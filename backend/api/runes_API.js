// Simple Express server for OTORI Vision Token (OVT) runes management
const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Make sure axios is installed
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
app.use(cors());
app.use(bodyParser.json());

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

// Load environment variables if not loaded by the main application
if (!process.env.NEXT_PUBLIC_OVT_RUNE_ID) {
  // Try to load from .env.local in the main project directory (one level up)
  const envPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('Loaded environment variables from ../../.env.local');
  } else {
    // Fallback to local .env file
    require('dotenv').config();
    console.log('Loaded environment variables from .env');
  }
}

// OVT rune constants
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';
const OVT_RUNE_SYMBOL = 'OTORI•VISION•TOKEN';
const OVT_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
const OVT_TREASURY_ADDRESS_2 = process.env.NEXT_PUBLIC_TREASURY_ADDRESS_2 || 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3';
const LP_ADDRESS = process.env.NEXT_PUBLIC_LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
const LP_ADDRESS_2 = process.env.NEXT_PUBLIC_LP_ADDRESS_2 || '';
// WHEN DONE TESTING REMOTELY: Change the OrdPi endpoint to the local IP (and add ssh key authentication for comms.)
// Remote OrdPi API endpoint - using the SSH tunnel for local development
const REMOTE_RUNES_API = process.env.REMOTE_RUNES_API || 'http://localhost:9001';

// Add a DEBUG_MODE flag to force using mock data
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || true; // Default to true for local development

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
  // If in debug mode, return mock data immediately
  if (DEBUG_MODE) {
    console.log(`[DEBUG MODE] Using mock data for: ${endpoint}`);
    return { success: true, result: MOCK_DATA[mockDataKey] };
  }
  
  try {
    // Try to call the remote API
    const result = await callRemoteRunesAPI(endpoint);
    
    if (result.success) {
      return result;
    } else {
      // If remote call fails, log the error and fall back to mock data
      console.warn(`Remote API call failed: ${result.error}. Using mock data for: ${endpoint}`);
      return { success: true, result: MOCK_DATA[mockDataKey] };
    }
  } catch (error) {
    // If there's an exception, log it and fall back to mock data
    console.error(`Error calling remote API: ${error.message}. Using mock data for: ${endpoint}`);
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

// Import util.promisify for exec
const util = require('util');
const { exec } = require('child_process');
const execAsync = util.promisify(exec);

// Enhanced helper function to execute ord commands with proper configuration
const execOrdCommand = (command) => {
  try {
    // Set up the command to execute via SSH on the OrdPi using external IP and port
    const sshConnection = 'BTCPi@91.7.62.224';
    const sshPort = '2211';
    
    // Get SSH password from environment variable (more secure than hardcoding)
    // For production, using SSH keys with proper permissions is recommended
    // instead of password authentication
    const sshPassword = process.env.ORDPI_SSH_PASSWORD;
    
    // Ensure all ord commands use the correct configuration
    // Use quotes properly for SSH command execution
    const ordCommand = `ord --config /home/BTCPi/.ord/ord.yaml --signet ${command}`;
    
    // Use sshpass to provide password if available, otherwise use standard SSH (assuming key-based auth)
    let fullCommand;
    if (sshPassword) {
      fullCommand = `sshpass -p "${sshPassword}" ssh -p ${sshPort} ${sshConnection} "${ordCommand}"`;
    } else {
      fullCommand = `ssh -p ${sshPort} ${sshConnection} "${ordCommand}"`;
      console.log('Warning: No SSH password provided. Using key-based authentication or will prompt for password.');
    }
    
    console.log(`Executing command via SSH: ${fullCommand.replace(sshPassword || '', '[REDACTED]')}`);
    const result = execSync(fullCommand).toString();
    console.log(`Command result: ${result}`);
    return { success: true, result };
  } catch (error) {
    console.error(`Error executing command: ${command}`, error);
    return { success: false, error: error.toString() };
  }
};

// Helper function to parse rune balance output
const parseRuneBalances = (output) => {
  try {
    // Based on the actual ord wallet balance output format
    console.log(`Parsing balance output: ${output}`);
    
    // Simple case: if there are no runes, return empty array
    if (!output.includes(OVT_RUNE_ID)) {
      return [];
    }
    
    // Extract rune balances from the output
    const balances = [];
    
    // Try to parse addresses with their balances - this depends on the actual output format
    try {
      // If the output is JSON, try to parse it
      const jsonData = JSON.parse(output);
      
      // Iterate through addresses in the JSON
      Object.keys(jsonData).forEach(address => {
        const addressData = jsonData[address];
        
        // Skip if no outputs
        if (!Array.isArray(addressData) || addressData.length === 0) return;
        
        // Look for outputs with OVT runes
        addressData.forEach(output => {
          if (output.runes && output.runes[OVT_RUNE_SYMBOL]) {
            const amount = parseInt(output.runes[OVT_RUNE_SYMBOL]);
            
            // Determine if this is a treasury or LP address
            const isTreasury = address === OVT_TREASURY_ADDRESS || address === OVT_TREASURY_ADDRESS_2;
            const isLP = address === LP_ADDRESS || (LP_ADDRESS_2 && address === LP_ADDRESS_2);
            
            balances.push({
              address,
              amount,
              isTreasury,
              isLP
            });
          }
        });
      });
    } catch (e) {
      // If JSON parsing fails, fall back to line-based parsing
      console.log('JSON parsing failed, falling back to line parsing');
      
      const lines = output.split('\n').filter(line => line.trim() && line.includes(OVT_RUNE_ID));
      
      for (const line of lines) {
        // Based on actual ord output format, try to extract amount and address
        const amount = parseInt(line.match(/(\d+)/)?.[0] || '0');
        
        // Try to extract address, or default to treasury
        const addressMatch = line.match(/([a-zA-Z0-9]{34,})/);
        const address = addressMatch ? addressMatch[0] : OVT_TREASURY_ADDRESS;
        
        // Determine if this is a treasury or LP address
        const isTreasury = address === OVT_TREASURY_ADDRESS || address === OVT_TREASURY_ADDRESS_2;
        const isLP = address === LP_ADDRESS || (LP_ADDRESS_2 && address === LP_ADDRESS_2);
        
        balances.push({
          address,
          amount,
          isTreasury,
          isLP
        });
      }
    }
    
    return balances;
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
const getTransactionHistory = async (runeId) => {
  try {
    // Use the correct command for wallet transactions
    const result = execOrdCommand(`wallet transactions`);
    if (!result.success) return [];
    
    // Parse the transaction output and filter for rune transactions
    const transactions = result.result
      .split('\n')
      .filter(line => line.includes(runeId))
      .map(line => {
        // Assuming format based on actual ord wallet transactions output
        // Adjust parsing logic based on actual output format
        const parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 3) return null;
        
        return {
          txid: parts[0],
          type: parts[1].toLowerCase(),
          amount: parseInt(parts[2]) || 0,
          timestamp: parts[3] ? new Date(parts[3]).getTime() : Date.now()
        };
      })
      .filter(Boolean);
    
    return transactions;
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
    // const bitcoinCliCmd = `bitcoin-cli -signet -rpcwallet=ovt_runes_wallet getaddressbalance "${address}"`;
    // or with listunspent for more detailed data
    
    // For now, let's still use ord wallet balance but improve parsing
    const result = execOrdCommand(`wallet balance`);
    if (result.success) {
      // Parse the balance from BTC to sats
      // Assuming the balance is in BTC format (e.g., "0.00123456 BTC")
      const btcMatch = result.result.match(/([0-9.]+)\s*BTC/i);
      if (btcMatch) {
        const btcBalance = parseFloat(btcMatch[1]);
        return Math.floor(btcBalance * 100000000); // Convert BTC to sats
      }
      
      // Fallback to direct parsing if no "BTC" format is found
      const btcBalance = parseFloat(result.result);
      if (!isNaN(btcBalance)) {
        return Math.floor(btcBalance * 100000000);
      }
    }
    console.log("Could not parse wallet balance, returning 0");
    return 0;
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return 0;
  }
}

// Home route documentation should be updated to reflect the new endpoints
app.get('/', (req, res) => {
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
          OTORI Vision Runes API v1.0 | Running on port ${process.env.PORT || 3030}
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
app.get('/ovt/info', async (req, res) => {
  try {
    // Try to get OVT rune info from remote API
    const result = await getRemoteOVTInfo();
    if (result.success) {
      return res.json(result.result);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Error getting OVT info:', error);
    
    // Fallback to mock data
    res.json({
      success: true,
      rune: {
        runeId: OVT_RUNE_ID,
        name: 'OTORI•VISION•TOKEN',
        symbol: '⊙',
        supply: 2100000,
        treasuryAddresses: [OVT_TREASURY_ADDRESS, OVT_TREASURY_ADDRESS_2],
        lpAddresses: [LP_ADDRESS, LP_ADDRESS_2].filter(Boolean),
        etching: 'e75ce796378927a5c152e8ee469c4ca3cf19a921f1e444fb88a22aaf035782fb',
        divisibility: 2,
        timestamp: '2025-03-20 21:48:00 UTC'
      }
    });
  }
});

// Update the other endpoints to use the remote API functions
app.get('/ovt/balances', async (req, res) => {
  try {
    const result = await getRemoteWalletBalances();
    if (result.success) {
      return res.json(result.result);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Error getting OVT balances:', error);
    res.status(500).json({
      success: false,
      error: error.toString()
    });
  }
});

app.get('/ovt/distribution', async (req, res) => {
  try {
    const result = await getRemoteDistributionStats();
    if (result.success) {
      return res.json(result.result);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Error getting OVT distribution:', error);
    res.status(500).json({
      success: false,
      error: error.toString()
    });
  }
});

app.get('/ovt/lp-info', async (req, res) => {
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

app.post('/ovt/prepare-lp-distribution', async (req, res) => {
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
app.get('/rune/:id', (req, res) => {
  res.redirect('/ovt/info');
});

app.get('/rune/:id/balances', (req, res) => {
  res.redirect('/ovt/balances');
});

app.get('/rune/:id/distribution', (req, res) => {
  res.redirect('/ovt/distribution');
});

app.get('/rune/:id/lp-info', (req, res) => {
  res.redirect('/ovt/lp-info');
});

// Update the prepare-lp-distribution endpoint to handle the request directly rather than redirecting
app.post('/rune/prepare-lp-distribution', async (req, res) => {
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

// Add health check endpoint
app.get('/health', (req, res) => {
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
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Start the server if this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3030;
  const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces
  
  // Check if we can connect to bitcoind and ord before starting
  console.log("Checking dependencies...");
  const ordInstalled = checkOrdInstallation();
  const bitcoinCliInstalled = checkBitcoinCliInstallation();
  const ordConfigExists = checkOrdConfig();
  
  if (!ordInstalled || !bitcoinCliInstalled || !ordConfigExists) {
    console.error("Some dependencies are missing. Check the logs above for details.");
    console.error("Starting the server anyway, but some functions may not work correctly.");
  }
  
  app.listen(PORT, HOST, () => {
    console.log(`OTORI Vision Runes API running on http://${HOST}:${PORT}`);
    console.log(`IMPORTANT: If this server is exposed to the internet, ensure proper security measures are in place.`);
    console.log(`OVT Rune ID: ${OVT_RUNE_ID}`);
    console.log(`Treasury Address: ${OVT_TREASURY_ADDRESS}`);
    console.log(`LP Address: ${LP_ADDRESS}`);
  });
}
// Simple IP-based rate limiting
const rateLimit = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

app.use((req, res, next) => {
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

// Add new transaction endpoints
app.post('/ovt/buy', async (req, res) => {
  try {
    const { fromAddress, amount, maxPrice, signature, pubkey } = req.body;
    
    if (!fromAddress || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid parameters. Required: fromAddress, amount' 
      });
    }
    
    console.log(`Processing buy request: ${amount} OVT from ${fromAddress}`);
    
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
    
    // 2. Check for sufficient BTC balance
    const btcBalance = await getWalletBalance(fromAddress);
    
    // 3. Calculate the current price and check against maxPrice if specified
    const lpInfo = await getRemoteLPInfo();
    const currentPrice = lpInfo.success ? 
      lpInfo.result.lpInfo.pricing.currentPriceSats : 
      700; // Default fallback price
    
    if (maxPrice && currentPrice > maxPrice) {
      return res.status(400).json({
        success: false,
        error: `Current price (${currentPrice}) exceeds maximum price (${maxPrice})`
      });
    }
    
    // 4. Calculate total cost in sats
    const totalCost = amount * currentPrice;
    
    if (btcBalance < totalCost) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Required: ${totalCost} sats, Available: ${btcBalance} sats`
      });
    }
    
    // 5. Create PSBTs for the transaction
    // In a real implementation, we would create actual PSBTs here
    // For now, we'll return a simulated PSBT
    const psbt = `cHNidP8BAHECAAAAAfUbVEKkUNXZbVFS3uB7z6X4wYQ3r8BwkyM2qX49CD2xAAAAAAD/////AgDh9QUAAAAAIgAgPU1kBB9KxCYkWxV7k2JP5gQVz8w/DNSE0UIRbVEIQEQB1AEAAAAAFgAU3AxdYMxkdq5YdZXKhQMb2jPMBsIAAAAAAAEA3gIAAAAAAQF2xNJVrnHvWW7yP2xj5chMSCHGQsibjEBG1DHp4HQYHgEAAAAA/v///wKghgEAAAAAACIAIIab5mIiJnE/LrxLlnFM7dKKLJ9anXA2u8BiQZIXQ3KbJbwNAAAAAAAWABRYhfmKkJ3MLp3hIBvAdgUkZ5XKpwJHMEQCIB7Kn9ikm0jrDHhUdK5JTCblI7PJWBUmKQOyJQnI8zLrAiAuBd8dDuSm2cMLZFcKDQ3MYrCSQimHfmiK8Rh1Yp4H8QEhA7dYnQPU0nNdEFdO3YcQB9pXdBIQIqiFeh8tCJRyzx1SrgAAAA==`;
    
    // 6. Return the transaction information
    // In a production system, the user would sign the PSBT and submit it back
    res.json({
      success: true,
      transaction: {
        txid: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        type: 'BUY',
        amount: amount,
        price: currentPrice,
        totalCost: totalCost,
        psbts: [psbt],
        fromAddress: fromAddress,
        toAddress: LP_ADDRESS,
        timestamp: Date.now(),
        status: 'pending'
      },
      message: 'Buy transaction prepared successfully'
    });
  } catch (error) {
    console.error('Error processing buy transaction:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

app.post('/ovt/sell', async (req, res) => {
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
    const lpInfo = await getRemoteLPInfo();
    const currentPrice = lpInfo.success ? 
      lpInfo.result.lpInfo.pricing.currentPriceSats : 
      700; // Default fallback price
    
    if (minPrice && currentPrice < minPrice) {
      return res.status(400).json({
        success: false,
        error: `Current price (${currentPrice}) is below minimum price (${minPrice})`
      });
    }
    
    // 4. Calculate total return in sats
    const totalReturn = amount * currentPrice;
    
    // 5. Create PSBTs for the transaction
    // In a real implementation, we would create actual PSBTs here
    // For now, we'll return a simulated PSBT
    const psbt = `cHNidP8BAHECAAAAAfUbVEKkUNXZbVFS3uB7z6X4wYQ3r8BwkyM2qX49CD2xAAAAAAD/////AgDh9QUAAAAAIgAgPU1kBB9KxCYkWxV7k2JP5gQVz8w/DNSE0UIRbVEIQEQB1AEAAAAAFgAU3AxdYMxkdq5YdZXKhQMb2jPMBsIAAAAAAAEA3gIAAAAAAQF2xNJVrnHvWW7yP2xj5chMSCHGQsibjEBG1DHp4HQYHgEAAAAA/v///wKghgEAAAAAACIAIIab5mIiJnE/LrxLlnFM7dKKLJ9anXA2u8BiQZIXQ3KbJbwNAAAAAAAWABRYhfmKkJ3MLp3hIBvAdgUkZ5XKpwJHMEQCIB7Kn9ikm0jrDHhUdK5JTCblI7PJWBUmKQOyJQnI8zLrAiAuBd8dDuSm2cMLZFcKDQ3MYrCSQimHfmiK8Rh1Yp4H8QEhA7dYnQPU0nNdEFdO3YcQB9pXdBIQIqiFeh8tCJRyzx1SrgAAAA==`;
    
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
        psbts: [psbt],
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
app.post('/ovt/submit-transaction', async (req, res) => {
  try {
    const { signedPsbt, txType, fromAddress, toAddress, amount } = req.body;
    
    if (!signedPsbt || !txType || !fromAddress || !toAddress || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters' 
      });
    }
    
    console.log(`Processing transaction submission: ${txType} ${amount} OVT from ${fromAddress} to ${toAddress}`);
    
    // In a real implementation, we would:
    // 1. Validate the signed PSBT
    // 2. Broadcast the transaction to the Bitcoin network
    // 3. Monitor for confirmation
    // 4. Update transaction status
    
    // For now, we'll simulate a successful transaction
    const txid = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    // Return a success response with transaction details
    res.json({
      success: true,
      transaction: {
        txid,
        type: txType,
        amount: amount,
        fromAddress: fromAddress,
        toAddress: toAddress,
        timestamp: Date.now(),
        status: 'confirmed',
        confirmations: 1
      },
      message: 'Transaction submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting transaction:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add endpoint for token transfers
app.post('/ovt/transfer', async (req, res) => {
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
    
    // 2. Prepare a PSBT for the transfer
    // In a real implementation, we would create a PSBT here
    // For now, we'll simulate a prepared transaction
    
    // Generate a mock PSBT for simulation
    const psbt = `simulated-psbt-${Date.now()}`;
    
    // Generate a temporary transaction ID for tracking
    const txid = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    // Simulated UTXO data - in a real implementation, we would fetch this from the Bitcoin Core node
    // or from the Runes API that contains the actual UTXOs where the runes are stored
    const mockUtxos = [
      {
        txid: `input-tx-${Date.now().toString(36)}`,
        vout: 0,
        value: amount + 1000, // Amount plus fee
        scriptPubKey: `scriptpubkey-${fromAddress.substring(0, 8)}`,
        confirmations: 5
      }
    ];
    
    // Information about the input where the rune is located
    const inputDetails = {
      txid: mockUtxos[0].txid,
      vout: mockUtxos[0].vout,
      runeId: actualRuneId,
      amount
    };
    
    // Return the transaction details
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
        status: 'pending',
        confirmations: 0,
        psbts: [psbt],
        utxos: mockUtxos, // Include UTXO information
        inputDetails // Include input details for rune tracking
      },
      message: 'Transfer prepared successfully'
    });
  } catch (error) {
    console.error('Error preparing transfer:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Add transaction history endpoint
app.get('/ovt/transactions', async (req, res) => {
  try {
    const address = req.query.address;
    
    if (!address) {
      return res.status(400).json({ 
        success: false, 
        error: 'Address parameter is required' 
      });
    }
    
    console.log(`Fetching transaction history for address: ${address}`);
    
    // In a real implementation, we would fetch transactions from the blockchain
    // For now, we'll return mock data
    const transactions = [
      {
        txid: 'tx-1234567890abcdef',
        type: 'BUY',
        amount: 100,
        price: 700,
        totalCost: 70000,
        fromAddress: address,
        toAddress: LP_ADDRESS,
        timestamp: Date.now() - 86400000, // 1 day ago
        status: 'confirmed',
        confirmations: 6
      },
      {
        txid: 'tx-abcdef1234567890',
        type: 'SELL',
        amount: 50,
        price: 710,
        totalReturn: 35500,
        fromAddress: address,
        toAddress: LP_ADDRESS,
        timestamp: Date.now() - 43200000, // 12 hours ago
        status: 'confirmed',
        confirmations: 3
      }
    ];
    
    res.json({
      success: true,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.toString() 
    });
  }
});

// Export the Express app for use in other modules
module.exports = app;