#!/usr/bin/env node
require("dotenv").config();

const logger = require("./logger"); // Import the configured logger

// --- DEBUG: Check if .env is loaded ---
// console.log('DEBUG: SLACK_TOKEN loaded:', !!process.env.SLACK_TOKEN);
// console.log('DEBUG: SLACK_CHANNEL_ID loaded:', !!process.env.SLACK_CHANNEL_ID);
logger.debug(`SLACK_TOKEN loaded: ${!!process.env.SLACK_TOKEN}`);
logger.debug(`SLACK_CHANNEL_ID loaded: ${!!process.env.SLACK_CHANNEL_ID}`);
// --- END DEBUG ---

const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");
const cron = require("node-cron");

// Import services and utilities
const { launchBrowser, setupPage } = require("../browser/browser");
const { login } = require("../services/auth");
const {
  checkForNewReports,
  fetchReportContent,
  extractPublishedDate,
} = require("../services/reports");
const {
  initializeSlack,
  sendSlackMessage,
  formatReportForSlack,
  logMessage,
} = require("../services/slack");
const { initializeGemini, getSummaryFromGemini } = require("../services/ai");
const { config, loadConfigFromEnv } = require("../config/config");
const {
  readLastVisitedLink,
  writeLastVisitedLink,
} = require("../utils/link-tracker");
const { ensureJsonFileExists } = require("../utils/file-utils");
const { runDigest } = require("../services/digest");

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(appConfig.GEMINI_API_KEY);
const slackInitialized = initializeSlack(
  appConfig.SLACK_TOKEN,
  appConfig.SLACK_CONFIG.channelId
);

// Initialize Slack Digest Scheduling (will only schedule if SLACK_DIGEST_SCHEDULE is set in .env and not 'now')
// require('./slack-digest.js');

// PID file path
const PID_FILE = path.join(process.cwd(), "delphi-checker.pid");

// Process command line arguments
const args = process.argv.slice(2);
const daemon = args.includes("--daemon");

const VISITED_LINKS_FILE_PATH = "data/visited_links.json"; // Define constant for clarity

/**
 * Reads existing reports, appends new reports, sorts them, and writes back to the file.
 * @param {Array<object>} newlyProcessedReports - Array of report objects processed in this run.
 * @param {string} filePath - Path to the visited_links.json file.
 */
async function updateVisitedLinksFile(newlyProcessedReports, filePath) {
  // Ensure the visited_links.json file exists before trying to read it
  await ensureJsonFileExists(filePath, []);

  let existingReports = [];
  try {
    // Attempt to read existing reports
    const data = await fs.readFile(filePath, "utf8");
    existingReports = JSON.parse(data);
    if (!Array.isArray(existingReports)) {
      // logWithTimestamp(`Warning: ${filePath} did not contain a valid JSON array. Starting fresh.`, 'warn');
      logger.warn(
        `${filePath} did not contain a valid JSON array. Starting fresh.`
      );
      existingReports = [];
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      // This shouldn't happen anymore since we ensure the file exists
      // logWithTimestamp(`${filePath} not found. Creating a new file.`);
      logger.info(`${filePath} not found. Creating a new file.`);
      // File doesn't exist, which is fine, we'll create it.
    } else {
      // Log other errors but proceed with an empty list
      // logError(`Error reading existing ${filePath}, will overwrite if new reports exist:`, error);
      logger.error(
        `Error reading existing ${filePath}, will overwrite if new reports exist: ${error.message}`,
        { stack: error.stack }
      );
    }
    existingReports = []; // Ensure it's an array
  }

  // Combine existing reports with the newly processed ones
  const combinedReports = [...existingReports, ...newlyProcessedReports];

  // Optional: Deduplicate based on URL (keeping the newest entry if duplicates exist)
  const reportMap = new Map();
  combinedReports.forEach((report) => {
    const existing = reportMap.get(report.url);
    // Keep the one with the later scrapedAt date, or the new one if dates are equal/missing
    if (
      !existing ||
      new Date(report.scrapedAt || 0) >= new Date(existing.scrapedAt || 0)
    ) {
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
    await fs.writeFile(
      filePath,
      JSON.stringify(uniqueReports, null, 2),
      "utf8"
    );
    if (newlyProcessedReports.length > 0) {
      // logWithTimestamp(`Successfully updated ${filePath} with ${newlyProcessedReports.length} new reports. Total reports: ${uniqueReports.length}.`);
      logger.info(
        `Successfully updated ${filePath} with ${newlyProcessedReports.length} new reports. Total reports: ${uniqueReports.length}.`
      );
    } else if (existingReports.length !== uniqueReports.length) {
      // logWithTimestamp(`Successfully updated ${filePath}. No new reports, but file content potentially changed (e.g., sorting/deduplication). Total reports: ${uniqueReports.length}.`);
      logger.info(
        `Successfully updated ${filePath}. No new reports, but file content potentially changed (e.g., sorting/deduplication). Total reports: ${uniqueReports.length}.`
      );
    } else {
      // logWithTimestamp(`No updates needed for ${filePath}.`);
      logger.info(`No updates needed for ${filePath}.`);
    }
  } catch (error) {
    // logError(`Error writing combined reports to ${filePath}:`, error);
    logger.error(
      `Error writing combined reports to ${filePath}: ${error.message}`,
      { stack: error.stack }
    );
  }
}

// Function to retry failed operations
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      // logWithTimestamp(`Attempt ${attempt} failed, retrying in ${delay/1000} seconds... Error: ${error.message}`, 'warn');
      logger.warn(
        `Attempt ${attempt} failed, retrying in ${
          delay / 1000
        } seconds... Error: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Main function to handle the complete flow
async function runFullFlow() {
  logger.info(`=== Starting Delphi full flow: ${new Date().toISOString()} ===`);

  if (slackInitialized) {
    await logMessage(
      "🔍 Starting Delphi Digital processing flow (using last visited link)...",
      [],
      false
    );
  }

  const browser = await launchBrowser();
  let latestProcessedUrl = null; // Track the URL of the newest report processed in this run

  try {
    const page = await setupPage(browser);

    // Step 1: Login to Delphi with retry
    logger.info("1. Login to Delphi Digital");
    logger.info("1.1 Attempting to log in...");
    const loginSuccess = await retryOperation(async () => {
      // Try to load cookies from file
      await fs.access("data/delphi_cookies.json"); // Use hardcoded path
      const cookiesString = await fs.readFile(
        "data/delphi_cookies.json",
        "utf8"
      ); // Use hardcoded path
      const cookies = JSON.parse(cookiesString);
      logger.info(`1.2 Loaded ${cookies.length} cookies from file`);
      logger.debug(
        `1.3 Cookie names: ${cookies.map((c) => c.name).join(", ")}`
      ); // Log cookie names at debug level
      await page.setCookie(...cookies);
      return await login(
        page,
        appConfig.DELPHI_EMAIL,
        appConfig.DELPHI_PASSWORD,
        "data/delphi_cookies.json"
      );
    });

    // Step 2: Read the last visited link
    logger.info("2. Reading last visited link");
    const lastVisitedUrl = await readLastVisitedLink();
    logger.info(
      `2.1 Last visited URL from file: ${lastVisitedUrl || "None (first run?)"}`
    );

    // Step 3: Check for new reports since the last visited one
    logger.info("3. Checking for new reports");
    const newReports = await retryOperation(async () => {
      return await checkForNewReports(
        page,
        appConfig.DELPHI_REPORTS_URL,
        lastVisitedUrl
      );
    });

    newReports.reverse();

    // Step 4: Process each new report
    if (newReports && newReports.length > 0) {
      logger.info(`4. Processing ${newReports.length} new reports`);
      const processedReportsThisRun = []; // Store successfully processed reports

      // Process reports (newest first assumed)
      latestProcessedUrl = newReports[0].url; // Store the newest URL to update last_visited_link

      for (const report of newReports) {
        logger.info(`4.1 Processing Report: ${report.title}`);
        let temporaryBody = ""; // Variable to hold the body temporarily
        let summary = "Error: Could not summarize."; // Default summary
        let processedReportData = { ...report }; // Copy initial data
        const now = new Date().toISOString(); // Define 'now' timestamp once per report

        try {
          const reportContent = await fetchReportContent(page, report.url);
          temporaryBody = reportContent;

          if (
            reportContent !== "Error fetching content." &&
            typeof reportContent === "string"
          ) {
            logger.info(
              `4.2 Fetched content successfully for ${report.url}. Length: ${reportContent.length}`
            );

            // Extract the published date from the page
            let publishedDate = null;
            try {
              // Navigate to the report URL again to ensure we have the right page
              await page.goto(report.url, {
                waitUntil: "networkidle0",
                timeout: 30000,
              });
              publishedDate = await extractPublishedDate(page);
              if (publishedDate) {
                logger.info(
                  `4.3 Extracted published date for ${report.title}: ${publishedDate}`
                );
              } else {
                logger.warn(
                  `4.3 Could not extract published date for ${report.title}`
                );
              }
            } catch (dateError) {
              logger.error(
                `4.3 Error extracting published date: ${dateError.message}`
              );
            }

            // Summarize using Gemini (using the fetched body content)
            if (geminiInitialized) {
              // Pass the fetched body content (temporaryBody) to Gemini
              summary = await getSummaryFromGemini(report.title, temporaryBody);
              if (!summary || summary.startsWith("Error:")) {
                // Handle Gemini error or empty summary
                summary =
                  summary || "Error: Failed to get summary from Gemini."; // Keep specific error if available
                logger.warn(
                  `4.4 Failed to get summary from Gemini for: ${report.title}`
                );
              } else {
                logger.info(
                  `4.4 Summary received from Gemini for: ${report.title}`
                );
              }
            } else {
              summary = "Error: Gemini not initialized.";
              logger.warn("4.4 Skipping Gemini summary: Not initialized.");
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
              publicationDate: publishedDate || report.publicationDate || now, // Use extracted date, or preserve original, or use 'now'
            };

            // Send to Slack if summary was successful
            if (slackInitialized && !summary.startsWith("Error:")) {
              try {
                logger.info(
                  `4.5 Sending summary for "${processedReportData.title}" to Slack...`
                );
                // Pass the version *without* the body to Slack formatting
                const blocks = formatReportForSlack(processedReportData);
                await sendSlackMessage(
                  `New Report Summary: ${processedReportData.title}`,
                  blocks
                );
                logger.info(
                  `4.5 Sent summary for "${processedReportData.title}" to Slack successfully.`
                );
              } catch (slackError) {
                logger.error(
                  `4.5 Failed to send report "${processedReportData.title}" to Slack: ${slackError.message}`,
                  { stack: slackError.stack }
                );
              }
            } else if (!summary.startsWith("Error:")) {
              logger.warn(
                `4.5 Skipping Slack notification for "${processedReportData.title}" as Slack is not initialized.`
              );
            } else {
              logger.warn(
                `4.5 Skipping Slack notification for "${processedReportData.title}" due to summary error.`
              );
            }
          } else {
            logger.warn(
              `4.2 Skipping summarization due to content fetch error for ${report.title}`
            );
            // Update report data with simple error state
            processedReportData = {
              url: report.url,
              title: report.title || "Untitled Report",
              body: "", // Keep body empty
              timestamp: report.timestamp || now,
              scrapedAt: now,
              lastChecked: now,
              summary: "Error: Could not fetch content.", // Simple error message
              publicationDate: report.publicationDate || now,
            };
          }

          processedReportsThisRun.push(processedReportData);
        } catch (error) {
          logger.error(
            `4.1 Error processing report ${report.url}: ${error.message}`,
            { stack: error.stack }
          );
          processedReportsThisRun.push({
            url: report.url,
            title: report.title || "Untitled Report",
            body: "",
            timestamp: report.timestamp || now,
            scrapedAt: now,
            lastChecked: now,
            summary: `Error during processing: ${error.message}`,
            publicationDate: report.publicationDate || now,
          });
        } finally {
          logger.info(`4.1 Finished Report: ${report.title}`);
        }
      }

      // Step 5: Update the main visited_links.json file
      logger.info("5. Updating visited links file");
      if (processedReportsThisRun.length > 0) {
        await updateVisitedLinksFile(
          processedReportsThisRun,
          VISITED_LINKS_FILE_PATH
        );
      } else {
        logger.info(
          "5.1 No new reports were successfully processed in this run, but updating file for consistency."
        );
        await updateVisitedLinksFile([], VISITED_LINKS_FILE_PATH);
      }

      // Step 6: Update the last visited link file
      logger.info("6. Updating last visited link");
      if (latestProcessedUrl) {
        await writeLastVisitedLink(latestProcessedUrl);
        logger.info(`6.1 Updated last visited link to: ${latestProcessedUrl}`);
      } else {
        logger.info(
          "6.1 No new report URL found to update last visited link.",
          "warn"
        );
      }

      // Step 7: Run the digest process
      logger.info("7. Running digest process");
      await runDigest();

      logger.info(
        `✅ Processing complete for this run. Processed ${processedReportsThisRun.length} reports.`
      );
      if (slackInitialized) {
        await logMessage(
          `✅ Successfully processed ${
            processedReportsThisRun.length
          } reports. Newest: ${latestProcessedUrl || "N/A"}`,
          [],
          false
        );
      }
    } else {
      logger.info("No new reports found since last visit.");
      await updateVisitedLinksFile([], VISITED_LINKS_FILE_PATH);
      if (slackInitialized) {
        await logMessage(
          "😴 No new reports found from Delphi Digital since last visit.",
          [],
          false
        );
      }
    }

    return true;
  } catch (error) {
    logger.error(
      `An unexpected error occurred in the main flow: ${error.message}`,
      { stack: error.stack }
    );
    if (slackInitialized) {
      await logMessage(
        `❌ An unexpected error occurred during the Delphi processing flow: ${error.message}`,
        [],
        true,
        "error"
      );
    }
    return false;
  } finally {
    if (browser) {
      await browser.close();
      logger.info("Browser closed.");
    }
    logger.info(
      `=== Delphi full flow finished: ${new Date().toISOString()} ===`
    );
  }
}

// Function to start daemon
async function startDaemon() {
  try {
    // Check if already running
    try {
      const pidData = await fs.readFile(PID_FILE, "utf8");
      const pid = parseInt(pidData.trim(), 10);

      // Check if process is still running
      process.kill(pid, 0);
      logger.info(`Delphi full flow is already running with PID ${pid}`);
      return false;
    } catch (err) {
      // Process not running or PID file doesn't exist, which is fine
    }

    // Start the daemon
    logger.info("Starting Delphi full flow daemon...");

    // Use node to run this script with the same arguments but without --daemon
    const args = process.argv.slice(2).filter((arg) => arg !== "--daemon");
    const child = spawn("node", [__filename, ...args], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });

    // Detach the child process
    child.unref();

    // Write PID file
    await fs.writeFile(PID_FILE, child.pid.toString());

    logger.info(`Delphi full flow daemon started with PID ${child.pid}`);
    logger.info(
      "The daemon will check for new reports every 24 hours by default."
    );
    logger.info("You can stop it using: npm run delphi:stop");

    return true;
  } catch (error) {
    logger.error("Error starting daemon:", error);
    return false;
  }
}

// Function to schedule regular checks
async function scheduledExecution() {
  // Run the initial flow
  await runFullFlow();

  // Get cron schedule from config or use default (daily at 9 AM)
  const cronSchedule = appConfig.CRON_SCHEDULE || "0 9 * * *";

  // Schedule regular checks using cron
  if (cron.validate(cronSchedule)) {
    cron.schedule(cronSchedule, async () => {
      await runFullFlow();
    });

    logger.info(`Delphi flow scheduled with cron pattern: ${cronSchedule}`);
  } else {
    logger.error(
      `Invalid cron pattern: ${cronSchedule}. Check your configuration.`
    );
    process.exit(1);
  }
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
  scheduledExecution,
};
