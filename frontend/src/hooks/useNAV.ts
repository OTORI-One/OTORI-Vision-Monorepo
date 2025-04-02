import { useState, useEffect, useCallback, useMemo } from 'react';
import type { NAVResult } from '../lib/navCalculator';
import { useCurrencyToggle, Currency } from './useCurrencyToggle';
import { formatValue, SATS_PER_BTC } from '../lib/formatting';
import { getPriceStore, NAVData } from '../services/priceService';

interface NAVHookResult {
  nav: NAVResult;
  loading: boolean;
  error: string | null;
  refreshNAV: () => void;
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
 * using the centralized PriceStore for updates via polling.
 */
export function useNAV(): NAVHookResult {
  // Get the singleton PriceStore instance
  const priceStore = useMemo(() => getPriceStore(), []);

  // Initialize state from PriceStore's current data or default
  const [navData, setNavData] = useState<NAVResult>(() => {
    const currentStoreData = priceStore.navData;
    if (currentStoreData) {
      // Map store data (NAVData) to hook data (NAVResult)
      return {
        navSats: currentStoreData.totalValueSats,
        navUsd: currentStoreData.totalValueUSD,
        formattedNavSats: currentStoreData.formattedTotalValueSats,
        formattedNavUsd: currentStoreData.formattedTotalValueUSD,
        pricePerToken: currentStoreData.ovtPrice,
        pricePerTokenUsd: currentStoreData.btcPrice ? (currentStoreData.ovtPrice / SATS_PER_BTC) * currentStoreData.btcPrice : 0,
        totalTokenSupply: currentStoreData.circulatingSupply || 2100000,
        changePercentage: currentStoreData.changePercentage || 0
      };
    }
    return defaultNAV;
  });

  // Loading is true initially if the store doesn't have data yet
  const [loading, setLoading] = useState<boolean>(!priceStore.navData);
  const [error, setError] = useState<string | null>(null);
  
  // Get the currency context
  const { currency } = useCurrencyToggle();
  
  // Manual refresh function - uses the store's fetch method
  const refreshNAV = useCallback(() => {
    // Only allow manual refresh if not currently loading
    if (loading) return;

    console.log('Manual NAV refresh triggered via PriceStore...');
    setLoading(true);
    priceStore.fetchNAVData(true) // Use force=true for manual refresh
      .then(data => {
         // The subscription listener below will handle updating the state
         // We just need to reset loading/error here if needed, but the listener does that too.
         // setError(null); 
      })
      .catch(err => {
        console.error('Error during manual NAV refresh:', err);
        setError('Failed to manually refresh NAV data');
        // If refresh fails, stop loading
        setLoading(false); 
      });
      // setLoading(false) will be handled by the subscription callback upon successful update or error during fetch
  }, [priceStore, loading]); 
  
  // Effect for subscribing to PriceStore updates
  useEffect(() => {
    // Skip in SSR context
    if (typeof window === 'undefined') return;

    let isMounted = true;

    // Callback when PriceStore updates its NAV data
    const handleNavUpdate = (storeData: NAVData) => {
        if (isMounted) {
          console.log('Received NAV update from PriceStore subscription.');
          // Map store data (NAVData) to hook data (NAVResult)
          const newNavResult: NAVResult = {
            navSats: storeData.totalValueSats,
            navUsd: storeData.totalValueUSD,
            formattedNavSats: storeData.formattedTotalValueSats,
            formattedNavUsd: storeData.formattedTotalValueUSD,
            pricePerToken: storeData.ovtPrice,
            pricePerTokenUsd: storeData.btcPrice ? (storeData.ovtPrice / SATS_PER_BTC) * storeData.btcPrice : 0,
            totalTokenSupply: storeData.circulatingSupply || 2100000,
            changePercentage: storeData.changePercentage || 0
          };
          setNavData(newNavResult);
          setError(null); 
          setLoading(false); // Data has arrived, no longer loading
        }
    };

    // Subscribe to updates from the PriceStore
    const unsubscribe = priceStore.subscribeToNavUpdates(handleNavUpdate);

    // Trigger initial fetch *if* the store doesn't have data upon mount
    // The store's internal logic prevents duplicate requests.
    if (!priceStore.navData) {
        console.log('useNAV: Initializing NAV fetch via PriceStore.');
        setLoading(true);
        priceStore.fetchNAVData(false)
            .catch(err => {
                // Error handling for the initial fetch
                if (isMounted) {
                    console.error('useNAV: Initial NAV fetch failed:', err);
                    setError('Failed to load initial NAV data');
                    setLoading(false); // Stop loading on error
                }
            });
    } else {
        // If store already had data, we are not loading
        setLoading(false);
    }

    // Clean up subscription on unmount
    return () => {
      isMounted = false;
      unsubscribe();
    };
  // IMPORTANT: priceStore is stable due to useMemo, so this effect runs only once on mount
  }, [priceStore]); 
  
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
    refreshNAV,
    formattedNAV,
  };
}

export default useNAV; 