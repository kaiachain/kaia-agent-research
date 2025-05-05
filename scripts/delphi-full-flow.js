#!/usr/bin/env node
require("dotenv").config();

const logger = require("../utils/logger");
const fs = require("fs").promises;
const { launchBrowser, setupPage } = require("../browser/browser");
const { login } = require("../services/auth");
const {
  checkForNewReports,
  fetchReportContent
} = require("../services/reports");
const {
  initializeSlack,
  sendSlackMessage,
  formatReportForSlack,
} = require("../services/slack");
const { initializeGemini, getSummaryFromGemini } = require("../services/ai");
const { loadConfigFromEnv } = require("../config/config");
const {
  readLastVisitedLink,
  writeLastVisitedLink,
} = require("../utils/link-tracker");

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const geminiInitialized = initializeGemini(appConfig.GEMINI_API_KEY);
const slackInitialized = initializeSlack(
  appConfig.SLACK_TOKEN,
  appConfig.SLACK_CONFIG.channelId
);

// Function to retry failed operations
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      logger.warn(
        `[Retry:${attempt}/${maxRetries}] Retrying in ${delay/1000}s. Error: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Main function to handle the complete flow
async function main() {
  logger.info(`[Flow:1] Starting Delphi full flow at ${new Date().toISOString()}`);

  const browser = await launchBrowser();

  try {
    const page = await setupPage(browser);

    // Step 1: Login to Delphi with retry
    logger.info("[Auth:2] Initiating Delphi Digital login process");
    await retryOperation(async () => {
      await fs.access("data/delphi_cookies.json");
      const cookiesString = await fs.readFile("data/delphi_cookies.json", "utf8");
      const cookies = JSON.parse(cookiesString);
      logger.info(`[Auth:2.1] Loaded ${cookies.length} cookies from storage`);
      logger.debug(`[Auth:2.2] Cookie names: ${cookies.map((c) => c.name).join(", ")}`);
      await page.setCookie(...cookies);
      return await login(
        page,
        appConfig.DELPHI_EMAIL,
        appConfig.DELPHI_PASSWORD,
        "data/delphi_cookies.json"
      );
    });

    // Step 2: Read the last visited link
    logger.info("[Link:3] Reading last visited link from storage");
    const lastVisitedUrl = await readLastVisitedLink();
    logger.info(`[Link:3.1] Last visited URL: ${lastVisitedUrl || "None (first run)"}`);

    // Step 3: Check for new reports since the last visited one
    logger.info("[Reports:4] Checking for new reports");
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
      logger.info(`[Reports:5] Found ${newReports.length} new reports to process`);
      let processedReportsThisRun = 0;

      for (const report of newReports) {
        logger.info(`[Report:5.1] Processing: "${report.title}"`);
        let temporaryBody = "";
        let summary = "Error: Could not summarize.";
        let processedReportData = { ...report };

        try {
          const { reportContent, publicationDate } = await fetchReportContent(page, report.url);
          temporaryBody = reportContent;

          if (
            reportContent !== "Error fetching content." &&
            typeof reportContent === "string"
          ) {
            logger.info(
              `[Report:5.2] Content fetched successfully. Length: ${reportContent.length} characters`
            );

            if (geminiInitialized) {
              summary = await getSummaryFromGemini(report.title, temporaryBody);
              if (!summary || summary.startsWith("Error:")) {
                summary = summary || "Error: Failed to get summary from Gemini.";
                logger.warn(`[AI:5.3] Summary generation failed for: "${report.title}"`);
              } else {
                logger.info(`[AI:5.3] Summary generated successfully for: "${report.title}"`);
              }
            } else {
              summary = "Error: Gemini not initialized.";
              logger.warn("[AI:5.3] Summary generation skipped: Gemini not initialized");
            }

            if (slackInitialized && !summary.startsWith("Error:")) {
              processedReportData.publicationDate = publicationDate;
              processedReportData.summary = summary;
              try {
                logger.info(`[Slack:5.4] Sending summary for: "${processedReportData.title}"`);
                const blocks = formatReportForSlack(processedReportData);
                await sendSlackMessage(
                  `New Report Summary: ${processedReportData.title}`,
                  blocks
                );
                logger.info(`[Slack:5.4] Summary sent successfully for: "${processedReportData.title}"`);

                logger.info("[Link:5.5] Updating last visited link");
                await writeLastVisitedLink(report.url);
                logger.info(`[Link:5.5] Updated last visited link to: ${report.url}`);
                processedReportsThisRun++;
              } catch (slackError) {
                logger.error(
                  `[Slack:5.4] Failed to send report "${processedReportData.title}": ${slackError.message}`,
                  { stack: slackError.stack }
                );
              }
            } else if (!summary.startsWith("Error:")) {
              logger.warn(`[Slack:5.4] Notification skipped: Slack not initialized for "${processedReportData.title}"`);
            } else {
              logger.warn(`[Slack:5.4] Notification skipped: Summary error for "${processedReportData.title}"`);
            }
          } else {
            logger.warn(`[Report:5.2] Content fetch failed for: "${report.title}"`);
          }
        } catch (error) {
          logger.error(
            `[Report:5.1] Processing error for "${report.url}": ${error.message}`,
            { stack: error.stack }
          );
        } finally {
          logger.info(`[Report:5.1] Completed processing: "${report.title}"`);
        }
      }

      logger.info(
        `[Flow:6] Processing complete. Successfully processed ${processedReportsThisRun} reports`
      );
    } else {
      logger.info("[Reports:5] No new reports found since last visit");
    }

    return true;
  } catch (error) {
    logger.error(
      `[Flow:7] Unexpected error: ${error.message}`,
      { stack: error.stack }
    );
    return false;
  } finally {
    if (browser) {
      await browser.close();
      logger.info("[Browser:8] Session closed");
    }
    logger.info(`[Flow:9] Delphi full flow completed at ${new Date().toISOString()}`);
  }
}

// Run the main function
if (require.main === module) {
  main();
}