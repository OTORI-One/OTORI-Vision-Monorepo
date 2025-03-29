/**
 * WalletTokenDisplay Component
 * 
 * Displays token balances for a connected wallet.
 * Shows both Bitcoin and OVT token balances.
 */

import React, { useEffect, useState } from 'react';
import { useLaserEyes } from '@omnisat/lasereyes';
import useRuneIntegration from '../hooks/useRuneIntegration';
import { useBitcoinPrice } from '../hooks/useBitcoinPrice';

// Define UTXO interface
interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status?: {
    confirmed: boolean;
    confirmations?: number;
  };
}

interface TokenCardProps {
  symbol: string;
  name: string;
  balance: number;
  icon: string;
  formattedBalance?: string;
  usdValue?: string;
}

const TokenCard: React.FC<TokenCardProps> = ({ 
  symbol, 
  name, 
  balance, 
  icon,
  formattedBalance,
  usdValue
}) => {
  return (
    <div className="flex items-center p-4 bg-white rounded-lg shadow-md mb-4">
      <div className="flex-shrink-0 mr-4">
        <img src={icon} alt={`${symbol} icon`} className="w-12 h-12" />
      </div>
      <div className="flex-grow">
        <h2 className="text-xl font-semibold">{name}</h2>
        <p className="text-gray-600">{symbol}</p>
      </div>
      <div className="text-right">
        <div className="text-xl font-bold">{formattedBalance || balance.toString()}</div>
        {usdValue && <div className="text-sm text-gray-500">{usdValue}</div>}
      </div>
    </div>
  );
};

interface WalletTokenDisplayProps {
  address?: string;
}

const WalletTokenDisplay: React.FC<WalletTokenDisplayProps> = ({ address: propAddress }) => {
  const { address: walletAddress, connected, getUtxos } = useLaserEyes();
  const { price: btcPrice } = useBitcoinPrice();
  const [btcBalance, setBtcBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Use our new Rune integration hook
  const { 
    balance: ovtBalance,
    getBalance, 
    formatTokenAmount,
    metadata,
    isConnected
  } = useRuneIntegration();
  
  // Use address from props or from wallet
  const address = propAddress || walletAddress;
  
  // Fetch Bitcoin balance when address changes
  useEffect(() => {
    setIsLoading(true);
    
    // Only fetch balances if we have an address
    if (address) {
      // Fetch BTC balance from LaserEyes
      getUtxos(address)
        .then((utxos: UTXO[]) => {
          const totalSats = utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0);
          setBtcBalance(totalSats);
        })
        .catch((error: Error) => {
          console.error('Error fetching BTC balance:', error);
          setBtcBalance(0);
        })
        .finally(() => setIsLoading(false));
      
      // Get OVT balance using our new hook (already handled in the hook internally)
      getBalance(address).catch(console.error);
    } else {
      setIsLoading(false);
    }
  }, [address, getUtxos, getBalance]);
  
  // Format the BTC balance
  const formatBtcBalance = (satoshis: number): string => {
    // Format as BTC with 8 decimal places
    const btc = satoshis / 100000000;
    return `₿${btc.toFixed(8)}`;
  };
  
  // Calculate USD value of BTC balance
  const calculateBtcUsdValue = (satoshis: number): string => {
    if (!btcPrice) return '$0.00';
    
    const btc = satoshis / 100000000;
    const usdValue = btc * btcPrice;
    
    // Format USD value
    return `$${usdValue.toFixed(2)}`;
  };
  
  // Calculate USD value of OVT balance
  const calculateOvtUsdValue = (ovtAmount: number): string => {
    if (!btcPrice || !metadata) return '$0.00';
    
    // Convert to actual token amount using divisibility
    const actualAmount = ovtAmount / Math.pow(10, metadata.divisibility || 2);
    
    // Assume 250 sats per OVT (based on the runes_API.js)
    const satValue = actualAmount * 250;
    const btcValue = satValue / 100000000;
    const usdValue = btcValue * (btcPrice || 50000);
    
    return `$${usdValue.toFixed(2)}`;
  };
  
  // Handle connection state
  if (!isConnected && !propAddress) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg">
        <p className="text-center text-gray-600">Connect your wallet to view token balances</p>
      </div>
    );
  }
  
  // Show loading state
  if (isLoading) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg">
        <p className="text-center text-gray-600">Loading balances...</p>
      </div>
    );
  }
  
  return (
    <div className="wallet-token-display">
      <h1 className="text-2xl font-bold mb-4">Your Tokens</h1>
      
      {/* Bitcoin Balance */}
      <TokenCard 
        symbol="BTC" 
        name="Bitcoin" 
        balance={btcBalance}
        formattedBalance={formatBtcBalance(btcBalance)}
        usdValue={calculateBtcUsdValue(btcBalance)}
        icon="/images/bitcoin.svg" 
      />
      
      {/* OVT Token Balance */}
      <TokenCard 
        symbol="OVT" 
        name="OTORI Vision Token" 
        balance={ovtBalance}
        formattedBalance={formatTokenAmount(ovtBalance, metadata?.divisibility || 2)}
        usdValue={calculateOvtUsdValue(ovtBalance)}
        icon="/images/ovt.svg" 
      />
    </div>
  );
};

export default WalletTokenDisplay; 