/**
 * Transaction Format Service for OTORI Vision
 * 
 * Ensures PSBT format compatibility between different components.
 * Provides utilities for standardizing transaction data and formats.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./configService');
const commandService = require('./commandExecutionService');

// Transaction format metadata fields
const METADATA_FIELDS = [
  'txid',          // Transaction ID
  'createdAt',     // Creation timestamp
  'type',          // Transaction type (buy, sell, mint, burn, etc.)
  'status',        // Transaction status
  'source',        // Component that created the transaction
  'user',          // User who initiated the transaction (if applicable)
  'amount',        // Transaction amount
  'fee',           // Transaction fee
  'inputs',        // Transaction inputs
  'outputs',       // Transaction outputs
  'runeData',      // Rune-specific data (if applicable)
];

// Transaction status constants
const TX_STATUS = {
  CREATED: 'created',
  SIGNED: 'signed',
  BROADCASTED: 'broadcasted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  REJECTED: 'rejected',
};

// Transaction type constants
const TX_TYPE = {
  BUY: 'buy',
  SELL: 'sell',
  MINT: 'mint',
  BURN: 'burn',
  TRANSFER: 'transfer',
  TREASURY: 'treasury',
  REBALANCE: 'rebalance',
};

/**
 * Creates standardized transaction metadata
 * @param {Object} data - Transaction data
 * @returns {Object} Standardized transaction metadata
 */
function createTransactionMetadata(data) {
  // Generate a unique ID if not provided
  const txid = data.txid || crypto.randomUUID();
  
  // Create base metadata
  const metadata = {
    txid,
    createdAt: data.createdAt || Date.now(),
    type: data.type || TX_TYPE.TRANSFER,
    status: data.status || TX_STATUS.CREATED,
    source: data.source || 'unknown',
  };
  
  // Add optional fields if provided
  METADATA_FIELDS.forEach(field => {
    if (field !== 'txid' && field !== 'createdAt' && field !== 'type' && 
        field !== 'status' && field !== 'source' && data[field] !== undefined) {
      metadata[field] = data[field];
    }
  });
  
  return metadata;
}

/**
 * Saves transaction data to file
 * @param {string} psbt - PSBT string
 * @param {Object} metadata - Transaction metadata
 * @param {string} outputDir - Output directory (optional)
 * @returns {string} Path to the saved file
 */
function saveTransactionToFile(psbt, metadata, outputDir = null) {
  // Use the specified directory or default
  const txDir = outputDir || path.join(config.paths.dataDir, 'transactions');
  
  // Ensure the directory exists
  if (!fs.existsSync(txDir)) {
    fs.mkdirSync(txDir, { recursive: true });
  }
  
  // Generate filename
  const timestamp = new Date(metadata.createdAt).toISOString().replace(/[:.]/g, '-');
  const txType = metadata.type || 'tx';
  const fileName = `${txType}_${timestamp}_${metadata.txid.substring(0, 8)}.psbt`;
  const filePath = path.join(txDir, fileName);
  
  // Save PSBT with metadata
  const fileData = {
    psbt,
    metadata,
  };
  
  fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
  
  return filePath;
}

/**
 * Loads transaction data from file
 * @param {string} filePath - Path to transaction file
 * @returns {Object} Transaction data with PSBT and metadata
 */
function loadTransactionFromFile(filePath) {
  try {
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Validate required fields
    if (!fileData.psbt) {
      throw new Error('Invalid transaction file: missing PSBT');
    }
    
    if (!fileData.metadata) {
      // If metadata is missing, create basic metadata
      fileData.metadata = createTransactionMetadata({
        txid: path.basename(filePath, '.psbt').split('_').pop(),
        source: 'file',
      });
    }
    
    return fileData;
  } catch (error) {
    console.error(`Error loading transaction from file: ${filePath}`, error);
    throw new Error(`Failed to load transaction: ${error.message}`);
  }
}

/**
 * Analyzes a PSBT and extracts key information
 * @param {string} psbt - PSBT string
 * @returns {Promise<Object>} PSBT analysis
 */
async function analyzePSBT(psbt) {
  try {
    // Use Bitcoin CLI to analyze the PSBT
    const result = await commandService.executeBitcoinCommand(`analyzepsbt ${psbt}`);
    
    return result;
  } catch (error) {
    console.error('Error analyzing PSBT:', error);
    throw new Error(`Failed to analyze PSBT: ${error.message}`);
  }
}

/**
 * Extracts transaction details from a PSBT
 * @param {string} psbt - PSBT string
 * @returns {Promise<Object>} Transaction details
 */
async function extractTransactionDetails(psbt) {
  const analysis = await analyzePSBT(psbt);
  
  return {
    inputs: analysis.inputs || [],
    outputs: analysis.outputs || [],
    fee: analysis.fee || 0,
    isComplete: analysis.complete || false,
    estimatedVsize: analysis.estimated_vsize || 0,
    nextAction: analysis.next || '',
  };
}

/**
 * Converts transaction data between different formats
 * @param {Object} transaction - Transaction data
 * @param {string} fromFormat - Source format ('internal', 'runes-api', 'bitcoin-cli')
 * @param {string} toFormat - Target format ('internal', 'runes-api', 'bitcoin-cli')
 * @returns {Object} Converted transaction data
 */
function convertTransactionFormat(transaction, fromFormat, toFormat) {
  if (fromFormat === toFormat) {
    return transaction;
  }
  
  // Internal format is our standardized format
  if (fromFormat === 'internal') {
    if (toFormat === 'runes-api') {
      return convertInternalToRunesApi(transaction);
    } else if (toFormat === 'bitcoin-cli') {
      return convertInternalToBitcoinCli(transaction);
    }
  } else if (toFormat === 'internal') {
    if (fromFormat === 'runes-api') {
      return convertRunesApiToInternal(transaction);
    } else if (fromFormat === 'bitcoin-cli') {
      return convertBitcoinCliToInternal(transaction);
    }
  }
  
  // If direct conversion is not implemented, convert via internal format
  if (fromFormat === 'runes-api' && toFormat === 'bitcoin-cli') {
    const internalFormat = convertRunesApiToInternal(transaction);
    return convertInternalToBitcoinCli(internalFormat);
  } else if (fromFormat === 'bitcoin-cli' && toFormat === 'runes-api') {
    const internalFormat = convertBitcoinCliToInternal(transaction);
    return convertInternalToRunesApi(internalFormat);
  }
  
  throw new Error(`Unsupported conversion: ${fromFormat} to ${toFormat}`);
}

/**
 * Converts internal transaction format to Runes API format
 * @param {Object} transaction - Internal transaction data
 * @returns {Object} Runes API transaction data
 */
function convertInternalToRunesApi(transaction) {
  return {
    psbt: transaction.psbt,
    runeId: transaction.metadata?.runeData?.runeId || config.lp.runeId,
    amount: transaction.metadata?.amount || 0,
    recipient: transaction.metadata?.outputs?.[0]?.address || '',
    fee: transaction.metadata?.fee || 0,
    ...getRuneTransactionMetadata(transaction),
  };
}

/**
 * Converts Runes API transaction format to internal format
 * @param {Object} transaction - Runes API transaction data
 * @returns {Object} Internal transaction data
 */
function convertRunesApiToInternal(transaction) {
  const metadata = createTransactionMetadata({
    type: determineTransactionType(transaction),
    source: 'runes-api',
    amount: transaction.amount || 0,
    fee: transaction.fee || 0,
    runeData: {
      runeId: transaction.runeId || config.lp.runeId,
    },
    outputs: transaction.recipient ? [{ address: transaction.recipient, value: 0 }] : [],
  });
  
  return {
    psbt: transaction.psbt,
    metadata,
  };
}

/**
 * Converts internal transaction format to Bitcoin CLI format
 * @param {Object} transaction - Internal transaction data
 * @returns {Object} Bitcoin CLI transaction data
 */
function convertInternalToBitcoinCli(transaction) {
  // Bitcoin CLI expects just the PSBT string in most cases
  return transaction.psbt;
}

/**
 * Converts Bitcoin CLI transaction format to internal format
 * @param {Object} transaction - Bitcoin CLI transaction data
 * @returns {Object} Internal transaction data
 */
function convertBitcoinCliToInternal(transaction) {
  // Bitcoin CLI output is usually just the PSBT string
  let psbt = transaction;
  if (typeof transaction === 'object' && transaction.psbt) {
    psbt = transaction.psbt;
  }
  
  const metadata = createTransactionMetadata({
    source: 'bitcoin-cli',
  });
  
  return {
    psbt,
    metadata,
  };
}

/**
 * Extracts metadata from Rune transaction
 * @param {Object} transaction - Transaction data
 * @returns {Object} Rune transaction metadata
 */
function getRuneTransactionMetadata(transaction) {
  const metadata = {};
  
  // Copy specific fields from transaction metadata if they exist
  const fields = ['txid', 'type', 'status', 'user'];
  fields.forEach(field => {
    if (transaction.metadata && transaction.metadata[field]) {
      metadata[field] = transaction.metadata[field];
    }
  });
  
  // Add rune-specific fields
  if (transaction.metadata && transaction.metadata.runeData) {
    Object.keys(transaction.metadata.runeData).forEach(key => {
      metadata[key] = transaction.metadata.runeData[key];
    });
  }
  
  return metadata;
}

/**
 * Determines transaction type based on transaction data
 * @param {Object} transaction - Transaction data
 * @returns {string} Transaction type
 */
function determineTransactionType(transaction) {
  // If type is explicitly provided, use it
  if (transaction.type) {
    return transaction.type;
  }
  
  // Try to determine type from metadata or context
  if (transaction.sender && transaction.sender.includes(config.admin.treasuryAddresses[0])) {
    return TX_TYPE.MINT;
  } else if (transaction.recipient && transaction.recipient.includes(config.admin.treasuryAddresses[0])) {
    return TX_TYPE.BURN;
  } else if (transaction.amount < 0) {
    return TX_TYPE.SELL;
  } else if (transaction.amount > 0) {
    return TX_TYPE.BUY;
  }
  
  // Default to transfer
  return TX_TYPE.TRANSFER;
}

module.exports = {
  createTransactionMetadata,
  saveTransactionToFile,
  loadTransactionFromFile,
  analyzePSBT,
  extractTransactionDetails,
  convertTransactionFormat,
  TX_STATUS,
  TX_TYPE,
  METADATA_FIELDS,
}; 