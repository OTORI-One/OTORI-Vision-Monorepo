import React, { useState, useEffect, useRef } from 'react';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import priceService from '../src/services/priceService';
import { SATS_PER_BTC } from '../src/lib/formatting';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import dynamic from 'next/dynamic';

interface NAVDisplayProps {
  size?: 'sm' | 'md' | 'lg';
  showChange?: boolean;
}

// The actual component implementation
function NAVDisplayComponent({ size = 'md', showChange = true }: NAVDisplayProps) {
  const { currency, formatValue } = useCurrencyToggle();
  // Use the OVT price hook to ensure consistency with the price card
  const { dailyChange } = useOVTPrice();
  
  // Initialize with empty values instead of hardcoded defaults
  const [navData, setNavData] = useState(() => {
    // Try to get from localStorage first (if in browser)
    if (typeof window !== 'undefined') {
      try {
        const cachedData = localStorage.getItem('nav-data-cache');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          // Only use cached data if it's less than 5 minutes old
          if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
            return parsed.data;
          }
        }
      } catch (e) {
        console.error('Error reading NAV cache:', e);
      }
    }
    
    // Default to empty but valid values
    return {
      totalValueSats: 0,
      totalValueUSD: 0,
      formattedTotalValueSats: '0 sats',
      formattedTotalValueUSD: '$0.00',
      changePercentage: 0,
      btcPrice: 0,
      ovtPrice: 0,
      circulatingSupply: 0,
      lastUpdate: Date.now(),
      timestamp: Date.now()
    };
  });

  // Track last successful refresh time to avoid hammering the API
  const lastSuccessfulRefreshRef = useRef<number>(0); // Start with 0 to ensure immediate fetch on mount
  // Track consecutive error count for backoff
  const errorCountRef = useRef<number>(0);
  
  // Function to store NAV data in localStorage
  const cacheNavData = (data: any) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nav-data-cache', JSON.stringify({
          timestamp: Date.now(),
          data
        }));
      } catch (e) {
        console.error('Error caching NAV data:', e);
      }
    }
  };
  
  // Fetch NAV data directly from the price service
  useEffect(() => {
    const fetchNAV = async () => {
      // Implement exponential backoff for consecutive errors
      const timeNow = Date.now();
      const timeSinceLastSuccess = timeNow - lastSuccessfulRefreshRef.current;
      
      // Gradually increase wait time based on error count (min: 15s, max: 60s)
      const baseWaitTime = 15000; // 15 seconds base
      const maxWaitTime = 60000;  // 60 seconds max
      const waitMultiplier = Math.min(Math.pow(1.5, errorCountRef.current), 4); // Exponential up to 4x
      const minWaitTime = Math.min(baseWaitTime * waitMultiplier, maxWaitTime);
      
      // Skip refresh if we've refreshed too recently or if backing off due to errors
      // But always fetch immediately on first mount (lastSuccessfulRefreshRef.current === 0)
      if (lastSuccessfulRefreshRef.current > 0 && timeSinceLastSuccess < minWaitTime) {
        return;
      }
      
      try {
        // Add a cache-busting query parameter to avoid cached responses
        const data = await priceService.getNAVData();
        
        // Get real change percentage from API, fallback to dailyChange if needed
        const actualChangePercentage = (typeof data.changePercentage === 'number' && isFinite(data.changePercentage))
          ? data.changePercentage
          : (typeof dailyChange === 'number' && isFinite(dailyChange))
            ? dailyChange
            : 0;
        
        // Create updated NAV data with valid change percentage
        const updatedData = {
          ...data,
          changePercentage: actualChangePercentage
        };
        
        // Only log significant changes to reduce console noise
        if (!navData || Math.abs(updatedData.ovtPrice - navData.ovtPrice) > 0.01 * navData.ovtPrice) {
          console.log('NAV data refreshed:', {
            timestamp: new Date().toISOString(),
            changePercentage: updatedData.changePercentage,
            ovtPrice: updatedData.ovtPrice
          });
        }
        
        // Update state with real data
        setNavData(updatedData);
        // Cache the data for faster loading on page transitions
        cacheNavData(updatedData);
        
        // Reset error counter and update last success time
        lastSuccessfulRefreshRef.current = Date.now();
        errorCountRef.current = 0;
      } catch (error) {
        console.error('Error fetching NAV:', error);
        // Increment error counter for backoff
        errorCountRef.current++;
        
        // Only update change percentage if we already have data
        if (navData.totalValueSats > 0) {
          setNavData((prevData: typeof navData) => ({
            ...prevData,
            changePercentage: (typeof dailyChange === 'number' && isFinite(dailyChange))
              ? dailyChange
              : prevData.changePercentage
          }));
        }
      }
    };
    
    // Initial fetch immediately
    fetchNAV();
    
    // Set up refresh at a reduced rate
    const interval = setInterval(fetchNAV, 15000);
    
    // Cleanup
    return () => clearInterval(interval);
  }, [dailyChange, navData]);
  
  // Format values based on current currency
  const formattedTotalValue = currency === 'usd' 
    ? navData.formattedTotalValueUSD 
    : navData.formattedTotalValueSats;
  
  // Format change percentage with safety checks
  const changePercentage = (typeof navData.changePercentage === 'number' && isFinite(navData.changePercentage))
    ? navData.changePercentage.toFixed(2)
    : '0.00';
    
  const isPositive = (typeof navData.changePercentage === 'number' && isFinite(navData.changePercentage))
    ? navData.changePercentage >= 0
    : true;
    
  const formattedChangePercentage = `${isPositive ? '+' : ''}${changePercentage}%`;
  
  // Size classes
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };
  
  const valueSize = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl'
  };
  
  return (
    <div className="flex items-center">
      <div>
        <p className={`${sizes[size]} text-primary font-medium mb-0.5`}>
          Net Asset Value (NAV)
        </p>
        <div className="flex items-center">
          <p className={`${valueSize[size]} font-bold text-primary mr-2`}>
            {formattedTotalValue}
          </p>
          
          {showChange && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
              isPositive ? 'bg-success bg-opacity-10 text-success' : 'bg-error bg-opacity-10 text-error'
            }`}>
              {formattedChangePercentage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Export a client-side only version of the component to avoid hydration issues
// This ensures this component only renders on the client, not during server-side rendering
const NAVDisplay = dynamic(() => Promise.resolve(NAVDisplayComponent), {
  ssr: false,
});

export default NAVDisplay; 