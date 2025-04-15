#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import services and utilities
const { initializeSlack, sendSlackMessage, formatReportForSlack, getMessageHistory, getMessagesForReport } = require('../services/slack');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// Process command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '0', 10);
const urlFilter = args.find(arg => arg.startsWith('--url='))?.split('=')[1];

// Main function to check and send unsent reports
async function sendUnsentReports() {
  console.log(`=== Checking for unsent reports: ${new Date().toISOString()} ===`);
  
  if (!slackInitialized) {
    console.error('❌ Slack is not initialized. Please check your SLACK_TOKEN and SLACK_CHANNEL_ID.');
    return false;
  }
  
  try {
    // Load visited links
    console.log(`Loading visited links from ${appConfig.VISITED_LINKS_FILE}`);
    const visitedLinksData = await fs.readFile(appConfig.VISITED_LINKS_FILE, 'utf8');
    const visitedLinks = JSON.parse(visitedLinksData);
    
    console.log(`Found ${visitedLinks.length} total reports in visited_links.json`);
    
    // Get message history
    console.log('Loading Slack message history...');
    const messageHistory = await getMessageHistory(1000); // Get a large message history
    console.log(`Found ${messageHistory.length} messages in history`);
    
    // Extract URLs of reports that have been sent to Slack
    const sentReportUrls = new Set(
      messageHistory
        .filter(msg => msg.text && (
          msg.text.includes('New report summary:') || 
          msg.text.includes('Update for report:') || 
          msg.text.includes('Report summary:')
        ))
        .flatMap(msg => {
          // Extract URLs from blocks if present
          if (msg.blocks && Array.isArray(msg.blocks)) {
            return msg.blocks
              .filter(block => block.type === 'section' && block.fields)
              .flatMap(block => block.fields || [])
              .filter(field => field && field.text && field.text.includes('<http'))
              .map(field => {
                const match = field.text.match(/<(https?:\/\/[^|>]+)/);
                return match ? match[1] : null;
              })
              .filter(url => url !== null);
          }
          return [];
        })
    );
    
    // Also check message text for URLs
    messageHistory.forEach(msg => {
      if (msg.text) {
        const urlMatches = msg.text.match(/https?:\/\/[^\s]+/g);
        if (urlMatches) {
          urlMatches.forEach(url => sentReportUrls.add(url));
        }
      }
    });
    
    console.log(`Found ${sentReportUrls.size} reports that have already been sent to Slack`);
    
    // Find reports in visitedLinks that haven't been sent to Slack
    let unsentReports = visitedLinks.filter(link => 
      link.url && 
      link.summary && 
      link.summary.length > 0 && 
      !sentReportUrls.has(link.url)
    );
    
    // Apply URL filter if specified
    if (urlFilter) {
      unsentReports = unsentReports.filter(report => report.url.includes(urlFilter));
      console.log(`Applied URL filter "${urlFilter}", ${unsentReports.length} reports match`);
    }
    
    // Apply limit if specified
    if (limit > 0 && unsentReports.length > limit) {
      console.log(`Limiting to ${limit} reports (out of ${unsentReports.length} total unsent)`);
      unsentReports = unsentReports.slice(0, limit);
    }
    
    if (unsentReports.length === 0) {
      console.log('No unsent reports found. All processed reports have already been sent to Slack.');
      return true;
    }
    
    console.log(`Found ${unsentReports.length} reports that haven't been sent to Slack:`);
    unsentReports.forEach(report => console.log(`- ${report.title}: ${report.url}`));
    
    if (dryRun) {
      console.log('Dry run mode: Not sending any reports to Slack');
      return true;
    }
    
    // One more verification check before sending
    // This double-checks each URL to make sure we absolutely haven't sent it
    const finalUnsentReports = [];
    
    for (const report of unsentReports) {
      // Get messages specifically for this report
      const reportMessages = await getMessagesForReport(report.url);
      if (reportMessages.length === 0) {
        finalUnsentReports.push(report);
      } else {
        console.log(`Skipping "${report.title}" as found ${reportMessages.length} existing message(s) containing this URL`);
      }
    }
    
    if (finalUnsentReports.length === 0) {
      console.log('After thorough verification, found no unsent reports. All reports have already been sent to Slack.');
      await sendSlackMessage('ℹ️ After checking visited_links.json, found no reports that need to be sent to Slack.');
      return true;
    }
    
    // Send notification about reports that need to be sent
    const reportList = finalUnsentReports.map(link => `• ${link.title || 'Untitled'}: ${link.url}`).join('\n');
    await sendSlackMessage(`📋 Sending ${finalUnsentReports.length} previously processed reports to Slack.\n${reportList}`);
    
    // Process each unsent report
    for (const report of finalUnsentReports) {
      console.log(`Sending report to Slack: ${report.title}`);
      
      // Format the report for Slack
      const blocks = formatReportForSlack(report);
      
      // Send the report to Slack
      await sendSlackMessage(`Report summary: ${report.title}`, blocks);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Log locally instead of sending to Slack
    logWithTimestamp(`✅ Successfully sent ${finalUnsentReports.length} previously processed reports to Slack!`);
    
    return true;
  } catch (error) {
    logWithTimestamp(`Error sending unsent reports: ${error.message}`, 'error');
    // Don't send errors to Slack, only log them to console
    // await sendSlackMessage(`❌ Error sending unsent reports: ${error.message}`);
    return false;
  }
}

// Run the function if called directly
if (require.main === module) {
  sendUnsentReports().then(success => {
    if (success) {
      console.log('Successfully completed unsent reports check');
      process.exit(0);
    } else {
      console.error('Failed to complete unsent reports check');
      process.exit(1);
    }
  });
}

// Export for importing in other scripts
module.exports = {
  sendUnsentReports
}; 