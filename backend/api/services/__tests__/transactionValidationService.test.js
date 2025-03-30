/**
 * Unit tests for transaction validation service
 */

const validationService = require('../transactionValidationService');

// Mock the dependency on executeBitcoinCommand
jest.mock('child_process', () => ({
  execSync: jest.fn((command) => {
    if (command.includes('gettxout test_txid_valid 0')) {
      return JSON.stringify({
        bestblock: '000000000000000000064ba7512f54dbadc0b8b85d65f89b2eccbaabfdb63e31',
        confirmations: 5,
        value: 0.00100000, // 100,000 satoshis
        scriptPubKey: {
          asm: 'OP_DUP OP_HASH160 1234567890abcdef1234567890abcdef12345678 OP_EQUALVERIFY OP_CHECKSIG',
          hex: '76a9141234567890abcdef1234567890abcdef1234567888ac',
          reqSigs: 1,
          type: 'pubkeyhash',
          addresses: ['tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq']
        }
      });
    } else if (command.includes('gettxout test_txid_unconfirmed 0')) {
      return JSON.stringify({
        bestblock: '000000000000000000064ba7512f54dbadc0b8b85d65f89b2eccbaabfdb63e31',
        confirmations: 0,
        value: 0.00100000,
        scriptPubKey: {
          asm: 'OP_DUP OP_HASH160 1234567890abcdef1234567890abcdef12345678 OP_EQUALVERIFY OP_CHECKSIG',
          hex: '76a9141234567890abcdef1234567890abcdef1234567888ac',
          reqSigs: 1,
          type: 'pubkeyhash',
          addresses: ['tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq']
        }
      });
    } else if (command.includes('gettxout test_txid_spent 0')) {
      return 'null';
    } else if (command.includes('analyzepsbt')) {
      if (command.includes('valid_psbt')) {
        return JSON.stringify({
          complete: true
        });
      } else if (command.includes('incomplete_psbt')) {
        return JSON.stringify({
          complete: false,
          next: 'signer',
          missing: [{ pubkeys: ['02abcdef'] }]
        });
      } else {
        return JSON.stringify({
          error: 'Invalid PSBT format'
        });
      }
    } else if (command.includes('testmempoolaccept')) {
      if (command.includes('valid_hex')) {
        return JSON.stringify([{ allowed: true }]);
      } else {
        return JSON.stringify([{ allowed: false, reject_reason: 'Test rejection reason' }]);
      }
    }
    
    throw new Error('Command not mocked: ' + command);
  })
}));

// Mock fs module to prevent file system operations during tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn()
}));

describe('Transaction Validation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Address Validation', () => {
    test('should validate a valid segwit address', () => {
      const result = validationService.validateAddressFormat('tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('segwit');
    });
    
    test('should validate a valid P2PKH address', () => {
      const result = validationService.validateAddressFormat('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('p2pkh');
    });
    
    test('should validate a valid P2SH address', () => {
      const result = validationService.validateAddressFormat('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
      expect(result.valid).toBe(true);
      expect(result.type).toBe('p2sh');
    });
    
    test('should reject an invalid address', () => {
      const result = validationService.validateAddressFormat('invalid_address');
      expect(result.valid).toBe(false);
    });
    
    test('should reject an empty address', () => {
      const result = validationService.validateAddressFormat('');
      expect(result.valid).toBe(false);
    });
  });
  
  describe('UTXO Validation', () => {
    test('should validate a valid UTXO', async () => {
      const result = await validationService.verifyUtxoExistence('test_txid_valid', 0);
      expect(result.exists).toBe(true);
      expect(result.spendable).toBe(true);
      expect(result.value).toBe(100000); // 0.001 BTC in satoshis
    });
    
    test('should reject an unconfirmed UTXO', async () => {
      const result = await validationService.verifyUtxoExistence('test_txid_unconfirmed', 0);
      expect(result.exists).toBe(true);
      expect(result.spendable).toBe(false);
      expect(result.error).toContain('Insufficient confirmations');
    });
    
    test('should reject a spent UTXO', async () => {
      const result = await validationService.verifyUtxoExistence('test_txid_spent', 0);
      expect(result.exists).toBe(false);
      expect(result.error).toContain('does not exist or is already spent');
    });
  });
  
  describe('Input Validation', () => {
    test('should validate transaction with valid inputs', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_valid', vout: 0 }
        ]
      };
      
      const result = await validationService.validateTransactionInputs(tx);
      expect(result.valid).toBe(true);
      expect(result.totalInputValue).toBe(100000);
    });
    
    test('should reject transaction with missing inputs', async () => {
      const tx = {};
      
      const result = await validationService.validateTransactionInputs(tx);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid transaction inputs format');
    });
    
    test('should reject transaction with invalid inputs', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_spent', vout: 0 }
        ]
      };
      
      const result = await validationService.validateTransactionInputs(tx);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('One or more inputs are invalid');
    });
  });
  
  describe('Output Validation', () => {
    test('should validate transaction with valid outputs', () => {
      const tx = {
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 50000 },
          { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', value: 40000 }
        ]
      };
      
      const totalInputValue = 100000;
      
      const result = validationService.validateTransactionOutputs(tx, totalInputValue);
      expect(result.valid).toBe(true);
      expect(result.totalOutputValue).toBe(90000);
      expect(result.fee).toBe(10000);
    });
    
    test('should reject transaction with missing outputs', () => {
      const tx = {};
      
      const result = validationService.validateTransactionOutputs(tx, 100000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid transaction outputs format');
    });
    
    test('should reject transaction with invalid output addresses', () => {
      const tx = {
        outputs: [
          { address: 'invalid_address', value: 50000 }
        ]
      };
      
      const result = validationService.validateTransactionOutputs(tx, 100000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('One or more outputs are invalid');
    });
    
    test('should reject transaction with dust outputs', () => {
      const tx = {
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 100 }
        ]
      };
      
      const result = validationService.validateTransactionOutputs(tx, 100000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('One or more outputs are invalid');
    });
    
    test('should reject transaction with output value exceeding input value', () => {
      const tx = {
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 200000 }
        ]
      };
      
      const result = validationService.validateTransactionOutputs(tx, 100000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Total output value exceeds input value');
    });
  });
  
  describe('Signature Validation', () => {
    test('should validate transaction with valid complete PSBT', () => {
      const tx = {
        psbt: 'valid_psbt'
      };
      
      const result = validationService.validateTransactionSignature(tx);
      expect(result.valid).toBe(true);
      expect(result.isComplete).toBe(true);
    });
    
    test('should handle incomplete PSBT', () => {
      const tx = {
        psbt: 'incomplete_psbt'
      };
      
      const result = validationService.validateTransactionSignature(tx);
      expect(result.valid).toBe(true);
      expect(result.isComplete).toBe(false);
      expect(result.needsSignatures).toBe(true);
    });
    
    test('should validate transaction with valid raw hex', () => {
      const tx = {
        rawHex: 'valid_hex'
      };
      
      const result = validationService.validateTransactionSignature(tx);
      expect(result.valid).toBe(true);
      expect(result.allowedInMempool).toBe(true);
    });
    
    test('should reject transaction with invalid raw hex', () => {
      const tx = {
        rawHex: 'invalid_hex'
      };
      
      const result = validationService.validateTransactionSignature(tx);
      expect(result.valid).toBe(false);
      expect(result.allowedInMempool).toBe(false);
    });
    
    test('should reject transaction with missing signature data', () => {
      const tx = {};
      
      const result = validationService.validateTransactionSignature(tx);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing transaction data');
    });
  });
  
  describe('Full Transaction Validation', () => {
    test('should validate a complete valid transaction', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_valid', vout: 0 }
        ],
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 90000 }
        ],
        psbt: 'valid_psbt'
      };
      
      const result = await validationService.validateTransaction(tx);
      expect(result.valid).toBe(true);
      expect(result.fee).toBe(10000);
      expect(result.isComplete).toBe(true);
    });
    
    test('should reject transaction with invalid inputs', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_spent', vout: 0 }
        ],
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 90000 }
        ],
        psbt: 'valid_psbt'
      };
      
      const result = await validationService.validateTransaction(tx);
      expect(result.valid).toBe(false);
      expect(result.stage).toBe('input');
    });
    
    test('should reject transaction with invalid outputs', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_valid', vout: 0 }
        ],
        outputs: [
          { address: 'invalid_address', value: 90000 }
        ],
        psbt: 'valid_psbt'
      };
      
      const result = await validationService.validateTransaction(tx);
      expect(result.valid).toBe(false);
      expect(result.stage).toBe('output');
    });
    
    test('should reject transaction with invalid signature', async () => {
      const tx = {
        inputs: [
          { txid: 'test_txid_valid', vout: 0 }
        ],
        outputs: [
          { address: 'tb1q8k9r0cgrs4l5e8hh9f0q07522jd4x33adv78hq', value: 90000 }
        ],
        psbt: 'invalid_psbt'
      };
      
      const result = await validationService.validateTransaction(tx);
      expect(result.valid).toBe(false);
      expect(result.stage).toBe('signature');
    });
  });
  
  describe('Validation Statistics', () => {
    test('should return validation statistics', () => {
      const stats = validationService.getValidationStats();
      expect(stats).toBeDefined();
      expect(stats.totalValidated).toBeDefined();
      expect(stats.successRate).toBeDefined();
      expect(stats.circuitBreaker).toBeDefined();
    });
  });
}); 