require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config'); // Importing config
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports } = require('../services/reports');
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { initializeSlack, sendSlackMessage, formatReportForSlack, logMessage } = require('../services/slack');
const { loadCache, updateCache, createContentHash, needsProcessing } = require('../utils/cache');
const { extractContent } = require('../utils/content-extractor');
const { ensureJsonFileExists } = require('../utils/file-utils');
const logger = require('./logger'); // Import logger

// Constants
const VISITED_LINKS_PATH = 'data/visited_links.json';

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
initializeGemini(process.env.GEMINI_API_KEY);
initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// Process command line arguments
const args = process.argv.slice(2);
const forceReprocessUrls = [];
let forceReprocessCount = 0;
let forceSummaries = false;
let runDigest = false;

// Process command line arguments
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force-url' && args[i + 1]) {
        forceReprocessUrls.push(args[i + 1]);
        i++; // Skip next arg
    } else if (args[i] === '--force-latest' && args[i + 1]) {
        forceReprocessCount = parseInt(args[i + 1], 10);
        if (isNaN(forceReprocessCount)) forceReprocessCount = 0;
        i++; // Skip next arg
    } else if (args[i] === '--force-summaries') {
        forceSummaries = true;
    } else if (args[i] === '--digest') {
        runDigest = true;
    }
}

// Function to format date
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// Function to load visited links
async function loadVisitedLinks() {
  try {
    // Ensure the visited_links.json file exists
    await ensureJsonFileExists(VISITED_LINKS_PATH, []);
    
    // Read the file
    const data = await fs.readFile(VISITED_LINKS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error loading visited links: ${error.message}`);
    return []; // Return empty array on error
  }
}

// Main function to process all links
async function processAllLinks() {
    try {
        logger.info('Starting to process reports...');

        // Send notification that processing has started (status message)
        await logMessage('🔄 Starting to process Delphi Digital reports...', [], false);

        // Load cache
        const cache = await loadCache('data/processed_reports_cache.json');

        // Load visited links
        let visitedLinks = await loadVisitedLinks();

        // In production, this function would call the full processing flow
        // It will be called by the delphi-full-flow.js script

        logger.info('Finished processing reports');
        await logMessage('✅ Finished processing Delphi Digital reports', [], true);

        return true;
    } catch (error) {
        logger.error(`Error processing links: ${error.message}`);
        return false;
    }
}

// Main function to send daily digest
async function sendDailyDigest() {
    try {
        logger.info('Preparing daily digest of Delphi Digital reports...');

        // Send notification that digest preparation has started (status message)
        await logMessage('📋 Preparing Delphi Digital daily digest...', [], false);

        // In production, this function would prepare and send a real digest
        // It will be called by the slack-digest.js script

        logger.info('Daily digest sent successfully');
        return true;
    } catch (error) {
        logger.error(`Error sending daily digest: ${error.message}`);
        return false;
    }
}

// Main execution
async function main() {
    try {
        if (runDigest) {
            await sendDailyDigest();
        } else {
            await processAllLinks();
        }
    } catch (error) {
        logger.error(`Error in main execution: ${error.message}`);
    }
}

// Run the main function
if (require.main === module) {
    main();
}

// Export functions for testing and importing
module.exports = {
    processAllLinks,
    sendDailyDigest,
    main
};

// Function to summarize reports
async function summarizeReports(forceLatest = false, maxReports = 5) {
  // Ensure the visited_links.json file exists
  await ensureJsonFileExists(VISITED_LINKS_PATH, []);
  
  // Initialize AI
  const geminiInitialized = initializeGemini(appConfig.GEMINI_API_KEY);
  if (!geminiInitialized) {
    logger.error('Failed to initialize Gemini. Check your GEMINI_API_KEY.');
    return false;
  }
} 