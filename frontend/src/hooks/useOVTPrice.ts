/**
 * useOVTPrice Hook
 * 
 * This hook fetches OVT price data from the centralized price service,
 * ensuring consistent pricing across all clients.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import priceService, { OVTPrice } from '../services/priceService';

export function useOVTPrice() {
  // Create a stable, consistent initial state for SSR
  const initialPrice = useMemo(() => ({
    price: 550000, // Fixed value for SSR
    btcPriceSats: 550000,
    btcPriceFormatted: '550,000 sats',
    usdPrice: 3.30,
    usdPriceFormatted: '$3.30',
    dailyChange: 0, // Always start with 0 for SSR
    lastUpdate: Date.now(),
    circulatingSupply: 1000000,
    timestamp: Date.now()
  }), []);

  const [ovtPrice, setOvtPrice] = useState<OVTPrice | null>(initialPrice);
  const [isLoading, setIsLoading] = useState(false); // Start with not loading for SSR
  const [error, setError] = useState<string | null>(null);
  
  // We'll use the price store for synchronized data
  const priceStore = priceService.getPriceStore();
  
  // Function to force refresh (can be called by components)
  const refreshPrice = useCallback(async () => {
    // Exit early in SSR context
    if (typeof window === 'undefined') return false;
    
    try {
      // Show loading state
      setIsLoading(true);
      
      // Trigger an update with optimized request handling
      await priceService.triggerOVTPriceUpdate();
      
      // Then fetch the updated price through the store with force=true to bypass cache
      const freshData = await priceStore.fetchOVTPrice(true); // Force refresh
      
      // Save valid data for 24h change
      if (typeof freshData.dailyChange === 'number' && isFinite(freshData.dailyChange)) {
        try {
          // Store the valid change percentage to localStorage for resilience
          localStorage.setItem('ovt-daily-change', String(freshData.dailyChange));
          localStorage.setItem('ovt-daily-change-timestamp', String(Date.now()));
        } catch (err) {
          console.error('Error saving OVT daily change to localStorage:', err);
        }
      }
      
      setIsLoading(false);
      return true;
    } catch (err) {
      console.error('Error manually refreshing OVT price:', err);
      setIsLoading(false);
      return false;
    }
  }, [priceStore]);

  // Set up subscription to the price store - only in client side
  useEffect(() => {
    // Skip in SSR context
    if (typeof window === 'undefined') return;
    
    // Initially check if store already has data
    if (priceStore.ovtPrice) {
      setOvtPrice(priceStore.ovtPrice);
    }
    
    // Set up listener for updates from the store
    const unsubscribe = priceStore.subscribeToOvtUpdates((data) => {
      // Save valid data for 24h change
      if (typeof data.dailyChange === 'number' && isFinite(data.dailyChange)) {
        try {
          // Store the valid change percentage to localStorage for resilience
          localStorage.setItem('ovt-daily-change', String(data.dailyChange));
          localStorage.setItem('ovt-daily-change-timestamp', String(Date.now()));
        } catch (err) {
          console.error('Error saving OVT daily change to localStorage:', err);
        }
      }
      
      setOvtPrice(data);
      setError(null);
    });
    
    // Always fetch fresh data on mount, regardless of cache state
    // This ensures we have the latest data when the component mounts
    setIsLoading(true);
    priceStore.fetchOVTPrice(false) // Use cached data first for faster initial render
      .catch(err => {
        console.error('Error in initial OVT price fetch:', err);
        setError('Failed to fetch initial OVT price data');
      })
      .finally(() => {
        setIsLoading(false);
      });
    
    // Cleanup
    return () => {
      unsubscribe();
    };
  }, [priceStore]);

  // Get cached daily change value if available
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

  // Calculate the formatted daily change safely
  const dailyChangeFormatted = useMemo(() => {
    // Use data from API if available
    if (ovtPrice && typeof ovtPrice.dailyChange === 'number' && isFinite(ovtPrice.dailyChange)) {
      const change = ovtPrice.dailyChange;
      return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    }
    
    // Try to get from localStorage cache
    const cachedChange = getCachedDailyChange();
    if (cachedChange !== null) {
      return `${cachedChange >= 0 ? '+' : ''}${cachedChange.toFixed(2)}%`;
    }
    
    // Default to consistent value for SSR
    return '+0.00%';
  }, [ovtPrice, getCachedDailyChange]);

  // Determine if change is positive (for styling)
  const isPositiveChange = useMemo(() => {
    if (ovtPrice && typeof ovtPrice.dailyChange === 'number' && isFinite(ovtPrice.dailyChange)) {
      return ovtPrice.dailyChange >= 0;
    }
    
    // Try to get from localStorage cache
    const cachedChange = getCachedDailyChange();
    if (cachedChange !== null) {
      return cachedChange >= 0;
    }
    
    // Default to neutral/positive
    return true;
  }, [ovtPrice, getCachedDailyChange]);

  // Debug log for troubleshooting - only on client side
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (process.env.NODE_ENV !== 'production') {
      if (!ovtPrice) {
        console.debug('useOVTPrice hook: No price data available');
      } else if (typeof ovtPrice.dailyChange !== 'number' || !isFinite(ovtPrice.dailyChange)) {
        console.debug('useOVTPrice hook: Invalid dailyChange value:', ovtPrice.dailyChange);
      }
    }
  }, [ovtPrice]);

  // Return a complete object with consistent values for SSR and client
  return {
    price: (ovtPrice?.price && isFinite(ovtPrice.price)) ? ovtPrice.price : 550000,
    btcPriceSats: (ovtPrice?.btcPriceSats && isFinite(ovtPrice.btcPriceSats)) ? ovtPrice.btcPriceSats : 550000,
    btcPriceFormatted: ovtPrice?.btcPriceFormatted || '550,000 sats',
    usdPrice: (ovtPrice?.usdPrice && isFinite(ovtPrice.usdPrice)) ? ovtPrice.usdPrice : 3.30,
    usdPriceFormatted: ovtPrice?.usdPriceFormatted || '$3.30',
    dailyChange: (ovtPrice?.dailyChange && isFinite(ovtPrice.dailyChange)) 
      ? ovtPrice.dailyChange 
      : getCachedDailyChange() || 0,
    dailyChangeFormatted,
    isPositiveChange,
    lastUpdate: ovtPrice?.lastUpdate || 0,
    circulatingSupply: (ovtPrice?.circulatingSupply && isFinite(ovtPrice.circulatingSupply)) 
      ? ovtPrice.circulatingSupply 
      : 1000000,
    isLoading,
    setIsLoading, // Expose loading state setter for component control
    error,
    refreshPrice, // Expose the refresh function
    timestamp: ovtPrice?.timestamp || 0
  };
} 