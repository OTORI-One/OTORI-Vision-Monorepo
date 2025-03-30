/**
 * Price Service for OTORI Vision
 * 
 * This service manages centralized price data for OVT and portfolio positions.
 * It implements the advanced price movement algorithm that was previously in the frontend,
 * ensuring consistent pricing data across all clients and accurate 24-hour change calculations.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Constants
const PRICE_DATA_FILE = path.join(__dirname, '../../data/price-data.json');
const BTC_PRICE_FILE = path.join(__dirname, '../../data/btc-price.json');
const SATS_PER_BTC = 100000000;
const UPDATE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds 
const DEFAULT_BTC_PRICE = 60000;
const DEFAULT_OVT_CIRCULATING_SUPPLY = 1000000; // 1M tokens for testnet
const OVT_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || 'tb1pglzcv7mg4xdy8nd2cdulsqgxc5yf35fxu5yvz27cf5gl6wcs4ktspjmytd';
const OVT_TREASURY_ADDRESS_2 = process.env.NEXT_PUBLIC_TREASURY_ADDRESS_2 || 'tb1plpfgtre7sxxrrwjdpy4357qj2nr7ek06xqpdryxr4lzt5tck6x3qz07zd3';
const OVT_RUNE_ID = process.env.NEXT_PUBLIC_OVT_RUNE_ID || '240249:101';
const SECONDS_IN_DAY = 86400000;

// Advanced price movement algorithm variables
// Bitcoin market sentiment as a shared state factor
let globalBTCMarketSentiment = 0;

// Global market sector trends (affects correlation between similar assets)
const globalSectorTrends = {
  defi: 0,
  privacy: 0,
  scaling: 0,
  infrastructure: 0,
  gaming: 0,
  dao: 0,
  exchange: 0,
  derivative: 0,
};

// Data structure to store current price state
let priceState = {
  positions: {},
  ovtPrice: 0,
  btcPrice: DEFAULT_BTC_PRICE,
  lastUpdate: 0,
  ovtCirculatingSupply: DEFAULT_OVT_CIRCULATING_SUPPLY,
  priceHistory: {
    daily: {}, // Daily closing prices by position name
    hourly: {} // Hourly data points for more granular analysis
  }
};

// Track request frequency with rate limiting
const requestTracker = {
  // Store last request timestamps by IP
  lastRequests: {},
  // Store request counts by IP for the current minute
  requestCounts: {},
  // Rate limit settings
  rateLimit: {
    standard: 2000, // Increase from 1000 to 2000 requests per minute for development
    high: 1000,      // Increase from 500 to 1000 requests per minute for high-load endpoints
    backoff: {}    // Store last error timestamp by IP for exponential backoff
  },
  // Track an API request
  trackRequest: function(ip, endpoint) {
    const now = Date.now();
    // For development, always allow requests without tracking
    if (process.env.NODE_ENV === 'development') {
      return now;
    }
    
    const minute = Math.floor(now / 60000);
    
    // Initialize tracking for this IP if needed
    if (!this.lastRequests[ip]) {
      this.lastRequests[ip] = {};
      this.requestCounts[ip] = {};
      this.rateLimit.backoff[ip] = {};
    }
    
    // Track this request
    this.lastRequests[ip][endpoint] = now;
    
    // Track request count for this minute
    const key = `${minute}:${endpoint}`;
    this.requestCounts[ip][key] = (this.requestCounts[ip][key] || 0) + 1;
    
    return now;
  },
  // Check if a request is allowed based on rate limits
  isAllowed: function(ip, endpoint) {
    // For development, always allow requests
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    
    // If no previous requests from this IP, always allow
    if (!this.lastRequests[ip]) {
      return true;
    }
    
    // If this IP had errors recently, apply exponential backoff
    const lastErrorTime = this.rateLimit.backoff[ip][endpoint] || 0;
    const errorCount = this.rateLimit.backoff[ip][`${endpoint}:count`] || 0;
    
    if (lastErrorTime > 0 && errorCount > 0) {
      // Calculate backoff time: 1.25^errorCount seconds (more lenient, max 30s)
      const backoffTime = Math.min(Math.pow(1.25, errorCount) * 1000, 30000);
      const timeElapsed = now - lastErrorTime;
      
      if (timeElapsed < backoffTime) {
        return false; // Still in backoff period
      }
    }
    
    // Check request count for this minute
    const key = `${minute}:${endpoint}`;
    const count = this.requestCounts[ip][key] || 0;
    
    // Different rate limits for different endpoint types
    let limit = this.rateLimit.standard;
    if (endpoint === 'nav' || endpoint === 'ovt') {
      limit = this.rateLimit.high;
    }
    
    // Never block first 50 requests completely (up from 30)
    if (count <= 50) {
      return true;
    }
    
    return count < limit;
  },
  // Track an error for exponential backoff
  trackError: function(ip, endpoint) {
    if (!this.rateLimit.backoff[ip]) {
      this.rateLimit.backoff[ip] = {};
    }
    
    this.rateLimit.backoff[ip][endpoint] = Date.now();
    this.rateLimit.backoff[ip][`${endpoint}:count`] = 
      (this.rateLimit.backoff[ip][`${endpoint}:count`] || 0) + 1;
    
    // Reset error count after 5 minutes (down from 10)
    setTimeout(() => {
      if (this.rateLimit.backoff[ip]) {
        this.rateLimit.backoff[ip][`${endpoint}:count`] = 0;
      }
    }, 300000);
  },
  // Reset tracking for cleanup
  resetTracking: function() {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    
    // Clear old request counts (older than 5 minutes)
    Object.keys(this.requestCounts).forEach(ip => {
      Object.keys(this.requestCounts[ip]).forEach(key => {
        const [minute] = key.split(':');
        if (currentMinute - parseInt(minute) > 5) {
          delete this.requestCounts[ip][key];
        }
      });
      
      // Clean up empty IPs
      if (Object.keys(this.requestCounts[ip]).length === 0) {
        delete this.requestCounts[ip];
        delete this.lastRequests[ip];
        delete this.rateLimit.backoff[ip];
      }
    });
  }
};

// Run cleanup every 5 minutes
setInterval(() => {
  requestTracker.resetTracking();
}, 300000);

// Helper functions for the advanced algorithm

/**
 * Gets the day number since Unix epoch
 */
function getDayNumber(date = new Date()) {
  return Math.floor(date.getTime() / SECONDS_IN_DAY);
}

/**
 * Updates the global market sentiment
 * This simulates the overall crypto market direction, primarily driven by Bitcoin
 */
function updateGlobalMarketSentiment() {
  // Market sentiment changes gradually (momentum)
  // Range from -1.0 (very bearish) to 1.0 (very bullish)
  const currentSentiment = globalBTCMarketSentiment;
  
  // 70% of the previous sentiment (momentum) + 30% new influence
  const randomFactor = (Math.random() * 2 - 1) * 0.3; // -0.3 to +0.3
  globalBTCMarketSentiment = Math.max(-1, Math.min(1, currentSentiment * 0.7 + randomFactor));

  // Also update sector trends
  Object.keys(globalSectorTrends).forEach(sector => {
    // Sector trends are influenced by BTC sentiment (60%) and their own momentum (40%)
    const currentTrend = globalSectorTrends[sector];
    const sectorRandomFactor = (Math.random() * 2 - 1) * 0.25; // -0.25 to +0.25
    const btcInfluence = globalBTCMarketSentiment * 0.6;
    
    globalSectorTrends[sector] = Math.max(-1, Math.min(1, 
      currentTrend * 0.4 + sectorRandomFactor + btcInfluence
    ));
  });
}

/**
 * Assign a sector to a position if not already present
 * Used for correlation calculations
 */
function assignSector(position) {
  if (!position) return 'infrastructure'; // Default if position is undefined
  if (position.sector) return position.sector;
  
  // Check if name exists before accessing toLowerCase()
  if (!position.name) return 'infrastructure'; // Default if name is undefined
  
  // Assign a sector based on name (very simple approach)
  const name = position.name.toLowerCase();
  
  if (name.includes('defi') || name.includes('finance') || name.includes('lending')) {
    return 'defi';
  } else if (name.includes('privacy') || name.includes('encrypt') || name.includes('secure')) {
    return 'privacy';
  } else if (name.includes('scale') || name.includes('layer') || name.includes('tps')) {
    return 'scaling';
  } else if (name.includes('infra') || name.includes('protocol') || name.includes('base')) {
    return 'infrastructure';
  } else if (name.includes('game') || name.includes('play') || name.includes('meta')) {
    return 'gaming';
  } else if (name.includes('dao') || name.includes('governance')) {
    return 'dao';
  } else if (name.includes('exchange') || name.includes('dex') || name.includes('trade')) {
    return 'exchange';
  } else if (name.includes('derivat') || name.includes('options') || name.includes('future')) {
    return 'derivative';
  }
  
  // Default to infrastructure if no match
  return 'infrastructure';
}

/**
 * Generates a daily price change percentage between -3% and +5%
 * with realistic correlation to the market and sector
 */
function generateDailyPriceChange(position, positiveBias = true) {
  // Check if position is defined
  if (!position) {
    console.warn('generateDailyPriceChange called with undefined position');
    return 0; // Return safe default
  }

  // Update global market sentiment first (once per batch)
  if (Math.random() < 0.1) { // 10% chance to update global markets per position
    updateGlobalMarketSentiment();
  }
  
  // Base volatility (standard deviation)
  let volatility = 0.02; // Base volatility
  
  // Market cap-based volatility - smaller caps have higher volatility
  if (position.marketCap) {
    if (position.marketCap < 10000000) { // < $10M
      volatility = 0.04; // 4% base volatility
    } else if (position.marketCap < 100000000) { // < $100M
      volatility = 0.03; // 3% base volatility
    }
  }
  
  // Assign a sector if not already present
  const sector = assignSector(position);
  
  // Generate normal-like distribution with volatility
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  
  // Base random change
  let change = z0 * volatility;
  
  // Apply market correlation (BTC effect)
  const btcCorrelation = 0.6; // 60% correlation with overall crypto market
  const marketEffect = globalBTCMarketSentiment * volatility * btcCorrelation;
  
  // Apply sector correlation
  const sectorCorrelation = 0.3; // 30% correlation with sector
  const sectorEffect = globalSectorTrends[sector] * volatility * sectorCorrelation;
  
  // Combine effects
  change = change + marketEffect + sectorEffect;
  
  // Add conditional positive bias if requested
  if (positiveBias) {
    // 65% chance of positive bias, 35% chance of negative bias (even with overall positive trend)
    const biasDirection = Math.random() < 0.65 ? 1 : -1;
    const biasAmount = 0.01 * biasDirection;
    change += biasAmount;
  }
  
  // Restrict the range for test expectations
  return Math.max(-0.03, Math.min(0.05, change));
}

/**
 * Generates a more extreme "super spike" between +/- 25% and +/- 50%
 */
function generateSuperSpike(position) {
  // Check if position is defined
  if (!position) {
    console.warn('generateSuperSpike called with undefined position');
    return 0.25; // Return safe default positive value
  }
  
  // Determine magnitude range based on market cap
  let minMagnitude = 0.25; // Default 25% minimum
  let maxMagnitude = 0.50; // Default 50% maximum
  
  // Smaller cap tokens have more extreme spikes
  if (position.marketCap) {
    if (position.marketCap < 10000000) { // < $10M
      minMagnitude = 0.35; // 35-60% range for micro caps
      maxMagnitude = 0.60;
    } else if (position.marketCap < 100000000) { // < $100M
      minMagnitude = 0.30; // 30-55% range for small caps
      maxMagnitude = 0.55;
    }
  }
  
  // Calculate magnitude
  const magnitude = minMagnitude + (Math.random() * (maxMagnitude - minMagnitude));
  
  // Determine direction influenced by global market sentiment
  let positiveChance = 0.7; // Base 70% chance of positive spike
  
  // Market sentiment influence
  positiveChance += globalBTCMarketSentiment * 0.1; // ±10% based on market
  
  // Finally determine if positive or negative
  const isPositive = Math.random() < positiveChance;
  
  return isPositive ? magnitude : -magnitude;
}

/**
 * Determines if a super spike should be triggered for a particular day
 */
function shouldTriggerSuperSpike(currentDay, lastSpikeDay = 0, highVolatilityMode = false) {
  // Don't allow spikes if too recent (minimum 5 days since last spike)
  if (currentDay - lastSpikeDay < 5) {
    return false;
  }
  
  // Base probability adjusted for volatility mode
  let baseProbability = 1 / 9.5; // Average of 5 and 14 is 9.5
  
  // If in high volatility mode, increase probability
  if (highVolatilityMode) {
    baseProbability = 1 / 7; // More frequent in high volatility periods
  }
  
  // Higher probability the longer we go without a spike
  const daysSinceLastSpike = currentDay - lastSpikeDay;
  let adjustedProbability = baseProbability;
  
  // Gradually increase probability after 10 days
  if (daysSinceLastSpike > 10) {
    // Add 0.5% per day after 10 days
    adjustedProbability += (daysSinceLastSpike - 10) * 0.005;
  }
  
  // Cap at 25% daily probability to avoid certainty
  adjustedProbability = Math.min(0.25, adjustedProbability);
  
  // Random check based on adjusted probability
  return Math.random() < adjustedProbability;
}

// Initialize module
function initialize() {
  try {
    // Ensure data directory exists
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Load price data from file if exists
    if (fs.existsSync(PRICE_DATA_FILE)) {
      const data = fs.readFileSync(PRICE_DATA_FILE, 'utf8');
      priceState = JSON.parse(data);
      console.log('Loaded price data from file');
    } else {
      console.log('No saved price data found, using default values');
      // Initialize with default data
      initializeDefaultPriceData();
    }
    
    // Setup periodic updates
    setInterval(updatePrices, UPDATE_INTERVAL);
    
    // Initial update
    updatePrices();
    
    // Setup periodic save
    setInterval(savePriceData, 30 * 60 * 1000); // Save every 30 minutes
    
    // Setup periodic OVT supply update
    setInterval(updateOVTCirculatingSupply, 2 * 60 * 60 * 1000); // Every 2 hours
    
    // Initial OVT supply update
    updateOVTCirculatingSupply();
    
    return true;
  } catch (error) {
    console.error('Error initializing price service:', error);
    return false;
  }
}

// Initialize with default data
function initializeDefaultPriceData() {
  // Default portfolio positions - matching the client-side defaults
  const defaultPositions = getDefaultPortfolio();
  
  // Initialize price state with default positions
  defaultPositions.forEach(position => {
    // Add market cap for more realistic price movements
    const baseMarketCap = position.tokenAmount * position.pricePerToken;
    const randomFactor = 0.6 + Math.random() * 0.8; // 0.6 to 1.4
    
    priceState.positions[position.name] = {
      current: position.current,
      value: position.value,
      change: position.change,
      pricePerToken: position.pricePerToken,
      tokenAmount: position.tokenAmount,
      description: position.description,
      lastUpdate: Date.now(),
      lastSpikeDay: 0,
      marketCap: baseMarketCap * randomFactor,
      sector: assignSector(position),
      volatilityState: {
        lastValue: position.current,
        momentum: 0,
        trend: 0
      }
    };
  });
  
  // Calculate OVT price based on total NAV and circulating supply
  calculateOVTPrice();
  
  // Initialize price history with current values for positions
  priceState.priceHistory.daily = Object.fromEntries(
    defaultPositions.map(p => [
      p.name, 
      { 
        [getDayKey(new Date())]: p.current 
      }
    ])
  );
  
  priceState.priceHistory.hourly = Object.fromEntries(
    defaultPositions.map(p => [
      p.name, 
      { 
        [getHourKey(new Date())]: p.current 
      }
    ])
  );
  
  // Initialize OVT price history
  priceState.priceHistory.daily['ovt'] = { 
    [getDayKey(new Date())]: priceState.ovtPrice 
  };
  
  priceState.priceHistory.hourly['ovt'] = { 
    [getHourKey(new Date())]: priceState.ovtPrice 
  };
  
  priceState.lastUpdate = Date.now();
  
  // Save the initialized data
  savePriceData();
}

// Update price data periodically
async function updatePrices() {
  try {
    console.log('Updating price data...');
    
    // 1. Update Bitcoin price
    await updateBitcoinPrice();
    
    // 2. Update position prices with advanced price movement algorithm
    // Reference the current day for consistency
    const currentDay = getDayNumber();
    
    // Determine global market volatility regime (high volatility or normal)
    const volatilityRegime = Math.random() < 0.2; // 20% chance of high volatility regime
    
    // Update each position with correlated movements
    Object.keys(priceState.positions).forEach(positionName => {
      // Safety check: ensure position exists
      if (!positionName || !priceState.positions[positionName]) {
        console.warn(`Skipping undefined position for key: ${positionName}`);
        return; // Skip this iteration
      }
      
      const position = priceState.positions[positionName];
      
      // Safety check: ensure position has required properties
      if (!position.current || typeof position.current !== 'number' || !isFinite(position.current)) {
        console.warn(`Position ${positionName} has invalid current value, initializing it`);
        position.current = position.value || 100000; // Default to original value or 100k sats
      }
      
      if (!position.value || typeof position.value !== 'number' || !isFinite(position.value)) {
        console.warn(`Position ${positionName} has invalid value, setting default`);
        position.value = position.current || 100000; // Default to current value or 100k sats
      }
      
      if (!position.volatilityState) {
        position.volatilityState = {
          lastValue: position.current,
          momentum: 0,
          trend: 0
        };
      }
      
      // Determine if a super spike should occur
      const shouldSpike = shouldTriggerSuperSpike(
        currentDay, 
        position.lastSpikeDay || 0,
        volatilityRegime
      );
      
      // Generate appropriate price change
      let priceChange;
      if (shouldSpike) {
        priceChange = generateSuperSpike(position);
      } else {
        priceChange = generateDailyPriceChange(position, true); // Default to positive bias
      }
      
      // Apply the price change
      const currentValue = position.current;
      const newValue = currentValue * (1 + priceChange);
      
      // Calculate the change percentage based on original investment
      const changePercentRelativeToOriginal = ((newValue - position.value) / position.value) * 100;
      
      // Calculate new price per token
      const newPricePerToken = position.tokenAmount > 0 
        ? newValue / position.tokenAmount 
        : position.pricePerToken;
      
      // Update position data
      priceState.positions[positionName] = {
        ...position,
        current: newValue,
        change: changePercentRelativeToOriginal,
        pricePerToken: newPricePerToken,
        lastUpdate: Date.now(),
        lastSpikeDay: shouldSpike ? currentDay : (position.lastSpikeDay || 0),
        volatilityState: {
          lastValue: newValue,
          momentum: (newValue / currentValue - 1) * 0.5 + 
            (position.volatilityState?.momentum || 0) * 0.5,
          trend: (position.volatilityState?.trend || 0) * 0.7 + priceChange * 0.3
        }
      };
      
      // Update historical data
      updatePriceHistory(positionName, newValue);
    });
    
    // 3. Update OVT price based on NAV and circulating supply
    calculateOVTPrice();
    
    // 4. Update OVT price history
    updatePriceHistory('ovt', priceState.ovtPrice);
    
    // 5. Update last update timestamp
    priceState.lastUpdate = Date.now();
    
    // 6. Save the updated data
    savePriceData();
    
    console.log('Price data updated successfully');
    return true;
  } catch (error) {
    console.error('Error updating prices:', error);
    return false;
  }
}

// Update OVT circulating supply from the Runes API
async function updateOVTCirculatingSupply() {
  try {
    console.log('Updating OVT circulating supply...');
    
    // Try to fetch circulating supply from the Runes API
    try {
      // The Runes API should be running on the same server or accessible locally
      const response = await axios.get('http://localhost:3030/ovt/distribution', {
        timeout: 5000
      });
      
      if (response.data && response.data.success && response.data.distributionStats) {
        const { totalSupply, treasuryHeld } = response.data.distributionStats;
        
        // Circulating supply is total supply minus tokens held in treasury
        const circulatingSupply = totalSupply - treasuryHeld;
        
        // Update state with on-chain data
        priceState.ovtCirculatingSupply = circulatingSupply > 0 ? circulatingSupply : DEFAULT_OVT_CIRCULATING_SUPPLY;
        console.log(`Updated OVT circulating supply: ${priceState.ovtCirculatingSupply}`);
        
        // Recalculate OVT price with the updated supply
        calculateOVTPrice();
        
        // Save data
        savePriceData();
        
        return true;
      } else {
        console.log('Invalid response from Runes API, using default or previous supply');
      }
    } catch (error) {
      console.error('Error fetching OVT distribution data:', error);
      console.log('Using default or previous supply value');
    }
    
    // If we couldn't fetch from the API, ensure we have at least the default value
    if (!priceState.ovtCirculatingSupply) {
      priceState.ovtCirculatingSupply = DEFAULT_OVT_CIRCULATING_SUPPLY;
    }
    
    return false;
  } catch (error) {
    console.error('Error updating OVT circulating supply:', error);
    return false;
  }
}

// Calculate OVT price based on NAV and circulating supply
function calculateOVTPrice() {
  try {
    // 1. Calculate total NAV in sats
    const totalNAVSats = Object.values(priceState.positions)
      .reduce((sum, position) => {
        // Ensure we're adding valid numbers to prevent overflow
        const current = typeof position.current === 'number' && isFinite(position.current) ? position.current : 0;
        return sum + current;
      }, 0);
    
    // 2. Ensure total NAV is within reasonable bounds (max 100 million BTC in sats)
    const maxNAV = 100 * 1000000 * SATS_PER_BTC; // 100M BTC in sats
    const validatedNAV = Math.min(Math.max(totalNAVSats, 0), maxNAV);
    
    // 3. Ensure we have a valid circulating supply (fallback to default if needed)
    const circulatingSupply = priceState.ovtCirculatingSupply || DEFAULT_OVT_CIRCULATING_SUPPLY;
    
    // 4. Ensure supply is positive to avoid division by zero
    if (circulatingSupply <= 0) {
      console.error('Invalid circulating supply:', circulatingSupply);
      return priceState.ovtPrice || 0; // Return existing price or 0
    }
    
    // 5. Calculate OVT price in sats with validation
    const ovtPriceInSats = validatedNAV / circulatingSupply;
    
    // 6. Ensure the price is within reasonable bounds (max 1M sats per token)
    const maxPrice = 1000000; // 1M sats = 0.01 BTC
    const validatedPrice = Math.min(Math.max(ovtPriceInSats, 0), maxPrice);
    
    // 7. For more realistic price movement, don't fully update price to this value
    // Instead, move gradually towards it from the current price (momentum-based approach)
    let newPriceValue;
    
    if (priceState.ovtPrice) {
      // Calculate the gap between current and target price
      const priceDifference = validatedPrice - priceState.ovtPrice;
      
      // Move 5-20% of the way toward the new price (smoother transitions)
      // Larger movements for larger price differences (more reactive to big changes)
      const percentageToMove = Math.min(0.2, Math.abs(priceDifference) / priceState.ovtPrice / 5);
      
      // Calculate new price with momentum
      newPriceValue = priceState.ovtPrice + (priceDifference * percentageToMove);
    } else {
      // No existing price, use the calculated one directly
      newPriceValue = validatedPrice;
    }
    
    // 8. Store new OVT price in state
    priceState.ovtPrice = newPriceValue;
    
    // 9. Update price history for OVT
    updatePriceHistory('ovt', newPriceValue);
    
    // 10. Log the calculation for transparency
    console.log(`Calculated OVT price: ${newPriceValue} sats (NAV: ${validatedNAV} sats / Supply: ${circulatingSupply})`);
    
    return newPriceValue;
  } catch (error) {
    console.error('Error calculating OVT price:', error);
    // Return existing price or a default value
    return priceState.ovtPrice || 100000; // Default to 100k sats (0.001 BTC) if calculation fails
  }
}

// Save price data to file
function savePriceData() {
  try {
    fs.writeFileSync(PRICE_DATA_FILE, JSON.stringify(priceState, null, 2));
    console.log('Price data saved to file');
    return true;
  } catch (error) {
    console.error('Error saving price data:', error);
    return false;
  }
}

// Update price history for a position
function updatePriceHistory(positionName, currentValue) {
  try {
    // Safety checks
    if (!positionName || typeof currentValue !== 'number' || !isFinite(currentValue)) {
      console.warn(`Invalid input to updatePriceHistory: ${positionName}, ${currentValue}`);
      return;
    }
    
    // Ensure priceState.priceHistory exists
    if (!priceState.priceHistory) {
      priceState.priceHistory = { daily: {}, hourly: {} };
    }
    
    // Ensure daily and hourly entries exist
    if (!priceState.priceHistory.daily) {
      priceState.priceHistory.daily = {};
    }
    
    if (!priceState.priceHistory.hourly) {
      priceState.priceHistory.hourly = {};
    }
    
    const now = new Date();
    const dayKey = getDayKey(now);
    const hourKey = getHourKey(now);
    
    // Ensure the position exists in history
    if (!priceState.priceHistory.daily[positionName]) {
      priceState.priceHistory.daily[positionName] = {};
    }
    
    if (!priceState.priceHistory.hourly[positionName]) {
      priceState.priceHistory.hourly[positionName] = {};
    }
    
    // Update daily data
    priceState.priceHistory.daily[positionName][dayKey] = currentValue;
    
    // Update hourly data
    priceState.priceHistory.hourly[positionName][hourKey] = currentValue;
    
    // Cleanup old data (keep only last 30 days and 7 days of hourly data)
    cleanupHistoricalData();
  } catch (error) {
    console.error(`Error in updatePriceHistory: ${error.message}`);
  }
}

// Cleanup old historical data
function cleanupHistoricalData() {
  try {
    // Safety check for priceState.priceHistory
    if (!priceState.priceHistory || !priceState.priceHistory.daily || !priceState.priceHistory.hourly) {
      console.warn('Invalid priceState.priceHistory structure in cleanupHistoricalData');
      return;
    }
    
    const MAX_DAILY_DAYS = 30;
    const MAX_HOURLY_DAYS = 7;
    
    const now = new Date();
    const dailyCutoff = new Date(now);
    dailyCutoff.setDate(dailyCutoff.getDate() - MAX_DAILY_DAYS);
    
    const hourlyCutoff = new Date(now);
    hourlyCutoff.setDate(hourlyCutoff.getDate() - MAX_HOURLY_DAYS);
    
    // Clean daily data
    Object.keys(priceState.priceHistory.daily).forEach(positionName => {
      const positionData = priceState.priceHistory.daily[positionName];
      if (!positionData) return; // Skip if no position data
      
      Object.keys(positionData).forEach(dateKey => {
        try {
          const [year, month, day] = dateKey.split('-').map(n => parseInt(n));
          const entryDate = new Date(year, month - 1, day);
          if (entryDate < dailyCutoff) {
            delete positionData[dateKey];
          }
        } catch (error) {
          console.warn(`Invalid date key in daily data: ${dateKey}`);
        }
      });
    });
    
    // Clean hourly data
    Object.keys(priceState.priceHistory.hourly).forEach(positionName => {
      const positionData = priceState.priceHistory.hourly[positionName];
      if (!positionData) return; // Skip if no position data
      
      Object.keys(positionData).forEach(dateTimeKey => {
        try {
          const [dateKey, hour] = dateTimeKey.split('T');
          if (!dateKey || !hour) {
            console.warn(`Invalid dateTimeKey format: ${dateTimeKey}`);
            delete positionData[dateTimeKey];
            return;
          }
          
          const [year, month, day] = dateKey.split('-').map(n => parseInt(n));
          const entryDate = new Date(year, month - 1, day, parseInt(hour));
          if (entryDate < hourlyCutoff || isNaN(entryDate.getTime())) {
            delete positionData[dateTimeKey];
          }
        } catch (error) {
          console.warn(`Invalid date time key in hourly data: ${dateTimeKey}`);
          delete positionData[dateTimeKey];
        }
      });
    });
  } catch (error) {
    console.error(`Error in cleanupHistoricalData: ${error.message}`);
  }
}

// Format date as YYYY-MM-DD
function getDayKey(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

// Format date as YYYY-MM-DDThh
function getHourKey(date) {
  return `${getDayKey(date)}T${date.getHours().toString().padStart(2, '0')}`;
}

// Update Bitcoin price from CoinGecko
async function updateBitcoinPrice() {
  try {
    // Check if we need to update (cache for 1 hour)
    const now = Date.now();
    const btcPriceData = fs.existsSync(BTC_PRICE_FILE) 
      ? JSON.parse(fs.readFileSync(BTC_PRICE_FILE, 'utf8')) 
      : { price: DEFAULT_BTC_PRICE, timestamp: 0 };
    
    if (now - btcPriceData.timestamp < 60 * 60 * 1000) {
      console.log('Using cached Bitcoin price:', btcPriceData.price);
      priceState.btcPrice = btcPriceData.price;
      return btcPriceData.price;
    }
    
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 5000 }
    );
    
    if (response.data && response.data.bitcoin && response.data.bitcoin.usd) {
      const price = response.data.bitcoin.usd;
      
      // Update price state
      priceState.btcPrice = price;
      
      // Save to cache file
      fs.writeFileSync(
        BTC_PRICE_FILE, 
        JSON.stringify({ price, timestamp: now })
      );
      
      console.log('Updated Bitcoin price:', price);
      return price;
    } else {
      throw new Error('Invalid response format from CoinGecko');
    }
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    // Use the existing price or default
    return priceState.btcPrice || DEFAULT_BTC_PRICE;
  }
}

/**
 * Calculate 24-hour change for a position
 */
function calculate24HourChange(positionName) {
  try {
    // Handle undefined or null positionName
    if (!positionName) {
      console.warn('calculate24HourChange called with undefined positionName');
      return 0;
    }
    
    // Ensure positionName is a string to avoid errors with toLowerCase()
    const positionNameStr = String(positionName);
    
    // Special case for OVT which isn't a portfolio position
    if (positionNameStr.toLowerCase() === 'ovt') {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const todayKey = getDayKey(now);
      const yesterdayKey = getDayKey(yesterday);
      
      // Check if we have history for 'ovt' specifically
      if (priceState.priceHistory && 
          priceState.priceHistory.daily && 
          priceState.priceHistory.daily['ovt'] && 
          priceState.priceHistory.daily['ovt'][yesterdayKey]) {
        const todayValue = priceState.ovtPrice;
        const yesterdayValue = priceState.priceHistory.daily['ovt'][yesterdayKey];
        
        // Ensure both values are valid numbers
        if (isFinite(todayValue) && isFinite(yesterdayValue) && yesterdayValue > 0) {
          return ((todayValue - yesterdayValue) / yesterdayValue) * 100;
        }
      }
      
      // If no direct OVT history, use weighted average of portfolio positions
      // which is more transparent than a random value
      const totalValue = Object.values(priceState.positions)
        .reduce((sum, pos) => sum + (isFinite(pos.current) ? pos.current : 0), 0);
        
      if (totalValue > 0) {
        let weightedChange = 0;
        
        Object.entries(priceState.positions).forEach(([name, pos]) => {
          if (name && pos) {
            const posChange = calculate24HourChange(name);
            const weight = isFinite(pos.current) ? pos.current / totalValue : 0;
            weightedChange += posChange * weight;
          }
        });
        
        // Add a small fixed bias for OVT as a fund token (0.5%)
        const positiveBias = 0.5;
        
        // Save this to history for consistency
        if (!priceState.priceHistory.daily) {
          priceState.priceHistory.daily = {};
        }
        if (!priceState.priceHistory.daily['ovt']) {
          priceState.priceHistory.daily['ovt'] = {};
        }
        
        // Set yesterday's value based on today's value and the calculated change
        const generatedChange = weightedChange + positiveBias;
        const yesterdayCalculatedValue = priceState.ovtPrice / (1 + (generatedChange / 100));
        
        // Store this in history for future consistency
        priceState.priceHistory.daily['ovt'][yesterdayKey] = yesterdayCalculatedValue;
        
        return generatedChange;
      }
      
      // If we can't calculate anything meaningful, return 0 (not a random value)
      // This is more transparent and prevents hydration errors
      return 0;
    }
    
    // Normal case for portfolio positions
    const position = priceState.positions[positionNameStr];
    if (!position) return 0;
    
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayKey = getDayKey(now);
    const yesterdayKey = getDayKey(yesterday);
    
    const todayValue = position.current;
    const yesterdayValue = priceState.priceHistory?.daily?.[positionNameStr]?.[yesterdayKey];
    
    // Ensure we have valid values
    if (!yesterdayValue || !isFinite(todayValue) || !isFinite(yesterdayValue) || yesterdayValue === 0) {
      return 0;
    }
    
    return ((todayValue - yesterdayValue) / yesterdayValue) * 100;
  } catch (error) {
    console.error('Error calculating 24-hour change:', error);
    return 0;
  }
}

// Simulate price movement for a position
function simulatePriceMovement(position) {
  try {
    // Check if position is undefined
    if (!position) {
      console.warn('simulatePriceMovement called with undefined position');
      return {
        current: 100000,
        value: 100000,
        change: 0,
        pricePerToken: 100,
        tokenAmount: 1000,
        description: "Default position",
        lastUpdate: Date.now(),
        lastSpikeDay: 0
      };
    }
    
    // Ensure position has required properties
    if (!position.current || typeof position.current !== 'number' || !isFinite(position.current)) {
      position.current = position.value || 100000;
    }
    
    if (!position.value || typeof position.value !== 'number' || !isFinite(position.value)) {
      position.value = position.current || 100000;
    }

    // Generate random daily change between -3% and +5% with positive bias
    const generateDailyChange = () => {
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      
      // Base volatility
      const volatility = 0.02;
      
      // Create a change with slight positive bias (0.5% positive bias on average)
      let change = z0 * volatility + 0.005;
      
      // Restrict to the expected range
      return Math.max(-0.03, Math.min(0.05, change));
    };
    
    // Determine if this should be a super spike day (rare large movement)
    const shouldGenerateSuperSpike = () => {
      const lastSpikeDay = position.lastSpikeDay || 0;
      const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
      
      // Don't allow spikes if too recent (minimum 5 days since last spike)
      if (currentDay - lastSpikeDay < 5) {
        return false;
      }
      
      // Base probability (1 in 10 days on average)
      const baseProbability = 1 / 10;
      
      // Higher probability the longer we go without a spike
      const daysSinceLastSpike = currentDay - lastSpikeDay;
      let adjustedProbability = baseProbability;
      
      // Gradually increase probability after 10 days
      if (daysSinceLastSpike > 10) {
        // Add 0.5% per day after 10 days
        adjustedProbability += (daysSinceLastSpike - 10) * 0.005;
      }
      
      // Cap at 25% daily probability
      adjustedProbability = Math.min(0.25, adjustedProbability);
      
      // Random check based on adjusted probability
      return Math.random() < adjustedProbability;
    };
    
    // Generate a super spike between +25% and +50% (positive) or -25% and -50% (negative)
    const generateSuperSpike = () => {
      const minMagnitude = 0.25;
      const maxMagnitude = 0.50;
      
      // Calculate magnitude
      const magnitude = minMagnitude + (Math.random() * (maxMagnitude - minMagnitude));
      
      // 70% chance of positive spike, 30% chance of negative
      const isPositive = Math.random() < 0.7;
      
      return isPositive ? magnitude : -magnitude;
    };
    
    // Calculate current day number for tracking spikes
    const currentDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    
    // Determine if we should create a spike
    const isSpike = shouldGenerateSuperSpike();
    
    // Generate change percentage based on whether it's a spike day
    const changePercentage = isSpike ? generateSuperSpike() : generateDailyChange();
    
    // Apply change to position
    const currentValue = position.current;
    const newValue = currentValue * (1 + changePercentage);
    
    // Calculate the change percentage based on original investment
    const changePercentRelativeToOriginal = ((newValue - position.value) / position.value) * 100;
    
    // Calculate new price per token
    const newPricePerToken = position.tokenAmount > 0 
      ? newValue / position.tokenAmount 
      : position.pricePerToken;
    
    // Return updated position
    return {
      ...position,
      current: newValue,
      // Keep the original value unchanged
      change: changePercentRelativeToOriginal,
      pricePerToken: newPricePerToken,
      lastUpdate: Date.now(),
      lastSpikeDay: isSpike ? currentDay : (position.lastSpikeDay || 0)
    };
  } catch (error) {
    console.error('Error simulating price movement:', error);
    return position;
  }
}

// Get default portfolio for initialization
function getDefaultPortfolio() {
  try {
    // Try to load the mock-data from the backend's data directory
    const mockDataPath = path.join(__dirname, '../../data/mock/portfolio-positions.json');
    if (fs.existsSync(mockDataPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockDataPath, 'utf8'));
      console.log(`Loaded portfolio positions from mock data: ${mockData.length} positions found`);
      return mockData;
    }
  } catch (error) {
    console.error('Error loading mock portfolio data:', error);
    console.log('Falling back to hardcoded portfolio positions');
  }
  
  // Fallback to default hardcoded portfolio positions if mock data can't be loaded
  return [
    {
      name: "Polymorphic Labs",
      value: 180000000,
      description: "Encryption Layer",
      current: 180000000,
      change: 0,
      tokenAmount: 600000,
      pricePerToken: 300
    },
    {
      name: "VoltFi",
      value: 87500000,
      description: "Bitcoin Volatility Index on Bitcoin",
      current: 87500000,
      change: 0,
      tokenAmount: 350000,
      pricePerToken: 250
    },
    {
      name: "MIXDTape",
      value: 100000000,
      description: "Phygital Music for superfans - disrupting Streaming",
      current: 100000000,
      change: 0,
      tokenAmount: 500000,
      pricePerToken: 200
    },
    {
      name: "OrdinalHive",
      value: 166980000,
      description: "Ordinal and Bitcoin asset aggregator for the Hive",
      current: 166980000,
      change: 0,
      tokenAmount: 690000,
      pricePerToken: 242
    }
  ];
}

// API methods for route handlers

/**
 * Get all portfolio positions with current prices
 */
function getAllPositions() {
  return Object.entries(priceState.positions).map(([name, position]) => ({
    name,
    value: position.value,
    current: position.current,
    change: position.change,
    pricePerToken: position.pricePerToken,
    tokenAmount: position.tokenAmount,
    description: position.description,
    dailyChange: calculate24HourChange(name)
  }));
}

/**
 * Get the current OVT price data
 */
function getOVTPrice() {
  // Calculate the daily change with higher priority
  const dailyChange = calculate24HourChange('ovt');
  
  // Ensure we always have a valid daily change
  const validatedDailyChange = (
    typeof dailyChange === 'number' && isFinite(dailyChange)
  ) ? dailyChange : (Math.random() * 8) - 2; // Generate a random change between -2% and +6%
  
  return {
    price: priceState.ovtPrice,
    btcPriceSats: priceState.ovtPrice,
    btcPriceFormatted: `${Math.floor(priceState.ovtPrice)} sats`,
    usdPrice: (priceState.ovtPrice / SATS_PER_BTC) * priceState.btcPrice,
    usdPriceFormatted: `$${((priceState.ovtPrice / SATS_PER_BTC) * priceState.btcPrice).toFixed(2)}`,
    dailyChange: validatedDailyChange,
    lastUpdate: priceState.lastUpdate,
    circulatingSupply: priceState.ovtCirculatingSupply
  };
}

/**
 * Get the current Bitcoin price
 */
function getBitcoinPrice() {
  return {
    price: priceState.btcPrice,
    formatted: `$${priceState.btcPrice.toLocaleString()}`,
    lastUpdate: priceState.lastUpdate
  };
}

/**
 * Get price history for a specific position
 */
function getPriceHistory(positionName, timeframe = 'daily') {
  if (!priceState.priceHistory[timeframe] || !priceState.priceHistory[timeframe][positionName]) {
    return [];
  }
  
  const historyData = priceState.priceHistory[timeframe][positionName];
  return Object.entries(historyData).map(([dateKey, value]) => ({
    date: dateKey,
    value
  })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get NAV data
 */
function getNAVData() {
  // Sum all position current values
  const totalValueSats = Object.values(priceState.positions)
    .reduce((sum, position) => sum + position.current, 0);
  
  // Convert to USD
  const totalValueUSD = (totalValueSats / SATS_PER_BTC) * priceState.btcPrice;
  
  // Calculate overall change percentage
  const totalOriginalValue = Object.values(priceState.positions)
    .reduce((sum, position) => sum + position.value, 0);
  
  const overallChangePercentage = ((totalValueSats - totalOriginalValue) / totalOriginalValue) * 100;
  
  // Format the values
  let formattedTotalValueSats;
  if (totalValueSats >= 10000000) { // 0.1 BTC or more
    formattedTotalValueSats = `₿${(totalValueSats / SATS_PER_BTC).toFixed(2)}`;
  } else if (totalValueSats >= 1000000) {
    formattedTotalValueSats = `${(totalValueSats / 1000000).toFixed(2)}M sats`;
  } else if (totalValueSats >= 1000) {
    formattedTotalValueSats = `${(totalValueSats / 1000).toFixed(1)}k sats`;
  } else {
    formattedTotalValueSats = `${Math.floor(totalValueSats)} sats`;
  }
  
  let formattedTotalValueUSD;
  if (totalValueUSD >= 1000000) {
    formattedTotalValueUSD = `$${(totalValueUSD / 1000000).toFixed(2)}M`;
  } else if (totalValueUSD >= 1000) {
    formattedTotalValueUSD = `$${(totalValueUSD / 1000).toFixed(1)}k`;
  } else {
    formattedTotalValueUSD = `$${Math.floor(totalValueUSD)}`;
  }
  
  return {
    totalValueSats,
    totalValueUSD,
    formattedTotalValueSats,
    formattedTotalValueUSD,
    changePercentage: overallChangePercentage,
    btcPrice: priceState.btcPrice,
    ovtPrice: priceState.ovtPrice,
    circulatingSupply: priceState.ovtCirculatingSupply,
    lastUpdate: priceState.lastUpdate
  };
}

module.exports = {
  initialize,
  getAllPositions,
  getOVTPrice,
  getBitcoinPrice,
  getPriceHistory,
  getNAVData,
  updatePrices,
  updateOVTCirculatingSupply,
  calculateOVTPrice,
  updatePriceHistory,
  savePriceData,
  requestTracker
}; 