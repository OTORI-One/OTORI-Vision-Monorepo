import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';
import React, { useState } from 'react';
import MultiSigApproval from './MultiSigApproval';
import { useOVTClient } from '../../src/hooks/useOVTClient';
import { 
  OVT_RUNE_ID, 
  OVT_TOTAL_SUPPLY, 
  OVT_FALLBACK_DISTRIBUTED,
  OVT_RUNE_SYMBOL,
  OVT_TRANSACTION_ID,
  OVT_TREASURY_ADDRESS,
  OVT_LP_ADDRESS
} from '../../src/lib/runeClient';

export default function RuneMinting() {
  const [amount, setAmount] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isMultiSigModalOpen, setIsMultiSigModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const { address } = useLaserEyes();
  const { formatValue, navData } = useOVTClient();

  // Get distributed amount with fallback
  const distributedAmount = navData?.tokenDistribution?.distributed || OVT_FALLBACK_DISTRIBUTED;
  
  // Calculate distribution percentage
  const distributionPercentage = ((distributedAmount / OVT_TOTAL_SUPPLY) * 100).toFixed(0);
  
  // Use the real rune ID
  const runeId = "240249:101";
  
  // Mock transaction history for display
  const transactionHistory = [
    {
      type: 'etch',
      txid: OVT_TRANSACTION_ID,
      timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      amount: OVT_TOTAL_SUPPLY
    },
    {
      type: 'treasury_allocation',
      txid: '8ae95df69430b7c6d181fec77fa617f42b8ed9587fcbe4eeb4592ef5a37c96c1',
      timestamp: Date.now() - 25 * 24 * 60 * 60 * 1000, // 25 days ago
      amount: OVT_TOTAL_SUPPLY
    },
    {
      type: 'lp_transfer',
      txid: '7fe85de59430a8d6c180fdc66ff616f31a9ec9476fdbe3dda3482df4f26b86b0',
      timestamp: Date.now() - 20 * 24 * 60 * 60 * 1000, // 20 days ago
      amount: OVT_TOTAL_SUPPLY - distributedAmount
    },
    {
      type: 'distribution',
      txid: '6cf74ce49431b6d7c080gdc55ef515e20a8ec8365edae2ccb2372ce3e15a75a0',
      timestamp: Date.now() - 15 * 24 * 60 * 60 * 1000, // 15 days ago
      amount: distributedAmount
    }
  ];
  
  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };
  
  // Format transaction type
  const formatTransactionType = (type: string) => {
    switch (type) {
      case 'etch': return 'Rune Etching';
      case 'treasury_allocation': return 'Treasury Allocation';
      case 'lp_transfer': return 'LP Transfer';
      case 'distribution': return 'User Distribution';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow numbers
    const value = e.target.value.replace(/[^0-9]/g, '');
    setAmount(value);
  };

  const handleMint = async () => {
    if (!amount || parseInt(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setError(null);
    setSuccess(null);

    // Create the mint action for MultiSig approval
    const mintAction = {
      type: 'MINT_RUNE',
      description: `Mint ${amount} OVT tokens`,
      data: {
        amount: parseInt(amount)
      },
      execute: async (signatures: string[]) => {
        try {
          setIsLoading(true);
          
          // Call the API endpoint to mint tokens
          const response = await fetch('/api/mint-rune', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              amount: parseInt(amount),
              signatures
            }),
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Failed to mint tokens');
          }
          
          setSuccess(`Successfully minted ${amount} OVT tokens. Transaction ID: ${data.txid}`);
          setAmount('');
        } catch (err: any) {
          setError(`Failed to mint tokens: ${err.message}`);
        } finally {
          setIsLoading(false);
        }
      }
    };

    // Open the MultiSig modal
    setPendingAction(mintAction);
    setIsMultiSigModalOpen(true);
  };

  const handleMultiSigComplete = async (signatures: string[]) => {
    if (!pendingAction) return;
    
    setIsMultiSigModalOpen(false);
    
    try {
      // Execute the action with collected signatures
      await pendingAction.execute(signatures);
    } catch (err: any) {
      setError(`Failed to execute action: ${err.message}`);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Mint OVT Rune</h2>
      <p className="text-sm text-gray-500 mb-6">
        Mint additional OVT tokens to support rolling raises and the inflationary supply model.
      </p>
      
      {/* Rune Details */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <h3 className="text-md font-semibold mb-2">Rune Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600 font-medium">Rune ID</p>
            <p className="font-mono">{runeId}</p>
          </div>
          <div>
            <p className="text-gray-600 font-medium">Total Supply</p>
            <p>{OVT_TOTAL_SUPPLY.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-600 font-medium">Distributed</p>
            <p>{distributedAmount.toLocaleString()} ({distributionPercentage}%)</p>
          </div>
          <div>
            <p className="text-gray-600 font-medium">Network</p>
            <p>Testnet</p>
          </div>
          <div>
            <p className="text-gray-600 font-medium">Symbol</p>
            <p>{OVT_RUNE_SYMBOL}</p>
          </div>
        </div>
      </div>
      
      {/* Transaction History */}
      <div className="mb-6">
        <h3 className="text-md font-semibold mb-3">Transaction History</h3>
        <div className="bg-gray-50 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction ID</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transactionHistory.map((tx, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-sm text-gray-900">{formatTransactionType(tx.type)}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">{formatDate(tx.timestamp)}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{tx.amount.toLocaleString()} OVT</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-500 truncate max-w-xs">
                    <span className="block truncate w-24 md:w-32 lg:w-64">{tx.txid}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* LP & Treasury Info */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <h3 className="text-md font-semibold mb-2">Addresses</h3>
        <div className="space-y-2">
          <div>
            <p className="text-gray-600 font-medium">Treasury</p>
            <p className="font-mono text-sm truncate">{OVT_TREASURY_ADDRESS}</p>
          </div>
          <div>
            <p className="text-gray-600 font-medium">Liquidity Provider</p>
            <p className="font-mono text-sm truncate">{OVT_LP_ADDRESS}</p>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
            Amount to Mint
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <input
              type="text"
              name="amount"
              id="amount"
              className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-3 pr-12 sm:text-sm border-gray-300 rounded-md"
              placeholder="0"
              value={amount}
              onChange={handleAmountChange}
              disabled={isLoading}
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">OVT</span>
            </div>
          </div>
        </div>
        
        <button
          type="button"
          className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
            isLoading
              ? 'bg-indigo-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
          }`}
          onClick={handleMint}
          disabled={isLoading || !amount}
        >
          {isLoading ? 'Processing...' : 'Mint Tokens (Requires MultiSig)'}
        </button>
        
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        {success && (
          <div className="bg-green-50 border-l-4 border-green-400 p-4">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-green-700">{success}</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <MultiSigApproval
        isOpen={isMultiSigModalOpen}
        onClose={() => setIsMultiSigModalOpen(false)}
        onComplete={handleMultiSigComplete}
        action={pendingAction}
      />
    </div>
  );
} 