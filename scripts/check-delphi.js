require('dotenv').config();
const { spawn } = require('child_process');
const cron = require('node-cron');
const { config, loadConfigFromEnv } = require('../config/config');
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports, extractPublishedDate } = require('../services/reports');
const { initializeSlack, sendSlackMessage, logMessage } = require('../services/slack');
const fs = require('fs').promises;
const logger = require('./logger'); // Import logger
const { ensureJsonFileExists } = require('../utils/file-utils');
const { readLastVisitedLink, writeLastVisitedLink } = require('../utils/link-tracker');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);
if (slackInitialized) {
  logger.info('Slack integration initialized successfully');
} else {
  logger.warn('Warning: Slack integration not initialized. Check your SLACK_TOKEN and SLACK_CHANNEL_ID.');
}

// Function to run the summarize.js script
async function runSummarizeScript(count = 5) {
  return new Promise((resolve, reject) => {
    logger.info(`Running summarize.js to process newest ${count} reports...`);
    
    const child = spawn('node', ['scripts/summarize.js', '--force-latest', count.toString()], {
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        logger.info('Successfully processed reports');
        resolve(true);
      } else {
        logger.error(`summarize.js process exited with code ${code}`);
        resolve(false); // Resolve with false rather than rejecting to avoid crashing
      }
    });
    
    child.on('error', (err) => {
      logger.error(`Failed to run summarize.js: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * Function to scrape a date from a URL and send it to Slack
 * @param {string} url - URL to scrape for a date
 * @returns {Promise<boolean>} - Success status
 */
async function scrapeAndSendDateToSlack(url) {
  logger.info(`Scraping published date from ${url}`);
  
  if (!slackInitialized) {
    logger.error('Slack is not initialized. Cannot send message. Check SLACK_TOKEN and SLACK_CHANNEL_ID environment variables.');
    return false;
  }
  
  const browser = await launchBrowser();
  
  try {
    const page = await setupPage(browser);
    
    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    // Extract the published date
    const publishedDate = await extractPublishedDate(page);
    
    if (!publishedDate) {
      logger.error(`Could not extract published date from ${url}`);
      await sendSlackMessage(`Failed to extract published date from ${url}`);
      return false;
    }
    
    // Format the date if needed
    let formattedDate;
    try {
      const dateObj = new Date(publishedDate);
      if (!isNaN(dateObj)) {
        formattedDate = dateObj.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      } else {
        formattedDate = publishedDate; // Use raw string if parsing fails
      }
    } catch (error) {
      logger.warn(`Could not parse date: ${publishedDate}. Using raw value.`);
      formattedDate = publishedDate;
    }
    
    // Create Slack message blocks
    const messageBlocks = [
      {
        "type": "header",
        "text": {
          "type": "plain_text",
          "text": "📅 Published Date Extracted",
          "emoji": true
        }
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*URL:* ${url}`
        }
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*Published Date:* ${formattedDate}`
        }
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*Raw Date Value:* \`${publishedDate}\``
        }
      }
    ];
    
    // Send to Slack
    logger.info(`Sending published date to Slack: ${formattedDate}`);
    await sendSlackMessage(`Published date for ${url}: ${formattedDate}`, messageBlocks);
    logger.info('Slack message sent successfully');
    
    return true;
  } catch (error) {
    logger.error(`Error scraping date: ${error.message}`);
    if (slackInitialized) {
      await sendSlackMessage(`Error scraping date from ${url}: ${error.message}`);
    }
    return false;
  } finally {
    await browser.close();
  }
}

// Main function to check Delphi website
async function checkDelphiWebsite() {
  logger.info(`=== Delphi Check: ${new Date().toISOString()} ===`);
  
  // Ensure visited_links.json exists
  const visitedLinksPath = 'data/visited_links.json';
  await ensureJsonFileExists(visitedLinksPath, []);
  
  // Send Slack notification about check starting (status message)
  if (slackInitialized) {
    await logMessage('🔍 Starting Delphi Digital check for new reports...', [], false);
  }
  
  const browser = await launchBrowser();
  
  try {
    const page = await setupPage(browser);
    
    // Login
    logger.info('Attempting to log in...');
    const loginSuccess = await login(
      page, 
      process.env.DELPHI_EMAIL, 
      process.env.DELPHI_PASSWORD, 
      'data/delphi_cookies.json'
    );
    
    // if (!loginSuccess) {
    //   logger.error('Failed to log in. Aborting check.');
    //   if (slackInitialized) {
    //     await logMessage('❌ Failed to log in to Delphi Digital. Check credentials.', [], true, 'error');
    //   }
    //   return false;
    // }
    
    // Get the last visited link
    const lastVisitedUrl = await readLastVisitedLink();
    logger.info(`Last visited URL from file: ${lastVisitedUrl || 'None (first run?)'}`);
    
    // Check for new reports using the last visited link
    const newLinks = await checkForNewReports(page, appConfig.DELPHI_URL, lastVisitedUrl);
    
    if (newLinks.length === 0) {
      logger.info('No new reports to process. Will check again later.');
      if (slackInitialized) {
        await logMessage('😴 No new reports found from Delphi Digital.', [], false);
      }
      return true;
    }
    
    // If we have new links, update the last visited link with the newest one
    if (newLinks.length > 0) {
      // The first link is the newest one
      const newestLink = newLinks[0].url;
      await writeLastVisitedLink(newestLink);
      logger.info(`Updated last visited link to: ${newestLink}`);
      
      // Send notification about new reports (this is a summary, so send to Slack)
      if (slackInitialized) {
        const reportList = newLinks.map(link => `• ${link.title || 'Untitled'}: ${link.url}`).join('\n');
        await logMessage(`🎉 Found ${newLinks.length} new reports!\n${reportList}\n\nProcessing and generating summaries...`, [], true);
      }
      
      // Run the summarize.js script to process new reports
      await runSummarizeScript(Math.min(newLinks.length, 5));
      
      // Send notification that processing is complete (summary notification)
      if (slackInitialized) {
        await logMessage(`✅ Processing completed for ${Math.min(newLinks.length, 5)} reports.`, [], true);
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in checkDelphiWebsite: ${error.message}`);
    if (slackInitialized) {
      // Don't send errors to Slack, only log them to console
      // await logMessage(`❌ Error checking Delphi Digital: ${error.message}`, [], true, 'error');
    }
    return false;
  } finally {
    await browser.close();
  }
}

// Function to schedule regular checks using cron
function scheduleChecks() {
  // Run the initial check
  checkDelphiWebsite().then(success => {
    logger.info(`Initial Delphi check ${success ? 'completed' : 'failed'}`);
    
    // Get cron schedule from config or use default (daily at midnight)
    const cronSchedule = appConfig.CRON_SCHEDULE || '0 0 * * *';
    
    // Schedule regular checks using cron
    if (cron.validate(cronSchedule)) {
      cron.schedule(cronSchedule, async () => {
        const success = await checkDelphiWebsite();
        logger.info(`Scheduled Delphi check ${success ? 'completed' : 'failed'}`);
      });
      
      logger.info(`Delphi checker scheduled with cron pattern: ${cronSchedule}`);
    } else {
      logger.error(`Invalid cron pattern: ${cronSchedule}. Check your configuration.`);
      process.exit(1);
    }
  });
}

// Handle script execution
if (require.main === module) {
  // Check if a URL is provided as an argument to scrape a date
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0].startsWith('http')) {
    // Run as a date scraper
    const url = args[0];
    scrapeAndSendDateToSlack(url)
      .then((success) => {
        logger.info('Date scraping completed');
        process.exit(success ? 0 : 1);
      })
      .catch(error => {
        logger.error(`Date scraping failed: ${error.message}`);
        process.exit(1);
      });
  } else {
    // If this file is run directly with no URL args, start the scheduler
    scheduleChecks();
    
    // Log the next scheduled check
    logger.info(`Delphi checker started. Will run according to cron schedule: ${appConfig.CRON_SCHEDULE}`);
  }
} else {
  // If this file is imported, export the functions
  module.exports = {
    checkDelphiWebsite,
    scheduleChecks,
    scrapeAndSendDateToSlack
  };
}