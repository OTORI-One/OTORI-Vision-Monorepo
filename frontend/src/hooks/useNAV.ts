import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { formatValue } from '@/src/lib/formatting';

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

// Add debounce helper at the top of the file
const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
): ((...args: Parameters<F>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<F>): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };
};

/**
 * Hook for accessing NAV data with automatic currency formatting
 */
export function useNAV(): NAVHookResult {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [navData, setNavData] = useState<NAVResult>(defaultNAV);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  
  // Get the currency context
  const { currency } = useCurrencyToggle();
  
  // Prevent excessive refreshes
  const updateThrottleRef = useRef<boolean>(false);
  const calculateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Debounced version of setNavData to prevent too frequent updates
  const debouncedSetNavData = useCallback(
    debounce((data: NAVResult) => {
      setNavData(data);
      updateThrottleRef.current = false;
      setLastUpdated(Date.now());
    }, 300),
    []
  );
  
  // Refresh portfolio data and recalculate NAV
  const refreshNAV = useCallback(() => {
    // Don't allow refreshes more often than once every 5 seconds
    if (updateThrottleRef.current) {
      return;
    }
    
    updateThrottleRef.current = true;
    setLoading(true);
    
    // Clear any existing calculation timeout
    if (calculateTimeoutRef.current !== null) {
      clearTimeout(calculateTimeoutRef.current);
    }
    
    // Delay the calculation slightly to batch multiple rapid calls
    calculateTimeoutRef.current = setTimeout(() => {
      try {
        // Reload portfolio positions
        const updatedPositions = getPortfolioFromLocalStorage();
        setPositions(updatedPositions);
        
        // Update NAV with fresh data
        const updatedNav = updateNAV(updatedPositions);
        
        // Use the debounced setter to prevent UI thrashing
        debouncedSetNavData(updatedNav);
        setError(null); // Clear any previous errors
        setLoading(false);
        
        // Only reset the throttle after 5 seconds (reduced update frequency)
        setTimeout(() => {
          updateThrottleRef.current = false;
        }, 5000);
      } catch (err) {
        console.error('Error refreshing NAV data:', err);
        setError('Failed to refresh NAV data');
        setLoading(false);
        updateThrottleRef.current = false;
      }
    }, 50);
  }, [debouncedSetNavData]);
  
  // Initialize NAV data
  useEffect(() => {
    let isMounted = true;
    
    const initializeNAV = async () => {
      try {
        // Load portfolio positions
        const portfolioPositions = getPortfolioFromLocalStorage();
        
        // Only update state if component is still mounted
        if (isMounted) {
          setPositions(portfolioPositions);
          
          // Calculate initial NAV
          const initialNav = calculateNAV(portfolioPositions);
          setNavData(initialNav);
          setLoading(false);
          setLastUpdated(Date.now());
        }
      } catch (err) {
        console.error('Error initializing NAV data:', err);
        if (isMounted) {
          setError('Failed to initialize NAV data');
          setLoading(false);
        }
      }
    };
    
    initializeNAV();
    
    // No internal timer - we'll rely on external triggers only
    // This reduces the number of timers and avoids memory issues
    
    // Cleanup function
    return () => {
      isMounted = false;
      if (calculateTimeoutRef.current !== null) {
        clearTimeout(calculateTimeoutRef.current);
      }
    };
  }, []);
  
  // Listen for NAV updates
  useEffect(() => {
    let isMounted = true;
    
    // Create a debounced handler for update events
    const handleNavUpdate = debounce((updatedNav: NAVResult) => {
      if (isMounted && !updateThrottleRef.current) {
        setNavData(updatedNav);
        setLastUpdated(Date.now());
      }
    }, 300);
    
    // Subscribe to NAV updates with a debounce to prevent too many refreshes
    addNAVUpdateListener(handleNavUpdate);
    
    // Also listen for direct nav-update events for backward compatibility
    const handleLegacyNavUpdate = (event: CustomEvent) => {
      if (isMounted && event.detail && event.detail.nav) {
        // Only refresh if it's been at least 5 seconds since the last update
        const now = Date.now();
        if (now - lastUpdated > 5000) {
          refreshNAV();
        }
      }
    };
    
    window.addEventListener('nav-update', handleLegacyNavUpdate as EventListener);
    
    // Cleanup all listeners on unmount to prevent memory leaks
    return () => {
      isMounted = false;
      removeNAVUpdateListener(handleNavUpdate);
      window.removeEventListener('nav-update', handleLegacyNavUpdate as EventListener);
    };
  }, [refreshNAV, lastUpdated]);
  
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