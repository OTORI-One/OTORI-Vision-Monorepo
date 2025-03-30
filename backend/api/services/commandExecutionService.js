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
 * Executes a command on a remote server via SSH
 * @param {string} command - Command to execute
 * @param {Object} sshConfig - SSH configuration
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Command result
 */
function executeRemoteCommand(command, sshConfig, options = {}) {
  const cmdOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };
  
  const logCommand = maskSensitiveInfo(command);
  console.log(`Executing remote command on ${sshConfig.host}: ${logCommand}`);
  
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let completed = false;
    
    // Create SSH client
    const conn = new Client();
    
    // Handle connection timeout
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        conn.end();
        reject(new Error(`Connection timeout after ${cmdOptions.timeout}ms`));
      }
    }, cmdOptions.timeout);
    
    // Handle connection errors
    conn.on('error', (error) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    });
    
    // Handle connection close
    conn.on('close', () => {
      if (!completed) {
        completed = true;
        clearTimeout(timeoutId);
        reject(new Error('Connection closed unexpectedly'));
      }
    });
    
    // Connect to SSH server
    conn.connect({
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      password: sshConfig.password,
      privateKey: sshConfig.privateKey ? fs.readFileSync(sshConfig.privateKey) : undefined,
      passphrase: sshConfig.passphrase,
    });
    
    // Handle successful connection
    conn.on('ready', () => {
      // Execute command
      conn.exec(command, (err, stream) => {
        if (err) {
          completed = true;
          clearTimeout(timeoutId);
          conn.end();
          return reject(err);
        }
        
        // Collect command output
        stream.on('data', (data) => {
          stdout += data.toString();
          if (cmdOptions.onOutput) {
            cmdOptions.onOutput(data.toString());
          }
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString();
          if (cmdOptions.onOutput) {
            cmdOptions.onOutput(data.toString());
          }
        });
        
        // Handle command completion
        stream.on('close', (code) => {
          clearTimeout(timeoutId);
          conn.end();
          completed = true;
          
          if (code !== 0) {
            const error = new Error(`Command failed with exit code ${code}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            return reject(error);
          }
          
          resolve({ stdout, stderr });
        });
      });
    });
  });
}

/**
 * Executes a command on a remote server via sshpass
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Command result
 */
async function executeSshPassCommand(command, options = {}) {
  // Get SSH configuration from environment
  // IMPORTANT: Never log or expose the password in any way
  // Use environment variables for sensitive information
  let sshPassword;
  
  // Check for password in environment variables - multiple possible locations
  if (process.env.ORDPI_SSH_PASSWORD) {
    sshPassword = process.env.ORDPI_SSH_PASSWORD;
  } else if (process.env.SSH_PASSWORD) {
    sshPassword = process.env.SSH_PASSWORD;
  } else {
    // Throw error if password not available but don't log anything sensitive
    throw new Error('SSH password not configured. Set ORDPI_SSH_PASSWORD or SSH_PASSWORD environment variable.');
  }
  
  const sshHost = process.env.ORDPI_SSH_HOST || '91.7.62.224';
  const sshPort = process.env.ORDPI_SSH_PORT || '2211';
  const sshUser = process.env.ORDPI_SSH_USER || 'BTCPi';
  
  // Build the sshpass command - NEVER include the actual password in logs
  const sshCommand = `sshpass -p "${sshPassword}" ssh -o StrictHostKeyChecking=no -p ${sshPort} ${sshUser}@${sshHost} "${command}"`;
  
  // Use a redacted log version that NEVER shows the password
  const logCommand = `sshpass -p "[REDACTED]" ssh -o StrictHostKeyChecking=no -p ${sshPort} ${sshUser}@${sshHost} "${command}"`;
  console.log(`Executing SSH command: ${logCommand}`);
  
  try {
    // Execute the command but never log the actual command with password
    const result = await executeCommand(sshCommand, {
      ...options,
      // Make sure the full command with password is never logged in error messages
      onError: (err) => {
        // Remove any trace of password from error messages
        if (err.message && err.message.includes(sshPassword)) {
          err.message = err.message.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
        }
        if (err.stderr && err.stderr.includes(sshPassword)) {
          err.stderr = err.stderr.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
        }
        if (err.stdout && err.stdout.includes(sshPassword)) {
          err.stdout = err.stdout.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
        }
        if (options.onError) options.onError(err);
      }
    });
    
    // Make sure we don't accidentally log the password in the result
    if (result.stdout && result.stdout.includes(sshPassword)) {
      result.stdout = result.stdout.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
    }
    if (result.stderr && result.stderr.includes(sshPassword)) {
      result.stderr = result.stderr.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
    }
    
    // Only log the results, not the command that might contain the password
    console.log(`Command result: ${result.stdout}`);
    
    return result;
  } catch (error) {
    // Sanitize the error to remove any passwords before throwing
    if (error && typeof error === 'object') {
      // Handle all properties that might contain the password
      if (error.message && error.message.includes(sshPassword)) {
        error.message = error.message.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
      }
      if (error.stack && error.stack.includes(sshPassword)) {
        error.stack = error.stack.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
      }
      if (error.cmd && error.cmd.includes(sshPassword)) {
        error.cmd = error.cmd.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
      }
      if (error.stdout && error.stdout.includes(sshPassword)) {
        error.stdout = error.stdout.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
      }
      if (error.stderr && error.stderr.includes(sshPassword)) {
        error.stderr = error.stderr.replace(new RegExp(sshPassword, 'g'), '[REDACTED]');
      }
    }
    
    throw error;
  }
}

/**
 * Executes a Bitcoin CLI command remotely over SSH
 * @param {string} command - Bitcoin CLI command (without bitcoin-cli prefix)
 * @param {Object} options - Execution options
 * @returns {Promise<any>} Command result (parsed if JSON)
 */
async function executeRemoteBitcoinCommand(command, options = {}) {
  try {
    // Get remote Bitcoin CLI path from config or environment
    const remoteBitcoinCliPath = process.env.REMOTE_BITCOIN_CLI_PATH || '/usr/local/bin/bitcoin-cli';
    
    // Build the bitcoin-cli command with appropriate network and wallet parameters
    let fullCommand = `${remoteBitcoinCliPath}`;
    
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
    console.log(`Remote Bitcoin command: ${logCommand}`);
    
    // Execute the command remotely
    const { stdout } = await executeSshPassCommand(fullCommand, options);
    
    // Try to parse as JSON, return string if not valid JSON
    try {
      return JSON.parse(stdout);
    } catch (e) {
      // Not JSON, return as string
      return stdout.trim();
    }
  } catch (error) {
    console.error(`Error executing remote Bitcoin command: ${command}`, error);
    throw error;
  }
}

/**
 * Executes a Bitcoin CLI command
 * @param {string} command - Bitcoin CLI command
 * @param {Object} options - Execution options
 * @returns {Promise<any>} Command result (parsed if JSON)
 */
async function executeBitcoinCommand(command, options = {}) {
  // Check if we should use remote execution based on environment
  const useRemoteExecution = process.env.USE_REMOTE_BITCOIN_CLI === 'true' || 
                            process.env.NODE_ENV === 'development' ||
                            !fs.existsSync(config.bitcoin.bitcoinCliPath);
  
  if (useRemoteExecution) {
    console.log(`Using remote Bitcoin CLI execution for command: ${command}`);
    return executeRemoteBitcoinCommand(command, options);
  }
  
  try {
    // Build the bitcoin-cli command with appropriate network and wallet parameters
    let fullCommand = `${config.bitcoin.bitcoinCliPath}`;
    
    // Add network flag
    if (config.bitcoin.network === 'testnet') {
      fullCommand += ' -testnet';
    } else if (config.bitcoin.network === 'signet') {
      fullCommand += ' -signet';
    } else if (config.bitcoin.network === 'regtest') {
      fullCommand += ' -regtest';
    }
    
    // Add wallet if specified - use environment variable first
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
  executeRemoteCommand,
  executeSshPassCommand,
  executeBitcoinCommand,
  executeRemoteBitcoinCommand,
  DEFAULT_RETRY_OPTIONS,
  maskSensitiveInfo,
}; 