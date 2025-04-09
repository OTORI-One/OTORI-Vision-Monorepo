import React, { useState, useEffect, useMemo } from 'react';
import { Switch } from '@headlessui/react';
import { ArrowUpIcon, ArrowDownIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import TransactionHistory from './TransactionHistory';
import { RuneMetadata } from '../src/hooks/useRuneIntegration';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';

// Define props for the controlled component
interface TradingInterfaceProps {
  buyAmount: string;
  setBuyAmount: (value: string) => void;
  sellAmount: string;
  setSellAmount: (value: string) => void;
  handleBuy: () => Promise<void>; 
  handleSell: () => Promise<void>;
  isActionLoading: boolean;
  metadata: RuneMetadata | null; 
  formatTokenAmount: (amount: number, divisibility?: number) => string;
  ovtBalance: number;
  displayedMarketPrice: string;
}

// Changed to named export and accept props
export function TradingInterface(props: TradingInterfaceProps) {
  const {
    buyAmount,
    setBuyAmount,
    sellAmount,
    setSellAmount,
    handleBuy,
    handleSell,
    isActionLoading,
    metadata,
    formatTokenAmount,
    ovtBalance,
    displayedMarketPrice,
  } = props;

  // Remove internal state for amounts, status, errors, price impact, limit orders
  // const [buyAmount, setBuyAmount] = useState<string>('');
  // const [sellAmount, setSellAmount] = useState<string>('');
  // const [isLimitOrder, setIsLimitOrder] = useState<boolean>(false);
  // const [limitBuyPrice, setLimitBuyPrice] = useState<string>('');
  // const [limitSellPrice, setLimitSellPrice] = useState<string>('');
  // const [buyPriceImpact, setBuyPriceImpact] = useState<number | null>(null);
  // const [sellPriceImpact, setSellPriceImpact] = useState<number | null>(null);
  // const [buyStatus, setBuyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  // const [sellStatus, setSellStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  // const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Remove direct hook usage
  // const { 
  //   buyOVT, 
  //   sellOVT, 
  //   isLoading: isRuneLoading,
  //   error: runeError,
  //   balance: ovtBalance,
  //   getBalance,
  //   getTransactionHistory
  // } = useRuneIntegration();
  // const { price: ovtPrice, btcPriceFormatted, usdPriceFormatted } = useOVTPrice();
  // const { currency, formatValue } = useCurrencyToggle(); // Keep currency for formatting if needed
  // const { positions } = usePortfolio();

  // Remove internal market price state and effects
  // const [marketPrice, setMarketPrice] = useState<number>(0);
  // useEffect(() => { ... fetchMarketPrice ... }, [ovtPrice]);
  // useEffect(() => { ... calculateBuyPriceImpact ... }, [buyAmount]);
  // useEffect(() => { ... calculateSellPriceImpact ... }, [sellAmount]);
  
  // Keep for currency formatting if needed directly here, otherwise remove
  const { currency, formatValue } = useCurrencyToggle(); 

  // Simplified amount change handlers - just call the prop function
  const handleBuyAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setBuyAmount(value);
    }
  };
  
  const handleSellAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setSellAmount(value);
    }
  };

  // Remove internal handleBuy/handleSell functions - use props instead
  // const handleBuy = async () => { ... };
  // const handleSell = async () => { ... };

  // Remove limit order logic and related handlers/calculations
  // const toggleOrderType = () => { ... };
  // const calculateBuyCost = (): number => { ... };
  // const calculateSellReturn = (): number => { ... };
  // const handleLimitBuyPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => { ... };
  // const handleLimitSellPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => { ... };

  // Transaction history state/toggle (can be kept if desired, managed by parent)
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const toggleHistory = () => setShowHistory(!showHistory); // Simple toggle

  // Placeholder/Default for formatting if metadata is null initially
  const effectiveDivisibility = metadata?.divisibility ?? 2; 
  const placeholderAmount = 100 * Math.pow(10, effectiveDivisibility);
  const formattedPlaceholder = formatTokenAmount(placeholderAmount, effectiveDivisibility);

  // Return component JSX, using props for state and handlers
  return (
    <div className="flex flex-col space-y-4">
      {/* History Toggle Button (Optional) */}
      {/* <div className="flex justify-end">
        <button 
          onClick={toggleHistory}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {showHistory ? 'Hide' : 'View'} Transaction History
        </button>
      </div> */}

      {/* Remove internal Error/success messages - handled by parent */}
      {/* {errorMessage && (...)} */}
      {/* {successMessage && (...)} */}
      
      {/* Transaction History Component (Optional) */}
      {/* {showHistory && <TransactionHistory limit={5} showExport={true} />} */}

      {/* Main Trading UI */} 
      {/* <> Remove fragment if history section is removed */}
        {/* Market price display - Use prop */}
        <div className="text-center mb-2">
          <p className="text-gray-600">Current Market Price (Approx)</p>
          <p className="text-xl font-bold">
            {displayedMarketPrice} per OVT
          </p>
        </div>
        
        {/* OVT Balance display - Use prop */}
        <div className="text-center mb-4 p-2 bg-blue-50 rounded">
          <p className="text-gray-600">Your OVT Balance</p>
          {/* Format the balance prop */} 
          <p className="text-lg font-bold text-blue-700">
             {formatTokenAmount(ovtBalance ?? 0, effectiveDivisibility)} OVT
          </p>
        </div>
        
        {/* Remove Market/Limit order toggle */}
        {/* <div className="flex items-center justify-center mb-4">...</div> */}
        
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
                  type="text" // Use text for better control with regex
                  value={buyAmount} // Use prop
                  onChange={handleBuyAmountChange} // Use updated handler
                  className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder={`e.g., ${formattedPlaceholder}`}
                  aria-label="Buy Amount"
                  disabled={isActionLoading} // Use prop
                />
                 {/* Simple validation message (optional) */}
                 {buyAmount && parseFloat(buyAmount) <= 0 && (
                   <p className="text-red-500 text-xs mt-1">Amount must be positive</p>
                 )}
              </div>
              
              {/* Removed Limit Order Input */}
              {/* {isLimitOrder && (...)} */}
              
              {/* Removed Estimated Cost Display - can add back if needed */}
              {/* <div> ... Estimated Cost: ... </div> */}
              
              <button
                onClick={handleBuy} // Use prop
                disabled={isActionLoading || !buyAmount || parseFloat(buyAmount) <= 0} // Use prop
                className="w-full px-4 py-2 bg-green-600 text-white font-medium rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
              >
                {isActionLoading ? <ArrowPathIcon className="h-5 w-5 animate-spin"/> : 'Buy OVT'}
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
                  type="text" // Use text for better control with regex
                  value={sellAmount} // Use prop
                  onChange={handleSellAmountChange} // Use updated handler
                  className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder={`e.g., ${formatTokenAmount(placeholderAmount / 2, effectiveDivisibility)}`}
                  aria-label="Sell Amount"
                  disabled={isActionLoading} // Use prop
                />
                 {/* Simple validation message (optional) */}
                 {sellAmount && parseFloat(sellAmount) <= 0 && (
                   <p className="text-red-500 text-xs mt-1">Amount must be positive</p>
                 )}
              </div>
              
              {/* Removed Limit Order Input */}
              {/* {isLimitOrder && (...)} */}
              
              {/* Removed Estimated Return Display */}
              {/* <div> ... Estimated Return: ... </div> */}
              
              <button
                onClick={handleSell} // Use prop
                disabled={isActionLoading || !sellAmount || parseFloat(sellAmount) <= 0} // Use prop
                className="w-full px-4 py-2 bg-red-600 text-white font-medium rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
              >
                {isActionLoading ? <ArrowPathIcon className="h-5 w-5 animate-spin"/> : 'Sell OVT'}
              </button>
            </div>
          </div>
        </div>
      {/* </> */}
    </div>
  );
}

// Export default if needed for dynamic import, though named export is often preferred
// export default TradingInterface; 