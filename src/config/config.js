const path = require('path');

// Default configuration
const config = {
  // URLs
  DELPHI_URL: 'https://members.delphidigital.io/reports',
  DELPHI_LOGIN_URL: 'https://members.delphidigital.io/login',
  DELPHI_REPORTS_URL: 'https://members.delphidigital.io/reports',
  
  // Timing
  CHECK_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  
  // File paths
  COOKIES_FILE: path.join(process.cwd(), 'src/data/delphi_cookies.json'),
  CACHE_FILE: path.join(process.cwd(), 'src/data/processed_reports_cache.json'),
  VISITED_LINKS_FILE: path.join(process.cwd(), 'src/data/visited_links.json'),
  BACKUPS_DIR: path.join(process.cwd(), 'src/data/backups'),
  
  // Browser settings
  BROWSER_CONFIG: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  },
  
  // Slack settings
  SLACK_CONFIG: {
    channelId: process.env.SLACK_CHANNEL_ID
  },
  
  // AI settings
  AI_CONFIG: {
    model: "gemini-2.0-flash-lite",
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024
  }
};

// Function to override config with environment variables
function loadConfigFromEnv() {
  // Override with environment variables if they exist
  if (process.env.DELPHI_URL) config.DELPHI_URL = process.env.DELPHI_URL;
  if (process.env.DELPHI_LOGIN_URL) config.DELPHI_LOGIN_URL = process.env.DELPHI_LOGIN_URL;
  if (process.env.DELPHI_REPORTS_URL) config.DELPHI_REPORTS_URL = process.env.DELPHI_REPORTS_URL;
  
  if (process.env.CHECK_INTERVAL) {
    const interval = parseInt(process.env.CHECK_INTERVAL, 10);
    if (!isNaN(interval)) config.CHECK_INTERVAL = interval;
  }
  
  if (process.env.COOKIES_FILE) config.COOKIES_FILE = process.env.COOKIES_FILE;
  if (process.env.CACHE_FILE) config.CACHE_FILE = process.env.CACHE_FILE;
  if (process.env.VISITED_LINKS_FILE) config.VISITED_LINKS_FILE = process.env.VISITED_LINKS_FILE;
  if (process.env.BACKUPS_DIR) config.BACKUPS_DIR = process.env.BACKUPS_DIR;
  
  // Add Slack channel id
  if (process.env.SLACK_CHANNEL_ID) config.SLACK_CONFIG.channelId = process.env.SLACK_CHANNEL_ID;
  
  return config;
}

module.exports = {
  config,
  loadConfigFromEnv
}; 