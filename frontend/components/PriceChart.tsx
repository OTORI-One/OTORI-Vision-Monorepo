import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useBitcoinPrice } from '../src/hooks/useBitcoinPrice';
import { useEffect, useMemo, useState } from 'react';
import { useOVTClient } from '../src/hooks/useOVTClient';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { getPriceHistory, PriceHistoryPoint } from '../src/services/priceService';

interface PriceData {
  name: string;
  value: number;
  change?: number;
}

interface PriceChartProps {
  data?: PriceData[];
  baseCurrency?: 'usd' | 'btc';
  days?: number;
}

// Default color theme
const CHART_PRIMARY_COLOR = '#29378d'; // OTORI brand deep purple
const CHART_SUCCESS_COLOR = '#10B981'; // success
const CHART_ERROR_COLOR = '#EF4444';   // error

// Use the centralized formatter from useOVTClient
export default function PriceChart({ baseCurrency = 'usd', days = 30 }: PriceChartProps) {
  const { formatValue } = useCurrencyToggle();
  const { price: ovtPrice, dailyChange, isLoading } = useOVTPrice();
  const [priceHistory, setPriceHistory] = useState<PriceData[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);
  
  // Fetch historical price data or generate synthetic data only as fallback
  useEffect(() => {
    // If OVT price is still loading, don't update yet
    if (isLoading) return;
    
    const fetchHistoricalData = async () => {
      setIsHistoryLoading(true);
      
      try {
        // Try to fetch actual historical data for OVT from API
        const historicalData = await getPriceHistory('ovt', 'daily');
        
        // If we have historical data, convert it to our PriceData format
        if (historicalData && historicalData.length > 0) {
          // Format data and calculate change percentages
          const formattedData: PriceData[] = [];
          
          historicalData.forEach((point, index) => {
            const previousPoint = index > 0 ? historicalData[index - 1] : null;
            const percentChange = previousPoint 
              ? Math.round(((point.value - previousPoint.value) / previousPoint.value) * 1000) / 10
              : 0;
              
            formattedData.push({
              name: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              value: point.value,
              change: percentChange
            });
          });
          
          // Add current price point if not in historical data
          const lastPoint = historicalData[historicalData.length - 1];
          const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const lastPointDate = new Date(lastPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          
          if (lastPointDate !== currentDate) {
            // Add current price as final point
            const percentChange = Math.round(((ovtPrice - lastPoint.value) / lastPoint.value) * 1000) / 10;
            
            formattedData.push({
              name: currentDate,
              value: ovtPrice,
              change: dailyChange || percentChange
            });
          }
          
          setPriceHistory(formattedData);
          setIsHistoryLoading(false);
          return;
        }
        
        // If we didn't get valid historical data, fall back to synthetic data
        throw new Error("Historical data unavailable or empty");
        
      } catch (error) {
        console.log("Using synthetic data due to error:", error);
        generateSyntheticData();
      }
    };
    
    const generateSyntheticData = () => {
      // FALLBACK ONLY: Generate synthetic data if we can't get real historical data
      console.warn("Using synthetic price history data as API fallback");
      const defaultPrice = ovtPrice > 0 ? ovtPrice : 249;
      const today = new Date();
      const data: PriceData[] = [];
      
      for (let i = days; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        
        // Create a price that trends from -30% to current price with some randomness
        const randomFactor = 0.5 + Math.random();
        const dayProgress = (days - i) / days;
        
        // Use exact current price for today, otherwise use trending calculation
        const dayValue = i === 0 
          ? defaultPrice 
          : defaultPrice * (0.7 + (0.3 * dayProgress * randomFactor));
        
        data.push({
          name: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: Math.round(dayValue * 100) / 100,
          change: i > 0 ? 
            Math.round(((dayValue - (data[data.length-1]?.value || dayValue)) / (data[data.length-1]?.value || dayValue)) * 1000) / 10 : 
            (dailyChange || 0)
        });
      }
      
      setPriceHistory(data);
      setIsHistoryLoading(false);
    };
    
    // Start by trying to fetch the real data
    fetchHistoricalData();
  }, [ovtPrice, dailyChange, days, isLoading]);
  
  // Calculate if overall trend is positive
  const isPositiveTrend = useMemo(() => {
    if (priceHistory.length < 2) return true;
    return priceHistory[priceHistory.length - 1].value >= priceHistory[0].value;
  }, [priceHistory]);
  
  const gradientId = "ovtPriceGradient";
  const chartColor = CHART_PRIMARY_COLOR;
  
  const maxValue = Math.max(...priceHistory.map(item => item.value));
  const yAxisDomain = [0, Math.ceil(maxValue * 1.1)]; // Add 10% padding to the top

  const formatYAxis = (value: number) => {
    return formatValue(value);
  };

  // Show loading state when no data is available or we're still loading
  if (priceHistory.length === 0 || isLoading || isHistoryLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Loading price data...</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={priceHistory}
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

// Custom tooltip component
const CustomTooltip = ({ active, payload, label, currency }: any) => {
  const { formatValue } = useCurrencyToggle();
  
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isPositive = data.change >= 0;
    
    return (
      <div className="bg-white p-4 rounded-lg shadow-lg border border-primary">
        <p className="text-sm text-primary">{data.name}</p>
        <p className="text-lg font-semibold mt-1 text-primary">
          {formatValue(data.value, currency)}
        </p>
        {data.change !== undefined && (
          <p className={`text-sm font-medium ${isPositive ? 'text-success' : 'text-error'}`}>
            {isPositive ? '+' : ''}{data.change}%
          </p>
        )}
      </div>
    );
  }
  return null;
};

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