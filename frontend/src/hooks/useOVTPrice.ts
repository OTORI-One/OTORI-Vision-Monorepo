/**
 * useOVTPrice Hook
 * 
 * This hook fetches OVT price data from the centralized price service,
 * ensuring consistent pricing across all clients.
 */

import { useState, useEffect, useCallback } from 'react';
import priceService, { OVTPrice } from '../services/priceService';

export function useOVTPrice() {
  const [ovtPrice, setOvtPrice] = useState<OVTPrice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Function to fetch price data
  const fetchOVTPrice = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Fetch from the API
      const data = await priceService.getOVTPrice();
      
      // Only log price changes that are significant (more than 0.01%)
      if (!ovtPrice || Math.abs(data.price - ovtPrice.price) > 0.0001 * ovtPrice.price) {
        console.log('OVT Price refreshed:', { 
          price: data.price,
          dailyChange: data.dailyChange,
          timestamp: new Date().toISOString() 
        });
      }
      
      setOvtPrice(data);
      priceService.cacheOVTPrice(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching OVT price:', err);
      setError('Failed to fetch OVT price data');
      
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

    // Set up periodic refresh (every 5 seconds to reduce flashing and resource usage)
    const intervalId = setInterval(fetchOVTPrice, 5000);

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