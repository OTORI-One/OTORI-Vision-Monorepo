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
import { BaseNetwork, RUNES } from '@omnisat/lasereyes-core'; // Ensure RUNES is imported
import { getPriceStore, OrderUpdatePayload } from '../services/priceService';
import { useNotifications } from './useNotifications';

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
  // Correct hook usage: Only get functions provided by LaserEyes
  const { address, connected, send } = useLaserEyes(); 
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [metadata, setMetadata] = useState<RuneMetadata | null>(null);
  const [transactions, setTransactions] = useState<RuneTransaction[]>([]);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [processingTimeoutId, setProcessingTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const { addNotification } = useNotifications();
  const priceStore = useMemo(() => getPriceStore(), []);

  const API_BASE_URL = process.env.NEXT_PUBLIC_RUNE_ENDPOINT || 'http://localhost:9192';
  const TRADING_API_URL = process.env.NEXT_PUBLIC_TRADING_API_URL || API_BASE_URL;

  // --- Utility Functions --- 
  const formatTokenAmount = useCallback((amount: number, divisibility: number = metadata?.divisibility ?? 2): string => {
    if (amount === undefined || amount === null) return '0.00';
    const rawAmount = amount;
    if (divisibility === 0) {
      return rawAmount.toString();
    }
    const factor = Math.pow(10, divisibility);
    const formattedValue = (rawAmount / factor).toLocaleString(undefined, {
        minimumFractionDigits: divisibility,
        maximumFractionDigits: divisibility,
    });
    return formattedValue;
  }, [metadata?.divisibility]);
  
  // --- Local Data Fetching Functions (Use Backend API) --- 
  const getBalance = useCallback(async (
    walletAddress: string = address || '', 
    runeId: string = OVT_RUNE_ID
  ): Promise<number> => {
     if (!walletAddress) {
      setBalance(0);
      return 0;
    }
    // setIsLoading(true); // Avoid duplicate loading states
    // setError(null);
    console.log(`[useRuneIntegration] getBalance called for walletAddress: ${walletAddress}`);
    try {
      const response = await axios.get(`${API_BASE_URL}/ovt/balances?address=${walletAddress}`);
      const balances = response.data?.balances || [];
      const ovtBalance = balances.find((b: any) => 
        b.address === walletAddress && (runeId ? b.runeId === runeId : true)
      );
      const amount = ovtBalance?.amount || 0;
      console.log(`[useRuneIntegration] Fetched raw balance via HTTP for ${walletAddress}: ${amount}`);
      setBalance(amount); // Update state
      return amount;
    } catch (err: any) {
      console.error('Error fetching rune balance via HTTP:', err);
      // setError('Failed to fetch token balance'); 
      setBalance(0);
      return 0;
    } finally {
      // setIsLoading(false);
    }
  }, [address, API_BASE_URL]);

  const getTokenMetadata = useCallback(async (
    runeId: string = OVT_RUNE_ID
  ): Promise<RuneMetadata> => {
    // setIsLoading(true);
    // setError(null);
    try {
      const response = await axios.get(`${API_BASE_URL}/ovt/info`);
      const runeInfo = response.data?.rune || {};
      const metadata: RuneMetadata = {
        id: runeInfo.runeId || OVT_RUNE_ID,
        symbol: runeInfo.name || OVT_RUNE_SYMBOL,
        ticker: runeInfo.symbol || OVT_RUNE_TICKER, 
        name: 'OTORI Vision Token',
        description: 'Investment token for Bitcoin-based venture capital',
        supply: {
          total: runeInfo.supply || 2100000,
          circulating: runeInfo.distributed || 1000000,
          maximum: 2100000,
        },
        divisibility: runeInfo.divisibility ?? 2, 
        icon: '/images/ovt-logo.svg'
      };
      setMetadata(metadata);
      return metadata;
    } catch (err: any) {
      console.error('Error fetching token metadata:', err);
      // setError('Failed to fetch token metadata');
      const defaultMetadata: RuneMetadata = {
        id: OVT_RUNE_ID,
        symbol: OVT_RUNE_SYMBOL,
        ticker: OVT_RUNE_TICKER,
        name: 'OTORI Vision Token',
        description: 'Investment token for Bitcoin-based venture capital',
        supply: { total: 2100000, circulating: 1000000, maximum: 2100000 },
        divisibility: 2,
        icon: '/images/ovt-logo.svg'
      };
      setMetadata(defaultMetadata); 
      return defaultMetadata;
    } finally {
      // setIsLoading(false);
    }
  }, [API_BASE_URL]);

  const getTransactionHistory = useCallback(async (
    walletAddress: string = address || '',
    runeId: string = OVT_RUNE_ID
  ): Promise<RuneTransaction[]> => {
    if (!walletAddress) {
       setTransactions([]);
       return [];
    }
    // setIsLoading(true);
    // setError(null);
    try {
      const response = await axios.get(
        `${API_BASE_URL}/ovt/transactions?address=${walletAddress}&runeId=${runeId}`
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch transaction history');
      }
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
    } catch (err: any) {
      console.error('Error fetching transaction history:', err);
      // setError('Failed to fetch transaction history');
      setTransactions([]);
      return [];
    } finally {
      // setIsLoading(false);
    }
  }, [address, API_BASE_URL]);

  // --- Trading Functions (Use Backend API) --- 

  const prepareBuyOVT = useCallback(async (
    amount: number, // Human-readable amount
    maxPrice?: number
  ): Promise<BuyPreparationResult> => {
     if (!address || !connected) {
      throw new Error('Wallet connection required for buying tokens');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }
    const divisibility = metadata?.divisibility ?? 2;
    const rawAmount = Math.floor(amount * Math.pow(10, divisibility)); // Calculate raw for backend if needed, though backend might recalculate
    setIsLoading(true);
    setError(null);
    try {
      const requestData = {
        fromAddress: address,
        amount: amount, // Send human-readable amount to backend
        maxPrice,
      };
      console.log('Preparing buy OVT request:', requestData);
      const response = await axios.post<BuyPreparationResult>(`${TRADING_API_URL}/ovt/buy`, requestData); // Use TRADING_API_URL
      console.log('Prepare buy OVT response:', response.data);
      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Failed to prepare buy transaction');
      }
       if (!response.data.paymentDetails || !response.data.paymentDetails.recipientAddress) {
         throw new Error('Invalid response from server: Missing payment details.');
       }
      return response.data;
    } catch (err: any) {
      console.error('Error preparing buy OVT:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to prepare buy transaction';
      setError(errorMessage);
      return { success: false, orderId: '', paymentDetails: { recipientAddress: '', amountSats: 0, memo: '' }, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, metadata?.divisibility, TRADING_API_URL]); // Use TRADING_API_URL

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
      console.log('Confirming Buy URL:', `${TRADING_API_URL}/confirm-buy-payment`); // Use TRADING_API_URL
      const response = await axios.post<FinalTransactionResult>(`${TRADING_API_URL}/confirm-buy-payment`, { // Use TRADING_API_URL
          orderId,
          btcTxId
      });
      console.log('Confirm buy OVT response:', response.data);
      if (!response.data || !response.data.success) {
         throw new Error(response.data?.error || 'Failed to confirm buy payment.');
      }
      if (address) {
          // Trigger local balance/history refresh after confirmation
          await getBalance(address);
          await getTransactionHistory(address);
      }
      return response.data;
    } catch (err: any) {
       console.error('Error confirming buy OVT:', err);
       const errorMessage = err instanceof Error ? err.message : 'Failed to confirm buy transaction';
       setError(errorMessage);
       return { success: false, error: errorMessage, status: 'failed' };
    } finally {
      setIsLoading(false);
    }
  // Add getBalance, getTransactionHistory as dependencies
  }, [TRADING_API_URL, address, getBalance, getTransactionHistory]); 

  const prepareSellOVT = useCallback(async (
    amount: number // Expecting raw atomic amount here
  ): Promise<SellPreparationResult> => {
    if (!address || !connected) {
      throw new Error('Wallet connection required for selling tokens');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }
    // Frontend balance check (optional but good UX)
    if (balance < amount) {
        throw new Error(`Insufficient balance: required ${amount} raw, available ${balance} raw`);
    }
    setIsLoading(true);
    setError(null);
    try {
       const requestData = {
         fromAddress: address,
         amount: amount, // Send raw amount to backend
         // minPrice, // Optional: Add if needed
       };
       console.log('Preparing sell OVT request:', requestData);
       const response = await axios.post<SellPreparationResult>(`${TRADING_API_URL}/ovt/sell`, requestData); // Use TRADING_API_URL
       console.log('Prepare sell OVT response:', response.data);
       if (!response.data || !response.data.success) {
         throw new Error(response.data?.error || 'Failed to prepare sell transaction');
       }
       // Expecting { success, orderId, amountOvtRaw, recipientAddress, message }
       return response.data; 
    } catch (err: any) {
       console.error('Error preparing sell OVT:', err);
       const errorMessage = err instanceof Error ? err.message : 'Failed to prepare sell transaction';
       setError(errorMessage);
       // Match the expected return type on error
       return { success: false, orderId: '', amountOvtRaw: 0, recipientAddress: '', error: errorMessage, psbtBase64: '' }; 
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, balance, TRADING_API_URL]); // Use TRADING_API_URL

  const confirmSellOVT = useCallback(async (
    orderId: string,
    ovtTxId: string
  ): Promise<FinalTransactionResult> => {
      if (!orderId || !ovtTxId) {
          throw new Error('Order ID and OVT Transaction ID are required');
      }
      if (processingTimeoutId) clearTimeout(processingTimeoutId);
      setProcessingOrderId(null);
      setProcessingTimeoutId(null);
      setIsLoading(true);
      setError(null);
      try {
          console.log(`Confirming sell transfer for order ${orderId} with OVT tx ${ovtTxId}`);
          const confirmUrl = `${TRADING_API_URL}/confirm-sell-transfer`; // Use TRADING_API_URL
          console.log('Confirming Sell URL:', confirmUrl);
          const response = await fetch(confirmUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId, ovtTxId })
          });
          const result: FinalTransactionResult = await response.json();
          console.log('Confirm sell OVT raw response:', { status: response.status, body: result });
          if (!response.ok && response.status !== 202) { 
              throw new Error(result?.error || result?.message || `Failed to confirm sell transfer. Status: ${response.status}`);
          }
          if (response.status === 202 || result.status === 'pending_confirmation') {
              console.log(`Sell Order ${orderId} is pending confirmation. Setting up listener and timeout.`);
              setProcessingOrderId(orderId);
              const timeoutDuration = 20 * 60 * 1000; 
              const timerId = setTimeout(() => {
                  console.log(`Sell Order ${orderId} confirmation timed out.`);
                  setProcessingOrderId(currentOrderId => {
                     if (currentOrderId === orderId) {
                        addNotification({ type: 'error', message: `Order ${orderId} confirmation timed out. Please check your transaction history or contact support.` });
                        console.error(`Sell Order ${orderId} confirmation timed out.`);
                        return null;
                     }
                     return currentOrderId; 
                  });
                  setProcessingTimeoutId(null);
              }, timeoutDuration);
              setProcessingTimeoutId(timerId);
              return { success: true, status: 'pending_confirmation', orderId: orderId }; 
          }
          if (result.success) {
              console.log(`Sell Order ${orderId} confirmed immediately.`);
              addNotification({ type: 'success', message: `Sell order ${orderId} completed successfully!` });
              if (address) {
                  // Trigger local balance/history refresh
                  await getBalance(address);
                  await getTransactionHistory(address);
              }
              return result;
          } else {
              console.error(`Sell Order ${orderId} failed immediate confirmation: ${result.error || result.message}`);
              throw new Error(result.error || result.message || 'Failed to confirm sell transfer and receive payment.');
          }
      } catch (err: any) {
          console.error('Error confirming sell OVT:', err);
          const errorMessage = err instanceof Error ? err.message : 'Failed to confirm sell transaction';
          setError(errorMessage);
          setProcessingOrderId(null); 
          if(processingTimeoutId) clearTimeout(processingTimeoutId);
          setProcessingTimeoutId(null);
          addNotification({ type: 'error', message: errorMessage });
          return { success: false, error: errorMessage, status: 'failed' }; 
      } finally {
          setIsLoading(false);
      }
  // Add getBalance, getTransactionHistory, addNotification, processingTimeoutId as dependencies
  }, [TRADING_API_URL, address, getBalance, getTransactionHistory, processingTimeoutId, addNotification]); 

  // --- LaserEyes Send Function --- 
  /**
   * Send OVT tokens using the LaserEyes wallet.
   * @param recipient The recipient address
   * @param runeName The rune name (e.g., OTORI•VISION•TOKEN)
   * @param amount The amount in atomic units
   * @returns Transaction ID of the sent transaction
   */
  const sendRune = useCallback(async (
    recipient: string,
    runeName: string = OVT_RUNE_SYMBOL,
    amount: number // Raw amount in atomic units
  ): Promise<string> => {
    if (!connected || !address || !send) { // Check for send function from useLaserEyes
      throw new Error('Wallet not connected or send function unavailable');
    }
    if (!recipient || !amount || amount <= 0) {
      throw new Error('Valid recipient and positive amount are required');
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`Initiating Rune transfer via LaserEyes: ${amount} units of ${runeName} to ${recipient}`);
      
      // Directly use LaserEyes send method for RUNES
      // Use type assertion to match the documented API pattern
      const txid = await send(RUNES, { 
          runeName: runeName,
          amount: amount, 
          toAddress: recipient 
      } as any); // Use type assertion to bypass type checking
      
      if (!txid) {
        throw new Error('LaserEyes send(RUNES) failed or was cancelled.');
      }
      
      console.log(`LaserEyes Rune transfer initiated with txid: ${txid}`);
            
      return txid;
    } catch (err: any) { 
      console.error('Error sending Rune tokens via LaserEyes:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send tokens via LaserEyes';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  // Dependencies: only need LaserEyes connection status, address, and send function
  }, [connected, address, send]); 

  // --- Effect for Initial Load and Subscriptions --- 
  useEffect(() => {
    let isMounted = true;
    if (address && connected) {
      console.log(`useRuneIntegration: Address detected (${address}), fetching initial data...`);
      // Call local functions
      getBalance(address, OVT_RUNE_ID).catch(err => console.error("Initial getBalance failed:", err));
      getTransactionHistory(address, OVT_RUNE_ID).catch(err => console.error("Initial getTransactionHistory failed:", err));
    } else {
      console.log("useRuneIntegration: No address or not connected, clearing data.");
      setBalance(0);
      setTransactions([]);
    }
    getTokenMetadata(OVT_RUNE_ID).catch(err => console.error("Initial getTokenMetadata failed:", err));

    // --- WebSocket Subscriptions --- 
    console.log("useRuneIntegration: Setting up WebSocket subscriptions.");
    const unsubscribeBalance = priceStore.subscribeToOvtBalanceUpdates((newBalanceData) => {
       if (address && newBalanceData.address === address && newBalanceData.runeId === OVT_RUNE_ID) {
         console.log(`useRuneIntegration: Received OVT_BALANCE_UPDATED via WebSocket for ${address}:`, newBalanceData.amount);
         setBalance(newBalanceData.amount);
       } 
    });
    const unsubscribeTransactions = priceStore.subscribeToOvtTransactionUpdates((updatedTransactionList) => {
        console.log(`useRuneIntegration: Received OVT_TRANSACTION_UPDATED via WebSocket. Updating local list.`);
        setTransactions(updatedTransactionList);
    });
    const unsubscribeOrderUpdates = priceStore.subscribeToOrderUpdates((orderUpdate: OrderUpdatePayload) => {
      if (!isMounted) return;
      console.log("useRuneIntegration: Received ORDER_UPDATE via WebSocket:", orderUpdate);
      if (orderUpdate.orderId && orderUpdate.orderId === processingOrderId) {
         console.log(`Order update matches currently processing order: ${processingOrderId}`);
         if (processingTimeoutId) clearTimeout(processingTimeoutId);
         setProcessingTimeoutId(null);
         setProcessingOrderId(null); 
         if (orderUpdate.status === 'completed') {
            addNotification({ type: 'success', message: orderUpdate.message || `Order ${orderUpdate.orderId} completed!` });
            console.log(`Order ${orderUpdate.orderId} completed successfully via WS.`);
            if (address) {
              getBalance(address).catch(err => console.error("getBalance after WS update failed:", err));
              getTransactionHistory(address).catch(err => console.error("getTransactionHistory after WS update failed:", err));
            }
         } else { 
            addNotification({ type: 'error', message: orderUpdate.message || `Order ${orderUpdate.orderId} failed: ${orderUpdate.status}` });
            console.error(`Order ${orderUpdate.orderId} failed via WS: ${orderUpdate.message || orderUpdate.status}`);
         }
      } else {
         console.log(`Received order update for ${orderUpdate.orderId}, but currently processing ${processingOrderId}. Ignoring.`);
      }
    });

    // --- Cleanup --- 
    return () => {
      console.log("useRuneIntegration: Cleaning up WebSocket subscriptions.");
      unsubscribeBalance();
      unsubscribeTransactions();
      unsubscribeOrderUpdates();
      if (processingTimeoutId) {
          clearTimeout(processingTimeoutId);
      }
      isMounted = false;
    };
  // Correct dependencies for useEffect
  }, [
      address, 
      connected, 
      getBalance, // Use local function 
      getTransactionHistory, // Use local function
      getTokenMetadata, 
      priceStore, 
      processingOrderId, 
      processingTimeoutId, 
      addNotification
  ]);

  return {
    isLoading, error, balance, metadata, transactions, processingOrderId,
    getBalance, getTokenMetadata, getTransactionHistory, // Expose local fetchers
    prepareBuyOVT, confirmBuyOVT, prepareSellOVT, confirmSellOVT, // Expose trading funcs
    sendRune, // Expose the correct LaserEyes-based sendRune
    formatTokenAmount,
    OVT_RUNE_ID, OVT_RUNE_SYMBOL, OVT_RUNE_TICKER, isConnected: connected,
    // Removed getDistributionStats and deprecated transferRune from export
  };
}

export default useRuneIntegration; 