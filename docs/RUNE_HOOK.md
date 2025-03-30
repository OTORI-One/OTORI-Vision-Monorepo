# OVT Rune Integration Module Documentation

## Overview

The `useRuneIntegration` hook provides a complete interface for interacting with OVT (OTORI Vision Token) Rune tokens on Bitcoin Signet. It abstracts away the complexity of working with the Runes API and wallet connections, providing simple methods for token operations.

## Installation

```bash
# No additional installation needed - dependencies already present:
# - axios for API requests
# - @omnisat/lasereyes for wallet integration
```

## Usage

```typescript
import useRuneIntegration from '../hooks/useRuneIntegration';

const MyComponent = () => {
  const { 
    balance, 
    metadata,
    getBalance, 
    transferRune
  } = useRuneIntegration();
  
  // Your component logic
};
```

## Key Features

- **Token Balance Querying**: Get OVT balances for any Bitcoin address
- **Token Metadata**: Access token information like symbol, name, and supply
- **Token Transfers**: Transfer OVT tokens between addresses
- **Transaction History**: Retrieve token transaction history
- **Distribution Statistics**: View token distribution and supply statistics

## API Reference

```typescript
interface RuneMetadata {
  id: string;           // Rune ID
  symbol: string;       // Full Rune symbol
  ticker: string;       // Short ticker (OVT)
  name: string;         // Human-readable name
  description: string;  // Token description
  supply: {
    total: number;      // Total token supply
    circulating: number; // Circulating supply
    maximum: number;    // Maximum possible supply
  };
  divisibility: number; // Token decimal places
  icon?: string;        // Token icon URL
}

// Main hook API
const {
  // State
  isLoading,           // Loading status
  error,               // Error information
  balance,             // Current wallet balance
  metadata,            // Token metadata
  transactions,        // Transaction history
  
  // Actions
  getBalance,          // Get token balance
  getTokenMetadata,    // Get token information
  transferRune,        // Transfer tokens
  getTransactionHistory, // Get transaction history
  getDistributionStats,  // Get distribution statistics
  formatTokenAmount,     // Format token amount with decimals
  
  // Constants
  OVT_RUNE_ID,         // Rune ID constant
  OVT_RUNE_SYMBOL,     // Full Rune symbol
  OVT_RUNE_TICKER,     // Short ticker symbol
  isConnected          // Wallet connection status
} = useRuneIntegration();
```