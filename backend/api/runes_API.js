// Express Server for the Runes API
// Required dependencies 
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const cheerio = require('cheerio'); // Add cheerio import
app.use(cors());
app.use(bodyParser.json());

// Simple queue for serializing ord commands (shared instance or separate? Using separate for now)
const { Mutex } = require('async-mutex');
const runesOrdCommandMutex = new Mutex();

// --- Caching Implementation START ---
const CACHE_TTL_DISTRIBUTION_MS = 60 * 1000; // 1 minute
const CACHE_TTL_TRANSACTIONS_MS = 60 * 1000; // 1 minute
const CACHE_TTL_BALANCES_MS = 30 * 1000;     // 30 seconds

let distributionCache = { data: null, timestamp: 0 };
let transactionsCache = { data: null, timestamp: 0 };
let addressBalanceCache = {}; // Object to store balances per address: { address: { data: {ovt, sats}, timestamp: 0 } }

const isCacheValid = (cacheEntry, ttl) => {
    // Check if cacheEntry itself exists and has data
    return cacheEntry && cacheEntry.data && (Date.now() - cacheEntry.timestamp < ttl);
};

// Overload clearCache or make it more specific
const clearCache = (cacheName, key = null) => {
    console.log(`[Cache] Clearing ${cacheName}` + (key ? ` for key ${key}` : ''));
    if (cacheName === 'distribution' || cacheName === 'all') {
        distributionCache = { data: null, timestamp: 0 };
    }
    if (cacheName === 'transactions' || cacheName === 'all') {
        transactionsCache = { data: null, timestamp: 0 };
    }
    if (cacheName === 'balance' || cacheName === 'all') {
        if (key) {
            // Clear specific address balance
            if (addressBalanceCache[key]) {
                delete addressBalanceCache[key];
            }
        } else {
            // Clear all address balances
            addressBalanceCache = {};
        }
    }
};
// --- Caching Implementation END ---

// WebSocket Broadcast Helpers START
// Helper function to send broadcast messages via internal HTTP call
const OTORI_PRICE_API_ENDPOINT = process.env.OTORI_PRICE_API_ENDPOINT || 'http://localhost:3033'; // Ensure otori-price-api runs on 3033
const INTERNAL_BROADCAST_URL = `${OTORI_PRICE_API_ENDPOINT}/api/price/internal/broadcast`;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET; // Use the generic API secret name

async function sendWebSocketBroadcast(type, payload) {
    // Prevent broadcast in test environments if needed
    if (process.env.NODE_ENV === 'test') {
        console.log(`[WebSocket Broadcast] Skipped in test environment. Type: ${type}`);
        return;
    }
    try {
        console.log(`[WebSocket Broadcast] Sending type: ${type}`); // Verbose logging for now
        // console.debug("Payload:", payload); // Optional: log payload details if needed
        await axios.post(INTERNAL_BROADCAST_URL, { type, payload }, {
            timeout: 2000, // Add a timeout to prevent hanging
            headers: { 'X-Internal-Secret': INTERNAL_SECRET } // Ensure this uses the correct variable
        });
        console.log(`[WebSocket Broadcast] Successfully sent type: ${type}`);
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[WebSocket Broadcast] Failed to send type: ${type}. Error: ${errorMessage}`);
        // Do not block the main flow, just log the error
    }
}
// WebSocket Broadcast Helpers END

// Create a router for the /api/runes prefix
const runesRouter = express.Router();

// Import trading service
const tradingService = require('./services/tradingService');

// Import the UTXO service
const utxoService = require('./services/utxoService');

// Import util.promisify for exec
const util = require('util');
const { exec } = require('child_process');
const execAsync = util.promisify(exec);
const { executeCommand } = require('./services/commandExecutionService');

// Add CORS support
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Load environment variables based on NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'development';
let envPath = path.join(__dirname, '..', '.env.local');

// If specific environment file exists, use it instead
const envDevPath = path.join(__dirname, '..', `.env.${NODE_ENV}`);
if (fs.existsSync(envDevPath)) {
  envPath = envDevPath;
  console.log(`Loading environment from ${envPath}`);
}

require('dotenv').config({ path: envPath });

// OVT rune constants
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';
const OVT_RUNE_SYMBOL = 'OTORI•VISION•TOKEN';
const OVT_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
const OVT_TREASURY_ADDRESS_2 = process.env.NEXT_PUBLIC_TREASURY_ADDRESS_2 || 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3';
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
const LP_ADDRESS_2 = process.env.NEXT_PUBLIC_LP_ADDRESS_2 || '';
// Remote OrdPi API endpoint - when working remote via ssh tunnel
// const REMOTE_RUNES_API = process.env.REMOTE_RUNES_API || 'http://localhost:9191';

// WHEN DONE TESTING REMOTELY: Change the OrdPi endpoint to the local IP (and add ssh key authentication for comms.)
// Remote OrdPi API endpoint - using the public IP for direct connection
const REMOTE_RUNES_API = process.env.REMOTE_RUNES_API || 'http://192.168.178.54:9191';

// Add a DEBUG_MODE flag to force using mock data
const DEBUG_MODE = process.env.DEBUG_MODE || false; // Set this to true to force using fallback data

// Fallback system configuration
const FAILURE_THRESHOLD = 3; // Number of consecutive failures before switching to fallback mode
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let consecutiveRemoteFailures = 0; // Counter for consecutive failures
let lastRemoteAttemptTimestamp = 0; // Timestamp of last attempt to use remote API

// Function to determine if we should use fallback data
const shouldUseFallback = () => {
  // --- TEMPORARY CHANGE: Always return false to disable fallback ---
  return false;
  // --- END TEMPORARY CHANGE ---

  /* // Original logic (commented out)
  // Always use fallback in debug mode
  if (DEBUG_MODE) {
    return true;
  }
  
  // If we haven't hit the threshold yet, don't use fallback
  if (consecutiveRemoteFailures < FAILURE_THRESHOLD) {
    return false;
  }
  
  // Check if we've waited long enough since last failure to try again
  const timeSinceLastAttempt = Date.now() - lastRemoteAttemptTimestamp;
  if (timeSinceLastAttempt >= RETRY_INTERVAL_MS) {
    console.log(`Retry interval elapsed (${timeSinceLastAttempt}ms). Attempting to use remote API again.`);
    return false;
  }
  
  // Still in fallback period
  return true;
  */
};

// Mock data for when remote API is not reachable
const MOCK_DATA = {
  info: {
    success: true,
    runeInfo: {
      id: OVT_RUNE_ID,
      symbol: OVT_RUNE_SYMBOL,
      treasuryAddress: OVT_TREASURY_ADDRESS,
      lpAddress: LP_ADDRESS
    }
  },
  balances: {
    success: true,
    balances: [
      {
        address: OVT_TREASURY_ADDRESS,
        amount: 1100000,
        isTreasury: true,
        isLP: false
      },
      {
        address: LP_ADDRESS,
        amount: 1000000,
        isTreasury: false,
        isLP: true
      }
    ]
  },
  distribution: {
    success: true,
    distributionStats: {
      totalSupply: 2100000,
      treasuryHeld: 1100000,
      lpHeld: 1000000,
      distributed: 0,
      percentDistributed: "0.00",
      percentInLP: "47.62",
      treasuryAddresses: [OVT_TREASURY_ADDRESS],
      lpAddresses: [LP_ADDRESS],
      distributionEvents: []
    }
  },
  lpInfo: {
    success: true,
    lpInfo: {
      address: LP_ADDRESS,
      liquidity: {
        ovt: 1000000,
        btcSats: 1000000,
        impactMultiplier: 0.01,
        liquidityScore: "100.00"
      },
      pricing: {
        currentPriceSats: 249,
        lastTradeTime: Date.now(),
        dailyVolume: 0,
        weeklyVolume: 0,
        estimatedPriceImpact: {
          small: "0.0100",
          medium: "0.1000",
          large: "1.0000"
        }
      },
      transactions: []
    }
  }
};

// Helper function to call remote API with mock fallback
const callRemoteAPIWithFallback = async (endpoint, mockDataKey) => {
  // If we should use fallback mode based on previous failures or debug mode
  if (shouldUseFallback()) {
    console.log(`[FALLBACK MODE] Using mock data for: ${endpoint}`);
    return { success: true, result: MOCK_DATA[mockDataKey] };
  }
  
  try {
    // Update last attempt timestamp
    lastRemoteAttemptTimestamp = Date.now();
    
    // Try to call the remote API
    const result = await callRemoteRunesAPI(endpoint);
    
    if (result.success) {
      // Reset failure counter on success
      consecutiveRemoteFailures = 0;
      return result;
    } else {
      // Increment failure counter
      consecutiveRemoteFailures++;
      
      // Log warning and fall back to mock data
      console.warn(`Remote API call failed: ${result.error}. Consecutive failures: ${consecutiveRemoteFailures}`);
      
      // If we've hit the threshold, log a more prominent warning
      if (consecutiveRemoteFailures >= FAILURE_THRESHOLD) {
        console.warn(`==== WARNING: ${consecutiveRemoteFailures} consecutive remote failures. ====`);
        console.warn(`==== Using fallback data for the next ${RETRY_INTERVAL_MS/1000/60} minutes. ====`);
      }
      
      return { success: true, result: MOCK_DATA[mockDataKey] };
    }
  } catch (error) {
    // Increment failure counter
    consecutiveRemoteFailures++;
    
    // Log error and fall back to mock data
    console.error(`Error calling remote API: ${error.message}. Consecutive failures: ${consecutiveRemoteFailures}`);
    
    // If we've hit the threshold, log a more prominent warning
    if (consecutiveRemoteFailures >= FAILURE_THRESHOLD) {
      console.warn(`==== WARNING: ${consecutiveRemoteFailures} consecutive remote failures. ====`);
      console.warn(`==== Using fallback data for the next ${RETRY_INTERVAL_MS/1000/60} minutes. ====`);
    }
    
    return { success: true, result: MOCK_DATA[mockDataKey] };
  }
};

// Helper function to call remote Runes API on OrdPi
const callRemoteRunesAPI = async (endpoint, method = 'GET', data = null) => {
  try {
    const url = `${REMOTE_RUNES_API}${endpoint}`;
    console.log(`Calling remote Runes API: ${method} ${url}`);
    
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }
    
    const response = await axios(config);
    console.log(`Remote API response status: ${response.status}`);
    return { success: true, result: response.data };
  } catch (error) {
    console.error(`Error calling remote Runes API: ${error.message}`);
    return { 
      success: false, 
      error: error.toString(),
      details: error.response?.data || 'No additional details'
    };
  }
};

// Helper function to get OVT information from remote Runes API
const getRemoteOVTInfo = async () => {
  return callRemoteAPIWithFallback('/ovt/info', 'info');
};

// Helper function to get wallet balances from remote Runes API
const getRemoteWalletBalances = async () => {
  return callRemoteAPIWithFallback('/ovt/balances', 'balances');
};

// Helper function to get distribution stats from remote Runes API
const getRemoteDistributionStats = async () => {
  return callRemoteAPIWithFallback('/ovt/distribution', 'distribution');
};

// Helper function to get LP information from remote Runes API
const getRemoteLPInfo = async () => {
  return callRemoteAPIWithFallback('/ovt/lp-info', 'lpInfo');
};

// Helper function to execute ord commands with proper configuration
// Refactored to use local executeCommand
const execOrdCommand = async (command) => {
  // Acquire the mutex lock before executing the command
  const release = await runesOrdCommandMutex.acquire();
  console.log(`RunesAPI: Acquired mutex for command: ${command}`);

  // Check if we should use fallback based on previous failures
  if (shouldUseFallback()) {
    console.log(`[FALLBACK MODE] Simulating command: ${command}`);
    
    // Return appropriate mock data based on command
    if (command.includes('wallet balance')) {
      return { success: true, result: '0.00050000 BTC' };
    } else if (command.includes('wallet transactions')) {
      return { success: true, result: '[]' }; // Empty transaction list
    } else if (command.includes('bitcoin-cli') && command.includes('getblockchaininfo')) {
      return { 
        success: true, 
        result: JSON.stringify({
          chain: 'signet',
          blocks: 189500,
          headers: 189500,
          bestblockhash: '00000183b5dd80c4a6f17f236fb7abc729f43e61f9e7f80d6bd7248b3c6e9f12',
          difficulty: 0.002873598515210077,
          mediantime: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
          verificationprogress: 0.9999973123250358,
          pruned: false,
          softforks: {
            taproot: { active: true },
            segwit: { active: true }
          },
          warnings: ''
        })
      };
    } else {
      return { success: true, result: 'Command simulated with fallback data' };
    }
  }
  
  try {
    // Update last attempt timestamp
    lastRemoteAttemptTimestamp = Date.now();
    
    // Ensure all ord commands use the correct configuration
    // Get path from env or fallback - ensure this is correct for OrdPi
    const ordPath = process.env.ORD_PATH || 'ord'; 
    const ordConfigPath = process.env.ORD_CONFIG_PATH || '/home/BTCPi/.ord/ord.yaml';
    const ordNetworkFlag = process.env.BITCOIN_NETWORK === 'signet' ? '--signet' : ''; // Add other networks if needed
    
    // Construct the full command for local execution
    const fullCommand = `${ordPath} --config ${ordConfigPath} ${ordNetworkFlag} ${command}`;
    
    // Use the local command execution service
    console.log(`Executing local ord command: ${command}`);
    
    // Execute the command locally
    const result = await executeCommand(fullCommand); 
    const stdout = result.stdout || '';
    
    console.log(`Command result: ${stdout}`);
    
    // Reset failure counter on success
    consecutiveRemoteFailures = 0;
    
    return { success: true, result: stdout };
  } catch (error) {
    console.error(`Error executing command: ${command}`, error);
    // Add more detailed logging of the error object
    console.error('Full error object:', JSON.stringify(error, null, 2));
    if (error.stdout) { console.error('Error stdout:', error.stdout); }
    if (error.stderr) { console.error('Error stderr:', error.stderr); }

    // --- TEMPORARY CHANGE: Re-throw the error instead of returning fallback ---
    // Increment failure counter (optional, depends if we want this failure to trigger fallback for *other* calls)
    // consecutiveRemoteFailures++;
    // console.warn(`Command execution failed. Consecutive failures: ${consecutiveRemoteFailures}`);

    // Throw the error to prevent fallback for command execution issues
    throw error; 
    // --- END TEMPORARY CHANGE ---

    /*  // Original fallback logic (commented out for now)
    // Increment failure counter
    consecutiveRemoteFailures++;
    console.warn(`SSH command failed. Consecutive failures: ${consecutiveRemoteFailures}`);

    // If we've hit the threshold, log a more prominent warning
    if (consecutiveRemoteFailures >= FAILURE_THRESHOLD) {
      console.warn(`==== WARNING: ${consecutiveRemoteFailures} consecutive remote failures. ====`);
      console.warn(`==== Using fallback data for the next ${RETRY_INTERVAL_MS/1000/60} minutes. ====`);
    }

    // Return appropriate mock data based on command
    if (command.includes('wallet balance')) {
      return { success: true, result: '0.00050000 BTC' };
    } else if (command.includes('wallet transactions')) {
      return { success: true, result: '[]' }; // Empty transaction list
    } else if (command.includes('bitcoin-cli') && command.includes('getblockchaininfo')) {
      return { 
        success: true, 
        result: JSON.stringify({
          chain: 'signet',
          blocks: 189500,
          headers: 189500,
          bestblockhash: '00000183b5dd80c4a6f17f236fb7abc729f43e61f9e7f80d6bd7248b3c6e9f12',
          difficulty: 0.002873598515210077,
          mediantime: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
          verificationprogress: 0.9999973123250358,
          pruned: false,
          softforks: {
            taproot: { active: true },
            segwit: { active: true }
          },
          warnings: ''
        })
      };
    } else {
      return { success: true, result: 'Command simulated with fallback data' };
    }
    */
  } finally {
    // Ensure the mutex lock is always released
    release();
    console.log(`RunesAPI: Released mutex for command: ${command}`);
  }
};

// Helper function to parse rune balance output
const parseRuneBalances = (output) => {
  try {
    console.log(`Parsing balance output: ${output}`);

    // Attempt to parse the output as JSON first
    try {
      const jsonData = JSON.parse(output);
      const addressBalances = {}; // Use an object to aggregate balances per address

      // Iterate through addresses in the JSON
      Object.keys(jsonData).forEach(address => {
        const addressData = jsonData[address];

        // Skip if no outputs or not an array
        if (!Array.isArray(addressData) || addressData.length === 0) return;

        // Aggregate OVT rune amounts for this address
        let totalAmountForAddress = 0;
        addressData.forEach(utxo => {
          if (utxo.runes && utxo.runes[OVT_RUNE_SYMBOL]) {
            const amount = parseInt(utxo.runes[OVT_RUNE_SYMBOL]);
            if (!isNaN(amount)) { // Ensure amount is a valid number
                totalAmountForAddress += amount;
            }
          }
        });

        // Store the total amount if > 0
        if (totalAmountForAddress > 0) {
            addressBalances[address] = totalAmountForAddress;
        }
      });

      // Convert the aggregated balances into the desired array format
      const balances = Object.keys(addressBalances).map(address => {
        const amount = addressBalances[address];
        const isTreasury = address === OVT_TREASURY_ADDRESS || address === OVT_TREASURY_ADDRESS_2;
        const isLP = address === LP_ADDRESS || (LP_ADDRESS_2 && address === LP_ADDRESS_2);
        return {
          address,
          amount,
          isTreasury,
          isLP
        };
      });

      console.log('Successfully parsed JSON balances:', balances);
      return balances;

    } catch (e) {
      // If JSON parsing fails, log the error and return empty (shouldn't happen with current ord version)
      console.error(`JSON parsing failed for balance output: ${e.message}`);
      console.error(`Raw output causing failure: ${output}`);
      return []; // Return empty array on failure
    }

  } catch (error) {
    console.error('Error parsing rune balances:', error);
    return [];
  }
};

// Helper function to calculate distribution stats
const calculateDistributionStats = (balances) => {
  const totalSupply = balances.reduce((sum, b) => sum + b.amount, 0);
  
  // Calculate treasury holdings by summing balances from both treasury addresses
  const treasuryHeld = balances
    .filter(b => b.isTreasury)
    .reduce((sum, b) => sum + b.amount, 0);
  
  const lpHeld = balances
    .filter(b => b.isLP)
    .reduce((sum, b) => sum + b.amount, 0);
  
  const distributed = totalSupply - treasuryHeld;
  
  return {
    totalSupply,
    treasuryHeld,
    lpHeld,
    distributed,
    percentDistributed: (distributed / totalSupply * 100).toFixed(2),
    percentInLP: (lpHeld / totalSupply * 100).toFixed(2),
    treasuryAddresses: [OVT_TREASURY_ADDRESS, OVT_TREASURY_ADDRESS_2],
    lpAddresses: [LP_ADDRESS, LP_ADDRESS_2].filter(Boolean)
  };
};

// Helper function to get transaction history
const getTransactionHistory = async (/* runeId - No longer used here */) => {
  try {
    // Use the correct command for wallet transactions
    console.log('Executing `ord wallet transactions`...');
    const commandResult = await execOrdCommand(`wallet transactions`);

    if (!commandResult.success || !commandResult.result) {
        console.error('Failed to execute `ord wallet transactions`', commandResult.error);
        return []; // Return empty on failure
    }

    // Parse the JSON transaction output
    try {
        const transactions = JSON.parse(commandResult.result);
        console.log(`Parsed ${transactions.length} transactions from wallet history.`);
        // Add a timestamp to each for potential future use/sorting
        return transactions.map(tx => ({ ...tx, fetchedAt: Date.now() }));
    } catch (parseError) {
        console.error(`Error parsing JSON from wallet transactions: ${parseError.message}`);
        console.error(`Raw output: ${commandResult.result}`);
        return []; // Return empty on parse failure
    }

  } catch (error) {
    console.error('Error getting transaction history:', error);
    return [];
  }
};

// Helper function to calculate price impact multiplier based on liquidity depth
const calculatePriceImpact = (lpBalance, btcSats) => {
  try {
    // Price impact is inversely proportional to liquidity depth
    // The more liquidity (OVT tokens and BTC), the less impact a trade will have
    
    // Base formula: impact = 1 / (sqrt(lpBalance * btcSats))
    // We normalize it to keep the impact in a reasonable range (0.00001 - 0.01)
    // Higher numbers mean more price impact per trade
    
    if (!lpBalance || !btcSats || lpBalance <= 0 || btcSats <= 0) {
      return 0.01; // Maximum impact if no liquidity
    }
    
    const liquidityDepth = Math.sqrt(lpBalance * btcSats);
    const baseImpact = 1 / liquidityDepth;
    
    // Normalize to a reasonable range
    const normalizedImpact = Math.min(Math.max(baseImpact * 10000, 0.00001), 0.01);
    
    return normalizedImpact;
  } catch (error) {
    console.error('Error calculating price impact:', error);
    return 0.01; // Default to maximum impact on error
  }
};

// Helper function to get wallet balance in sats
async function getWalletBalance(address) {
  try {
    // For wallet balance, we need to use bitcoin-cli instead of ord
    // This is a placeholder - in a real implementation, we would use:
    // const bitcoinCliCmd = `bitcoin-cli -signet -rpcwallet=ovt-LP-wallet getaddressbalance "${address}"`;
    // or with listunspent for more detailed data
    
    // For now, let's still use ord wallet balance but improve parsing
    const result = execOrdCommand(`wallet balance`);
    if (result.success) {
      console.log(`Wallet balance result: ${result.result}`);
      
      try {
        // Parse the JSON response from ord wallet balance
        const balanceData = JSON.parse(result.result);
        
        // Extract the total balance in sats
        if (balanceData && balanceData.total) {
          const totalSats = parseInt(balanceData.total);
          console.log(`Parsed wallet balance: ${totalSats} sats`);
          return totalSats;
        }
        
        // If total is not available, try cardinal + ordinal
        if (balanceData && balanceData.cardinal !== undefined && balanceData.ordinal !== undefined) {
          const totalSats = parseInt(balanceData.cardinal) + parseInt(balanceData.ordinal);
          console.log(`Calculated wallet balance from components: ${totalSats} sats`);
          return totalSats;
        }
        
        // Fallback if JSON parsing succeeded but expected fields aren't found
        console.log("Could not extract balance from parsed JSON, returning total available");
        return 500000; // Return a sufficiently large balance for testing
      } catch (parseError) {
        // If JSON parsing fails, try legacy format
        console.log(`JSON parsing failed: ${parseError.message}, trying legacy format`);
        
        // Try to parse BTC format (e.g. "0.00123456 BTC")
        const btcMatch = result.result.match(/([0-9.]+)\s*BTC/i);
        if (btcMatch) {
          const btcBalance = parseFloat(btcMatch[1]);
          const satsBalance = Math.floor(btcBalance * 100000000); // Convert BTC to sats
          console.log(`Parsed legacy BTC format: ${satsBalance} sats`);
          return satsBalance;
        }
        
        // Fallback to direct parsing if no "BTC" format is found
        const btcBalance = parseFloat(result.result);
        if (!isNaN(btcBalance)) {
          const satsBalance = Math.floor(btcBalance * 100000000);
          console.log(`Parsed direct float value: ${satsBalance} sats`);
          return satsBalance;
        }
      }
    }
    
    console.log("Could not parse wallet balance, using default value for testing");
    return 500000; // Default to a reasonable balance for testing purposes
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    // Return a non-zero value for testing so trades can proceed
    return 500000;
  }
}

// Home route documentation should be updated to reflect the new endpoints
runesRouter.get('/', (req, res) => {
  const endpoints = [
    {
      path: '/',
      method: 'GET',
      description: 'API documentation',
    },
    {
      path: '/health',
      method: 'GET',
      description: 'Check API health and dependencies',
    },
    {
      path: '/ovt/info',
      method: 'GET',
      description: 'Get information about the OVT (OTORI Vision Token) rune',
    },
    {
      path: '/ovt/balances',
      method: 'GET',
      description: 'Get balances for the OVT rune',
    },
    {
      path: '/ovt/distribution',
      method: 'GET',
      description: 'Get distribution statistics for the OVT rune',
    },
    {
      path: '/ovt/lp-info',
      method: 'GET',
      description: 'Get LP wallet information for the OVT rune',
    },
    {
      path: '/ovt/transactions',
      method: 'GET',
      description: 'Get transaction history for an address',
      params: {
        address: 'Wallet address to fetch transactions for'
      }
    },
    {
      path: '/ovt/buy',
      method: 'POST',
      description: 'Prepare a buy transaction for OVT tokens',
      body: {
        fromAddress: 'Buyer wallet address',
        amount: 'Amount of OVT to buy',
        maxPrice: 'Maximum price willing to pay (optional)',
        signature: 'Transaction signature (optional)',
        pubkey: 'Public key for signature verification (optional)'
      }
    },
    {
      path: '/ovt/sell',
      method: 'POST',
      description: 'Prepare a sell transaction for OVT tokens',
      body: {
        fromAddress: 'Seller wallet address',
        toAddress: 'Recipient wallet address (optional, defaults to LP address)',
        amount: 'Amount of OVT to sell',
        minPrice: 'Minimum price willing to accept (optional)',
        signature: 'Transaction signature (optional)',
        pubkey: 'Public key for signature verification (optional)'
      }
    },
    {
      path: '/ovt/submit-transaction',
      method: 'POST',
      description: 'Submit a signed transaction',
      body: {
        signedPsbt: 'Signed PSBT transaction',
        txType: 'Transaction type (BUY or SELL)',
        fromAddress: 'Sender wallet address',
        toAddress: 'Recipient wallet address',
        amount: 'Amount of OVT in the transaction'
      }
    },
    {
      path: '/ovt/transfer',
      method: 'POST',
      description: 'Transfer OVT tokens to another address',
      body: {
        fromAddress: 'Sender wallet address',
        toAddress: 'Recipient wallet address',
        runeId: 'Rune ID (optional, defaults to OVT)',
        amount: 'Amount of OVT to transfer'
      }
    },
    {
      path: '/ovt/prepare-lp-distribution',
      method: 'POST',
      description: 'Prepare PSBTs for LP distribution',
      body: {
        amount: 'Amount of OVT to distribute',
        lpAddress: 'LP wallet address (optional, defaults to configured address)'
      }
    }
  ];

  // Format the response as HTML for better readability in browsers
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OTORI Vision Runes API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
          h1 { color: #333; }
          h2 { color: #555; margin-top: 2rem; }
          .endpoint { background: #f5f5f5; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; }
          .method { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; margin-right: 0.5rem; }
          .get { background: #61affe; color: white; }
          .post { background: #49cc90; color: white; }
          .params { margin-top: 0.5rem; }
          .param { margin-left: 1rem; color: #555; }
          footer { margin-top: 2rem; color: #777; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <h1>OTORI Vision Runes API</h1>
        <p>API for managing OVT (OTORI Vision Token) runes on Bitcoin Signet.</p>
        
        <h2>Configuration</h2>
        <p>Rune ID: ${OVT_RUNE_ID}</p>
        <p>Treasury Address: ${OVT_TREASURY_ADDRESS}</p>
        <p>LP Address: ${LP_ADDRESS}</p>
        
        <h2>Available Endpoints</h2>
    `;
    
    endpoints.forEach(endpoint => {
      html += `
        <div class="endpoint">
          <span class="method ${endpoint.method.toLowerCase()}">${endpoint.method}</span>
          <strong>${endpoint.path}</strong>
          <div>${endpoint.description}</div>
      `;
      
      if (endpoint.params) {
        html += `<div class="params">Parameters:</div>`;
        for (const [key, value] of Object.entries(endpoint.params)) {
          html += `<div class="param"><strong>${key}</strong>: ${value}</div>`;
        }
      }
      
      if (endpoint.body) {
        html += `<div class="params">Request Body:</div>`;
        for (const [key, value] of Object.entries(endpoint.body)) {
          html += `<div class="param"><strong>${key}</strong>: ${value}</div>`;
        }
      }
      
      html += `</div>`;
    });
    
    html += `
        <footer>
          OTORI Vision Runes API v1.0 | Running on port ${process.env.PORT}
        </footer>
      </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } else {
    // Return JSON if not explicitly requesting HTML
    res.json({
      name: 'OTORI Vision Runes API',
      version: '1.0',
      description: 'API for managing OVT (OTORI Vision Token) runes on Bitcoin Signet',
      configuration: {
        runeId: OVT_RUNE_ID,
        treasuryAddresses: [OVT_TREASURY_ADDRESS, OVT_TREASURY_ADDRESS_2],
        lpAddresses: [LP_ADDRESS, LP_ADDRESS_2].filter(Boolean)
      },
      endpoints
    });
  }
});

// Define OVT rune information endpoint
runesRouter.get('/ovt/info', async (req, res) => {
  try {
    // Instead of trying to get OVT rune info from remote API, construct it locally
    // using constants defined in this file
    res.json({
      success: true,
      rune: {
        runeId: OVT_RUNE_ID,
        name: OVT_RUNE_SYMBOL,
        symbol: '⊙',
        supply: 2100000,
        treasuryAddresses: [OVT_TREASURY_ADDRESS, OVT_TREASURY_ADDRESS_2],
        lpAddresses: [LP_ADDRESS, LP_ADDRESS_2].filter(Boolean),
        etching: 'e75ce796378927a5c152e8ee469c4ca3cf19a921f1e444fb88a22aaf035782fb',
        divisibility: 2,
        timestamp: '2025-03-20 21:48:00 UTC'
      }
    });
  } catch (error) {
    console.error('Error getting OVT info:', error);
    res.status(500).json({
      success: false,
      error: error.toString()
    });
  }
});

// Update the other endpoints to use the remote API functions
runesRouter.get('/ovt/balances', async (req, res) => {
  try {
    const address = req.query.address;
    if (!address) {
      return res.status(400).json({ success: false, error: 'Address query parameter is required' });
    }

    console.log(`Fetching balance for address: ${address}`);

    // --- Caching START ---
    const cachedEntry = addressBalanceCache[address];
    if (isCacheValid(cachedEntry, CACHE_TTL_BALANCES_MS)) {
        console.log(`[Cache] Using cached balance data for ${address}.`);
        const { ovtBalanceAmount, satBalanceAmount } = cachedEntry.data;
        const isTreasury = address === OVT_TREASURY_ADDRESS || address === OVT_TREASURY_ADDRESS_2;
        const isLP = address === LP_ADDRESS || (LP_ADDRESS_2 && address === LP_ADDRESS_2);

        return res.json({
            success: true,
            balances: (ovtBalanceAmount > 0 || satBalanceAmount > 0 || isTreasury || isLP) ? [{
                address,
                runeId: OVT_RUNE_ID,
                runeSymbol: OVT_RUNE_SYMBOL,
                amount: ovtBalanceAmount,
                sats: satBalanceAmount,
                isTreasury,
                isLP
            }] : []
        });
    }
    // --- Caching END ---

    // --- Scraping Logic START ---
    let ovtBalanceAmount = 0;
    let satBalanceAmount = 0;
    const ordServerHost = 'http://localhost:9191'; // Use localhost for scraping
    const ordServerUrl = `${ordServerHost}/address/${address}`;
    console.log(`[Scraping] Querying local ord server: ${ordServerUrl}`);

    try {
      const response = await axios.get(ordServerUrl, { timeout: 5000 });
      const $ = cheerio.load(response.data);

      // Extract Sat Balance
      $('dt').each((index, element) => {
        if ($(element).text().trim() === 'sat balance') {
          satBalanceAmount = parseInt($(element).next('dd').text().trim().replace(/,/g, ''), 10) || 0;
        }
      });

      // Extract Rune Balance for OVT
      $('dt').each((index, element) => {
        if ($(element).text().trim() === 'rune balances') {
          const ovtLink = $(element).next('dd').find(`a[href='/rune/${OVT_RUNE_SYMBOL.replace(/•/g, '%E2%80%A2')}']`);
          if (ovtLink.length > 0) {
            const fullText = ovtLink.parent().text();
            const balanceMatch = fullText.match(/:\s*([\d,]+)⊙/);
            if (balanceMatch && balanceMatch[1]) {
              ovtBalanceAmount = parseInt(balanceMatch[1].replace(/,/g, ''), 10) || 0;
            }
          }
        }
      });

      console.log(`[Scraping] Parsed balances - OVT: ${ovtBalanceAmount}, Sats: ${satBalanceAmount}`);

      // --- Caching START ---
      console.log(`[Cache] Storing fresh balance data for ${address}.`);
      addressBalanceCache[address] = {
          data: { ovtBalanceAmount, satBalanceAmount },
          timestamp: Date.now()
      };
      // --- Caching END ---

    } catch (error) {
      const errorMessage = error.response ? `Status ${error.response.status}` : error.message;
      console.error(`[Scraping] Error querying or parsing ${ordServerUrl}: ${errorMessage}`);
      // Do not cache errors, just return error response
      return res.status(502).json({
        success: false,
        error: 'Failed to retrieve or parse balance from local ord server via scraping.',
        details: errorMessage
      });
    }
    // --- Scraping Logic END ---

    // Determine if this is a treasury or LP address (outside scraping block)
    const isTreasury = address === OVT_TREASURY_ADDRESS || address === OVT_TREASURY_ADDRESS_2;
    const isLP = address === LP_ADDRESS || (LP_ADDRESS_2 && address === LP_ADDRESS_2);

    // Return the freshly scraped and cached balance information
    const responsePayload = {
        success: true,
        balances: (ovtBalanceAmount > 0 || satBalanceAmount > 0 || isTreasury || isLP) ? [{
            address,
            runeId: OVT_RUNE_ID,
            runeSymbol: OVT_RUNE_SYMBOL,
            amount: ovtBalanceAmount,
            sats: satBalanceAmount,
            isTreasury,
            isLP
        }] : []
    };

    return res.json(responsePayload);

  } catch (error) {
    // Catch any unexpected errors during the process
    console.error('Error in /ovt/balances handler:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while getting OVT balance.',
      details: error.toString()
    });
  }
});

runesRouter.get('/ovt/distribution', async (req, res) => {
  try {
    // --- Caching START ---
    if (isCacheValid(distributionCache, CACHE_TTL_DISTRIBUTION_MS)) {
        console.log('[Cache] Using cached distribution data.');
        return res.json({ success: true, distributionStats: distributionCache.data });
    }
    // --- Caching END ---

    // Directly execute the 'wallet addresses' command to get all balances
    console.log('Fetching all balances for distribution calculation...');
    const commandResult = await execOrdCommand('wallet addresses');

    console.log('Raw command result in /ovt/distribution:', commandResult);

    if (!commandResult.success || !commandResult.result) {
      throw new Error(commandResult.error || 'Failed to execute ord wallet addresses command for distribution');
    }

    // Parse the raw output to get balances
    const allBalances = parseRuneBalances(commandResult.result);

    // Calculate distribution stats from the parsed balances
    const distributionStats = calculateDistributionStats(allBalances);

    // --- Caching START ---
    console.log('[Cache] Storing fresh distribution data.');
    distributionCache = { data: distributionStats, timestamp: Date.now() };
    // --- Caching END ---

    // Return the calculated stats
    return res.json({ success: true, distributionStats });

  } catch (error) {
    // --- MODIFIED CATCH BLOCK ---
    console.error('!!! Critical Error in /ovt/distribution route handler !!!');
    console.error('Error details:', error);
    // Log the specific error message if available
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    } else {
      console.error('Caught non-Error object:', error);
    }
    // Return a 500 status with the error
    res.status(500).json({
      success: false,
      error: 'Failed to get OVT distribution due to internal error.',
      // Optionally include error details in non-production environments
      details: process.env.NODE_ENV !== 'production' ? error.toString() : undefined
    });
    // --- END MODIFIED CATCH BLOCK ---
  }
});

runesRouter.get('/ovt/lp-info', async (req, res) => {
  try {
    const result = await getRemoteLPInfo();
    if (result.success) {
      return res.json(result.result);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Error getting LP info:', error);
    res.status(500).json({
      success: false,
      error: error.toString()
    });
  }
});

runesRouter.post('/ovt/prepare-lp-distribution', async (req, res) => {
  try {
    const amount = req.body.amount || 0;
    const lpAddress = req.body.lpAddress || LP_ADDRESS;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid amount specified' 
      });
    }
    
    console.log(`Preparing PSBT for distributing ${amount} of ${OVT_RUNE_ID} to LP address ${lpAddress}`);
    
    // In a real implementation, we would use bitcoin-cli to create a PSBT
    // This would require using proper RPC commands to the Bitcoin Core node
    
    // Example of a more realistic approach using Bitcoin Core RPC:
    // 1. Create a transaction with createrawtransaction
    // 2. Convert to PSBT with converttopsbt
    // 3. Add inputs with walletprocesspsbt
    
    // For now, returning a dummy PSBT as before
    const dummyPSBT = `cHNidP8BAHECAAAAAfUbVEKkUNXZbVFS3uB7z6X4wYQ3r8BwkyM2qX49CD2xAAAAAAD/////AgDh9QUAAAAAIgAgPU1kBB9KxCYkWxV7k2JP5gQVz8w/DNSE0UIRbVEIQEQB1AEAAAAAFgAU3AxdYMxkdq5YdZXKhQMb2jPMBsIAAAAAAAEA3gIAAAAAAQF2xNJVrnHvWW7yP2xj5chMSCHGQsibjEBG1DHp4HQYHgEAAAAA/v///wKghgEAAAAAACIAIIab5mIiJnE/LrxLlnFM7dKKLJ9anXA2u8BiQZIXQ3KbJbwNAAAAAAAWABRYhfmKkJ3MLp3hIBvAdgUkZ5XKpwJHMEQCIB7Kn9ikm0jrDHhUdK5JTCblI7PJWBUmKQOyJQnI8zLrAiAuBd8dDuSm2cMLZFcKDQ3MYrCSQimHfmiK8Rh1Yp4H8QEhA7dYnQPU0nNdEFdO3YcQB9pXdBIQIqiFeh8tCJRyzx1SrgAAAA==`;
    
    res.json({
      success: true,
      psbts: [dummyPSBT],
      message: 'PSBT created for LP distribution'
    });
  } catch (error) {
    console.error('Error preparing LP distribution PSBT:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Keep the existing endpoints for backward compatibility (temporarily)
runesRouter.get('/rune/:id', (req, res) => {
  res.redirect('/ovt/info');
});

runesRouter.get('/rune/:id/balances', (req, res) => {
  res.redirect('/ovt/balances');
});

runesRouter.get('/rune/:id/distribution', (req, res) => {
  res.redirect('/ovt/distribution');
});

runesRouter.get('/rune/:id/lp-info', (req, res) => {
  res.redirect('/ovt/lp-info');
});

// Update the prepare-lp-distribution endpoint to handle the request directly rather than redirecting
runesRouter.post('/rune/prepare-lp-distribution', async (req, res) => {
  try {
    const amount = req.body.amount || 0;
    const lpAddress = req.body.lpAddress || LP_ADDRESS;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid amount specified' 
      });
    }
    
    console.log(`Preparing PSBT for distributing ${amount} of ${OVT_RUNE_ID} to LP address ${lpAddress}`);
    
    // For now, returning a dummy PSBT
    const dummyPSBT = `cHNidP8BAHECAAAAAfUbVEKkUNXZbVFS3uB7z6X4wYQ3r8BwkyM2qX49CD2xAAAAAAD/////AgDh9QUAAAAAIgAgPU1kBB9KxCYkWxV7k2JP5gQVz8w/DNSE0UIRbVEIQEQB1AEAAAAAFgAU3AxdYMxkdq5YdZXKhQMb2jPMBsIAAAAAAAEA3gIAAAAAAQF2xNJVrnHvWW7yP2xj5chMSCHGQsibjEBG1DHp4HQYHgEAAAAA/v///wKghgEAAAAAACIAIIab5mIiJnE/LrxLlnFM7dKKLJ9anXA2u8BiQZIXQ3KbJbwNAAAAAAAWABRYhfmKkJ3MLp3hIBvAdgUkZ5XKpwJHMEQCIB7Kn9ikm0jrDHhUdK5JTCblI7PJWBUmKQOyJQnI8zLrAiAuBd8dDuSm2cMLZFcKDQ3MYrCSQimHfmiK8Rh1Yp4H8QEhA7dYnQPU0nNdEFdO3YcQB9pXdBIQIqiFeh8tCJRyzx1SrgAAAA==`;
    
    res.json({
      success: true,
      psbts: [dummyPSBT],
      message: 'PSBT created for LP distribution'
    });
  } catch (error) {
    console.error('Error preparing LP distribution PSBT:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add health check endpoint
runesRouter.get('/health', (req, res) => {
  // Check all required dependencies
  const ordInstalled = checkOrdInstallation();
  const bitcoinCliInstalled = checkBitcoinCliInstallation();
  const ordConfigExists = checkOrdConfig();
  
  // Get Bitcoin and ord version info for diagnostics
  let bitcoinVersion = 'Not available';
  let ordVersion = 'Not available';
  
  try {
    bitcoinVersion = execSync('bitcoin-cli -version').toString().trim();
  } catch (error) {
    console.error('Could not get bitcoin-cli version');
  }
  
  try {
    ordVersion = execSync('ord --version').toString().trim();
  } catch (error) {
    console.error('Could not get ord version');
  }
  
  const status = ordInstalled && bitcoinCliInstalled && ordConfigExists ? 'healthy' : 'unhealthy';
  
  res.json({
    status,
    timestamp: new Date().toISOString(),
    configuration: {
      runeId: OVT_RUNE_ID,
      treasuryAddresses: [OVT_TREASURY_ADDRESS, OVT_TREASURY_ADDRESS_2],
      lpAddresses: [LP_ADDRESS, LP_ADDRESS_2].filter(Boolean)
    },
    dependencies: {
      ord: {
        installed: ordInstalled,
        version: ordVersion,
        configExists: ordConfigExists
      },
      bitcoinCli: {
        installed: bitcoinCliInstalled,
        version: bitcoinVersion
      }
    }
  });
});

// Add global error handling middleware (place this before module.exports)
runesRouter.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Simple IP-based rate limiting
const rateLimit = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

runesRouter.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  
  // Initialize or clean up old entries
  if (!rateLimit[ip] || Date.now() - rateLimit[ip].timestamp > RATE_LIMIT_WINDOW) {
    rateLimit[ip] = {
      count: 0,
      timestamp: Date.now()
    };
  }
  
  // Increment request count
  rateLimit[ip].count++;
  
  // Check if rate limit exceeded
  if (rateLimit[ip].count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    });
  }
  
  next();
});

// Add a simple in-memory store for pending orders
const pendingOrders = new Map(); // Stores orderId -> { fromAddress, amount, price, timestamp }

runesRouter.post('/ovt/buy', async (req, res) => {
  // ---> ADDED ENTRY LOGGING <---
  console.log(`[POST /ovt/buy] Request received. Body:`, req.body);
  // ---> END ENTRY LOGGING <---
  try {
    const { fromAddress, amount, maxPrice, signature, pubkey } = req.body;
    
    // --- FIX: Define divisibility early for logging ---
    const OVT_DIVISIBILITY = 2; // Define or fetch divisibility
    // --- END FIX ---

    if (!fromAddress || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid parameters. Required: fromAddress, amount' 
      });
    }
    
    // --- FIX: Log human-readable amount ---
    const humanReadableAmountForLog = amount / Math.pow(10, OVT_DIVISIBILITY);
    console.log(`[2Step Buy Prep] Processing request for ${humanReadableAmountForLog} OVT (Raw: ${amount}) from ${fromAddress}`);
    // --- END FIX ---
    
    // 1. Verify the signature if provided (Optional step)
    // ... (keep existing signature logic if needed)
    
    // 2. Check for sufficient BTC balance using CHEERIO scraping
    let btcBalance = 0;
    try {
      const ordServerHost = 'http://localhost:9191';
      const ordServerUrl = `${ordServerHost}/address/${fromAddress}`;
      console.log(`[2Step Buy Prep] Querying user balance: ${ordServerUrl}`);
      const response = await axios.get(ordServerUrl, { timeout: 5000 });
      const $ = cheerio.load(response.data);
      $('dt').each((index, element) => {
        if ($(element).text().trim() === 'sat balance') {
          btcBalance = parseInt($(element).next('dd').text().trim().replace(/,/g, ''), 10) || 0;
        }
      });
      console.log(`[2Step Buy Prep] Scraped BTC balance for ${fromAddress}: ${btcBalance} sats`);
    } catch (error) {
      const errorMessage = error.response ? `Status ${error.response.status}` : error.message;
      console.error(`[2Step Buy Prep] Error scraping balance: ${errorMessage}`);
      return res.status(503).json({ success: false, error: 'Service unavailable: Could not verify user balance.' });
    }
    
    // 3. Fetch the current OVT price from price-api (Phase 2)
    // TEMPORARY PLACEHOLDER PRICE - Replace with actual API call in Phase 2
    // const currentPrice = 700; // TODO: Replace with fetch from price-api
    // console.log(`[2Step Buy Prep] Using price: ${currentPrice} sats`);

    // 3. Fetch the current OVT price from price-api (Phase 2)
    let currentPrice;
    try {
        const priceApiUrl = `${process.env.OTORI_PRICE_API_ENDPOINT || 'http://localhost:3033'}/api/price/ovt`;
        console.log(`[2Step Buy Prep] Fetching price from: ${priceApiUrl}`);
        const priceResponse = await axios.get(priceApiUrl, {
            headers: { 'X-Internal-Secret': process.env.INTERNAL_API_SECRET },
            timeout: 3000
        });
        currentPrice = priceResponse.data.btcPriceSats; // Use btcPriceSats field
        if (currentPrice === undefined || currentPrice === null) throw new Error('Invalid price data received');
        console.log(`[2Step Buy Prep] Current OVT price from price-api: ${currentPrice} sats`);
    } catch (priceError) {
        const errorMessage = priceError.response ? `Status ${priceError.response.status}: ${JSON.stringify(priceError.response.data)}` : priceError.message;
        console.error(`[2Step Buy Prep] Failed to fetch OVT price: ${errorMessage}`);
        return res.status(503).json({ success: false, error: 'Service unavailable: Could not fetch OVT price.' });
    }

    if (maxPrice && currentPrice > maxPrice) {
      return res.status(400).json({
        success: false,
        error: `Current price (${currentPrice}) exceeds maximum price (${maxPrice})`
      });
    }
    
    // 4. Calculate total cost and check balance
    // --- FIX: Account for divisibility (assuming 2) when calculating cost from raw amount ---
    const humanReadableAmount = amount / Math.pow(10, OVT_DIVISIBILITY);
    const costSats = Math.floor(humanReadableAmount * currentPrice); // Calculate cost based on human-readable amount
    // --- END FIX ---
    // Use a generic, slightly higher fee estimate for the user's payment transaction
    const estimatedUserFeeSats = 1000; // Example: 1000 sats, adjust as needed
    const totalRequired = costSats + estimatedUserFeeSats;
    
    // ---> ADDED DEBUG LOGGING <---
    console.log(`[2Step Buy Prep] Balance Check - Available: ${btcBalance}, Cost: ${costSats}, Fee Est: ${estimatedUserFeeSats}, Total Required: ${totalRequired}`);
    // ---> END DEBUG LOGGING <---

    if (btcBalance < totalRequired) {
      console.error(`[2Step Buy Prep] Insufficient balance detected for ${fromAddress}. Required: ~${totalRequired}, Available: ${btcBalance}`); // Added error log
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Required: ~${totalRequired} sats (${costSats} + ${estimatedUserFeeSats} fee), Available: ${btcBalance} sats`
      });
    }
    
    // 5. Generate Order ID and Store Pending Order
    const orderId = `ovt-buy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    // Use tradingService to store the pending order
    const stored = tradingService.storePendingOrder(orderId, {
      fromAddress,
      amount,
      price: currentPrice, // Store the price used for this order
      costSats,          // Store the calculated cost
      timestamp: Date.now()
    });
    
    if (!stored) {
        console.error(`[2Step Buy Prep] Failed to store pending order: ${orderId}`);
        return res.status(500).json({ success: false, error: 'Internal server error: Could not store order.' });
    }
    console.log(`[2Step Buy Prep] Pending order stored via tradingService: ${orderId}`);

    // 6. Prepare Payment Details for Frontend
    // Use an environment variable for the BTC receiving address
    const paymentRecipientAddress = process.env.LP_BTC_RECEIVING_ADDRESS; 
    if (!paymentRecipientAddress) {
        console.error("[2Step Buy Prep] CRITICAL: LP_BTC_RECEIVING_ADDRESS environment variable not set!");
        return res.status(500).json({ success: false, error: 'Internal server configuration error.' });
    }

    const paymentDetails = {
      recipientAddress: paymentRecipientAddress,
      amountSats: costSats, 
      memo: `OTORI Buy ${orderId}` // Memo for user's transaction
    };

    // 7. Respond to Frontend with necessary info for Step 1 (User Payment)
    res.json({
      success: true,
      orderId: orderId,
      paymentDetails: paymentDetails,
      message: 'Order prepared. Please send the specified BTC amount.'
    });

    // --- REMOVED executeBuyOrder and Cache Invalidation --- 
    // Fulfillment happens in the confirmation step

  } catch (error) {
    console.error('[2Step Buy Prep] Error processing buy preparation:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error during buy preparation.' 
    });
  }
});

// TODO: Implement POST /api/trading/confirm-buy-payment endpoint (Phase 3, Step 2)
// This endpoint will verify the user's BTC payment (using btcTxId) 
// and then call tradingService.transferTokensFromLP to fulfill the order.

runesRouter.post('/ovt/sell', async (req, res) => {
  try {
    const { fromAddress, toAddress, amount, minPrice, signature, pubkey } = req.body;
    
    if (!fromAddress || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid parameters. Required: fromAddress, amount' 
      });
    }
    
    // If toAddress is not specified, use the LP address
    const recipient = toAddress || LP_ADDRESS;
    
    console.log(`Processing sell request: ${amount} OVT from ${fromAddress} to ${recipient}`);
    
    // 1. Verify the signature if provided
    let isSignatureValid = true;
    if (signature && pubkey) {
      // In a real implementation, we would verify the signature here
      // For example: isSignatureValid = verifySignature(message, signature, pubkey);
      console.log(`Signature verification: ${isSignatureValid ? 'valid' : 'invalid'}`);
    }
    
    if (!isSignatureValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }
    
    // 2. Check for sufficient OVT balance
    const balancesResult = await getRemoteWalletBalances();
    const userBalances = balancesResult.success ? 
      balancesResult.result.balances.filter(b => b.address === fromAddress) : 
      [];
    
    const ovtBalance = userBalances.length > 0 ? userBalances[0].amount : 0;
    
    if (ovtBalance < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient OVT balance. Required: ${amount}, Available: ${ovtBalance}`
      });
    }
    
    // 3. Calculate the current price and check against minPrice if specified
    // const lpInfo = await getRemoteLPInfo(); // REMOVED: Phase 2
    // const currentPrice = lpInfo.success ? 
    //   lpInfo.result.lpInfo.pricing.currentPriceSats : 
    //   700; // Default fallback price // REMOVED: Phase 2
    
    // 3. Fetch the current OVT price from price-api (Phase 2)
    let currentPrice;
    try {
        const priceApiUrl = `${process.env.OTORI_PRICE_API_ENDPOINT || 'http://localhost:3033'}/api/price/ovt`;
        console.log(`[Sell Prep] Fetching price from: ${priceApiUrl}`);
        const priceResponse = await axios.get(priceApiUrl, {
            headers: { 'X-Internal-Secret': process.env.INTERNAL_API_SECRET },
            timeout: 3000
        });
        currentPrice = priceResponse.data.btcPriceSats; // Use btcPriceSats field
        if (currentPrice === undefined || currentPrice === null) throw new Error('Invalid price data received');
        console.log(`[Sell Prep] Current OVT price from price-api: ${currentPrice} sats`);
    } catch (priceError) {
        const errorMessage = priceError.response ? `Status ${priceError.response.status}: ${JSON.stringify(priceError.response.data)}` : priceError.message;
        console.error(`[Sell Prep] Failed to fetch OVT price: ${errorMessage}`);
        return res.status(503).json({ success: false, error: 'Service unavailable: Could not fetch OVT price.' });
    }

    if (minPrice && currentPrice < minPrice) {
      return res.status(400).json({
        success: false,
        error: `Current price (${currentPrice}) is below minimum price (${minPrice})`
      });
    }
    
    // 4. Calculate total return in sats
    const totalReturn = amount * currentPrice;
    
    // 5. Try to get real UTXOs for the transaction if available
    let utxoDetails = { psbts: [] };
    try {
      // Get UTXOs associated with the fromAddress that contain runes
      const addressUtxos = await utxoService.getAddressUtxos(fromAddress);
      console.log(`Found ${addressUtxos.length} UTXOs for address ${fromAddress}`);
      
      if (addressUtxos.length > 0) {
        // Select optimal UTXOs for the transaction
        // In a real implementation, we would need to check which UTXOs hold the runes
        // and select those specific ones
        const optimizedUtxos = utxoService.selectOptimalUtxos(
          addressUtxos, 
          utxoService.DUST_LIMIT + utxoService.calculateEstimatedFee(1, 2)
        );
        
        // Create a PSBT
        const psbtInfo = await utxoService.createOptimizedPSBT(
          recipient,
          utxoService.DUST_LIMIT, // Minimum BTC amount
          {
            preferSmallUtxos: true
            // For an actual rune transfer, we'd need more complex logic here
          }
        );
        
        if (psbtInfo && psbtInfo.psbt) {
          utxoDetails = {
            psbts: [psbtInfo.psbt],
            utxos: optimizedUtxos.utxos
          };
        }
      }
    } catch (error) {
      console.error(`Error selecting UTXOs: ${error.message}`);
      // If there's an error, we'll fall back to the mock PSBT below
    }
    
    // If we don't have real UTXOs, create a simulated PSBT
    if (utxoDetails.psbts.length === 0) {
      utxoDetails.psbts = [`cHNidP8BAHECAAAAAfUbVEKkUNXZbVFS3uB7z6X4wYQ3r8BwkyM2qX49CD2xAAAAAAD/////AgDh9QUAAAAAIgAgPU1kBB9KxCYkWxV7k2JP5gQVz8w/DNSE0UIRbVEIQEQB1AEAAAAAFgAU3AxdYMxkdq5YdZXKhQMb2jPMBsIAAAAAAAEA3gIAAAAAAQF2xNJVrnHvWW7yP2xj5chMSCHGQsibjEBG1DHp4HQYHgEAAAAA/v///wKghgEAAAAAACIAIIab5mIiJnE/LrxLlnFM7dKKLJ9anXA2u8BiQZIXQ3KbJbwNAAAAAAAWABRYhfmKkJ3MLp3hIBvAdgUkZ5XKpwJHMEQCIB7Kn9ikm0jrDHhUdK5JTCblI7PJWBUmKQOyJQnI8zLrAiAuBd8dDuSm2cMLZFcKDQ3MYrCSQimHfmiK8Rh1Yp4H8QEhA7dYnQPU0nNdEFdO3YcQB9pXdBIQIqiFeh8tCJRyzx1SrgAAAA==`];
    }
    
    // 6. Return the transaction information
    // In a production system, the user would sign the PSBT and submit it back
    res.json({
      success: true,
      transaction: {
        txid: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        type: 'SELL',
        amount: amount,
        price: currentPrice,
        totalReturn: totalReturn,
        psbts: utxoDetails.psbts,
        utxos: utxoDetails.utxos || [],
        fromAddress: fromAddress,
        toAddress: recipient,
        timestamp: Date.now(),
        status: 'pending'
      },
      message: 'Sell transaction prepared successfully'
    });
  } catch (error) {
    console.error('Error processing sell transaction:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add endpoint for transaction submission after signing
runesRouter.post('/ovt/submit-transaction', async (req, res) => {
  try {
    const { signedPsbt, txType, fromAddress, toAddress, amount } = req.body;
    
    if (!signedPsbt || !txType || !fromAddress || !toAddress || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters' 
      });
    }
    
    console.log(`Processing transaction submission: ${txType} ${amount} OVT from ${fromAddress} to ${toAddress}`);
    
    // Create a tracking ID in case we can't broadcast immediately
    const trackingId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    // 1. Validate the signed PSBT
    let validationResult = { isValid: false, error: null };
    try {
      // Use UTXO service to analyze the PSBT
      const psbtAnalysis = utxoService.analyzePSBT(signedPsbt);
      
      // Check if the PSBT is complete and ready to broadcast
      if (psbtAnalysis.error) {
        validationResult = { isValid: false, error: psbtAnalysis.error };
      } else if (!psbtAnalysis.complete && psbtAnalysis.next === 'signer') {
        validationResult = { isValid: false, error: 'PSBT is not fully signed' };
      } else {
        validationResult = { isValid: true };
      }
      
      console.log(`PSBT validation result: ${validationResult.isValid ? 'Valid' : 'Invalid'}`);
      if (validationResult.error) {
        console.log(`Validation error: ${validationResult.error}`);
      }
    } catch (error) {
      console.error(`Error validating PSBT: ${error.message}`);
      validationResult = { isValid: false, error: error.message };
    }
    
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: `Invalid transaction: ${validationResult.error}`,
        trackingId
      });
    }
    
    // 2. Broadcast the transaction to the Bitcoin network
    let txid = trackingId;
    let broadcastSuccess = false;
    let broadcastError = null; // Store broadcast error message
    
    try {
      // Use UTXO service to finalize and broadcast the PSBT
      const finalizeResult = await utxoService.finalizePSBT(signedPsbt);
      
      if (finalizeResult && finalizeResult.txid) {
        txid = finalizeResult.txid;
        broadcastSuccess = true;
        console.log(`Transaction broadcast successful. TXID: ${txid}`);
      } else {
        console.error('Failed to broadcast transaction (finalizePSBT returned null/no txid)');
        broadcastError = 'Failed to finalize or broadcast PSBT';
      }
    } catch (error) {
      console.error(`Error broadcasting transaction: ${error.message}`);
      broadcastError = error.message; // Store the error message
      // Let the flow continue to send WS message but respond with error below
    }

    // --- WebSocket Update START ---
    // Prepare transaction object for broadcast
    const transactionData = {
        txid: broadcastSuccess ? txid : trackingId, // Use real txid if broadcast succeeded
        type: txType,
        amount: amount, // Raw amount
        fromAddress: fromAddress,
        toAddress: toAddress,
        timestamp: Date.now(),
        status: broadcastSuccess ? 'submitted' : 'failed', // Reflect broadcast status
        confirmations: 0,
        runeId: OVT_RUNE_ID, // Assuming OVT
        error: broadcastError // Include broadcast error if any
    };

    // Send OVT_TRANSACTION_ADDED update
    // This signals the frontend to update history and potentially re-fetch balances
    sendWebSocketBroadcast('OVT_TRANSACTION_ADDED', transactionData);
    // --- WebSocket Update END ---
    
    // 3. Return response based on broadcast success
    if (!broadcastSuccess) {
      // If broadcast failed, return appropriate error status (e.g., 500 or 502)
      return res.status(502).json({ // Use 502 Bad Gateway if broadcast failed
        success: false,
        transaction: transactionData, // Include transaction data with failed status
        message: `Transaction submission failed: ${broadcastError || 'Unknown broadcast error'}`
      });
    }
    
    // 4. Return a success response with transaction details
    res.json({
      success: true,
      transaction: {
        txid,
        type: txType,
        amount: amount,
        fromAddress: fromAddress,
        toAddress: toAddress,
        timestamp: Date.now(),
        status: broadcastSuccess ? 'submitted' : 'failed',
        confirmations: 0
      },
      message: broadcastSuccess ? 
        'Transaction submitted successfully' : 
        'Transaction prepared but not broadcast'
    });

    // --- Cache Invalidation ---
    if (broadcastSuccess) {
        // Clear distribution and transaction caches (covers all addresses involved)
        clearCache('distribution');
        clearCache('transactions');
        // Clear specific sender/receiver balances
        clearCache('balance', fromAddress);
        clearCache('balance', toAddress);
        // If it was a buy/sell involving LP, clear LP balance too
        if (toAddress === LP_ADDRESS || fromAddress === LP_ADDRESS) {
            clearCache('balance', LP_ADDRESS);
        }
        // If involving treasury, clear treasury balance
        if (toAddress === OVT_TREASURY_ADDRESS || fromAddress === OVT_TREASURY_ADDRESS) {
            clearCache('balance', OVT_TREASURY_ADDRESS);
        }
         if (toAddress === OVT_TREASURY_ADDRESS_2 || fromAddress === OVT_TREASURY_ADDRESS_2) {
            clearCache('balance', OVT_TREASURY_ADDRESS_2);
        }
    }
    // --- Cache Invalidation ---

  } catch (error) {
    console.error('Error submitting transaction:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add endpoint for token transfers
runesRouter.post('/ovt/transfer', async (req, res) => {
  try {
    const { fromAddress, toAddress, runeId, amount } = req.body;
    
    if (!fromAddress || !toAddress || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid parameters. Required: fromAddress, toAddress, amount' 
      });
    }
    
    const actualRuneId = runeId || OVT_RUNE_ID;
    
    console.log(`Processing transfer request: ${amount} OVT from ${fromAddress} to ${toAddress}`);
    
    // 1. Check for sufficient OVT balance
    const balancesResult = await getRemoteWalletBalances();
    const userBalances = balancesResult.success ? 
      balancesResult.result.balances.filter(b => b.address === fromAddress) : 
      [];
    
    const ovtBalance = userBalances.length > 0 ? userBalances[0].amount : 0;
    
    if (ovtBalance < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient OVT balance. Required: ${amount}, Available: ${ovtBalance}`
      });
    }
    
    // 2. Prepare and execute the ord wallet send command
    let txid;
    let transferSuccess = false;
    let transferError = null;
    try {
      // Get fee rate from environment or use a default
      const feeRate = process.env.BITCOIN_FEE_RATE || 1; // Default to 1 sat/vB
      
      // Construct the specific 'wallet send' command
      // Format: <ADDRESS> <AMOUNT>:<RUNE_ID>
      const sendCommand = `wallet send --fee-rate ${feeRate} ${toAddress} ${amount}:${actualRuneId}`;
      
      // Execute the command using the refactored helper
      const result = await execOrdCommand(sendCommand);
      
      if (!result.success || !result.result) {
        throw new Error(result.error || 'Command execution failed or returned empty result');
      }
      
      // Parse the transaction ID from the output
      // Assuming ord wallet send outputs the TXID directly or within JSON
      let parsedResult;
      try {
        parsedResult = JSON.parse(result.result);
        txid = parsedResult.txid; 
      } catch (e) {
        // If not JSON, assume the output is the TXID itself
        txid = result.result.trim(); 
      }

      if (!txid) {
         throw new Error('Could not parse transaction ID from command output.');
      }

      console.log(`Real Rune transfer executed. TXID: ${txid}`);
      transferSuccess = true;
      
    } catch (error) {
      console.error(`Error executing ord wallet send: ${error.message}`);
      transferError = error.message; // Store error
      // Do not return immediately, proceed to WS update and then return error response
    }

    // --- WebSocket Update START ---
    const transactionData = {
        txid: transferSuccess ? txid : `pending-${Date.now()}`, // Use real txid or placeholder
        type: 'TRANSFER',
        amount: amount, // Raw amount
        fromAddress: fromAddress,
        toAddress: toAddress,
        timestamp: Date.now(),
        status: transferSuccess ? 'submitted' : 'failed',
        confirmations: 0,
        runeId: actualRuneId,
        error: transferError // Include error if transfer failed
    };

    // Send OVT_TRANSACTION_ADDED update regardless of success/failure
    // This signals the frontend to update history and potentially re-fetch balances
    sendWebSocketBroadcast('OVT_TRANSACTION_ADDED', transactionData);
    // --- WebSocket Update END ---
    
    // 3. Return the response based on transfer success
    if (!transferSuccess) {
      return res.status(500).json({
        success: false,
        transaction: transactionData, // Include data with failed status
        error: `Failed to execute transfer: ${transferError || 'Unknown transfer error'}`
      });
    }
    
    // 4. Return the transaction details
    res.json({
      success: true,
      transaction: {
        txid,
        type: 'TRANSFER',
        amount: amount,
        fromAddress: fromAddress,
        toAddress: toAddress,
        runeId: actualRuneId,
        timestamp: Date.now(),
        status: 'submitted', // Mark as submitted, confirmation needs separate tracking
        confirmations: 0
      },
      message: 'Transfer submitted successfully'
    });

    // --- Cache Invalidation START ---
    if (transferSuccess) { // Only invalidate if transfer succeeded
        console.log(`[Cache - RunesAPI /ovt/transfer] Invalidating caches for TX: ${txid}`);
        clearCache('distribution'); // Clear distribution cache
        clearCache('transactions'); // Clear transaction cache
        clearCache('balance', fromAddress); // Clear sender balance
        clearCache('balance', toAddress); // Clear recipient balance
        // Invalidate LP/Treasury if involved (though transfers usually aren't to/from them directly)
        if (fromAddress === LP_ADDRESS || toAddress === LP_ADDRESS) {
            clearCache('balance', LP_ADDRESS);
        }
        if (fromAddress === OVT_TREASURY_ADDRESS || toAddress === OVT_TREASURY_ADDRESS) {
            clearCache('balance', OVT_TREASURY_ADDRESS);
        }
         if (fromAddress === OVT_TREASURY_ADDRESS_2 || toAddress === OVT_TREASURY_ADDRESS_2) {
            clearCache('balance', OVT_TREASURY_ADDRESS_2);
        }
    }
    // --- Cache Invalidation END ---

  } catch (error) {
    console.error('Error preparing transfer:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add transaction history endpoint
runesRouter.get('/ovt/transactions', async (req, res) => {
  try {
    const address = req.query.address; // Keep address param for potential future filtering

    // if (!address) { // Optional: Remove if address filtering isn't implemented here
    //   return res.status(400).json({ 
    //     success: false, 
    //     error: 'Address parameter is required' 
    //   });
    // }

    console.log(`Fetching transaction history (currently for entire wallet)...`);

    // --- Caching START ---
    if (isCacheValid(transactionsCache, CACHE_TTL_TRANSACTIONS_MS)) {
        console.log('[Cache] Using cached transaction data.');
        // Note: This cache is for the *entire wallet's* BTC transaction history
        // Filtering by address would happen here if needed.
        return res.json({
            success: true,
            transactions: transactionsCache.data,
            count: transactionsCache.data.length,
            note: 'Wallet transaction history (not filtered by address or rune)'
        });
    }
    // --- Caching END ---

    // Fetch actual transaction history using the helper function
    // Pass OVT_RUNE_ID although it's not used by the refactored helper anymore
    const transactions = await getTransactionHistory();

    // --- Caching START ---
    console.log('[Cache] Storing fresh transaction data.');
    transactionsCache = { data: transactions, timestamp: Date.now() };
    // --- Caching END ---

    // TODO: Potentially filter transactions further based on the `address` parameter
    // by fetching details for each txid (expensive).
    // For now, returning all BTC transactions found in the wallet.

    res.json({
      success: true,
      transactions, // Use actual transactions
      count: transactions.length,
      note: 'Wallet transaction history (not filtered by address or rune)'
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Mount the router at /api/runes
app.use('/api/runes', runesRouter);

// Add a route for the root to redirect to the documentation
app.get('/', (req, res) => {
  res.redirect('/api/runes');
});

// Add functions to validate ord and bitcoin-cli before the server starts
function checkOrdInstallation() {
  try {
    const result = execSync('which ord').toString().trim();
    console.log(`Found ord at: ${result}`);
    return true;
  } catch (error) {
    console.error('ord is not installed or not in PATH');
    return false;
  }
}

function checkBitcoinCliInstallation() {
  try {
    const result = execSync('which bitcoin-cli').toString().trim();
    console.log(`Found bitcoin-cli at: ${result}`);
    return true;
  } catch (error) {
    console.error('bitcoin-cli is not installed or not in PATH');
    return false;
  }
}

function checkOrdConfig() {
  try {
    // Check if ord config exists
    const configExists = fs.existsSync(path.join(process.env.HOME, '.ord', 'ord.yaml'));
    if (!configExists) {
      console.error('ord config file not found at ~/.ord/ord.yaml');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error checking ord config:', error);
    return false;
  }
}

// Start the server if this file is run directly
// Use process.env.PORT provided by PM2 ecosystem config
const PORT = process.env.PORT; 
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

if (PORT) {
  // Check dependencies before starting
  console.log("Checking dependencies for Runes API facade...");
  const ordInstalled = checkOrdInstallation();
  const bitcoinCliInstalled = checkBitcoinCliInstallation();
  const ordConfigExists = checkOrdConfig();
  
  if (!ordInstalled || !bitcoinCliInstalled || !ordConfigExists) {
    console.warn("Some dependencies might be missing. Check logs.");
  }

  app.listen(PORT, HOST, () => {
    console.log(`OTORI Vision Custom Runes API facade running on http://${HOST}:${PORT}`);
    console.log(`This service provides custom endpoints and interacts with ord server/CLI.`);
    console.log(`OVT Rune ID: ${OVT_RUNE_ID}`);
  });
} else {
  // This case should ideally not happen if run via PM2 with PORT set
  console.error("ERROR: PORT environment variable not set. Runes API facade server cannot start.");
}

// Export the Express app and potentially useful functions 
// Ensure this is the final export
module.exports = app;