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

import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useLaserEyes } from '@omnisat/lasereyes';

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
}

// Transaction interface
export interface RuneTransaction {
  txid: string;
  type: 'send' | 'receive';
  amount: number;
  address: string;
  timestamp: number;
  confirmations: number;
  status: 'pending' | 'confirmed' | 'failed';
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
      throw new Error('Wallet address is required');
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
      // Return 0 as fallback
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
   * Transfer rune tokens
   */
  const transferRune = useCallback(async (
    fromAddress: string = address || '',
    toAddress: string,
    runeId: string = OVT_RUNE_ID,
    amount: number
  ): Promise<TransactionResult> => {
    if (!fromAddress || !toAddress) {
      throw new Error('Both sender and recipient addresses are required');
    }
    
    if (!connected) {
      throw new Error('Wallet connection required for transfers');
    }
    
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Create transfer request data
      const transferData = {
        fromAddress,
        toAddress,
        runeId,
        amount
      };

      // Sign the transfer request to prove ownership
      const message = `Transfer ${amount} OVT to ${toAddress}`;
      
      // Get signature - handle different return types from LaserEyes implementations
      let signature: string = '';
      let pubkey: string = '';
      
      const signResult = await signMessage(message);
      
      // Determine the shape of the result
      if (typeof signResult === 'string') {
        // Basic implementation just returns signature string
        signature = signResult;
        // We'll need to get pubkey from elsewhere or use address as identifier
        pubkey = fromAddress;
      } else if (typeof signResult === 'object' && signResult !== null) {
        // Extended implementation returns object with signature and pubkey
        const typedResult = signResult as unknown as SignMessageResult;
        signature = typedResult.signature || '';
        pubkey = typedResult.pubkey || fromAddress;
      }
      
      // Add signature to request
      const transferRequest = {
        ...transferData,
        signature,
        pubkey
      };

      // Send transfer request to API
      const response = await axios.post(`${API_BASE_URL}/ovt/transfer`, transferRequest);
      
      // Return transaction result
      const result: TransactionResult = {
        txid: response.data.txid,
        status: response.data.status || 'pending',
        confirmations: response.data.confirmations || 0,
        timestamp: Date.now()
      };
      
      // Refresh balance after transfer
      await getBalance(fromAddress, runeId);
      
      return result;
    } catch (err) {
      console.error('Error transferring tokens:', err);
      setError('Failed to transfer tokens');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, signMessage, getBalance, API_BASE_URL]);

  /**
   * Get transaction history for address
   */
  const getTransactionHistory = useCallback(async (
    walletAddress: string = address || '',
    runeId: string = OVT_RUNE_ID
  ): Promise<RuneTransaction[]> => {
    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call API to get transaction history
      const response = await axios.get(
        `${API_BASE_URL}/ovt/transactions?address=${walletAddress}&runeId=${runeId}`
      );
      
      // Format transactions from API response
      const txs = (response.data?.transactions || []).map((tx: any) => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
        address: tx.address,
        timestamp: tx.timestamp,
        confirmations: tx.confirmations || 0,
        status: tx.status || 'confirmed'
      }));
      
      setTransactions(txs);
      return txs;
    } catch (err) {
      console.error('Error fetching transaction history:', err);
      setError('Failed to fetch transaction history');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [address, API_BASE_URL]);

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
   * Fetch token info when wallet address changes
   */
  useEffect(() => {
    if (address) {
      // Load initial balance
      getBalance(address, OVT_RUNE_ID).catch(console.error);
      
      // Load transaction history
      getTransactionHistory(address, OVT_RUNE_ID).catch(console.error);
    }
    
    // Load token metadata regardless of wallet connection
    getTokenMetadata(OVT_RUNE_ID).catch(console.error);
  }, [address, getBalance, getTokenMetadata, getTransactionHistory]);

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
    transferRune,
    getTransactionHistory,
    getDistributionStats,
    formatTokenAmount,
    
    // Constants
    OVT_RUNE_ID,
    OVT_RUNE_SYMBOL,
    OVT_RUNE_TICKER,
    isConnected: connected
  };
}

export default useRuneIntegration; 