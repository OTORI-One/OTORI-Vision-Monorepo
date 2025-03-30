import { useState, useCallback, useEffect } from 'react';
import { getDataSourceIndicator } from '../lib/hybridModeUtils';
import { ArchTransaction } from '../lib/archClient';
import { useOVTClient } from './useOVTClient';
import priceService from '../services/priceService';
import { useOVTPrice } from './useOVTPrice';
import { TransactionDetails } from '../../components/TransactionConfirmationModal';

// Define types for our trading module
export interface Order {
  price: number;  // in sats
  amount: number; // number of OVT tokens
}

export interface OrderBook {
  bids: Order[];  // buy orders (price descending)
  asks: Order[];  // sell orders (price ascending)
}

export interface TradeTransaction {
  txid: string;
  type: 'BUY' | 'SELL';
  amount: number;
  confirmations: number;
  timestamp: number;
  metadata: {
    price: number;
    status: 'pending' | 'confirmed' | 'failed';
    orderType: 'market' | 'limit';
    limitPrice?: number;
    filledAt?: number;
  };
}

export type TradeParams = {
  type: 'buy' | 'sell';
  amount: number;
  maxPrice?: number; // for buy orders
  minPrice?: number; // for sell orders
  executionPrice: number; // price trade executed at
  fee?: number;
};

// Add new types for confirmation flow
export interface TradingModuleResult {
  buyOVT: (amount: number, maxPrice?: number) => Promise<TradeTransaction | null>;
  sellOVT: (amount: number, minPrice?: number) => Promise<TradeTransaction | null>;
  getMarketPrice: () => number;
  prepareTransaction: (type: 'buy' | 'sell', amount: number, limitPrice?: number) => TransactionDetails;
  executeTransaction: (details: TransactionDetails) => Promise<TradeTransaction>;
  isLoading: boolean;
  error: string | null;
  tradeHistory: TradeTransaction[];
  dataSource: {
    isMock: boolean;
    label: string;
    color: string;
  };
  pendingTransaction: TransactionDetails | null;
  setPendingTransaction: (tx: TransactionDetails | null) => void;
}

// Local storage keys
const TRADE_HISTORY_KEY = 'ovt-trade-history';

// Helper to convert ArchTransaction to TradeTransaction
const convertArchToTradeTransaction = (archTx: ArchTransaction): TradeTransaction => {
  return {
    txid: archTx.txid,
    type: archTx.type as 'BUY' | 'SELL',
    amount: archTx.amount,
    confirmations: archTx.confirmations,
    timestamp: archTx.timestamp,
    metadata: {
      price: archTx.metadata?.price || 0,
      status: archTx.metadata?.status || 'confirmed',
      orderType: archTx.metadata?.orderType || 'market',
      limitPrice: archTx.metadata?.limitPrice,
      filledAt: archTx.metadata?.filledAt
    }
  };
};

/**
 * Hook for trading OVT tokens
 */
export function useTradingModule(): TradingModuleResult {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeTransaction[]>([]);
  const [pendingTransaction, setPendingTransaction] = useState<TransactionDetails | null>(null);
  
  // Get consistent OVT price from price service
  const priceData = useOVTPrice();
  
  // We keep the reference to useOVTClient for now but comment out its direct usage
  // This will be useful when implementing on-chain interactions with the OTORI program
  // in the future, but for now we use the centralized price service
  const ovtClientResult = useOVTClient();
  // Let archClient;
  // if (ovtClientResult) {
  //   archClient = ovtClientResult.archClient;
  // }
  
  /**
   * Simulates getting the current market price from the on-chain program
   */
  const getMarketPrice = useCallback(() => {
    // Use price service rather than direct calculation
    return priceData.btcPriceSats;
  }, [priceData.btcPriceSats]);
  
  /**
   * Prepares transaction details for confirmation
   */
  const prepareTransaction = useCallback((type: 'buy' | 'sell', amount: number, limitPrice?: number): TransactionDetails => {
    const marketPrice = getMarketPrice();
    const executionPrice = limitPrice || marketPrice;
    
    // Use the specified limit price or market price
    const price = type === 'buy' 
      ? Math.min(executionPrice, marketPrice) // For buy orders, use the lower price
      : Math.max(executionPrice, marketPrice); // For sell orders, use the higher price
    
    const totalValue = amount * price;
    
    // Estimate fees (simplified for now)
    const feeEstimate = totalValue * 0.001; // 0.1% fee
    
    return {
      type,
      amount,
      price,
      totalValue,
      feeEstimate,
      tokenSymbol: 'OVT'
    };
  }, [getMarketPrice]);
  
  /**
   * Executes a prepared transaction
   */
  const executeTransaction = useCallback(async (details: TransactionDetails): Promise<TradeTransaction> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Simulate a transaction - in the future this would call the OTORI program
      const transaction = await simulateTradeTransaction({
        type: details.type,
        amount: details.amount,
        maxPrice: details.type === 'buy' ? details.price : undefined,
        minPrice: details.type === 'sell' ? details.price : undefined,
        executionPrice: details.price
      });
      
      // Update trade history
      setTradeHistory(prev => [transaction, ...prev]);
      
      return transaction;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error executing transaction';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
      setPendingTransaction(null);
    }
  }, []);
  
  /**
   * Simulates buying OVT at either market price or up to a specified max price
   */
  const buyOVT = useCallback(async (amount: number, maxPrice?: number): Promise<TradeTransaction | null> => {
    if (amount <= 0) {
      setError('Amount must be greater than 0');
      return null;
    }
    
    // Prepare the transaction details
    const txDetails = prepareTransaction('buy', amount, maxPrice);
    
    // Update pending transaction (will trigger UI to show confirmation)
    setPendingTransaction(txDetails);
    
    // Return null - the actual execution happens when confirmation is received
    return null;
  }, [prepareTransaction]);
  
  /**
   * Simulates selling OVT at either market price or down to a specified min price
   */
  const sellOVT = useCallback(async (amount: number, minPrice?: number): Promise<TradeTransaction | null> => {
    if (amount <= 0) {
      setError('Amount must be greater than 0');
      return null;
    }
    
    // Prepare the transaction details
    const txDetails = prepareTransaction('sell', amount, minPrice);
    
    // Update pending transaction (will trigger UI to show confirmation)
    setPendingTransaction(txDetails);
    
    // Return null - the actual execution happens when confirmation is received
    return null;
  }, [prepareTransaction]);

  // Helper to simulate transaction for development purposes
  const simulateTradeTransaction = useCallback(async (params: TradeParams): Promise<TradeTransaction> => {
    try {
      // In a real implementation, this would submit to the blockchain
      // For now just creating a simulated transaction
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
      
      // Create a simulated transaction
      const txid = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      return {
        txid,
        type: params.type.toUpperCase() as 'BUY' | 'SELL',
        amount: params.amount,
        confirmations: 0,
        timestamp: Date.now(),
        metadata: {
          price: params.executionPrice,
          status: 'pending' as 'pending' | 'confirmed' | 'failed',
          orderType: (params.maxPrice || params.minPrice ? 'limit' : 'market') as 'market' | 'limit',
          limitPrice: params.maxPrice || params.minPrice,
          filledAt: params.executionPrice
        }
      };
    } catch (error) {
      console.error('Error simulating transaction:', error);
      throw error;
    }
  }, []);
  
  // Update state with trade history
  useEffect(() => {
    const updateHistory = async () => {
      // In the future, fetch the actual trade history from the OTORI program
      // For now, just using our local state
    };
    
    updateHistory().catch(console.error);
  }, []);
  
  // Get the current data source indicator
  const dataSource = getDataSourceIndicator('trading');
  
  return {
    buyOVT,
    sellOVT,
    getMarketPrice,
    prepareTransaction,
    executeTransaction,
    isLoading,
    error,
    tradeHistory,
    dataSource,
    pendingTransaction,
    setPendingTransaction
  };
} 