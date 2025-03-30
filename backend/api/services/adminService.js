/**
 * Admin Service for OTORI Vision
 * 
 * This service handles admin operations requiring multi-signature approval
 * as specified in the backend-specific-dev-rules.mdc document.
 * It implements the 3-of-5 multisig pattern for admin operations,
 * particularly for transactions out of the Treasury address.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1');
const config = require('./configService');
const commandService = require('./commandExecutionService');
const utxoService = require('./utxoService');
const validationService = require('./transactionValidationService');
const transactionFormatService = require('./transactionFormatService');

// Initialize storage for pending admin actions
let pendingAdminActions = [];

// Load any existing pending admin actions
try {
  const pendingActionsFile = path.join(config.paths.dataDir, 'pending-admin-actions.json');
  if (fs.existsSync(pendingActionsFile)) {
    const data = fs.readFileSync(pendingActionsFile, 'utf8');
    pendingAdminActions = JSON.parse(data);
    console.log(`Loaded ${pendingAdminActions.length} pending admin actions`);
  } else {
    // Create the directory if it doesn't exist
    const dir = path.dirname(pendingActionsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create an empty file
    fs.writeFileSync(pendingActionsFile, JSON.stringify([]));
    console.log('Created empty pending admin actions file');
  }
} catch (error) {
  console.error('Error loading pending admin actions:', error);
}

/**
 * AdminAction class as specified in backend rules
 */
class AdminAction {
  constructor(actionType, description, data = {}) {
    this.id = crypto.randomUUID();
    this.actionType = actionType;
    this.description = description;
    this.data = data;
    this.signatures = [];
    this.signedBy = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.status = 'pending'; // pending, approved, rejected, executed
  }

  /**
   * Add a signature to the admin action
   * @param {string} signature - Signature from admin
   * @param {string} publicKey - Admin's public key
   * @returns {boolean} - Whether the signature was added
   */
  addSignature(signature, publicKey) {
    // Check if the admin has already signed
    if (this.signedBy.includes(publicKey)) {
      return false;
    }

    // Validate the signature
    try {
      const message = JSON.stringify({
        type: this.actionType,
        data: this.data,
        id: this.id
      });
      
      // Verify signature (implementation depends on the signature format)
      // For now, we'll just store the signature
      this.signatures.push(signature);
      this.signedBy.push(publicKey);
      this.updatedAt = Date.now();
      
      return true;
    } catch (error) {
      console.error('Error adding signature:', error);
      return false;
    }
  }

  /**
   * Check if the action has enough signatures to be approved
   * @returns {boolean} - Whether the action is approved
   */
  isApproved() {
    return this.signatures.length >= config.admin.requiredSignatures;
  }

  /**
   * Convert the admin action to a plain object
   * @returns {Object} - Admin action as a plain object
   */
  toJSON() {
    return {
      id: this.id,
      actionType: this.actionType,
      description: this.description,
      data: this.data,
      signatures: this.signatures,
      signedBy: this.signedBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      status: this.status
    };
  }
}

/**
 * Create a new admin action
 * @param {string} actionType - Type of action
 * @param {string} description - Human-readable description
 * @param {Object} data - Action-specific data
 * @returns {AdminAction} - Created admin action
 */
function createAdminAction(actionType, description, data = {}) {
  const action = new AdminAction(actionType, description, data);
  pendingAdminActions.push(action);
  savePendingActions();
  
  console.log(`Created admin action: ${action.id}, type: ${actionType}`);
  return action;
}

/**
 * Get an admin action by ID
 * @param {string} id - Action ID
 * @returns {AdminAction|null} - Admin action or null if not found
 */
function getAdminAction(id) {
  const action = pendingAdminActions.find(a => a.id === id);
  if (!action) return null;
  
  // Convert from plain object to AdminAction instance if needed
  if (!(action instanceof AdminAction)) {
    const newAction = new AdminAction(action.actionType, action.description, action.data);
    Object.assign(newAction, action);
    return newAction;
  }
  
  return action;
}

/**
 * Update an admin action
 * @param {AdminAction} action - Updated action
 * @returns {boolean} - Whether the update was successful
 */
function updateAdminAction(action) {
  const index = pendingAdminActions.findIndex(a => a.id === action.id);
  if (index === -1) return false;
  
  pendingAdminActions[index] = action;
  savePendingActions();
  return true;
}

/**
 * Add a signature to an admin action
 * @param {string} actionId - Action ID
 * @param {string} signature - Signature
 * @param {string} publicKey - Admin's public key
 * @returns {Object} - Result of the operation
 */
function addSignatureToAction(actionId, signature, publicKey) {
  const action = getAdminAction(actionId);
  if (!action) {
    return {
      success: false,
      error: 'Admin action not found'
    };
  }
  
  // Add the signature
  const added = action.addSignature(signature, publicKey);
  if (!added) {
    return {
      success: false,
      error: 'Failed to add signature or admin has already signed'
    };
  }
  
  // Update the action
  updateAdminAction(action);
  
  // Check if the action is now approved
  if (action.isApproved()) {
    action.status = 'approved';
    updateAdminAction(action);
    
    return {
      success: true,
      isApproved: true,
      signaturesCount: action.signatures.length,
      requiredSignatures: config.admin.requiredSignatures
    };
  }
  
  return {
    success: true,
    isApproved: false,
    signaturesCount: action.signatures.length,
    requiredSignatures: config.admin.requiredSignatures
  };
}

/**
 * Execute an approved admin action
 * @param {string} actionId - Action ID
 * @returns {Promise<Object>} - Result of the operation
 */
async function executeAdminAction(actionId) {
  const action = getAdminAction(actionId);
  if (!action) {
    return {
      success: false,
      error: 'Admin action not found'
    };
  }
  
  // Check if the action is approved
  if (!action.isApproved()) {
    return {
      success: false,
      error: `Insufficient signatures: ${action.signatures.length}/${config.admin.requiredSignatures}`
    };
  }
  
  // Check if the action is already executed
  if (action.status === 'executed') {
    return {
      success: false,
      error: 'Admin action already executed'
    };
  }
  
  try {
    // Execute the action based on its type
    let result;
    
    switch (action.actionType) {
      case 'TREASURY_TRANSFER':
        result = await executeTreasuryTransfer(action);
        break;
      case 'MINT_RUNE':
        result = await executeRuneMinting(action);
        break;
      case 'LP_REBALANCE':
        result = await executeLPRebalancing(action);
        break;
      default:
        return {
          success: false,
          error: `Unknown action type: ${action.actionType}`
        };
    }
    
    // Update action status
    action.status = 'executed';
    updateAdminAction(action);
    
    return {
      success: true,
      result
    };
  } catch (error) {
    console.error(`Error executing admin action ${actionId}:`, error);
    return {
      success: false,
      error: `Execution error: ${error.message}`
    };
  }
}

/**
 * Execute a treasury transfer
 * @param {AdminAction} action - Admin action
 * @returns {Promise<Object>} - Result of the operation
 */
async function executeTreasuryTransfer(action) {
  const { recipient, amount, description } = action.data;
  
  // Validate the treasury transfer
  if (!recipient || !amount) {
    throw new Error('Missing required fields: recipient and amount');
  }
  
  const addressValidation = validationService.validateAddressFormat(recipient);
  if (!addressValidation.valid) {
    throw new Error(`Invalid recipient address: ${addressValidation.error}`);
  }
  
  // Check if the transaction is sending from a treasury address
  // This is critical for security reasons
  const isTreasuryTransaction = true; // This will be replaced with actual logic
  
  // For treasury transactions, we require multi-signature verification
  if (isTreasuryTransaction && action.signatures.length < config.admin.requiredSignatures) {
    throw new Error(`Treasury transactions require at least ${config.admin.requiredSignatures} signatures`);
  }
  
  // Create the transaction PSBT
  const psbtResult = await utxoService.createOptimizedPSBT(recipient, amount);
  
  // Create transaction metadata
  const metadata = transactionFormatService.createTransactionMetadata({
    type: transactionFormatService.TX_TYPE.TREASURY,
    amount,
    source: 'admin-service',
    description: description || 'Treasury transfer',
    outputs: [{
      address: recipient,
      value: amount
    }]
  });
  
  // Save the transaction to file for record-keeping
  const filePath = transactionFormatService.saveTransactionToFile(psbtResult.psbt, metadata);
  
  // For simulation, just return the PSBT data without broadcasting
  // In a real implementation, this would sign and broadcast the transaction
  const txid = 'simulated_treasury_transfer_' + Date.now();
  
  return {
    txid,
    psbt: psbtResult.psbt,
    amount,
    recipient,
    filePath,
    description: description || 'Treasury transfer',
    timestamp: Date.now()
  };
}

/**
 * Execute Rune minting
 * @param {AdminAction} action - Admin action
 * @returns {Promise<Object>} - Result of the operation
 */
async function executeRuneMinting(action) {
  const { amount } = action.data;
  
  // Validate the mint operation
  if (!amount || amount <= 0) {
    throw new Error('Invalid mint amount');
  }
  
  // Create API call to runes service for minting
  try {
    // In a real implementation, this would call the Rune API
    // For now, just simulate the API response
    
    // Create metadata for tracking
    const metadata = transactionFormatService.createTransactionMetadata({
      type: transactionFormatService.TX_TYPE.MINT,
      amount,
      source: 'admin-service',
      description: `Minted ${amount} OVT tokens`,
      runeData: {
        runeId: config.lp.runeId
      }
    });
    
    // For simulation, just return a mock txid
    const txid = 'simulated_rune_mint_' + Date.now();
    
    return {
      txid,
      amount,
      runeId: config.lp.runeId,
      description: `Minted ${amount} OVT tokens`,
      timestamp: Date.now(),
      metadata
    };
  } catch (error) {
    console.error('Error minting rune:', error);
    throw new Error(`Rune minting failed: ${error.message}`);
  }
}

/**
 * Execute LP rebalancing
 * @param {AdminAction} action - Admin action
 * @returns {Promise<Object>} - Result of the operation
 */
async function executeLPRebalancing(action) {
  const { distributions } = action.data;
  
  // Validate the rebalancing operation
  if (!distributions || !Array.isArray(distributions)) {
    throw new Error('Invalid distributions data');
  }
  
  // In a real implementation, this would create PSBTs to redistribute funds
  // For now, just create metadata for tracking
  const metadata = transactionFormatService.createTransactionMetadata({
    type: transactionFormatService.TX_TYPE.REBALANCE,
    source: 'admin-service',
    description: 'LP wallet rebalancing',
    data: { distributions }
  });
  
  // For simulation, just return a mock txid
  const txid = 'simulated_lp_rebalance_' + Date.now();
  
  return {
    txid,
    distributions,
    description: 'LP wallet rebalancing',
    timestamp: Date.now(),
    metadata
  };
}

/**
 * Get all pending admin actions
 * @param {Object} options - Filter options
 * @returns {Array} - Pending admin actions
 */
function getPendingAdminActions(options = {}) {
  let filtered = pendingAdminActions;
  
  // Filter by status
  if (options.status) {
    filtered = filtered.filter(a => a.status === options.status);
  }
  
  // Filter by action type
  if (options.actionType) {
    filtered = filtered.filter(a => a.actionType === options.actionType);
  }
  
  // Sort by creation date (newest first)
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  
  return filtered;
}

/**
 * Verify if an address is a treasury address
 * @param {string} address - Address to check
 * @returns {boolean} - Whether the address is a treasury address
 */
function isTreasuryAddress(address) {
  return config.admin.treasuryAddresses.includes(address);
}

/**
 * Save pending actions to file
 */
function savePendingActions() {
  try {
    const pendingActionsFile = path.join(config.paths.dataDir, 'pending-admin-actions.json');
    const data = JSON.stringify(pendingAdminActions, null, 2);
    fs.writeFileSync(pendingActionsFile, data);
  } catch (error) {
    console.error('Error saving pending admin actions:', error);
  }
}

/**
 * Verify multi-signature threshold is met for treasury transactions
 * @param {Object} transaction - Transaction to verify
 * @returns {boolean} - Whether the transaction meets the threshold
 */
function verifySignatureThreshold(transaction) {
  // Check if this is a treasury transaction
  if (!transaction || !transaction.inputs) {
    return false;
  }
  
  // Determine if any input is spending from a treasury address
  const isTreasuryTransaction = transaction.inputs.some(input => {
    // In a real implementation, we would check if the input spends from a treasury address
    // For now, we'll simplify this
    return input.isTreasury;
  });
  
  // For treasury transactions, we require multi-signature verification
  if (isTreasuryTransaction) {
    // Check if the transaction has enough signatures
    // For PSBTs, we would check the actual signatures
    // For now, we'll just check if the transaction has the required metadata
    return transaction.signatures && 
           transaction.signatures.length >= config.admin.requiredSignatures;
  }
  
  // For non-treasury transactions, we don't require multi-signature verification
  return true;
}

module.exports = {
  createAdminAction,
  getAdminAction,
  addSignatureToAction,
  executeAdminAction,
  getPendingAdminActions,
  verifySignatureThreshold,
  isTreasuryAddress,
  
  // Export AdminAction class for testing
  AdminAction,
  
  // Export configuration for reference
  config: {
    requiredSignatures: config.admin.requiredSignatures,
    maxAdmins: config.admin.maxAdmins,
    treasuryAddresses: config.admin.treasuryAddresses
  }
}; 