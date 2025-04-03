import { useState, useEffect } from 'react';
import { usePortfolio } from '../../src/hooks/usePortfolio';
import { useCurrencyToggle } from '../../src/hooks/useCurrencyToggle';
import { PortfolioPosition } from '../../src/utils/priceMovement';

const SATS_PER_BTC = 100000000;

interface PositionManagementProps {
  onActionRequiringMultiSig: (action: any) => void;
}

export default function PositionManagement({ onActionRequiringMultiSig }: PositionManagementProps) {
  const { formatValue } = useCurrencyToggle();
  const { positions, refreshPortfolio } = usePortfolio();
  const [newPosition, setNewPosition] = useState({
    name: '',
    description: '',
    investmentAmount: '', // in BTC
    pricePerToken: '', // in sats
  });
  const [error, setError] = useState<string | null>(null);

  // Calculate token amount based on investment amount and price per token
  const calculateTokenAmount = (): number => {
    const btcAmount = parseFloat(newPosition.investmentAmount);
    const pricePerToken = parseFloat(newPosition.pricePerToken);
    
    if (isNaN(btcAmount) || isNaN(pricePerToken) || pricePerToken <= 0) {
      return 0;
    }

    // Convert BTC to sats and divide by price per token in sats
    return Math.floor((btcAmount * SATS_PER_BTC) / pricePerToken);
  };

  const formatTokenAmount = (amount: number): string => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(2)}M tokens`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(2)}k tokens`;
    }
    return `${Math.floor(amount)} tokens`;
  };

  const handleInputChange = (field: keyof typeof newPosition, value: string) => {
    setError(null); // Clear error when any field changes
    setNewPosition(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Validate required fields first
      if (!newPosition.name.trim()) {
        setError('Project name is required');
        return;
      }
      if (!newPosition.description.trim()) {
        setError('Description is required');
        return;
      }

      const btcAmount = parseFloat(newPosition.investmentAmount);
      const pricePerToken = parseFloat(newPosition.pricePerToken);
      
      if (isNaN(btcAmount) || btcAmount <= 0) {
        setError('Invalid investment amount');
        return;
      }
      if (isNaN(pricePerToken) || pricePerToken <= 0) {
        setError('Invalid price per token');
        return;
      }

      const satsValue = Math.floor(btcAmount * SATS_PER_BTC);
      const tokenAmount = calculateTokenAmount();
      
      const portfolioData: PortfolioPosition = {
        name: newPosition.name,
        description: newPosition.description,
        value: satsValue,
        current: satsValue, // Initially, current value equals initial value
        change: 0, // Initially, no change
        tokenAmount,
        pricePerToken: Math.floor(parseFloat(newPosition.pricePerToken)),
        address: 'bc1p...', // Mock address for testing
        transactionId: `tx_${Date.now()}` // Generate a unique transaction ID
      };

      // This will require multi-sig approval
      onActionRequiringMultiSig({
        type: 'ADD_POSITION',
        description: `Add position for ${portfolioData.name}`,
        data: portfolioData,
        execute: async (signatures: string[]) => {
          // TODO: Implement the actual API call to add the position using signatures.
          // For now, we just refresh the portfolio list, assuming the backend
          // processes the addition and the refresh gets the latest state.
          console.log('Simulating adding position with signatures:', signatures);
          await refreshPortfolio(); 
          
          // Reset form
          setNewPosition({
            name: '',
            description: '',
            investmentAmount: '',
            pricePerToken: ''
          });
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add position');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Add New Position</h3>
          
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Project Name
              </label>
              <input
                type="text"
                name="name"
                id="name"
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                value={newPosition.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                value={newPosition.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="investmentAmount" className="block text-sm font-medium text-gray-700">
                Investment Amount (BTC)
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="number"
                  name="investmentAmount"
                  id="investmentAmount"
                  required
                  step="0.00000001"
                  min="0"
                  className="block w-full rounded-md border-gray-300 pl-7 pr-12 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder="0.00000000"
                  value={newPosition.investmentAmount}
                  onChange={(e) => handleInputChange('investmentAmount', e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">BTC</span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="pricePerToken" className="block text-sm font-medium text-gray-700">
                Price per Token (sats)
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="number"
                  name="pricePerToken"
                  id="pricePerToken"
                  required
                  step="1"
                  min="1"
                  className="block w-full rounded-md border-gray-300 pl-7 pr-12 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder="0"
                  value={newPosition.pricePerToken}
                  onChange={(e) => handleInputChange('pricePerToken', e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">sats</span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="tokenAmount" className="block text-sm font-medium text-gray-700">
                Token Amount (Calculated)
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  type="text"
                  name="tokenAmount"
                  id="tokenAmount"
                  className="block w-full pr-12 sm:text-sm border-gray-300 rounded-md disabled:bg-gray-100"
                  value={calculateTokenAmount()}
                  disabled
                  aria-label="Token Amount (Calculated)"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm" id="token-amount-display">
                    {calculateTokenAmount() ? formatTokenAmount(calculateTokenAmount()) : '0 tokens'}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4" role="alert">
                <div className="flex">
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Error</h3>
                    <div className="mt-2 text-sm text-red-700">
                      <p>{error}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Add Position
            </button>
          </form>
        </div>
      </div>

      {/* Current Positions */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg border border-primary">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-primary">Current Positions</h3>
        </div>
        <div className="border-t border-primary border-opacity-20">
          <ul role="list" className="divide-y divide-primary divide-opacity-20">
            {positions.map((position, index) => (
              <li key={index} className="px-4 py-4 sm:px-6 hover:bg-primary hover:bg-opacity-5 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-lg font-medium text-primary">{position.name}</h4>
                    <p className="mt-1 text-sm text-primary opacity-75">{position.description}</p>
                    <p className="mt-1 text-sm text-primary">
                      {formatTokenAmount(position.tokenAmount)} @ {formatValue(position.pricePerToken)}
                    </p>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <div className="text-sm text-primary text-right">
                      Initial: {formatValue(position.value)}
                    </div>
                    <div className="text-sm text-primary text-right">
                      Current: {formatValue(position.current)}
                    </div>
                    <div className={`text-sm ${position.change >= 0 ? 'text-success' : 'text-error'}`}>
                      {position.change >= 0 ? '+' : ''}
                      {position.change}%
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
} 