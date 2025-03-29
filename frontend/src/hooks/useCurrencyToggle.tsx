import { useState, useEffect, useCallback, useContext, createContext, ReactNode } from 'react';

// Define the currency type
export type Currency = 'btc' | 'usd';

// Define the context interface
interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
  formatValue: (value: number, bitcoinPrice?: number) => string;
  formatRawValue: (value: number, bitcoinPrice?: number) => number;
  getBitcoinPrice: () => number;
}

// Create a context with default values
const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'usd',
  setCurrency: () => {},
  toggleCurrency: () => {},
  formatValue: () => '',
  formatRawValue: () => 0,
  getBitcoinPrice: () => 50000,
});

// Constants
const SATS_PER_BTC = 100000000;
const LOCAL_STORAGE_KEY = 'ovt-currency-preference';

interface CurrencyProviderProps {
  children: ReactNode;
  initialCurrency?: Currency;
}

/**
 * Provider component for currency context
 */
export const CurrencyProvider = ({ 
  children, 
  initialCurrency = 'usd' 
}: CurrencyProviderProps) => {
  // Initialize with value from localStorage or default
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [bitcoinPrice, setBitcoinPrice] = useState<number>(50000);
  
  // Initialize from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedCurrency = localStorage.getItem(LOCAL_STORAGE_KEY) as Currency;
        
        if (storedCurrency && (storedCurrency === 'btc' || storedCurrency === 'usd')) {
          setCurrencyState(storedCurrency);
        }
        
        // Set the global for other components
        if (typeof window !== 'undefined') {
          (window as any).globalBaseCurrency = storedCurrency || initialCurrency;
        }
        
        // Try to get Bitcoin price from global
        if (typeof window !== 'undefined' && (window as any).btcPrice) {
          setBitcoinPrice((window as any).btcPrice);
        }
      } catch (error) {
        console.error('Error accessing localStorage for currency preference:', error);
      }
    }
  }, [initialCurrency]);
  
  // Update localStorage and global when currency changes
  const setCurrency = useCallback((newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, newCurrency);
        // Also set global for consistency across components
        (window as any).globalBaseCurrency = newCurrency;
        
        // Dispatch a custom event to notify other components
        window.dispatchEvent(new CustomEvent('currency-change', { 
          detail: { currency: newCurrency } 
        }));
      } catch (error) {
        console.error('Error saving currency preference:', error);
      }
    }
  }, []);
  
  // Toggle between BTC and USD
  const toggleCurrency = useCallback(() => {
    const newCurrency = currency === 'btc' ? 'usd' : 'btc';
    setCurrency(newCurrency);
  }, [currency, setCurrency]);
  
  // Update Bitcoin price from global
  useEffect(() => {
    const updateBitcoinPrice = () => {
      if (typeof window !== 'undefined' && (window as any).btcPrice) {
        setBitcoinPrice((window as any).btcPrice);
      }
    };
    
    // Listen for bitcoin price updates
    window.addEventListener('btcprice-update', updateBitcoinPrice);
    
    // Update immediately on mount
    updateBitcoinPrice();
    
    // Then update every 15 seconds
    const intervalId = setInterval(updateBitcoinPrice, 15000);
    
    // Cleanup on unmount
    return () => {
      window.removeEventListener('btcprice-update', updateBitcoinPrice);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);
  
  // Format a value according to current currency
  const formatValue = useCallback((value: number, btcPriceOverride?: number): string => {
    // First validate inputs to prevent infinity issues
    if (!isFinite(value)) {
      console.warn('formatValue received non-finite value:', value);
      value = 0;
    }
    
    // Safely handle Bitcoin price
    const effectiveBtcPrice = (btcPriceOverride && isFinite(btcPriceOverride)) 
      ? btcPriceOverride 
      : (isFinite(bitcoinPrice) ? bitcoinPrice : 50000);
    
    if (currency === 'usd') {
      // Convert sats to USD
      const usdValue = (value / SATS_PER_BTC) * effectiveBtcPrice;
      
      // Check for NaN or Infinity again after calculation
      if (!isFinite(usdValue)) {
        return '$0.00';
      }
      
      // Format according to rules
      if (usdValue >= 1000000) {
        return `$${(usdValue / 1000000).toFixed(2)}M`;
      } else if (usdValue >= 1000) {
        return `$${(usdValue / 1000).toFixed(1)}k`;
      } else if (usdValue >= 100) {
        return `$${Math.floor(usdValue)}`;
      } else if (usdValue >= 1) {
        return `$${usdValue.toFixed(2)}`;
      } else if (usdValue >= 0.01) {
        return `$${usdValue.toFixed(2)}`;
      } else if (usdValue > 0) {
        return `$${usdValue.toFixed(4)}`;
      } else {
        return `$0.00`;
      }
    } else {
      // Check for NaN or Infinity
      if (!isFinite(value)) {
        return '0 sats';
      }
      
      // Format BTC/sats value
      if (value >= SATS_PER_BTC) { // 1 BTC or more
        return `₿${(value / SATS_PER_BTC).toFixed(4)}`;
      } else if (value >= 10000000) { // 0.1 BTC or more
        return `₿${(value / SATS_PER_BTC).toFixed(2)}`;
      } else if (value >= 1000000) {
        return `${(value / 1000000).toFixed(2)}M sats`;
      } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}k sats`;
      } else {
        return `${Math.floor(value)} sats`;
      }
    }
  }, [currency, bitcoinPrice]);
  
  // Return raw converted value without formatting
  const formatRawValue = useCallback((value: number, btcPriceOverride?: number): number => {
    const effectiveBtcPrice = btcPriceOverride || bitcoinPrice;
    
    if (currency === 'usd') {
      // Convert sats to USD
      return (value / SATS_PER_BTC) * effectiveBtcPrice;
    } else {
      // Return the raw sats value
      return value;
    }
  }, [currency, bitcoinPrice]);
  
  // Get the current Bitcoin price
  const getBitcoinPrice = useCallback((): number => {
    return bitcoinPrice;
  }, [bitcoinPrice]);
  
  // Provide context value
  const contextValue: CurrencyContextType = {
    currency,
    setCurrency,
    toggleCurrency,
    formatValue,
    formatRawValue,
    getBitcoinPrice,
  };
  
  return (
    <CurrencyContext.Provider value={contextValue}>
      {children}
    </CurrencyContext.Provider>
  );
};

/**
 * Custom hook to use the currency context
 */
export function useCurrencyToggle() {
  const context = useContext(CurrencyContext);
  
  if (!context) {
    throw new Error('useCurrencyToggle must be used within a CurrencyProvider');
  }
  
  return context;
}

export default useCurrencyToggle; 