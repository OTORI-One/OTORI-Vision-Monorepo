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
router.get('/ovt', (req, res) => {
  try {
    const ovtPrice = priceService.getOVTPrice();
    res.json({
      success: true,
      ...ovtPrice,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching OVT price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch OVT price'
    });
  }
});

/**
 * @route GET /api/price/bitcoin
 * @description Get current Bitcoin price
 * @access Public
 */
router.get('/bitcoin', (req, res) => {
  try {
    const bitcoinPrice = priceService.getBitcoinPrice();
    res.json({
      success: true,
      ...bitcoinPrice,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Bitcoin price'
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
router.get('/nav', (req, res) => {
  try {
    const navData = priceService.getNAVData();
    res.json({
      success: true,
      ...navData,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching NAV data:', error);
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

module.exports = router; 