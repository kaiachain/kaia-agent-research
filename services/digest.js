const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');
const { initializeSlack, sendSlackMessage } = require('./slack');
const { ensureJsonFileExists } = require('../utils/file-utils');
const logger = require('../utils/logger');

// Load configuration
const appConfig = loadConfigFromEnv();
appConfig.SLACK_CONFIG = appConfig.SLACK_CONFIG || {};
const slackInitialized = initializeSlack(appConfig.SLACK_TOKEN, appConfig.SLACK_CONFIG.channelId, appConfig.SLACK_CONFIG.historyFile);
const VISITED_LINKS_PATH = path.resolve(process.cwd(), appConfig.VISITED_LINKS_FILE || 'data/visited_links.json');
const DIGEST_STATE_PATH = path.resolve(process.cwd(), appConfig.SLACK_CONFIG.digestStateFile || 'data/digest_state.json');
const DIGEST_HOURS = appConfig.SLACK_CONFIG.digestLookbackHours || 24;

/**
 * Loads reports from the JSON file.
 */
async function loadReports(filePath) {
    await ensureJsonFileExists(filePath, []);
    
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
 * Loads the timestamp of the last successfully sent digest.
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
 * Saves the timestamp of the current successful digest.
 */
async function saveLastDigestTime(timestamp) {
    try {
        const state = { lastDigestSentAt: timestamp.toISOString() };
        await fs.mkdir(path.dirname(DIGEST_STATE_PATH), { recursive: true });
        await fs.writeFile(DIGEST_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
        logger.debug(`Saved current digest time: ${state.lastDigestSentAt}`);
    } catch (error) {
        logger.error(`Error saving last digest time to ${DIGEST_STATE_PATH}: ${error.message}`, { stack: error.stack });
    }
}

/**
 * Filters reports last checked within the specified time window.
 */
function filterRecentReports(reports, lastDigestTime, hoursAgo) {
    const now = new Date();
    const timeThreshold = lastDigestTime || new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

    const recentReports = reports.filter(report => {
        if (!report.lastChecked) return false;
        try {
            const lastChecked = new Date(report.lastChecked);
            return lastChecked > timeThreshold && report.title && report.url;
        } catch (error) {
            logger.error(`Error parsing lastChecked date for report: ${report.url || 'unknown'}`, error);
            return false;
        }
    });

    // Sort by publication date (descending)
    recentReports.sort((a, b) => {
        const dateA = new Date(a.publicationDate || 0);
        const dateB = new Date(b.publicationDate || 0);
        return dateB - dateA;
    });

    return recentReports;
}

/**
 * Formats the list of reports into Slack message blocks.
 */
function formatDigestMessage(reports, lookbackHours) {
    if (!reports || reports.length === 0) {
        return null;
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
                "text": `Here are summaries for the ${reports.length === 1 ? 'report' : `${reports.length} reports`} processed since the last digest (approx. last ${lookbackHours} hours):`
            }
        },
        {"type": "divider"}
    ];

    for (const report of reports) {
        let summaryText = report.summary || 'No summary available.';
        const maxLen = 2900;
        if (summaryText.length > maxLen) {
            summaryText = summaryText.substring(0, maxLen) + "... *(truncated)*";
        }

        let pubDateStr = "Unknown date";
        if (report.publicationDate) {
            try {
                const pubDateDt = new Date(report.publicationDate);
                if (!isNaN(pubDateDt)) {
                    pubDateStr = pubDateDt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                }
            } catch (e) {
                logger.warn(`Could not parse publicationDate '${report.publicationDate}' for report ${report.url}`);
                pubDateStr = report.publicationDate;
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

    if (messageBlocks.length > 50) {
        logger.warn(`Digest generated ${messageBlocks.length} blocks, truncating to 50.`);
        messageBlocks = messageBlocks.slice(0, 49);
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
 * Sends the digest message to Slack.
 */
async function sendDigest(blocks) {
    if (!slackInitialized) {
        logger.error('Slack is not initialized. Cannot send digest.');
        return false;
    }
    if (!blocks) {
        logger.info('No new reports found for digest.');
        return true;
    }

    const digestSummaryText = `Delphi Digital Report Digest - ${new Date().toLocaleDateString()}`;

    try {
        const messageTs = await sendSlackMessage(digestSummaryText, blocks);
        if (messageTs) {
            logger.info('Digest sent successfully to Slack.');
            await saveLastDigestTime(new Date());
            return true;
        }
        logger.error('Failed to send digest message to Slack.');
        return false;
    } catch (error) {
        logger.error(`Failed to send digest message to Slack: ${error.message}`, { stack: error.stack });
        return false;
    }
}

/**
 * Main function to generate and send the digest.
 */
async function runDigest() {
    logger.info('Starting Slack digest process...');

    const allReports = await loadReports(VISITED_LINKS_PATH);
    if (allReports.length === 0) {
        logger.info('No reports found in visited links file.');
        return;
    }

    const lastDigestTime = await loadLastDigestTime();
    const recentReports = filterRecentReports(allReports, lastDigestTime, DIGEST_HOURS);

    if (recentReports.length > 0) {
        logger.info(`Found ${recentReports.length} recent reports to include in the digest.`);
        const messageBlocks = formatDigestMessage(recentReports, DIGEST_HOURS);
        await sendDigest(messageBlocks);
    } else {
        logger.info('No recent reports found to include in the digest.');
    }

    logger.info('Slack digest process finished.');
}

module.exports = {
    runDigest
}; 