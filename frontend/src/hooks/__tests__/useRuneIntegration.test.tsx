import { renderHook, act } from '@testing-library/react-hooks';
import axios from 'axios';
import useRuneIntegration from '../useRuneIntegration';
import { useLaserEyes } from '@omnisat/lasereyes';

// Mock dependencies
jest.mock('axios');
jest.mock('@omnisat/lasereyes', () => ({
  useLaserEyes: jest.fn()
}));

// Mock response data
const mockMetadata = {
  id: '240249:101',
  symbol: 'OTORI•VISION•TOKEN',
  ticker: 'OVT',
  name: 'OTORI Vision Token',
  description: 'Investment token for Bitcoin-based venture capital',
  supply: {
    total: 2100000,
    circulating: 1000000,
    maximum: 2100000,
  },
  divisibility: 2,
  icon: '/images/ovt-logo.svg'
};

const mockBalanceResponse = {
  data: {
    balances: [
      {
        address: 'tb1pmock_address',
        amount: 50000,
        runeId: '240249:101'
      }
    ]
  }
};

const mockInfoResponse = {
  data: {
    rune: {
      runeId: '240249:101',
      name: 'OTORI•VISION•TOKEN',
      symbol: '⊙',
      supply: 2100000,
      distributed: 1000000,
      divisibility: 2
    }
  }
};

const mockDistributionResponse = {
  data: {
    distributionStats: {
      totalSupply: 2100000,
      distributed: 1000000,
      treasuryHeld: 0,
      lpHeld: 1100000,
      percentDistributed: 47.62,
      percentInLP: 52.38
    }
  }
};

const mockTransactionsResponse = {
  data: {
    transactions: [
      {
        txid: 'mock_tx_1',
        type: 'receive',
        amount: 30000,
        address: 'tb1psender_address',
        timestamp: Date.now() - 86400000,
        confirmations: 10,
        status: 'confirmed'
      }
    ]
  }
};

const mockWalletAddress = 'tb1pmock_address';

describe('useRuneIntegration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock LaserEyes hook return value
    (useLaserEyes as jest.Mock).mockReturnValue({
      address: mockWalletAddress,
      connected: true,
      signMessage: jest.fn().mockResolvedValue({
        signature: 'mock_signature',
        pubkey: 'mock_pubkey'
      })
    });
    
    // Mock axios get responses
    (axios.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/ovt/balances')) {
        return Promise.resolve(mockBalanceResponse);
      } else if (url.includes('/ovt/info')) {
        return Promise.resolve(mockInfoResponse);
      } else if (url.includes('/ovt/distribution')) {
        return Promise.resolve(mockDistributionResponse);
      } else if (url.includes('/ovt/transactions')) {
        return Promise.resolve(mockTransactionsResponse);
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
    
    // Mock axios post response
    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        txid: 'mock_transfer_txid',
        status: 'pending',
        confirmations: 0
      }
    });
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useRuneIntegration());
    
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.balance).toBe(0);
    expect(result.current.metadata).toBeNull();
    expect(result.current.transactions).toEqual([]);
    expect(result.current.OVT_RUNE_ID).toBe('240249:101');
    expect(result.current.OVT_RUNE_SYMBOL).toBe('OTORI•VISION•TOKEN');
    expect(result.current.OVT_RUNE_TICKER).toBe('OVT');
  });

  it('should fetch wallet balance', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useRuneIntegration());
    
    // Trigger the getBalance function
    act(() => {
      const promise = result.current.getBalance(mockWalletAddress);
      return promise;
    });
    
    await waitForNextUpdate();
    
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/ovt/balances'));
    expect(result.current.balance).toBe(50000);
  });

  it('should fetch token metadata', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useRuneIntegration());
    
    // Trigger the getTokenMetadata function
    act(() => {
      const promise = result.current.getTokenMetadata();
      return promise;
    });
    
    await waitForNextUpdate();
    
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/ovt/info'));
    expect(result.current.metadata).toMatchObject({
      id: expect.any(String),
      symbol: expect.any(String),
      ticker: expect.any(String),
      name: expect.any(String),
      description: expect.any(String)
    });
  });

  it('should fetch distribution stats', async () => {
    const { result } = renderHook(() => useRuneIntegration());
    
    // Call the getDistributionStats function
    const stats = await result.current.getDistributionStats();
    
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/ovt/distribution'));
    expect(stats).toEqual(mockDistributionResponse.data.distributionStats);
  });

  it('should fetch transaction history', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useRuneIntegration());
    
    // Trigger the getTransactionHistory function
    act(() => {
      const promise = result.current.getTransactionHistory(mockWalletAddress);
      return promise;
    });
    
    await waitForNextUpdate();
    
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/ovt/transactions'));
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.transactions[0]).toMatchObject({
      txid: 'mock_tx_1',
      type: 'receive',
      amount: 30000
    });
  });

  it('should transfer tokens', async () => {
    const { result } = renderHook(() => useRuneIntegration());
    
    const fromAddress = mockWalletAddress;
    const toAddress = 'tb1precipient_address';
    const amount = 1000;
    
    // Call the transferRune function
    const transferResult = await result.current.transferRune(fromAddress, toAddress, '240249:101', amount);
    
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/ovt/transfer'),
      expect.objectContaining({
        fromAddress,
        toAddress,
        amount
      })
    );
    
    expect(transferResult).toMatchObject({
      txid: 'mock_transfer_txid',
      status: 'pending'
    });
  });

  it('should format token amounts correctly', () => {
    const { result } = renderHook(() => useRuneIntegration());
    
    // Test with default divisibility (2)
    expect(result.current.formatTokenAmount(12345)).toBe('123.45');
    
    // Test with custom divisibility
    expect(result.current.formatTokenAmount(12345, 3)).toBe('12.345');
    expect(result.current.formatTokenAmount(12345, 0)).toBe('12345');
  });

  it('should handle API errors gracefully', async () => {
    // Mock API error
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error('API Error'));
    
    const { result, waitForNextUpdate } = renderHook(() => useRuneIntegration());
    
    // Trigger the getBalance function with an error
    act(() => {
      const promise = result.current.getBalance(mockWalletAddress);
      return promise;
    });
    
    await waitForNextUpdate();
    
    expect(result.current.error).toBe('Failed to fetch token balance');
    expect(result.current.balance).toBe(0); // Should use fallback value
  });
}); 