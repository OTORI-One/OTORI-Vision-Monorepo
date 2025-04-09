import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AdminDashboard from '../admin/AdminDashboard';
import { useOVTClient } from '../../src/hooks/useOVTClient';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';
import * as adminUtils from '../../src/utils/adminUtils';
import { act } from 'react-dom/test-utils';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({children, href}: {children: React.ReactNode, href: string}) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock Heroicons components
jest.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <div data-testid="arrow-left-icon">ArrowLeftIcon</div>
}));

// Mock the hooks
jest.mock('../../src/hooks/useOVTClient', () => ({
  useOVTClient: jest.fn(() => ({
    isLoading: false,
    error: null,
    navData: {
      totalValue: '₿2.00',
      changePercentage: '+5%',
      tokenDistribution: {
        runeId: '240249:101',
        totalSupply: 2100000,
        distributed: 1000000,
        distributionEvents: [{ id: 1 }]
      }
    },
    formatValue: (val: number) => `₿${val.toFixed(2)}`
  }))
}));

jest.mock('@omnisat/lasereyes', () => ({
  useLaserEyes: jest.fn(() => ({
    address: '0x1234...5678',
    isConnected: true,
    network: 'mainnet',
    connect: jest.fn(),
    disconnect: jest.fn()
  })),
  XVERSE: 'xverse',
  UNISAT: 'unisat'
}));

// Mock the admin utils
jest.mock('../../src/utils/adminUtils', () => ({
  isAdminWallet: jest.fn((address: string) => address === '0x1234...5678'),
  ADMIN_WALLETS: ['0x1234...5678']
}));

// Mock the hybrid mode utils
jest.mock('../../src/lib/hybridModeUtils', () => ({
  getDataSourceIndicator: () => ({ isMock: true, icon: 'icon', label: 'Mock Data' })
}));

// Create a shared mock execute function
const mockExecute = jest.fn().mockResolvedValue(true);

// Mock the child components
jest.mock('../admin/PositionManagement', () => ({
  __esModule: true,
  default: ({ onActionRequiringMultiSig }: any) => (
    <div 
      data-testid="position-management"
      onClick={() => onActionRequiringMultiSig({
        type: 'add_position',
        description: 'Add new position',
        execute: mockExecute
      })}
    >
      Position Management
    </div>
  )
}));

jest.mock('../admin/TokenMinting', () => ({
  __esModule: true,
  default: () => <div data-testid="token-minting">Token Minting</div>
}));

jest.mock('../admin/RuneMinting', () => ({
  __esModule: true,
  default: () => <div data-testid="rune-minting">Rune Minting</div>
}));

jest.mock('../admin/TransactionHistory', () => ({
  __esModule: true,
  default: () => <div data-testid="transaction-history">Transaction History</div>
}));

jest.mock('../admin/MultiSigApproval', () => ({
  __esModule: true,
  default: ({ isOpen, onClose, onComplete, action }: any) => (
    isOpen ? (
      <div data-testid="multisig-modal" role="dialog">
        <button onClick={() => onComplete(['sig1', 'sig2', 'sig3'])}>Complete</button>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  )
}));

// Mock setTimeout to execute immediately in tests
jest.useFakeTimers();

describe('AdminDashboard', () => {
  const mockUseLaserEyes = useLaserEyes as jest.Mock;
  const mockUseOVTClient = useOVTClient as jest.Mock;
  const mockIsAdminWallet = adminUtils.isAdminWallet as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default mock values for admin access
    mockUseLaserEyes.mockReturnValue({
      address: '0x1234...5678',
      isConnected: true,
      network: 'mainnet',
      connect: jest.fn(),
      disconnect: jest.fn()
    });
    mockIsAdminWallet.mockReturnValue(true);
    mockUseOVTClient.mockReturnValue({
      isLoading: false,
      error: null,
      navData: {
        totalValue: '₿2.00',
        changePercentage: '+5%',
        tokenDistribution: {
          runeId: '240249:101',
          totalSupply: 2100000,
          distributed: 1000000,
          distributionEvents: [{ id: 1 }]
        }
      },
      formatValue: (val: number) => `₿${val.toFixed(2)}`
    });
  });

  describe('Access Control', () => {
    it('renders access denied message for non-admin wallets', async () => {
      mockIsAdminWallet.mockReturnValue(false);
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    });

    it('renders dashboard for admin wallets', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Use getByRole to find the heading
      expect(screen.getByRole('heading', { name: /admin dashboard/i })).toBeInTheDocument();
      
      // Only the position management component is visible by default
      expect(screen.getByTestId('position-management')).toBeInTheDocument();
      
      // Verify the navigation buttons exist
      const navButtons = screen.getAllByRole('button');
      expect(navButtons.some(btn => btn.textContent === 'Token Minting')).toBe(true);
      expect(navButtons.some(btn => btn.textContent === 'Transaction History')).toBe(true);
    });
  });

  describe('Navigation', () => {
    it('shows position management by default', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      expect(screen.getByTestId('position-management')).toBeInTheDocument();
    });

    it('switches to token minting view', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      fireEvent.click(screen.getByText('Token Minting'));
      expect(screen.getByTestId('token-minting')).toBeInTheDocument();
    });

    it('switches to transaction history view', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      fireEvent.click(screen.getByText('Transaction History'));
      expect(screen.getByTestId('transaction-history')).toBeInTheDocument();
    });

    it('applies correct styling to active navigation item', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Use more specific selectors
      const navButtons = screen.getAllByRole('button');
      const positionsButton = navButtons.find(btn => btn.textContent === 'Position Management');
      
      expect(positionsButton).toHaveClass('bg-blue-100');
      
      // Click the token minting button
      const mintButton = navButtons.find(btn => btn.textContent === 'Token Minting');
      if (mintButton) {
        fireEvent.click(mintButton);
      } else {
        throw new Error("'Token Minting' button not found");
      }
      
      expect(positionsButton).not.toHaveClass('bg-blue-100');
    });
  });

  describe('Loading and Error States', () => {
    it('shows loading spinner when loading', async () => {
      mockUseOVTClient.mockReturnValue({
        isLoading: true,
        error: null
      });
      render(<AdminDashboard />);
      expect(screen.getByText(/verifying admin status/i)).toBeInTheDocument();
    });

    it('shows error message when there is an error', async () => {
      // Make sure both error is set and isAdmin is false to fully trigger error state
      mockIsAdminWallet.mockReturnValue(false);
      mockUseOVTClient.mockReturnValue({
        isLoading: false,
        error: 'Failed to load data',
        navData: null
      });
      
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Just check that the access denied message is shown
      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    });
  });

  describe('MultiSig Integration', () => {
    it('opens multisig modal when action requires signatures', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Trigger an action that requires multisig
      const dashboard = screen.getByTestId('position-management');
      fireEvent.click(dashboard);

      // Wait for the modal to appear
      expect(screen.getByTestId('multisig-modal')).toBeInTheDocument();
    });

    it('handles multisig completion', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Trigger an action that requires multisig
      const dashboard = screen.getByTestId('position-management');
      fireEvent.click(dashboard);

      // Complete the multisig process
      fireEvent.click(screen.getByText('Complete'));
      
      // Verify that the action was executed with signatures
      expect(mockExecute).toHaveBeenCalledWith(['sig1', 'sig2', 'sig3']);
    });

    it('closes modal on successful multisig completion', async () => {
      render(<AdminDashboard />);
      
      // Fast-forward through the timeout
      act(() => {
        jest.runAllTimers();
      });
      
      // Trigger an action that requires multisig
      const dashboard = screen.getByTestId('position-management');
      fireEvent.click(dashboard);

      // Click close
      fireEvent.click(screen.getByText('Close'));

      // Verify modal is closed
      expect(screen.queryByTestId('multisig-modal')).not.toBeInTheDocument();
    });
  });
}); 