/**
 * Price Service for OTORI Vision Frontend
 * 
 * This service handles communication with the centralized price API
 * to ensure consistent pricing data across all clients.
 * It does NOT perform any price calculations locally - all price data comes from the backend.
 */

import axios from 'axios';

// API base URL - can be overridden via environment variables
const API_BASE_URL = process.env.NEXT_PUBLIC_PRICE_API_URL || 'http://localhost:3030/api/price';
const CACHE_TTL = 10000; // Cache time-to-live: 10 seconds
const SATS_PER_BTC = 100000000; // 100M sats per BTC

// Central data storage - this is the single source of truth
class PriceStore {
  private static instance: PriceStore;
  
  // Store the latest data
  private _navData: NAVData | null = null;
  private _ovtPrice: OVTPrice | null = null;
  private _btcPrice: BitcoinPrice | null = null;
  
  // Track when data was last fetched
  private _navLastFetched: number = 0;
  private _ovtLastFetched: number = 0;
  private _btcLastFetched: number = 0;
  
  // Store listeners for data changes
  private _navListeners: Set<(data: NAVData) => void> = new Set();
  private _ovtListeners: Set<(data: OVTPrice) => void> = new Set();
  private _btcListeners: Set<(data: BitcoinPrice) => void> = new Set();
  
  // Pending promises to prevent duplicate requests
  private _pendingNavPromise: Promise<NAVData> | null = null;
  private _pendingOvtPromise: Promise<OVTPrice> | null = null;
  private _pendingBtcPromise: Promise<BitcoinPrice> | null = null;
  
  // Centralized queue for API requests to prevent 429 errors
  private requestQueue: Map<string, number> = new Map();
  private QUEUE_DELAY = 1500; // 1.5 seconds between requests of the same type
  private MAX_CONCURRENT_REQUESTS = 1; // Limit concurrent requests
  private activeRequests = 0;
  
  // Constructor is private for singleton pattern
  private constructor() {}
  
  // Get the singleton instance
  public static getInstance(): PriceStore {
    if (!PriceStore.instance) {
      PriceStore.instance = new PriceStore();
    }
    return PriceStore.instance;
  }
  
  // NAV data accessors
  public get navData(): NAVData | null {
    return this._navData;
  }
  
  public set navData(data: NAVData | null) {
    // Only update if data is valid
    if (data && !this.hasInfinityValues(data)) {
      this._navData = data;
      this._navLastFetched = Date.now();
      // Notify all listeners
      this._navListeners.forEach(listener => {
        try { listener(data); } catch (e) { console.error('Error in NAV listener:', e); }
      });
      // Also store in local storage for faster page loads
      this.cacheData('nav-data-cache', data);
    }
  }
  
  // OVT price accessors
  public get ovtPrice(): OVTPrice | null {
    return this._ovtPrice;
  }
  
  public set ovtPrice(data: OVTPrice | null) {
    // Only update if data is valid
    if (data && !this.hasInfinityValues(data)) {
      this._ovtPrice = data;
      this._ovtLastFetched = Date.now();
      // Notify all listeners
      this._ovtListeners.forEach(listener => {
        try { listener(data); } catch (e) { console.error('Error in OVT listener:', e); }
      });
      // Store in local storage
      this.cacheData('ovt-price-data', data);
    }
  }
  
  // BTC price accessors
  public get btcPrice(): BitcoinPrice | null {
    return this._btcPrice;
  }
  
  public set btcPrice(data: BitcoinPrice | null) {
    // Only update if data is valid
    if (data && !this.hasInfinityValues(data)) {
      this._btcPrice = data;
      this._btcLastFetched = Date.now();
      // Notify all listeners
      this._btcListeners.forEach(listener => {
        try { listener(data); } catch (e) { console.error('Error in BTC listener:', e); }
      });
      // Store in local storage
      this.cacheData('btc-price-data', data);
    }
  }
  
  // Subscribe to NAV updates
  public subscribeToNavUpdates(callback: (data: NAVData) => void): () => void {
    this._navListeners.add(callback);
    // Immediately call with current data if available
    if (this._navData) {
      callback(this._navData);
    }
    // Return unsubscribe function
    return () => {
      this._navListeners.delete(callback);
    };
  }
  
  // Subscribe to OVT price updates
  public subscribeToOvtUpdates(callback: (data: OVTPrice) => void): () => void {
    this._ovtListeners.add(callback);
    // Immediately call with current data if available
    if (this._ovtPrice) {
      callback(this._ovtPrice);
    }
    // Return unsubscribe function
    return () => {
      this._ovtListeners.delete(callback);
    };
  }
  
  // Subscribe to BTC price updates
  public subscribeToBtcUpdates(callback: (data: BitcoinPrice) => void): () => void {
    this._btcListeners.add(callback);
    // Immediately call with current data if available
    if (this._btcPrice) {
      callback(this._btcPrice);
    }
    // Return unsubscribe function
    return () => {
      this._btcListeners.delete(callback);
    };
  }
  
  // Helper to check for Infinity/NaN values in an object
  private hasInfinityValues(obj: any): boolean {
    for (const key in obj) {
      if (typeof obj[key] === 'number' && !isFinite(obj[key])) {
        console.warn(`Detected non-finite value in price data: ${key} = ${obj[key]}`);
        return true;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (this.hasInfinityValues(obj[key])) {
          return true;
        }
      }
    }
    return false;
  }
  
  // Helper to cache data in localStorage
  private cacheData(key: string, data: any): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error(`Error caching ${key}:`, e);
    }
  }
  
  // Helper to load data from localStorage
  private loadCachedData<T>(key: string, maxAge: number = 5 * 60 * 1000): T | null {
    if (typeof window === 'undefined') return null;
    try {
      const cachedData = localStorage.getItem(key);
      if (!cachedData) return null;
      
      const parsed = JSON.parse(cachedData);
      if (Date.now() - parsed.timestamp < maxAge) {
        return parsed.data as T;
      }
    } catch (e) {
      console.error(`Error loading cached ${key}:`, e);
    }
    return null;
  }
  
  // Helper method to handle API requests with rate limiting and retry logic
  private async executeRateLimitedRequest<T>(
    endpoint: string,
    requestFn: () => Promise<T>,
    retries = 2
  ): Promise<T> {
    // Check when last request of this type was made
    const lastRequestTime = this.requestQueue.get(endpoint) || 0;
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // If too recent, wait before making the request
    if (timeSinceLastRequest < this.QUEUE_DELAY) {
      // Wait for the remaining time plus a small buffer
      const waitTime = this.QUEUE_DELAY - timeSinceLastRequest + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Wait if we have too many active requests globally
    while (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Update the queue with current timestamp
    this.requestQueue.set(endpoint, Date.now());
    
    try {
      // Track active request count
      this.activeRequests++;
      
      // Execute the actual API request
      return await requestFn();
    } catch (error) {
      if (retries > 0) {
        console.warn(`Request to ${endpoint} failed, retrying... (${retries} attempts left)`);
        // Exponential backoff: wait longer for each retry
        const backoffTime = (3 - retries) * 3000 + Math.random() * 2000;
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        return this.executeRateLimitedRequest(endpoint, requestFn, retries - 1);
      }
      throw error;
    } finally {
      // Decrease active request count when done
      this.activeRequests--;
    }
  }
  
  // Method to fetch NAV data with automatic caching and retry
  public async fetchNAVData(force: boolean = false): Promise<NAVData> {
    const now = Date.now();
    const CACHE_TTL = 10000; // 10 seconds TTL
    
    // If we have recent data and this isn't a forced refresh, return cached data
    if (!force && this._navData && (now - this._navLastFetched < CACHE_TTL)) {
      return this._navData;
    }
    
    // Rate limiting - prevent too many requests
    if (this._pendingNavPromise) {
      return this._pendingNavPromise;
    }
    
    // Mark fetch time
    this._navLastFetched = now;
    
    // Use the rate-limited request helper
    this._pendingNavPromise = this.executeRateLimitedRequest<NAVData>(
      'nav',
      () => getNAVData(),
      3 // Three retries for NAV data since it's critical
    )
    .then(data => {
      // Update cache with valid data
      if (!this._navData || this.hasDataChanged(this._navData, data)) {
        this.navData = data; // This will trigger listeners
      }
      this._pendingNavPromise = null;
      return data;
    })
    .catch(err => {
      console.error('All NAV data fetch attempts failed:', err);
      this._pendingNavPromise = null;
      
      // Use cached data if we have it
      if (this._navData) {
        console.log('Using cached NAV data from memory');
        return this._navData;
      }
      
      // Try to load from localStorage
      const cachedData = this.loadCachedData<NAVData>('nav-data');
      if (cachedData) {
        console.log('Using cached NAV data from localStorage');
        this._navData = cachedData;
        return cachedData;
      }
      
      // If we have nothing else, throw the error
      throw new Error('Failed to fetch NAV data and no cache available');
    });
    
    return this._pendingNavPromise;
  }
  
  // Method to fetch OVT price with automatic caching and retry
  public async fetchOVTPrice(force: boolean = false): Promise<OVTPrice> {
    const now = Date.now();
    const CACHE_TTL = 10000; // 10 seconds TTL
    
    // If not forcing refresh and data is still fresh, use cached data
    if (!force && this._ovtPrice && (now - this._ovtLastFetched < CACHE_TTL)) {
      return this._ovtPrice;
    }
    
    // Rate limiting - prevent too many requests
    if (this._pendingOvtPromise) {
      return this._pendingOvtPromise;
    }
    
    // Mark fetch time
    this._ovtLastFetched = now;
    
    // Use the rate-limited request helper
    this._pendingOvtPromise = this.executeRateLimitedRequest<OVTPrice>(
      'ovt',
      () => getOVTPrice(),
      3 // Three retries for OVT price data since it's critical
    )
    .then(data => {
      // Ensure dailyChange is a valid number
      if (typeof data.dailyChange !== 'number' || !isFinite(data.dailyChange)) {
        // Use zero instead of a random number for transparency
        data.dailyChange = 0;
        console.warn('Server returned invalid dailyChange value, using 0');
      }
      
      // Update cache with valid data
      if (!this._ovtPrice || this.hasDataChanged(this._ovtPrice, data)) {
        this.ovtPrice = data; // This will trigger listeners
      }
      this._pendingOvtPromise = null;
      return data;
    })
    .catch(err => {
      console.error('All OVT price fetch attempts failed:', err);
      this._pendingOvtPromise = null;
      
      // Use cached data if we have it
      if (this._ovtPrice) {
        console.log('Using cached OVT price data from memory');
        return this._ovtPrice;
      }
      
      // Try to load from localStorage
      const cachedData = this.loadCachedData<OVTPrice>('ovt-price-data');
      if (cachedData) {
        console.log('Using cached OVT price data from localStorage');
        this._ovtPrice = cachedData;
        return cachedData;
      }
      
      // If we have nothing else, throw the error
      throw new Error('Failed to fetch OVT price data and no cache available');
    });
    
    return this._pendingOvtPromise;
  }
  
  // Method to fetch BTC price with automatic caching
  public async fetchBTCPrice(force: boolean = false): Promise<BitcoinPrice> {
    // If we have recent data and this isn't a forced refresh, return cached data
    const now = Date.now();
    const CACHE_TTL = 30000; // BTC price changes less frequently, use 30 seconds
    
    if (!force && this._btcPrice && (now - this._btcLastFetched < CACHE_TTL)) {
      return this._btcPrice;
    }
    
    // If we have a pending request, return that promise
    if (this._pendingBtcPromise) {
      return this._pendingBtcPromise;
    }
    
    // Mark fetch time
    this._btcLastFetched = now;
    
    // Use the rate-limited request helper
    this._pendingBtcPromise = this.executeRateLimitedRequest<BitcoinPrice>(
      'bitcoin',
      () => getBitcoinPrice(),
      2 // Two retries for BTC price
    )
    .then(data => {
      // Update cache with valid data
      if (!this._btcPrice || this.hasDataChanged(this._btcPrice, data)) {
        this.btcPrice = data; // This will trigger listeners
      }
      this._pendingBtcPromise = null;
      return data;
    })
    .catch(err => {
      console.error('All BTC price fetch attempts failed:', err);
      this._pendingBtcPromise = null;
      
      // Use cached data if we have it
      if (this._btcPrice) {
        console.log('Using cached BTC price data from memory');
        return this._btcPrice;
      }
      
      // Try to load from localStorage
      const cachedData = this.loadCachedData<BitcoinPrice>('btc-price-data');
      if (cachedData) {
        console.log('Using cached BTC price data from localStorage');
        this._btcPrice = cachedData;
        return cachedData;
      }
      
      // If we have nothing else, throw the error
      throw new Error('Failed to fetch BTC price data and no cache available');
    });
    
    return this._pendingBtcPromise;
  }
  
  // Initialize store with cached data
  public initialize(): void {
    // Try to load cached data
    const cachedNav = this.loadCachedData<NAVData>('nav-data-cache');
    if (cachedNav) this._navData = cachedNav;
    
    const cachedOvt = this.loadCachedData<OVTPrice>('ovt-price-data');
    if (cachedOvt) this._ovtPrice = cachedOvt;
    
    const cachedBtc = this.loadCachedData<BitcoinPrice>('btc-price-data');
    if (cachedBtc) this._btcPrice = cachedBtc;
    
    // Start data refresh
    this.startPeriodicUpdates();
  }
  
  // Start periodic updates for all data
  public startPeriodicUpdates(): void {
    // Skip in SSR context
    if (typeof window === 'undefined') return;
    
    // Track API health
    let isApiHealthy = true;
    let consecutiveErrors = 0;
    let lastSuccessfulFetch = Date.now();
    
    // Much more aggressive throttling to avoid rate limiting
    const MIN_INTERVAL = 60000;    // Minimum time between requests (60s)
    const MAX_INTERVAL = 300000;   // Maximum time between requests (5 minutes)
    const BACKOFF_FACTOR = 4;      // More aggressive exponential backoff
    const QUEUE_PROCESS_DELAY = 5000; // Time between processing queue items
    
    // Calculate interval based on API health
    const getRefreshInterval = () => {
      if (isApiHealthy) return MIN_INTERVAL;
      
      // Calculate backoff 
      const backoffTime = MIN_INTERVAL * Math.pow(BACKOFF_FACTOR, consecutiveErrors);
      return Math.min(backoffTime, MAX_INTERVAL);
    };
    
    // Helper to track API health
    const trackApiCall = (success: boolean) => {
      if (success) {
        isApiHealthy = true;
        consecutiveErrors = Math.max(0, consecutiveErrors - 1); // Gradually reduce error count
        lastSuccessfulFetch = Date.now();
      } else {
        consecutiveErrors++;
        if (consecutiveErrors > 2) { // Lower threshold for unhealthy API
          isApiHealthy = false;
          console.warn(`API appears unhealthy, backing off (${consecutiveErrors} consecutive errors)`);
        }
      }
    };
    
    // Create a queue system to avoid parallel requests
    const requestQueue: (() => Promise<void>)[] = [];
    let isProcessingQueue = false;
    
    // Process next request in queue with more delay between requests
    const processQueue = async () => {
      if (isProcessingQueue || requestQueue.length === 0) return;
      
      isProcessingQueue = true;
      
      try {
        const nextRequest = requestQueue.shift();
        if (nextRequest) {
          await nextRequest();
          trackApiCall(true);
        }
      } catch (err) {
        console.error('Error processing queued request:', err);
        trackApiCall(false);
      } finally {
        isProcessingQueue = false;
        
        // Process next request if available, with longer delay
        if (requestQueue.length > 0) {
          setTimeout(processQueue, QUEUE_PROCESS_DELAY);
        }
      }
    };
    
    // Add request to queue with priority and deduplication
    const queueRequest = (request: () => Promise<void>, type: string) => {
      // Check if we already have a request of this type in the queue
      const existingRequestIndex = requestQueue.findIndex(req => 
        (req as any).requestType === type
      );
      
      // If we already have this type of request, don't add another
      if (existingRequestIndex >= 0) {
        return;
      }
      
      // Tag the request with its type for deduplication
      (request as any).requestType = type;
      
      // Add to queue
      requestQueue.push(request);
      
      // Start processing if not already
      if (!isProcessingQueue) {
        processQueue();
      }
    };
    
    // Initial data load with types
    queueRequest(() => this.fetchNAVData().then(() => {}).catch(() => {}), 'nav');
    
    // Stagger the initial requests
    setTimeout(() => {
      queueRequest(() => this.fetchOVTPrice().then(() => {}).catch(() => {}), 'ovt');
    }, 5000);
    
    setTimeout(() => {
      queueRequest(() => this.fetchBTCPrice().then(() => {}).catch(() => {}), 'btc');
    }, 10000);
    
    // Set up staggered intervals with health-based timing and much longer intervals
    const navInterval = setInterval(() => {
      // Only queue new requests if the API is believed to be responsive
      // or enough time has passed since last error
      if (isApiHealthy || Date.now() - lastSuccessfulFetch > MAX_INTERVAL) {
        // NAV is high priority so always process it first
        queueRequest(() => this.fetchNAVData().then(() => {}).catch(() => {}), 'nav');
      }
    }, getRefreshInterval() * 1.0); // NAV refreshes at the base interval - most important data
    
    const ovtInterval = setInterval(() => {
      if (isApiHealthy || Date.now() - lastSuccessfulFetch > MAX_INTERVAL) {
        queueRequest(() => this.fetchOVTPrice().then(() => {}).catch(() => {}), 'ovt');
      }
    }, getRefreshInterval() * 2.0); // OVT updates less frequently
    
    const btcInterval = setInterval(() => {
      if (isApiHealthy || Date.now() - lastSuccessfulFetch > MAX_INTERVAL * 2) {
        queueRequest(() => this.fetchBTCPrice().then(() => {}).catch(() => {}), 'btc');
      }
    }, getRefreshInterval() * 4.0); // BTC refreshes least frequently
    
    // Add cleanup for memory leaks
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearInterval(navInterval);
        clearInterval(ovtInterval);
        clearInterval(btcInterval);
      });
    }
  }

  // Add a utility method to check if data has changed meaningfully
  private hasDataChanged(oldData: any, newData: any, threshold: number = 0.1): boolean {
    // For NAVData comparison
    if (oldData.totalValueSats !== undefined && newData.totalValueSats !== undefined) {
      // Only consider it changed if value differs by more than 0.1%
      const pctChange = Math.abs((newData.totalValueSats - oldData.totalValueSats) / oldData.totalValueSats);
      return pctChange > threshold / 100; // Convert to decimal (0.1% = 0.001)
    }
    
    // For OVTPrice comparison
    if (oldData.price !== undefined && newData.price !== undefined) {
      // Only consider it changed if price differs by more than 0.1%
      const pctChange = Math.abs((newData.price - oldData.price) / oldData.price);
      return pctChange > threshold / 100;
    }
    
    // For BitcoinPrice comparison
    if (oldData.price !== undefined && newData.price !== undefined) {
      // Only consider it changed if price differs by more than 0.1%
      const pctChange = Math.abs((newData.price - oldData.price) / oldData.price);
      return pctChange > threshold / 100;
    }
    
    // Default to true if no specific comparison rule exists
    return true;
  }
}

// Types
export interface Position {
  name: string;
  value: number;
  current: number;
  change: number;
  pricePerToken: number;
  tokenAmount: number;
  description: string;
  dailyChange: number;
  transactionId?: string;
  address?: string;
}

export interface OVTPrice {
  price: number;
  btcPriceSats: number;
  btcPriceFormatted: string;
  usdPrice: number;
  usdPriceFormatted: string;
  dailyChange: number;
  lastUpdate: number;
  circulatingSupply: number;
  timestamp: number;
}

export interface BitcoinPrice {
  price: number;
  formatted: string;
  lastUpdate: number;
  timestamp: number;
}

export interface NAVData {
  totalValueSats: number;
  totalValueUSD: number;
  formattedTotalValueSats: string;
  formattedTotalValueUSD: string;
  changePercentage: number;
  btcPrice: number;
  ovtPrice: number;
  circulatingSupply: number;
  lastUpdate: number;
  timestamp: number;
}

export interface PriceHistoryPoint {
  date: string;
  value: number;
}

// API client configuration
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Error handler
const handleApiError = (error: any): never => {
  // Log detailed error information
  if (error.response) {
    console.error('API Error Response:', {
      status: error.response.status,
      data: error.response.data
    });
  } else if (error.request) {
    console.error('API Request Error:', error.request);
  } else {
    console.error('API Error:', error.message);
  }
  throw error;
};

// Fetch all portfolio positions
export const getPortfolioPositions = async (): Promise<Position[]> => {
  try {
    const response = await apiClient.get<{success: boolean; positions: Position[]}>('/portfolio');
    if (response.data.success) {
      return response.data.positions;
    }
    throw new Error('Failed to fetch portfolio positions');
  } catch (error) {
    console.error('Error fetching portfolio positions:', error);
    throw error;
  }
};

// Get current OVT price
export const getOVTPrice = async (): Promise<OVTPrice> => {
  try {
    const response = await apiClient.get<OVTPrice & {success: boolean}>('/ovt');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('Failed to fetch OVT price');
  } catch (error) {
    console.error('Error fetching OVT price:', error);
    throw error; // Let the caller handle the error
  }
};

// Get current Bitcoin price
export const getBitcoinPrice = async (): Promise<BitcoinPrice> => {
  try {
    const response = await apiClient.get<BitcoinPrice & {success: boolean}>('/bitcoin');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('Failed to fetch Bitcoin price');
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    throw error; // Re-throw to handle at caller level
  }
};

// Get NAV data
export const getNAVData = async (): Promise<NAVData> => {
  try {
    const response = await apiClient.get<NAVData & {success: boolean}>('/nav');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('Failed to fetch NAV data');
  } catch (error) {
    console.error('Error fetching NAV data:', error);
    throw error; // Re-throw to handle at caller level
  }
};

// Get price history for a position
export const getPriceHistory = async (
  positionName: string,
  timeframe: 'daily' | 'hourly' = 'daily'
): Promise<PriceHistoryPoint[]> => {
  try {
    const response = await apiClient.get<{success: boolean; history: PriceHistoryPoint[]}>(`/history/${positionName}`, {
      params: { timeframe }
    });
    if (response.data.success) {
      return response.data.history;
    }
    throw new Error(`Failed to fetch price history for ${positionName}`);
  } catch (error) {
    console.error(`Error fetching price history for ${positionName}:`, error);
    throw error; // Re-throw to handle at caller level
  }
};

// Trigger a price update (admin only)
export const triggerPriceUpdate = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update');
    return response.data.success;
  } catch (error) {
    console.error('Error triggering price update:', error);
    throw error; // Re-throw to handle at caller level
  }
};

// Manually trigger an OVT circulating supply update (admin only)
export const updateOVTCirculatingSupply = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update-ovt-supply');
    return response.data.success;
  } catch (error) {
    console.error('Error updating OVT circulating supply:', error);
    throw error; // Re-throw to handle at caller level
  }
};

// Trigger OVT price update (admin only)
export const triggerOVTPriceUpdate = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update-ovt');
    return response.data.success;
  } catch (error) {
    console.error('Error triggering OVT price update:', error);
    throw error; // Re-throw to handle at caller level
  }
};

// Helper functions for handling caching and real-time updates
export const getCachedOVTPrice = (): OVTPrice | null => {
  try {
    if (typeof window === 'undefined') return null;
    
    const cachedData = localStorage.getItem('ovt-price-data');
    if (!cachedData) return null;
    
    const parsedData = JSON.parse(cachedData) as OVTPrice;
    
    // Only use cache if it's less than 5 minutes old
    if (Date.now() - parsedData.timestamp < 5 * 60 * 1000) {
      return parsedData;
    }
    return null;
  } catch (error) {
    console.error('Error reading cached OVT price:', error);
    return null;
  }
};

export const cacheOVTPrice = (data: OVTPrice): void => {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem('ovt-price-data', JSON.stringify({
      ...data,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Error caching OVT price:', error);
  }
};

// Export the singleton instance
const priceStore = PriceStore.getInstance();

// Initialize price store when module is loaded (but only on client)
if (typeof window !== 'undefined') {
  priceStore.initialize();
}

// Better API methods that use the singleton store
export const getPriceStore = () => priceStore;

// Helper to get NAV data using the store to avoid duplicate requests
export const getLatestNAVData = async (): Promise<NAVData> => {
  return priceStore.fetchNAVData();
};

// Helper to get OVT price using the store
export const getLatestOVTPrice = async (): Promise<OVTPrice> => {
  return priceStore.fetchOVTPrice();
};

// Helper to get Bitcoin price using the store
export const getLatestBitcoinPrice = async (): Promise<BitcoinPrice> => {
  return priceStore.fetchBTCPrice();
};

// Export default with both original and improved methods
export default {
  // Original methods
  getPortfolioPositions,
  getOVTPrice,
  getBitcoinPrice,
  getNAVData,
  getPriceHistory,
  triggerPriceUpdate,
  updateOVTCirculatingSupply,
  getCachedOVTPrice,
  cacheOVTPrice,
  triggerOVTPriceUpdate,
  
  // New store-based methods
  getLatestNAVData,
  getLatestOVTPrice,
  getLatestBitcoinPrice,
  getPriceStore,
  
  // Direct store access
  store: priceStore
}; 