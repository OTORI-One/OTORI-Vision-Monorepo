/**
 * Transaction Validation Service for OTORI Vision
 * 
 * Provides comprehensive transaction validation for Bitcoin transactions
 * as specified in the backend-specific-dev-rules.mdc document.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./configService');
const commandService = require('./commandExecutionService');

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
if (!fs.existsSync(config.paths.logDirectory)) {
  fs.mkdirSync(config.paths.logDirectory, { recursive: true });
}

/**
 * Logs a validation event to the audit trail
 * @param {string} event - Event name
 * @param {object} data - Event data 
 */
function logValidationEvent(event, data) {
  if (!config.validation.auditTrailEnabled) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    data
  };
  
  // Write to daily audit log file
  const date = timestamp.split('T')[0];
  const logFile = path.join(config.paths.logDirectory, `validation-${date}.log`);
  
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
      // Get transaction details
      const tx = await commandService.executeBitcoinCommand(`gettxout ${txid} ${vout}`);
      
      // If successful, update circuit breaker state
      if (circuitState.state === 'halfOpen') {
        circuitState.state = 'closed';
        circuitState.failures = 0;
        console.log('Circuit breaker closed: Bitcoin node connection restored');
      }
      circuitState.lastSuccess = Date.now();
      
      // If null, UTXO doesn't exist or is already spent
      if (tx === null) {
        logValidationFailure('input', `UTXO ${txid}:${vout} does not exist or is already spent`);
        return { exists: false, error: 'UTXO does not exist or is already spent' };
      }
      
      // Check confirmations
      if (tx.confirmations < config.validation.confirmationThreshold) {
        logValidationFailure('input', `UTXO ${txid}:${vout} has insufficient confirmations`, { 
          required: config.validation.confirmationThreshold, 
          actual: tx.confirmations 
        });
        return { 
          exists: true, 
          spendable: false, 
          error: `Insufficient confirmations (${tx.confirmations}/${config.validation.confirmationThreshold})` 
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
      // Update circuit breaker on failure
      circuitState.failures++;
      circuitState.lastFailure = Date.now();
      
      if (circuitState.failures >= config.circuitBreaker.failureThreshold) {
        circuitState.state = 'open';
        console.error(`Circuit breaker opened after ${circuitState.failures} failures`);
      }
      
      logValidationFailure('input', `Error verifying UTXO ${txid}:${vout}`, { error: error.message });
      throw error;
    }
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
  if (transaction.inputs.length > config.validation.maxInputs) {
    logValidationFailure('input', `Too many inputs: ${transaction.inputs.length}/${config.validation.maxInputs}`);
    return { valid: false, error: `Too many inputs: ${transaction.inputs.length}/${config.validation.maxInputs}` };
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
  if (transaction.outputs.length > config.validation.maxOutputs) {
    logValidationFailure('output', `Too many outputs: ${transaction.outputs.length}/${config.validation.maxOutputs}`);
    return { valid: false, error: `Too many outputs: ${transaction.outputs.length}/${config.validation.maxOutputs}` };
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
    if (output.value < config.utxo.dustLimit) {
      return {
        valid: false,
        error: `Output value below dust limit (${output.value} < ${config.utxo.dustLimit})`,
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
      error: 'Total output value exceeds input value',
      totalInputValue,
      totalOutputValue
    };
  }
  
  // Calculate fee
  const fee = totalInputValue - totalOutputValue;
  
  // Check if fee is reasonable (e.g., not excessively high)
  // This is a simple check - more sophisticated fee validation could be added
  const feePercent = (fee / totalInputValue) * 100;
  if (feePercent > 20) { // If fee is more than 20% of input value
    logValidationFailure('output', 'Fee is excessively high', { 
      fee, 
      feePercent,
      totalInputValue
    });
    return { 
      valid: false, 
      error: `Fee is excessively high (${feePercent.toFixed(2)}%)`,
      fee,
      feePercent,
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
 * Validates Bitcoin address format
 * @param {string} address - Bitcoin address to validate
 * @returns {object} Validation result
 */
function validateAddressFormat(address) {
  // Basic validation for different address formats
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address must be a string' };
  }
  
  // P2PKH (legacy) addresses start with 1
  if (address.startsWith('1')) {
    if (address.length !== 26 && address.length !== 34) {
      return { valid: false, error: 'Invalid P2PKH address length' };
    }
    return { valid: true, format: 'p2pkh' };
  }
  
  // P2SH addresses start with 3
  if (address.startsWith('3')) {
    if (address.length !== 34) {
      return { valid: false, error: 'Invalid P2SH address length' };
    }
    return { valid: true, format: 'p2sh' };
  }
  
  // Bech32 addresses (Segwit) start with bc1 (mainnet) or tb1 (testnet)
  if (address.startsWith('bc1') || address.startsWith('tb1')) {
    if (address.length < 42 || address.length > 62) {
      return { valid: false, error: 'Invalid Bech32 address length' };
    }
    return { valid: true, format: 'bech32' };
  }
  
  // Taproot addresses (P2TR) usually start with bc1p or tb1p
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    if (address.length < 62 || address.length > 80) {
      return { valid: false, error: 'Invalid Taproot address length' };
    }
    return { valid: true, format: 'p2tr' };
  }
  
  return { valid: false, error: 'Unsupported address format' };
}

/**
 * Validates transaction signature
 * @param {object} transaction - Transaction object with PSBT
 * @returns {Promise<object>} Validation result
 */
async function validateTransactionSignature(transaction) {
  if (!transaction || !transaction.psbt) {
    logValidationFailure('signature', 'Missing PSBT for signature validation');
    return { valid: false, error: 'Missing PSBT for signature validation' };
  }
  
  try {
    // Use Bitcoin Core's analyzepsbt to check signatures
    const analysis = await commandService.executeBitcoinCommand(`analyzepsbt ${transaction.psbt}`);
    
    // Check if the PSBT is complete (all signatures present)
    const isComplete = analysis.complete === true;
    
    // For incomplete PSBTs, check signature status of each input
    const missingSignatures = [];
    
    if (!isComplete && analysis.inputs) {
      analysis.inputs.forEach((input, index) => {
        if (input.missing && input.missing.signatures) {
          missingSignatures.push({
            inputIndex: index,
            missing: input.missing.signatures
          });
        }
      });
    }
    
    // For complete PSBTs, verify that they can be finalized
    let isValidSignature = isComplete;
    
    if (isComplete) {
      try {
        // Verify that the PSBT can be finalized and extracted
        const finalizationTest = await commandService.executeBitcoinCommand(`finalizepsbt ${transaction.psbt} false`);
        isValidSignature = finalizationTest.complete === true;
      } catch (error) {
        logValidationFailure('signature', 'PSBT finalization failed', { error: error.message });
        isValidSignature = false;
      }
    }
    
    if (!isValidSignature) {
      logValidationFailure('signature', 'Signature validation failed', { 
        isComplete,
        missingSignatures
      });
      return { 
        valid: false, 
        error: 'Invalid or incomplete signatures',
        isComplete,
        missingSignatures,
      };
    }
    
    return { 
      valid: true, 
      isComplete,
      nextAction: analysis.next || '',
      estimatedVsize: analysis.estimated_vsize || 0,
    };
  } catch (error) {
    logValidationFailure('signature', 'Error during signature validation', { error: error.message });
    
    return { 
      valid: false, 
      error: `Signature validation error: ${error.message}`
    };
  }
}

/**
 * Validates a complete transaction
 * @param {object} transaction - Transaction object with inputs, outputs, and PSBT
 * @returns {Promise<object>} Validation result
 */
async function validateTransaction(transaction) {
  // Log validation start
  logValidationEvent('validationStart', {
    transaction: {
      inputs: transaction.inputs?.length,
      outputs: transaction.outputs?.length,
      hasPsbt: !!transaction.psbt
    },
    timestamp: Date.now()
  });
  
  // Validate inputs first
  const inputValidation = await validateTransactionInputs(transaction);
  if (!inputValidation.valid) {
    logValidationEvent('validationComplete', {
      result: 'failed',
      reason: 'input validation failed',
      details: inputValidation.error,
      timestamp: Date.now()
    });
    
    return {
      valid: false,
      errorType: 'input',
      error: inputValidation.error,
      inputValidation
    };
  }
  
  // Validate outputs next
  const outputValidation = validateTransactionOutputs(transaction, inputValidation.totalInputValue);
  if (!outputValidation.valid) {
    logValidationEvent('validationComplete', {
      result: 'failed',
      reason: 'output validation failed',
      details: outputValidation.error,
      timestamp: Date.now()
    });
    
    return {
      valid: false,
      errorType: 'output',
      error: outputValidation.error,
      inputValidation,
      outputValidation
    };
  }
  
  // Validate signatures if PSBT is provided
  if (transaction.psbt) {
    const signatureValidation = await validateTransactionSignature(transaction);
    if (!signatureValidation.valid) {
      logValidationEvent('validationComplete', {
        result: 'failed',
        reason: 'signature validation failed',
        details: signatureValidation.error,
        timestamp: Date.now()
      });
      
      return {
        valid: false,
        errorType: 'signature',
        error: signatureValidation.error,
        inputValidation,
        outputValidation,
        signatureValidation
      };
    }
    
    // All validations passed
    logValidationEvent('validationComplete', {
      result: 'success',
      timestamp: Date.now()
    });
    
    validationStats.totalValidated++;
    
    return {
      valid: true,
      inputValidation,
      outputValidation,
      signatureValidation,
      fee: outputValidation.fee,
      isComplete: signatureValidation.isComplete
    };
  }
  
  // If no PSBT is provided, consider it a partial validation success
  logValidationEvent('validationComplete', {
    result: 'partial success',
    reason: 'no PSBT provided for signature validation',
    timestamp: Date.now()
  });
  
  validationStats.totalValidated++;
  
  return {
    valid: true,
    inputValidation,
    outputValidation,
    fee: outputValidation.fee,
    partialValidation: true,
    message: 'PSBT not provided, signature validation skipped'
  };
}

/**
 * Gets validation statistics
 * @param {boolean} reset - Whether to reset statistics after retrieval
 * @returns {object} Validation statistics
 */
function getValidationStats(reset = false) {
  const stats = {
    totalValidated: validationStats.totalValidated,
    inputValidationFailures: validationStats.inputValidationFailures,
    outputValidationFailures: validationStats.outputValidationFailures,
    signatureValidationFailures: validationStats.signatureValidationFailures,
    successRate: validationStats.successRate,
    lastReset: validationStats.lastReset,
    circuitBreaker: {
      state: circuitState.state,
      failures: circuitState.failures,
      lastFailure: circuitState.lastFailure,
      lastSuccess: circuitState.lastSuccess
    },
    configuredThresholds: {
      confirmationThreshold: config.validation.confirmationThreshold,
      dustLimit: config.utxo.dustLimit,
      circuitBreakerThreshold: config.circuitBreaker.failureThreshold
    }
  };
  
  if (reset) {
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
 * Generates a validation report for a specified period
 * @param {string} period - Period to report on ('day', 'week', 'month')
 * @returns {Promise<object>} Validation report
 */
async function generateValidationReport(period = 'day') {
  // Define date range based on period
  const now = new Date();
  let startDate = new Date(now);
  
  switch (period) {
    case 'week':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'day':
    default:
      startDate.setDate(now.getDate() - 1);
      break;
  }
  
  // Format dates for log file matching
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = now.toISOString().split('T')[0];
  
  // Collect log files in the date range
  const logFiles = [];
  let currentDate = new Date(startDate);
  
  while (currentDate <= now) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const logFile = path.join(config.paths.logDirectory, `validation-${dateStr}.log`);
    
    if (fs.existsSync(logFile)) {
      logFiles.push(logFile);
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Analyze log files
  const stats = {
    validationCount: 0,
    successCount: 0,
    failureCount: 0,
    failuresByType: {
      input: 0,
      output: 0,
      signature: 0,
      other: 0
    },
    dailyStats: []
  };
  
  // Process each log file
  for (const logFile of logFiles) {
    const dateStr = path.basename(logFile).replace('validation-', '').replace('.log', '');
    const dailyStat = { date: dateStr, validationCount: 0, successCount: 0, failureCount: 0 };
    
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          if (entry.event === 'validationComplete') {
            dailyStat.validationCount++;
            stats.validationCount++;
            
            if (entry.data && entry.data.result === 'success') {
              dailyStat.successCount++;
              stats.successCount++;
            } else {
              dailyStat.failureCount++;
              stats.failureCount++;
              
              // Count failure types
              if (entry.data && entry.data.reason) {
                if (entry.data.reason.includes('input')) {
                  stats.failuresByType.input++;
                } else if (entry.data.reason.includes('output')) {
                  stats.failuresByType.output++;
                } else if (entry.data.reason.includes('signature')) {
                  stats.failuresByType.signature++;
                } else {
                  stats.failuresByType.other++;
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error parsing log entry: ${error.message}`);
        }
      }
    }
    
    if (dailyStat.validationCount > 0) {
      stats.dailyStats.push(dailyStat);
    }
  }
  
  // Calculate success rate
  stats.successRate = stats.validationCount > 0 
    ? parseFloat(((stats.successCount / stats.validationCount) * 100).toFixed(2))
    : 0;
  
  return {
    period,
    startDate: startDateStr,
    endDate: endDateStr,
    ...stats
  };
}

module.exports = {
  validateTransaction,
  validateTransactionInputs,
  validateTransactionOutputs,
  validateTransactionSignature,
  validateAddressFormat,
  getValidationStats,
  generateValidationReport,
}; 