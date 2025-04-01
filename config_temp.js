const path = require('path');
const fs = require('fs');

// 获取应用程序根目录
const getAppRoot = () => {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return __dirname;
};

// 确保目录存在
const ensureDirectories = () => {
    const appRoot = getAppRoot();
    const dirs = [
        path.join(appRoot, 'logs'),
        path.join(appRoot, 'data')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// 确保目录存在
ensureDirectories();

module.exports = {
    tron: {
        fullHost: 'https://api.trongrid.io',
        apiKeys: [],
        currentApiKeyIndex: 0,
        ownerAddress: '', // 被签名地址
        multisigAddress: '', // 签名地址
        ownerPrivateKey: '', // 被签名地址私钥
        signerPrivateKey: '', // 签名地址私钥
        threshold: 1, // 余额阈值（TRX）
        transferAmount: 50, // 每次转账金额（TRX）
        balanceCheckInterval: 5000, // 余额检查间隔（毫秒）
        maxRetries: 3, // 最大重试次数
        retryDelay: 1000, // 重试延迟（毫秒）
        minBalance: 1, // 最小保留余额（TRX）
        usdtContractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' // USDT 合约地址
    },
    files: {
        wallets: path.join(getAppRoot(), 'data', 'wallets.json'),
        transactions: path.join(getAppRoot(), 'data', 'transactions.json'),
        logs: path.join(getAppRoot(), 'logs', 'app.log'),
        balanceHistory: path.join(getAppRoot(), 'data', 'balance_history.json')
    },
    logging: {
        level: 'info',
        log_dir: path.join(getAppRoot(), 'logs'),
        max_file_size: 5242880, // 5MB
        max_files: 5,
        format: {
            timestamp: 'YYYY-MM-DD HH:mm:ss',
            json: true
        }
    },
    server: {
        http_port: 8880,
        ws_port: 8881
    }
}; 