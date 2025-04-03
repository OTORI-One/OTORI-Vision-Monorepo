/**
 * usePortfolio Hook
 * 
 * Subscribes to the centralized price service (priceStore) for real-time portfolio updates via WebSocket.
 * Fetches initial data via HTTP on mount or manual refresh.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Position, getPriceStore } from '../services/priceService';
import { shouldUseMockData } from '../lib/hybridModeUtils';
import mockPortfolioPositions from '../mock-data/portfolio-positions.json';
// Type assertion for priceStore to include portfolio specific methods/properties
type PriceStoreWithPortfolio = {
    portfolioPositions?: Position[]; // Cache for initial state
    subscribeToPortfolioUpdates: (callback: (positions: Position[]) => void) => () => void;
    getPortfolioPositions: () => Promise<Position[]>;
    isConnected: boolean;
    subscribeToConnectionChange: (callback: (status: boolean) => void) => () => void;
};
export function usePortfolio() {
  const priceStore = useMemo(() => {
    const store = getPriceStore();
    if (!('subscribeToPortfolioUpdates' in store) || !('getPortfolioPositions' in store)) {
      throw new Error('PriceStore is missing required portfolio methods');
    }
    return store as PriceStoreWithPortfolio;
  }, []);

  // Initialize state from potential store cache or empty array
  const [positions, setPositions] = useState<Position[]>(() => priceStore.portfolioPositions || []);

  // Loading/Error state tied to initial fetch and connection
  const [isConnected, setIsConnected] = useState<boolean>(() => priceStore.isConnected); // Initialize from store
  const [isLoading, setIsLoading] = useState<boolean>(!priceStore.portfolioPositions); // Only load initially if no cache
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  // Fetch initial portfolio positions via HTTP
  const fetchInitialPositions = useCallback(async () => { 
    // Run if loading flag is set (e.g., on mount without cache or manual refresh)
    if (!isLoading) return;
    
    console.log("usePortfolio: Fetching initial positions via HTTP...");
    setError(null);
    
    try {
      // Use the method from the priceStore instance
      const data = await priceStore.getPortfolioPositions(); 
      setPositions(data);
      setLastUpdate(Date.now());
      setError(null);
    } catch (apiError) {
       console.error('usePortfolio: Error fetching initial positions:', apiError);
       if (shouldUseMockData('portfolio')) {
          console.log('Using local mock portfolio data as fallback.');
          const mockData = mockPortfolioPositions.map(pos => ({ ...pos, dailyChange: pos.change })) as Position[];
          setPositions(mockData);
          setError(null); // Don't show error in mock mode
       } else {
           setError('Failed to load portfolio data. Displaying empty list or cached data if available.');
           // Keep potentially stale data if already present
           if (positions.length === 0) setPositions([]); 
       }
    } finally {
      // Only set loading false after the attempt, regardless of success/fail
      setIsLoading(false);
    }
  }, [isLoading, priceStore, positions.length]);

  // Effect for initial fetch and subscriptions
  useEffect(() => {
    let isMounted = true;

    // 1. Fetch initial data on mount if needed (isLoading is true)
    fetchInitialPositions();

    // 2. Subscribe to WebSocket connection changes
    const handleConnectionChange = (status: boolean) => {
        if (isMounted) {
            setIsConnected(status);
            if (!status && positions.length > 0) {
                // Only set error if disconnected AND we have data (which might become stale)
                setError("Real-time connection lost. Portfolio data may be outdated.");
            } else if (status) {
                setError(null); // Clear connection error when reconnected
                // Optionally trigger a refetch if needed on reconnect and data seems stale
                // Consider checking lastUpdate time
                 console.log("Reconnected, checking if portfolio refresh needed...");
            }
        }
    };
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);

    // 3. Subscribe to WebSocket portfolio updates
    const handlePortfolioUpdate = (updatedPositions: Position[]) => {
        if (isMounted) {
            console.log("usePortfolio: Received portfolio update via WebSocket subscription.");
            setPositions(updatedPositions);
            setLastUpdate(Date.now());
            setError(null); // Clear any previous errors (like connection lost)
            setIsLoading(false); // Data arrived, no longer loading
        }
    };
    const unsubscribePortfolio = priceStore.subscribeToPortfolioUpdates(handlePortfolioUpdate);
    
    // Cleanup
    return () => {
      isMounted = false;
      unsubscribeConnection();
      unsubscribePortfolio(); // Unsubscribe from portfolio updates
    };
  }, [priceStore, positions.length]);

  // Correct Memoized calculations
  const totalValue = useMemo(() => {
    return positions.reduce((sum, position) => sum + position.current, 0);
  }, [positions]);

  const overallChangePercentage = useMemo(() => {
    const totalCurrent = positions.reduce((sum, position) => sum + position.current, 0);
    const totalOriginal = positions.reduce((sum, position) => sum + position.value, 0);
    if (totalOriginal === 0) return 0;
    return ((totalCurrent - totalOriginal) / totalOriginal) * 100;
  }, [positions]);

  const getPositionByName = useCallback((name: string): Position | undefined => { // Added return type
    return positions.find(position => position.name === name);
  }, [positions]);

  // Expose manual refresh function (uses HTTP)
  const refreshPortfolio = useCallback(() => {
    console.log("Manual portfolio refresh triggered...");
    if (!isLoading) {
      setIsLoading(true);
    }
    // Directly call fetchInitialPositions - it already depends on isLoading
    // Note: fetchInitialPositions won't run if isLoading is already true unless dependency changes trigger it.
    // A state change might be needed to force it if called rapidly while still loading.
    fetchInitialPositions(); 
  }, [fetchInitialPositions, isLoading]);

  // + Corrected return object structure
  return {
    positions,
    isLoading,
    error,
    lastUpdate,
    isConnected, // Expose connection status
    totalValue,
    overallChangePercentage,
    getTotalValue: useCallback(() => totalValue, [totalValue]), // Keep existing utils
    getOverallChangePercentage: useCallback(() => overallChangePercentage, [overallChangePercentage]),
    getPositionByName, // Return the function itself
    refreshPortfolio // Return the manual refresh function
  };
} 