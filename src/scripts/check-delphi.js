require('dotenv').config();
const { spawn } = require('child_process');
const { config, loadConfigFromEnv } = require('../config/config');
const { launchBrowser, setupPage } = require('../browser/browser');
const { login } = require('../services/auth');
const { checkForNewReports, findNewReports, updateVisitedLinks } = require('../services/reports');
const { initializeSlack, sendSlackMessage } = require('../services/slack');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize Slack
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);
if (slackInitialized) {
  console.log('Slack integration initialized successfully');
} else {
  console.log('Warning: Slack integration not initialized. Check your SLACK_TOKEN and SLACK_CHANNEL_ID.');
}

// Function to run the summarize.js script
async function runSummarizeScript(count = 5) {
  return new Promise((resolve, reject) => {
    console.log(`Running summarize.js to process newest ${count} reports...`);
    
    const child = spawn('node', ['src/scripts/summarize.js', '--force-latest', count.toString()], {
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('Successfully processed reports');
        resolve(true);
      } else {
        console.error(`summarize.js process exited with code ${code}`);
        resolve(false); // Resolve with false rather than rejecting to avoid crashing
      }
    });
    
    child.on('error', (err) => {
      console.error('Failed to run summarize.js:', err);
      resolve(false);
    });
  });
}

// Main function to check Delphi website
async function checkDelphiWebsite() {
  console.log(`=== Delphi Check: ${new Date().toISOString()} ===`);
  
  // Send Slack notification about check starting
  if (slackInitialized) {
    await sendSlackMessage('🔍 Starting Delphi Digital check for new reports...');
  }
  
  const browser = await launchBrowser();
  
  try {
    const page = await setupPage(browser);
    
    // Login
    console.log('Attempting to log in...');
    const loginSuccess = await login(
      page, 
      process.env.DELPHI_EMAIL, 
      process.env.DELPHI_PASSWORD, 
      appConfig.COOKIES_FILE
    );
    
    if (!loginSuccess) {
      console.log('Failed to log in. Aborting check.');
      if (slackInitialized) {
        await sendSlackMessage('❌ Failed to log in to Delphi Digital. Check credentials.');
      }
      return false;
    }
    
    // Check for new reports
    const links = await checkForNewReports(page, appConfig.DELPHI_URL);
    
    if (links.length === 0) {
      console.log('Failed to get links from Delphi. Aborting check.');
      if (slackInitialized) {
        await sendSlackMessage('❌ Failed to retrieve links from Delphi Digital.');
      }
      return false;
    }
    
    // Find new reports
    const { newLinks, visitedLinks } = await findNewReports(links, appConfig.VISITED_LINKS_FILE);
    
    if (newLinks.length > 0) {
      // Send notification about new reports
      if (slackInitialized) {
        const reportList = newLinks.map(link => `• ${link.title || 'Untitled'}: ${link.url}`).join('\n');
        await sendSlackMessage(`🎉 Found ${newLinks.length} new reports!\n${reportList}\n\nProcessing and generating summaries...`);
      }
      
      // Update visited links with new ones
      await updateVisitedLinks(newLinks, visitedLinks, appConfig.VISITED_LINKS_FILE);
      
      // Run the summarize.js script to process new reports
      await runSummarizeScript(Math.min(newLinks.length, 5));
      
      // Send notification that processing is complete
      if (slackInitialized) {
        await sendSlackMessage(`✅ Processing completed for ${Math.min(newLinks.length, 5)} reports.`);
      }
    } else {
      console.log('No new reports to process. Will check again later.');
      if (slackInitialized) {
        await sendSlackMessage('😴 No new reports found from Delphi Digital.');
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error in checkDelphiWebsite:', error);
    if (slackInitialized) {
      await sendSlackMessage(`❌ Error checking Delphi Digital: ${error.message}`);
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
    console.log(`Initial Delphi check ${success ? 'completed' : 'failed'}`);
    
    // Schedule regular checks
    setInterval(() => {
      checkDelphiWebsite().then(success => {
        console.log(`Scheduled Delphi check ${success ? 'completed' : 'failed'}`);
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
console.log(`Delphi checker started. Next check in ${appConfig.CHECK_INTERVAL / (60 * 60 * 1000)} hours`); 