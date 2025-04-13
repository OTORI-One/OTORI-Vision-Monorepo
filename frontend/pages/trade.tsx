import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { getDataSourceIndicator } from '../src/lib/hybridModeUtils';
import WalletConnector from '../components/WalletConnector';
import CurrencyToggle from '../components/CurrencyToggle';
import NAVDisplay from '../components/NAVDisplay';
import { isAdminWallet } from '../src/utils/adminUtils';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useNAV } from '../src/hooks/useNAV';
import dynamic from 'next/dynamic';
import useRuneIntegration, { FinalTransactionResult } from '../src/hooks/useRuneIntegration'; // Import directly and add FinalTransactionResult
import axios from 'axios';
import { base64ToHex } from '../src/utils/hexUtils';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useOVTPrice } from '../src/hooks/useOVTPrice';
// import TransactionConfirmationModal from '../components/TransactionConfirmationModal'; // Remove if not using pending tx flow from useTradingModule
// import { useTradingModule } from '../src/hooks/useTradingModule'; // Remove useTradingModule

// Import components that depend on client-side data with dynamic import and SSR disabled
const DynamicTradingContent = dynamic(
  () => import('../components/TradingContent'),
  { ssr: false }
);

// Define the broadcast function (copied from index.tsx)
const broadcastTransaction = async (signedPsbtBase64: string): Promise<{ txid: string }> => {
  try {
    const psbtHex = base64ToHex(signedPsbtBase64);
    console.log("Broadcasting PSBT Hex:", psbtHex);
    const response = await axios.post('https://mempool.space/signet/api/tx', psbtHex, {
      headers: { 'Content-Type': 'text/plain' }
    });
    if (response.status !== 200 || typeof response.data !== 'string' || response.data.length !== 64) {
      throw new Error(`Failed to broadcast transaction. API returned status ${response.status}: ${response.data}`);
    }
    const txid = response.data;
    console.log("Broadcast successful. TXID:", txid);
    return { txid };
  } catch (error) {
    console.error("Error broadcasting transaction:", error);
    const message = axios.isAxiosError(error) && error.response?.data 
      ? `Broadcast failed: ${error.response.data}` 
      : error instanceof Error ? error.message : "Unknown broadcast error";
    throw new Error(message);
  }
};

export default function TradePage() {
  const { address: walletAddress, network, sendBTC, signPsbt } = useLaserEyes(); // Get sendBTC & signPsbt
  useNAV(); 
  const { currency, formatValue } = useCurrencyToggle(); // Get formatValue

  const isConnected = !!walletAddress;
  
  const [isMounted, setIsMounted] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [laserEyesWallets, setLaserEyesWallets] = useState<string[]>([]);
  
  // State for trading actions (mirroring index.tsx)
  const [buyAmount, setBuyAmount] = useState<string>('');
  const [sellAmount, setSellAmount] = useState<string>('');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isTradingActionLoading, setIsTradingActionLoading] = useState<boolean>(false);
  const [currentStepMessage, setCurrentStepMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<React.ReactNode | null>(null); // Allow JSX

  // Get data source indicator for trading
  const tradingDataSource = getDataSourceIndicator('trading');

  // Use useRuneIntegration directly
  const { 
    prepareBuyOVT,
    confirmBuyOVT,
    prepareSellOVT,
    confirmSellOVT,
    isLoading: runesHookLoading,
    error: runesHookError,
    metadata,
    balance: ovtBalance // Get balance from hook
  } = useRuneIntegration();
  
  // Get OVT price for market display
  const { price: ovtPriceSats, isLoading: ovtPriceLoading } = useOVTPrice();
  
  // Format the market price based on currency
  const displayedMarketPrice = useMemo(() => {
      return formatValue(ovtPriceSats); // formatValue handles sats -> currency
  }, [formatValue, ovtPriceSats]);

  useEffect(() => {
    setIsMounted(true);
    if (walletAddress) {
      setLaserEyesWallets([walletAddress]);
      setConnectedAddress(walletAddress);
      setIsAdmin(isAdminWallet(walletAddress));
    } else {
      setConnectedAddress(null);
      setIsAdmin(false);
    }
  }, [walletAddress]);

  // Wallet connection handlers
  const handleConnectWallet = (address: string) => {
    setConnectedAddress(address);
    setIsAdmin(isAdminWallet(address));
  };
  
  const handleDisconnectWallet = () => {
    setConnectedAddress(null);
    setIsAdmin(false);
  };

  // --- Buy/Sell Handlers (copied & adapted from index.tsx) ---
  const handleBuy = async (/* Removed e: React.FormEvent */) => {
    // e.preventDefault(); // Not needed if called directly onClick

    if (!connectedAddress || typeof sendBTC !== 'function') {
        setNetworkError("Wallet not connected or sendBTC function unavailable.");
        setCurrentStepMessage(null);
        setIsTradingActionLoading(false);
        return;
    }
    if (!buyAmount || parseFloat(buyAmount) <= 0) {
        setNetworkError("Please enter a valid amount to buy.");
        setCurrentStepMessage(null);
        setIsTradingActionLoading(false);
        return;
    }
    if (!metadata) {
        setNetworkError("Token metadata not loaded yet. Please wait.");
        setCurrentStepMessage(null);
        setIsTradingActionLoading(false);
        return;
    }

    setNetworkError(null);
    setSuccessMessage(null);
    setIsTradingActionLoading(true);
    setCurrentStepMessage("Step 1/3: Preparing buy transaction...");

    let confirmResult: FinalTransactionResult | null = null; // Declare confirmResult here

    try {
      const amount = parseFloat(buyAmount);
      const prepResult = await prepareBuyOVT(amount);

      if (!prepResult.success || !prepResult.orderId || !prepResult.paymentDetails) {
        throw new Error(prepResult.error || "Failed to prepare buy transaction.");
      }

      const { orderId, paymentDetails } = prepResult;
      const { recipientAddress, amountSats } = paymentDetails;

      setCurrentStepMessage(`Step 2/3: Please confirm sending ${amountSats} sats in your wallet.`);

      try {
        console.log(`Initiating LaserEyes sendBTC to ${recipientAddress} for ${amountSats} sats`);
        const txid = await sendBTC(recipientAddress, Number(amountSats));
        
        if (!txid) {
            throw new Error("BTC payment failed or was cancelled.");
        }
        
        console.log(`LaserEyes payment successful, txid: ${txid}`);
        const btcTxId = txid;
        setCurrentStepMessage(`Step 3/3: Payment sent (${btcTxId.substring(0, 10)}...). Confirming OVT transfer...`);
        
        // Assign to the outer scope variable
        confirmResult = await confirmBuyOVT(orderId, btcTxId);

        if (!confirmResult.success) {
          throw new Error(confirmResult.error || 'Failed to confirm purchase after payment.');
        }
      } catch (paymentError) {
        console.error('Payment step error:', paymentError);
        throw new Error(`BTC payment process failed: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`);
      }

      // Check if confirmResult is valid before using it
      if (!confirmResult || !confirmResult.success) {
          // Error was already thrown or handled, maybe add a generic fallback error
          throw new Error('Buy confirmation step failed.'); 
      }
      
      // Now confirmResult is accessible here and known to be successful
      const displayAmount = amount.toLocaleString();
      const ovtTxId = confirmResult.ovtTxId || confirmResult.txid;
      const ovtTxLink = ovtTxId ? `https://mempool.space/signet/tx/${ovtTxId}` : null;
      
      setSuccessMessage(
        <span>
          Successfully initiated purchase of {displayAmount} OVT units (⊙)! 
          {ovtTxLink ? <a href={ovtTxLink} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-800">View OVT Tx ({ovtTxId?.substring(0, 10)}...)</a> : `(OVT Tx: ${ovtTxId?.substring(0, 10)}...)`}
        </span>
      );
      setBuyAmount('');

    } catch (error) {
       const message = error instanceof Error ? error.message : "An unknown error occurred.";
       const stepInfo = currentStepMessage ? ` (Failed at: ${currentStepMessage})` : '';
       setNetworkError(`${message}${stepInfo}`);
    } finally {
      setIsTradingActionLoading(false);
      setCurrentStepMessage(null);
    }
  };
  
  const handleSell = async (/* Removed e: React.FormEvent */) => {
    // e.preventDefault(); // Not needed

    if (!connectedAddress || typeof signPsbt !== 'function') {
        setNetworkError("Wallet not connected or signing function unavailable.");
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
    setCurrentStepMessage("Step 1/4: Preparing sell transaction...");

    try {
      const amount = parseFloat(sellAmount);
      const prepResult = await prepareSellOVT(amount);

      if (!prepResult.success || !prepResult.orderId || !prepResult.psbtBase64) {
          throw new Error(prepResult.error || "Failed to prepare sell transaction.");
      }
      
      const { orderId, psbtBase64 } = prepResult;
      const displayAmount = amount.toLocaleString();
      
      setCurrentStepMessage(`Step 2/4: Please sign the transaction to transfer ${displayAmount} OVT units (⊙).`);

      const signedPsbtResult = await signPsbt(psbtBase64);

      if (!signedPsbtResult || !signedPsbtResult.signedPsbtBase64) {
          throw new Error("PSBT signing failed or was cancelled.");
      }
      const signedPsbtBase64 = signedPsbtResult.signedPsbtBase64;
      setCurrentStepMessage(`Step 3/4: Broadcasting OVT transfer...`);

      const broadcastResponse = await broadcastTransaction(signedPsbtBase64);
      const ovtTxId = broadcastResponse.txid;
      setCurrentStepMessage(`Step 4/4: OVT transfer broadcasted (${ovtTxId.substring(0,10)}...). Confirming sale...`);

      const confirmResult = await confirmSellOVT(orderId, ovtTxId);

      if (!confirmResult.success) {
        throw new Error(confirmResult.error || 'Failed to confirm sale after OVT transfer.');
      }

      const btcTxId = confirmResult.btcTxId || confirmResult.txid;
      const btcTxLink = btcTxId ? `https://mempool.space/signet/tx/${btcTxId}` : null;
      
      setSuccessMessage(
        <span>
          Successfully initiated sale of {displayAmount} OVT units (⊙)! 
          {btcTxLink ? <a href={btcTxLink} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-800">View Payment Tx ({btcTxId?.substring(0, 10)}...)</a> : `(Payment Tx: ${btcTxId?.substring(0, 10)}...)`}
        </span>
      );
      setSellAmount('');

    } catch (error) {
      const message = error instanceof Error ? error.message : "An unknown error occurred.";
      const stepInfo = currentStepMessage ? ` (Failed at: ${currentStepMessage})` : '';
      setNetworkError(`${message}${stepInfo}`);
    } finally {
      setIsTradingActionLoading(false);
      setCurrentStepMessage(null);
    }
  };
  // --- End Buy/Sell Handlers ---
  
  const isActionLoading = isTradingActionLoading || runesHookLoading || ovtPriceLoading;

  return (
    <Layout title="Trade OVT">
      {/* Top Navigation Bar (Keep existing structure) */}
      <div className="bg-white border-b border-primary shadow-sm p-4 mb-6 rounded-lg">
         {/* ... existing nav bar JSX ... */} 
         <div className="flex justify-between items-center">
           <div className="flex items-center space-x-6">
             <div className="flex items-center">
               <img className="h-8 w-auto mr-2" src="/logo.svg" alt="OTORI" />
               <span className="text-lg font-bold text-primary">OTORI Vision</span>
             </div>
             <nav className="flex space-x-4">
               <a href="/" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">Dashboard</a>
               <a href="/trade" className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-white">Trade</a>
               <a href="/wallet" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">Wallet</a>
               {isAdmin && (
                 <>
                   <a href="/portfolio" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">Portfolio</a>
                   <a href="/admin" className="px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary hover:bg-opacity-10">Admin</a>
                 </>
               )}
             </nav>
             <NAVDisplay showChange={true} size="md" />
           </div>
           <div className="flex items-center space-x-4">
             <CurrencyToggle size="md" />
             <WalletConnector 
               onConnect={handleConnectWallet}
               onDisconnect={handleDisconnectWallet}
               connectedAddress={connectedAddress || undefined}
             />
           </div>
         </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary">Trading Portal</h1>
          <p className="mt-2 text-sm text-primary opacity-75">
            Buy and sell OVT tokens on the Bitcoin Signet network.
             <span 
               className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${tradingDataSource.color === 'green' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
               {tradingDataSource.label}
             </span>
          </p>
        </div>

         {/* Status/Error Messages */} 
         {currentStepMessage && ( 
             <div className="bg-blue-100 border border-blue-400 text-blue-700 p-4 mb-4 rounded-lg mx-auto max-w-4xl"> 
                 <p><ArrowPathIcon className="h-5 w-5 inline-block animate-spin mr-2"/> {currentStepMessage}</p> 
             </div> 
         )} 
         {networkError && ( 
           <div className="bg-red-100 border border-red-400 text-red-700 p-4 mb-4 rounded-lg mx-auto max-w-4xl"> 
             <p>{networkError}</p> 
           </div> 
         )} 
         {successMessage && ( 
           <div className="bg-green-100 border border-green-400 text-green-700 p-4 mb-4 rounded-lg mx-auto max-w-4xl"> 
             <p>{successMessage}</p> 
           </div> 
         )} 
         {runesHookError && !networkError && ( // Display hook error if no other error shown
           <div className="bg-red-100 border border-red-400 text-red-700 p-4 mb-4 rounded-lg mx-auto max-w-4xl"> 
             <p>Error: {runesHookError}</p> 
           </div> 
         )}
        
        {/* Main Trading Content Area - Pass handlers down */} 
        {isMounted ? (
          <DynamicTradingContent 
            isConnected={isConnected}
            connectedAddress={connectedAddress}
            walletAddress={walletAddress}
            laserEyesWallets={laserEyesWallets}
            tradingDataSource={tradingDataSource}
            buyAmount={buyAmount}
            setBuyAmount={setBuyAmount}
            sellAmount={sellAmount}
            setSellAmount={setSellAmount}
            handleBuy={handleBuy} 
            handleSell={handleSell}
            isActionLoading={isActionLoading}
            metadata={metadata}
            ovtBalance={ovtBalance ?? 0}
            displayedMarketPrice={displayedMarketPrice}
          />
        ) : (
           <div className="text-center p-10">Loading Trading Interface...</div>
        )}
      </div>

       {/* Confirmation Modal - Removed as we handle steps directly now */}
       {/* {pendingTransaction && (
         <TransactionConfirmationModal
           isOpen={showConfirmation}
           onClose={handleCancelTransaction}
           onConfirm={handleConfirmTransaction}
           transactionDetails={pendingTransaction}
           isProcessing={isProcessingTx}
         />
       )} */}
    </Layout>
  );
} 