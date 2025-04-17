const { WebClient } = require('@slack/web-api');
const fs = require('fs').promises;
const path = require('path');

// Initialize Slack client when module is loaded
let slack = null;
let slackChannel = null;
let messageHistoryFile = null;

// Utility function to log with timestamp
function logWithTimestamp(message, level = 'info') {
  const timestamp = new Date().toISOString();
  switch(level) {
    case 'error':
      console.error(`[${timestamp}] ERROR: ${message}`);
      break;
    case 'warn':
      console.warn(`[${timestamp}] WARN: ${message}`);
      break;
    default:
      console.log(`[${timestamp}] INFO: ${message}`);
  }
}

// Initialize Slack client
function initializeSlack(token, channelId, historyFilePath = null) {
  if (!token || !channelId) {
    logWithTimestamp('Slack credentials not configured');
    return false;
  }
  
  slack = new WebClient(token);
  slackChannel = channelId;
  
  // Set default message history file if not provided
  messageHistoryFile = historyFilePath || path.join(process.cwd(), 'src/data/slack_message_history.json');
  
  return true;
}

// Helper function to load message history
async function loadMessageHistory() {
  try {
    const data = await fs.readFile(messageHistoryFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // If file doesn't exist, create it with empty array
      await fs.writeFile(messageHistoryFile, JSON.stringify([], null, 2));
      return [];
    }
    logWithTimestamp('Error loading message history: ' + error.message, 'error');
    return [];
  }
}

// Helper function to save message history
async function saveMessageHistory(history) {
  try {
    // Ensure directory exists
    const dir = path.dirname(messageHistoryFile);
    await fs.mkdir(dir, { recursive: true });
    
    // Save history
    await fs.writeFile(messageHistoryFile, JSON.stringify(history, null, 2));
    return true;
  } catch (error) {
    logWithTimestamp('Error saving message history: ' + error.message, 'error');
    return false;
  }
}

/**
 * Log a message to the console with timestamp and optionally send to Slack
 * @param {string} message - The message to log
 * @param {Array} blocks - Slack blocks for formatting (if sending to Slack)
 * @param {boolean} sendToSlack - Whether to send this message to Slack
 * @param {string} level - Log level (info, warn, error)
 */
async function logMessage(message, blocks = [], sendToSlack = false, level = 'info') {
  // Always log to console
  logWithTimestamp(message, level);
  
  // Only send to Slack if explicitly requested
  if (sendToSlack) {
    return await sendSlackMessage(message, blocks);
  }
  
  return true;
}

// Function to send message to Slack
async function sendSlackMessage(message, blocks = []) {
  try {
    if (!slack || !slackChannel) {
      logWithTimestamp('Slack not initialized, skipping notification');
      return false;
    }

    const result = await slack.chat.postMessage({
      channel: slackChannel,
      text: message,
      blocks: blocks.length > 0 ? blocks : undefined
    });

    logWithTimestamp(`Message sent to Slack: ${result.ts}`);
    
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
    
    return true;
  } catch (error) {
    logWithTimestamp('Error sending message to Slack: ' + error.message, 'error');
    return false;
  }
}

// Function to get message history
async function getMessageHistory(limit = 100) {
  try {
    const history = await loadMessageHistory();
    return history.slice(-limit); // Return the most recent messages up to the limit
  } catch (error) {
    logWithTimestamp('Error getting message history: ' + error.message, 'error');
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
          return false;
        });
      }
      
      return false;
    });
    
    return reportMessages.slice(-limit); // Return the most recent messages up to the limit
  } catch (error) {
    logWithTimestamp('Error getting messages for report: ' + error.message, 'error');
    return [];
  }
}

// Function to retrieve a specific message from Slack
async function getSlackMessage(ts) {
  try {
    if (!slack || !slackChannel) {
      logWithTimestamp('Slack not initialized, cannot retrieve message', 'warn');
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
    logWithTimestamp('Error retrieving message from Slack: ' + error.message, 'error');
    return null;
  }
}

// Function to format a report for Slack
function formatReportForSlack(report) {
  // Split the summary into main summary and Kaia relevance
  let mainSummary = report.summary;
  let kaiaRelevance = '';
  
  // Check if there are distinct parts in the summary
  const summaryParts = report.summary.split('\n\n');
  if (summaryParts.length >= 2) {
    mainSummary = summaryParts[0];
    // The second part should be the Kaia relevance
    kaiaRelevance = summaryParts[1];
  }
  
  const publishDate = new Date(report.publicationDate).toLocaleDateString();
  
  return [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": report.title
      }
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
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Relevance to Kaia:*\n${kaiaRelevance}`
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": `*Published:*\n${publishDate}`
        },
        {
          "type": "mrkdwn",
          "text": `*Source:*\n<${report.url}|View Original Report>`
        }
      ]
    }
  ];
}

/**
 * Log error messages to console with timestamps but never send to Slack
 * @param {string} errorMessage - The error message to log
 * @param {Error} [error] - Optional error object for stack trace
 */
function logError(errorMessage, error = null) {
  // Always log to console with timestamp, never to Slack
  logWithTimestamp(errorMessage, 'error');
  
  // If error object provided, log stack trace for debugging
  if (error && error.stack) {
    logWithTimestamp(`Stack trace: ${error.stack}`, 'error');
  }
}

module.exports = {
  initializeSlack,
  sendSlackMessage,
  logMessage,
  logWithTimestamp,
  logError,
  formatReportForSlack,
  getMessageHistory,
  getMessagesForReport,
  getSlackMessage
}; 