/**
 * Test script for Rune transfers
 * 
 * This script tests the Rune transfer functionality in the trading service.
 */

const tradingService = require('../services/tradingService');

// Test recipient address (should be a valid Bitcoin signet address)
const TEST_RECIPIENT = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_AMOUNT = 10; // Small amount for testing

// Enable color output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Output formatting helpers
function log(msg) {
  console.log(`${colors.blue}[Test]${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}[Success]${colors.reset} ${msg}`);
}

function error(msg) {
  console.log(`${colors.red}[Error]${colors.reset} ${msg}`);
}

function warning(msg) {
  console.log(`${colors.yellow}[Warning]${colors.reset} ${msg}`);
}

/**
 * Test the Rune balance function
 */
async function testRuneBalance() {
  log('Testing getRuneBalance function...');
  
  try {
    const balance = await tradingService.getRuneBalance(process.env.LP_ADDRESS);
    success(`Rune balance: ${balance}`);
    return true;
  } catch (err) {
    error(`Failed to get rune balance: ${err.message}`);
    return false;
  }
}

/**
 * Test the Rune transfer function directly
 */
async function testRuneTransfer() {
  log(`Testing transferRunes function with recipient ${TEST_RECIPIENT} and amount ${TEST_AMOUNT}...`);
  
  try {
    const result = await tradingService.transferRunes(TEST_RECIPIENT, TEST_AMOUNT);
    success(`Rune transfer successful: ${JSON.stringify(result)}`);
    
    // Verify the transaction
    log(`Verifying transaction ${result.txid}...`);
    const verification = await tradingService.verifyRuneTransfer(result.txid);
    
    if (verification.success) {
      success(`Transaction verified: ${JSON.stringify(verification)}`);
    } else {
      warning(`Could not verify transaction: ${verification.error}`);
    }
    
    return result.txid;
  } catch (err) {
    error(`Failed to transfer runes: ${err.message}`);
    return null;
  }
}

/**
 * Test the transferTokensFromLP function
 */
async function testTokenTransfer() {
  log(`Testing transferTokensFromLP function with recipient ${TEST_RECIPIENT} and amount ${TEST_AMOUNT}...`);
  
  try {
    const result = await tradingService.transferTokensFromLP({
      recipient: TEST_RECIPIENT,
      amount: TEST_AMOUNT
    });
    
    success(`Token transfer successful: ${JSON.stringify(result)}`);
    return result.txid;
  } catch (err) {
    error(`Failed to transfer tokens: ${err.message}`);
    return null;
  }
}

/**
 * Test the buy order execution
 */
async function testBuyOrder() {
  log(`Testing executeBuyOrder function with recipient ${TEST_RECIPIENT} and amount ${TEST_AMOUNT}...`);
  
  try {
    const result = await tradingService.executeBuyOrder({
      price: 250,
      amount: TEST_AMOUNT,
      address: TEST_RECIPIENT
    });
    
    success(`Buy order executed: ${JSON.stringify(result)}`);
    return result.txid;
  } catch (err) {
    error(`Failed to execute buy order: ${err.message}`);
    return null;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  log('Starting Rune transfer tests...');
  
  // Test balance check
  const balanceResult = await testRuneBalance();
  
  if (!balanceResult) {
    warning('Skipping transfer tests due to balance check failure');
    return;
  }
  
  // Test rune transfer directly
  const transferTxid = await testRuneTransfer();
  
  if (!transferTxid) {
    warning('Direct rune transfer failed, still testing other methods');
  }
  
  // Test token transfer through service
  const tokenTxid = await testTokenTransfer();
  
  if (!tokenTxid) {
    warning('Token transfer failed, still testing buy order');
  }
  
  // Test buy order execution
  const buyTxid = await testBuyOrder();
  
  if (!buyTxid) {
    warning('Buy order execution failed');
  }
  
  // Summary
  log('Test summary:');
  if (balanceResult) success('✓ Rune balance check');
  else error('✗ Rune balance check');
  
  if (transferTxid) success(`✓ Direct rune transfer (txid: ${transferTxid})`);
  else error('✗ Direct rune transfer');
  
  if (tokenTxid) success(`✓ Token transfer (txid: ${tokenTxid})`);
  else error('✗ Token transfer');
  
  if (buyTxid) success(`✓ Buy order execution (txid: ${buyTxid})`);
  else error('✗ Buy order execution');
}

// Run tests
runTests().catch(err => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
}); 