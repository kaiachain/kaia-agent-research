#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// Import services and utilities
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports } = require('../services/reports');
const { initializeSlack, sendSlackMessage, formatReportForSlack, logMessage, logWithTimestamp, logError } = require('../services/slack');
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { config, loadConfigFromEnv } = require('../config/config');
const { readLastVisitedLink, writeLastVisitedLink } = require('../utils/link-tracker');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(appConfig.GEMINI_API_KEY);
const slackInitialized = initializeSlack(appConfig.SLACK_TOKEN, appConfig.SLACK_CHANNEL_ID);

// PID file path
const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

// Process command line arguments
const args = process.argv.slice(2);
const daemon = args.includes('--daemon');

/**
 * Fetches the main textual content of a given report URL.
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the report page.
 * @returns {Promise<string>} The extracted text content.
 */
async function fetchReportContent(page, url) {
  try {
    logWithTimestamp(`Fetching content for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    // *** Attempt to get body text from common article containers ***
    const content = await page.evaluate(() => {
      const articleSelectors = [
        'article.report-content', // Specific class?
        '.prose',               // Common class for formatted text
        '.report-body',         // Another possible class
        'article',              // General article tag
        '#main-content'         // ID for main content area
      ];
      let mainContentElement = null;
      for (const selector of articleSelectors) {
        mainContentElement = document.querySelector(selector);
        if (mainContentElement) break;
      }
      // Return innerText which represents visible text content
      return mainContentElement ? mainContentElement.innerText : document.body.innerText;
    });
    logWithTimestamp(`Fetched body text successfully.`);
    return content;
  } catch (error) {
    logError(`Error fetching content for ${url}:`, error);
    return "Error fetching content."; // Return error message instead of throwing
  }
}

/**
 * Writes the newly processed reports from the current run to visited_links.json,
 * overwriting any previous content. Sorts reports before writing.
 * @param {Array<object>} newlyProcessedReports - Array of report objects processed in this run.
 * @param {string} filePath - Path to the visited_links.json file.
 */
async function updateVisitedLinksFile(newlyProcessedReports, filePath) {
  // Sort the newly processed reports by publicationDate (descending)
  // Use scrapedAt as a fallback if publicationDate is missing/invalid
  newlyProcessedReports.sort((a, b) => {
    const dateA = new Date(a.publicationDate || a.scrapedAt || 0);
    const dateB = new Date(b.publicationDate || b.scrapedAt || 0);
    return dateB - dateA;
  });

  // Write only the newly processed reports to the file, overwriting existing content
  try {
    await fs.writeFile(filePath, JSON.stringify(newlyProcessedReports, null, 2), 'utf8');
    if (newlyProcessedReports.length > 0) {
       logWithTimestamp(`Successfully wrote ${newlyProcessedReports.length} newly processed reports to ${filePath}.`);
    } else {
       logWithTimestamp(`Wrote empty array to ${filePath} as no reports were processed in this run.`);
    }
  } catch (error) {
    logError(`Error writing newly processed reports to ${filePath}:`, error);
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
    await logMessage('🔍 Starting Delphi Digital processing flow (using last visited link)...', [], false);
  }
  
  const browser = await launchBrowser();
  let latestProcessedUrl = null; // Track the URL of the newest report processed in this run

  try {
    const page = await setupPage(browser);
    
    // Step 1: Login to Delphi with retry
    logWithTimestamp('Attempting to log in...');
    const loginSuccess = await retryOperation(async () => {
      return await login(
        page, 
        appConfig.DELPHI_EMAIL, 
        appConfig.DELPHI_PASSWORD, 
        appConfig.COOKIES_FILE
      );
    });
    
    if (!loginSuccess) {
      logWithTimestamp('Failed to log in after retries. Aborting process.', 'error');
      if (slackInitialized) {
        await logMessage('❌ Failed to log in to Delphi Digital after multiple attempts. Check credentials.', [], true, 'error');
      }
      return false; // Indicate failure
    }
    
    // Step 2: Read the last visited link
    const lastVisitedUrl = await readLastVisitedLink();
    logWithTimestamp(`Last visited URL from file: ${lastVisitedUrl || 'None (first run?)'}`);

    // Step 3: Check for new reports since the last visited one
    const newReports = await retryOperation(async () => {
      // Pass lastVisitedUrl to checkForNewReports
      return await checkForNewReports(page, appConfig.DELPHI_REPORTS_URL, lastVisitedUrl);
    });
    
    // Step 4: Process each new report
    if (newReports && newReports.length > 0) {
      logWithTimestamp(`Processing ${newReports.length} new reports...`);
      const processedReportsThisRun = []; // Store successfully processed reports
      
      // Process reports (newest first assumed)
      latestProcessedUrl = newReports[0].url; // Store the newest URL to update last_visited_link

      for (const report of newReports) {
        logWithTimestamp(`--- Processing Report: ${report.title} ---`);
        try {
          // Fetch body content
          const reportContent = await fetchReportContent(page, report.url);
          let summary = "Error: Could not summarize."; // Default summary
          let processedReportData = { ...report }; // Copy initial data

          if (reportContent !== "Error fetching content.") {
            // Print the fetched body content to the terminal
            console.log("\n--- Fetched Report Body ---");
            console.log(reportContent.substring(0, 1000) + (reportContent.length > 1000 ? '... [truncated]' : '')); // Print truncated body
            console.log("--- End Report Body ---\n");
            
            // Summarize using Gemini (using the fetched body content)
            if (geminiInitialized) {
              summary = await getSummaryFromGemini(report.title, reportContent);
              if (!summary) { // Handle Gemini error
                summary = "Error: Failed to get summary from Gemini.";
                logWithTimestamp(`Failed to get summary from Gemini for: ${report.title}`);
              } else {
                logWithTimestamp(`Summary received from Gemini for: ${report.title}`);
              }
            } else {
              summary = "Error: Gemini not initialized.";
              logWithTimestamp('Skipping Gemini summary: Not initialized.', 'warn');
            }
            
            // Construct the report object using the template structure
            const now = new Date().toISOString();
            processedReportData = {
              url: report.url,
              title: report.title || "Untitled Report",
              body: "",
              timestamp: report.timestamp || now,
              scrapedAt: now,
              lastChecked: now,
              // Use the summary directly from Gemini (which includes relevance) or the error string
              summary: summary, 
              publicationDate: report.publicationDate || now
            };
            
            // Send to Slack if summary was successful
            if (slackInitialized && !summary.startsWith('Error:')) {
              try {
                logWithTimestamp(`Sending summary for "${processedReportData.title}" to Slack...`);
                const blocks = formatReportForSlack(processedReportData);
                await sendSlackMessage(`New Report Summary: ${processedReportData.title}`, blocks);
                logWithTimestamp(`Sent summary for "${processedReportData.title}" to Slack successfully.`);
              } catch (slackError) {
                logError(`Failed to send report "${processedReportData.title}" to Slack:`, slackError);
              }
            }
            
          } else {
            logWithTimestamp(`Skipping summarization due to content fetch error for ${report.title}`);
            // Update report data with simple error state
            const now = new Date().toISOString();
            processedReportData = {
               url: report.url,
               title: report.title || "Untitled Report",
               body: "",
               timestamp: report.timestamp || now,
               scrapedAt: now,
               lastChecked: now,
               summary: "Error: Could not fetch content.", // Simple error message
               publicationDate: report.publicationDate || now
            };
          }
          
          // Add the processed (or error state) report data to our list for this run
          processedReportsThisRun.push(processedReportData);

        } catch (error) {
          logError(`Unhandled error processing report ${report.url}`, error);
          // Optionally add an error entry to processedReportsThisRun here too
        }
        logWithTimestamp(`--- Finished Report: ${report.title} ---`);
      }
      
      // Step 5: Update the main visited_links.json file
      if (processedReportsThisRun.length > 0) {
        await updateVisitedLinksFile(processedReportsThisRun, appConfig.VISITED_LINKS_FILE);
      } else {
        logWithTimestamp('No reports were successfully processed in this run.');
      }

      // Step 6: Update the last visited link file with the newest URL processed
      if (latestProcessedUrl) { // Ensure we have a URL
        await writeLastVisitedLink(latestProcessedUrl);
      } else {
        logWithTimestamp('No new report URL found to update last visited link.', 'warn');
      }
      
      // TODO: Send Slack messages for processedReportsThisRun if needed
      // Example loop:
      // for (const processedReport of processedReportsThisRun) {
      //    if (!processedReport.summary.startsWith('Error:')) { 
      //       await sendSlackMessage(...)
      //    }
      // }

      logWithTimestamp(`✅ Processing complete for this run. Processed ${processedReportsThisRun.length} reports.`);
      if (slackInitialized) {
        await logMessage(`✅ Successfully processed ${processedReportsThisRun.length} reports. Newest: ${latestProcessedUrl || 'N/A'}`, [], false);
      }

    } else {
      logWithTimestamp('No new reports found since last visit.');
      if (slackInitialized) {
        await logMessage('😴 No new reports found from Delphi Digital since last visit.', [], false);
      }
    }
    
    return true; // Indicate success

  } catch (error) {
    logError('An unexpected error occurred in the main flow', error);
    if (slackInitialized) {
      await logMessage('❌ An unexpected error occurred during the Delphi processing flow. Check logs.', [], true, 'error');
    }
    return false; // Indicate failure
  } finally {
    if (browser) {
      await browser.close();
      logWithTimestamp('Browser closed.');
    }
    logWithTimestamp(`=== Delphi full flow finished: ${new Date().toISOString()} ===`);
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