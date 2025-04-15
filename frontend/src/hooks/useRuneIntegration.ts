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
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core'; // Assuming BaseNetwork might be needed
import { getPriceStore, OrderUpdatePayload } from '../services/priceService'; // Added import
import { useNotifications } from './useNotifications'; // Corrected import path for the hook

// OVT Rune constants
export const OVT_RUNE_ID = '240249:101';
export const OVT_RUNE_SYMBOL = 'OTORI•VISION•TOKEN';
export const OVT_RUNE_TICKER = 'OVT';
export const OVT_TREASURY_ADDRESS = 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
export const OVT_LP_ADDRESS = 'tb1p3vn6wc0dlud3tvckv95datu3stq4qycz7vj9mzpclfkrv9rh8jqsjrw38f';
export const LP_BTC_RECEIVING_ADDRESS = process.env.NEXT_PUBLIC_LP_BTC_ADDRESS || 'tb1p...'; // LP's BTC Receiving Address (for buys) - Ensure this is configured

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
  ovtTxId?: string;
  btcTxId?: string;
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

// Interface for the response from the /ovt/buy preparation endpoint
export interface BuyPreparationResult {
  success: boolean;
  orderId: string;
  paymentDetails: {
    recipientAddress: string;
    amountSats: number;
    memo: string;
  };
  error?: string;
}

// Interface for the response from the /ovt/sell preparation endpoint
// Assumes the backend returns a PSBT for the user to sign
export interface SellPreparationResult {
  success: boolean;
  orderId: string;
  psbtBase64: string; // PSBT for the user to sign (transferring OVT to LP)
  amountOvtRaw: number; // The raw amount of OVT to be transferred
  recipientAddress: string; // LP's OVT receiving address
  error?: string;
}

// Extend FinalTransactionResult to include pending status
export interface FinalTransactionResult {
  success: boolean;
  txid?: string; // Can be OVT txid (buy) or BTC txid (sell)
  ovtTxId?: string;
  btcTxId?: string;
  status?: 'pending' | 'confirmed' | 'failed' | 'pending_confirmation'; // Add pending_confirmation
  confirmations?: number;
  timestamp?: number;
  message?: string;
  error?: string;
  orderId?: string; // Include orderId for pending status
}

/**
 * Hook for integrating with OVT Rune tokens using a two-step trading flow
 */
export function useRuneIntegration() {
  // Correct hook usage from the react package
  const { address, connected, signMessage, getUtxos } = useLaserEyes();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [metadata, setMetadata] = useState<RuneMetadata | null>(null);
  const [transactions, setTransactions] = useState<RuneTransaction[]>([]);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [processingTimeoutId, setProcessingTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const { addNotification } = useNotifications(); // Use the hook
  const priceStore = useMemo(() => getPriceStore(), []);

  const API_BASE_URL = process.env.NEXT_PUBLIC_RUNE_ENDPOINT || 'http://localhost:9192';
  const TRADING_API_URL = process.env.NEXT_PUBLIC_TRADING_API_URL || API_BASE_URL; // Use correct env var name

  // --- Utility Functions (Moved formatTokenAmount earlier) ---
  const formatTokenAmount = useCallback((amount: number, divisibility: number = metadata?.divisibility ?? 2): string => {
    if (amount === undefined || amount === null) return '0.00'; // Handle undefined/null
    
    // Always ensure we're working with the raw amount
    const rawAmount = amount;
    
    if (divisibility === 0) {
      return rawAmount.toString();
    }
    
    const factor = Math.pow(10, divisibility);
    
    // Format the amount properly by applying divisibility
    const formattedValue = (rawAmount / factor).toLocaleString(undefined, {
        minimumFractionDigits: divisibility,
        maximumFractionDigits: divisibility,
    });
    
    return formattedValue;
  }, [metadata?.divisibility]);

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

    // --- DEBUGGING --- 
    console.log(`[useRuneIntegration] getBalance called for walletAddress: ${walletAddress}`);
    console.log(`[useRuneIntegration] LaserEyes address: ${address}, connected: ${connected}`);
    // --- END DEBUGGING ---

    try {
      // Call the Runes API to get balance
      const response = await axios.get(`${API_BASE_URL}/ovt/balances?address=${walletAddress}`);
      
      // Find the OVT token balance in the response
      const balances = response.data?.balances || [];
      const ovtBalance = balances.find((b: any) => 
        b.address === walletAddress && (runeId ? b.runeId === runeId : true)
      );
      
      const amount = ovtBalance?.amount || 0;
      // --- DEBUGGING LOG --- 
      console.log(`[useRuneIntegration] Fetched raw balance via HTTP for ${walletAddress}: ${amount}`);
      // --- END DEBUGGING LOG ---
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
      const txs = (response.data.transactions || []).map((tx: any): RuneTransaction => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
        address: tx.fromAddress === walletAddress ? tx.toAddress : tx.fromAddress,
        timestamp: tx.timestamp,
        confirmations: tx.confirmations || 0,
        status: tx.status || 'confirmed',
        price: tx.price,
        totalCost: tx.totalCost,
        totalReturn: tx.totalReturn,
        ovtTxId: tx.ovtTxId,
        btcTxId: tx.btcTxId,
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
   * Step 1: Prepare Buy Transaction
   * Calls the backend to get payment details and an order ID.
   * @param amount The number of OVT tokens to buy (human-readable, e.g., 500.00).
   * @param maxPrice Optional maximum price per token in sats.
   */
  const prepareBuyOVT = useCallback(async (
    amount: number,
    maxPrice?: number
  ): Promise<BuyPreparationResult> => {
    if (!address || !connected) {
      throw new Error('Wallet connection required for buying tokens');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    // Convert human-readable amount to raw amount based on divisibility
    const divisibility = metadata?.divisibility ?? 2; // Default to 2 if metadata not loaded
    const rawAmount = Math.floor(amount * Math.pow(10, divisibility));

    setIsLoading(true);
    setError(null);

    try {
      // No need for frontend signing here, backend just prepares
      const requestData = {
        fromAddress: address,
        amount: amount, // Send human-readable amount
        maxPrice,
        // No signature/pubkey needed for preparation
      };

      console.log('Preparing buy OVT request:', requestData);
      const response = await axios.post<BuyPreparationResult>(`${API_BASE_URL}/ovt/buy`, requestData);
      console.log('Prepare buy OVT response:', response.data);

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Failed to prepare buy transaction');
      }
      
      // Ensure paymentDetails exist
       if (!response.data.paymentDetails || !response.data.paymentDetails.recipientAddress) {
         throw new Error('Invalid response from server: Missing payment details.');
       }

      return response.data; // Contains { success, orderId, paymentDetails }

    } catch (err) {
      console.error('Error preparing buy OVT:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to prepare buy transaction';
      setError(errorMessage);
      // Return a structured error object matching the expected interface
      return { success: false, orderId: '', paymentDetails: { recipientAddress: '', amountSats: 0, memo: '' }, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, API_BASE_URL, metadata?.divisibility]);

  /**
   * Step 2: Confirm Buy Transaction
   * Called after the user has successfully sent the BTC payment.
   * @param orderId The order ID received from prepareBuyOVT.
   * @param btcTxId The transaction ID of the user's BTC payment.
   */
  const confirmBuyOVT = useCallback(async (
    orderId: string,
    btcTxId: string
  ): Promise<FinalTransactionResult> => {
    if (!orderId || !btcTxId) {
      throw new Error('Order ID and BTC Transaction ID are required');
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`Confirming buy payment for order ${orderId} with BTC tx ${btcTxId}`);
      // Use TRADING_API_URL for the confirmation endpoint
      console.log('Confirming Buy URL:', `${TRADING_API_URL}/confirm-buy-payment`);
      const response = await axios.post<FinalTransactionResult>(`${TRADING_API_URL}/confirm-buy-payment`, {
          orderId,
          btcTxId
      });
      console.log('Confirm buy OVT response:', response.data);

      if (!response.data || !response.data.success) {
         throw new Error(response.data?.error || 'Failed to confirm buy payment.');
      }
      
      // Optional: Refresh balance and history after successful confirmation
      if (address) {
          await getBalance(address);
          await getTransactionHistory(address);
      }

      return response.data; // Contains { success, ovtTxId, ... }

    } catch (err) {
       console.error('Error confirming buy OVT:', err);
       const errorMessage = err instanceof Error ? err.message : 'Failed to confirm buy transaction';
       setError(errorMessage);
       return { success: false, error: errorMessage, status: 'failed' }; // Return structured error
    } finally {
      setIsLoading(false);
    }
  }, [TRADING_API_URL, address, getBalance, getTransactionHistory]);

  /**
   * Step 1: Prepare Sell Transaction
   * Calls the backend to get an order ID and a PSBT for the user to sign.
   * @param amount The number of OVT tokens to sell (human-readable, e.g., 500.00).
   * @param minPrice Optional minimum price per token in sats.
   */
  const prepareSellOVT = useCallback(async (
    amount: number,
    minPrice?: number
  ): Promise<SellPreparationResult> => {
    if (!address || !connected) {
      throw new Error('Wallet connection required for selling tokens');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    // Convert human-readable amount to raw amount
    const divisibility = metadata?.divisibility ?? 2;
    const rawAmount = Math.floor(amount * Math.pow(10, divisibility));

    // Frontend balance check (optional but good UX)
    if (balance < rawAmount) {
        throw new Error(`Insufficient balance: required ${amount} (${rawAmount} raw), available ${formatTokenAmount(balance, divisibility)} (${balance} raw)`);
    }

    setIsLoading(true);
    setError(null);

    try {
       // Backend expects raw amount
       const requestData = {
         fromAddress: address,
         toAddress: OVT_LP_ADDRESS, // Sell goes to the LP address
         amount: rawAmount,
         minPrice,
         // No signature needed here, PSBT will be returned for signing
       };
       
       console.log('Preparing sell OVT request:', requestData);
       // Assume the backend /ovt/sell endpoint now returns the SellPreparationResult structure
       const response = await axios.post<SellPreparationResult>(`${API_BASE_URL}/ovt/sell`, requestData);
       console.log('Prepare sell OVT response:', response.data);

       if (!response.data || !response.data.success || !response.data.psbtBase64) {
         throw new Error(response.data?.error || 'Failed to prepare sell transaction or missing PSBT');
       }
       
       // Add details from request for clarity in the result
       response.data.amountOvtRaw = rawAmount;
       response.data.recipientAddress = OVT_LP_ADDRESS;

       return response.data; // Contains { success, orderId, psbtBase64, ... }

    } catch (err) {
       console.error('Error preparing sell OVT:', err);
       const errorMessage = err instanceof Error ? err.message : 'Failed to prepare sell transaction';
       setError(errorMessage);
       return { success: false, orderId: '', psbtBase64: '', amountOvtRaw: 0, recipientAddress: '', error: errorMessage }; // Structured error
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, balance, API_BASE_URL, metadata?.divisibility, formatTokenAmount]);

   /**
   * Step 2: Confirm Sell Transaction
   * Called after the user has successfully signed and broadcasted the OVT transfer PSBT.
   * @param orderId The order ID received from prepareSellOVT.
   * @param ovtTxId The transaction ID of the user's OVT transfer to the LP.
   */
  const confirmSellOVT = useCallback(async (
      orderId: string,
      ovtTxId: string // We send the OVT TXID for backend verification
  ): Promise<FinalTransactionResult> => {
      if (!orderId || !ovtTxId) {
          throw new Error('Order ID and OVT Transaction ID are required');
      }

      // Clear any previous processing state
      if (processingTimeoutId) clearTimeout(processingTimeoutId);
      setProcessingOrderId(null);
      setProcessingTimeoutId(null);
      
      setIsLoading(true);
      setError(null);

      try {
          console.log(`Confirming sell transfer for order ${orderId} with OVT tx ${ovtTxId}`);
          const confirmUrl = `${TRADING_API_URL}/confirm-sell-transfer`; // Adjusted API endpoint
          console.log('Confirming Sell URL:', confirmUrl);

          // Use fetch to check status code
          const response = await fetch(confirmUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId, ovtTxId })
          });

          const result: FinalTransactionResult = await response.json();
          console.log('Confirm sell OVT raw response:', { status: response.status, body: result });

          if (!response.ok && response.status !== 202) { // Handle non-200/202 errors
              throw new Error(result?.error || result?.message || `Failed to confirm sell transfer. Status: ${response.status}`);
          }

          // --- Handle Pending Confirmation (202 Accepted or explicit status) ---
          if (response.status === 202 || result.status === 'pending_confirmation') {
              console.log(`Sell Order ${orderId} is pending confirmation. Setting up listener and timeout.`);
              setProcessingOrderId(orderId);
              
              // Set timeout (20 minutes)
              const timeoutDuration = 20 * 60 * 1000; 
              const timerId = setTimeout(() => {
                  console.log(`Sell Order ${orderId} confirmation timed out.`);
                  setProcessingOrderId(currentOrderId => {
                     if (currentOrderId === orderId) {
                        addNotification({ type: 'error', message: `Order ${orderId} confirmation timed out. Please check your transaction history or contact support.` }); // Add timeout notification
                        console.error(`Sell Order ${orderId} confirmation timed out.`); // Added console log
                        return null; // Clear the processing state
                     }
                     return currentOrderId; 
                  });
                  setProcessingTimeoutId(null);
              }, timeoutDuration);
              setProcessingTimeoutId(timerId);
    
              // Return pending status
              return { success: true, status: 'pending_confirmation', orderId: orderId }; 
          }

          // --- Handle Immediate Success/Failure --- 
          if (result.success) {
              console.log(`Sell Order ${orderId} confirmed immediately.`);
              addNotification({ type: 'success', message: `Sell order ${orderId} completed successfully!` }); // Add success notification
              // Optional: Refresh balance and history after successful confirmation
              if (address) {
                  await getBalance(address); // OVT balance should decrease
                  await getTransactionHistory(address);
              }
              return result; // Contains { success, btcTxId, ... }
          } else {
              // Handle immediate failure response from API
              console.error(`Sell Order ${orderId} failed immediate confirmation: ${result.error || result.message}`);
              throw new Error(result.error || result.message || 'Failed to confirm sell transfer and receive payment.');
          }

      } catch (err) {
          console.error('Error confirming sell OVT:', err);
          const errorMessage = err instanceof Error ? err.message : 'Failed to confirm sell transaction';
          setError(errorMessage);
          // Ensure processing state is cleared on error
          setProcessingOrderId(null); 
          if(processingTimeoutId) clearTimeout(processingTimeoutId);
          setProcessingTimeoutId(null);
          addNotification({ type: 'error', message: errorMessage }); // Add error notification on catch
          return { success: false, error: errorMessage, status: 'failed' }; // Structured error
      } finally {
          setIsLoading(false);
      }
  }, [TRADING_API_URL, address, getBalance, getTransactionHistory, processingTimeoutId, addNotification]);

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
   * Transfer OVT tokens to another address
   */
  const transferRune = useCallback(async (
    fromAddress: string,
    toAddress: string,
    runeId: string = OVT_RUNE_ID,
    amount: number // Expecting raw amount here
  ): Promise<FinalTransactionResult> => { // Updated return type
    if (!fromAddress || !toAddress || amount <= 0) {
      throw new Error('Valid sender, recipient, and amount required');
    }
    // Check balance from state first
    if (balance < amount) {
        const divisibility = metadata?.divisibility ?? 2;
        throw new Error(`Insufficient balance: required ${formatTokenAmount(amount, divisibility)}, available ${formatTokenAmount(balance, divisibility)}`);
    }

    setIsLoading(true);
    setError(null);

    try {
      // TODO: This likely needs to be updated to use PSBTs like the sell flow
      // For now, keep the old logic but adjust the response expectation
      const response = await axios.post(`${API_BASE_URL}/ovt/transfer`, {
        fromAddress,
        toAddress,
        runeId,
        amount // Send raw amount
      });
      
      if (!response.data.success || !response.data.transaction?.psbts) {
        throw new Error(response.data.error || 'Failed to prepare transfer transaction or missing PSBT');
      }
      
       // --- Placeholder: Needs PSBT signing & broadcasting ---
       // const psbtBase64 = response.data.transaction.psbts[0]; 
       // const signedPsbt = await signPsbt(psbtBase64); 
       // const txid = await broadcastTransaction(signedPsbt); // Need broadcast capability
       // --- End Placeholder ---

      // Mocking success until PSBT flow is implemented
       console.warn("Transfer PSBT signing/broadcasting not implemented yet.");
       const mockTxId = 'mock-transfer-txid-' + Date.now();

       // Refresh balance after mock success
       if(address) await getBalance(address);

       return {
           success: true,
           // txid: txid, // Use actual txid after implementation
           txid: mockTxId,
           status: 'pending',
           timestamp: Date.now(),
           message: "Transfer initiated (PSBT flow pending)"
       };

    } catch (err) {
      console.error('Error transferring OVT tokens:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to transfer tokens';
      setError(errorMessage);
      throw new Error(errorMessage); // Re-throw for UI handling
    } finally {
      setIsLoading(false);
    }
  }, [balance, API_BASE_URL, address, getBalance, metadata?.divisibility, formatTokenAmount]);

  /**
   * Send OVT tokens using the LaserEyes wallet.
   * This is a simplified wrapper around LaserEyes send for Runes.
   * @param recipient The recipient address
   * @param runeName The rune name (defaults to OVT_RUNE_SYMBOL)
   * @param amount The amount in atomic units
   * @returns Transaction ID of the sent transaction
   */
  const sendRune = useCallback(async (
    recipient: string,
    runeName: string = OVT_RUNE_SYMBOL,
    amount: number // Raw amount in atomic units
  ): Promise<string> => {
    if (!connected || !address) {
      throw new Error('Wallet not connected');
    }
    
    if (!recipient || !amount || amount <= 0) {
      throw new Error('Valid recipient and positive amount are required');
    }

    setIsLoading(true);
    setError(null);

    try {
      // We need to check what method LaserEyes provides for sending runes
      // The actual implementation may vary based on LaserEyes API
      if (!signMessage) {
        throw new Error('LaserEyes signMessage function not available');
      }

      console.log(`Initiating Rune transfer: ${amount} units of ${runeName} to ${recipient}`);
      
      // This is a placeholder implementation. The actual implementation should use 
      // whatever method LaserEyes provides for sending Runes.
      // We're implementing it as a mock temporarily until we can check the actual LaserEyes API
      
      // Construct a mock transaction
      const txid = `mock-rune-tx-${Date.now()}`;
      
      console.log(`Rune transfer initiated with txid: ${txid}`);
      
      // Refresh data after transfer
      if (address) {
        await getBalance(address);
        await getTransactionHistory(address);
      }
      
      return txid;
    } catch (err) {
      console.error('Error sending Rune tokens:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send tokens';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [connected, address, signMessage, getBalance, getTransactionHistory]);

  /**
   * Fetch token info and subscribe to updates
   */
  useEffect(() => {
    let isMounted = true;
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
         // --- DEBUGGING LOG --- 
         console.log(`[useRuneIntegration] Setting balance via WebSocket for ${address} to raw amount: ${newBalanceData.amount}`);
         // --- END DEBUGGING LOG ---
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

    // *** NEW: Subscribe to Order Updates ***
    const unsubscribeOrderUpdates = priceStore.subscribeToOrderUpdates((orderUpdate: OrderUpdatePayload) => {
      if (!isMounted) return;

      console.log("useRuneIntegration: Received ORDER_UPDATE via WebSocket:", orderUpdate);

      // Check if this update is for the order we are currently processing
      if (orderUpdate.orderId && orderUpdate.orderId === processingOrderId) {
         console.log(`Order update matches currently processing order: ${processingOrderId}`);

         // Clear the processing state and timeout
         if (processingTimeoutId) clearTimeout(processingTimeoutId);
         setProcessingTimeoutId(null);
         setProcessingOrderId(null); // Clear the ID now that we have a final status

         // Handle final status
         if (orderUpdate.status === 'completed') {
            addNotification({ type: 'success', message: orderUpdate.message || `Order ${orderUpdate.orderId} completed!` }); // Notify success
            console.log(`Order ${orderUpdate.orderId} completed successfully via WS.`);
            // Refresh balance and history
            if (address) {
              getBalance(address).catch(err => console.error("getBalance after WS update failed:", err));
              getTransactionHistory(address).catch(err => console.error("getTransactionHistory after WS update failed:", err));
            }
         } else { // Handle failed, cancelled, etc.
            addNotification({ type: 'error', message: orderUpdate.message || `Order ${orderUpdate.orderId} failed: ${orderUpdate.status}` }); // Notify failure
            console.error(`Order ${orderUpdate.orderId} failed via WS: ${orderUpdate.message || orderUpdate.status}`);
         }
      } else {
         console.log(`Received order update for ${orderUpdate.orderId}, but currently processing ${processingOrderId}. Ignoring.`);
      }
    });

    // Cleanup function
    return () => {
      console.log("useRuneIntegration: Cleaning up WebSocket subscriptions.");
      unsubscribeBalance();
      unsubscribeTransactions();
      unsubscribeOrderUpdates(); // Ensure order updates are unsubscribed
      // Clear any pending timeout on unmount
      if (processingTimeoutId) {
          clearTimeout(processingTimeoutId);
      }
      isMounted = false;
    };
  }, [
      address,
      connected,
      getBalance,
      getTransactionHistory,
      getTokenMetadata,
      priceStore,
      processingOrderId,
      processingTimeoutId, // Keep timeoutId here if needed elsewhere, otherwise potentially remove
      addNotification
  ]);

  return {
    // State
    isLoading,
    error,
    balance,
    metadata,
    transactions,
    processingOrderId,
    
    // Actions
    getBalance,
    getTokenMetadata,
    getTransactionHistory,
    getDistributionStats,
    prepareBuyOVT,
    confirmBuyOVT,
    prepareSellOVT,
    confirmSellOVT,
    transferRune,
    sendRune,
    
    // Utilities
    formatTokenAmount,
    
    // Constants
    OVT_RUNE_ID,
    OVT_RUNE_SYMBOL,
    OVT_RUNE_TICKER,
    isConnected: connected,
  };
}

export default useRuneIntegration; 