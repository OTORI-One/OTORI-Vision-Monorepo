import { useState, useCallback, useEffect, useRef } from 'react';
import { UNISAT, XVERSE, useLaserEyes, ProviderType } from '@omnisat/lasereyes';
import WalletTokenDisplay from '../src/components/WalletTokenDisplay';

interface WalletConnectorProps {
  onConnect: (address: string) => void;
  onDisconnect: () => void;
  connectedAddress?: string;
  showTokens?: boolean;
}

export default function WalletConnector({ onConnect, onDisconnect, connectedAddress, showTokens = false }: WalletConnectorProps) {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBalances, setShowBalances] = useState(false);
  const { connect, disconnect, address, network } = useLaserEyes();
  // Add a ref to track connection state
  const previousConnectedRef = useRef<string | null>(null);
  
  // Event emitter for wallet connections - fixed to avoid state updates during render
  useEffect(() => {
    // Only call onConnect if we have a new address and it's not already connected
    if (address && !connectedAddress && address !== previousConnectedRef.current) {
      previousConnectedRef.current = address;
      onConnect(address);
    }
  }, [address, connectedAddress, onConnect]);
  
  // Network badge styling based on network
  const getNetworkBadgeStyle = (networkName: string | null) => {
    if (!networkName) return 'bg-gray-100 text-gray-800';
    
    switch (networkName.toLowerCase()) {
      case 'mainnet':
        return 'bg-green-700 text-white';
      case 'testnet':
      case 'testnet3':
      case 'testnet4':
        return 'bg-blue-700 text-white';
      case 'signet':
        return 'bg-purple-700 text-white';
      case 'regtest':
        return 'bg-orange-700 text-white';
      default:
        return 'bg-gray-700 text-white';
    }
  };
  
  // Function to format the network name
  const formatNetworkName = (networkName: string | null) => {
    if (!networkName) return 'Unknown';
    
    // If it's a testnet with a number (like testnet4), just return "Testnet"
    if (networkName.toLowerCase().startsWith('testnet')) {
      return 'Testnet';
    }
    
    // Make first letter uppercase and the rest lowercase
    return networkName.charAt(0).toUpperCase() + networkName.slice(1).toLowerCase();
  };
  
  const handleConnect = useCallback(async (wallet: ProviderType) => {
    try {
      await connect(wallet);
    } catch (err) {
      console.error('Failed to connect wallet', err);
      setError('Failed to connect wallet');
    }
  }, [connect]);
  
  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      
      if (onDisconnect) {
        onDisconnect();
      }
      
      // Hide balances when disconnecting
      setShowBalances(false);
    } catch (err) {
      console.error('Failed to disconnect wallet', err);
      setError('Failed to disconnect wallet');
    }
    setError(null);
  }, [disconnect, onDisconnect]);
  
  const toggleBalances = useCallback(() => {
    setShowBalances(prev => !prev);
  }, []);
  
  if (connectedAddress) {
    return (
      <div className="flex flex-col">
        <div className="flex items-center space-x-4">
          <div 
            className="flex items-center px-4 py-2 bg-white border border-primary rounded-md shadow-sm cursor-pointer"
            onClick={toggleBalances}
          >
            <div className="flex flex-col">
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 bg-success rounded-full mr-2"></div>
                <span className="text-xs text-primary font-medium">Connected Wallet</span>
              </div>
              <div className="flex items-center mt-1">
                <span className="text-sm font-mono text-primary font-medium tracking-wide">
                  {connectedAddress.slice(0, 10)}...{connectedAddress.slice(-6)}
                </span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${getNetworkBadgeStyle(network)}`}>
                  {formatNetworkName(network || 'Testnet')}
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDisconnect();
              }}
              className="ml-3 text-sm text-primary hover:text-primary-dark border border-primary border-opacity-50 rounded-md px-2 py-0.5 hover:bg-primary hover:bg-opacity-10 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
        
        {/* Token Balances Display */}
        {(showBalances || showTokens) && (
          <div className="mt-2 w-full">
            <WalletTokenDisplay address={connectedAddress} />
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div className="relative">
      <button
        onClick={() => setWalletMenuOpen(!walletMenuOpen)}
        className="flex items-center justify-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50 transition-colors font-medium"
      >
        <span className="mr-2">Connect Wallet</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform ${walletMenuOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {walletMenuOpen && (
        <div className="absolute right-0 mt-2 w-60 bg-white rounded-md shadow-lg z-50 border border-primary">
          <div className="p-4">
            <h3 className="text-lg font-semibold text-primary mb-4">Connect Wallet</h3>
            
            <div className="space-y-2">
              
              <button
                onClick={() => handleConnect(XVERSE)}
                className="w-full flex items-center justify-between px-4 py-2 text-primary bg-white border border-primary rounded-md hover:bg-primary hover:bg-opacity-5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50"
              >
                <span>Xverse</span>
                <img src="/icons/xverse.svg" alt="Xverse" className="h-5 w-5" />
              </button>
              
              <button
                onClick={() => handleConnect(UNISAT)}
                className="w-full flex items-center justify-between px-4 py-2 text-primary bg-white border border-primary rounded-md hover:bg-primary hover:bg-opacity-5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50"
              >
                <span>Unisat</span>
                <img src="/icons/unisat.svg" alt="Unisat" className="h-5 w-5" />
              </button>
            </div>
            
            {error && (
              <div className="mt-4 p-2 bg-error bg-opacity-10 text-error text-sm rounded">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}