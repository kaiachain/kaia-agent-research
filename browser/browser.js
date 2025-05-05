const fs = require('fs').promises;
const { existsSync, readFileSync } = require('fs');
const puppeteer = require('puppeteer-core');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

// Function to save cookies from the browser session
async function saveCookies(page, cookiesFile) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(cookiesFile, JSON.stringify(cookies, null, 2));
    
    const cookieNames = cookies.map(cookie => cookie.name);
    logger.info(`${cookies.length} cookies saved to ${cookiesFile}`);
    logger.debug(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    logger.error(`Error saving cookies to ${cookiesFile}: ${error.message}`, { stack: error.stack });
    return false;
  }
}

// Function to load cookies into the browser session
async function loadCookies(page, cookiesFile) {
  try {
    const cookiesString = await fs.readFile(cookiesFile, 'utf8');
    const cookies = JSON.parse(cookiesString);
    
    if (!cookies || cookies.length === 0) {
      logger.info(`No cookies found in ${cookiesFile}`);
      return false;
    }
    
    await page.setCookie(...cookies);
    
    const cookieNames = cookies.map(cookie => cookie.name);
    logger.info(`Loaded ${cookies.length} cookies from ${cookiesFile}`);
    logger.debug(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info(`Cookies file not found at ${cookiesFile}. Proceeding with normal login.`);
    } else if (error instanceof SyntaxError) {
      logger.error(`Error parsing JSON from cookies file ${cookiesFile}: ${error.message}`);
    } else {
      logger.error(`Error loading cookies from ${cookiesFile}: ${error.message}`, { stack: error.stack });
    }
    return false;
  }
}

// Function to verify cookie login
async function verifyCookieLogin(page, url = 'https://members.delphidigital.io/reports') {
  try {
    logger.info('Verifying cookie authentication...');
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    // Check if we're logged in
    const isLoggedIn = await page.evaluate(() => {
      // Check for elements that would indicate we're logged in
      const hasLoginForm = document.querySelector('form input[type="password"], form input[name*="pass"], form #password') !== null;
      const hasUsernameField = document.querySelector('form input[type="email"], form input[name*="user"], form #username') !== null;
      // More robust check for reports/dashboard content
      const hasContentArea = document.querySelector('.reports-container, .article-list, .content-area, .dashboard, main[role="main"], #main-content') !== null;

      // Look for logout link or button more broadly
      const logoutElements = Array.from(document.querySelectorAll('a, button')).filter(el => {
        const text = (el.textContent || '').toLowerCase();
        const href = (el.getAttribute('href') || '');
        return text.includes('logout') || text.includes('sign out') || href.includes('logout') || href.includes('signout');
      });

      // We are likely logged in if there's no login form AND (there is dashboard content OR a logout button)
      return (!hasLoginForm || !hasUsernameField) && (hasContentArea || logoutElements.length > 0);
    });

    if (isLoggedIn) {
      logger.info('Successfully authenticated using cookies');
      return true;
    } else {
      logger.warn('Cookie authentication failed, proceeding with normal login');
      return false;
    }
  } catch (error) {
    if (error.message.includes('Navigation timeout') || error.message.includes('net::')) {
      logger.error(`Navigation error verifying cookie login at ${url}: ${error.message}`);
    } else {
      logger.error(`Error during page evaluation while verifying cookie login: ${error.message}`, { stack: error.stack });
    }
    return false;
  }
}

// Check if running in a Docker container
function isRunningInDocker() {
  try {
    return existsSync('/.dockerenv') || 
           (existsSync('/proc/1/cgroup') && 
            readFileSync('/proc/1/cgroup', 'utf-8').includes('docker'));
  } catch (error) {
    logger.warn(`Error checking for Docker environment: ${error.message}`);
    return false;
  }
}

// Find Chrome or Chromium on Linux using which command
function findLinuxChrome() {
  try {
    // If we're in a Docker container, first check for Chrome at the standard Docker location
    if (isRunningInDocker()) {
      const dockerChromePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
      ];
      
      for (const p of dockerChromePaths) {
        if (existsSync(p)) {
          logger.debug(`Using Docker Chrome path: ${p}`);
          return p;
        }
      }
    }
    
    // Try to find Chrome using the "which" command
    const browsers = [
      'google-chrome',
      'google-chrome-stable',
      'chrome',
      'chromium',
      'chromium-browser'
    ];
    
    for (const browser of browsers) {
      try {
        const browserPath = execSync(`which ${browser}`, { stdio: 'pipe' }).toString().trim();
        if (browserPath && existsSync(browserPath)) {
          logger.debug(`Found browser via which: ${browserPath}`);
          return browserPath;
        }
      } catch (e) {
        // Command failed, browser not found via which
        logger.debug(`Browser '${browser}' not found using 'which'.`);
      }
    }
    
    // Hard-coded paths as fallback
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/snap/bin/google-chrome'
    ];
    
    for (const p of linuxPaths) {
      if (existsSync(p)) {
        logger.debug(`Found browser via fallback path: ${p}`);
        return p;
      }
    }
    
    logger.warn('Could not find any suitable Chrome/Chromium binary on Linux.');
    return null;
  } catch (error) {
    logger.error(`Error finding Chrome on Linux: ${error.message}`, { stack: error.stack });
    return null;
  }
}

// Find Chrome on macOS
function findMacOSChrome() {
  const macPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // User-specific paths
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    path.join(os.homedir(), 'Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
    path.join(os.homedir(), 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    path.join(os.homedir(), 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  ];
  
  for (const p of macPaths) {
    if (existsSync(p)) {
      logger.debug(`Found browser via standard path: ${p}`);
      return p;
    }
  }
  
  // Try to find using mdfind (macOS Spotlight CLI)
  try {
    // Escape inner single quotes within the single-quoted string
    const mdfindOutput = execSync('mdfind "kMDItemKind == \'Application\' && kMDItemDisplayName == \'Google Chrome\'" | head -1', { stdio: 'pipe' }).toString().trim();
    // Example output: /Applications/Google Chrome.app
    if (mdfindOutput && existsSync(mdfindOutput)) {
      const chromePath = path.join(mdfindOutput, 'Contents/MacOS/Google Chrome');
      if (existsSync(chromePath)) {
        logger.debug(`Found browser via mdfind: ${chromePath}`);
        return chromePath;
      }
    }
  } catch (e) {
    logger.debug(`mdfind command failed or did not find Chrome: ${e.message}`);
  }
  
  logger.warn('Could not find any suitable Chrome/Chromium binary on macOS.');
  return null;
}

// Find Chrome or Edge on Windows
function findWindowsChrome() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA;

  const windowsPaths = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];

  if (localAppData) {
    windowsPaths.push(
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  }
  
  for (const p of windowsPaths) {
    if (existsSync(p)) {
      logger.debug(`Found browser via standard path: ${p}`);
      return p;
    }
  }
  
  logger.warn('Could not find any suitable Chrome/Edge binary on Windows.');
  return null;
}

// Get default Chrome/Chromium path based on OS
function getDefaultBrowserPath() {
  // Check environment variable first - highest priority
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) {
    logger.info(`Using browser from PUPPETEER_EXECUTABLE_PATH: ${envPath}`);
    return envPath;
  }
  
  const platform = os.platform();
  const arch = os.arch();
  logger.info(`Detected platform: ${platform}, architecture: ${arch}`);
  
  // Check if running in Docker
  const dockerMode = isRunningInDocker();
  if (dockerMode) {
    logger.info('Running in Docker container');
  }
  
  let browserPath = null;
  
  if (platform === 'darwin') {  // macOS
    browserPath = findMacOSChrome();
  } else if (platform === 'win32') {  // Windows
    browserPath = findWindowsChrome();
  } else {  // Linux and others
    browserPath = findLinuxChrome();
  }
  
  if (browserPath) {
    logger.info(`Found browser at: ${browserPath}`);
  } else {
    logger.error('Could not automatically find a compatible browser executable. Set PUPPETEER_EXECUTABLE_PATH environment variable.');
  }
  
  return browserPath;
}

// Launch a browser with default settings
async function launchBrowser() {
  try {
    const executablePath = getDefaultBrowserPath();
    
    if (!executablePath) {
      logger.error('No browser executable found automatically', 'warn');
      throw new Error(
        'Chrome/Chromium browser not found. Please install Chrome or set PUPPETEER_EXECUTABLE_PATH in your .env file.\n' +
        'For macOS: Install Google Chrome from https://www.google.com/chrome/\n' +
        'For Linux: sudo apt install chromium-browser or equivalent for your distribution\n' +
        'For Docker: Make sure to include Chrome in your container or mount it from the host'
      );
    }
    
    // Parse puppeteer args if provided
    let puppeteerArgs = [];
    if (process.env.PUPPETEER_ARGS) {
      puppeteerArgs = process.env.PUPPETEER_ARGS.split(',');
    }

    // Enhanced default arguments for the browser
    const defaultArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-notifications',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--disable-features=site-per-process,TranslateUI,BlinkGenPropertyTrees,MediaRouter',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      `--js-flags=--max-old-space-size=2048`,
      '--deterministic-fetch' // Make network fetches more reliable
    ];
    
    // Combine default args with any provided args, removing duplicates
    const args = [...new Set([...defaultArgs, ...puppeteerArgs])];

    // Options for launching browser
    const options = {
      headless: 'new',
      executablePath,
      args,
      ignoreHTTPSErrors: true,
      timeout: 120000, // Increase timeout to 120 seconds
      defaultViewport: {
        width: 1280,
        height: 1024
      },
      handleSIGINT: false, // Prevent Puppeteer from closing browser on Ctrl+C
      handleSIGTERM: false, // Prevent Puppeteer from closing browser on SIGTERM
      handleSIGHUP: false, // Prevent Puppeteer from closing browser on SIGHUP
      protocolTimeout: 120000 // Increase protocol command timeout
    };
    
    // Launch the browser
    const browser = await puppeteer.launch(options);
    
    // Get the version
    const version = await browser.version();
    logger.info(`Browser launched successfully: ${version}`);
    
    return browser;
  } catch (error) {
    logger.error(`Error launching browser: ${error}`, 'error');
    throw error;
  }
}

// Create and configure a new page
async function setupPage(browser) {
  const page = await browser.newPage();
  
  // Set viewport and user agent
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Set increased timeout
  page.setDefaultNavigationTimeout(120000); // Increase to 120 seconds
  
  // Enable JavaScript error collection
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', (e) => {
      console.error('Browser JS error:', e.message, e.error?.stack || '');
    });
  });
  
  // Block unnecessary resources to improve performance
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    // Block unnecessary resources but allow CSS to prevent preload errors
    if (['image', 'media', 'font'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });
  
  // Add additional error handling
  page.on('error', err => {
    console.error('Page crashed:', err);
  });
  
  page.on('pageerror', err => {
    console.error('Page error:', err);
  });
  
  return page;
}

module.exports = {
  saveCookies,
  loadCookies,
  verifyCookieLogin,
  launchBrowser,
  setupPage,
  isRunningInDocker
}; 