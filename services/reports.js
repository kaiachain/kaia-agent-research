const fs = require('fs').promises;
const path = require('path');
const { logWithTimestamp, logError } = require('./slack');
const config = require('../config/config').loadConfigFromEnv();

// Determine screenshot directory with platform-independence
// const SCREENSHOTS_DIR = path.join(process.cwd(), 'src/data/screenshots');

// Ensure screenshots directory exists
// async function ensureScreenshotsDir() {
//   try {
//     await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
//   } catch (error) {
//     if (error.code !== 'EEXIST') {
//       logError(`Error creating screenshots directory: ${error.message}`, error);
//     }
//   }
// }

// Function to check for new reports from Delphi Digital
async function checkForNewReports(page, url) {
  logWithTimestamp('Checking for new reports...');
  
  // Create screenshots directory if it doesn't exist
  // await ensureScreenshotsDir();
  
  try {
    logWithTimestamp(`Attempting to login with URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Take a screenshot of the current state
    // const screenshotPath = path.join(SCREENSHOTS_DIR, 'current-page-state.png');
    // await page.screenshot({ path: screenshotPath, fullPage: true });
    
    // Save HTML content
    // const contentPath = path.join(SCREENSHOTS_DIR, 'current-page.html');
    // await fs.writeFile(contentPath, await page.content());
    
    // Get the list of links
    // ... existing code ...
    logError('Error checking for new reports', error);
    
    // Save the current page state on error
    // const errorContentPath = path.join(SCREENSHOTS_DIR, 'error-state.html');
    // const errorScreenshotPath = path.join(SCREENSHOTS_DIR, 'error-state.png');
    // await fs.writeFile(errorContentPath, await page.content());
    // await page.screenshot({ path: errorScreenshotPath, fullPage: true });
    // logWithTimestamp('Error state saved to error-state.html and error-state.png in screenshots directory');
    
    return []; // Return an empty array to indicate failure
  } catch (error) {
    // logError(`Failed to create backup directory`, error);
  }
}

// Helper function to scroll the page and load dynamic content
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.documentElement.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if(totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  
  // Wait for any lazy-loaded content using a Promise instead of waitForTimeout
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// Function to compare new links with visited links
async function findNewReports(links, visitedLinksPath) {
  try {
    // Load existing links from visited_links.json
    const jsonData = await fs.readFile(visitedLinksPath, 'utf8');
    const visitedLinks = JSON.parse(jsonData);
    const visitedUrls = new Set(visitedLinks.map(link => link.url));
    
    logWithTimestamp(`Currently have ${visitedLinks.length} reports in ${visitedLinksPath}`);
    
    // Find new links
    const newLinks = links.filter(link => !visitedUrls.has(link.url));
    
    if (newLinks.length === 0) {
      logWithTimestamp('No new reports found');
    } else {
      logWithTimestamp(`Found ${newLinks.length} new reports!`);
      newLinks.forEach(link => logWithTimestamp(`- ${link.title}: ${link.url}`));
    }
    
    return {
      newLinks,
      visitedLinks
    };
  } catch (error) {
    logError('Error finding new reports', error);
    if (error.code === 'ENOENT') {
      logWithTimestamp(`${visitedLinksPath} not found. Creating a new one.`);
      
      // Initialize with all fields according to the template
      const now = new Date().toISOString();
      const initialLinks = links.map(link => ({
        url: link.url,
        title: link.title || "Untitled Report",
        body: "",
        timestamp: now,
        scrapedAt: now,
        lastChecked: now,
        summary: "",
        publicationDate: now
      }));
      
      // Sort by publicationDate in descending order (newest first)
      initialLinks.sort((a, b) => {
        // Extract dates for comparison
        const dateA = new Date(a.publicationDate || 0);
        const dateB = new Date(b.publicationDate || 0);
        
        // Sort in descending order (newest first)
        return dateB - dateA;
      });
      
      await fs.writeFile(visitedLinksPath, JSON.stringify(initialLinks, null, 2));
      return {
        newLinks: initialLinks,
        visitedLinks: []
      };
    }
    return {
      newLinks: [],
      visitedLinks: []
    };
  }
}

// Function to update visited links
async function updateVisitedLinks(newLinks, visitedLinks, visitedLinksPath) {
  try {
    // First, create a backup of the current file
    const backupDir = config.BACKUPS_DIR;
    
    try {
      await fs.mkdir(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupPath = path.join(backupDir, `visited_links_${timestamp}.json`);
      
      // Only backup if the file exists
      try {
        const currentData = await fs.readFile(visitedLinksPath, 'utf8');
        await fs.writeFile(backupPath, currentData);
        logWithTimestamp(`Created backup at ${backupPath}`);
      } catch (backupError) {
        if (backupError.code !== 'ENOENT') {
          logError(`Error creating backup`, backupError);
        }
      }
    } catch (error) {
      logError(`Failed to create backup directory`, error);
    }
    
    // Combine existing and new links, ensuring no duplicates
    const existingUrlMap = new Map();
    
    // Add existing links to the map
    visitedLinks.forEach(link => {
      existingUrlMap.set(link.url, link);
    });
    
    // Update or add new links
    newLinks.forEach(newLink => {
      const now = new Date().toISOString();
      
      // If the link already exists, update lastChecked and possibly other fields
      if (existingUrlMap.has(newLink.url)) {
        const existingLink = existingUrlMap.get(newLink.url);
        existingLink.lastChecked = now;
        
        // Only update title if the new one is more descriptive
        if (newLink.title && (!existingLink.title || existingLink.title === "Untitled Report")) {
          existingLink.title = newLink.title;
        }
        
        // Update other fields as needed
        if (newLink.summary && newLink.summary.length > 0) {
          existingLink.summary = newLink.summary;
        }
        
        if (newLink.publicationDate) {
          existingLink.publicationDate = newLink.publicationDate;
        }
      } else {
        // Add new link
        existingUrlMap.set(newLink.url, newLink);
      }
    });
    
    // Convert map back to array
    const updatedLinks = Array.from(existingUrlMap.values());
    
    // Sort by publicationDate in descending order (newest first)
    updatedLinks.sort((a, b) => {
      // Extract dates for comparison
      const dateA = new Date(a.publicationDate || 0);
      const dateB = new Date(b.publicationDate || 0);
      
      // Sort in descending order (newest first)
      return dateB - dateA;
    });
    
    // Save updated list
    await fs.writeFile(visitedLinksPath, JSON.stringify(updatedLinks, null, 2));
    logWithTimestamp(`Updated ${visitedLinksPath} with ${newLinks.length} new links`);
    
    return updatedLinks;
  } catch (error) {
    logError(`Error updating visited links`, error);
    throw error;
  }
}

module.exports = {
  checkForNewReports,
  findNewReports,
  updateVisitedLinks,
  autoScroll
}; 