# Setting Up Automated Daily Digests

This guide explains how to set up automated daily execution of the Delphi scraper and digest scripts using cron jobs.

## Prerequisites

- The Delphi scraper project must be fully set up and working manually
- You need a Linux/macOS system with cron installed

## Recommended Schedule

For optimal results, we recommend the following schedule:

1. Run the main scraper twice daily to capture new reports:
   - Early morning (e.g., 6:00 AM)
   - Evening (e.g., 6:00 PM)

2. Run the daily digest once daily (e.g., 7:00 PM) to send a summary of the day's reports

## Setting Up Cron Jobs

### Step 1: Create a Shell Script

First, create a shell script that will be executed by cron:

```bash
nano ~/delphi-scraper-run.sh
```

Add the following content:

```bash
#!/bin/bash

# Set working directory
cd /path/to/your/delphi-scraper

# Load NVM if you use it
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Run the scraper
node summarize.js >> scraper.log 2>&1

# Record the execution in the log
echo "Scraper executed at $(date)" >> cron.log
```

Make the script executable:

```bash
chmod +x ~/delphi-scraper-run.sh
```

### Step 2: Create a Shell Script for the Daily Digest

```bash
nano ~/delphi-digest-run.sh
```

Add the following content:

```bash
#!/bin/bash

# Set working directory
cd /path/to/your/delphi-scraper

# Load NVM if you use it
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Run the daily digest
node slack-digest.js >> digest.log 2>&1

# Record the execution in the log
echo "Digest executed at $(date)" >> cron.log
```

Make the script executable:

```bash
chmod +x ~/delphi-digest-run.sh
```

### Step 3: Edit the Crontab

Open your crontab file for editing:

```bash
crontab -e
```

Add the following lines (adjust the paths as needed):

```
# Run the scraper at 6:00 AM and 6:00 PM every day
0 6,18 * * * ~/delphi-scraper-run.sh

# Run the daily digest at 7:00 PM every day
0 19 * * * ~/delphi-digest-run.sh
```

Save and close the editor.

## Verifying the Setup

To verify that your cron jobs are set up correctly:

1. List all active cron jobs:
   ```bash
   crontab -l
   ```

2. Check if the cron service is running:
   ```bash
   systemctl status cron  # On most Linux systems
   ```
   or
   ```bash
   ps aux | grep cron
   ```

3. Check the log files after the scheduled times:
   ```bash
   cat scraper.log
   cat digest.log
   cat cron.log
   ```

## Troubleshooting

If the cron jobs aren't running as expected:

1. **Path issues**: Ensure all paths in your scripts are absolute paths
2. **Permission issues**: Make sure the scripts are executable
3. **Node.js issues**: If you're using nvm, make sure it's properly sourced in the scripts
4. **Environment variables**: Cron runs with a limited environment. You may need to explicitly set PATH and other environment variables

## Automating on Windows

On Windows, you can use Task Scheduler instead of cron:

1. Open Task Scheduler
2. Create a new Basic Task
3. Set the trigger to daily at your desired times
4. Set the action to "Start a program"
5. For the program, use the full path to your Node.js executable
6. For arguments, use the full path to your script
7. Set "Start in" to your project directory

## Logging Rotation

For long-term usage, consider setting up log rotation to prevent log files from growing too large:

```bash
sudo nano /etc/logrotate.d/delphi-scraper
```

Add:

```
/path/to/your/delphi-scraper/*.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
``` 