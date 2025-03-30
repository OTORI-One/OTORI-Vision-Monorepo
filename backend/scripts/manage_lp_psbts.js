#!/usr/bin/env node

/**
 * LP PSBTs Management Script
 * 
 * This script helps with managing and processing PSBTs for the LP wallet.
 * It can:
 * - List available PSBTs
 * - Check PSBT details
 * - Estimate fees
 * - Sign PSBTs (if wallet is available)
 * - Broadcast signed PSBTs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Configuration
const config = {
  dataDir: process.env.DATA_DIR || path.join(__dirname, '../data/lp-distribution'),
  bitcoinCliPath: process.env.BITCOIN_CLI_PATH || 'bitcoin-cli',
  network: process.env.NETWORK || 'testnet',
  walletName: process.env.WALLET_NAME || '',
  // UTXO management parameters
  smallUtxoThreshold: process.env.SMALL_UTXO_THRESHOLD ? parseInt(process.env.SMALL_UTXO_THRESHOLD) : 10000, // 10,000 sats threshold for "small" UTXOs
  dustLimit: 546, // BTC dust limit in satoshis
  preferSmallUtxos: process.env.PREFER_SMALL_UTXOS !== 'false', // Default to true
};

// Create readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompts the user with a question
 * @param {string} question - The question to ask
 * @returns {Promise<string>} - User's answer
 */
function promptUser(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Executes a bitcoin-cli command
 * @param {string} command - Command to execute
 * @returns {string} - Command output
 */
function executeBitcoinCommand(command) {
  try {
    let fullCommand = `${config.bitcoinCliPath}`;
    
    if (config.network === 'testnet') {
      fullCommand += ' -testnet';
    }
    
    if (config.walletName) {
      fullCommand += ` -rpcwallet=${config.walletName}`;
    }
    
    fullCommand += ` ${command}`;
    
    return execSync(fullCommand).toString().trim();
  } catch (error) {
    console.error(`Error executing bitcoin command: ${error.message}`);
    if (error.stderr) {
      console.error(`stderr: ${error.stderr.toString()}`);
    }
    throw error;
  }
}

/**
 * Lists all PSBT files in the data directory
 * @returns {string[]} - Array of PSBT file paths
 */
function listPSBTFiles() {
  try {
    const files = fs.readdirSync(config.dataDir)
      .filter(file => file.endsWith('.psbt'))
      .map(file => path.join(config.dataDir, file));
    
    return files;
  } catch (error) {
    console.error(`Error listing PSBT files: ${error.message}`);
    return [];
  }
}

/**
 * Analyzes a PSBT file
 * @param {string} psbtFilePath - Path to PSBT file
 * @returns {object} - PSBT analysis
 */
function analyzePSBT(psbtFilePath) {
  try {
    const psbt = fs.readFileSync(psbtFilePath, 'utf8');
    const result = executeBitcoinCommand(`analyzepsbt ${psbt}`);
    return JSON.parse(result);
  } catch (error) {
    console.error(`Error analyzing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Gets all UTXOs from the wallet
 * @returns {Promise<Array>} - List of UTXOs
 */
async function getWalletUtxos() {
  try {
    const listUnspentCmd = 'listunspent 0 9999999';
    const utxoJson = executeBitcoinCommand(listUnspentCmd);
    
    // Parse the JSON response
    const utxos = JSON.parse(utxoJson);
    
    console.log(`Found ${utxos.length} UTXOs in wallet`);
    
    // Group UTXOs by size for analysis
    const smallUtxos = utxos.filter(u => u.amount * 100000000 < config.smallUtxoThreshold);
    const largeUtxos = utxos.filter(u => u.amount * 100000000 >= config.smallUtxoThreshold);
    
    console.log(`UTXO breakdown: ${smallUtxos.length} small, ${largeUtxos.length} large`);
    
    // Convert BTC amounts to satoshis for easier handling
    return {
      utxos: utxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        address: utxo.address,
        value: Math.floor(utxo.amount * 100000000), // Convert BTC to satoshis
        confirmations: utxo.confirmations,
        spendable: utxo.spendable,
        scriptPubKey: utxo.scriptPubKey,
        raw: utxo // Keep original for reference
      })),
      smallCount: smallUtxos.length,
      largeCount: largeUtxos.length
    };
  } catch (error) {
    console.error(`Error getting wallet UTXOs: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the balance of a specific address by filtering UTXOs
 * @param {string} address - Bitcoin address to check
 * @returns {Promise<number>} - Balance in satoshis
 */
async function getAddressBalance(address) {
  try {
    if (!address) {
      throw new Error('Address is required');
    }
    
    // Validate address format
    if (!address.startsWith('tb1') && !address.startsWith('bc1') && 
        !address.startsWith('1') && !address.startsWith('3')) {
      throw new Error(`Invalid address format: ${address}`);
    }
    
    // Get UTXOs and filter by address
    const utxoData = await getWalletUtxos();
    const addressUtxos = utxoData.utxos.filter(utxo => utxo.address === address);
    
    // Sum the values
    const balance = addressUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
    
    return balance;
  } catch (error) {
    console.error(`Error getting balance for address ${address}: ${error.message}`);
    throw error;
  }
}

/**
 * Rebalances funds across multiple LP addresses
 * Ensures no LP address runs out of sats while others have excess
 * @param {string[]} lpAddresses - Array of LP addresses to rebalance
 * @param {Object} options - Options for rebalancing
 * @param {number} options.thresholdPercent - Percentage deviation threshold (default: 30%)
 * @param {number} options.minTransferAmount - Minimum amount to transfer (default: 1000 sats)
 * @returns {Promise<Array>} - Array of rebalancing PSBTs
 */
async function rebalanceLiquidity(lpAddresses, options = {}) {
  const thresholdPercent = options.thresholdPercent || 30;
  const minTransferAmount = options.minTransferAmount || 1000;
  
  try {
    console.log(`Rebalancing liquidity across ${lpAddresses.length} LP addresses...`);
    
    // Validate addresses
    for (const address of lpAddresses) {
      if (!address.startsWith('tb1') && !address.startsWith('bc1') && 
          !address.startsWith('1') && !address.startsWith('3')) {
        throw new Error(`Invalid address format: ${address}`);
      }
    }
    
    // Get balances for all addresses
    console.log('Fetching balances for all addresses...');
    const balanceResults = await Promise.allSettled(
      lpAddresses.map(async address => ({
        address,
        balance: await getAddressBalance(address)
      }))
    );
    
    // Filter out failed balance checks
    const balanceData = balanceResults
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    
    if (balanceData.length < 2) {
      throw new Error('Need at least two LP addresses with valid balances to perform rebalancing');
    }
    
    // Log current balances
    console.log('\nCurrent LP address balances:');
    balanceData.forEach(data => {
      console.log(`${data.address}: ${data.balance} satoshis (${(data.balance / 100000000).toFixed(8)} BTC)`);
    });
    
    // Calculate average and identify imbalances
    const totalBalance = balanceData.reduce((sum, data) => sum + data.balance, 0);
    const averageBalance = Math.floor(totalBalance / balanceData.length);
    const threshold = Math.floor(averageBalance * (thresholdPercent / 100));
    
    console.log(`\nTotal balance: ${totalBalance} satoshis (${(totalBalance / 100000000).toFixed(8)} BTC)`);
    console.log(`Average balance: ${averageBalance} satoshis (${(averageBalance / 100000000).toFixed(8)} BTC)`);
    console.log(`Threshold (${thresholdPercent}%): ${threshold} satoshis`);
    
    // Identify donors (addresses with excess funds) and recipients
    const donors = balanceData
      .filter(data => data.balance > averageBalance + threshold)
      .sort((a, b) => b.balance - a.balance); // Sort richest first
      
    const recipients = balanceData
      .filter(data => data.balance < averageBalance - threshold)
      .sort((a, b) => a.balance - b.balance); // Sort poorest first
    
    console.log(`\nDonor addresses: ${donors.length}`);
    console.log(`Recipient addresses: ${recipients.length}`);
    
    if (donors.length === 0 || recipients.length === 0) {
      console.log('No rebalancing needed. All addresses are within threshold.');
      return [];
    }
    
    // Create rebalancing PSBTs
    const rebalancingPsbts = [];
    for (let i = 0; i < Math.min(donors.length, recipients.length); i++) {
      // Calculate transfer amount
      const transferAmount = Math.min(
        donors[i].balance - averageBalance, // Don't take more than excess
        averageBalance - recipients[i].balance // Don't give more than needed
      );
      
      if (transferAmount > minTransferAmount) {
        console.log(`\nCreating rebalancing PSBT #${i+1}:`);
        console.log(`From: ${donors[i].address} (${donors[i].balance} sats)`);
        console.log(`To: ${recipients[i].address} (${recipients[i].balance} sats)`);
        console.log(`Amount: ${transferAmount} satoshis`);
        
        try {
          // Create the PSBT
          const psbt = await createRebalancingPSBT(
            donors[i].address,
            recipients[i].address,
            transferAmount
          );
          
          // Save the PSBT
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `rebalance_${timestamp}_${i}.psbt`;
          const filePath = path.join(config.dataDir, fileName);
          fs.writeFileSync(filePath, psbt);
          
          rebalancingPsbts.push({
            filePath,
            psbt,
            from: donors[i].address,
            to: recipients[i].address,
            amount: transferAmount
          });
          
          console.log(`Rebalancing PSBT saved to: ${filePath}`);
        } catch (error) {
          console.error(`Error creating rebalancing PSBT: ${error.message}`);
        }
      } else {
        console.log(`\nSkipping transfer from ${donors[i].address} to ${recipients[i].address}`);
        console.log(`Transfer amount (${transferAmount} sats) is below minimum threshold (${minTransferAmount} sats)`);
      }
    }
    
    console.log(`\nCreated ${rebalancingPsbts.length} rebalancing PSBTs`);
    
    return rebalancingPsbts;
  } catch (error) {
    console.error(`Error rebalancing liquidity: ${error.message}`);
    throw error;
  }
}

/**
 * Selects optimal UTXOs for transaction building
 * Prioritizes using smallest UTXOs first to preserve larger ones
 * @param {Array} availableUtxos - Available UTXOs
 * @param {number} targetAmount - Target amount in satoshis
 * @returns {Object} - Selected UTXOs and total value
 */
function selectOptimalUtxos(availableUtxos, targetAmount) {
  // Filter to only spendable UTXOs
  const spendableUtxos = availableUtxos.filter(utxo => utxo.spendable);
  
  if (spendableUtxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }
  
  // Sort UTXOs by value (ascending)
  const sortedUtxos = [...spendableUtxos].sort((a, b) => a.value - b.value);
  
  let selectedUtxos = [];
  let totalValue = 0;
  
  if (config.preferSmallUtxos) {
    // Strategy 1: Prefer small UTXOs to preserve large ones
    // First pass: try to use only small UTXOs if possible
    for (const utxo of sortedUtxos) {
      if (totalValue >= targetAmount) break;
      
      if (utxo.value < config.smallUtxoThreshold) {
        selectedUtxos.push(utxo);
        totalValue += utxo.value;
      }
    }
  } else {
    // Strategy 2: Use a single large UTXO if possible (minimize input count)
    // Find the smallest UTXO that is larger than the target amount
    const singleLargeUtxo = sortedUtxos.find(utxo => utxo.value >= targetAmount);
    if (singleLargeUtxo) {
      selectedUtxos.push(singleLargeUtxo);
      totalValue = singleLargeUtxo.value;
    }
  }
  
  // If the target amount isn't met yet, add more UTXOs regardless of size
  if (totalValue < targetAmount) {
    for (const utxo of sortedUtxos) {
      if (totalValue >= targetAmount) break;
      
      if (!selectedUtxos.includes(utxo)) {
        selectedUtxos.push(utxo);
        totalValue += utxo.value;
      }
    }
  }
  
  return {
    utxos: selectedUtxos,
    totalValue,
    sufficient: totalValue >= targetAmount,
    count: selectedUtxos.length,
    average: selectedUtxos.length > 0 ? totalValue / selectedUtxos.length : 0
  };
}

/**
 * Calculates estimated fee for a transaction with given inputs and outputs
 * @param {number} inputCount - Number of inputs
 * @param {number} outputCount - Number of outputs
 * @param {number} feeRate - Fee rate in satoshis per byte
 * @returns {number} - Estimated fee in satoshis
 */
function calculateEstimatedFee(inputCount, outputCount, feeRate = 2) {
  // Simple fee estimation based on typical input/output sizes
  const bytesPerInput = 140; // Approximate size of a typical input
  const bytesPerOutput = 34; // Approximate size of a typical output
  const overheadBytes = 10; // Transaction overhead
  
  const estimatedSize = overheadBytes + (inputCount * bytesPerInput) + (outputCount * bytesPerOutput);
  return estimatedSize * feeRate;
}

/**
 * Creates a PSBT with optimally selected UTXOs
 * @param {string} recipient - Recipient address
 * @param {number} amount - Amount to send in satoshis
 * @param {number} feeRate - Fee rate in satoshis per byte
 * @returns {Promise<string>} - PSBT hex string
 */
async function createOptimizedPSBT(recipient, amount, feeRate = 2) {
  try {
    console.log(`Creating optimized PSBT: ${amount} satoshis to ${recipient}`);
    
    // Get available UTXOs
    const utxoData = await getWalletUtxos();
    console.log(`Total available UTXOs: ${utxoData.utxos.length}`);
    
    // Calculate necessary value (amount + estimated initial fee)
    // Start with a rough estimate for fee calculation
    const initialFeeEstimate = calculateEstimatedFee(1, 2, feeRate);
    const targetValue = amount + initialFeeEstimate;
    
    // Select optimal UTXOs
    const selection = selectOptimalUtxos(utxoData.utxos, targetValue);
    
    if (!selection.sufficient) {
      throw new Error(`Insufficient funds: needed ${targetValue} satoshis, have ${selection.totalValue} satoshis`);
    }
    
    console.log(`Selected ${selection.count} UTXOs with total value of ${selection.totalValue} satoshis`);
    
    // Refine fee calculation based on actual input count
    const refinedFeeEstimate = calculateEstimatedFee(selection.count, 2, feeRate);
    console.log(`Estimated fee: ${refinedFeeEstimate} satoshis`);
    
    // Calculate change amount (if any)
    const changeAmount = selection.totalValue - amount - refinedFeeEstimate;
    console.log(`Change amount: ${changeAmount} satoshis`);
    
    // Determine if change is needed (above dust limit)
    const needsChange = changeAmount > config.dustLimit;
    
    // Create inputs array for createpsbt command
    const inputs = selection.utxos.map(utxo => (
      `'[{"txid":"${utxo.txid}","vout":${utxo.vout}}]'`
    )).join(' ');
    
    // Create outputs object for createpsbt command
    let outputs = `'{"${recipient}":${amount / 100000000}}'`;
    
    if (needsChange) {
      // Get a change address from the wallet
      const changeAddress = executeBitcoinCommand('getnewaddress "" "bech32"').trim();
      // Add change output
      outputs = `'{"${recipient}":${amount / 100000000},"${changeAddress}":${changeAmount / 100000000}}'`;
    }
    
    // Create the PSBT
    const createPsbtCmd = `createpsbt ${inputs} ${outputs}`;
    const psbt = executeBitcoinCommand(createPsbtCmd).trim();
    
    console.log(`PSBT created successfully: ${psbt.substring(0, 20)}...`);
    return psbt;
  } catch (error) {
    console.error(`Error creating optimized PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a PSBT for rebalancing funds between LP addresses
 * @param {string} fromAddress - Source address
 * @param {string} toAddress - Destination address
 * @param {number} amount - Amount to transfer in satoshis
 * @returns {Promise<string>} - PSBT hex string
 */
async function createRebalancingPSBT(fromAddress, toAddress, amount) {
  try {
    console.log(`Creating rebalancing PSBT: ${amount} satoshis from ${fromAddress} to ${toAddress}`);
    
    // First, find UTXOs belonging to the fromAddress
    const utxoData = await getWalletUtxos();
    const fromAddressUtxos = utxoData.utxos.filter(utxo => utxo.address === fromAddress);
    
    if (fromAddressUtxos.length === 0) {
      throw new Error(`No UTXOs found for address ${fromAddress}`);
    }
    
    console.log(`Found ${fromAddressUtxos.length} UTXOs for address ${fromAddress}`);
    
    // Calculate necessary value (amount + estimated fee)
    const feeEstimate = calculateEstimatedFee(1, 2, 2);
    const targetValue = amount + feeEstimate;
    
    // Select optimal UTXOs from this address
    const selection = selectOptimalUtxos(fromAddressUtxos, targetValue);
    
    if (!selection.sufficient) {
      throw new Error(`Insufficient funds at address ${fromAddress}: needed ${targetValue} satoshis, have ${selection.totalValue} satoshis`);
    }
    
    // Create inputs array for createpsbt command
    const inputs = selection.utxos.map(utxo => (
      `'[{"txid":"${utxo.txid}","vout":${utxo.vout}}]'`
    )).join(' ');
    
    // Calculate change amount
    const refinedFeeEstimate = calculateEstimatedFee(selection.count, 2, 2);
    const changeAmount = selection.totalValue - amount - refinedFeeEstimate;
    
    // Create outputs object for createpsbt command
    let outputs = `'{"${toAddress}":${amount / 100000000}}`;
    
    if (changeAmount > config.dustLimit) {
      outputs += `,"${fromAddress}":${changeAmount / 100000000}`;
    }
    
    outputs += `'`;
    
    // Create the PSBT
    const createPsbtCmd = `createpsbt ${inputs} ${outputs}`;
    const psbt = executeBitcoinCommand(createPsbtCmd).trim();
    
    console.log(`Rebalancing PSBT created successfully`);
    return psbt;
  } catch (error) {
    console.error(`Error creating rebalancing PSBT: ${error.message}`);
    throw error;
  }
}

/**
 * Processes a PSBT
 * @param {string} psbtFilePath - Path to PSBT file
 */
async function processPSBT(psbtFilePath) {
  try {
    console.log(`\nProcessing PSBT: ${path.basename(psbtFilePath)}`);
    
    // Analyze the PSBT
    const analysis = analyzePSBT(psbtFilePath);
    console.log('\nPSBT Analysis:');
    console.log(`Status: ${analysis.complete ? 'Complete' : 'Incomplete'}`);
    console.log(`Inputs: ${analysis.inputs?.length || 0}`);
    console.log(`Outputs: ${analysis.outputs?.length || 0}`);
    console.log(`Estimated fee: ${analysis.fee || 'unknown'} BTC`);
    
    if (analysis.error) {
      console.log(`Error: ${analysis.error}`);
      return;
    }
    
    if (analysis.next === 'signer') {
      const shouldSign = await promptUser('This PSBT needs signing. Sign it now? (y/n): ');
      if (shouldSign.toLowerCase() === 'y') {
        // Attempt to sign the PSBT
        try {
          const psbt = fs.readFileSync(psbtFilePath, 'utf8');
          const signedPsbt = executeBitcoinCommand(`walletprocesspsbt ${psbt}`);
          const signedPsbtObj = JSON.parse(signedPsbt);
          
          if (signedPsbtObj.complete) {
            console.log('PSBT successfully signed!');
            
            // Save the signed PSBT
            const signedFilePath = psbtFilePath.replace('.psbt', '.signed.psbt');
            fs.writeFileSync(signedFilePath, signedPsbtObj.psbt);
            console.log(`Signed PSBT saved to: ${signedFilePath}`);
            
            // Ask if user wants to broadcast
            const shouldBroadcast = await promptUser('Broadcast the signed PSBT now? (y/n): ');
            if (shouldBroadcast.toLowerCase() === 'y') {
              const txid = executeBitcoinCommand(`finalizepsbt ${signedPsbtObj.psbt} true`);
              console.log(`Transaction broadcast! TXID: ${JSON.parse(txid).txid}`);
            }
          } else {
            console.log('PSBT signing incomplete. It may require additional signatures.');
          }
        } catch (error) {
          console.error('Error signing PSBT. Do you have the correct wallet loaded?');
        }
      }
    } else if (analysis.next === 'extractor') {
      // This PSBT is already signed and ready for broadcast
      const shouldBroadcast = await promptUser('This PSBT is ready for broadcast. Broadcast now? (y/n): ');
      if (shouldBroadcast.toLowerCase() === 'y') {
        try {
          const psbt = fs.readFileSync(psbtFilePath, 'utf8');
          const result = executeBitcoinCommand(`finalizepsbt ${psbt} true`);
          console.log(`Transaction broadcast! TXID: ${JSON.parse(result).txid}`);
        } catch (error) {
          console.error('Error broadcasting transaction:', error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Error processing PSBT: ${error.message}`);
  }
}

/**
 * Main menu function
 */
async function showMainMenu() {
  while (true) {
    console.log('\n=== LP PSBT Management Tool ===');
    console.log('1. List all PSBTs');
    console.log('2. Process a specific PSBT');
    console.log('3. Process all unsigned PSBTs');
    console.log('4. Check wallet status');
    console.log('5. Create optimized PSBT');
    console.log('6. Rebalance LP addresses');
    console.log('7. Exit');
    
    const choice = await promptUser('\nEnter your choice (1-7): ');
    
    switch (choice) {
      case '1':
        // List all PSBTs
        const psbtFiles = listPSBTFiles();
        console.log('\nAvailable PSBT files:');
        if (psbtFiles.length === 0) {
          console.log('No PSBT files found.');
        } else {
          psbtFiles.forEach((file, index) => {
            console.log(`${index + 1}. ${path.basename(file)}`);
          });
        }
        break;
        
      case '2':
        // Process a specific PSBT
        const files = listPSBTFiles();
        if (files.length === 0) {
          console.log('No PSBT files found.');
          break;
        }
        
        console.log('\nAvailable PSBT files:');
        files.forEach((file, index) => {
          console.log(`${index + 1}. ${path.basename(file)}`);
        });
        
        const fileIndex = await promptUser(`\nEnter the file number (1-${files.length}): `);
        const selectedIndex = parseInt(fileIndex) - 1;
        
        if (selectedIndex >= 0 && selectedIndex < files.length) {
          await processPSBT(files[selectedIndex]);
        } else {
          console.log('Invalid selection.');
        }
        break;
        
      case '3':
        // Process all unsigned PSBTs
        const allFiles = listPSBTFiles();
        if (allFiles.length === 0) {
          console.log('No PSBT files found.');
          break;
        }
        
        console.log('\nProcessing all PSBTs...');
        let processedCount = 0;
        
        for (const file of allFiles) {
          if (!file.includes('.signed.')) {
            try {
              const analysis = analyzePSBT(file);
              if (!analysis.complete && analysis.next === 'signer') {
                await processPSBT(file);
                processedCount++;
              }
            } catch (error) {
              console.error(`Error processing ${path.basename(file)}: ${error.message}`);
            }
          }
        }
        
        console.log(`\nProcessed ${processedCount} unsigned PSBTs.`);
        break;
        
      case '4':
        // Check wallet status
        try {
          console.log('\nChecking wallet status...');
          
          // Get basic wallet info
          const walletInfo = executeBitcoinCommand('getwalletinfo');
          console.log(walletInfo);
          
          // Get and display UTXO information
          const utxoData = await getWalletUtxos();
          console.log('\nUTXO Information:');
          console.log(`Total UTXOs: ${utxoData.utxos.length}`);
          console.log(`Small UTXOs (<${config.smallUtxoThreshold} sats): ${utxoData.smallCount}`);
          console.log(`Large UTXOs (>=${config.smallUtxoThreshold} sats): ${utxoData.largeCount}`);
          
          // Calculate total value
          const totalValue = utxoData.utxos.reduce((sum, utxo) => sum + utxo.value, 0);
          console.log(`Total value: ${totalValue} satoshis (${(totalValue / 100000000).toFixed(8)} BTC)`);
        } catch (error) {
          console.error('Error checking wallet status. Is bitcoin-cli configured correctly?');
        }
        break;
        
      case '5':
        // Create optimized PSBT
        try {
          const recipient = await promptUser('Enter recipient address: ');
          const amountStr = await promptUser('Enter amount in satoshis: ');
          const amount = parseInt(amountStr);
          
          if (isNaN(amount) || amount <= 0) {
            console.log('Invalid amount. Please enter a positive number.');
            break;
          }
          
          // Confirm with user
          console.log(`\nCreating PSBT to send ${amount} satoshis to ${recipient}`);
          const confirmCreate = await promptUser('Proceed? (y/n): ');
          
          if (confirmCreate.toLowerCase() !== 'y') {
            console.log('Operation cancelled.');
            break;
          }
          
          // Create the optimized PSBT
          const psbt = await createOptimizedPSBT(recipient, amount);
          
          // Save the PSBT to a file
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `optimized_${timestamp}.psbt`;
          const filePath = path.join(config.dataDir, fileName);
          
          fs.writeFileSync(filePath, psbt);
          console.log(`PSBT saved to: ${filePath}`);
          
          // Ask if user wants to process it immediately
          const shouldProcess = await promptUser('Process this PSBT now? (y/n): ');
          if (shouldProcess.toLowerCase() === 'y') {
            await processPSBT(filePath);
          }
        } catch (error) {
          console.error(`Error creating optimized PSBT: ${error.message}`);
        }
        break;
        
      case '6':
        // Rebalance LP addresses
        try {
          console.log('\n=== LP Address Rebalancing ===');
          
          // Get LP addresses from environment or prompt user
          let lpAddresses = [];
          
          if (process.env.LP_ADDRESS) {
            lpAddresses.push(process.env.LP_ADDRESS);
          }
          
          if (process.env.LP_ADDRESS_2) {
            lpAddresses.push(process.env.LP_ADDRESS_2);
          }
          
          if (process.env.LP_ADDRESS_3) {
            lpAddresses.push(process.env.LP_ADDRESS_3);
          }
          
          // If no addresses found in environment, prompt user
          if (lpAddresses.length < 2) {
            console.log('At least two LP addresses needed for rebalancing.');
            let continueAdding = true;
            while (continueAdding && lpAddresses.length < 5) {
              const address = await promptUser(`Enter LP address ${lpAddresses.length + 1}: `);
              if (address) {
                lpAddresses.push(address);
              }
              
              if (lpAddresses.length >= 2) {
                const addMore = await promptUser('Add another address? (y/n): ');
                continueAdding = addMore.toLowerCase() === 'y';
              }
            }
          }
          
          if (lpAddresses.length < 2) {
            console.log('Need at least two LP addresses for rebalancing. Operation cancelled.');
            break;
          }
          
          console.log(`\nRebalancing the following ${lpAddresses.length} LP addresses:`);
          lpAddresses.forEach((addr, idx) => console.log(`${idx + 1}. ${addr}`));
          
          // Let user set threshold
          const thresholdStr = await promptUser('Enter threshold percentage (default 30%): ');
          const threshold = parseInt(thresholdStr) || 30;
          
          // Confirm with user
          const confirmRebalance = await promptUser('\nProceed with rebalancing? (y/n): ');
          if (confirmRebalance.toLowerCase() !== 'y') {
            console.log('Rebalancing cancelled.');
            break;
          }
          
          // Perform rebalancing
          const rebalancePsbts = await rebalanceLiquidity(lpAddresses, { 
            thresholdPercent: threshold 
          });
          
          // Process PSBTs if any created
          if (rebalancePsbts.length > 0) {
            const shouldProcess = await promptUser('\nSign and broadcast rebalancing PSBTs now? (y/n): ');
            if (shouldProcess.toLowerCase() === 'y') {
              for (const item of rebalancePsbts) {
                console.log(`\nProcessing: ${path.basename(item.filePath)}`);
                await processPSBT(item.filePath);
              }
            }
          }
        } catch (error) {
          console.error(`Error performing rebalancing: ${error.message}`);
        }
        break;
        
      case '7':
        // Exit
        console.log('Exiting...');
        rl.close();
        return;
        
      default:
        console.log('Invalid choice. Please try again.');
    }
  }
}

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

// Start the application
console.log('=== OTORI•VISION•TOKEN LP PSBT Management Tool ===');
console.log(`Data directory: ${config.dataDir}`);
console.log(`Network: ${config.network}`);
console.log(`Wallet name: ${config.walletName || 'Default'}`);

// Check bitcoin-cli availability
try {
  const bitcoinCliVersion = execSync(`${config.bitcoinCliPath} --version`).toString();
  console.log(`Bitcoin CLI detected: ${bitcoinCliVersion.split('\n')[0]}`);
} catch (error) {
  console.warn('Warning: bitcoin-cli not found or not accessible. Some features may not work.');
}

showMainMenu().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 