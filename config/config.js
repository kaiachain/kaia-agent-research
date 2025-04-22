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
  COOKIES_FILE: path.join(process.cwd(), 'data/delphi_cookies.json'),
  // Stores processed report data to avoid re-processing the same reports multiple times
  // and improve performance by caching results for CACHE_EXPIRY_DAYS
  CACHE_FILE: path.join(process.cwd(), 'data/processed_reports_cache.json'),
  CACHE_EXPIRY_DAYS: 7, // Default expiry days for cache entries
  VISITED_LINKS_FILE: path.join(process.cwd(), 'data/visited_links.json'),
  UNSENT_REPORTS_FILE: path.join(process.cwd(), 'data/unsent_reports.json'),
  HISTORY_FILE: path.join(process.cwd(), 'data/slack_message_history.json'),
  RATE_LIMIT_DELAY_MS: 1000, // Delay between requests to avoid rate limiting
  
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
  },
  
  // Add Gemini API Key from environment
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  
  // Add Slack Token from environment
  SLACK_TOKEN: process.env.SLACK_TOKEN
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
  
  if (process.env.CACHE_EXPIRY_DAYS) config.CACHE_EXPIRY_DAYS = parseInt(process.env.CACHE_EXPIRY_DAYS, 10);
  if (process.env.RATE_LIMIT_DELAY_MS) config.RATE_LIMIT_DELAY_MS = parseInt(process.env.RATE_LIMIT_DELAY_MS, 10);
  
  // Add Slack channel id
  if (process.env.SLACK_CHANNEL_ID) config.SLACK_CONFIG.channelId = process.env.SLACK_CHANNEL_ID;
  
  return config;
}

module.exports = {
  config,
  loadConfigFromEnv
}; 