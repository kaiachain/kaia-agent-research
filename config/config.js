const path = require('path');

// Define config structure with defaults, DO NOT read process.env here
const config = {
  // URLs
  DELPHI_URL: 'https://members.delphidigital.io/reports',
  DELPHI_LOGIN_URL: 'https://members.delphidigital.io/login',
  DELPHI_REPORTS_URL: 'https://members.delphidigital.io/reports',
  DELPHI_EMAIL: '', // Default empty
  DELPHI_PASSWORD: '', // Default empty
  
  // Timing
  CRON_SCHEDULE: '0 0 * * *', // Default: daily at midnight
  
  // File paths - Hardcoded
  COOKIES_FILE: 'data/delphi_cookies.json',
  // Stores processed report data to avoid re-processing the same reports multiple times
  // and improve performance by caching results for CACHE_EXPIRY_DAYS
  CACHE_FILE: 'data/processed_reports_cache.json',
  CACHE_EXPIRY_DAYS: 7, // Default expiry days for cache entries
  VISITED_LINKS_FILE: 'data/visited_links.json',
  // HISTORY_FILE: 'data/slack_message_history.json',
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
    channelId: '', // Default empty
    historyFile: '' // Default empty, won't save history
  },
  SLACK_TOKEN: '', // Default empty
  SLACK_DIGEST_SCHEDULE: '' , // Default empty
  
  // AI settings
  AI_CONFIG: {
    model: "gemini-2.0-flash-lite",
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024
  },
  
  // Add Gemini API Key from environment
  GEMINI_API_KEY: '', // Default empty
};

// Function to load config values FROM environment variables, OVERWRITING defaults
function loadConfigFromEnv() {
  // Create a fresh copy to avoid modifying the original default object if called multiple times?
  // Or assume it's called once per script run after dotenv.config()
  // Sticking with modifying the shared object for now as that's the existing pattern.

  // Load from process.env, using the default value if env var is missing
  config.DELPHI_URL = process.env.DELPHI_URL || config.DELPHI_URL;
  config.DELPHI_LOGIN_URL = process.env.DELPHI_LOGIN_URL || config.DELPHI_LOGIN_URL;
  config.DELPHI_REPORTS_URL = process.env.DELPHI_REPORTS_URL || config.DELPHI_REPORTS_URL;
  config.DELPHI_EMAIL = process.env.DELPHI_EMAIL || config.DELPHI_EMAIL;
  config.DELPHI_PASSWORD = process.env.DELPHI_PASSWORD || config.DELPHI_PASSWORD;

  // Load CRON_SCHEDULE from environment
  config.CRON_SCHEDULE = process.env.CRON_SCHEDULE || config.CRON_SCHEDULE;

  const cacheDays = parseInt(process.env.CACHE_EXPIRY_DAYS, 10);
  if (!isNaN(cacheDays)) config.CACHE_EXPIRY_DAYS = cacheDays;

  const rateLimit = parseInt(process.env.RATE_LIMIT_DELAY_MS, 10);
  if (!isNaN(rateLimit)) config.RATE_LIMIT_DELAY_MS = rateLimit;

  // Load Slack config
  config.SLACK_CONFIG.channelId = process.env.SLACK_CHANNEL_ID || config.SLACK_CONFIG.channelId;
  config.SLACK_TOKEN = process.env.SLACK_TOKEN || config.SLACK_TOKEN;

  // Load Gemini Key
  config.GEMINI_API_KEY = process.env.GEMINI_API_KEY || config.GEMINI_API_KEY;

  // Load Slack Digest Schedule
  config.SLACK_DIGEST_SCHEDULE = process.env.SLACK_DIGEST_SCHEDULE || config.SLACK_DIGEST_SCHEDULE;

  return config;
}

module.exports = {
  // Export the config object directly AND the loader function
  // Scripts should ideally call loadConfigFromEnv() AFTER dotenv.config()
  config,
  loadConfigFromEnv
}; 