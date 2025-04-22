#!/usr/bin/env node
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

async function startDaemon() {
  try {
    // Check if already running
    try {
      const pidData = await fs.readFile(PID_FILE, 'utf8');
      const pid = parseInt(pidData.trim(), 10);
      
      // Check if process is still running
      process.kill(pid, 0);
      console.log(`Delphi checker is already running with PID ${pid}`);
      return false;
    } catch (err) {
      // Process not running or PID file doesn't exist, which is fine
    }
    
    // Start the daemon
    console.log('Starting Delphi checker daemon...');
    
    // Use node to run the check-delphi script
    const child = spawn('node', ['scripts/check-delphi.js'], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    
    // Detach the child process
    child.unref();
    
    // Write PID file
    await fs.writeFile(PID_FILE, child.pid.toString());
    
    console.log(`Delphi checker daemon started with PID ${child.pid}`);
    console.log(`The daemon will check for new reports every ${config.CHECK_INTERVAL / (60 * 60 * 1000)} hours`);
    console.log('You can stop it using: node cli/stop-daemon.js');
    
    return true;
  } catch (error) {
    console.error('Error starting daemon:', error);
    return false;
  }
}

// If this script is run directly, start the daemon
if (require.main === module) {
  startDaemon();
} else {
  module.exports = { startDaemon };
} 