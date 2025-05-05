const fs = require("fs").promises;
const logger = require("../utils/logger"); // Import the shared logger

/**
 * Fetches report links from the Delphi website, stopping when the last visited link is found.
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the Delphi reports page.
 * @param {string|null} lastVisitedUrl - The URL of the last report processed.
 * @returns {Promise<Array<{url: string, title: string}>>} - Array of new report links (newest first).
 */
async function checkForNewReports(page, url, lastVisitedUrl) {
  try {
    logger.info("Checking for new reports...");
    logger.info(`Navigating to URL: ${url}`);

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        await page.goto(url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });
        logger.info("Page loaded successfully");

        const currentUrl = page.url();
        logger.info(`Current URL: ${currentUrl}`);

        if (currentUrl.includes("/login")) {
          logger.warn("Redirected to login page - session may have expired");
          throw new Error("Authentication required, redirected to login page");
        }

        await page.waitForSelector('a[href*="/reports/"]', {
          timeout: 30000,
          visible: true,
        });
        logger.info("Found report links indicator on page");

        const pageText = await page.evaluate(() => document.body.innerText);
        if (
          pageText.toLowerCase().includes("sign in to continue") ||
          pageText.toLowerCase().includes("log in to access")
        ) {
          logger.warn(
            "Found login prompt text on page - session may be invalid or expired."
          );
          throw new Error("Invalid session: Login prompt detected on page");
        }

        break;
      } catch (error) {
        retryCount++;
        logger.warn(
          `Attempt ${retryCount} to load reports page failed: ${error.message}`
        );

        if (retryCount === maxRetries) {
          logger.error(
            `Failed to load reports page after ${maxRetries} attempts: ${error.message}`
          );
          throw new Error(
            `Failed after ${maxRetries} attempts: ${error.message}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
        logger.info(`Retrying page load (attempt ${retryCount + 1})...`);
      }
    }

    const metrics = await page.metrics();
    logger.debug("Page metrics:", { metrics });

    const linksData = await page.evaluate((stopUrl) => {
      const reportLinks = document.querySelectorAll('a[href*="/reports/"]');
      console.log(
        `[Browser] Found ${reportLinks.length} potential report links on page`
      );

      const newLinks = [];
      const uniqueUrls = new Set();

      for (const el of reportLinks) {
        const currentUrl = el.href;
        const title =
          el.textContent.trim() ||
          el.getAttribute("title") ||
          el.getAttribute("aria-label") ||
          "";

        if (stopUrl && currentUrl === stopUrl) {
          console.log(
            `[Browser] Reached last visited URL: ${stopUrl}. Stopping link collection.`
          );
          break;
        }

        if (currentUrl && title && !uniqueUrls.has(currentUrl)) {
          newLinks.push({
            url: currentUrl,
            title: title,
          });
          uniqueUrls.add(currentUrl);
          console.log(`[Browser] Added link: ${title} (${currentUrl})`);
        } else if (!uniqueUrls.has(currentUrl)) {
          console.log(`[Browser] Skipping link with no title: ${currentUrl}`);
        }
      }

      return newLinks;
    }, lastVisitedUrl);

    const now = new Date().toISOString();
    const preparedLinks = linksData.map((link) => ({
      url: link.url,
      title: link.title || "Untitled Report",
      body: "",
      timestamp: now,
      scrapedAt: now,
      lastChecked: now,
      summary: "",
      publicationDate: null,
    }));

    if (preparedLinks.length === 0) {
      logger.info("No new reports found since the last visit.");
    } else {
      logger.info(
        `Found ${preparedLinks.length} new reports since last visit:`
      );
      preparedLinks.forEach((link, index) => {
        logger.debug(`${index + 1}. ${link.title}: ${link.url}`);
      });
    }

    return preparedLinks;
  } catch (error) {
    logger.error(`Error in checkForNewReports: ${error.message}`, {
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Fetches the main textual content of a given report URL (Simplified).
 * @param {object} page - Puppeteer page object.
 * @param {string} url - The URL of the report page.
 * @returns {Promise<string>} The extracted text content or error string.
 */
async function fetchReportContent(page, url) {
  try {
    logger.info(`Fetching content for: ${url}`);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });

    const reportData = await page.evaluate(() => {
      const contentSelectors = [".delphi-report-content"];
      let element = null;
      for (const selector of contentSelectors) {
        element = document.querySelector(selector);
        if (element) break;
      }
      let bodyText = element ? element.innerText : document.body.innerText;

      const titleSelectors = "h1";
      let titleElement = document.querySelector(titleSelectors);

      let publicationDate = null;
      let publicationDateElement = titleElement.nextElementSibling;
      if (publicationDateElement) {
        publicationDate = publicationDateElement.innerText;
        if (publicationDate) {
          publicationDate =
            publicationDate.split("•").length > 1
              ? publicationDate.split("•")[0]
              : publicationDate;
          publicationDate = publicationDate.trim();
        }
      }

      return { body: bodyText, publicationDate };
    });

    if (
      !reportData ||
      !reportData.body ||
      reportData.body.trim().length === 0
    ) {
      logger.warn(`Fetched empty content for ${url}.`);
      try {
        const errorContent = await page.content();
        const errorStatePath = `error_empty_content_${url
          .split("/")
          .pop()}_${Date.now()}.html`;
        await fs.writeFile(errorStatePath, errorContent);
        logger.info(
          `Saved page HTML for empty content debug to ${errorStatePath}`
        );
      } catch (debugError) {
        logger.error(
          `Failed to save empty content page HTML: ${debugError.message}`
        );
      }
      return "Error fetching content.";
    }

    logger.info(
      `Fetched content successfully for ${url}. Length: ${reportData.body.length}`
    );
    debugger;
    if (reportData.publicationDate) {
      logger.info(`Extracted publication date: ${reportData.publicationDate}`);
    } else {
      logger.debug(`Could not extract publication date for ${url}`);
    }

    return {
      reportContent: reportData.body,
      publicationDate: reportData.publicationDate,
    };
  } catch (error) {
    logger.error(`Error fetching content for ${url}: ${error.message}`, {
      stack: error.stack,
    });
    return "Error fetching content.";
  }
}

module.exports = {
  checkForNewReports,
  fetchReportContent,
};
