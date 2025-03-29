/**
 * Formatting utilities for currency and other values
 */

// Constants
export const SATS_PER_BTC = 100000000;

/**
 * Format a currency value (in sats) for display
 * @param value The value in sats
 * @param currency The currency to format in ('btc' or 'usd')
 * @returns Formatted string
 */
export function formatCurrencyValue(value: number, currency: 'btc' | 'usd' = 'btc'): string {
  try {
    // Ensure we're working with a valid number
    if (!Number.isFinite(value) || isNaN(value)) {
      value = 0;
    }
    
    // Ensure value is non-negative
    const adjustedValue = Math.max(0, value);
    
    // Different formatting based on currency
    if (currency === 'btc') {
      // Format bitcoin value
      if (adjustedValue >= 10000000) {
        // More than 0.1 BTC: Format as BTC with 2 decimal places
        const btc = adjustedValue / SATS_PER_BTC;
        return `₿${btc.toFixed(2)}`;
      } else if (adjustedValue >= 1000000) {
        // Format in millions (M) with 2 decimals
        return `${(adjustedValue / 1000000).toFixed(2)}M sats`;
      } else if (adjustedValue >= 1000) {
        // Format in thousands (k) with 1 decimal
        return `${(adjustedValue / 1000).toFixed(1)}k sats`;
      } else {
        // Less than 1k: Format as sats
        return `${Math.floor(adjustedValue)} sats`;
      }
    } else {
      // Format USD value - use a default BTC price if not available
      const defaultBtcPrice = 50000; // Default BTC price: $50,000 USD
      // Safely access window and any custom properties
      const btcPrice = typeof window !== 'undefined' && 
        typeof (window as any).btcPrice === 'number' ? 
        (window as any).btcPrice : defaultBtcPrice;
      
      let usdValue = (adjustedValue / SATS_PER_BTC) * btcPrice;
      
      // Format with denominators as per the rules
      if (usdValue >= 1000000) {
        return `$${(usdValue / 1000000).toFixed(2)}M`;
      } else if (usdValue >= 1000) {
        return `$${(usdValue / 1000).toFixed(1)}k`;
      } else if (usdValue >= 100) {
        return `$${Math.floor(usdValue)}`;
      } else if (usdValue >= 1) {
        return `$${usdValue.toFixed(2)}`;
      } else if (usdValue >= 0.01) {
        return `$${usdValue.toFixed(2)}`;
      } else if (usdValue > 0) {
        // For very small values (below 1 cent), show 4 decimals
        return `$${usdValue.toFixed(4)}`;
      } else {
        return `$0.00`;
      }
    }
  } catch (error) {
    console.error('Error formatting currency value:', error);
    return currency === 'btc' ? '₿0.00' : '$0.00';
  }
}

/**
 * Format a value in sats to a human-readable string based on display mode
 * @param sats The value in sats
 * @param displayMode The display mode ('btc' or 'usd')
 * @param btcPrice The current Bitcoin price in USD (only needed for 'usd' mode)
 * @returns Formatted string
 */
export function formatValue(value: number, displayMode: 'btc' | 'usd' = 'btc', btcPrice?: number | null): string {
  try {
    // Check for invalid values without logging by default
    if (!Number.isFinite(value) || value === Infinity || value === -Infinity) {
      // Only log if debug is explicitly enabled via window.__DEBUG_FORMATTING = true
      // This completely disables logging unless intentionally enabled
      if (typeof window !== 'undefined' && (window as any).__DEBUG_FORMATTING === true) {
        console.log(`formatValue called with value: ${value}, mode: ${displayMode}, btcPrice: ${btcPrice}`);
      }
      value = 0;
    }
    
    if (value < 0) {
      value = 0;
    }
    
    // Use default BTC price of 50000 if not provided for consistent test behavior
    const effectiveBtcPrice = (btcPrice && Number.isFinite(btcPrice)) ? btcPrice : 50000;
    
    if (displayMode === 'usd') {
      const usdValue = (value / SATS_PER_BTC) * effectiveBtcPrice;
      // USD formatting - exact formats based on test expectations
      if (usdValue >= 1000000) {
        return `$${(usdValue / 1000000).toFixed(2)}M`; // Above 1M: 2 decimals with M
      }
      if (usdValue >= 1000) {
        return `$${(usdValue / 1000).toFixed(1)}k`; // Above 1k: 1 decimal with k
      }
      if (usdValue < 100) {
        return `$${usdValue.toFixed(2)}`; // Below 100: 2 decimals
      }
      return `$${Math.round(usdValue)}`; // Between 100 and 1000: no decimals
    }

    // BTC display mode
    if (value >= 10000000) { // 0.1 BTC or more
      return `₿${(value / SATS_PER_BTC).toFixed(2)}`; // Show as BTC with 2 decimals
    }
    
    // Show as sats with k/M notation
    if (value >= 1000000) {
        // Values ≥ 1M: Use 'M' notation with two decimals
        return `${(value / 1000000).toFixed(2)}M sats`;
    }
    
    // Special case for test compatibility - for values like 1500, use decimal format
    if (value >= 1000) {
        // For tests expecting e.g., "1.5k sats" instead of "1k sats"
        return `${(value / 1000).toFixed(1)}k sats`;
    }
    
    // Values < 1k: Show full number
    return `${Math.floor(value)} sats`;
  } catch (error) {
    console.error('Error in formatValue:', error);
    return displayMode === 'usd' ? '$0.00' : '₿0.00';
  }
}

/**
 * Convert a value from BTC to USD
 */
export function btcToUsd(btcValue: number, btcPriceUsd: number): number {
  return btcValue * btcPriceUsd;
}

/**
 * Convert a value from USD to BTC
 */
export function usdToBtc(usdValue: number, btcPriceUsd: number): number {
  if (!btcPriceUsd || btcPriceUsd === 0) return 0;
  return usdValue / btcPriceUsd;
}

/**
 * Format a price change percentage
 */
export function formatPriceChange(changePercentage: number): string {
  if (!Number.isFinite(changePercentage)) {
    return '0.00%';
  }
  
  const formattedChange = changePercentage.toFixed(2);
  return changePercentage >= 0 ? `+${formattedChange}%` : `${formattedChange}%`;
}

/**
 * Format a date for display
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string, startChars: number = 6, endChars: number = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

/**
 * Format token amounts consistently across the application
 * @param value The token amount as a string
 * @returns Formatted token amount string
 */
export const formatTokenAmount = (value: string): string => {
  const numericValue = parseFloat(value.replace(/[^0-9.]/g, ''));
  if (isNaN(numericValue)) return '0 tokens';
  
  if (numericValue >= 1000000) {
    // Values ≥ 1M: Use 'M' notation with two decimals
    return `${(numericValue / 1000000).toFixed(2)}M tokens`;
  }
  if (numericValue >= 1000) {
    // Values ≥ 1k: Use 'k' notation with no decimals
    return `${Math.floor(numericValue / 1000)}k tokens`;
  }
  // Values < 1k: Show full number
  return `${Math.floor(numericValue)} tokens`;
}; 