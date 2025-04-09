import React, { useState, useEffect, useCallback } from 'react';
import { useOVTClient } from '../../src/hooks/useOVTClient';
import NAVDisplay from '../NAVDisplay';
import MultiSigApproval from './MultiSigApproval';
import PositionManagement from './PositionManagement';
import TokenMinting from './TokenMinting';
import RuneMinting from './RuneMinting';
import TransactionHistory from './TransactionHistory';
import { useNAV } from '../../src/hooks/useNAV';
import { useOVTPrice } from '../../src/hooks/useOVTPrice';
import { isAdminWallet, ADMIN_WALLETS } from '../../src/utils/adminUtils';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { XVERSE, UNISAT, BaseNetwork } from '@omnisat/lasereyes-core';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { getDataSourceIndicator } from '../../src/lib/hybridModeUtils';
import { usePortfolio } from '../../src/hooks/usePortfolio';
import { useCurrencyToggle } from '../../src/hooks/useCurrencyToggle';
import CurrencyToggle from '../CurrencyToggle';
import WalletConnector from '../WalletConnector';
import { ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

enum AdminView {
  POSITIONS = 'positions',
  MINT = 'mint',
  RUNE_MINT = 'rune_mint',
  HISTORY = 'history',
}

export default function AdminDashboard() {
  const [activeView, setActiveView] = useState<AdminView>(AdminView.POSITIONS);
  const [isMultiSigModalOpen, setIsMultiSigModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(true);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  
  // Use our centralized hooks
  const { nav: navData, loading: isLoading, error } = useNAV();
  const { price: ovtPrice, btcPriceFormatted, usdPriceFormatted } = useOVTPrice();
  const { positions, getTotalValue, getOverallChangePercentage } = usePortfolio();
  const { currency, formatValue } = useCurrencyToggle();
  const { address, connect, disconnect, network } = useLaserEyes();

  // Get data source indicator for portfolio
  const portfolioDataSource = getDataSourceIndicator('portfolio');

  const addDebugLog = (message: string) => {
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('[AdminDashboard]', message);
      setDebugLogs(prev => [...prev, message]);
    }
  };

  // Check if current wallet is an admin with delay to prevent race conditions
  useEffect(() => {
    addDebugLog(`Current address: ${address || 'No address'}`);
    addDebugLog(`Network: ${network || 'Unknown'}`);
    
    // Set loading to true when address changes
    setIsLocalLoading(true);
    
    // Update connected address
    setConnectedAddress(address ?? null);
    
    // Small delay to ensure other components have processed the wallet connection
    const timer = setTimeout(() => {
      if (!address) {
        addDebugLog('No wallet address detected, admin status is false');
        setIsAdmin(false);
        setIsLocalLoading(false);
        return;
      }
      
      // Check admin status
      const adminStatus = isAdminWallet(address);
      addDebugLog(`Admin status check result: ${adminStatus}`);
      setIsAdmin(adminStatus);
      setIsLocalLoading(false);
    }, 500); // 500ms delay
    
    return () => clearTimeout(timer);
  }, [address, network]);

  // Listen for wallet connection events from WalletConnector
  useEffect(() => {
    const handleWalletConnection = (e: CustomEvent) => {
      addDebugLog(`Detected wallet connection event: ${e.detail.address}`);
    };
    
    window.addEventListener('wallet-connected', handleWalletConnection as EventListener);
    return () => {
      window.removeEventListener('wallet-connected', handleWalletConnection as EventListener);
    };
  }, []);

  // Custom wallet connection handlers that utilize the LaserEyes hook
  const handleConnectWallet = async (walletAddress: string) => {
    setConnectedAddress(walletAddress);
    setIsAdmin(isAdminWallet(walletAddress));
  };
  
  const handleDisconnectWallet = () => {
    addDebugLog('Disconnecting wallet...');
    disconnect();
    setConnectedAddress(null);
    setIsAdmin(false);
  };

  const handleActionRequiringMultiSig = (action: any) => {
    setPendingAction(action);
    setIsMultiSigModalOpen(true);
  };

  const handleMultiSigComplete = async (signatures: string[]) => {
    if (!pendingAction) return;
    
    try {
      // Execute the action with collected signatures
      await pendingAction.execute(signatures);
      
      // Reset the pending action and close the modal
      setPendingAction(null);
      setIsMultiSigModalOpen(false);
    } catch (error) {
      console.error('Error executing multi-sig action:', error);
      // Here you might want to set an error state and display it to the user
    }
  };

  const handleMultiSigCancel = () => {
    setPendingAction(null);
    setIsMultiSigModalOpen(false);
  };
  
  // Calculate total portfolio value and change percentage
  const totalPortfolioValue = formatValue(getTotalValue());
  const overallChangePercentage = getOverallChangePercentage().toFixed(2);
  const isPositive = parseFloat(overallChangePercentage) >= 0;

  // Return loading indicator while checking admin status
  if (isLocalLoading) {
    return (
      <div className="w-full bg-white shadow-md rounded-lg p-6 font-sans text-gray-800">
        <div className="flex items-center justify-center p-12">
          <div className="animate-pulse flex flex-col items-center">
            <div className="h-8 w-32 bg-gray-200 rounded mb-4"></div>
            <div className="text-gray-500">Verifying admin status...</div>
          </div>
        </div>
      </div>
    );
  }

  // Return the admin dashboard or access denied message based on admin status
  return (
    <div className="w-full bg-white shadow-md rounded-lg">
      {/* Navigation Bar */}
      <div className="bg-white border-b border-primary shadow-sm p-4 mb-6 rounded-t-lg">
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
              <a href="/portfolio" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                Portfolio
              </a>
              <a href="/admin" className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
                Admin
              </a>
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
      
      <div className="p-6">
        {/* Debug Info - Only shown in development mode and much more compact */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-2 p-2 bg-gray-100 rounded text-xs">
            <details>
              <summary className="cursor-pointer text-gray-600">Debug Info</summary>
              <div className="mt-1 p-1">
                <p>Admin: {String(isAdmin)} | Address: {address || 'None'} | Network: {network || 'Unknown'}</p>
                {!address && (
                  <div className="flex space-x-2 mt-1">
                    <button 
                      onClick={() => connect(XVERSE)}
                      className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
                    >
                      Connect Xverse
                    </button>
                    <button 
                      onClick={() => connect(UNISAT)}
                      className="text-xs px-2 py-1 bg-orange-500 text-white rounded"
                    >
                      Connect Unisat
                    </button>
                  </div>
                )}
                {address && (
                  <button 
                    onClick={handleDisconnectWallet}
                    className="text-xs px-2 py-1 bg-gray-500 text-white rounded mt-1"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </details>
          </div>
        )}
        
        {/* Changed from hardcoded "true" to use isAdmin state */}
        {isAdmin ? (
          <>
            <div className="border-b border-gray-200 pb-4">
              <h2 className="text-xl font-semibold text-gray-900">Admin Dashboard</h2>
              <p className="mt-1 text-sm text-gray-500">
                Manage OVT Fund operations and view system metrics
              </p>
            </div>
            
            {/* Admin Navigation */}
            <div className="border-b border-gray-200 mt-4">
              <nav className="flex py-2 space-x-4 overflow-x-auto">
                <button
                  onClick={() => setActiveView(AdminView.POSITIONS)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    activeView === AdminView.POSITIONS
                      ? 'bg-primary text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Position Management
                </button>
                <button
                  onClick={() => setActiveView(AdminView.MINT)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    activeView === AdminView.MINT
                      ? 'bg-primary text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Token Minting
                </button>
                <button
                  onClick={() => setActiveView(AdminView.RUNE_MINT)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    activeView === AdminView.RUNE_MINT
                      ? 'bg-primary text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Rune Minting
                </button>
                <button
                  onClick={() => setActiveView(AdminView.HISTORY)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    activeView === AdminView.HISTORY
                      ? 'bg-primary text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Transaction History
                </button>
              </nav>
            </div>
            
            <div className="mt-6">
              {/* Fund Metrics Summary */}
              <div className="p-6 bg-white border border-primary rounded-lg shadow-sm mb-6">
                <h3 className="text-lg font-medium text-primary mb-4">OVT Fund Metrics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white border border-primary border-opacity-20 p-4 rounded-lg">
                    <p className="text-sm text-primary">Total Value</p>
                    <p className="text-xl font-bold text-primary">{totalPortfolioValue}</p>
                  </div>
                  <div className="bg-white border border-primary border-opacity-20 p-4 rounded-lg">
                    <p className="text-sm text-primary">Change</p>
                    <p className={`text-xl font-bold ${isPositive ? 'text-success' : 'text-error'}`}>
                      {isPositive ? '+' : ''}{overallChangePercentage}%
                    </p>
                  </div>
                  <div className="bg-white border border-primary border-opacity-20 p-4 rounded-lg">
                    <p className="text-sm text-primary">Data Source</p>
                    <p className="text-xl font-bold text-primary">
                      {portfolioDataSource.isMock ? "Simulated Data" : "Real Contract Data"}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* OVT Rune Information */}
              <div className="p-6 bg-white border border-primary rounded-lg shadow-sm mb-6">
                <h3 className="text-lg font-medium text-primary mb-4">OVT Rune Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-primary">Status</p>
                      <p className="text-base text-primary">Etched</p>
                      <p className="text-sm text-primary opacity-75">Bitcoin Rune representing the OTORI Vision Token</p>
                      <p className="text-sm text-primary mt-1">Rune ID: {'240249:101'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-primary">Initial Supply</p>
                      <p className="text-base text-primary">{'2,100,000'.toLocaleString()}</p>
                    </div>
                  </div>
                  <div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-primary">Current Supply</p>
                      <p className="text-base text-primary">{'2,100,000'.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-primary">Distribution</p>
                      <p className="text-base text-primary">
                        {'0'.toLocaleString()} tokens 
                        (0.00%)
                      </p>
                      <p className="text-sm font-medium text-primary mt-2">Distribution Events</p>
                      <p className="text-base text-primary">1</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Admin View Content */}
              <div className="p-6 bg-white border border-primary rounded-lg shadow-sm">
                {activeView === AdminView.POSITIONS && (
                  <PositionManagement onActionRequiringMultiSig={handleActionRequiringMultiSig} />
                )}
                
                {activeView === AdminView.MINT && (
                  <TokenMinting onActionRequiringMultiSig={handleActionRequiringMultiSig} />
                )}
                
                {activeView === AdminView.RUNE_MINT && (
                  <RuneMinting />
                )}
                
                {activeView === AdminView.HISTORY && (
                  <TransactionHistory />
                )}
              </div>
              
              {/* Multi-Sig Modal */}
              {isMultiSigModalOpen && pendingAction && (
                <MultiSigApproval
                  isOpen={isMultiSigModalOpen}
                  onClose={handleMultiSigCancel}
                  onComplete={handleMultiSigComplete}
                  action={pendingAction}
                />
              )}
            </div>
          </>
        ) : (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-red-700">
                  Access denied. This dashboard is only accessible to admin wallets.
                </p>
                {address && (
                  <p className="text-sm text-red-700 mt-2">
                    Your current address "{address}" is not in the admin whitelist.
                  </p>
                )}
                {!address && (
                  <p className="text-sm text-red-700 mt-2">
                    You need to connect a wallet to access the admin dashboard.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 