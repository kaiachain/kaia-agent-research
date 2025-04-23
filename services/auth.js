const { loadCookies, verifyCookieLogin, saveCookies } = require('../browser/browser');
const logger = require('../scripts/logger'); // Import the shared logger

// Function to handle login
async function login(page, email, password, cookiesFile) {
  try {
    // Try to use cookies first
    const cookiesLoaded = await loadCookies(page, cookiesFile);
    if (cookiesLoaded) {
      const cookieLoginSuccessful = await verifyCookieLogin(page);
      if (cookieLoginSuccessful) {
        return true; // Already logged in via cookies
      }
      // If cookie login failed, continue with normal login
      logger.info('Cookie login failed or verification needed, proceeding with form login.');
    }

    // Go to the login page
    // console.log('Navigating to login page...');
    logger.info('Navigating to login page...');
    await page.goto('https://members.delphidigital.io/login', { // Make URL configurable?
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait for login form elements
    // console.log('Waiting for login form...');
    logger.info('Waiting for login form elements (email/password fields)...');
    const emailSelector = 'input[type="email"], input[name*="user"], #email';
    const passwordSelector = 'input[type="password"], input[name*="pass"], #password';
    await page.waitForSelector(`${emailSelector}, ${passwordSelector}`, { timeout: 30000 });
    logger.debug('Login form elements found.');

    // Enter credentials
    // console.log('Entering credentials...');
    logger.info('Entering credentials...');
    await page.evaluate((email, password, emailSel, passSel) => {
      const emailInput = document.querySelector(emailSel);
      const passwordInput = document.querySelector(passSel);

      if (emailInput) {
        emailInput.value = email;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
         console.warn('Could not find email input field using selector:', emailSel); // Keep console for evaluate
      }

      if (passwordInput) {
        passwordInput.value = password;
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
         console.warn('Could not find password input field using selector:', passSel); // Keep console for evaluate
      }
    }, email, password, emailSelector, passwordSelector);
    logger.debug('Credentials entered.');

    // Submit login form
    // console.log('Looking for submit button...');
    logger.info('Looking for login/submit button...');
    const formSubmitted = await page.evaluate(() => {
      // Try different button selectors
      const buttonSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button[class*="submit" i],',
        'button[class*="login" i],',
        'button[id*="submit" i],',
        'button[id*="login" i],',
        'button:not([type])' // Generic button as fallback
      ];

      for (const selector of buttonSelectors) {
        const buttons = Array.from(document.querySelectorAll(selector));
        const loginButton = buttons.find(button => {
          const text = (button.textContent || button.value || '').toLowerCase();
          return text.includes('sign in') ||
                  text.includes('log in') ||
                  text.includes('login') ||
                  text.includes('submit');
        });

        if (loginButton) {
          console.log('Found login button with selector:', selector, 'Text:', loginButton.textContent); // Keep console for evaluate
          // Try to submit the form associated with the button
          const form = loginButton.closest('form');
          if (form) {
            console.log('Submitting form via dispatchEvent...'); // Keep console for evaluate
            // form.submit(); // This might not trigger JS handlers
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
             // Check if a submit button was clicked directly
             if (loginButton.type === 'submit') {
                 loginButton.click();
             }
            return true;
          } else {
             console.log('Clicking login button directly (no form found)...'); // Keep console for evaluate
            loginButton.click();
            return true;
          }
        }
      }
       console.warn('Could not find a suitable login button.'); // Keep console for evaluate
      return false;
    });

    if (!formSubmitted) {
      logger.error('Could not find or click login button.');
      throw new Error('Could not find or click login button');
    }
    logger.info('Login form submitted/button clicked.');

    // Wait for navigation or a specific response indicating success/failure
    // console.log('Waiting for auth response...');
    logger.info('Waiting for navigation or authentication response...');
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 45000 });
        logger.info('Navigation occurred after login attempt.');
    } catch (navError) {
        logger.warn(`Navigation did not complete after login attempt within timeout: ${navError.message}. Checking current state.`);
        // Even if navigation times out, the login might have succeeded via AJAX.
        // We will proceed to verification.
    }

    // Verify login success by checking the target page (e.g., reports page)
    // console.log('Verifying login...');
    logger.info('Verifying login success by navigating to reports page...');
    await page.goto('https://members.delphidigital.io/reports', { // Make configurable?
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    const isLoggedIn = await verifyCookieLogin(page); // Reuse verification logic

    if (isLoggedIn) {
      // console.log('Successfully logged in');
      logger.info('Successfully logged in and verified.');

      // Save cookies for future use
      await saveCookies(page, cookiesFile);

      return true;
    } else {
       logger.error('Login verification failed after submitting form.');
      throw new Error('Login verification failed after submitting form.');
    }
  } catch (error) {
    // console.error('Error during login:', error);
    logger.error(`Error during login process: ${error.message}`, { stack: error.stack });
    // Try to capture screenshot on error
    try {
        const screenshotPath = `error_login_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`Screenshot saved to ${screenshotPath} due to login error.`);
    } catch (screenshotError) {
        logger.error(`Failed to take screenshot on login error: ${screenshotError.message}`);
    }
    return false;
  }
}

module.exports = {
  login
}; 