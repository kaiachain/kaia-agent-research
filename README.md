# Delphi Digital Report Scraper

A tool for automatically scraping, summarizing, and processing Delphi Digital reports. Includes Slack integration for notifications.

## Table of Contents

- [Project Structure](#project-structure)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
- [Slack Integration](#slack-integration)
- [Error Handling](#error-handling)
- [License](#license)

## Project Structure

```
.
├── data/                  # Data directory
│   ├── delphi_cookies.json  # Stored cookies
│   └── visited_links.json  # Links that have been visited
├── browser/              # Browser automation code
│   └── browser.js        # Browser utilities
├── services/             # Core services
│   ├── ai.js             # Gemini AI service
│   ├── auth.js           # Authentication service
│   ├── reports.js        # Reports service
│   └── slack.js          # Slack integration service
├── utils/                # Utility functions
│   └── link-tracker.js   # Link tracking utilities
├── config/               # Configuration
│   └── config.js         # App configuration
├── scripts/              # Main scripts
│   ├── delphi-full-flow.js  # Main application script
│   └── logger.js         # Logging utility
├── package.json          # Dependencies
└── .env                  # Environment variables
```

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/kaiachain/kaia-agent-research.git
   cd kaia-agent-research
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   - Copy `.env.example` to `.env`
   ```bash
   cp .env.example .env
   ```
   - Edit `.env` and fill in your credentials (see [Environment Variables](#environment-variables))

4. **Set up the data directory**:
   ```bash
   mkdir -p data
   touch data/visited_links.json
   ```

## Environment Variables

Required configuration:
```
# Delphi Digital credentials
DELPHI_EMAIL=your_delphi_login_email
DELPHI_PASSWORD=your_delphi_login_password
DELPHI_REPORTS_URL=https://members.delphidigital.io/reports

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key

# Slack integration
SLACK_TOKEN=your_slack_bot_token
SLACK_CONFIG={"channelId": "your_slack_channel_id"}
```

## Usage

Run the main script to process reports:
```bash
node scripts/delphi-full-flow.js
```

The script will:
1. Authenticate with Delphi Digital
2. Check for new reports
3. Process each new report:
   - Extract content
   - Generate summary using Gemini AI
   - Send summary to Slack
4. Track visited links to avoid reprocessing

## Slack Integration

The tool sends notifications to a configured Slack channel:
- **Individual Report Summaries**: Sent immediately after a new report is processed
- Each summary includes:
  - Report title
  - Publication date
  - URL
  - AI-generated summary

The Slack integration uses three main functions:
- `initializeSlack`: Sets up the Slack connection
- `sendSlackMessage`: Sends messages to the configured channel
- `formatReportForSlack`: Formats report data for Slack messages

## Error Handling

The system handles errors gracefully:

- All errors are logged with timestamps for debugging
- Errors are NOT sent to Slack to avoid cluttering the channel
- Only report summaries and critical success notifications are sent to Slack

To debug issues:
1. Check the console logs for detailed error messages and stack traces
2. Look for log entries with timestamp format `[YYYY-MM-DDThh:mm:ss.sssZ] ERROR: ...`

## License

ISC 