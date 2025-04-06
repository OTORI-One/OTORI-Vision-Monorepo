/**
 * Centralized NAV calculation service
 * Provides a single source of truth for NAV calculations across the application
 */

import { getGlobalNAVReference, updateGlobalNAVReference, PortfolioPosition } from '../utils/priceMovement';
import { getGlobalOVTPrice, updateGlobalOVTPrice } from '../hooks/useOVTClient';
import { SATS_PER_BTC } from './formatting';

// Event names for NAV updates
export const NAV_UPDATE_EVENT = 'nav-update';
export const OVT_PRICE_UPDATE_EVENT = 'ovt-price-update';

// Default BTC price if not available
const DEFAULT_BTC_PRICE = 50000;

/**
 * Get the current Bitcoin price from the global window object
 */
export function getCurrentBitcoinPrice(): number {
  if (typeof window !== 'undefined' && window.btcPrice) {
    return window.btcPrice;
  }
  return DEFAULT_BTC_PRICE;
}

/**
 * Calculate the NAV in both sats and formatted USD
 */
export interface NAVResult {
  navSats: number;           // NAV in satoshis
  navUsd: number;            // NAV in USD
  pricePerToken: number;     // Price per token in sats
  pricePerTokenUsd: number;  // Price per token in USD
  totalTokenSupply: number;  // Total OVT token supply
  changePercentage: number;  // 24h change percentage
}

/**
 * Calculate the NAV based on the portfolio positions
 * This is the single source of truth for NAV calculations
 */
export function calculateNAV(
  positions: PortfolioPosition[],
  totalTokenSupply: number = 2100000
): NAVResult {
  try {
    // Get the baseline NAV from the global reference
    let navSats = getGlobalNAVReference();
    
    // Calculate the Bitcoin price
    const btcPrice = getCurrentBitcoinPrice();
    
    // Check if we have portfolio data to calculate a real NAV
    if (Array.isArray(positions) && positions.length > 0) {
      console.log(`Portfolio items for NAV calculation: ${positions.length}`);
      
      // Sum the current values of all positions
      let totalCurrentValue = 0;
      for (const position of positions) {
        if (position && typeof position.current === 'number' && !isNaN(position.current)) {
          totalCurrentValue += position.current;
        }
      }
      
      console.log(`Calculated total current value: ${totalCurrentValue}`);
      
      // Only update the NAV if we have valid positions
      if (totalCurrentValue > 0 && isFinite(totalCurrentValue)) {
        navSats = totalCurrentValue;
      } else {
        console.log(`Using fallback NAV value: ${navSats}`);
      }
    } else {
      console.log(`Portfolio items for NAV calculation: 0`);
      
      // If no valid positions, stick with the global reference NAV
      console.log(`NAV fallback value: ${navSats}`);
      
      if (!isFinite(navSats)) {
        // Set a reasonable default if the global value is invalid
        navSats = 1000000000; // 10 BTC in sats as default
        console.log(`Using hardcoded fallback NAV: ${navSats}`);
      }
    }
    
    // Ensure NAV is finite and within reasonable bounds
    if (!isFinite(navSats) || navSats <= 0) {
      navSats = 1000000000; // 10 BTC in sats as default
      console.log(`Using hardcoded fallback NAV: ${navSats}`);
    }
    
    // Calculate NAV in USD - protect against bad BTC price
    const effectiveBtcPrice = isFinite(btcPrice) && btcPrice > 0 ? btcPrice : DEFAULT_BTC_PRICE;
    const navUsd = (navSats / SATS_PER_BTC) * effectiveBtcPrice;
    
    // Calculate price per token in sats - protect against division by zero
    const effectiveSupply = totalTokenSupply > 0 ? totalTokenSupply : 2100000;
    const pricePerToken = Math.floor(navSats / effectiveSupply);
    
    // Calculate price per token in USD
    const pricePerTokenUsd = navUsd / effectiveSupply;
    
    // Calculate change percentage (day over day)
    // For now use a placeholder or calculated value
    let changePercentage = calculateChangePercentage(positions);
    
    // Ensure valid change percentage
    if (!isFinite(changePercentage)) {
      changePercentage = 0;
    }
    
    // Update the global OVT price, but only if it's valid
    if (isFinite(pricePerToken) && pricePerToken > 0) {
      updateGlobalOVTPrice(pricePerToken);
    }
    
    console.log(`OVT price calculated: ${pricePerToken} sats, NAV: ${navSats} sats`);
    
    return {
      navSats,
      navUsd,
      pricePerToken,
      pricePerTokenUsd,
      totalTokenSupply: effectiveSupply,
      changePercentage
    };
  } catch (error) {
    console.error(`Error calculating NAV:`, error);
    // Return safe default values
    return {
      navSats: 1000000000,
      navUsd: 50000,
      pricePerToken: 476,
      pricePerTokenUsd: 23.81,
      totalTokenSupply: 2100000,
      changePercentage: 0
    };
  }
}

/**
 * Calculate the change percentage based on portfolio positions
 */
function calculateChangePercentage(positions: PortfolioPosition[]): number {
  if (!positions || !Array.isArray(positions) || positions.length === 0) {
    return 0;
  }
  
  try {
    // Calculate the weighted average of position changes
    let totalValue = 0;
    let totalChangeValue = 0;
    
    positions.forEach(position => {
      if (position && typeof position.current === 'number' && 
          isFinite(position.current) && position.current > 0 &&
          typeof position.change === 'number' && isFinite(position.change)) {
        
        totalValue += position.current;
        // Convert percentage change to value change
        const changeValue = position.current * (position.change / 100);
        totalChangeValue += changeValue;
      }
    });
    
    if (totalValue === 0) {
      return 0;
    }
    
    // Calculate overall percentage change
    const result = (totalChangeValue / totalValue) * 100;
    
    // Sanity check - cap extreme values
    if (!isFinite(result)) return 0;
    return Math.max(-50, Math.min(50, result));
  } catch (error) {
    console.error('Error calculating change percentage:', error);
    return 0;
  }
}

/**
 * Update the NAV based on new data and notify listeners
 */
export function updateNAV(
  positions: PortfolioPosition[],
  totalTokenSupply: number = 2100000
): NAVResult {
  // Calculate the new NAV
  const navResult = calculateNAV(positions, totalTokenSupply);
  
  // Update the global reference
  updateGlobalNAVReference(navResult.changePercentage / 100);
  
  // Notify listeners if in browser environment
  if (typeof window !== 'undefined') {
    // Dispatch NAV update event
    window.dispatchEvent(new CustomEvent(NAV_UPDATE_EVENT, {
      detail: navResult
    }));
    
    // Dispatch OVT price update event
    window.dispatchEvent(new CustomEvent(OVT_PRICE_UPDATE_EVENT, {
      detail: {
        price: navResult.pricePerToken,
        priceUsd: navResult.pricePerTokenUsd
      }
    }));
  }
  
  return navResult;
}

// Store event listeners in a Map to allow for removal
const navListeners = new Map<(nav: NAVResult) => void, EventListener>();

/**
 * Add a listener for NAV updates
 * @param listener Function to call when NAV is updated
 */
export function addNAVUpdateListener(listener: (nav: NAVResult) => void): void {
  if (typeof window === 'undefined') {
    return; // No-op for SSR
  }
  
  // Create an event listener that calls our callback
  const eventListener = ((event: Event) => {
    const customEvent = event as CustomEvent<NAVResult>;
    listener(customEvent.detail);
  }) as EventListener;
  
  // Store the mapping between our callback and the event listener
  navListeners.set(listener, eventListener);
  
  // Add the event listener
  window.addEventListener(NAV_UPDATE_EVENT, eventListener);
}

/**
 * Remove a NAV update listener to prevent memory leaks
 * @param listener The listener function to remove
 */
export function removeNAVUpdateListener(listener: (nav: NAVResult) => void): void {
  if (typeof window === 'undefined') {
    return; // No-op for SSR
  }
  
  // Get the corresponding event listener
  const eventListener = navListeners.get(listener);
  
  if (eventListener) {
    // Remove the event listener
    window.removeEventListener(NAV_UPDATE_EVENT, eventListener);
    
    // Remove from our map
    navListeners.delete(listener);
  }
}

/**
 * Get the current NAV data
 */
export function getCurrentNAV(
  positions: PortfolioPosition[] = [],
  totalTokenSupply: number = 2100000
): NAVResult {
  // Use the provided positions or calculate without them
  return calculateNAV(positions, totalTokenSupply);
}

/**
 * Simulate NAV appreciation based on a percentage
 */
export function simulateNAVChange(
  changePercentage: number,
  totalTokenSupply: number = 2100000
): NAVResult {
  // Update the global reference
  updateGlobalNAVReference(changePercentage / 100);
  
  // Return the updated NAV
  return calculateNAV([], totalTokenSupply);
} 