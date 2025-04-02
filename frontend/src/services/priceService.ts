/**
 * Price Service for OTORI Vision Frontend
 * 
 * This service handles communication with the centralized price API
 * to ensure consistent pricing data across all clients.
 * It does NOT perform any price calculations locally - all price data comes from the backend.
 */

import axios from 'axios';
import { w3cwebsocket as W3CWebSocket, IMessageEvent, ICloseEvent } from "websocket"; // Use websocket library and import types

// API base URL - can be overridden via environment variables
const API_BASE_URL = process.env.NEXT_PUBLIC_PRICE_API_URL || 'http://localhost:3030/api/price';
// Determine WebSocket URL from API URL or specific env var
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || API_BASE_URL.replace(/^http/, 'ws');

const CACHE_TTL = 10000; // Cache time-to-live: 10 seconds (Keep for potential fallback)
const SATS_PER_BTC = 100000000; // 100M sats per BTC
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds

// Central data storage - this is the single source of truth
class PriceStore {
  private static instance: PriceStore;
  
  // Store the latest data
  private _navData: NAVData | null = null;
  private _ovtPrice: OVTPrice | null = null;
  private _btcPrice: BitcoinPrice | null = null;
  
  // Track when data was last fetched (still useful for cache validity)
  private _navLastFetched: number = 0;
  private _ovtLastFetched: number = 0;
  private _btcLastFetched: number = 0;
  
  // Store listeners for data changes
  private _navListeners: Set<(data: NAVData) => void> = new Set();
  private _ovtListeners: Set<(data: OVTPrice) => void> = new Set();
  private _btcListeners: Set<(data: BitcoinPrice) => void> = new Set();
  
  // WebSocket State
  private ws: W3CWebSocket | null = null; // Use W3CWebSocket type
  private wsUrl: string = WS_URL;
  private _isConnected: boolean = false;
  private connectionListeners: Set<(status: boolean) => void> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  
  // Pending promises might still be useful for initial load before WS connects
  private _pendingNavPromise: Promise<NAVData> | null = null;
  private _pendingOvtPromise: Promise<OVTPrice> | null = null;
  private _pendingBtcPromise: Promise<BitcoinPrice> | null = null;
  
  // Rate limiting/Queueing might be removed if purely WS, but keep for now if HTTP calls remain
  private requestQueue: Map<string, number> = new Map();
  private QUEUE_DELAY = 1500; // 1.5 seconds between requests of the same type
  private MAX_CONCURRENT_REQUESTS = 1; // Limit concurrent requests
  private activeRequests = 0;
  
  // Constructor is private for singleton pattern
  private constructor() {
    // Load initial data from cache immediately
    this.loadInitialCache();
    // Don't connect immediately, wait for initialize call
  }
  
  // Get the singleton instance
  public static getInstance(): PriceStore {
    if (!PriceStore.instance) {
      PriceStore.instance = new PriceStore();
    }
    return PriceStore.instance;
  }
  
  // --- WebSocket Connection Management ---
  
  private connectWebSocket(): void {
    if (this.ws || typeof window === 'undefined') {
      // Avoid connecting if already connected or in SSR
      return;
    }

    console.log(`Attempting to connect WebSocket to ${this.wsUrl}...`);
    // Use W3CWebSocket constructor
    this.ws = new W3CWebSocket(this.wsUrl);
    this.setupWebSocketListeners();
  }
  
  private disconnectWebSocket(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      console.log('Disconnecting WebSocket...');
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.notifyConnectionListeners();
     this.reconnectAttempts = 0; // Reset attempts on manual disconnect
  }
  
  private setupWebSocketListeners(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected successfully.');
      this._isConnected = true;
      this.reconnectAttempts = 0; // Reset attempts on successful connection
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout); // Clear any pending reconnect timer
        this.reconnectTimeout = null;
      }
      this.notifyConnectionListeners();
      // Optional: Send a ping or subscription message if required by backend
      // this.ws.send(JSON.stringify({ type: 'subscribe', topics: ['nav', 'ovt', 'btc'] }));
    };

    this.ws.onmessage = (event: IMessageEvent) => {
      try {
        const message = JSON.parse(event.data.toString());
        // console.log('WebSocket message received:', message); // Verbose logging

        switch (message.type) {
          case 'NAV_UPDATE':
            if (message.payload && !this.hasInfinityValues(message.payload)) {
               // console.log('Updating NAV data from WS:', message.payload);
               this.navData = message.payload as NAVData; // Use setter to notify listeners
            } else {
                console.warn('Received invalid NAV_UPDATE payload:', message.payload);
            }
            break;
          case 'OVT_PRICE_UPDATE':
            if (message.payload && !this.hasInfinityValues(message.payload)) {
                // console.log('Updating OVT price from WS:', message.payload);
                this.ovtPrice = message.payload as OVTPrice; // Use setter
            } else {
                console.warn('Received invalid OVT_PRICE_UPDATE payload:', message.payload);
            }
            break;
          case 'BTC_PRICE_UPDATE':
            if (message.payload && !this.hasInfinityValues(message.payload)) {
               // console.log('Updating BTC price from WS:', message.payload);
               this.btcPrice = message.payload as BitcoinPrice; // Use setter
            } else {
                console.warn('Received invalid BTC_PRICE_UPDATE payload:', message.payload);
            }
            break;
           case 'PONG': // Handle potential ping/pong
             // console.log('Received pong from server');
             break;
          default:
            console.warn('Received unknown WebSocket message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error, 'Raw data:', event.data);
      }
    };

    this.ws.onerror = (error: Error) => {
      console.error('WebSocket error:', error);
      // The 'onclose' event will likely follow, triggering reconnection logic
    };

    this.ws.onclose = (event: ICloseEvent) => {
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}. Clean close: ${event.wasClean}`);
      this._isConnected = false;
      this.ws = null; // Ensure ws instance is cleared
      this.notifyConnectionListeners();
      if (!event.wasClean) { // Only attempt reconnect on unclean close
          this.scheduleReconnect();
      } else {
           console.log("WebSocket closed cleanly, not attempting reconnect.");
      }
    };
  }

  private scheduleReconnect(): void {
      if (this.reconnectTimeout) { // Prevent scheduling multiple reconnects
         // console.log("Reconnect already scheduled.");
          return;
      }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`Max WebSocket reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      this.reconnectAttempts = 0; // Reset for potential future manual connect
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter
    const delay = Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts -1) + Math.random() * 1000,
        MAX_RECONNECT_DELAY
    );


    console.log(`WebSocket disconnected. Attempting reconnect #${this.reconnectAttempts} in ${(delay / 1000).toFixed(1)}s...`);

    this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null; // Clear the timeout handle before attempting connection
        this.connectWebSocket();
    }, delay);
  }

  private notifyConnectionListeners(): void {
    this.connectionListeners.forEach(listener => {
      try { listener(this._isConnected); } catch (e) { console.error('Error in connection listener:', e); }
    });
  }

  // Public method to subscribe to connection status changes
  public subscribeToConnectionChange(callback: (status: boolean) => void): () => void {
    this.connectionListeners.add(callback);
    // Immediately call with current status
    callback(this._isConnected);
    // Return unsubscribe function
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  // Public property to check connection status
  public get isConnected(): boolean {
    return this._isConnected;
  }

  // --- Data Accessors & Handling (Mostly Unchanged, but rely on WS updates) ---
  
  // NAV data accessors
  public get navData(): NAVData | null {
    return this._navData;
  }
  
  public set navData(data: NAVData | null) {
    // Only update if data is valid and different enough
    if (data && !this.hasInfinityValues(data)) {
      const changed = !this._navData || this.hasDataChanged(this._navData, data);
      if(changed) {
          this._navData = data;
          this._navLastFetched = Date.now(); // Still track last update time
          // Notify all listeners
          this._navListeners.forEach(listener => {
            try { listener(data); } catch (e) { console.error('Error in NAV listener:', e); }
          });
          // Still cache in local storage for initial load speed
          this.cacheData('nav-data-cache', data);
      }
    }
  }
  
  // OVT price accessors
  public get ovtPrice(): OVTPrice | null {
    return this._ovtPrice;
  }
  
  public set ovtPrice(data: OVTPrice | null) {
     // Only update if data is valid and different enough
    if (data && !this.hasInfinityValues(data)) {
       const changed = !this._ovtPrice || this.hasDataChanged(this._ovtPrice, data);
       if(changed) {
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
  }
  
  // BTC price accessors
  public get btcPrice(): BitcoinPrice | null {
    return this._btcPrice;
  }
  
  public set btcPrice(data: BitcoinPrice | null) {
    // Only update if data is valid and different enough
    if (data && !this.hasInfinityValues(data)) {
        const changed = !this._btcPrice || this.hasDataChanged(this._btcPrice, data);
        if (changed) {
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
  }
  
  // --- Data Subscriptions (Unchanged) ---
  
  // Subscribe to NAV updates
  public subscribeToNavUpdates(callback: (data: NAVData) => void): () => void {
    this._navListeners.add(callback);
    // Immediately call with current data if available
    if (this._navData) {
        try { callback(this._navData); } catch (e) { console.error('Error in initial NAV callback:', e); }
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
        try { callback(this._ovtPrice); } catch (e) { console.error('Error in initial OVT callback:', e); }
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
        try { callback(this._btcPrice); } catch (e) { console.error('Error in initial BTC callback:', e); }
    }
    // Return unsubscribe function
    return () => {
      this._btcListeners.delete(callback);
    };
  }
  
  // --- Helper Methods (Mostly Unchanged) ---
  
  // Helper to check for Infinity/NaN values in an object
  private hasInfinityValues(obj: any): boolean {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (typeof value === 'number' && !isFinite(value)) {
            console.warn(`Detected non-finite value in price data: ${key} = ${value}`);
            return true;
          }
          if (typeof value === 'object' && value !== null) {
            if (this.hasInfinityValues(value)) {
              return true;
            }
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
        timestamp: Date.now() // Timestamp the cache entry
      }));
    } catch (e) {
      console.error(`Error caching ${key}:`, e);
    }
  }
  
  // Helper to load data from localStorage
  private loadCachedData<T>(key: string, maxAge: number = 5 * 60 * 1000): T | null { // Default 5 min max age
    if (typeof window === 'undefined') return null;
    try {
      const cachedItem = localStorage.getItem(key);
      if (!cachedItem) return null;

      const parsed = JSON.parse(cachedItem);
      if (!parsed.timestamp || !parsed.data) return null; // Validate structure

      if (Date.now() - parsed.timestamp < maxAge) {
          // console.log(`Using fresh cached data for ${key}`);
          return parsed.data as T;
      } else {
          // console.log(`Cached data for ${key} is stale.`);
          localStorage.removeItem(key); // Remove stale cache
          return null;
      }
    } catch (e) {
      console.error(`Error loading cached ${key}:`, e);
      localStorage.removeItem(key); // Remove potentially corrupted cache
    }
    return null;
  }
  
  // --- HTTP Fetching (Keep as fallback or for initial load?) ---
  // Decide if these HTTP methods are still needed. If WS is reliable,
  // they might only be needed for an initial fetch before WS connects,
  // or as a fallback mechanism. For now, keep the structure but remove
  // the automatic polling logic.
  
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
        console.warn(`HTTP Request to ${endpoint} failed, retrying... (${retries} attempts left)`);
        // Exponential backoff: wait longer for each retry
        const backoffTime = (3 - retries) * 1500 + Math.random() * 1000; // Shorter backoff for fallback HTTP
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        // Ensure correct recursive call signature
        return this.executeRateLimitedRequest<T>(endpoint, requestFn, retries - 1);
      }
       console.error(`All HTTP request attempts to ${endpoint} failed.`);
      throw error;
    } finally {
      // Decrease active request count when done
      this.activeRequests--;
    }
  }

  // Method to fetch NAV data via HTTP (potential fallback/initial load)
  public async fetchNAVData(force: boolean = false): Promise<NAVData> {
    const now = Date.now();
    const HTTP_CACHE_TTL = 60000; // Longer TTL for HTTP fallback (60s)

    // Use existing data if fresh and not forcing
    if (!force && this._navData && (now - this._navLastFetched < HTTP_CACHE_TTL)) {
      return this._navData;
    }

    // Use pending promise if available
    if (this._pendingNavPromise) {
      return this._pendingNavPromise;
    }

    console.log('Fetching NAV data via HTTP...');
    this._pendingNavPromise = this.executeRateLimitedRequest<NAVData>(
      'nav',
      () => getNAVData(), // Assumes getNAVData still makes the HTTP call
      2 // Fewer retries for fallback
    )
    .then(data => {
      // Update store only if data is newer or significantly different
      if (!this._navData || data.timestamp > this._navLastFetched || this.hasDataChanged(this._navData, data, 0.5)) {
          this.navData = data; // Use setter to notify/cache
      }
      this._pendingNavPromise = null;
      return this.navData!; // Return the potentially updated store data
    })
    .catch(err => {
      console.error('HTTP fetchNAVData failed:', err);
      this._pendingNavPromise = null;
      // Return existing data if available, otherwise throw
      if (this._navData) return this._navData;
      throw new Error('Failed to fetch NAV data via HTTP and no cache available');
    });

    return this._pendingNavPromise;
  }

  // Method to fetch OVT price via HTTP (potential fallback/initial load)
  public async fetchOVTPrice(force: boolean = false): Promise<OVTPrice> {
    const now = Date.now();
    const HTTP_CACHE_TTL = 60000; // 60 seconds TTL

    if (!force && this._ovtPrice && (now - this._ovtLastFetched < HTTP_CACHE_TTL)) {
      return this._ovtPrice;
    }
    if (this._pendingOvtPromise) {
      return this._pendingOvtPromise;
    }

     console.log('Fetching OVT price via HTTP...');
    this._pendingOvtPromise = this.executeRateLimitedRequest<OVTPrice>(
      'ovt',
      () => getOVTPrice(),
      2
    )
    .then(data => {
        if (!this._ovtPrice || data.timestamp > this._ovtLastFetched || this.hasDataChanged(this._ovtPrice, data, 0.5)) {
           // Ensure dailyChange is valid
           if (typeof data.dailyChange !== 'number' || !isFinite(data.dailyChange)) {
               data.dailyChange = this._ovtPrice?.dailyChange ?? 0; // Fallback to previous or 0
               console.warn('Server returned invalid dailyChange via HTTP, using fallback.');
           }
           this.ovtPrice = data;
        }
        this._pendingOvtPromise = null;
        return this.ovtPrice!;
    })
    .catch(err => {
      console.error('HTTP fetchOVTPrice failed:', err);
      this._pendingOvtPromise = null;
      if (this._ovtPrice) return this._ovtPrice;
      throw new Error('Failed to fetch OVT price via HTTP and no cache available');
    });

    return this._pendingOvtPromise;
  }

  // Method to fetch BTC price via HTTP (potential fallback/initial load)
  public async fetchBTCPrice(force: boolean = false): Promise<BitcoinPrice> {
     const now = Date.now();
     const HTTP_CACHE_TTL = 120000; // 120 seconds TTL for BTC

     if (!force && this._btcPrice && (now - this._btcLastFetched < HTTP_CACHE_TTL)) {
       return this._btcPrice;
     }
     if (this._pendingBtcPromise) {
       return this._pendingBtcPromise;
     }

      console.log('Fetching BTC price via HTTP...');
     this._pendingBtcPromise = this.executeRateLimitedRequest<BitcoinPrice>(
       'bitcoin',
       () => getBitcoinPrice(),
       2
     )
     .then(data => {
         if (!this._btcPrice || data.timestamp > this._btcLastFetched || this.hasDataChanged(this._btcPrice, data, 0.5)) {
             this.btcPrice = data;
         }
         this._pendingBtcPromise = null;
         return this.btcPrice!;
     })
     .catch(err => {
       console.error('HTTP fetchBTCPrice failed:', err);
       this._pendingBtcPromise = null;
       if (this._btcPrice) return this._btcPrice;
       throw new Error('Failed to fetch BTC price via HTTP and no cache available');
     });

     return this._pendingBtcPromise;
  }

  // --- Initialization and Updates ---
  
   // Load initial data from cache on construction
  private loadInitialCache(): void {
    if (typeof window === 'undefined') return;
    console.log("PriceStore: Loading initial cache...");
    const cachedNav = this.loadCachedData<NAVData>('nav-data-cache');
    if (cachedNav) this._navData = cachedNav;

    const cachedOvt = this.loadCachedData<OVTPrice>('ovt-price-data');
    if (cachedOvt) this._ovtPrice = cachedOvt;

    const cachedBtc = this.loadCachedData<BitcoinPrice>('btc-price-data');
    if (cachedBtc) this._btcPrice = cachedBtc;
  }


  // Initialize store: connect WebSocket and potentially fetch initial data via HTTP
  public initialize(): void {
    if (typeof window === 'undefined') return; // Only run on client

    console.log("PriceStore initializing...");

    // Connect WebSocket
    this.connectWebSocket();

    // Optional: Fetch initial data via HTTP if WS connection is delayed
    // or as a quick way to populate initial state while WS connects.
    // Consider if this is needed based on WS connection speed and reliability.
    /*
    if (!this._navData) {
        this.fetchNAVData().catch(e => console.warn("Initial NAV HTTP fetch failed", e));
    }
    if (!this._ovtPrice) {
        this.fetchOVTPrice().catch(e => console.warn("Initial OVT HTTP fetch failed", e));
    }
     if (!this._btcPrice) {
        this.fetchBTCPrice().catch(e => console.warn("Initial BTC HTTP fetch failed", e));
    }
    */

    // The old startPeriodicUpdates is removed as updates are now WS-driven
  }

  // REMOVED: startPeriodicUpdates - No longer needed with WebSockets
  // public startPeriodicUpdates(): void { ... }


  // Add a utility method to check if data has changed meaningfully
  // Adjusted threshold for less frequent updates if desired
  private hasDataChanged(oldData: any, newData: any, thresholdPercent: number = 0.01): boolean {
    if (!oldData || !newData) return true; // Always update if old data is null

    // Use timestamp as primary check - if newer, always update
     if (newData.timestamp && oldData.timestamp && newData.timestamp > oldData.timestamp) {
        // console.log("Data changed based on timestamp");
        return true;
    }

    // Helper to compare values with threshold
    const checkValueChange = (key: string): boolean => {
         if (oldData[key] !== undefined && newData[key] !== undefined && typeof oldData[key] === 'number' && typeof newData[key] === 'number') {
            if (oldData[key] === 0 && newData[key] === 0) return false; // 0 to 0 is not a change
            if (oldData[key] === 0 && newData[key] !== 0) return true; // 0 to non-zero is a change

            const pctChange = Math.abs((newData[key] - oldData[key]) / oldData[key]) * 100;
            // console.log(`Comparing ${key}: Old=${oldData[key]}, New=${newData[key]}, PctChange=${pctChange.toFixed(4)}%, Threshold=${thresholdPercent}%`);
            return pctChange > thresholdPercent;
         }
         // Fallback to simple inequality if not numbers or one is undefined
         return oldData[key] !== newData[key];
    };


    // Specific comparisons based on data type structure (adjust keys as needed)
    if (newData.totalValueSats !== undefined) { // NAVData
        return checkValueChange('totalValueSats') || checkValueChange('changePercentage');
    }
    if (newData.price !== undefined && newData.btcPriceSats !== undefined) { // OVTPrice or similar
        return checkValueChange('price') || checkValueChange('dailyChange'); // Check price and daily change
    }
     if (newData.price !== undefined && newData.lastUpdate !== undefined) { // BitcoinPrice or similar
        return checkValueChange('price'); // Just check price for BTC
    }


    // Fallback: Deep comparison (less efficient) or simple reference check if needed
     console.warn("hasDataChanged defaulting to true - couldn't determine data type for comparison.");
    return true; // Default to true if structure doesn't match known types
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
    console.error('API No Response Error:', error.message); // error.request might be complex
  } else {
    // Setup error
    console.error('API Setup Error:', error.message);
  }
   // Rethrow the error so callers can handle it
  throw error;
};

// Fetch all portfolio positions
export const getPortfolioPositions = async (): Promise<Position[]> => {
  try {
    const response = await apiClient.get<{success: boolean; positions: Position[]}>('/portfolio');
    if (response.data.success) {
      return response.data.positions;
    }
    throw new Error('API indicated failure fetching portfolio positions');
  } catch (error) {
    console.error('Error fetching portfolio positions:', error);
    return handleApiError(error); // Call and return to satisfy linter about never return
  }
};

// Get current OVT price
export const getOVTPrice = async (): Promise<OVTPrice> => {
  try {
    const response = await apiClient.get<OVTPrice & {success: boolean}>('/ovt');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('API indicated failure fetching OVT price');
  } catch (error) {
    return handleApiError(error);
  }
};

// Get current Bitcoin price
export const getBitcoinPrice = async (): Promise<BitcoinPrice> => {
  try {
    const response = await apiClient.get<BitcoinPrice & {success: boolean}>('/bitcoin');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('API indicated failure fetching Bitcoin price');
  } catch (error) {
    return handleApiError(error);
  }
};

// Get NAV data
export const getNAVData = async (): Promise<NAVData> => {
  try {
    const response = await apiClient.get<NAVData & {success: boolean}>('/nav');
    if (response.data.success) {
      return response.data;
    }
    throw new Error('API indicated failure fetching NAV data');
  } catch (error) {
    return handleApiError(error);
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
    throw new Error(`API indicated failure fetching price history for ${positionName}`);
  } catch (error) {
    console.error(`Error fetching price history for ${positionName}:`, error);
    return handleApiError(error);
  }
};

// Trigger a price update (admin only)
export const triggerPriceUpdate = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update');
    return response.data.success;
  } catch (error) {
    console.error('Error triggering price update:', error);
    return handleApiError(error);
  }
};

// Manually trigger an OVT circulating supply update (admin only)
export const updateOVTCirculatingSupply = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update-ovt-supply');
    return response.data.success;
  } catch (error) {
    console.error('Error updating OVT circulating supply:', error);
    return handleApiError(error);
  }
};

// Trigger OVT price update (admin only)
export const triggerOVTPriceUpdate = async (): Promise<boolean> => {
  try {
    const response = await apiClient.post<{success: boolean}>('/update-ovt');
    return response.data.success;
  } catch (error) {
    console.error('Error triggering OVT price update:', error);
    return handleApiError(error);
  }
};

// Export the singleton instance
const priceStore = PriceStore.getInstance();

// Initialize price store when module is loaded (client-side only)
if (typeof window !== 'undefined') {
  priceStore.initialize();
}

// New way to access the store
export const getPriceStore = () => priceStore;

// --- Consolidated Export ---
// Provides access via default export, including the store instance
export default {
  // Store instance and accessors
  store: priceStore,
  getPriceStore,

  // Potentially still useful direct HTTP calls
  getPortfolioPositions,
  getPriceHistory,
  triggerPriceUpdate,
  updateOVTCirculatingSupply,
  triggerOVTPriceUpdate,

  // Direct access to store methods (can be used instead of getLatest...)
  fetchNAVData: priceStore.fetchNAVData.bind(priceStore), // Expose HTTP fetch methods bound to store
  fetchOVTPrice: priceStore.fetchOVTPrice.bind(priceStore),
  fetchBTCPrice: priceStore.fetchBTCPrice.bind(priceStore),

  // Subscription methods directly available
  subscribeToNavUpdates: priceStore.subscribeToNavUpdates.bind(priceStore),
  subscribeToOvtUpdates: priceStore.subscribeToOvtUpdates.bind(priceStore),
  subscribeToBtcUpdates: priceStore.subscribeToBtcUpdates.bind(priceStore),
  subscribeToConnectionChange: priceStore.subscribeToConnectionChange.bind(priceStore),
}; 