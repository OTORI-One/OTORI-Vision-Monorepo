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

// Get LP address from environment variables
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';

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
 * Gets the UTXOs for an external address (not in our wallet)
 * For development use with Unisat and other external wallets
 * @param {string} address - Bitcoin address to check
 * @returns {Promise<Array>} - Array of UTXOs for the address
 */
async function getExternalAddressUtxos(address) {
  try {
    if (!address) {
      throw new Error('Address is required');
    }
    
    // Validate address format
    if (!address.startsWith('tb1') && !address.startsWith('bc1') && 
        !address.startsWith('1') && !address.startsWith('3')) {
      throw new Error(`Invalid address format: ${address}`);
    }
    
    console.log(`Using development mode for external wallet: ${address}`);
    
    // For development, create a mock UTXO with sufficient funds
    // This allows testing with external wallets like Unisat without querying external APIs
    const mockUtxo = {
      txid: `mock-txid-${Date.now()}`,
      vout: 0,
      address: address,
      value: 20000, // 20,000 sats (enough for test transactions)
      confirmations: 6,
      spendable: true,
      scriptPubKey: "mockscript",
      isExternal: true
    };
    
    return [mockUtxo];
  } catch (error) {
    console.error(`Error getting external UTXOs for address ${address}: ${error.message}`);
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
    
    // Get UTXOs from our wallet and filter by address
    const utxoData = await getWalletUtxos();
    const addressUtxos = utxoData.utxos.filter(utxo => utxo.address === address);
    
    if (addressUtxos.length > 0) {
      console.log(`Found ${addressUtxos.length} UTXOs for address ${address} in our wallet`);
      return addressUtxos;
    }
    
    // If no UTXOs found in our wallet and we're in development mode, use external wallet support
    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_EXTERNAL_WALLETS === 'true') {
      console.log(`No UTXOs found in our wallet for ${address}, checking external wallet...`);
      return getExternalAddressUtxos(address);
    }
    
    console.log(`Found 0 UTXOs for address ${address}`);
    return [];
  } catch (error) {
    console.error(`Error getting UTXOs: ${error.message}`);
    
    // If this is the LP address and we're in development mode or real transactions are enabled, use fallback UTXOs
    if (address === LP_ADDRESS && (process.env.NODE_ENV === 'development' || process.env.ENABLE_REAL_TRANSACTIONS === 'true')) {
      console.log('Using fallback UTXOs for LP address');
      return [
        {
          txid: "known_txid_from_lp_wallet",
          vout: 0,
          address: LP_ADDRESS,
          value: 50000, // 50k sats
          spendable: true
        }
      ];
    }
    
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
    
    // Format inputs array for Bitcoin-CLI
    // Properly format JSON for bitcoin-cli through SSH
    const inputsJson = JSON.stringify(selection.utxos.map(utxo => ({
      txid: utxo.txid,
      vout: utxo.vout
    })));
    
    // Format outputs object for Bitcoin-CLI
    const outputsObj = {};
    outputsObj[recipient] = (amount / 100000000).toFixed(8);
    
    if (needsChange) {
      // Get a change address from the wallet
      const changeAddress = await commandService.executeBitcoinCommand('getnewaddress "" "bech32"');
      // Add change output with proper BTC format
      outputsObj[changeAddress] = (changeAmount / 100000000).toFixed(8);
    }
    
    const outputsJson = JSON.stringify(outputsObj);
    
    // Create direct command with proper shell escaping
    // Important: The quotes need to be properly placed for bitcoin-cli
    // We need to escape the JSON for the shell through SSH
    // First, escape all JSON double quotes with backslashes for the shell
    const escapedInputs = inputsJson.replace(/"/g, '\\"');
    const escapedOutputs = outputsJson.replace(/"/g, '\\"');
    
    // Then construct the command with proper shell syntax
    const createPsbtCmd = `createpsbt "${escapedInputs}" "${escapedOutputs}"`;
    console.log(`PSBT command structure: ${createPsbtCmd.substring(0, 100)}...`);
    
    // Execute the command
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
  getExternalAddressUtxos,
  getAddressBalance,
  selectOptimalUtxos,
  calculateEstimatedFee,
  createOptimizedPSBT,
  analyzePSBT,
  signPSBT,
  finalizePSBT,
  getStats,
  resetStats,
  // Constants
  DUST_LIMIT: config.utxo.dustLimit || 546
}; 