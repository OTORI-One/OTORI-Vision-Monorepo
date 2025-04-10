/**
 * Trading Service for OTORI Vision
 * 
 * This service handles trading operations, order matching, and liquidity management.
 */

const orderMatchingService = require('./orderMatchingService');
const validationService = require('./transactionValidationService');
const adminService = require('./adminService');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const utxoService = require('./utxoService');
const commandService = require('./commandExecutionService');

// Simple queue for serializing ord commands
const { Mutex } = require('async-mutex');
const ordCommandMutex = new Mutex();

// --- Shared Pending Order Storage (File-based) ---
const PENDING_ORDERS_DIR = path.join(__dirname, '..', 'data');
const PENDING_ORDERS_FILE = path.join(PENDING_ORDERS_DIR, 'pending_orders.json');

// Helper to read the pending orders file
function readPendingOrdersFile() {
    try {
        // Ensure directory exists
        if (!fs.existsSync(PENDING_ORDERS_DIR)) {
            fs.mkdirSync(PENDING_ORDERS_DIR, { recursive: true });
            console.log(`[Trading Service] Created pending orders directory: ${PENDING_ORDERS_DIR}`);
        }
        // Ensure file exists
        if (!fs.existsSync(PENDING_ORDERS_FILE)) {
            console.log(`[Trading Service] Pending orders file not found, creating empty file: ${PENDING_ORDERS_FILE}`);
            fs.writeFileSync(PENDING_ORDERS_FILE, JSON.stringify({}), 'utf8');
            return {}; // Return empty object
        }
        const data = fs.readFileSync(PENDING_ORDERS_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (error) {
        console.error(`[Trading Service] Error reading pending orders file (${PENDING_ORDERS_FILE}):`, error);
        return {}; // Return empty object on error
    }
}

// Helper to write the pending orders file
function writePendingOrdersFile(orders) {
    try {
        // Ensure directory exists (might be redundant but safe)
        if (!fs.existsSync(PENDING_ORDERS_DIR)) {
            fs.mkdirSync(PENDING_ORDERS_DIR, { recursive: true });
        }
        fs.writeFileSync(PENDING_ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
        // console.log(`[Trading Service] Pending orders file updated: ${PENDING_ORDERS_FILE}`); // Optional: reduce log noise
    } catch (error) {
        console.error(`[Trading Service] Error writing pending orders file (${PENDING_ORDERS_FILE}):`, error);
    }
}
// --- End Shared Pending Order Storage ---

// WebSocket Internal Broadcast Configuration
const INTERNAL_BROADCAST_URL = process.env.INTERNAL_BROADCAST_URL || 'http://localhost:3033/api/price/internal/broadcast'; // Ensure this matches otori-price-api endpoint
const INTERNAL_BROADCAST_SECRET = process.env.INTERNAL_BROADCAST_SECRET; // Optional shared secret

// Load environment variables for accessing remote OrdPi
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
const LP_ADDRESS_2 = process.env.NEXT_PUBLIC_LP_ADDRESS_2 || ''; // Add if needed
const OVT_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
const OVT_TREASURY_ADDRESS_2 = process.env.NEXT_PUBLIC_TREASURY_ADDRESS_2 || 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3';
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';
const OVT_RUNE_NAME = process.env.OVT_RUNE_NAME || 'OTORI•VISION•TOKEN';

// Mock data for development
const mockOrderbook = {
  bids: [
    { price: 245, amount: 500 },
    { price: 240, amount: 750 },
    { price: 235, amount: 1000 }
  ],
  asks: [
    { price: 250, amount: 600 },
    { price: 255, amount: 800 },
    { price: 260, amount: 1200 }
  ]
};

// Mock recent trades
const mockRecentTrades = [
  { price: 248, amount: 200, side: 'buy', timestamp: Date.now() - 1800000 },
  { price: 252, amount: 300, side: 'sell', timestamp: Date.now() - 3600000 },
  { price: 249, amount: 150, side: 'buy', timestamp: Date.now() - 7200000 },
  { price: 250, amount: 400, side: 'sell', timestamp: Date.now() - 14400000 },
  { price: 247, amount: 350, side: 'buy', timestamp: Date.now() - 28800000 }
];

// Check if orderMatchingService is available
let orderMatchingServiceActive = false;

// Try to initialize the service connection
(async () => {
  try {
    // Check if the orderMatchingService is initialized
    const stats = orderMatchingService.getStats();
    orderMatchingServiceActive = true;
    console.log('OrderMatchingService is active and connected');
  } catch (error) {
    console.warn('OrderMatchingService unavailable, using mock data:', error.message);
    orderMatchingServiceActive = false;
  }
})();

// --- Caching Implementation START ---
// Copied from runes_API.js for consistency
const CACHE_TTL_DISTRIBUTION_MS = 60 * 1000; // 1 minute
const CACHE_TTL_TRANSACTIONS_MS = 60 * 1000; // 1 minute
const CACHE_TTL_BALANCES_MS = 30 * 1000;     // 30 seconds

let distributionCache = { data: null, timestamp: 0 };
let transactionsCache = { data: null, timestamp: 0 };
let addressBalanceCache = {}; // Object to store balances per address: { address: { data: {ovt, sats}, timestamp: 0 } }

const isCacheValid = (cacheEntry, ttl) => {
    // Check if cacheEntry itself exists and has data
    return cacheEntry && cacheEntry.data && (Date.now() - cacheEntry.timestamp < ttl);
};

// Overload clearCache or make it more specific
const clearCache = (cacheName, key = null) => {
    console.log(`[Cache - TradingService] Clearing ${cacheName}` + (key ? ` for key ${key}` : ''));
    // Note: This assumes caches are shared or need independent clearing.
    // If caches are truly independent, this needs adjustment. For now, mirroring runes_API logic.
    if (cacheName === 'distribution' || cacheName === 'all') {
        distributionCache = { data: null, timestamp: 0 };
    }
    if (cacheName === 'transactions' || cacheName === 'all') {
        transactionsCache = { data: null, timestamp: 0 };
    }
    if (cacheName === 'balance' || cacheName === 'all') {
        if (key) {
            // Clear specific address balance
            if (addressBalanceCache[key]) {
                delete addressBalanceCache[key];
            }
        } else {
            // Clear all address balances
            addressBalanceCache = {};
        }
    }
};
// --- Caching Implementation END ---

/**
 * Helper function to execute ord commands locally on OrdPi
 * @param {string} command - The ord command to execute
 * @param {Object} options - Additional options for the command
 * @param {string} options.wallet - Wallet name to use (defaults to environment variable or "ovt-LP-wallet")
 * @returns {Object} The result from the command
 */
async function executeOrdCommand(command, options = {}) {
  // Acquire the mutex lock before executing the command
  const release = await ordCommandMutex.acquire();
  console.log(`Trading: Acquired mutex for command: ${command}`);

  try {
    // Get wallet name from options, env var, or default - this is handled by ord.yaml now
    // const walletName = options.wallet || process.env.BITCOIN_WALLET || "ovt-LP-wallet";
    
    // Full ord command with config and wallet selection
    // Wallet should be configured in the ord.yaml file, not passed as a parameter
    const ordPath = process.env.ORD_PATH || 'ord'; // Ensure ORD_PATH is set in OrdPi env
    const ordConfigPath = process.env.ORD_CONFIG_PATH || '/home/BTCPi/.ord/ord.yaml'; // Ensure config path is correct
    const ordNetworkFlag = process.env.BITCOIN_NETWORK === 'signet' ? '--signet' : '';
    const fullCommand = `${ordPath} --config ${ordConfigPath} ${ordNetworkFlag} ${command}`;
    
    // Execute the command using the local service
    console.log(`Trading: Executing local ord command: ${command}`);
    
    // Await the promise directly
    const { stdout, stderr } = await commandService.executeCommand(fullCommand);
    
    if (stderr && stderr.trim()) {
      console.warn(`Trading: Command warning: ${stderr}`);
    }
    
    console.log(`Trading: Command result: ${stdout}`);
    return { success: true, result: stdout, warning: stderr };
  } catch (error) {
    // Handle synchronous errors from executeCommand itself if needed
    console.error(`Trading: Error executing command: ${command}`, error);
    return { 
      success: false, 
      error: error.message || error.toString(),
      isSync: true // Flag to indicate this was a synchronous error
    };
  } finally {
    // Ensure the mutex lock is always released
    release();
    console.log(`Trading: Released mutex for command: ${command}`);
  }
}

/**
 * Gets UTXOs containing specific runes for an address
 * @param {string} address - Bitcoin address
 * @param {string} runeId - ID of rune to find
 * @returns {Promise<Array>} UTXOs containing the rune
 */
async function getRuneUtxos(address, runeId) {
  try {
    // Use ord command to list runes in wallet
    const listCmd = `wallet runics`;
    const result = await executeOrdCommand(listCmd);
    
    if (!result.success) {
      throw new Error(`Failed to list runes: ${result.error}`);
    }
    
    // Parse the result to find UTXOs with the specific rune
    console.log('Rune balance command output:', result.result);
    
    // This is a placeholder since the actual output format needs to be parsed
    // based on the specific ord command output structure
    // For now, we'll return a basic UTXO assuming the command succeeded
    return [
      {
        txid: "rune_utxo_placeholder",
        vout: 0,
        amount: 10000, // in satoshis
        runes: [{ id: 'OTORI•VISION•TOKEN', amount: 1000000 }]
      }
    ];
  } catch (error) {
    console.error(`Error getting rune UTXOs: ${error.message}`);
    return [];
  }
}

/**
 * Transfers runes from the LP wallet to a recipient
 * @param {string} recipient - Recipient address
 * @param {number} amount - Amount of runes to transfer
 * @param {string} runeId - ID of rune to transfer (format: "id:divisibility")
 * @returns {Promise<Object>} Transfer result with txid
 */
async function transferRunes(recipient, amount, runeId = OVT_RUNE_ID) {
  try {
    console.log(`Transferring ${amount} of rune ${runeId} to ${recipient}`);
    
    // The ord CLI already handles divisibility, so we don't need to multiply 
    // Use the amount as is - no need to format based on decimal places
    const runeAmount = amount.toString();
    
    // Use the full rune name from environment instead of the ID
    // const runeName = OVT_RUNE_NAME; // Keep this line commented if using RUNE_ID
    
    // Format the asset according to documentation: AMOUNT:RUNE_ID
    // Use runeId directly as per the plan to use `ord wallet send` which expects ID
    const asset = `${runeAmount}:${runeId}`;
    
    // Use ord command to create and broadcast the rune transfer
    // Format: wallet send --fee-rate <FEE_RATE> --postage <POSTAGE> <ADDRESS> <AMOUNT>:<RUNE_ID>
    const feeRate = process.env.BITCOIN_FEE_RATE || 1; // Default 1 sat/vB
    const postage = process.env.ORD_POSTAGE_SATS || 777; // Use env var or 777 sats
    const transferCmd = `wallet send --fee-rate ${feeRate} --postage ${postage} ${recipient} "${asset}"`;
    console.log(`Executing transfer command: ${transferCmd}`);
    
    // Use the refactored executeOrdCommand which now runs locally
    const result = await executeOrdCommand(transferCmd);
    
    if (!result.success) {
      throw new Error(`Failed to transfer runes: ${result.error}`);
    }
    
    // Extract txid from the result (assuming the result contains the txid)
    // The result might be a JSON object or a simple string
    let txid;
    let transferDetails = {};
    
    try {
      // Try to parse as JSON first
      const jsonResult = JSON.parse(result.result);
      console.log('Parsed JSON result:', jsonResult);
      
      // Extract the txid and other details
      txid = jsonResult.txid;
      transferDetails = jsonResult;
    } catch (parseError) {
      // If not JSON, use the string result as txid
      console.log('Using plain string as txid, parse error:', parseError.message);
      txid = result.result ? result.result.trim() : `mock_${Date.now()}`;
    }
    
    if (!txid) {
      txid = `mock_${Date.now()}`;
      console.warn('No txid found in result, using mock txid');
    }
    
    return { 
      success: true, 
      txid, 
      amount, 
      recipient,
      transferDetails
    };
  } catch (error) {
    console.error(`Error transferring runes: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the balance of a specific rune for an address
 * @param {string} address - Bitcoin address
 * @param {string} runeId - ID of rune
 * @returns {Promise<number>} Balance of the rune
 */
async function getRuneBalance(address, runeId = OVT_RUNE_ID) {
  try {
    // Use ord command to get rune balance
    const balanceCmd = `wallet runics`;
    // Use the refactored executeOrdCommand which now runs locally
    const result = await executeOrdCommand(balanceCmd);
    
    if (!result.success) {
      throw new Error(`Failed to get rune balance: ${result.error}`);
    }
    
    console.log('Rune balance command output:', result.result);
    
    // Try to parse as JSON first - this is the most common format from newer ord versions
    try {
      const jsonData = JSON.parse(result.result);
      
      // Check if it's an array - newer ord returns an array of outputs
      if (Array.isArray(jsonData)) {
        // Look for the OVT rune in each output
        for (const item of jsonData) {
          if (item.runes && OVT_RUNE_NAME in item.runes) {
            const amount = parseInt(item.runes[OVT_RUNE_NAME]);
            console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${amount}`);
            return amount;
          }
        }
      } 
      // Also handle if it's a direct object with runes property (some ord versions)
      else if (jsonData.runes && OVT_RUNE_NAME in jsonData.runes) {
        const amount = parseInt(jsonData.runes[OVT_RUNE_NAME]);
        console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${amount}`);
        return amount;
      }
    } catch (jsonError) {
      console.log(`JSON parsing failed: ${jsonError.message}, trying string parsing`);
      
      // If JSON parsing fails, try the original string parsing approach
      const runeBalances = {};
      const balanceLines = result.result.split('\n');
      
      for (const line of balanceLines) {
        // Try to match the rune name and balance
        // Format is typically "RUNE_NAME: X.XX ⊙"
        const match = line.match(/([^:]+):\s+([0-9.]+)\s+⊙/);
        if (match) {
          const runeName = match[1].trim();
          const amount = parseFloat(match[2]);
          runeBalances[runeName] = amount;
        }
      }
      
      // Check if we have OVT_RUNE_NAME in the balances
      if (OVT_RUNE_NAME in runeBalances) {
        console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${runeBalances[OVT_RUNE_NAME]}`);
        return runeBalances[OVT_RUNE_NAME];
      }
    }
    
    // If not found in any format, log and return 0
    console.log(`Rune ${OVT_RUNE_NAME} not found in balances, returning 0`);
    return 0;
  } catch (error) {
    console.error(`Error getting rune balance: ${error.message}`);
    return 0;
  }
}

/**
 * Verifies a rune transfer transaction
 * @param {string} txid - Transaction ID
 * @returns {Promise<Object>} Verification result
 */
async function verifyRuneTransfer(txid) {
  try {
    if (!txid || txid.startsWith('mock_')) {
      return { 
        success: false, 
        verified: false, 
        error: "Cannot verify mock transaction", 
        isMock: true 
      };
    }
    
    // First, check if the transaction exists using local bitcoin-cli
    // We use executeBitcoinCommand here for clarity, assuming it's configured for OrdPi's node
    const txCmd = `getrawtransaction ${txid}`;
    let txResult;
    try {
      txResult = await commandService.executeBitcoinCommand(txCmd);
      // Check if the command returned a string (the raw tx hex)
      if (typeof txResult !== 'string' || txResult.length === 0) {
         throw new Error('getrawtransaction did not return a valid transaction hex.');
      }
    } catch (btcError) {
       // Handle specific error if tx not found
       if (btcError.message && (btcError.message.includes('No such mempool or blockchain transaction') || btcError.message.includes('transaction not found'))) {
         throw new Error(`Transaction not found: ${txid}`);
       } else {
         // Rethrow other bitcoin-cli errors
         throw new Error(`Error checking transaction with bitcoin-cli: ${btcError.message}`);
       }
    }
    
    // Now check if this transaction involved rune transfers using local ord
    const runeCmd = `rune transaction ${txid}`;
    const runeResult = await executeOrdCommand(runeCmd);
    
    if (!runeResult.success) {
      // The transaction exists but may not be a rune transaction
      return { 
        success: true, 
        verified: false, 
        details: txResult,
        error: "Transaction exists but is not a rune transfer"
      };
    }
    
    // Parse the rune transaction details
    let details;
    try {
      if (typeof runeResult.result === 'string') {
        // Try to parse as JSON if it's a string in JSON format
        if (runeResult.result.trim().startsWith('{')) {
          details = JSON.parse(runeResult.result);
        } else {
          // Otherwise store as text
          details = { raw: runeResult.result };
        }
      } else {
        details = runeResult.result;
      }
    } catch (parseError) {
      console.warn(`Could not parse rune transaction details: ${parseError.message}`);
      details = { raw: runeResult.result };
    }
    
    // Check if the transaction contains OVT transfers
    const containsOVT = 
      (details.raw && details.raw.includes(OVT_RUNE_NAME)) || 
      (details.rune && details.rune === OVT_RUNE_NAME) ||
      (details.runes && details.runes.some(r => r.rune === OVT_RUNE_NAME));
    
    return { 
      success: true, 
      verified: containsOVT, 
      details,
      containsOVT
    };
  } catch (error) {
    console.error(`Error verifying rune transfer: ${error.message}`);
    return { 
      success: false, 
      verified: false, 
      error: error.message 
    };
  }
}

/**
 * Helper to handle errors with fallback to mock data
 * @param {Function} fn - Function to execute
 * @param {any} fallbackValue - Fallback value if function fails
 * @returns {Promise<any>} - Result or fallback
 */
async function withFallback(fn, fallbackValue) {
  if (!orderMatchingServiceActive) {
    return fallbackValue;
  }
  
  try {
    return await fn();
  } catch (error) {
    console.error('Error in trading service, falling back to mock data:', error);
    return fallbackValue;
  }
}

/**
 * Match orders in the orderbook
 * @returns {Promise<Array>} Matched orders
 */
async function matchOrders() {
  return withFallback(
    async () => await orderMatchingService.matchOrders(),
    [] // Empty array as fallback
  );
}

/**
 * Process matches into execution batches
 * @returns {Promise<Array>} Execution batches
 */
async function processMatches() {
  return withFallback(
    async () => await orderMatchingService.processMatches(),
    [] // Empty array as fallback
  );
}

/**
 * Checks if a transaction requires multi-signature verification
 * based on whether it's spending from a treasury address
 * @param {Object} transaction - Transaction details
 * @returns {boolean} Whether multi-signature is required
 */
function requiresMultiSignature(transaction) {
  // If no transaction or no inputs, we can't determine
  if (!transaction || !transaction.inputs || !Array.isArray(transaction.inputs)) {
    return false;
  }
  
  // Check if any input is from a treasury address
  return transaction.inputs.some(input => {
    // Get the input address
    const inputAddress = input.address || '';
    // Check if it's a treasury address
    return adminService.isTreasuryAddress(inputAddress);
  });
}

/**
 * Verify transaction meets all requirements including multi-signature threshold for treasury transactions
 * @param {Object} transaction - Transaction to verify
 * @returns {Promise<Object>} Validation result
 */
async function validateTransaction(transaction) {
  // First, perform standard transaction validation
  const validationResult = await validationService.validateTransaction(transaction);
  
  // If standard validation fails, return the failure
  if (!validationResult.valid) {
    return validationResult;
  }
  
  // Check if this transaction requires multi-signature verification
  const needsMultiSig = requiresMultiSignature(transaction);
  
  if (needsMultiSig) {
    // Verify that the transaction meets the signature threshold
    const meetsThreshold = adminService.verifySignatureThreshold(transaction);
    
    if (!meetsThreshold) {
      return {
        valid: false,
        stage: 'signature',
        error: 'Treasury transaction requires multi-signature verification',
        details: {
          requiredSignatures: adminService.config.requiredSignatures,
          providedSignatures: transaction.signatures ? transaction.signatures.length : 0
        }
      };
    }
  }
  
  // All validation passed
  return {
    ...validationResult,
    additionalValidation: {
      multiSignatureRequired: needsMultiSig,
      multiSignatureVerified: needsMultiSig ? true : null
    }
  };
}

/**
 * Stores pending order details in the file.
 * @param {string} orderId - Unique identifier for the order.
 * @param {Object} orderDetails - Details of the order (fromAddress, amount, price, costSats, timestamp).
 * @returns {boolean} - True if stored successfully
 */
function storePendingOrder(orderId, orderDetails) {
    if (!orderId || !orderDetails) {
        console.error('[Trading Service] Attempted to store invalid order data.');
        return false;
    }
    try {
        console.log(`[Trading Service] Storing order: ${orderId}. Details:`, orderDetails);
        const orders = readPendingOrdersFile();
        orders[orderId] = orderDetails; // Add or update the order
        writePendingOrdersFile(orders);
        console.log(`[Trading Service] Order ${orderId} stored in file.`);
        return true;
    } catch (error) {
        console.error(`[Trading Service] Failed to store order ${orderId} in file:`, error);
        return false;
    }
}

/**
 * Retrieves pending order details from the file.
 * @param {string} orderId - Unique identifier for the order.
 * @returns {Object|null} - Order details or null if not found
 */
function getPendingOrder(orderId) {
    console.log(`[Trading Service] Getting order: ${orderId}`);
    if (!orderId) {
        console.warn('[Trading Service] Attempted to get order with null/undefined ID.');
        return null;
    }
    try {
        const orders = readPendingOrdersFile();
        console.log(`[Trading Service] Found ${Object.keys(orders).length} orders in file at time of get.`); // Log count
        return orders[orderId] || null;
    } catch (error) {
        console.error(`[Trading Service] Failed to get order ${orderId} from file:`, error);
        return null;
    }
}

/**
 * Remove a pending order from the file
 * @param {string} orderId - The order ID
 */
function removePendingOrder(orderId) {
    if (!orderId) {
        console.warn('[Trading Service] Attempted to remove order with null/undefined ID.');
        return;
    }
    try {
        const orders = readPendingOrdersFile();
        if (orders[orderId]) {
            delete orders[orderId];
            writePendingOrdersFile(orders);
            console.log(`[Trading Service] Pending order removed from file: ${orderId}`);
        } else {
            console.log(`[Trading Service] Attempted to remove non-existent order from file: ${orderId}`);
        }
    } catch (error) {
        console.error(`[Trading Service] Failed to remove order ${orderId} from file:`, error);
    }
}

/**
 * Confirms a user's BTC payment and triggers OVT fulfillment.
 * @param {string} orderId - The ID of the pending order.
 * @param {string} btcTxId - The transaction ID of the user's BTC payment.
 * @returns {Promise<Object>} - Result object { success: boolean, ovtTxId?: string, error?: string }
 */
async function confirmBuyPayment(orderId, btcTxId) {
  console.log(`[Trading Service] Confirming payment for order ${orderId}, BTC TxID: ${btcTxId}`);
  const pendingOrder = getPendingOrder(orderId);

  if (!pendingOrder) {
    console.error(`[Trading Service] Order ${orderId} not found for payment confirmation.`);
    return { success: false, status: 'order_not_found', message: `Order ${orderId} not found.` };
  }

  // Prevent re-processing if already completed or failed in a final state
  if (['completed', 'btc_verification_failed', 'ovt_transfer_failed'].includes(pendingOrder.status)) {
      console.log(`[Trading Service] Order ${orderId} already in final state: ${pendingOrder.status}. Skipping confirmation.`);
      return { success: true, status: pendingOrder.status, message: `Order already processed with status: ${pendingOrder.status}` };
  }

  // Use the specific address designated for receiving initial BTC payments
  const expectedAddress = process.env.LP_BTC_RECEIVING_ADDRESS; 
  if (!expectedAddress) {
      console.error("[Trading Service] CRITICAL: LP_BTC_RECEIVING_ADDRESS environment variable is not set!");
      // Update status to reflect internal config error
      updatePendingOrderStatus(orderId, 'internal_config_error', { error: 'LP_BTC_RECEIVING_ADDRESS not configured.' });
      return { success: false, status: 'internal_config_error', message: 'Internal server configuration error preventing payment verification.' };
  }
  
  const expectedCostSats = pendingOrder.costSats;
  const expectedCostBtc = expectedCostSats / 1e8; // Convert sats to BTC for comparison

  try {
    console.log(`[Trading Service] Verifying BTC Tx ${btcTxId} using getrawtransaction...`);
    
    // --- Use getrawtransaction as the primary check ---
    const rawTxData = await commandService.executeBitcoinCommand(
      `getrawtransaction ${btcTxId} true` // Add 'true' for verbose JSON output
    );

    // Check if transaction exists and has confirmations
    if (!rawTxData || typeof rawTxData !== 'object') {
        console.error(`[Trading Service] Failed to fetch raw transaction data for ${btcTxId}. Response:`, rawTxData);
        updatePendingOrderStatus(orderId, 'btc_verification_failed');
        return { success: false, status: 'btc_verification_failed', message: `Failed to fetch transaction data for ${btcTxId}.` };
    }

    console.log(`[Trading Service] Raw TX data received for ${btcTxId}:`, JSON.stringify(rawTxData, null, 2)); // Log the structure

    const confirmations = rawTxData.confirmations || 0;
    console.log(`[Trading Service] Transaction ${btcTxId} has ${confirmations} confirmations.`);

    // --- Verification Logic ---
    let paymentVerified = false;
    let foundCorrectOutput = false;

    if (rawTxData.vout && Array.isArray(rawTxData.vout)) {
        for (const output of rawTxData.vout) {
            if (output.scriptPubKey && output.scriptPubKey.address === expectedAddress) {
                // Found an output to the correct address
                const receivedAmountBtc = output.value;
                console.log(`[Trading Service] Output found to ${expectedAddress} with amount ${receivedAmountBtc} BTC.`);
                // Use a small tolerance for floating point comparison
                if (Math.abs(receivedAmountBtc - expectedCostBtc) < 1e-9) { 
                    foundCorrectOutput = true;
                    console.log(`[Trading Service] Correct amount confirmed for output to ${expectedAddress}.`);
                    break; // Found the matching output
                } else {
                    console.warn(`[Trading Service] Output to ${expectedAddress} found, but amount mismatch. Expected: ${expectedCostBtc}, Received: ${receivedAmountBtc}`);
                }
            }
        }
    } else {
        console.warn(`[Trading Service] Transaction ${btcTxId} has no outputs (vout) array.`);
    }

    // Decide status based on verification and confirmations
    if (foundCorrectOutput) {
        if (confirmations >= 1) {
            console.log(`[Trading Service] BTC Payment verified for order ${orderId} (Tx: ${btcTxId}, Confirmations: ${confirmations}).`);
            paymentVerified = true;
        } else {
            console.log(`[Trading Service] BTC Payment found for order ${orderId} (Tx: ${btcTxId}) but has 0 confirmations. Status remains pending_confirmation.`);
            updatePendingOrderStatus(orderId, 'pending_confirmation');
            return { success: true, status: 'pending_confirmation', message: `Transaction ${btcTxId} found but awaiting confirmation.` };
        }
    } else {
        // If correct output wasn't found
        console.error(`[Trading Service] BTC verification failed for order ${orderId} (Tx: ${btcTxId}). Correct output (Address: ${expectedAddress}, Amount: ${expectedCostBtc} BTC) not found.`);
        updatePendingOrderStatus(orderId, 'btc_verification_failed');
        return { success: false, status: 'btc_verification_failed', message: `Payment verification failed for ${btcTxId}. Output mismatch.` };
    }

    // --- Proceed to OVT Transfer if BTC payment is verified ---
    if (paymentVerified) {
      console.log(`[Trading Service] Attempting OVT transfer for verified order ${orderId}...`);
      try {
        const transferParams = {
          recipientAddress: pendingOrder.fromAddress,
          amount: pendingOrder.amount, // OVT amount
          orderId: orderId,
          btcTxId: btcTxId // Pass BTC txid for logging/reference
        };
        
        const transferResult = await transferTokensFromLP(transferParams);

        if (transferResult.success && transferResult.ovtTxId) {
          console.log(`[Trading Service] OVT transfer successful for order ${orderId}. OVT TxID: ${transferResult.ovtTxId}`);
          
          // Update order status to completed and add OVT txid
          updatePendingOrderStatus(orderId, 'completed', { ovtTxId: transferResult.ovtTxId });
          // Optionally remove from pending if successful completion means it's no longer 'pending'
          // removePendingOrder(orderId); // Keep it for history unless explicitly needed otherwise
          
          return { 
              success: true, 
              status: 'completed', 
              message: 'Buy order completed successfully.',
              ovtTxId: transferResult.ovtTxId,
              btcTxId: btcTxId
          };
        } else {
          // OVT Transfer Failed - Critical State!
          console.error(`[Trading Service] OVT transfer FAILED for order ${orderId} after BTC confirmed. Error: ${transferResult.message}. Order status set to ovt_transfer_failed.`);
          updatePendingOrderStatus(orderId, 'ovt_transfer_failed', { error: transferResult.message });
          // ** MANUAL INTERVENTION REQUIRED HERE ** 
          // Log this state clearly. A refund process needs to be triggered.
          return { 
              success: false, 
              status: 'ovt_transfer_failed', 
              message: `BTC payment confirmed, but OVT transfer failed: ${transferResult.message}`,
              btcTxId: btcTxId
          };
        }
      } catch (transferError) {
        // Catch errors during the transfer attempt itself
        console.error(`[Trading Service] Exception during OVT transfer for order ${orderId}: ${transferError.message}`);
        updatePendingOrderStatus(orderId, 'ovt_transfer_failed', { error: transferError.message });
         // ** MANUAL INTERVENTION REQUIRED HERE **
         return { 
              success: false, 
              status: 'ovt_transfer_failed', 
              message: `Exception during OVT transfer: ${transferError.message}`,
              btcTxId: btcTxId
          };
      }
    }
    // This part should logically not be reached if verification failed earlier, but as a fallback:
    else {
        console.error(`[Trading Service] Reached end of confirmBuyPayment for ${orderId} without resolving to a final state. Defaulting to failure.`);
        updatePendingOrderStatus(orderId, 'btc_verification_failed');
         return { 
              success: false, 
              status: 'btc_verification_failed', 
              message: 'BTC verification failed or confirmations insufficient.',
              btcTxId: btcTxId
          };
    }

  } catch (error) {
    console.error(`[Trading Service] Error during BTC payment confirmation for order ${orderId} (Tx: ${btcTxId}):`, error);

    // Check if the error is specifically "transaction not found" from bitcoin-cli
    // Error structure might vary, check message or stderr if available
    let specificErrorMsg = error.message || '';
    if (error.stderr) {
        specificErrorMsg += ` (stderr: ${error.stderr})`;
    }

    if (specificErrorMsg.includes('No such mempool or blockchain transaction') || specificErrorMsg.includes('transaction not found')) {
        console.warn(`[Trading Service] Transaction ${btcTxId} not found via getrawtransaction. Treating as pending/not yet propagated.`);
         // Keep status as pending_payment or move to pending_confirmation? Let's use pending_confirmation
         // as the user *thinks* they paid. The background poller should retry.
        updatePendingOrderStatus(orderId, 'pending_confirmation');
        return { success: false, status: 'pending_confirmation', message: `Transaction ${btcTxId} not found or not yet propagated. Awaiting confirmation.` };
    } else {
        // Generic error during bitcoin-cli execution or other logic
        updatePendingOrderStatus(orderId, 'btc_verification_failed');
        return { 
            success: false, 
            status: 'btc_verification_failed', 
            message: `Error during BTC verification: ${specificErrorMsg}`,
            btcTxId: btcTxId,
            error: error // Include original error for debugging if helpful
        };
    }
  }
}

/**
* Updates the status of a pending order in the file.
* @param {string} orderId - The ID of the order to update.
* @param {string} newStatus - The new status string.
*/
function updatePendingOrderStatus(orderId, newStatus, details = {}) {
    console.log(`[Trading Service] Updating status for order ${orderId} to ${newStatus}. Details:`, details);
    const orders = readPendingOrdersFile();
    if (orders[orderId]) {
        orders[orderId].status = newStatus;
        orders[orderId].lastUpdated = new Date().toISOString();
        // Merge any additional details provided
        orders[orderId] = { ...orders[orderId], ...details }; 
        
        // Clean up error details if status is no longer failed
        if (newStatus !== 'btc_verification_failed' && newStatus !== 'ovt_transfer_failed') {
            delete orders[orderId].error;
        }

        writePendingOrdersFile(orders);
        console.log(`[Trading Service] Status updated for order ${orderId} to ${newStatus}.`);
    } else {
        console.warn(`[Trading Service] Tried to update status for non-existent order ${orderId}.`);
    }
}

/**
 * Transfer OVT tokens from the LP wallet to a recipient using `ord wallet send`
 * @param {Object} params - Transfer parameters
 * @param {string} params.recipient - Recipient address
 * @param {number} params.amount - Amount to transfer (in token units, not satoshis)
 * @returns {Promise<Object>} Transfer result { success: boolean, txid?: string, error?: string }
 */
async function transferTokensFromLP(params) {
  const { recipientAddress, amount, orderId, btcTxId } = params; // Include btcTxId
  console.log(`[Trading Service] Initiating OVT transfer: ${amount} OVT to ${recipientAddress} for order ${orderId} (BTC Tx: ${btcTxId})`);

  try {
    // Ensure amount is positive
    if (amount <= 0) {
      console.error('[Transfer LP] Invalid amount:', amount);
      return { success: false, error: 'Amount must be positive' };
    }

    // 1. Validate parameters
    if (!recipientAddress || !amount) {
      console.error('[Transfer LP] Invalid parameters:', params);
      return { success: false, error: 'Recipient and positive amount are required' };
    }

    console.log(`[Transfer LP] Initiating transfer of ${amount} OVT to ${recipientAddress}`);

    // 2. Execute `ord wallet send` command
    let transferResult;
    try {
      // Use the transferRunes function which handles the ord command execution
      // transferRunes expects the amount in base token units
      transferResult = await transferRunes(recipientAddress, amount, OVT_RUNE_ID);

      if (!transferResult.success || !transferResult.txid) {
        throw new Error(transferResult.error || 'ord wallet send command failed or did not return a txid');
      }

      console.log(`[Transfer LP] Real OVT transfer executed via ord. TXID: ${transferResult.txid}`);

      // --- WebSocket Update ---
      // Prepare transaction object for broadcast
      const transactionData = {
          txid: transferResult.txid,
          type: 'BUY_FULFILLMENT', // Specific type for fulfillment
          amount: amount, // Raw amount of OVT
          fromAddress: LP_ADDRESS, // Sent from LP
          toAddress: recipientAddress,    // Sent to buyer
          timestamp: Date.now(),
          status: 'submitted', // Mark as submitted initially
          confirmations: 0,
          runeId: OVT_RUNE_ID,
          // price: null // Price isn't directly relevant here, but could be added from order
      };

      // Send OVT_TRANSACTION_ADDED update
      await broadcastInternalUpdate('OVT_TRANSACTION_ADDED', transactionData);

      // Send OVT_BALANCE_UPDATE for recipient and potentially LP
      // Recipient balance will update when TX confirms
      await broadcastInternalUpdate('OVT_BALANCE_UPDATE', { address: recipientAddress });
      await broadcastInternalUpdate('OVT_BALANCE_UPDATE', { address: LP_ADDRESS });
      // --- End WebSocket Update ---

      // --- Cache Invalidation START ---
      console.log(`[Cache - TradingService] Invalidating caches after successful transfer ${transferResult.txid}`);
      clearCache('distribution');
      clearCache('transactions');
      clearCache('balance', LP_ADDRESS); // Invalidate LP balance
      clearCache('balance', recipientAddress);  // Invalidate recipient balance
      // Optional: Clear other relevant addresses if needed (e.g., secondary LP)
      if (LP_ADDRESS_2) {
          clearCache('balance', LP_ADDRESS_2);
      }
      // --- Cache Invalidation END ---

      return {
          success: true,
          txid: transferResult.txid,
          amount: amount,
          recipient: recipientAddress,
          timestamp: Date.now(),
          isMock: false // This is a real transaction attempt
      };

    } catch (error) {
      console.error(`[Transfer LP] Failed to execute ord wallet send: ${error.message}`);
      console.error("Error details:", error); // Log full error

       // --- WebSocket Update for Failure ---
       const failureData = {
          txid: `failed-${Date.now()}`,
          type: 'BUY_FULFILLMENT_FAILED',
          amount: amount,
          fromAddress: LP_ADDRESS,
          toAddress: recipientAddress,
          timestamp: Date.now(),
          status: 'failed',
          runeId: OVT_RUNE_ID,
          error: error.message || 'Unknown transfer error'
      };
      await broadcastInternalUpdate('OVT_TRANSACTION_FAILED', failureData); // Use a specific failure type if needed
      // --- End WebSocket Update for Failure ---

      return {
          success: false,
          error: `Failed to transfer OVT from LP: ${error.message}`,
          isMock: false
      };
    }
  } catch (error) {
    console.error(`[Transfer LP] Failed to execute transfer: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Execute a buy order directly (without order matching)
 * @param {Object} order - Buy order details
 * @returns {Promise<Object>} Execution result
 */
async function executeBuyOrder(order) {
  const { price, amount, address, signatures } = order;
  
  if (!price || !amount || !address) {
    throw new Error('Invalid order parameters');
  }
  
  // Calculate total cost in sats
  const totalCostSats = price * amount;
  
  try {
    // Create a transfer from LP to buyer
    const transferResult = await transferTokensFromLP({
      recipientAddress: address,
      amount,
      orderId: `buy-${Date.now()}`,
      btcTxId: null // No BTC txid for market orders
    });
    
    // If this is a real transaction (not mock), log it
    if (!transferResult.isMock) {
      // Log the buy transaction if not already logged in transferTokensFromLP
      if (process.env.ENABLE_REAL_TRANSACTIONS === 'true') {
        // Use await here since logTransaction is async now
        await logTransaction({
          txid: transferResult.txid,
          type: 'BUY',
          amount,
          fromAddress: address,
          toAddress: LP_ADDRESS,
          price,
          isRune: true
        });
      }
    }
    
    const executionResult = {
      success: true,
      orderId: `buy-${Date.now()}`,
      txid: transferResult.txid,
      price,
      amount,
      totalCost: totalCostSats,
      recipient: address,
      timestamp: Date.now(),
      isMock: transferResult.isMock,
      side: 'buy'
    };

    // --- WebSocket Broadcast ---
    // Broadcast TRADE_UPDATE after successful execution
    // Use the structure from executionResult as the payload
    // Ensure frontend expects this structure or adapt as needed
    await broadcastInternalUpdate('TRADE_UPDATE', executionResult);

    // Broadcast ORDER_BOOK_UPDATE as a buy consumes liquidity
    try {
        const currentOrderbook = await getOrderbook(); // Fetch current state
        await broadcastInternalUpdate('ORDER_BOOK_UPDATE', currentOrderbook);
    } catch (orderbookError) {
        console.error("Failed to fetch or broadcast orderbook after buy execution:", orderbookError);
    }
    // --- End WebSocket Broadcast ---

    return executionResult;
  } catch (error) {
    console.error(`Failed to execute buy order: ${error.message}`);
    throw new Error(`Buy order execution failed: ${error.message}`);
  }
}

/**
 * Get trading service statistics
 * @returns {Promise<Object>} Service statistics
 */
async function getStats() {
  // Get validation statistics
  const validationStats = validationService.getValidationStats();
  
  const tradingStats = await withFallback(
    async () => orderMatchingService.getStats(),
    {
      buyOrderCount: mockOrderbook.bids.length,
      sellOrderCount: mockOrderbook.asks.length,
      matchCount: 0,
      pendingMatchCount: 0,
      mockMode: true,
      lastUpdate: Date.now()
    }
  );
  
  // Get admin service statistics
  const adminStats = {
    pendingActionCount: adminService.getPendingAdminActions().length,
    treasuryAddresses: adminService.config.treasuryAddresses,
    requiredSignatures: adminService.config.requiredSignatures
  };
  
  // Combine stats
  return {
    ...tradingStats,
    validation: validationStats,
    admin: adminStats
  };
}

/**
 * Get recent trades
 * @param {number} limit - Maximum number of trades to return
 * @returns {Promise<Array>} Recent trades
 */
async function getRecentTrades(limit = 10) {
  try {
    // Try to get real trade data if available from order matching service
    if (typeof orderMatchingService !== 'undefined' && orderMatchingService) {
      try {
        const realTrades = await orderMatchingService.getRecentTrades(limit);
        if (realTrades && Array.isArray(realTrades) && realTrades.length > 0) {
          console.log(`Retrieved ${realTrades.length} recent trades from order matching service`);
          return realTrades;
        }
      } catch (serviceError) {
        console.warn(`Error fetching trades from order matching service: ${serviceError.message}. Falling back to mock data.`);
      }
    }
    
    // If orderMatchingService isn't available or returned no data, try to fetch from API
    try {
      // Try fetching from remote Runes API if available
      const runesApiUrl = process.env.REMOTE_RUNES_API || 'http://192.168.178.54:9191';
      const response = await axios.get(`${runesApiUrl}/ovt/trades?limit=${limit}`, { 
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data && response.data.success && 
          Array.isArray(response.data.trades) && response.data.trades.length > 0) {
        console.log(`Retrieved ${response.data.trades.length} recent trades from Runes API`);
        return response.data.trades;
      }
    } catch (apiError) {
      console.warn(`Error fetching trades from API: ${apiError.message}. Falling back to mock data.`);
    }

    // Fall back to mock data if all else fails
    console.log(`No real trade data available. Using mock data (${limit} trades).`);
    return mockRecentTrades.slice(0, limit);
  } catch (error) {
    console.error('Error in getRecentTrades:', error);
    return mockRecentTrades.slice(0, limit);
  }
}

/**
 * Gets the current state of the order book
 * @param {boolean} includeSummary - Whether to include summary statistics
 * @returns {Promise<Object>} Order book data with bids and asks
 */
async function getOrderbook(includeSummary = false) {
  try {
    // Try to get real orderbook data if available from order matching service
    if (typeof orderMatchingService !== 'undefined' && orderMatchingService) {
      try {
        const realOrderbook = await orderMatchingService.getOrderbook();
        if (realOrderbook && realOrderbook.bids && realOrderbook.asks) {
          console.log(`Retrieved orderbook from order matching service: ${realOrderbook.bids.length} bids, ${realOrderbook.asks.length} asks`);
          
          // Add summary data if requested
          if (includeSummary) {
            realOrderbook.summary = calculateOrderbookSummary(realOrderbook);
          }
          
          return realOrderbook;
        }
      } catch (serviceError) {
        console.warn(`Error fetching orderbook from order matching service: ${serviceError.message}. Falling back to mock data.`);
      }
    }
    
    // If orderMatchingService isn't available or returned no data, try to fetch from API
    try {
      // Try fetching from remote Runes API if available
      const runesApiUrl = process.env.REMOTE_RUNES_API || 'http://192.168.178.54:9191';
      const response = await axios.get(`${runesApiUrl}/ovt/orderbook`, { 
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data && response.data.success && 
          response.data.orderbook && response.data.orderbook.bids && response.data.orderbook.asks) {
        console.log(`Retrieved orderbook from Runes API: ${response.data.orderbook.bids.length} bids, ${response.data.orderbook.asks.length} asks`);
        
        // Add summary data if requested
        if (includeSummary) {
          response.data.orderbook.summary = calculateOrderbookSummary(response.data.orderbook);
        }
        
        return response.data.orderbook;
      }
    } catch (apiError) {
      console.warn(`Error fetching orderbook from API: ${apiError.message}. Falling back to mock data.`);
    }

    // Fall back to mock data if all else fails
    console.log('No real orderbook data available. Using mock data.');
    
    // Add summary data if requested
    if (includeSummary) {
      mockOrderbook.summary = calculateOrderbookSummary(mockOrderbook);
    }
    
    return mockOrderbook;
  } catch (error) {
    console.error('Error in getOrderbook:', error);
    return mockOrderbook;
  }
}

/**
 * Calculate summary statistics for an orderbook
 * @param {Object} orderbook - Orderbook with bids and asks
 * @returns {Object} Summary statistics
 */
function calculateOrderbookSummary(orderbook) {
  const summary = {
    bidCount: orderbook.bids.length,
    askCount: orderbook.asks.length,
    highestBid: 0,
    lowestAsk: Infinity,
    bidVolume: 0,
    askVolume: 0,
    spread: 0,
    spreadPercent: 0
  };
  
  // Calculate highest bid and total bid volume
  if (orderbook.bids.length > 0) {
    summary.highestBid = Math.max(...orderbook.bids.map(bid => bid.price));
    summary.bidVolume = orderbook.bids.reduce((total, bid) => total + bid.amount, 0);
  }
  
  // Calculate lowest ask and total ask volume
  if (orderbook.asks.length > 0) {
    summary.lowestAsk = Math.min(...orderbook.asks.map(ask => ask.price));
    summary.askVolume = orderbook.asks.reduce((total, ask) => total + ask.amount, 0);
  }
  
  // Calculate spread
  if (summary.lowestAsk !== Infinity && summary.highestBid > 0) {
    summary.spread = summary.lowestAsk - summary.highestBid;
    summary.spreadPercent = (summary.spread / summary.lowestAsk) * 100;
  }
  
  return summary;
}

// Export the synchronous version for backward compatibility
function getOrderbookSync() {
  console.log('Using synchronous orderbook getter (mock data only)');
  return mockOrderbook;
}

/**
 * Place a new order in the order book
 * @param {Object} order - Order details
 * @returns {Promise<Object>} Order placement result
 */
async function placeOrder(order) {
  try {
    // Validate the order parameters
    if (!order || !order.side || !order.amount || !order.price) {
      return { 
        success: false, 
        error: 'Invalid order parameters. Side, amount and price are required.'
      };
    }
    
    // Try to use the order matching service if available
    if (typeof orderMatchingService !== 'undefined' && orderMatchingService) {
      try {
        const result = await orderMatchingService.placeOrder(order);
        console.log(`Order placed with order matching service: ${JSON.stringify(result)}`);
        return result;
      } catch (serviceError) {
        console.warn(`Error placing order with matching service: ${serviceError.message}. Falling back to direct execution.`);
      }
    }

    // For buy orders, execute directly as a market order
    if (order.side.toLowerCase() === 'buy') {
      console.log(`Executing buy order directly: ${order.amount} tokens at ${order.price} sats`);
      return executeBuyOrder(order);
    }
    
    // For sell orders, just acknowledge without executing (would need LP integration)
    return {
      success: true,
      orderId: `sell-${Date.now()}`,
      message: 'Sell order acknowledged (mock implementation)',
      order
    };
  } catch (error) {
    console.error('Error placing order:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Log transaction details for auditing and tracking
 * @param {Object} txDetails - Transaction details
 * @param {string|Object} txDetails.txid - Transaction ID or transaction object
 * @param {string} txDetails.type - Transaction type
 * @param {number} txDetails.amount - Amount transacted (in token units)
 * @param {string} txDetails.fromAddress - Sender address
 * @param {string} txDetails.toAddress - Recipient address
 * @param {number} txDetails.price - Price per token (in sats)
 * @returns {Promise<void>}
 */
async function logTransaction(txDetails) {
  const { txid, type, amount, fromAddress, toAddress, price } = txDetails;
  
  try {
    // Ensure txid is a string
    let txidStr = typeof txid === 'string' ? txid : (txid?.toString() || `tx_${Date.now()}`);
    
    // If txid is an object that was stringified, use a hash of it as filename
    if (txidStr.startsWith('{') || txidStr.startsWith('[')) {
      // Use a simple hash function to create a safe filename
      const hash = require('crypto').createHash('md5').update(txidStr).digest('hex');
      txidStr = `tx_${hash}`;
      console.log(`Complex txid detected, using hash as ID: ${txidStr}`);
    }
    
    // Log to console
    console.log(`Transaction created: ${type} - ${txidStr}`);
    console.log(`  From: ${fromAddress}`);
    console.log(`  To: ${toAddress}`);
    console.log(`  Amount: ${amount} OVT`);
    console.log(`  Price: ${price} sats per OVT`);
    
    // Could also log to database or file for persistence
    // For now, we'll create a JSON file in a transactions directory
    
    const transactionDir = path.join(__dirname, '..', 'data', 'transactions');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(transactionDir)) {
      fs.mkdirSync(transactionDir, { recursive: true });
    }
    
    // Create a transaction record
    const transaction = {
      txid: txidStr,
      originalTxid: txid, // Store the original txid in case it was complex
      type,
      amount,
      fromAddress,
      toAddress,
      price,
      timestamp: Date.now()
    };
    
    // Write to a JSON file named with the txid
    const filePath = path.join(transactionDir, `${txidStr}.json`);
    fs.writeFileSync(filePath, JSON.stringify(transaction, null, 2));
    
    console.log(`Transaction logged to ${filePath}`);
  } catch (error) {
    console.error(`Error logging transaction: ${error.message}`);
  }
}

/**
 * Gets the currently selected wallet name and information
 * @returns {Promise<Object>} Wallet information
 */
async function getCurrentWalletInfo() {
  try {
    // Execute commands locally using executeOrdCommand
    const balanceResult = await executeOrdCommand('wallet balance');
    const runicsResult = await executeOrdCommand('wallet runics');
    
    let balance = 'N/A';
    if (balanceResult.success) {
      // Try to parse as JSON first - this is the most common format from newer ord versions
      try {
        const jsonData = JSON.parse(balanceResult.result);
        
        // Check if it's an array - newer ord returns an array of outputs
        if (Array.isArray(jsonData)) {
          // Look for the OVT rune in each output
          for (const item of jsonData) {
            if (item.runes && OVT_RUNE_NAME in item.runes) {
              const amount = parseInt(item.runes[OVT_RUNE_NAME]);
              console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${amount}`);
              balance = amount;
            }
          }
        } 
        // Also handle if it's a direct object with runes property (some ord versions)
        else if (jsonData.runes && OVT_RUNE_NAME in jsonData.runes) {
          const amount = parseInt(jsonData.runes[OVT_RUNE_NAME]);
          console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${amount}`);
          balance = amount;
        }
      } catch (jsonError) {
        console.log(`JSON parsing failed: ${jsonError.message}, trying string parsing`);
        
        // If JSON parsing fails, try the original string parsing approach
        const runeBalances = {};
        const balanceLines = balanceResult.result.split('\n');
        
        for (const line of balanceLines) {
          // Try to match the rune name and balance
          // Format is typically "RUNE_NAME: X.XX ⊙"
          const match = line.match(/([^:]+):\s+([0-9.]+)\s+⊙/);
          if (match) {
            const runeName = match[1].trim();
            const amount = parseFloat(match[2]);
            runeBalances[runeName] = amount;
          }
        }
        
        // Check if we have OVT_RUNE_NAME in the balances
        if (OVT_RUNE_NAME in runeBalances) {
          console.log(`Found rune balance for ${OVT_RUNE_NAME}: ${runeBalances[OVT_RUNE_NAME]}`);
          balance = runeBalances[OVT_RUNE_NAME];
        }
      }
    }
    
    return {
      success: true,
      info: {
        raw: runicsResult.result,
        addresses: [],
        name: null
      }
    };
  } catch (error) {
    console.error(`Error getting wallet info: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verifies that we're using the correct wallet for OVT transactions
 * @returns {Promise<boolean>} Whether the wallet is correct
 */
async function verifyWalletForOVT() {
  try {
    // Execute command locally using executeOrdCommand
    const result = await executeOrdCommand('wallet runics');
    
    if (!result.success) {
      return { verified: false, error: `Failed to check wallet: ${result.error}` };
    }

    // Check if OVT_RUNE_NAME exists in the output
    const hasOVT = result.result.includes(OVT_RUNE_NAME);

    return { verified: hasOVT };

  } catch (error) {
    console.error(`Error verifying wallet: ${error.message}`);
    return { verified: false, error: error.message };
  }
}

/**
 * Helper function to broadcast updates internally to the Price API WebSocket service
 * @param {string} type - The message type (e.g., 'TRADE_UPDATE', 'ORDER_BOOK_UPDATE')
 * @param {any} payload - The data payload for the message
 */
async function broadcastInternalUpdate(type, payload) {
  const url = process.env.INTERNAL_BROADCAST_URL || 'http://localhost:3033/api/price/internal/broadcast';
  const secret = process.env.INTERNAL_API_SECRET; // Use the correct env variable name

  if (!url) {
    console.warn('INTERNAL_BROADCAST_URL not set. Skipping WebSocket broadcast.');
    return;
  }
  
  if (!secret) {
    console.warn('INTERNAL_API_SECRET not set. Cannot send authenticated internal broadcast.');
    // Optional: Decide if you want to proceed without auth or stop here
    // return; // Uncomment to stop if secret is mandatory
  }

  try {
    const headers = {};
    if (secret) {
      headers['X-Internal-Secret'] = secret; // Correctly add the header
    }
    console.log(`Broadcasting internal update: ${type} to ${url}`);
    await axios.post(url, { type, payload }, { headers }); // Pass headers correctly
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`Failed to broadcast internal update (${type}):`, errorMessage);
    // Non-fatal error, log and continue
  }
}

module.exports = {
  matchOrders,
  processMatches,
  getOrderbook,
  getOrderbookSync,
  getRecentTrades,
  placeOrder,
  cancelOrder: async () => ({ success: true }), // Stub implementation
  getStats,
  executeBuyOrder,
  transferTokensFromLP,
  validateTransaction, // Export the enhanced validation function
  logTransaction, // Export the transaction logging function
  
  // Export multi-signature helpers
  requiresMultiSignature,
  
  // Export pending order helpers
  storePendingOrder,
  getPendingOrder,
  removePendingOrder,

  // Export confirmation logic
  confirmBuyPayment,
  
  // Export Rune-related functions
  transferRunes,
  getRuneUtxos,
  getRuneBalance,
  verifyRuneTransfer,
  
  // Export wallet verification functions
  getCurrentWalletInfo,
  verifyWalletForOVT
}; 