import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import TradingInterface from '../components/TradingInterface';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import { useLaserEyes } from '@omnisat/lasereyes';
import { getDataSourceIndicator } from '../src/lib/hybridModeUtils';
import WalletConnector from '../components/WalletConnector';
import CurrencyToggle from '../components/CurrencyToggle';
import NAVDisplay from '../components/NAVDisplay';
import { isAdminWallet } from '../src/utils/adminUtils';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useNAV } from '../src/hooks/useNAV';
import dynamic from 'next/dynamic';
import priceService from '../src/services/priceService';
import TransactionConfirmationModal from '../components/TransactionConfirmationModal';
import { useTradingModule } from '../src/hooks/useTradingModule';

// Ensure NAV data is loaded before rendering
if (typeof window !== 'undefined') {
  // Immediately trigger a fetch - don't wait for it to complete
  priceService.getPriceStore().fetchNAVData();
}

// Import components that depend on client-side data with dynamic import and SSR disabled
const DynamicTradingContent = dynamic(
  () => import('../components/TradingContent'),
  { ssr: false }
);

export default function TradePage() {
  // Use hooks
  const { address: walletAddress, network } = useLaserEyes();
  const { currency } = useCurrencyToggle();
  const { nav } = useNAV(); // Get NAV data (refreshNAV is removed)
  const isConnected = !!walletAddress;
  
  // Client-side state
  const [isMounted, setIsMounted] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [laserEyesWallets, setLaserEyesWallets] = useState<string[]>([]);
  
  // Trade form state
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [lastTradeStatus, setLastTradeStatus] = useState<{success: boolean, message: string} | null>(null);
  
  // Get data source indicator for trading
  const tradingDataSource = getDataSourceIndicator('trading');
  
  // Confirmation modal state
  const [showConfirmation, setShowConfirmation] = useState<boolean>(false);
  const [isProcessingTx, setIsProcessingTx] = useState<boolean>(false);
  
  // Use our trading module
  const { 
    buyOVT, 
    sellOVT, 
    getMarketPrice, 
    isLoading,
    tradeHistory,
    error,
    pendingTransaction,
    setPendingTransaction,
    executeTransaction,
    dataSource 
  } = useTradingModule();
  
  // Mark component as mounted to prevent hydration issues
  useEffect(() => {
    setIsMounted(true);
    
    // For development, allow any connected wallet to trade
    if (walletAddress) {
      setLaserEyesWallets([walletAddress]);
    }
    
    // NAV data is now handled by the useNAV hook and WebSocket connection
    // No need to manually refresh here
  }, [walletAddress]);
  
  // Update wallet connection status when address changes
  useEffect(() => {
    if (walletAddress) {
      setConnectedAddress(walletAddress);
      // Check if the connected wallet is an admin wallet
      setIsAdmin(isAdminWallet(walletAddress));
    } else {
      setConnectedAddress(null);
      setIsAdmin(false);
    }
  }, [walletAddress]);
  
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
    
    try {
      const result = await executeTransaction(pendingTransaction);
      console.log('Transaction executed:', result);
      
      // Show success message
      if (pendingTransaction.type === 'buy') {
        setLastTradeStatus({
          success: true,
          message: `Successfully purchased ${pendingTransaction.amount} OVT at ${pendingTransaction.price} sats per token`
        });
      } else {
        setLastTradeStatus({
          success: true,
          message: `Successfully sold ${pendingTransaction.amount} OVT at ${pendingTransaction.price} sats per token`
        });
      }
      
      // Reset form
      if (pendingTransaction.type === 'buy') {
        setBuyAmount('');
      } else {
        setSellAmount('');
      }
    } catch (err) {
      console.error('Transaction failed:', err);
      setLastTradeStatus({
        success: false,
        message: err instanceof Error ? err.message : 'Transaction failed'
      });
    } finally {
      setIsProcessingTx(false);
      setShowConfirmation(false);
    }
  };
  
  // Wallet connection handlers
  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };
  
  // Update buy handler
  const handleBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setLastTradeStatus({
        success: false,
        message: 'Please connect your wallet first'
      });
      return;
    }
    
    const amount = parseFloat(buyAmount);
    if (isNaN(amount) || amount <= 0) {
      setLastTradeStatus({
        success: false,
        message: 'Please enter a valid amount'
      });
      return;
    }
    
    try {
      // This will trigger the confirmation flow
      await buyOVT(amount);
    } catch (error) {
      console.error('Error preparing buy transaction:', error);
      setLastTradeStatus({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to prepare transaction'
      });
    }
  };
  
  // Update sell handler
  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setLastTradeStatus({
        success: false,
        message: 'Please connect your wallet first'
      });
      return;
    }
    
    const amount = parseFloat(sellAmount);
    if (isNaN(amount) || amount <= 0) {
      setLastTradeStatus({
        success: false,
        message: 'Please enter a valid amount'
      });
      return;
    }
    
    try {
      // This will trigger the confirmation flow
      await sellOVT(amount);
    } catch (error) {
      console.error('Error preparing sell transaction:', error);
      setLastTradeStatus({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to prepare transaction'
      });
    }
  };
  
  return (
    <Layout title="Trade OVT">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-primary shadow-sm p-4 mb-6 rounded-lg">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-6">
            {/* Logo */}
            <div className="flex items-center">
              <img className="h-8 w-auto mr-2" src="/logo.svg" alt="OTORI" />
              <span className="text-lg font-bold text-primary">OTORI Vision</span>
            </div>
            
            {/* Navigation Links */}
            <nav className="flex space-x-4">
              <a href="/" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                Dashboard
              </a>
              <a href="/trade" className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
                Trade
              </a>
              <a href="/wallet" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                Wallet
              </a>
              {isAdmin && (
                <>
                  <a href="/portfolio" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                    Portfolio
                  </a>
                  <a href="/admin" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                    Admin
                  </a>
                </>
              )}
            </nav>
            
            {/* Centralized NAV Display */}
            <NAVDisplay showChange={true} size="md" />
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Currency Toggle */}
            <CurrencyToggle size="md" />
            
            {/* Wallet Connection */}
            <WalletConnector 
              onConnect={handleConnectWallet}
              onDisconnect={handleDisconnectWallet}
              connectedAddress={connectedAddress || undefined}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary">Trading Portal</h1>
          <p className="mt-2 text-sm text-primary opacity-75">
            Buy and sell OVT tokens on the Bitcoin testnet
          </p>
        </div>
        
        {/* Only render client-dependent content when mounted */}
        {isMounted && (
          <DynamicTradingContent 
            isConnected={isConnected}
            connectedAddress={connectedAddress}
            walletAddress={walletAddress}
            laserEyesWallets={laserEyesWallets}
            tradingDataSource={tradingDataSource}
          />
        )}
      </div>

      {/* Add the confirmation modal at the end of the component */}
      {pendingTransaction && (
        <TransactionConfirmationModal
          isOpen={showConfirmation}
          onClose={handleCancelTransaction}
          onConfirm={handleConfirmTransaction}
          transactionDetails={pendingTransaction}
          isProcessing={isProcessingTx}
        />
      )}
    </Layout>
  );
} 