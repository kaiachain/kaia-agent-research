const fs = require('fs').promises;
const path = require('path');

const LAST_VISITED_LINK_FILE = path.join(process.cwd(), 'data/last_visited_link.json');

/**
 * Reads the last visited link URL from the JSON file.
 * Handles file not found errors gracefully.
 * @returns {Promise<string|null>} The last visited URL or null if not found/error.
 */
async function readLastVisitedLink() {
  try {
    const data = await fs.readFile(LAST_VISITED_LINK_FILE, 'utf8');
    const jsonData = JSON.parse(data);
    return jsonData.lastVisitedUrl || null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('last_visited_link.json not found (first run?). Starting fresh.');
      return null; // File doesn't exist, treat as first run
    }
    console.error('Error reading last_visited_link.json:', error);
    return null; // Return null on other errors
  }
}

/**
 * Writes the last visited link URL to the JSON file.
 * @param {string} url The URL of the most recently processed report.
 * @returns {Promise<void>}
 */
async function writeLastVisitedLink(url) {
  try {
    const data = JSON.stringify({ lastVisitedUrl: url }, null, 2);
    await fs.writeFile(LAST_VISITED_LINK_FILE, data, 'utf8');
    console.log(`Updated last visited link to: ${url}`);
  } catch (error) {
    console.error('Error writing last_visited_link.json:', error);
  }
}

module.exports = {
  readLastVisitedLink,
  writeLastVisitedLink,
}; 