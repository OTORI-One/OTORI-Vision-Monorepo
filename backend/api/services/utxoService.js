/**
 * UTXO Management Service for OTORI Vision
 * 
 * This service handles UTXO selection and optimization for Bitcoin transactions.
 * It provides utilities for efficiently managing UTXOs for both the LP wallet
 * and user wallets when creating transactions.
 */

const fs = require('fs');
const path = require('path');
const config = require('./configService');
const commandService = require('./commandExecutionService');

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
 * Gets all UTXOs from a specified wallet
 * @param {string} walletName - Optional wallet name, defaults to config.bitcoin.walletName
 * @returns {Promise<Object>} - Information about UTXOs
 */
async function getWalletUtxos(walletName = null) {
  try {
    // Save current wallet name
    const currentWallet = walletName || config.bitcoin.walletName;
    
    // Execute listunspent command
    const listUnspentCmd = 'listunspent 0 9999999';
    const utxos = await commandService.executeBitcoinCommand(listUnspentCmd, {
      env: walletName ? { WALLET_NAME: walletName } : {}
    });
    
    console.log(`Found ${utxos.length} UTXOs in wallet ${currentWallet}`);
    
    // Group UTXOs by size for analysis
    const smallUtxos = utxos.filter(u => u.amount * 100000000 < config.utxo.smallUtxoThreshold);
    const largeUtxos = utxos.filter(u => u.amount * 100000000 >= config.utxo.smallUtxoThreshold);
    
    console.log(`UTXO breakdown: ${smallUtxos.length} small, ${largeUtxos.length} large`);
    
    // Update statistics
    utxoStats.totalQueriesCount++;
    utxoStats.successfulQueriesCount++;
    
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
    
    // Update statistics
    utxoStats.totalQueriesCount++;
    utxoStats.failedQueriesCount++;
    
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
    options.preferSmallUtxos : config.utxo.preferSmallUtxos;
  
  const smallUtxoThreshold = options.smallUtxoThreshold !== undefined ? 
    options.smallUtxoThreshold : config.utxo.smallUtxoThreshold;
  
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
function calculateEstimatedFee(inputCount, outputCount, feeRate = config.utxo.defaultFeeRate) {
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
    const feeRate = options.feeRate || config.utxo.defaultFeeRate;
    const walletName = options.walletName || config.bitcoin.walletName;
    
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
    const needsChange = changeAmount > config.utxo.dustLimit;
    
    // Create inputs array for createpsbt command
    const inputs = selection.utxos.map(utxo => (
      `'[{"txid":"${utxo.txid}","vout":${utxo.vout}}]'`
    )).join(' ');
    
    // Create outputs object for createpsbt command
    let outputs = `'{"${recipient}":${amount / 100000000}}'`;
    
    if (needsChange) {
      // Get a change address from the wallet
      const changeAddress = await commandService.executeBitcoinCommand('getnewaddress "" "bech32"');
      // Add change output
      outputs = `'{"${recipient}":${amount / 100000000},"${changeAddress}":${changeAmount / 100000000}}'`;
    }
    
    // Create the PSBT
    const createPsbtCmd = `createpsbt ${inputs} ${outputs}`;
    const psbt = await commandService.executeBitcoinCommand(createPsbtCmd);
    
    console.log(`PSBT created successfully: ${typeof psbt === 'string' ? psbt.substring(0, 20) : ''}...`);
    
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
 * Analyzes a PSBT to extract details
 * @param {string} psbt - PSBT string
 * @returns {Promise<Object>} - PSBT analysis
 */
async function analyzePSBT(psbt) {
  try {
    const analysis = await commandService.executeBitcoinCommand(`analyzepsbt ${psbt}`);
    return analysis;
  } catch (error) {
    console.error(`Error analyzing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Signs a PSBT with the wallet
 * @param {string} psbt - PSBT string
 * @param {string} walletName - Optional wallet name
 * @returns {Promise<Object>} - Signed PSBT result
 */
async function signPSBT(psbt, walletName = null) {
  try {
    const options = walletName ? { env: { WALLET_NAME: walletName } } : {};
    const signedPsbt = await commandService.executeBitcoinCommand(`walletprocesspsbt ${psbt}`, options);
    
    return signedPsbt;
  } catch (error) {
    console.error(`Error signing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Finalizes and broadcasts a PSBT
 * @param {string} psbt - PSBT string
 * @returns {Promise<Object>} - Transaction result
 */
async function finalizePSBT(psbt) {
  try {
    // Finalize the PSBT and broadcast it
    const result = await commandService.executeBitcoinCommand(`finalizepsbt ${psbt} true`);
    
    return result;
  } catch (error) {
    console.error(`Error finalizing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Gets UTXO service statistics
 * @returns {Object} - Service statistics
 */
function getStats() {
  return {
    ...utxoStats,
    dustLimit: config.utxo.dustLimit,
    smallUtxoThreshold: config.utxo.smallUtxoThreshold,
    preferSmallUtxos: config.utxo.preferSmallUtxos
  };
}

/**
 * Resets UTXO service statistics
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
  getWalletUtxos,
  getAddressUtxos,
  getAddressBalance,
  selectOptimalUtxos,
  calculateEstimatedFee,
  createOptimizedPSBT,
  analyzePSBT,
  signPSBT,
  finalizePSBT,
  getStats,
  resetStats
}; 