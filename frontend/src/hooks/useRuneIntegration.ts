/**
 * useRuneIntegration Hook
 * 
 * A dedicated hook for integrating with OVT Rune tokens on Bitcoin Signet.
 * This hook provides functionality for:
 * - Querying OVT token balances for wallet addresses
 * - Getting token metadata
 * - Handling token transfers
 * - Retrieving transaction history
 * 
 * It communicates with the backend Runes API to perform these operations.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useLaserEyes } from '@omnisat/lasereyes';
import { getPriceStore } from '../services/priceService'; // Added import

// OVT Rune constants
export const OVT_RUNE_ID = '240249:101';
export const OVT_RUNE_SYMBOL = 'OTORI•VISION•TOKEN';
export const OVT_RUNE_TICKER = 'OVT';
export const OVT_TREASURY_ADDRESS = 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
export const OVT_LP_ADDRESS = 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';

// Token metadata interface
export interface RuneMetadata {
  id: string;
  symbol: string;
  ticker: string;
  name: string;
  description: string;
  supply: {
    total: number;
    circulating: number;
    maximum: number;
  };
  divisibility: number;
  icon?: string;
}

// Transaction result interface
export interface TransactionResult {
  txid: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations: number;
  timestamp: number;
  price?: number;
  totalCost?: number;
  totalReturn?: number;
  psbts?: string[];
  utxos?: Array<{
    txid: string;
    vout: number;
    value: number;
    scriptPubKey: string;
    confirmations: number;
  }>;
  inputDetails?: {
    txid: string;
    vout: number;
    runeId: string;
    amount: number;
  };
}

// Transaction interface
export interface RuneTransaction {
  txid: string;
  type: 'BUY' | 'SELL';
  amount: number;
  address: string;
  timestamp: number;
  confirmations: number;
  status: 'pending' | 'confirmed' | 'failed';
  price?: number;
  totalCost?: number;
  totalReturn?: number;
}

// Token balance interface
export interface TokenBalance {
  address: string;
  runeId: string;
  amount: number;
  formattedAmount: string;
}

// Extended LaserEyes signature response type
interface SignMessageResult {
  signature: string;
  pubkey: string;
}

/**
 * Hook for integrating with OVT Rune tokens
 */
export function useRuneIntegration() {
  const { address, connected, signMessage } = useLaserEyes();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [metadata, setMetadata] = useState<RuneMetadata | null>(null);
  const [transactions, setTransactions] = useState<RuneTransaction[]>([]);
  const priceStore = useMemo(() => getPriceStore(), []); // Get price store instance

  // API base URL
  const API_BASE_URL = process.env.NEXT_PUBLIC_RUNES_API_ENDPOINT || 'http://localhost:3030';
  
  // Check if we should use mock data
  const USE_MOCK_DATA = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';

  /**
   * Get balance of specified rune token for an address
   */
  const getBalance = useCallback(async (
    walletAddress: string = address || '', 
    runeId: string = OVT_RUNE_ID
  ): Promise<number> => {
    if (!walletAddress) {
      // Allow returning 0 if no address, avoid throwing error for initial state
      setBalance(0);
      return 0;
      // throw new Error('Wallet address is required');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call the Runes API to get balance
      const response = await axios.get(`${API_BASE_URL}/ovt/balances?address=${walletAddress}`);
      
      // Find the OVT token balance in the response
      const balances = response.data?.balances || [];
      const ovtBalance = balances.find((b: any) => 
        b.address === walletAddress && (runeId ? b.runeId === runeId : true)
      );
      
      const amount = ovtBalance?.amount || 0;
      setBalance(amount);
      return amount;
    } catch (err) {
      console.error('Error fetching rune balance:', err);
      setError('Failed to fetch token balance');
      // Return 0 as fallback and set balance state
      setBalance(0);
      return 0;
    } finally {
      setIsLoading(false);
    }
  }, [address, API_BASE_URL]);

  /**
   * Get metadata for a specific rune token
   */
  const getTokenMetadata = useCallback(async (
    runeId: string = OVT_RUNE_ID
  ): Promise<RuneMetadata> => {
    setIsLoading(true);
    setError(null);

    try {
      // Call the Runes API to get token metadata
      const response = await axios.get(`${API_BASE_URL}/ovt/info`);
      
      // Parse the response
      const runeInfo = response.data?.rune || {};
      
      // Format the metadata
      const metadata: RuneMetadata = {
        id: runeInfo.runeId || OVT_RUNE_ID,
        symbol: runeInfo.name || OVT_RUNE_SYMBOL,
        ticker: runeInfo.symbol || OVT_RUNE_TICKER,
        name: 'OTORI Vision Token',
        description: 'Investment token for Bitcoin-based venture capital',
        supply: {
          total: runeInfo.supply || 2100000,
          circulating: runeInfo.distributed || 1000000,
          maximum: 2100000, // Fixed maximum supply
        },
        divisibility: runeInfo.divisibility || 2,
        icon: '/images/ovt-logo.svg' // Default icon path
      };
      
      setMetadata(metadata);
      return metadata;
    } catch (err) {
      console.error('Error fetching token metadata:', err);
      setError('Failed to fetch token metadata');
      
      // Return default metadata as fallback
      const defaultMetadata: RuneMetadata = {
        id: OVT_RUNE_ID,
        symbol: OVT_RUNE_SYMBOL,
        ticker: OVT_RUNE_TICKER,
        name: 'OTORI Vision Token',
        description: 'Investment token for Bitcoin-based venture capital',
        supply: {
          total: 2100000,
          circulating: 1000000,
          maximum: 2100000,
        },
        divisibility: 2,
        icon: '/images/ovt-logo.svg'
      };
      
      return defaultMetadata;
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL]);

  /**
   * Get transaction history for address
   */
  const getTransactionHistory = useCallback(async (
    walletAddress: string = address || '',
    runeId: string = OVT_RUNE_ID
  ): Promise<RuneTransaction[]> => {
    if (!walletAddress) {
       // Allow returning [] if no address, avoid throwing error
       setTransactions([]);
       return [];
      // throw new Error('Wallet address is required');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call API to get transaction history
      const response = await axios.get(
        `${API_BASE_URL}/ovt/transactions?address=${walletAddress}&runeId=${runeId}`
      );
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch transaction history');
      }
      
      // Format transactions from API response
      const txs = (response.data.transactions || []).map((tx: any) => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
        // Ensure address represents the other party involved
        address: tx.fromAddress === walletAddress ? tx.toAddress : tx.fromAddress,
        timestamp: tx.timestamp,
        confirmations: tx.confirmations || 0,
        status: tx.status || 'confirmed',
        price: tx.price,
        totalCost: tx.totalCost,
        totalReturn: tx.totalReturn
      }));
      
      setTransactions(txs);
      return txs;
    } catch (err) {
      console.error('Error fetching transaction history:', err);
      setError('Failed to fetch transaction history');
      setTransactions([]); // Clear transactions on error
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [address, API_BASE_URL]);

  /**
   * Buy OVT tokens
   */
  const buyOVT = useCallback(async (
    amount: number,
    maxPrice?: number
  ): Promise<TransactionResult> => {
    if (!address || !connected) {
      throw new Error('Wallet connection required for buying tokens');
    }
    
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Sign the transaction request
      const message = `Buy ${amount} OVT${maxPrice ? ` at max price ${maxPrice}` : ''}`;
      let signature = '';
      let pubkey = '';
      
      try {
        const signResult = await signMessage(message);
        
        // Handle different return types from LaserEyes implementations
        if (typeof signResult === 'string') {
          signature = signResult;
          pubkey = ''; // Can't get pubkey from string signature
        } else if (typeof signResult === 'object' && signResult !== null) {
          const typedResult = signResult as unknown as SignMessageResult;
          signature = typedResult.signature || '';
          pubkey = typedResult.pubkey || '';
        }
      } catch (signError) {
        console.warn('Failed to sign message, proceeding without signature:', signError);
      }
      
      // Build request data
      const requestData = {
        fromAddress: address,
        amount,
        maxPrice,
        signature,
        pubkey
      };
      
      // Call API to prepare buy transaction
      const response = await axios.post(`${API_BASE_URL}/ovt/buy`, requestData);
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to prepare buy transaction');
      }
      
      const txData = response.data.transaction;
      
      return {
        txid: txData.txid,
        status: txData.status || 'pending',
        confirmations: txData.confirmations || 0,
        timestamp: txData.timestamp || Date.now(),
        price: txData.price,
        totalCost: txData.totalCost,
        psbts: txData.psbts
      };
    } catch (err) {
      console.error('Error buying OVT tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to buy tokens');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, signMessage, API_BASE_URL]);

  /**
   * Sell OVT tokens
   */
  const sellOVT = useCallback(async (
    amount: number,
    minPrice?: number,
    toAddress: string = OVT_LP_ADDRESS
  ): Promise<TransactionResult> => {
    if (!address || !connected) {
      throw new Error('Wallet connection required for selling tokens');
    }
    
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    setIsLoading(true);
    setError(null);

    try {
      // First check if we have enough OVT to sell
      if (balance < amount) {
        throw new Error(`Insufficient balance: required ${amount}, available ${balance}`);
      }
      
      // Sign the transaction request
      const message = `Sell ${amount} OVT${minPrice ? ` at min price ${minPrice}` : ''}`;
      let signature = '';
      let pubkey = '';
      
      try {
        const signResult = await signMessage(message);
        
        // Handle different return types from LaserEyes implementations
        if (typeof signResult === 'string') {
          signature = signResult;
          pubkey = ''; // Can't get pubkey from string signature
        } else if (typeof signResult === 'object' && signResult !== null) {
          const typedResult = signResult as unknown as SignMessageResult;
          signature = typedResult.signature || '';
          pubkey = typedResult.pubkey || '';
        }
      } catch (signError) {
        console.warn('Failed to sign message, proceeding without signature:', signError);
      }
      
      // Build request data
      const requestData = {
        fromAddress: address,
        toAddress,
        amount,
        minPrice,
        signature,
        pubkey
      };
      
      // Call API to prepare sell transaction
      const response = await axios.post(`${API_BASE_URL}/ovt/sell`, requestData);
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to prepare sell transaction');
      }
      
      const txData = response.data.transaction;
      
      return {
        txid: txData.txid,
        status: txData.status || 'pending',
        confirmations: txData.confirmations || 0,
        timestamp: txData.timestamp || Date.now(),
        price: txData.price,
        totalReturn: txData.totalReturn,
        psbts: txData.psbts
      };
    } catch (err) {
      console.error('Error selling OVT tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to sell tokens');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, signMessage, balance, API_BASE_URL]);

  /**
   * Submit a signed transaction
   */
  const submitTransaction = useCallback(async (
    signedPsbt: string,
    txType: 'BUY' | 'SELL',
    fromAddress: string,
    toAddress: string,
    amount: number
  ): Promise<TransactionResult> => {
    if (!signedPsbt) {
      throw new Error('Signed PSBT is required');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call API to submit the signed transaction
      const response = await axios.post(`${API_BASE_URL}/ovt/submit-transaction`, {
        signedPsbt,
        txType,
        fromAddress,
        toAddress,
        amount
      });
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to submit transaction');
      }
      
      const txData = response.data.transaction;
      
      return {
        txid: txData.txid,
        status: txData.status || 'confirmed',
        confirmations: txData.confirmations || 1,
        timestamp: txData.timestamp || Date.now()
      };
    } catch (err) {
      console.error('Error submitting transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit transaction');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL]);

  /**
   * Transfer OVT tokens to another address
   */
  const transferRune = useCallback(async (
    fromAddress: string,
    toAddress: string,
    runeId: string = OVT_RUNE_ID,
    amount: number
  ): Promise<TransactionResult> => {
    if (!fromAddress) {
      throw new Error('Sender address is required');
    }
    
    if (!toAddress) {
      throw new Error('Recipient address is required');
    }
    
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check balance from state first
      if (balance < amount) {
        throw new Error(`Insufficient balance: required ${amount}, available ${balance}`);
      }

      // Call the API to prepare transfer transaction
      const response = await axios.post(`${API_BASE_URL}/ovt/transfer`, {
        fromAddress,
        toAddress,
        runeId,
        amount
      });
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to prepare transfer transaction');
      }
      
      const txData = response.data.transaction;
      
      return {
        txid: txData.txid || 'mock-txid-' + Date.now(),
        status: 'pending',
        confirmations: 0,
        timestamp: Date.now(),
        psbts: txData.psbts,
        utxos: txData.utxos || [], // Include UTXOs from the response
        inputDetails: txData.inputDetails || null // Include input details for rune tracking
      };
    } catch (err) {
      console.error('Error transferring OVT tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to transfer tokens');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [balance, API_BASE_URL]);

  /**
   * Get distribution statistics for OVT token
   */
  const getDistributionStats = useCallback(async (
    runeId: string = OVT_RUNE_ID
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      // Call API to get distribution stats
      const response = await axios.get(`${API_BASE_URL}/ovt/distribution`);
      
      return response.data?.distributionStats || {
        totalSupply: 2100000,
        distributed: 1000000,
        treasuryHeld: 0,
        lpHeld: 1100000,
        percentDistributed: 47.62,
        percentInLP: 52.38
      };
    } catch (err) {
      console.error('Error fetching distribution stats:', err);
      setError('Failed to fetch distribution stats');
      
      // Return default stats
      return {
        totalSupply: 2100000,
        distributed: 1000000,
        treasuryHeld: 0,
        lpHeld: 1100000,
        percentDistributed: 47.62,
        percentInLP: 52.38
      };
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL]);

  /**
   * Fetch token info and subscribe to updates
   */
  useEffect(() => {
    // Initial fetch when address becomes available or changes
    if (address && connected) {
      console.log(`useRuneIntegration: Address detected (${address}), fetching initial data...`);
      getBalance(address, OVT_RUNE_ID).catch(err => console.error("Initial getBalance failed:", err));
      getTransactionHistory(address, OVT_RUNE_ID).catch(err => console.error("Initial getTransactionHistory failed:", err));
    } else {
      console.log("useRuneIntegration: No address or not connected, clearing data.");
       // Clear data if address is removed (wallet disconnect)
      setBalance(0);
      setTransactions([]);
    }

    // Always load metadata (doesn't depend on address)
    getTokenMetadata(OVT_RUNE_ID).catch(err => console.error("Initial getTokenMetadata failed:", err));

    // --- WebSocket Subscriptions ---
    console.log("useRuneIntegration: Setting up WebSocket subscriptions.");

    // Subscribe to balance updates
    const unsubscribeBalance = priceStore.subscribeToOvtBalanceUpdates((newBalanceData) => {
       // Ensure the update is for the current user's address and rune
      if (address && newBalanceData.address === address && newBalanceData.runeId === OVT_RUNE_ID) {
         console.log(`useRuneIntegration: Received OVT_BALANCE_UPDATED via WebSocket for ${address}:`, newBalanceData.amount);
         setBalance(newBalanceData.amount);
       } else if (address && newBalanceData.address === address) {
          console.log(`useRuneIntegration: Received balance update for ${address}, but wrong rune (${newBalanceData.runeId}). Ignoring.`);
       } else {
          // console.log(`useRuneIntegration: Received balance update for different address (${newBalanceData.address}), ignoring.`);
       }
    });

    // Subscribe to transaction updates (receives the full list)
    const unsubscribeTransactions = priceStore.subscribeToOvtTransactionUpdates((updatedTransactionList) => {
        console.log(`useRuneIntegration: Received OVT_TRANSACTION_UPDATED via WebSocket. Updating local list.`);
        // Simply update the state with the new list provided by the priceStore
        // This assumes the priceStore handles adding new transactions correctly
        // and that the subscription provides the *complete, sorted* list.
        setTransactions(updatedTransactionList);

        // If the WS only sends the *new* transaction, you would use this logic instead:
        /*
        const newTransaction = updatedTransactionData; // Assuming updatedTransactionData is the single new transaction
        if (address && (newTransaction.fromAddress === address || newTransaction.toAddress === address)) {
           console.log(`useRuneIntegration: Received NEW OVT_TRANSACTION via WebSocket affecting ${address}. Adding to list.`);
           setTransactions(prev => {
                // Avoid duplicates and keep sorted
                if (!prev.some(tx => tx.txid === newTransaction.txid)) {
                    return [newTransaction, ...prev].sort((a, b) => b.timestamp - a.timestamp);
                }
                return prev;
           });
         } else {
            console.log(`useRuneIntegration: Received new transaction update not involving ${address}, ignoring.`);
         }
        */
    });

    // Cleanup function
    return () => {
      console.log("useRuneIntegration: Cleaning up WebSocket subscriptions.");
      unsubscribeBalance();
      unsubscribeTransactions();
    };
    // Dependencies: address, connected, getBalance, getTransactionHistory, getTokenMetadata, priceStore
  }, [address, connected, getBalance, getTransactionHistory, getTokenMetadata, priceStore]);

  /**
   * Format token amount with proper divisibility 
   */
  const formatTokenAmount = useCallback((amount: number, divisibility: number = 2): string => {
    if (divisibility === 0) {
      return amount.toString();
    }
    
    const factor = Math.pow(10, divisibility);
    const formatted = (amount / factor).toFixed(divisibility);
    return formatted;
  }, []);

  return {
    // State
    isLoading,
    error,
    balance,
    metadata,
    transactions,
    
    // Actions
    getBalance,
    getTokenMetadata,
    buyOVT,
    sellOVT,
    submitTransaction,
    getTransactionHistory,
    getDistributionStats,
    formatTokenAmount,
    transferRune,
    
    // Constants
    OVT_RUNE_ID,
    OVT_RUNE_SYMBOL,
    OVT_RUNE_TICKER,
    isConnected: connected
  };
}

export default useRuneIntegration; 