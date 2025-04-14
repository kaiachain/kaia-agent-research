require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { checkDelphiWebsite } = require('./check-delphi');
const { sendDailyDigest } = require('./slack-digest');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse request bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Verify Slack requests are legitimate
function verifySlackRequest(req, res, next) {
  // Skip verification in development mode
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  if (!slackSigningSecret) {
    console.error('SLACK_SIGNING_SECRET is not defined');
    return res.status(400).send('Slack signing secret not configured');
  }

  const slackSignature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const body = JSON.stringify(req.body);

  // Check if the request is more than 5 minutes old
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return res.status(400).send('Request too old');
  }

  // Create the signature
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', slackSigningSecret)
    .update(baseString)
    .digest('hex');
  const calculatedSignature = `v0=${hmac}`;

  // Compare signatures
  if (calculatedSignature !== slackSignature) {
    return res.status(400).send('Invalid signature');
  }

  next();
}

// Endpoint for Slack commands
app.post('/slack/command', verifySlackRequest, async (req, res) => {
  const { command, text } = req.body;

  if (command === '/delphi-check') {
    // Acknowledge the command immediately
    res.status(200).send({
      response_type: 'in_channel',
      text: 'Starting check for new Delphi Digital reports...'
    });

    // Run the check process
    try {
      await checkDelphiWebsite();
    } catch (error) {
      console.error('Error running Delphi check:', error);
    }
  } else if (command === '/delphi-digest') {
    // Acknowledge the command immediately
    res.status(200).send({
      response_type: 'in_channel',
      text: 'Generating Delphi Digital digest...'
    });

    // Generate the digest
    try {
      await sendDailyDigest();
    } catch (error) {
      console.error('Error generating digest:', error);
    }
  } else {
    res.status(200).send({
      response_type: 'ephemeral',
      text: `Unknown command: ${command}`
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Slack webhook server running on port ${PORT}`);
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('Shutting down Slack webhook server...');
  process.exit(0);
});

// Export the Express app for testing
module.exports = app; 