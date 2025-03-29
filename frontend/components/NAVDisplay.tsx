import React, { useState, useEffect, useRef } from 'react';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import priceService from '../src/services/priceService';
import { SATS_PER_BTC } from '../src/lib/formatting';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { useNAV } from '../src/hooks/useNAV';
import dynamic from 'next/dynamic';

interface NAVDisplayProps {
  size?: 'sm' | 'md' | 'lg';
  showChange?: boolean;
}

// Safely access localStorage only on client side
const safeGetItem = (key: string, defaultValue: string = ''): string => {
  if (typeof window !== 'undefined') {
    try {
      return localStorage.getItem(key) || defaultValue;
    } catch (err) {
      console.warn(`Error reading ${key} from localStorage:`, err);
      return defaultValue;
    }
  }
  return defaultValue;
};

// Shared global cache to ensure NAV values are consistent across renders
// Safely initialize to avoid SSR issues
const globalNavCache = {
  navTotalSats: Number(safeGetItem('nav-total-sats', '0')),
  navTotalUSD: Number(safeGetItem('nav-total-usd', '0')),
  navPercentage: Number(safeGetItem('nav-percentage', '0')),
  formattedSats: safeGetItem('nav-formatted-sats', '0 sats'),
  formattedUSD: safeGetItem('nav-formatted-usd', '$0.00')
};

// The actual component implementation
function NAVDisplayComponent({ size = 'md', showChange = true }: NAVDisplayProps) {
  // Use the centralized NAV hook
  const { nav, formattedNAV } = useNAV();
  const { currency } = useCurrencyToggle();
  
  // Initialize with global cache values
  const [navData, setNavData] = useState({
    totalValueSats: globalNavCache.navTotalSats || 0,
    totalValueUSD: globalNavCache.navTotalUSD || 0,
    formattedTotalValueSats: globalNavCache.formattedSats || '0 sats',
    formattedTotalValueUSD: globalNavCache.formattedUSD || '$0.00',
    changePercentage: globalNavCache.navPercentage || 0,
    btcPrice: 0,
    ovtPrice: 0,
    circulatingSupply: 0,
    lastUpdate: Date.now(),
    timestamp: Date.now()
  });

  // Track when data was last updated to avoid constantly refreshing
  const lastUpdateRef = useRef<number>(Date.now());
  const hasInitializedRef = useRef<boolean>(false);

  // Subscribe to central store for NAV updates with priority given to the useNAV hook
  useEffect(() => {
    // Skip in SSR context
    if (typeof window === 'undefined') return;
    
    // Update from useNAV hook first
    if (nav && nav.navSats > 0) {
      // Only update if nav data has changed significantly
      const percentChange = Math.abs((nav.changePercentage || 0) - (navData.changePercentage || 0));
      const valueChange = Math.abs((nav.navSats || 0) - (navData.totalValueSats || 0)) / (navData.totalValueSats || 1);
      
      if (percentChange > 0.01 || valueChange > 0.005 || !hasInitializedRef.current) {
        setNavData({
          totalValueSats: nav.navSats,
          totalValueUSD: nav.navUsd,
          formattedTotalValueSats: nav.formattedNavSats,
          formattedTotalValueUSD: nav.formattedNavUsd,
          changePercentage: nav.changePercentage,
          btcPrice: 0,
          ovtPrice: 0,
          circulatingSupply: 0,
          lastUpdate: Date.now(),
          timestamp: Date.now()
        });
        
        // Update global cache
        globalNavCache.navTotalSats = nav.navSats;
        globalNavCache.navTotalUSD = nav.navUsd;
        globalNavCache.navPercentage = nav.changePercentage;
        globalNavCache.formattedSats = nav.formattedNavSats;
        globalNavCache.formattedUSD = nav.formattedNavUsd;
        
        try {
          localStorage.setItem('nav-total-sats', String(nav.navSats));
          localStorage.setItem('nav-total-usd', String(nav.navUsd));
          localStorage.setItem('nav-percentage', String(nav.changePercentage));
          localStorage.setItem('nav-formatted-sats', nav.formattedNavSats);
          localStorage.setItem('nav-formatted-usd', nav.formattedNavUsd);
        } catch (err) {
          console.error('Error saving NAV to localStorage:', err);
        }
        
        hasInitializedRef.current = true;
        lastUpdateRef.current = Date.now();
      }
    } 
    // Also fetch fresh data from the API if it's been over 5 seconds since last update
    else if (Date.now() - lastUpdateRef.current > 5000) {
      // Try to get fresh data from store
      priceService.getLatestNAVData().then(storeData => {
        if (storeData && storeData.totalValueSats > 0) {
          setNavData(storeData);
          
          // Update global cache
          globalNavCache.navTotalSats = storeData.totalValueSats;
          globalNavCache.navTotalUSD = storeData.totalValueUSD;
          globalNavCache.navPercentage = storeData.changePercentage || 0;
          globalNavCache.formattedSats = storeData.formattedTotalValueSats;
          globalNavCache.formattedUSD = storeData.formattedTotalValueUSD;
          
          try {
            localStorage.setItem('nav-total-sats', String(storeData.totalValueSats));
            localStorage.setItem('nav-total-usd', String(storeData.totalValueUSD));
            localStorage.setItem('nav-percentage', String(storeData.changePercentage || 0));
            localStorage.setItem('nav-formatted-sats', storeData.formattedTotalValueSats);
            localStorage.setItem('nav-formatted-usd', storeData.formattedTotalValueUSD);
          } catch (err) {
            console.error('Error saving NAV to localStorage:', err);
          }
          
          hasInitializedRef.current = true;
          lastUpdateRef.current = Date.now();
        }
      }).catch(err => {
        console.warn('Error fetching NAV data:', err);
      });
    }
    
    // Listen for NAV updates from the store
    const priceStore = priceService.getPriceStore();
    const unsubscribe = priceStore.subscribeToNavUpdates(data => {
      // Only update if significant change or we haven't initialized yet
      const percentChange = Math.abs((data.changePercentage || 0) - (navData.changePercentage || 0));
      const valueChange = Math.abs((data.totalValueSats || 0) - (navData.totalValueSats || 0)) / (navData.totalValueSats || 1);
      
      if (percentChange > 0.01 || valueChange > 0.005 || !hasInitializedRef.current) {
        setNavData(data);
        
        // Update global cache
        globalNavCache.navTotalSats = data.totalValueSats;
        globalNavCache.navTotalUSD = data.totalValueUSD;
        globalNavCache.navPercentage = data.changePercentage || 0;
        globalNavCache.formattedSats = data.formattedTotalValueSats;
        globalNavCache.formattedUSD = data.formattedTotalValueUSD;
        
        try {
          localStorage.setItem('nav-total-sats', String(data.totalValueSats));
          localStorage.setItem('nav-total-usd', String(data.totalValueUSD));
          localStorage.setItem('nav-percentage', String(data.changePercentage || 0));
          localStorage.setItem('nav-formatted-sats', data.formattedTotalValueSats);
          localStorage.setItem('nav-formatted-usd', data.formattedTotalValueUSD);
        } catch (err) {
          console.error('Error saving NAV to localStorage:', err);
        }
        
        hasInitializedRef.current = true;
        lastUpdateRef.current = Date.now();
      }
    });
    
    // Trigger a fetch immediately (but don't wait for it)
    if (!hasInitializedRef.current) {
      priceStore.fetchNAVData();
    }
    
    return () => {
      unsubscribe();
    };
  }, [nav, navData]);
  
  // Format values based on current currency
  const formattedTotalValue = currency === 'usd' 
    ? navData.formattedTotalValueUSD 
    : navData.formattedTotalValueSats;
  
  // Format change percentage with safety checks
  const changePercentage = (typeof navData.changePercentage === 'number' && isFinite(navData.changePercentage))
    ? navData.changePercentage.toFixed(2)
    : (typeof globalNavCache.navPercentage === 'number' && isFinite(globalNavCache.navPercentage))
      ? globalNavCache.navPercentage.toFixed(2)
      : '0.00';
    
  const isPositive = (typeof navData.changePercentage === 'number' && isFinite(navData.changePercentage))
    ? navData.changePercentage >= 0
    : (typeof globalNavCache.navPercentage === 'number' && isFinite(globalNavCache.navPercentage))
      ? globalNavCache.navPercentage >= 0
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