/**
 * Unified formatting utilities for currency, numbers and percentages
 * Consolidated from previous separate formatting files
 */

// Constants for numeric handling
export const SATS_PER_BTC = 100000000;

/**
 * Format a number to a specified number of decimal places with optional thousands separator
 * @param value The number to format
 * @param decimals Number of decimal places (default: 2)
 * @param useThousandsSeparator Whether to use thousands separator (default: true)
 * @returns Formatted number string
 */
export function formatNumber(
  value: number, 
  decimals = 2, 
  useThousandsSeparator = true
): string {
  // First check for invalid values to prevent downstream errors
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: useThousandsSeparator
  };
  
  return new Intl.NumberFormat('en-US', options).format(value);
}

/**
 * Format a value as currency with $ symbol and optional decimals
 * @param value The value to format as currency
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted currency string
 */
export function formatCurrency(
  value: number, 
  decimals = 2
): string {
  // First check for invalid values to prevent downstream errors
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '$0.00';
  }
  
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  };
  
  return new Intl.NumberFormat('en-US', options).format(value);
}

/**
 * Format a number as a percentage with % symbol
 * @param value The value to format as percentage
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted percentage string
 */
export function formatPercentage(
  value: number, 
  decimals = 2
): string {
  // First check for invalid values to prevent downstream errors
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0.00%';
  }
  
  // Determine if we need a plus sign for positive values
  const formatted = formatNumber(value, decimals);
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatted}%`;
}

/**
 * Format a number as BTC with BTC symbol and satoshi precision
 * @param value The value to format as BTC
 * @param showSymbol Whether to include the BTC symbol (default: true)
 * @returns Formatted BTC string
 */
export function formatBitcoin(
  value: number, 
  showSymbol = true
): string {
  // First check for invalid values to prevent downstream errors
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return showSymbol ? '₿0.00' : '0.00';
  }
  
  const formatted = formatNumber(value, 8, true);
  return showSymbol ? `₿${formatted}` : formatted;
}

/**
 * Format a value in sats to either BTC or USD display format
 * Follows the frontend guidelines for displaying Bitcoin and USD values
 * 
 * @param sats The value in satoshis
 * @param displayMode Whether to show as 'btc' or 'usd'
 * @param btcPrice Current Bitcoin price in USD (required for USD display)
 * @returns Formatted string with appropriate units
 */
export function formatValue(
  sats: number, 
  displayMode: 'btc' | 'usd' = 'btc', 
  btcPrice: number | null = null
): string {
  // First validate inputs to prevent downstream issues
  if (sats === null || sats === undefined || !Number.isFinite(sats)) {
    // Log error for debugging if it's trying to use Infinity
    if (sats === Infinity || sats === -Infinity) {
      console.error('formatValue received non-finite value:', sats, new Error().stack);
    }
    return displayMode === 'usd' ? '$0.00' : '0 sats';
  }
  
  // Ensure value is non-negative
  const value = Math.max(0, sats);
  
  // Ensure btcPrice is valid for USD mode
  const effectiveBtcPrice = 
    (displayMode === 'usd' && btcPrice && Number.isFinite(btcPrice)) 
      ? btcPrice 
      : 50000; // Safe default
  
  try {
    if (displayMode === 'usd') {
      // Safely calculate USD value with validation
      const usdValue = (value / SATS_PER_BTC) * effectiveBtcPrice;
      
      // Validate calculation result
      if (!Number.isFinite(usdValue)) {
        console.warn('Invalid USD calculation result', {value, btcPrice, result: usdValue});
        return '$0.00';
      }
      
      // USD formatting rules
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
    } else {
      // BTC display mode
      if (value >= 10000000) { // 0.1 BTC or more
        const btcValue = value / SATS_PER_BTC;
        return `₿${btcValue.toFixed(2)}`; // Show as BTC with 2 decimals
      }
      
      // Show as sats with k/M notation
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(2)}M sats`; // Millions
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}k sats`; // Thousands
      }
      
      // Small values
      return `${Math.floor(value)} sats`;
    }
  } catch (error) {
    console.error('Error in formatValue:', error);
    return displayMode === 'usd' ? '$0.00' : '0 sats';
  }
}

/**
 * Format a currency value (in sats) for display
 * Legacy function maintained for backwards compatibility
 * New code should use formatValue instead
 * 
 * @param value The value in sats
 * @param currency The currency to format in ('btc' or 'usd')
 * @returns Formatted string
 */
export function formatCurrencyValue(
  value: number, 
  currency: 'btc' | 'usd' = 'btc'
): string {
  return formatValue(value, currency);
}

/**
 * Format a date to a readable string
 * @param date The date to format
 * @param includeTime Whether to include time (default: false)
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | number | string,
  includeTime = false
): string {
  if (!date) return '-';
  
  try {
    const dateObj = typeof date === 'object' ? date : new Date(date);
    
    if (includeTime) {
      return dateObj.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return '-';
  }
}

/**
 * Convert a value from BTC to USD
 */
export function btcToUsd(btcValue: number, btcPriceUsd: number): number {
  if (!Number.isFinite(btcValue) || !Number.isFinite(btcPriceUsd)) {
    return 0;
  }
  return btcValue * btcPriceUsd;
}

/**
 * Convert a value from USD to BTC
 */
export function usdToBtc(usdValue: number, btcPriceUsd: number): number {
  if (!Number.isFinite(usdValue) || !Number.isFinite(btcPriceUsd) || btcPriceUsd === 0) {
    return 0;
  }
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
 * Truncate address for display
 */
export function truncateAddress(address: string, startChars: number = 6, endChars: number = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

/**
 * Format token amounts consistently across the application
 * @param value The token amount as a string or number
 * @returns Formatted token amount string
 */
export function formatTokenAmount(value: string | number): string {
  // Handle both string and number inputs
  const numericValue = typeof value === 'string' 
    ? parseFloat(value.replace(/[^0-9.]/g, '')) 
    : value;
  
  if (isNaN(numericValue) || !Number.isFinite(numericValue)) return '0 tokens';
  
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
} 