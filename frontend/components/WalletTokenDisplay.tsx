/**
 * WalletTokenDisplay Component
 * 
 * Displays token balances for a connected wallet.
 * Shows both Bitcoin and OVT token balances.
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
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
  const [isLoadingBtc, setIsLoadingBtc] = useState<boolean>(true);
  const [isUpdatingOvt, setIsUpdatingOvt] = useState<boolean>(false);
  const prevOvtBalanceRef = useRef<number>();
  
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
    isConnected,
    isLoading: isLoadingOvt
  } = useRuneIntegration();

  const address = propAddress || walletAddress;
  
  // Fetch Bitcoin balance when address changes
  useEffect(() => {
    let isMounted = true;
    setIsLoadingBtc(true);
    setBtcBalanceSats(0); // Reset balance on address change
    
    // Only fetch balances if we have an address
    if (address) {
      // Try to fetch Bitcoin UTXOs directly from Signet explorer
      const fetchBitcoinBalance = async () => {
        try {
          // First try using LaserEyes
          const utxos = await getUtxos(address);
          const totalSats = utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0);
          if (isMounted) setBtcBalanceSats(Number(totalSats) || 0); // Ensure it's a number
        } catch (error) {
          console.warn('Error fetching BTC balance from LaserEyes, falling back to mempool.space:', error);
          // Fallback to direct signet mempool.space API if LaserEyes fails
          try {
            const response = await axios.get(`https://mempool.space/signet/api/address/${address}/utxo`);
            if (isMounted && response.data && Array.isArray(response.data)) {
              const totalSats = response.data.reduce((sum: number, utxo: any) => sum + utxo.value, 0);
              if (isMounted) setBtcBalanceSats(Number(totalSats) || 0); // Ensure it's a number
            } else {
              if (isMounted) setBtcBalanceSats(0);
            }
          } catch (signetError) {
            console.error('Error fetching BTC balance from signet explorer:', signetError);
            if (isMounted) setBtcBalanceSats(0);
          }
        } finally {
          if (isMounted) setIsLoadingBtc(false);
        }
      };
      
      fetchBitcoinBalance();
      
      // Assuming useRuneIntegration fetches its own balance internally now
      // getBalance(address).catch(console.error);
    } else {
      setIsLoadingBtc(false);
    }
    
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, getUtxos]);
  
  // Effect to detect OVT balance changes and trigger flash
  useEffect(() => {
    // Only trigger flash if balance has actually changed and is not the initial undefined/null value
    if (prevOvtBalanceRef.current !== undefined && ovtBalance !== prevOvtBalanceRef.current) {
      setIsUpdatingOvt(true);
      const timer = setTimeout(() => setIsUpdatingOvt(false), 1500); // Flash duration 1.5s
      return () => clearTimeout(timer);
    }
    // Store current balance for next comparison
    prevOvtBalanceRef.current = ovtBalance;
  }, [ovtBalance]);
  
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
  const isLoading = isLoadingBtc || isLoadingOvt;
  if (isLoading && ovtBalance === undefined) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg">
        <p className="text-center text-gray-600">Loading balances...</p>
      </div>
    );
  }
  
  return (
    <div className="wallet-token-display space-y-4">
      <h1 className="text-2xl font-bold mb-4">Your Tokens</h1>
      
      {/* Bitcoin Balance */}
      <div className="flex items-center p-4 bg-white rounded-lg shadow-md">
        <div className="flex-shrink-0 mr-4">
          <img src="/images/bitcoin.svg" alt="BTC icon" className="w-12 h-12" />
        </div>
        <div className="flex-grow">
          <h2 className="text-xl font-semibold">Bitcoin</h2>
          <p className="text-gray-600">BTC</p>
        </div>
        <div className="text-right">
          {isLoadingBtc ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="text-xl font-bold">{formatSatsToCurrency(btcBalanceSats, 'btc', btcPrice)}</div>
              <div className="text-sm text-gray-500">{formatSatsToCurrency(btcBalanceSats, 'usd', btcPrice)}</div>
            </>
          )}
        </div>
      </div>
      
      {/* OVT Token Balance */}
      <div className={`flex items-center p-4 bg-white rounded-lg shadow-md transition-colors duration-300 ${isUpdatingOvt ? 'balance-update-flash' : ''}`}>
        <div className="flex-shrink-0 mr-4">
          <img src="/images/ovt.svg" alt="OVT icon" className="w-12 h-12" />
        </div>
        <div className="flex-grow">
          <h2 className="text-xl font-semibold">{metadata?.name || "OTORI Vision Token"}</h2>
          <p className="text-gray-600">{metadata?.ticker || "OVT"}</p>
        </div>
        <div className="text-right">
          {isLoadingOvt && ovtBalance === undefined ? (
             <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="text-xl font-bold">
                {formatTokenAmount(ovtBalance ?? 0, metadata?.divisibility || 2)}
              </div>
              <div className="text-sm text-gray-500">
                {formatSatsToCurrency(ovtValueSats, currency , btcPrice)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletTokenDisplay; 