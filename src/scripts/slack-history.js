#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import services and utilities
const { initializeSlack, getMessageHistory, getMessagesForReport } = require('../services/slack');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Initialize services
const slackInitialized = initializeSlack(process.env.SLACK_TOKEN, process.env.SLACK_CHANNEL_ID);

// Process command line arguments
const args = process.argv.slice(2);
const reportUrl = args.find(arg => arg.startsWith('--url='))?.split('=')[1];
const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '10', 10);
const jsonOutput = args.includes('--json');

// Function to display message history
async function displayMessageHistory() {
  if (!slackInitialized) {
    console.error('❌ Slack is not initialized. Please check your SLACK_TOKEN and SLACK_CHANNEL_ID.');
    return false;
  }
  
  try {
    let messages;
    
    if (reportUrl) {
      console.log(`Fetching messages related to report: ${reportUrl}`);
      messages = await getMessagesForReport(reportUrl, limit);
      console.log(`Found ${messages.length} messages related to this report.`);
    } else {
      console.log(`Fetching the last ${limit} messages sent to Slack`);
      messages = await getMessageHistory(limit);
      console.log(`Retrieved ${messages.length} messages.`);
    }
    
    if (messages.length === 0) {
      console.log('No messages found.');
      return true;
    }
    
    if (jsonOutput) {
      // Output as JSON
      const output = JSON.stringify(messages, null, 2);
      
      if (outputFile) {
        await fs.writeFile(outputFile, output);
        console.log(`Messages saved to ${outputFile}`);
      } else {
        console.log(output);
      }
    } else {
      // Output formatted messages
      messages.forEach((msg, index) => {
        console.log(`\n--- Message ${index + 1} ---`);
        console.log(`Sent: ${new Date(msg.timestamp).toLocaleString()}`);
        console.log(`Message ID: ${msg.messageId}`);
        console.log(`Text: ${msg.text}`);
        
        if (msg.blocks && Array.isArray(msg.blocks)) {
          console.log(`Blocks: ${msg.blocks.length}`);
          
          // Display certain block types in a readable way
          msg.blocks.forEach((block, blockIndex) => {
            if (block.type === 'section' && block.text) {
              console.log(`  Block ${blockIndex + 1} (${block.type}): ${block.text.text?.substring(0, 100)}...`);
            } else {
              console.log(`  Block ${blockIndex + 1} (${block.type})`);
            }
          });
        }
      });
      
      if (outputFile) {
        // Save formatted output to file
        const outputStream = messages.map((msg, index) => {
          return [
            `--- Message ${index + 1} ---`,
            `Sent: ${new Date(msg.timestamp).toLocaleString()}`,
            `Message ID: ${msg.messageId}`,
            `Text: ${msg.text}`,
            msg.blocks && Array.isArray(msg.blocks) 
              ? `Blocks: ${msg.blocks.length}\n` + 
                msg.blocks.map((block, blockIndex) => {
                  if (block.type === 'section' && block.text) {
                    return `  Block ${blockIndex + 1} (${block.type}): ${block.text.text?.substring(0, 100)}...`;
                  } else {
                    return `  Block ${blockIndex + 1} (${block.type})`;
                  }
                }).join('\n')
              : '',
            '\n'
          ].join('\n');
        }).join('\n');
        
        await fs.writeFile(outputFile, outputStream);
        console.log(`Formatted messages saved to ${outputFile}`);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error displaying message history:', error);
    return false;
  }
}

// Main execution
if (require.main === module) {
  displayMessageHistory().then(success => {
    if (success) {
      console.log('Successfully displayed message history');
      process.exit(0);
    } else {
      console.error('Failed to display message history');
      process.exit(1);
    }
  });
}

// Export for importing in other scripts
module.exports = {
  displayMessageHistory
}; 