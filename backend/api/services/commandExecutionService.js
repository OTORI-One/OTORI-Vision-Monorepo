/**
 * Command Execution Service for OTORI Vision
 * 
 * Standardizes command execution across different services and scripts.
 * Provides reliable error handling, retry logic, and logging for
 * both local and remote command execution.
 */

const { exec, execSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const config = require('./configService');

// Default retry options
const DEFAULT_RETRY_OPTIONS = {
  attempts: 3,
  delay: 1000, // ms
  backoff: 2, // exponential backoff factor
  timeout: 30000, // ms
};

/**
 * Executes a command with retry logic
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Command result
 */
async function executeCommand(command, options = {}) {
  const cmdOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
    timeout: options.timeout || DEFAULT_RETRY_OPTIONS.timeout,
  };
  
  const logCommand = maskSensitiveInfo(command);
  console.log(`Executing command: ${logCommand}`);
  
  let attempt = 0;
  let delay = cmdOptions.delay;
  
  while (attempt < cmdOptions.attempts) {
    attempt++;
    
    try {
      return await executeCommandOnce(command, cmdOptions);
    } catch (error) {
      if (attempt === cmdOptions.attempts) {
        console.error(`Command failed after ${attempt} attempts: ${logCommand}`);
        throw error;
      }
      
      console.warn(`Command attempt ${attempt} failed: ${logCommand}`);
      console.warn(`Error: ${error.message}`);
      console.warn(`Retrying in ${delay}ms...`);
      
      // Wait for delay before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increase delay with exponential backoff
      delay *= cmdOptions.backoff;
    }
  }
}

/**
 * Executes a command once
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Command result
 */
function executeCommandOnce(command, options) {
  return new Promise((resolve, reject) => {
    const childProcess = exec(command, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer || 1024 * 1024, // 1MB
      env: { ...process.env, ...options.env },
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      
      resolve({ stdout, stderr });
    });
    
    if (options.onOutput) {
      if (childProcess.stdout) {
        childProcess.stdout.on('data', options.onOutput);
      }
      
      if (childProcess.stderr) {
        childProcess.stderr.on('data', options.onOutput);
      }
    }
  });
}

/**
 * Executes a command synchronously
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Object} Command result
 */
function executeCommandSync(command, options = {}) {
  const logCommand = maskSensitiveInfo(command);
  console.log(`Executing command synchronously: ${logCommand}`);
  
  try {
    const stdout = execSync(command, {
      timeout: options.timeout || DEFAULT_RETRY_OPTIONS.timeout,
      maxBuffer: options.maxBuffer || 1024 * 1024, // 1MB
      env: { ...process.env, ...options.env },
    }).toString();
    
    return { stdout, stderr: '' };
  } catch (error) {
    console.error(`Command failed: ${logCommand}`);
    console.error(`Error: ${error.message}`);
    
    if (error.stdout) {
      console.error(`stdout: ${error.stdout.toString()}`);
    }
    
    if (error.stderr) {
      console.error(`stderr: ${error.stderr.toString()}`);
    }
    
    throw error;
  }
}

/**
 * Executes a Bitcoin CLI command locally
 * @param {string} command - Bitcoin CLI command (without bitcoin-cli prefix)
 * @param {Object} options - Execution options
 * @returns {Promise<any>} Command result (parsed if JSON)
 */
async function executeBitcoinCommand(command, options = {}) {
  // Remote execution logic removed - always assumes local execution relative to the service
  
  try {
    // Build the bitcoin-cli command with appropriate network and wallet parameters
    // Ensure configService provides the correct path for the *current* environment
    let fullCommand = `${config.bitcoin.bitcoinCliPath}`; 
    
    // Add network flag
    if (config.bitcoin.network === 'testnet') {
      fullCommand += ' -testnet';
    } else if (config.bitcoin.network === 'signet') {
      fullCommand += ' -signet';
    } else if (config.bitcoin.network === 'regtest') {
      fullCommand += ' -regtest';
    }
    
    // Add wallet if specified
    if (process.env.BITCOIN_WALLET) {
      fullCommand += ` -rpcwallet=${process.env.BITCOIN_WALLET}`;
    } else if (config.bitcoin.walletName) {
      fullCommand += ` -rpcwallet=${config.bitcoin.walletName}`;
    }
    
    // Add RPC connection parameters if provided in environment or config
    // Use environment variables first, then fall back to config
    const rpcUser = process.env.BITCOIN_RPC_USER || config.bitcoin.rpcUser;
    const rpcPassword = process.env.BITCOIN_RPC_PASSWORD || config.bitcoin.rpcPassword;
    const rpcHost = process.env.BITCOIN_RPC_HOST || config.bitcoin.rpcHost;
    const rpcPort = process.env.BITCOIN_RPC_PORT || config.bitcoin.rpcPort;
    
    if (rpcUser && rpcPassword) {
      fullCommand += ` -rpcuser=${rpcUser} -rpcpassword=${rpcPassword}`;
    }
    
    // Always include RPC connection details to avoid defaulting to incorrect values
    fullCommand += ` -rpcconnect=${rpcHost} -rpcport=${rpcPort}`;
    
    // Add the actual command
    fullCommand += ` ${command}`;
    
    // Log the command for debugging (without sensitive info)
    const logCommand = fullCommand.replace(/-rpcpassword=\S+/g, '-rpcpassword=[REDACTED]');
    console.log(`Bitcoin command: ${logCommand}`);
    
    // Execute the command with retry logic
    const { stdout } = await executeCommand(fullCommand, options);
    
    // Try to parse as JSON, return string if not valid JSON
    try {
      return JSON.parse(stdout);
    } catch (e) {
      // Not JSON, return as string
      return stdout.trim();
    }
  } catch (error) {
    console.error(`Error executing Bitcoin command: ${command}`, error);
    throw error;
  }
}

/**
 * Masks sensitive information in command strings
 * @param {string} command - Command string
 * @returns {string} Command with sensitive info masked
 */
function maskSensitiveInfo(command) {
  if (!command) return command;
  
  let maskedCommand = command;
  
  // Get passwords from environment for masking - NEVER log these directly
  const sensitiveVars = [
    process.env.ORDPI_SSH_PASSWORD,
    process.env.BITCOIN_RPC_PASSWORD,
    process.env.SSH_PASSWORD
  ].filter(Boolean); // Remove undefined/null values
  
  // Mask passwords in RPC commands with better regex
  if (maskedCommand.includes('-rpcpassword=')) {
    maskedCommand = maskedCommand.replace(/-rpcpassword=["']?[^"'\s]+["']?/g, '-rpcpassword=[REDACTED]');
  }
  
  // Mask SSH passwords in sshpass commands with improved pattern
  if (maskedCommand.includes('sshpass -p')) {
    maskedCommand = maskedCommand.replace(/sshpass -p ["'].*?["']/g, 'sshpass -p "[REDACTED]"');
  }
  
  // Mask private keys (assumes they are hex strings of 64 characters)
  maskedCommand = maskedCommand.replace(/[a-f0-9]{64}/gi, '[REDACTED_KEY]');
  
  // Mask potential passwords from environment variables
  // This is done at the end to catch any passwords that might be in the command
  // but weren't caught by the specific patterns above
  sensitiveVars.forEach(password => {
    if (password && maskedCommand.includes(password)) {
      // Use regex to replace all occurrences safely
      const safePassword = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special regex chars
      maskedCommand = maskedCommand.replace(new RegExp(safePassword, 'g'), '[REDACTED]');
    }
  });
  
  return maskedCommand;
}

module.exports = {
  executeCommand,
  executeCommandSync,
  executeBitcoinCommand,
  DEFAULT_RETRY_OPTIONS,
  maskSensitiveInfo,
}; 