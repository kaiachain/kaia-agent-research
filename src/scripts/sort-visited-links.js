#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Main function to sort visited links
async function sortVisitedLinks() {
  const visitedLinksPath = appConfig.VISITED_LINKS_FILE;
  console.log(`=== Sorting visited_links.json by publication date: ${new Date().toISOString()} ===`);
  
  try {
    // Load the current visited_links.json
    console.log(`Loading visited links from ${visitedLinksPath}`);
    const visitedLinksData = await fs.readFile(visitedLinksPath, 'utf8');
    const visitedLinks = JSON.parse(visitedLinksData);
    
    console.log(`Found ${visitedLinks.length} entries in visited_links.json`);
    
    // Create a backup
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupPath = path.join(process.cwd(), 'backups', `visited_links.${timestamp}.json`);
    
    // Ensure backups directory exists
    await fs.mkdir(path.join(process.cwd(), 'backups'), { recursive: true });
    
    // Save backup
    await fs.writeFile(backupPath, visitedLinksData);
    console.log(`Backup created at ${backupPath}`);
    
    // Sort by publicationDate in descending order (newest first)
    visitedLinks.sort((a, b) => {
      // Extract dates for comparison
      const dateA = new Date(a.publicationDate || 0);
      const dateB = new Date(b.publicationDate || 0);
      
      // Sort in descending order (newest first)
      return dateB - dateA;
    });
    
    // Save the sorted file
    await fs.writeFile(visitedLinksPath, JSON.stringify(visitedLinks, null, 2));
    
    console.log(`Sorted ${visitedLinks.length} entries in visited_links.json by publication date (newest first)`);
    
    // Print the first few entries to show sorting worked
    console.log('\nFirst 3 entries after sorting:');
    for (let i = 0; i < Math.min(3, visitedLinks.length); i++) {
      const date = new Date(visitedLinks[i].publicationDate).toLocaleString();
      console.log(`${i+1}. ${visitedLinks[i].title} (${date})`);
    }
    
    return true;
  } catch (error) {
    console.error('Error sorting visited_links.json:', error);
    return false;
  }
}

// Run the function if called directly
if (require.main === module) {
  sortVisitedLinks().then(success => {
    if (success) {
      console.log('Successfully sorted visited_links.json');
      process.exit(0);
    } else {
      console.error('Failed to sort visited_links.json');
      process.exit(1);
    }
  });
}

// Export for importing in other scripts
module.exports = {
  sortVisitedLinks
}; 