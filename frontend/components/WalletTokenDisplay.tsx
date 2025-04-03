/**
 * WalletTokenDisplay Component
 * 
 * Displays token balances for a connected wallet.
 * Shows both Bitcoin and OVT token balances.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useLaserEyes } from '@omnisat/lasereyes';
import useRuneIntegration from '../src/hooks/useRuneIntegration';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import axios from 'axios';
import { getPriceStore, BitcoinPrice } from '../src/services/priceService'; // Import BitcoinPrice type
// Import the specific formatter we need from the central utility
import { formatSatsToCurrency } from '../src/utils/formatters'; 

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
  balance: number; // Raw numeric balance
  icon: string;
  formattedBalance?: string; // Explicitly string for display
  usdValue?: string; // Explicitly string for display
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
  // Get only the currency mode from the toggle hook
  const { currency } = useCurrencyToggle(); 
  const { price: ovtPriceSats } = useOVTPrice();
  const [btcBalanceSats, setBtcBalanceSats] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const priceStore = useMemo(() => getPriceStore(), []);
  const [btcPrice, setBtcPrice] = useState<number>(priceStore.btcPrice?.price || 0);
  
  useEffect(() => {
    const unsubscribe = priceStore.subscribeToBtcUpdates((newBtcPriceData: BitcoinPrice) => {
      setBtcPrice(newBtcPriceData.price);
    });
    setBtcPrice(priceStore.btcPrice?.price || 0);
    return unsubscribe;
  }, [priceStore]);

  const { 
    balance: ovtBalance, // This is the raw balance (e.g., 50000000 for 500k with 2 decimals)
    getBalance, 
    formatTokenAmount, // This formats the raw balance based on divisibility
    metadata,
    isConnected
  } = useRuneIntegration();

  const address = propAddress || walletAddress;
  
  // Fetch Bitcoin balance when address changes
  useEffect(() => {
    setIsLoading(true);
    setBtcBalanceSats(0); // Reset balance on address change
    
    // Only fetch balances if we have an address
    if (address) {
      // Try to fetch Bitcoin UTXOs directly from Signet explorer
      const fetchBitcoinBalance = async () => {
        try {
          // First try using LaserEyes
          const utxos = await getUtxos(address);
          const totalSats = utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0);
          setBtcBalanceSats(Number(totalSats) || 0); // Ensure it's a number
        } catch (error) {
          console.warn('Error fetching BTC balance from LaserEyes, falling back to mempool.space:', error);
          // Fallback to direct signet mempool.space API if LaserEyes fails
          try {
            const response = await axios.get(`https://mempool.space/signet/api/address/${address}/utxo`);
            if (response.data && Array.isArray(response.data)) {
              const totalSats = response.data.reduce((sum: number, utxo: any) => sum + utxo.value, 0);
              setBtcBalanceSats(Number(totalSats) || 0); // Ensure it's a number
            } else {
              setBtcBalanceSats(0);
            }
          } catch (signetError) {
            console.error('Error fetching BTC balance from signet explorer:', signetError);
            setBtcBalanceSats(0);
          }
        } finally {
          setIsLoading(false);
        }
      };
      
      fetchBitcoinBalance();
      
      // Assuming useRuneIntegration fetches its own balance internally now
      // getBalance(address).catch(console.error);
    } else {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, getUtxos]);
  
  // Calculate OVT value in Sats for formatting
  const ovtValueSats = useMemo(() => {
    if (!ovtPriceSats || !metadata || ovtBalance === undefined || ovtBalance === null) {
      return 0; 
    }
    const actualTokenAmount = ovtBalance / Math.pow(10, metadata.divisibility || 2);
    return actualTokenAmount * ovtPriceSats;
  }, [ovtBalance, ovtPriceSats, metadata]);
  
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
        balance={Number(btcBalanceSats) || 0} // Pass raw number
        // Use the central formatter based on currency mode
        formattedBalance={formatSatsToCurrency(btcBalanceSats, 'btc', btcPrice)} 
        usdValue={formatSatsToCurrency(btcBalanceSats, 'usd', btcPrice)} 
        icon="/images/bitcoin.svg" 
      />
      
      {/* OVT Token Balance */}
      <TokenCard 
        symbol="OVT" 
        name={metadata?.name || "OTORI Vision Token"} 
        balance={Number(ovtBalance) || 0} // Pass raw number
        // Use formatTokenAmount for the OVT *amount* display
        formattedBalance={formatTokenAmount(ovtBalance, metadata?.divisibility || 2)} 
        // Use the central formatter for the OVT *value* display (in USD or BTC)
        usdValue={formatSatsToCurrency(ovtValueSats, currency , btcPrice)} 
        icon="/images/ovt.svg" 
      />
    </div>
  );
};

export default WalletTokenDisplay; 