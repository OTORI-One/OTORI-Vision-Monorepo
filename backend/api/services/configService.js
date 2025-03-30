/**
 * Configuration Service for OTORI Vision
 * 
 * Centralizes configuration management for all services and scripts
 * to ensure consistent settings across the codebase.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Base configuration with defaults
const baseConfig = {
  // Bitcoin network configuration
  bitcoin: {
    network: process.env.BITCOIN_NETWORK || 'testnet',
    bitcoinCliPath: process.env.BITCOIN_CLI_PATH || 'bitcoin-cli',
    walletName: process.env.WALLET_NAME || '',
    rpcUser: process.env.BITCOIN_RPC_USER,
    rpcPassword: process.env.BITCOIN_RPC_PASSWORD,
    rpcHost: process.env.BITCOIN_RPC_HOST || 'localhost',
    rpcPort: process.env.BITCOIN_RPC_PORT || '38332',
  },
  
  // UTXO management
  utxo: {
    smallUtxoThreshold: parseInt(process.env.SMALL_UTXO_THRESHOLD || '10000', 10),
    dustLimit: 546, // Bitcoin dust limit in satoshis
    preferSmallUtxos: process.env.PREFER_SMALL_UTXOS !== 'false', // Default to true
    defaultFeeRate: parseInt(process.env.DEFAULT_FEE_RATE || '2', 10),
  },
  
  // Transaction validation
  validation: {
    confirmationThreshold: parseInt(process.env.CONFIRMATION_THRESHOLD || '1', 10),
    maxInputs: parseInt(process.env.MAX_TX_INPUTS || '100', 10),
    maxOutputs: parseInt(process.env.MAX_TX_OUTPUTS || '100', 10),
    auditTrailEnabled: process.env.AUDIT_TRAIL_ENABLED !== 'false',
    logVerbosity: process.env.LOG_VERBOSITY || 'info', // error, warn, info, debug, trace
  },
  
  // Admin and Treasury
  admin: {
    requiredSignatures: parseInt(process.env.REQUIRED_SIGNATURES || '3', 10),
    maxAdmins: parseInt(process.env.MAX_ADMINS || '5', 10),
    treasuryAddresses: [
      process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
      process.env.NEXT_PUBLIC_TREASURY_ADDRESS_2 || 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3'
    ],
  },
  
  // LP distribution
  lp: {
    runeId: process.env.RUNE_ID || '240249:101',
    lpAddresses: [
      process.env.PRIMARY_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
      process.env.SECONDARY_LP_ADDRESS || 'tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz',
      process.env.TERTIARY_LP_ADDRESS || 'tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh',
    ],
    distributionWeights: [0.5, 0.3, 0.2], // Proportional distribution
    batchSize: parseInt(process.env.BATCH_SIZE || '5000', 10),
    minBatchSize: parseInt(process.env.MIN_BATCH_SIZE || '1000', 10),
    maxBatchesPerRun: parseInt(process.env.MAX_BATCHES_PER_RUN || '3', 10),
  },
  
  // Circuit breaker
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
    resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET || '300000', 10), // 5 minutes
    halfOpenTimeout: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN || '60000', 10), // 1 minute
  },
  
  // Paths and directories
  paths: {
    dataDir: process.env.DATA_DIR || path.join(__dirname, '../../data'),
    logDirectory: process.env.LOG_DIRECTORY || path.join(__dirname, '../../data/logs'),
    distributionOutputDir: process.env.OUTPUT_DIR || path.join(__dirname, '../../data/lp-distribution'),
  },
  
  // API settings
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3030',
    timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
  }
};

/**
 * Validates required configuration parameters
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result with any errors
 */
function validateConfig(config) {
  const errors = [];
  
  // Check critical Bitcoin configuration
  if (!config.bitcoin.network) {
    errors.push('Bitcoin network is required');
  }
  
  if (!['mainnet', 'testnet', 'signet', 'regtest'].includes(config.bitcoin.network)) {
    errors.push(`Invalid Bitcoin network: ${config.bitcoin.network}`);
  }
  
  // Validate admin configuration
  if (config.admin.requiredSignatures > config.admin.maxAdmins) {
    errors.push(`Required signatures (${config.admin.requiredSignatures}) cannot exceed max admins (${config.admin.maxAdmins})`);
  }
  
  // Validate LP configuration
  if (config.lp.distributionWeights.length !== config.lp.lpAddresses.length) {
    errors.push('Distribution weights count must match LP addresses count');
  }
  
  const weightSum = config.lp.distributionWeights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    errors.push(`Distribution weights sum (${weightSum}) should be approximately 1.0`);
  }
  
  // Validate paths
  try {
    // Ensure critical directories exist
    for (const dirPath of [config.paths.dataDir, config.paths.logDirectory, config.paths.distributionOutputDir]) {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
  } catch (error) {
    errors.push(`Error creating directories: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Loads an environment-specific configuration
 * @param {string} env - Environment name (e.g., 'development', 'production')
 * @returns {Object} Combined configuration
 */
function loadEnvConfig(env) {
  const envConfigPath = path.join(__dirname, `../../config/${env}.json`);
  
  try {
    if (fs.existsSync(envConfigPath)) {
      const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
      // Deep merge of base config and environment-specific config
      return deepMerge(baseConfig, envConfig);
    }
  } catch (error) {
    console.warn(`Could not load environment configuration for ${env}:`, error.message);
  }
  
  return baseConfig;
}

/**
 * Deep merges two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }
  
  return output;
}

/**
 * Checks if a value is an object
 * @param {*} item - Value to check
 * @returns {boolean} Whether the value is an object
 */
function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

// Load configuration for current environment
const env = process.env.NODE_ENV || 'development';
const config = loadEnvConfig(env);

// Validate configuration
const validation = validateConfig(config);
if (!validation.valid) {
  console.warn('Configuration validation warnings:', validation.errors);
}

module.exports = {
  // Export the complete configuration
  ...config,
  
  // Export validation function for testing
  validateConfig,
  
  // Export the current environment
  currentEnv: env,
  
  // Export configuration update method
  updateConfig: (newConfig) => Object.assign(config, deepMerge(config, newConfig))
}; 