/**
 * Trading API Routes for OTORI Vision
 * 
 * This module provides trading simulation endpoints for OTORI Vision Token.
 */

const express = require('express');
const router = express.Router();
const tradingService = require('../services/tradingService');
const utxoService = require('../services/utxoService');

/**
 * @route GET /api/trading/orderbook
 * @description Get the current order book
 * @access Public
 */
router.get('/orderbook', (req, res) => {
  try {
    const orderbook = tradingService.getOrderbook();
    
    res.json({
      success: true,
      orderbook,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching orderbook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orderbook'
    });
  }
});

/**
 * @route GET /api/trading/trades
 * @description Get recent trades
 * @access Public
 */
router.get('/trades', (req, res) => {
  try {
    const trades = tradingService.getRecentTrades();
    
    res.json({
      success: true,
      trades,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching recent trades:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent trades'
    });
  }
});

/**
 * @route GET /api/trading/liquidity
 * @description Get current liquidity information
 * @access Public
 */
router.get('/liquidity', (req, res) => {
  const liquidity = {
    ovtLiquidity: 1000000,
    btcLiquidity: 30000000, // 0.3 BTC in sats
    totalValueLocked: 330000000, // 3.3 BTC in sats
    lastUpdate: Date.now()
  };
  
  res.json({
    success: true,
    liquidity,
    timestamp: Date.now()
  });
});

/**
 * @route GET /api/trading/user-trades
 * @description Get trades for a specific user
 * @access Restricted
 */
router.get('/user-trades', (req, res) => {
  const { address } = req.query;
  
  if (!address) {
    return res.status(400).json({
      success: false,
      error: 'Wallet address required'
    });
  }
  
  // Simple mock user trades
  const userTrades = [
    { id: '101', price: 310000, amount: 2000, timestamp: Date.now() - 3600000, type: 'buy', status: 'completed' },
    { id: '102', price: 305000, amount: 1500, timestamp: Date.now() - 7200000, type: 'sell', status: 'completed' }
  ];
  
  res.json({
    success: true,
    userTrades,
    timestamp: Date.now()
  });
});

/**
 * @route POST /api/trading/market-order
 * @description Execute a market order
 * @access Restricted
 */
router.post('/market-order', (req, res) => {
  const { type, amount, address } = req.body;
  
  if (!type || !amount || !address) {
    return res.status(400).json({
      success: false,
      error: 'Type, amount and address are required'
    });
  }
  
  // Simple mock market order execution
  const order = {
    id: `order-${Date.now()}`,
    type,
    amount: parseFloat(amount),
    price: type === 'buy' ? 315000 : 305000, // Slightly worse price for market orders
    status: 'completed',
    timestamp: Date.now(),
    address
  };
  
  res.json({
    success: true,
    order,
    timestamp: Date.now()
  });
});

/**
 * @route POST /api/trading/limit-order
 * @description Place a limit order
 * @access Restricted
 */
router.post('/limit-order', (req, res) => {
  const { type, amount, price, address } = req.body;
  
  if (!type || !amount || !price || !address) {
    return res.status(400).json({
      success: false,
      error: 'Type, amount, price and address are required'
    });
  }
  
  // Simple mock limit order placement
  const order = {
    id: `order-${Date.now()}`,
    type,
    amount: parseFloat(amount),
    price: parseFloat(price),
    status: 'open',
    timestamp: Date.now(),
    address
  };
  
  res.json({
    success: true,
    order,
    timestamp: Date.now()
  });
});

/**
 * @route GET /api/trading/price-impact
 * @description Calculate price impact for a trade
 * @access Public
 */
router.get('/price-impact', (req, res) => {
  const { amount, type } = req.query;
  
  if (!amount || !type) {
    return res.status(400).json({
      success: false,
      error: 'Amount and type (buy/sell) are required'
    });
  }
  
  const amountValue = parseFloat(amount);
  
  // Simple mock price impact calculation
  const basePrice = type === 'buy' ? 310000 : 300000;
  const impact = Math.min(amountValue / 100000, 0.05); // Maximum 5% impact
  const priceWithImpact = type === 'buy' 
    ? basePrice * (1 + impact) 
    : basePrice * (1 - impact);
  
  res.json({
    success: true,
    basePrice,
    priceWithImpact: Math.round(priceWithImpact),
    priceImpact: `${(impact * 100).toFixed(2)}%`,
    timestamp: Date.now()
  });
});

/**
 * @route GET /api/trading/utxo-stats
 * @description Get UTXO management statistics and status
 * @access Restricted
 */
router.get('/utxo-stats', (req, res) => {
  try {
    // Get UTXO service statistics
    const stats = utxoService.getStats();
    
    res.json({
      success: true,
      stats,
      config: {
        smallUtxoThreshold: utxoService.SMALL_UTXO_THRESHOLD,
        dustLimit: utxoService.DUST_LIMIT
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error getting UTXO statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get UTXO statistics'
    });
  }
});

/**
 * @route POST /api/trading/reset-utxo-stats
 * @description Reset UTXO management statistics
 * @access Admin
 */
router.post('/reset-utxo-stats', (req, res) => {
  try {
    // Reset UTXO service statistics
    utxoService.resetStats();
    
    res.json({
      success: true,
      message: 'UTXO statistics reset successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error resetting UTXO statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset UTXO statistics'
    });
  }
});

/**
 * @route GET /api/trading/validation-stats
 * @description Get transaction validation statistics
 * @access Admin
 */
router.get('/validation-stats', (req, res) => {
  try {
    // Define a metrics object to track validation statistics
    // This would normally be stored in a database or persistent storage
    const validationStats = {
      // Basic transaction metrics
      transactionsProcessed: 0,
      transactionsValidated: 0,
      transactionsRejected: 0,
      
      // UTXO validation metrics
      utxosValidated: utxoService.getStats().totalQueriesCount || 0,
      utxosOptimized: utxoService.getStats().optimizationCount || 0,
      
      // Fee statistics
      averageFeeRate: 2, // Example value in sats/byte
      totalFeesCollected: 0, // Example value in sats
      
      // Transaction types
      buyTransactions: 0,
      sellTransactions: 0,
      transferTransactions: 0,
      
      // Validation failures by type
      invalidSignatureCount: 0,
      insufficientFundsCount: 0,
      invalidUtxoCount: 0,
      
      // Time-based metrics
      averageValidationTimeMs: 120, // Example value
      
      // Status
      lastUpdated: Date.now()
    };
    
    // In a real implementation, we would load these statistics from a database
    
    res.json({
      success: true,
      stats: validationStats,
      utxoStats: utxoService.getStats(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error getting validation statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get validation statistics'
    });
  }
});

module.exports = router; 