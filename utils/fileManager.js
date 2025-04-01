const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

class FileManager {
    static async ensureDirectoryExists(filePath) {
        const dir = path.dirname(filePath);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
            logger.info(`已创建目录: ${dir}`);
        }
    }

    static async readJsonFile(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info(`文件不存在，创建新文件: ${filePath}`);
                await this.writeJsonFile(filePath, []);
                return [];
            }
            logger.error(`读取文件失败: ${filePath}`, error);
            throw error;
        }
    }

    static async writeJsonFile(filePath, data) {
        try {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            logger.info(`成功写入文件: ${filePath}`);
        } catch (error) {
            logger.error(`写入文件失败: ${filePath}`, error);
            throw error;
        }
    }

    static async appendToJsonFile(filePath, newData) {
        try {
            const existingData = await this.readJsonFile(filePath);
            existingData.push(newData);
            await this.writeJsonFile(filePath, existingData);
            logger.info(`成功追加数据到文件: ${filePath}`);
        } catch (error) {
            logger.error(`追加数据到文件失败: ${filePath}`, error);
            throw error;
        }
    }
}

module.exports = FileManager; 