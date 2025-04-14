const puppeteer = require('puppeteer');

async function testPuppeteer() {
  console.log('Testing Puppeteer v24.6.1...');
  
  try {
    // Launch the browser
    const browser = await puppeteer.launch({ headless: 'new' });
    console.log('Browser launched successfully');
    
    // Open a new page
    const page = await browser.newPage();
    console.log('New page created');
    
    // Navigate to a test URL
    await page.goto('https://example.com', { waitUntil: 'networkidle0' });
    console.log('Navigation successful');
    
    // Get page title
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Close the browser
    await browser.close();
    console.log('Browser closed successfully');
    
    return true;
  } catch (error) {
    console.error('Error testing Puppeteer:', error);
    return false;
  }
}

// Run the test
testPuppeteer()
  .then(result => {
    if (result) {
      console.log('Puppeteer test completed successfully!');
      process.exit(0);
    } else {
      console.log('Puppeteer test failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Unhandled error in test:', error);
    process.exit(1);
  }); 