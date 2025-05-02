# Delphi Digital Report Scraper

A tool for automatically scraping, summarizing, and processing Delphi Digital reports. Includes Slack integration for notifications and digests.

## Table of Contents

- [Project Structure](#project-structure)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
  - [Full Flow Process](#full-flow-process-recommended)
  - [Individual Components](#individual-components)
  - [Fixing Visited Links](#fixing-visited-links)
  - [Sorting Reports by Date](#sorting-reports-by-date)
  - [Slack Message History](#slack-message-history)
  - [Sending Unsent Reports](#sending-unsent-reports)
- [Customization](#customization)
- [Development](#development)
- [Automation with Cron](#automation-with-cron)
- [Slack Integration](#slack-integration)
- [Docker Setup](#docker-setup)
- [Troubleshooting](#troubleshooting)
- [Implementation Guide](#implementation-guide)
- [Error Handling](#error-handling)
- [License](#license)

## Project Structure

```
delphi/
├── bin/                      # Command-line executables 
│   ├── delphi-start          # Start the daemon
│   ├── delphi-stop           # Stop the daemon
│   └── delphi-status         # Check daemon status
├── src/                      # Source code
│   ├── browser/              # Browser automation code
│   │   └── browser.js        # Browser utilities
│   ├── cli/                  # CLI tools
│   │   ├── start-daemon.js   # Start daemon script
│   │   ├── stop-daemon.js    # Stop daemon script
│   │   └── status-daemon.js  # Status daemon script
│   ├── config/               # Configuration
│   │   └── config.js         # App configuration
│   ├── data/                 # Data files
│   │   ├── delphi_cookies.json  # Stored cookies
│   │   ├── processed_reports_cache.json  # Processed reports
│   │   └── visited_links.json # Links that have been visited
│   │   └── digest_state.json # Stores timestamp of last digest run (for 'now' schedule)
│   ├── scripts/              # Main application scripts
│   │   ├── check-delphi.js   # Script to check for new reports
│   │   └── summarize.js      # Script to summarize reports
│   │   └── send-slack-digest.js # Script to send daily digest to Slack
│   ├── services/             # Business logic modules
│   │   ├── ai.js             # Gemini AI service
│   │   ├── auth.js           # Authentication service
│   │   ├── reports.js        # Reports service
│   │   └── slack.js          # Slack integration service
│   └── utils/                # Utility functions
│       ├── cache.js          # Cache utilities
│       └── content-extractor.js  # Content extraction utilities
├── .env                      # Environment variables
├── .env.example              # Example environment variables
├── .gitignore                # Git ignore file
├── Dockerfile                # Docker configuration
├── docker-compose.yml        # Docker Compose configuration
├── delphi-checker.pid        # PID file for daemon
├── package.json              # NPM package info
└── package-lock.json         # NPM package lock
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
   mkdir -p src/data
   cp visited_links.json.template src/data/visited_links.json
   ```

## Environment Variables

Required configuration:
```
# Delphi Digital credentials
DELPHI_EMAIL=your_delphi_login_email
DELPHI_PASSWORD=your_delphi_login_password

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key

# Slack integration
SLACK_TOKEN=your_slack_bot_token
SLACK_CHANNEL_ID=your_slack_channel_id

# Optional: Schedule for daily digest. Use a cron-like format (e.g., "0 9 * * *" for 9 AM UTC)
# or "now" to send immediately based on reports since the last successful 'now' run.
# If not set or "now", the digest must be triggered manually or via the main flow.
SLACK_DIGEST_SCHEDULE="now"

# Cron schedule for checking new reports (default: "0 0 * * *" for daily at midnight)
# Uses standard cron syntax: minute hour day month weekday
# Examples:
# "0 */12 * * *" - Every 12 hours
# "0 9 * * 1-5" - Every weekday at 9 AM
# "0 0,12 * * *" - Every day at midnight and noon
CRON_SCHEDULE="0 0 * * *"
```

Optional configuration:
```
# Optional: Custom file paths (these are set by default in Docker)
COOKIES_FILE=src/data/delphi_cookies.json
CACHE_FILE=src/data/processed_reports_cache.json
VISITED_LINKS_FILE=src/data/visited_links.json
```

## Usage

### Full Flow Process (Recommended)

The recommended way to use this tool is with the full flow process:

```bash
# Run once
npm run delphi:run

# Run in daemon mode (checks according to the CRON_SCHEDULE)
npm run delphi:daemon

# Stop the daemon
npm run delphi:stop
```

### Individual Components

```bash
# Check for new reports
npm run check

# Process and summarize reports
npm run process

# Force reprocess latest reports
npm run force-latest <count>

# Force regenerate all summaries
npm run force-summaries

# Send daily digest to Slack
npm run digest
```

### Docker Setup

1. **Build and start the container**:
   ```bash
   docker-compose up -d
   ```

2. **View logs**:
   ```bash
   docker-compose logs -f
   ```

3. **Run the Slack digest service**:
   ```bash
   docker-compose run --rm slack-digest
   ```

The Docker setup includes:
- Automatic volume mounting for data persistence
- Pre-configured environment variables for file paths
- All necessary dependencies for Puppeteer
- Support for running both the main scraper and digest services
- The `data/digest_state.json` file will be created automatically in the data volume
  when `SLACK_DIGEST_SCHEDULE` is set to `"now"` to track the last digest time.

### Troubleshooting

Common issues and solutions:

1. **Login Issues**:
   - Check your Delphi credentials in `.env`
   - Delete `src/data/delphi_cookies.json` to force a fresh login

2. **Slack Issues**:
   - Verify your Slack token and channel ID
   - Ensure the bot is invited to the channel
   - Check console output for error messages

3. **Docker Issues**:
   - Ensure Docker is running
   - Check container logs: `docker-compose logs`
   - Verify volume permissions
   - For Puppeteer errors, check container has all required dependencies

## Error Handling

The system is configured to handle errors gracefully:

- All errors are logged to the console with timestamps for debugging
- Errors are NOT sent to Slack to avoid cluttering the channel
- Only report summaries and critical success notifications are sent to Slack

If you need to debug issues:

1. Check the console logs for detailed error messages and stack traces
2. Look for log entries with timestamp format `[YYYY-MM-DDThh:mm:ss.sssZ] ERROR: ...`
3. Use the Docker container logs if running in Docker: `docker-compose logs -f`

If you want to modify this behavior, you can:
- Edit the `logError` function in `src/services/slack.js` 
- Uncomment the error notification lines in the catch blocks if you want errors in Slack

## License

ISC 

## Slack Integration

This tool can send notifications to a configured Slack channel:
- **Individual Report Summaries**: Sent immediately after a new report is processed (if Slack is initialized correctly in the main flow).
- **Daily Digest**: A consolidated message summarizing reports processed within a specific timeframe.

**Digest Behavior:**
- The timing and content of the daily digest are controlled by the `SLACK_DIGEST_SCHEDULE` environment variable:
  - **`SLACK_DIGEST_SCHEDULE="now"`**: When the digest script runs (either manually via `npm run digest` or automatically if integrated into the main flow's end), it will send summaries for reports processed *since the last time the "now" digest was successfully run*. It tracks this using the `data/digest_state.json` file.
  - **`SLACK_DIGEST_SCHEDULE="<cron_schedule>"` (e.g., `"0 9 * * *"` for 9 AM UTC)**: The script uses a fixed lookback period (currently hardcoded as 24 hours in `send-slack-digest.js`) to gather reports when run. You would typically trigger this script using an external scheduler like `cron` based on the desired schedule. *Note: The current setup doesn't automatically schedule based on the cron string; it only uses it to adjust the lookback logic if provided.*
  - **Not Set / Empty**: If the variable is not set, running the digest script defaults to the fixed lookback period (like the cron schedule case) and relies on manual triggering.

## Automation with Cron

The application uses node-cron for scheduling regular checks for new reports:

1. **Internal Cron Scheduling**:
   - The daemon uses node-cron to schedule checks according to the `CRON_SCHEDULE` environment variable
   - The default schedule is daily at midnight (`0 0 * * *`)
   - You can customize this by setting `CRON_SCHEDULE` in your .env file

2. **Cron Syntax**:
   - Standard cron format: `minute hour day month weekday`
   - Examples:
     - `0 */12 * * *` - Every 12 hours
     - `0 9 * * 1-5` - Every weekday at 9 AM
     - `0 0,12 * * *` - Every day at midnight and noon

3. **Manual Scheduling**:
   - You can also use your system's cron to schedule runs if you prefer not using the daemon
   - Example: `0 9 * * * cd /path/to/app && npm run delphi:run`

The scheduling system ensures regular checks without requiring manual intervention while providing flexibility to customize the timing according to your needs.

## Docker Setup

1. **Build and start the container**:
   ```bash
   docker-compose up -d
   ```

2. **View logs**:
   ```bash
   docker-compose logs -f
   ```

3. **Run the Slack digest service**:
   ```bash
   docker-compose run --rm slack-digest
   ```

The Docker setup includes:
- Automatic volume mounting for data persistence
- Pre-configured environment variables for file paths
- All necessary dependencies for Puppeteer
- Support for running both the main scraper and digest services
- The `data/digest_state.json` file will be created automatically in the data volume
  when `SLACK_DIGEST_SCHEDULE` is set to `"now"` to track the last digest time.

### Troubleshooting

Common issues and solutions:

1. **Login Issues**:
   - Check your Delphi credentials in `.env`
   - Delete `src/data/delphi_cookies.json` to force a fresh login

2. **Slack Issues**:
   - Verify your Slack token and channel ID
   - Ensure the bot is invited to the channel
   - Check console output for error messages

3. **Docker Issues**:
   - Ensure Docker is running
   - Check container logs: `docker-compose logs`
   - Verify volume permissions
   - For Puppeteer errors, check container has all required dependencies

## Error Handling

The system is configured to handle errors gracefully:

- All errors are logged to the console with timestamps for debugging
- Errors are NOT sent to Slack to avoid cluttering the channel
- Only report summaries and critical success notifications are sent to Slack

If you need to debug issues:

1. Check the console logs for detailed error messages and stack traces
2. Look for log entries with timestamp format `[YYYY-MM-DDThh:mm:ss.sssZ] ERROR: ...`
3. Use the Docker container logs if running in Docker: `docker-compose logs -f`

If you want to modify this behavior, you can:
- Edit the `logError` function in `src/services/slack.js` 
- Uncomment the error notification lines in the catch blocks if you want errors in Slack

## License

ISC 