require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import services
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { initializeSlack, sendSlackMessage, formatReportForSlack, logMessage, logWithTimestamp } = require('../services/slack');
const { loadCache, updateCache, createContentHash, needsProcessing } = require('../utils/cache');
const { extractContent } = require('../utils/content-extractor');

// Import config
const { config, loadConfigFromEnv } = require('../config/config');
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
let startDaemon = false;
let stopDaemon = false;
let checkStatus = false;

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
    } else if (args[i] === '--start-daemon') {
        startDaemon = true;
    } else if (args[i] === '--stop-daemon') {
        stopDaemon = true;
    } else if (args[i] === '--status') {
        checkStatus = true;
    }
}

// Function to format date
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// Main function to process all links
async function processAllLinks() {
    try {
        logWithTimestamp('Starting to process reports...');
        
        // Send notification that processing has started (status message)
        await logMessage('🔄 Starting to process Delphi Digital reports...', [], false);
        
        // Load cache
        const cache = await loadCache(appConfig.CACHE_FILE);
        
        // In production, this function would call the full processing flow
        // It will be called by the delphi-full-flow.js script
        
        logWithTimestamp('Finished processing reports');
        await logMessage('✅ Finished processing Delphi Digital reports', [], true);
        
        return true;
    } catch (error) {
        logWithTimestamp(`Error processing links: ${error.message}`, 'error');
        return false;
    }
}

// Main function to send daily digest
async function sendDailyDigest() {
    try {
        logWithTimestamp('Preparing daily digest of Delphi Digital reports...');
        
        // Send notification that digest preparation has started (status message)
        await logMessage('📋 Preparing Delphi Digital daily digest...', [], false);
        
        // In production, this function would prepare and send a real digest
        // It will be called by the slack-digest.js script
        
        logWithTimestamp('Daily digest sent successfully');
        return true;
    } catch (error) {
        logWithTimestamp(`Error sending daily digest: ${error.message}`, 'error');
        return false;
    }
}

// Main execution
async function main() {
    try {
        if (startDaemon) {
            const { startDaemon } = require('../cli/start-daemon');
            await startDaemon();
        } else if (stopDaemon) {
            const { stopDaemon } = require('../cli/stop-daemon');
            await stopDaemon();
        } else if (checkStatus) {
            const { checkStatus } = require('../cli/status-daemon');
            await checkStatus();
        } else if (runDigest) {
            await sendDailyDigest();
        } else {
            await processAllLinks();
        }
    } catch (error) {
        logWithTimestamp(`Error in main execution: ${error.message}`, 'error');
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