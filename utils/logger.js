const winston = require('winston');
const path = require('path');
const config = require('../config');

// 获取日志目录
function getLogDir() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const logDir = path.join(config.logging.log_dir, `${year}${month}${day}`);
    require('fs').mkdirSync(logDir, { recursive: true });
    return logDir;
}

// 创建日志目录
const logDir = getLogDir();

// 创建 winston logger 实例
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp({
            format: config.logging.format.timestamp
        }),
        winston.format.json()
    ),
    transports: [
        // 错误日志
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: config.logging.max_file_size,
            maxFiles: config.logging.max_files
        }),
        // 转账日志
        new winston.transports.File({
            filename: path.join(logDir, 'transfer.log'),
            maxsize: config.logging.max_file_size,
            maxFiles: config.logging.max_files
        }),
        // 系统日志
        new winston.transports.File({
            filename: path.join(logDir, 'system.log'),
            maxsize: config.logging.max_file_size,
            maxFiles: config.logging.max_files
        }),
        // 控制台输出
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// 导出所有需要的函数和实例
module.exports = {
    logger,
    logTransferSuccess: (fromAddress, toAddress, amount, txid, gasFee) => {
        logger.info('转账成功', {
            type: 'transfer_success',
            from: fromAddress,
            to: toAddress,
            amount: amount,
            txid: txid,
            gasFee: gasFee
        });
    },
    logBalanceCheck: (address, balance, threshold) => {
        logger.info('余额检查', {
            type: 'balance_check',
            address: address,
            balance: balance,
            threshold: threshold
        });
    },
    logSystemError: (error, context) => {
        logger.error('系统错误', {
            type: 'system_error',
            context: context,
            error: error.message,
            stack: error.stack
        });
    }
}; 