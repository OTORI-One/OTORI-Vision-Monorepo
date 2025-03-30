/**
 * Integration test for Trading Service with Transaction Validation
 * 
 * Tests the integration between tradingService and transactionValidationService
 */

const tradingService = require('../tradingService');
const validationService = require('../transactionValidationService');

// Mock dependencies
jest.mock('child_process', () => ({
  execSync: jest.fn((command) => {
    if (command.includes('wallet balance')) {
      return '{"confirmed": 1.50000000, "unconfirmed": 0.00000000}';
    } else if (command.includes('wallet send')) {
      return 'Sent 100 OTORI•VISION•TOKEN to recipient in transaction abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    } else {
      return '{}';
    }
  })
}));

// Mock the validation service
jest.mock('../transactionValidationService', () => ({
  validateTransaction: jest.fn(),
  validateAddressFormat: jest.fn(),
  validateTransactionInputs: jest.fn(),
  validateTransactionOutputs: jest.fn(),
  validateTransactionSignature: jest.fn(),
  getValidationStats: jest.fn(),
  verifyUtxoExistence: jest.fn()
}));

describe('Trading Service Integration with Transaction Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementation for address validation
    validationService.validateAddressFormat.mockImplementation((address) => {
      return { 
        valid: address && address.startsWith('tb1') || address.startsWith('bc1'),
        type: 'segwit'
      };
    });
    
    // Default mock implementation for transaction validation
    validationService.validateTransaction.mockResolvedValue({
      valid: true,
      fee: 1000,
      isComplete: true
    });
    
    // Default mock implementation for validation stats
    validationService.getValidationStats.mockReturnValue({
      totalValidated: 10,
      inputValidationFailures: 0,
      outputValidationFailures: 0,
      signatureValidationFailures: 0,
      successRate: 100,
      lastReset: Date.now() - 86400000
    });
  });
  
  describe('Address Validation Integration', () => {
    test('should validate addresses when placing orders', async () => {
      // Setup rejection for invalid address
      validationService.validateAddressFormat.mockImplementation((address) => {
        if (address === 'invalid_address') {
          return { valid: false, error: 'Invalid address format' };
        }
        return { valid: true, type: 'segwit' };
      });
      
      // Test valid address
      const validOrder = {
        type: 'buy',
        price: 100000,
        amount: 5000,
        address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq'
      };
      
      await expect(tradingService.placeOrder(validOrder)).resolves.toBeDefined();
      expect(validationService.validateAddressFormat).toHaveBeenCalledWith(validOrder.address);
      
      // Test invalid address
      const invalidOrder = {
        type: 'buy',
        price: 100000,
        amount: 5000,
        address: 'invalid_address'
      };
      
      await expect(tradingService.placeOrder(invalidOrder)).rejects.toThrow('Invalid address format');
      expect(validationService.validateAddressFormat).toHaveBeenCalledWith(invalidOrder.address);
    });
    
    test('should validate address when getting user orders', async () => {
      const validAddress = 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq';
      const invalidAddress = 'invalid_address';
      
      // Setup rejection for invalid address
      validationService.validateAddressFormat.mockImplementation((address) => {
        if (address === invalidAddress) {
          return { valid: false, error: 'Invalid address format' };
        }
        return { valid: true, type: 'segwit' };
      });
      
      // Test valid address
      await expect(tradingService.getUserOrders(validAddress)).resolves.toBeDefined();
      expect(validationService.validateAddressFormat).toHaveBeenCalledWith(validAddress);
      
      // Test invalid address
      await expect(tradingService.getUserOrders(invalidAddress)).rejects.toThrow('Invalid address format');
      expect(validationService.validateAddressFormat).toHaveBeenCalledWith(invalidAddress);
    });
  });
  
  describe('Transaction Validation Integration', () => {
    test('should validate transaction before transfer', async () => {
      const recipientAddress = 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq';
      const amount = 1000;
      
      // Mock successful validation
      validationService.validateTransaction.mockResolvedValueOnce({
        success: true,
        validationResult: {
          valid: true,
          fee: 500,
          isComplete: true
        }
      });
      
      const result = await tradingService.transferTokensFromLP(recipientAddress, amount);
      
      expect(result.success).toBe(true);
      expect(validationService.validateTransaction).toHaveBeenCalled();
      
      // Get the transaction argument passed to validation
      const txArg = validationService.validateTransaction.mock.calls[0][0];
      expect(txArg.outputs[0].address).toBe(recipientAddress);
      expect(txArg.outputs[0].value).toBe(amount);
    });
    
    test('should reject transfer if validation fails', async () => {
      const recipientAddress = 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq';
      const amount = 1000;
      
      // Mock failed validation
      validationService.validateTransaction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid transaction',
        details: { valid: false, error: 'Insufficient funds' }
      });
      
      await expect(tradingService.transferTokensFromLP(recipientAddress, amount))
        .rejects.toThrow('Transaction validation failed');
      
      expect(validationService.validateTransaction).toHaveBeenCalled();
    });
    
    test('should validate transaction before executing buy order', async () => {
      const buyerAddress = 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq';
      const amount = 1000;
      const price = 100000;
      
      // Mock successful validation
      validationService.validateTransaction.mockResolvedValueOnce({
        success: true,
        validationResult: {
          valid: true,
          fee: 500,
          isComplete: true
        }
      });
      
      const result = await tradingService.executeBuyOrder(buyerAddress, amount, price);
      
      expect(result.success).toBe(true);
      expect(result.trade.validationStatus).toBe('passed');
      expect(validationService.validateTransaction).toHaveBeenCalled();
      expect(validationService.validateAddressFormat).toHaveBeenCalledWith(buyerAddress);
    });
    
    test('should reject buy order if validation fails', async () => {
      const buyerAddress = 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq';
      const amount = 1000;
      const price = 100000;
      
      // Mock failed validation
      validationService.validateTransaction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid transaction',
        details: { valid: false, error: 'Insufficient funds' }
      });
      
      await expect(tradingService.executeBuyOrder(buyerAddress, amount, price))
        .rejects.toThrow('Transaction validation failed');
      
      expect(validationService.validateTransaction).toHaveBeenCalled();
    });
  });
  
  describe('Stats Integration', () => {
    test('should include validation stats in service stats', async () => {
      // Mock validation stats
      validationService.getValidationStats.mockReturnValueOnce({
        totalValidated: 50,
        inputValidationFailures: 5,
        outputValidationFailures: 3,
        signatureValidationFailures: 2,
        successRate: 80,
        lastReset: Date.now() - 86400000
      });
      
      const stats = await tradingService.getStats();
      
      expect(stats.validation).toBeDefined();
      expect(stats.validation.totalValidated).toBe(50);
      expect(stats.validation.successRate).toBe(80);
      expect(validationService.getValidationStats).toHaveBeenCalled();
    });
  });
  
  describe('Direct Validation Function', () => {
    test('should expose validateTransaction function', async () => {
      const transaction = {
        inputs: [{ txid: 'test_txid', vout: 0 }],
        outputs: [{ address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 1000 }],
        psbt: 'test_psbt'
      };
      
      // Mock successful validation
      validationService.validateTransaction.mockResolvedValueOnce({
        valid: true,
        fee: 500,
        isComplete: true
      });
      
      const result = await tradingService.validateTransaction(transaction);
      
      expect(result.success).toBe(true);
      expect(validationService.validateTransaction).toHaveBeenCalledWith(transaction);
    });
    
    test('should handle validation errors', async () => {
      const transaction = {
        inputs: [{ txid: 'test_txid', vout: 0 }],
        outputs: [{ address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 1000 }],
        psbt: 'test_psbt'
      };
      
      // Mock failed validation
      validationService.validateTransaction.mockRejectedValueOnce(new Error('Test error'));
      
      const result = await tradingService.validateTransaction(transaction);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation error');
    });
  });
}); 