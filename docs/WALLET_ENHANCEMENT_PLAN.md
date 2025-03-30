# OTORI Vision Wallet Enhancement Plan

This document outlines the plan for enhancing the OTORI Vision wallet functionality, including implementing transaction confirmations, fixing network configuration issues, and ensuring proper balance display.

## 1. Network Configuration Issues

### Current Status

- The application was incorrectly configured to use `TESTNET4` in the LaserEyesProvider
- Actual wallet connections are using Bitcoin Signet network
- CORS issues and network errors are occurring due to this mismatch

### Resolution Plan

1. **Fix Network Configuration**
   - ✅ Update LaserEyesProvider in `_app.tsx` to use `BaseNetwork.SIGNET`
   - Configure all Bitcoin API calls to specifically target Signet endpoints

2. **Plan for TestNet4 Migration**
   - Research the exact relationship between Testnet4 and Signet
   - Document the technical differences and requirements
   - Create a migration path that allows the application to support both networks during transition
   - Update wallet connection logic to handle network switching gracefully

## 2. Transaction Confirmation Implementation

### Requirements

- Add a confirmation dialog before executing buy/sell transactions
- Display transaction details for user verification
- Implement a confirmation mechanism that prevents accidental trades

### Implementation Plan

1. **Create Confirmation Modal Component**
   - Build a reusable `TransactionConfirmationModal` component
   - Include fields for:
     - Transaction type (Buy/Sell)
     - Amount
     - Price
     - Total value
     - Fee estimate
     - Network (Signet)

2. **Integrate with Trading Flow**
   - Modify the buy/sell functions in `useTradingModule.ts` to:
     - Capture transaction details
     - Trigger confirmation modal
     - Execute transaction only after confirmation
   - Add state management for pending transactions

3. **User Experience Improvements**
   - Add loading states during transaction preparation
   - Implement success/error feedback
   - Show transaction status in real-time

## 3. Wallet Balance Display Fixes

### Current Issues

- Bitcoin (BTC) balance shows as 0 even when the wallet has funds
- Network errors when trying to fetch UTXOs
- Inconsistent balance updates

### Solution Plan

1. **Enhanced BTC Balance Fetching**
   - ✅ Improve the UTXO fetching mechanism in `WalletTokenDisplay.tsx`
   - ✅ Add direct Signet explorer API as a fallback
   - Add proper error handling and retry logic

2. **Network-Aware Balance Display**
   - Update balance fetching logic to be network-aware
   - Implement caching to prevent excessive API calls
   - Add visual indicators for the active network

3. **Mempool Integration for Pending Transactions**
   - Integrate with mempool APIs to show pending transactions
   - Display confirmations for recent transactions
   - Implement balance forecasting that includes pending transactions

## 4. Implementation Timeline

| Task | Estimated Time | Priority |
|------|----------------|----------|
| Fix Network Configuration | 0.5 days | High |
| Create Transaction Confirmation Modal | 1 day | High |
| Integrate Confirmation with Trading Flow | 1 day | High |
| Enhance BTC Balance Fetching | 0.5 days | High |
| Implement Network-Aware Balance Display | 1 day | Medium |
| Add Mempool Integration | 1.5 days | Medium |
| Testing and Bug Fixes | 2 days | High |

## 5. Technical Considerations

### Network Compatibility

Bitcoin has several test networks, each with different characteristics:

- **Testnet** (currently at Testnet3): The main Bitcoin test network
- **Signet**: A centrally controlled test network for more predictable block generation
- **Regtest**: Local testing network
- **"Testnet4"**: Not an official Bitcoin Core network; appears to be a wallet-specific term

Our application should:
1. Clearly identify which network is being used
2. Support multiple networks through configuration
3. Provide clear error messages when network mismatches occur

### LaserEyes Integration

The LaserEyes library needs to be properly configured for Signet:

```typescript
<LaserEyesProvider 
  config={{ 
    network: BaseNetwork.SIGNET
  }}
>
  <App />
</LaserEyesProvider>
```

### API Endpoints

Different Bitcoin networks use different API endpoints:

- Signet: `https://mempool.space/signet/api/`
- Testnet: `https://mempool.space/testnet/api/`

All API calls must be updated to use the correct network endpoints.

## 6. Next Steps

1. Implement the Transaction Confirmation Modal
2. Update Trading Module to use the confirmation flow
3. Enhance the wallet balance display with proper network awareness
4. Test the wallet functionality across different scenarios
5. Document the network architecture for future reference 