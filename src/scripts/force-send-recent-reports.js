#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;

// Import services and utilities
const { initializeSlack, sendSlackMessage, formatReportForSlack } = require('../services/slack');
const { loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// Main function to send recent reports
async function sendRecentReports(count = 5) {
  console.log(`=== Forcing send of last ${count} reports to Slack: ${new Date().toISOString()} ===`);
  
  // Verify required environment variables
  if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL_ID) {
    console.error('Error: Slack token or channel ID not set in environment variables');
    return false;
  }
  
  if (!slackInitialized) {
    console.error('Error: Failed to initialize Slack');
    return false;
  }
  
  try {
    // Load visited links file
    console.log(`Loading reports from ${appConfig.VISITED_LINKS_FILE}...`);
    const visitedLinksData = await fs.readFile(appConfig.VISITED_LINKS_FILE, 'utf8');
    const visitedLinks = JSON.parse(visitedLinksData);
    
    // Get reports that have a summary
    const reportsWithSummary = visitedLinks.filter(link => 
      link.summary && link.summary.length > 0 && link.summary !== "No summary available."
    );
    
    if (reportsWithSummary.length === 0) {
      console.log('No reports with summaries found.');
      await sendSlackMessage('❌ No reports with summaries found to send to Slack.');
      return false;
    }
    
    // Get the most recent reports
    const recentReports = reportsWithSummary
      .sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate))
      .slice(0, count);
    
    console.log(`Found ${recentReports.length} recent reports with summaries to send.`);
    
    // Send notification about which reports we're sending
    const reportList = recentReports.map(report => `• ${report.title}: ${report.url}`).join('\n');
    await sendSlackMessage(`🔄 Force-sending the ${recentReports.length} most recent reports to Slack:\n\n${reportList}`);
    
    // Send each report to Slack
    let sentCount = 0;
    for (const report of recentReports) {
      try {
        console.log(`Sending report to Slack: ${report.title}`);
        
        // Format the report for Slack
        const blocks = formatReportForSlack(report);
        
        // Send the report to Slack
        await sendSlackMessage(`Report summary: ${report.title}`, blocks);
        sentCount++;
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error sending report "${report.title}" to Slack:`, error);
      }
    }
    
    // Send notification that processing is complete
    if (sentCount > 0) {
      await sendSlackMessage(`✅ Successfully force-sent ${sentCount} reports to Slack!`);
      console.log(`Successfully sent ${sentCount} reports to Slack.`);
    } else {
      await sendSlackMessage(`❌ Failed to send any reports to Slack.`);
      console.log('Failed to send any reports to Slack.');
    }
    
    return true;
  } catch (error) {
    console.error('Error sending recent reports:', error);
    await sendSlackMessage(`❌ Error sending reports to Slack: ${error.message}`);
    return false;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let reportCount = 5; // Default to 5 reports

// Check if a count parameter was provided
if (args.length > 0) {
  const parsedCount = parseInt(args[0], 10);
  if (!isNaN(parsedCount) && parsedCount > 0) {
    reportCount = parsedCount;
  }
}

// Run the main function
if (require.main === module) {
  sendRecentReports(reportCount)
    .then(() => {
      console.log('Sending recent reports complete.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export function for testing and importing
module.exports = {
  sendRecentReports
}; 