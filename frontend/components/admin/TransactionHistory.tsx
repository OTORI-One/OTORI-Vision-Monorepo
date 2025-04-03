import React, { useState, useEffect } from 'react';
import { useOVTClient } from '../../src/hooks/useOVTClient';
import { useCurrencyToggle } from '../../src/hooks/useCurrencyToggle';
import { formatDate } from '../../src/lib/formatting';
import { 
  CurrencyDollarIcon, 
  FireIcon, 
  ArrowPathIcon, 
  PlusIcon, 
  MinusIcon 
} from '@heroicons/react/24/outline';
import DataSourceIndicator from '../DataSourceIndicator';

interface Transaction {
  txid: string;
  type: 'mint' | 'burn' | 'transfer' | 'position_entry' | 'position_exit';
  amount: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  details: {
    reason?: string;
    position?: string;
    signatures?: string[];
    currency?: string;
  };
}

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const { 
    getTransactionHistory, 
    isLoading, 
    error, 
  } = useOVTClient();
  const { formatValue } = useCurrencyToggle();

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        console.log('Fetching transaction history...');
        const history = await getTransactionHistory();
        console.log('Transaction history received:', history);
        
        if (history && Array.isArray(history)) {
          console.log(`Found ${history.length} transactions`);
          setTransactions(history);
        } else {
          console.warn('No transactions found or invalid format:', history);
          setTransactions([]);
        }
      } catch (err) {
        console.error('Failed to fetch transaction history:', err);
        setTransactions([]);
      }
    };

    fetchTransactions();
  }, [getTransactionHistory]);

  const filteredTransactions = transactions.filter(tx => 
    filter === 'all' || tx.type === filter
  );

  console.log('Filtered transactions:', filteredTransactions);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-green-600';
      case 'pending': return 'text-amber-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'mint': return <PlusIcon className="h-5 w-5 text-green-500" />;
      case 'burn': return <FireIcon className="h-5 w-5 text-red-500" />;
      case 'transfer': return <ArrowPathIcon className="h-5 w-5 text-blue-500" />;
      case 'position_entry': return <PlusIcon className="h-5 w-5 text-purple-500" />;
      case 'position_exit': return <MinusIcon className="h-5 w-5 text-orange-500" />;
      default: return <CurrencyDollarIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatAmount = (tx: Transaction) => {
    const currencySymbol = tx.details?.currency || 'OVT';
    return `${tx.amount.toLocaleString()} ${currencySymbol}`;
  };

  if (isLoading) {
    return <div className="p-4 text-center">Loading transaction history...</div>;
  }

  if (error) {
    return <div className="p-4 text-center text-red-500">Error: {error}</div>;
  }

  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Transaction History</h2>
        <div className="flex items-center space-x-2">
          <select
            className="border rounded p-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Transactions</option>
            <option value="mint">Mint</option>
            <option value="burn">Burn</option>
            <option value="transfer">Transfer</option>
            <option value="position_entry">Position Entry</option>
            <option value="position_exit">Position Exit</option>
          </select>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No transactions found. Transactions will appear here as they occur.
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No transactions match the selected filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.map((tx) => (
                <tr key={tx.txid} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getTypeIcon(tx.type)}
                      <span className="ml-2 capitalize">{tx.type.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {formatAmount(tx)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {formatDate(tx.timestamp)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`capitalize ${getStatusColor(tx.status)}`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tx.details.reason && <div>Reason: {tx.details.reason}</div>}
                    {tx.details.position && <div>Position: {tx.details.position}</div>}
                    {tx.details.signatures && tx.details.signatures.length > 0 && (
                      <div>Signatures: {tx.details.signatures.length}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
} 