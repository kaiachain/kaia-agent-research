#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');
const { initializeSlack, sendSlackMessage } = require('../services/slack');
const logger = require('./logger'); // Import the shared logger

// --- Configuration ---
const appConfig = loadConfigFromEnv();
// Ensure SLACK_CONFIG exists and has defaults if not fully loaded
appConfig.SLACK_CONFIG = appConfig.SLACK_CONFIG || {};
const slackInitialized = initializeSlack(appConfig.SLACK_TOKEN, appConfig.SLACK_CONFIG.channelId, appConfig.SLACK_CONFIG.historyFile); // Pass history file path
const VISITED_LINKS_PATH = path.resolve(__dirname, '..', appConfig.VISITED_LINKS_FILE || 'data/visited_links.json'); // Use config path
const DIGEST_STATE_PATH = path.resolve(__dirname, '..', appConfig.SLACK_CONFIG.digestStateFile || 'data/digest_state.json'); // Use config path
const DIGEST_HOURS = appConfig.SLACK_CONFIG.digestLookbackHours || 24; // Use config value

// --- Helper Functions ---

/**
 * Loads reports from the JSON file.
 * @param {string} filePath
 * @returns {Promise<Array<object>>}
 */
async function loadReports(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const reports = JSON.parse(data);
        if (!Array.isArray(reports)) {
            logger.warn(`'${filePath}' does not contain a valid JSON array. Returning empty list.`);
            return [];
        }
        return reports;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.warn(`'${filePath}' not found. No reports to process for digest.`);
        } else if (error instanceof SyntaxError) {
            logger.error(`Error decoding JSON from '${filePath}': ${error.message}`);
        } else {
            logger.error(`An unexpected error occurred loading reports from ${filePath}: ${error.message}`, { stack: error.stack });
        }
        return [];
    }
}

/**
 * Loads the timestamp of the last successfully sent "now" digest.
 * @returns {Promise<Date | null>} A Date object or null if not found/error.
 */
async function loadLastDigestTime() {
    try {
        const data = await fs.readFile(DIGEST_STATE_PATH, 'utf8');
        const state = JSON.parse(data);
        if (state && state.lastDigestSentAt) {
            const lastTime = new Date(state.lastDigestSentAt);
            if (!isNaN(lastTime)) {
                logger.debug(`Loaded last digest time: ${lastTime.toISOString()}`);
                return lastTime;
            }
        }
        logger.warn('No valid last digest timestamp found in state file.');
        return null;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info(`'${DIGEST_STATE_PATH}' not found. Assuming first run for digest.`);
        } else if (error instanceof SyntaxError) {
            logger.error(`Error decoding JSON from '${DIGEST_STATE_PATH}': ${error.message}`);
        } else {
            logger.error(`Error loading last digest time from ${DIGEST_STATE_PATH}: ${error.message}`, { stack: error.stack });
        }
        return null;
    }
}

/**
 * Saves the timestamp of the current successful "now" digest.
 * @param {Date} timestamp - The time the digest was sent.
 * @returns {Promise<void>}
 */
async function saveLastDigestTime(timestamp) {
    try {
        const state = { lastDigestSentAt: timestamp.toISOString() };
        await fs.mkdir(path.dirname(DIGEST_STATE_PATH), { recursive: true }); // Ensure directory exists
        await fs.writeFile(DIGEST_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
        logger.debug(`Saved current digest time: ${state.lastDigestSentAt}`);
    } catch (error) {
        logger.error(`Error saving last digest time to ${DIGEST_STATE_PATH}: ${error.message}`, { stack: error.stack });
    }
}

/**
 * Filters reports last checked within the specified time window.
 * If schedule is "now", uses lastDigestTime. Otherwise, uses hoursAgo.
 * @param {Array<object>} reports
 * @param {string | undefined} schedule - The digest schedule (e.g., "now").
 * @param {Date | null} lastDigestTime - Timestamp of the last successful "now" digest.
 * @param {number} hoursAgo - Fallback lookback period in hours.
 * @returns {Array<object>}
 */
function filterRecentReports(reports, schedule, lastDigestTime, hoursAgo) {
    const now = new Date();
    let timeThreshold;

    if (schedule === 'now' && lastDigestTime) {
        timeThreshold = lastDigestTime;
        logger.info(`Filtering reports for digest since last sent time: ${timeThreshold.toISOString()}`);
    } else {
        const fallbackHours = (schedule === 'now' && !lastDigestTime) ? hoursAgo : hoursAgo; // Use hoursAgo if 'now' but first run, or if schedule is not 'now'
        timeThreshold = new Date(now.getTime() - fallbackHours * 60 * 60 * 1000);
        if (schedule === 'now') {
             logger.info(`First run or no previous digest time found. Filtering reports in the last ${fallbackHours} hours (since ${timeThreshold.toISOString()}).`);
        } else {
             logger.info(`Filtering reports for digest in the last ${fallbackHours} hours (since ${timeThreshold.toISOString()}).`);
        }
    }

    const recentReports = [];

    for (const report of reports) {
        const lastCheckedStr = report.lastChecked || report.scrapedAt; // Use lastChecked or scrapedAt
        if (!lastCheckedStr) continue; // Skip if no relevant timestamp

        try {
            const lastCheckedDt = new Date(lastCheckedStr); // JS Date object handles ISO format with Z

            // Filter condition: last checked date must be *strictly greater than* the threshold
            // to avoid resending the exact same report that triggered the last update.
            const comparisonTime = (schedule === 'now' && lastDigestTime) ? lastDigestTime.getTime() : timeThreshold.getTime();
            const checkTime = lastCheckedDt.getTime();

            if (!isNaN(lastCheckedDt) && checkTime > comparisonTime ) {
                // Basic validation: Ensure essential fields exist and summary is not an error
                if (report.url && report.title && report.summary && !report.summary.startsWith('Error:')) {
                    recentReports.push(report);
                }
            }
        } catch (e) {
             logger.error(`Error parsing date string "${lastCheckedStr}" for report ${report.url}: ${e.message}`);
        }
    }

    // Sort by publication date (descending)
    recentReports.sort((a, b) => {
        const dateA = new Date(a.publicationDate || 0);
        const dateB = new Date(b.publicationDate || 0);
        return dateB - dateA; // Newest first
    });

    return recentReports;
}

/**
 * Formats the list of reports into Slack message blocks.
 * @param {Array<object>} reports
 * @param {number} lookbackHours - The number of hours the digest covers.
 * @returns {Array<object> | null} Slack blocks array or null if no reports.
 */
function formatDigestMessage(reports, lookbackHours) {
    if (!reports || reports.length === 0) {
        return null; // No message needed
    }

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let messageBlocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": `📰 Delphi Digital Report Digest - ${todayStr}`,
                "emoji": true
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `Here are summaries for the ${reports.length === 1 ? 'report' : `${reports.length} reports`} processed since the last digest${reports.length > 1 ? 's' : ''} (approx. last ${lookbackHours} hours):`
            }
        },
        {"type": "divider"}
    ];

    for (const report of reports) {
        let summaryText = report.summary || 'No summary available.';
        const maxLen = 2900; // Keep it well below Slack's 3000 char limit for section text
        if (summaryText.length > maxLen) {
            summaryText = summaryText.substring(0, maxLen) + "... *(truncated)*";
        }

        let pubDateStr = "Unknown date";
        if (report.publicationDate) {
            try {
                const pubDateDt = new Date(report.publicationDate);
                 if (!isNaN(pubDateDt)) {
                    pubDateStr = pubDateDt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                 }
            } catch (e) {
                 logger.warn(`Could not parse publicationDate '${report.publicationDate}' for report ${report.url}`);
            }
        }

        messageBlocks.push(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `📝 *<${report.url || '#'}|${report.title || 'Untitled Report'}>* \n*Published:* ${pubDateStr}`
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `${summaryText}`
                }
            },
            {"type": "divider"}
        );
    }

    // Slack messages have a limit of 50 blocks. Truncate if necessary.
    if (messageBlocks.length > 50) {
        logger.warn(`Digest generated ${messageBlocks.length} blocks, truncating to 50.`);
        messageBlocks = messageBlocks.slice(0, 49); // Keep first 49 blocks
        messageBlocks.push({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "*... Message truncated due to Slack block limit.*"
            }
        });
    }

    return messageBlocks;
}

/**
 * Sends the digest message to the configured Slack channel.
 * Updates the last digest time if the schedule is "now" and sending is successful.
 * @param {Array<object> | null} blocks - The Slack message blocks, or null if no reports.
 * @param {string | undefined} schedule - The digest schedule (e.g., "now").
 * @returns {Promise<boolean>} - True if successful or nothing to send, false on error.
 */
async function sendDigest(blocks, schedule) {
    if (!slackInitialized) {
        logger.error('Slack is not initialized. Cannot send digest. Check SLACK_TOKEN and SLACK_CHANNEL_ID environment variables.');
        return false;
    }
    if (!blocks) {
        logger.info('No new reports found for digest.');
        if (schedule === 'now') {
            await saveLastDigestTime(new Date());
            logger.debug('Updated last digest time even though no reports were sent (schedule=now).');
        }
        return true; // Nothing to send, considered success
    }

    const digestSummaryText = `Delphi Digital Report Digest - ${new Date().toLocaleDateString()}`;

    try {
        const messageTs = await sendSlackMessage(digestSummaryText, blocks);
        if (messageTs) {
             logger.info('Digest sent successfully to Slack.');
            if (schedule === 'now') {
                await saveLastDigestTime(new Date());
            }
            return true;
        } else {
             logger.error('Failed to send digest message to Slack (sendSlackMessage returned null/false).');
            return false;
        }
    } catch (error) {
        logger.error(`Failed to send digest message to Slack: ${error.message}`, { stack: error.stack });
        return false;
    }
}

// --- Main Execution ---

/**
 * Main function to generate and send the digest.
 */
async function runDigest() {
    const schedule = appConfig.SLACK_CONFIG.digestSchedule;
    logger.info(`Starting Slack digest process (Schedule: ${schedule || 'default'})...`);

    const allReports = await loadReports(VISITED_LINKS_PATH);
    if (allReports.length === 0) {
        logger.info('No reports found in visited links file. Exiting digest process.');
        return;
    }

    const lastDigestTime = await loadLastDigestTime();
    const recentReports = filterRecentReports(allReports, schedule, lastDigestTime, DIGEST_HOURS);

    if (recentReports.length > 0) {
        logger.info(`Found ${recentReports.length} recent reports to include in the digest.`);
        const messageBlocks = formatDigestMessage(recentReports, DIGEST_HOURS);
        const success = await sendDigest(messageBlocks, schedule);
        if (!success) {
             logger.error('Digest sending failed.');
             process.exitCode = 1; // Indicate failure
        }
    } else {
        logger.info('No recent reports found to include in the digest.');
        if (schedule === 'now') {
            await saveLastDigestTime(new Date());
            logger.debug('Updated last digest time even though no reports were sent (schedule=now).');
        }
    }

    logger.info('Slack digest process finished.');
}

/**
 * Determines if the digest should run based on the schedule.
 * For cron schedules, this script should be called by cron.
 * For "now" schedule, it runs if called directly.
 */
function shouldRunDigest() {
    const schedule = appConfig.SLACK_CONFIG.digestSchedule;

    if (schedule === 'now') {
        logger.info('Digest schedule set to "now", running immediately.');
        return true;
    }

    if (schedule && schedule !== 'manual') {
         logger.info(`Digest schedule is "${schedule}". Assumed to be handled by an external scheduler (like cron). This script run will exit unless called with --force.`);
         const forceRun = process.argv.includes('--force');
         if (forceRun) {
             logger.info('--force flag detected. Running digest despite schedule configuration.');
             return true;
         }
         return false;
    }

    logger.info('Digest schedule is not set or set to manual. Run manually or via command.');
    return false; // Don't run automatically if schedule is undefined, empty, or 'manual'
}

// --- Script Entry Point ---
if (require.main === module) {
    if (shouldRunDigest()) {
        runDigest().catch(error => {
            logger.error(`Unhandled error during digest generation: ${error.message}`, { stack: error.stack });
            process.exit(1);
        });
    } else {
         logger.info('Digest will not run based on current schedule configuration.');
    }
} else {
    // If required as a module, perhaps for scheduling internally?
    // logger.info('Slack digest script loaded as a module.');
    // Expose runDigest if needed?
    // module.exports = { runDigest };
} 