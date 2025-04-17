const fs = require('fs').promises;
const { existsSync, readFileSync } = require('fs');
const puppeteer = require('puppeteer-core');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { logWithTimestamp } = require('../services/slack');

// Function to save cookies from the browser session
async function saveCookies(page, cookiesFile) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(cookiesFile, JSON.stringify(cookies, null, 2));
    
    const cookieNames = cookies.map(cookie => cookie.name);
    logWithTimestamp(`${cookies.length} cookies saved to ${cookiesFile}`);
    logWithTimestamp(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    logWithTimestamp(`Error saving cookies: ${error.message}`, 'error');
    return false;
  }
}

// Function to load cookies into the browser session
async function loadCookies(page, cookiesFile) {
  try {
    const cookiesString = await fs.readFile(cookiesFile, 'utf8');
    const cookies = JSON.parse(cookiesString);
    
    if (!cookies.length) {
      logWithTimestamp('No cookies found in file');
      return false;
    }
    
    await page.setCookie(...cookies);
    
    const cookieNames = cookies.map(cookie => cookie.name);
    logWithTimestamp(`Loaded ${cookies.length} cookies from file`);
    logWithTimestamp(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logWithTimestamp('No cookies file found, will proceed with normal login');
    } else {
      logWithTimestamp(`Error loading cookies: ${error.message}`, 'error');
    }
    return false;
  }
}

// Function to verify cookie login
async function verifyCookieLogin(page, url = 'https://members.delphidigital.io/reports') {
  try {
    logWithTimestamp('Verifying cookie authentication...');
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
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
      logWithTimestamp('Successfully authenticated using cookies');
      return true;
    } else {
      logWithTimestamp('Cookie authentication failed, will proceed with normal login');
      return false;
    }
  } catch (error) {
    logWithTimestamp(`Error verifying cookie login: ${error.message}`, 'error');
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
      
      for (const path of dockerChromePaths) {
        if (existsSync(path)) {
          logWithTimestamp(`Using Docker Chrome path: ${path}`);
          return path;
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
        const path = execSync(`which ${browser}`, { stdio: 'pipe' }).toString().trim();
        if (path && existsSync(path)) {
          return path;
        }
      } catch (e) {
        // Command failed, browser not found
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
    
    for (const path of linuxPaths) {
      if (existsSync(path)) {
        return path;
      }
    }
    
    return null;
  } catch (error) {
    logWithTimestamp(`Error finding Chrome on Linux: ${error.message}`, 'warn');
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
    `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    `${os.homedir()}/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`,
    `${os.homedir()}/Applications/Chromium.app/Contents/MacOS/Chromium`,
    `${os.homedir()}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`
  ];
  
  for (const path of macPaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  
  // Try to find using mdfind (macOS Spotlight CLI)
  try {
    const mdfindPath = execSync('mdfind "kMDItemCFBundleIdentifier == com.google.Chrome" | head -1', { stdio: 'pipe' }).toString().trim();
    if (mdfindPath) {
      const chromePath = `${mdfindPath}/Contents/MacOS/Google Chrome`;
      if (existsSync(chromePath)) {
        return chromePath;
      }
    }
  } catch (e) {
    // mdfind command failed
  }
  
  return null;
}

// Find Chrome or Edge on Windows
function findWindowsChrome() {
  const windowsPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  
  // Add local app data path if environment variable exists
  if (process.env.LOCALAPPDATA) {
    windowsPaths.push(
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
    );
  }
  
  for (const path of windowsPaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  
  return null;
}

// Get default Chrome/Chromium path based on OS
function getDefaultBrowserPath() {
  // Check environment variable first - highest priority
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    logWithTimestamp(`Using browser from PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  const platform = os.platform();
  const arch = os.arch();
  logWithTimestamp(`Detected platform: ${platform}, architecture: ${arch}`);
  
  // Check if running in Docker
  const dockerMode = isRunningInDocker();
  if (dockerMode) {
    logWithTimestamp('Running in Docker container');
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
    logWithTimestamp(`Found browser at: ${browserPath}`);
  } else {
    logWithTimestamp('No browser executable found automatically', 'warn');
  }
  
  return browserPath;
}

// Launch a browser with default settings
async function launchBrowser() {
  try {
    const executablePath = getDefaultBrowserPath();
    
    if (!executablePath) {
      logWithTimestamp('No browser executable found automatically', 'warn');
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

    // Get default arguments for the browser
    const defaultArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ];
    
    // Combine default args with any provided args, removing duplicates
    const args = [...new Set([...defaultArgs, ...puppeteerArgs])];

    // Options for launching browser
    const options = {
      headless: 'new',
      executablePath,
      args,
      ignoreHTTPSErrors: true,
      timeout: 60000
    };
    
    // Launch the browser
    const browser = await puppeteer.launch(options);
    
    // Get the version
    const version = await browser.version();
    logWithTimestamp(`Browser launched successfully: ${version}`);
    
    return browser;
  } catch (error) {
    logWithTimestamp(`Error launching browser: ${error}`, 'error');
    throw error;
  }
}

// Create and configure a new page
async function setupPage(browser) {
  const page = await browser.newPage();
  
  // Set viewport and user agent
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Set timeout
  page.setDefaultNavigationTimeout(60000);
  
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