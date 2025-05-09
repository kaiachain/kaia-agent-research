const { WebClient } = require("@slack/web-api");
const fs = require("fs").promises;
const path = require("path");
const config = require("../config/config").loadConfigFromEnv(); // Import config
const logger = require("../utils/logger"); // Import the shared logger

// Initialize Slack client when module is loaded
let slack = null;
let slackChannel = null;
let messageHistoryPath = null; // Rename for clarity

// Initialize Slack client
function initializeSlack(token, channelId, historyFilePath = null) {
  if (!token || !channelId) {
    // logWithTimestamp('Slack credentials not configured');
    logger.warn(
      "Slack credentials not configured. Slack notifications disabled."
    );
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
    const data = await fs.readFile(messageHistoryPath, "utf8");
    // Handle empty file case explicitly
    if (!data) {
      // logWithTimestamp('Message history file is empty. Starting fresh.', 'warn');
      logger.warn(
        `Message history file (${messageHistoryPath}) is empty. Starting fresh.`
      );
      return [];
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // logWithTimestamp('Message history file not found. Creating it.', 'info');
      logger.info(
        `Message history file (${messageHistoryPath}) not found. Creating it.`
      );
      // Ensure directory exists before writing
      try {
        const dir = path.dirname(messageHistoryPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(messageHistoryPath, JSON.stringify([], null, 2)); // Create with empty array
        return [];
      } catch (createError) {
        logger.error(
          `Failed to create message history directory or file at ${messageHistoryPath}: ${createError.message}`,
          { stack: createError.stack }
        );
        return []; // Return empty if creation fails
      }
    }
    // Handle JSON parsing errors specifically
    if (error instanceof SyntaxError) {
      // logWithTimestamp(`Error parsing JSON in message history file: ${error.message}. Treating as empty.`, 'error');
      logger.error(
        `Error parsing JSON in message history file (${messageHistoryPath}): ${error.message}. Treating as empty.`
      );
      return [];
    }
    // Log other unexpected errors
    // logWithTimestamp('Error loading message history: ' + error.message, 'error');
    logger.error(
      `Error loading message history from ${messageHistoryPath}: ${error.message}`,
      { stack: error.stack }
    );
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
    logger.error(
      `Error saving message history to ${messageHistoryPath}: ${error.message}`,
      { stack: error.stack }
    );
    return false;
  }
}

// Function to send message to Slack
async function sendSlackMessage(message, blocks = []) {
  try {
    if (!slack || !slackChannel) {
      // logWithTimestamp('Slack not initialized, skipping notification');
      logger.warn("Slack not initialized, skipping notification");
      return null; // Return null or similar to indicate not sent
    }

    const result = await slack.chat.postMessage({
      channel: slackChannel,
      text: message, // Fallback text
      blocks: blocks.length > 0 ? blocks : undefined, // Use blocks if available
    });

    // logWithTimestamp(`Message sent to Slack: ${result.ts}`);
    logger.info(`Message sent to Slack: ${result.ts}`);

    // Store message in history
    const messageRecord = {
      timestamp: new Date().toISOString(),
      messageId: result.ts,
      channel: slackChannel,
      text: message,
      blocks: blocks.length > 0 ? blocks : undefined,
    };

    // Add to history
    const history = await loadMessageHistory();
    history.push(messageRecord);
    await saveMessageHistory(history);

    return result.ts; // Return the timestamp of the sent message
  } catch (error) {
    // logWithTimestamp('Error sending message to Slack: ' + error.message, 'error');
    logger.error(`Error sending message to Slack: ${error.message}`, {
      slackError: error?.data,
      stack: error.stack,
    });
    return null; // Return null on error
  }
}

// Function to format a report for Slack
function formatReportForSlack(report) {
  if (!report || !report.url || !report.title) {
    return null; // Invalid report data
  }

  // Format publication date if available
  let pubDateStr = "Unknown date";
  if (report.publicationDate) {
    try {
      const pubDate = new Date(report.publicationDate);
      if (!isNaN(pubDate)) {
        pubDateStr = pubDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } else {
        // If date parsing fails, use the raw string
        pubDateStr = report.publicationDate;
      }
    } catch (e) {
      console.error(`Error parsing publication date: ${e.message}`);
      pubDateStr = report.publicationDate; // Fallback to using raw string
    }
  }

  // Format the summary for Slack (ensure it's not too long)
  let summaryText = report.summary || "No summary available";
  if (summaryText.length > 2900) {
    summaryText = summaryText.substring(0, 2900) + "... (truncated)";
  }

  // Create Slack message blocks
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${report.title}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*URL:*\n<${report.url}|${report.url.substring(0, 70)}${
            report.url.length > 70 ? "..." : ""
          }>`,
        },
        {
          type: "mrkdwn",
          text: `*Published:*\n${pubDateStr}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Summary:*\n${summaryText}`,
      },
    },
  ];

  return blocks;
}

// Export functions
module.exports = {
  initializeSlack,
  sendSlackMessage,
  formatReportForSlack,
};
