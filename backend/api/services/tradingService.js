/**
 * Trading Service for OTORI Vision
 * 
 * This service handles trading operations, order matching, and liquidity management.
 */

const orderMatchingService = require('./orderMatchingService');

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
 * Get the current orderbook
 * @returns {Promise<Object>} Current orderbook
 */
async function getOrderbook() {
  return withFallback(
    async () => orderMatchingService.getOrderbook(),
    mockOrderbook // Mock orderbook as fallback
  );
}

/**
 * Get the current orderbook (synchronous version for backward compatibility)
 * @deprecated Use the async getOrderbook() instead
 * @returns {Object} Current orderbook
 */
function getOrderbookSync() {
  if (orderMatchingServiceActive) {
    try {
      return orderMatchingService.getOrderbook();
    } catch (error) {
      console.error('Error getting orderbook, using mock data:', error);
      return mockOrderbook;
    }
  }
  return mockOrderbook;
}

/**
 * Get recent trades
 * @returns {Promise<Array>} Recent trades
 */
async function getRecentTrades() {
  return withFallback(
    async () => {
      // Extract recent trades from matches
      const matches = orderMatchingService.matches || [];
      return matches
        .filter(m => m.status === 'executed' || m.status === 'confirmed')
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50); // Last 50 trades
    },
    mockRecentTrades // Mock trades as fallback
  );
}

/**
 * Place a new order
 * @param {Object} order Order details
 * @returns {Promise<Object>} Placed order
 */
async function placeOrder(order) {
  const { type, price, amount, address } = order;
  
  if (!type || !price || !amount || !address) {
    throw new Error('Invalid order parameters');
  }
  
  if (type !== 'buy' && type !== 'sell') {
    throw new Error('Invalid order type, must be "buy" or "sell"');
  }
  
  return withFallback(
    async () => {
      // Place order with order matching service
      if (type === 'buy') {
        return await orderMatchingService.addBuyOrder({ price, amount, address });
      } else {
        return await orderMatchingService.addSellOrder({ price, amount, address });
      }
    },
    // Fallback to mock implementation
    {
      id: `order-${Date.now()}`,
      type,
      price,
      amount,
      address,
      status: 'open',
      timestamp: Date.now()
    }
  );
}

/**
 * Get a user's orders
 * @param {string} address User's wallet address
 * @returns {Promise<Array>} User's orders
 */
async function getUserOrders(address) {
  if (!address) {
    throw new Error('Address is required');
  }
  
  return withFallback(
    async () => {
      const orders = await orderMatchingService.getUserOrders(address);
      return [...orders.buyOrders, ...orders.sellOrders];
    },
    // Fallback to mock implementation
    [
      {
        id: `mock-buy-${Date.now()}`,
        type: 'buy',
        price: 300000,
        amount: 5000,
        address,
        status: 'open',
        timestamp: Date.now() - 3600000
      },
      {
        id: `mock-sell-${Date.now()}`,
        type: 'sell',
        price: 320000,
        amount: 3000,
        address,
        status: 'open',
        timestamp: Date.now() - 7200000
      }
    ]
  );
}

/**
 * Cancel an open order
 * @param {string} orderId Order ID to cancel
 * @param {string} address User's wallet address (for verification)
 * @returns {Promise<Object>} Cancelled order
 */
async function cancelOrder(orderId, address) {
  if (!orderId) {
    throw new Error('Order ID is required');
  }
  
  if (!address) {
    throw new Error('Address is required for verification');
  }
  
  return withFallback(
    async () => {
      // Find the order
      const order = orderMatchingService.findOrderById(orderId);
      
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      
      // Verify ownership
      if (order.address !== address) {
        throw new Error('Unauthorized: You can only cancel your own orders');
      }
      
      // Only open or partial orders can be cancelled
      if (order.status !== 'open' && order.status !== 'partial') {
        throw new Error(`Cannot cancel order with status: ${order.status}`);
      }
      
      // Update order status
      return await orderMatchingService.updateOrderStatus(orderId, 'cancelled');
    },
    // Fallback to mock implementation
    {
      id: orderId,
      status: 'cancelled',
      message: 'Order cancelled (mock mode)'
    }
  );
}

/**
 * Get trading service statistics
 * @returns {Promise<Object>} Service statistics
 */
async function getStats() {
  return withFallback(
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
}

module.exports = {
  matchOrders,
  processMatches,
  getOrderbook,
  getOrderbookSync, // For backward compatibility
  getRecentTrades,
  placeOrder,
  getUserOrders,
  cancelOrder,
  getStats
}; 