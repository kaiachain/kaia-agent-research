# Delphi Digital Scraper Setup Guide

This guide will help you set up the Delphi Digital scraper on a new machine.

## Initial Setup

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
   - Edit `.env` and fill in your credentials:
     - `DELPHI_EMAIL` and `DELPHI_PASSWORD`: Your Delphi Digital login credentials
     - `GEMINI_API_KEY`: Your Google Gemini API key
     - `SLACK_TOKEN` and `SLACK_CHANNEL_ID`: Your Slack bot token and channel ID (if using Slack integration)

4. **Set up the visited_links.json file**:
   - Copy `visited_links.json.template` to `visited_links.json`
   ```bash
   cp visited_links.json.template visited_links.json
   ```
   - This creates an initial file with a placeholder entry
   - The script will populate this file as it scrapes reports

## Running the Script

Basic usage:
```bash
node summarize.js
```

### Command Line Options

- **Force reprocessing of latest reports**:
  ```bash
  node summarize.js --force-latest 5
  ```
  This reprocesses the 5 most recent reports.

- **Force reprocessing of specific URLs**:
  ```bash
  node summarize.js --force-url https://members.delphidigital.io/reports/some-report-url
  ```
  You can specify multiple URLs:
  ```bash
  node summarize.js --force-url https://url1 --force-url https://url2
  ```

- **Force regeneration of summaries**:
  ```bash
  node summarize.js --force-summaries
  ```
  This regenerates summaries even if the content hasn't changed.

## Troubleshooting

- If login fails, the script will save debug information:
  - `login-page.png`: Screenshot of the login page
  - `login-failed.png`: Screenshot when login fails
  - `login-failed.html`: HTML content when login fails

- Check that you have correctly set up `.env` with valid credentials.

- Look for saved cookies in `delphi_cookies.json` - if this file exists, the script will try to use these cookies to log in.

- If content extraction fails, check the article-page screenshots and HTML files for debugging.

- If you need to reset everything, delete the following files and start fresh:
  - `delphi_cookies.json`
  - `processed_reports_cache.json`
  - Any PNG and HTML debug files 