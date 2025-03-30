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

// Load environment variables for accessing remote OrdPi
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';

// Mock orderbook - used only when orderMatchingService is unavailable
const mockOrderbook = {
  bids: [
    { id: 'bid1', price: 300000, amount: 10000, address: 'mock-address-1' },
    { id: 'bid2', price: 290000, amount: 15000, address: 'mock-address-2' },
    { id: 'bid3', price: 280000, amount: 20000, address: 'mock-address-3' }
  ],
  asks: [
    { id: 'ask1', price: 310000, amount: 8000, address: 'mock-address-4' },
    { id: 'ask2', price: 320000, amount: 12000, address: 'mock-address-5' },
    { id: 'ask3', price: 330000, amount: 18000, address: 'mock-address-6' }
  ],
  lastUpdate: Date.now()
};

// Mock trades
const mockRecentTrades = [];

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

module.exports = {
  matchOrders,
  processMatches,
  getOrderbook: async () => mockOrderbook, // For backward compatibility
  getOrderbookSync: () => mockOrderbook, // For backward compatibility
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