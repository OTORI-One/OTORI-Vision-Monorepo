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
import { useLaserEyes } from '@omnisat/lasereyes';
import { 
  shouldUseMockData, 
  getDataSourceIndicator,
  mergePortfolioData,
  getTokenSupplyData,
  getHybridModeConfig
} from '../lib/hybridModeUtils';
import { ensurePortfolioDataLoaded } from '../utils/portfolioLoader';
import { SATS_PER_BTC } from '../lib/formatting';
import { formatSatsToCurrency } from '../utils/formatters';
import { 
  simulatePortfolioPriceMovements, 
  PortfolioPosition,
  getGlobalNAVReference
} from '../utils/priceMovement';
import priceService from '../services/priceService';
import { useNAV } from './useNAV';
import { useOVTPrice } from './useOVTPrice';
import { useBitcoinPrice } from './useBitcoinPrice';
import { useCurrencyToggle } from './useCurrencyToggle';

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

// Initialize clients
const runeClient = new RuneClient({
  baseUrl: process.env.NEXT_PUBLIC_RUNE_ENDPOINT || 'http://localhost:3032',
  mockData: process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true'
});
const archClient = new ArchClient({
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID || '',
  treasuryAddress: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd',
  endpoint: process.env.NEXT_PUBLIC_ARCH_ENDPOINT || 'http://localhost:8000'
});

// Helper function to format values consistently
// DEPRECATED LOCAL HELPER - Use formatters from ../utils/formatters directly
/*
const formatValue = (value: number, displayMode: 'btc' | 'usd' = 'btc', btcPrice?: number | null): string => {
  // ... implementation ...
  // Replace formatValueUtils with formatSatsToCurrency
  // Need to handle potential missing btcPrice for USD mode if this was ever used directly
  // return formatSatsToCurrency(value, displayMode, btcPrice ?? null); 
};
*/

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
  // Get currency context
  const { currency: baseCurrencyFromToggle, setCurrency: setBaseCurrencyFromToggle } = useCurrencyToggle();

  // State hooks - initialize properly to prevent React queue errors
  const [error, setError] = useState<string | null>(null);
  const [portfolioPositions, setPortfolioPositions] = useState<Portfolio[]>([]);
  
  // Use the hooks
  const { nav, loading: navLoading, error: navError, isConnected: navConnected } = useNAV();
  const { 
      price: ovtPriceValue, // This is likely the raw USD price based on useOVTPrice structure
      btcPriceSats: ovtBtcPriceSats,
       usdPrice: ovtUsdPrice,
      btcPriceFormatted: ovtBtcFormatted, // Store formatted values from hook if needed elsewhere
      usdPriceFormatted: ovtUsdFormatted,
      isLoading: ovtLoading,
      error: ovtError,
      isConnected: ovtConnected
  } = useOVTPrice();
  // Rename destructured btcPrice to avoid conflict
  const { price: bitcoinHookPrice, isLoading: btcLoading, error: btcError } = useBitcoinPrice() || { price: 50000, isLoading: false, error: null }; 
  
  const { address } = useLaserEyes();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  // Derive overall loading state
  const isLoading = useMemo(() => navLoading || ovtLoading || btcLoading, [navLoading, ovtLoading, btcLoading]);
  
  // Combine errors (simple concatenation for now)
  const combinedError = useMemo(() => {
      const errors = [navError, ovtError, btcError].filter(Boolean);
      return errors.length > 0 ? errors.join('; ') : null;
  }, [navError, ovtError, btcError]);

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

  // Currency change handler - uses the function from useCurrencyToggle
  const handleCurrencyChange = useCallback((currency: 'btc' | 'usd') => {
    setBaseCurrencyFromToggle(currency);
    // Dispatching event is likely handled within useCurrencyToggle/Provider now
  }, [setBaseCurrencyFromToggle]);

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

  // Add position management functions
  const addPosition = useCallback(async (position: Omit<Portfolio, 'address' | 'current' | 'change'>) => {
    try {
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
    }
  }, []);

  // Add getPositions function
  const getPositions = useCallback(() => {
    try {
      setError(null);
      return portfolioPositions;
    } catch (error) {
      console.error('Error getting positions:', error);
      setError('Failed to get positions');
      return []; // Return empty array on error
    }
  }, [portfolioPositions]);

  // Get circulating supply of OVT tokens
  const getCirculatingSupply = useCallback(async (): Promise<number> => {
    // Prefer data from useNAV hook if available
    if (nav && nav.totalTokenSupply) {
        return nav.totalTokenSupply;
    }
    // Fallback to RuneClient
    try {
      return await runeClient.getCirculatingSupply();
    } catch (error) {
      console.error('Error getting circulating supply:', error);
      return OVT_FALLBACK_DISTRIBUTED; // Fallback to 1M OVT as per the first TGE plan
    }
  }, [nav]); // Depend on nav data
  
  // Construct the legacy NAVData object from the useNAV hook
  const legacyNavData = useMemo(() => {
      // Use the formatter function here
      const formattedTotalValue = formatSatsToCurrency(
          nav.navSats, 
          baseCurrencyFromToggle, 
          bitcoinHookPrice // Use the BTC price from the useBitcoinPrice hook
      );
      return {
          totalValue: formattedTotalValue, // Use the newly formatted value
          totalValueSats: nav.navSats,
          changePercentage: `${(nav.changePercentage || 0).toFixed(2)}%`,
          portfolioItems: portfolioPositions, // Still using mock/local portfolio state
          tokenDistribution: {
              totalSupply: 2100000, // TODO: Get from source if available
              distributed: nav.totalTokenSupply || OVT_FALLBACK_DISTRIBUTED,
              runeId: OVT_RUNE_ID,
              runeSymbol: 'OVT',
              distributionEvents: [] // TODO: Populate if needed
          }
      };
  }, [nav, baseCurrencyFromToggle, portfolioPositions, bitcoinHookPrice]);

  return {
    isLoading,
    error: combinedError, // Use combined error
    navData: legacyNavData, // Provide the constructed legacy object
    baseCurrency: baseCurrencyFromToggle, // Use currency from the hook
    btcPrice: bitcoinHookPrice, // Use the renamed variable from useBitcoinPrice
    portfolioPositions,
    // Export the correct centralized utility directly
    formatValue: formatSatsToCurrency, 
    getTransactionHistory,
    handleCurrencyChange,
    setBaseCurrency: handleCurrencyChange,
    archClient,
    setPortfolioPositions,
    addPosition,
    getPositions,
    getCirculatingSupply,
    ovtPrice: ovtPriceValue, // Provide value from useOVTPrice hook
    // Provide formatted value based on baseCurrency
    formattedOvtPrice: baseCurrencyFromToggle === 'usd' 
        ? ovtUsdFormatted // Use the formatted value directly from useOVTPrice hook
        : ovtBtcFormatted   // Use the formatted value directly from useOVTPrice hook
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
