// Export main modules for importing

// Services
const ai = require('./services/ai');
const auth = require('./services/auth');
const reports = require('./services/reports');
const slack = require('./services/slack');

// Scripts
const checker = require('./scripts/check-delphi');
const summarizer = require('./scripts/summarize');

// Utils
const cache = require('./utils/cache');
const contentExtractor = require('./utils/content-extractor');

// Configuration
const config = require('./config/config');

// Browser utilities
const browser = require('./browser/browser');

// CLI tools
const startDaemon = require('./cli/start-daemon');
const stopDaemon = require('./cli/stop-daemon');
const statusDaemon = require('./cli/status-daemon');

module.exports = {
  // Main functionality
  check: checker.checkDelphiWebsite,
  scheduleChecks: checker.scheduleChecks,
  processReports: summarizer.processAllLinks,
  sendDailyDigest: summarizer.sendDailyDigest,
  
  // Services
  ai,
  auth,
  reports,
  slack,
  
  // Utils
  cache,
  contentExtractor,
  
  // Config
  config,
  
  // Browser utilities
  browser,
  
  // CLI tools
  startDaemon: startDaemon.startDaemon,
  stopDaemon: stopDaemon.stopDaemon,
  checkStatus: statusDaemon.checkStatus
};
