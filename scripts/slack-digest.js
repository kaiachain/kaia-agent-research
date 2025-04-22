require('dotenv').config();
const fs = require('fs').promises;
const { WebClient } = require('@slack/web-api');
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack client
const slack = new WebClient(process.env.SLACK_TOKEN);
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID;

// Function to format a date as a string
function formatDate(date) {
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

// Main function to generate and send digest
async function sendDailyDigest() {
    try {
        console.log('Generating daily Delphi Digital digest...');
        
        // Read the visited_links.json file
        const jsonData = JSON.parse(await fs.readFile(appConfig.VISITED_LINKS_FILE, 'utf8'));
        const reports = Object.values(jsonData);
        
        // Get current date and the date 24 hours ago
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Filter for reports updated in the last 24 hours
        const recentReports = reports.filter(report => {
            if (!report.lastChecked) return false;
            const lastChecked = new Date(report.lastChecked);
            return lastChecked >= yesterday;
        });
        
        // Sort by publication date (newest first)
        recentReports.sort((a, b) => {
            const dateA = a.publicationDate ? new Date(a.publicationDate) : new Date(0);
            const dateB = b.publicationDate ? new Date(b.publicationDate) : new Date(0);
            return dateB - dateA;
        });
        
        // If no recent reports, send a notification and exit
        if (recentReports.length === 0) {
            console.log('No recent reports found in the last 24 hours.');
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
            const publishDate = report.publicationDate 
                ? new Date(report.publicationDate).toLocaleDateString() 
                : "Unknown date";
            
            // Create blocks for this report
            digestBlocks.push(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": `*${report.title}*\n${publishDate} · <${report.url}|View Report>`
                    }
                }
            );
            
            // Add summary if available (truncated if too long)
            if (report.summary) {
                let summary = report.summary;
                if (summary.length > 500) {
                    summary = summary.substring(0, 500) + '...';
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
            }
            
            // Add divider between reports
            digestBlocks.push({
                "type": "divider"
            });
        }
        
        // Send digest to Slack
        const result = await slack.chat.postMessage({
            channel: SLACK_CHANNEL,
            blocks: digestBlocks
        });
        
        console.log('Daily digest sent to Slack successfully');
        console.log(`Message ID: ${result.ts}`);
        
    } catch (error) {
        console.error('Error sending daily digest:', error);
    }
}

// Execute the function if this script is run directly
if (require.main === module) {
    sendDailyDigest();
}

// Export for use in other modules
module.exports = { sendDailyDigest }; 