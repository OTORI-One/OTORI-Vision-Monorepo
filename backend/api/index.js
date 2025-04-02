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
const SERVICE_TYPE = process.env.SERVICE_TYPE || 'all'; // Default to 'all' if not specified

// Determine base URLs based on environment
const ORDPI_GATEWAY_BASE = process.env.ORDPI_GATEWAY_URL || 'http://192.168.178.54:8080'; // Use gateway for external access
const LOCAL_RUNES_API_URL = process.env.RUNES_API_URL || 'http://localhost:9191'; // Direct local URL

// Choose Runes API URL based on context (local or remote via gateway)
// If running on WebPi (admin), use gateway. If on OrdPi, use local.
// We might need a more robust way to determine this, but SERVICE_TYPE can help.
const RUNES_API_URL = SERVICE_TYPE === 'admin' ? `${ORDPI_GATEWAY_BASE}/api/runes` : LOCAL_RUNES_API_URL;

// Define service URLs (primarily for reference or potential future direct calls)
const TRADING_API_URL = `${ORDPI_GATEWAY_BASE}/api/trading`;
const PRICE_API_URL = `${ORDPI_GATEWAY_BASE}/api/price`;
const VALIDATION_API_URL = `${ORDPI_GATEWAY_BASE}/api/validation`;

// Log startup information
console.log(`Starting OTORI Vision API [${SERVICE_TYPE}] in ${NODE_ENV} mode on port ${PORT}`);
console.log(`Using Runes API URL: ${RUNES_API_URL}`);
console.log(`Gateway URL: ${ORDPI_GATEWAY_BASE}`);

// Import API routes
const priceRoutes = require('./routes/priceRoutes');
const tradingRoutes = require('./routes/tradingRoutes');
const validationRoutes = require('./routes/validationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const healthRoutes = require('./routes/healthRoutes');
const runesAPI = require('./runes_API'); // For direct mounting if SERVICE_TYPE=runes

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

// Mount API routes conditionally based on SERVICE_TYPE
console.log(`Mounting routes for service type: ${SERVICE_TYPE}`);

// Health routes are always mounted
app.use('/api/health', healthRoutes);

if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'price') {
  console.log('Mounting /api/price routes');
  app.use('/api/price', priceRoutes);
}

if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'trading') {
  console.log('Mounting /api/trading routes');
  app.use('/api/trading', tradingRoutes);
}

if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'validation') {
  console.log('Mounting /api/validation routes');
  app.use('/api/validation', validationRoutes);
}

if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'admin') {
  console.log('Mounting /api/admin routes');
  app.use('/api/admin', adminRoutes);
}

if (SERVICE_TYPE === 'runes') {
  console.log('Mounting / (root) routes for Runes API Facade');
  // Mount Runes API routes directly on the root path
  // This makes endpoints like /ovt/distribution available
  app.use('/', runesAPI);
} else if (SERVICE_TYPE === 'all') {
  // If running in 'all' mode (e.g., local dev), mount runes directly too
  console.log('Mounting / (root) routes for Runes API (all mode)');
  app.use('/', runesAPI);
} else {
  // If we are NOT the runes service AND NOT in 'all' mode,
  // we might need to proxy requests if a component expects to call runes via the *same* port.
  // However, current setup seems to rely on explicit URLs (RUNES_API_URL),
  // so direct proxying might not be needed here unless a specific use case arises.
  console.log('Runes API routes are NOT mounted directly for this service type.');
  // The existing proxy logic below handles forwarding if needed based on RUNES_API_URL vs current port.
}

// Forward Runes API requests to the runesAPI service IF the RUNES_API_URL is different
// This logic remains relevant for services that need to call the runes API via a different host/port
if (RUNES_API_URL !== `http://localhost:${PORT}` && RUNES_API_URL !== `http://127.0.0.1:${PORT}`) {
  console.log(`Setting up Runes API proxy forwarding to ${RUNES_API_URL}`);
  // Proxy for Runes API endpoints expected at the root or /ovt
  // Note: Adjust prefix if needed, '/ovt' was used before, but runesAPI mounts at '/'
  const runesProxyPrefix = ''; // Proxy requests like /distribution, /mint etc.
  app.use(runesProxyPrefix, async (req, res) => {
    try {
      // Construct the target URL carefully
      const targetPath = req.originalUrl.startsWith(runesProxyPrefix)
        ? req.originalUrl.substring(runesProxyPrefix.length)
        : req.originalUrl;
      const url = `${RUNES_API_URL}${targetPath}`;
      console.log(`Proxying [${req.method}] request to: ${url}`);

      const method = req.method.toLowerCase();
      let response;
      const headers = { ...req.headers };
      // Remove host header to avoid conflicts
      delete headers.host;
      // Add other headers if necessary, e.g., 'Content-Type'

      const axiosConfig = {
        method: method,
        url: url,
        headers: headers,
        params: req.query, // Pass query params
        data: req.body, // Pass request body
        validateStatus: function (status) {
          return status >= 200 && status < 500; // Accept any status code below 500
        }
      };

      response = await axios(axiosConfig);

      // Forward the status code and response data
      res.status(response.status).set(response.headers).json(response.data);

    } catch (error) {
      console.error('Error proxying to Runes API:', error.message);
      const status = error.response?.status || 503; // Use 503 Service Unavailable for proxy errors
      res.status(status).json({
        status: 'error',
        message: `Failed to proxy request to Runes API: ${error.message}`,
        origin: 'proxy',
        targetUrl: RUNES_API_URL, // Show where it tried to connect
        errorDetails: error.code // Include details like ECONNREFUSED if available
      });
    }
  });
} else if (SERVICE_TYPE !== 'runes' && SERVICE_TYPE !== 'all') {
     // If we are the same host/port as RUNES_API_URL, but not the runes service itself, log that we're not proxying.
    console.log(`Runes API URL (${RUNES_API_URL}) matches local address, no proxy needed.`);
}

// Simple redirect from old health endpoint to new detailed health checks
app.get('/api/health-check', (req, res) => {
  res.redirect('/api/health');
});

// Add error monitoring middleware
app.use(createErrorMonitoringMiddleware());

// Home route for API documentation
app.get('/', (req, res) => {
  // Filter endpoints based on SERVICE_TYPE
  let availableEndpoints = [];
  const allEndpoints = [
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

  // Always include basic health and documentation endpoints
  availableEndpoints.push(allEndpoints.find(e => e.path === '/'));
  availableEndpoints.push(allEndpoints.find(e => e.path === '/api/health'));
  // Add detailed health endpoints too
  availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/api/health/')));

  // Add endpoints based on SERVICE_TYPE
  if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'price') {
    availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/api/price')));
  }
  if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'trading') {
    availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/api/trading')));
  }
  if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'validation') {
    availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/api/validation')));
  }
  if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'admin') {
    availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/api/admin')));
  }
  if (SERVICE_TYPE === 'runes' || SERVICE_TYPE === 'all') {
     // Assuming runes API endpoints start with /ovt or similar root paths defined in runesAPI
     // Filter based on common patterns or add specific endpoints if needed
     // Example: adding endpoints starting with /ovt/
     availableEndpoints.push(...allEndpoints.filter(e => e.path.startsWith('/ovt/')));
     // You might need a more robust way to identify runes endpoints if they don't share a common prefix
  }

  // Remove duplicates if any (e.g., from 'all' adding routes already added)
  availableEndpoints = availableEndpoints.filter((endpoint, index, self) =>
    endpoint && index === self.findIndex((e) => (e && e.path === endpoint.path && e.method === endpoint.method))
  );

  // Sort endpoints for consistency
  availableEndpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  // Format the response as HTML or JSON
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OTORI Vision API (${SERVICE_TYPE})</title>
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
        <h1>OTORI Vision API Endpoints (${SERVICE_TYPE})</h1>
        <table>
          <tr>
            <th>Path</th>
            <th>Method</th>
            <th>Description</th>
          </tr>
    `;

    availableEndpoints.forEach(endpoint => {
       if (endpoint) { // Add check in case filtering resulted in undefined entries
        html += `
          <tr>
            <td><code>${endpoint.path}</code></td>
            <td>${endpoint.method}</td>
            <td>${endpoint.description}</td>
          </tr>
        `;
       }
    });

    html += `
        </table>
         </body>
      </html>
    `;

    return res.send(html);
  }

  res.json({
    name: `OTORI Vision API (${SERVICE_TYPE})`,
    version: '1.0.0',
    environment: NODE_ENV,
    serviceType: SERVICE_TYPE, // Add service type to JSON response
    runesApiUrl: RUNES_API_URL,
    endpoints: availableEndpoints // Use the filtered list
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
    console.log(`OTORI Vision API server (${SERVICE_TYPE}) running on port ${PORT} in ${NODE_ENV} mode`);
    console.log(`API documentation available at http://localhost:${PORT}/`);
  });

  // Only run periodic tasks relevant to the service type
  if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'trading') {
    console.log('Setting up periodic order matching task for trading service.');
    setInterval(() => {
      try {
        // Ensure tradingService is required only when needed
        const tradingService = require('./services/tradingService');
        const matches = tradingService.matchOrders();
        if (matches.length > 0) {
          console.log(`Matched ${matches.length} orders`);
        }
      } catch (error) {
        console.error('Error in order matching task:', error);
      }
    }, 60000); // Adjust interval as needed
  }

   if (SERVICE_TYPE === 'all' || SERVICE_TYPE === 'price') {
     console.log('Initializing price service periodic updates.');
     // Assuming priceService initialization handles its own timers/intervals
     // If not, add setInterval calls here for price updates, OVT supply checks, etc.
     // e.g., require('./services/priceService').startPeriodicUpdates();
   }

   // Add other service-specific periodic tasks here
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