require('dotenv').config();
const fs = require('fs').promises;
const { WebClient } = require('@slack/web-api');
const path = require('path');
const cron = require('node-cron'); // Import node-cron
const { config, loadConfigFromEnv } = require('../config/config');
const { ensureJsonFileExists } = require('../utils/file-utils');
const logger = require('./logger'); // Import the shared logger

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack client
const slack = new WebClient(process.env.SLACK_TOKEN);
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID;
const SLACK_DIGEST_SCHEDULE = process.env.SLACK_DIGEST_SCHEDULE || 'now'; // Read schedule, default to 'now'

// Function to format a date as a string
function formatDate(date) {
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

// Format publication date if available
function formatPublishedDate(dateStr) {
    if (!dateStr) return "Unknown date";
    
    try {
        const date = new Date(dateStr);
        if (!isNaN(date)) {
            return date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
        }
        // If date parsing fails, return the original string
        return dateStr;
    } catch (e) {
        console.error(`Error parsing date: ${dateStr}`, e);
        return dateStr; // Return the original string on error
    }
}

// Main function to generate and send digest
async function sendDailyDigest() {
    try {
        console.log('Generating daily Delphi Digital digest...');
        
        // Read the visited_links.json file
        const visitedLinksPath = path.resolve(__dirname, '..', 'data/visited_links.json');
        
        // Ensure the file exists before trying to read it
        await ensureJsonFileExists(visitedLinksPath, []);
        
        let reports = [];
        try {
            const jsonData = JSON.parse(await fs.readFile(visitedLinksPath, 'utf8'));
             // Assuming jsonData is an object where keys are URLs/IDs and values are report objects
            reports = Array.isArray(jsonData) ? jsonData : Object.values(jsonData);
        } catch (readError) {
             if (readError.code === 'ENOENT') {
                // This shouldn't happen anymore since we ensure the file exists
                console.warn(`Digest source file not found: ${visitedLinksPath}. No digest will be sent.`);
             } else {
                console.error(`Error reading digest source file: ${readError.message}`);
                throw readError; // Re-throw other errors
             }
             reports = []; // Ensure reports is an array even if file doesn't exist
        }
        
        // Get current date and the date 24 hours ago
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Filter for reports updated in the last 24 hours
        const recentReports = reports.filter(report => {
            if (!report.lastChecked) return false;
            try {
                const lastChecked = new Date(report.lastChecked);
                return lastChecked >= yesterday && report.title && report.url; // Ensure basic fields exist
            } catch(dateError) {
                console.error(`Error parsing lastChecked date for report: ${report.url || 'unknown'}`, dateError);
                return false;
            }
        });
        
        // Sort by publication date (newest first)
        recentReports.sort((a, b) => {
            const dateA = a.publicationDate ? new Date(a.publicationDate) : new Date(0);
            const dateB = b.publicationDate ? new Date(b.publicationDate) : new Date(0);
            return dateB - dateA; // Newest first
        });
        
        // If no recent reports, send a notification and exit
        if (recentReports.length === 0) {
            console.log('No new reports found in the last 24 hours for the digest.');
            await slack.chat.postMessage({
                channel: SLACK_CHANNEL,
                text: `:information_source: *Delphi Digital Daily Digest*\nNo new reports from Delphi Digital in the last 24 hours.`
            });
            return;
        }
        
        // Generate digest header
        const digestBlocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": `Delphi Digital Daily Digest - ${formatDate(now)}`
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*${recentReports.length} report${recentReports.length > 1 ? 's' : ''} in the last 24 hours:*`
                }
            },
            {
                "type": "divider"
            }
        ];
        
        // Add each report to the digest
        for (const report of recentReports) {
            // Format publication date if available
            const publishDate = formatPublishedDate(report.publicationDate);
            
            // Create blocks for this report
            digestBlocks.push(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": `*<${report.url}|${report.title}>*\n_Published: ${publishDate}_`
                    }
                }
            );
            
            // Add summary if available (truncated if too long)
            if (report.summary) {
                let summary = report.summary;
                // Basic truncation - consider smarter truncation if needed
                if (summary.length > 500) {
                    summary = summary.substring(0, 500).trim() + '...';
                }
                
                digestBlocks.push(
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": summary
                        }
                    }
                );
            } else {
                 digestBlocks.push(
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "_Summary not available._"
                        }
                    }
                );
            }
            
            // Add divider between reports
            digestBlocks.push({
                "type": "divider"
            });
        }
        
        // Send digest to Slack (check block limit)
        // Slack allows up to 100 blocks per message. If more reports, consider pagination or alternative format.
        if (digestBlocks.length > 100) {
            console.warn(`Digest has ${digestBlocks.length} blocks, exceeding Slack's limit of 100. Truncating.`);
             // Simple truncation: take the first 99 blocks + a warning block
             const truncatedBlocks = digestBlocks.slice(0, 99);
             truncatedBlocks.push({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*Note:* Digest truncated due to length limitations."
                }
             });
              const result = await slack.chat.postMessage({
                  channel: SLACK_CHANNEL,
                  text: `Delphi Digital Daily Digest - ${formatDate(now)} (Truncated)`, // Fallback text
                  blocks: truncatedBlocks
              });
              console.log(`Truncated daily digest sent to Slack successfully: ${result.ts}`);

        } else {
             const result = await slack.chat.postMessage({
                channel: SLACK_CHANNEL,
                text: `Delphi Digital Daily Digest - ${formatDate(now)}`, // Fallback text
                blocks: digestBlocks
            });
            console.log(`Daily digest sent to Slack successfully: ${result.ts}`);
        }
        
    } catch (error) {
        console.error('Error sending daily digest:', error);
        // Optionally send an error message to Slack
        try {
            await slack.chat.postMessage({
                channel: SLACK_CHANNEL,
                text: `:x: Error generating Delphi Digital daily digest: ${error.message}`
            });
        } catch (slackError) {
            console.error('Failed to send error notification to Slack:', slackError);
        }
    }
}

// --- Scheduling Logic (runs when module is loaded if schedule is set) ---

function initializeDigestSchedule() {
    console.log(`Slack digest schedule configuration: ${SLACK_DIGEST_SCHEDULE}`);

    if (SLACK_DIGEST_SCHEDULE.toLowerCase() === 'now') {
        console.log('Digest schedule set to "now", run manually or via command.');
        // Optional: You could run it once on startup if 'now' is set,
        // but current setup runs it via command or explicit call.
        // sendDailyDigest();
    } else {
        // Attempt to parse HH:MM TZ format (e.g., "09:00 SGT")
        const scheduleMatch = SLACK_DIGEST_SCHEDULE.match(/^(\d{1,2}):(\d{2})\s+([A-Z]{3,})$/i);

        if (scheduleMatch) {
            const hour = scheduleMatch[1];
            const minute = scheduleMatch[2];
            const tzAbbreviation = scheduleMatch[3].toUpperCase();

            // Basic Timezone mapping (expand as needed)
            const timezoneMap = {
                'SGT': 'Asia/Singapore',
                'UTC': 'Etc/UTC',
                'EST': 'America/New_York',
                'PST': 'America/Los_Angeles'
                // Add other timezones your team might use
            };

            const timezone = timezoneMap[tzAbbreviation];

            if (timezone) {
                const cronPattern = `${minute} ${hour} * * *`;
                console.log(`Scheduling digest with pattern: "${cronPattern}" in timezone "${timezone}"`);

                if (cron.validate(cronPattern)) {
                     cron.schedule(cronPattern, () => {
                        console.log(`Running scheduled digest (${SLACK_DIGEST_SCHEDULE})...`);
                        sendDailyDigest();
                     }, {
                        scheduled: true,
                        timezone: timezone
                     });
                     console.log(`Digest scheduled successfully. Will run daily at ${hour}:${minute} ${timezone}.`);
                } else {
                     console.error(`Error: Invalid cron pattern generated: "${cronPattern}". Digest not scheduled.`);
                }

            } else {
                console.error(`Error: Unsupported timezone abbreviation "${tzAbbreviation}" in SLACK_DIGEST_SCHEDULE. Please use a known abbreviation (e.g., SGT, UTC). Digest not scheduled.`);
            }
        } else {
            console.error(`Error: Invalid SLACK_DIGEST_SCHEDULE format "${SLACK_DIGEST_SCHEDULE}". Expected "now" or "HH:MM TZ" (e.g., "09:00 SGT"). Digest not scheduled.`);
        }
    }
}

// Initialize the schedule when the module is loaded
initializeDigestSchedule();

// Export the main function for manual triggers (like Slack command)
module.exports = { sendDailyDigest }; 