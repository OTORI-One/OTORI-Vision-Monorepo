import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Head from 'next/head';
import { ArrowUpIcon, CurrencyDollarIcon, CircleStackIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import WalletConnector from '../components/WalletConnector';
import PortfolioChart from '../components/PortfolioChart';
import ChartToggle from '../components/ChartToggle';
import { useOVTClient, SATS_PER_BTC } from '../src/hooks/useOVTClient';
import AdminDashboard from '../components/admin/AdminDashboard';
import { useBitcoinPrice } from '../src/hooks/useBitcoinPrice';
import { useLaserEyes } from '@omnisat/lasereyes';
import Layout from '../components/Layout';
import { useTradingModule } from '../src/hooks/useTradingModule';
import { isAdminWallet } from '../src/utils/adminUtils';
import { getGlobalNAVReference, updateGlobalNAVReference } from '../src/utils/priceMovement';
import CurrencyToggle from '../components/CurrencyToggle';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { formatValue } from '../src/lib/formatting';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import priceService from '../src/services/priceService';
import dynamic from 'next/dynamic';

// Import client-only components with dynamic imports
const PriceChart = dynamic(() => import('../components/PriceChart'), { ssr: false });
const NAVDisplay = dynamic(() => import('../components/NAVDisplay'), { ssr: false });

export default function Dashboard() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'price' | 'nav'>('nav');
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [animatingNav, setAnimatingNav] = useState(false);
  const previousNavRef = useRef<number>(0);
  // Add a ref to track currency changes
  const lastCurrencyRef = useRef<string | null>(null);
  
  // Use the currency toggle hook
  const { currency, toggleCurrency, formatValue: formatCurrencyValue } = useCurrencyToggle();
  
  // Get OVT price information
  const { 
    price, 
    btcPriceFormatted, 
    usdPriceFormatted, 
    dailyChange, 
    dailyChangeFormatted, 
    isPositiveChange,
    refreshPrice
  } = useOVTPrice();

  // Get OVTClient data with useEffect for baseCurrency syncing instead of direct use
  const ovtClientData = useOVTClient();
  const { 
    isLoading, 
    error, 
    navData, 
    formatValue,
    fetchNAV,
    ovtPrice: clientOvtPrice,
    formattedOvtPrice: clientFormattedOvtPrice
  } = ovtClientData;
  
  // Extract setBaseCurrency to use it safely in an effect
  const { setBaseCurrency, baseCurrency } = ovtClientData;
  
  const { price: btcPrice } = useBitcoinPrice();
  const { network, address } = useLaserEyes();
  
  // Use the trading hook
  const { buyOVT, sellOVT, getMarketPrice } = useTradingModule();

  // State for admin status
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  
  // Use the portfolio hook instead of managing state directly
  const { positions } = usePortfolio();
  
  // Default starting price in SATs (for server-side rendering)
  const DEFAULT_OVT_PRICE = 300;
  
  // Update wallet connection status when address changes
  useEffect(() => {
    if (typeof window === 'undefined') return; // Only run on client
    
    if (network) {
      // Store the wallet address, not the network name
      const walletAddress = address || network;
      setConnectedAddress(walletAddress);
      // Check if the connected wallet is an admin wallet
      setIsAdmin(isAdminWallet(walletAddress));
    } else {
      setConnectedAddress(null);
      setIsAdmin(false);
    }
  }, [network, address]);
  
  // Periodically refresh data from server
  useEffect(() => {
    if (typeof window === 'undefined') return; // Only run on client
    
    // Initial fetch
    fetchNAV();
    
    // Set up interval for refreshing
    const intervalId = setInterval(() => {
      fetchNAV();
    }, 60000); // Refresh every 60 seconds
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [fetchNAV]);
  
  // Sync currency toggle with OVT client
  useEffect(() => {
    if (typeof window === 'undefined') return; // Only run on client
    
    if (baseCurrency && currency && baseCurrency !== currency && currency !== lastCurrencyRef.current) {
      lastCurrencyRef.current = currency;
      setBaseCurrency(currency);
    }
  }, [currency, baseCurrency, setBaseCurrency]);

  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };
  
  // Handle buy OVT operation
  const handleBuy = async () => {
    if (!buyAmount || parseFloat(buyAmount) <= 0) return;
    
    try {
      setIsSubmitting(true);
      setSuccessMessage(null);
      
      const amount = parseFloat(buyAmount);
      const result = await buyOVT(amount);
      
      setBuyAmount('');
      setSuccessMessage(`Successfully purchased ${amount} OVT!`);
      
      // Simulate a positive impact on the global NAV (0.1-0.5% increase)
      const positiveBump = 0.001 + (Math.random() * 0.004);
      updateGlobalNAVReference(positiveBump);
      
      // Refresh NAV data
      fetchNAV();
    } catch (error) {
      // Reduced error logging - just set the user-facing error
      setNetworkError(error instanceof Error ? error.message : 'Error processing your purchase');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Handle sell OVT operation
  const handleSell = async () => {
    if (!sellAmount || parseFloat(sellAmount) <= 0) return;
    
    try {
      setIsSubmitting(true);
      setSuccessMessage(null);
      
      const amount = parseFloat(sellAmount);
      const result = await sellOVT(amount);
      
      setSellAmount('');
      setSuccessMessage(`Successfully sold ${amount} OVT!`);
      
      // Simulate a small negative impact on the global NAV (0.05-0.2% decrease)
      const negativeBump = -0.0005 - (Math.random() * 0.0015);
      updateGlobalNAVReference(negativeBump);
      
      // Refresh NAV data
      fetchNAV();
    } catch (error) {
      // Reduced error logging - just set the user-facing error
      setNetworkError(error instanceof Error ? error.message : 'Error processing your sale');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <Head>
        <title>OTORI Vision - Dashboard</title>
        <meta name="description" content="OTORI Vision Dashboard - Bitcoin VC Fund" />
      </Head>
      
      <div className="flex flex-col">
        {/* Top Navigation Bar */}
        <div className="bg-white border-b border-primary shadow-sm p-2 sm:p-4 mb-6 rounded-lg">
          <div className="flex flex-col sm:flex-row justify-between items-center">
            <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-6 w-full sm:w-auto mb-3 sm:mb-0">
              {/* Logo */}
              <div className="flex items-center">
                <img className="h-8 w-auto mr-2" src="/logo.svg" alt="OTORI" />
                <span className="text-lg font-bold text-primary">OTORI Vision</span>
              </div>
              
              {/* Navigation Links */}
              <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
                <a href="/" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
                  Dashboard
                </a>
                <a href="/trade" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Trade
                </a>
                <a href="/portfolio" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Portfolio
                </a>
                {isAdmin && (
                  <a href="/admin" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                    Admin
                  </a>
                )}
              </nav>
              
              {/* Centralized NAV Display - Hidden on small screens */}
              <div className="hidden md:block">
                <NAVDisplay showChange={true} size="sm" />
              </div>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* Currency Toggle */}
              <CurrencyToggle size="sm" />
              
              {/* Wallet Connection */}
              <WalletConnector 
                onConnect={handleConnectWallet}
                onDisconnect={handleDisconnectWallet}
                connectedAddress={connectedAddress || undefined}
              />
            </div>
          </div>
          
          {/* NAV Display for mobile */}
          <div className="md:hidden mt-3 flex justify-center">
            <NAVDisplay showChange={true} size="sm" />
          </div>
        </div>
        
        {/* Error Messages */}
        {networkError && (
          <div className="bg-white border border-error p-4 mb-4 rounded-lg text-error">
            <p>{networkError}</p>
          </div>
        )}
        
        {/* Success Message */}
        {successMessage && (
          <div className="bg-white border border-success p-4 mb-4 rounded-lg text-success">
            <p>{successMessage}</p>
          </div>
        )}
        
        {/* Main Dashboard Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section - 2/3 width on large screens */}
          <div className="lg:col-span-2 bg-white border border-primary rounded-lg shadow-sm p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-primary">Portfolio Performance</h2>
              <ChartToggle 
                activeChart={activeChart} 
                onToggle={(chart: 'price' | 'nav') => setActiveChart(chart)} 
              />
            </div>
            
            <div className="h-80">
              {activeChart === 'nav' ? (
                <PortfolioChart />
              ) : (
                <PriceChart />
              )}
            </div>
          </div>
          
          {/* Trading Panel & Info - 1/3 width on large screens */}
          <div className="space-y-6">
            {/* Token Price Card */}
            <div className="bg-white border border-primary rounded-lg shadow-sm p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-primary">OVT Price</h2>
                <button 
                  onClick={async () => {
                    // Force OVT price refresh
                    try {
                      await priceService.triggerOVTPriceUpdate();
                      // Also refresh the NAV data
                      fetchNAV();
                    } catch (err) {
                      console.error('Failed to refresh OVT price:', err);
                    }
                  }}
                  className="text-primary hover:text-primary-dark p-1 rounded-full"
                  title="Refresh OVT Price"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-primary">Current Price:</span>
                  <span className="text-primary font-medium text-lg">
                    {currency === 'usd' ? usdPriceFormatted : btcPriceFormatted}
                  </span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-primary">24h Change:</span>
                  <span className={`font-medium ${isPositiveChange ? 'text-success' : 'text-error'}`}>
                    {dailyChangeFormatted}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Trading Panel - Only show if wallet is connected */}
            {connectedAddress && (
              <div className="bg-white border border-primary rounded-lg shadow-sm p-4">
                <h2 className="text-xl font-semibold text-primary mb-4">Trade OVT</h2>
                
                {/* Buy OVT Form */}
                <div className="mb-4">
                  <label className="block text-primary mb-2">Buy OVT</label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={buyAmount}
                      onChange={(e) => setBuyAmount(e.target.value)}
                      className="flex-grow bg-white border border-primary border-opacity-20 text-primary rounded p-2"
                      placeholder="Amount"
                      disabled={isSubmitting}
                    />
                    <button
                      onClick={handleBuy}
                      disabled={isSubmitting || !buyAmount}
                      className="bg-success hover:bg-success/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                      Buy
                    </button>
                  </div>
                </div>
                
                {/* Sell OVT Form */}
                <div>
                  <label className="block text-primary mb-2">Sell OVT</label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      className="flex-grow bg-white border border-primary border-opacity-20 text-primary rounded p-2"
                      placeholder="Amount"
                      disabled={isSubmitting}
                    />
                    <button
                      onClick={handleSell}
                      disabled={isSubmitting || !sellAmount}
                      className="bg-error hover:bg-error/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                      Sell
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
} 