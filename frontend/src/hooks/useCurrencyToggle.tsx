import React, { useState, useEffect, useCallback, useContext, createContext, ReactNode, useMemo } from 'react';
import { getPriceStore } from '../services/priceService'; // Import price store

// Define the currency type
export type Currency = 'btc' | 'usd';

// Define the context interface
interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
  bitcoinPrice: number;
  formatValue: (value: number, btcPriceOverride?: number) => string;
  formatRawValue: (value: number, btcPriceOverride?: number) => number;
  getBitcoinPrice: () => number;
}

// Create a context with default values
const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'usd',
  setCurrency: () => {},
  toggleCurrency: () => {},
  bitcoinPrice: 50000,
  formatValue: () => '',
  formatRawValue: () => 0,
  getBitcoinPrice: () => 50000
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
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  
  const priceStore = useMemo(() => getPriceStore(), []);
  
  // Safely initialize bitcoinPrice state, handling potential null
  const [bitcoinPrice, setBitcoinPrice] = useState<number>(() => {
    const initialPrice = priceStore.btcPrice; // Assume BitcoinPrice is number | null
    return (initialPrice !== null && isFinite(initialPrice)) ? initialPrice : 50000;
  }); 
  
  // Initialize from localStorage on mount
  useEffect(() => {
    let storedCurrency: Currency | null = null;
    try {
      storedCurrency = localStorage.getItem(LOCAL_STORAGE_KEY) as Currency | null; // Use correct key
      if (storedCurrency && (storedCurrency === 'btc' || storedCurrency === 'usd')) { // Check if valid
          setCurrencyState(storedCurrency);
      }
      // Set the global for other components (Consider removing this global pattern later)
      if (typeof window !== 'undefined') {
        (window as any).globalBaseCurrency = storedCurrency || initialCurrency; // Use initialCurrency as fallback
      }
    } catch (error) {
      console.error('Error accessing localStorage for currency preference:', error);
    }
  }, [initialCurrency]); // Depend on initialCurrency
  
  // Update Bitcoin price from priceStore subscription
  useEffect(() => {
    // Handle potential null from subscription
    const handlePriceUpdate = (newPrice: number | null) => { // Accept number | null
      if (newPrice !== null && isFinite(newPrice)) { 
        setBitcoinPrice(newPrice);
      }
    };
    
    // Subscribe (assuming callback expects number | null based on BitcoinPrice type)
    const unsubscribe = priceStore.subscribeToBtcUpdates(handlePriceUpdate);
    
    // Safely check and set initial price from store if available and valid
    const currentStorePrice = priceStore.btcPrice;
    if (currentStorePrice !== null && isFinite(currentStorePrice)) {
        setBitcoinPrice(currentStorePrice);
    }

    return () => {
      unsubscribe();
    };
  }, [priceStore]); 

  // Update localStorage and global when currency changes
  const setCurrency = useCallback((newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, newCurrency); // Use correct key
        (window as any).globalBaseCurrency = newCurrency;
        
        window.dispatchEvent(new CustomEvent('currency-change', { 
          detail: { currency: newCurrency } 
        }));
      } catch (error) {
        console.error('Error saving currency preference:', error);
      }
    }
  }, []); // Removed currency from dependency array as setCurrency doesn't depend on it directly

  // Toggle between BTC and USD
  const toggleCurrency = useCallback(() => {
    setCurrency(currency === 'btc' ? 'usd' : 'btc');
  }, [currency, setCurrency]);
  
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
    const effectiveBtcPrice = (btcPriceOverride && isFinite(btcPriceOverride))
      ? btcPriceOverride
      : (isFinite(bitcoinPrice) ? bitcoinPrice : 50000);

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
    bitcoinPrice,
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

export default CurrencyProvider; 