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
  
  // We'll use the price store for synchronized data
  const priceStore = priceService.getPriceStore();
  
  // Function to force refresh (can be called by components)
  const refreshPrice = useCallback(async () => {
    try {
      // Only trigger an update from admin components
      await priceService.triggerOVTPriceUpdate();
      
      // Then fetch the updated price through the store
      await priceStore.fetchOVTPrice(true); // Force refresh
      
      return true;
    } catch (err) {
      console.error('Error manually refreshing OVT price:', err);
      return false;
    }
  }, [priceStore]);

  // Set up subscription to the price store
  useEffect(() => {
    // Skip in SSR context
    if (typeof window === 'undefined') return;
    
    // Initially check if store already has data
    if (priceStore.ovtPrice) {
      setOvtPrice(priceStore.ovtPrice);
      setIsLoading(false);
    }
    
    // Set up listener for updates from the store
    const unsubscribe = priceStore.subscribeToOvtUpdates((data) => {
      setOvtPrice(data);
      setIsLoading(false);
      setError(null);
    });
    
    // Initially fetch if not already loading
    priceStore.fetchOVTPrice().catch(err => {
      console.error('Error in initial OVT price fetch:', err);
      setError('Failed to fetch initial OVT price data');
      setIsLoading(false);
    });
    
    // Cleanup
    return () => {
      unsubscribe();
    };
  }, [priceStore]);

  // Calculate the formatted daily change safely
  const dailyChangeFormatted = (() => {
    if (!ovtPrice || typeof ovtPrice.dailyChange !== 'number' || !isFinite(ovtPrice.dailyChange)) {
      return '0.00%';
    }
    const change = ovtPrice.dailyChange;
    return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  })();

  // Return a complete object even if data is missing
  return {
    price: (ovtPrice?.price && isFinite(ovtPrice.price)) ? ovtPrice.price : 0,
    btcPriceSats: (ovtPrice?.btcPriceSats && isFinite(ovtPrice.btcPriceSats)) ? ovtPrice.btcPriceSats : 0,
    btcPriceFormatted: ovtPrice?.btcPriceFormatted || '0 sats',
    usdPrice: (ovtPrice?.usdPrice && isFinite(ovtPrice.usdPrice)) ? ovtPrice.usdPrice : 0,
    usdPriceFormatted: ovtPrice?.usdPriceFormatted || '$0.00',
    dailyChange: (ovtPrice?.dailyChange && isFinite(ovtPrice.dailyChange)) ? ovtPrice.dailyChange : 0,
    dailyChangeFormatted,
    isPositiveChange: (ovtPrice?.dailyChange && isFinite(ovtPrice.dailyChange)) 
      ? ovtPrice.dailyChange >= 0 
      : true,
    lastUpdate: ovtPrice?.lastUpdate || 0,
    circulatingSupply: (ovtPrice?.circulatingSupply && isFinite(ovtPrice.circulatingSupply)) 
      ? ovtPrice.circulatingSupply 
      : 1000000,
    isLoading,
    error,
    refreshPrice // Expose the refresh function
  };
} 