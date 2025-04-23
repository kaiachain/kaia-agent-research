#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { config, loadConfigFromEnv } = require('../config/config');

// Load configuration
const appConfig = loadConfigFromEnv();

// Main function to fix visited links
async function fixVisitedLinks() {
  console.log(`=== Starting to fix visited_links.json: ${new Date().toISOString()} ===`);
  
  try {
    // Load the template for reference
    const templatePath = path.join(process.cwd(), 'visited_links.json.template');
    const templateData = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(templateData);
    
    if (!template || !template.length || !template[0]) {
      throw new Error('Template file is invalid or empty');
    }
    
    // Get required fields from template
    const requiredFields = Object.keys(template[0]);
    console.log(`Required fields: ${requiredFields.join(', ')}`);
    
    // Load the current visited_links.json
    const visitedLinksPath = appConfig.VISITED_LINKS_FILE;
    const visitedLinksData = await fs.readFile(visitedLinksPath, 'utf8');
    
    const visitedLinks = JSON.parse(visitedLinksData);
    
    console.log(`Found ${visitedLinks.length} entries in visited_links.json`);
    
    // Fix each entry
    let fixedCount = 0;
    const fixedLinks = visitedLinks.map(link => {
      const needsFix = !requiredFields.every(field => field in link && link[field] !== undefined);
      
      if (needsFix) {
        fixedCount++;
        const now = new Date().toISOString();
        
        // Create a fixed entry with all required fields
        return {
          url: link.url || "",
          title: link.title || "Untitled Report",
          body: link.body || "",
          timestamp: link.timestamp || now,
          scrapedAt: link.scrapedAt || now,
          lastChecked: link.lastChecked || now,
          summary: link.summary || "",
          publicationDate: link.publicationDate || now
        };
      }
      
      return link;
    });
    
    // Sort by publicationDate in descending order (newest first)
    fixedLinks.sort((a, b) => {
      // Extract dates for comparison
      const dateA = new Date(a.publicationDate || 0);
      const dateB = new Date(b.publicationDate || 0);
      
      // Sort in descending order (newest first)
      return dateB - dateA;
    });
    
    // Save the fixed and sorted file
    await fs.writeFile(visitedLinksPath, JSON.stringify(fixedLinks, null, 2));
    
    console.log(`Fixed ${fixedCount} entries in visited_links.json`);
    console.log(`Sorted all entries by publication date (newest first)`);
    console.log('Fix and sort completed successfully');
    
    return true;
  } catch (error) {
    console.error('Error fixing visited_links.json:', error);
    return false;
  }
}

// Run the function if called directly
if (require.main === module) {
  fixVisitedLinks().then(success => {
    if (success) {
      console.log('Successfully fixed visited_links.json');
      process.exit(0);
    } else {
      console.error('Failed to fix visited_links.json');
      process.exit(1);
    }
  });
}

// Export for importing in other scripts
module.exports = {
  fixVisitedLinks
}; 