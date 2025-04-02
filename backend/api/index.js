/**
 * OTORI Vision API Server
 * Provides centralized services for price feeds, trading simulation, and runes API
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const axios = require('axios');

// Initialize express app
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3031;
const NODE_ENV = process.env.NODE_ENV || 'development';
const RUNES_API_URL = process.env.REMOTE_RUNES_API_URL || process.env.RUNES_API_URL || 'http://localhost:9191';

// Similarly update other service URL lookups if needed elsewhere
const TRADING_API_URL = process.env.REMOTE_TRADING_API_URL || process.env.TRADING_API_URL || 'http://localhost:3032';
const PRICE_API_URL = process.env.REMOTE_PRICE_API_URL || process.env.PRICE_API_URL || 'http://localhost:3033';
const VALIDATION_API_URL = process.env.REMOTE_VALIDATION_API_URL || process.env.VALIDATION_API_URL || 'http://localhost:3034';

// Log startup information
console.log(`Starting OTORI Vision API in ${NODE_ENV} mode`);
console.log(`Using Runes API URL: ${RUNES_API_URL}`);

// Import API routes
const priceRoutes = require('./routes/priceRoutes');
const tradingRoutes = require('./routes/tradingRoutes');
const validationRoutes = require('./routes/validationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const healthRoutes = require('./routes/healthRoutes');

// Import error monitoring middleware
const { createErrorMonitoringMiddleware } = require('./services/errorMonitoringService');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin
}));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Data directory initialization
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory:', dataDir);
}

// Logs directory initialization for validation logs
const logsDir = path.join(dataDir, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log('Created logs directory:', logsDir);
}

// Mount API routes
app.use('/api/price', priceRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/validation', validationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health', healthRoutes); // Mount new health check routes

// Forward Runes API requests to the runesAPI service if we're not running it directly
if (RUNES_API_URL !== `http://localhost:${PORT}`) {
  console.log('Setting up Runes API proxy forwarding');
  // Proxy for Runes API endpoints
  app.use('/ovt', async (req, res) => {
    try {
      const url = `${RUNES_API_URL}${req.url}`;
      console.log(`Proxying request to: ${url}`);
      
      const method = req.method.toLowerCase();
      let response;
      
      if (method === 'get') {
        response = await axios.get(url, { params: req.query });
      } else if (method === 'post') {
        response = await axios.post(url, req.body);
      } else {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
      }
      
      res.status(response.status).json(response.data);
    } catch (error) {
      console.error('Error proxying to Runes API:', error.message);
      res.status(error.response?.status || 500).json({
        status: 'error',
        message: error.message || 'Internal Server Error',
        origin: 'proxy'
      });
    }
  });
} else {
  // Mount Runes API routes directly on the root path if we're running in combined mode
  // This makes endpoints like /ovt/distribution available
  const runesAPI = require('./runes_API');
  app.use('/', runesAPI);
  console.log('Running in combined mode with direct Runes API integration');
}

// Simple redirect from old health endpoint to new detailed health checks
app.get('/api/health-check', (req, res) => {
  res.redirect('/api/health');
});

// Add error monitoring middleware
app.use(createErrorMonitoringMiddleware());

// Home route for API documentation
app.get('/', (req, res) => {
  const endpoints = [
    {
      path: '/',
      method: 'GET',
      description: 'API documentation',
    },
    {
      path: '/api/health',
      method: 'GET',
      description: 'Basic health check endpoint',
    },
    {
      path: '/api/health/detailed',
      method: 'GET',
      description: 'Detailed system health check',
    },
    {
      path: '/api/health/circuit-breakers',
      method: 'GET',
      description: 'Get circuit breaker status',
    },
    {
      path: '/api/health/retry-stats',
      method: 'GET',
      description: 'Get retry statistics',
    },
    {
      path: '/api/health/error-stats',
      method: 'GET',
      description: 'Get error statistics',
    },
    {
      path: '/api/health/mock-status',
      method: 'GET',
      description: 'Get mock service status',
    },
    {
      path: '/api/health/mock-mode',
      method: 'POST',
      description: 'Toggle mock service mode',
    },
    {
      path: '/api/price/portfolio',
      method: 'GET',
      description: 'Get portfolio positions with current prices',
    },
    {
      path: '/api/price/ovt',
      method: 'GET',
      description: 'Get current OVT price data',
    },
    {
      path: '/api/price/bitcoin',
      method: 'GET',
      description: 'Get current Bitcoin price',
    },
    {
      path: '/api/price/history/:positionName',
      method: 'GET',
      description: 'Get price history for a specific position',
    },
    {
      path: '/api/price/nav',
      method: 'GET',
      description: 'Get NAV data including total value and changes',
    },
    {
      path: '/api/price/update',
      method: 'POST',
      description: 'Trigger a manual price update (admin only)',
    },
    {
      path: '/api/price/update-ovt-supply',
      method: 'POST',
      description: 'Trigger a manual update of OVT circulating supply (admin only)',
    },
    {
      path: '/api/trading/orderbook',
      method: 'GET',
      description: 'Get current order book data',
    },
    {
      path: '/api/trading/trades',
      method: 'GET',
      description: 'Get recent trades data',
    },
    {
      path: '/api/trading/liquidity',
      method: 'GET',
      description: 'Get current liquidity data',
    },
    {
      path: '/api/trading/user-trades',
      method: 'GET',
      description: 'Get trades for a specific user',
    },
    {
      path: '/api/trading/market-order',
      method: 'POST',
      description: 'Execute a market order',
    },
    {
      path: '/api/trading/limit-order',
      method: 'POST',
      description: 'Place a limit order',
    },
    {
      path: '/api/trading/price-impact',
      method: 'GET',
      description: 'Calculate price impact for a trade',
    },
    // New validation endpoints
    {
      path: '/api/validation/validate',
      method: 'POST',
      description: 'Validate a complete Bitcoin transaction',
    },
    {
      path: '/api/validation/validate-inputs',
      method: 'POST',
      description: 'Validate transaction inputs only',
    },
    {
      path: '/api/validation/validate-outputs',
      method: 'POST',
      description: 'Validate transaction outputs only',
    },
    {
      path: '/api/validation/validate-signature',
      method: 'POST',
      description: 'Validate transaction signature',
    },
    {
      path: '/api/validation/stats',
      method: 'GET',
      description: 'Get transaction validation statistics',
    },
    {
      path: '/api/validation/report',
      method: 'GET',
      description: 'Get validation report for a specific period',
    },
    {
      path: '/api/trading/utxo-stats',
      method: 'GET',
      description: 'Get UTXO management statistics and status',
    },
    {
      path: '/api/trading/reset-utxo-stats',
      method: 'POST',
      description: 'Reset UTXO management statistics (admin only)',
    },
    {
      path: '/api/trading/validation-stats',
      method: 'GET',
      description: 'Get transaction validation statistics (admin only)',
    },
    {
      path: '/ovt/buy',
      method: 'POST',
      description: 'Prepare and execute a token purchase transaction',
    },
    {
      path: '/ovt/sell',
      method: 'POST',
      description: 'Prepare a token sale transaction',
    },
    {
      path: '/ovt/submit-transaction',
      method: 'POST',
      description: 'Submit a signed transaction for broadcast',
    },
    {
      path: '/ovt/transactions',
      method: 'GET',
      description: 'Get transaction history for an address',
    },
  ];

  // Format the response as HTML for better readability in browsers
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OTORI Vision API</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          table { border-collapse: collapse; width: 100%; }
          th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          tr:hover { background-color: #f5f5f5; }
          code { background-color: #f0f0f0; padding: 2px 4px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>OTORI Vision API Endpoints</h1>
        <table>
          <tr>
            <th>Path</th>
            <th>Method</th>
            <th>Description</th>
          </tr>
    `;
    
    endpoints.forEach(endpoint => {
      html += `
        <tr>
          <td><code>${endpoint.path}</code></td>
          <td>${endpoint.method}</td>
          <td>${endpoint.description}</td>
        </tr>
      `;
    });
    
    html += `
        </table>
        <p>For more detailed API documentation, visit <a href="/api-docs">API Documentation</a>.</p>
      </body>
      </html>
    `;
    
    return res.send(html);
  }

  res.json({
    name: 'OTORI Vision API',
    version: '1.0.0',
    environment: NODE_ENV,
    runesApiUrl: RUNES_API_URL,
    endpoints
  });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    errorId: err.errorId
  });
});

// Start server
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`OTORI Vision API server running on port ${PORT} in ${NODE_ENV} mode`);
    console.log(`API documentation available at http://localhost:${PORT}/`);
  });
  
  // Set up a periodic task to match orders (every minute)
  setInterval(() => {
    try {
      const tradingService = require('./services/tradingService');
      const matches = tradingService.matchOrders();
      if (matches.length > 0) {
        console.log(`Matched ${matches.length} orders`);
      }
    } catch (error) {
      console.error('Error in order matching task:', error);
    }
  }, 60000);
}

// Export for potential programmatic usage
module.exports = {
  app,
  server,
  RUNES_API_URL,
  TRADING_API_URL,
  PRICE_API_URL,
  VALIDATION_API_URL
}; 