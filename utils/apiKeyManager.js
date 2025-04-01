const config = require('../config');
const { logger } = require('./logger');

class ApiKeyManager {
    constructor() {
        this.apiKeys = config.tron.apiKeys;
        this.currentIndex = 0;
    }

    getCurrentApiKey() {
        return this.apiKeys[this.currentIndex];
    }

    rotateApiKey() {
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        logger.info(`已切换到新的 API 密钥，当前索引: ${this.currentIndex}`);
        return this.getCurrentApiKey();
    }

    getApiKey() {
        return this.getCurrentApiKey();
    }
}

// 创建单例实例
const apiKeyManager = new ApiKeyManager();

module.exports = {
    getApiKey: () => apiKeyManager.getApiKey(),
    rotateApiKey: () => apiKeyManager.rotateApiKey()
}; 