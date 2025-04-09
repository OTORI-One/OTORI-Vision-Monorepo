import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import Layout from '../components/Layout';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { getDataSourceIndicator } from '../src/lib/hybridModeUtils';
import DataSourceIndicator from '../components/DataSourceIndicator';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import NAVDisplay from '../components/NAVDisplay';
import CurrencyToggle from '../components/CurrencyToggle';
import WalletConnector from '../components/WalletConnector';
import { isAdminWallet } from '../src/utils/adminUtils';

export default function PortfolioPage() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [animating, setAnimating] = useState<Record<string, boolean>>({});
  const prevValuesRef = useRef<Record<string, number>>({});
  
  // Use our central hooks
  const { currency, formatValue } = useCurrencyToggle();
  const { positions, getTotalValue, getOverallChangePercentage, isLoading, error } = usePortfolio();
  
  // Get wallet info from laser eyes
  const { address: walletAddress, network } = useLaserEyes();
  const isConnected = !!walletAddress;
  
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
  }, [walletAddress, network]);
  
  // Format portfolio values with a consistent initial render value
  const formattedTotalValue = useMemo(() => {
    return formatValue(getTotalValue());
  }, [formatValue, getTotalValue]);
  
  // Track previous values to animate changes
  useEffect(() => {
    if (!positions || positions.length === 0) return;
    
    const newAnimatingState: Record<string, boolean> = {};
    const newPrevValues: Record<string, number> = {};
    
    positions.forEach(pos => {
      const prevValue = prevValuesRef.current[pos.name] || pos.current;
      // Only animate if the change is significant (more than 0.1%)
      if (Math.abs(prevValue - pos.current) / prevValue > 0.001) {
        newAnimatingState[pos.name] = true;
        
        // Reset animation after a short delay
        setTimeout(() => {
          setAnimating(prev => ({
            ...prev,
            [pos.name]: false
          }));
        }, 800);
      }
      newPrevValues[pos.name] = pos.current;
    });
    
    setAnimating(newAnimatingState);
    prevValuesRef.current = newPrevValues;
  }, [positions]);

  // Get data source indicator
  const portfolioDataSource = getDataSourceIndicator('portfolio');
  
  // Calculate total change percentage
  const totalChangePercentage = getOverallChangePercentage();
  const formattedChangePercentage = totalChangePercentage.toFixed(2);
  const isPositiveChange = totalChangePercentage >= 0;
  
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
    <Layout title="OTORI Vision Portfolio">
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
              <a href="/trade" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                Trade
              </a>
              <a href="/wallet" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                Wallet
              </a>
              <a href="/portfolio" className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
                Portfolio
              </a>
              {isAdmin && (
                <a href="/admin" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Admin
                </a>
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
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-primary">OTORI Vision Portfolio</h1>
            <p className="mt-2 text-sm text-primary opacity-75">
              View portfolio holdings and performance
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-primary opacity-75 mr-2">
              Live prices updating in real-time
            </div>
            <DataSourceIndicator 
              isMock={portfolioDataSource.isMock}
              label={portfolioDataSource.label}
              color={portfolioDataSource.color} 
            />
          </div>
        </div>
        
        {!isConnected ? (
          <div className="bg-white border border-primary p-6 rounded-lg shadow-sm text-center">
            <p className="text-lg text-primary mb-4">Please connect your wallet to view your portfolio</p>
            <p className="text-sm text-primary opacity-75">You need to connect your wallet to access your portfolio information</p>
          </div>
        ) : !isAdmin ? (
          <div className="bg-white border border-primary p-6 rounded-lg shadow-sm text-center">
            <p className="text-lg text-primary mb-4">Admin Access Required</p>
            <p className="text-sm text-primary opacity-75">The portfolio view is only available to fund administrators</p>
          </div>
        ) : isLoading ? (
          // Loading State
          <div className="bg-white border border-primary p-6 rounded-lg shadow-sm text-center">
            <p className="text-lg text-primary mb-4">Loading Portfolio Data...</p>
            <p className="text-sm text-primary opacity-75">Fetching the latest positions and values.</p>
            {/* Optional: Add a spinner here */}
          </div>
        ) : error ? (
          // Error State
          <div className="bg-white border border-error p-6 rounded-lg shadow-sm text-center">
            <p className="text-lg text-error mb-4">Error Loading Portfolio</p>
            <p className="text-sm text-error opacity-75">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Portfolio Summary Card */}
            <div className="bg-white border border-primary p-6 rounded-lg shadow-sm col-span-1 lg:col-span-3">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg font-medium text-primary">Portfolio Overview</h2>
                <div className="text-xs text-primary opacity-75">
                  Last updated: {new Date().toLocaleTimeString()}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-primary p-4 rounded-lg">
                  <p className="text-sm text-primary font-medium">Total Value</p>
                  <p className={`text-2xl font-bold text-primary transition-all duration-300 ${
                    animating['total'] ? 'scale-105' : ''
                  }`}>
                    {formattedTotalValue}
                  </p>
                </div>
                <div className="bg-white border border-primary p-4 rounded-lg">
                  <p className="text-sm text-primary font-medium">Performance</p>
                  <p className={`text-2xl font-bold ${
                    isPositiveChange ? 'text-success' : 'text-error'
                  } transition-all duration-300 ${
                    animating['total'] ? 'scale-105' : ''
                  }`}>
                    {isPositiveChange ? '+' : ''}{formattedChangePercentage}%
                  </p>
                </div>
                <div className="bg-white border border-primary p-4 rounded-lg">
                  <p className="text-sm text-primary font-medium">Holdings</p>
                  <p className="text-2xl font-bold text-primary">{positions?.length || 0} positions</p>
                </div>
              </div>
            </div>
            
            {/* Portfolio Items */}
            {positions && positions.length > 0 ? (
              positions.map((item, index) => (
                <div key={index} className="bg-white border border-primary p-6 rounded-lg shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-medium text-primary">{item.name}</h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      item.change >= 0 ? 'bg-success bg-opacity-10 text-success' : 'bg-error bg-opacity-10 text-error'
                    } transition-all duration-500 ${
                      animating[item.name] ? 'scale-110' : ''
                    }`}>
                      {item.change >= 0 ? '+' : ''}
                      {item.change}%
                    </span>
                  </div>
                  <p className="text-sm text-primary opacity-75 mb-4">{item.description}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-primary opacity-75">Current Value</p>
                      <span 
                        className={`text-lg font-semibold text-primary transition-all duration-500 ${
                          animating[item.name] ? 'text-success scale-105' : ''
                        }`}
                      >
                        {formatValue(item.current)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-primary opacity-75">Initial Value</p>
                      <span className="text-lg font-semibold text-primary">
                        {formatValue(item.value)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-primary border-opacity-20">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-primary opacity-75">Token Amount</p>
                        <p className="text-base text-primary">{item.tokenAmount.toLocaleString()} tokens</p>
                      </div>
                      <div>
                        <p className="text-xs text-primary opacity-75">Price Per Token</p>
                        <span 
                          className={`text-base text-primary transition-all duration-500 ${
                            animating[item.name] ? 'text-success scale-105' : ''
                          }`}
                        >
                          {formatValue(item.pricePerToken)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Check if transactionId exists using optional chaining and type assertion */}
                  {(item as any).transactionId && (
                    <div className="mt-4 text-xs text-primary opacity-50">
                      <p>TX: {((item as any).transactionId).slice(0, 10)}...{((item as any).transactionId).slice(-10)}</p>
                    </div>
                  )}
                </div>
              ))
            ) : (
              // No Positions State (Handles case after loading finishes but no data)
              <div className="bg-white border border-primary p-6 rounded-lg shadow-sm col-span-1 lg:col-span-3 text-center">
                <p className="text-primary opacity-75 mb-2">No portfolio positions found</p>
                <p className="text-sm text-primary opacity-50">Visit the Trade section to acquire OVT tokens or check admin settings.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
} 