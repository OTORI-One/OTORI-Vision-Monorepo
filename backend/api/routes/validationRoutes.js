/**
 * Transaction Validation Routes for OTORI Vision
 * 
 * This module provides API endpoints for transaction validation and statistics.
 */

const express = require('express');
const router = express.Router();
const validationService = require('../services/transactionValidationService');

/**
 * @route GET /api/validation/stats
 * @description Get transaction validation statistics
 * @access Public
 */
router.get('/stats', (req, res) => {
  try {
    const reset = req.query.reset === 'true';
    const stats = validationService.getValidationStats(reset);
    
    res.json({
      success: true,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching validation stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch validation statistics'
    });
  }
});

/**
 * @route GET /api/validation/report
 * @description Get validation report for a specific period
 * @access Public
 */
router.get('/report', async (req, res) => {
  try {
    const period = req.query.period || 'day';
    
    // Validate period parameter
    if (!['day', 'week', 'month'].includes(period)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid period. Use "day", "week", or "month"'
      });
    }
    
    const report = await validationService.generateValidationReport(period);
    
    res.json({
      success: true,
      report,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error generating validation report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate validation report'
    });
  }
});

/**
 * @route POST /api/validation/validate
 * @description Validate a Bitcoin transaction
 * @access Public
 */
router.post('/validate', async (req, res) => {
  try {
    const { transaction } = req.body;
    
    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction data is required'
      });
    }
    
    const validationResult = await validationService.validateTransaction(transaction);
    
    res.json({
      success: true,
      validationResult,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error validating transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate transaction'
    });
  }
});

/**
 * @route POST /api/validation/validate-inputs
 * @description Validate transaction inputs only
 * @access Public
 */
router.post('/validate-inputs', async (req, res) => {
  try {
    const { transaction } = req.body;
    
    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction data is required'
      });
    }
    
    const inputValidation = await validationService.validateTransactionInputs(transaction);
    
    res.json({
      success: true,
      inputValidation,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error validating transaction inputs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate transaction inputs'
    });
  }
});

/**
 * @route POST /api/validation/validate-outputs
 * @description Validate transaction outputs only
 * @access Public
 */
router.post('/validate-outputs', async (req, res) => {
  try {
    const { transaction, totalInputValue } = req.body;
    
    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction data is required'
      });
    }
    
    if (totalInputValue === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Total input value is required'
      });
    }
    
    const outputValidation = validationService.validateTransactionOutputs(
      transaction, 
      parseInt(totalInputValue, 10)
    );
    
    res.json({
      success: true,
      outputValidation,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error validating transaction outputs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate transaction outputs'
    });
  }
});

/**
 * @route POST /api/validation/validate-signature
 * @description Validate transaction signature
 * @access Public
 */
router.post('/validate-signature', async (req, res) => {
  try {
    const { transaction } = req.body;
    
    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction data is required'
      });
    }
    
    const signatureValidation = validationService.validateTransactionSignature(transaction);
    
    res.json({
      success: true,
      signatureValidation,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error validating transaction signature:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate transaction signature'
    });
  }
});

module.exports = router; 