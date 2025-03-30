/**
 * UTXO Management Service for OTORI Vision
 * 
 * This service handles UTXO selection and optimization for Bitcoin transactions.
 * It provides utilities for efficiently managing UTXOs for both the LP wallet
 * and user wallets when creating transactions.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration constants
const SMALL_UTXO_THRESHOLD = process.env.SMALL_UTXO_THRESHOLD ? 
  parseInt(process.env.SMALL_UTXO_THRESHOLD) : 10000; // 10,000 sats threshold for "small" UTXOs

const DUST_LIMIT = 546; // Bitcoin dust limit in satoshis
const PREFER_SMALL_UTXOS = process.env.PREFER_SMALL_UTXOS !== 'false'; // Default to true
const DEFAULT_FEE_RATE = parseInt(process.env.DEFAULT_FEE_RATE || '2'); // Default 2 sats/byte

// Remote Bitcoin node configuration
const BITCOIN_CLI_PATH = process.env.BITCOIN_CLI_PATH || 'bitcoin-cli';
const BITCOIN_NETWORK = process.env.BITCOIN_NETWORK || 'signet';
const BITCOIN_RPC_USER = process.env.BITCOIN_RPC_USER;
const BITCOIN_RPC_PASSWORD = process.env.BITCOIN_RPC_PASSWORD;
const BITCOIN_RPC_HOST = process.env.BITCOIN_RPC_HOST || 'localhost';
const BITCOIN_RPC_PORT = process.env.BITCOIN_RPC_PORT || '38332';
const WALLET_NAME = process.env.WALLET_NAME || '';

// Track statistics for reporting
let utxoStats = {
  totalQueriesCount: 0,
  successfulQueriesCount: 0,
  failedQueriesCount: 0,
  optimizationCount: 0,
  selectionCount: 0,
  averageUtxosPerTransaction: 0,
  totalUtxosSelected: 0,
  lastUpdated: Date.now()
};

/**
 * Executes a bitcoin-cli command
 * @param {string} command - Command to execute
 * @returns {string} - Command output
 */
function executeBitcoinCommand(command) {
  try {
    // Build the bitcoin-cli command with appropriate network and wallet parameters
    let fullCommand = `${BITCOIN_CLI_PATH}`;
    
    // Add network flag
    if (BITCOIN_NETWORK === 'testnet') {
      fullCommand += ' -testnet';
    } else if (BITCOIN_NETWORK === 'signet') {
      fullCommand += ' -signet';
    } else if (BITCOIN_NETWORK === 'regtest') {
      fullCommand += ' -regtest';
    }
    
    // Add wallet if specified
    if (WALLET_NAME) {
      fullCommand += ` -rpcwallet=${WALLET_NAME}`;
    }
    
    // Add RPC connection parameters if provided
    if (BITCOIN_RPC_USER && BITCOIN_RPC_PASSWORD) {
      fullCommand += ` -rpcuser=${BITCOIN_RPC_USER} -rpcpassword=${BITCOIN_RPC_PASSWORD}`;
    }
    
    if (BITCOIN_RPC_HOST && BITCOIN_RPC_PORT) {
      fullCommand += ` -rpcconnect=${BITCOIN_RPC_HOST} -rpcport=${BITCOIN_RPC_PORT}`;
    }
    
    // Add the actual command
    fullCommand += ` ${command}`;
    
    // Log command with redacted password
    const logCommand = BITCOIN_RPC_PASSWORD ? 
      fullCommand.replace(BITCOIN_RPC_PASSWORD, '[REDACTED]') : 
      fullCommand;
    
    console.log(`Executing Bitcoin command: ${logCommand}`);
    
    // Execute the command
    const result = execSync(fullCommand).toString().trim();
    
    // Update statistics
    utxoStats.totalQueriesCount++;
    utxoStats.successfulQueriesCount++;
    
    return result;
  } catch (error) {
    console.error(`Error executing Bitcoin command: ${error.message}`);
    
    // Update statistics
    utxoStats.totalQueriesCount++;
    utxoStats.failedQueriesCount++;
    
    if (error.stderr) {
      console.error(`stderr: ${error.stderr.toString()}`);
    }
    
    throw error;
  }
}

/**
 * Gets all UTXOs from a specified wallet
 * @param {string} walletName - Optional wallet name, defaults to WALLET_NAME
 * @returns {Promise<Object>} - Information about UTXOs
 */
async function getWalletUtxos(walletName = null) {
  try {
    // Save current wallet name
    const currentWallet = WALLET_NAME;
    
    // Temporarily set wallet name if provided
    if (walletName) {
      global.WALLET_NAME = walletName;
    }
    
    // Execute listunspent command
    const listUnspentCmd = 'listunspent 0 9999999';
    const utxoJson = executeBitcoinCommand(listUnspentCmd);
    
    // Parse the JSON response
    const utxos = JSON.parse(utxoJson);
    
    console.log(`Found ${utxos.length} UTXOs in wallet ${walletName || WALLET_NAME}`);
    
    // Group UTXOs by size for analysis
    const smallUtxos = utxos.filter(u => u.amount * 100000000 < SMALL_UTXO_THRESHOLD);
    const largeUtxos = utxos.filter(u => u.amount * 100000000 >= SMALL_UTXO_THRESHOLD);
    
    console.log(`UTXO breakdown: ${smallUtxos.length} small, ${largeUtxos.length} large`);
    
    // Restore original wallet name
    if (walletName) {
      global.WALLET_NAME = currentWallet;
    }
    
    // Convert BTC amounts to satoshis for easier handling
    return {
      utxos: utxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        address: utxo.address,
        value: Math.floor(utxo.amount * 100000000), // Convert BTC to satoshis
        confirmations: utxo.confirmations,
        spendable: utxo.spendable,
        scriptPubKey: utxo.scriptPubKey,
        raw: utxo // Keep original for reference
      })),
      smallCount: smallUtxos.length,
      largeCount: largeUtxos.length,
      totalCount: utxos.length
    };
  } catch (error) {
    console.error(`Error getting wallet UTXOs: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the UTXOs for a specific address
 * @param {string} address - Bitcoin address to check
 * @returns {Promise<Array>} - Array of UTXOs for the address
 */
async function getAddressUtxos(address) {
  try {
    if (!address) {
      throw new Error('Address is required');
    }
    
    // Validate address format
    if (!address.startsWith('tb1') && !address.startsWith('bc1') && 
        !address.startsWith('1') && !address.startsWith('3')) {
      throw new Error(`Invalid address format: ${address}`);
    }
    
    // Get UTXOs and filter by address
    const utxoData = await getWalletUtxos();
    const addressUtxos = utxoData.utxos.filter(utxo => utxo.address === address);
    
    console.log(`Found ${addressUtxos.length} UTXOs for address ${address}`);
    
    return addressUtxos;
  } catch (error) {
    console.error(`Error getting UTXOs for address ${address}: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the balance of a specific address by filtering UTXOs
 * @param {string} address - Bitcoin address to check
 * @returns {Promise<number>} - Balance in satoshis
 */
async function getAddressBalance(address) {
  try {
    // Get UTXOs for the address
    const addressUtxos = await getAddressUtxos(address);
    
    // Sum the values
    const balance = addressUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
    
    return balance;
  } catch (error) {
    console.error(`Error getting balance for address ${address}: ${error.message}`);
    throw error;
  }
}

/**
 * Selects optimal UTXOs for transaction building
 * Prioritizes using smallest UTXOs first to preserve larger ones
 * @param {Array} availableUtxos - Available UTXOs
 * @param {number} targetAmount - Target amount in satoshis
 * @param {Object} options - Selection options
 * @param {boolean} options.preferSmallUtxos - Whether to prefer small UTXOs
 * @param {number} options.smallUtxoThreshold - Threshold for small UTXOs
 * @returns {Object} - Selected UTXOs and total value
 */
function selectOptimalUtxos(availableUtxos, targetAmount, options = {}) {
  // Update statistics
  utxoStats.selectionCount++;
  
  // Get options with defaults
  const preferSmallUtxos = options.preferSmallUtxos !== undefined ? 
    options.preferSmallUtxos : PREFER_SMALL_UTXOS;
  
  const smallUtxoThreshold = options.smallUtxoThreshold !== undefined ? 
    options.smallUtxoThreshold : SMALL_UTXO_THRESHOLD;
  
  // Filter to only spendable UTXOs
  const spendableUtxos = availableUtxos.filter(utxo => utxo.spendable);
  
  if (spendableUtxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }
  
  // Sort UTXOs by value (ascending)
  const sortedUtxos = [...spendableUtxos].sort((a, b) => a.value - b.value);
  
  let selectedUtxos = [];
  let totalValue = 0;
  
  if (preferSmallUtxos) {
    // Strategy 1: Prefer small UTXOs to preserve large ones
    // First pass: try to use only small UTXOs if possible
    for (const utxo of sortedUtxos) {
      if (totalValue >= targetAmount) break;
      
      if (utxo.value < smallUtxoThreshold) {
        selectedUtxos.push(utxo);
        totalValue += utxo.value;
      }
    }
  } else {
    // Strategy 2: Use a single large UTXO if possible (minimize input count)
    // Find the smallest UTXO that is larger than the target amount
    const singleLargeUtxo = sortedUtxos.find(utxo => utxo.value >= targetAmount);
    if (singleLargeUtxo) {
      selectedUtxos.push(singleLargeUtxo);
      totalValue = singleLargeUtxo.value;
    }
  }
  
  // If the target amount isn't met yet, add more UTXOs regardless of size
  if (totalValue < targetAmount) {
    for (const utxo of sortedUtxos) {
      if (totalValue >= targetAmount) break;
      
      if (!selectedUtxos.includes(utxo)) {
        selectedUtxos.push(utxo);
        totalValue += utxo.value;
      }
    }
  }
  
  // Update statistics
  utxoStats.totalUtxosSelected += selectedUtxos.length;
  const averageUtxosPerTx = utxoStats.totalUtxosSelected / utxoStats.selectionCount;
  utxoStats.averageUtxosPerTransaction = parseFloat(averageUtxosPerTx.toFixed(2));
  utxoStats.lastUpdated = Date.now();
  
  return {
    utxos: selectedUtxos,
    totalValue,
    sufficient: totalValue >= targetAmount,
    count: selectedUtxos.length,
    average: selectedUtxos.length > 0 ? totalValue / selectedUtxos.length : 0,
    preferredSmallUtxos: preferSmallUtxos
  };
}

/**
 * Calculates estimated fee for a transaction with given inputs and outputs
 * @param {number} inputCount - Number of inputs
 * @param {number} outputCount - Number of outputs
 * @param {number} feeRate - Fee rate in satoshis per byte
 * @returns {number} - Estimated fee in satoshis
 */
function calculateEstimatedFee(inputCount, outputCount, feeRate = DEFAULT_FEE_RATE) {
  // Simple fee estimation based on typical input/output sizes
  const bytesPerInput = 140; // Approximate size of a typical input
  const bytesPerOutput = 34; // Approximate size of a typical output
  const overheadBytes = 10; // Transaction overhead
  
  const estimatedSize = overheadBytes + (inputCount * bytesPerInput) + (outputCount * bytesPerOutput);
  return estimatedSize * feeRate;
}

/**
 * Creates a PSBT with optimally selected UTXOs
 * @param {string} recipient - Recipient address
 * @param {number} amount - Amount to send in satoshis
 * @param {Object} options - Creation options
 * @param {number} options.feeRate - Fee rate in satoshis per byte
 * @param {boolean} options.preferSmallUtxos - Whether to prefer small UTXOs
 * @param {string} options.walletName - Wallet to use for UTXOs
 * @returns {Promise<Object>} - PSBT information
 */
async function createOptimizedPSBT(recipient, amount, options = {}) {
  try {
    // Update optimization statistics
    utxoStats.optimizationCount++;
    
    // Get options with defaults
    const feeRate = options.feeRate || DEFAULT_FEE_RATE;
    const walletName = options.walletName || WALLET_NAME;
    
    console.log(`Creating optimized PSBT: ${amount} satoshis to ${recipient}`);
    
    // Get available UTXOs
    const utxoData = await getWalletUtxos(walletName);
    console.log(`Total available UTXOs: ${utxoData.utxos.length}`);
    
    // Calculate necessary value (amount + estimated initial fee)
    // Start with a rough estimate for fee calculation
    const initialFeeEstimate = calculateEstimatedFee(1, 2, feeRate);
    const targetValue = amount + initialFeeEstimate;
    
    // Select optimal UTXOs
    const selection = selectOptimalUtxos(utxoData.utxos, targetValue, {
      preferSmallUtxos: options.preferSmallUtxos,
      smallUtxoThreshold: options.smallUtxoThreshold
    });
    
    if (!selection.sufficient) {
      throw new Error(`Insufficient funds: needed ${targetValue} satoshis, have ${selection.totalValue} satoshis`);
    }
    
    console.log(`Selected ${selection.count} UTXOs with total value of ${selection.totalValue} satoshis`);
    
    // Refine fee calculation based on actual input count
    const refinedFeeEstimate = calculateEstimatedFee(selection.count, 2, feeRate);
    console.log(`Estimated fee: ${refinedFeeEstimate} satoshis`);
    
    // Calculate change amount (if any)
    const changeAmount = selection.totalValue - amount - refinedFeeEstimate;
    console.log(`Change amount: ${changeAmount} satoshis`);
    
    // Determine if change is needed (above dust limit)
    const needsChange = changeAmount > DUST_LIMIT;
    
    // Create inputs array for createpsbt command
    const inputs = selection.utxos.map(utxo => (
      `'[{"txid":"${utxo.txid}","vout":${utxo.vout}}]'`
    )).join(' ');
    
    // Create outputs object for createpsbt command
    let outputs = `'{"${recipient}":${amount / 100000000}}'`;
    
    if (needsChange) {
      // Get a change address from the wallet
      const changeAddress = executeBitcoinCommand('getnewaddress "" "bech32"').trim();
      // Add change output
      outputs = `'{"${recipient}":${amount / 100000000},"${changeAddress}":${changeAmount / 100000000}}'`;
    }
    
    // Create the PSBT
    const createPsbtCmd = `createpsbt ${inputs} ${outputs}`;
    const psbt = executeBitcoinCommand(createPsbtCmd).trim();
    
    console.log(`PSBT created successfully: ${psbt.substring(0, 20)}...`);
    
    return {
      psbt,
      inputs: selection.utxos,
      outputs: [
        { address: recipient, amount },
        ...(needsChange ? [{ address: changeAddress, amount: changeAmount }] : [])
      ],
      fee: refinedFeeEstimate,
      changeAmount: needsChange ? changeAmount : 0,
      totalValue: selection.totalValue,
      isComplete: false
    };
  } catch (error) {
    console.error(`Error creating optimized PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Analyzes a PSBT to get details
 * @param {string} psbt - PSBT in base64 format
 * @returns {Object} - PSBT analysis
 */
function analyzePSBT(psbt) {
  try {
    const result = executeBitcoinCommand(`analyzepsbt ${psbt}`);
    return JSON.parse(result);
  } catch (error) {
    console.error(`Error analyzing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Signs a PSBT with the wallet
 * @param {string} psbt - PSBT in base64 format
 * @param {string} walletName - Optional wallet name
 * @returns {Object} - Signed PSBT information
 */
async function signPSBT(psbt, walletName = null) {
  try {
    // Save current wallet name
    const currentWallet = WALLET_NAME;
    
    // Temporarily set wallet name if provided
    if (walletName) {
      global.WALLET_NAME = walletName;
    }
    
    // Sign the PSBT
    const signedResult = executeBitcoinCommand(`walletprocesspsbt ${psbt}`);
    const signedPsbtObj = JSON.parse(signedResult);
    
    // Restore original wallet name
    if (walletName) {
      global.WALLET_NAME = currentWallet;
    }
    
    return {
      psbt: signedPsbtObj.psbt,
      isComplete: signedPsbtObj.complete
    };
  } catch (error) {
    console.error(`Error signing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Finalizes and broadcasts a PSBT
 * @param {string} psbt - PSBT in base64 format
 * @returns {Object} - Transaction information
 */
async function finalizePSBT(psbt) {
  try {
    const finalizeResult = executeBitcoinCommand(`finalizepsbt ${psbt} true`);
    const finalizeObj = JSON.parse(finalizeResult);
    
    return {
      txid: finalizeObj.txid,
      hex: finalizeObj.hex,
      complete: finalizeObj.complete
    };
  } catch (error) {
    console.error(`Error finalizing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Get service statistics
 * @returns {Object} - Service statistics
 */
function getStats() {
  return {
    ...utxoStats,
    uptime: process.uptime()
  };
}

/**
 * Reset service statistics
 */
function resetStats() {
  utxoStats = {
    totalQueriesCount: 0,
    successfulQueriesCount: 0,
    failedQueriesCount: 0,
    optimizationCount: 0,
    selectionCount: 0,
    averageUtxosPerTransaction: 0,
    totalUtxosSelected: 0,
    lastUpdated: Date.now()
  };
}

module.exports = {
  // UTXO selection and fee calculation
  selectOptimalUtxos,
  calculateEstimatedFee,
  
  // UTXO retrieval
  getWalletUtxos,
  getAddressUtxos,
  getAddressBalance,
  
  // PSBT creation and management
  createOptimizedPSBT,
  analyzePSBT,
  signPSBT,
  finalizePSBT,
  
  // Utilities
  executeBitcoinCommand,
  
  // Statistics
  getStats,
  resetStats,
  
  // Configuration constants
  DUST_LIMIT,
  SMALL_UTXO_THRESHOLD
}; 