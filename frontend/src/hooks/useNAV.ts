import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  calculateNAV, 
  updateNAV,
  addNAVUpdateListener,
  removeNAVUpdateListener,
  NAVResult, 
  NAV_UPDATE_EVENT 
} from '../lib/navCalculator';
import { PortfolioPosition, getPortfolioFromLocalStorage } from '../utils/priceMovement';
import { useCurrencyToggle, Currency } from './useCurrencyToggle';
import { formatValue, SATS_PER_BTC } from '@/src/lib/formatting';
import priceService from '@/src/services/priceService';

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

// Add a global cache at the module level to store NAV data across component instances
const navDataCache = {
  data: null as NAVResult | null,
  timestamp: 0,
  subscribers: new Set<(data: NAVResult) => void>()
};

// Central update function that updates all subscribers
const updateNavSubscribers = (data: NAVResult) => {
  navDataCache.data = data;
  navDataCache.timestamp = Date.now();
  
  // Notify all subscribers
  navDataCache.subscribers.forEach(callback => {
    try {
      callback(data);
    } catch (err) {
      console.error('Error in NAV subscriber callback:', err);
    }
  });
};

// Helper function to determine if cache is still fresh
const isCacheFresh = (maxAge: number = 5000): boolean => {
  return (
    navDataCache.data !== null && 
    Date.now() - navDataCache.timestamp < maxAge
  );
};

/**
 * Hook for accessing NAV data with automatic currency formatting
 */
export function useNAV(): NAVHookResult {
  const [navData, setNavData] = useState<NAVResult>(() => 
    navDataCache.data || defaultNAV
  );
  const [loading, setLoading] = useState<boolean>(!navDataCache.data);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(navDataCache.timestamp);
  
  // Get the currency context
  const { currency } = useCurrencyToggle();
  
  // Access the centralized price store for consistency
  const priceStore = useMemo(() => {
    return typeof window !== 'undefined' ? priceService.getPriceStore() : null;
  }, []);
  
  // Refresh portfolio data and recalculate NAV
  const refreshNAV = useCallback(() => {
    setLoading(true);
    
    // Use the store method which has built-in rate limiting
    priceStore?.fetchNAVData(true)
      .then(data => {
        // Map from API format to NAV format
        const navResult: NAVResult = {
          navSats: data.totalValueSats,
          navUsd: data.totalValueUSD,
          formattedNavSats: data.formattedTotalValueSats,
          formattedNavUsd: data.formattedTotalValueUSD,
          pricePerToken: data.ovtPrice,
          pricePerTokenUsd: data.btcPrice ? (data.ovtPrice / SATS_PER_BTC) * data.btcPrice : 0,
          totalTokenSupply: data.circulatingSupply || 2100000,
          changePercentage: data.changePercentage || 0
        };
        
        // Update module-level cache for all components
        updateNavSubscribers(navResult);
        
        // Update local state
        setNavData(navResult);
        setError(null);
        setLastUpdateTime(Date.now());
      })
      .catch(err => {
        console.error('Error refreshing NAV:', err);
        setError('Failed to refresh NAV data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [priceStore]);
  
  // Subscribe to global NAV updates
  useEffect(() => {
    // Skip in SSR context
    if (typeof window === 'undefined') return;
    
    // Callback when NAV data is updated
    const handleNavUpdate = (data: NAVResult) => {
      setNavData(data);
      setLoading(false);
      setError(null);
      setLastUpdateTime(Date.now());
    };
    
    // Add subscription to global updates
    navDataCache.subscribers.add(handleNavUpdate);
    
    // Initial data fetch if cache is stale or empty
    if (!isCacheFresh(10000)) {
      // Try to use price store API data first
      if (priceStore) {
        priceStore.fetchNAVData()
          .then(data => {
            // Map from API format to NAV format
            const navResult: NAVResult = {
              navSats: data.totalValueSats,
              navUsd: data.totalValueUSD,
              formattedNavSats: data.formattedTotalValueSats,
              formattedNavUsd: data.formattedTotalValueUSD,
              pricePerToken: data.ovtPrice,
              pricePerTokenUsd: data.btcPrice ? (data.ovtPrice / SATS_PER_BTC) * data.btcPrice : 0,
              totalTokenSupply: data.circulatingSupply || 2100000,
              changePercentage: data.changePercentage || 0
            };
            
            // Update module-level cache for all components
            updateNavSubscribers(navResult);
          })
          .catch(err => {
            console.warn('Could not fetch initial NAV data from API:', err);
            // Use fallback local calculation if API fails
            try {
              const portfolioPositions = getPortfolioFromLocalStorage();
              const initialNav = calculateNAV(portfolioPositions);
              
              // Update module-level cache
              updateNavSubscribers(initialNav);
            } catch (calcErr) {
              console.error('Error with fallback NAV calculation:', calcErr);
              setError('Failed to load NAV data');
            }
          });
      } else {
        // No price store available, use local calculation
        try {
          const portfolioPositions = getPortfolioFromLocalStorage();
          const initialNav = calculateNAV(portfolioPositions);
          
          // Update module-level cache
          updateNavSubscribers(initialNav);
        } catch (err) {
          console.error('Error calculating local NAV:', err);
          setError('Failed to load NAV data');
        }
      }
    }
    
    // Clean up subscription on unmount
    return () => {
      navDataCache.subscribers.delete(handleNavUpdate);
    };
  }, [priceStore]);
  
  // Get formatted NAV based on current currency - memoize to prevent unnecessary calculations
  const getFormattedNAV = useCallback((navResult: NAVResult, activeCurrency: Currency): string => {
    if (!navResult) return activeCurrency === 'usd' ? '$0.00' : '₿0.00';
    
    return activeCurrency === 'usd' 
      ? navResult.formattedNavUsd 
      : navResult.formattedNavSats;
  }, []);
  
  // Memoize formatted NAV to prevent unnecessary recalculations
  const formattedNAV = useMemo(() => {
    return getFormattedNAV(navData, currency);
  }, [getFormattedNAV, navData, currency]);
  
  return {
    nav: navData,
    loading,
    error,
    refreshNAV,
    formattedNAV
  };
}

export default useNAV; 