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
  const sshPassword = process.env.ORDPI_SSH_PASSWORD;
  const sshHost = process.env.ORDPI_SSH_HOST || '91.7.62.224';
  const sshPort = process.env.ORDPI_SSH_PORT || '2211';
  const sshUser = process.env.ORDPI_SSH_USER || 'BTCPi';
  
  if (!sshPassword) {
    throw new Error('SSH password not configured. Set ORDPI_SSH_PASSWORD environment variable.');
  }
  
  // Build the sshpass command
  const sshCommand = `sshpass -p "${sshPassword}" ssh -o StrictHostKeyChecking=no -p ${sshPort} ${sshUser}@${sshHost} "${command}"`;
  
  const logCommand = `sshpass -p "[REDACTED]" ssh -o StrictHostKeyChecking=no -p ${sshPort} ${sshUser}@${sshHost} "${command}"`;
  console.log(`Executing SSH command: ${logCommand}`);
  
  // Execute the command
  const result = await executeCommand(sshCommand, options);
  console.log(`Command result: ${result.stdout}`);
  
  return result;
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
    if (config.bitcoin.walletName) {
      fullCommand += ` -rpcwallet=${config.bitcoin.walletName}`;
    }
    
    // Add RPC connection parameters if provided
    if (config.bitcoin.rpcUser && config.bitcoin.rpcPassword) {
      fullCommand += ` -rpcuser=${config.bitcoin.rpcUser} -rpcpassword=${config.bitcoin.rpcPassword}`;
    }
    
    if (config.bitcoin.rpcHost && config.bitcoin.rpcPort) {
      fullCommand += ` -rpcconnect=${config.bitcoin.rpcHost} -rpcport=${config.bitcoin.rpcPort}`;
    }
    
    // Add the actual command
    fullCommand += ` ${command}`;
    
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
    
    // Add wallet if specified
    if (config.bitcoin.walletName) {
      fullCommand += ` -rpcwallet=${config.bitcoin.walletName}`;
    }
    
    // Add RPC connection parameters if provided
    if (config.bitcoin.rpcUser && config.bitcoin.rpcPassword) {
      fullCommand += ` -rpcuser=${config.bitcoin.rpcUser} -rpcpassword=${config.bitcoin.rpcPassword}`;
    }
    
    if (config.bitcoin.rpcHost && config.bitcoin.rpcPort) {
      fullCommand += ` -rpcconnect=${config.bitcoin.rpcHost} -rpcport=${config.bitcoin.rpcPort}`;
    }
    
    // Add the actual command
    fullCommand += ` ${command}`;
    
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
  // Mask passwords in RPC commands
  if (command.includes('-rpcpassword=')) {
    command = command.replace(/-rpcpassword=\S+/g, '-rpcpassword=[REDACTED]');
  }
  
  // Mask private keys (assumes they are hex strings of 64 characters)
  command = command.replace(/[a-f0-9]{64}/gi, '[REDACTED_KEY]');
  
  return command;
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