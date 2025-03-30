# OTORI Liquidity Pool (LP) Wallet Documentation

This document explains the LP wallet functionality, how to use it, and how to distribute Runes tokens to it for trading simulation.

## Overview

The Liquidity Pool (LP) wallet is a specialized wallet that holds Runes tokens for simulating trading activities. It maintains a balance of both OTORI•VISION•TOKEN (OVT) and testnet Bitcoin to facilitate trades.
**current address:** 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f'

Key features:
- Holds a designated portion (typically 10%) of the total OVT supply
- Used for simulating buy/sell orders
- Maintains pricing information for OVT/BTC trading pair
- Tracks liquidity metrics
- Supports distributed liquidity across multiple addresses
- Implements off-chain order matching to minimize transaction costs

## LP Wallet Addresses

The LP wallet system now supports multiple designated Taproot addresses for distributed liquidity:

```
# Primary LP address
LP_ADDRESS="tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f"

# Secondary LP addresses for load distribution and redundancy
LP_ADDRESS_2="tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz"
LP_ADDRESS_3="tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh"
```

These addresses should be updated in the appropriate environment variables or configuration files before running the distribution scripts.

## Distributed Liquidity Architecture

The LP system now features a distributed liquidity architecture that:

1. **Spreads Risk**: Distributes OVT tokens across multiple LP addresses with configurable weights
2. **Improves Availability**: Maintains service even if one LP address encounters issues
3. **Optimizes Resource Usage**: Distributes transaction load across multiple UTXOs
4. **Enables Redundancy**: Provides fallback options if a primary LP address is unavailable

### Distribution Weights

You can configure how tokens are distributed across LP addresses:

```javascript
// Example configuration in distribute_lp_runes.js
const config = {
  // Other config options...
  lpAddresses: [
    process.env.LP_ADDRESS || 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f',
    process.env.LP_ADDRESS_2 || 'tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz',
    process.env.LP_ADDRESS_3 || 'tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh',
  ],
  distributionWeights: [0.5, 0.3, 0.2], // Proportional distribution
};
```

The system automatically normalizes weights to ensure they sum to 1.0.

## Liquidity Rebalancing

The enhanced LP system includes automatic liquidity rebalancing functionality to ensure optimal fund distribution across LP addresses.

### Rebalancing Features

- **Threshold-Based**: Only rebalances when imbalances exceed a configurable threshold (default 30%)
- **Minimal Transfers**: Calculates optimal transfer amounts to minimize fees
- **Smart UTXO Selection**: Uses optimal UTXO selection algorithm to preserve larger UTXOs
- **Fee Estimation**: Provides accurate fee estimation before rebalancing
- **Detailed Logging**: Shows comprehensive information about the rebalancing process

### Using the Rebalancing Feature

1. Access through the LP PSBT Management Tool:
   ```bash
   node scripts/manage_lp_psbts.js
   # Select option 6: "Rebalance LP addresses"
   ```

2. The tool will:
   - Detect LP addresses from environment variables or prompt for manual entry
   - Check current balances across all addresses
   - Calculate average and identify imbalances
   - Create rebalancing PSBTs as needed
   - Guide through signing and broadcasting

3. Configuration options:
   - Set custom threshold percentage (default: 30%)
   - Set minimum transfer amount (default: 1000 sats)
   - Configure UTXO selection strategy

## Distribution Scripts

### `distribute_lp_runes.js`

This script automates the process of distributing Runes tokens to the LP wallet. It prepares PSBTs, handles wallet signing, and tracks distribution progress.

Usage:
```bash
# Basic usage with default values
node scripts/distribute_lp_runes.js

# Customized usage with environment variables
export API_BASE_URL="http://localhost:3030"
export RUNE_ID="240249:101"
export LP_ADDRESS="tb1pyour_actual_lp_address"
export LP_ADDRESS_2="tb1pyour_second_lp_address"
export LP_ADDRESS_3="tb1pyour_third_lp_address"
export AMOUNT="210000"
export BATCH_SIZE="5000"  # Optimized default batch size
node scripts/distribute_lp_runes.js
```

Enhanced features:
1. **Distributed Allocation**: Distributes tokens across multiple LP addresses
2. **Batch Size Optimization**: Dynamically adjusts batch size based on available funds
3. **UTXO Management**: Implements intelligent UTXO selection for efficient transactions
4. **Security Improvements**: Input validation and protection against command injection

### `manage_lp_psbts.js`

This script helps with managing and processing PSBTs for the LP wallet. It provides various utilities for working with PSBTs.

Usage:
```bash
# Basic usage with default values
node scripts/manage_lp_psbts.js

# Customized usage with environment variables
export DATA_DIR="./my-psbts"
export BITCOIN_CLI_PATH="/path/to/bitcoin-cli"
export NETWORK="testnet"
export WALLET_NAME="lp_wallet"
export LP_ADDRESS="tb1pyour_actual_lp_address"
export LP_ADDRESS_2="tb1pyour_second_lp_address"
export LP_ADDRESS_3="tb1pyour_third_lp_address"
node scripts/manage_lp_psbts.js
```

Enhanced features:
- **Liquidity Rebalancing**: Option 6 in the menu for rebalancing LP addresses
- **Optimized PSBT Creation**: Creates PSBTs with smart UTXO selection
- **Enhanced Wallet Status**: Shows detailed UTXO breakdown and balance distribution
- **Security Improvements**: Secure API calls and comprehensive validation

## Off-Chain Order Matching Service

The trading system now includes a sophisticated off-chain order matching service that reduces the number of on-chain transactions needed for trading activity.

### Key Features

1. **Order Book Management**: Maintains a complete order book with buy and sell orders
2. **Efficient Matching**: Matches compatible orders based on price
3. **Transaction Batching**: Groups matched orders to minimize blockchain transactions
4. **Persistent Storage**: Saves order book state to disk with transaction journaling
5. **Crash Recovery**: Automatically recovers state after system restarts
6. **Rate Limiting**: Prevents service overload with configurable rate limiting

### Architecture

The order matching service consists of two main components:

1. **OrderMatchingService** (`backend/api/services/orderMatchingService.js`): Core service that handles:
   - Order book management and persistence
   - Order matching algorithm
   - Transaction journaling and recovery
   - Batch optimization for on-chain execution

2. **TradingService** (`backend/api/services/tradingService.js`): API-facing service that:
   - Integrates with the order matching service
   - Provides fallback mechanisms for reliability
   - Exposes a consistent API for frontend integration
   - Handles error conditions gracefully

### Order Lifecycle

1. **Order Creation**: Users place buy or sell orders with price and amount
2. **Order Matching**: Service matches compatible orders (buy price >= sell price)
3. **Execution Batching**: Matched orders are grouped by buyer/seller pairs
4. **On-Chain Execution**: Batched orders are executed as single transactions
5. **Status Updates**: Order status is updated throughout the process

### API Endpoints (via TradingService)

- `getOrderbook()`: Returns current order book with bids and asks
- `placeOrder(order)`: Places a new buy or sell order
- `getUserOrders(address)`: Gets all orders for a specific address
- `cancelOrder(orderId, address)`: Cancels an open order
- `getRecentTrades()`: Gets recently executed trades
- `getStats()`: Gets service statistics

## API Endpoints

The following API endpoints are available for interacting with the LP wallet:

### `/rune/:id/balances`

Returns the balances of all addresses holding the specified rune, including the LP wallet.

Example response:
```json
{
  "success": true,
  "balances": [
    {
      "address": "tb1ptreasury...",
      "amount": 1680000,
      "isTreasury": true,
      "isLP": false
    },
    {
      "address": "tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f",
      "amount": 105000,
      "isTreasury": false,
      "isLP": true
    },
    {
      "address": "tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz",
      "amount": 63000,
      "isTreasury": false,
      "isLP": true
    },
    {
      "address": "tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh",
      "amount": 42000,
      "isTreasury": false,
      "isLP": true
    },
    {
      "address": "tb1pexampleaddress1",
      "amount": 105000,
      "isTreasury": false,
      "isLP": false
    }
  ]
}
```

### `/rune/:id/distribution`

Returns distribution statistics for the rune, including LP wallet allocation.

Example response:
```json
{
  "success": true,
  "distributionStats": {
    "totalSupply": 2100000,
    "treasuryHeld": 1680000,
    "lpHeld": 210000,
    "distributed": 210000,
    "percentDistributed": 10,
    "percentInLP": 10,
    "treasuryAddresses": ["tb1ptreasury..."],
    "lpAddresses": [
      "tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f",
      "tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz",
      "tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh"
    ],
    "distributionEvents": [
      {
        "txid": "lpallocation1",
        "amount": 210000,
        "timestamp": 1621459200000,
        "recipient": "LP Addresses (Distributed)",
        "type": "lp_allocation"
      }
    ]
  }
}
```

### `/rune/:id/lp-info`

Returns detailed information about the LP wallet's liquidity and trading activity.

Example response:
```json
{
  "success": true,
  "lpInfo": {
    "addresses": [
      "tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f",
      "tb1p7pjgu34lprrtj24gq203zyyjjju34e9ftaarstjas2877zxuar2q5ru9yz",
      "tb1prujv33np5rfkpz9mh9qyqaulkz5fvz79aj35cdqg357e7c3ze4dq6p7njh"
    ],
    "liquidity": {
      "ovt": 210000,
      "btcSats": 52500000,
      "impactMultiplier": 0.00001,
      "distribution": {
        "primary": 105000,
        "secondary": 63000,
        "tertiary": 42000
      }
    },
    "pricing": {
      "currentPriceSats": 250,
      "lastTradeTime": 1621459200000,
      "dailyVolume": 15000,
      "weeklyVolume": 45000
    },
    "orderMatching": {
      "pendingOrders": 12,
      "matchedPairs": 8,
      "batchesCreated": 3,
      "lastMatchTime": 1621459200000
    },
    "transactions": [
      {
        "txid": "mock_trade_1",
        "type": "buy",
        "amount": 5000,
        "priceSats": 245,
        "timestamp": 1621459200000
      }
    ]
  }
}
```

### `/trading/orderbook`

Returns the current order book from the order matching service.

Example response:
```json
{
  "success": true,
  "orderbook": {
    "bids": [
      { "id": "bid1", "price": 300000, "amount": 10000, "remaining": 10000, "address": "user-address-1", "status": "open" },
      { "id": "bid2", "price": 290000, "amount": 15000, "remaining": 15000, "address": "user-address-2", "status": "open" }
    ],
    "asks": [
      { "id": "ask1", "price": 310000, "amount": 8000, "remaining": 8000, "address": "user-address-3", "status": "open" },
      { "id": "ask2", "price": 320000, "amount": 12000, "remaining": 12000, "address": "user-address-4", "status": "open" }
    ],
    "lastUpdate": 1658481625000
  }
}
```

## How to Set Up the LP Wallet

1. Create a new Bitcoin Core wallet (testnet):
   ```bash
   bitcoin-cli -testnet createwallet lp_wallet
   ```

2. Generate multiple Taproot addresses for distributed liquidity:
   ```bash
   # Primary LP address
   bitcoin-cli -testnet -rpcwallet=lp_wallet getnewaddress "" "bech32m"
   
   # Secondary LP address
   bitcoin-cli -testnet -rpcwallet=lp_wallet getnewaddress "" "bech32m"
   
   # Tertiary LP address (optional)
   bitcoin-cli -testnet -rpcwallet=lp_wallet getnewaddress "" "bech32m"
   ```

3. Update the LP_ADDRESS constants in the appropriate files:
   - `OTORI-Vision/backend/api/runes_API.js`
   - `OTORI-Vision/backend/api/services/tradingService.js`
   - `OTORI-Vision/backend/api/services/orderMatchingService.js`
   - Environment variables for your deployment

4. Fund the wallet with testnet Bitcoin:
   - You'll need approximately 0.01 tBTC per 100,000 OVT tokens distributed
   - Distribute funds across all LP addresses
   - Use a testnet faucet to get testnet Bitcoin

5. Run the distribution script to allocate OVT tokens to the LP wallet:
   ```bash
   node scripts/distribute_lp_runes.js
   ```

6. Check the liquidity balance distribution and rebalance if needed:
   ```bash
   node scripts/manage_lp_psbts.js
   # Select option 6 to rebalance if necessary
   ```

7. Start the order matching service (runs automatically with the API):
   ```bash
   # Start the API service which includes the order matching service
   npm run start:api
   ```

## Testnet Bitcoin Requirements

For distributing OVT to the LP wallet, you'll need testnet Bitcoin to cover:

1. **Transaction fees**: Typically 1000 sats per transaction
2. **Dust outputs**: 546 sats per output
3. **Buffer**: Additional 20% for network fee fluctuations

The script now includes adaptive batch sizing that:
- Checks available testnet funds before distribution
- Calculates optimal batch size based on funds and fee estimates
- Limits maximum batches per run to prevent fund depletion

In practice, you should fund each LP address with at least 0.001 tBTC to ensure smooth operation.

## Performance Optimization

The LP system includes several optimizations for improved performance:

1. **Memory Efficiency**:
   - Streams PSBT files instead of loading all at once
   - Processes in sequence to control memory usage

2. **Rate Limiting**:
   - Limits API calls and bitcoin-cli commands to prevent overload
   - Configurable throttling for different operation types

3. **Batch Processing Optimization**:
   - Adapts batch size based on available system resources
   - Checks available memory before distribution

4. **Asynchronous Operations**:
   - Uses promises for file operations to avoid blocking
   - Implements non-blocking API calls

## System Resilience

The LP system includes several features for improved resilience:

1. **Transaction Journaling**:
   - Records all operations in a transaction journal
   - Enables recovery from crashes or interruptions
   - Tracks operation history for troubleshooting

2. **Graceful Shutdown**:
   - Handles termination signals appropriately
   - Saves state before exiting
   - Prevents data loss during interruptions

3. **Comprehensive Logging**:
   - Detailed structured logging with different log levels
   - Persistent log storage for troubleshooting
   - Separate error logs for critical issues 