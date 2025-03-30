/**
 * Transaction Validation Service for OTORI Vision
 * 
 * Provides comprehensive transaction validation for Bitcoin transactions
 * as specified in the backend-specific-dev-rules.mdc document.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration values
const config = {
  // Bitcoin network configuration
  network: process.env.BITCOIN_NETWORK || 'testnet',
  bitcoinCliPath: process.env.BITCOIN_CLI_PATH || 'bitcoin-cli',
  walletName: process.env.WALLET_NAME || '',
  
  // Validation thresholds
  confirmationThreshold: parseInt(process.env.CONFIRMATION_THRESHOLD || '1', 10),
  dustLimit: 546, // Standard Bitcoin dust limit in satoshis
  maxInputs: parseInt(process.env.MAX_TX_INPUTS || '100', 10),
  maxOutputs: parseInt(process.env.MAX_TX_OUTPUTS || '100', 10),
  
  // Audit and logging
  logDirectory: process.env.LOG_DIRECTORY || path.join(__dirname, '../../data/logs'),
  auditTrailEnabled: process.env.AUDIT_TRAIL_ENABLED !== 'false',
  logVerbosity: process.env.LOG_VERBOSITY || 'info', // error, warn, info, debug, trace
  
  // Circuit breaker configuration
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
    resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET || '300000', 10), // 5 minutes
    halfOpenTimeout: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN || '60000', 10) // 1 minute
  }
};

// Initialize circuit breaker state
const circuitState = {
  state: 'closed', // closed, open, halfOpen
  failures: 0,
  lastFailure: null,
  lastSuccess: null
};

// Validation statistics
const validationStats = {
  totalValidated: 0,
  inputValidationFailures: 0,
  outputValidationFailures: 0,
  signatureValidationFailures: 0,
  successRate: 100, // percentage
  lastReset: Date.now()
};

// Create log directory if it doesn't exist
if (!fs.existsSync(config.logDirectory)) {
  fs.mkdirSync(config.logDirectory, { recursive: true });
}

/**
 * Executes a bitcoin-cli command with proper error handling
 * @param {string} command - Command to execute
 * @returns {object} Command output (parsed if JSON) 
 */
function executeBitcoinCommand(command) {
  // Check circuit breaker state
  if (circuitState.state === 'open') {
    const now = Date.now();
    const elapsed = now - circuitState.lastFailure;
    
    if (elapsed < config.circuitBreaker.resetTimeout) {
      throw new Error('Circuit breaker open: Bitcoin node connection is currently unavailable');
    }
    
    // Move to half-open state after timeout
    circuitState.state = 'halfOpen';
    console.log('Circuit breaker moved to half-open state');
  }
  
  try {
    let fullCommand = `${config.bitcoinCliPath}`;
    
    if (config.network === 'testnet') {
      fullCommand += ' -testnet';
    } else if (config.network === 'regtest') {
      fullCommand += ' -regtest';
    }
    
    if (config.walletName) {
      fullCommand += ` -rpcwallet=${config.walletName}`;
    }
    
    fullCommand += ` ${command}`;
    
    // Execute command and get output
    const output = execSync(fullCommand).toString().trim();
    
    // Try to parse as JSON, return string if not valid JSON
    try {
      const result = JSON.parse(output);
      
      // If we get here, command succeeded - update circuit breaker
      if (circuitState.state === 'halfOpen') {
        circuitState.state = 'closed';
        circuitState.failures = 0;
        console.log('Circuit breaker closed: Bitcoin node connection restored');
      }
      
      circuitState.lastSuccess = Date.now();
      return result;
    } catch (e) {
      // Not JSON, return as string
      if (circuitState.state === 'halfOpen') {
        circuitState.state = 'closed';
        circuitState.failures = 0;
      }
      circuitState.lastSuccess = Date.now();
      return output;
    }
  } catch (error) {
    // Update circuit breaker on failure
    circuitState.failures++;
    circuitState.lastFailure = Date.now();
    
    if (circuitState.failures >= config.circuitBreaker.failureThreshold) {
      circuitState.state = 'open';
      console.error(`Circuit breaker opened after ${circuitState.failures} failures`);
    }
    
    console.error(`Error executing Bitcoin command: ${command}`, error);
    logValidationFailure('bitcoinRPC', error.message);
    
    throw new Error(`Bitcoin RPC error: ${error.message}`);
  }
}

/**
 * Logs a validation event to the audit trail
 * @param {string} event - Event name
 * @param {object} data - Event data 
 */
function logValidationEvent(event, data) {
  if (!config.auditTrailEnabled) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    data
  };
  
  // Write to daily audit log file
  const date = timestamp.split('T')[0];
  const logFile = path.join(config.logDirectory, `validation-${date}.log`);
  
  try {
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('Error writing to audit log:', error);
  }
}

/**
 * Logs a validation failure and updates statistics
 * @param {string} validationType - Type of validation that failed
 * @param {string} reason - Reason for failure
 * @param {object} details - Additional details
 */
function logValidationFailure(validationType, reason, details = {}) {
  // Update statistics
  validationStats.totalValidated++;
  
  switch (validationType) {
    case 'input':
      validationStats.inputValidationFailures++;
      break;
    case 'output':
      validationStats.outputValidationFailures++;
      break;
    case 'signature':
      validationStats.signatureValidationFailures++;
      break;
  }
  
  // Recalculate success rate
  const failures = 
    validationStats.inputValidationFailures + 
    validationStats.outputValidationFailures + 
    validationStats.signatureValidationFailures;
  
  validationStats.successRate = ((validationStats.totalValidated - failures) / validationStats.totalValidated) * 100;
  
  // Log to audit trail
  logValidationEvent('validationFailure', {
    validationType,
    reason,
    details,
    timestamp: Date.now()
  });
}

/**
 * Verifies that a UTXO exists and is spendable
 * @param {string} txid - Transaction ID
 * @param {number} vout - Output index
 * @returns {Promise<object>} UTXO information if valid
 */
async function verifyUtxoExistence(txid, vout) {
  try {
    // Get transaction details
    const tx = executeBitcoinCommand(`gettxout ${txid} ${vout}`);
    
    // If null, UTXO doesn't exist or is already spent
    if (tx === null) {
      logValidationFailure('input', `UTXO ${txid}:${vout} does not exist or is already spent`);
      return { exists: false, error: 'UTXO does not exist or is already spent' };
    }
    
    // Check confirmations
    if (tx.confirmations < config.confirmationThreshold) {
      logValidationFailure('input', `UTXO ${txid}:${vout} has insufficient confirmations`, { 
        required: config.confirmationThreshold, 
        actual: tx.confirmations 
      });
      return { 
        exists: true, 
        spendable: false, 
        error: `Insufficient confirmations (${tx.confirmations}/${config.confirmationThreshold})` 
      };
    }
    
    return { 
      exists: true, 
      spendable: true, 
      value: Math.round(tx.value * 100000000), // Convert BTC to satoshis
      scriptPubKey: tx.scriptPubKey,
      confirmations: tx.confirmations
    };
  } catch (error) {
    logValidationFailure('input', `Error verifying UTXO ${txid}:${vout}`, { error: error.message });
    throw error;
  }
}

/**
 * Validates a transaction's inputs
 * @param {object} transaction - Transaction object with inputs
 * @returns {Promise<object>} Validation result
 */
async function validateTransactionInputs(transaction) {
  if (!transaction || !transaction.inputs || !Array.isArray(transaction.inputs)) {
    logValidationFailure('input', 'Invalid transaction inputs format');
    return { valid: false, error: 'Invalid transaction inputs format' };
  }
  
  // Check if number of inputs is within limits
  if (transaction.inputs.length > config.maxInputs) {
    logValidationFailure('input', `Too many inputs: ${transaction.inputs.length}/${config.maxInputs}`);
    return { valid: false, error: `Too many inputs: ${transaction.inputs.length}/${config.maxInputs}` };
  }
  
  if (transaction.inputs.length === 0) {
    logValidationFailure('input', 'Transaction must have at least one input');
    return { valid: false, error: 'Transaction must have at least one input' };
  }
  
  // Validate each input
  const inputResults = await Promise.all(transaction.inputs.map(async (input) => {
    if (!input.txid || input.vout === undefined) {
      return { 
        valid: false, 
        error: 'Input missing txid or vout',
        input
      };
    }
    
    try {
      const utxoResult = await verifyUtxoExistence(input.txid, input.vout);
      return {
        valid: utxoResult.exists && utxoResult.spendable,
        error: utxoResult.error,
        input,
        utxoInfo: utxoResult
      };
    } catch (error) {
      return { 
        valid: false, 
        error: `UTXO verification failed: ${error.message}`,
        input
      };
    }
  }));
  
  // Check if all inputs are valid
  const invalidInputs = inputResults.filter(result => !result.valid);
  
  if (invalidInputs.length > 0) {
    logValidationFailure('input', 'One or more inputs are invalid', { invalidInputs });
    return { 
      valid: false, 
      error: 'One or more inputs are invalid',
      invalidInputs
    };
  }
  
  // Calculate total input value
  const totalInputValue = inputResults.reduce((sum, result) => {
    return sum + (result.utxoInfo?.value || 0);
  }, 0);
  
  return { 
    valid: true, 
    inputResults,
    totalInputValue
  };
}

/**
 * Validates transaction outputs
 * @param {object} transaction - Transaction object with outputs
 * @param {number} totalInputValue - Total value of all inputs
 * @returns {object} Validation result
 */
function validateTransactionOutputs(transaction, totalInputValue) {
  if (!transaction || !transaction.outputs || !Array.isArray(transaction.outputs)) {
    logValidationFailure('output', 'Invalid transaction outputs format');
    return { valid: false, error: 'Invalid transaction outputs format' };
  }
  
  // Check if number of outputs is within limits
  if (transaction.outputs.length > config.maxOutputs) {
    logValidationFailure('output', `Too many outputs: ${transaction.outputs.length}/${config.maxOutputs}`);
    return { valid: false, error: `Too many outputs: ${transaction.outputs.length}/${config.maxOutputs}` };
  }
  
  if (transaction.outputs.length === 0) {
    logValidationFailure('output', 'Transaction must have at least one output');
    return { valid: false, error: 'Transaction must have at least one output' };
  }
  
  // Validate each output
  const outputResults = transaction.outputs.map(output => {
    // Check for required fields
    if (!output.address || !output.value) {
      return {
        valid: false,
        error: 'Output missing address or value',
        output
      };
    }
    
    // Check for dust outputs
    if (output.value < config.dustLimit) {
      return {
        valid: false,
        error: `Output value below dust limit (${output.value} < ${config.dustLimit})`,
        output
      };
    }
    
    // Validate address format - basic checks
    // Full validation would require bitcoinjs-lib
    const addressValid = validateAddressFormat(output.address);
    if (!addressValid.valid) {
      return {
        valid: false,
        error: addressValid.error,
        output
      };
    }
    
    return {
      valid: true,
      output
    };
  });
  
  // Check if all outputs are valid
  const invalidOutputs = outputResults.filter(result => !result.valid);
  
  if (invalidOutputs.length > 0) {
    logValidationFailure('output', 'One or more outputs are invalid', { invalidOutputs });
    return { 
      valid: false, 
      error: 'One or more outputs are invalid',
      invalidOutputs
    };
  }
  
  // Calculate total output value
  const totalOutputValue = transaction.outputs.reduce((sum, output) => {
    return sum + (output.value || 0);
  }, 0);
  
  // Check if total output value is within range of input value (accounting for fee)
  if (totalOutputValue > totalInputValue) {
    logValidationFailure('output', 'Total output value exceeds input value', { 
      totalInputValue, 
      totalOutputValue 
    });
    return { 
      valid: false, 
      error: 'Total output value exceeds input value (attempting to spend more than available)',
      totalInputValue,
      totalOutputValue
    };
  }
  
  // Calculate fee
  const fee = totalInputValue - totalOutputValue;
  
  // Very basic fee validation - ensure fee is reasonable
  // A more advanced implementation would validate fee based on tx size and market rates
  if (fee < 0) {
    logValidationFailure('output', 'Negative fee', { fee });
    return { valid: false, error: 'Transaction fee cannot be negative' };
  }
  
  if (fee > totalInputValue * 0.5 && fee > 100000) { // Over 50% of input and over 0.001 BTC
    logValidationFailure('output', 'Excessive fee', { fee, totalInputValue });
    return { 
      valid: false, 
      error: 'Transaction fee is excessive',
      fee,
      totalInputValue
    };
  }
  
  return { 
    valid: true, 
    outputResults,
    totalOutputValue,
    fee
  };
}

/**
 * Very basic address format validation
 * @param {string} address - Bitcoin address to validate
 * @returns {object} Validation result
 */
function validateAddressFormat(address) {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address must be a string' };
  }
  
  // Basic format checks based on address type
  // This is a simplified version - a full validator would use bitcoinjs-lib
  
  // Bech32 (segwit v0 and v1)
  if (address.startsWith('bc1') || address.startsWith('tb1')) {
    // Check length
    if (address.length < 14 || address.length > 74) {
      return { valid: false, error: 'Invalid Bech32 address length' };
    }
    return { valid: true, type: 'segwit' };
  }
  
  // P2PKH
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    if (address.length !== 26 && address.length !== 34) {
      return { valid: false, error: 'Invalid P2PKH address length' };
    }
    return { valid: true, type: 'p2pkh' };
  }
  
  // P2SH
  if (address.startsWith('3') || address.startsWith('2')) {
    if (address.length !== 34) {
      return { valid: false, error: 'Invalid P2SH address length' };
    }
    return { valid: true, type: 'p2sh' };
  }
  
  return { valid: false, error: 'Unknown address format' };
}

/**
 * Validates transaction signature(s)
 * @param {object} transaction - Transaction with signature data
 * @returns {object} Validation result
 */
function validateTransactionSignature(transaction) {
  // For PSBT validation, we would use Bitcoin Core's analyzepsbt
  // This is a simplified version
  
  if (!transaction.psbt && !transaction.rawHex) {
    logValidationFailure('signature', 'Missing transaction data (psbt or rawHex)');
    return { valid: false, error: 'Missing transaction data (psbt or rawHex)' };
  }
  
  try {
    let result;
    
    if (transaction.psbt) {
      // Use Bitcoin Core to analyze the PSBT
      result = executeBitcoinCommand(`analyzepsbt ${transaction.psbt}`);
      
      if (result.error) {
        logValidationFailure('signature', `PSBT analysis error: ${result.error}`);
        return { valid: false, error: `PSBT analysis error: ${result.error}` };
      }
      
      // Check if PSBT is complete
      if (result.complete === true) {
        return { valid: true, isComplete: true };
      }
      
      // If not complete, check what's missing
      if (result.next === 'signer') {
        // Missing signatures
        return { 
          valid: true, 
          isComplete: false, 
          needsSignatures: true,
          missingSignatures: result.missing || []
        };
      }
      
      return { valid: true, isComplete: false, nextAction: result.next };
    }
    
    if (transaction.rawHex) {
      // For raw transaction hex, use testmempoolaccept
      result = executeBitcoinCommand(`testmempoolaccept '["${transaction.rawHex}"]'`);
      
      if (!Array.isArray(result) || result.length === 0) {
        logValidationFailure('signature', 'Invalid testmempoolaccept response');
        return { valid: false, error: 'Invalid mempool test response' };
      }
      
      if (result[0].allowed) {
        return { valid: true, isComplete: true, allowedInMempool: true };
      } else {
        logValidationFailure('signature', `Transaction rejected by mempool: ${result[0].reject_reason}`);
        return { 
          valid: false, 
          isComplete: true, 
          allowedInMempool: false,
          rejectReason: result[0].reject_reason
        };
      }
    }
    
    return { valid: false, error: 'Unsupported transaction format' };
  } catch (error) {
    logValidationFailure('signature', `Signature validation error: ${error.message}`);
    return { valid: false, error: `Signature validation error: ${error.message}` };
  }
}

/**
 * Comprehensive transaction validation
 * @param {object} transaction - Transaction to validate
 * @returns {Promise<object>} Validation result
 */
async function validateTransaction(transaction) {
  if (!transaction) {
    logValidationFailure('transaction', 'No transaction provided');
    return { valid: false, error: 'No transaction provided' };
  }
  
  try {
    validationStats.totalValidated++;
    
    // Log the validation attempt
    logValidationEvent('validationStart', {
      transactionId: transaction.txid || 'unknown',
      timestamp: Date.now()
    });
    
    // Validate inputs
    const inputValidation = await validateTransactionInputs(transaction);
    if (!inputValidation.valid) {
      return { 
        valid: false, 
        stage: 'input',
        error: inputValidation.error,
        details: inputValidation
      };
    }
    
    // Validate outputs using total input value from input validation
    const outputValidation = validateTransactionOutputs(transaction, inputValidation.totalInputValue);
    if (!outputValidation.valid) {
      return { 
        valid: false, 
        stage: 'output',
        error: outputValidation.error,
        details: outputValidation
      };
    }
    
    // Validate signatures
    const signatureValidation = validateTransactionSignature(transaction);
    if (!signatureValidation.valid) {
      return { 
        valid: false, 
        stage: 'signature',
        error: signatureValidation.error,
        details: signatureValidation
      };
    }
    
    // Log successful validation
    logValidationEvent('validationSuccess', {
      transactionId: transaction.txid || 'unknown',
      fee: outputValidation.fee,
      isComplete: signatureValidation.isComplete,
      timestamp: Date.now()
    });
    
    // Return comprehensive validation result
    return {
      valid: true,
      inputValidation,
      outputValidation,
      signatureValidation,
      fee: outputValidation.fee,
      isComplete: signatureValidation.isComplete
    };
  } catch (error) {
    logValidationFailure('transaction', `Validation error: ${error.message}`);
    return { 
      valid: false, 
      error: `Validation error: ${error.message}`
    };
  }
}

/**
 * Get validation statistics
 * @param {boolean} reset - Whether to reset stats after retrieval
 * @returns {object} Validation statistics
 */
function getValidationStats(reset = false) {
  const stats = {
    ...validationStats,
    circuitBreaker: {
      state: circuitState.state,
      failures: circuitState.failures,
      lastFailure: circuitState.lastFailure,
      lastSuccess: circuitState.lastSuccess
    },
    configuredThresholds: {
      confirmationThreshold: config.confirmationThreshold,
      dustLimit: config.dustLimit,
      circuitBreakerThreshold: config.circuitBreaker.failureThreshold
    }
  };
  
  if (reset) {
    // Reset statistics
    validationStats.totalValidated = 0;
    validationStats.inputValidationFailures = 0;
    validationStats.outputValidationFailures = 0;
    validationStats.signatureValidationFailures = 0;
    validationStats.successRate = 100;
    validationStats.lastReset = Date.now();
  }
  
  return stats;
}

/**
 * Generate a validation report for a given time period
 * @param {string} period - Time period ('day', 'week', 'month')
 * @returns {Promise<object>} Validation report
 */
async function generateValidationReport(period = 'day') {
  let daysToAnalyze;
  switch (period) {
    case 'week':
      daysToAnalyze = 7;
      break;
    case 'month':
      daysToAnalyze = 30;
      break;
    case 'day':
    default:
      daysToAnalyze = 1;
      break;
  }
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysToAnalyze);
  
  const report = {
    period,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    validationCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    failuresByType: {
      input: 0,
      output: 0,
      signature: 0,
      other: 0
    },
    dailyStats: []
  };
  
  try {
    // Collect logs for the period
    const logEntries = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const logFile = path.join(config.logDirectory, `validation-${dateStr}.log`);
      
      const dailyStat = {
        date: dateStr,
        validationCount: 0,
        successCount: 0,
        failureCount: 0
      };
      
      // Check if log file exists
      if (fs.existsSync(logFile)) {
        try {
          const logContent = fs.readFileSync(logFile, 'utf8');
          const lines = logContent.trim().split('\n');
          
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              logEntries.push(entry);
              
              // Update daily stats
              if (entry.event === 'validationStart') {
                dailyStat.validationCount++;
              } else if (entry.event === 'validationSuccess') {
                dailyStat.successCount++;
              } else if (entry.event === 'validationFailure') {
                dailyStat.failureCount++;
              }
            } catch (e) {
              console.error(`Error parsing log entry: ${e.message}`);
            }
          }
        } catch (e) {
          console.error(`Error reading log file ${logFile}: ${e.message}`);
        }
      }
      
      report.dailyStats.push(dailyStat);
    }
    
    // Analyze logs
    const validationStarts = logEntries.filter(entry => entry.event === 'validationStart');
    const validationSuccesses = logEntries.filter(entry => entry.event === 'validationSuccess');
    const validationFailures = logEntries.filter(entry => entry.event === 'validationFailure');
    
    report.validationCount = validationStarts.length;
    report.successCount = validationSuccesses.length;
    report.failureCount = validationFailures.length;
    
    if (report.validationCount > 0) {
      report.successRate = (report.successCount / report.validationCount) * 100;
    }
    
    // Count failures by type
    for (const failure of validationFailures) {
      if (failure.data && failure.data.validationType) {
        const type = failure.data.validationType;
        report.failuresByType[type] = (report.failuresByType[type] || 0) + 1;
      } else {
        report.failuresByType.other++;
      }
    }
    
    return report;
  } catch (error) {
    console.error('Error generating validation report:', error);
    throw new Error(`Report generation error: ${error.message}`);
  }
}

module.exports = {
  validateTransaction,
  validateTransactionInputs,
  validateTransactionOutputs,
  validateTransactionSignature,
  getValidationStats,
  generateValidationReport,
  // Export some utilities for testing
  validateAddressFormat,
  verifyUtxoExistence
}; 