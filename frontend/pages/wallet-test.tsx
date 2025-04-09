import { useLaserEyes } from '@omnisat/lasereyes-react';
import { XVERSE, UNISAT, BaseNetwork } from '@omnisat/lasereyes-core';
import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import axios from 'axios';

export default function WalletTest() {
  const { address, connect, disconnect, network } = useLaserEyes();
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  const isConnected = !!address; // Derive isConnected from address

  const addLog = (message: string) => {
    setConnectionLog(prev => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  useEffect(() => {
    addLog(`Component mounted. Address: ${address || 'none'}, Connected: ${isConnected}`);
  }, [address, isConnected]);

  useEffect(() => {
    if (address) {
      addLog(`Address changed: ${address}`);
    }
  }, [address]);

  const handleConnect = async (wallet: 'unisat' | 'xverse') => {
    addLog(`Attempting to connect with ${wallet}...`);
    try {
      const provider = wallet === 'unisat' ? UNISAT : XVERSE;
      await connect(provider);
      addLog(`Connected to ${wallet}. Address: ${address || 'not available yet'}`);
    } catch (error) {
      addLog(`Error connecting to ${wallet}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDisconnect = async () => {
    addLog('Attempting to disconnect...');
    try {
      await disconnect();
      addLog('Disconnected successfully');
    } catch (error) {
      addLog(`Error disconnecting: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <Layout title="Wallet Connection Test">
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Wallet Connection Test</h1>
        
        <div className="mb-6 p-4 bg-gray-100 rounded">
          <div className="mb-2"><strong>Current State:</strong></div>
          <div>Address: {address || 'Not connected'}</div>
          <div>Connected: {isConnected ? 'Yes' : 'No'}</div>
          <div>Network: {network || 'Unknown'}</div>
        </div>
        
        <div className="mb-6">
          <div className="flex space-x-4">
            <button 
              onClick={() => handleConnect('unisat')}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              Connect Unisat
            </button>
            <button 
              onClick={() => handleConnect('xverse')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Connect Xverse
            </button>
            <button 
              onClick={handleDisconnect}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Disconnect
            </button>
          </div>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">Connection Log:</h2>
          <pre className="bg-gray-800 text-green-400 p-4 rounded h-64 overflow-auto">
            {connectionLog.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </pre>
        </div>
      </div>
    </Layout>
  );
} 