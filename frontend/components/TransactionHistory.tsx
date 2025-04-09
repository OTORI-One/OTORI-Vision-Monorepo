import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';
import React, { useState, useEffect } from 'react';
import { useRuneIntegration, RuneTransaction } from '../src/hooks/useRuneIntegration';
import { formatDate } from '../src/lib/formatting';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline';

type TransactionHistoryProps = {
  limit?: number;
  showExport?: boolean;
};

const TransactionHistory: React.FC<TransactionHistoryProps> = ({ limit = 10, showExport = false }) => {
  const { address } = useLaserEyes();
  const { transactions, getTransactionHistory, isLoading, error } = useRuneIntegration();
  const { formatValue, currency } = useCurrencyToggle();
  const [filteredTransactions, setFilteredTransactions] = useState<RuneTransaction[]>([]);
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  useEffect(() => {
    if (address) {
      getTransactionHistory(address).catch(console.error);
    }
  }, [address, getTransactionHistory]);

  useEffect(() => {
    // Apply filter and limit
    let filtered = [...transactions];
    
    if (filter === 'buy') {
      filtered = filtered.filter(tx => tx.type === 'BUY');
    } else if (filter === 'sell') {
      filtered = filtered.filter(tx => tx.type === 'SELL');
    }
    
    setFilteredTransactions(filtered.slice(0, limit));
  }, [transactions, filter, limit]);

  const exportTransactions = () => {
    if (transactions.length === 0) return;
    
    // Format data for CSV
    const headers = ['Date', 'Type', 'Amount', 'Price', 'Total', 'Status', 'Transaction ID'];
    const csvRows = [headers.join(',')];
    
    transactions.forEach(tx => {
      const total = tx.type === 'BUY' ? tx.totalCost : tx.totalReturn;
      const row = [
        new Date(tx.timestamp).toISOString(),
        tx.type,
        tx.amount,
        tx.price || 0,
        total || 0,
        tx.status,
        tx.txid
      ];
      csvRows.push(row.join(','));
    });
    
    // Create and download the CSV file
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ovt-transactions-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Confirmed</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
      case 'failed':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Failed</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  if (!address) {
    return (
      <div className="bg-white shadow rounded-lg p-4">
        <div className="text-center text-gray-500 py-8">
          Please connect your wallet to view transaction history
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Transaction History</h2>
        
        <div className="flex space-x-2">
          <div className="flex bg-gray-100 rounded-md">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-sm rounded-l-md ${
                filter === 'all' ? 'bg-blue-600 text-white' : 'text-gray-600'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('buy')}
              className={`px-3 py-1 text-sm ${
                filter === 'buy' ? 'bg-green-600 text-white' : 'text-gray-600'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setFilter('sell')}
              className={`px-3 py-1 text-sm rounded-r-md ${
                filter === 'sell' ? 'bg-red-600 text-white' : 'text-gray-600'
              }`}
            >
              Sell
            </button>
          </div>
          
          {showExport && (
            <button
              onClick={exportTransactions}
              disabled={transactions.length === 0}
              className={`px-3 py-1 text-sm rounded-md ${
                transactions.length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Export CSV
            </button>
          )}
        </div>
      </div>
      
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : error ? (
        <div className="text-center text-red-500 py-4">{error}</div>
      ) : filteredTransactions.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          No transactions found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction ID</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.map((tx) => (
                <tr key={tx.txid} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {tx.type === 'BUY' ? (
                        <ArrowDownIcon className="h-5 w-5 text-green-500 mr-1" />
                      ) : (
                        <ArrowUpIcon className="h-5 w-5 text-red-500 mr-1" />
                      )}
                      <span className={tx.type === 'BUY' ? 'text-green-600' : 'text-red-600'}>
                        {tx.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {formatDate(tx.timestamp, true)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {tx.amount} OVT
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {tx.price ? formatValue(tx.price) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {tx.type === 'BUY' && tx.totalCost
                      ? formatValue(tx.totalCost)
                      : tx.type === 'SELL' && tx.totalReturn
                      ? formatValue(tx.totalReturn)
                      : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(tx.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="font-mono">{tx.txid.slice(0, 8)}...{tx.txid.slice(-8)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {limit < transactions.length && (
        <div className="flex justify-center mt-4">
          <a href="/wallet" className="text-blue-600 hover:underline">
            View All Transactions
          </a>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory; 