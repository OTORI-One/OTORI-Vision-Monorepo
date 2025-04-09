// ovt-fund/components/__tests__/MultiSigApproval.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import MultiSigApproval from '../admin/MultiSigApproval';
import { mockAdminWallet, generateMockAdminKeys } from '../../test-utils/test-utils';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';

// Mock LaserEyes hook
jest.mock('@omnisat/lasereyes', () => ({
  useLaserEyes: jest.fn(),
  XVERSE: 'xverse'
}));

describe('MultiSigApproval', () => {
  const mockAction = {
    type: 'MINT_TOKENS',
    description: 'Mint 1000 OVT tokens',
    data: {
      amount: 1000,
      recipient: '0x123...abc'
    }
  };

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onComplete: jest.fn(),
    action: mockAction
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup LaserEyes mock implementation
    (useLaserEyes as jest.Mock).mockReturnValue({
      connect: mockAdminWallet.connect,
      disconnect: mockAdminWallet.disconnect,
      signMessage: mockAdminWallet.signMessage,
      address: mockAdminWallet.currentAdminKey
    });
  });

  it('renders correctly when open', () => {
    render(<MultiSigApproval {...defaultProps} />);
    
    expect(screen.getByText('MultiSig Approval Required')).toBeInTheDocument();
    expect(screen.getByText('This action requires approval from 3 out of 5 admin wallets.')).toBeInTheDocument();
    expect(screen.getByText(mockAction.type)).toBeInTheDocument();
    expect(screen.getByText(mockAction.description)).toBeInTheDocument();
  });

  it('shows connect wallet button when wallet is not connected', () => {
    (useLaserEyes as jest.Mock).mockReturnValue({
      ...mockAdminWallet,
      address: null
    });

    render(<MultiSigApproval {...defaultProps} />);
    
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('handles wallet connection', async () => {
    (useLaserEyes as jest.Mock).mockReturnValue({
      ...mockAdminWallet,
      address: null
    });

    render(<MultiSigApproval {...defaultProps} />);
    
    const connectButton = screen.getByText('Connect Wallet');
    
    await act(async () => {
      fireEvent.click(connectButton);
    });

    expect(mockAdminWallet.connect).toHaveBeenCalledWith('xverse');
  });

  it('allows signing with different admin keys', async () => {
    const { rerender } = render(<MultiSigApproval {...defaultProps} />);
    
    // First signature
    const signButton = screen.getByText('Sign');
    
    await act(async () => {
      fireEvent.click(signButton);
    });
    
    expect(mockAdminWallet.signMessage).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('1/5 signatures collected')).toBeInTheDocument();
    });

    // Switch admin and sign again
    await act(async () => {
      mockAdminWallet.currentAdminKey = '0x222...222';
      (useLaserEyes as jest.Mock).mockReturnValue({
        ...mockAdminWallet,
        address: '0x222...222',
        signMessage: mockAdminWallet.signMessage
      });
    });

    rerender(<MultiSigApproval {...defaultProps} />);

    const newSignButton = screen.getByText('Sign');
    await act(async () => {
      fireEvent.click(newSignButton);
    });
    
    await waitFor(() => {
      expect(screen.getByText('2/5 signatures collected')).toBeInTheDocument();
    });
  });

  it('shows complete button when enough signatures are collected', async () => {
    const { rerender } = render(<MultiSigApproval {...defaultProps} />);

    // Collect 3 signatures
    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        mockAdminWallet.currentAdminKey = `0x${i}${i}${i}...${i}${i}${i}`;
        (useLaserEyes as jest.Mock).mockReturnValue({
          ...mockAdminWallet,
          address: mockAdminWallet.currentAdminKey
        });
      });

      await act(async () => {
        rerender(<MultiSigApproval {...defaultProps} />);
      });
      
      const signButton = screen.getByText('Sign');
      await act(async () => {
        fireEvent.click(signButton);
      });
    }

    expect(screen.getByText('Complete Transaction')).toBeInTheDocument();
  });

  it('calls onComplete with collected signatures', async () => {
    render(<MultiSigApproval {...defaultProps} />);

    // Collect 3 signatures
    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        mockAdminWallet.currentAdminKey = `0x${i}${i}${i}...${i}${i}${i}`;
        (useLaserEyes as jest.Mock).mockReturnValue({
          ...mockAdminWallet,
          address: mockAdminWallet.currentAdminKey
        });

        const signButton = screen.getByText('Sign');
        fireEvent.click(signButton);
      });
    }

    const completeButton = screen.getByText('Complete Transaction');
    await act(async () => {
      fireEvent.click(completeButton);
    });

    expect(defaultProps.onComplete).toHaveBeenCalledWith(expect.any(Array));
    expect(defaultProps.onComplete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('signature')
      ])
    );
  });

  it('resets state when modal is closed and reopened', async () => {
    const { rerender } = render(<MultiSigApproval {...defaultProps} />);
    
    // Sign once
    const signButton = screen.getByText('Sign');
    await act(async () => {
      fireEvent.click(signButton);
    });
    
    // Close modal
    await act(async () => {
      rerender(<MultiSigApproval {...defaultProps} isOpen={false} />);
    });
    
    // Reopen modal
    await act(async () => {
      rerender(<MultiSigApproval {...defaultProps} isOpen={true} />);
    });
    
    expect(screen.getByText('0/5 signatures collected')).toBeInTheDocument();
  });
});