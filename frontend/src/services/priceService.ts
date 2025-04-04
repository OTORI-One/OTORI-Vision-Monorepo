/**
 * Price Service for OTORI Vision Frontend
 * 
 * This service handles communication with the centralized price API
 * to ensure consistent pricing data across all clients.
 * It does NOT perform any price calculations locally - all price data comes from the backend.
 */

import axios from 'axios';
import { w3cwebsocket as W3CWebSocket, IMessageEvent, ICloseEvent } from "websocket"; // Use websocket library and import types
import { RuneTransaction, TokenBalance } from '../hooks/useRuneIntegration'; // Import necessary types

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
  private _ovtBalance: TokenBalance | null = null;
  private _ovtTransactions: RuneTransaction[] = [];
  // Add back portfolio state
  private _portfolioPositions: Position[] = []; 
  // Add trade history and order book state
  private _tradeHistory: TradeTransaction[] = [];
  private _orderBook: OrderBook = { bids: [], asks: [] };
  
  // Track when data was last fetched
  private _navLastFetched: number = 0;
  private _ovtLastFetched: number = 0;
  private _btcLastFetched: number = 0;
  private _ovtBalanceLastFetched: number = 0;
  private _ovtTransactionsLastFetched: number = 0;
  // Add back portfolio fetched time
  private _portfolioLastFetched: number = 0;
  // Add trade fetched times
  private _tradeHistoryLastFetched: number = 0;
  private _orderBookLastFetched: number = 0;
  
  // Store listeners for data changes
  private _navListeners: Set<(data: NAVData) => void> = new Set();
  private _ovtListeners: Set<(data: OVTPrice) => void> = new Set();
  private _btcListeners: Set<(data: BitcoinPrice) => void> = new Set();
  private _ovtBalanceListeners: Set<(data: TokenBalance) => void> = new Set();
  private _ovtTransactionListeners: Set<(data: RuneTransaction[]) => void> = new Set();
  // Add back portfolio listeners
  private _portfolioListeners: Set<(positions: Position[]) => void> = new Set();
  // Add trade listener sets
  private _tradeListeners: Set<(trade: TradeTransaction) => void> = new Set(); // Assuming single trade updates
  private _orderBookListeners: Set<(orderBook: OrderBook) => void> = new Set();
  
  // WebSocket State
  private ws: W3CWebSocket | null = null;
  private wsUrl: string = WS_URL;
  private _isConnected: boolean = false;
  private connectionListeners: Set<(status: boolean) => void> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  
  // Pending promises might still be useful for initial load before WS connects
  private _pendingNavPromise: Promise<NAVData> | null = null;
  private _pendingOvtPromise: Promise<OVTPrice> | null = null;
  private _pendingBtcPromise: Promise<BitcoinPrice> | null = null;
  // NEW: Pending promises for balance/transactions (if HTTP fetch remains)
  private _pendingOvtBalancePromise: Promise<TokenBalance> | null = null;
  private _pendingOvtTransactionsPromise: Promise<RuneTransaction[]> | null = null;
  
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
      // Assign empty functions to effectively clear handlers
      this.ws.onopen = () => {}; 
      this.ws.onmessage = () => {};
      this.ws.onerror = () => {};
      this.ws.onclose = () => {};
      this.ws.close();
      this.ws = null; // Setting the ws object itself to null is fine
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
          // NEW: Handle OVT Balance Updates
          case 'OVT_BALANCE_UPDATE':
             // Assuming payload structure: { address: string, runeId: string, amount: number, formattedAmount: string }
            if (message.payload && message.payload.address && typeof message.payload.amount === 'number') {
                console.log('Updating OVT Balance from WS:', message.payload);
                this.ovtBalance = message.payload as TokenBalance; // Use setter
            } else {
                 console.warn('Received invalid OVT_BALANCE_UPDATE payload:', message.payload);
            }
            break;
           // NEW: Handle OVT Transaction Updates (Example: receiving a single new transaction)
           // Alternative: Backend could send 'OVT_TRANSACTION_HISTORY_UPDATE' with the full list
          case 'OVT_TRANSACTION_ADDED':
             // Assuming payload structure matches RuneTransaction interface
             if (message.payload && message.payload.txid) {
                 console.log('Adding OVT Transaction from WS:', message.payload);
                 const newTransaction = message.payload as RuneTransaction;
                 // Use setter to update the list and notify listeners
                 this.addOvtTransaction(newTransaction);
             } else {
                 console.warn('Received invalid OVT_TRANSACTION_ADDED payload:', message.payload);
             }
             break;
          // NEW: Handle Portfolio Updates
          case 'PORTFOLIO_UPDATE':
             // Assuming payload is Position[]
             if (message.payload && Array.isArray(message.payload)) {
                 console.log('Updating Portfolio from WS:', message.payload);
                 this.portfolioPositions = message.payload as Position[]; // Use setter
             } else {
                 console.warn('Received invalid PORTFOLIO_UPDATE payload:', message.payload);
             }
             break;
          // ADDED: Handle full initial positions update
          case 'ALL_POSITIONS_UPDATE':
            // Assuming payload is an object where keys are position names
            // and values are Position objects (matching backend structure)
            if (message.payload && typeof message.payload === 'object') {
                console.log('Received initial All Positions from WS:', message.payload);
                // Convert backend object { name: data } to frontend array [data]
                const positionsArray = Object.values(message.payload) as Position[];
                this.portfolioPositions = positionsArray; // Use setter
            } else {
                console.warn('Received invalid ALL_POSITIONS_UPDATE payload:', message.payload);
            }
            break;
          // NEW: Handle Trade Updates (assuming a single trade is pushed)
          case 'TRADE_UPDATE':
             // Assuming payload is a single TradeTransaction
             if (message.payload && message.payload.txid) {
                 // console.log('Received Trade Update from WS:', message.payload);
                 const newTrade = message.payload as TradeTransaction;
                 this.addTradeToHistory(newTrade); // Use method to add and notify
             } else {
                 console.warn('Received invalid TRADE_UPDATE payload:', message.payload);
             }
             break;
          // NEW: Handle Order Book Updates
          case 'ORDER_BOOK_UPDATE':
             // Assuming payload is the full OrderBook object
             if (message.payload && Array.isArray(message.payload.bids) && Array.isArray(message.payload.asks)) {
                 // console.log('Updating Order Book from WS:', message.payload);
                 this.orderBook = message.payload as OrderBook; // Use setter
             } else {
                 console.warn('Received invalid ORDER_BOOK_UPDATE payload:', message.payload);
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

    // NEW: Load portfolio from cache
    this._portfolioPositions = this.loadCachedData<Position[]>('portfolio-positions-cache') || [];
    // NEW: Load trade data from cache
    this._tradeHistory = this.loadCachedData<TradeTransaction[]>('trade-history-cache') || [];
    this._orderBook = this.loadCachedData<OrderBook>('order-book-cache') || { bids: [], asks: [] };
    
    // Set fetched times if data was loaded
    if (this._navData) this._navLastFetched = Date.now();
    if (this._ovtPrice) this._ovtLastFetched = Date.now();
    if (this._btcPrice) this._btcLastFetched = Date.now();
    // NEW: Set portfolio fetched time
    if (this._portfolioPositions.length > 0) this._portfolioLastFetched = Date.now(); 
    // NEW: Set trade data fetched time
    if (this._tradeHistory.length > 0) this._tradeHistoryLastFetched = Date.now();
    if (this._orderBook.bids.length > 0 || this._orderBook.asks.length > 0) this._orderBookLastFetched = Date.now();

    console.log('Initial cache loaded:', {
      nav: !!this._navData,
      ovt: !!this._ovtPrice,
      btc: !!this._btcPrice,
      portfolio: this._portfolioPositions.length > 0,
      tradeHistory: this._tradeHistory.length > 0,
      orderBook: this._orderBook.bids.length > 0 || this._orderBook.asks.length > 0
    });
  }


  // Initialize store: connect WebSocket and potentially fetch initial data via HTTP
  public initialize(): void {
    if (typeof window === 'undefined') return; // Only run on client

    console.log("PriceStore initializing...");

    // Connect WebSocket
    this.connectWebSocket();

    // Optional: Add initial HTTP fetches for balance/transactions if desired
    /*
     const address = getCurrentUserAddress(); // Need a way to get current address if fetching here
     if (address) {
         if (!this._ovtBalance) {
             // Call hypothetical fetchOvtBalance().catch(...)
         }
         if (this._ovtTransactions.length === 0) {
             // Call hypothetical fetchOvtTransactions().catch(...)
         }
     }
    */

    // The old startPeriodicUpdates is removed as updates are now WS-driven
  }

  // REMOVED: startPeriodicUpdates - No longer needed with WebSockets
  // public startPeriodicUpdates(): void { ... }


  // Add a utility method to check if data has changed meaningfully
  private hasDataChanged(oldData: any, newData: any, thresholdPercent: number = 0.01): boolean {
    if (!oldData || !newData) return true; // Always update if old data is null or new data exists

    // Use timestamp as primary check - if newer, always update
    if (typeof newData.timestamp === 'number' && typeof oldData.timestamp === 'number' && newData.timestamp > oldData.timestamp) {
        return true;
    }

    const checkNumericChange = (key: string): boolean => {
        const oldValue = oldData[key];
        const newValue = newData[key];
        if (typeof oldValue === 'number' && typeof newValue === 'number' && isFinite(oldValue) && isFinite(newValue)) {
            if (oldValue === 0 && newValue === 0) return false; 
            if (oldValue === 0) return true; 

            const pctChange = Math.abs((newValue - oldValue) / oldValue) * 100;
            return pctChange > thresholdPercent;
        }
        return oldValue !== newValue;
    };

    // --- Type Identification --- 
    // Identify based on key properties present in the newData object

    // NAVData Check (use totalValueSats as key identifier) - Checks NAV_UPDATE
    if (newData.totalValueSats !== undefined) {
       // console.log('Comparing as NAVData');
       // Compare the primary value and potentially others if they exist in newData
       let changed = checkNumericChange('totalValueSats');
       if (newData.changePercentage !== undefined) changed = changed || checkNumericChange('changePercentage');
       return changed;
    }

    // OVTPrice Check (use price AND circulatingSupply) - Checks OVT_PRICE_UPDATE
    // Ensure it's not BitcoinPrice by checking for circulatingSupply
    if (newData.price !== undefined && newData.circulatingSupply !== undefined) {
        // console.log('Comparing as OVTPrice');
       // Compare price and potentially dailyChange if it exists in newData
       let changed = checkNumericChange('price');
       if (newData.dailyChange !== undefined) changed = changed || checkNumericChange('dailyChange');
       return changed;
    }

    // BitcoinPrice Check (use formatted string as key identifier) - Checks BTC_PRICE_UPDATE
    // Assumes payload is just the number (price)
    if (newData.formatted !== undefined && newData.price === undefined && typeof newData === 'number') { // Modified: Check if newData *itself* is the number
        // console.log('Comparing as BitcoinPrice');
        // Directly compare the numeric value if newData is the price itself
        return oldData !== newData; 
    }
     // Check if it's the BitcoinPrice object with `formatted`
    if (newData.formatted !== undefined && newData.price !== undefined) {
         // console.log('Comparing as BitcoinPrice Object');
         return checkNumericChange('price');
    }
    
    // Position Check (use name, current, tokenAmount) - Checks POSITION_UPDATE / ALL_POSITIONS_UPDATE item
    if (newData.name !== undefined && newData.current !== undefined && newData.tokenAmount !== undefined) {
       // console.log(`Comparing as Position: ${newData.name}`);
       return checkNumericChange('current') || checkNumericChange('change') || checkNumericChange('dailyChange');
    }

    // OVT Balance Check (address, amount, runeId) - Checks OVT_BALANCE_UPDATE
    if (newData.address !== undefined && newData.amount !== undefined && newData.runeId !== undefined) {
        // console.log('Comparing as OVTBalance');
        return oldData?.amount !== newData.amount || oldData?.address !== newData.address;
    }
    
    // OrderBook Check (bids, asks arrays) - Checks ORDER_BOOK_UPDATE
    if (Array.isArray(newData.bids) && Array.isArray(newData.asks)) {
        // console.log('Comparing as OrderBook');
        return oldData?.bids?.length !== newData.bids.length || 
               oldData?.asks?.length !== newData.asks.length || 
               JSON.stringify(oldData) !== JSON.stringify(newData); 
    }

    // Fallback
    console.warn("hasDataChanged defaulting to true - couldn't determine data type for comparison.", newData);
    return true;
  }

  // NEW: OVT Balance accessors
  public get ovtBalance(): TokenBalance | null {
    return this._ovtBalance;
  }

  public set ovtBalance(data: TokenBalance | null) {
     if (data && data.address && typeof data.amount === 'number') {
       const changed = !this._ovtBalance || this._ovtBalance.amount !== data.amount || this._ovtBalance.address !== data.address;
       if (changed) {
          this._ovtBalance = data;
          this._ovtBalanceLastFetched = Date.now();
          // Notify listeners
          this._ovtBalanceListeners.forEach(listener => {
            try { listener(data); } catch (e) { console.error('Error in OVT Balance listener:', e); }
          });
          // Optionally cache balance? Depends on use case.
          // this.cacheData(`ovt-balance-cache-${data.address}`, data);
       }
    }
  }

  // NEW: OVT Transactions accessors / modifiers
  public get ovtTransactions(): RuneTransaction[] {
    return this._ovtTransactions;
  }

  // Setter for the entire list (e.g., after initial HTTP fetch)
  public set ovtTransactions(data: RuneTransaction[]) {
     // Basic check for array type
     if (Array.isArray(data)) {
         // More sophisticated check could compare txids if needed
         const changed = JSON.stringify(this._ovtTransactions) !== JSON.stringify(data);
         if (changed) {
            this._ovtTransactions = [...data].sort((a, b) => b.timestamp - a.timestamp); // Keep sorted
            this._ovtTransactionsLastFetched = Date.now();
            // Notify listeners with the full, updated list
            this._ovtTransactionListeners.forEach(listener => {
                try { listener(this._ovtTransactions); } catch (e) { console.error('Error in OVT Transaction list listener:', e); }
            });
            // Optionally cache transactions? Can get large.
            // this.cacheData(`ovt-transactions-cache-${address}`, data);
         }
     }
  }

   // Method to add a single transaction (e.g., from WS 'OVT_TRANSACTION_ADDED')
   public addOvtTransaction(transaction: RuneTransaction): void {
       if (transaction && transaction.txid) {
            // Avoid duplicates
            if (!this._ovtTransactions.some(tx => tx.txid === transaction.txid)) {
                const newList = [transaction, ...this._ovtTransactions].sort((a, b) => b.timestamp - a.timestamp);
                this._ovtTransactions = newList;
                this._ovtTransactionsLastFetched = Date.now(); // Update timestamp
                // Notify listeners with the new full list
                this._ovtTransactionListeners.forEach(listener => {
                    try { listener(this._ovtTransactions); } catch (e) { console.error('Error in OVT Transaction add listener:', e); }
                });
            }
       }
   }

  // NEW: Subscribe to OVT Balance updates
  public subscribeToOvtBalanceUpdates(callback: (data: TokenBalance) => void): () => void {
    this._ovtBalanceListeners.add(callback);
    // Immediately call with current data if available
    if (this._ovtBalance) {
        try { callback(this._ovtBalance); } catch (e) { console.error('Error in initial OVT Balance callback:', e); }
    }
    // Return unsubscribe function
    return () => {
      this._ovtBalanceListeners.delete(callback);
    };
  }

  // NEW: Subscribe to OVT Transaction updates (provides the full list)
  public subscribeToOvtTransactionUpdates(callback: (data: RuneTransaction[]) => void): () => void {
    this._ovtTransactionListeners.add(callback);
    // Immediately call with current data if available
    if (this._ovtTransactions.length > 0) {
        try { callback(this._ovtTransactions); } catch (e) { console.error('Error in initial OVT Transactions callback:', e); }
    }
    // Return unsubscribe function
    return () => {
      this._ovtTransactionListeners.delete(callback);
    };
  }

  // --- NEW: Portfolio Data Accessors & Subscription ---

  public get portfolioPositions(): Position[] {
    return this._portfolioPositions;
  }

  public set portfolioPositions(data: Position[]) {
    // Basic validation: Ensure it's an array
    if (Array.isArray(data)) {
       const changed = this._portfolioPositions.length !== data.length || 
                       JSON.stringify(this._portfolioPositions) !== JSON.stringify(data); // Simple deep compare for now

       if (changed) {
         this._portfolioPositions = data;
         this._portfolioLastFetched = Date.now();
         // Notify all portfolio listeners
         this._portfolioListeners.forEach(listener => {
           try { listener(data); } catch (e) { console.error('Error in Portfolio listener:', e); }
         });
         // Cache portfolio data
         this.cacheData('portfolio-positions-cache', data); 
       }
    } else {
        console.warn("Attempted to set portfolioPositions with non-array data:", data);
    }
  }

  // Subscribe to Portfolio updates
  public subscribeToPortfolioUpdates(callback: (positions: Position[]) => void): () => void {
    this._portfolioListeners.add(callback);
    // Immediately call with current data if available
    if (this._portfolioPositions.length > 0) { // Check if we have data
      try { callback(this._portfolioPositions); } catch (e) { console.error('Error in initial Portfolio callback:', e); }
    }
    // Return unsubscribe function
    return () => {
      this._portfolioListeners.delete(callback);
    };
  }

  // Fetch Portfolio Positions (initial load via HTTP)
  // Replaces the standalone exported function
  public async getPortfolioPositions(force: boolean = false): Promise<Position[]> {
    const now = Date.now();
    // Return cached data if not forced and cache is fresh (e.g., within 5 mins for portfolio)
    if (!force && this._portfolioPositions.length > 0 && (now - this._portfolioLastFetched < 300000)) { // 5 min TTL
      console.log("PriceStore: Returning cached portfolio positions.");
      return Promise.resolve([...this._portfolioPositions]); // Return a copy
    }

    // Use rate limiter/queue if needed, adapting existing pattern
    return this.executeRateLimitedRequest<Position[]>('/portfolio', async () => {
      try {
        console.log("PriceStore: Fetching portfolio positions from API...");
        const response = await axios.get<Position[]>(`${API_BASE_URL}/portfolio`);
        if (response.data && Array.isArray(response.data)) {
            // Validate data structure if necessary here
            this.portfolioPositions = response.data; // Use setter to update cache and notify listeners
            return response.data;
        } else {
            throw new Error('Invalid portfolio data format received from API');
        }
      } catch (error) {
        console.error('Error fetching portfolio positions:', error);
        handleApiError(error); // handleApiError is typed as 'never', it should throw
        // Add explicit throw to satisfy TS strict checks about implicit undefined return
        throw error; 
      }
    });
  }

  // --- NEW: Trading Data Accessors & Subscriptions ---

  public get tradeHistory(): TradeTransaction[] {
    return this._tradeHistory;
  }
  
  // Method to add a single trade (used by WS handler)
  public addTradeToHistory(trade: TradeTransaction): void {
    if (trade && trade.txid) {
      // Avoid duplicates and update existing if status changes
      const existingIndex = this._tradeHistory.findIndex(t => t.txid === trade.txid);
      let changed = false;
      if (existingIndex > -1) {
        // Update existing trade if different (e.g., status change)
        if (JSON.stringify(this._tradeHistory[existingIndex]) !== JSON.stringify(trade)) {
            this._tradeHistory[existingIndex] = trade;
            changed = true;
        } 
      } else {
        // Add new trade
        this._tradeHistory.unshift(trade); // Add to the beginning
        // Optional: Limit history size
        // if (this._tradeHistory.length > MAX_HISTORY_SIZE) { this._tradeHistory.pop(); }
        changed = true;
      }

      if (changed) {
          this._tradeHistory.sort((a, b) => b.timestamp - a.timestamp); // Ensure sorted by time
          this._tradeHistoryLastFetched = Date.now(); // Update timestamp
          // Notify individual trade listeners with the *new/updated* trade
          this._tradeListeners.forEach(listener => {
              try { listener(trade); } catch (e) { console.error('Error in Trade listener:', e); }
          });
          // Optionally cache trade history (can get large)
          // this.cacheData('trade-history-cache', this._tradeHistory);
      }
    }
  }

  // Setter for the full history (e.g., for initial load via HTTP if needed)
  public set tradeHistory(data: TradeTransaction[]) {
      if (Array.isArray(data)) {
          const sortedData = [...data].sort((a, b) => b.timestamp - a.timestamp);
          const changed = JSON.stringify(this._tradeHistory) !== JSON.stringify(sortedData);
          if (changed) {
              this._tradeHistory = sortedData;
              this._tradeHistoryLastFetched = Date.now();
              // Notify listeners? Typically updates come one by one via WS.
              // Maybe notify order book listeners if a full history load impacts it?
              // this.cacheData('trade-history-cache', this._tradeHistory);
          }
      } else {
           console.warn("Attempted to set tradeHistory with non-array data:", data);
      }
  }

  public get orderBook(): OrderBook {
    return this._orderBook;
  }

  public set orderBook(data: OrderBook) {
    // Basic validation
    if (data && Array.isArray(data.bids) && Array.isArray(data.asks)) {
      // Deep compare can be expensive, check size first
      const changed = this._orderBook.bids.length !== data.bids.length || 
                      this._orderBook.asks.length !== data.asks.length ||
                      JSON.stringify(this._orderBook) !== JSON.stringify(data);

      if (changed) {
        this._orderBook = data;
        this._orderBookLastFetched = Date.now();
        // Notify order book listeners
        this._orderBookListeners.forEach(listener => {
          try { listener(data); } catch (e) { console.error('Error in Order Book listener:', e); }
        });
        // Cache order book data
        this.cacheData('order-book-cache', data);
      }
    } else {
        console.warn("Attempted to set orderBook with invalid data:", data);
    }
  }

  // Subscribe to individual Trade updates
  public subscribeToTradeUpdates(callback: (trade: TradeTransaction) => void): () => void {
    this._tradeListeners.add(callback);
    // Initial call with history is complex as listener expects single trades.
    // The hook should probably fetch initial history separately.
    return () => {
      this._tradeListeners.delete(callback);
    };
  }

  // Subscribe to Order Book updates
  public subscribeToOrderBookUpdates(callback: (orderBook: OrderBook) => void): () => void {
    this._orderBookListeners.add(callback);
    // Immediately call with current data if available
    if (this._orderBook.bids.length > 0 || this._orderBook.asks.length > 0) { 
      try { callback(this._orderBook); } catch (e) { console.error('Error in initial Order Book callback:', e); }
    }
    return () => {
      this._orderBookListeners.delete(callback);
    };
  }

  // --- Fetching Methods (Add HTTP fetches for initial load if needed) ---
  // Example: Fetch initial Trade History via HTTP (if backend supports it)
  public async fetchTradeHistory(force: boolean = false): Promise<TradeTransaction[]> {
      // TODO: Implement HTTP fetch logic similar to getPortfolioPositions
      // Needs a corresponding API endpoint, e.g., /trade/history
      console.warn("fetchTradeHistory not implemented yet.");
      // For now, return current state or cached state
      if (this._tradeHistory.length > 0 && !force) {
          return Promise.resolve([...this._tradeHistory]);
      }
      // Placeholder: return empty if no API call implemented
      return Promise.resolve([]); 
  }

  // Example: Fetch initial Order Book via HTTP (if backend supports it)
  public async fetchOrderBook(force: boolean = false): Promise<OrderBook> {
       // TODO: Implement HTTP fetch logic similar to getPortfolioPositions
       // Needs a corresponding API endpoint, e.g., /trade/orderbook
      console.warn("fetchOrderBook not implemented yet.");
       // For now, return current state or cached state
      if ((this._orderBook.bids.length > 0 || this._orderBook.asks.length > 0) && !force) {
          return Promise.resolve({...this._orderBook});
      }
       // Placeholder: return empty if no API call implemented
       return Promise.resolve({ bids: [], asks: [] });
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
  subscribeToOvtBalanceUpdates: priceStore.subscribeToOvtBalanceUpdates.bind(priceStore),
  subscribeToOvtTransactionUpdates: priceStore.subscribeToOvtTransactionUpdates.bind(priceStore),
  subscribeToPortfolioUpdates: priceStore.subscribeToPortfolioUpdates.bind(priceStore),
  // NEW: Expose trade subscriptions
  subscribeToTradeUpdates: priceStore.subscribeToTradeUpdates.bind(priceStore),
  subscribeToOrderBookUpdates: priceStore.subscribeToOrderBookUpdates.bind(priceStore),
}; 

// --- Type Definitions (Ensure TradeTransaction and OrderBook are defined or imported) ---

// Assume TradeTransaction and OrderBook interfaces are defined similar to useTradingModule

export interface Order {
  price: number;  // in sats
  amount: number; // number of OVT tokens
}

export interface OrderBook {
  bids: Order[];  // buy orders (price descending)
  asks: Order[];  // sell orders (price ascending)
}

export interface TradeTransaction {
  txid: string;
  type: 'BUY' | 'SELL';
  amount: number; // OVT amount
  valueSats: number; // Total value in Sats
  pricePerOvtSats: number; // Effective price
  feeSats: number;
  confirmations?: number; // Optional confirmations
  timestamp: number; // Unix timestamp (seconds or ms)
  status: 'pending' | 'confirmed' | 'failed';
  orderType?: 'market' | 'limit'; // Optional order type
  limitPrice?: number; // Optional limit price
} 