const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Ensures that a JSON file exists. If it doesn't exist, creates it with the provided default content.
 * @param {string} filePath - Path to the JSON file
 * @param {any} defaultContent - Default content to write if file doesn't exist (default: empty array)
 * @returns {Promise<boolean>} - True if file exists or was created successfully
 */
async function ensureJsonFileExists(filePath, defaultContent = []) {
  try {
    // Check if file exists
    await fs.access(filePath);
    logger.debug(`File exists: ${filePath}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, create it
      try {
        // Ensure directory exists
        const dirPath = path.dirname(filePath);
        await fs.mkdir(dirPath, { recursive: true });
        
        // Write default content to file
        await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2), 'utf8');
        
        logger.info(`Created file with default content: ${filePath}`);
        return true;
      } catch (createError) {
        logger.error(`Failed to create file ${filePath}: ${createError.message}`, { stack: createError.stack });
        return false;
      }
    } else {
      // Other error
      logger.error(`Error checking file ${filePath}: ${error.message}`, { stack: error.stack });
      return false;
    }
  }
}

module.exports = {
  ensureJsonFileExists
}; 