#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// Import services and utilities
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports, findNewReports, updateVisitedLinks } = require('../services/reports');
const { initializeSlack, sendSlackMessage, formatReportForSlack, getMessagesForReport, getMessageHistory, logMessage, logWithTimestamp, logError } = require('../services/slack');
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { extractContent } = require('../utils/content-extractor');
const { loadCache, updateCache, createContentHash, needsProcessing } = require('../utils/cache');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(process.env.GEMINI_API_KEY);
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// PID file path
const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

// Process command line arguments
const args = process.argv.slice(2);
const daemon = args.includes('--daemon');

// Main function to process a single report
async function processReport(page, report, cache) {
  try {
    logWithTimestamp(`Processing report: ${report.title}`);
    
    // Check if we've sent messages about this report before
    const previousMessages = await getMessagesForReport(report.url);
    const isUpdate = previousMessages.length > 0;
    
    // Extract content from the report page
    const articleContent = await extractContent(page, report.url);
    
    // Generate a summary using AI
    let summary = await getSummaryFromGemini(articleContent.title, articleContent.content);
    
    if (!summary) {
      summary = "No summary available.";
    }
    
    // Current timestamp for all timestamp-related fields
    const now = new Date().toISOString();
    
    // Update the report object using the exact format from visited_links.json.template
    const processedReport = {
      url: report.url,
      title: articleContent.title || report.title || "Untitled Report",
      body: "",
      timestamp: now,
      scrapedAt: now,
      lastChecked: now,
      summary: summary,
      publicationDate: articleContent.publicationDate || now
    };
    
    // Update cache
    const contentHash = createContentHash(articleContent.content);
    await updateCache(report.url, processedReport, contentHash, cache, appConfig.CACHE_FILE);
    
    // Skip sending to Slack if this report has already been sent before
    // We'll let the caller decide whether to send or not based on isUpdate
    
    return {
      report: processedReport,
      isUpdate: isUpdate,
      previousMessages: previousMessages
    };
  } catch (error) {
    logError(`Error processing report ${report.url}`, error);
    
    // If there's an error, return a minimal valid report following the template
    const now = new Date().toISOString();
    return {
      report: {
        url: report.url,
        title: report.title || "Error: Could not process report",
        body: "",
        timestamp: now,
        scrapedAt: now, 
        lastChecked: now,
        summary: "Error processing this report. Please check manually.",
        publicationDate: now
      },
      isUpdate: false,
      previousMessages: []
    };
  }
}

// Function to retry failed operations
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      logWithTimestamp(`Attempt ${attempt} failed, retrying in ${delay/1000} seconds...`, 'warn');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Main function to handle the complete flow
async function runFullFlow() {
  logWithTimestamp(`=== Starting Delphi full flow: ${new Date().toISOString()} ===`);
  
  if (slackInitialized) {
    await logMessage('🔍 Starting Delphi Digital full processing flow...', [], false);
  }
  
  const browser = await launchBrowser();
  
  try {
    const page = await setupPage(browser);
    
    // Step 1: Login to Delphi with retry
    logWithTimestamp('Attempting to log in...');
    const loginSuccess = await retryOperation(async () => {
      return await login(
        page, 
        process.env.DELPHI_EMAIL, 
        process.env.DELPHI_PASSWORD, 
        appConfig.COOKIES_FILE
      );
    });
    
    if (!loginSuccess) {
      logWithTimestamp('Failed to log in after retries. Aborting process.', 'error');
      if (slackInitialized) {
        await logMessage('❌ Failed to log in to Delphi Digital after multiple attempts. Check credentials.', [], true, 'error');
      }
      return false;
    }
    
    // Step 2: Check for new reports with retry
    const links = await retryOperation(async () => {
      const result = await checkForNewReports(page, appConfig.DELPHI_URL);
      if (result.length === 0) throw new Error('No links found');
      return result;
    });
    
    if (links.length === 0) {
      logWithTimestamp('Failed to get links from Delphi after retries. Aborting process.', 'error');
      if (slackInitialized) {
        await logMessage('❌ Failed to retrieve links from Delphi Digital after multiple attempts.', [], true, 'error');
      }
      return false;
    }
    
    // Step 3: Find new reports
    const { newLinks, visitedLinks } = await findNewReports(links, appConfig.VISITED_LINKS_FILE);
    
    // Load cache
    const cache = await loadCache(appConfig.CACHE_FILE);
    
    // Load message history to check which reports have been sent
    logWithTimestamp('Loading Slack message history to check for previously sent reports...');
    const messageHistory = await getMessageHistory(1000);
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
    
    logWithTimestamp(`Found ${sentReportUrls.size} reports that have already been sent to Slack`);
    
    // Step 4: Process each new report
    if (newLinks.length > 0) {
      // Get all reports that need to be processed
      const reportsToProcess = newLinks.filter(report => !sentReportUrls.has(report.url));
      
      if (reportsToProcess.length === 0 && newLinks.length > 0) {
        logWithTimestamp('All new reports have already been sent to Slack');
        await logMessage(`ℹ️ Found ${newLinks.length} new reports, but all have already been sent to Slack before.`, [], false);
      } else if (reportsToProcess.length < newLinks.length) {
        logWithTimestamp(`Found ${newLinks.length} new reports, but only ${reportsToProcess.length} need to be sent to Slack`);
        const skippedReports = newLinks.filter(report => sentReportUrls.has(report.url));
        const skippedList = skippedReports.map(report => `• ${report.title}: ${report.url}`).join('\n');
        await logMessage(`📊 Found ${newLinks.length} new reports, processing ${reportsToProcess.length} (skipping ${skippedReports.length} that were already sent).\n\nSkipped reports:\n${skippedList}`, [], false);
      } else if (reportsToProcess.length > 0) {
        logWithTimestamp(`Found ${reportsToProcess.length} new reports`);
        await logMessage(`🔍 Found ${reportsToProcess.length} new reports to process.`, [], false);
      }
      
      // Initialize arrays to track processed reports and those to be sent
      const processedReports = [];
      const reportsToSend = [];
      
      // Process each report that needs processing
      for (const link of reportsToProcess) {
        try {
          const result = await processReport(page, link, cache);
          processedReports.push(result.report);
          
          // Check if this report should be sent to Slack (not in sentReportUrls)
          if (!sentReportUrls.has(link.url)) {
            reportsToSend.push(result);
          } else {
            logWithTimestamp(`Skipping sending report "${link.title}" to Slack as it has already been sent before.`);
          }
        } catch (error) {
          logError(`Error processing report ${link.url}`, error);
          // Continue with other reports even if one fails
        }
      }
      
      // Only update visited links if we actually processed any reports
      if (processedReports.length > 0) {
        // Step 5: Update visited links with processed reports
        await updateVisitedLinks(processedReports, visitedLinks, appConfig.VISITED_LINKS_FILE);
      }
      
      // Step 6: Send new reports to Slack (only those that haven't been sent before)
      if (reportsToSend.length > 0) {
        logWithTimestamp(`Sending ${reportsToSend.length} new reports to Slack...`);
        
        for (const resultItem of reportsToSend) {
          const { report, isUpdate, previousMessages } = resultItem;
          
          // Format the report for Slack
          const blocks = formatReportForSlack(report);
          
          // Add update information if this is an update to a previously sent report
          let messagePrefix = `New report summary: ${report.title}`;
          if (isUpdate) {
            messagePrefix = `Update for report: ${report.title} (previously sent ${previousMessages.length} time${previousMessages.length > 1 ? 's' : ''})`;
            
            // Add a note about the update to the blocks
            blocks.push({
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `_This is an update to a previously processed report. Updated on ${new Date().toLocaleString()}_`
                }
              ]
            });
          }
          
          // Send the report to Slack (this should be sent to Slack as it's a report summary)
          if (slackInitialized) {
            await sendSlackMessage(messagePrefix, blocks);
            logWithTimestamp(`Sent report "${report.title}" to Slack.`);
          }
        }
        
        // Send notification that processing is complete (this should be sent to Slack as it's a summary)
        if (slackInitialized) {
          logWithTimestamp(`✅ Successfully processed and sent ${reportsToSend.length} new reports!`);
        }
      } else if (processedReports.length > 0) {
        logWithTimestamp(`Processed ${processedReports.length} reports, but all were already sent to Slack`);
        await logMessage(`✅ Successfully processed ${processedReports.length} new reports, but all were already sent to Slack previously.`, [], false);
      }
    } else {
      logWithTimestamp('No new reports found');
      await logMessage('😴 No new reports found from Delphi Digital.', [], false);
    }
    
    // Step 7: Find reports in visited_links.json that have summaries but haven't been sent to Slack
    logWithTimestamp('Checking for previously processed reports that need to be sent to Slack...');
    
    // Get all reports that have summaries
    const processedReportsWithSummaries = visitedLinks.filter(link => link.summary && link.summary.length > 0);
    
    // Filter to only those that have not been sent to Slack before
    const processedReportsToSend = processedReportsWithSummaries.filter(report => !sentReportUrls.has(report.url));
    
    // Send these reports to Slack
    if (processedReportsToSend.length > 0) {
      // Limit to 10 reports per run to avoid flooding Slack
      const reportsToSendNow = processedReportsToSend.slice(0, 10);
      const extraCount = processedReportsToSend.length > 10 ? 
        `\n\n_Note: There are ${processedReportsToSend.length - 10} more reports that will be sent in subsequent runs._` : '';
      
      const reportList = reportsToSendNow.map(report => `• ${report.title || 'Untitled'}: ${report.url}`).join('\n');
      
      // Log to console only, don't send to Slack (changed from true to false)
      await logMessage(`📋 Sending ${processedReportsToSend.length} previously processed reports to Slack.\n${reportList}${extraCount}`, [], false);
      
      // Send each report
      let sentCount = 0;
      for (const report of reportsToSendNow) {
        logWithTimestamp(`Sending previously processed report to Slack: ${report.title}`);
        
        // Format the report for Slack
        const blocks = formatReportForSlack(report);
        
        // Send the report to Slack (this should be sent to Slack as it's a report summary)
        try {
          await sendSlackMessage(`Report summary: ${report.title}`, blocks);
          sentCount++;
          
          // Add a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logError(`Error sending report to Slack`, error);
        }
      }
      
      // Send notification that processing is complete - log to console only (don't send to Slack)
      if (sentCount > 0) {
        // Log locally but don't send to Slack
        logWithTimestamp(`✅ Successfully sent ${sentCount} previously processed reports to Slack!`);
      } else {
        // Log locally but don't send to Slack
        logWithTimestamp(`⚠️ Attempted to send ${processedReportsToSend.length} previously processed reports to Slack, but none were sent successfully.`);
      }
    } else if (visitedLinks.some(link => link.summary && link.summary.length > 0)) {
      logWithTimestamp('All previously processed reports have already been sent to Slack');
      // Log to console only (changed from true to false)
      await logMessage(`ℹ️ No previously processed reports to send - all have already been sent to Slack.`, [], false);
    }
    
    return true;
  } catch (error) {
    logError('Error in full flow process', error);
    // Don't send errors to Slack
    return false;
  } finally {
    await browser.close();
  }
}

// Function to start daemon
async function startDaemon() {
  try {
    // Check if already running
    try {
      const pidData = await fs.readFile(PID_FILE, 'utf8');
      const pid = parseInt(pidData.trim(), 10);
      
      // Check if process is still running
      process.kill(pid, 0);
      logWithTimestamp(`Delphi full flow is already running with PID ${pid}`);
      return false;
    } catch (err) {
      // Process not running or PID file doesn't exist, which is fine
    }
    
    // Start the daemon
    logWithTimestamp('Starting Delphi full flow daemon...');
    
    // Use node to run this script with the same arguments but without --daemon
    const args = process.argv.slice(2).filter(arg => arg !== '--daemon');
    const child = spawn('node', [__filename, ...args], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    
    // Detach the child process
    child.unref();
    
    // Write PID file
    await fs.writeFile(PID_FILE, child.pid.toString());
    
    logWithTimestamp(`Delphi full flow daemon started with PID ${child.pid}`);
    logWithTimestamp('The daemon will check for new reports every 24 hours by default.');
    logWithTimestamp('You can stop it using: npm run delphi:stop');
    
    return true;
  } catch (error) {
    logWithTimestamp('Error starting daemon:', error);
    return false;
  }
}

// Function to schedule regular checks
async function scheduledExecution() {
  // Run the initial flow
  await runFullFlow();
  
  // Schedule regular runs
  setInterval(async () => {
    await runFullFlow();
  }, appConfig.CHECK_INTERVAL);
  
  logWithTimestamp(`Delphi flow scheduled. Next execution in ${appConfig.CHECK_INTERVAL / (60 * 60 * 1000)} hours`);
}

// Main execution
async function main() {
  if (daemon) {
    // Start as daemon
    await startDaemon();
  } else {
    // Run scheduled execution
    await scheduledExecution();
  }
}

// Run the main function
if (require.main === module) {
  main();
}

// Export functions for testing and importing
module.exports = {
  runFullFlow,
  startDaemon,
  scheduledExecution
}; 