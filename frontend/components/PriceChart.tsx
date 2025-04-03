import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import dynamic from 'next/dynamic';
import axios from 'axios';

// Define the structure expected in the static JSON file
interface StaticPricePoint {
  date: string; // Expecting "YYYY-MM-DD" format
  value: number;
}

// Define the structure used internally by the chart
interface ChartDataPoint {
  name: string; // Formatted date for display (e.g., "Mar 05")
  value: number;
  dateObj: Date; // Keep for sorting
}

interface PriceChartProps {
  baseCurrency?: 'usd' | 'btc';
  days?: number; // Use this to determine how much static history to show
}

// Default color theme
const CHART_PRIMARY_COLOR = '#29378d'; // OTORI brand deep purple

// Helper to format date consistently
const formatChartDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// The component implementation
function PriceChartComponent({ baseCurrency = 'usd', days = 30 }: PriceChartProps) {
  const { formatValue } = useCurrencyToggle();
  // Get live price and loading state from the hook
  const { price: liveOvtPrice, isLoading: isLivePriceLoading } = useOVTPrice(); 
  const [historicalData, setHistoricalData] = useState<ChartDataPoint[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);
  const isMountedRef = useRef<boolean>(true);

  // Cleanup function for unmounting
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  
  // Fetch static historical data on mount or when `days` changes
  useEffect(() => {
    if (!isMountedRef.current) return;

    const fetchStaticHistory = async () => {
      setIsHistoryLoading(true);
      try {
        // Fetch the static JSON data
        const response = await axios.get<StaticPricePoint[]>('/data/ovt-price-history.json');
        const staticData = response.data;

        if (!staticData || staticData.length === 0) {
          throw new Error('No historical data found in static file.');
        }

        // Process static data: Convert dates, format names, sort
        const processedData = staticData
          .map(point => {
            const dateObj = new Date(point.date);
            // Add basic validation for date parsing
            if (isNaN(dateObj.getTime())) {
              console.warn(`Invalid date format in static data: ${point.date}`);
              return null;
            }
            return {
              name: formatChartDate(dateObj),
              value: point.value,
              dateObj: dateObj
            };
          })
          .filter((point): point is ChartDataPoint => point !== null) // Filter out invalid points
          .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()); // Ensure chronological order
          
        if (isMountedRef.current) {
            // Limit the data to the requested number of days
            const limitedData = processedData.slice(-days); 
            setHistoricalData(limitedData);
        }

      } catch (error) {
        console.error('Error fetching or processing static price history:', error);
        // Optionally set empty data or a default state on error
        if (isMountedRef.current) {
            setHistoricalData([]); 
        }
      } finally {
        if (isMountedRef.current) {
          setIsHistoryLoading(false);
        }
      }
    };

    fetchStaticHistory();
  }, [days]); // Re-fetch if the number of days changes

  // Combine historical data with the live price
  const displayData = useMemo(() => {
    if (historicalData.length === 0 || isLivePriceLoading || !liveOvtPrice) {
        // If history is empty or live price isn't ready, return empty or just history
        return historicalData.length > 0 ? historicalData : [];
    }

    const today = new Date();
    const todayStr = formatChartDate(today);
    let combinedData = [...historicalData];

    // Check if the last point in history is today
    const lastPoint = combinedData[combinedData.length - 1];
    if (lastPoint && lastPoint.name === todayStr) {
      // Update today's value with the live price
      lastPoint.value = liveOvtPrice;
    } else {
      // Add today's live price as a new point
      combinedData.push({
        name: todayStr,
        value: liveOvtPrice,
        dateObj: today, // Include dateObj for consistency, though not strictly needed for last point
      });
      // Ensure we don't exceed the `days` limit if adding a new point
      if (combinedData.length > days) {
        combinedData = combinedData.slice(-days);
      }
    }
    return combinedData;

  }, [historicalData, liveOvtPrice, isLivePriceLoading, days]);

  const gradientId = "ovtPriceGradient";
  const chartColor = CHART_PRIMARY_COLOR;
  
  const maxValue = displayData.length > 0 
    ? Math.max(...displayData.map(item => item.value))
    : 0;
    
  const yAxisDomain = [0, Math.ceil((maxValue || 100) * 1.1)];

  const formatYAxis = (value: number) => {
    // Use the central formatter, assuming OVT price is treated like USD for display purposes
    // If OVT should be formatted differently (e.g., as Sats), adjust this
    return formatValue(value); // Only pass the value parameter
  };

  // Loading state for combined data readiness
  if ((isHistoryLoading || isLivePriceLoading) && displayData.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <p className="text-gray-500 mb-2">Loading price chart...</p>
      </div>
    );
  }
  
  // Handle case where data fetch failed or resulted in empty array
  if (!isHistoryLoading && !isLivePriceLoading && displayData.length === 0) {
     return (
      <div className="h-full flex flex-col items-center justify-center">
        <p className="text-gray-500 mb-2">Price data unavailable.</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={displayData.map(({ name, value }) => ({ name, value }))} // Pass only name and value to chart
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={chartColor} stopOpacity={0.1}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis domain={yAxisDomain} tickFormatter={formatYAxis} />
          {/* Pass currency mode to tooltip */}
          <Tooltip content={(props) => <CustomTooltip {...props} currency={baseCurrency} />} /> 
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke={chartColor}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 8, strokeWidth: 2 }}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Custom tooltip component - simplified, uses formatValue from hook
const CustomTooltip = ({ active, payload, label, currency }: any) => {
  // Use the hook here again to get the formatter in the tooltip's scope
  const { formatValue } = useCurrencyToggle(); 
  
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    
    // Determine positivity based on change if available, otherwise fallback (optional)
    // For simplicity, we'll remove the change indicator here as static data might not have it
    // const isPositive = data.change !== undefined ? data.change >= 0 : true; 
    
    return (
      <div className="bg-white p-4 rounded-lg shadow-lg border border-primary">
        <p className="text-sm text-primary">{label}</p> {/* Use label which is the date string */}
        <p className="text-lg font-semibold mt-1 text-primary">
          {/* Format the value without the currency parameter */}
          {formatValue(data.value)}
        </p>
        {/* Removed change indicator as static data might not include it reliably */}
        {/* {data.change !== undefined && (
          <p className={`text-sm font-medium ${isPositive ? 'text-success' : 'text-error'}`}>
            {isPositive ? '+' : ''}{data.change}% 
          </p>
        )} */}
      </div>
    );
  }
  return null;
};

// Create client-only version of the chart component
const PriceChart = dynamic(() => Promise.resolve(PriceChartComponent), {
  ssr: false
});

export default PriceChart;

// Mock data for development or when no positions exist
const mockData = [
  { name: 'Jan', value: 400, change: 0 },
  { name: 'Feb', value: 300, change: -25 },
  { name: 'Mar', value: 600, change: 100 },
  { name: 'Apr', value: 800, change: 33.3 },
  { name: 'May', value: 700, change: -12.5 },
  { name: 'Jun', value: 900, change: 28.6 },
  { name: 'Jul', value: 1000, change: 11.1 },
]; 