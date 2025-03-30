/**
 * Retry Service for OTORI Vision
 * 
 * Provides enhanced retry functionality with exponential backoff,
 * retry counting, and logging for retry patterns.
 */

const fs = require('fs');
const path = require('path');
const config = require('./configService');

// Default retry configuration
const DEFAULT_RETRY_CONFIG = {
  attempts: 3,                   // Number of retry attempts
  initialDelay: 1000,            // Initial delay in milliseconds
  maxDelay: 30000,               // Maximum delay in milliseconds
  backoffFactor: 2,              // Exponential backoff factor
  jitter: 0.2,                   // Randomization factor (0-1)
  timeout: 30000,                // Operation timeout in milliseconds
  shouldRetry: () => true,       // Function to determine if retry should be attempted
  onRetry: null,                 // Function to call before each retry
  retryLogEnabled: true,         // Whether to log retries
  retryLogDirectory: config.paths.logDirectory || path.join(__dirname, '../../data/logs'),
};

// Retry statistics tracking
const retryStats = {
  totalOperations: 0,
  successfulOperations: 0,
  failedOperations: 0,
  retriedOperations: 0,
  totalRetries: 0,
  serviceStats: {},              // Stats broken down by service
};

/**
 * Adds jitter to a delay time to prevent synchronized retries
 * @param {number} delay - Base delay in milliseconds
 * @param {number} jitterFactor - Jitter factor (0-1)
 * @returns {number} Delay with jitter applied
 */
function addJitter(delay, jitterFactor) {
  const jitter = delay * jitterFactor;
  return Math.floor(delay - (jitter / 2) + (Math.random() * jitter));
}

/**
 * Calculates delay for a retry attempt with exponential backoff
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} options - Retry options
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt, options) {
  const rawDelay = options.initialDelay * Math.pow(options.backoffFactor, attempt);
  const boundedDelay = Math.min(rawDelay, options.maxDelay);
  return addJitter(boundedDelay, options.jitter);
}

/**
 * Logs a retry attempt
 * @param {string} operation - Operation name
 * @param {number} attempt - Attempt number
 * @param {Error} error - Error that caused the retry
 * @param {number} delay - Delay before next retry
 * @param {Object} options - Retry options
 */
function logRetryAttempt(operation, attempt, error, delay, options) {
  if (!options.retryLogEnabled) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    operation,
    attempt,
    error: error.message,
    delay,
    nextAttemptAt: new Date(Date.now() + delay).toISOString(),
  };
  
  // Ensure log directory exists
  if (!fs.existsSync(options.retryLogDirectory)) {
    fs.mkdirSync(options.retryLogDirectory, { recursive: true });
  }
  
  // Write to daily retry log file
  const date = timestamp.split('T')[0];
  const logFile = path.join(options.retryLogDirectory, `retry-${date}.log`);
  
  try {
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('Error writing to retry log:', error);
  }
  
  // Also log to console
  console.warn(`Retry ${attempt}/${options.attempts} for ${operation}: ${error.message} (waiting ${delay}ms)`);
}

/**
 * Update retry statistics
 * @param {string} operation - Operation name
 * @param {boolean} success - Whether the operation was successful
 * @param {number} retries - Number of retries performed
 */
function updateRetryStats(operation, success, retries) {
  // Update global stats
  retryStats.totalOperations++;
  
  if (success) {
    retryStats.successfulOperations++;
  } else {
    retryStats.failedOperations++;
  }
  
  if (retries > 0) {
    retryStats.retriedOperations++;
    retryStats.totalRetries += retries;
  }
  
  // Update service-specific stats
  const serviceName = operation.split(':')[0];
  if (!retryStats.serviceStats[serviceName]) {
    retryStats.serviceStats[serviceName] = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      retriedOperations: 0,
      totalRetries: 0,
    };
  }
  
  const serviceStats = retryStats.serviceStats[serviceName];
  serviceStats.totalOperations++;
  
  if (success) {
    serviceStats.successfulOperations++;
  } else {
    serviceStats.failedOperations++;
  }
  
  if (retries > 0) {
    serviceStats.retriedOperations++;
    serviceStats.totalRetries += retries;
  }
}

/**
 * Executes a function with retry logic
 * @param {Function} fn - Function to execute
 * @param {string} operation - Name of the operation for logging
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(fn, operation, options = {}) {
  const retryOptions = {
    ...DEFAULT_RETRY_CONFIG,
    ...options,
  };
  
  let attempt = 0;
  let lastError;
  
  while (attempt <= retryOptions.attempts) {
    try {
      // Execute the function
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Operation timed out after ${retryOptions.timeout}ms`)), 
            retryOptions.timeout);
        })
      ]);
      
      // If successful, update stats and return the result
      updateRetryStats(operation, true, attempt);
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if we've reached max attempts
      if (attempt >= retryOptions.attempts || !retryOptions.shouldRetry(error, attempt)) {
        break;
      }
      
      // Calculate delay for next retry
      const delay = calculateBackoff(attempt, retryOptions);
      
      // Log retry attempt
      logRetryAttempt(operation, attempt + 1, error, delay, retryOptions);
      
      // Call onRetry callback if provided
      if (retryOptions.onRetry) {
        try {
          retryOptions.onRetry(error, attempt + 1);
        } catch (callbackError) {
          console.error('Error in retry callback:', callbackError);
        }
      }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increment attempt counter
      attempt++;
    }
  }
  
  // If we reach here, all attempts failed
  updateRetryStats(operation, false, attempt);
  throw lastError;
}

/**
 * Gets retry statistics
 * @param {boolean} reset - Whether to reset statistics after retrieval
 * @returns {Object} Retry statistics
 */
function getRetryStats(reset = false) {
  const stats = { ...retryStats };
  
  // Calculate aggregate metrics
  stats.successRate = stats.totalOperations > 0 ? 
    (stats.successfulOperations / stats.totalOperations) * 100 : 100;
  stats.averageRetriesPerFailure = stats.failedOperations > 0 ? 
    stats.totalRetries / stats.failedOperations : 0;
  stats.timestamp = new Date().toISOString();
  
  // Reset statistics if requested
  if (reset) {
    retryStats.totalOperations = 0;
    retryStats.successfulOperations = 0;
    retryStats.failedOperations = 0;
    retryStats.retriedOperations = 0;
    retryStats.totalRetries = 0;
    retryStats.serviceStats = {};
  }
  
  return stats;
}

/**
 * Creates a retry pattern monitor for scheduled reporting
 * @param {number} interval - Reporting interval in milliseconds
 * @param {Function} reportFn - Function to call with statistics report
 * @returns {Object} Monitor control interface
 */
function createRetryMonitor(interval = 3600000, reportFn = console.log) {
  let monitorInterval = null;
  
  // Start the monitor
  function start() {
    if (monitorInterval) return;
    
    monitorInterval = setInterval(() => {
      const stats = getRetryStats(true);
      reportFn('Retry Statistics Report', stats);
    }, interval);
    
    return { 
      stop: () => {
        if (monitorInterval) {
          clearInterval(monitorInterval);
          monitorInterval = null;
        }
      }
    };
  }
  
  return { start };
}

module.exports = {
  withRetry,
  calculateBackoff,
  getRetryStats,
  createRetryMonitor,
  DEFAULT_RETRY_CONFIG
}; 