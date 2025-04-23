#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');
const { initializeSlack, sendSlackMessage, logWithTimestamp, logError } = require('../services/slack'); // Reusing existing Slack functions

// --- Configuration ---
const appConfig = loadConfigFromEnv();
// Ensure SLACK_CONFIG exists and has defaults if not fully loaded
appConfig.SLACK_CONFIG = appConfig.SLACK_CONFIG || {};
const slackInitialized = initializeSlack(appConfig.SLACK_TOKEN, appConfig.SLACK_CONFIG.channelId); // Initialize Slack service
const VISITED_LINKS_PATH = path.resolve(__dirname, '..', 'data/visited_links.json');
const DIGEST_STATE_PATH = path.resolve(__dirname, '..', 'data/digest_state.json'); // Path for storing last digest time
const DIGEST_HOURS = 24; // How many hours back to check for recent reports (fallback)

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
            logWithTimestamp(`Warning: '${filePath}' does not contain a JSON list. Returning empty list.`, 'warn');
            return [];
        }
        return reports;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logWithTimestamp(`'${filePath}' not found. No reports to process.`, 'warn');
        } else if (error instanceof SyntaxError) {
            logError(`Error decoding JSON from '${filePath}'.`, error);
        } else {
            logError(`An unexpected error occurred loading reports from ${filePath}:`, error);
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
                logWithTimestamp(`Loaded last digest time: ${lastTime.toISOString()}`, 'debug');
                return lastTime;
            }
        }
        logWithTimestamp('No valid last digest timestamp found in state file.', 'warn');
        return null;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logWithTimestamp(`'${DIGEST_STATE_PATH}' not found. Assuming first run for 'now' schedule.`, 'info');
        } else if (error instanceof SyntaxError) {
            logError(`Error decoding JSON from '${DIGEST_STATE_PATH}'.`, error);
        } else {
            logError(`Error loading last digest time from ${DIGEST_STATE_PATH}:`, error);
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
        logWithTimestamp(`Saved current digest time: ${state.lastDigestSentAt}`, 'debug');
    } catch (error) {
        logError(`Error saving last digest time to ${DIGEST_STATE_PATH}:`, error);
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
        logWithTimestamp(`Filtering reports since last digest at ${timeThreshold.toISOString()}`, 'info');
    } else {
        const fallbackHours = (schedule === 'now' && !lastDigestTime) ? hoursAgo : hoursAgo; // Use hoursAgo if 'now' but first run, or if schedule is not 'now'
        timeThreshold = new Date(now.getTime() - fallbackHours * 60 * 60 * 1000);
        if (schedule === 'now') {
             logWithTimestamp(`First run or no previous time found for 'now' schedule. Filtering reports in the last ${fallbackHours} hours (since ${timeThreshold.toISOString()}).`, 'info');
        } else {
             logWithTimestamp(`Filtering reports in the last ${fallbackHours} hours (since ${timeThreshold.toISOString()}).`, 'info');
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
            // Only use >= if threshold is based on hoursAgo (fallback)
            const comparisonTime = (schedule === 'now' && lastDigestTime) ? lastDigestTime.getTime() : timeThreshold.getTime();
            const checkTime = lastCheckedDt.getTime();

            if (!isNaN(lastCheckedDt) && checkTime > comparisonTime ) {
                // Basic validation: Ensure essential fields exist and summary is not an error
                if (report.url && report.title && report.summary && !report.summary.startsWith('Error:')) {
                    recentReports.push(report);
                }
            }
        } catch (e) {
             logError(`Error parsing date string "${lastCheckedStr}" for report ${report.url}`, e)
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
 * @returns {Array<object> | null} Slack blocks array or null if no reports.
 */
function formatDigestMessage(reports) {
    if (!reports || reports.length === 0) {
        return null; // No message needed
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    let messageBlocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": `📰 Delphi Digital Daily Digest - ${todayStr}`,
                "emoji": true
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `Here are the summaries for reports processed in the last ${DIGEST_HOURS} hours:`
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
                    pubDateStr = pubDateDt.toISOString().split('T')[0]; // YYYY-MM-DD
                 }
            } catch (e) {
                 logWithTimestamp(`Could not parse publicationDate '${report.publicationDate}' for report ${report.url}`, 'warn')
            }
        }

        messageBlocks.push(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `📝 *<${report.url || '#'}|${report.title || 'Untitled Report'}>* (${pubDateStr})`
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
        logWithTimestamp(`Digest generated ${messageBlocks.length} blocks, truncating to 50.`, 'warn');
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
        logError('Slack is not initialized. Cannot send digest. Check SLACK_TOKEN and SLACK_CHANNEL_ID environment variables.');
        return false;
    }
    if (!blocks) {
        logWithTimestamp('No recent reports qualify for the digest based on the schedule.', 'info');
        // If schedule is 'now', we should still update the timestamp even if nothing was sent,
        // so the *next* 'now' run looks from this point forward.
        if (schedule === 'now') {
            await saveLastDigestTime(new Date());
        }
        return true; // Not an error, just nothing to send
    }

    try {
        const success = await sendSlackMessage(
             `Delphi Digital Daily Digest - ${new Date().toISOString().split('T')[0]}`, // Title/Fallback text
             blocks, // The formatted blocks
             true // Assuming 'true' means send as primary message
        );
        if (success) {
            logWithTimestamp(`Successfully sent daily digest to Slack channel ${appConfig.SLACK_CONFIG.channelId}.`);
            // Save timestamp only on success *and* if schedule is 'now'
            if (schedule === 'now') {
                await saveLastDigestTime(new Date());
            }
            return true;
        } else {
            logError('Failed to send daily digest via sendSlackMessage.');
            return false;
        }
    } catch (error) {
        logError('An unexpected error occurred sending the Slack digest:', error);
        return false;
    }
}

// --- Main Execution ---
async function runDigest() {
    logWithTimestamp("--- Starting Daily Digest Script ---", 'info');
    const schedule = appConfig.SLACK_CONFIG?.digestSchedule; // Get schedule from config
    logWithTimestamp(`Digest schedule: ${schedule || 'Not set (defaulting to hourly check)'}`, 'info');

    const allReports = await loadReports(VISITED_LINKS_PATH);

    // Load the last digest time only if the schedule is 'now'
    let lastDigestTime = null;
    if (schedule === 'now') {
        lastDigestTime = await loadLastDigestTime();
    }

    // Pass schedule and last time to filter function
    const recentReports = filterRecentReports(allReports, schedule, lastDigestTime, DIGEST_HOURS);

    if (recentReports.length > 0) {
        logWithTimestamp(`Found ${recentReports.length} recent reports to include in the digest.`);
        const digestBlocks = formatDigestMessage(recentReports);
        // Pass schedule to send function
        await sendDigest(digestBlocks, schedule);
    } else {
        logWithTimestamp(`No new reports found since the last check time based on schedule '${schedule}'.`, 'info');
         // If schedule is 'now', update the timestamp even if nothing new, to mark this check time.
         if (schedule === 'now') {
             await sendDigest(null, schedule); // Call sendDigest with null blocks to trigger timestamp save
         }
        // Optionally send a "nothing new" message if schedule is *not* 'now'
        // if (schedule !== 'now') {
        //    await sendDigest([{"type": "section", "text": {"type": "mrkdwn", "text": `No new Delphi reports processed in the last ${DIGEST_HOURS} hours.`}}], schedule);
        // }
    }

    logWithTimestamp("--- Daily Digest Script Finished ---", 'info');
}

// Execute if run directly
if (require.main === module) {
    runDigest().catch(error => {
        logError("Fatal error in digest script:", error);
        process.exit(1);
    });
}

module.exports = {
    runDigest,
    loadReports,
    filterRecentReports,
    formatDigestMessage,
    sendDigest
}; 