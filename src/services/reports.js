const fs = require('fs').promises;

// Function to check for new reports
async function checkForNewReports(page, url) {
  try {
    console.log('Checking for new reports...');
    console.log(`Navigating to URL: ${url}`);
    
    // Add retry logic for navigation
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        // Navigate to the page and wait for content to load
        await page.goto(url, { 
          waitUntil: 'networkidle0',
          timeout: 60000
        });
        console.log('Page loaded successfully');
        
        // Verify we're on the correct page
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);
        
        if (currentUrl.includes('/login')) {
          console.log('Redirected to login page - session may have expired');
          throw new Error('Authentication required');
        }
        
        // Wait for the content to be fully loaded
        await page.waitForSelector('a[href*="/reports/"]', {
          timeout: 30000,
          visible: true
        });
        console.log('Found report links on page');
        
        // Verify we can actually see the content
        const pageText = await page.evaluate(() => document.body.innerText);
        if (pageText.toLowerCase().includes('sign in') || pageText.toLowerCase().includes('log in')) {
          console.log('Found login text on page - session may be invalid');
          throw new Error('Invalid session');
        }
        
        break; // If we get here, everything is good
      } catch (error) {
        retryCount++;
        console.log(`Attempt ${retryCount} failed:`, error.message);
        
        if (retryCount === maxRetries) {
          throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Retrying...');
      }
    }
    
    // Get page metrics
    const metrics = await page.metrics();
    console.log('Page metrics:', JSON.stringify(metrics, null, 2));
    
    // Take a screenshot of the current state
    await page.screenshot({ path: 'current-page-state.png', fullPage: true });
    
    // Extract links from the current page
    const links = await page.evaluate(() => {
      const reportLinks = document.querySelectorAll('a[href*="/reports/"]');
      console.log(`Found ${reportLinks.length} report links`);
      
      const uniqueLinks = new Map();
      const debugInfo = {
        totalElementsFound: reportLinks.length,
        elementDetails: []
      };
      
      reportLinks.forEach(el => {
        const url = el.href;
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        
        debugInfo.elementDetails.push({
          url: url,
          visible: isVisible,
          position: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          },
          text: el.textContent.trim()
        });
        
        if (url && !uniqueLinks.has(url)) {
          uniqueLinks.set(url, {
            url: url,
            title: el.textContent.trim() || el.getAttribute('title') || el.getAttribute('aria-label') || ''
          });
        }
      });
      
      return {
        links: Array.from(uniqueLinks.values()),
        debug: debugInfo
      };
    });
    
    // Log debug information
    console.log('\nDebug Information:');
    console.log(`Total elements found: ${links.debug.totalElementsFound}`);
    console.log('Element details:', JSON.stringify(links.debug.elementDetails, null, 2));
    
    // Save the current page content for verification
    const content = await page.content();
    await fs.writeFile('current-page.html', content);
    
    // Prepare links
    const now = new Date().toISOString();
    const preparedLinks = links.links.map(link => ({
      url: link.url,
      title: link.title || "Untitled Report",
      body: "",
      timestamp: now,
      scrapedAt: now,
      lastChecked: now,
      summary: "",
      publicationDate: now
    }));
    
    if (preparedLinks.length === 0) {
      console.warn('No links found - this might indicate a problem');
      throw new Error('No links found on page');
    }
    
    console.log(`\nFound ${preparedLinks.length} unique reports:`);
    preparedLinks.forEach((link, index) => {
      console.log(`${index + 1}. ${link.title}: ${link.url}`);
    });
    
    return preparedLinks;
  } catch (error) {
    console.error('Error in checkForNewReports:', error);
    // Save error state
    try {
      const errorContent = await page.content();
      await fs.writeFile('error-state.html', errorContent);
      await page.screenshot({ path: 'error-state.png', fullPage: true });
      console.log('Error state saved to error-state.html and error-state.png');
    } catch (debugError) {
      console.error('Failed to save error state:', debugError);
    }
    throw error;
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
    
    console.log(`Currently have ${visitedLinks.length} reports in ${visitedLinksPath}`);
    
    // Find new links
    const newLinks = links.filter(link => !visitedUrls.has(link.url));
    
    if (newLinks.length === 0) {
      console.log('No new reports found');
    } else {
      console.log(`Found ${newLinks.length} new reports!`);
      newLinks.forEach(link => console.log(`- ${link.title}: ${link.url}`));
    }
    
    return {
      newLinks,
      visitedLinks
    };
  } catch (error) {
    console.error('Error finding new reports:', error);
    if (error.code === 'ENOENT') {
      console.log(`${visitedLinksPath} not found. Creating a new one.`);
      
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
    // Create backup of current visited_links.json
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupPath = `backups/visited_links.${timestamp}.json`;
    
    // Ensure backups directory exists
    await fs.mkdir('backups', { recursive: true });
    
    // Save backup
    await fs.writeFile(backupPath, JSON.stringify(visitedLinks, null, 2));
    console.log(`Backup created at ${backupPath}`);
    
    // Validate and ensure all newLinks have all required fields
    const now = new Date().toISOString();
    const validatedNewLinks = newLinks.map(link => {
      return {
        url: link.url,
        title: link.title || "Untitled Report",
        body: link.body || "",
        timestamp: link.timestamp || now,
        scrapedAt: link.scrapedAt || now,
        lastChecked: link.lastChecked || now,
        summary: link.summary || "",
        publicationDate: link.publicationDate || now
      };
    });
    
    // Update visited links with new ones
    const updatedVisitedLinks = [...visitedLinks, ...validatedNewLinks];
    
    // Sort by publicationDate in descending order (newest first)
    updatedVisitedLinks.sort((a, b) => {
      // Extract dates for comparison
      const dateA = new Date(a.publicationDate || 0);
      const dateB = new Date(b.publicationDate || 0);
      
      // Sort in descending order (newest first)
      return dateB - dateA;
    });
    
    // Save updated visited links
    await fs.writeFile(visitedLinksPath, JSON.stringify(updatedVisitedLinks, null, 2));
    console.log(`Updated ${visitedLinksPath} with ${validatedNewLinks.length} new reports and sorted by publication date`);
    
    return updatedVisitedLinks;
  } catch (error) {
    console.error('Error updating visited links:', error);
    return visitedLinks;
  }
}

module.exports = {
  checkForNewReports,
  findNewReports,
  updateVisitedLinks
}; 