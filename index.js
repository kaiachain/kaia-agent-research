// Export main modules for importing

// Services
const ai = require('./src/services/ai');
const auth = require('./src/services/auth');
const reports = require('./src/services/reports');
const slack = require('./src/services/slack');

// Scripts
const checker = require('./src/scripts/check-delphi');
const summarizer = require('./src/scripts/summarize');

// Utils
const cache = require('./src/utils/cache');
const contentExtractor = require('./src/utils/content-extractor');

// Configuration
const config = require('./src/config/config');

// Browser utilities
const browser = require('./src/browser/browser');

// CLI tools
const startDaemon = require('./src/cli/start-daemon');
const stopDaemon = require('./src/cli/stop-daemon');
const statusDaemon = require('./src/cli/status-daemon');

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
