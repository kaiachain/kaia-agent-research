require('dotenv').config();
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const puppeteer = require('puppeteer');
const path = require('path');
const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Initialize Slack Web API
const slack = new WebClient(process.env.SLACK_TOKEN);
const slackChannel = process.env.SLACK_CHANNEL_ID;

// Cookie file path
const COOKIES_FILE = path.join(process.cwd(), 'delphi_cookies.json');
// Cache file path
const CACHE_FILE = path.join(process.cwd(), 'processed_reports_cache.json');

// Check for command line arguments
const args = process.argv.slice(2);
const forceReprocessUrls = [];
let forceReprocessCount = 0;
let forceSummaries = false;

// Process command line arguments
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force-url' && args[i + 1]) {
        forceReprocessUrls.push(args[i + 1]);
        i++; // Skip next arg
    } else if (args[i] === '--force-latest' && args[i + 1]) {
        forceReprocessCount = parseInt(args[i + 1], 10);
        if (isNaN(forceReprocessCount)) forceReprocessCount = 0;
        i++; // Skip next arg
    } else if (args[i] === '--force-summaries') {
        forceSummaries = true;
    }
}

// Function to send message to Slack
async function sendSlackMessage(message, blocks = []) {
    try {
        if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL_ID) {
            console.log('Slack credentials not configured, skipping notification');
            return false;
        }

        const result = await slack.chat.postMessage({
            channel: slackChannel,
            text: message,
            blocks: blocks.length > 0 ? blocks : undefined
        });

        console.log(`Message sent to Slack: ${result.ts}`);
        return true;
    } catch (error) {
        console.error('Error sending message to Slack:', error);
        return false;
    }
}

// Function to format a report for Slack
function formatReportForSlack(report) {
    // Split the summary into main summary and Kaia relevance
    let mainSummary = report.summary;
    let kaiaRelevance = '';
    
    // Check if there are distinct parts in the summary
    const summaryParts = report.summary.split('\n\n');
    if (summaryParts.length >= 2) {
        mainSummary = summaryParts[0];
        // The second part should be the Kaia relevance
        kaiaRelevance = summaryParts[1];
    }
    
    const publishDate = new Date(report.publicationDate).toLocaleDateString();
    
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": report.title
            }
        },
        {
            "type": "divider"
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*Summary:*\n${mainSummary}`
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*Relevance to Kaia:*\n${kaiaRelevance}`
            }
        },
        {
            "type": "section",
            "fields": [
                {
                    "type": "mrkdwn",
                    "text": `*Published:*\n${publishDate}`
                },
                {
                    "type": "mrkdwn",
                    "text": `*Source:*\n<${report.url}|View Original Report>`
                }
            ]
        }
    ];
}

// Function to get summary using Gemini
async function getSummaryFromGemini(title, body) {
    try {
        // Initialize with specific model configuration
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-lite",
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
        });
        
        const prompt = `
Summarize this Delphi Digital report directly without any introductory phrases.
Title: ${title}

Content:
${body}

Your response should have two parts:
1. A direct, concise summary of the report in one sentence (max 160 characters).
2. A brief one-liner explaining why this research/topic is relevant to the Kaia ecosystem and technology stack.

Do not use phrases like "Here's a summary" or "This report discusses". Start directly with the core information.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Error getting summary from Gemini:', error);
        return null;
    }
}

// Function to extract content from an article
async function extractContent(page, url) {
    try {
        console.log(`\nNavigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        // Wait for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Extract publication date
        const publicationDate = await page.evaluate(() => {
            // Try to get date from JSON-LD structured data
            const jsonLd = document.querySelector('script[type="application/ld+json"]');
            if (jsonLd) {
                try {
                    const data = JSON.parse(jsonLd.textContent);
                    if (data.datePublished) {
                        return data.datePublished;
                    }
                } catch (e) {
                    // JSON parsing failed, continue with other methods
                }
            }
            
            // Try meta tags
            const metaPublishedTime = document.querySelector('meta[property="article:published_time"]');
            if (metaPublishedTime) {
                return metaPublishedTime.getAttribute('content');
            }
            
            // Try common date patterns in the page
            const dateElement = document.querySelector('.publish-date, .date, .article-date, time');
            if (dateElement) {
                if (dateElement.getAttribute('datetime')) {
                    return dateElement.getAttribute('datetime');
                }
                return dateElement.textContent.trim();
            }
            
            return null;
        });

        if (publicationDate) {
            console.log(`Publication date found: ${publicationDate}`);
        } else {
            console.log('No publication date found');
        }

        // Save the page HTML for debugging
        const pageContent = await page.content();
        await fs.writeFile('article-page.html', pageContent);
        console.log('Saved article page HTML for debugging');

        // Take a screenshot
        await page.screenshot({ path: 'article-page.png', fullPage: true });
        console.log('Saved article page screenshot');

        // Log all available selectors on the page
        const selectors = await page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            const classes = new Set();
            const ids = new Set();
            
            elements.forEach(el => {
                // Get classes
                el.classList.forEach(cls => classes.add(cls));
                // Get ids
                if (el.id) ids.add(el.id);
            });
            
            return {
                classes: Array.from(classes),
                ids: Array.from(ids)
            };
        });
        
        console.log('\nAvailable classes:', selectors.classes);
        console.log('Available IDs:', selectors.ids);

        // Try to wait for any of our selectors
        const contentSelectors = [
            // Main content selectors
            '[role="main"]',
            'main',
            '#__next main',
            // Article selectors
            'article',
            '.article',
            '.article-body',
            '.article-content',
            // Report selectors
            '.report',
            '.report-content',
            '.report-body',
            // Generic content selectors
            '.content',
            '.content-area',
            '.main-content',
            // Markdown/prose selectors
            '.markdown',
            '.prose',
            '.rich-text',
            // Specific content wrappers
            '.post-content',
            '.page-content',
            '#content'
        ];

        console.log('\nTrying to find content with selectors:', contentSelectors);

        // Wait for any of the selectors to appear
        try {
            await page.waitForFunction(
                (selectors) => {
                    return selectors.some(selector => {
                        const el = document.querySelector(selector);
                        return el && el.textContent.trim().length > 0;
                    });
                },
                { timeout: 30000 },
                contentSelectors
            );
            console.log('Found matching content selector');
        } catch (error) {
            console.log('No matching selector found:', error.message);
        }

        // Extract content
        const content = await page.evaluate((selectors) => {
            // Function to clean text content
            const cleanText = (text) => {
                return text
                    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                    .replace(/\n+/g, '\n')  // Replace multiple newlines with single newline
                    .trim();
            };

            // Try each selector
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // Remove unwanted elements
                    ['script', 'style', 'nav', 'header', 'footer'].forEach(tag => {
                        element.querySelectorAll(tag).forEach(el => el.remove());
                    });

                    // Get text content
                    const text = cleanText(element.textContent);
                    if (text.length > 100) { // Ensure we have substantial content
                        return {
                            text,
                            selector: selector
                        };
                    }
                }
            }

            // If no content found in main selectors, try to get content from the body
            const mainContent = document.querySelector('body main') || document.body;
            const text = cleanText(mainContent.textContent);
            return text.length > 100 ? { text, selector: 'body' } : null;
        }, contentSelectors);

        if (!content) {
            console.warn('Warning: No content found in the article body');
            return { content: null, publicationDate };
        }

        console.log('Successfully extracted content using selector:', content.selector);
        return { content: content.text, publicationDate };
    } catch (error) {
        console.error('Error extracting content:', error.message);
        return { content: null, publicationDate: null };
    }
}

// Function to save cookies to a file
async function saveCookies(page) {
    try {
        // Get cookies for the specific domain
        const cookies = await page.cookies('https://members.delphidigital.io');
        await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        console.log(`${cookies.length} cookies saved to ${COOKIES_FILE}`);
        
        // Log cookie names for debugging
        const cookieNames = cookies.map(cookie => cookie.name).join(', ');
        console.log(`Cookie names: ${cookieNames}`);
        
        return true;
    } catch (error) {
        console.error('Error saving cookies:', error);
        return false;
    }
}

// Function to load cookies from file
async function loadCookies(page) {
    try {
        // Check if cookies file exists
        try {
            await fs.access(COOKIES_FILE);
        } catch (error) {
            console.log('No cookies file found, will proceed with normal login');
            return false;
        }

        // Read and parse cookies
        const cookiesString = await fs.readFile(COOKIES_FILE, 'utf8');
        const cookies = JSON.parse(cookiesString);
        
        if (cookies.length === 0) {
            console.log('No cookies found in file');
            return false;
        }

        // Log cookie info for debugging
        console.log(`Loading ${cookies.length} cookies from file`);
        const cookieNames = cookies.map(cookie => cookie.name).join(', ');
        console.log(`Cookie names: ${cookieNames}`);

        // Set cookies
        for (const cookie of cookies) {
            // Make sure to set the cookies with correct domain fields
            await page.setCookie(cookie);
        }
        
        console.log(`Loaded ${cookies.length} cookies from ${COOKIES_FILE}`);
        return true;
    } catch (error) {
        console.error('Error loading cookies:', error);
        return false;
    }
}

// Function to verify if loaded cookies are valid
async function verifyCookieLogin(page) {
    try {
        console.log('Verifying cookie authentication...');
        await page.goto('https://members.delphidigital.io/reports', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Take a screenshot
        await page.screenshot({ path: 'cookie-login-check.png', fullPage: true });
        
        // Check if we're logged in
        const isLoggedIn = await page.evaluate(() => {
            // Check for elements that would indicate we're logged in
            const hasLoginForm = document.querySelector('form input[type="password"]') !== null;
            const hasReports = document.querySelector('.reports-container, .article-list, .content-area, .dashboard') !== null;
            
            // Look for logout link or button
            const logoutElements = Array.from(document.querySelectorAll('a, button')).filter(el => {
                const text = el.textContent.toLowerCase();
                const href = el.getAttribute('href') || '';
                return text.includes('logout') || text.includes('sign out') || href.includes('logout');
            });
            
            return (!hasLoginForm && (hasReports || logoutElements.length > 0));
        });

        if (isLoggedIn) {
            console.log('Successfully authenticated using cookies');
            return true;
        } else {
            console.log('Cookie authentication failed, will proceed with normal login');
            return false;
        }
    } catch (error) {
        console.error('Error verifying cookie login:', error);
        return false;
    }
}

// Function to handle login
async function login(page) {
    try {
        // Try to use cookies first
        const cookiesLoaded = await loadCookies(page);
        if (cookiesLoaded) {
            const cookieLoginSuccessful = await verifyCookieLogin(page);
            if (cookieLoginSuccessful) {
                return true;
            }
            // If cookie login failed, continue with normal login
        }
        
        // Go to the login page
        console.log('Navigating to login page...');
        await page.goto('https://members.delphidigital.io/login', { 
            waitUntil: 'networkidle0',
            timeout: 60000 
        });

        // Wait for any login-related element to appear
        console.log('Waiting for login form...');
        await page.waitForSelector('form, input[type="email"], .login-container', { timeout: 30000 });

        // Take a screenshot of what we see
        await page.screenshot({ path: 'login-page.png', fullPage: true });
        console.log('Saved screenshot of login page to login-page.png');

        // Get the page content for debugging
        const pageContent = await page.content();
        await fs.writeFile('login-page.html', pageContent);
        console.log('Saved login page HTML for debugging');

        // Wait a bit for any dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // First fill in the email and password
        console.log('Entering credentials...');
        await page.evaluate((email, password) => {
            const emailInput = document.querySelector('input[type="email"], #email');
            const passwordInput = document.querySelector('input[type="password"], #password');
            
            if (emailInput) {
                emailInput.value = email;
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            if (passwordInput) {
                passwordInput.value = password;
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, process.env.DELPHI_EMAIL, process.env.DELPHI_PASSWORD);

        // Now find and click the submit button using multiple approaches
        console.log('Looking for submit button...');
        const formSubmitted = await page.evaluate(() => {
            // Try different button selectors
            const buttonSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button.submit',
                'button.login-button',
                'button:not([type])',
                'button.outline-none',
                'button'
            ];

            for (const selector of buttonSelectors) {
                const buttons = Array.from(document.querySelectorAll(selector));
                const loginButton = buttons.find(button => {
                    const text = button.textContent.toLowerCase();
                    return text.includes('sign in') || 
                           text.includes('log in') || 
                           text.includes('login') ||
                           text.includes('submit');
                });
                
                if (loginButton) {
                    // Try to submit the form
                    const form = loginButton.closest('form');
                    if (form) {
                        form.dispatchEvent(new Event('submit', { bubbles: true }));
                        return true;
                    } else {
                        loginButton.click();
                        return true;
                    }
                }
            }
            return false;
        });

        if (!formSubmitted) {
            throw new Error('Could not submit form');
        }

        // Wait for navigation or auth response
        console.log('Waiting for auth response...');
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
            page.waitForResponse(
                response => response.url().includes('/api/auth') || response.url().includes('/login'),
                { timeout: 30000 }
            )
        ]);

        // Wait a bit for any redirects
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify login success
        console.log('Verifying login...');
        await page.goto('https://members.delphidigital.io/reports', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Take a screenshot after login attempt
        await page.screenshot({ path: 'after-login.png', fullPage: true });
        
        // Save the page HTML for debugging
        const afterLoginContent = await page.content();
        await fs.writeFile('after-login.html', afterLoginContent);

        const isLoggedIn = await page.evaluate(() => {
            // Check for elements that would indicate we're logged in
            const hasLoginForm = document.querySelector('form input[type="password"]') !== null;
            const hasReports = document.querySelector('.reports-container, .article-list, .content-area, .dashboard') !== null;
            
            // Look for logout link or button
            const logoutElements = Array.from(document.querySelectorAll('a, button')).filter(el => {
                const text = el.textContent.toLowerCase();
                const href = el.getAttribute('href') || '';
                return text.includes('logout') || text.includes('sign out') || href.includes('logout');
            });
            
            return (!hasLoginForm && (hasReports || logoutElements.length > 0));
        });

        if (isLoggedIn) {
            console.log('Successfully logged in');
            
            // Save cookies for future use
            await saveCookies(page);
            
            return true;
        } else {
            throw new Error('Login verification failed');
        }
    } catch (error) {
        console.error('Login failed:', error.message);
        // Take a screenshot of the failed login attempt
        try {
            await page.screenshot({ path: 'login-failed.png', fullPage: true });
            console.log('Saved screenshot of failed login attempt to login-failed.png');
            
            // Save the page HTML for debugging
            const pageContent = await page.content();
            await fs.writeFile('login-failed.html', pageContent);
            console.log('Saved failed login page HTML for debugging');
        } catch (screenshotError) {
            console.error('Failed to save error data:', screenshotError);
        }
        return false;
    }
}

// Function to load the cache file
async function loadCache() {
    try {
        try {
            // Check if cache file exists
            await fs.access(CACHE_FILE);
        } catch (error) {
            // Create new cache file if it doesn't exist
            console.log('No cache file found, creating new one');
            await fs.writeFile(CACHE_FILE, JSON.stringify({}, null, 2));
            return {};
        }

        // Read and parse cache
        const cacheString = await fs.readFile(CACHE_FILE, 'utf8');
        const cache = JSON.parse(cacheString);
        console.log(`Loaded cache with ${Object.keys(cache).length} processed reports`);
        return cache;
    } catch (error) {
        console.error('Error loading cache:', error);
        return {};
    }
}

// Function to update the cache
async function updateCache(url, entry, contentHash, cache) {
    try {
        // Update cache with this entry
        cache[url] = {
            url: url,
            title: entry.title,
            lastProcessed: new Date().toISOString(),
            contentHash: contentHash,
            hasSummary: !!entry.summary,
            publicationDate: entry.publicationDate || null
        };
        
        // Save updated cache
        await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
        return true;
    } catch (error) {
        console.error('Error updating cache:', error);
        return false;
    }
}

// Helper function to create a hash of content
function createContentHash(content) {
    return crypto.createHash('md5').update(content || '').digest('hex');
}

// Function to check if a report needs processing
function needsProcessing(cache, entry, content) {
    // If no URL, we can't track it
    if (!entry.url) return false;
    
    // Get the content hash
    const contentHash = createContentHash(content);
    
    // If not in cache or no summary, process it
    if (!cache[entry.url] || !entry.summary) return { needsProcessing: true, contentHash };
    
    // If content has changed since last processing, process it
    if (cache[entry.url].contentHash !== contentHash) {
        return { needsProcessing: true, contentHash };
    }
    
    // No need to process
    return { needsProcessing: false, contentHash };
}

// Main function to process all links
async function processAllLinks() {
    console.log('Starting summarization process...');
    
    // Load cache
    const cache = await loadCache();
    
    // Read the JSON file
    const jsonData = JSON.parse(await fs.readFile('visited_links.json', 'utf8'));
    const links = Object.values(jsonData);
    
    console.log(`Found ${links.length} links to process`);
    
    // Filter links that need processing based on cache
    const linksToProcess = [];
    const linksToSkip = [];
    const reprocessingFailed = []; // Track links we're reprocessing due to previous failures
    const forcedReprocess = []; // Track links we're forcing to reprocess
    
    // If force latest is specified, select the latest N links
    let forceLatestLinks = [];
    if (forceReprocessCount > 0) {
        // Sort links by publication date (if available) or last checked date
        const sortedLinks = [...links].sort((a, b) => {
            const dateA = a.publicationDate ? new Date(a.publicationDate) : new Date(a.lastChecked);
            const dateB = b.publicationDate ? new Date(b.publicationDate) : new Date(b.lastChecked);
            return dateB - dateA; // Latest first
        });
        
        forceLatestLinks = sortedLinks.slice(0, forceReprocessCount);
        console.log(`Forcing reprocessing of ${forceLatestLinks.length} latest links`);
    }
    
    for (const entry of links) {
        const url = entry.url;
        
        // Skip entries without URL
        if (!url) continue;
        
        // Check if this entry is forced to reprocess
        const isForced = forceReprocessUrls.includes(url) || 
                         forceLatestLinks.some(link => link.url === url);
        
        if (isForced) {
            linksToProcess.push(entry);
            forcedReprocess.push(url);
            continue;
        }
        
        // Check if this entry has failed previously
        const isFailed = cache[url] && !cache[url].hasSummary;
        
        // Mark for reprocessing if it's a previously failed entry
        if (isFailed) {
            linksToProcess.push(entry);
            reprocessingFailed.push(url);
            continue;
        }
        
        // If in cache and has summary, we can skip it
        if (cache[url] && entry.summary) {
            // Check if the entry has been updated since we processed it
            // For now, assume unchanged if in cache (will check content later)
            linksToSkip.push(entry);
        } else {
            linksToProcess.push(entry);
        }
    }
    
    console.log(`${linksToProcess.length} links need processing, ${linksToSkip.length} can be skipped`);
    if (reprocessingFailed.length > 0) {
        console.log(`Reprocessing ${reprocessingFailed.length} previously failed links`);
    }
    if (forcedReprocess.length > 0) {
        console.log(`Force reprocessing ${forcedReprocess.length} links`);
    }
    
    // If nothing to process, exit early
    if (linksToProcess.length === 0) {
        console.log('No reports need processing, exiting');
        return;
    }
    
    // Launch browser
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-web-security', // Disable CORS
            '--disable-features=IsolateOrigins,site-per-process' // Allow cross-origin iframes
        ]
    });
    
    try {
        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });
        
        // Set user agent to appear more like a regular browser
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // First try to log in
        console.log('Attempting to log in...');
        const loginSuccess = await login(page);
        
        if (!loginSuccess) {
            console.log('Failed to log in. Aborting.');
            return;
        }

        console.log('Successfully logged in to Delphi Digital');

        let processed = 0;
        let successful = 0;
        let failed = 0;
        let newSummaries = 0;
        let skipped = linksToSkip.length;
        let skippedDuringProcessing = 0;

        // Process each link
        for (const [index, entry] of linksToProcess.entries()) {
            processed++;
            console.log(`\nProcessing (${processed}/${linksToProcess.length}): ${entry.url}`);
            
            try {
                // Extract content and publication date
                const { content, publicationDate } = await extractContent(page, entry.url);
                
                // Check if this content needs processing
                const { needsProcessing: shouldProcess, contentHash } = needsProcessing(cache, entry, content);
                
                // Update cache with new content hash
                await updateCache(entry.url, entry, contentHash, cache);
                
                // Skip if content hasn't changed and we already have a summary
                if (!forceSummaries && !shouldProcess && entry.summary) {
                    console.log('Content unchanged, skipping summary generation');
                    // Still update publication date if found
                    if (publicationDate && !entry.publicationDate) {
                        entry.publicationDate = publicationDate;
                        jsonData[entry.url] = entry;
                        await fs.writeFile('visited_links.json', JSON.stringify(jsonData, null, 2));
                        console.log('Publication date saved successfully');
                    }
                    skippedDuringProcessing++;
                    continue;
                }
                
                // If force-summaries is true, log it
                if (forceSummaries && !shouldProcess && entry.summary) {
                    console.log('Force regenerating summary despite unchanged content');
                }
                
                if (!content) {
                    console.log('No content extracted, keeping original data');
                    
                    // Still update publication date if found
                    if (publicationDate) {
                        entry.publicationDate = publicationDate;
                        jsonData[entry.url] = entry;
                        await fs.writeFile('visited_links.json', JSON.stringify(jsonData, null, 2));
                        console.log('Publication date saved successfully');
                    }
                    
                    failed++;
                    continue;
                }

                // Get summary from Gemini
                console.log('Getting summary from Gemini...');
                const summary = await getSummaryFromGemini(entry.title, content);
                
                if (!summary) {
                    console.log('Failed to get summary, keeping original data');
                    
                    // Still update publication date if found
                    if (publicationDate) {
                        entry.publicationDate = publicationDate;
                        jsonData[entry.url] = entry;
                        await fs.writeFile('visited_links.json', JSON.stringify(jsonData, null, 2));
                        console.log('Publication date saved successfully');
                    }
                    
                    failed++;
                    continue;
                }

                // Check if summary is new or changed
                const hadPreviousSummary = !!entry.summary;
                const summaryChanged = entry.summary !== summary;
                
                // Update the entry with the summary and publication date
                entry.summary = summary;
                if (publicationDate) {
                    entry.publicationDate = publicationDate;
                }
                jsonData[entry.url] = entry;

                // Save after each successful update
                await fs.writeFile('visited_links.json', JSON.stringify(jsonData, null, 2));
                console.log('Summary and publication date saved successfully');
                
                // Update cache with newly processed entry
                await updateCache(entry.url, entry, contentHash, cache);
                
                successful++;
                
                // Send notification to Slack for new or updated summaries
                if (!hadPreviousSummary || summaryChanged) {
                    newSummaries++;
                    await sendSlackMessage(entry.title, formatReportForSlack(entry));
                }

                // Add a delay between requests
                if (index < linksToProcess.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error('Error processing link:', error);
                failed++;
            }
        }

        const totalSkipped = skipped + skippedDuringProcessing;
        
        console.log('\nSummarization complete:');
        console.log(`- Total links: ${links.length}`);
        console.log(`- Processed: ${processed}`);
        console.log(`- Initially skipped (cached): ${skipped}`);
        console.log(`- Skipped during processing: ${skippedDuringProcessing}`);
        console.log(`- Total skipped: ${totalSkipped}`);
        console.log(`- Successful: ${successful}`);
        console.log(`- Failed: ${failed}`);
        console.log(`- New/Updated summaries: ${newSummaries}`);
        
    } finally {
        await browser.close();
    }
}

// Run the main function
processAllLinks().catch(async (error) => { 
    console.error(error);
    // Send error notification to Slack
    await sendSlackMessage(`❌ *Error in Delphi Digital processing*\n\`\`\`${error.message}\`\`\``);
}); 