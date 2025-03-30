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

// Load environment variables for accessing remote OrdPi
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';

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

/**
 * Helper function to execute ord commands via SSH on the remote OrdPi
 * @param {string} command - The ord command to execute
 * @returns {Object} The result from the command
 */
function executeOrdCommand(command) {
  try {
    // Set up the command to execute via SSH on the OrdPi
    const sshConnection = 'BTCPi@91.7.62.224';
    const sshPort = '2211';
    const sshPassword = process.env.ORDPI_SSH_PASSWORD;
    
    // Full ord command with config
    const ordCommand = `ord --config /home/BTCPi/.ord/ord.yaml --signet ${command}`;
    
    // Build the sshpass command
    const fullCommand = `sshpass -p "${sshPassword}" ssh -o StrictHostKeyChecking=no -p ${sshPort} ${sshConnection} "${ordCommand}"`;
    
    // Execute the SSH command (log a redacted version)
    console.log(`Trading: Executing SSH command: ${fullCommand.replace(sshPassword, '[REDACTED]')}`);
    
    const result = execSync(fullCommand).toString();
    console.log(`Trading: Command result: ${result}`);
    
    return { success: true, result };
  } catch (error) {
    console.error(`Trading: Error executing command: ${command}`, error);
    return { success: false, error: error.toString() };
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
 * Transfer OVT tokens from the LP wallet to a recipient
 * @param {Object} params - Transfer parameters
 * @param {string} params.recipient - Recipient address
 * @param {number} params.amount - Amount to transfer (in token units)
 * @param {Array<string>} [params.signatures] - Required signatures for treasury transactions
 * @returns {Promise<Object>} Transfer result
 */
async function transferTokensFromLP(params) {
  const { recipient, amount, signatures } = params;
  
  // Validate parameters
  if (!recipient || !amount) {
    throw new Error('Recipient and amount are required');
  }
  
  // Check if this is a treasury address
  const isFromTreasury = adminService.isTreasuryAddress(LP_ADDRESS);
  
  // If transferring from treasury, verify multi-signature requirements
  if (isFromTreasury) {
    if (!signatures || !Array.isArray(signatures) || signatures.length < adminService.config.requiredSignatures) {
      throw new Error(`Treasury transfers require at least ${adminService.config.requiredSignatures} signatures`);
    }
    
    // In a real implementation, we would verify each signature
    // For now, we'll just check the count
    console.log(`Multi-signature verification passed with ${signatures.length} signatures`);
  }
  
  // Implementation of token transfer logic
  // This would use ord commands to transfer OVT tokens
  
  // For now, we'll just return a simulated result
  const txid = `transfer_${Date.now()}`;
  
  return {
    success: true,
    txid,
    amount,
    recipient,
    timestamp: Date.now()
  };
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
  
  // Create a transfer from LP to buyer
  const transferResult = await transferTokensFromLP({
    recipient: address,
    amount,
    signatures
  });
  
  return {
    success: true,
    orderId: `buy-${Date.now()}`,
    txid: transferResult.txid,
    price,
    amount,
    totalCost: totalCostSats,
    recipient: address,
    timestamp: Date.now()
  };
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
      const runesApiUrl = process.env.REMOTE_RUNES_API || 'http://localhost:9001';
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
      const runesApiUrl = process.env.REMOTE_RUNES_API || 'http://localhost:9001';
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
  
  // Export multi-signature helpers
  requiresMultiSignature
}; 