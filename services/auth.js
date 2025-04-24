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
    
    try {
      // First check if elements already exist without waiting
      const elementsExist = await page.evaluate((emailSel, passSel) => {
        return !!(document.querySelector(emailSel) || document.querySelector(passSel));
      }, emailSelector, passwordSelector);
      
      if (!elementsExist) {
        // Wait with increased timeout if elements don't exist yet
        await page.waitForSelector(`${emailSelector}, ${passwordSelector}`, { timeout: 60000 });
      }
      logger.debug('Login form elements found.');
    } catch (selectorError) {
      // If still failing, try a more generic approach
      logger.warn(`Selector timeout: ${selectorError.message}. Trying alternative approach...`);
      // Try a more generic selector as fallback
      await page.waitForSelector('input', { timeout: 30000 });
      logger.debug('Found generic input element, will attempt to identify login fields.');
    }

    // Enter credentials
    // console.log('Entering credentials...');
    logger.info('Entering credentials...');
    try {
      // First try with specific selectors
      const specificSelectorResult = await page.evaluate((email, password, emailSel, passSel) => {
        const emailInput = document.querySelector(emailSel);
        const passwordInput = document.querySelector(passSel);
        let success = { email: false, password: false };

        if (emailInput) {
          emailInput.value = email;
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          success.email = true;
        }

        if (passwordInput) {
          passwordInput.value = password;
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          success.password = true;
        }

        return success;
      }, email, password, emailSelector, passwordSelector);

      // If specific selectors failed, try a more generic approach
      if (!specificSelectorResult.email || !specificSelectorResult.password) {
        logger.warn(`Could not fill all form fields with specific selectors. Email: ${specificSelectorResult.email}, Password: ${specificSelectorResult.password}`);
        
        // Try a more generic approach to find form fields
        await page.evaluate((email, password, emailSuccess, passwordSuccess) => {
          // Get all input fields
          const inputs = Array.from(document.querySelectorAll('input'));
          
          // Try to identify email/username field
          if (!emailSuccess) {
            const emailField = inputs.find(input => {
              const type = (input.type || '').toLowerCase();
              const name = (input.name || '').toLowerCase();
              const id = (input.id || '').toLowerCase();
              const placeholder = (input.placeholder || '').toLowerCase();
              
              return type === 'email' || 
                    name.includes('email') || name.includes('user') || 
                    id.includes('email') || id.includes('user') ||
                    placeholder.includes('email') || placeholder.includes('user');
            });
            
            if (emailField) {
              emailField.value = email;
              emailField.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('Found email field using generic search');
            }
          }
          
          // Try to identify password field
          if (!passwordSuccess) {
            const passwordField = inputs.find(input => {
              const type = (input.type || '').toLowerCase();
              const name = (input.name || '').toLowerCase();
              const id = (input.id || '').toLowerCase();
              const placeholder = (input.placeholder || '').toLowerCase();
              
              return type === 'password' || 
                    name.includes('pass') || 
                    id.includes('pass') ||
                    placeholder.includes('password');
            });
            
            if (passwordField) {
              passwordField.value = password;
              passwordField.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('Found password field using generic search');
            }
          }
        }, email, password, specificSelectorResult.email, specificSelectorResult.password);
      }
      
      logger.debug('Credentials entered.');
    } catch (error) {
      logger.error(`Error entering credentials: ${error.message}`);
      throw error;
    }

    // Submit login form
    // console.log('Looking for submit button...');
    logger.info('Looking for login/submit button...');
    
    // Expand button selectors for better coverage
    const buttonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[class*="submit" i]',
      'button[class*="login" i]',
      'button[id*="submit" i]',
      'button[id*="login" i]',
      'button',
      'input[type="button"]',
      'a[class*="login" i]',
      'a[class*="submit" i]',
      'a[href*="login" i]',
      '.login-button',
      '.submit-button'
    ];

    const formSubmitted = await page.evaluate((selectors) => {
      for (const selector of selectors) {
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
    }, buttonSelectors);

    if (!formSubmitted) {
      logger.error('Could not find or click login button.');
      throw new Error('Could not find or click login button');
    }
    logger.info('Login form submitted/button clicked.');

    // Wait for navigation or a specific response indicating success/failure
    // console.log('Waiting for auth response...');
    logger.info('Waiting for navigation or authentication response...');
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
        logger.info('Navigation occurred after login attempt.');
    } catch (navError) {
        logger.warn(`Navigation did not complete after login attempt within timeout: ${navError.message}. Checking current state.`);
        // Even if navigation times out, the login might have succeeded via AJAX
        
        // Try to detect if we're logged in despite navigation timeout
        const pageState = await page.evaluate(() => {
            // Check if we have any error messages visible on the page
            const errorElements = Array.from(document.querySelectorAll('.error, .alert, .notification, .message'))
                .filter(el => el.offsetParent !== null && (el.textContent || '').toLowerCase().includes('error'));
            
            // Check if we have any elements that would indicate we're already logged in
            const loggedInIndicators = !!document.querySelector('.dashboard, .logged-in, .user-profile, .account');
            
            return {
                hasErrors: errorElements.length > 0,
                errorMessages: errorElements.map(el => el.textContent.trim()),
                appearsLoggedIn: loggedInIndicators
            };
        });
        
        if (pageState.hasErrors) {
            logger.warn(`Form errors detected: ${pageState.errorMessages.join(', ')}`);
        }
        
        if (pageState.appearsLoggedIn) {
            logger.info('Page appears to be in logged-in state despite navigation timeout');
        }
        
        // We will proceed to verification regardless
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
    return false;
  }
}

module.exports = {
  login
}; 