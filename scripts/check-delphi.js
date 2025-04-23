require('dotenv').config();
const { spawn } = require('child_process');
const { config, loadConfigFromEnv } = require('../config/config');
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports, findNewReports, updateVisitedLinks } = require('../services/reports');
const { initializeSlack, sendSlackMessage, logMessage, logWithTimestamp } = require('../services/slack');
const fs = require('fs').promises;

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);
if (slackInitialized) {
  logWithTimestamp('Slack integration initialized successfully');
} else {
  logWithTimestamp('Warning: Slack integration not initialized. Check your SLACK_TOKEN and SLACK_CHANNEL_ID.', 'warn');
}

// Function to run the summarize.js script
async function runSummarizeScript(count = 5) {
  return new Promise((resolve, reject) => {
    logWithTimestamp(`Running summarize.js to process newest ${count} reports...`);
    
    const child = spawn('node', ['scripts/summarize.js', '--force-latest', count.toString()], {
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        logWithTimestamp('Successfully processed reports');
        resolve(true);
      } else {
        logWithTimestamp(`summarize.js process exited with code ${code}`, 'error');
        resolve(false); // Resolve with false rather than rejecting to avoid crashing
      }
    });
    
    child.on('error', (err) => {
      logWithTimestamp(`Failed to run summarize.js: ${err.message}`, 'error');
      resolve(false);
    });
  });
}

// Main function to check Delphi website
async function checkDelphiWebsite() {
  logWithTimestamp(`=== Delphi Check: ${new Date().toISOString()} ===`);
  
  // Send Slack notification about check starting (status message)
  if (slackInitialized) {
    await logMessage('🔍 Starting Delphi Digital check for new reports...', [], false);
  }
  
  const browser = await launchBrowser();
  
  try {
    const page = await setupPage(browser);
    
    // Login
    logWithTimestamp('Attempting to log in...');
    const loginSuccess = await login(
      page, 
      process.env.DELPHI_EMAIL, 
      process.env.DELPHI_PASSWORD, 
      'data/delphi_cookies.json'
    );
    
    if (!loginSuccess) {
      logWithTimestamp('Failed to log in. Aborting check.', 'error');
      if (slackInitialized) {
        await logMessage('❌ Failed to log in to Delphi Digital. Check credentials.', [], true, 'error');
      }
      return false;
    }
    
    // Check for new reports
    const links = await checkForNewReports(page, appConfig.DELPHI_URL);
    
    if (links.length === 0) {
      logWithTimestamp('Failed to get links from Delphi. Aborting check.', 'error');
      if (slackInitialized) {
        await logMessage('❌ Failed to retrieve links from Delphi Digital.', [], true, 'error');
      }
      return false;
    }
    
    // Find new reports
    const { newLinks, visitedLinks } = await findNewReports(links, 'data/visited_links.json');
    
    if (newLinks.length > 0) {
      // Send notification about new reports (this is a summary, so send to Slack)
      if (slackInitialized) {
        const reportList = newLinks.map(link => `• ${link.title || 'Untitled'}: ${link.url}`).join('\n');
        await logMessage(`🎉 Found ${newLinks.length} new reports!\n${reportList}\n\nProcessing and generating summaries...`, [], true);
      }
      
      // Update visited links with new ones
      await updateVisitedLinks(newLinks, visitedLinks, 'data/visited_links.json');
      
      // Run the summarize.js script to process new reports
      await runSummarizeScript(Math.min(newLinks.length, 5));
      
      // Send notification that processing is complete (summary notification)
      if (slackInitialized) {
        await logMessage(`✅ Processing completed for ${Math.min(newLinks.length, 5)} reports.`, [], true);
      }
    } else {
      logWithTimestamp('No new reports to process. Will check again later.');
      if (slackInitialized) {
        await logMessage('😴 No new reports found from Delphi Digital.', [], false);
      }
    }
    
    return true;
  } catch (error) {
    logWithTimestamp(`Error in checkDelphiWebsite: ${error.message}`, 'error');
    if (slackInitialized) {
      // Don't send errors to Slack, only log them to console
      // await logMessage(`❌ Error checking Delphi Digital: ${error.message}`, [], true, 'error');
    }
    return false;
  } finally {
    await browser.close();
  }
}

// Function to schedule regular checks
function scheduleChecks() {
  // Run the initial check
  checkDelphiWebsite().then(success => {
    logWithTimestamp(`Initial Delphi check ${success ? 'completed' : 'failed'}`);
    
    // Schedule regular checks
    setInterval(() => {
      checkDelphiWebsite().then(success => {
        logWithTimestamp(`Scheduled Delphi check ${success ? 'completed' : 'failed'}`);
      });
    }, appConfig.CHECK_INTERVAL);
  });
}

// Handle script execution
if (require.main === module) {
  // If this file is run directly, start the scheduler
  scheduleChecks();
} else {
  // If this file is imported, export the functions
  module.exports = {
    checkDelphiWebsite,
    scheduleChecks,
    CHECK_INTERVAL: appConfig.CHECK_INTERVAL
  };
}

// Log the next scheduled check
logWithTimestamp(`Delphi checker started. Next check in ${appConfig.CHECK_INTERVAL / (60 * 60 * 1000)} hours`); 