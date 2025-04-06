import { useState, useEffect, useCallback, useMemo } from 'react';
import type { NAVResult } from '../lib/navCalculator';
import { useCurrencyToggle, Currency } from './useCurrencyToggle';
import { SATS_PER_BTC } from '../lib/formatting';
import { getPriceStore, NAVData, BitcoinPrice } from '../services/priceService';

interface NAVHookResult {
  nav: NAVResult;
  loading: boolean; // True if WebSocket is connecting or initial data hasn't arrived
  error: string | null; // Connection errors or data issues
  isConnected: boolean; // Expose WebSocket connection status
  btcPriceData: BitcoinPrice | null; // ADD BTC price data for formatting
}

// Default NAV result if not yet loaded - ONLY RAW VALUES
const defaultNAV: NAVResult = {
  navSats: 0,
  navUsd: 0,
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

  // State for NAV Result (raw data)
  const [navDataResult, setNavDataResult] = useState<NAVResult>(() => {
    const currentStoreData = priceStore.navData;
    if (currentStoreData) {
      // Ensure mapStoreDataToNavResult exists and handles potential missing btcPrice initially
      return mapStoreDataToNavResult(currentStoreData, priceStore.btcPrice); 
    }
    return defaultNAV;
  });
  
  // State for BTC Price Data
  const [btcPriceData, setBtcPriceData] = useState<BitcoinPrice | null>(priceStore.btcPrice);

  // Loading state is derived from connection status and whether we have initial data
  const [isConnected, setIsConnected] = useState<boolean>(priceStore.isConnected);
  const [loading, setLoading] = useState<boolean>(!priceStore.isConnected || !priceStore.navData || !priceStore.btcPrice);
  const [error, setError] = useState<string | null>(null);

  const { currency } = useCurrencyToggle();

  // REMOVED: refreshNAV function - no longer needed
  /*
  const refreshNAV = useCallback(() => { ... }, [priceStore, loading]);
  */

  // Effect for subscribing to PriceStore updates (NAV, BTC, Connection)
  useEffect(() => {
    let isMounted = true;

    // 1. Subscribe to NAV data updates
    const handleNavUpdate = (storeData: NAVData) => {
      if (isMounted) {
        // Pass current btcPriceData for mapping
        const mappedData = mapStoreDataToNavResult(storeData, btcPriceData); 
        setNavDataResult(mappedData);
        setError(null); 
        setLoading(false); 
      }
    };
    const unsubscribeNav = priceStore.subscribeToNavUpdates(handleNavUpdate);
    
    // 2. Subscribe to BTC price updates
    const handleBtcUpdate = (newBtcData: BitcoinPrice) => {
        if (isMounted) {
            setBtcPriceData(newBtcData);
            // Re-map NAV data with the new BTC price if NAV data exists
            if (priceStore.navData) {
                const mappedData = mapStoreDataToNavResult(priceStore.navData, newBtcData);
                setNavDataResult(mappedData);
            }
        }
    };
    const unsubscribeBtc = priceStore.subscribeToBtcUpdates(handleBtcUpdate);

    // 3. Subscribe to WebSocket connection status changes
    const handleConnectionChange = (status: boolean) => {
      if (isMounted) {
        setIsConnected(status);
        if (!status) {
          if (!priceStore.navData) {
              setLoading(true);
              setError("Connecting to real-time updates...");
          } else {
               setError("Real-time connection lost. Displaying last known data.");
               setLoading(false);
          }
        } else {
          setError(null);
          setLoading(!priceStore.navData || !priceStore.btcPrice); // Loading if missing NAV OR BTC data
        }
      }
    };
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);

    // Initial state check after subscriptions are set up
    if (isMounted) {
       setIsConnected(priceStore.isConnected);
       setBtcPriceData(priceStore.btcPrice);
       setLoading(!priceStore.isConnected || !priceStore.navData || !priceStore.btcPrice);
       if (!priceStore.isConnected && (!priceStore.navData || !priceStore.btcPrice)) {
          setError("Connecting to real-time updates...");
       }
       if (priceStore.navData && priceStore.btcPrice) {
           setNavDataResult(mapStoreDataToNavResult(priceStore.navData, priceStore.btcPrice));
           setLoading(false);
       }
    }

    // Clean up subscriptions on unmount
    return () => {
      isMounted = false;
      unsubscribeNav();
      unsubscribeBtc(); // Unsubscribe BTC listener
      unsubscribeConnection();
    };
  }, [priceStore, btcPriceData]); // Add btcPriceData dependency for re-mapping on BTC price change

  // REMOVED pre-formatted NAV calculation
  /*
  const getFormattedNAV = useCallback(...);
  const formattedNAV = useMemo(...);
  */

  return {
    nav: navDataResult, // Use the state holding the NAVResult object
    loading,
    error,
    isConnected,
    btcPriceData, // Return the BTC price data object
  };
}

// Helper function to map store data to hook data structure (RAW VALUES ONLY)
// Now requires btcPriceData for calculating pricePerTokenUsd
function mapStoreDataToNavResult(storeData: NAVData, btcPriceData: BitcoinPrice | null): NAVResult {
    // Use price from btcPriceData if available
    const currentBtcPrice = btcPriceData?.price ?? 0; 
    
    const pricePerTokenUsd = currentBtcPrice && storeData.ovtPrice
        ? (storeData.ovtPrice / SATS_PER_BTC) * currentBtcPrice
        : 0;
        
    // Return raw values. Formatting happens in the display component.
    return {
        navSats: storeData.totalValueSats,
        navUsd: storeData.totalValueUSD,
        pricePerToken: storeData.ovtPrice, 
        pricePerTokenUsd: pricePerTokenUsd, 
        totalTokenSupply: storeData.circulatingSupply || 2100000, 
        changePercentage: storeData.changePercentage || 0
    };
}

export default useNAV; 