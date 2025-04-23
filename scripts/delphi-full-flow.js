#!/usr/bin/env node
require('dotenv').config();

// --- DEBUG: Check if .env is loaded ---
console.log('DEBUG: SLACK_TOKEN loaded:', !!process.env.SLACK_TOKEN);
console.log('DEBUG: SLACK_CHANNEL_ID loaded:', !!process.env.SLACK_CHANNEL_ID);
// --- END DEBUG ---

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// Import services and utilities
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports, fetchReportContent } = require('../services/reports');
const { initializeSlack, sendSlackMessage, formatReportForSlack, logMessage, logWithTimestamp, logError } = require('../services/slack');
const { initializeGemini, getSummaryFromGemini } = require('../services/ai');
const { config, loadConfigFromEnv } = require('../config/config');
const { readLastVisitedLink, writeLastVisitedLink } = require('../utils/link-tracker');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(appConfig.GEMINI_API_KEY);
const slackInitialized = initializeSlack(appConfig.SLACK_TOKEN, appConfig.SLACK_CONFIG.channelId);

// Initialize Slack Digest Scheduling (will only schedule if SLACK_DIGEST_SCHEDULE is set in .env and not 'now')
require('./slack-digest.js');

// PID file path
const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

// Process command line arguments
const args = process.argv.slice(2);
const daemon = args.includes('--daemon');

const VISITED_LINKS_FILE_PATH = 'data/visited_links.json'; // Define constant for clarity

/**
 * Reads existing reports, appends new reports, sorts them, and writes back to the file.
 * @param {Array<object>} newlyProcessedReports - Array of report objects processed in this run.
 * @param {string} filePath - Path to the visited_links.json file.
 */
async function updateVisitedLinksFile(newlyProcessedReports, filePath) {
  let existingReports = [];
  try {
    // Attempt to read existing reports
    const data = await fs.readFile(filePath, 'utf8');
    existingReports = JSON.parse(data);
    if (!Array.isArray(existingReports)) {
        logWithTimestamp(`Warning: ${filePath} did not contain a valid JSON array. Starting fresh.`, 'warn');
        existingReports = [];
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      logWithTimestamp(`${filePath} not found. Creating a new file.`);
      // File doesn't exist, which is fine, we'll create it.
    } else {
      // Log other errors but proceed with an empty list
      logError(`Error reading existing ${filePath}, will overwrite if new reports exist:`, error);
    }
    existingReports = []; // Ensure it's an array
  }

  // Combine existing reports with the newly processed ones
  const combinedReports = [...existingReports, ...newlyProcessedReports];

  // Optional: Deduplicate based on URL (keeping the newest entry if duplicates exist)
  const reportMap = new Map();
  combinedReports.forEach(report => {
      const existing = reportMap.get(report.url);
      // Keep the one with the later scrapedAt date, or the new one if dates are equal/missing
      if (!existing || new Date(report.scrapedAt || 0) >= new Date(existing.scrapedAt || 0)) {
          reportMap.set(report.url, report);
      }
  });
  const uniqueReports = Array.from(reportMap.values());


  // Sort the combined, unique reports by publicationDate (descending)
  uniqueReports.sort((a, b) => {
    const dateA = new Date(a.publicationDate || a.scrapedAt || 0);
    const dateB = new Date(b.publicationDate || b.scrapedAt || 0);
    return dateB - dateA; // Newest first
  });

  // Write the combined, sorted reports back to the file
  try {
    await fs.writeFile(filePath, JSON.stringify(uniqueReports, null, 2), 'utf8');
    if (newlyProcessedReports.length > 0) {
       logWithTimestamp(`Successfully updated ${filePath} with ${newlyProcessedReports.length} new reports. Total reports: ${uniqueReports.length}.`);
    } else if (existingReports.length !== uniqueReports.length) {
        logWithTimestamp(`Successfully updated ${filePath}. No new reports, but file content potentially changed (e.g., sorting/deduplication). Total reports: ${uniqueReports.length}.`);
    } else {
       logWithTimestamp(`No updates needed for ${filePath}.`);
    }
  } catch (error) {
    logError(`Error writing combined reports to ${filePath}:`, error);
  }
}

// Function to retry failed operations
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      logWithTimestamp(`Attempt ${attempt} failed, retrying in ${delay/1000} seconds... Error: ${error.message}`, 'warn');
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
      // Try to load cookies from file
      await fs.access('data/delphi_cookies.json'); // Use hardcoded path
      const cookiesString = await fs.readFile('data/delphi_cookies.json', 'utf8'); // Use hardcoded path
      const cookies = JSON.parse(cookiesString);
      await page.setCookie(...cookies);
      return await login(
        page, 
        appConfig.DELPHI_EMAIL, 
        appConfig.DELPHI_PASSWORD, 
        'data/delphi_cookies.json'
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
        let temporaryBody = ""; // Variable to hold the body temporarily
        let summary = "Error: Could not summarize."; // Default summary
        let processedReportData = { ...report }; // Copy initial data
        const now = new Date().toISOString(); // Define 'now' timestamp once per report

        try {
          // Fetch body content
          const reportContent = await fetchReportContent(page, report.url);
          temporaryBody = reportContent; // Store the fetched body

          if (reportContent !== "Error fetching content.") {
            // Optional: Log truncated body
            // console.log("\n--- Fetched Report Body ---");
            // console.log(reportContent.substring(0, 500) + (reportContent.length > 500 ? '...' : ''));
            // console.log("--- End Report Body ---\n");

            // Summarize using Gemini (using the fetched body content)
            if (geminiInitialized) {
              // Pass the fetched body content (temporaryBody) to Gemini
              summary = await getSummaryFromGemini(report.title, temporaryBody);
              if (!summary || summary.startsWith('Error:')) { // Handle Gemini error or empty summary
                summary = summary || "Error: Failed to get summary from Gemini."; // Keep specific error if available
                logWithTimestamp(`Failed to get summary from Gemini for: ${report.title}`);
              } else {
                logWithTimestamp(`Summary received from Gemini for: ${report.title}`);
              }
            } else {
              summary = "Error: Gemini not initialized.";
              logWithTimestamp('Skipping Gemini summary: Not initialized.', 'warn');
            }

            // Construct the report object *after* summarization attempt
            processedReportData = {
              url: report.url,
              title: report.title || "Untitled Report",
              body: "", // Keep body empty in the final JSON structure
              timestamp: report.timestamp || now,
              scrapedAt: now,
              lastChecked: now,
              summary: summary, // Use the generated summary or error string
              publicationDate: report.publicationDate || now // Preserve original or use 'now'
            };

             // Send to Slack if summary was successful
            if (slackInitialized && !summary.startsWith('Error:')) {
              try {
                logWithTimestamp(`Sending summary for "${processedReportData.title}" to Slack...`);
                // Pass the version *without* the body to Slack formatting
                const blocks = formatReportForSlack(processedReportData);
                await sendSlackMessage(`New Report Summary: ${processedReportData.title}`, blocks);
                logWithTimestamp(`Sent summary for "${processedReportData.title}" to Slack successfully.`);
              } catch (slackError) {
                logError(`Failed to send report "${processedReportData.title}" to Slack:`, slackError);
              }
            } else if (!summary.startsWith('Error:')) {
                 logWithTimestamp(`Skipping Slack notification for "${processedReportData.title}" as Slack is not initialized.`, 'warn');
            } else {
                 logWithTimestamp(`Skipping Slack notification for "${processedReportData.title}" due to summary error.`);
            }

          } else {
            logWithTimestamp(`Skipping summarization due to content fetch error for ${report.title}`);
            // Update report data with simple error state
            processedReportData = {
               url: report.url,
               title: report.title || "Untitled Report",
               body: "", // Keep body empty
               timestamp: report.timestamp || now,
               scrapedAt: now,
               lastChecked: now,
               summary: "Error: Could not fetch content.", // Simple error message
               publicationDate: report.publicationDate || now
            };
          }

          // Add the processed (or error state) report data to our list for this run
          // Body is already cleared or was never populated in processedReportData here
          processedReportsThisRun.push(processedReportData);

        } catch (error) {
          logError(`Unhandled error processing report ${report.url}`, error);
          // Create an error entry to ensure the report is tracked
           processedReportsThisRun.push({
               url: report.url,
               title: report.title || "Untitled Report (Processing Error)",
               body: "",
               timestamp: report.timestamp || now,
               scrapedAt: now,
               lastChecked: now,
               summary: `Error: Unhandled exception during processing - ${error.message}`,
               publicationDate: report.publicationDate || now
           });
        }
        logWithTimestamp(`--- Finished Report: ${report.title} ---`);
      } // End for loop

      // Step 5: Update the main visited_links.json file using the modified function
      if (processedReportsThisRun.length > 0) {
        // Use the constant path and the modified function
        await updateVisitedLinksFile(processedReportsThisRun, VISITED_LINKS_FILE_PATH);
      } else {
        // Still call the function even if no new reports, to ensure sorting/deduplication happens
        logWithTimestamp('No new reports were successfully processed in this run, but updating file for consistency.');
        await updateVisitedLinksFile([], VISITED_LINKS_FILE_PATH);
        // logWithTimestamp('No reports were successfully processed in this run.');
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
       // Optionally, update the file even if no new reports were found to ensure it's sorted correctly
      await updateVisitedLinksFile([], VISITED_LINKS_FILE_PATH);
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