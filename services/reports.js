const fs = require('fs').promises;
const logger = require('../scripts/logger'); // Import the shared logger

/**
 * Fetches report links from the Delphi website, stopping when the last visited link is found.
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the Delphi reports page.
 * @param {string|null} lastVisitedUrl - The URL of the last report processed.
 * @returns {Promise<Array<{url: string, title: string}>>} - Array of new report links (newest first).
 */
async function checkForNewReports(page, url, lastVisitedUrl) {
  try {
    // console.log('Checking for new reports...');
    logger.info('Checking for new reports...');
    // console.log(`Navigating to URL: ${url}`);
    logger.info(`Navigating to URL: ${url}`);
    
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
        // console.log('Page loaded successfully');
        logger.info('Page loaded successfully');
        
        // Verify we're on the correct page
        const currentUrl = page.url();
        // console.log('Current URL:', currentUrl);
        logger.info(`Current URL: ${currentUrl}`);
        
        if (currentUrl.includes('/login')) {
          // console.log('Redirected to login page - session may have expired');
          logger.warn('Redirected to login page - session may have expired');
          throw new Error('Authentication required, redirected to login page');
        }
        
        // Wait for the content to be fully loaded
        await page.waitForSelector('a[href*="/reports/"]', {
          timeout: 30000,
          visible: true
        });
        // console.log('Found report links on page');
        logger.info('Found report links indicator on page');
        
        // Verify we can actually see the content
        const pageText = await page.evaluate(() => document.body.innerText);
        if (pageText.toLowerCase().includes('sign in to continue') || pageText.toLowerCase().includes('log in to access')) {
          // console.log('Found login text on page - session may be invalid');
           logger.warn('Found login prompt text on page - session may be invalid or expired.');
          throw new Error('Invalid session: Login prompt detected on page');
        }
        
        break; // If we get here, everything is good
      } catch (error) {
        retryCount++;
        // console.log(`Attempt ${retryCount} failed:`, error.message);
        logger.warn(`Attempt ${retryCount} to load reports page failed: ${error.message}`);
        
        if (retryCount === maxRetries) {
           logger.error(`Failed to load reports page after ${maxRetries} attempts: ${error.message}`);
          throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        // console.log('Retrying...');
        logger.info(`Retrying page load (attempt ${retryCount + 1})...`);
      }
    }
    
    // Get page metrics
    const metrics = await page.metrics();
    // console.log('Page metrics:', JSON.stringify(metrics, null, 2));
    logger.debug('Page metrics:', { metrics }); // Log metrics object at debug level
    
    // Extract links from the current page
    const linksData = await page.evaluate((stopUrl) => {
      const reportLinks = document.querySelectorAll('a[href*="/reports/"]');
      console.log(`[Browser] Found ${reportLinks.length} potential report links on page`); // Keep console for evaluate
      
      const newLinks = [];
      const uniqueUrls = new Set(); // Keep track of URLs added

      for (const el of reportLinks) {
        const currentUrl = el.href;
        const title = el.textContent.trim() || el.getAttribute('title') || el.getAttribute('aria-label') || '';

        // Stop if we hit the last visited URL
        if (stopUrl && currentUrl === stopUrl) {
          console.log(`[Browser] Reached last visited URL: ${stopUrl}. Stopping link collection.`);
          break; 
        }

        // Only add valid, unique URLs
        if (currentUrl && title && !uniqueUrls.has(currentUrl)) {
          newLinks.push({
            url: currentUrl,
            title: title
          });
          uniqueUrls.add(currentUrl);
           console.log(`[Browser] Added link: ${title} (${currentUrl})`);
        } else if (!uniqueUrls.has(currentUrl)) {
             console.log(`[Browser] Skipping link with no title: ${currentUrl}`);
        }
      }
      
      // Assuming the page lists newest first, the collected links are the new ones.
      return newLinks; 
    }, lastVisitedUrl); // Pass lastVisitedUrl into evaluate

    // Log debug information (optional)

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
      publicationDate: null // Initialize as null, should be fetched later if possible
    }));

    if (preparedLinks.length === 0) {
      // This is now expected if no *new* reports are found since the last visited one
      // console.log('No new reports found since the last visit.');
      logger.info('No new reports found since the last visit.');
    } else {
      // console.log(`\nFound ${preparedLinks.length} new reports since last visit:`);
      logger.info(`Found ${preparedLinks.length} new reports since last visit:`);
      preparedLinks.forEach((link, index) => {
        // console.log(`${index + 1}. ${link.title}: ${link.url}`);
        logger.debug(`${index + 1}. ${link.title}: ${link.url}`); // Log details at debug level
      });
    }
    
    // Return only the array of new links (newest first)
    return preparedLinks;
  } catch (error) {
    // console.error('Error in checkForNewReports:', error);
    logger.error(`Error in checkForNewReports: ${error.message}`, { stack: error.stack });
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

/**
 * Fetches the main textual content of a given report URL (Simplified).
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the report page.
 * @returns {Promise<string>} The extracted text content or error string.
 */
async function fetchReportContent(page, url) {
  // const timestamp = new Date().toISOString(); // Use logger timestamp instead
  try {
    // console.log(`[${timestamp}] INFO: Fetching content for: ${url}`);
    logger.info(`Fetching content for: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });

    const reportData = await page.evaluate(() => {
       const contentSelectors = [
         'article.report-content', // Specific class
         'div.prose', // Common class for markdown content
         'div.report-body', // Another possible class
         'article', // General article tag
         '#main-content', // Common ID for main content area
         'div[role="article"]' // Role attribute
       ];
       let element = null;
       for (const selector of contentSelectors) {
         element = document.querySelector(selector);
         if (element) break;
       }
       const bodyText = element ? element.innerText : document.body.innerText; // Fallback to body

        // Attempt to find publication date
       let publicationDate = null;
       const dateSelectors = [
           'time[datetime]', // Standard time element
           'span[class*="date" i]', // Class containing "date"
           'div[class*="publish" i]', // Class containing "publish"
           'p[class*="meta" i]' // Meta paragraph
       ];
       for (const selector of dateSelectors) {
           const dateElement = document.querySelector(selector);
           if (dateElement) {
               publicationDate = dateElement.getAttribute('datetime') || dateElement.textContent;
               if (publicationDate) break;
           }
       }

        // Clean up extracted date string if necessary
       if (publicationDate) {
           publicationDate = publicationDate.trim().replace(/^Published on /i, '');
           // Attempt to parse into a standard format (optional, can be done later)
           // try { publicationDate = new Date(publicationDate).toISOString(); } catch(e) { /* ignore parse error */ }
       }

       return { body: bodyText, publicationDate };
    });

    if (!reportData || !reportData.body || reportData.body.trim().length === 0) {
      // console.warn(`[${timestamp}] WARN: Fetched empty content for ${url}.`);
      logger.warn(`Fetched empty content for ${url}.`);
      // Save page source for debugging empty content
        try {
            const errorContent = await page.content();
            const errorStatePath = `error_empty_content_${url.split('/').pop()}_${Date.now()}.html`;
            await fs.writeFile(errorStatePath, errorContent);
            logger.info(`Saved page HTML for empty content debug to ${errorStatePath}`);
        } catch (debugError) {
            logger.error(`Failed to save empty content page HTML: ${debugError.message}`);
        }
      return "Error fetching content."; // Return specific error string
    }
    // console.log(`[${timestamp}] INFO: Fetched content successfully for ${url}. Length: ${reportData.body.length}`);
    logger.info(`Fetched content successfully for ${url}. Length: ${reportData.body.length}`);
     if (reportData.publicationDate) {
         logger.info(`Extracted publication date: ${reportData.publicationDate}`);
     }
     else {
          logger.warn(`Could not extract publication date for ${url}`);
     }

    // Return the main body content. The publication date might need separate handling or merging.
    // For now, let's return just the body to match the previous signature.
    // TODO: Refactor to return an object { body: string, publicationDate: string | null }
    return reportData.body; // Return only body for now

  } catch (error) {
    // console.error(`[${timestamp}] ERROR: Error fetching content for ${url}: ${error.message}`);
    logger.error(`Error fetching content for ${url}: ${error.message}`, { stack: error.stack });
    return "Error fetching content."; // Return specific error string
  }
}

module.exports = {
  checkForNewReports,
  // findNewReports, // Removed
  // updateVisitedLinks // Removed
  fetchReportContent
}; 