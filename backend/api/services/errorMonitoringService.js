/**
 * Error Monitoring Service for OTORI Vision
 * 
 * Provides centralized error monitoring, tracking, and analysis
 * to help identify patterns and improve system stability.
 */

const fs = require('fs');
const path = require('path');
const config = require('./configService');

// Store for error occurrences
const errorStore = {
  errors: [],
  categories: {},
  services: {},
  lastReset: Date.now(),
  maxStoredErrors: 1000,
};

// Error categories and codes
const ERROR_CATEGORIES = {
  NETWORK: 'network',
  VALIDATION: 'validation',
  BITCOIN_NODE: 'bitcoin-node',
  API: 'api',
  DATA: 'data',
  SECURITY: 'security',
  INTERNAL: 'internal',
  UNKNOWN: 'unknown',
};

// Default logging configuration
const DEFAULT_ERROR_LOG_CONFIG = {
  logDirectory: config.paths.logDirectory || path.join(__dirname, '../../data/logs'),
  maxFileSizeMB: 50,
  logRotation: true,
  maxLogFiles: 10,
  consoleOutput: true,
  detailedErrors: process.env.NODE_ENV !== 'production', // Only detailed in non-production
  anonymizeData: process.env.NODE_ENV === 'production', // Anonymize in production
};

// Current configuration
let errorLogConfig = { ...DEFAULT_ERROR_LOG_CONFIG };

// Create log directory if it doesn't exist
if (!fs.existsSync(errorLogConfig.logDirectory)) {
  fs.mkdirSync(errorLogConfig.logDirectory, { recursive: true });
}

/**
 * Categorizes an error based on its type or message
 * @param {Error} error - Error to categorize
 * @param {string} defaultCategory - Default category if not determinable
 * @returns {string} Error category
 */
function categorizeError(error, defaultCategory = ERROR_CATEGORIES.UNKNOWN) {
  if (!error) return defaultCategory;
  
  const message = error.message || '';
  const stack = error.stack || '';
  
  // Check for network-related errors
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('socket')
  ) {
    return ERROR_CATEGORIES.NETWORK;
  }
  
  // Check for Bitcoin node errors
  if (
    message.includes('bitcoin-cli') ||
    message.includes('bitcoind') ||
    message.includes('RPC') ||
    message.includes('daemon')
  ) {
    return ERROR_CATEGORIES.BITCOIN_NODE;
  }
  
  // Check for validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('schema') ||
    message.includes('missing')
  ) {
    return ERROR_CATEGORIES.VALIDATION;
  }
  
  // Check for API errors
  if (
    message.includes('API') ||
    message.includes('endpoint') ||
    message.includes('request failed') ||
    message.includes('response')
  ) {
    return ERROR_CATEGORIES.API;
  }
  
  // Check for data errors
  if (
    message.includes('data') ||
    message.includes('database') ||
    message.includes('JSON') ||
    message.includes('parse')
  ) {
    return ERROR_CATEGORIES.DATA;
  }
  
  // Check for security errors
  if (
    message.includes('security') ||
    message.includes('auth') ||
    message.includes('permission') ||
    message.includes('token') ||
    message.includes('signature')
  ) {
    return ERROR_CATEGORIES.SECURITY;
  }
  
  // Check if it's an internal error
  if (
    stack.includes(path.dirname(__dirname)) || // Is in our codebase
    message.includes('internal')
  ) {
    return ERROR_CATEGORIES.INTERNAL;
  }
  
  return defaultCategory;
}

/**
 * Anonymizes sensitive data in error messages and objects
 * @param {string|object} data - Data to anonymize
 * @returns {string|object} Anonymized data
 */
function anonymizeData(data) {
  if (!data) return data;
  
  // For strings, replace potential sensitive data
  if (typeof data === 'string') {
    // Replace potential Bitcoin addresses
    let anonymized = data.replace(/\b(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\b/g, '[BITCOIN_ADDRESS]');
    
    // Replace potential transaction IDs
    anonymized = anonymized.replace(/\b[a-fA-F0-9]{64}\b/g, '[TX_ID]');
    
    // Replace potential private keys or signatures (hex strings of specific lengths)
    anonymized = anonymized.replace(/\b[a-fA-F0-9]{64,65}\b/g, '[PRIVATE_DATA]');
    
    // Replace potential IP addresses
    anonymized = anonymized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_ADDRESS]');
    
    return anonymized;
  }
  
  // For objects, deep clone and anonymize
  if (typeof data === 'object' && data !== null) {
    const anonymized = Array.isArray(data) ? [...data] : { ...data };
    
    for (const key in anonymized) {
      if (
        key.includes('key') ||
        key.includes('signature') ||
        key.includes('password') ||
        key.includes('secret') ||
        key.includes('token') ||
        key.includes('auth')
      ) {
        anonymized[key] = '[REDACTED]';
      } else if (typeof anonymized[key] === 'object' && anonymized[key] !== null) {
        anonymized[key] = anonymizeData(anonymized[key]);
      } else if (typeof anonymized[key] === 'string') {
        anonymized[key] = anonymizeData(anonymized[key]);
      }
    }
    
    return anonymized;
  }
  
  return data;
}

/**
 * Logs an error with metadata
 * @param {Error} error - Error object
 * @param {string} service - Service where error occurred
 * @param {Object} metadata - Additional metadata about the error
 * @returns {string} Error ID
 */
function logError(error, service = 'unknown', metadata = {}) {
  const timestamp = Date.now();
  const category = metadata.category || categorizeError(error);
  const errorId = `err_${timestamp}_${Math.floor(Math.random() * 1000000).toString(36)}`;
  
  // Process error data
  const processedData = {
    id: errorId,
    timestamp,
    service,
    category,
    message: error.message || 'Unknown error',
    stack: error.stack,
    code: error.code,
    name: error.name,
    metadata: errorLogConfig.anonymizeData ? anonymizeData(metadata) : metadata,
  };
  
  // Add to in-memory store, removing oldest if at capacity
  errorStore.errors.push(processedData);
  if (errorStore.errors.length > errorStore.maxStoredErrors) {
    errorStore.errors.shift();
  }
  
  // Update category and service stats
  updateErrorStats(category, service);
  
  // Write to log file
  writeErrorToLog(processedData);
  
  // Console output if enabled
  if (errorLogConfig.consoleOutput) {
    console.error(`[ERROR] [${service}] [${category}] ${errorId}: ${processedData.message}`);
    if (errorLogConfig.detailedErrors && processedData.stack) {
      console.error(processedData.stack);
    }
  }
  
  return errorId;
}

/**
 * Updates error statistics
 * @param {string} category - Error category
 * @param {string} service - Service name
 */
function updateErrorStats(category, service) {
  // Update category stats
  if (!errorStore.categories[category]) {
    errorStore.categories[category] = {
      count: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };
  }
  
  const categoryStats = errorStore.categories[category];
  categoryStats.count++;
  categoryStats.lastSeen = Date.now();
  
  // Update service stats
  if (!errorStore.services[service]) {
    errorStore.services[service] = {
      count: 0,
      categories: {},
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };
  }
  
  const serviceStats = errorStore.services[service];
  serviceStats.count++;
  serviceStats.lastSeen = Date.now();
  
  // Update service-specific category stats
  if (!serviceStats.categories[category]) {
    serviceStats.categories[category] = {
      count: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };
  }
  
  const serviceCategoryStats = serviceStats.categories[category];
  serviceCategoryStats.count++;
  serviceCategoryStats.lastSeen = Date.now();
}

/**
 * Writes an error to the log file
 * @param {Object} errorData - Processed error data
 */
function writeErrorToLog(errorData) {
  try {
    // Get daily log file path
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(errorLogConfig.logDirectory, `errors-${date}.log`);
    
    // Check for file size if rotation enabled
    if (errorLogConfig.logRotation && fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB >= errorLogConfig.maxFileSizeMB) {
        // Rotate file
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const rotatedFile = path.join(
          errorLogConfig.logDirectory, 
          `errors-${date}-${timestamp}.log`
        );
        
        fs.renameSync(logFile, rotatedFile);
        
        // Clean up old log files if we have too many
        if (errorLogConfig.maxLogFiles > 0) {
          cleanupOldLogFiles();
        }
      }
    }
    
    // Write error data to log file
    fs.appendFileSync(logFile, JSON.stringify(errorData) + '\n');
  } catch (loggingError) {
    console.error('Error writing to error log:', loggingError);
  }
}

/**
 * Cleans up old log files if there are too many
 */
function cleanupOldLogFiles() {
  try {
    // Get all error log files
    const files = fs.readdirSync(errorLogConfig.logDirectory)
      .filter(file => file.startsWith('errors-'))
      .map(file => ({
        name: file,
        path: path.join(errorLogConfig.logDirectory, file),
        time: fs.statSync(path.join(errorLogConfig.logDirectory, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Sort newest first
    
    // Remove oldest files beyond the limit
    if (files.length > errorLogConfig.maxLogFiles) {
      const filesToRemove = files.slice(errorLogConfig.maxLogFiles);
      filesToRemove.forEach(file => {
        fs.unlinkSync(file.path);
        console.log(`Removed old error log: ${file.name}`);
      });
    }
  } catch (error) {
    console.error('Error cleaning up old log files:', error);
  }
}

/**
 * Gets error statistics
 * @param {boolean} reset - Whether to reset statistics after retrieval
 * @returns {Object} Error statistics
 */
function getErrorStats(reset = false) {
  const stats = {
    totalErrors: errorStore.errors.length,
    categories: { ...errorStore.categories },
    services: { ...errorStore.services },
    timeRange: {
      from: errorStore.lastReset,
      to: Date.now(),
      durationMs: Date.now() - errorStore.lastReset
    }
  };
  
  // Reset statistics if requested
  if (reset) {
    errorStore.errors = [];
    errorStore.categories = {};
    errorStore.services = {};
    errorStore.lastReset = Date.now();
  }
  
  return stats;
}

/**
 * Searches for error patterns within the error store
 * @param {Object} options - Search options
 * @returns {Object} Search results
 */
function findErrorPatterns(options = {}) {
  const {
    service,
    category,
    timeRangeMs = 86400000, // Default to last 24 hours
    minOccurrences = 2,
    similarityThreshold = 0.7 // How similar error messages need to be to be grouped
  } = options;
  
  // Filter errors based on criteria
  const now = Date.now();
  const timeThreshold = now - timeRangeMs;
  
  const filteredErrors = errorStore.errors.filter(error => {
    if (error.timestamp < timeThreshold) return false;
    if (service && error.service !== service) return false;
    if (category && error.category !== category) return false;
    return true;
  });
  
  // Group errors by similar messages
  const errorGroups = {};
  
  filteredErrors.forEach(error => {
    // Use the first 50 chars of the message as a grouping key
    // This is a simple approach - more sophisticated text similarity could be used
    const messageKey = error.message.substring(0, 50);
    
    let added = false;
    for (const key in errorGroups) {
      // Check similarity with existing group key (simple character comparison)
      let similarity = 0;
      let compareLength = Math.min(messageKey.length, key.length);
      
      if (compareLength === 0) continue;
      
      // Count matching characters
      for (let i = 0; i < compareLength; i++) {
        if (messageKey[i] === key[i]) similarity++;
      }
      
      similarity = similarity / compareLength;
      
      if (similarity >= similarityThreshold) {
        errorGroups[key].errors.push(error);
        added = true;
        break;
      }
    }
    
    if (!added) {
      errorGroups[messageKey] = {
        pattern: messageKey,
        errors: [error],
        services: new Set([error.service]),
        categories: new Set([error.category])
      };
    } else {
      // Update services and categories sets for the group
      const group = errorGroups[messageKey];
      group.services.add(error.service);
      group.categories.add(error.category);
    }
  });
  
  // Convert to array and filter by occurrence threshold
  const patterns = Object.values(errorGroups)
    .filter(group => group.errors.length >= minOccurrences)
    .map(group => ({
      pattern: group.pattern,
      count: group.errors.length,
      services: Array.from(group.services),
      categories: Array.from(group.categories),
      firstSeen: Math.min(...group.errors.map(e => e.timestamp)),
      lastSeen: Math.max(...group.errors.map(e => e.timestamp)),
      examples: group.errors.slice(0, 3).map(e => ({
        id: e.id,
        message: e.message,
        timestamp: e.timestamp,
        service: e.service
      }))
    }))
    .sort((a, b) => b.count - a.count);
  
  return {
    totalPatternsFound: patterns.length,
    timeRange: {
      from: timeThreshold,
      to: now,
      durationMs: timeRangeMs
    },
    patterns
  };
}

/**
 * Updates error monitoring configuration
 * @param {Object} newConfig - New configuration
 * @returns {Object} Updated configuration
 */
function updateErrorConfig(newConfig = {}) {
  errorLogConfig = {
    ...errorLogConfig,
    ...newConfig
  };
  
  // Ensure log directory exists with new config
  if (!fs.existsSync(errorLogConfig.logDirectory)) {
    fs.mkdirSync(errorLogConfig.logDirectory, { recursive: true });
  }
  
  return { ...errorLogConfig };
}

/**
 * Creates an error monitoring middleware for Express
 * @returns {Function} Express middleware
 */
function createErrorMonitoringMiddleware() {
  return (err, req, res, next) => {
    // Log the error
    const errorId = logError(err, 'api', {
      url: req.originalUrl,
      method: req.method,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    // Continue to next error handler
    err.errorId = errorId;
    next(err);
  };
}

module.exports = {
  ERROR_CATEGORIES,
  logError,
  getErrorStats,
  findErrorPatterns,
  updateErrorConfig,
  createErrorMonitoringMiddleware,
  categorizeError
}; 