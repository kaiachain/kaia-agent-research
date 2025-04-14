const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const path = require('path');

// Function to save cookies from the browser session
async function saveCookies(page, cookiesFile) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(cookiesFile, JSON.stringify(cookies, null, 2));
    
    const cookieNames = cookies.map(cookie => cookie.name);
    console.log(`${cookies.length} cookies saved to ${cookiesFile}`);
    console.log(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    console.error('Error saving cookies:', error);
    return false;
  }
}

// Function to load cookies into the browser session
async function loadCookies(page, cookiesFile) {
  try {
    const cookiesString = await fs.readFile(cookiesFile, 'utf8');
    const cookies = JSON.parse(cookiesString);
    
    if (!cookies.length) {
      console.log('No cookies found in file');
      return false;
    }
    
    await page.setCookie(...cookies);
    
    const cookieNames = cookies.map(cookie => cookie.name);
    console.log(`Loaded ${cookies.length} cookies from file`);
    console.log(`Cookie names: ${cookieNames.join(', ')}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No cookies file found, will proceed with normal login');
    } else {
      console.error('Error loading cookies:', error);
    }
    return false;
  }
}

// Function to verify cookie login
async function verifyCookieLogin(page, url = 'https://members.delphidigital.io/reports') {
  try {
    console.log('Verifying cookie authentication...');
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

// Launch a browser with default settings
async function launchBrowser() {
  return await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
}

// Create and configure a new page
async function setupPage(browser) {
  const page = await browser.newPage();
  
  // Set viewport and user agent
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  return page;
}

module.exports = {
  saveCookies,
  loadCookies,
  verifyCookieLogin,
  launchBrowser,
  setupPage
}; 