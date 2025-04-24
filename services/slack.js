const { WebClient } = require('@slack/web-api');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config').loadConfigFromEnv(); // Import config
const logger = require('../scripts/logger'); // Import the shared logger

// Initialize Slack client when module is loaded
let slack = null;
let slackChannel = null;
let messageHistoryPath = null; // Rename for clarity

// Initialize Slack client
function initializeSlack(token, channelId, historyFilePath = null) {
  if (!token || !channelId) {
    // logWithTimestamp('Slack credentials not configured');
    logger.warn('Slack credentials not configured. Slack notifications disabled.');
    return false;
  }

  slack = new WebClient(token);
  slackChannel = channelId;

  // Set message history file path (use config default if none provided)
  messageHistoryPath = historyFilePath || config.SLACK_CONFIG.historyFile; // Use configured path
  // logger.info(`Slack initialized. Channel: ${channelId}. History file: ${messageHistoryPath}`);
  logger.info(`Slack initialized. Channel: ${channelId}.`); // History file path not critical for init message

  return true;
}

// Helper function to load message history
async function loadMessageHistory() {
  if (!messageHistoryPath) {
    // Return empty array instead of error when history not needed
    return [];
  }
  try {
    const data = await fs.readFile(messageHistoryPath, 'utf8');
    // Handle empty file case explicitly
    if (!data) {
        // logWithTimestamp('Message history file is empty. Starting fresh.', 'warn');
        logger.warn(`Message history file (${messageHistoryPath}) is empty. Starting fresh.`);
        return [];
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // logWithTimestamp('Message history file not found. Creating it.', 'info');
      logger.info(`Message history file (${messageHistoryPath}) not found. Creating it.`);
      // Ensure directory exists before writing
      try {
          const dir = path.dirname(messageHistoryPath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(messageHistoryPath, JSON.stringify([], null, 2)); // Create with empty array
          return [];
      } catch (createError) {
          logger.error(`Failed to create message history directory or file at ${messageHistoryPath}: ${createError.message}`, { stack: createError.stack });
          return []; // Return empty if creation fails
      }
    }
    // Handle JSON parsing errors specifically
    if (error instanceof SyntaxError) {
         // logWithTimestamp(`Error parsing JSON in message history file: ${error.message}. Treating as empty.`, 'error');
         logger.error(`Error parsing JSON in message history file (${messageHistoryPath}): ${error.message}. Treating as empty.`);
         return [];
    }
    // Log other unexpected errors
    // logWithTimestamp('Error loading message history: ' + error.message, 'error');
    logger.error(`Error loading message history from ${messageHistoryPath}: ${error.message}`, { stack: error.stack });
    return []; // Return empty array on other errors too
  }
}

// Helper function to save message history
async function saveMessageHistory(history) {
   if (!messageHistoryPath) {
    // Return success instead of error when history not needed
    return true;
  }
  try {
    // Ensure directory exists
    const dir = path.dirname(messageHistoryPath);
    await fs.mkdir(dir, { recursive: true });

    // Save history
    await fs.writeFile(messageHistoryPath, JSON.stringify(history, null, 2));
    return true;
  } catch (error) {
    // logWithTimestamp('Error saving message history: ' + error.message, 'error');
    logger.error(`Error saving message history to ${messageHistoryPath}: ${error.message}`, { stack: error.stack });
    return false;
  }
}

/**
 * Log a message using the configured logger and optionally send to Slack
 * @param {string} message - The message to log
 * @param {Array} blocks - Slack blocks for formatting (if sending to Slack)
 * @param {boolean} sendToSlack - Whether to send this message to Slack
 * @param {string} level - Log level (info, warn, error, debug)
 */
async function logMessage(message, blocks = [], sendToSlack = false, level = 'info') {
  // Log using the logger
  switch(level.toLowerCase()) {
    case 'error':
      logger.error(message);
      break;
    case 'warn':
      logger.warn(message);
      break;
    case 'debug':
       logger.debug(message);
       break;
    case 'info':
    default:
      logger.info(message);
  }

  // Only send to Slack if explicitly requested and Slack is initialized
  if (sendToSlack && slack && slackChannel) {
    // Don't return the result of sendSlackMessage directly
    // Let the function complete its logging independently
    await sendSlackMessage(message, blocks);
  }
  // We don't need to return true/false based on slack sending here
  // The primary purpose is logging, Slack is secondary.
}

// Function to send message to Slack
async function sendSlackMessage(message, blocks = []) {
  try {
    if (!slack || !slackChannel) {
      // logWithTimestamp('Slack not initialized, skipping notification');
      logger.warn('Slack not initialized, skipping notification');
      return null; // Return null or similar to indicate not sent
    }

    const result = await slack.chat.postMessage({
      channel: slackChannel,
      text: message, // Fallback text
      blocks: blocks.length > 0 ? blocks : undefined // Use blocks if available
    });

    // logWithTimestamp(`Message sent to Slack: ${result.ts}`);
    logger.info(`Message sent to Slack: ${result.ts}`);

    // Store message in history
    const messageRecord = {
      timestamp: new Date().toISOString(),
      messageId: result.ts,
      channel: slackChannel,
      text: message,
      blocks: blocks.length > 0 ? blocks : undefined
    };

    // Add to history
    const history = await loadMessageHistory();
    history.push(messageRecord);
    await saveMessageHistory(history);

    return result.ts; // Return the timestamp of the sent message
  } catch (error) {
    // logWithTimestamp('Error sending message to Slack: ' + error.message, 'error');
    logger.error(`Error sending message to Slack: ${error.message}`, { slackError: error?.data, stack: error.stack });
    return null; // Return null on error
  }
}

// Function to get message history
async function getMessageHistory(limit = 100) {
  try {
    const history = await loadMessageHistory();
    return history.slice(-limit); // Return the most recent messages up to the limit
  } catch (error) {
    // logWithTimestamp('Error getting message history: ' + error.message, 'error');
    logger.error(`Error getting message history: ${error.message}`, { stack: error.stack });
    return [];
  }
}

// Function to get recently sent messages about a specific report URL
async function getMessagesForReport(reportUrl, limit = 10) {
  try {
    const history = await loadMessageHistory();

    // Filter messages containing the report URL
    const reportMessages = history.filter(msg => {
      // Check in text
      if (msg.text && msg.text.includes(reportUrl)) {
        return true;
      }

      // Check in blocks
      if (msg.blocks && Array.isArray(msg.blocks)) {
        return msg.blocks.some(block => {
          if (block.type === 'section' && block.text && block.text.text) {
            return block.text.text.includes(reportUrl);
          }
          if (block.fields && Array.isArray(block.fields)) {
            return block.fields.some(field => field.text && field.text.includes(reportUrl));
          }
          // Add check for context block elements
          if (block.type === 'context' && block.elements && Array.isArray(block.elements)) {
             return block.elements.some(el => el.type === 'mrkdwn' && el.text && el.text.includes(reportUrl));
          }
          return false;
        });
      }

      return false;
    });

    return reportMessages.slice(-limit); // Return the most recent messages up to the limit
  } catch (error) {
    // logWithTimestamp('Error getting messages for report: ' + error.message, 'error');
    logger.error(`Error getting messages for report ${reportUrl}: ${error.message}`, { stack: error.stack });
    return [];
  }
}

// Function to retrieve a specific message from Slack
async function getSlackMessage(ts) {
  try {
    if (!slack || !slackChannel) {
      // logWithTimestamp('Slack not initialized, cannot retrieve message', 'warn');
      logger.warn('Slack not initialized, cannot retrieve message');
      return null;
    }

    const result = await slack.conversations.history({
      channel: slackChannel,
      latest: ts,
      inclusive: true,
      limit: 1
    });

    if (result.messages && result.messages.length > 0) {
      return result.messages[0];
    }

    return null;
  } catch (error) {
    // logWithTimestamp('Error retrieving message from Slack: ' + error.message, 'error');
    logger.error(`Error retrieving message ${ts} from Slack: ${error.message}`, { slackError: error?.data, stack: error.stack });
    return null;
  }
}

// Function to format a report for Slack
function formatReportForSlack(report) {
  // Split the summary into main summary and Kaia relevance
  let mainSummary = report.summary || "Summary not available.";
  let kaiaRelevance = '';

  // Assume Kaia relevance might start with "**Kaia Relevance:**" or similar, split by newline
  const summaryLines = mainSummary.split('\n');
  const kaiaIndex = summaryLines.findIndex(line => line.toLowerCase().includes('kaia relevance'));

  if (kaiaIndex !== -1) {
      mainSummary = summaryLines.slice(0, kaiaIndex).join('\n').trim();
      kaiaRelevance = summaryLines.slice(kaiaIndex).join('\n').trim();
  }

  // const publishDate = report.publicationDate ? new Date(report.publicationDate).toLocaleDateString() : 'N/A';
  // Use a more reliable date formatting
  let publishDateStr = 'N/A';
  try {
    if (report.publicationDate) {
       publishDateStr = new Date(report.publicationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
  } catch (e) {
    logger.warn(`Could not parse publicationDate: ${report.publicationDate}`);
  }

  const blocks = [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": report.title || "Untitled Report",
         "emoji": true
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": `*Published:* ${publishDateStr} | <${report.url}|View Report>`
        }
      ]
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Summary:*\n${mainSummary}`
      }
    },
  ];

  if (kaiaRelevance) {
    blocks.push({
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Relevance:*\n${kaiaRelevance}`
      }
    });
  }

  // Add timestamp if available
  if (report.timestamp) {
      blocks.push({
          "type": "context",
          "elements": [
              {
                  "type": "mrkdwn",
                  "text": `_Scraped: ${new Date(report.scrapedAt || report.timestamp).toLocaleString()}_`
              }
          ]
      });
  }

  return blocks;
}

// Export functions
module.exports = {
  initializeSlack,
  sendSlackMessage,
  logMessage,
  getMessageHistory,
  getMessagesForReport,
  getSlackMessage,
  formatReportForSlack,
  // logWithTimestamp, // Removed
  // logError // Removed
}; 