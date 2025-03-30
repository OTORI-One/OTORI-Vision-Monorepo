/**
 * Order Matching Service for OTORI Vision
 * 
 * This service manages an off-chain order book and matches orders before on-chain execution.
 * It reduces the number of transactions needed for trading activity by batching compatible trades.
 */

const fs = require('fs').promises;
const path = require('path');
const { createHash } = require('crypto');

// Rate limiter for API calls and order processing
class RateLimiter {
  constructor(maxCalls = 10, timeWindowMs = 1000) {
    this.maxCalls = maxCalls;
    this.timeWindowMs = timeWindowMs;
    this.calls = [];
  }
  
  async limit() {
    // Clean up old calls
    const now = Date.now();
    this.calls = this.calls.filter(time => now - time < this.timeWindowMs);
    
    // If at limit, wait until a slot opens
    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0];
      const waitTime = this.timeWindowMs - (now - oldestCall);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.limit(); // Recursively check again after waiting
    }
    
    // Record this call
    this.calls.push(now);
  }
}

// Order status enum
const OrderStatus = {
  PENDING: 'pending',
  OPEN: 'open',
  PARTIAL: 'partial',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  REJECTED: 'rejected'
};

// Match status enum
const MatchStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  EXECUTED: 'executed',
  FAILED: 'failed'
};

class OrderMatchingService {
  constructor(options = {}) {
    // Configuration
    this.config = {
      dataDir: options.dataDir || path.join(process.cwd(), 'data/orderbook'),
      journalPath: options.journalPath || path.join(process.cwd(), 'data/orderbook/transaction_journal.json'),
      matchingInterval: options.matchingInterval || 30000, // 30 seconds
      expirationTime: options.expirationTime || 24 * 60 * 60 * 1000, // 24 hours
      minOrderSize: options.minOrderSize || 1000, // Minimum order size in sats
      maxSlippage: options.maxSlippage || 0.05, // 5% max slippage
      maxBatchSize: options.maxBatchSize || 10, // Max orders to process in one batch
    };
    
    // Internal state
    this.buyOrders = []; // Orders to buy OVT with BTC
    this.sellOrders = []; // Orders to sell OVT for BTC
    this.matches = []; // Matched orders
    this.matchingInterval = null;
    this.isInitialized = false;
    this.journal = {
      entries: [],
      loaded: false
    };
    
    // Rate limiters
    this.apiRateLimiter = new RateLimiter(5, 1000); // 5 calls per second
    this.matchingRateLimiter = new RateLimiter(2, 1000); // 2 matching processes per second
    
    // Bind methods
    this.addBuyOrder = this.addBuyOrder.bind(this);
    this.addSellOrder = this.addSellOrder.bind(this);
    this.matchOrders = this.matchOrders.bind(this);
    this.startMatching = this.startMatching.bind(this);
    this.stopMatching = this.stopMatching.bind(this);
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // Load transaction journal
      await this.loadJournal();
      
      // Load any persisted orders
      await this.loadOrders();
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize OrderMatchingService:', error);
      return false;
    }
  }
  
  /**
   * Load transaction journal
   */
  async loadJournal() {
    try {
      const data = await fs.readFile(this.config.journalPath, 'utf8');
      this.journal.entries = JSON.parse(data);
    } catch (error) {
      // If file doesn't exist or is invalid, start with empty journal
      this.journal.entries = [];
    }
    this.journal.loaded = true;
  }
  
  /**
   * Save transaction journal
   */
  async saveJournal() {
    await fs.writeFile(
      this.config.journalPath, 
      JSON.stringify(this.journal.entries, null, 2)
    );
  }
  
  /**
   * Add journal entry
   */
  async addJournalEntry(entry) {
    if (!this.journal.loaded) await this.loadJournal();
    
    this.journal.entries.push({
      ...entry,
      timestamp: Date.now()
    });
    
    await this.saveJournal();
  }
  
  /**
   * Load persisted orders
   */
  async loadOrders() {
    try {
      const buyOrdersPath = path.join(this.config.dataDir, 'buy_orders.json');
      const sellOrdersPath = path.join(this.config.dataDir, 'sell_orders.json');
      
      try {
        const buyOrdersData = await fs.readFile(buyOrdersPath, 'utf8');
        this.buyOrders = JSON.parse(buyOrdersData);
      } catch (error) {
        this.buyOrders = [];
      }
      
      try {
        const sellOrdersData = await fs.readFile(sellOrdersPath, 'utf8');
        this.sellOrders = JSON.parse(sellOrdersData);
      } catch (error) {
        this.sellOrders = [];
      }
      
      // Filter out expired orders
      const now = Date.now();
      this.buyOrders = this.buyOrders.filter(order => 
        order.timestamp + this.config.expirationTime > now && 
        order.status !== OrderStatus.FULFILLED &&
        order.status !== OrderStatus.CANCELLED
      );
      
      this.sellOrders = this.sellOrders.filter(order => 
        order.timestamp + this.config.expirationTime > now &&
        order.status !== OrderStatus.FULFILLED &&
        order.status !== OrderStatus.CANCELLED
      );
      
      // Sort orders
      this.sortOrders();
    } catch (error) {
      console.error('Error loading orders:', error);
      this.buyOrders = [];
      this.sellOrders = [];
    }
  }
  
  /**
   * Save orders to disk
   */
  async saveOrders() {
    try {
      const buyOrdersPath = path.join(this.config.dataDir, 'buy_orders.json');
      const sellOrdersPath = path.join(this.config.dataDir, 'sell_orders.json');
      
      await fs.writeFile(buyOrdersPath, JSON.stringify(this.buyOrders, null, 2));
      await fs.writeFile(sellOrdersPath, JSON.stringify(this.sellOrders, null, 2));
    } catch (error) {
      console.error('Error saving orders:', error);
    }
  }
  
  /**
   * Validate order parameters
   */
  validateOrder(order) {
    // Required fields
    if (!order.price || typeof order.price !== 'number' || order.price <= 0) {
      throw new Error('Invalid price');
    }
    
    if (!order.amount || typeof order.amount !== 'number' || order.amount <= 0) {
      throw new Error('Invalid amount');
    }
    
    if (order.amount < this.config.minOrderSize) {
      throw new Error(`Order amount below minimum (${this.config.minOrderSize} sats)`);
    }
    
    if (!order.address || typeof order.address !== 'string') {
      throw new Error('Invalid address');
    }
    
    // Validate Bitcoin address format (basic check)
    if (!order.address.startsWith('tb1') && !order.address.startsWith('bc1') && 
        !order.address.startsWith('1') && !order.address.startsWith('3')) {
      throw new Error('Invalid Bitcoin address format');
    }
    
    return true;
  }
  
  /**
   * Generate order ID
   */
  generateOrderId(order) {
    const input = `${order.address}:${order.amount}:${order.price}:${Date.now()}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }
  
  /**
   * Add new buy order
   */
  async addBuyOrder(order) {
    await this.apiRateLimiter.limit();
    
    try {
      // Initialize if needed
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      // Validate order
      this.validateOrder(order);
      
      // Create new order object
      const newOrder = {
        id: this.generateOrderId(order),
        type: 'buy',
        price: order.price,
        amount: order.amount,
        filled: 0,
        remaining: order.amount,
        address: order.address,
        timestamp: Date.now(),
        status: OrderStatus.OPEN,
        executions: []
      };
      
      // Add to buy orders
      this.buyOrders.push(newOrder);
      
      // Sort orders
      this.sortOrders();
      
      // Save to disk
      await this.saveOrders();
      
      // Add journal entry
      await this.addJournalEntry({
        type: 'order_created',
        order: newOrder
      });
      
      return newOrder;
    } catch (error) {
      console.error('Error adding buy order:', error);
      throw error;
    }
  }
  
  /**
   * Add new sell order
   */
  async addSellOrder(order) {
    await this.apiRateLimiter.limit();
    
    try {
      // Initialize if needed
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      // Validate order
      this.validateOrder(order);
      
      // Create new order object
      const newOrder = {
        id: this.generateOrderId(order),
        type: 'sell',
        price: order.price,
        amount: order.amount,
        filled: 0,
        remaining: order.amount,
        address: order.address,
        timestamp: Date.now(),
        status: OrderStatus.OPEN,
        executions: []
      };
      
      // Add to sell orders
      this.sellOrders.push(newOrder);
      
      // Sort orders
      this.sortOrders();
      
      // Save to disk
      await this.saveOrders();
      
      // Add journal entry
      await this.addJournalEntry({
        type: 'order_created',
        order: newOrder
      });
      
      return newOrder;
    } catch (error) {
      console.error('Error adding sell order:', error);
      throw error;
    }
  }
  
  /**
   * Sort orders by price
   * Buy: highest first
   * Sell: lowest first
   */
  sortOrders() {
    this.buyOrders.sort((a, b) => b.price - a.price);
    this.sellOrders.sort((a, b) => a.price - b.price);
  }
  
  /**
   * Update order status
   */
  async updateOrderStatus(orderId, status, additionalData = {}) {
    const order = this.findOrderById(orderId);
    
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    // Update status
    order.status = status;
    
    // Add additional data
    Object.keys(additionalData).forEach(key => {
      order[key] = additionalData[key];
    });
    
    // Save changes
    await this.saveOrders();
    
    // Add journal entry
    await this.addJournalEntry({
      type: 'order_updated',
      orderId,
      status,
      additionalData
    });
    
    return order;
  }
  
  /**
   * Find order by ID
   */
  findOrderById(orderId) {
    return this.buyOrders.find(o => o.id === orderId) || 
           this.sellOrders.find(o => o.id === orderId);
  }
  
  /**
   * Get the current orderbook
   */
  getOrderbook() {
    return {
      bids: this.buyOrders.filter(o => 
        o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIAL
      ),
      asks: this.sellOrders.filter(o => 
        o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIAL
      ),
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Get user's orders
   */
  getUserOrders(address) {
    if (!address) {
      throw new Error('Address is required');
    }
    
    const buyOrders = this.buyOrders.filter(o => o.address === address);
    const sellOrders = this.sellOrders.filter(o => o.address === address);
    
    return { buyOrders, sellOrders };
  }
  
  /**
   * Match compatible orders
   */
  async matchOrders() {
    await this.matchingRateLimiter.limit();
    
    try {
      // Initialize if needed
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      const matches = [];
      let i = 0, j = 0;
      
      // Filter only open and partial orders
      const activeBuyOrders = this.buyOrders.filter(o => 
        o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIAL
      );
      
      const activeSellOrders = this.sellOrders.filter(o => 
        o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIAL
      );
      
      // Sort by price
      activeBuyOrders.sort((a, b) => b.price - a.price);
      activeSellOrders.sort((a, b) => a.price - b.price);
      
      while (i < activeBuyOrders.length && j < activeSellOrders.length) {
        const buyOrder = activeBuyOrders[i];
        const sellOrder = activeSellOrders[j];
        
        // Check if orders can be matched (buy price >= sell price)
        if (buyOrder.price >= sellOrder.price) {
          // Calculate execution price (midpoint)
          const executionPrice = Math.floor((buyOrder.price + sellOrder.price) / 2);
          
          // Calculate matched amount
          const matchedAmount = Math.min(buyOrder.remaining, sellOrder.remaining);
          
          // Create match record
          const match = {
            id: `match-${Date.now()}-${matches.length}`,
            buyOrderId: buyOrder.id,
            sellOrderId: sellOrder.id,
            amount: matchedAmount,
            price: executionPrice,
            timestamp: Date.now(),
            status: MatchStatus.PENDING,
            buyerAddress: buyOrder.address,
            sellerAddress: sellOrder.address
          };
          
          matches.push(match);
          
          // Update the orders
          buyOrder.filled += matchedAmount;
          buyOrder.remaining -= matchedAmount;
          buyOrder.executions.push({
            matchId: match.id,
            amount: matchedAmount,
            price: executionPrice,
            timestamp: Date.now()
          });
          
          sellOrder.filled += matchedAmount;
          sellOrder.remaining -= matchedAmount;
          sellOrder.executions.push({
            matchId: match.id,
            amount: matchedAmount,
            price: executionPrice,
            timestamp: Date.now()
          });
          
          // Update order status
          if (buyOrder.remaining === 0) {
            buyOrder.status = OrderStatus.FULFILLED;
            i++;
          } else {
            buyOrder.status = OrderStatus.PARTIAL;
          }
          
          if (sellOrder.remaining === 0) {
            sellOrder.status = OrderStatus.FULFILLED;
            j++;
          } else {
            sellOrder.status = OrderStatus.PARTIAL;
          }
        } else {
          // No more matches possible with current orders
          break;
        }
      }
      
      // Save all matches
      this.matches = [...this.matches, ...matches];
      
      // Save changes to orders
      await this.saveOrders();
      
      // Add journal entry for matches
      if (matches.length > 0) {
        await this.addJournalEntry({
          type: 'matches_created',
          matchCount: matches.length,
          matches: matches.map(m => m.id)
        });
      }
      
      return matches;
    } catch (error) {
      console.error('Error matching orders:', error);
      
      await this.addJournalEntry({
        type: 'error',
        context: 'matchOrders',
        message: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
  
  /**
   * Process matches into execution batches
   * Groups trades to minimize on-chain transactions
   */
  async processMatches() {
    try {
      // Get pending matches
      const pendingMatches = this.matches.filter(m => m.status === MatchStatus.PENDING);
      
      if (pendingMatches.length === 0) {
        return [];
      }
      
      // Group by buyer/seller pairs to minimize transactions
      const pairGroups = {};
      
      pendingMatches.forEach(match => {
        const pairKey = `${match.buyerAddress}-${match.sellerAddress}`;
        
        if (!pairGroups[pairKey]) {
          pairGroups[pairKey] = [];
        }
        
        pairGroups[pairKey].push(match);
      });
      
      // Generate execution batches
      const executionBatches = [];
      
      for (const pairKey of Object.keys(pairGroups)) {
        const matches = pairGroups[pairKey];
        const [buyerAddress, sellerAddress] = pairKey.split('-');
        
        // Split into batches of maxBatchSize
        for (let i = 0; i < matches.length; i += this.config.maxBatchSize) {
          const batchMatches = matches.slice(i, i + this.config.maxBatchSize);
          
          // Calculate total amounts for this batch
          const totalAmount = batchMatches.reduce((sum, m) => sum + m.amount, 0);
          const weightedPrice = Math.floor(
            batchMatches.reduce((sum, m) => sum + (m.price * m.amount), 0) / totalAmount
          );
          
          executionBatches.push({
            id: `batch-${Date.now()}-${executionBatches.length}`,
            matches: batchMatches.map(m => m.id),
            buyerAddress,
            sellerAddress,
            totalAmount,
            price: weightedPrice,
            timestamp: Date.now(),
            status: 'pending'
          });
        }
      }
      
      // Add journal entry for batches
      if (executionBatches.length > 0) {
        await this.addJournalEntry({
          type: 'execution_batches_created',
          batchCount: executionBatches.length,
          batches: executionBatches.map(b => b.id)
        });
      }
      
      return executionBatches;
    } catch (error) {
      console.error('Error processing matches:', error);
      
      await this.addJournalEntry({
        type: 'error',
        context: 'processMatches',
        message: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
  
  /**
   * Start automatic matching process
   */
  startMatching(intervalMs = null) {
    if (this.matchingInterval) return;
    
    const interval = intervalMs || this.config.matchingInterval;
    
    this.matchingInterval = setInterval(async () => {
      try {
        const matches = await this.matchOrders();
        
        if (matches.length > 0) {
          console.log(`Matched ${matches.length} orders`);
          const batches = await this.processMatches();
          console.log(`Created ${batches.length} execution batches`);
        }
      } catch (error) {
        console.error('Error in automatic matching:', error);
      }
    }, interval);
    
    return true;
  }
  
  /**
   * Stop automatic matching
   */
  stopMatching() {
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
      this.matchingInterval = null;
    }
    
    return true;
  }
  
  /**
   * Get service statistics
   */
  getStats() {
    return {
      buyOrderCount: this.buyOrders.length,
      sellOrderCount: this.sellOrders.length,
      matchCount: this.matches.length,
      pendingMatchCount: this.matches.filter(m => m.status === MatchStatus.PENDING).length,
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Clean up expired orders
   */
  async cleanupExpiredOrders() {
    const now = Date.now();
    const expirationCutoff = now - this.config.expirationTime;
    
    // Find expired orders
    const expiredBuyOrders = this.buyOrders.filter(o => 
      o.timestamp < expirationCutoff && 
      o.status !== OrderStatus.FULFILLED &&
      o.status !== OrderStatus.CANCELLED
    );
    
    const expiredSellOrders = this.sellOrders.filter(o => 
      o.timestamp < expirationCutoff &&
      o.status !== OrderStatus.FULFILLED &&
      o.status !== OrderStatus.CANCELLED
    );
    
    // Mark them as expired
    for (const order of [...expiredBuyOrders, ...expiredSellOrders]) {
      order.status = OrderStatus.EXPIRED;
    }
    
    // Save changes
    if (expiredBuyOrders.length > 0 || expiredSellOrders.length > 0) {
      await this.saveOrders();
      
      await this.addJournalEntry({
        type: 'orders_expired',
        buyOrderCount: expiredBuyOrders.length,
        sellOrderCount: expiredSellOrders.length
      });
      
      return expiredBuyOrders.length + expiredSellOrders.length;
    }
    
    return 0;
  }
}

// Create singleton instance
const orderMatchingService = new OrderMatchingService();

// Initialize on module load
(async () => {
  try {
    await orderMatchingService.initialize();
    orderMatchingService.startMatching();
    console.log('OrderMatchingService initialized and automatic matching started');
    
    // Set up periodic cleanup of expired orders
    setInterval(async () => {
      try {
        const expiredCount = await orderMatchingService.cleanupExpiredOrders();
        if (expiredCount > 0) {
          console.log(`Cleaned up ${expiredCount} expired orders`);
        }
      } catch (error) {
        console.error('Error cleaning up expired orders:', error);
      }
    }, 3600000); // Check every hour
  } catch (error) {
    console.error('Failed to initialize OrderMatchingService:', error);
  }
})();

module.exports = orderMatchingService; 