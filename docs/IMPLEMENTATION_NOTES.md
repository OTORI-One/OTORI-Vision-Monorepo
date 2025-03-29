# OTORI Vision Implementation Notes

## Price Movement Algorithm Update

### Overview

We've updated the price movement implementation to ensure all price calculations happen on the server side, with the frontend strictly consuming the API. This approach provides:

1. Consistent pricing data across all clients
2. More realistic price movements with market correlations
3. Centralized control over price data
4. Reduced client-side computation

### Changes Made

#### Backend Updates

1. **Integrated Advanced Algorithm**
   - Moved the advanced price movement algorithm from frontend to backend
   - Implemented market correlation features in the backend service
   - Added realistic sector-based correlations
   - Implemented the full super spike functionality

2. **Enhanced Price Data Persistence**
   - Added improved data structures for tracking position history
   - Implemented daily and hourly price history tracking

#### Frontend Updates

1. **API-First Approach**
   - Removed all local price calculations from frontend components
   - Updated hooks to always fetch from API instead of calculating locally
   - Added proper error handling with graceful fallbacks

2. **PriceChart Component**
   - Updated to use real price history from API endpoint
   - Added fallback to synthetic data only when API fails
   - Improved rendering of current price point

3. **Price Service**
   - Simplified service to focus on API communication
   - Removed mock data generation except as error fallbacks
   - Improved caching for better offline experience

### Technical Details

#### Price Movement Algorithm

The advanced algorithm now running on the backend includes:

- Box-Muller transform for normal-like distribution of price changes
- Correlation between assets based on market sectors
- Global market sentiment factor that influences all positions
- Configurable volatility based on market cap
- Super spikes with realistic frequency and magnitude

#### API Endpoints

All pricing data is now available through the following endpoints:

- `/api/price/portfolio` - Get all portfolio positions with current prices
- `/api/price/ovt` - Get current OVT price data
- `/api/price/bitcoin` - Get current Bitcoin price
- `/api/price/nav` - Get NAV data
- `/api/price/history/:position` - Get price history for a position

### Future Improvements

1. **WebSocket Integration**
   - Add real-time price updates through WebSockets
   - Implement server-sent events for efficient updates

2. **Performance Optimizations**
   - Add more efficient caching strategies
   - Implement pagination for large datasets

3. **Enhanced Analytics**
   - Add more sophisticated correlation models
   - Implement machine learning for more realistic price movements 