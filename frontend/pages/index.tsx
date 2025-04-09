import { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import { ArrowUpIcon, CurrencyDollarIcon, CircleStackIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import WalletConnector from '../components/WalletConnector';
import PortfolioChart from '../components/PortfolioChart';
import ChartToggle from '../components/ChartToggle';
import AdminDashboard from '../components/admin/AdminDashboard';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import Layout from '../components/Layout';
import { isAdminWallet } from '../src/utils/adminUtils';
import CurrencyToggle from '../components/CurrencyToggle';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { usePortfolio } from '../src/hooks/usePortfolio';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
import dynamic from 'next/dynamic';
import useRuneIntegration from '../src/hooks/useRuneIntegration';

// Import client-only components with dynamic imports
const PriceChart = dynamic(() => import('../components/PriceChart'), { ssr: false });
const NAVDisplay = dynamic(() => import('../components/NAVDisplay'), { ssr: false });

export default function Dashboard() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'price' | 'nav'>('nav');
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isTradingActionLoading, setIsTradingActionLoading] = useState<boolean>(false);
  const [currentStepMessage, setCurrentStepMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const previousNavRef = useRef<number>(0);
  const lastCurrencyRef = useRef<string | null>(null);
  
  const { currency, formatValue: formatCurrencyValue } = useCurrencyToggle();
  
  const { 
    btcPriceFormatted, 
    usdPriceFormatted, 
    dailyChangeFormatted, 
    isPositiveChange,
    isLoading: ovtPriceLoading,
  } = useOVTPrice();

  const { network, address, sendBTC, signPsbt } = useLaserEyes();
  
  const { 
    prepareBuyOVT,
    confirmBuyOVT,
    prepareSellOVT,
    confirmSellOVT,
    isLoading: runesHookLoading,
    error: runesHookError,
    metadata,
    formatTokenAmount,
  } = useRuneIntegration();
  
  const { positions } = usePortfolio();
  
  const displayedChangePercentage = useMemo(() => {
    return {
      changeText: dailyChangeFormatted, 
      isPositive: isPositiveChange
    };
  }, [dailyChangeFormatted, isPositiveChange]);
  
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  
  const handleConnectWallet = (addr: string) => {
    setConnectedAddress(addr);
    setIsAdmin(isAdminWallet(addr));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };
  
  useEffect(() => {
    if (typeof window === 'undefined') return; 
    const walletAddress = address || network;
    if (walletAddress) {
      setConnectedAddress(walletAddress);
      setIsAdmin(isAdminWallet(walletAddress));
    } else {
      setConnectedAddress(null);
      setIsAdmin(false);
    }
  }, [network, address]);
  
  const handleBuy = async () => {
    if (!connectedAddress || typeof sendBTC !== 'function') {
        setNetworkError("Wallet not connected or sendBTC function unavailable.");
        return;
    }
    if (!buyAmount || parseFloat(buyAmount) <= 0) {
        setNetworkError("Please enter a valid amount to buy.");
        return;
    }
    if (!metadata) {
        setNetworkError("Token metadata not loaded yet. Please wait.");
        return;
    }

    setNetworkError(null);
    setSuccessMessage(null);
    setIsTradingActionLoading(true);
    setCurrentStepMessage("Preparing buy transaction...");

    try {
      const amount = parseFloat(buyAmount);
      const prepResult = await prepareBuyOVT(amount);

      if (!prepResult.success || !prepResult.orderId || !prepResult.paymentDetails) {
        throw new Error(prepResult.error || "Failed to prepare buy transaction.");
      }

      const { orderId, paymentDetails } = prepResult;
      const { recipientAddress, amountSats, memo } = paymentDetails;

      setCurrentStepMessage(`Prepared Order ${orderId}. Please confirm sending ${amountSats} sats to ${recipientAddress} in your wallet.`);

      console.log(`Requesting BTC payment via LaserEyes: ${amountSats} sats to ${recipientAddress}`);
      const txid = await sendBTC(recipientAddress, amountSats);

      if (!txid) {
          throw new Error("BTC payment failed or was cancelled by the user (no txid returned).");
      }
      const btcTxId = txid;
      console.log(`BTC Payment successful: ${btcTxId}`);
      setCurrentStepMessage(`Payment sent (${btcTxId}). Confirming OVT transfer...`);

      const confirmResult = await confirmBuyOVT(orderId, btcTxId);

      if (!confirmResult.success) {
        throw new Error(confirmResult.error || "Failed to confirm purchase after payment.");
      }

      console.log("Buy Confirmation successful:", confirmResult);
      setSuccessMessage(`Successfully purchased ${amount} OVT! OVT TxID: ${confirmResult.ovtTxId || confirmResult.txid}`);
      setBuyAmount('');

    } catch (error) {
       console.error('Buy process failed:', error);
       setNetworkError(error instanceof Error ? error.message : "An unknown error occurred during the buy process.");
    } finally {
      setIsTradingActionLoading(false);
      setCurrentStepMessage(null);
    }
  };
  
  const handleSell = async () => {
    if (!connectedAddress || typeof signPsbt !== 'function') {
        setNetworkError("Wallet not connected or signing function unavailable (verify LaserEyes API).");
        return;
    }
     if (!sellAmount || parseFloat(sellAmount) <= 0) {
        setNetworkError("Please enter a valid amount to sell.");
        return;
    }
     if (!metadata) {
        setNetworkError("Token metadata not loaded yet. Please wait.");
        return;
    }

    setNetworkError(null);
    setSuccessMessage(null);
    setIsTradingActionLoading(true);
    setCurrentStepMessage("Preparing sell transaction...");

    try {
      const amount = parseFloat(sellAmount);
      const prepResult = await prepareSellOVT(amount);

      if (!prepResult.success || !prepResult.orderId || !prepResult.psbtBase64) {
          throw new Error(prepResult.error || "Failed to prepare sell transaction. Invalid response.");
      }
      
      const { orderId, psbtBase64 } = prepResult;
      
      setCurrentStepMessage(`Prepared Order ${orderId}. Please sign the transaction in your wallet to transfer OVT.`);

      console.log("Requesting PSBT signature via LaserEyes for PSBT:", psbtBase64);
      const signedPsbtResult = await signPsbt(psbtBase64);

      if (!signedPsbtResult || !signedPsbtResult.signedPsbtBase64) {
          throw new Error("PSBT signing failed or was cancelled by the user.");
      }
      const signedPsbtBase64 = signedPsbtResult.signedPsbtBase64;
      console.log(`PSBT Signed successfully (Base64):`, signedPsbtBase64);
      setCurrentStepMessage(`Transaction signed. Broadcasting OVT transfer...`);

      const broadcastResponse = await mockBroadcastTransaction(signedPsbtBase64);
      
      if (!broadcastResponse || !broadcastResponse.txid) {
          throw new Error("Failed to broadcast the signed OVT transfer transaction.");
      }
      const ovtTxId = broadcastResponse.txid;
      console.log(`OVT Transfer broadcasted: ${ovtTxId}`);
      setCurrentStepMessage(`OVT transfer broadcasted (${ovtTxId}). Confirming sale and BTC payment...`);

      const confirmResult = await confirmSellOVT(orderId, ovtTxId);

      if (!confirmResult.success) {
        throw new Error(confirmResult.error || "Failed to confirm sale after OVT transfer.");
      }

      console.log("Sell Confirmation successful:", confirmResult);
      setSuccessMessage(`Successfully sold ${amount} OVT! Payment TxID: ${confirmResult.btcTxId || confirmResult.txid}`);
      setSellAmount('');

    } catch (error) {
      console.error('Sell process failed:', error);
      setNetworkError(error instanceof Error ? error.message : "An unknown error occurred during the sell process.");
    } finally {
      setIsTradingActionLoading(false);
      setCurrentStepMessage(null);
    }
  };
  
  const mockBroadcastTransaction = async (signedPsbtBase64: string): Promise<{ txid: string } | null> => {
    console.warn("Using MOCK broadcastTransaction. Replace with actual implementation.");
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mockTx = "mock_ovt_tx_" + Date.now().toString().slice(-6);
    console.log("Mock Broadcast TXID:", mockTx);
    return { txid: mockTx };
  };

  const isActionLoading = isTradingActionLoading || runesHookLoading || ovtPriceLoading;

  return (
    <Layout>
      <Head>
        <title>OTORI Vision - Dashboard</title>
        <meta name="description" content="OTORI Vision Dashboard - Bitcoin VC Fund" />
      </Head>
      
      <div className="flex flex-col">
        <div className="bg-white border-b border-primary shadow-sm p-2 sm:p-4 mb-6 rounded-lg">
          <div className="flex flex-col sm:flex-row justify-between items-center">
            <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-6 w-full sm:w-auto mb-3 sm:mb-0">
              <div className="flex items-center">
                <img className="h-8 w-auto mr-2" src="/logo.svg" alt="OTORI" />
                <span className="text-lg font-bold text-primary">OTORI Vision</span>
              </div>
              
              <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
                <a href="/" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">
                  Dashboard
                </a>
                <a href="/trade" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Trade
                </a>
                <a href="/wallet" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                  Wallet
                </a>
                {isAdmin && (
                  <>
                    <a href="/portfolio" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                      Portfolio
                    </a>
                    <a href="/admin" className="px-2 sm:px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">
                      Admin
                    </a>
                  </>
                )}
              </nav>
              
              <div className="hidden md:block">
                <NAVDisplay showChange={true} size="sm" />
              </div>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              <CurrencyToggle size="sm" />
              
              <WalletConnector 
                onConnect={handleConnectWallet}
                onDisconnect={handleDisconnectWallet}
                connectedAddress={connectedAddress || undefined}
                showTokens={false}
              />
            </div>
          </div>
          
          <div className="md:hidden mt-3 flex justify-center">
            <NAVDisplay showChange={true} size="sm" />
          </div>
        </div>
        
        {currentStepMessage && (
            <div className="bg-blue-100 border border-blue-400 text-blue-700 p-4 mb-4 rounded-lg"> 
                <p>{currentStepMessage}</p> 
            </div> 
        )} 
        {networkError && ( 
          <div className="bg-red-100 border border-red-400 text-red-700 p-4 mb-4 rounded-lg"> 
            <p>{networkError}</p> 
          </div> 
        )} 
        {successMessage && ( 
          <div className="bg-green-100 border border-green-400 text-green-700 p-4 mb-4 rounded-lg"> 
            <p>{successMessage}</p> 
          </div> 
        )} 
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-primary rounded-lg shadow-sm p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-primary">Portfolio Performance</h2>
              <ChartToggle 
                activeChart={activeChart} 
                onToggle={(chart: 'price' | 'nav') => setActiveChart(chart)} 
              />
            </div>
            
            <div className="h-80">
              {activeChart === 'nav' ? (
                <PortfolioChart />
              ) : (
                <PriceChart />
              )}
            </div>
          </div>
          
          <div className="space-y-6">
            <div className="bg-white border border-primary rounded-lg shadow-sm p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-primary">OVT Price</h2>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-primary">Current Price:</span>
                  <span className="text-primary font-medium text-lg">
                    {currency === 'usd' ? usdPriceFormatted : btcPriceFormatted}
                  </span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-primary">24h Change:</span>
                  <span className={`font-medium ${displayedChangePercentage.isPositive ? 'text-success' : 'text-error'}`}>
                    {displayedChangePercentage.changeText}
                  </span>
                </div>
              </div>
            </div>
            
            {connectedAddress && (
              <div className="bg-white border border-primary rounded-lg shadow-sm p-4">
                <h2 className="text-xl font-semibold text-primary mb-4">Trade OVT</h2>
                
                <div className="mb-4">
                  <label className="block text-primary mb-2">Buy OVT</label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={buyAmount}
                      onChange={(e) => setBuyAmount(e.target.value)}
                      className="flex-grow bg-white border border-primary border-opacity-20 text-primary rounded p-2"
                      placeholder="Amount (e.g. 100.00)"
                      disabled={isActionLoading}
                    />
                    <button
                      onClick={handleBuy}
                      disabled={isActionLoading || !buyAmount}
                      className="bg-success hover:bg-success/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                      {isTradingActionLoading ? 'Processing...' : 'Buy'}
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-primary mb-2">Sell OVT</label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      className="flex-grow bg-white border border-primary border-opacity-20 text-primary rounded p-2"
                      placeholder="Amount (e.g. 50.00)"
                      disabled={isActionLoading}
                    />
                    <button
                      onClick={handleSell}
                      disabled={isActionLoading || !sellAmount}
                      className="bg-error hover:bg-error/80 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                       {isTradingActionLoading ? 'Processing...' : 'Sell'}
                    </button>
                  </div>
                </div>
                 {runesHookError && !networkError && (
                   <p className="text-error text-sm mt-2">{runesHookError}</p> 
                 )} 
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
} 