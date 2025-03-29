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

export default {
  getPortfolioPositions,
  getOVTPrice,
  getBitcoinPrice,
  getNAVData,
  getPriceHistory,
  triggerPriceUpdate,
  updateOVTCirculatingSupply,
  getCachedOVTPrice,
  cacheOVTPrice,
  triggerOVTPriceUpdate
}; 