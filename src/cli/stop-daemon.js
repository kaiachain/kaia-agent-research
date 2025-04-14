#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const PID_FILE = path.join(process.cwd(), 'delphi-checker.pid');

async function stopDaemon() {
  try {
    // Read PID file
    const pidData = await fs.readFile(PID_FILE, 'utf8').catch(() => null);
    
    if (!pidData) {
      console.log('No Delphi checker daemon appears to be running.');
      return false;
    }
    
    const pid = parseInt(pidData.trim(), 10);
    
    if (isNaN(pid)) {
      console.log('Invalid PID in PID file. Removing file...');
      await fs.unlink(PID_FILE).catch(() => {});
      return false;
    }
    
    // Try to kill the process
    try {
      process.kill(pid);
      console.log(`Stopped Delphi checker daemon with PID ${pid}`);
      
      // Remove PID file
      await fs.unlink(PID_FILE).catch(() => {});
      
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') {
        console.log(`No process found with PID ${pid}. Removing stale PID file...`);
        await fs.unlink(PID_FILE).catch(() => {});
      } else {
        console.error(`Error stopping process with PID ${pid}:`, error);
      }
      return false;
    }
  } catch (error) {
    console.error('Error stopping daemon:', error);
    return false;
  }
}

// If this script is run directly, stop the daemon
if (require.main === module) {
  stopDaemon();
} else {
  module.exports = { stopDaemon };
} 