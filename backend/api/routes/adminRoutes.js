/**
 * Admin API Routes for OTORI Vision
 * 
 * This module provides secure admin functionality requiring multi-signature approval
 * for sensitive operations, particularly for transactions out of the Treasury address.
 */

const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const validationService = require('../services/transactionValidationService');

/**
 * @route GET /api/admin/actions
 * @description Get all pending admin actions
 * @access Private (Admin only)
 */
router.get('/actions', (req, res) => {
  try {
    const { status, type } = req.query;
    
    const options = {};
    if (status) options.status = status;
    if (type) options.actionType = type;
    
    const actions = adminService.getPendingAdminActions(options);
    
    res.json({
      success: true,
      actions,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching admin actions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin actions'
    });
  }
});

/**
 * @route GET /api/admin/actions/:id
 * @description Get a specific admin action
 * @access Private (Admin only)
 */
router.get('/actions/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const action = adminService.getAdminAction(id);
    if (!action) {
      return res.status(404).json({
        success: false,
        error: 'Admin action not found'
      });
    }
    
    res.json({
      success: true,
      action,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Error fetching admin action ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin action'
    });
  }
});

/**
 * @route POST /api/admin/actions
 * @description Create a new admin action
 * @access Private (Admin only)
 */
router.post('/actions', (req, res) => {
  try {
    const { actionType, description, data } = req.body;
    
    if (!actionType || !description) {
      return res.status(400).json({
        success: false,
        error: 'Action type and description are required'
      });
    }
    
    // Validate action type
    const validActionTypes = ['TREASURY_TRANSFER', 'MINT_RUNE', 'LP_REBALANCE'];
    if (!validActionTypes.includes(actionType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action type. Must be one of: ${validActionTypes.join(', ')}`
      });
    }
    
    // Additional validation for specific action types
    if (actionType === 'TREASURY_TRANSFER') {
      const { recipient, amount } = data || {};
      if (!recipient || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Treasury transfers require recipient and amount'
        });
      }
      
      // Validate Bitcoin address
      const addressValidation = validationService.validateAddressFormat(recipient);
      if (!addressValidation.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid recipient address: ${addressValidation.error}`
        });
      }
    } else if (actionType === 'MINT_RUNE') {
      const { amount } = data || {};
      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Mint amount must be positive'
        });
      }
    } else if (actionType === 'LP_REBALANCE') {
      const { distributions } = data || {};
      if (!distributions || !Array.isArray(distributions) || distributions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'LP rebalance requires a valid distributions array'
        });
      }
    }
    
    const action = adminService.createAdminAction(actionType, description, data);
    
    res.status(201).json({
      success: true,
      action,
      message: 'Admin action created successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error creating admin action:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create admin action'
    });
  }
});

/**
 * @route POST /api/admin/actions/:id/sign
 * @description Add a signature to an admin action
 * @access Private (Admin only)
 */
router.post('/actions/:id/sign', (req, res) => {
  try {
    const { id } = req.params;
    const { signature, publicKey } = req.body;
    
    if (!signature || !publicKey) {
      return res.status(400).json({
        success: false,
        error: 'Signature and public key are required'
      });
    }
    
    const result = adminService.addSignatureToAction(id, signature, publicKey);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json({
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Error signing admin action ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to sign admin action'
    });
  }
});

/**
 * @route POST /api/admin/actions/:id/execute
 * @description Execute an approved admin action
 * @access Private (Admin only)
 */
router.post('/actions/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await adminService.executeAdminAction(id);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json({
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`Error executing admin action ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute admin action'
    });
  }
});

/**
 * @route POST /api/admin/treasury-transfer
 * @description Create a treasury transfer action and optionally sign it
 * @access Private (Admin only)
 */
router.post('/treasury-transfer', (req, res) => {
  try {
    const { recipient, amount, description, signature, publicKey } = req.body;
    
    if (!recipient || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Recipient and amount are required'
      });
    }
    
    // Validate Bitcoin address
    const addressValidation = validationService.validateAddressFormat(recipient);
    if (!addressValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid recipient address: ${addressValidation.error}`
      });
    }
    
    // Create the admin action
    const actionType = 'TREASURY_TRANSFER';
    const actionDesc = description || `Transfer ${amount} satoshis to ${recipient}`;
    const action = adminService.createAdminAction(actionType, actionDesc, {
      recipient,
      amount,
      description
    });
    
    // If a signature and public key are provided, add the signature
    let signatureResult = null;
    if (signature && publicKey) {
      signatureResult = adminService.addSignatureToAction(action.id, signature, publicKey);
    }
    
    res.status(201).json({
      success: true,
      action,
      signatureResult,
      message: 'Treasury transfer action created successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error creating treasury transfer action:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create treasury transfer action'
    });
  }
});

/**
 * @route POST /api/admin/mint-rune
 * @description Create a rune minting action and optionally sign it
 * @access Private (Admin only)
 */
router.post('/mint-rune', (req, res) => {
  try {
    const { amount, signature, publicKey } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'A positive amount is required'
      });
    }
    
    // Create the admin action
    const actionType = 'MINT_RUNE';
    const actionDesc = `Mint ${amount} OVT tokens`;
    const action = adminService.createAdminAction(actionType, actionDesc, {
      amount
    });
    
    // If a signature and public key are provided, add the signature
    let signatureResult = null;
    if (signature && publicKey) {
      signatureResult = adminService.addSignatureToAction(action.id, signature, publicKey);
    }
    
    res.status(201).json({
      success: true,
      action,
      signatureResult,
      message: 'Rune minting action created successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error creating rune minting action:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create rune minting action'
    });
  }
});

/**
 * @route GET /api/admin/config
 * @description Get admin service configuration
 * @access Private (Admin only)
 */
router.get('/config', (req, res) => {
  try {
    res.json({
      success: true,
      config: adminService.config,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching admin config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin config'
    });
  }
});

module.exports = router; 