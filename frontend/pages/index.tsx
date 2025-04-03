import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Head from 'next/head';
import { ArrowUpIcon, CurrencyDollarIcon, CircleStackIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import WalletConnector from '../components/WalletConnector';
import PortfolioChart from '../components/PortfolioChart';
import ChartToggle from '../components/ChartToggle';
import AdminDashboard from '../components/admin/AdminDashboard';
import { useLaserEyes } from '@omnisat/lasereyes';
import Layout from '../components/Layout';
import { useTradingModule } from '../src/hooks/useTradingModule';
import { isAdminWallet } from '../src/utils/adminUtils';
import { getGlobalNAVReference, updateGlobalNAVReference } from '../src/utils/priceMovement';
import CurrencyToggle from '../components/CurrencyToggle';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import dynamic from 'next/dynamic';
import TransactionConfirmationModal from '../components/TransactionConfirmationModal';
import useRuneIntegration from '../src/hooks/useRuneIntegration';

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
  
  // Add confirmation state
  const [showConfirmation, setShowConfirmation] = useState<boolean>(false);
  const [isProcessingTx, setIsProcessingTx] = useState<boolean>(false);
  
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
    isLoading: ovtPriceLoading,
  } = useOVTPrice();

  const { network, address } = useLaserEyes();
  
  // Use the RuneIntegration hook for real wallet transactions
  const { 
    buyOVT: runesBuyOVT,
    sellOVT: runesSellOVT,
    isLoading: runesLoading,
    error: runesError
  } = useRuneIntegration();
  
  // Use the trading hook with the updated confirmation pattern
  const { 
    buyOVT, 
    sellOVT, 
    executeTransaction,
    pendingTransaction,
    setPendingTransaction, 
    error: tradingError
  } = useTradingModule();

  // State for admin status
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  
  // Use the portfolio hook instead of managing state directly
  const { positions } = usePortfolio();
  
  // Default starting price in SATs (for server-side rendering)
  const DEFAULT_OVT_PRICE = 300;
  
  // Only show real data from the API, no randomly generated fallbacks
  const displayedChangePercentage = useMemo(() => {
    return {
      changeText: dailyChangeFormatted, 
      isPositive: isPositiveChange
    };
  }, [dailyChangeFormatted, isPositiveChange]);
  
  // Wallet connection handlers
  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };
  
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
  
  // Handle pending transactions (confirmation flow)
  useEffect(() => {
    if (pendingTransaction) {
      setShowConfirmation(true);
    }
  }, [pendingTransaction]);

  // Cancel a pending transaction
  const handleCancelTransaction = () => {
    setPendingTransaction(null);
    setShowConfirmation(false);
  };

  // Confirm and execute a transaction
  const handleConfirmTransaction = async () => {
    if (!pendingTransaction) return;
    
    setIsProcessingTx(true);
    setNetworkError(null);
    setSuccessMessage(null);
    
    try {
      let result;
      if (pendingTransaction.type === 'buy') {
        result = await runesBuyOVT(pendingTransaction.amount, pendingTransaction.price);
      } else {
        result = await runesSellOVT(pendingTransaction.amount, pendingTransaction.price);
      }
      
      setSuccessMessage(`Successfully ${pendingTransaction.type === 'buy' ? 'purchased' : 'sold'} ${pendingTransaction.amount} OVT`);
      
      if (pendingTransaction.type === 'buy') {
        setBuyAmount('');
      } else {
        setSellAmount('');
      }
      
    } catch (err) {
      console.error('Transaction failed:', err);
      setNetworkError(runesError || (err instanceof Error ? err.message : 'Transaction failed'));
    } finally {
      setIsProcessingTx(false);
      setShowConfirmation(false);
    }
  };
  
  // Handle buy OVT operation
  const handleBuy = async () => {
    if (!buyAmount || parseFloat(buyAmount) <= 0) return;
    
    try {
      setNetworkError(null);
      setSuccessMessage(null);
      
      const amount = parseFloat(buyAmount);
      await buyOVT(amount);
    } catch (error) {
      setNetworkError(tradingError || (error instanceof Error ? error.message : 'Error preparing purchase'));
    }
  };
  
  // Handle sell OVT operation
  const handleSell = async () => {
    if (!sellAmount || parseFloat(sellAmount) <= 0) return;
    
    try {
      setNetworkError(null);
      setSuccessMessage(null);
      
      const amount = parseFloat(sellAmount);
      await sellOVT(amount);
    } catch (error) {
      setNetworkError(tradingError || (error instanceof Error ? error.message : 'Error preparing sale'));
    }
  };

  // Combine loading states for disabling buttons
  const isActionLoading = isSubmitting || isProcessingTx || runesLoading || ovtPriceLoading;

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
                <a href="/wallet" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Wallet
                </a>
                {isAdmin && (
                  <>
                    <a href="/portfolio" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                      Portfolio
                    </a>
                    <a href="/admin" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                      Admin
                    </a>
                  </>
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
                showTokens={false}
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
                  <span className={`font-medium ${displayedChangePercentage.isPositive ? 'text-success' : 'text-error'}`}>
                    {displayedChangePercentage.changeText}
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
                      disabled={isActionLoading}
                    />
                    <button
                      onClick={handleBuy}
                      disabled={isActionLoading || !buyAmount}
                      className="bg-success hover:bg-success/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                      {runesLoading && pendingTransaction?.type === 'buy' ? 'Buying...' : 'Buy'}
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
                      disabled={isActionLoading}
                    />
                    <button
                      onClick={handleSell}
                      disabled={isActionLoading || !sellAmount}
                      className="bg-error hover:bg-error/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                      {runesLoading && pendingTransaction?.type === 'sell' ? 'Selling...' : 'Sell'}
                    </button>
                  </div>
                </div>
                {tradingError && (
                  <p className="text-error text-sm mt-2">{tradingError}</p>
                )}
                {runesError && isProcessingTx && (
                   <p className="text-error text-sm mt-2">{runesError}</p>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Transaction Confirmation Modal */}
        {pendingTransaction && (
          <TransactionConfirmationModal
            isOpen={showConfirmation}
            onClose={handleCancelTransaction}
            onConfirm={handleConfirmTransaction}
            transactionDetails={pendingTransaction}
            isProcessing={isProcessingTx}
          />
        )}
      </div>
    </Layout>
  );
} 