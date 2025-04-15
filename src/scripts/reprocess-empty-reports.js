#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import services and utilities
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { updateVisitedLinks } = require('../services/reports');
const { initializeSlack, sendSlackMessage, formatReportForSlack } = require('../services/slack');
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { extractContent } = require('../utils/content-extractor');
const { loadCache, updateCache, createContentHash } = require('../utils/cache');
const { loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(process.env.GEMINI_API_KEY);
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// Function to process a single report
async function processReport(page, report, cache) {
  try {
    console.log(`Processing report: ${report.url}`);
    
    // Extract content from the report page
    const articleContent = await extractContent(page, report.url);
    
    // Generate a summary using AI
    let summary = await getSummaryFromGemini(articleContent.title, articleContent.content);
    
    if (!summary) {
      console.log(`Failed to generate summary for report: ${report.url}`);
      summary = "No summary available.";
    } else {
      console.log(`Successfully generated summary for report: ${report.url}`);
    }
    
    // Current timestamp for all timestamp-related fields
    const now = new Date().toISOString();
    
    // Update the report object using the exact format from visited_links.json.template
    return {
      url: report.url,
      title: articleContent.title || report.title || "Untitled Report",
      body: articleContent.content || "",
      timestamp: report.timestamp || now,
      scrapedAt: now,
      lastChecked: now,
      summary: summary,
      publicationDate: articleContent.publicationDate || report.publicationDate || now
    };
  } catch (error) {
    console.error(`Error processing report ${report.url}:`, error);
    return report; // Return original report on error
  }
}

// Main function to reprocess empty reports
async function reprocessEmptyReports() {
  console.log(`=== Starting reprocessing of empty reports: ${new Date().toISOString()} ===`);
  
  // Verify required environment variables
  const requiredEnvVars = [
    { name: 'GEMINI_API_KEY', value: process.env.GEMINI_API_KEY },
    { name: 'DELPHI_EMAIL', value: process.env.DELPHI_EMAIL },
    { name: 'DELPHI_PASSWORD', value: process.env.DELPHI_PASSWORD },
    { name: 'SLACK_TOKEN', value: process.env.SLACK_TOKEN },
    { name: 'SLACK_CHANNEL_ID', value: process.env.SLACK_CHANNEL_ID }
  ];
  
  const missingVars = requiredEnvVars
    .filter(v => !v.value)
    .map(v => v.name);
    
  if (missingVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file and ensure all required variables are set.');
    return false;
  }
  
  if (!geminiInitialized) {
    console.error("Gemini API not initialized. Please check your API key.");
    return false;
  }
  
  if (slackInitialized) {
    await sendSlackMessage('🔄 Starting to reprocess reports with empty summaries...');
  }
  
  try {
    // Load visited links file
    const visitedLinksData = await fs.readFile(appConfig.VISITED_LINKS_FILE, 'utf8');
    const visitedLinks = JSON.parse(visitedLinksData);
    
    // Find reports with empty summaries
    const emptyReports = visitedLinks.filter(link => !link.summary || link.summary.length === 0);
    
    if (emptyReports.length === 0) {
      console.log('No reports with empty summaries found.');
      if (slackInitialized) {
        await sendSlackMessage('ℹ️ No reports with empty summaries found.');
      }
      return true;
    }
    
    console.log(`Found ${emptyReports.length} reports with empty summaries.`);
    if (slackInitialized) {
      await sendSlackMessage(`🔍 Found ${emptyReports.length} reports with empty summaries to process.`);
    }
    
    // Launch browser
    const browser = await launchBrowser();
    
    try {
      const page = await setupPage(browser);
      
      // Login to Delphi
      console.log('Attempting to log in...');
      const loginSuccess = await login(
        page, 
        process.env.DELPHI_EMAIL, 
        process.env.DELPHI_PASSWORD, 
        appConfig.COOKIES_FILE
      );
      
      if (!loginSuccess) {
        console.log('Failed to log in. Aborting process.');
        if (slackInitialized) {
          await sendSlackMessage('❌ Failed to log in to Delphi Digital. Check credentials.');
        }
        return false;
      }
      
      // Load cache
      const cache = await loadCache(appConfig.CACHE_FILE);
      
      // Process each empty report
      const processedReports = [];
      for (const report of emptyReports) {
        try {
          const processedReport = await processReport(page, report, cache);
          
          // Check if processing actually improved the report
          if (processedReport.summary && processedReport.summary.length > 0 && processedReport.summary !== "No summary available.") {
            processedReports.push(processedReport);
          } else {
            console.log(`Failed to improve report: ${report.url}`);
          }
          
          // Add a small delay between processing reports
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Error processing report ${report.url}:`, error);
        }
      }
      
      if (processedReports.length > 0) {
        // Update the original array with the processed reports
        const updatedVisitedLinks = visitedLinks.map(link => {
          const processed = processedReports.find(r => r.url === link.url);
          return processed || link;
        });
        
        // Update the visited links file
        await fs.writeFile(appConfig.VISITED_LINKS_FILE, JSON.stringify(updatedVisitedLinks, null, 2));
        
        console.log(`Successfully processed ${processedReports.length} reports out of ${emptyReports.length} empty reports.`);
        if (slackInitialized) {
          await sendSlackMessage(`✅ Successfully processed ${processedReports.length} reports out of ${emptyReports.length} empty reports.`);
          
          // Send each successfully processed report to Slack
          console.log('Sending processed reports to Slack...');
          for (const report of processedReports) {
            try {
              console.log(`Sending report to Slack: ${report.title}`);
              
              // Format the report for Slack
              const blocks = formatReportForSlack(report);
              
              // Send the report to Slack
              await sendSlackMessage(`Report summary: ${report.title}`, blocks);
              
              // Add a small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
              console.error(`Error sending report "${report.title}" to Slack:`, error);
            }
          }
          
          // Log locally instead of sending to Slack
          logWithTimestamp(`✅ Successfully sent ${processedReports.length} reports to Slack!`);
        }
      } else {
        console.log('Failed to process any empty reports successfully.');
        if (slackInitialized) {
          await sendSlackMessage('⚠️ Attempted to process empty reports, but none were successfully processed.');
        }
      }
      
      return true;
    } finally {
      await browser.close();
    }
  } catch (error) {
    logWithTimestamp(`Error in reprocessing: ${error.message}`, 'error');
    // Don't send errors to Slack, only log them to console
    // await sendSlackMessage(`❌ Error in reprocessing: ${error.message}`);
    return false;
  }
}

// Run the main function
if (require.main === module) {
  reprocessEmptyReports()
    .then(() => {
      console.log('Reprocessing complete.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export function for testing and importing
module.exports = {
  reprocessEmptyReports
}; 