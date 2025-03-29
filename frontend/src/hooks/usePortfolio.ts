/**
 * usePortfolio Hook
 * 
 * Uses the centralized price service to ensure consistent pricing data across all clients.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Position } from '../services/priceService';
import priceService from '../services/priceService';
import { shouldUseMockData } from '../lib/hybridModeUtils';
import mockPortfolioPositions from '../mock-data/portfolio-positions.json';

export function usePortfolio() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  // Fetch portfolio positions from the API
  const fetchPositions = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Check if we should use mock data based on hybrid mode settings
      if (shouldUseMockData('portfolio')) {
        // If in mock mode, use the mock portfolio but add the dailyChange field
        const mockData = mockPortfolioPositions.map(pos => ({
          ...pos,
          dailyChange: pos.change // Use existing change value for daily change in mock data
        })) as Position[];
        
        setPositions(mockData);
        setLastUpdate(Date.now());
        setIsLoading(false);
        return;
      }
      
      // Fetch positions from the centralized price service
      const data = await priceService.getPortfolioPositions();
      setPositions(data);
      setLastUpdate(Date.now());
      setError(null);
    } catch (error) {
      console.error('Error fetching portfolio positions:', error);
      setError('Failed to fetch portfolio data. Using fallback data.');
      
      // Use mock data as fallback but add the dailyChange field
      const mockData = mockPortfolioPositions.map(pos => ({
        ...pos,
        dailyChange: pos.change // Use existing change value for daily change in mock data
      })) as Position[];
      
      setPositions(mockData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchPositions();
    
    // Set up periodic refresh (every 10 seconds instead of 5 minutes)
    // This will keep data updated but not so frequently that it causes performance issues
    const intervalId = setInterval(fetchPositions, 10 * 1000);
    
    // Cleanup function to prevent memory leaks
    return () => {
      console.log('usePortfolio hook unmounting - cleaning up interval');
      clearInterval(intervalId);
    };
  }, [fetchPositions]);

  // Calculate total value of all positions - memoize to prevent recalculations
  const totalValue = useMemo(() => {
    return positions.reduce((sum, position) => sum + position.current, 0);
  }, [positions]);

  // Calculate overall change percentage - also memoize
  const overallChangePercentage = useMemo(() => {
    const totalCurrent = positions.reduce((sum, position) => sum + position.current, 0);
    const totalOriginal = positions.reduce((sum, position) => sum + position.value, 0);
    
    if (totalOriginal === 0) return 0;
    
    return ((totalCurrent - totalOriginal) / totalOriginal) * 100;
  }, [positions]);

  // Get position by name
  const getPositionByName = useCallback((name: string) => {
    return positions.find(position => position.name === name);
  }, [positions]);

  return {
    positions,
    isLoading,
    error,
    lastUpdate,
    totalValue,
    overallChangePercentage,
    // Keep these methods for backward compatibility
    getTotalValue: useCallback(() => totalValue, [totalValue]),
    getOverallChangePercentage: useCallback(() => overallChangePercentage, [overallChangePercentage]),
    getPositionByName,
    refreshPortfolio: fetchPositions
  };
} 