/**
 * usePortfolio Hook
 * 
 * Uses the centralized price service to ensure consistent pricing data across all clients.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Position, getPriceStore } from '../services/priceService';
import priceService from '../services/priceService';
import { shouldUseMockData } from '../lib/hybridModeUtils';
import mockPortfolioPositions from '../mock-data/portfolio-positions.json';

// Extend PriceStore interface for portfolio (conceptually - this isn't modifying the actual class)
interface PriceStoreWithPortfolio extends ReturnType<typeof getPriceStore> {
  portfolioPositions?: Position[];
  subscribeToPortfolioUpdates?(callback: (positions: Position[]) => void): () => void;
}

export function usePortfolio() {
  const priceStore = useMemo(() => getPriceStore() as PriceStoreWithPortfolio, []);

  // Initialize state from potential store cache or empty array
  const [positions, setPositions] = useState<Position[]>(() => priceStore.portfolioPositions || []);
  
  // Loading/Error state tied to initial fetch and connection
  const [isConnected, setIsConnected] = useState<boolean>(priceStore.isConnected);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Start loading until initial fetch completes
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  // Fetch initial portfolio positions via HTTP
  const fetchInitialPositions = useCallback(async () => {
    // Ensure this only runs once or when needed, not continuously
    if (!isLoading) return; // Avoid refetch if not loading
    
    console.log("usePortfolio: Fetching initial positions via HTTP...");
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await priceService.getPortfolioPositions();
      setPositions(data);
      setLastUpdate(Date.now());
      // Store in our conceptual priceStore extension (won't persist unless priceService is modified)
      // priceStore.portfolioPositions = data; 
      setError(null);
    } catch (apiError) {
       console.error('usePortfolio: Error fetching initial positions:', apiError);
       if (shouldUseMockData('portfolio')) {
          console.log('Using local mock portfolio data as fallback.');
          const mockData = mockPortfolioPositions.map(pos => ({ ...pos, dailyChange: pos.change })) as Position[];
          setPositions(mockData);
          // priceStore.portfolioPositions = mockData;
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
  }, [isLoading, positions.length]); // Depend on isLoading to control execution

  // Effect for initial fetch and subscriptions
  useEffect(() => {
    let isMounted = true;

    // 1. Fetch initial data on mount
    fetchInitialPositions();

    // 2. Subscribe to WebSocket connection changes
    const handleConnectionChange = (status: boolean) => {
        if (isMounted) {
            setIsConnected(status);
            if (!status && positions.length > 0) {
                setError("Real-time connection lost. Portfolio list may be outdated.");
            } else if (status) {
                setError(null); // Clear connection error when reconnected
                // Optionally trigger a refetch if needed on reconnect
                // fetchInitialPositions(); 
            }
        }
    };
    const unsubscribeConnection = priceStore.subscribeToConnectionChange(handleConnectionChange);

    // 3. Subscribe to hypothetical portfolio updates (if priceService implements it)
    let unsubscribePortfolio: (() => void) | null = null;
    if (priceStore.subscribeToPortfolioUpdates) {
        const handlePortfolioUpdate = (updatedPositions: Position[]) => {
            if (isMounted) {
                console.log("usePortfolio: Received portfolio update via subscription.");
                setPositions(updatedPositions);
                setLastUpdate(Date.now());
                setError(null);
                setIsLoading(false); // Data arrived
            }
        };
        unsubscribePortfolio = priceStore.subscribeToPortfolioUpdates(handlePortfolioUpdate);
    }
    
    // REMOVED: setInterval polling logic
    /*
    const intervalId = setInterval(fetchPositions, 10 * 1000);
    */

    // Cleanup
    return () => {
      isMounted = false;
      unsubscribeConnection();
      if (unsubscribePortfolio) {
        unsubscribePortfolio();
      }
      // clearInterval(intervalId); // Removed interval
    };
  // Run only on mount or if fetchInitialPositions changes (which it shouldn't frequently)
  }, [priceStore, fetchInitialPositions]); 

  // Memoized calculations (no changes needed)
  const totalValue = useMemo(() => {
    return positions.reduce((sum, position) => sum + position.current, 0);
  }, [positions]);

  const overallChangePercentage = useMemo(() => {
    const totalCurrent = positions.reduce((sum, position) => sum + position.current, 0);
    const totalOriginal = positions.reduce((sum, position) => sum + position.value, 0);
    if (totalOriginal === 0) return 0;
    return ((totalCurrent - totalOriginal) / totalOriginal) * 100;
  }, [positions]);

  const getPositionByName = useCallback((name: string) => {
    return positions.find(position => position.name === name);
  }, [positions]);

  return {
    positions,
    isLoading,
    error,
    lastUpdate,
    isConnected, // Expose connection status
    totalValue,
    overallChangePercentage,
    getTotalValue: useCallback(() => totalValue, [totalValue]),
    getOverallChangePercentage: useCallback(() => overallChangePercentage, [overallChangePercentage]),
    getPositionByName,
    // refreshPortfolio: fetchInitialPositions // Rename refresh to reflect it's an initial/manual fetch now
     // Expose a manual refresh if desired, but it uses HTTP
    refreshPortfolio: useCallback(() => { 
        // Allow manual refresh even if not loading initially
        console.log("Manual portfolio refresh triggered...");
        setIsLoading(true); // Set loading true for manual refresh
        fetchInitialPositions(); 
    }, [fetchInitialPositions])
  };
} 