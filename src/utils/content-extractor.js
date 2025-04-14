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
      
      // Try common date element selectors
      const dateSelectors = [
        '.date',
        '.published',
        '.publish-date',
        '.timestamp',
        '.article-date',
        'time',
        '[datetime]'
      ];
      
      for (const selector of dateSelectors) {
        const dateEl = document.querySelector(selector);
        if (dateEl) {
          // Check for datetime attribute
          const datetime = dateEl.getAttribute('datetime');
          if (datetime) {
            return datetime;
          }
          // Otherwise return the text content
          return dateEl.textContent.trim();
        }
      }
      
      // Return current date as fallback
      return new Date().toISOString();
    });

    // Extract main content
    const result = await page.evaluate(() => {
      // Remove unwanted elements before extracting content
      const elementsToRemove = [
        'nav',
        'header',
        'footer',
        '.navigation',
        '.footer',
        '.comments',
        '.sidebar',
        '.ad',
        '.advertisement',
        '.social-share',
        'script',
        'style',
        'iframe'
      ];
      
      elementsToRemove.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          try {
            el.remove();
          } catch (e) {
            // Ignore errors if element can't be removed
          }
        });
      });
      
      // Look for the article title
      let title = '';
      const titleSelectors = [
        'h1',
        '.article-title',
        '.post-title',
        '.entry-title',
        '[itemprop="headline"]'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl && titleEl.textContent.trim().length > 0) {
          title = titleEl.textContent.trim();
          break;
        }
      }
      
      // Look for the article content
      let content = '';
      const contentSelectors = [
        'article',
        '.article-content',
        '.post-content',
        '.entry-content',
        '.content',
        'main',
        '[itemprop="articleBody"]'
      ];
      
      // Helper function to clean text
      const cleanText = (text) => {
        return text
          .replace(/\s+/g, ' ')  // Replace multiple spaces with a single space
          .replace(/\n+/g, '\n') // Replace multiple newlines with a single newline
          .trim();
      };
      
      for (const selector of contentSelectors) {
        const contentEl = document.querySelector(selector);
        if (contentEl) {
          content = cleanText(contentEl.textContent);
          
          // If content is very short, this might not be the main article body
          if (content.length > 500) {
            break;
          }
        }
      }
      
      // If no content found with selectors, use body as fallback
      if (content.length < 500) {
        content = cleanText(document.body.textContent);
      }
      
      return { title, content };
    });

    const articleContent = {
      url,
      title: result.title || 'Untitled Article',
      content: result.content,
      publicationDate
    };

    return articleContent;
  } catch (error) {
    console.error(`Error extracting content from ${url}:`, error);
    return {
      url,
      title: 'Error: Could not extract content',
      content: '',
      publicationDate: new Date().toISOString()
    };
  }
}

module.exports = {
  extractContent
}; 