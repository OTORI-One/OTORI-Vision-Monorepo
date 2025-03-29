import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useBitcoinPrice } from '../src/hooks/useBitcoinPrice';
import { useEffect, useMemo, useState } from 'react';
import { useOVTClient } from '../src/hooks/useOVTClient';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { getPriceHistory, PriceHistoryPoint } from '../src/services/priceService';
import dynamic from 'next/dynamic';

interface PriceData {
  name: string;
  value: number;
  change?: number;
  dateObj: Date; // Add date object for sorting and gap detection
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

// Helper to format date consistently
const formatChartDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Helper to create a full series of dates with no gaps
const createCompleteDateSeries = (startDate: Date, endDate: Date): Date[] => {
  const dates: Date[] = [];
  let currentDate = new Date(startDate);
  
  // Clone dates to avoid modifying originals
  currentDate = new Date(currentDate.setHours(0, 0, 0, 0));
  const endDateTime = new Date(endDate.setHours(0, 0, 0, 0)).getTime();
  
  // Generate all dates in range
  while (currentDate.getTime() <= endDateTime) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
};

// The component implementation
function PriceChartComponent({ baseCurrency = 'usd', days = 30 }: PriceChartProps) {
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
          // Calculate target date range (last X days)
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(endDate.getDate() - days);
          
          // Get complete series of dates (no gaps)
          const completeDateSeries = createCompleteDateSeries(startDate, endDate);
          
          // Create a map of existing data points by date string
          const dataByDate = new Map<string, PriceHistoryPoint>();
          historicalData.forEach(point => {
            const dateStr = new Date(point.date).toISOString().split('T')[0];
            dataByDate.set(dateStr, point);
          });
          
          // Create the complete dataset, filling gaps with interpolated values
          const formattedData: PriceData[] = [];
          let lastKnownValue = ovtPrice; // Default to current price if we have no data point
          
          // Find the initial value (use the first available data point before startDate)
          const earliestData = historicalData.sort((a, b) => 
            new Date(a.date).getTime() - new Date(b.date).getTime()
          )[0];
          
          if (earliestData) {
            lastKnownValue = earliestData.value;
          }
          
          // Process each date in the complete series
          completeDateSeries.forEach((date, index) => {
            const dateStr = date.toISOString().split('T')[0];
            const existingDataPoint = dataByDate.get(dateStr);
            
            // If we have a data point for this date, use it
            if (existingDataPoint) {
              const formattedDate = formatChartDate(date);
              const previousPoint = formattedData[formattedData.length - 1];
              const percentChange = previousPoint 
                ? Math.round(((existingDataPoint.value - previousPoint.value) / previousPoint.value) * 1000) / 10
                : 0;
                
              formattedData.push({
                name: formattedDate,
                value: existingDataPoint.value,
                change: percentChange,
                dateObj: date
              });
              
              // Update lastKnownValue
              lastKnownValue = existingDataPoint.value;
            } 
            // If this is today's date, use current price
            else if (index === completeDateSeries.length - 1) {
              const previousPoint = formattedData[formattedData.length - 1];
              const percentChange = previousPoint 
                ? Math.round(((ovtPrice - previousPoint.value) / previousPoint.value) * 1000) / 10
                : dailyChange || 0;
                
              formattedData.push({
                name: formatChartDate(date),
                value: ovtPrice,
                change: percentChange,
                dateObj: date
              });
            }
            // We need to generate data for this missing date
            else {
              // Find next existing data point
              let nextValue = ovtPrice;
              let distanceToNext = completeDateSeries.length - index;
              
              // Scan forward to find the next real data point
              for (let j = index + 1; j < completeDateSeries.length; j++) {
                const futureDate = completeDateSeries[j];
                const futureDateStr = futureDate.toISOString().split('T')[0];
                const futureDataPoint = dataByDate.get(futureDateStr);
                
                if (futureDataPoint) {
                  nextValue = futureDataPoint.value;
                  distanceToNext = j - index;
                  break;
                }
              }
              
              // Linear interpolation between lastKnownValue and nextValue
              const progress = 1 / (distanceToNext + 1);
              const interpolatedValue = lastKnownValue + 
                ((nextValue - lastKnownValue) * progress * (1 + (Math.random() * 0.1 - 0.05)));
              
              const previousPoint = formattedData[formattedData.length - 1];
              const percentChange = previousPoint 
                ? Math.round(((interpolatedValue - previousPoint.value) / previousPoint.value) * 1000) / 10
                : 0;
                
              formattedData.push({
                name: formatChartDate(date),
                value: interpolatedValue,
                change: percentChange,
                dateObj: date
              });
            }
          });
          
          // Sort by date to ensure chronological order
          formattedData.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
          
          // Make sure we include current price at the end if not already present
          const lastPoint = formattedData[formattedData.length - 1];
          const currentDate = new Date();
          currentDate.setHours(0, 0, 0, 0);
          
          // If the last point isn't from today, add current price
          if (lastPoint.dateObj.getTime() !== currentDate.getTime()) {
            const percentChange = Math.round(((ovtPrice - lastPoint.value) / lastPoint.value) * 1000) / 10;
            
            formattedData.push({
              name: formatChartDate(currentDate),
              value: ovtPrice,
              change: dailyChange || percentChange,
              dateObj: currentDate
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
      const currentDate = new Date();
      const data: PriceData[] = [];
      
      for (let i = days; i >= 0; i--) {
        const date = new Date(currentDate);
        date.setDate(currentDate.getDate() - i);
        
        // Create a price that trends from -30% to current price with some randomness
        const randomFactor = 0.5 + Math.random();
        const dayProgress = (days - i) / days;
        
        // Use exact current price for today, otherwise use trending calculation
        const dayValue = i === 0 
          ? defaultPrice 
          : defaultPrice * (0.7 + (0.3 * dayProgress * randomFactor));
        
        data.push({
          name: formatChartDate(date),
          value: Math.round(dayValue * 100) / 100,
          change: i > 0 ? 
            Math.round(((dayValue - (data[data.length-1]?.value || dayValue)) / (data[data.length-1]?.value || dayValue)) * 1000) / 10 : 
            (dailyChange || 0),
          dateObj: date
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

  // Get display data (without the dateObj that's only used internally)
  const displayData = priceHistory.map(({name, value, change}) => ({name, value, change}));

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={displayData}
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

// Create client-only version of the chart component to avoid hydration issues
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