import type { AppProps } from 'next/app';
import { LaserEyesProvider, BaseNetwork } from '@omnisat/lasereyes';
import { useEffect } from 'react';
import { ensurePortfolioDataLoaded } from '../src/utils/portfolioLoader';
import { useBitcoinPrice } from '../src/hooks/useBitcoinPrice';
import { CurrencyProvider } from '../src/hooks/useCurrencyToggle';
import { getPriceStore } from '../src/services/priceService';
import '@/styles/globals.css';

// Initialize global BTC price for formatting utilities
declare global {
  interface Window {
    btcPrice: number;
    globalBaseCurrency: 'btc' | 'usd';
  }
}

export default function App({ Component, pageProps }: AppProps) {
  // Get Bitcoin price from hook
  const { price: btcPrice } = useBitcoinPrice();

  // Inject mock data on client-side
  useEffect(() => {
    ensurePortfolioDataLoaded();
    
    // Listen for wallet connection events from WalletConnector
    const handleWalletConnection = (e: CustomEvent) => {
      console.log('[_app.tsx] Detected wallet connection:', e.detail.address);
      // This can be used to update global state if needed
    };
    
    window.addEventListener('wallet-connected', handleWalletConnection as EventListener);
    return () => {
      window.removeEventListener('wallet-connected', handleWalletConnection as EventListener);
    };
  }, []);
  
  // Set global Bitcoin price when it's available
  useEffect(() => {
    if (typeof window !== 'undefined' && btcPrice) {
      window.btcPrice = btcPrice;
      
      // Dispatch an event for the currency provider to pick up
      window.dispatchEvent(new CustomEvent('btcprice-update', { 
        detail: { price: btcPrice } 
      }));
      
      console.log('[_app.tsx] Updated global BTC price:', btcPrice);
    }
  }, [btcPrice]);
  
  // Initialize PriceStore WebSocket connection on app mount
  useEffect(() => {
    console.log('App mounted, initializing PriceStore...');
    const priceStore = getPriceStore();
    priceStore.initialize();

    // Optional: Clean disconnect on unmount (though usually not needed for app lifecycle)
    // return () => {
    //   console.log('App unmounting, disconnecting PriceStore WebSocket...');
    //   priceStore.disconnectWebSocket(); 
    // };
  }, []);
  
  console.log('[_app.tsx] Initializing LaserEyesProvider with config:', {
    network: BaseNetwork.SIGNET,
    timestamp: new Date().toISOString()
  });
  
  return (
    <LaserEyesProvider 
      config={{ 
        network: BaseNetwork.SIGNET
      }}
    >
      <CurrencyProvider initialCurrency="usd">
        <Component {...pageProps} />
      </CurrencyProvider>
    </LaserEyesProvider>
  );
}