/**
 * Price API Routes for OTORI Vision
 * 
 * This module exposes endpoints for fetching centralized price data
 * for OVT and portfolio positions across all clients.
 */

const express = require('express');
const router = express.Router();
const priceService = require('../services/priceService');

// Initialize price service when routes are loaded
priceService.initialize();

// Middleware for securing internal endpoints
const secureInternalEndpoint = (req, res, next) => {
  // const internalSecret = process.env.INTERNAL_WS_SECRET;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const requestSecret = req.headers['x-internal-secret'];

  // --- Added Detailed Logging START ---
  console.log(`[Internal Auth] Checking request from IP: ${req.ip}`);
  console.log(`[Internal Auth] Expected Secret (from env): ${internalSecret ? '*****' : 'MISSING'}`); // Avoid logging the actual secret
  console.log(`[Internal Auth] Received Secret (from header): ${requestSecret ? '*****' : 'MISSING'}`);
  // --- Added Detailed Logging END ---

  // Check if the secret is missing or doesn't match
  if (!internalSecret || requestSecret !== internalSecret) {
    // --- Modified Logging START ---
    console.warn(`[Internal Auth] Unauthorized attempt from IP: ${req.ip}. Expected: ${internalSecret ? 'Present' : 'MISSING'}, Received: ${requestSecret ? 'Present' : 'MISSING'}`);
    // --- Modified Logging END ---
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  console.log(`[Internal Auth] Access granted for IP: ${req.ip}`); // Log success
  next();
};

// Add rate limiting middleware
const rateLimitMiddleware = (endpoint) => (req, res, next) => {
  // Get client IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  
  // Check if this request is allowed
  if (priceService.requestTracker.isAllowed(ip, endpoint)) {
    // Track the request
    priceService.requestTracker.trackRequest(ip, endpoint);
    next();
  } else {
    // Too many requests - send 429 response
    console.warn(`Rate limit exceeded for ${ip} on ${endpoint}`);
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please try again later.'
    });
  }
};

/**
 * @route GET /api/price/portfolio
 * @description Get all portfolio positions with current prices
 * @access Public
 */
router.get('/portfolio', (req, res) => {
  try {
    const positions = priceService.getAllPositions();
    res.json({
      success: true,
      positions,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching portfolio positions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio positions'
    });
  }
});

/**
 * @route GET /api/price/ovt
 * @description Get current OVT price data
 * @access Public
 */
router.get('/ovt', rateLimitMiddleware('ovt'), (req, res) => {
  try {
    const ovtPrice = priceService.getOVTPrice();
    res.json({
      success: true,
      ...ovtPrice,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching OVT price:', error);
    
    // Track the error for exponential backoff
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    priceService.requestTracker.trackError(ip, 'ovt');
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch OVT price data'
    });
  }
});

/**
 * @route GET /api/price/bitcoin
 * @description Get current Bitcoin price
 * @access Public
 */
router.get('/bitcoin', rateLimitMiddleware('bitcoin'), (req, res) => {
  try {
    const bitcoinPrice = priceService.getBitcoinPrice();
    res.json({
      success: true,
      ...bitcoinPrice,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    
    // Track the error for exponential backoff
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    priceService.requestTracker.trackError(ip, 'bitcoin');
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Bitcoin price data'
    });
  }
});

/**
 * @route GET /api/price/history/:positionName
 * @description Get price history for a specific position
 * @access Public
 */
router.get('/history/:positionName', (req, res) => {
  try {
    const { positionName } = req.params;
    const { timeframe = 'daily' } = req.query;
    
    // Validate timeframe
    if (!['daily', 'hourly'].includes(timeframe)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timeframe. Use "daily" or "hourly".'
      });
    }
    
    const history = priceService.getPriceHistory(positionName, timeframe);
    res.json({
      success: true,
      positionName,
      timeframe,
      history,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch price history'
    });
  }
});

/**
 * @route GET /api/price/nav
 * @description Get NAV data including total value and changes
 * @access Public
 */
router.get('/nav', rateLimitMiddleware('nav'), (req, res) => {
  try {
    const navData = priceService.getNAVData();
    res.json({
      success: true,
      ...navData,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching NAV data:', error);
    
    // Track the error for exponential backoff
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    priceService.requestTracker.trackError(ip, 'nav');
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch NAV data'
    });
  }
});

/**
 * @route POST /api/price/update
 * @description Trigger a manual price update (admin only, should be restricted in production)
 * @access Restricted
 */
router.post('/update', (req, res) => {
  try {
    // In production, add authentication middleware and restrict this endpoint
    // For now, allow manual updates for development
    priceService.updatePrices()
      .then(success => {
        if (success) {
          res.json({
            success: true,
            message: 'Price data updated successfully',
            timestamp: Date.now()
          });
        } else {
          throw new Error('Price update failed');
        }
      })
      .catch(error => {
        throw error;
      });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update prices'
    });
  }
});

/**
 * @route POST /api/price/update-ovt-supply
 * @description Trigger a manual update of OVT circulating supply (admin only)
 * @access Restricted
 */
router.post('/update-ovt-supply', (req, res) => {
  try {
    // In production, add authentication middleware and restrict this endpoint
    // For now, allow manual updates for development
    priceService.updateOVTCirculatingSupply()
      .then(success => {
        if (success) {
          res.json({
            success: true,
            message: 'OVT circulating supply updated successfully',
            timestamp: Date.now(),
            circulatingSupply: priceService.getOVTPrice().circulatingSupply
          });
        } else {
          res.json({
            success: true,
            message: 'OVT circulating supply update attempted but no changes made',
            timestamp: Date.now(),
            circulatingSupply: priceService.getOVTPrice().circulatingSupply
          });
        }
      })
      .catch(error => {
        throw error;
      });
  } catch (error) {
    console.error('Error updating OVT circulating supply:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update OVT circulating supply'
    });
  }
});

/**
 * @route POST /api/price/update-ovt
 * @description Recalculate OVT price immediately (admin only, should be restricted in production)
 * @access Restricted
 */
router.post('/update-ovt', (req, res) => {
  try {
    // In production, add authentication middleware and restrict this endpoint
    const newPrice = priceService.calculateOVTPrice();
    
    // Update OVT price history
    priceService.updatePriceHistory('ovt', newPrice);
    
    // Save the updated data
    priceService.savePriceData();
    
    res.json({
      success: true,
      message: 'OVT price updated successfully',
      newPrice,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error updating OVT price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update OVT price'
    });
  }
});

/**
 * @route POST /api/price/internal/broadcast
 * @description Internal endpoint for other backend services to trigger WebSocket broadcasts.
 * @access Internal (Protected by shared secret)
 */
router.post('/internal/broadcast', secureInternalEndpoint, (req, res) => {
  try {
    const { type, payload } = req.body;

    // Basic validation
    if (!type || typeof type !== 'string' || !payload) {
      console.warn('Invalid broadcast request received:', req.body);
      return res.status(400).json({ success: false, error: 'Invalid request body. Requires "type" (string) and "payload".' });
    }

    // Call the priceService to broadcast the update
    priceService.broadcastUpdate(type, payload);

    // Respond immediately, the broadcast is asynchronous
    res.status(202).json({ success: true, message: 'Broadcast request accepted' });

  } catch (error) {
    console.error('Error processing internal broadcast request:', error);
    res.status(500).json({ success: false, error: 'Internal server error processing broadcast request' });
  }
});

module.exports = router; 