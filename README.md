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
│   │   ├── backups/          # Backup directory
│   │   ├── delphi_cookies.json  # Stored cookies
│   │   ├── processed_reports_cache.json  # Processed reports
│   │   └── visited_links.json # Links that have been visited
│   ├── scripts/              # Main application scripts
│   │   ├── check-delphi.js   # Script to check for new reports
│   │   └── summarize.js      # Script to summarize reports
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
   git clone https://github.com/avdheshcharjan/delphi-scraper.git
   cd delphi-scraper
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
```

Optional configuration:
```
# Optional: Custom file paths (these are set by default in Docker)
COOKIES_FILE=src/data/delphi_cookies.json
CACHE_FILE=src/data/processed_reports_cache.json
VISITED_LINKS_FILE=src/data/visited_links.json
BACKUPS_DIR=src/data/backups

# Optional: Check interval in milliseconds (default: 24 hours)
CHECK_INTERVAL=86400000
```

## Usage

### Full Flow Process (Recommended)

The recommended way to use this tool is with the full flow process:

```bash
# Run once
npm run delphi:run

# Run in daemon mode (checks every 24 hours)
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

### Troubleshooting

Common issues and solutions:

1. **Login Issues**:
   - Check your Delphi credentials in `.env`
   - Delete `src/data/delphi_cookies.json` to force a fresh login
   - Check the debug screenshots in the root directory

2. **Slack Issues**:
   - Verify your Slack token and channel ID
   - Ensure the bot is invited to the channel
   - Check console output for error messages

3. **Docker Issues**:
   - Ensure Docker is running
   - Check container logs: `docker-compose logs`
   - Verify volume permissions
   - For Puppeteer errors, check container has all required dependencies

## License

ISC 