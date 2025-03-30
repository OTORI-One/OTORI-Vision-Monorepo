/**
 * Mock Service for OTORI Vision
 * 
 * Provides sophisticated fallback mechanisms and mock data generation
 * for testing and service degradation scenarios.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./configService');

// Current service status tracking
const serviceStatus = {
  // 'real' = using real services, 'mock' = using mock data, 'hybrid' = mix of both
  mode: process.env.SERVICE_MODE || 'real',
  services: {},
  transitionTimestamp: null,
  lastStatusChange: Date.now(),
};

// Mock data templates
const mockDataTemplates = {
  utxo: {
    // Template for a mock UTXO object
    createMockUtxo: (amount = 100000, confirmations = 6) => ({
      txid: generateRandomTxid(),
      vout: Math.floor(Math.random() * 4),
      address: generateMockAddress(),
      value: amount / 100000000, // Convert to BTC
      valueInSatoshis: amount,
      confirmations,
      spendable: true,
      solvable: true,
      safe: true,
      scriptPubKey: {
        asm: 'OP_1 PUSH20 0x' + crypto.randomBytes(20).toString('hex'),
        hex: '5114' + crypto.randomBytes(20).toString('hex'),
        type: 'witness_v1_taproot',
        address: generateMockAddress(),
      }
    }),
    
    // Generate a list of mock UTXOs with varied amounts
    createMockUtxoSet: (count = 10, smallUtxoThreshold = 10000) => {
      const utxos = [];
      
      // Generate some small UTXOs
      for (let i = 0; i < Math.floor(count / 3); i++) {
        const amount = Math.floor(Math.random() * smallUtxoThreshold) + 1000;
        utxos.push(mockDataTemplates.utxo.createMockUtxo(amount));
      }
      
      // Generate some medium UTXOs
      for (let i = 0; i < Math.floor(count / 3); i++) {
        const amount = Math.floor(Math.random() * 100000) + smallUtxoThreshold;
        utxos.push(mockDataTemplates.utxo.createMockUtxo(amount));
      }
      
      // Generate some large UTXOs
      for (let i = 0; i < Math.floor(count / 3) + (count % 3); i++) {
        const amount = Math.floor(Math.random() * 1000000) + 100000;
        utxos.push(mockDataTemplates.utxo.createMockUtxo(amount));
      }
      
      return utxos;
    }
  },
  
  transaction: {
    // Template for a mock transaction
    createMockTransaction: (inputCount = 2, outputCount = 2) => {
      const inputs = [];
      const outputs = [];
      let totalInputValue = 0;
      
      // Generate inputs
      for (let i = 0; i < inputCount; i++) {
        const value = Math.floor(Math.random() * 100000) + 10000;
        totalInputValue += value;
        
        inputs.push({
          txid: generateRandomTxid(),
          vout: Math.floor(Math.random() * 4),
          sequence: 0xffffffff,
          scriptSig: {
            asm: 'OP_0 PUSH32 0x' + crypto.randomBytes(32).toString('hex'),
            hex: '0020' + crypto.randomBytes(32).toString('hex'),
          },
          value
        });
      }
      
      // Calculate fee (0.5%-2% of total input)
      const feeRate = (Math.random() * 1.5) + 0.5;
      const fee = Math.floor(totalInputValue * (feeRate / 100));
      const totalOutputValue = totalInputValue - fee;
      
      // Distribute value among outputs
      let remaining = totalOutputValue;
      for (let i = 0; i < outputCount - 1; i++) {
        const portion = Math.random();
        const value = Math.floor(remaining * portion);
        remaining -= value;
        
        outputs.push({
          value,
          address: generateMockAddress(),
          scriptPubKey: {
            asm: 'OP_1 PUSH20 0x' + crypto.randomBytes(20).toString('hex'),
            hex: '5114' + crypto.randomBytes(20).toString('hex'),
            type: 'witness_v1_taproot',
            address: generateMockAddress(),
          }
        });
      }
      
      // Last output gets the remainder
      outputs.push({
        value: remaining,
        address: generateMockAddress(),
        scriptPubKey: {
          asm: 'OP_1 PUSH20 0x' + crypto.randomBytes(20).toString('hex'),
          hex: '5114' + crypto.randomBytes(20).toString('hex'),
          type: 'witness_v1_taproot',
          address: generateMockAddress(),
        }
      });
      
      return {
        txid: generateRandomTxid(),
        hash: generateRandomTxid(),
        version: 2,
        size: 222 + (inputCount * 150) + (outputCount * 80),
        vsize: 141 + (inputCount * 100) + (outputCount * 50),
        weight: 564 + (inputCount * 400) + (outputCount * 200),
        locktime: 0,
        inputs,
        outputs,
        fee,
        hex: crypto.randomBytes(300).toString('hex')
      };
    },
    
    // Create a mock transaction history
    createMockTransactionHistory: (count = 20) => {
      const history = [];
      const endTime = Date.now();
      const startTime = endTime - (86400000 * 30); // 30 days ago
      
      for (let i = 0; i < count; i++) {
        const timestamp = startTime + Math.floor(Math.random() * (endTime - startTime));
        const txType = Math.random() > 0.5 ? 'buy' : 'sell';
        const amount = Math.floor(Math.random() * 100000) + 1000;
        
        history.push({
          txid: generateRandomTxid(),
          type: txType,
          amount,
          timestamp,
          status: Math.random() > 0.9 ? 'pending' : 'confirmed',
          confirmations: Math.floor(Math.random() * 100) + 1,
          address: generateMockAddress(),
          fee: Math.floor(amount * 0.01)
        });
      }
      
      // Sort by timestamp, most recent first
      return history.sort((a, b) => b.timestamp - a.timestamp);
    }
  },
  
  blockchain: {
    // Create mock blockchain info
    createMockBlockchainInfo: () => {
      const currentHeight = 800000 + Math.floor(Math.random() * 10000);
      
      return {
        chain: config.bitcoin.network,
        blocks: currentHeight,
        headers: currentHeight,
        bestblockhash: generateRandomTxid(),
        difficulty: 35364065900.77557,
        mediantime: Math.floor(Date.now() / 1000) - 300,
        verificationprogress: 0.9999952457086625,
        initialblockdownload: false,
        chainwork: '00000000000000000000000000000000000000002a39f3a16278a09cb6d30f47',
        size_on_disk: 409392436129,
        pruned: false,
        warnings: ''
      };
    },
    
    // Create mock fee estimates
    createMockFeeEstimates: () => {
      return {
        '1': Math.random() * 10 + 15,   // High priority (1 block)
        '6': Math.random() * 5 + 8,     // Medium priority (6 blocks)
        '24': Math.random() * 3 + 3,    // Low priority (24 blocks)
        '144': Math.random() * 1 + 1,   // Minimum (144 blocks)
      };
    }
  }
};

/**
 * Generates a random transaction ID
 * @returns {string} Random transaction ID
 */
function generateRandomTxid() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a mock Bitcoin address
 * @param {string} type - Address type
 * @returns {string} Random address
 */
function generateMockAddress(type = 'taproot') {
  if (type === 'taproot') {
    return `tb1p${crypto.randomBytes(38).toString('hex')}`;
  } else if (type === 'segwit') {
    return `tb1q${crypto.randomBytes(38).toString('hex')}`;
  } else if (type === 'legacy') {
    return `m${crypto.randomBytes(33).toString('base64').replace(/[+/=]/g, '')}`;
  }
  
  // Default to taproot
  return `tb1p${crypto.randomBytes(38).toString('hex')}`;
}

/**
 * Transitions service mode between real and mock modes
 * @param {string} newMode - New service mode ('real', 'mock', or 'hybrid')
 * @param {Object} serviceOverrides - Specific service mode overrides
 * @returns {Object} Current service status
 */
function transitionServiceMode(newMode, serviceOverrides = {}) {
  const validModes = ['real', 'mock', 'hybrid'];
  
  if (!validModes.includes(newMode)) {
    throw new Error(`Invalid service mode: ${newMode}. Must be one of: ${validModes.join(', ')}`);
  }
  
  // Update global mode
  serviceStatus.mode = newMode;
  serviceStatus.transitionTimestamp = Date.now();
  serviceStatus.lastStatusChange = Date.now();
  
  // Apply service-specific overrides
  Object.keys(serviceOverrides).forEach(serviceName => {
    const mode = serviceOverrides[serviceName];
    
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode for service ${serviceName}: ${mode}`);
    }
    
    serviceStatus.services[serviceName] = {
      mode,
      since: Date.now()
    };
  });
  
  // Log transition for audit
  console.log(`Transitioned service mode to ${newMode} with overrides:`, serviceOverrides);
  
  return getServiceStatus();
}

/**
 * Gets current service mode status
 * @returns {Object} Current service status
 */
function getServiceStatus() {
  return {
    ...serviceStatus,
    currentTime: Date.now(),
    uptime: Date.now() - serviceStatus.lastStatusChange,
  };
}

/**
 * Determines if a specific service should use mock mode
 * @param {string} serviceName - Service name to check
 * @returns {boolean} Whether to use mock mode
 */
function shouldUseMock(serviceName) {
  // Check for service-specific override
  if (serviceStatus.services[serviceName]) {
    const serviceConfig = serviceStatus.services[serviceName];
    
    if (serviceConfig.mode === 'mock') {
      return true;
    } else if (serviceConfig.mode === 'real') {
      return false;
    }
    // For 'hybrid', fall through to global mode check
  }
  
  // Check global mode
  return serviceStatus.mode === 'mock' || 
         (serviceStatus.mode === 'hybrid' && Math.random() > 0.7); // 30% mock in hybrid mode
}

/**
 * Creates a mock data fallback for a real service function
 * @param {Function} realFn - Real implementation function
 * @param {Function} mockFn - Mock implementation function
 * @param {string} serviceName - Service name for tracking
 * @returns {Function} Function that will use either real or mock implementation
 */
function createFallbackFunction(realFn, mockFn, serviceName) {
  return async (...args) => {
    try {
      // Determine whether to use mock based on service status
      if (shouldUseMock(serviceName)) {
        console.log(`Using mock implementation for ${serviceName}`);
        return await mockFn(...args);
      }
      
      // Attempt real implementation
      return await realFn(...args);
    } catch (error) {
      console.warn(`Error in real implementation of ${serviceName}, falling back to mock:`, error.message);
      
      // Fall back to mock implementation
      return mockFn(...args);
    }
  };
}

/**
 * Loads mock data from a file or creates it if it doesn't exist
 * @param {string} filename - Filename to load from
 * @param {Function} createFn - Function to create mock data if file doesn't exist
 * @returns {any} Loaded or created mock data
 */
function loadOrCreateMockData(filename, createFn) {
  const filePath = path.join(config.paths.dataDir, 'mock', filename);
  
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Try to load existing file
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data;
    }
    
    // File doesn't exist, create new mock data
    const mockData = createFn();
    
    // Save to file for future use
    fs.writeFileSync(filePath, JSON.stringify(mockData, null, 2));
    
    return mockData;
  } catch (error) {
    console.error(`Error loading/creating mock data ${filename}:`, error);
    // If all else fails, create fresh mock data but don't save it
    return createFn();
  }
}

module.exports = {
  // Mode management functions
  transitionServiceMode,
  getServiceStatus,
  shouldUseMock,
  createFallbackFunction,
  
  // Mock data loading and generation
  loadOrCreateMockData,
  mockDataTemplates,
  
  // Helper functions
  generateRandomTxid,
  generateMockAddress
}; 