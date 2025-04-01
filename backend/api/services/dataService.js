/**
 * Data Service for OTORI Vision
 * 
 * This service handles smart data persistence to avoid unnecessary file writes
 * that would trigger PM2 restarts. Only writes files when content actually changes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cache of file hashes to detect changes
const fileHashes = new Map();

/**
 * Saves data to a JSON file only if the content has changed
 * @param {string} filePath - Path to the JSON file
 * @param {Object} data - Data to save
 * @param {boolean} pretty - Whether to pretty-print the JSON
 * @returns {boolean} - Whether the file was written (true = changed, false = unchanged)
 */
function saveDataIfChanged(filePath, data, pretty = true) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Convert data to JSON string
    const jsonString = pretty 
      ? JSON.stringify(data, null, 2) 
      : JSON.stringify(data);
    
    // Calculate hash of new content
    const newHash = crypto.createHash('md5').update(jsonString).digest('hex');
    
    // Check if file exists and get its current hash
    let currentHash = fileHashes.get(filePath);
    
    if (!currentHash && fs.existsSync(filePath)) {
      // First time seeing this file, calculate its hash
      const currentContent = fs.readFileSync(filePath, 'utf8');
      currentHash = crypto.createHash('md5').update(currentContent).digest('hex');
      fileHashes.set(filePath, currentHash);
    }
    
    // If hashes match, content hasn't changed
    if (currentHash === newHash) {
      console.log(`Data unchanged for ${path.basename(filePath)}, skipping write`);
      return false;
    }
    
    // Write file and update hash cache
    fs.writeFileSync(filePath, jsonString, 'utf8');
    fileHashes.set(filePath, newHash);
    console.log(`Data changed, wrote updates to ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`Error saving data to ${filePath}:`, error);
    return false;
  }
}

/**
 * Loads data from a JSON file
 * @param {string} filePath - Path to the JSON file
 * @param {Object} defaultValue - Default value if file doesn't exist
 * @returns {Object} - Parsed data or default value
 */
function loadData(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      const jsonString = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(jsonString);
      
      // Update file hash in cache
      const hash = crypto.createHash('md5').update(jsonString).digest('hex');
      fileHashes.set(filePath, hash);
      
      return data;
    }
  } catch (error) {
    console.error(`Error loading data from ${filePath}:`, error);
  }
  
  return defaultValue;
}

module.exports = {
  saveDataIfChanged,
  loadData
}; 