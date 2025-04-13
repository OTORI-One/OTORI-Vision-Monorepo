import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';
import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import WalletConnector from '../components/WalletConnector';
import WalletTokenDisplay from '../components/WalletTokenDisplay';
import useRuneIntegration from '../src/hooks/useRuneIntegration';
import { isAdminWallet } from '../src/utils/adminUtils';
import NAVDisplay from '../components/NAVDisplay';
import CurrencyToggle from '../components/CurrencyToggle';
import Spinner from '../components/Spinner';

export default function WalletPage() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  
  // Laser Eyes wallet integration
  const { address: walletAddress, network } = useLaserEyes();
  
  // OVT Token integration
  const { 
    balance: ovtBalance, 
    formatTokenAmount, 
    metadata, 
    transferRune,
    getDistributionStats,
    isLoading: isTransferLoading,
    error: transferHookError,
    OVT_RUNE_ID,
    processingOrderId
  } = useRuneIntegration();
  
  // Distribution stats
  const [distributionStats, setDistributionStats] = useState<any>(null);
  
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
  
  // Fetch distribution stats on load
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await getDistributionStats();
        setDistributionStats(stats);
      } catch (error) {
        console.error('Error fetching distribution stats:', error);
      }
    };
    
    fetchStats();
  }, [getDistributionStats]);
  
  // Handle wallet connection
  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };
  
  // Handle OVT transfer
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferStatus(null);
    setTransferError(null);
    
    if (!connectedAddress) {
      setTransferError('Please connect your wallet first');
      return;
    }
    
    if (!recipient) {
      setTransferError('Please enter a recipient address');
      return;
    }
    
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      setTransferError('Please enter a valid amount');
      return;
    }
    
    // Convert from human-readable to raw amount
    const divisibility = metadata?.divisibility || 2;
    const rawAmount = Math.floor(parseFloat(transferAmount) * Math.pow(10, divisibility));
    
    try {
      setTransferStatus('Initiating transfer...');
      const result = await transferRune(connectedAddress, recipient, OVT_RUNE_ID, rawAmount);
      setTransferStatus(`Transfer successful! Transaction ID: ${result?.txid || 'Processing'}`);
      setTransferAmount('');
      setRecipient('');
    } catch (error) {
      console.error('Transfer error:', error);
      setTransferError(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Define the style/class for the processing indicator
  // Using ring for the subtle glow effect on the balance card
  const processingCardClass = processingOrderId 
    ? 'ring-2 ring-offset-2 ring-[#7bc6d5] ring-opacity-75' // Vibrant Cyan ring
    : '';
  
  // Class for the small status indicator (e.g., on Wallet button)
  const processingStatusIndicatorClass = processingOrderId
     ? 'absolute -top-1 -right-1 flex h-3 w-3'
     : 'hidden'; // Hide when not processing

  return (
    <Layout title="OTORI Vision Wallet">
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
              <a href="/wallet" className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
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
            <div className="hidden md:block">
              <NAVDisplay showChange={true} size="sm" />
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Currency Toggle */}
            <CurrencyToggle size="sm" />
            
            {/* Wallet Connection with Status Indicator */}
            <div className="relative"> 
                <WalletConnector 
                  onConnect={handleConnectWallet}
                  onDisconnect={handleDisconnectWallet}
                  connectedAddress={connectedAddress || undefined}
                />
                {/* Small pulsing dot indicator */}
                <div className={processingStatusIndicatorClass}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7bc6d5] opacity-75"></span> 
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#67a8b6]"></span> {/* Slightly darker cyan for the dot */}
                </div>
             </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Your OTORI Vision Wallet</h1>
        
        {connectedAddress ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Wallet Overview Section */}
            <div className="md:col-span-2">
              {/* Apply ring indicator to the balances card */}
              <div className={`bg-white rounded-lg shadow-sm p-6 mb-6 relative overflow-hidden ${processingCardClass}`}>
                 {/* Optional: Corner indicator with spinner */}
                 {processingOrderId && (
                      <div className="absolute top-2 right-2 flex items-center space-x-1 px-2 py-0.5 bg-cyan-100 text-[#7bc6d5] text-xs font-medium rounded-full z-10 border border-[#7bc6d5] border-opacity-50">
                          <Spinner size="xs" color="text-[#7bc6d5]" /> 
                          <span>Processing...</span>
                      </div>
                  )}
                <h2 className="text-xl font-semibold mb-4">Token Balances</h2>
                <WalletTokenDisplay address={connectedAddress} />
              </div>
              
              {/* OVT Transfer Form */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-semibold mb-4">Transfer OVT Tokens</h2>
                <form onSubmit={handleTransfer}>
                  <div className="mb-4">
                    <label htmlFor="recipient" className="block text-sm font-medium text-gray-700 mb-1">
                      Recipient Address
                    </label>
                    <input
                      type="text"
                      id="recipient"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="tb1p..."
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
                      Amount (OVT)
                    </label>
                    <div className="flex">
                      <input
                        type="number"
                        id="amount"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        min="0.01"
                        step="0.01"
                        className="w-full p-2 border border-gray-300 rounded-l focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="0.00"
                      />
                      <span className="inline-flex items-center px-3 py-2 rounded-r border border-l-0 border-gray-300 bg-gray-50 text-gray-500">
                        OVT
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Available: {formatTokenAmount(ovtBalance, metadata?.divisibility || 2)} OVT
                    </div>
                  </div>
                  
                  <button
                    type="submit"
                    disabled={isTransferLoading}
                    className="w-full bg-primary text-white py-2 px-4 rounded hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 transition-colors"
                  >
                    {isTransferLoading ? 'Processing...' : 'Send OVT'}
                  </button>
                </form>
                
                {transferStatus && (
                  <div className="mt-4 p-3 bg-success bg-opacity-10 text-success rounded">
                    {transferStatus}
                  </div>
                )}
                
                {transferError && (
                  <div className="mt-4 p-3 bg-error bg-opacity-10 text-error rounded">
                    {transferError}
                  </div>
                )}
              </div>
            </div>
            
            {/* Distribution Stats Section - Temporarily Commented Out Until Data Source is Fixed
            <div className="md:col-span-1">
              <div className="bg-white rounded-lg shadow-sm p-6 h-full">
                <h2 className="text-xl font-semibold mb-4">Token Statistics</h2>
                
                {distributionStats ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Total Supply</h3>
                      <p className="text-lg font-bold">{(distributionStats.totalSupply || 0).toLocaleString()} OVT</p>
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Treasury Held</h3>
                      <p className="text-lg font-bold">{formatTokenAmount(distributionStats.treasuryHeld, metadata?.divisibility || 2)} OVT</p>
                      <p className="text-sm text-gray-500">{distributionStats.percentTreasury || (100 - parseFloat(distributionStats.percentDistributed))}% of supply</p>
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">LP Pool</h3>
                      <p className="text-lg font-bold">{formatTokenAmount(distributionStats.lpHeld, metadata?.divisibility || 2)} OVT</p>
                      <p className="text-sm text-gray-500">{distributionStats.percentInLP}% of supply</p>
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Distributed</h3>
                      <p className="text-lg font-bold">{formatTokenAmount(distributionStats.distributed, metadata?.divisibility || 2)} OVT</p>
                      <p className="text-sm text-gray-500">{distributionStats.percentDistributed}% of supply</p>
                    </div>
                    
                    <div className="pt-2 mt-2 border-t border-gray-200">
                      <h3 className="text-sm font-medium text-gray-500">Divisibility</h3>
                      <p className="text-lg font-bold">{metadata?.divisibility || 2}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center items-center h-64">
                    <p className="text-gray-500">Loading token statistics...</p>
                  </div>
                )}
              </div>
            </div>
            */}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <h2 className="text-xl font-semibold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-600 mb-6">Connect your wallet to view your OVT token balances and manage transactions.</p>
            <div className="inline-block">
              <WalletConnector 
                onConnect={handleConnectWallet}
                onDisconnect={handleDisconnectWallet}
                connectedAddress={connectedAddress || undefined}
              />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
} 