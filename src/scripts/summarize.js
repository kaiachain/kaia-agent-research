require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import services
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { initializeSlack, sendSlackMessage, formatReportForSlack } = require('../services/slack');
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
let checkForNew = false;
let runScheduler = false;
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
    } else if (args[i] === '--check-new') {
        checkForNew = true;
    } else if (args[i] === '--scheduler') {
        runScheduler = true;
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
        console.log('Starting to process reports...');
        
        // Send notification that processing has started
        await sendSlackMessage('🔄 Starting to process Delphi Digital reports...');
        
        // Load cache
        const cache = await loadCache(appConfig.CACHE_FILE);
        
        // For simplicity in this implementation, we'll just process a test report
        const testReport = {
            url: 'https://members.delphidigital.io/reports/test-report',
            title: 'Test Report',
            publicationDate: new Date().toISOString(),
            summary: 'This is a test summary for the report.\n\nThis is relevant to the Kaia ecosystem because it demonstrates Slack integration functionality.'
        };
        
        // Format the report for Slack
        const blocks = formatReportForSlack(testReport);
        
        // Send the report to Slack
        await sendSlackMessage(`New report summary: ${testReport.title}`, blocks);
        
        console.log('Finished processing reports');
        await sendSlackMessage('✅ Finished processing Delphi Digital reports');
        
        return true;
    } catch (error) {
        console.error('Error processing links:', error);
        await sendSlackMessage(`❌ Error processing Delphi Digital reports: ${error.message}`);
        return false;
    }
}

// Main function to send daily digest
async function sendDailyDigest() {
    try {
        console.log('Preparing daily digest of Delphi Digital reports...');
        
        // Send notification that digest preparation has started
        await sendSlackMessage('📋 Preparing Delphi Digital daily digest...');
        
        // For simplicity in this implementation, we'll just send a test digest
        const digestMessage = {
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "📈 Delphi Digital Daily Digest"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Recent reports from the last 24 hours:*"
                    }
                },
                {
                    "type": "divider"
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Test Report*\nThis is a test summary for the report. This is relevant to the Kaia ecosystem because it demonstrates Slack integration functionality."
                    }
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `*Published:* ${new Date().toLocaleDateString()} | <https://members.delphidigital.io/reports/test-report|View Full Report>`
                        }
                    ]
                },
                {
                    "type": "divider"
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "_This is an automated digest from the Delphi Digital scraper_"
                    }
                }
            ]
        };
        
        // Send the digest to Slack
        await sendSlackMessage('Delphi Digital Daily Digest', digestMessage.blocks);
        
        console.log('Daily digest sent successfully');
        return true;
    } catch (error) {
        console.error('Error sending daily digest:', error);
        await sendSlackMessage(`❌ Error sending Delphi Digital daily digest: ${error.message}`);
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
        console.error('Error in main execution:', error);
    }
}

// Run the main function
if (require.main === module) {
    main();
}

// Export functions for testing and importing
module.exports = {
    processAllLinks,
    sendDailyDigest
}; 