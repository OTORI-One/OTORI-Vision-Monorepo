/**
 * RuneIntegrationExample
 * 
 * This component demonstrates how to use the useRuneIntegration hook
 * to interact with OVT tokens on the Bitcoin Signet network.
 */

import React, { useState } from 'react';
import useRuneIntegration from '../hooks/useRuneIntegration';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { UNISAT, XVERSE } from '@omnisat/lasereyes-core';

const RuneIntegrationExample: React.FC = () => {
  const laserEyes = useLaserEyes();
  const { address } = laserEyes;
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [transferStatus, setTransferStatus] = useState<string>('');
  
  // Use our Rune integration hook
  const {
    isLoading,
    error,
    balance,
    metadata,
    transactions,
    getBalance,
    transferRune,
    formatTokenAmount,
    getDistributionStats,
    OVT_RUNE_TICKER
  } = useRuneIntegration();
  
  // Handle wallet connection
  const connectWallet = () => {
    // Use whatever connect method is available in LaserEyes
    if (laserEyes.connect) {
      laserEyes.connect(XVERSE);
    } else if (typeof (window as any).bitcoin !== 'undefined') {
      // Fallback to direct browser wallet connection if available
      (window as any).bitcoin.enable().catch(console.error);
    } else {
      alert('Please install a Bitcoin wallet extension like Leather or Xverse');
    }
  };
  
  // Format the OVT balance
  const formattedBalance = metadata ? 
    formatTokenAmount(balance, metadata.divisibility) : 
    balance.toString();
  
  // Handle token transfer
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!address) {
      setTransferStatus('Please connect your wallet first');
      return;
    }
    
    if (!recipient || !amount) {
      setTransferStatus('Please enter recipient address and amount');
      return;
    }
    
    try {
      setTransferStatus('Preparing transfer...');
      
      // Convert amount to token units (respecting divisibility)
      const divisibility = metadata?.divisibility || 2;
      const tokenAmount = parseInt(amount) * Math.pow(10, divisibility);
      
      // Execute the transfer
      const result = await transferRune(address, recipient, metadata?.id, tokenAmount);
      
      setTransferStatus(`Transfer successful! Transaction ID: ${result.txid}`);
      
      // Reset form
      setAmount('');
      setRecipient('');
      
      // Refresh balance
      await getBalance(address);
    } catch (error) {
      console.error('Transfer error:', error);
      setTransferStatus(`Transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  // Display distribution stats
  const [stats, setStats] = useState<any>(null);
  const [showStats, setShowStats] = useState<boolean>(false);
  
  const handleShowStats = async () => {
    if (!showStats) {
      try {
        const distributionStats = await getDistributionStats();
        setStats(distributionStats);
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    }
    setShowStats(!showStats);
  };
  
  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-4">OVT Rune Integration</h1>
      
      {/* Wallet Connection */}
      <div className="mb-6 p-4 bg-gray-50 rounded-md">
        {address ? (
          <div>
            <p className="font-medium">Connected Wallet:</p>
            <p className="text-sm text-gray-600 break-all">{address}</p>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Connect Wallet
          </button>
        )}
      </div>
      
      {/* Token Info */}
      {isLoading ? (
        <div className="text-center py-4">Loading token info...</div>
      ) : (
        <div className="mb-6">
          <div className="flex items-center mb-4">
            <h2 className="text-xl font-semibold">Token Details</h2>
            {metadata?.icon && (
              <img src={metadata.icon} alt="Token logo" className="w-6 h-6 ml-2" />
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Symbol:</p>
              <p className="font-medium">{metadata?.ticker || OVT_RUNE_TICKER}</p>
            </div>
            <div>
              <p className="text-gray-600">Name:</p>
              <p className="font-medium">{metadata?.name || 'OTORI Vision Token'}</p>
            </div>
            <div>
              <p className="text-gray-600">Your Balance:</p>
              <p className="font-medium">{formattedBalance} {metadata?.ticker || OVT_RUNE_TICKER}</p>
            </div>
            <div>
              <p className="text-gray-600">Divisibility:</p>
              <p className="font-medium">{metadata?.divisibility || 2}</p>
            </div>
          </div>
          
          <button
            onClick={handleShowStats}
            className="mt-4 px-3 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm"
          >
            {showStats ? 'Hide' : 'Show'} Distribution Stats
          </button>
          
          {showStats && stats && (
            <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
              <h3 className="font-medium mb-2">Distribution Statistics</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-gray-600">Total Supply:</p>
                  <p>{stats.totalSupply.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-600">Distributed:</p>
                  <p>{stats.distributed.toLocaleString()} ({stats.percentDistributed}%)</p>
                </div>
                <div>
                  <p className="text-gray-600">LP Holdings:</p>
                  <p>{stats.lpHeld.toLocaleString()} ({stats.percentInLP}%)</p>
                </div>
                <div>
                  <p className="text-gray-600">Treasury:</p>
                  <p>{stats.treasuryHeld.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Transfer Form */}
      {address && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-3">Transfer Tokens</h2>
          <form onSubmit={handleTransfer}>
            <div className="mb-3">
              <label className="block text-gray-700 text-sm font-medium mb-1">
                Recipient Address
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
                placeholder="tb1p..."
                required
              />
            </div>
            <div className="mb-3">
              <label className="block text-gray-700 text-sm font-medium mb-1">
                Amount ({metadata?.ticker || OVT_RUNE_TICKER})
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                className="w-full p-2 border border-gray-300 rounded"
                placeholder="Amount to send"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              {isLoading ? 'Processing...' : 'Transfer'}
            </button>
          </form>
          
          {transferStatus && (
            <div className={`mt-3 p-3 rounded text-sm ${
              transferStatus.includes('failed') ? 'bg-red-100' : 
              transferStatus.includes('successful') ? 'bg-green-100' : 'bg-blue-100'
            }`}>
              {transferStatus}
            </div>
          )}
        </div>
      )}
      
      {/* Recent Transactions */}
      {address && transactions.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Recent Transactions</h2>
          <div className="border rounded overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((tx) => (
                  <tr key={tx.txid}>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        tx.type === 'SELL' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {tx.type === 'SELL' ? 'Sent' : 'Received'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      {metadata ? formatTokenAmount(tx.amount, metadata.divisibility) : tx.amount} {metadata?.ticker || OVT_RUNE_TICKER}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                      {new Date(tx.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        tx.status === 'confirmed' ? 'bg-green-100 text-green-800' : 
                        tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Error Display */}
      {error && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
          <p className="font-medium">Error:</p>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
};

export default RuneIntegrationExample; 