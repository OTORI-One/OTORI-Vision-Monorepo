/**
 * useOVTPrice Hook
 * 
 * This hook fetches OVT price data from the centralized price service,
 * ensuring consistent pricing across all clients.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import priceService, { getPriceStore, OVTPrice } from '../services/priceService';

// Define the hook result interface
interface OVTPriceHookResult {
  price: number;
  btcPriceSats: number;
  btcPriceFormatted: string;
  usdPrice: number;
  usdPriceFormatted: string;
  dailyChange: number;
  dailyChangeFormatted: string;
  isPositiveChange: boolean;
  lastUpdate: number;
  circulatingSupply: number;
  isLoading: boolean; // True if WebSocket is connecting or initial data hasn't arrived
  error: string | null; // Connection errors or data issues
  isConnected: boolean; // Expose WebSocket connection status
  // refreshPrice: () => Promise<boolean>; // Removed - updates are pushed
  timestamp: number;
}

export function useOVTPrice(): OVTPriceHookResult {
  const priceStore = useMemo(() => getPriceStore(), []);

  // SSR initial state remains the same
  const initialPriceSsr = useMemo(() => ({
    price: 550000,
    btcPriceSats: 550000,
    btcPriceFormatted: '550,000 sats',
    usdPrice: 3.30,
    usdPriceFormatted: '$3.30',
    dailyChange: 0,
    lastUpdate: Date.now(),
    circulatingSupply: 1000000,
    timestamp: Date.now()
  }), []);

  // Initialize state from store cache or SSR default
  const [ovtPrice, setOvtPrice] = useState<OVTPrice | null>(() => {
      // In SSR, always use initialPriceSsr
      if (typeof window === 'undefined') return initialPriceSsr;
      // On client, try store first, then SSR default
      return priceStore.ovtPrice || initialPriceSsr;
  });
  
  const [isConnected, setIsConnected] = useState<boolean>(priceStore.isConnected);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
      if (typeof window === 'undefined') return false; // Not loading in SSR
      return !priceStore.isConnected || !priceStore.ovtPrice;
  });
  const [error, setError] = useState<string | null>(null);

  // Get cached daily change value if available (keep this utility)
  const getCachedDailyChange = useCallback(() => {
    try {
      if (typeof window === 'undefined') return null;
      
      const cachedChange = localStorage.getItem('ovt-daily-change');
      const timestamp = localStorage.getItem('ovt-daily-change-timestamp');
      
      if (cachedChange && timestamp) {
        // Only use cache if it's less than 1 hour old
        const changeTime = parseInt(timestamp, 10);
        if (Date.now() - changeTime < 60 * 60 * 1000) {
          return parseFloat(cachedChange);
        }
      }
      return null;
    } catch (err) {
      console.error('Error reading cached OVT daily change:', err);
      return null;
    }
  }, []);

  // Effect for subscribing to PriceStore updates (data and connection)
  useEffect(() => {
    if (typeof window === 'undefined') return; // Client-side only

    let isMounted = true;

    // 1. Subscribe to OVT price data updates
    const handleOvtUpdate = (data: OVTPrice) => {
      if (isMounted) {
        // Cache the daily change value locally if valid
        if (typeof data.dailyChange === 'number' && isFinite(data.dailyChange)) {
          try {
            localStorage.setItem('ovt-daily-change', String(data.dailyChange));
            localStorage.setItem('ovt-daily-change-timestamp', String(Date.now()));
          } catch (err) {
            console.error('Error saving OVT daily change to localStorage:', err);
          }
        }
        setOvtPrice(data);
        setError(null); // Clear error on successful data update
        setIsLoading(false); // Data arrived
      }
    };
    const unsubscribeOvt = priceStore.subscribeToOvtUpdates(handleOvtUpdate);

    // 2. Subscribe to connection status changes
    const handleConnectionChange = (status: boolean) => {
      if (isMounted) {
        setIsConnected(status);
        if (!status) {
           if (!priceStore.ovtPrice) { // Only loading if no data at all
              setIsLoading(true);
              setError("Connecting to real-time updates...");
           } else {
               setError("Real-time connection lost. Displaying last known data.");
               setIsLoading(false);
           }
        } else {
          setError(null);
          setIsLoading(!priceStore.ovtPrice); // Loading if connected but no data yet
        }
      }
    };
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);

    // Initial state check after subscriptions
    if (isMounted) {
        setIsConnected(priceStore.isConnected);
        const currentStorePrice = priceStore.ovtPrice;
        setOvtPrice(currentStorePrice || initialPriceSsr); // Use cache or SSR default
        setIsLoading(!priceStore.isConnected || !currentStorePrice);
        if (!priceStore.isConnected && !currentStorePrice) {
            setError("Connecting to real-time updates...");
        }
    }

    // Cleanup
    return () => {
      isMounted = false;
      unsubscribeOvt();
      unsubscribeConnection();
    };
  }, [priceStore, initialPriceSsr]); // Include initialPriceSsr in deps for safety

  // Memoized calculations for formatted daily change and positive status (keep)
  const dailyChangeFormatted = useMemo(() => {
      // Prioritize live data, then cache, then default
      const currentChange = (ovtPrice?.dailyChange !== undefined && isFinite(ovtPrice.dailyChange)) 
          ? ovtPrice.dailyChange 
          : getCachedDailyChange();

      if (currentChange !== null) {
          return `${currentChange >= 0 ? '+' : ''}${currentChange.toFixed(2)}%`;
      }
      return '+0.00%'; // Default
  }, [ovtPrice, getCachedDailyChange]);

  const isPositiveChange = useMemo(() => {
      const currentChange = (ovtPrice?.dailyChange !== undefined && isFinite(ovtPrice.dailyChange)) 
          ? ovtPrice.dailyChange 
          : getCachedDailyChange();
      
      return currentChange === null ? true : currentChange >= 0; // Default to true if unknown
  }, [ovtPrice, getCachedDailyChange]);

  // Return hook result, ensuring fallbacks for potentially null ovtPrice
  // Use live data if available, otherwise fallback gracefully (using cached daily change where appropriate)
  const finalPriceData = ovtPrice || initialPriceSsr;
  const liveDailyChange = (ovtPrice?.dailyChange !== undefined && isFinite(ovtPrice.dailyChange)) 
      ? ovtPrice.dailyChange 
      : getCachedDailyChange() ?? 0; // Fallback to cache or 0

  return {
    price: finalPriceData.price,
    btcPriceSats: finalPriceData.btcPriceSats,
    btcPriceFormatted: finalPriceData.btcPriceFormatted,
    usdPrice: finalPriceData.usdPrice,
    usdPriceFormatted: finalPriceData.usdPriceFormatted,
    dailyChange: liveDailyChange,
    dailyChangeFormatted,
    isPositiveChange,
    lastUpdate: finalPriceData.lastUpdate,
    circulatingSupply: finalPriceData.circulatingSupply,
    isLoading,
    error,
    isConnected,
    // refreshPrice, // Removed
    timestamp: finalPriceData.timestamp,
  };
} 