const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Store visited links
let visitedLinks = [];
let visitedUrls = new Set(); // For faster duplicate checking

// Configuration
const DELPHI_URL = 'https://members.delphidigital.io/search?access=pro';
const SCAN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const VISITED_LINKS_FILE = 'visited_links.json';
const VISITED_LINKS_BACKUP_DIR = 'backups';

// Function to sanitize text from unusual line terminators and control characters
function sanitizeText(text) {
    if (!text) return '';
    
    try {
        // Remove control characters and unusual line terminators
        return text
            // Remove all control characters (including Line/Paragraph Separators)
            .replace(/[\x00-\x1F\x7F-\x9F\u2028\u2029]/g, '')
            // Replace multiple spaces with single space
            .replace(/\s+/g, ' ')
            // Remove non-printable and special characters
            .replace(/[\uFFF0-\uFFFF]/g, '')
            // Normalize line endings to LF
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Trim whitespace
            .trim();
    } catch (error) {
        console.error('Error in sanitizeText:', error);
        return '';
    }
}

// Function to ensure backup directory exists
async function ensureBackupDir() {
    try {
        await fs.access(VISITED_LINKS_BACKUP_DIR);
    } catch {
        await fs.mkdir(VISITED_LINKS_BACKUP_DIR);
    }
}

// Function to create timestamped backup
async function createBackup() {
    try {
        await ensureBackupDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(VISITED_LINKS_BACKUP_DIR, `visited_links.${timestamp}.json`);
        await fs.copyFile(VISITED_LINKS_FILE, backupFile);
        console.log(`Created backup: ${backupFile}`);
    } catch (error) {
        console.error('Error creating backup:', error);
    }
}

// Function to clean and normalize JSON content
function normalizeJsonContent(jsonString) {
    try {
        // Parse and stringify to normalize the JSON structure
        const parsed = JSON.parse(jsonString);
        return JSON.stringify(parsed, null, 2)
            // Ensure consistent line endings
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Remove any remaining unusual line terminators
            .replace(/[\u2028\u2029]/g, '\n')
            + '\n'; // Add final newline
    } catch (error) {
        console.error('Error normalizing JSON:', error);
        return null;
    }
}

// Function to ensure the visited_links.json file exists with valid JSON
async function ensureValidJsonFile() {
    try {
        // Check if file exists
        try {
            await fs.access(VISITED_LINKS_FILE);
        } catch {
            // File doesn't exist, create it with empty array
            await fs.writeFile(VISITED_LINKS_FILE, '[]\n', 'utf8');
            return true;
        }

        // File exists, read and normalize content
        const data = await fs.readFile(VISITED_LINKS_FILE, 'utf8');
        const normalizedData = normalizeJsonContent(data);
        
        if (normalizedData === null) {
            // Invalid JSON, create backup and start fresh
            console.log('Invalid JSON found in visited_links.json. Creating backup and starting fresh.');
            await createBackup();
            await fs.writeFile(VISITED_LINKS_FILE, '[]\n', 'utf8');
            return true;
        }

        // Write back normalized content
        await fs.writeFile(VISITED_LINKS_FILE, normalizedData, 'utf8');
        return true;
    } catch (error) {
        console.error('Error ensuring valid JSON file:', error);
        return false;
    }
}

// Function to check if a link exists in visited_links.json
async function checkExistingLinks() {
    try {
        // First ensure we have a valid JSON file
        const isValid = await ensureValidJsonFile();
        if (!isValid) {
            throw new Error('Could not ensure valid JSON file');
        }

        // Read the file (we know it exists and is valid now)
        const data = await fs.readFile(VISITED_LINKS_FILE, 'utf8');
        const existingLinks = JSON.parse(data);
        
        if (!Array.isArray(existingLinks)) {
            console.log('visited_links.json does not contain an array. Starting fresh.');
            visitedLinks = [];
            visitedUrls = new Set();
            await fs.writeFile(VISITED_LINKS_FILE, '[]\n', 'utf8');
            return true;
        }

        visitedLinks = existingLinks;
        visitedUrls = new Set(existingLinks.map(link => link.url));
        console.log(`Loaded ${visitedUrls.size} existing links from visited_links.json`);
        return true;
    } catch (error) {
        console.error('Error reading visited_links.json:', error);
        // Create a fresh start
        try {
            await fs.writeFile(VISITED_LINKS_FILE, '[]\n', 'utf8');
            visitedLinks = [];
            visitedUrls = new Set();
            return true;
        } catch (writeError) {
            console.error('Failed to create new visited_links.json:', writeError);
            return false;
        }
    }
}

// Function to update visited URLs set
function updateVisitedUrlsSet() {
    visitedUrls = new Set(visitedLinks.map(link => link.url));
    console.log(`Tracking ${visitedUrls.size} unique URLs`);
}

// Function to save visited links with backup
async function saveVisitedLinks() {
    try {
        // Create backup before saving
        await createBackup();

        // Remove any duplicates and normalize data
        const uniqueLinks = new Map();
        visitedLinks.forEach(link => {
            if (link.url) {
                uniqueLinks.set(link.url, {
                    url: link.url,
                    title: sanitizeText(link.title || ''),
                    body: sanitizeText(link.body || ''),
                    timestamp: link.timestamp || new Date().toISOString(),
                    scrapedAt: link.scrapedAt || new Date().toISOString(),
                    lastChecked: new Date().toISOString()
                });
            }
        });
        
        const sanitizedLinks = Array.from(uniqueLinks.values());
        const jsonString = JSON.stringify(sanitizedLinks, null, 2) + '\n';
        
        // Write to temporary file first
        const tempFile = `${VISITED_LINKS_FILE}.temp`;
        await fs.writeFile(tempFile, jsonString, 'utf8');
        
        // Rename temp file to actual file (atomic operation)
        await fs.rename(tempFile, VISITED_LINKS_FILE);
        
        console.log(`Successfully saved ${sanitizedLinks.length} unique links`);
        console.log('Changes saved to visited_links.json');
    } catch (error) {
        console.error('Error in saveVisitedLinks:', error);
        // Try to restore from latest backup if save failed
        try {
            const backups = await fs.readdir(VISITED_LINKS_BACKUP_DIR);
            if (backups.length > 0) {
                // Get most recent backup
                const latestBackup = backups
                    .filter(f => f.startsWith('visited_links.'))
                    .sort()
                    .pop();
                if (latestBackup) {
                    const backupPath = path.join(VISITED_LINKS_BACKUP_DIR, latestBackup);
                    await fs.copyFile(backupPath, VISITED_LINKS_FILE);
                    console.log(`Restored from backup: ${latestBackup}`);
                }
            }
        } catch (restoreError) {
            console.error('Failed to restore from backup:', restoreError);
        }
    }
}

// Function to extract report details
async function extractReportDetails(page, link) {
    try {
        await page.goto(link, { waitUntil: 'networkidle0', timeout: 60000 });
        
        // Extract content from the report page
        const content = await page.evaluate(() => {
            const title = document.querySelector('h1')?.textContent || '';
            const body = document.querySelector('article')?.textContent || '';
            
            // Look for publication date in multiple ways
            let datePublished = '';
            
            // 1. Check meta tags first (most reliable)
            const metaDate = document.querySelector('meta[property="article:published_time"]')?.content ||
                           document.querySelector('meta[name="publication_date"]')?.content ||
                           document.querySelector('meta[name="date"]')?.content;
            
            if (metaDate) {
                datePublished = metaDate;
            } else {
                // 2. Look for structured data
                const scriptTags = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of scriptTags) {
                    try {
                        const jsonData = JSON.parse(script.textContent);
                        if (jsonData.datePublished) {
                            datePublished = jsonData.datePublished;
                            break;
                        }
                    } catch (e) {}
                }
                
                // 3. Look for visible date elements
                if (!datePublished) {
                    const timeElement = document.querySelector('time[datetime]') ||
                                      document.querySelector('[data-timestamp]') ||
                                      document.querySelector('.published-date') ||
                                      document.querySelector('.post-date');
                    
                    if (timeElement) {
                        datePublished = timeElement.getAttribute('datetime') ||
                                      timeElement.getAttribute('data-timestamp') ||
                                      timeElement.textContent;
                    }
                }
                
                // 4. Look for date patterns in the text
                if (!datePublished) {
                    const datePatterns = [
                        // Match patterns like "Mar 26, 2025" or "March 26, 2025"
                        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i,
                        // Match patterns like "26 March 2025"
                        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i,
                        // Match ISO-like dates
                        /\d{4}-\d{2}-\d{2}/
                    ];
                    
                    for (const pattern of datePatterns) {
                        const match = document.body.textContent.match(pattern);
                        if (match) {
                            datePublished = match[0];
                            break;
                        }
                    }
                }
            }

            return {
                title,
                body,
                datePublished
            };
        });
        
        // Parse and validate the date
        let parsedDate;
        if (content.datePublished) {
            try {
                parsedDate = new Date(content.datePublished);
                if (isNaN(parsedDate.getTime())) {
                    throw new Error('Invalid date');
                }
            } catch (e) {
                console.warn(`Could not parse date "${content.datePublished}" for ${link}, using current time`);
                parsedDate = new Date();
            }
        } else {
            parsedDate = new Date();
        }

        return {
            title: sanitizeText(content.title),
            body: sanitizeText(content.body),
            datePublished: parsedDate.toISOString()
        };
    } catch (error) {
        console.error(`Error extracting content from ${link}:`, error);
        return null;
    }
}

// Function to rescrape and update all existing links
async function rescrapeExistingLinks() {
    console.log('\n=== Starting full rescrape of existing links ===');
    
    // Load existing links
    const loadSuccess = await checkExistingLinks();
    if (!loadSuccess) {
        console.error('Failed to load existing links. Aborting rescrape.');
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Found ${visitedLinks.length} links to rescrape`);
        let updatedCount = 0;
        let failedCount = 0;

        // Create a new array for updated links
        const updatedLinks = [];

        for (const link of visitedLinks) {
            console.log(`\nProcessing (${updatedCount + 1}/${visitedLinks.length}): ${link.url}`);
            
            try {
                const content = await extractReportDetails(page, link.url);
                
                if (content) {
                    const updatedEntry = {
                        url: link.url,
                        title: content.title || link.title,
                        body: content.body || link.body,
                        datePublished: content.datePublished,
                        scrapedAt: new Date().toISOString(),
                        lastChecked: new Date().toISOString()
                    };
                    
                    updatedLinks.push(updatedEntry);
                    updatedCount++;
                    console.log(`Updated: ${link.url}`);
                    console.log(`Publication date: ${content.datePublished}`);
                } else {
                    // Keep existing data if scrape fails
                    updatedLinks.push({
                        ...link,
                        lastChecked: new Date().toISOString()
                    });
                    failedCount++;
                    console.log(`Failed to update: ${link.url}`);
                }
            } catch (error) {
                console.error(`Error processing ${link.url}:`, error);
                // Keep existing data
                updatedLinks.push({
                    ...link,
                    lastChecked: new Date().toISOString()
                });
                failedCount++;
            }

            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Update our global arrays
        visitedLinks = updatedLinks;
        updateVisitedUrlsSet();

        // Save the updated data
        await saveVisitedLinks();

        console.log('\n=== Rescrape Summary ===');
        console.log(`Total links processed: ${visitedLinks.length}`);
        console.log(`Successfully updated: ${updatedCount}`);
        console.log(`Failed to update: ${failedCount}`);

    } catch (error) {
        console.error('Error during rescrape:', error);
    } finally {
        await browser.close();
    }
}

// Main scraping function
async function scrapeDelphiReports() {
    // First check existing links
    const loadSuccess = await checkExistingLinks();
    if (!loadSuccess) {
        console.error('Failed to load existing links. Aborting scrape.');
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions'
        ]
    });

    try {
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('Fetching reports from Delphi Digital...');
        await page.goto(DELPHI_URL, { 
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Extract all report links
        const links = await page.evaluate(() => {
            const reportElements = document.querySelectorAll('a[href*="/reports/"]');
            const uniqueLinks = new Map();
            
            reportElements.forEach(el => {
                const url = el.href;
                if (url && !uniqueLinks.has(url)) {
                    uniqueLinks.set(url, {
                        url: url,
                        title: el.textContent.trim()
                    });
                }
            });
            
            return Array.from(uniqueLinks.values());
        });

        console.log(`\n=== Scan Results ===`);
        console.log(`Found ${links.length} total reports on page`);
        console.log(`Currently have ${visitedLinks.length} reports in visited_links.json`);
        
        // Debug: Print all found URLs
        console.log('\nFound URLs:');
        links.forEach(link => {
            const isVisited = visitedUrls.has(link.url);
            console.log(`- ${link.url} ${isVisited ? '(already saved)' : '(new)'}`);
        });
        
        // Quick check for new links using Set
        const newLinks = links.filter(link => !visitedUrls.has(link.url));
        
        if (newLinks.length === 0) {
            console.log('\nNo new reports found - all reports are already saved in visited_links.json');
            return;
        }

        console.log(`\nFound ${newLinks.length} new reports to process:`);
        newLinks.forEach(link => console.log(`- ${link.url}`));

        // Process only new links
        let processedCount = 0;
        let failedCount = 0;
        let savedCount = 0;

        for (const link of newLinks) {
            if (visitedUrls.has(link.url)) {
                console.log(`Skipping already processed report: ${link.title}`);
                continue;
            }
            
            processedCount++;
            console.log(`\nProcessing report ${processedCount}/${newLinks.length}: ${link.title}`);
            console.log(`URL: ${link.url}`);
            
            try {
                const content = await extractReportDetails(page, link.url);
                
                if (content) {
                    const newEntry = {
                        ...link,
                        ...content,
                        scrapedAt: new Date().toISOString(),
                        lastChecked: new Date().toISOString()
                    };
                    
                    // Add to our lists before saving
                    visitedLinks.push(newEntry);
                    visitedUrls.add(link.url);
                    
                    // Save after each successful extraction
                    try {
                        await saveVisitedLinks();
                        savedCount++;
                        console.log(`Saved report ${savedCount}: ${link.title}`);
                        
                        // Verify the save
                        const saved = await verifyLinkSaved(link.url);
                        if (!saved) {
                            console.error(`Warning: Failed to verify save for ${link.url}`);
                            failedCount++;
                        }
                    } catch (saveError) {
                        console.error(`Error saving link ${link.url}:`, saveError);
                        failedCount++;
                    }
                } else {
                    // Even if we can't get content, save the URL and title
                    const newEntry = {
                        url: link.url,
                        title: link.title,
                        body: '',
                        timestamp: new Date().toISOString(),
                        scrapedAt: new Date().toISOString(),
                        lastChecked: new Date().toISOString(),
                        error: 'Failed to extract content'
                    };
                    
                    visitedLinks.push(newEntry);
                    visitedUrls.add(link.url);
                    
                    try {
                        await saveVisitedLinks();
                        savedCount++;
                        console.log(`Saved report ${savedCount} (without content): ${link.title}`);
                    } catch (saveError) {
                        console.error(`Error saving link ${link.url}:`, saveError);
                        failedCount++;
                    }
                }
            } catch (processError) {
                console.error(`Error processing ${link.url}:`, processError);
                failedCount++;
            }
            
            // Add a small delay between requests to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Final summary
        console.log('\n=== Scraping Summary ===');
        console.log(`Total links found: ${links.length}`);
        console.log(`New links processed: ${processedCount}`);
        console.log(`Successfully saved: ${savedCount}`);
        console.log(`Failed: ${failedCount}`);
        console.log(`Total links in visited_links.json: ${visitedLinks.length}`);

    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }
}

// Function to verify a link was saved
async function verifyLinkSaved(url) {
    try {
        const data = await fs.readFile(VISITED_LINKS_FILE, 'utf8');
        const links = JSON.parse(data);
        return links.some(link => link.url === url);
    } catch (error) {
        console.error('Error verifying link save:', error);
        return false;
    }
}

// Main execution function
async function main() {
    console.log('Starting Delphi Digital report scraper...');
    
    // First rescrape all existing links to update timestamps
    await rescrapeExistingLinks();
    
    // Then continue with normal operation
    await scrapeDelphiReports();
    
    // Set up periodic scanning
    console.log(`Setting up periodic scan every ${SCAN_INTERVAL / (60 * 60 * 1000)} hours`);
    setInterval(async () => {
        console.log('\n=== Starting periodic scrape ===');
        await scrapeDelphiReports();
    }, SCAN_INTERVAL);
}

// Handle errors and cleanup
process.on('SIGINT', async () => {
    console.log('Saving visited links before exit...');
    await saveVisitedLinks();
    process.exit();
});

// Start the application
main().catch(console.error); 