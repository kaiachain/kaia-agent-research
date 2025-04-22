const fs = require('fs').promises;

/**
 * Fetches report links from the Delphi website, stopping when the last visited link is found.
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the Delphi reports page.
 * @param {string|null} lastVisitedUrl - The URL of the last report processed.
 * @returns {Promise<Array<{url: string, title: string}>>} - Array of new report links (newest first).
 */
async function checkForNewReports(page, url, lastVisitedUrl) {
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
    // await page.screenshot({ path: 'current-page-state.png', fullPage: true });
    
    // Extract links from the current page
    const linksData = await page.evaluate((stopUrl) => {
      const reportLinks = document.querySelectorAll('a[href*="/reports/"]');
      console.log(`Found ${reportLinks.length} potential report links on page`);
      
      const newLinks = [];
      const uniqueUrls = new Set(); // Keep track of URLs added

      for (const el of reportLinks) {
        const currentUrl = el.href;
        const title = el.textContent.trim() || el.getAttribute('title') || el.getAttribute('aria-label') || '';

        // Stop if we hit the last visited URL
        if (stopUrl && currentUrl === stopUrl) {
          console.log(`Reached last visited URL: ${stopUrl}. Stopping link collection.`);
          break; 
        }

        // Only add valid, unique URLs
        if (currentUrl && title && !uniqueUrls.has(currentUrl)) {
          newLinks.push({
            url: currentUrl,
            title: title
          });
          uniqueUrls.add(currentUrl);
        }
      }
      
      // Assuming the page lists newest first, the collected links are the new ones.
      return newLinks; 
    }, lastVisitedUrl); // Pass lastVisitedUrl into evaluate

    // Log debug information (optional)
    // console.log('\nDebug Information:', JSON.stringify(linksData.debug, null, 2));

    // Save the current page content for verification (optional)
    // const content = await page.content();
    // await fs.writeFile('current-page.html', content);

    // Prepare links (add other fields if needed by later processing)
    const now = new Date().toISOString();
    const preparedLinks = linksData.map(link => ({
      url: link.url,
      title: link.title || "Untitled Report",
      // Add other fields as needed, default timestamps
      body: "", 
      timestamp: now,
      scrapedAt: now,
      lastChecked: now,
      summary: "",
      publicationDate: now 
    }));

    if (preparedLinks.length === 0) {
      // This is now expected if no *new* reports are found since the last visited one
      console.log('No new reports found since the last visit.');
    } else {
      console.log(`\nFound ${preparedLinks.length} new reports since last visit:`);
      preparedLinks.forEach((link, index) => {
        console.log(`${index + 1}. ${link.title}: ${link.url}`);
      });
    }
    
    // Return only the array of new links (newest first)
    return preparedLinks;
  } catch (error) {
    console.error('Error in checkForNewReports:', error);
    // Save error state
    try {
      const errorContent = await page.content();
      await fs.writeFile('error-state.html', errorContent);
      // await page.screenshot({ path: 'error-state.png', fullPage: true });
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
// THIS FUNCTION IS NO LONGER NEEDED with the last_visited_link approach
/*
async function findNewReports(links, visitedLinksPath) {
  // ... implementation ...
}
*/

// Function to update visited links
// THIS FUNCTION IS NO LONGER NEEDED with the last_visited_link approach
// The tracking is now handled by writing the single last visited link.
/*
async function updateVisitedLinks(newLinks, visitedLinks, visitedLinksPath) {
  // ... implementation ...
}
*/

module.exports = {
  checkForNewReports,
  // findNewReports, // Removed
  // updateVisitedLinks // Removed
}; 