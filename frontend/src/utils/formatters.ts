/**
 * Comprehensive Formatting Utilities
 *
 * Provides centralized functions for formatting various data types 
 * consistently across the OTORI Vision application.
 */

// Constants
const SATS_PER_BTC = 100000000;

/**
 * Format a generic number with specified decimals and optional grouping.
 * 
 * @param value - The number to format.
 * @param decimals - Number of decimal places.
 * @param useGrouping - Whether to use thousands separators.
 * @returns Formatted number string or '-' if invalid.
 */
export function formatNumber(
  value: number | null | undefined,
  decimals = 2,
  useGrouping = true
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  
  try {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: useGrouping,
    });
  } catch (error) {
    console.error("Error formatting number:", error, { value, decimals, useGrouping });
    return '-';
  }
}

/**
 * Format a value as USD currency.
 * 
 * @param value - The value in USD.
 * @param decimals - Number of decimal places (smart default based on value).
 * @returns Formatted currency string (e.g., $1.23M, $45.6k, $7.89, $0.12).
 */
export function formatUsd(
  value: number | null | undefined,
  decimals?: number // Allow override, but defaults are smart
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '$0.00';
  }
  
  try {
    if (value >= 1000000) {
      return `$${formatNumber(value / 1000000, decimals ?? 2)}M`;
    }
    if (value >= 1000) {
      return `$${formatNumber(value / 1000, decimals ?? 1)}k`;
    }
    if (value >= 0.01 || value === 0) {
       return `$${formatNumber(value, decimals ?? 2)}`;
    }
     // For very small positive values
     return `$${formatNumber(value, decimals ?? 4)}`; 
  } catch (error) {
    console.error("Error formatting USD:", error, { value, decimals });
    return '$0.00';
  }
}

/**
 * Format a Bitcoin value (in BTC units).
 * 
 * @param value - The value in BTC.
 * @param decimals - Number of decimal places (default: 8).
 * @param showSymbol - Whether to prepend the ₿ symbol.
 * @returns Formatted BTC string.
 */
export function formatBtc(
  value: number | null | undefined,
  decimals = 8,
  showSymbol = true
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return showSymbol ? '₿0.00' : '0.00';
  }
  
  const formatted = formatNumber(value, decimals);
  return showSymbol ? `₿${formatted}` : formatted;
}

/**
 * Format a value in Satoshis. Uses k/M notation for large numbers.
 * 
 * @param value - The value in Satoshis.
 * @returns Formatted satoshi string (e.g., 1.23M sats, 45k sats, 789 sats).
 */
export function formatSats(value: number | null | undefined): string {
   if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0 sats';
  }
  
  try {
     if (value >= 1000000) {
      return `${formatNumber(value / 1000000, 2)}M sats`;
    }
    if (value >= 1000) {
      return `${formatNumber(value / 1000, 1)}k sats`;
    }
    return `${formatNumber(value, 0)} sats`;
  } catch (error) {
     console.error("Error formatting sats:", error, { value });
     return '0 sats';
  }
}

/**
 * Format a percentage value. Includes a '+' sign for positive values.
 * 
 * @param value - The percentage value (e.g., 5.25 for 5.25%).
 * @param decimals - Number of decimal places.
 * @returns Formatted percentage string (e.g., +5.25%, -1.20%).
 */
export function formatPercent(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0.00%';
  }
  
  const formatted = formatNumber(Math.abs(value), decimals);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatted}%`;
}

/**
 * Format a value in sats to either BTC or USD display format.
 * Follows the OTORI Vision frontend guidelines for displaying values.
 * 
 * @param sats The value in satoshis.
 * @param displayMode Whether to show as 'btc' or 'usd'.
 * @param btcPriceUsd Current Bitcoin price in USD (required for USD display).
 * @returns Formatted string with appropriate units (e.g., ₿0.1234, $12.3k, 500 sats).
 */
export function formatSatsToCurrency(
  sats: number | null | undefined,
  displayMode: 'btc' | 'usd',
  btcPriceUsd: number | null | undefined
): string {
  if (sats === null || sats === undefined || !Number.isFinite(sats)) {
    return displayMode === 'usd' ? '$0.00' : '0 sats';
  }

  // Use a safe BTC price for USD conversion if needed
  const safeBtcPrice = (btcPriceUsd && Number.isFinite(btcPriceUsd)) ? btcPriceUsd : 50000; // Default fallback

  try {
    if (displayMode === 'usd') {
      const usdValue = (sats / SATS_PER_BTC) * safeBtcPrice;
      // Use the existing formatUsd function for consistency
      return formatUsd(usdValue); 
    } else { // displayMode === 'btc'
      // Format as BTC or Sats based on magnitude
      if (sats >= SATS_PER_BTC / 10) { // Threshold for showing as BTC (e.g., 0.1 BTC)
        const btcValue = sats / SATS_PER_BTC;
        // Use existing formatBtc function
        return formatBtc(btcValue, 4, true); // Show 4 decimals for BTC display
      } else {
        // Use existing formatSats function for smaller amounts
        return formatSats(sats);
      }
    }
  } catch (error) {
    console.error("Error in formatSatsToCurrency:", error, { sats, displayMode, btcPriceUsd });
    return displayMode === 'usd' ? '$0.00' : '0 sats';
  }
}

/**
 * Formats a date object or timestamp into a readable string.
 * 
 * @param date - The date object, timestamp number, or date string.
 * @param includeTime - Whether to include the time component.
 * @returns Formatted date string or '-' if invalid.
 */
export function formatDate(
  date: Date | number | string | null | undefined,
  includeTime = false
): string {
  if (!date) return '-';

  try {
    const dateObj = typeof date === 'object' ? date : new Date(date);
    
    // Check if date is valid after conversion
    if (isNaN(dateObj.getTime())) {
        console.warn("Invalid date provided to formatDate:", date);
        return '-';
    }

    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };

    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
      // options.timeZoneName = 'short'; // Optional: Add timezone
    }

    return dateObj.toLocaleString('en-US', options);
  } catch (error) {
    console.error("Error formatting date:", error, { date, includeTime });
    return '-';
  }
} 