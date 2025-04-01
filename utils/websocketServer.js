const WebSocket = require('ws');
const { logger } = require('./logger');

class WebSocketServer {
    constructor(port, host = '0.0.0.0') {
        this.wss = new WebSocket.Server({ port, host });
        this.clients = new Set();
        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            logger.info('新的 WebSocket 客户端已连接');

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.info('WebSocket 客户端已断开连接');
            });
        });

        this.wss.on('error', (error) => {
            logger.error(`WebSocket 服务器错误: ${error.message}`);
        });

        // 重写 logger 的 transport 来捕获日志
        logger.transports.forEach(transport => {
            const originalLog = transport.log;
            transport.log = (info, callback) => {
                // 构造日志消息
                const logMessage = {
                    level: info.level,
                    message: info.message,
                    timestamp: info.timestamp
                };
                
                // 发送日志到所有连接的客户端
                this.broadcast(logMessage);
                
                // 调用原始的日志方法
                originalLog.call(transport, info, callback);
            };
        });
    }

    broadcast(message) {
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

module.exports = WebSocketServer; 