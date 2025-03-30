#!/usr/bin/env node

/**
 * LP Runes Distribution Script
 * 
 * This script automates the process of distributing Runes tokens to the LP wallet
 * for trading simulation. It prepares PSBTs, handles wallet signing, and tracks
 * distribution progress.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');

// Configuration
const config = {
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3030',
  runeId: process.env.RUNE_ID || '240249:101',
  // Replace single LP address with an array of addresses
  lpAddresses: [
    process.env.PRIMARY_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
    process.env.SECONDARY_LP_ADDRESS || 'tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz',
    process.env.TERTIARY_LP_ADDRESS || 'tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh',
  ],
  distributionWeights: [0.5, 0.3, 0.2], // Proportional distribution
  // Legacy single LP address for backward compatibility
  lpAddress: process.env.LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
  amount: process.env.AMOUNT ? parseInt(process.env.AMOUNT) : 210000, // 10% of total supply
  outputDir: process.env.OUTPUT_DIR || path.join(__dirname, '../data/lp-distribution'),
  // Batch size optimization parameters
  batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE) : 5000, // Reduced from 50000
  minBatchSize: process.env.MIN_BATCH_SIZE ? parseInt(process.env.MIN_BATCH_SIZE) : 1000, // Don't create batches smaller than this
  maxBatchesPerRun: process.env.MAX_BATCHES_PER_RUN ? parseInt(process.env.MAX_BATCHES_PER_RUN) : 3, // Limit batches per execution
  dustLimit: 546, // BTC dust limit in satoshis
};

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Create readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Makes API requests with error handling
 * @param {string} endpoint - API endpoint
 * @param {object} options - Axios options
 * @returns {Promise<any>} - API response
 */
async function makeApiRequest(endpoint, options = {}) {
  try {
    const url = `${config.apiBaseUrl}${endpoint}`;
    const response = await axios({
      url,
      ...options,
      timeout: 30000, // 30 second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`API request failed: ${endpoint}`, error.message);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Gets rune info to verify connection and parameters
 * @returns {Promise<object>} - Rune info
 */
async function getRuneInfo() {
  try {
    const response = await makeApiRequest(`/rune/${config.runeId}`);
    return response;
  } catch (error) {
    console.error("Failed to get rune info. Is the API running?");
    process.exit(1);
  }
}

/**
 * Gets current rune distribution info
 * @returns {Promise<object>} - Distribution statistics
 */
async function getDistributionStats() {
  try {
    const response = await makeApiRequest(`/rune/${config.runeId}/distribution`);
    return response.distributionStats;
  } catch (error) {
    console.log("Failed to get distribution stats, returning default values");
    return {
      totalSupply: 2100000,
      treasuryHeld: 1890000,
      lpHeld: 0,
      distributed: 210000,
      percentDistributed: 10,
      percentInLP: 0
    };
  }
}

/**
 * Prepares PSBTs for LP distribution
 * @param {number} amount - Amount to distribute
 * @param {string} lpAddress - LP address to receive tokens (optional)
 * @returns {Promise<string[]>} - Array of PSBT strings
 */
async function prepareLPDistributionPSBTs(amount, lpAddress = config.lpAddress) {
  try {
    const response = await makeApiRequest('/rune/prepare-lp-distribution', {
      method: 'POST',
      data: {
        runeId: config.runeId,
        amount: amount,
        lpAddress: lpAddress
      }
    });
    
    return response.psbts || [];
  } catch (error) {
    console.error(`Failed to prepare LP distribution PSBTs for address ${lpAddress}`);
    throw error;
  }
}

/**
 * Saves PSBTs to files
 * @param {string[]} psbts - Array of PSBT strings
 * @returns {string[]} - Array of file paths
 */
function savePSBTsToFiles(psbts) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePaths = [];
  
  for (let i = 0; i < psbts.length; i++) {
    const filePath = path.join(config.outputDir, `lp_distribution_${timestamp}_${i}.psbt`);
    fs.writeFileSync(filePath, psbts[i]);
    filePaths.push(filePath);
  }
  
  return filePaths;
}

/**
 * Prompts user for confirmation
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} - User confirmation
 */
function promptForConfirmation(message) {
  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Executes a shell command
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @returns {Promise<{stdout: string, stderr: string}>} - Command output
 */
function executeCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    exec(command + (args.length > 0 ? ' ' + args.join(' ') : ''), (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Analyzes a PSBT file
 * @param {string} psbtFilePath - Path to PSBT file
 * @returns {Promise<object>} - PSBT analysis
 */
async function analyzePSBT(psbtFilePath) {
  try {
    // Read file content first, then pass as argument
    const psbtContent = fs.readFileSync(psbtFilePath, 'utf8');
    
    // Validate PSBT content before processing
    if (!psbtContent || typeof psbtContent !== 'string') {
      throw new Error('Invalid PSBT: empty or wrong format');
    }

    if (psbtContent.length > 1000000) { // 1MB limit
      throw new Error('PSBT exceeds maximum size');
    }
    
    // Use the safer command execution approach
    const { stdout } = await executeCommand('bitcoin-cli', ['analyzepsbt', psbtContent]);
    return JSON.parse(stdout);
  } catch (error) {
    console.error("Failed to analyze PSBT:", error);
    throw error;
  }
}

/**
 * Estimates fees for a PSBT
 * @param {string} psbtFilePath - Path to PSBT file
 * @returns {Promise<number>} - Estimated fee in satoshis
 */
async function estimatePSBTFee(psbtFilePath) {
  try {
    const analysis = await analyzePSBT(psbtFilePath);
    return analysis.fee || 0;
  } catch (error) {
    console.error("Failed to estimate PSBT fee:", error);
    return 0;
  }
}

/**
 * Distributes tokens to multiple LP addresses based on configuration weights
 * @param {number} totalAmount - Total amount to distribute
 * @returns {Promise<Array>} - Results for each LP distribution
 */
async function distributeToMultipleLPs(totalAmount) {
  console.log(`\n📊 Planning to distribute ${totalAmount} tokens across ${config.lpAddresses.length} LP addresses`);
  
  // Validate weights sum to 1.0
  const weightSum = config.distributionWeights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    console.warn(`Warning: Distribution weights sum to ${weightSum}, not 1.0. Normalizing...`);
    // Normalize weights
    config.distributionWeights = config.distributionWeights.map(w => w / weightSum);
  }
  
  // Calculate amounts per LP based on weights
  const amounts = config.lpAddresses.map((_, index) => 
    Math.floor(totalAmount * config.distributionWeights[index])
  );
  
  // Adjust for rounding errors to ensure total = totalAmount
  const amountSum = amounts.reduce((sum, amt) => sum + amt, 0);
  if (amountSum < totalAmount) {
    // Add remaining amount to the first address
    amounts[0] += (totalAmount - amountSum);
  }
  
  console.log("Distribution plan:");
  config.lpAddresses.forEach((address, index) => {
    console.log(`  ${address}: ${amounts[index]} tokens (${(config.distributionWeights[index] * 100).toFixed(1)}%)`);
  });
  
  // Distribution logic with error handling
  const results = [];
  for (let i = 0; i < config.lpAddresses.length; i++) {
    try {
      console.log(`\n== Processing LP Address ${i+1}/${config.lpAddresses.length} ==`);
      console.log(`Address: ${config.lpAddresses[i]}`);
      console.log(`Amount: ${amounts[i]} tokens`);
      
      if (amounts[i] <= 0) {
        console.log("Skipping (zero amount)");
        results.push({ 
          address: config.lpAddresses[i], 
          amount: amounts[i],
          message: "Skipped (zero amount)",
          success: true 
        });
        continue;
      }
      
      console.log("🔄 Preparing PSBTs...");
      const psbts = await prepareLPDistributionPSBTs(amounts[i], config.lpAddresses[i]);
      console.log(`Created ${psbts.length} PSBTs for this address`);
      
      // Save PSBTs to files
      const psbtFiles = savePSBTsToFiles(psbts);
      
      // Add address identifier to filenames for clarity
      psbtFiles.forEach((file, idx) => {
        const shortAddress = config.lpAddresses[i].substring(0, 8);
        const newFilename = file.replace('.psbt', `_${shortAddress}.psbt`);
        fs.renameSync(file, newFilename);
        psbtFiles[idx] = newFilename;
      });
      
      console.log(`PSBTs saved to ${config.outputDir}`);
      
      results.push({ 
        address: config.lpAddresses[i], 
        psbts, 
        files: psbtFiles,
        amount: amounts[i],
        success: true 
      });
    } catch (error) {
      console.error(`Failed to distribute to ${config.lpAddresses[i]}:`, error);
      results.push({ 
        address: config.lpAddresses[i], 
        error: error.message, 
        amount: amounts[i],
        success: false 
      });
    }
  }
  
  return results;
}

/**
 * Gets available testnet funds from treasury wallet
 * @returns {Promise<number>} - Available satoshis
 */
async function getAvailableTestnetFunds() {
  try {
    const { stdout } = await executeCommand('bitcoin-cli', ['getbalance']);
    // Convert BTC to satoshis (1 BTC = 100,000,000 satoshis)
    return Math.floor(parseFloat(stdout) * 100000000);
  } catch (error) {
    console.warn("Failed to get wallet balance, using fallback value:", error);
    // Return a fallback value - assuming minimal funds for testnet
    return 10000000; // 0.1 BTC in satoshis as fallback
  }
}

/**
 * Estimates the average fee per batch based on historical data or calculations
 * @returns {Promise<number>} - Estimated fee in satoshis
 */
async function estimateAverageFeePerBatch() {
  try {
    // First try to get the current fee rate
    const { stdout } = await executeCommand('bitcoin-cli', ['estimatesmartfee', '6']);
    const feeResponse = JSON.parse(stdout);
    
    if (feeResponse.feerate) {
      // Convert BTC/kB to satoshis and estimate for a typical PSBT size
      const feeRatePerByte = (feeResponse.feerate * 100000000) / 1024; // sats per byte
      const typicalTransactionSize = 250; // bytes, simple transaction
      return Math.ceil(feeRatePerByte * typicalTransactionSize);
    }
  } catch (error) {
    console.warn("Failed to estimate fee from node, using fallback calculation:", error);
  }
  
  // Fallback to a reasonable testnet fee estimate
  return 2000; // 2000 satoshis as a conservative estimate for testnet
}

/**
 * Calculates optimal batch size based on available funds and constraints
 * @param {number} remainingAmount - Total amount of tokens to distribute
 * @returns {Promise<number>} - Optimal batch size
 */
async function calculateOptimalBatchSize(remainingAmount) {
  // Calculate optimal batch size based on available funds
  const feeEstimate = await estimateAverageFeePerBatch();
  const availableSats = await getAvailableTestnetFunds();
  
  console.log(`Available funds: ${availableSats} satoshis (${(availableSats / 100000000).toFixed(8)} BTC)`);
  console.log(`Estimated fee per batch: ${feeEstimate} satoshis`);
  
  // Calculate how many batches we can afford with current funds
  // Each transaction needs at least the fee + dust limit
  const costPerTransaction = feeEstimate + config.dustLimit;
  const maxBatchesPossible = Math.floor(availableSats / costPerTransaction);
  
  console.log(`Maximum affordable batches: ${maxBatchesPossible}`);
  
  // Limit to config.maxBatchesPerRun
  const batchesToUse = Math.min(maxBatchesPossible, config.maxBatchesPerRun);
  
  // Calculate optimal size per batch
  let optimalBatchSize;
  
  if (batchesToUse <= 0) {
    // Not enough funds for even one batch at current fee rates
    console.warn("⚠️ Warning: Insufficient funds for distribution at current fee rates");
    // Return minimum batch size as fallback
    optimalBatchSize = config.minBatchSize;
  } else {
    // Calculate a batch size that distributes the tokens evenly across the affordable batches
    const calculatedSize = Math.ceil(remainingAmount / batchesToUse);
    
    // Ensure batch size is within constraints
    optimalBatchSize = Math.min(
      config.batchSize, // Never exceed max batch size
      Math.max(
        config.minBatchSize, // Never go below min batch size
        calculatedSize // Use calculated size if it's in range
      )
    );
  }
  
  console.log(`Optimized batch size: ${optimalBatchSize} tokens based on available funds`);
  return optimalBatchSize;
}

/**
 * Processes distribution in batches
 * @returns {Promise<void>}
 */
async function processBatchDistribution() {
  try {
    console.log("🔍 Checking rune info and distribution stats...");
    const runeInfo = await getRuneInfo();
    const stats = await getDistributionStats();
    
    console.log("\n== RUNE DISTRIBUTION INFO ==");
    console.log(`Rune ID: ${config.runeId}`);
    console.log(`Total Supply: ${stats.totalSupply}`);
    console.log(`Treasury Held: ${stats.treasuryHeld} (${(stats.treasuryHeld / stats.totalSupply * 100).toFixed(2)}%)`);
    console.log(`LP Wallets Held: ${stats.lpHeld} (${(stats.lpHeld / stats.totalSupply * 100).toFixed(2)}%)`);
    console.log(`Already Distributed: ${stats.distributed} (${stats.percentDistributed}%)`);
    
    // Show distribution across LP addresses
    console.log("\n== LIQUIDITY POOL CONFIGURATION ==");
    console.log("LP Addresses:");
    config.lpAddresses.forEach((address, index) => {
      console.log(`  LP ${index+1}: ${address} (${(config.distributionWeights[index] * 100).toFixed(1)}%)`);
    });
    
    const remainingAmount = config.amount - stats.lpHeld;
    if (remainingAmount <= 0) {
      console.log("\n✅ The LP wallets already have the target amount or more. No distribution needed.");
      rl.close();
      return;
    }
    
    console.log(`\n📊 Planning to distribute a total of ${remainingAmount} tokens to LP wallets`);
    
    // Calculate optimal batch size
    console.log("\n== BATCH SIZE OPTIMIZATION ==");
    const optimalBatchSize = await calculateOptimalBatchSize(remainingAmount);
    
    // Calculate number of batches with optimal size
    const numBatches = Math.ceil(remainingAmount / optimalBatchSize);
    console.log(`This will be done in ${numBatches} batch(es) of up to ${optimalBatchSize} tokens each`);
    
    // Provide a summary of the plan for user confirmation
    console.log("\n== DISTRIBUTION PLAN ==");
    console.log(`Total tokens: ${remainingAmount}`);
    console.log(`Batch size: ${optimalBatchSize}`);
    console.log(`Number of batches: ${numBatches}`);
    console.log(`LP addresses: ${config.lpAddresses.length}`);
    
    const shouldContinue = await promptForConfirmation("Do you want to continue with the distribution?");
    if (!shouldContinue) {
      console.log("❌ Distribution canceled by user");
      rl.close();
      return;
    }
    
    // Process each batch
    let totalProcessed = 0;
    for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
      const batchAmount = Math.min(optimalBatchSize, remainingAmount - totalProcessed);
      console.log(`\n== Processing Batch ${batchIndex + 1}/${numBatches} (${batchAmount} tokens) ==`);
      
      // Use new multi-LP distribution
      const distributionResults = await distributeToMultipleLPs(batchAmount);
      
      // Estimate fees for all PSBTs
      let totalFees = 0;
      let allPsbtFiles = [];
      
      // Collect all PSBT files from the distribution
      distributionResults.forEach(result => {
        if (result.success && result.files) {
          allPsbtFiles = allPsbtFiles.concat(result.files);
        }
      });
      
      for (const file of allPsbtFiles) {
        const fee = await estimatePSBTFee(file);
        totalFees += fee;
      }
      
      console.log(`\nEstimated total fees: ${totalFees} satoshis (${(totalFees / 100000000).toFixed(8)} BTC)`);
      
      // Ask user to sign PSBTs manually for now
      console.log("\n⚠️ Please sign these PSBTs with your wallet and then broadcast them");
      console.log(`PSBT files are located at: ${config.outputDir}`);
      
      // Summarize success/failure for this batch
      const successCount = distributionResults.filter(r => r.success).length;
      const failureCount = distributionResults.length - successCount;
      
      console.log(`\nBatch summary: ${successCount} successful, ${failureCount} failed distributions`);
      
      // If this is the last batch, don't ask for confirmation to proceed
      if (batchIndex < numBatches - 1) {
        const shouldProceedToNextBatch = await promptForConfirmation("Proceed to next batch?");
        if (!shouldProceedToNextBatch) {
          console.log("❌ Distribution paused by user. Remaining batches not processed.");
          break;
        }
      }
      
      totalProcessed += batchAmount;
    }
    
    console.log("\n✅ LP distribution process completed!");
    console.log(`Total tokens processed: ${totalProcessed}`);
    
    rl.close();
  } catch (error) {
    console.error("Error during distribution process:", error);
    rl.close();
    process.exit(1);
  }
}

// Main execution
console.log("=== OTORI•VISION•TOKEN LP Distribution Tool ===");
console.log("This tool helps distribute OVT runes to the LP wallet for trading simulation");
processBatchDistribution().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 