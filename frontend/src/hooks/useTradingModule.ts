import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { getDataSourceIndicator } from '../lib/hybridModeUtils';
import { ArchTransaction } from '../lib/archClient';
import { getPriceStore } from '../services/priceService';
import { useOVTPrice } from './useOVTPrice';
import { TransactionDetails } from '../../components/TransactionConfirmationModal';

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

export type TradeParams = TransactionDetails;

export interface TradingModuleResult {
  buyOVT: (amount: number, maxPrice?: number) => Promise<void>;
  sellOVT: (amount: number, minPrice?: number) => Promise<void>;
  getMarketPrice: () => number;
  prepareTransaction: (type: 'buy' | 'sell', amount: number, limitPrice?: number) => TransactionDetails;
  executeTransaction: (details: TransactionDetails) => Promise<TradeTransaction | null>;
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
  orderBook: OrderBook;
}

type PriceStoreWithTrading = ReturnType<typeof getPriceStore> & {
  subscribeToTradeUpdates: (callback: (trade: TradeTransaction) => void) => () => void;
  subscribeToOrderBookUpdates: (callback: (orderBook: OrderBook) => void) => () => void;
  subscribeToConnectionChange: (callback: (status: boolean) => void) => () => void;
};

const TRADE_HISTORY_KEY = 'ovt-trade-history';

const convertArchToTradeTransaction = (archTx: ArchTransaction): TradeTransaction => {
  return {
    txid: archTx.txid,
    type: archTx.type.toUpperCase() as 'BUY' | 'SELL',
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

export function useTradingModule(): TradingModuleResult {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeTransaction[]>([]);
  const [pendingTransaction, setPendingTransaction] = useState<TransactionDetails | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [] });
  
  const priceData = useOVTPrice();
  const priceStore = useMemo(() => getPriceStore() as PriceStoreWithTrading, []);

  const getMarketPrice = useCallback(() => {
    if (orderBook.asks.length > 0 && orderBook.bids.length > 0) {
        return (orderBook.asks[0].price + orderBook.bids[0].price) / 2;
    }
    return priceData.btcPriceSats;
  }, [priceData.btcPriceSats, orderBook]);

  const prepareTransaction = useCallback((type: 'buy' | 'sell', amount: number, limitPrice?: number): TransactionDetails => {
    const marketPrice = getMarketPrice();
    const calculationPrice = limitPrice ?? marketPrice;

    const price = calculationPrice;

    const totalValue = amount * price;
    const feeEstimate = totalValue * 0.001;

    return {
      type,
      amount,
      price,
      totalValue,
      feeEstimate,
      tokenSymbol: 'OVT',
      limitPrice
    };
  }, [getMarketPrice]);

  const executeTransaction = useCallback(async (details: TransactionDetails): Promise<TradeTransaction | null> => {
    setIsLoading(true);
    setError(null);
    console.log("Attempting to execute transaction via API:", details);
    try {
      const response = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(details)
      });

      if (!response.ok) {
          let errorMsg = 'Trade execution request failed';
          try {
              const errorData = await response.json();
              errorMsg = errorData?.message || `Request failed with status: ${response.status}`;
          } catch {
               errorMsg = `Request failed with status: ${response.status}`;
          }
          console.error("API Error:", errorMsg);
          throw new Error(errorMsg);
      }

      const pendingData = await response.json().catch(() => ({}));
      console.log("API response received:", pendingData);

      return {
          txid: pendingData?.txid || `pending-${Date.now()}`,
          type: details.type.toUpperCase() as 'BUY' | 'SELL',
          amount: details.amount,
          confirmations: 0,
          timestamp: Date.now(),
          metadata: {
              price: details.price,
              status: 'pending',
              orderType: details.limitPrice ? 'limit' : 'market',
              limitPrice: details.limitPrice,
              filledAt: undefined
          }
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during trade execution';
      console.error("executeTransaction Error:", errorMessage, err);
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
      setPendingTransaction(null);
    }
  }, []);

  const buyOVT = useCallback(async (amount: number, maxPrice?: number): Promise<void> => {
    if (amount <= 0) { setError('Amount must be positive'); return; }
    setError(null);
    const txDetails = prepareTransaction('buy', amount, maxPrice);
    setPendingTransaction(txDetails);
  }, [prepareTransaction]);

  const sellOVT = useCallback(async (amount: number, minPrice?: number): Promise<void> => {
    if (amount <= 0) { setError('Amount must be positive'); return; }
    setError(null);
    const txDetails = prepareTransaction('sell', amount, minPrice);
    setPendingTransaction(txDetails);
  }, [prepareTransaction]);

  useEffect(() => {
    let isMounted = true;
    console.log("Setting up TradingModule WebSocket subscriptions...");

    const handleTradeUpdate = (trade: TradeTransaction) => {
      if (isMounted) {
        console.log('WS: Received trade update:', trade);
        setTradeHistory(prev => {
          const existingIndex = prev.findIndex(t => t.txid === trade.txid);
          if (existingIndex !== -1) {
            const updatedHistory = [...prev];
            updatedHistory[existingIndex] = trade;
            return updatedHistory;
          } else {
            return [trade, ...prev];
          }
        });
        if (trade.metadata.status === 'confirmed' || trade.metadata.status === 'failed') {
            setIsLoading(false);
            setError(null);
        }
      }
    };

    const handleOrderBookUpdate = (newOrderBook: OrderBook) => {
      if (isMounted) {
        setOrderBook(newOrderBook);
      }
    };

    const handleConnectionChange = (status: boolean) => {
      if (isMounted) {
        console.log(`WS Connection Status (Trading): ${status ? 'Connected' : 'Disconnected'}`);
        if (!status) {
          setError("Real-time trading updates unavailable. Connection lost.");
        } else {
          setError(null);
        }
      }
    };

    const unsubscribeTrade = priceStore.subscribeToTradeUpdates(handleTradeUpdate);
    const unsubscribeOrderBook = priceStore.subscribeToOrderBookUpdates(handleOrderBookUpdate);
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);
    console.log("TradingModule subscriptions active.");

    return () => {
      isMounted = false;
      console.log("Cleaning up TradingModule WebSocket subscriptions...");
      unsubscribeTrade();
      unsubscribeOrderBook();
      unsubscribeConnection();
    };
  }, [priceStore]);

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
    setPendingTransaction,
    orderBook,
  };
}

export default useTradingModule; 