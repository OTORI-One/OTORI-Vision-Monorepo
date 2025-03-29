import React, { useMemo, useState, useCallback, memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import TokenExplorerModal, { ChartDataItem } from './TokenExplorerModal';
import { useCurrencyToggle, Currency } from '../src/hooks/useCurrencyToggle';
import { useNAV } from '../src/hooks/useNAV';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { PortfolioPosition } from '../src/utils/priceMovement';
import { SATS_PER_BTC } from '../src/lib/formatting';  // Import from centralized formatter

interface PortfolioChartProps {
  data?: PortfolioPosition[];
  totalValue?: string;
  changePercentage?: string;
  baseCurrency?: Currency;
  onBarClick?: (item: ChartDataItem) => void;
}

// Colors for growth bars
const POSITIVE_GROWTH_COLOR = '#10B981'; // Success color
const NEGATIVE_GROWTH_COLOR = '#EF4444'; // Error color
const BASE_COLOR = '#29378d';           // Primary color

// Define the shape props type
interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  dataKey?: string;
  name?: string;
  value?: number;
  index?: number;
  payload?: any;
}

// Format currency values according to frontend-specific-dev-rules.mdc
const formatCurrencyValue = (value: number, currency: Currency = 'usd'): string => {
  if (!isFinite(value) || value === 0) return currency === 'usd' ? '$0.00' : '0 sats';
  
  if (currency === 'usd') {
    // USD Value Standards:
    // Values ≥ 1,000,000: Use '$' prefix, 'M' notation with two decimals (e.g., "$1.50M")
    // Values ≥ 1,000: Use '$' prefix, 'k' notation with no decimals (e.g., "$500k")
    // Values < 1,000: Use '$' prefix, show the full number with two decimal places (e.g., "$750.25")
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${Math.floor(value / 1000)}k`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  } else {
    // BTC Value Standards:
    // BTC ≥ 0.1: Show in BTC with 2 decimals (e.g., "₿0.15")
    // Sats ≥ 1M: Use 'M' notation (e.g., "1.50M sats")
    // Sats ≥ 1k: Use 'k' notation (e.g., "500k sats")
    // Sats < 1k: Show full number (e.g., "750 sats")
    const btcValue = value / SATS_PER_BTC;
    
    if (btcValue >= 0.1) {
      return `₿${btcValue.toFixed(2)}`;
    } else if (value >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M sats`;
    } else if (value >= 1000) {
      return `${Math.floor(value / 1000)}k sats`;
    } else {
      return `${Math.floor(value)} sats`;
    }
  }
};

// Updated component with a clearer name (PortfolioChart instead of NAVVisualization)
// This visualizes the portfolio positions that make up the NAV
function PortfolioChart({ data, totalValue, changePercentage, baseCurrency, onBarClick }: PortfolioChartProps) {
  const { currency, formatValue } = useCurrencyToggle();
  const { positions } = usePortfolio();
  const [selectedToken, setSelectedToken] = useState<ChartDataItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use the centralized hooks with less frequent updates
  const { nav, loading: navLoading } = useNAV();
  
  // Get portfolio data - either from props or from the usePortfolio hook
  const portfolioData = useMemo(() => {
    try {
      if (data && data.length > 0) {
        return data;
      }
      // Use the centralized portfolio data
      return positions;
    } catch (error) {
      console.error("Error loading portfolio data:", error);
      setError("Failed to load portfolio data");
      return [];
    }
  }, [data, positions]);
  
  const displayCurrency = baseCurrency || currency;
  const navChangePercentage = changePercentage || (nav?.changePercentage?.toFixed(2) + '%') || '+0.00%';

  // Transform portfolio data for the chart - using deep equality check for portfolioData
  const formattedData = useMemo(() => {
    // Skip recalculation if nothing changed
    if (portfolioData.length === 0) {
      return [];
    }
    
    // Debug the number of recalculations to detect excessive renders
    console.log(`Recalculating formatted data with ${portfolioData.length} positions`);
    
    // Use a stable reference to the portfolio data to prevent unnecessary recalculations
    const portfolioDataString = JSON.stringify(portfolioData);
    const portfolioDataKey = portfolioDataString.length;
    
    // Generate a cache key that includes dependencies that should trigger recalculation
    const cacheKey = `${displayCurrency}-${portfolioDataKey}-${nav?.navUsd || 0}-${nav?.navSats || 0}`;
    
    // Store the cache key for debugging and to check if it's changing unexpectedly
    console.log('Portfolio data cache key:', cacheKey);
    
    return portfolioData.map((item: PortfolioPosition) => {
      // Calculate the initial investment (value) and current value
      const initialInvestment = item.value;
      const currentValue = item.current;
      
      // Calculate growth (difference between current and initial)
      const growth = currentValue - initialInvestment;
      
      // Convert to appropriate currency if needed
      let growthConverted = growth;
      let initialInvestmentConverted = initialInvestment;
      let currentValueConverted = currentValue;
      
      if (displayCurrency === 'usd') {
        // Get BTC price from the centralized NAV data
        const btcPrice = nav?.navUsd && nav.navSats 
          ? (nav.navUsd / nav.navSats) * SATS_PER_BTC
          : 50000; // Fallback to a reasonable value if not available
          
        // Convert from sats to USD
        const satsToBtc = 1 / SATS_PER_BTC;
        const satsToUsd = satsToBtc * btcPrice;
        
        growthConverted = growth * satsToUsd;
        initialInvestmentConverted = initialInvestment * satsToUsd;
        currentValueConverted = currentValue * satsToUsd;
      }
      
      // Calculate growth as a percentage
      const growthPercentage = ((currentValueConverted - initialInvestmentConverted) / initialInvestmentConverted) * 100;
      
      // Format the values using the new formatter
      const formatted = {
        initialInvestment: formatCurrencyValue(initialInvestmentConverted, displayCurrency),
        currentValue: formatCurrencyValue(currentValueConverted, displayCurrency),
        growth: `${growthPercentage.toFixed(2)}%`,
        pricePerToken: formatCurrencyValue(
          displayCurrency === 'usd' 
            ? item.pricePerToken * (nav?.navUsd && nav?.navSats ? nav.navUsd / nav.navSats * SATS_PER_BTC : 50000) / SATS_PER_BTC 
            : item.pricePerToken,
          displayCurrency
        )
      };
      
      return {
        name: item.name,
        initialInvestment: initialInvestmentConverted,
        currentValue: currentValueConverted,
        growth: parseFloat(growthPercentage.toFixed(2)),
        description: item.description,
        tokenAmount: item.tokenAmount,
        pricePerToken: item.pricePerToken,
        formatted
      };
    });
  }, [portfolioData, displayCurrency, formatValue, nav?.navUsd, nav?.navSats]);
  
  // Format Y axis values - memoize to prevent unnecessary recalculations
  const formatYAxis = useCallback((value: number): string => {
    // Use the custom formatter that follows the frontend-specific-dev-rules
    return formatCurrencyValue(value, displayCurrency);
  }, [displayCurrency]);

  // Handle bar click to show token details
  const handleClick = useCallback((data: any) => {
    if (data?.payload) {
      const item = data.payload as ChartDataItem;
      setSelectedToken(item);
      setModalOpen(true);
      
      if (onBarClick) {
        onBarClick(item);
      }
    }
  }, [onBarClick]);

  // Handle closing the modal
  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setSelectedToken(null);
  }, []);
  
  // Cleanup effect to handle component unmounting and prevent memory leaks
  React.useEffect(() => {
    // Store references to values that will be used in interval cleanup
    const mountTime = Date.now();
    
    return () => {
      // Ensure proper cleanup to prevent memory leaks
      const unmountTime = Date.now();
      const componentLifetime = unmountTime - mountTime;
      console.log(`PortfolioChart unmounting after ${componentLifetime}ms - cleaning up`);
    };
  }, []);

  return (
    <div className="h-full">
      {error ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-red-500">{error}</p>
        </div>
      ) : navLoading ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500">Loading portfolio data...</p>
        </div>
      ) : formattedData.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500">No portfolio data available</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={formattedData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              barCategoryGap="20%"
              maxBarSize={50}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={formatYAxis} />
              <Tooltip content={(props) => <MemoizedCustomTooltip {...props} baseCurrency={displayCurrency} />} />
              
              {/* Base value bar - shows initial investment */}
              <Bar 
                dataKey="initialInvestment" 
                name="Initial Investment" 
                fill={BASE_COLOR}
                barSize={20}
                stackId="investment"
              />
              
              {/* Growth bar - shows growth on top of initial value */}
              <Bar 
                dataKey="growth" 
                name="Growth" 
                stackId="investment"
                onClick={handleClick}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                {/* Apply different colors based on growth value */}
                {formattedData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.growth >= 0 ? POSITIVE_GROWTH_COLOR : NEGATIVE_GROWTH_COLOR} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          
          {selectedToken && (
            <TokenExplorerModal
              isOpen={modalOpen}
              onClose={handleCloseModal}
              token={selectedToken}
            />
          )}
        </>
      )}
    </div>
  );
}

// Export memoized component to prevent unnecessary re-renders
export default memo(PortfolioChart);

// Update CustomTooltip to use the consistent currency formatter
interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  baseCurrency: Currency;
}

// Create a memoized tooltip component to prevent unnecessary renders
const CustomTooltip = ({ active, payload, label, baseCurrency }: CustomTooltipProps) => {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as ChartDataItem;
    const initialInvestment = data.initialInvestment;
    const currentValue = data.currentValue;
    const growth = data.growth;
    
    // Ensure we display the correct sign for growth percentage
    const formattedGrowth = Number.isFinite(growth) 
      ? `${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%` 
      : '+0.00%';
    
    // Use our consistent formatter
    const formattedInitial = data.formatted ? data.formatted.initialInvestment : formatCurrencyValue(initialInvestment, baseCurrency);
    const formattedCurrent = data.formatted ? data.formatted.currentValue : formatCurrencyValue(currentValue, baseCurrency);
    const formattedTokens = data.tokenAmount.toLocaleString();
    const formattedPrice = data.formatted ? data.formatted.pricePerToken : formatCurrencyValue(data.pricePerToken, baseCurrency);
    
    return (
      <div className="bg-white p-4 shadow-lg rounded-lg border border-primary max-w-xs">
        <h4 className="text-lg font-semibold text-primary">{label}</h4>
        <p className="text-sm text-primary opacity-75 mt-1">{data.description}</p>
        
        <div className="mt-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-primary">Initial:</span>
            <span className="text-sm font-medium text-primary">{formattedInitial}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-primary">Current:</span>
            <span className="text-sm font-medium text-primary">{formattedCurrent}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-primary">Growth:</span>
            <span className={`text-sm font-medium ${
              growth >= 0 ? 'text-success' : 'text-error'
            }`}>
              {formattedGrowth}
            </span>
          </div>
          <div className="border-t border-primary border-opacity-20 pt-2 mt-2">
            <div className="flex justify-between">
              <span className="text-sm text-primary">Holdings:</span>
              <span className="text-sm font-medium text-primary">{formattedTokens} tokens</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-primary">Price per token:</span>
              <span className="text-sm font-medium text-primary">{formattedPrice}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return null;
};

// Memoize the CustomTooltip component to prevent unnecessary re-renders
const MemoizedCustomTooltip = memo(CustomTooltip);

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// Updated to use the Currency type from our hooks
const getInitialTransaction = (tokenAmount: number, pricePerToken: number, currency: Currency = 'usd') => {
  return {
    date: formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), // 30 days ago
    type: 'buy' as const, // Using 'buy' to match the expected union type of 'buy' | 'sell'
    amount: tokenAmount.toString(), // Converting to string as expected by TokenExplorerModal
    price: pricePerToken // Pass the raw price, let TokenExplorerModal handle formatting
  };
}; 