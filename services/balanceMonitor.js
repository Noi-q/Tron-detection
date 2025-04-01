const TronWeb = require('tronweb');
const config = require('../config');
const { logger, logTransferSuccess, logBalanceCheck, logSystemError } = require('../utils/logger');
const FileManager = require('../utils/fileManager');
const { getApiKey } = require('../utils/apiKeyManager');

class BalanceMonitor {
    constructor() {
        this.tronWeb = null;
        this.walletManager = null;
        this.isTransferring = false;
        this.currentWalletIndex = 0;
        this.isProcessing = false;
        this.balanceThreshold = config.tron.threshold;
        this.checkInterval = config.tron.balanceCheckInterval;
        
        // 初始化基础 TronWeb 实例
        this.initializeTronWeb();
        
        // 初始化多签钱包实例
        try {
            // 创建多签钱包实例
            this.multisigTronWeb = new TronWeb({
                fullHost: config.tron.fullHost,
                privateKey: config.tron.ownerPrivateKey,
                headers: { "TRON-PRO-API-KEY": getApiKey() }
            });

            // 创建签名者钱包实例
            this.signerTronWeb = new TronWeb({
                fullHost: config.tron.fullHost,
                privateKey: config.tron.signerPrivateKey,
                headers: { "TRON-PRO-API-KEY": getApiKey() }
            });

            // 获取多签钱包地址和权限信息
            const multisigAddress = config.tron.multisigAddress;
            const ownerAddress = this.multisigTronWeb.address.fromPrivateKey(config.tron.ownerPrivateKey);
            const signerAddress = this.signerTronWeb.address.fromPrivateKey(config.tron.signerPrivateKey);

            logger.info(`余额监控器初始化完成：
    阈值: ${this.balanceThreshold} TRX
    检查间隔: ${this.checkInterval / 1000} 秒
    多签地址: ${multisigAddress}
    所有者地址: ${ownerAddress}
    签名者地址: ${signerAddress}
    多签权限: Owner和Active权限
    权限阈值: ${config.tron.threshold}`);

        } catch (error) {
            logger.error(`初始化多签钱包失败：
    错误信息: ${error.message}
    所有者私钥长度: ${config.tron.ownerPrivateKey.length}
    签名者私钥长度: ${config.tron.signerPrivateKey.length}
    多签地址: ${config.tron.multisigAddress}`);
            throw error;
        }
    }

    // 修改 formatPrivateKey 方法
    formatPrivateKey(privateKey) {
        try {
            // 如果已经是 Buffer，直接返回
            if (Buffer.isBuffer(privateKey)) {
                return privateKey;
            }
            
            // 如果是十六进制字符串，转换为 Buffer
            if (typeof privateKey === 'string') {
                // 移除可能存在的 0x 前缀
                const hexKey = privateKey.replace('0x', '');
                
                // 验证十六进制格式
                if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
                    throw new Error('私钥格式无效，必须是64位十六进制字符串');
                }
                
                return Buffer.from(hexKey, 'hex');
            }
            
            throw new Error('私钥必须是 Buffer 或十六进制字符串');
        } catch (error) {
            logger.error(`私钥格式化失败：
    错误信息: ${error.message}
    私钥类型: ${typeof privateKey}
    私钥长度: ${privateKey ? privateKey.length : 'undefined'}`);
            throw error;
        }
    }

    setWalletManager(walletManager) {
        this.walletManager = walletManager;
    }

    initializeTronWeb() {
        this.tronWeb = new TronWeb({
            fullHost: config.tron.fullHost,
            headers: { "TRON-PRO-API-KEY": getApiKey() }
        });
        logger.info(`已初始化基础 TronWeb 实例，使用 API 密钥`);
    }

    rotateApiKey() {
        config.tron.currentApiKeyIndex = (config.tron.currentApiKeyIndex + 1) % config.tron.apiKeys.length;
        this.initializeTronWeb();
    }

    async getBalance() {
        try {
            const balance = await this.tronWeb.trx.getBalance(config.tron.ownerAddress);
            return balance;
        } catch (error) {
            const errorMessage = error.message || error.toString() || '未知错误';
            logger.error(`获取所有者钱包余额时出错：
                错误信息: ${errorMessage}
                钱包地址: ${config.tron.ownerAddress}`);
            throw error;
        }
    }

    async recordBalanceHistory() {
        try {
            const balance = await this.getBalance();
            const history = await FileManager.readJsonFile(config.files.balanceHistory);
            
            history.push({
                timestamp: new Date().toISOString(),
                balance: balance / 1000000,
                threshold: this.balanceThreshold
            });

            await FileManager.writeJsonFile(config.files.balanceHistory, history);
            
            // 使用新的日志记录功能
            logBalanceCheck(config.tron.ownerAddress, balance / 1000000, this.balanceThreshold);
        } catch (error) {
            logSystemError(error, {
                type: 'balance_history',
                address: config.tron.ownerAddress
            });
        }
    }

    async transferExcessBalance() {
        if (this.isTransferring) {
            logger.info('已有转账正在处理中，跳过本次检查...');
            return;
        }

        let targetWallet = null;
        try {
            this.isTransferring = true;
            
            // 获取所有钱包
            const wallets = await FileManager.readJsonFile(config.files.wallets);
            if (!wallets || wallets.length === 0) {
                logger.warn('没有可用的钱包用于转账');
                return;
            }

            // 获取当前要使用的钱包
            targetWallet = wallets[this.currentWalletIndex];
            
            // 更新索引，循环使用钱包
            this.currentWalletIndex = (this.currentWalletIndex + 1) % wallets.length;
            
            logger.info(`使用钱包地址进行转账：
    地址: ${targetWallet.address}
    当前索引: ${this.currentWalletIndex}
    总钱包数: ${wallets.length}`);

            // 获取所有者钱包余额
            const balance = await this.tronWeb.trx.getBalance(config.tron.ownerAddress);
            const balanceInTrx = balance / 1000000;

            // 获取账户资源信息
            const accountResources = await this.tronWeb.trx.getAccountResources(config.tron.ownerAddress);
            const energy = accountResources.EnergyLimit || 0;
            const bandwidth = accountResources.NetLimit || 0;

            // 获取动态计算的交易费用（包含激活费用）
            const transactionFee = await this.walletManager.getTransactionFee(targetWallet.address);
            const transactionFeeInTrx = transactionFee / 1000000;

            // 计算可转账金额：当前余额 - 手续费 - 最小保留余额(1 TRX)
            const minReserveBalance = 1; // 最小保留余额 1 TRX
            const transferAmountInTrx = balanceInTrx - transactionFeeInTrx - minReserveBalance;
            
            // 确保转账金额大于0
            if (transferAmountInTrx <= 0) {
                logger.warn(`余额不足，无法执行转账：
    当前余额: ${balanceInTrx} TRX
    手续费: ${transactionFeeInTrx} TRX
    最小保留余额: ${minReserveBalance} TRX
    发送地址: ${config.tron.ownerAddress}
    接收地址: ${targetWallet.address}
    计划转账金额: ${transferAmountInTrx} TRX
    账户资源:
    - 能量: ${energy}
    - 带宽: ${bandwidth}`);
                return;
            }

            // 将转账金额转换为 SUN（整数）
            const transferAmountInSun = Math.floor(transferAmountInTrx * 1000000);

            // 记录转账信息
            const transferRecord = {
                timestamp: new Date().toISOString(),
                from: config.tron.ownerAddress,
                to: targetWallet.address,
                amount: transferAmountInSun,
                amountInTrx: transferAmountInTrx,
                fee: transactionFee,
                feeInTrx: transactionFeeInTrx,
                minReserveBalance: minReserveBalance,
                balanceBefore: balanceInTrx,
                balanceAfter: balanceInTrx - transferAmountInTrx - transactionFeeInTrx,
                walletIndex: this.currentWalletIndex,
                totalWallets: wallets.length,
                status: 'pending',
                transferCount: 1,
                accountResources: {
                    energy,
                    bandwidth
                }
            };

            // 获取历史转账记录
            const transactions = await FileManager.readJsonFile(config.files.transactions) || [];
            const walletTransfers = transactions.filter(t => t.to === targetWallet.address);
            transferRecord.transferCount = walletTransfers.length + 1;

            logger.info(`准备转账：
    发送地址: ${config.tron.ownerAddress}
    接收地址: ${targetWallet.address}
    当前余额: ${balanceInTrx} TRX
    手续费: ${transactionFeeInTrx} TRX
    最小保留余额: ${minReserveBalance} TRX
    转账金额: ${transferAmountInTrx} TRX (${transferAmountInSun} SUN)
    转账后余额: ${transferRecord.balanceAfter} TRX
    钱包索引: ${this.currentWalletIndex}/${wallets.length}
    该钱包转账次数: ${transferRecord.transferCount}
    账户资源:
    - 能量: ${energy}
    - 带宽: ${bandwidth}`);

            // 执行多签转账
            try {
                // 1. 使用所有者钱包创建交易
                const transaction = await this.multisigTronWeb.transactionBuilder.sendTrx(
                    this.tronWeb.address.toHex(targetWallet.address),
                    transferAmountInSun,
                    this.tronWeb.address.toHex(config.tron.ownerAddress),
                    { 
                        permissionId: 0,  // 使用 owner 权限
                        feeLimit: 1000000,
                        energyLimit: 10000
                    }
                );

                // 2. 使用签名者钱包签名交易
                const signedTransaction = await this.signerTronWeb.trx.multiSign(
                    transaction,
                    config.tron.signerPrivateKey,
                    0  // 使用 owner 权限类型
                );

                logger.info('签名结果:', JSON.stringify(signedTransaction, null, 2));

                if (!signedTransaction || !signedTransaction.signature) {
                    throw new Error('签名失败');
                }
                logger.info('签名成功');

                // 3. 广播交易
                logger.info('开始广播交易...');
                const result = await this.tronWeb.trx.broadcast(signedTransaction);
                
                logger.info('广播结果:', JSON.stringify(result, null, 2));

                // 检查是否是余额不足错误
                if (result.code === 'CONTRACT_VALIDATE_ERROR') {
                    const errorMessage = result.message || '余额不足';
                    logger.error(`交易广播失败 - 余额不足：
    错误信息: ${errorMessage}
    当前余额: ${balanceInTrx} TRX
    手续费: ${transactionFeeInTrx} TRX
    计划转账金额: ${transferAmountInTrx} TRX
    发送地址: ${config.tron.ownerAddress}
    接收地址: ${targetWallet.address}`);
                    return;
                }

                if (!result || !result.result) {
                    throw new Error('交易广播失败: ' + (result?.message || '未知错误'));
                }

                const txid = result.txid || result.transaction?.txID;
                if (!txid) {
                    throw new Error('交易广播失败: 未获取到交易ID');
                }

                // 等待交易确认
                let isConfirmed = false;
                let retryCount = 0;
                const maxRetries = 20;
                
                while (!isConfirmed && retryCount < maxRetries) {
                    try {
                        const txInfo = await this.tronWeb.trx.getTransaction(txid);
                        
                        if (txInfo && txInfo.ret && txInfo.ret[0].contractRet === 'SUCCESS') {
                            isConfirmed = true;
                            transferRecord.status = 'success';
                            transferRecord.txHash = txid;
                            
                            // 使用新的转账成功日志记录
                            logTransferSuccess(
                                config.tron.ownerAddress,
                                targetWallet.address,
                                transferAmountInTrx,
                                txid,
                                transactionFeeInTrx
                            );

                            // 记录交易
                            await this.recordTransaction(
                                result.txid,
                                config.tron.ownerAddress,
                                config.tron.signerAddress,
                                transferAmountInTrx,
                                'TRX',
                                'completed'
                            );

                            // 更新钱包状态
                            const walletIndex = wallets.findIndex(w => w.address === config.tron.ownerAddress);
                            if (walletIndex !== -1) {
                                wallets[walletIndex].status = 'completed';
                                wallets[walletIndex].lastTransaction = {
                                    txHash: result.txid,
                                    timestamp: new Date().toISOString()
                                };
                                await FileManager.writeJsonFile(config.files.wallets, wallets);
                            }

                            logger.info(`转账成功: ${result.txid}`);
                            break;
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        retryCount++;
                        logger.info(`等待交易确认中... (${retryCount}/${maxRetries})`);
                    } catch (error) {
                        if (error.message && error.message.includes('Transaction not found')) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            retryCount++;
                            continue;
                        }
                        throw error;
                    }
                }
                
                if (!isConfirmed) {
                    throw new Error('交易确认超时');
                }
            } catch (txError) {
                const errorMessage = txError.message || '未知错误';
                const errorDetails = txError.response?.data || {};
                
                logger.error(`交易执行失败：
    错误信息: ${errorMessage}
    错误详情: ${JSON.stringify(errorDetails)}
    发送地址: ${config.tron.ownerAddress}
    接收地址: ${targetWallet ? targetWallet.address : 'unknown'}
    转账金额: ${transferAmountInTrx} TRX (${transferAmountInSun} SUN)
    钱包索引: ${this.currentWalletIndex}/${wallets.length}`);
                
                // 在错误处理的地方使用新的系统错误日志
                logSystemError(txError, {
                    type: 'transfer',
                    from: config.tron.ownerAddress,
                    to: targetWallet ? targetWallet.address : 'unknown',
                    amount: transferAmountInTrx
                });
                throw txError;
            }

            // 保存转账记录
            transactions.push(transferRecord);
            await FileManager.writeJsonFile(config.files.transactions, transactions);
        } catch (error) {
            const errorMessage = error.message || error.toString() || '未知错误';
            logger.error(`转账过程发生错误：
    错误信息: ${errorMessage}
    发送地址: ${config.tron.ownerAddress}
    接收地址: ${targetWallet ? targetWallet.address : '未获取到目标钱包'}
    钱包索引: ${this.currentWalletIndex}`);
            
            // 在错误处理的地方使用新的系统错误日志
            logSystemError(error, {
                type: 'transfer',
                from: config.tron.ownerAddress,
                to: targetWallet ? targetWallet.address : 'unknown',
                amount: transferAmountInTrx
            });
        } finally {
            this.isTransferring = false;
        }
    }

    async checkBalance() {
        try {
            // 记录余额历史
            await this.recordBalanceHistory();
            
            // 检查并处理超额余额
            await this.transferExcessBalance();
        } catch (error) {
            const errorMessage = error.message || error.toString() || '未知错误';
            logger.error(`余额检查过程出错：
                错误信息: ${errorMessage}`);
            
            // 在错误处理的地方使用新的系统错误日志
            logSystemError(error, {
                type: 'balance_check',
                address: config.tron.ownerAddress
            });
            throw error;
        }
    }

    startMonitoring() {
        logger.info('正在启动余额监控服务');
        
        // 立即执行一次检查
        this.checkBalance();
        
        // 设置定期检查
        this.monitoringInterval = setInterval(async () => {
            try {
                await this.checkBalance();
            } catch (error) {
                const errorMessage = error.message || error.toString() || '未知错误';
                logger.error(`余额监控间隔检查出错：
                    错误信息: ${errorMessage}`);
                
                // 在错误处理的地方使用新的系统错误日志
                logSystemError(error, {
                    type: 'monitoring_interval',
                    address: config.tron.ownerAddress
                });
            }
        }, this.checkInterval);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            logger.info('已停止余额监控服务');
        }
    }

    async recordTransaction(txHash, from, to, amount, type, status) {
        try {
            const transactions = await FileManager.readJsonFile(config.files.transactions);
            const wallets = await FileManager.readJsonFile(config.files.wallets);
            
            // 添加交易记录
            transactions.push({
                txHash,
                from,
                to,
                amount,
                type,
                status,
                timestamp: new Date().toISOString()
            });
            
            // 更新钱包状态
            const walletIndex = wallets.findIndex(w => w.address === from);
            if (walletIndex !== -1) {
                wallets[walletIndex].status = status;
                wallets[walletIndex].lastTransaction = {
                    txHash,
                    timestamp: new Date().toISOString()
                };
            }

            // 保存更新后的数据
            await FileManager.writeJsonFile(config.files.transactions, transactions);
            await FileManager.writeJsonFile(config.files.wallets, wallets);
            
            logger.info(`交易记录已保存: ${txHash}`);
        } catch (error) {
            logger.error(`保存交易记录失败: ${error.message}`);
        }
    }
}

module.exports = BalanceMonitor; 