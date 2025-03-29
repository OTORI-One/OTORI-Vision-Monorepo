/**
 * useOVTPrice Hook
 * 
 * This hook fetches OVT price data from the centralized price service,
 * ensuring consistent pricing across all clients.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import priceService, { OVTPrice } from '../services/priceService';

// Debounce helper to reduce network calls
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

export function useOVTPrice() {
  const [ovtPrice, setOvtPrice] = useState<OVTPrice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track last successful refresh time to avoid hammering the API
  const lastSuccessfulRefreshRef = useRef<number>(Date.now());
  // Track consecutive error count for backoff
  const errorCountRef = useRef<number>(0);
  
  // Function to fetch price data
  const fetchOVTPrice = useCallback(async () => {
    // Implement exponential backoff for consecutive errors
    const timeNow = Date.now();
    const timeSinceLastSuccess = timeNow - lastSuccessfulRefreshRef.current;
    
    // Gradually increase wait time based on error count (min: 15s, max: 60s)
    const baseWaitTime = 15000; // 15 seconds base
    const maxWaitTime = 60000;  // 60 seconds max
    const waitMultiplier = Math.min(Math.pow(1.5, errorCountRef.current), 4); // Exponential up to 4x
    const minWaitTime = Math.min(baseWaitTime * waitMultiplier, maxWaitTime);
    
    // Skip refresh if we've refreshed too recently or if backing off due to errors
    if (timeSinceLastSuccess < minWaitTime) {
      return;
    }
    
    try {
      setIsLoading(true);
      
      // Fetch from the API
      const data = await priceService.getOVTPrice();
      
      // Only log price changes that are significant (more than 0.5%)
      if (!ovtPrice || Math.abs(data.price - ovtPrice.price) > 0.005 * ovtPrice.price) {
        console.log('OVT Price refreshed:', { 
          price: data.price,
          dailyChange: data.dailyChange,
          timestamp: new Date().toISOString() 
        });
      }
      
      setOvtPrice(data);
      priceService.cacheOVTPrice(data);
      setError(null);
      
      // Reset error counter and update last success time
      lastSuccessfulRefreshRef.current = Date.now();
      errorCountRef.current = 0;
    } catch (err) {
      console.error('Error fetching OVT price:', err);
      setError('Failed to fetch OVT price data');
      errorCountRef.current++; // Increment error counter for backoff
      
      // If we have cached data, continue using it
      const cachedData = priceService.getCachedOVTPrice();
      if (!ovtPrice && cachedData) {
        setOvtPrice(cachedData);
      }
    } finally {
      setIsLoading(false);
    }
  }, [ovtPrice]);

  // Function to force refresh (can be called by components)
  const refreshPrice = useCallback(async () => {
    try {
      // First trigger an update on the server
      await priceService.triggerOVTPriceUpdate();
      
      // Then fetch the updated price
      await fetchOVTPrice();
      
      return true;
    } catch (err) {
      console.error('Error refreshing OVT price:', err);
      return false;
    }
  }, [fetchOVTPrice]);

  useEffect(() => {
    // First check if we have a recent cached value
    const cachedData = priceService.getCachedOVTPrice();
    if (cachedData) {
      setOvtPrice(cachedData);
      setIsLoading(false);
    }

    // Fetch immediately
    fetchOVTPrice();

    // Set up periodic refresh (every 15 seconds to reduce API load)
    const intervalId = setInterval(fetchOVTPrice, 15000);

    return () => clearInterval(intervalId);
  }, [fetchOVTPrice]);

  // Calculate the formatted daily change safely
  const dailyChangeFormatted = (() => {
    if (!ovtPrice || typeof ovtPrice.dailyChange !== 'number') return '0.00%';
    const change = ovtPrice.dailyChange;
    return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  })();

  return {
    price: ovtPrice?.price || 0,
    btcPriceSats: ovtPrice?.btcPriceSats || 0,
    btcPriceFormatted: ovtPrice?.btcPriceFormatted || '0 sats',
    usdPrice: ovtPrice?.usdPrice || 0,
    usdPriceFormatted: ovtPrice?.usdPriceFormatted || '$0.00',
    dailyChange: ovtPrice?.dailyChange || 0,
    dailyChangeFormatted,
    isPositiveChange: (ovtPrice?.dailyChange || 0) >= 0,
    lastUpdate: ovtPrice?.lastUpdate || 0,
    circulatingSupply: ovtPrice?.circulatingSupply || 1000000,
    isLoading,
    error,
    refreshPrice // Expose the refresh function
  };
} 