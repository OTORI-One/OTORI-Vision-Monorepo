import { renderHook, act } from '@testing-library/react';
import { useOVTClient } from '../useOVTClient';
import { useBitcoinPrice } from '../useBitcoinPrice';
import { RuneClient } from '../../lib/runeClient';
import { ArchClient } from '../../lib/archClient';
import React from 'react';

// Mock the useBitcoinPrice hook with a dedicated variable to make it easier to reference
const mockBitcoinPrice = { price: 50000, isLoading: false, error: null };

// Important: hoist mock before any imports in the tests
jest.mock('../useBitcoinPrice', () => ({
  __esModule: true, // This is important for ES module compatibility
  useBitcoinPrice: () => mockBitcoinPrice
}));

// Mock LaserEyes hook
jest.mock('@omnisat/lasereyes', () => ({
  useLaserEyes: () => ({ isEnabled: false, toggle: jest.fn(), address: 'test-address' })
}));

// Mock the RuneClient class
jest.mock('../../lib/runeClient', () => {
  const mockRuneClient = {
    getRuneInfo: jest.fn(() => Promise.resolve({
      id: 'test-rune-id',
      symbol: 'OVT',
      supply: {
        total: 2100000,
        distributed: 1000000,
        treasury: 1100000,
        percentDistributed: 4.76
      },
      events: []
    })),
    getDistributionStats: jest.fn(() => Promise.resolve({
      totalSupply: 2100000,
      treasuryHeld: 1680000,
      lpHeld: 210000,
      distributed: 210000,
      percentDistributed: 10,
      percentInLP: 10,
      treasuryAddresses: ['treasury-address'],
      lpAddresses: ['lp-address'],
      distributionEvents: []
    })),
    getRuneBalances: jest.fn(() => Promise.resolve([
      { address: 'treasury-address', amount: 1680000, isDistributed: false },
      { address: 'user1-address', amount: 105000, isDistributed: true },
      { address: 'user2-address', amount: 105000, isDistributed: true }
    ])),
    getTransactionInfo: jest.fn(() => Promise.resolve({
      txid: 'test-tx-id',
      type: 'buy',
      amount: 1000,
      timestamp: Date.now(),
      status: 'confirmed',
      details: { price: 1000 }
    })),
    addTreasuryAddress: jest.fn(),
    removeTreasuryAddress: jest.fn(),
    isTreasuryAddress: (addr: string) => addr === 'treasury-address'
  };

  return {
    RuneClient: function() { return mockRuneClient; },
    OVT_RUNE_ID: 'test-rune-id'
  };
});

// Mock ArchClient
jest.mock('../../lib/archClient', () => {
  const mockArchClient = {
    getCurrentNAV: jest.fn(() => Promise.resolve({
      value: 0,
      portfolioItems: []
    }))
  };

  return {
    ArchClient: function() { return mockArchClient; }
  };
});

// Create a properly typed mock localStorage for global use
const createMockLocalStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key],
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(key => delete store[key]); },
    store
  };
};

describe('useOVTClient', () => {
  // Setup before each test
  beforeEach(() => {
    // Create and setup local storage mock
    const mockStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    // Mock fetch
    global.fetch = jest.fn(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with correct default values', async () => {
    let result;
    await act(async () => {
      result = renderHook(() => useOVTClient());
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initial effects
    });

    expect(result.result.current.isLoading).toBe(false);
    expect(result.result.current.error).toBeNull();

    // Use a more flexible matcher that validates the structure but allows for price fluctuations
    expect(result.result.current.navData).toMatchObject({
      tokenDistribution: {
        totalSupply: expect.any(Number),
        distributed: expect.any(Number),
        runeId: expect.any(String),
        runeSymbol: expect.any(String),
        distributionEvents: expect.any(Array)
      }
    });
  });

  it('handles currency change', async () => {
    // Setup localStorage mock for this test
    const localStorageMock = {
      store: {},
      getItem: (key: string) => localStorageMock.store[key],
      setItem: (key: string, value: string) => { localStorageMock.store[key] = value; },
      clear: () => { localStorageMock.store = {}; }
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    let result;
    await act(async () => {
      result = renderHook(() => useOVTClient());
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initial effects
    });

    await act(async () => {
      result.result.current.handleCurrencyChange('btc');
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for state updates
    });

    expect(result.result.current.baseCurrency).toBe('btc');
    expect(localStorageMock.store['ovt-currency-preference']).toBe('btc');

    // Test the setBaseCurrency alias
    await act(async () => {
      result.result.current.setBaseCurrency('usd');
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for state updates
    });

    expect(result.result.current.baseCurrency).toBe('usd');
    expect(localStorageMock.store['ovt-currency-preference']).toBe('usd');
  });

  it('handles API errors gracefully', async () => {
    // Create a function that will cause an error when trying to reduce portfolio positions
    const mockSetPortfolioPositions = jest.fn(() => {
      throw new Error('Simulated error in portfolio processing');
    });
    
    // Apply our mocked function
    const { result } = renderHook(() => useOVTClient());
    
    // Force an error by setting portfolioPositions to null
    await act(async () => {
      // This should directly reference the hook's setPortfolioPositions
      result.current.setPortfolioPositions(null as any); // Force TS to accept null
      
      // Now trigger fetchNAV which will try to use the null portfolioPositions
      result.current.handleCurrencyChange('usd');
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for state updates
    });

    expect(result.current.error).toBe('Failed to fetch portfolio data');
  });

  it('updates portfolio positions', async () => {
    let result: any;
    await act(async () => {
      result = renderHook(() => useOVTClient());
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initial effects
    });

    const newPositions = [
      {
        name: 'Test Position',
        value: 1000000,
        current: 1000000,
        change: 0,
        description: 'Test Description',
        tokenAmount: 100,
        pricePerToken: 10000,
        address: 'test-address'
      }
    ];

    await act(async () => {
      result.result.current.setPortfolioPositions(newPositions);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for state updates
    });

    expect(result.result.current.portfolioPositions).toEqual(newPositions);
  });

  it('formats values correctly with k notation', () => {
    const { result } = renderHook(() => useOVTClient());
    
    // Test BTC formatting when baseCurrency is btc
    act(() => {
      result.current.handleCurrencyChange('btc');
    });
    expect(result.current.formatValue(100000000)).toBe('₿1.00');
    expect(result.current.formatValue(1000000000)).toBe('₿10.00');
    expect(result.current.formatValue(1500)).toBe('1.5k sats');
    
    // Test USD formatting when baseCurrency is usd
    act(() => {
      result.current.handleCurrencyChange('usd');
    });
    expect(result.current.formatValue(100000000)).toBe('$50.0k'); // 1 BTC = $50k
    expect(result.current.formatValue(1000000)).toBe('$500'); // 0.01 BTC = $500
    expect(result.current.formatValue(200000)).toBe('$100'); // 0.002 BTC = $100
  });

  it('fetches NAV data on mount', async () => {
    const { result } = renderHook(() => useOVTClient());

    // Wait for initial data fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Check that the rune data matches our mock
    expect(result.current.navData.tokenDistribution.runeId).toBe('test-rune-id');
    expect(result.current.navData.tokenDistribution.runeSymbol).toBe('OVT');
  });

  it('handles Bitcoin price changes correctly', async () => {
    // Mock implementation function
    const { result, rerender } = renderHook(() => useOVTClient());
    
    // Set currency to USD and let the hook use the initial mock price (50000)
    await act(async () => {
      result.current.handleCurrencyChange('usd');
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Check formatting with 50k price
    expect(result.current.formatValue(100000000)).toBe('$50.0k');
    
    // Update the mock to return a new price
    const newMockPrice = { price: 60000, isLoading: false, error: null };
    
    // Update the global mockBitcoinPrice for future renders
    Object.assign(mockBitcoinPrice, newMockPrice);
    
    // Re-render with the new price
    await act(async () => {
      // Trigger a re-render
      rerender();
      // Then trigger the fetch with a currency change
      result.current.handleCurrencyChange('usd');
      await new Promise(resolve => setTimeout(resolve, 200)); // Longer timeout
    });
    
    // Check if values are updated with new BTC price
    expect(result.current.btcPrice).toBe(60000);
  });
}); 