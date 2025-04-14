const { loadCookies, verifyCookieLogin, saveCookies } = require('../browser/browser');

// Function to handle login
async function login(page, email, password, cookiesFile) {
  try {
    // Try to use cookies first
    const cookiesLoaded = await loadCookies(page, cookiesFile);
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

    // Wait for login form
    console.log('Waiting for login form...');
    await page.waitForSelector('form, input[type="email"], .login-container', { timeout: 30000 });

    // Enter credentials
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
    }, email, password);

    // Submit login form
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

    // Verify login success
    console.log('Verifying login...');
    await page.goto('https://members.delphidigital.io/reports', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
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
      await saveCookies(page, cookiesFile);
      
      return true;
    } else {
      throw new Error('Login verification failed');
    }
  } catch (error) {
    console.error('Error during login:', error);
    return false;
  }
}

module.exports = {
  login
}; 