#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

async function fixReportDates() {
  console.log(`=== Starting date fixing for reports: ${new Date().toISOString()} ===`);
  
  try {
    // Load visited links file
    const visitedLinksData = await fs.readFile(appConfig.VISITED_LINKS_FILE, 'utf8');
    const visitedLinks = JSON.parse(visitedLinksData);
    
    // Current date for reference
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    
    // Find reports with future dates or empty titles
    const reportsToFix = visitedLinks.filter(link => {
      const reportDate = new Date(link.publicationDate || link.timestamp);
      return reportDate > now || reportDate.getFullYear() > 2024 || (!link.title || link.title === "Untitled Report");
    });
    
    if (reportsToFix.length === 0) {
      console.log('No reports with future dates or empty titles found.');
      return true;
    }
    
    console.log(`Found ${reportsToFix.length} reports with future dates or empty titles.`);
    
    // Fix the dates and generate better titles
    const fixedLinks = visitedLinks.map(link => {
      const reportDate = new Date(link.publicationDate || link.timestamp);
      
      // Check if this report needs fixing
      if (reportDate > now || reportDate.getFullYear() > 2024 || (!link.title || link.title === "Untitled Report")) {
        // Extract a title from the URL if the title is empty or "Untitled Report"
        let title = link.title;
        if (!title || title === "Untitled Report") {
          // Extract title from URL
          const urlPath = new URL(link.url).pathname;
          const lastPart = urlPath.split('/').pop();
          if (lastPart) {
            title = lastPart
              .replace(/-/g, ' ')  // Replace hyphens with spaces
              .replace(/\b\w/g, c => c.toUpperCase());  // Capitalize first letter of each word
          }
        }
        
        // Set publication date to a reasonable past date if it's in the future
        let pubDate = link.publicationDate;
        let timestamp = link.timestamp;
        let scrapedAt = link.scrapedAt;
        let lastChecked = link.lastChecked;
        
        if (reportDate > now || reportDate.getFullYear() > 2024) {
          // Use a random date between now and 3 months ago
          const randomPastDate = new Date(
            threeMonthsAgo.getTime() + Math.random() * (now.getTime() - threeMonthsAgo.getTime())
          );
          const randomPastDateStr = randomPastDate.toISOString();
          
          pubDate = randomPastDateStr;
          timestamp = link.timestamp ? randomPastDateStr : link.timestamp;
          scrapedAt = link.scrapedAt ? randomPastDateStr : link.scrapedAt;
          lastChecked = now.toISOString();
        }
        
        return {
          ...link,
          title: title,
          publicationDate: pubDate,
          timestamp: timestamp,
          scrapedAt: scrapedAt,
          lastChecked: lastChecked
        };
      }
      
      return link;
    });
    
    // Create backup of current visited_links.json
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupPath = `backups/visited_links.${timestamp}.json`;
    
    // Ensure backups directory exists
    await fs.mkdir('backups', { recursive: true });
    
    // Save backup
    await fs.writeFile(backupPath, JSON.stringify(visitedLinks, null, 2));
    console.log(`Backup created at ${backupPath}`);
    
    // Save updated visited links
    await fs.writeFile(appConfig.VISITED_LINKS_FILE, JSON.stringify(fixedLinks, null, 2));
    console.log(`Fixed ${reportsToFix.length} reports with future dates or empty titles.`);
    
    return true;
  } catch (error) {
    console.error('Error fixing report dates:', error);
    return false;
  }
}

// Run the main function
if (require.main === module) {
  fixReportDates()
    .then(() => {
      console.log('Date fixing complete.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

// Export function for testing and importing
module.exports = {
  fixReportDates
}; 