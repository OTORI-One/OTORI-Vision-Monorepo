/**
 * LEGACY HOOK - Maintained for backward compatibility
 * 
 * This hook is being maintained while we transition to the more focused, specialized hooks:
 * 
 * 1. useNAV - Handles all NAV-related functionality
 * 2. useCurrencyToggle - Handles currency formatting and toggling
 * 3. usePortfolio - Manages portfolio data operations
 * 
 * The refactoring approach is to:
 * 1. Keep this legacy hook working to avoid breaking existing components
 * 2. Gradually update components to use the new specialized hooks
 * 3. Once all components are migrated, this hook can be deprecated
 * 
 * This follows the Strangler Fig Pattern - building new functionality around legacy code
 * and gradually replacing it while maintaining continuous operation.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ArchClient } from '../lib/archClient';
import { RuneClient, OVT_RUNE_ID, OVT_FALLBACK_DISTRIBUTED } from '../lib/runeClient';
import { useBitcoinPrice } from '../hooks/useBitcoinPrice';
import { useLaserEyes } from '@omnisat/lasereyes';
import { 
  shouldUseMockData, 
  getDataSourceIndicator,
  mergePortfolioData,
  getTokenSupplyData,
  getHybridModeConfig
} from '../lib/hybridModeUtils';
import { ensurePortfolioDataLoaded } from '../utils/portfolioLoader';
import { SATS_PER_BTC, formatValue as formatValueUtils } from '../lib/formatting';
import { 
  simulatePortfolioPriceMovements, 
  PortfolioPosition,
  getGlobalNAVReference
} from '../utils/priceMovement';
import priceService from '../services/priceService';

// Constants for numeric handling
export { SATS_PER_BTC };

// Import mock portfolio data
import mockPortfolioData from '../mock-data/portfolio-positions.json';

// Make Portfolio compatible with PortfolioPosition to support price movement simulation
export interface Portfolio extends PortfolioPosition {
  // Ensure description is required for Portfolio
  description: string;
}

export interface TokenDistribution {
  totalSupply: number;     // Total token supply
  distributed: number;     // Number of tokens distributed
  runeId: string;         // OVT rune identifier
  runeSymbol: string;     // OVT symbol (e.g., 'OVT')
  distributionEvents: {
    timestamp: number;
    amount: number;
    recipient: string;
    txid: string;
    runeTransactionId?: string;  // Rune-specific transaction ID
  }[];
}

interface NAVData {
  totalValue: string;         // Formatted string for display
  totalValueSats: number;     // Raw value in sats
  changePercentage: string;
  portfolioItems: Portfolio[];
  tokenDistribution: TokenDistribution;
}

// Initialize clients
const runeClient = new RuneClient({
  baseUrl: process.env.NEXT_PUBLIC_RUNES_API_ENDPOINT || 'http://localhost:3030',
  mockData: process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true'
});
const archClient = new ArchClient({
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID || '',
  treasuryAddress: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
  endpoint: process.env.NEXT_PUBLIC_ARCH_ENDPOINT || 'http://localhost:8000'
});

// Helper function to format values consistently
const formatValue = (value: number, displayMode: 'btc' | 'usd' = 'btc', btcPrice?: number | null): string => {
  // Wrap the entire function in a try-catch to ensure it never throws
  try {
    // Early validation to prevent infinity issues - before ANY calculations
    if (value === null || value === undefined || !Number.isFinite(value)) {
      // Use a fixed default value instead of propagating Infinity
      console.error('formatValue received non-finite value - using default value', new Error().stack);
      return displayMode === 'usd' ? '$0.00' : '0 sats';
    }

    // Don't do any calculations here - just use the centralized formatting utility
    return formatValueUtils(value, displayMode, btcPrice);
  } catch (error) {
    console.error('Fatal error in formatValue:', error);
    return displayMode === 'usd' ? '$0.00' : '0 sats';
  }
};

// Add a specialized currency formatter that follows the frontend-specific-dev-rules
const formatCurrencyValueLocal = (value: number, currency: 'btc' | 'usd' = 'usd'): string => {
  // Delegate to the centralized formatting utility
  return formatValueUtils(value, currency);
};

// Add global store for currency and price to maintain consistency across page navigations
let globalBaseCurrency: 'btc' | 'usd' = 'usd';
let globalOVTPrice: number = getGlobalNAVReference();

// Function to update the global OVT price
export const updateGlobalOVTPrice = (price: number): void => {
  if (Number.isFinite(price) && price > 0) {
    globalOVTPrice = price;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('ovt-global-price', price.toString());
      } catch (e) {
        console.error('Failed to save OVT price to localStorage:', e);
      }
    }
  }
};

// Function to get the global OVT price
export const getGlobalOVTPrice = (): number => {
  if (typeof window !== 'undefined') {
    try {
      const savedPrice = localStorage.getItem('ovt-global-price');
      if (savedPrice) {
        const parsedPrice = parseFloat(savedPrice);
        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          globalOVTPrice = parsedPrice;
        }
      }
    } catch (e) {
      console.error('Failed to load OVT price from localStorage:', e);
    }
  }
  return globalOVTPrice;
};

export function useOVTClient() {
  // State hooks - initialize properly to prevent React queue errors
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [baseCurrency, setBaseCurrency] = useState<'btc' | 'usd'>('btc');
  
  // Access the central price store
  const priceStore = useMemo(() => {
    if (typeof window !== 'undefined') {
      return priceService.getPriceStore();
    }
    return null;
  }, []);
  
  // Add a fallback for Bitcoin price in case useBitcoinPrice returns undefined during testing
  const bitcoinPriceHook = useBitcoinPrice() || { price: 50000, isLoading: false, error: null };
  
  // Memoize the bitcoin price and only update it when it changes by more than 1%
  // This prevents small fluctuations from causing re-renders
  const { price: rawBtcPrice } = bitcoinPriceHook;
  const btcPrice = useMemo(() => {
    // Safety check for null/undefined/NaN/Infinity
    if (typeof rawBtcPrice !== 'number' || !Number.isFinite(rawBtcPrice)) {
      return 50000; // Safe default
    }
    
    // Round to the nearest 100 to reduce fluctuations
    return Math.round(rawBtcPrice / 100) * 100;
  }, [rawBtcPrice]);
  
  const { address } = useLaserEyes();
  const [portfolioPositions, setPortfolioPositions] = useState<Portfolio[]>([]);
  const [lastPriceUpdateTime, setLastPriceUpdateTime] = useState<number>(Date.now());
  
  // Get the global OVT price without triggering renders
  const initialOVTPrice = useMemo(() => getGlobalOVTPrice(), []);
  
  // Add centralized OVT price state
  const [ovtPrice, setOvtPrice] = useState<number>(initialOVTPrice);
  
  // Formatted OVT price for consistent display
  const formattedOvtPrice = useMemo(() => {
    try {
      // Check if ovtPrice is valid
      if (!Number.isFinite(ovtPrice) || ovtPrice <= 0) {
        // Default reasonable value
        const defaultPrice = getGlobalNAVReference();
        
        // If the default is also invalid, use a hard-coded fallback
        if (!Number.isFinite(defaultPrice) || defaultPrice <= 0) {
          return baseCurrency === 'usd' ? '$0.00' : '0 sats';
        }
        
        return formatValue(defaultPrice, baseCurrency, btcPrice);
      }
      
      // Check for valid BTC price for USD conversion
      if (baseCurrency === 'usd') {
        if (!Number.isFinite(btcPrice) || btcPrice <= 0) {
          // If BTC price is invalid, fall back to BTC display
          return formatValue(ovtPrice, 'btc');
        }
      }
      
      // Now it's safe to format with validated values
      return formatValue(ovtPrice, baseCurrency, btcPrice);
    } catch (error) {
      console.error('Error formatting OVT price (returning safe default):', error);
      return baseCurrency === 'usd' ? '$0.00' : '0 sats';
    }
  }, [ovtPrice, baseCurrency, btcPrice]);

  const [navData, setNavData] = useState<NAVData>({
    totalValue: formatValue(getGlobalNAVReference(), 'usd'),
    totalValueSats: getGlobalNAVReference(),
    changePercentage: '0%',
    portfolioItems: [],
    tokenDistribution: {
      totalSupply: 2100000,
      distributed: 2100000,
      runeId: OVT_RUNE_ID,
      runeSymbol: 'OVT',
      distributionEvents: []
    }
  });

  // Initialize currency from localStorage after mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('ovt-currency-preference');
        const currency = saved === 'btc' ? 'btc' : 'usd';
        globalBaseCurrency = currency;
        setBaseCurrency(currency);
        
        // Initialize price from localStorage
        const savedPrice = localStorage.getItem('ovt-global-price');
        if (savedPrice) {
          const parsedPrice = parseFloat(savedPrice);
          if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
            setOvtPrice(parsedPrice);
          }
        }
      } catch (e) {
        console.error('Error loading from localStorage:', e);
      }
    }
  }, []);

  // Initialize portfolio positions with mock data
  useEffect(() => {
    try {
      console.log('Initializing portfolio positions with mock data');
      
      // Check if mockPortfolioData is valid
      if (!Array.isArray(mockPortfolioData) || mockPortfolioData.length === 0) {
        console.error('Mock portfolio data is invalid:', mockPortfolioData);
        // Create some fallback data to prevent errors
        const fallbackPositions = [
          {
            name: "Polymorphic Labs",
            value: 150000000,
            current: 150000000,
            change: 0,
            description: "Encryption Layer",
            tokenAmount: 500000,
            pricePerToken: 300,
            address: "mock-address-polymorphic-labs"
          }
        ];
        setPortfolioPositions(fallbackPositions as Portfolio[]);
        return;
      }
      
      // Map positions with address field
      const positions = mockPortfolioData.map(position => ({
        ...position,
        address: `mock-address-${position.name.replace(/\s+/g, '-').toLowerCase()}`
      })) as Portfolio[];
      
      // Ensure all positions have valid values
      const validatedPositions = positions.map(pos => ({
        ...pos,
        value: pos.value > 0 ? pos.value : 10000000, // Fallback to 10M sats (0.1 BTC)
        current: pos.current > 0 ? pos.current : pos.value > 0 ? pos.value : 10000000,
        tokenAmount: pos.tokenAmount > 0 ? pos.tokenAmount : 100000,
        pricePerToken: pos.pricePerToken > 0 ? pos.pricePerToken : 100
      }));
      
      // Apply initial price movement to create realistic growth
      const simulatedPositions = simulatePortfolioPriceMovements(validatedPositions);
      
      // Ensure required description field is set for all positions
      const finalPositions = simulatedPositions.map(pos => ({
        ...pos,
        description: pos.description || getProjectDescription(pos.name)
      })) as Portfolio[];
      
      console.log('Setting initial portfolio positions:', finalPositions.length);
      setPortfolioPositions(finalPositions);
      
    } catch (error) {
      console.error('Error initializing portfolio positions:', error);
      // Create some fallback data to prevent errors
      const fallbackPositions = [
        {
          name: "Fallback Position",
          value: 100000000,
          current: 100000000,
          change: 0,
          description: "Fallback position for error recovery",
          tokenAmount: 100000,
          pricePerToken: 1000,
          address: "mock-address-fallback"
        }
      ];
      setPortfolioPositions(fallbackPositions as Portfolio[]);
    }
  }, []);

  // Simulate price movements for mock data
  useEffect(() => {
    if (!shouldUseMockData('portfolio')) {
      return; // Only simulate prices for mock data
    }
    
    // Listen for portfolio updates from usePortfolioPrices hook
    const handlePortfolioUpdate = (e: CustomEvent) => {
      if (e.detail && e.detail.positions) {
        setPortfolioPositions(e.detail.positions);
        setLastPriceUpdateTime(Date.now());
      }
    };
    
    // Add listener for portfolio updates
    window.addEventListener('portfolio-updated', handlePortfolioUpdate as EventListener);
    
    // Set up interval for regular price updates - longer interval for better performance
    const interval = setInterval(() => {
      setPortfolioPositions(prevPositions => {
        // Apply price movements
        const updatedPositions = simulatePortfolioPriceMovements(prevPositions);
        
        // Ensure required description field is set for all positions
        const validPositions = updatedPositions.map(pos => ({
          ...pos,
          description: pos.description || getProjectDescription(pos.name)
        })) as Portfolio[];
        
        setLastPriceUpdateTime(Date.now());
        return validPositions;
      });
    }, 45000 + Math.random() * 30000); // Longer interval (45-75 seconds) for better performance
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('portfolio-updated', handlePortfolioUpdate as EventListener);
    };
  }, []);

  // Currency change handler
  const handleCurrencyChange = useCallback((currency: 'btc' | 'usd') => {
    // Update global currency
    globalBaseCurrency = currency;
    setBaseCurrency(currency);
    
    try {
      localStorage.setItem('ovt-currency-preference', currency);
    } catch (e) {
      console.error('Failed to save currency preference:', e);
    }
    
    // Instead of calling fetchNAV, just update the display currency of existing data
    setNavData(prev => ({
      ...prev,
      totalValue: formatValue(prev.totalValueSats, currency, btcPrice)
    }));
    
    // Dispatch a custom event that other components can listen for
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('currency-changed', { 
        detail: { currency } 
      }));
    }
  }, [btcPrice]);

  // Get transaction history from blockchain
  const getTransactionHistory = useCallback(async () => {
    try {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      // For now, return empty array as transaction history requires additional implementation
      console.log('Transaction history for address:', address);
      return [];
      
      // Implementation placeholder for when getTransactionInfo is added to RuneClient
      // const txInfo = await runeClient.getTransactionInfo(address);
      // return txInfo ? [txInfo] : [];
    } catch (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }
  }, [address]);

  // Fetch NAV data - memoize to prevent unnecessary re-creation
  const fetchNAV = useCallback(async (currency: 'btc' | 'usd' = 'usd') => {
    const currencyToUse = currency || baseCurrency || 'usd';
    setIsLoading(true);
    setError(null);

    try {
      // Fetch NAV data from the API
      const navData = await priceService.getNAVData();
      
      // Update local state with API data
      setNavData({
        totalValue: currencyToUse === 'usd' ? navData.formattedTotalValueUSD : navData.formattedTotalValueSats,
        totalValueSats: navData.totalValueSats,
        changePercentage: `${navData.changePercentage.toFixed(2)}%`,
        portfolioItems: [], // Will be populated later
        tokenDistribution: {
          totalSupply: 2100000,
          distributed: navData.circulatingSupply || 2100000,
          runeId: OVT_RUNE_ID,
          runeSymbol: 'OVT',
          distributionEvents: []
        }
      });
      
      // Fetch portfolio positions to populate portfolioItems
      try {
        const positions = await priceService.getPortfolioPositions();
        setPortfolioPositions(positions as Portfolio[]);
      } catch (posError) {
        console.error('Error fetching portfolio positions:', posError);
      }
      
      // Update OVT price from NAV data
      setOvtPrice(navData.ovtPrice);
      updateGlobalOVTPrice(navData.ovtPrice);
      
      setError(null);
      setLastPriceUpdateTime(Date.now());
    } catch (err) {
      console.error('Error fetching NAV data:', err);
      setError('Failed to fetch NAV data');
    } finally {
      setIsLoading(false);
    }
  }, [baseCurrency]);

  // Fetch NAV data on mount and when dependencies change
  useEffect(() => {
    if (baseCurrency) {
      // Initial fetch
      fetchNAV(baseCurrency);
      
      // Set up automatic updates
      const intervalId = setInterval(() => fetchNAV(baseCurrency), 30000);
      
      // Clean up on component unmount
      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }
  }, [fetchNAV, baseCurrency, lastPriceUpdateTime]);

  // Update the formatValue function to handle the current display mode
  // Add memoization to prevent excessive recalculations
  const formatValueWithMode = useCallback((value: number, displayMode?: 'btc' | 'usd') => {
    if (!Number.isFinite(value) || value < 0) {
      value = 0;
    }
    
    try {
      const mode = displayMode || baseCurrency || 'usd';
      // For USD mode, always use the memoized BTC price
      return formatValue(value, mode, btcPrice);
    } catch (error) {
      console.error('Error in formatValueWithMode:', error);
      return (displayMode || baseCurrency) === 'usd' ? '$0.00' : '₿0.00';
    }
  }, [baseCurrency, btcPrice]);

  // Add position management functions
  const addPosition = useCallback(async (position: Omit<Portfolio, 'address' | 'current' | 'change'>) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Create a new position with generated values
      const newPosition: Portfolio = {
        ...position,
        address: `mock-address-${position.name.replace(/\s+/g, '-').toLowerCase()}`,
        current: position.value, // Initialize current value same as initial value
        change: 0 // Initialize with no change
      };
      
      // Add to existing positions
      setPortfolioPositions(prev => [...prev, newPosition]);
      
      return newPosition;
    } catch (error) {
      console.error('Error adding position:', error);
      setError('Failed to add position');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Add getPositions function
  const getPositions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      return portfolioPositions;
    } catch (error) {
      console.error('Error getting positions:', error);
      setError('Failed to get positions');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [portfolioPositions]);

  // Get circulating supply of OVT tokens
  const getCirculatingSupply = useCallback(async (): Promise<number> => {
    try {
      return await runeClient.getCirculatingSupply();
    } catch (error) {
      console.error('Error getting circulating supply:', error);
      return OVT_FALLBACK_DISTRIBUTED; // Fallback to 1M OVT as per the first TGE plan
    }
  }, []);

  return {
    isLoading,
    error,
    navData,
    baseCurrency: baseCurrency || 'usd',
    btcPrice,
    portfolioPositions,
    lastPriceUpdateTime,
    formatValue: useCallback((value: number, mode?: 'btc' | 'usd') => {
      return formatValue(value, mode || baseCurrency || 'usd', btcPrice);
    }, [baseCurrency, btcPrice]),
    getTransactionHistory,
    fetchNAV,
    handleCurrencyChange,
    setBaseCurrency: handleCurrencyChange,
    archClient,
    setPortfolioPositions,
    addPosition,
    getPositions,
    getCirculatingSupply,
    ovtPrice,
    formattedOvtPrice
  };
}

// Helper function to get project descriptions
function getProjectDescription(name: string): string {
  const descriptions: Record<string, string> = {
    'Polymorphic Labs': 'Encryption Layer',
    'VoltFi': 'Bitcoin Volatility Index on Bitcoin',
    'MIXDTape': 'Phygital Music for superfans - disrupting Streaming',
  };
  return descriptions[name] || '';
} 
