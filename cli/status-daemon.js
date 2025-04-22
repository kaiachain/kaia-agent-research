#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

async function checkStatus() {
  try {
    // Read PID file
    const pidData = await fs.readFile(PID_FILE, 'utf8').catch(() => null);
    
    if (!pidData) {
      console.log('No Delphi checker daemon appears to be running.');
      return false;
    }
    
    const pid = parseInt(pidData.trim(), 10);
    
    if (isNaN(pid)) {
      console.log('Invalid PID in PID file. The daemon may not be running properly.');
      return false;
    }
    
    // Check if process is running
    try {
      process.kill(pid, 0); // This just checks if the process exists
      
      // Get process info
      let processInfo = 'Unknown';
      try {
        // This works on macOS and Linux
        const { stdout } = await execAsync(`ps -p ${pid} -o %cpu,%mem,lstart`);
        processInfo = stdout.trim();
      } catch (err) {
        // Ignore errors from ps command
      }
      
      console.log(`Delphi checker daemon is running with PID ${pid}`);
      console.log('\nProcess details:');
      console.log(processInfo);
      
      // Get next scheduled check time
      const config = require('../config/config');
      const appConfig = config.loadConfigFromEnv();
      const interval = appConfig.CHECK_INTERVAL;
      
      try {
        const { stdout: startTimeStr } = await execAsync(`ps -p ${pid} -o lstart`);
        const startTimeLine = startTimeStr.split('\n')[1]; // Skip header line
        if (startTimeLine) {
          const startTime = new Date(startTimeLine);
          const nextCheckTime = new Date(startTime.getTime() + interval);
          console.log(`\nNext check scheduled at approximately: ${nextCheckTime.toLocaleString()}`);
        }
      } catch (err) {
        // Ignore errors when trying to determine next check time
      }
      
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') {
        console.log(`No process found with PID ${pid}. The daemon is not running.`);
      } else {
        console.error(`Error checking status of process with PID ${pid}:`, error);
      }
      return false;
    }
  } catch (error) {
    console.error('Error checking daemon status:', error);
    return false;
  }
}

// If this script is run directly, check status
if (require.main === module) {
  checkStatus();
} else {
  module.exports = { checkStatus };
} 