import { PublicKey } from '@omnisat/lasereyes-core';

// Target the core package for module augmentation
declare module '@omnisat/lasereyes-core' {
  // Ensure PublicKey is exported correctly or adjust augmentation if needed
  export class PublicKey {
    toString(): string;
    toBuffer(): Buffer;
    equals(other: PublicKey): boolean;
  }
}

export interface ArchTransaction {
  txid: string;
  type: 'MINT' | 'BURN' | 'TRANSFER' | 'POSITION_ENTRY' | 'POSITION_EXIT' | 'BUY' | 'SELL';
  amount: number;
  confirmations: number;
  timestamp: number;
  metadata?: {
    reason?: string;
    position?: string;
    signatures?: string[];
    currency?: string;
    price?: number;
    status?: 'pending' | 'confirmed' | 'failed';
    orderType?: 'market' | 'limit';
    limitPrice?: number;
    filledAt?: number;
  };
}

export interface NAVUpdate {
  timestamp: number;
  value: number;
  portfolioItems: {
    name: string;
    value: number;
    change: number;
  }[];
}

export interface Portfolio {
  name: string;
  value: number;
  current: number;
  change: number;
  description: string;
  tokenAmount: number;
  pricePerToken: number;
  address: string;
}

export class ArchClient {
  private programId: string;
  private treasuryAddress: string;
  private endpoint: string;

  constructor(config: {
    programId: string;
    treasuryAddress: string;
    endpoint: string;
  }) {
    this.programId = config.programId;
    this.treasuryAddress = config.treasuryAddress;
    this.endpoint = config.endpoint;
  }

  async verifyBitcoinPayment(txid: string, expectedAmount: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/verify_payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          txid,
          expected_amount: expectedAmount,
          treasury_address: this.treasuryAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to verify payment');
      }

      const result = await response.json();
      return result.verified;
    } catch (error) {
      console.error('Payment verification failed:', error);
      return false;
    }
  }

  async buyOVT(
    amount: number,
    paymentTxid: string,
    walletAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> {
    try {
      // Verify the payment first
      const isVerified = await this.verifyBitcoinPayment(paymentTxid, amount);
      if (!isVerified) {
        throw new Error('Payment verification failed');
      }

      // Execute the buyback instruction
      const response = await fetch(`${this.endpoint}/buy_ovt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program_id: this.programId,
          payment_txid: paymentTxid,
          amount,
          wallet_address: walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute OVT purchase');
      }

      const result = await response.json();
      return {
        success: true,
        txid: result.txid,
      };
    } catch (error) {
      console.error('OVT purchase failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async sellOVT(
    amount: number,
    walletAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> {
    try {
      const response = await fetch(`${this.endpoint}/sell_ovt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program_id: this.programId,
          amount,
          wallet_address: walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute OVT sale');
      }

      const result = await response.json();
      return {
        success: true,
        txid: result.txid,
      };
    } catch (error) {
      console.error('OVT sale failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getCurrentNAV(): Promise<NAVUpdate> {
    try {
      const response = await fetch(`${this.endpoint}/get_nav`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program_id: this.programId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch NAV: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch NAV:', error);
      throw error;
    }
  }

  async getTransactionHistory(walletAddress: string): Promise<ArchTransaction[]> {
    try {
      const response = await fetch(
        `${this.endpoint}/transactions?address=${walletAddress}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch transaction history');
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch transaction history:', error);
      throw error;
    }
  }

  async addPosition(position: any): Promise<any> {
    try {
      console.log(`Adding position to the validator: ${position.name}`);
      console.log('Position details:', position);
      
      const response = await fetch(`${this.endpoint}/add_position`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          program_id: this.programId,
          name: position.name,
          description: position.description,
          value: position.value,
          token_amount: position.tokenAmount,
          price_per_token: position.pricePerToken,
          transaction_id: `position_entry_${position.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to add position. Status: ${response.status}. Error: ${errorText}`);
      }

      const result = await response.json();
      console.log("Position added successfully. API Response:", JSON.stringify(result, null, 2));
      return {
        ...position,
        transactionId: result.txid || result.transaction_id || `tx-${Date.now()}`
      };
    } catch (error) {
      console.error(`Position creation failed for ${position.name}:`, error);
      throw error;
    }
  }

  async getMarketPrice(): Promise<number> {
    let retryCount = 0;
    const maxRetries = 2;
    const fallbackPrice = 700000; // 700k sats default
    
    while (retryCount <= maxRetries) {
      try {
        const response = await fetch(`${this.endpoint}/market_price`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          console.warn(`Market price fetch failed with status ${response.status} (attempt ${retryCount + 1}/${maxRetries + 1})`);
          retryCount++;
          
          if (retryCount > maxRetries) {
            throw new Error(`Failed to fetch market price after ${maxRetries + 1} attempts`);
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
          continue;
        }

        const data = await response.json();
        if (!data || typeof data.price !== 'number' || data.price <= 0) {
          console.warn(`Invalid market price received: ${JSON.stringify(data)} (attempt ${retryCount + 1}/${maxRetries + 1})`);
          retryCount++;
          
          if (retryCount > maxRetries) {
            console.log(`Using fallback price: ${fallbackPrice}`);
            return fallbackPrice;
          }
          
          await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
          continue;
        }
        
        return data.price;
      } catch (error) {
        console.error(`Failed to fetch market price (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
        retryCount++;
        
        if (retryCount > maxRetries) {
          console.log(`Using fallback price: ${fallbackPrice}`);
          return fallbackPrice; // Return fallback price instead of throwing
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      }
    }
    
    // This should never be reached due to the returns above, but TypeScript requires it
    return fallbackPrice;
  }

  async estimatePriceImpact(amount: number, isBuy: boolean): Promise<number> {
    try {
      const response = await fetch(`${this.endpoint}/estimate_impact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          side: isBuy ? 'buy' : 'sell'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to estimate price impact');
      }

      const data = await response.json();
      return data.estimatedPrice;
    } catch (error) {
      console.error('Failed to estimate price impact:', error);
      throw error;
    }
  }

  async getOrderBook(): Promise<{ bids: { price: number; amount: number }[]; asks: { price: number; amount: number }[] }> {
    try {
      const response = await fetch(`${this.endpoint}/order_book`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch order book');
      }

      const data = await response.json();
      return {
        bids: data.bids,
        asks: data.asks
      };
    } catch (error) {
      console.error('Failed to fetch order book:', error);
      throw error;
    }
  }

  async executeTrade(params: {
    type: 'buy' | 'sell';
    amount: number;
    executionPrice: number;
    maxPrice?: number;
    minPrice?: number;
  }): Promise<ArchTransaction> {
    try {
      const response = await fetch(`${this.endpoint}/execute_trade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...params,
          program_id: this.programId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to execute trade');
      }

      const data = await response.json();
      return {
        txid: data.txid,
        type: params.type.toUpperCase() as 'BUY' | 'SELL',
        amount: params.amount,
        confirmations: 0,
        timestamp: Date.now(),
        metadata: {
          price: params.executionPrice,
          status: 'pending',
          orderType: params.maxPrice || params.minPrice ? 'limit' : 'market',
          limitPrice: params.maxPrice || params.minPrice,
          filledAt: params.executionPrice
        }
      };
    } catch (error) {
      console.error('Failed to execute trade:', error);
      throw error;
    }
  }

  async getPositions(): Promise<Portfolio[]> {
    try {
      // First try to get positions from the API
      const response = await fetch(`${this.endpoint}/positions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch positions');
      }

      const positions = await response.json();
      return positions;
    } catch (error) {
      console.error('Error fetching positions:', error);
      // Return mock data in development
      if (process.env.NODE_ENV === 'development') {
        return [
          {
            name: 'Mock Position 1',
            value: 1000000, // 1M sats
            current: 1100000,
            change: 10,
            description: 'Mock position for development',
            tokenAmount: 100,
            pricePerToken: 10000,
            address: 'mock-address-1'
          },
          {
            name: 'Mock Position 2',
            value: 2000000,
            current: 2400000,
            change: 20,
            description: 'Another mock position',
            tokenAmount: 200,
            pricePerToken: 10000,
            address: 'mock-address-2'
          }
        ];
      }
      throw error;
    }
  }
} 
