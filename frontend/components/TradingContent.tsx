import React from 'react';
import { TradingInterface } from './TradingInterface';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useNAV } from '../src/hooks/useNAV';
import dynamic from 'next/dynamic';
import { formatSatsToCurrency, formatNumber } from '../src/utils/formatters';
import PriceChart from './PriceChart';
import { RuneMetadata } from '../src/hooks/useRuneIntegration';

interface TradingContentProps {
  isConnected: boolean;
  connectedAddress: string | null;
  walletAddress?: string;
  laserEyesWallets: string[];
  tradingDataSource: {
    isMock: boolean;
    label: string;
    color: string;
  };
  buyAmount: string;
  setBuyAmount: (value: string) => void;
  sellAmount: string;
  setSellAmount: (value: string) => void;
  handleBuy: () => Promise<void>;
  handleSell: () => Promise<void>;
  isActionLoading: boolean;
  metadata: RuneMetadata | null;
  ovtBalance: number;
  displayedMarketPrice: string;
}

const TradingContent: React.FC<TradingContentProps> = ({
  isConnected,
  connectedAddress,
  walletAddress,
  laserEyesWallets,
  tradingDataSource,
  buyAmount,
  setBuyAmount,
  sellAmount,
  setSellAmount,
  handleBuy,
  handleSell,
  isActionLoading,
  metadata,
  ovtBalance,
  displayedMarketPrice
}) => {
  const { nav, loading: navLoading, error: navError } = useNAV();
  const { 
      price: currentOvtPriceSats, // Assuming 'price' from hook is in sats
      isLoading: priceLoading, 
      error: priceError 
  } = useOVTPrice(); 
  const { currency, getBitcoinPrice } = useCurrencyToggle();
  const baseCurrency = currency;
  const btcPrice = getBitcoinPrice();
  
  // Combine loading states
  const isLoading = navLoading || priceLoading;
  const combinedError = navError || priceError;

  // Extract relevant data safely using correct property names from useNAV
  const currentNAV = nav?.navSats ?? 0; // Use navSats
  const circulatingSupply = nav?.totalTokenSupply ?? 0; // Use totalTokenSupply
  const formattedNAV = formatSatsToCurrency(currentNAV, baseCurrency, btcPrice);
  const formattedOvtPrice = formatSatsToCurrency(currentOvtPriceSats, baseCurrency, btcPrice);

  if (combinedError) {
    console.error("TradingContent Error:", combinedError);
    return (
      <div className="flex-1 p-4 md:p-6 space-y-4 md:space-y-6">
        <div className="bg-red-100 border border-red-500 p-4 rounded">
           <h3 className="text-red-700 font-bold flex items-center">
             Error Loading Trading Data
           </h3>
           <div className="text-red-600 mt-2">
             <p>Could not load necessary data. Please try refreshing the page.</p>
             <p className="text-xs mt-1">Details: {combinedError}</p>
           </div>
        </div>
      </div>
    );
  }

  if (isLoading && !nav && !currentOvtPriceSats) { 
    return (
      <div className="flex-1 p-4 md:p-6 grid gap-4 md:gap-6 grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-4 md:space-y-6">
          <div className="border p-4 rounded"><p className="text-muted-foreground">Loading NAV...</p></div>
          <div className="border p-4 rounded"><p className="text-muted-foreground">Loading Price...</p></div>
          <div className="border p-4 rounded"><p className="text-muted-foreground">Loading Supply...</p></div>
        </div>
        <div className="lg:col-span-2 border p-4 rounded">
           <h3 className="font-bold mb-2">Trade OVT</h3>
           <div className="space-y-4">
             <div className="h-10 bg-gray-200 rounded w-full"></div>
             <div className="h-10 bg-gray-200 rounded w-full"></div>
             <div className="h-10 bg-gray-200 rounded w-1/4"></div>
           </div>
        </div>
        <div className="lg:col-span-3 border p-4 rounded h-[300px] md:h-[400px]">
           <h3 className="font-bold mb-2">OVT Price History (Sats)</h3>
           <div className="h-full w-full bg-gray-200 rounded flex items-center justify-center">
             <p className="text-muted-foreground">Loading chart...</p>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-6 grid gap-4 md:gap-6 grid-cols-1 lg:grid-cols-3">
      <div className="lg:col-span-1 space-y-4 md:space-y-6">
        <div className="bg-card border border-border shadow-sm p-4 rounded">
          <h3 className="text-sm font-medium text-muted-foreground pb-2">Fund NAV</h3>
          <div className="text-2xl font-bold">
             {formattedNAV}
             {navLoading && <span className="text-xs text-muted-foreground ml-2">(Updating...)</span>}
          </div>
        </div>
         <div className="bg-card border border-border shadow-sm p-4 rounded">
          <h3 className="text-sm font-medium text-muted-foreground pb-2">OVT Price</h3>
          <div className="text-2xl font-bold">
             {displayedMarketPrice}
             {priceLoading && <span className="text-xs text-muted-foreground ml-2">(Updating...)</span>}
          </div>
        </div>
        <div className="bg-card border border-border shadow-sm p-4 rounded">
          <h3 className="text-sm font-medium text-muted-foreground pb-2">Circulating Supply</h3>
          <div className="text-2xl font-bold">
             {formatNumber(circulatingSupply, 0)} OVT
             {navLoading && <span className="text-xs text-muted-foreground ml-2">(Updating...)</span>}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 bg-card border border-border shadow-sm p-4 rounded">
        <h3 className="text-lg font-bold mb-4">Trade OVT</h3>
         <TradingInterface 
            buyAmount={buyAmount}
            setBuyAmount={setBuyAmount}
            sellAmount={sellAmount}
            setSellAmount={setSellAmount}
            handleBuy={handleBuy}
            handleSell={handleSell}
            isActionLoading={isActionLoading}
            metadata={metadata}
            ovtBalance={ovtBalance}
            displayedMarketPrice={displayedMarketPrice}
         />
      </div>

      <div className="lg:col-span-3 bg-card border border-border shadow-sm p-4 rounded h-[300px] md:h-[400px]">
         <h3 className="text-lg font-bold mb-4">OVT Price History (Sats)</h3>
         <div className="h-[calc(100%-2rem)] pb-6">
           <PriceChart baseCurrency="btc" />
         </div>
       </div>

    </div>
  );
};

export default TradingContent; 