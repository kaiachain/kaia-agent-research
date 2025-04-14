const fs = require('fs').promises;
const crypto = require('crypto');

// Function to load cache
async function loadCache(cachePath) {
  try {
    const cacheData = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(cacheData);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`${cachePath} not found. Creating a new one.`);
      const emptyCache = {};
      await fs.writeFile(cachePath, JSON.stringify(emptyCache, null, 2));
      return emptyCache;
    }
    console.error(`Error loading cache from ${cachePath}:`, error);
    return {};
  }
}

// Function to update cache
async function updateCache(url, entry, contentHash, cache, cachePath) {
  try {
    // Copy cache to avoid modifying the original object
    const updatedCache = { ...cache };
    
    // Update the cache with the new entry
    updatedCache[url] = {
      ...entry,
      contentHash,
      timestamp: new Date().toISOString()
    };
    
    // Write updated cache to file
    await fs.writeFile(cachePath, JSON.stringify(updatedCache, null, 2));
    
    return updatedCache;
  } catch (error) {
    console.error('Error updating cache:', error);
    return cache;
  }
}

// Function to create content hash
function createContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Function to check if content needs processing
function needsProcessing(cache, entry, content, forceSummaries = false) {
  // If we want to force processing, return true
  if (forceSummaries) {
    return true;
  }
  
  const url = entry.url;
  
  // If this URL is not in the cache, it needs processing
  if (!cache[url]) {
    return true;
  }
  
  // If we have content, check if it's changed
  if (content) {
    const newContentHash = createContentHash(content);
    const cachedContentHash = cache[url].contentHash;
    
    // If the content hash is different, it needs processing
    if (newContentHash !== cachedContentHash) {
      return true;
    }
  }
  
  // If the cache entry doesn't have a summary yet, it needs processing
  if (!cache[url].summary) {
    return true;
  }
  
  // If we got this far, no processing needed
  return false;
}

module.exports = {
  loadCache,
  updateCache,
  createContentHash,
  needsProcessing
}; 