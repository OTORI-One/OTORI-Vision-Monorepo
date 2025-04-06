import { useState, useEffect, useCallback, useMemo } from 'react';
import type { NAVResult } from '../lib/navCalculator';
import { useCurrencyToggle, Currency } from './useCurrencyToggle';
import { formatValue, SATS_PER_BTC } from '../lib/formatting';
import { getPriceStore, NAVData } from '../services/priceService';

interface NAVHookResult {
  nav: NAVResult;
  loading: boolean; // True if WebSocket is connecting or initial data hasn't arrived
  error: string | null; // Connection errors or data issues
  isConnected: boolean; // Expose WebSocket connection status
  // refreshNAV: () => void; // Removed - updates are pushed via WebSocket
  formattedNAV: string;
}

// Default NAV result if not yet loaded
const defaultNAV: NAVResult = {
  navSats: 0,
  navUsd: 0,
  formattedNavSats: '0 sats',
  formattedNavUsd: '$0.00',
  pricePerToken: 0,
  pricePerTokenUsd: 0,
  totalTokenSupply: 2100000,
  changePercentage: 0
};

/**
 * Hook for accessing NAV data with automatic currency formatting,
 * using the centralized PriceStore updated via WebSockets.
 */
export function useNAV(): NAVHookResult {
  const priceStore = useMemo(() => getPriceStore(), []);

  // Initialize state from PriceStore's current cached data or default
  const [navData, setNavData] = useState<NAVResult>(() => {
    const currentStoreData = priceStore.navData;
    if (currentStoreData) {
      return mapStoreDataToNavResult(currentStoreData);
    }
    return defaultNAV;
  });

  // Loading state is derived from connection status and whether we have initial data
  const [isConnected, setIsConnected] = useState<boolean>(priceStore.isConnected);
  const [loading, setLoading] = useState<boolean>(!priceStore.isConnected || !priceStore.navData);
  const [error, setError] = useState<string | null>(null);

  const { currency } = useCurrencyToggle();

  // REMOVED: refreshNAV function - no longer needed
  /*
  const refreshNAV = useCallback(() => { ... }, [priceStore, loading]);
  */

  // Effect for subscribing to PriceStore updates (data and connection status)
  useEffect(() => {
    let isMounted = true;

    // 1. Subscribe to NAV data updates
    const handleNavUpdate = (storeData: NAVData) => {
      if (isMounted) {
        console.log('useNAV: Received NAV update via subscription. Store Data:', storeData);
        const mappedData = mapStoreDataToNavResult(storeData);
        console.log('useNAV: Mapped data before setting state:', mappedData);
        setNavData(mappedData);
        setError(null); // Clear previous errors on successful update
        // Loading is false if we have data, even if temporarily disconnected
        setLoading(false); 
      }
    };
    const unsubscribeNav = priceStore.subscribeToNavUpdates(handleNavUpdate);

    // 2. Subscribe to WebSocket connection status changes
    const handleConnectionChange = (status: boolean) => {
      if (isMounted) {
        // console.log(`useNAV: Connection status changed: ${status}`);
        setIsConnected(status);
        if (!status) {
          // If disconnected, set loading true *only if* we don't have any data yet
          if (!priceStore.navData) {
              setLoading(true);
              setError("Connecting to real-time updates..."); // Informative message
          } else {
              // We have stale data, but show disconnected state
               setError("Real-time connection lost. Displaying last known data.");
               setLoading(false); // Not strictly loading, just potentially stale
          }
        } else {
          // Connected: clear connection errors, loading depends on data arrival
          setError(null);
          setLoading(!priceStore.navData); // Loading if connected but no data yet
        }
      }
    };
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);

    // Initial state check after subscriptions are set up
    if (isMounted) {
       setIsConnected(priceStore.isConnected);
       setLoading(!priceStore.isConnected || !priceStore.navData);
       if (!priceStore.isConnected && !priceStore.navData) {
          setError("Connecting to real-time updates...");
       }
       // If store already had data when mounting, apply it immediately
       if (priceStore.navData) {
           setNavData(mapStoreDataToNavResult(priceStore.navData));
           setLoading(false);
       }
    }

    // REMOVED: Initial fetch logic - PriceStore handles its initialization
    /*
    if (!priceStore.navData) {
        console.log('useNAV: Initializing NAV fetch via PriceStore.');
        setLoading(true);
        priceStore.fetchNAVData(false) ...
    }
    */

    // Clean up subscriptions on unmount
    return () => {
      isMounted = false;
      unsubscribeNav();
      unsubscribeConnection();
    };
  }, [priceStore]); // priceStore is stable

  // Memoized formatted NAV calculation (no changes needed)
  const getFormattedNAV = useCallback((navResult: NAVResult, activeCurrency: Currency): string => {
    if (!navResult) return activeCurrency === 'usd' ? '$0.00' : '₿0.00';
    
    return activeCurrency === 'usd' 
      ? navResult.formattedNavUsd 
      : navResult.formattedNavSats;
  }, []);
  
  const formattedNAV = useMemo(() => {
    return getFormattedNAV(navData, currency);
  }, [getFormattedNAV, navData, currency]);

  return {
    nav: navData,
    loading,
    error,
    isConnected,
    // refreshNAV, // Removed
    formattedNAV,
  };
}

// Helper function to map store data to hook data structure
function mapStoreDataToNavResult(storeData: NAVData): NAVResult {
    const pricePerTokenUsd = storeData.btcPrice && storeData.ovtPrice
        ? (storeData.ovtPrice / SATS_PER_BTC) * storeData.btcPrice
        : 0;
        
    return {
        navSats: storeData.totalValueSats,
        navUsd: storeData.totalValueUSD,
        formattedNavSats: storeData.formattedTotalValueSats,
        formattedNavUsd: storeData.formattedTotalValueUSD,
        pricePerToken: storeData.ovtPrice, // Assuming ovtPrice in store is per token in sats
        pricePerTokenUsd: pricePerTokenUsd, 
        totalTokenSupply: storeData.circulatingSupply || 2100000, // Fallback if needed
        changePercentage: storeData.changePercentage || 0
    };
}

export default useNAV; 