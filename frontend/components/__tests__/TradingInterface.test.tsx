import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TradingInterface } from '../TradingInterface';
import { useRuneIntegration } from '../../src/hooks/useRuneIntegration';
import { useCurrencyToggle } from '../../src/hooks/useCurrencyToggle';
import { useOVTPrice } from '../../src/hooks/useOVTPrice';

// Mock @headlessui/react Switch component
jest.mock('@headlessui/react', () => ({
  Switch: ({ checked, onChange, className, children }) => (
    <button
      data-testid="mock-switch"
      className={className}
      onClick={() => onChange(!checked)}
    >
      {children}
    </button>
  )
}));

// Mock the hooks
jest.mock('../../src/hooks/useOVTClient', () => ({
  useOVTClient: () => ({
    formatValue: (value) => `${value} sats`,
    baseCurrency: 'btc',
    btcPrice: 50000,
    dataSourceIndicator: {
      trading: {
        isMock: true,
        label: 'Test Data',
        color: 'blue'
      }
    },
    isLoading: false,
    error: null,
    navData: {
      totalValueSats: 371000000,
      portfolioItems: []
    }
  }),
  SATS_PER_BTC: 100000000
}));

jest.mock('../../src/hooks/useTradingModule', () => ({
  useTradingModule: () => ({
    buyOVT: jest.fn().mockResolvedValue({
      txid: 'mock-tx-123',
      status: 'confirmed',
    }),
    sellOVT: jest.fn().mockResolvedValue({
      txid: 'mock-tx-456',
      status: 'confirmed',
    }),
    getMarketPrice: jest.fn().mockResolvedValue(700),
    estimatePriceImpact: jest.fn().mockResolvedValue(700),
    isLoading: false,
    error: null,
    dataSourceIndicator: {
      isMock: true,
      label: 'Test Data',
      color: 'blue'
    }
  })
}));

// Mock the new hooks
jest.mock('../../src/hooks/useRuneIntegration');
jest.mock('../../src/hooks/useCurrencyToggle');
jest.mock('../../src/hooks/useOVTPrice');
jest.mock('../../src/hooks/usePortfolio');

describe('TradingInterface', () => {
  beforeEach(() => {
    // Setup default mocks
    (useRuneIntegration as jest.Mock).mockReturnValue({
      buyOVT: jest.fn().mockResolvedValue({
        txid: 'mock-txid-123',
        status: 'confirmed',
        price: 700,
        timestamp: Date.now()
      }),
      sellOVT: jest.fn().mockResolvedValue({
        txid: 'mock-txid-456',
        status: 'confirmed',
        price: 710,
        timestamp: Date.now()
      }),
      isLoading: false,
      error: null,
      balance: 500,
      getBalance: jest.fn(),
      getTransactionHistory: jest.fn()
    });

    (useCurrencyToggle as jest.Mock).mockReturnValue({
      currency: 'btc',
      formatValue: jest.fn((val) => `${val} sats`),
      toggleCurrency: jest.fn()
    });

    (useOVTPrice as jest.Mock).mockReturnValue({
      price: 700,
      btcPriceFormatted: '₿0.000007',
      usdPriceFormatted: '$0.35'
    });
  });

  test('renders trading interface with buy and sell panels', () => {
    render(<TradingInterface />);
    
    expect(screen.getByText('Trading Interface')).toBeInTheDocument();
    expect(screen.getByText('Buy OVT')).toBeInTheDocument();
    expect(screen.getByText('Sell OVT')).toBeInTheDocument();
  });

  test('toggles between market and limit orders', async () => {
    render(<TradingInterface />);
    
    // Initially market order (not showing limit price input)
    expect(screen.queryByLabelText('Limit Price')).not.toBeInTheDocument();
    
    // Click the toggle switch
    fireEvent.click(screen.getByTestId('mock-switch'));
    
    // Should now show limit price inputs
    await waitFor(() => {
      expect(screen.getAllByLabelText('Limit Price')[0]).toBeInTheDocument();
      expect(screen.getAllByLabelText('Limit Price')[1]).toBeInTheDocument();
    });
  });

  test('handles buy order submission', async () => {
    const mockBuyOVT = jest.fn().mockResolvedValue({
      txid: 'mock-buy-txid',
      status: 'confirmed',
      price: 700,
      timestamp: Date.now()
    });
    
    (useRuneIntegration as jest.Mock).mockReturnValue({
      buyOVT: mockBuyOVT,
      sellOVT: jest.fn(),
      isLoading: false,
      error: null,
      balance: 500,
      getBalance: jest.fn(),
      getTransactionHistory: jest.fn()
    });

    render(<TradingInterface />);
    
    // Enter buy amount
    fireEvent.change(screen.getByLabelText('Buy Amount'), {
      target: { value: '100' }
    });
    
    // Submit the buy order
    fireEvent.click(screen.getByText('Buy OVT'));
    
    // Check that buyOVT was called with the right parameters
    await waitFor(() => {
      expect(mockBuyOVT).toHaveBeenCalledWith(100, undefined);
      expect(screen.getByText(/Transaction Confirmed/)).toBeInTheDocument();
    });
  });

  test('handles sell order submission', async () => {
    const mockSellOVT = jest.fn().mockResolvedValue({
      txid: 'mock-sell-txid',
      status: 'confirmed',
      price: 710,
      timestamp: Date.now()
    });
    
    (useRuneIntegration as jest.Mock).mockReturnValue({
      buyOVT: jest.fn(),
      sellOVT: mockSellOVT,
      isLoading: false,
      error: null,
      balance: 500,
      getBalance: jest.fn(),
      getTransactionHistory: jest.fn()
    });

    render(<TradingInterface />);
    
    // Enter sell amount
    fireEvent.change(screen.getByLabelText('Sell Amount'), {
      target: { value: '50' }
    });
    
    // Submit the sell order
    fireEvent.click(screen.getByText('Sell OVT'));
    
    // Check that sellOVT was called with the right parameters
    await waitFor(() => {
      expect(mockSellOVT).toHaveBeenCalledWith(50, undefined);
      expect(screen.getByText(/Transaction Confirmed/)).toBeInTheDocument();
    });
  });

  test('toggles transaction history view', async () => {
    render(<TradingInterface />);
    
    // Transaction history should not be visible initially
    expect(screen.queryByText('Transaction History')).not.toBeInTheDocument();
    
    // Click the View Transaction History button
    fireEvent.click(screen.getByText('View Transaction History'));
    
    // Now transaction history should be visible
    await waitFor(() => {
      expect(screen.getByText('Transaction History')).toBeInTheDocument();
    });
  });
}); 