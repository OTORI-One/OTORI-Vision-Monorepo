import React, { useState, useEffect, useMemo } from 'react';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { useBitcoinPrice } from '../src/hooks/useBitcoinPrice';
import { SATS_PER_BTC, updateGlobalOVTPrice } from '../src/hooks/useOVTClient';
import { Switch } from '@headlessui/react';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline';
import DataSourceIndicator from './DataSourceIndicator';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useRuneIntegration } from '../src/hooks/useRuneIntegration';
import TransactionHistory from './TransactionHistory';

interface PriceDisplay {
  impact: number | null;
  total: number | null;
}

// Changed to named export for better compatibility with testing
export function TradingInterface() {
  // State for buy/sell forms
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [isLimitOrder, setIsLimitOrder] = useState<boolean>(false);
  const [limitBuyPrice, setLimitBuyPrice] = useState<string>('');
  const [limitSellPrice, setLimitSellPrice] = useState<string>('');
  
  // State for price impact and expected return
  const [buyPriceImpact, setBuyPriceImpact] = useState<number | null>(null);
  const [sellPriceImpact, setSellPriceImpact] = useState<number | null>(null);
  
  // State for transaction feedback
  const [buyStatus, setBuyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sellStatus, setSellStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Get rune integration hook for real transaction handling
  const { 
    buyOVT, 
    sellOVT, 
    isLoading: isRuneLoading,
    error: runeError,
    balance: ovtBalance,
    getBalance,
    getTransactionHistory
  } = useRuneIntegration();
  
  // Use our hooks for consistent data across the app
  const { price: ovtPrice, btcPriceFormatted, usdPriceFormatted } = useOVTPrice();
  const { currency, formatValue } = useCurrencyToggle();
  const { positions } = usePortfolio();
  
  // State for market price
  const [marketPrice, setMarketPrice] = useState<number>(0);
  
  // Use relevant components from hooks
  const [activeBuySellTab, setActiveBuySellTab] = useState<'buy' | 'sell'>('buy');
  const [showHistory, setShowHistory] = useState<boolean>(false);
  
  // Format the displayed market price
  const displayedMarketPrice = useMemo(() => {
    // Always use the portfolio data for consistency
    return formatValue(ovtPrice);
  }, [formatValue, ovtPrice]);
  
  // Neatly format the price impact for display
  const formatPriceImpact = (impact: number | null): string => {
    if (impact === null || isNaN(impact)) return '0.00%';
    return `${impact >= 0 ? '+' : ''}${impact.toFixed(2)}%`;
  };
  
  // Fetch market price on component mount
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    const fetchMarketPrice = async () => {
      try {
        setMarketPrice(ovtPrice);
        // Update the global OVT price state for consistency
        updateGlobalOVTPrice(ovtPrice);
      } catch (error) {
        console.error('Error setting market price:', error);
      }
    };
    
    // Run immediately once
    fetchMarketPrice();
    
    // Set up periodic price updates - store reference to clear later
    intervalId = setInterval(fetchMarketPrice, 10000); // Update every 10 seconds
    
    // Cleanup function to prevent memory leaks
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  }, [ovtPrice]);
  
  // Calculate price impact when buy amount changes
  useEffect(() => {
    const calculateBuyPriceImpact = async () => {
      const amount = parseFloat(buyAmount);
      if (!isNaN(amount) && amount > 0) {
        try {
          // Simple price impact calculation (could be improved with liquidity depth)
          const impact = (amount / 10000) * 100; // Simple 1% impact per 10,000 OVT
          setBuyPriceImpact(impact);
        } catch (error) {
          console.error('Error calculating buy price impact:', error);
          setBuyPriceImpact(null);
        }
      } else {
        setBuyPriceImpact(null);
      }
    };
    
    calculateBuyPriceImpact();
  }, [buyAmount]);
  
  // Calculate price impact when sell amount changes
  useEffect(() => {
    const calculateSellPriceImpact = async () => {
      const amount = parseFloat(sellAmount);
      if (!isNaN(amount) && amount > 0) {
        try {
          // Simple price impact calculation (could be improved with liquidity depth)
          const impact = -(amount / 10000) * 100; // Negative impact for sells
          setSellPriceImpact(impact);
        } catch (error) {
          console.error('Error calculating sell price impact:', error);
          setSellPriceImpact(null);
        }
      } else {
        setSellPriceImpact(null);
      }
    };
    
    calculateSellPriceImpact();
  }, [sellAmount]);
  
  // Handle buy amount change
  const handleBuyAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow positive numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setBuyAmount(value);
    }
  };
  
  // Handle sell amount change
  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow positive numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setSellAmount(value);
    }
  };
  
  // Handle limit price changes
  const handleLimitBuyPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setLimitBuyPrice(value);
    }
  };
  
  const handleLimitSellPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setLimitSellPrice(value);
    }
  };
  
  // Handle buy submit
  const handleBuy = async () => {
    const amount = parseFloat(buyAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Please enter a valid amount');
      return;
    }
    
    setBuyStatus('loading');
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      let maxPrice: number | undefined;
      if (isLimitOrder && limitBuyPrice) {
        maxPrice = parseFloat(limitBuyPrice);
        if (isNaN(maxPrice) || maxPrice <= 0) {
          throw new Error('Invalid limit price');
        }
      }
      
      const result = await buyOVT(amount, maxPrice);
      setBuyStatus('success');
      setSuccessMessage(`Transaction Confirmed: Bought ${amount} OVT at ${formatValue(result.price || marketPrice)} per token`);
      setBuyAmount('');
      setLimitBuyPrice('');
      
      // Ensure transaction history is updated
      await getTransactionHistory();
    } catch (error) {
      setBuyStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Error executing buy order');
      console.error('Buy error:', error);
    }
  };
  
  // Handle sell submit
  const handleSell = async () => {
    const amount = parseFloat(sellAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Please enter a valid amount');
      return;
    }
    
    setSellStatus('loading');
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      let minPrice: number | undefined;
      if (isLimitOrder && limitSellPrice) {
        minPrice = parseFloat(limitSellPrice);
        if (isNaN(minPrice) || minPrice <= 0) {
          throw new Error('Invalid limit price');
        }
      }
      
      const result = await sellOVT(amount, minPrice);
      setSellStatus('success');
      setSuccessMessage(`Transaction Confirmed: Sold ${amount} OVT at ${formatValue(result.price || marketPrice)} per token`);
      setSellAmount('');
      setLimitSellPrice('');
      
      // Ensure transaction history is updated
      await getTransactionHistory();
    } catch (error) {
      setSellStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Error executing sell order');
      console.error('Sell error:', error);
    }
  };
  
  // Toggle order type
  const toggleOrderType = () => {
    setIsLimitOrder(!isLimitOrder);
    // Reset error/success states
    setErrorMessage(null);
    setSuccessMessage(null);
  };
  
  // Calculate total cost for buy
  const calculateBuyCost = (): number => {
    const amount = parseFloat(buyAmount);
    if (isNaN(amount) || amount <= 0) {
      return 0;
    }
    
    // Use market price if no impact
    const effectivePrice = marketPrice * (1 + (buyPriceImpact || 0) / 100);
    return Math.floor(amount * effectivePrice);
  };
  
  // Calculate total return for sell
  const calculateSellReturn = (): number => {
    const amount = parseFloat(sellAmount);
    if (isNaN(amount) || amount <= 0) {
      return 0;
    }
    
    // Use market price if no impact
    const effectivePrice = marketPrice * (1 + (sellPriceImpact || 0) / 100);
    return Math.floor(amount * effectivePrice);
  };
  
  // Format price according to selected currency
  const formatCurrencyValue = (satValue: number): string => {
    if (satValue === 0 || isNaN(satValue)) {
      return currency === 'usd' ? '$0.00' : '0 sats';
    }
    return formatValue(satValue);
  };
  
  // Toggle transaction history visibility
  const toggleHistory = () => {
    setShowHistory(!showHistory);
    if (!showHistory) {
      // Refresh transaction history when showing
      getTransactionHistory().catch(console.error);
    }
  };
  
  // Return component JSX
  return (
    <div className="flex flex-col space-y-4 p-4 bg-white rounded-lg shadow-md">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-800">Trading Interface</h2>
        
        <button 
          onClick={toggleHistory}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {showHistory ? 'Hide' : 'View'} Transaction History
        </button>
      </div>
      
      {/* Error/success messages */}
      {errorMessage && (
        <div className="p-3 bg-red-100 text-red-800 rounded mb-3">
          {errorMessage}
        </div>
      )}
      
      {successMessage && (
        <div className="p-3 bg-green-100 text-green-800 rounded mb-3">
          {successMessage}
        </div>
      )}
      
      {showHistory ? (
        <TransactionHistory limit={5} showExport={true} />
      ) : (
        <>
          {/* Market price display */}
          <div className="text-center mb-2">
            <p className="text-gray-600">Current Market Price</p>
            <p className="text-xl font-bold currency-dependent" data-currency={currency}>
              {displayedMarketPrice} per OVT
            </p>
          </div>
          
          {/* OVT Balance display */}
          <div className="text-center mb-4 p-2 bg-blue-50 rounded">
            <p className="text-gray-600">Your OVT Balance</p>
            <p className="text-lg font-bold text-blue-700">{ovtBalance} OVT</p>
          </div>
          
          {/* Market/Limit order toggle */}
          <div className="flex items-center justify-center mb-4">
            <span className="mr-2 text-sm text-gray-700">Market Order</span>
            <Switch
              checked={isLimitOrder}
              onChange={toggleOrderType}
              className={`${
                isLimitOrder ? 'bg-indigo-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
              aria-label="Order Type"
            >
              <span
                className={`${
                  isLimitOrder ? 'translate-x-6' : 'translate-x-1'
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
            <span className="ml-2 text-sm text-gray-700">Limit Order</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Buy panel */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-100">
              <h3 className="text-lg font-semibold text-green-800 mb-3">Buy OVT</h3>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="buyAmount" className="block text-sm font-medium text-gray-700 mb-1">
                    Buy Amount
                  </label>
                  <input
                    id="buyAmount"
                    type="text"
                    value={buyAmount}
                    onChange={handleBuyAmountChange}
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Amount of OVT to buy"
                    aria-label="Buy Amount"
                  />
                  {parseFloat(buyAmount) < 0 && (
                    <p className="text-red-500 text-xs mt-1">Amount must be positive</p>
                  )}
                </div>
                
                {isLimitOrder && (
                  <div>
                    <label htmlFor="limitBuyPrice" className="block text-sm font-medium text-gray-700 mb-1">
                      Limit Price
                    </label>
                    <input
                      id="limitBuyPrice"
                      type="text"
                      value={limitBuyPrice}
                      onChange={handleLimitBuyPriceChange}
                      className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Maximum price in sats"
                      aria-label="Limit Price"
                    />
                    {limitBuyPrice && (
                      <p className="text-gray-600 text-xs mt-1">
                        Price: {limitBuyPrice} sats/OVT
                      </p>
                    )}
                  </div>
                )}
                
                {buyAmount && parseFloat(buyAmount) > 0 && (
                  <div>
                    {buyPriceImpact !== null && (
                      <>
                        <p className="text-gray-700 text-sm mb-1">Estimated Price Impact</p>
                        <p className="font-medium text-green-700">{formatPriceImpact(buyPriceImpact)}</p>
                      </>
                    )}
                    
                    <p className="text-gray-700 text-sm mt-2 mb-1">Estimated Cost</p>
                    <p className="font-medium text-green-700">{formatCurrencyValue(calculateBuyCost())}</p>
                  </div>
                )}
                
                <button
                  onClick={handleBuy}
                  disabled={buyStatus === 'loading' || !buyAmount || parseFloat(buyAmount) <= 0}
                  className={`w-full py-2 px-4 rounded font-medium ${
                    buyStatus === 'loading'
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'
                  }`}
                >
                  {buyStatus === 'loading' ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing
                    </span>
                  ) : (
                    'Buy OVT'
                  )}
                </button>
              </div>
            </div>
            
            {/* Sell panel */}
            <div className="bg-red-50 p-4 rounded-lg border border-red-100">
              <h3 className="text-lg font-semibold text-red-800 mb-3">Sell OVT</h3>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="sellAmount" className="block text-sm font-medium text-gray-700 mb-1">
                    Sell Amount
                  </label>
                  <input
                    id="sellAmount"
                    type="text"
                    value={sellAmount}
                    onChange={handleSellAmountChange}
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Amount of OVT to sell"
                    aria-label="Sell Amount"
                  />
                  {parseFloat(sellAmount) < 0 && (
                    <p className="text-red-500 text-xs mt-1">Amount must be positive</p>
                  )}
                  
                  {parseFloat(sellAmount) > ovtBalance && (
                    <p className="text-red-500 text-xs mt-1">Insufficient balance</p>
                  )}
                </div>
                
                {isLimitOrder && (
                  <div>
                    <label htmlFor="limitSellPrice" className="block text-sm font-medium text-gray-700 mb-1">
                      Limit Price
                    </label>
                    <input
                      id="limitSellPrice"
                      type="text"
                      value={limitSellPrice}
                      onChange={handleLimitSellPriceChange}
                      className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Minimum price in sats"
                      aria-label="Limit Price"
                    />
                    {limitSellPrice && (
                      <p className="text-gray-600 text-xs mt-1">
                        Price: {limitSellPrice} sats/OVT
                      </p>
                    )}
                  </div>
                )}
                
                {sellAmount && parseFloat(sellAmount) > 0 && (
                  <div>
                    {sellPriceImpact !== null && (
                      <>
                        <p className="text-gray-700 text-sm mb-1">Estimated Price Impact</p>
                        <p className="font-medium text-red-700">{formatPriceImpact(sellPriceImpact)}</p>
                      </>
                    )}
                    
                    <p className="text-gray-700 text-sm mt-2 mb-1">Expected Return</p>
                    <p className="font-medium text-red-700">{formatCurrencyValue(calculateSellReturn())}</p>
                  </div>
                )}
                
                <button
                  onClick={handleSell}
                  disabled={
                    sellStatus === 'loading' || 
                    !sellAmount || 
                    parseFloat(sellAmount) <= 0 ||
                    parseFloat(sellAmount) > ovtBalance
                  }
                  className={`w-full py-2 px-4 rounded font-medium ${
                    sellStatus === 'loading' || parseFloat(sellAmount) > ovtBalance
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'
                  }`}
                >
                  {sellStatus === 'loading' ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing
                    </span>
                  ) : (
                    'Sell OVT'
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Add default export that references the named export for backward compatibility
export default TradingInterface; 