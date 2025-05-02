const fs = require('fs').promises;
const path = require('path');
const logger = require('../scripts/logger'); // Import the logger
const { ensureJsonFileExists } = require('./file-utils'); // Import the file utility

const LAST_VISITED_LINK_FILE = path.join(process.cwd(), 'data/last_visited_link.json');

/**
 * Ensures the last_visited_link.json file exists
 * Creates it with empty lastVisitedUrl if it doesn't
 * @returns {Promise<boolean>} Success status
 */
async function ensureLastVisitedLinkFileExists() {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.dirname(LAST_VISITED_LINK_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    
    // Check if file exists
    try {
      await fs.access(LAST_VISITED_LINK_FILE);
      // File exists, no need to create it
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create it with default content
        const defaultContent = { lastVisitedUrl: null };
        await fs.writeFile(LAST_VISITED_LINK_FILE, JSON.stringify(defaultContent, null, 2), 'utf8');
        logger.info(`Created default ${LAST_VISITED_LINK_FILE} file`);
        return true;
      }
      // Some other error occurred
      throw error;
    }
  } catch (error) {
    logger.error(`Error ensuring last_visited_link.json exists: ${error.message}`);
    return false;
  }
}

/**
 * Reads the last visited link URL from the JSON file.
 * Creates the file if it doesn't exist.
 * @returns {Promise<string|null>} The last visited URL or null if not found/error.
 */
async function readLastVisitedLink() {
  try {
    // First ensure the file exists
    await ensureLastVisitedLinkFileExists();
    
    // Read the file
    const data = await fs.readFile(LAST_VISITED_LINK_FILE, 'utf8');
    const jsonData = JSON.parse(data);
    logger.info(`Read last visited URL: ${jsonData.lastVisitedUrl || 'None'}`);
    return jsonData.lastVisitedUrl || null;
  } catch (error) {
    logger.error(`Error reading last_visited_link.json: ${error.message}`);
    return null; // Return null on errors
  }
}

/**
 * Writes the last visited link URL to the JSON file.
 * Creates the file if it doesn't exist.
 * @param {string} url The URL of the most recently processed report.
 * @returns {Promise<boolean>} Success status
 */
async function writeLastVisitedLink(url) {
  try {
    // First ensure the file exists
    await ensureLastVisitedLinkFileExists();
    
    // Write the new URL
    const data = JSON.stringify({ lastVisitedUrl: url }, null, 2);
    await fs.writeFile(LAST_VISITED_LINK_FILE, data, 'utf8');
    logger.info(`Updated last visited link to: ${url}`);
    return true;
  } catch (error) {
    logger.error(`Error writing last_visited_link.json: ${error.message}`);
    return false;
  }
}

module.exports = {
  readLastVisitedLink,
  writeLastVisitedLink,
  ensureLastVisitedLinkFileExists
}; 