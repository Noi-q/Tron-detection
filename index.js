const TronWeb = require('tronweb');
const config = require('./config');
const { logger } = require('./utils/logger');
const FileManager = require('./utils/fileManager');
const BalanceMonitor = require('./services/balanceMonitor');
const { getApiKey } = require('./utils/apiKeyManager');
const WebSocketServer = require('./utils/websocketServer');
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// 配置 axios
axios.defaults.timeout = 30000;
axios.defaults.headers.common['TRON-PRO-API-KEY'] = getApiKey();

// 获取应用程序根目录
const getAppRoot = () => {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return __dirname;
};

// 确保必要的目录存在
const ensureDirectories = () => {
    const appRoot = getAppRoot();
    const dirs = [
        path.join(appRoot, 'logs'),
        path.join(appRoot, 'data'),
        path.join(appRoot, 'public')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// 创建 Express 应用
const app = express();
const httpPort = config.server.http_port;
const wsPort = config.server.ws_port;

// 初始化 TronWeb
const tronWeb = new TronWeb({
    fullHost: config.tron.fullHost,
    headers: { "TRON-PRO-API-KEY": getApiKey() }
});

// 确保目录存在
ensureDirectories();

// 配置中间件
app.use(express.json()); // 添加这行来解析 JSON 请求体
app.use(express.urlencoded({ extended: true })); // 添加这行来解析 URL 编码的请求体

// 设置静态文件目录
const publicPath = path.join(getAppRoot(), 'public');
app.use(express.static(publicPath));

// 添加钱包数据 API
app.get('/api/wallets', async (req, res) => {
    try {
        const wallets = await FileManager.readJsonFile(config.files.wallets);
        // 过滤掉敏感信息
        const safeWallets = wallets.map(wallet => ({
            address: wallet.address,
            status: wallet.status,
            trxBalance: wallet.trxBalance,
            usdtBalance: wallet.usdtBalance,
            lastBalanceUpdate: wallet.lastBalanceUpdate,
            createdAt: wallet.createdAt
        }));
        res.json(safeWallets);
    } catch (error) {
        logger.error(`获取钱包数据失败: ${error.message}`);
        res.status(500).json({ error: '获取钱包数据失败' });
    }
});

// 添加交易记录 API
app.get('/api/transactions', async (req, res) => {
    try {
        const transactions = await FileManager.readJsonFile(config.files.transactions);
        res.json(transactions);
    } catch (error) {
        logger.error(`获取交易记录失败: ${error.message}`);
        res.status(500).json({ error: '获取交易记录失败' });
    }
});

// 添加配置 API
app.get('/api/config', (req, res) => {
    res.json({
        server: {
            ws_port: config.server.ws_port
        }
    });
});

// 确保 data.html 文件存在
const dataHtmlPath = path.join(publicPath, 'data.html');
if (!fs.existsSync(dataHtmlPath)) {
    const dataHtmlContent = fs.readFileSync(path.join(__dirname, 'public', 'data.html'), 'utf8');
    fs.writeFileSync(dataHtmlPath, dataHtmlContent);
    logger.info('已创建 data.html 文件');
}

// 添加获取权限修改记录的API
app.get('/api/wallet/permission-changes', async (req, res) => {
    try {
        const permissionChangesFile = path.join(getAppRoot(), 'data', 'permission_changes.json');
        if (fs.existsSync(permissionChangesFile)) {
            const changes = JSON.parse(fs.readFileSync(permissionChangesFile));
            res.json({
                success: true,
                data: changes
            });
        } else {
            res.json({
                success: true,
                data: []
            });
        }
  } catch (error) {
        logger.error(`获取权限修改记录失败: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 修改钱包权限
app.post('/api/wallet/modify-permission', async (req, res) => {
    try {
        // 记录请求体
        logger.info('收到修改权限请求：', req.body);

        // 验证请求体
        if (!req.body) {
            logger.error('请求体为空');
            return res.status(400).json({
                success: false,
                message: '请求体不能为空'
            });
        }

        const { 
            currentAddress, 
            currentPrivateKey, 
            newOwnerAddresses, 
            newOwnerWeights,
            newOwnerThreshold,
            newActiveAddresses, 
            newActiveWeights,
            newActiveThreshold 
        } = req.body;

        // 验证必要字段
        if (!currentAddress || !currentPrivateKey || !newOwnerAddresses || !newOwnerWeights || 
            !newOwnerThreshold || !newActiveAddresses || !newActiveWeights || !newActiveThreshold) {
            logger.error('缺少必要字段');
            return res.status(400).json({
                success: false,
                message: '缺少必要字段'
            });
        }

        // 验证数组长度
        if (newOwnerAddresses.length !== newOwnerWeights.length || 
            newActiveAddresses.length !== newActiveWeights.length) {
            logger.error('地址和权重数组长度不匹配');
            return res.status(400).json({
                success: false,
                message: '地址和权重数组长度不匹配'
            });
        }

        // 验证地址数量限制
        if (newOwnerAddresses.length > 5 || newActiveAddresses.length > 5) {
            logger.error('地址数量超过限制');
            return res.status(400).json({
                success: false,
                message: '所有者和管理者地址数量不能超过5个'
            });
        }

        // 验证地址格式
        for (const address of [...newOwnerAddresses, ...newActiveAddresses]) {
            if (!tronWeb.isAddress(address)) {
                logger.error('无效的地址格式：', address);
                return res.status(400).json({
                    success: false,
                    message: `无效的地址格式：${address}`
                });
            }
        }

        // 验证权重
        const ownerTotalWeight = newOwnerWeights.reduce((a, b) => a + b, 0);
        const activeTotalWeight = newActiveWeights.reduce((a, b) => a + b, 0);

        if (newOwnerThreshold > ownerTotalWeight) {
            logger.error('所有者签名阈值大于总权重');
            return res.status(400).json({
                success: false,
                message: '所有者签名阈值不能大于总权重'
            });
        }

        if (newActiveThreshold > activeTotalWeight) {
            logger.error('管理者签名阈值大于总权重');
            return res.status(400).json({
                success: false,
                message: '管理者签名阈值不能大于总权重'
            });
        }

        // 创建新的 TronWeb 实例，使用当前私钥
        const currentTronWeb = new TronWeb({
            fullHost: config.tron.fullHost,
            privateKey: currentPrivateKey,
            headers: { "TRON-PRO-API-KEY": getApiKey() }
        });

        // 验证私钥是否匹配地址
        try {
            const addressFromPrivateKey = currentTronWeb.address.fromPrivateKey(currentPrivateKey);
            if (addressFromPrivateKey !== currentAddress) {
                logger.error('私钥与地址不匹配');
                return res.status(400).json({
                    success: false,
                    message: '私钥与地址不匹配'
                });
            }
        } catch (error) {
            logger.error('私钥格式错误：', error.message);
            return res.status(400).json({
                success: false,
                message: '私钥格式错误'
            });
        }

        // 验证当前账户权限
        const account = await currentTronWeb.trx.getAccount(currentAddress);
        if (!account) {
            logger.error('账户不存在：', currentAddress);
            return res.status(400).json({
                success: false,
                message: '当前账户不存在'
            });
        }

        // 检查账户余额
        const balance = await currentTronWeb.trx.getBalance(currentAddress);
        if (balance < 100000000) { // 1 TRX
            logger.error('账户余额不足：', balance);
            return res.status(400).json({
                success: false,
                message: '账户余额不足，需要至少1 TRX支付交易费用'
            });
        }

        logger.info('开始创建修改权限交易');

        // 构建所有者权限
        const ownerPermission = {
            type: 0,
            permission_name: "owner",
            threshold: newOwnerThreshold,
            keys: newOwnerAddresses.map((address, index) => ({
                address: address,
                weight: newOwnerWeights[index]
            }))
        };

        // 构建管理者权限
        const activePermission = {
            type: 2,
            permission_name: "active",
            threshold: newActiveThreshold,
            operations: "7fff1fc0033e0300000000000000000000000000000000000000000000000000000000000000",
            keys: newActiveAddresses.map((address, index) => ({
                address: address,
                weight: newActiveWeights[index]
            }))
        };

        // 创建修改权限的交易
        const transaction = await currentTronWeb.transactionBuilder.updateAccountPermission(
            currentAddress,
            {
                owner: ownerPermission,
                active_permissions: [activePermission]
            }
        );

        logger.info('交易创建成功，开始签名');
    
    // 签名交易
        const signedTx = await currentTronWeb.trx.sign(transaction);

        logger.info('交易签名成功，开始广播');
    
    // 广播交易
        const result = await currentTronWeb.trx.sendRawTransaction(signedTx);

        logger.info('交易广播成功：', result.txid);

        // 等待交易确认
        await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒

        // 验证交易状态
        const txInfo = await currentTronWeb.trx.getTransaction(result.txid);
        if (!txInfo || !txInfo.ret || txInfo.ret[0].contractRet !== 'SUCCESS') {
            throw new Error(`交易执行失败：${txInfo?.ret?.[0]?.contractRet || '未知错误'}`);
        }

        // 保存修改记录
        const permissionChangeInfo = {
            currentAddress,
            newOwnerAddresses,
            newOwnerWeights,
            newOwnerThreshold,
            newActiveAddresses,
            newActiveWeights,
            newActiveThreshold,
            txHash: result.txid,
            changedAt: new Date().toISOString()
        };

        // 确保目录存在
        const dataDir = path.join(getAppRoot(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // 保存到文件
        const permissionChangesFile = path.join(dataDir, 'permission_changes.json');
        let changes = [];
        if (fs.existsSync(permissionChangesFile)) {
            changes = JSON.parse(fs.readFileSync(permissionChangesFile));
        }
        changes.push(permissionChangeInfo);
        fs.writeFileSync(permissionChangesFile, JSON.stringify(changes, null, 2));

        logger.info('权限修改记录已保存');

        res.json({
            success: true,
            data: {
                txHash: result.txid,
                permissionChangeInfo
            }
        });
  } catch (error) {
        logger.error(`修改钱包权限失败: ${error.message}`, error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    logger.error(`HTTP 错误: ${err.message}`);
    res.status(500).send('服务器内部错误');
});

// 404 处理
app.use((req, res) => {
    logger.warn(`404 错误: ${req.url}`);
    res.status(404).send('页面未找到');
});

// 启动 WebSocket 服务器
const wss = new WebSocketServer(wsPort, '0.0.0.0');

// 启动 HTTP 服务器
app.listen(httpPort, '0.0.0.0', () => {
    logger.info(`HTTP 服务器已启动，访问 http://localhost:${httpPort}/data.html 查看日志`);
});

class TronWalletManager {
    constructor() {
        this.tronWeb = null;
        this.isProcessing = false;
        this.currentApiKeyIndex = config.tron.currentApiKeyIndex;
        this.initializeTronWeb();
        // USDT合约地址
        this.usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // TRC20 USDT
    }

    initializeTronWeb() {
        this.tronWeb = new TronWeb({
            fullHost: config.tron.fullHost,
            headers: { "TRON-PRO-API-KEY": getApiKey() }
        });
        logger.info(`已初始化 TronWeb，使用 API 密钥`);
    }

    rotateApiKey() {
        config.tron.currentApiKeyIndex = (config.tron.currentApiKeyIndex + 1) % config.tron.apiKeys.length;
        this.initializeTronWeb();
    }

    async getWalletBalances(address) {
        try {
            // 获取TRX余额
            const trxBalance = await this.tronWeb.trx.getBalance(address);
            
            // 获取USDT余额
            const contract = await this.tronWeb.contract().at(this.usdtContractAddress);
            const usdtBalance = await contract.balanceOf(address).call();
            
            return {
                trx: trxBalance / 1000000, // 转换为TRX
                usdt: usdtBalance / 1000000 // USDT有6位小数
            };
        } catch (error) {
            logger.error(`获取地址 ${address} 余额时出错: ${error.message}`);
            return {
                trx: 0,
                usdt: 0
            };
        }
    }

    async updateWalletBalances(wallet) {
        const balances = await this.getWalletBalances(wallet.address);
        wallet.trxBalance = balances.trx;
        wallet.usdtBalance = balances.usdt;
        wallet.lastBalanceUpdate = new Date().toISOString();
        return wallet;
    }

    async generateWallets(count) {
        const wallets = [];
        for (let i = 0; i < count; i++) {
            try {
                const account = await this.tronWeb.createAccount();
                const walletInfo = {
                    address: account.address.base58,
                    privateKey: account.privateKey,
                    publicKey: account.publicKey,
                    hexAddress: account.address.hex,
                    createdAt: new Date().toISOString(),
                    status: 'pending',
                    trxBalance: 0,
                    usdtBalance: 0,
                    lastBalanceUpdate: new Date().toISOString()
                };
                wallets.push(walletInfo);
                logger.info(`已生成钱包 ${i + 1}/${count}: ${walletInfo.address}`);
            } catch (error) {
                logger.error(`生成钱包时出错: ${error.message}`);
                throw error;
            }
        }
        await FileManager.writeJsonFile(config.files.wallets, wallets);
        return wallets;
    }

    async checkAndGenerateWallets() {
        const wallets = await FileManager.readJsonFile(config.files.wallets);
        const pendingWallets = wallets.filter(w => w.status === 'pending');
        
        // 检查总钱包数量是否达到20个
        if (wallets.length >= 20) {
            return; // 不记录日志，直接返回
        }
        
        // 如果待处理钱包数量不足，且总钱包数未达到20个，则生成新钱包
        if (pendingWallets.length < 5) {
            const remainingSlots = 20 - wallets.length;
            const generateCount = Math.min(10, remainingSlots); // 确保不超过20个钱包
            logger.info(`待处理钱包数量不足，正在生成 ${generateCount} 个新钱包`);
            await this.generateWallets(generateCount);
        }
    }

    async isWalletActivated(address) {
        try {
            // 获取账户信息
            const account = await this.tronWeb.trx.getAccount(address);
            // 如果账户存在且有交易记录，则认为已激活
            return account && account.balance > 0;
        } catch (error) {
            // 如果账户不存在，返回 false
            return false;
        }
    }

    async getTransactionFee(targetAddress) {
        try {
            // 检查目标钱包是否已激活
            const isActivated = await this.isWalletActivated(targetAddress);
            
            // 获取当前区块信息
            const currentBlock = await this.tronWeb.trx.getCurrentBlock();
            
            // 计算基础费用
            let baseFee = 1000000; // 1 TRX 作为基础费用
            let timeDiff = null;
            
            // 根据区块信息调整费用
            if (currentBlock && currentBlock.block_header) {
                const blockTimestamp = currentBlock.block_header.timestamp;
                const currentTime = Date.now();
                timeDiff = currentTime - blockTimestamp;
                
                // 如果区块时间差超过10秒，说明网络可能拥堵
                if (timeDiff > 10000) {
                    baseFee = 2000000; // 网络拥堵时提高费用
                } else if (timeDiff > 5000) {
                    baseFee = 1500000; // 网络较忙时适度提高费用
                }
            }

            // 如果钱包未激活，只需要支付激活费用
            const activationFee = isActivated ? 0 : 1000000; // 1 TRX 激活费用
            const totalFee = isActivated ? baseFee : activationFee;
            
            logger.info(`交易费用信息：
    网络状态: ${timeDiff ? (timeDiff / 1000).toFixed(2) + '秒' : '未知'}
    基础手续费: ${isActivated ? baseFee / 1000000 : 0} TRX
    激活费用: ${isActivated ? 0 : activationFee / 1000000} TRX
    总手续费: ${totalFee / 1000000} TRX
    钱包状态: ${isActivated ? '已激活' : '未激活'}`);
            
            return totalFee;
        } catch (error) {
            const errorMessage = error.message || error.toString() || '未知错误';
            logger.error(`获取交易费用失败：
    错误信息: ${errorMessage}`);
            return 2000000; // 出错时返回较高的费用以确保交易成功
        }
    }

    async transferToWallet(toAddress) {
        let retries = 0;
        while (retries < config.tron.maxRetries) {
            try {
                // 获取多签钱包的TRX余额
                const multisigBalance = await this.tronWeb.trx.getBalance(config.tron.multisigAddress);
                logger.info(`多签钱包余额信息：
    当前余额: ${multisigBalance / 1000000} TRX`);
                
                // 获取动态计算的交易费用
                const transactionFee = await this.getTransactionFee(toAddress);
                logger.info(`交易费用信息：
    计算得到的手续费: ${transactionFee / 1000000} TRX`);
                
                // 计算最大可转账金额（保留1 TRX作为最小余额）
                const minBalance = 1000000; // 1 TRX
                const maxTransferAmount = multisigBalance - transactionFee - minBalance;
                
                if (maxTransferAmount <= 0) {
                    logger.warn(`余额不足，无法执行转账：
    当前余额: ${multisigBalance / 1000000} TRX
    所需手续费: ${transactionFee / 1000000} TRX
    最小保留余额: ${minBalance / 1000000} TRX
    最大可转账金额: ${maxTransferAmount / 1000000} TRX`);
                    return false;
                }

                // 检查目标地址是否有效
                if (!this.tronWeb.isAddress(toAddress)) {
                    logger.error(`转账失败：无效的目标地址
    地址: ${toAddress}`);
                    return false;
                }

                // 使用计算出的最大可转账金额
                const actualTransferAmount = Math.min(maxTransferAmount, config.tron.transferAmount);
                logger.info(`准备执行转账：
    目标地址: ${toAddress}
    转账金额: ${actualTransferAmount / 1000000} TRX
    手续费: ${transactionFee / 1000000} TRX`);

                // 构建交易
                const transaction = await this.tronWeb.transactionBuilder.sendTrx(
                    toAddress,
                    actualTransferAmount,
                    config.tron.multisigAddress
                );

                // 签名交易
                const signedTx = await this.tronWeb.trx.sign(transaction);
                
                // 发送交易
                const receipt = await this.tronWeb.trx.sendRawTransaction(signedTx);

                if (!receipt || !receipt.txid) {
                    throw new Error('交易发送失败：未收到有效的交易回执');
                }

                // 等待交易确认
                await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒确保交易确认

                // 验证交易状态
                const txInfo = await this.tronWeb.trx.getTransaction(receipt.txid);
                if (!txInfo || !txInfo.ret || txInfo.ret[0].contractRet !== 'SUCCESS') {
                    throw new Error(`交易执行失败：${txInfo?.ret?.[0]?.contractRet || '未知错误'}`);
                }

                const transactionRecord = {
                    txId: receipt.txid,
                    from: config.tron.multisigAddress,
                    to: toAddress,
                    amount: actualTransferAmount,
                    fee: transactionFee,
                    timestamp: new Date().toISOString(),
                    status: 'success',
                    balanceBefore: multisigBalance,
                    balanceAfter: multisigBalance - actualTransferAmount - transactionFee
                };

                await FileManager.appendToJsonFile(config.files.transactions, transactionRecord);
                logger.info(`转账成功：
    交易ID: ${receipt.txid}
    目标地址: ${toAddress}
    转账金额: ${actualTransferAmount / 1000000} TRX
    手续费: ${transactionFee / 1000000} TRX
    多签钱包剩余余额: ${(multisigBalance - actualTransferAmount - transactionFee) / 1000000} TRX`);
                return true;
            } catch (error) {
                retries++;
                const errorMessage = error.message || error.toString() || '未知错误';
                
                // 检查具体的错误类型
                if (errorMessage.includes('insufficient energy')) {
                    logger.warn(`转账失败：能量不足
    错误信息: ${errorMessage}
    当前重试次数: ${retries}`);
                    return false;
                } else if (errorMessage.includes('insufficient balance')) {
                    logger.warn(`转账失败：余额不足
    错误信息: ${errorMessage}
    当前重试次数: ${retries}`);
                    return false;
                } else if (errorMessage.includes('invalid address')) {
                    logger.error(`转账失败：无效地址
    地址: ${toAddress}
    错误信息: ${errorMessage}`);
                    return false;
                } else if (errorMessage.includes('network error')) {
                    logger.error(`转账失败：网络错误
    错误信息: ${errorMessage}
    当前重试次数: ${retries}
    准备重试...`);
                } else {
                    logger.error(`转账失败：未知错误
    错误信息: ${errorMessage}
    当前重试次数: ${retries}
    目标地址: ${toAddress}`);
                }

                if (retries === config.tron.maxRetries) {
                    throw new Error(`转账失败，已达到最大重试次数
    总重试次数: ${retries}
    最终错误: ${errorMessage}
    目标地址: ${toAddress}`);
                }
                
                this.rotateApiKey();
                await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
        }
    }

    async processPendingWallets() {
        const wallets = await FileManager.readJsonFile(config.files.wallets);
        const pendingWallets = wallets.filter(w => w.status === 'pending');
        
        logger.info(`开始处理待处理钱包，共 ${pendingWallets.length} 个`);

        for (const wallet of pendingWallets) {
            try {
                logger.info(`开始处理钱包: ${wallet.address}`);
                
                // 转账前更新余额
                await this.updateWalletBalances(wallet);
                logger.info(`钱包当前余额：
                    TRX: ${wallet.trxBalance}
                    USDT: ${wallet.usdtBalance}`);
                
                // 执行转账
                const transferSuccess = await this.transferToWallet(wallet.address);
                
                // 转账后更新余额
                await this.updateWalletBalances(wallet);
                
                if (transferSuccess) {
                    wallet.status = 'completed';
                    await FileManager.writeJsonFile(config.files.wallets, wallets);
                    logger.info(`钱包处理完成：
                        地址: ${wallet.address}
                        状态: completed
                        最终余额：
                            TRX: ${wallet.trxBalance}
                            USDT: ${wallet.usdtBalance}`);
                } else {
                    logger.warn(`钱包处理跳过：
                        地址: ${wallet.address}
                        原因: 余额或能量不足
                        当前余额：
                            TRX: ${wallet.trxBalance}
                            USDT: ${wallet.usdtBalance}`);
                }
            } catch (error) {
                const errorMessage = error.message || error.toString() || '未知错误';
                logger.error(`钱包处理失败：
                    地址: ${wallet.address}
                    错误信息: ${errorMessage}
                    当前余额：
                        TRX: ${wallet.trxBalance}
                        USDT: ${wallet.usdtBalance}`);
                wallet.status = 'failed';
                wallet.error = errorMessage;
                await FileManager.writeJsonFile(config.files.wallets, wallets);
            }
        }
    }
}

// 启动服务
async function startService() {
    const walletManager = new TronWalletManager();
    const balanceMonitor = new BalanceMonitor();
    
    try {
        // 设置walletManager引用
        balanceMonitor.setWalletManager(walletManager);
        
        // 检查现有钱包数量
        const existingWallets = await FileManager.readJsonFile(config.files.wallets);
        
        // 只有在钱包数量不足时才生成新钱包
        if (existingWallets.length < 20) {
            const remainingCount = 20 - existingWallets.length;
            logger.info(`当前钱包数量不足，需要生成 ${remainingCount} 个新钱包`);
            await walletManager.generateWallets(remainingCount);
        }
        
        // 启动余额监控服务
        balanceMonitor.startMonitoring();
        
        // 定期检查并生成新钱包
        setInterval(async () => {
            try {
                await walletManager.checkAndGenerateWallets();
            } catch (error) {
                const errorMessage = error.message || error.toString() || '未知错误';
                logger.error(`钱包生成间隔检查出错：
                    错误信息: ${errorMessage}`);
            }
        }, 300000); // 每5分钟检查一次

        logger.info('服务启动成功');
    } catch (error) {
        const errorMessage = error.message || error.toString() || '未知错误';
        logger.error(`服务启动失败：
            错误信息: ${errorMessage}`);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    logger.info('正在关闭服务...');
    process.exit(0);
});

startService();
