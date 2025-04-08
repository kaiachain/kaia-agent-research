# Delphi Digital Scraper and Summarizer

This tool automatically processes Delphi Digital reports, extracts content, and generates summaries using the Google Gemini API. It also provides Slack notifications for new reports.

## Setup

1. Install dependencies:
```
npm install puppeteer @google/generative-ai @slack/web-api dotenv
```

2. Create a `.env` file with the following variables:
```
GEMINI_API_KEY=your_gemini_api_key
DELPHI_EMAIL=your_delphi_login_email
DELPHI_PASSWORD=your_delphi_login_password
SLACK_TOKEN=your_slack_bot_token
SLACK_CHANNEL_ID=your_slack_channel_id
```

3. Set up required files:
   - Copy `visited_links.json.template` to `visited_links.json`
   - This file is essential - it stores all report links and their summaries

For a complete setup guide, see [SETUP.md](SETUP.md).

## Required Files

- `summarize.js`: Main script for scraping and processing
- `.env`: Environment variables and credentials
- `visited_links.json`: Stores all reports and summaries
- `delphi_cookies.json`: Created automatically to store login cookies
- `processed_reports_cache.json`: Created automatically to track processed reports

## Usage

Basic usage:
```
node summarize.js
```

This will:
1. Login to Delphi Digital (using saved cookies if available)
2. Process all reports in `visited_links.json`
3. Extract content and generate summaries for new or updated reports
4. Save summaries to `visited_links.json`
5. Send notifications to Slack

## Reprocessing Reports

The tool supports several options for reprocessing reports:

### Force Reprocessing of Latest Reports

To reprocess the latest N reports regardless of their cache status:
```
node summarize.js --force-latest 5
```

This will reprocess the 5 most recent reports, as determined by their publication date.

### Force Reprocessing of Specific URLs

To reprocess one or more specific reports by URL:
```
node summarize.js --force-url https://members.delphidigital.io/reports/some-report-url
```

You can specify multiple URLs:
```
node summarize.js --force-url https://url1 --force-url https://url2
```

### Force Regeneration of Summaries

By default, the tool skips regenerating summaries if the content hasn't changed. To force summary regeneration even for unchanged content:
```
node summarize.js --force-summaries
```

This can be combined with other options:
```
node summarize.js --force-latest 3 --force-summaries
```

## Caching and Performance

The tool maintains two cache files:
- `delphi_cookies.json`: Saves login session cookies to minimize login attempts
- `processed_reports_cache.json`: Tracks processed reports and their content hashes

## Output Format

Each report's summary in Slack follows a consistent format:
- Title
- Main summary points
- Relevance to Kaia
- Publication date
- Link to original report

## Troubleshooting

If you encounter issues with login or scraping:
1. Check saved screenshots (`login-page.png`, `login-failed.png`, etc.)
2. Look at saved HTML files for debugging
3. Try reprocessing specific reports with the `--force-url` option 