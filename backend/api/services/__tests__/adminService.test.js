/**
 * Tests for Admin Service implementation
 * 
 * These tests verify that the Admin Service correctly implements
 * multi-signature support for administrative operations.
 */

const path = require('path');
const fs = require('fs');
const adminService = require('../adminService');

// Mock dependencies
jest.mock('../../services/validationService', () => ({
  validateAddressFormat: jest.fn(address => {
    // Simple validation - address should look like a Bitcoin address format
    const valid = 
      address.startsWith('tb1') || 
      address.startsWith('bc1') || 
      address.startsWith('1') || 
      address.startsWith('3');
    
    return { 
      valid, 
      error: valid ? null : 'Invalid address format'
    };
  })
}));

// Mock execSync for testing
jest.mock('child_process', () => ({
  execSync: jest.fn((cmd) => {
    // Mock implementation that returns expected output for different commands
    if (cmd.includes('listunspent')) {
      return JSON.stringify([
        {
          txid: 'mock_txid_1',
          vout: 0,
          address: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
          amount: 0.001,
          confirmations: 10,
          spendable: true,
          scriptPubKey: 'mock_script_1'
        }
      ]);
    }
    
    return 'mock_output';
  })
}));

// Setup test environment
beforeEach(() => {
  // Reset the mock implementation
  jest.clearAllMocks();
  
  // Create a temporary directory for test data
  const testDataDir = path.join(__dirname, '../../../data');
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  
  // Setup test-specific configuration
  adminService.config = {
    requiredSignatures: 3,
    maxAdmins: 5,
    treasuryAddresses: [
      'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
      'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3'
    ]
  };
});

// Clean up after tests
afterEach(() => {
  // Restore original pendingAdminActions
  adminService.pendingAdminActions = [];
});

describe('Admin Service', () => {
  describe('AdminAction Class', () => {
    test('should create a new admin action with proper structure', () => {
      const action = new adminService.AdminAction('TEST_ACTION', 'Test action', { test: true });
      
      expect(action.id).toBeDefined();
      expect(action.actionType).toBe('TEST_ACTION');
      expect(action.description).toBe('Test action');
      expect(action.data).toEqual({ test: true });
      expect(action.signatures).toEqual([]);
      expect(action.signedBy).toEqual([]);
      expect(action.status).toBe('pending');
    });
    
    test('should add a signature to the action', () => {
      const action = new adminService.AdminAction('TEST_ACTION', 'Test action');
      const signature = 'mock_signature';
      const publicKey = 'mock_public_key';
      
      const added = action.addSignature(signature, publicKey);
      
      expect(added).toBe(true);
      expect(action.signatures).toContain(signature);
      expect(action.signedBy).toContain(publicKey);
    });
    
    test('should not add duplicate signatures from the same admin', () => {
      const action = new adminService.AdminAction('TEST_ACTION', 'Test action');
      const signature1 = 'mock_signature_1';
      const signature2 = 'mock_signature_2';
      const publicKey = 'mock_public_key';
      
      action.addSignature(signature1, publicKey);
      const added = action.addSignature(signature2, publicKey);
      
      expect(added).toBe(false);
      expect(action.signatures).toEqual([signature1]);
      expect(action.signedBy).toEqual([publicKey]);
    });
    
    test('should correctly determine if an action is approved', () => {
      const action = new adminService.AdminAction('TEST_ACTION', 'Test action');
      
      // Add 2 signatures (not enough for approval)
      action.addSignature('sig1', 'key1');
      action.addSignature('sig2', 'key2');
      expect(action.isApproved()).toBe(false);
      
      // Add the third signature (enough for approval)
      action.addSignature('sig3', 'key3');
      expect(action.isApproved()).toBe(true);
    });
  });
  
  describe('Action Management', () => {
    test('should create and get an admin action', () => {
      const action = adminService.createAdminAction('TEST_ACTION', 'Test action', { test: true });
      
      const retrieved = adminService.getAdminAction(action.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(action.id);
      expect(retrieved.actionType).toBe('TEST_ACTION');
      expect(retrieved.data).toEqual({ test: true });
    });
    
    test('should add a signature to an action', () => {
      const action = adminService.createAdminAction('TEST_ACTION', 'Test action');
      const result = adminService.addSignatureToAction(action.id, 'sig', 'key');
      
      expect(result.success).toBe(true);
      expect(result.signaturesCount).toBe(1);
      expect(result.isApproved).toBe(false);
      
      // Add more signatures
      adminService.addSignatureToAction(action.id, 'sig2', 'key2');
      const result3 = adminService.addSignatureToAction(action.id, 'sig3', 'key3');
      
      expect(result3.success).toBe(true);
      expect(result3.signaturesCount).toBe(3);
      expect(result3.isApproved).toBe(true);
    });
    
    test('should handle non-existent actions', () => {
      const result = adminService.addSignatureToAction('non-existent', 'sig', 'key');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
    
    test('should filter pending admin actions', () => {
      // Create actions with different statuses
      const action1 = adminService.createAdminAction('TEST_ACTION', 'Test 1');
      const action2 = adminService.createAdminAction('TEST_ACTION', 'Test 2');
      const action3 = adminService.createAdminAction('OTHER_ACTION', 'Test 3');
      
      // Update action2 status
      const retrieved2 = adminService.getAdminAction(action2.id);
      retrieved2.status = 'approved';
      adminService.updateAdminAction(retrieved2);
      
      // Filter by status
      const pendingActions = adminService.getPendingAdminActions({ status: 'pending' });
      expect(pendingActions.length).toBe(2);
      
      // Filter by action type
      const testActions = adminService.getPendingAdminActions({ actionType: 'TEST_ACTION' });
      expect(testActions.length).toBe(2);
      
      // Filter by both
      const pendingTestActions = adminService.getPendingAdminActions({ 
        status: 'pending', 
        actionType: 'TEST_ACTION' 
      });
      expect(pendingTestActions.length).toBe(1);
    });
  });
  
  describe('Treasury Address Verification', () => {
    test('should verify treasury addresses correctly', () => {
      // Test with treasury addresses
      expect(adminService.isTreasuryAddress('tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd')).toBe(true);
      expect(adminService.isTreasuryAddress('tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3')).toBe(true);
      
      // Test with non-treasury addresses
      expect(adminService.isTreasuryAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
      expect(adminService.isTreasuryAddress('invalid_address')).toBe(false);
    });
  });
  
  describe('Signature Threshold Verification', () => {
    test('should verify signature threshold correctly for treasury transactions', () => {
      // Create a transaction sending from a treasury address
      const treasuryTransaction = {
        inputs: [
          { 
            address: 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
            isTreasury: true
          }
        ],
        signatures: ['sig1', 'sig2', 'sig3']
      };
      
      // Create a transaction not sending from a treasury address
      const normalTransaction = {
        inputs: [
          { address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' }
        ],
        signatures: ['sig1']
      };
      
      // Test treasury transaction with enough signatures
      expect(adminService.verifySignatureThreshold(treasuryTransaction)).toBe(true);
      
      // Test treasury transaction with insufficient signatures
      treasuryTransaction.signatures = ['sig1', 'sig2'];
      expect(adminService.verifySignatureThreshold(treasuryTransaction)).toBe(false);
      
      // Test non-treasury transaction (always passes)
      expect(adminService.verifySignatureThreshold(normalTransaction)).toBe(true);
    });
  });
  
  describe('Action Execution', () => {
    test('should not execute actions without sufficient signatures', async () => {
      const action = adminService.createAdminAction('TREASURY_TRANSFER', 'Test transfer', {
        recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        amount: 10000
      });
      
      // Add only 2 signatures (not enough)
      adminService.addSignatureToAction(action.id, 'sig1', 'key1');
      adminService.addSignatureToAction(action.id, 'sig2', 'key2');
      
      const result = await adminService.executeAdminAction(action.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient signatures');
    });
    
    test('should execute approved treasury transfer actions', async () => {
      const action = adminService.createAdminAction('TREASURY_TRANSFER', 'Test transfer', {
        recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        amount: 10000
      });
      
      // Add 3 signatures (enough for approval)
      adminService.addSignatureToAction(action.id, 'sig1', 'key1');
      adminService.addSignatureToAction(action.id, 'sig2', 'key2');
      adminService.addSignatureToAction(action.id, 'sig3', 'key3');
      
      const result = await adminService.executeAdminAction(action.id);
      
      expect(result.success).toBe(true);
      expect(result.result.txid).toBeDefined();
      
      // Check that the action was marked as executed
      const executed = adminService.getAdminAction(action.id);
      expect(executed.status).toBe('executed');
    });
    
    test('should execute approved minting actions', async () => {
      const action = adminService.createAdminAction('MINT_RUNE', 'Test mint', {
        amount: 50000
      });
      
      // Add 3 signatures (enough for approval)
      adminService.addSignatureToAction(action.id, 'sig1', 'key1');
      adminService.addSignatureToAction(action.id, 'sig2', 'key2');
      adminService.addSignatureToAction(action.id, 'sig3', 'key3');
      
      const result = await adminService.executeAdminAction(action.id);
      
      expect(result.success).toBe(true);
      expect(result.result.txid).toBeDefined();
      expect(result.result.amount).toBe(50000);
      
      // Check that the action was marked as executed
      const executed = adminService.getAdminAction(action.id);
      expect(executed.status).toBe('executed');
    });
    
    test('should not execute unknown action types', async () => {
      const action = adminService.createAdminAction('UNKNOWN_TYPE', 'Test unknown', {
        data: 'test'
      });
      
      // Add 3 signatures (enough for approval)
      adminService.addSignatureToAction(action.id, 'sig1', 'key1');
      adminService.addSignatureToAction(action.id, 'sig2', 'key2');
      adminService.addSignatureToAction(action.id, 'sig3', 'key3');
      
      const result = await adminService.executeAdminAction(action.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });
  });
}); 