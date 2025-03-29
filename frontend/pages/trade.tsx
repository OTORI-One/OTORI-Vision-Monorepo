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
  const { nav, refreshNAV } = useNAV(); // Get NAV data
  const isConnected = !!walletAddress;
  
  // Client-side state
  const [isMounted, setIsMounted] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [laserEyesWallets, setLaserEyesWallets] = useState<string[]>([]);
  
  // Get data source indicator for trading
  const tradingDataSource = getDataSourceIndicator('trading');
  
  // Mark component as mounted to prevent hydration issues
  useEffect(() => {
    setIsMounted(true);
    
    // For development, allow any connected wallet to trade
    if (walletAddress) {
      setLaserEyesWallets([walletAddress]);
    }
    
    // Make sure we have fresh NAV data
    refreshNAV();
  }, [walletAddress, refreshNAV]);
  
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
  
  // Wallet connection handlers
  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
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
    </Layout>
  );
} 