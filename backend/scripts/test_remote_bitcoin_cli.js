/**
 * Test script for remote Bitcoin CLI execution
 * 
 * This script tests the remote Bitcoin CLI execution functionality
 * added to the commandExecutionService.js file.
 */

// Set environment to development for testing
process.env.NODE_ENV = 'development';

// Load the command execution service
const commandService = require('../api/services/commandExecutionService');

// Load the configuration service (for debugging)
const config = require('../api/services/configService');

// Log the current config for debugging
console.log('Current configuration:');
console.log(`- Bitcoin CLI Path: ${config.bitcoin.bitcoinCliPath}`);
console.log(`- Bitcoin Network: ${config.bitcoin.network}`);
console.log(`- Current Environment: ${process.env.NODE_ENV}`);
console.log(`- Remote Execution: ${process.env.USE_REMOTE_BITCOIN_CLI || 'Not explicitly set'}`);

// Test the Bitcoin CLI wrapper
async function testBitcoinCliExecution() {
  console.log('\n===== Testing Bitcoin CLI Execution =====');
  
  try {
    // First test regular command execution
    console.log('\nTesting executeBitcoinCommand:');
    const blockchainInfo = await commandService.executeBitcoinCommand('getblockchaininfo');
    console.log('Blockchain Info Chain:', blockchainInfo.chain);
    console.log('Blockchain Info Blocks:', blockchainInfo.blocks);
    
    // Test remote execution specifically
    console.log('\nTesting executeRemoteBitcoinCommand:');
    const networkInfo = await commandService.executeRemoteBitcoinCommand('getnetworkinfo');
    console.log('Network Info Version:', networkInfo.version);
    console.log('Network Info Subversion:', networkInfo.subversion);
    
    // Test UTXO listing
    console.log('\nTesting listunspent command:');
    const utxos = await commandService.executeBitcoinCommand('listunspent 0 9999999');
    console.log(`UTXO Count: ${Array.isArray(utxos) ? utxos.length : 'Not an array'}`);
    if (Array.isArray(utxos) && utxos.length > 0) {
      console.log('First UTXO:', JSON.stringify(utxos[0], null, 2));
    }
    
    console.log('\n===== All tests completed successfully =====');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the tests
testBitcoinCliExecution(); 