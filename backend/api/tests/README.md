# OTORI Vision Test Suite

This directory contains test scripts and utilities for testing OTORI Vision functionality.

## Available Tests

### Rune Transfer Tests

The Rune transfer tests verify that the OVT token (Rune) transfer functionality is working correctly. The tests check:

1. Rune balance checking
2. Direct Rune transfers using the `transferRunes` function
3. Token transfers through the trading service using `transferTokensFromLP`
4. Buy order execution through the trading service

#### Running the Tests

To run the Rune transfer tests:

```bash
# From the project root
cd backend/api/scripts
./test-rune-transfers.sh
```

### Requirements for Rune Tests

To run the Rune transfer tests, you need:

1. A running Bitcoin node on Signet
2. The ord CLI tool installed and configured
3. An OVT LP wallet with sufficient OVT Runes and BTC for transaction fees
4. Proper environment variables set in your `.env` file or `ecosystem.config.js`

### Test Environment Variables

The following environment variables are used in the tests:

- `ENABLE_REAL_TRANSACTIONS` - Set to 'true' to enable real transactions
- `BITCOIN_WALLET` - Name of the Bitcoin wallet to use for tests
- `NEXT_PUBLIC_OVT_RUNE_ID` - ID of the OVT Rune to test
- `NEXT_PUBLIC_LP_ADDRESS` - Address of the liquidity provider that holds OVT Runes
- `ORD_PATH` - Path to the ord CLI executable
- `ORD_CONFIG_PATH` - Path to the ord configuration file

## Troubleshooting Tests

If tests fail, check the following:

1. Bitcoin node is running and accessible
2. The ord CLI tool is installed and properly configured
3. The LP wallet has sufficient OVT Runes and BTC for transaction fees
4. Environment variables are properly set

## Adding New Tests

When adding new tests, follow these guidelines:

1. Use a descriptive name for the test file
2. Include a clear description of what the test is checking
3. Add proper error handling and reporting
4. Document any special requirements or setup needed 