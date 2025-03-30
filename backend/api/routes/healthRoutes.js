/**
 * Health Check Routes for OTORI Vision
 * 
 * Provides endpoints for monitoring system health and status.
 */

const express = require('express');
const router = express.Router();
const { getCircuitBreaker, getAllCircuitBreakerStates } = require('../services/circuitBreakerService');
const { getRetryStats } = require('../services/retryService');
const { getErrorStats } = require('../services/errorMonitoringService');
const { getServiceStatus } = require('../services/mockService');
const config = require('../services/configService');
const os = require('os');
const commandService = require('../services/commandExecutionService');

// Basic health check
router.get('/', async (req, res) => {
  try {
    // Check service availability
    const status = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuLoad: os.loadavg(),
    };
    
    res.json(status);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  try {
    // Run checks in parallel
    const [bitcoinStatus, bitcoinNetwork, serverResources] = await Promise.allSettled([
      checkBitcoinNodeStatus(),
      getBitcoinNetworkInfo(),
      getServerResources()
    ]);
    
    // Collect status information
    const status = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      
      // Component status
      components: {
        bitcoinNode: {
          status: bitcoinStatus.status === 'fulfilled' ? bitcoinStatus.value.status : 'error',
          details: bitcoinStatus.status === 'fulfilled' ? bitcoinStatus.value : { error: 'Failed to check Bitcoin node' }
        },
        bitcoinNetwork: {
          status: bitcoinNetwork.status === 'fulfilled' ? 'ok' : 'error',
          details: bitcoinNetwork.status === 'fulfilled' ? bitcoinNetwork.value : { error: 'Failed to get network info' }
        },
        server: {
          status: serverResources.status === 'fulfilled' ? 'ok' : 'warning',
          details: serverResources.status === 'fulfilled' ? serverResources.value : { error: 'Failed to get server resources' }
        }
      }
    };
    
    // Determine overall status
    if (bitcoinStatus.status !== 'fulfilled' || bitcoinStatus.value.status === 'error') {
      status.status = 'error';
    } else if (bitcoinNetwork.status !== 'fulfilled') {
      status.status = 'warning';
    }
    
    res.json(status);
  } catch (error) {
    console.error('Detailed health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Circuit breaker status
router.get('/circuit-breakers', (req, res) => {
  try {
    const circuitBreakerStates = getAllCircuitBreakerStates();
    res.json({
      timestamp: new Date().toISOString(),
      circuitBreakers: circuitBreakerStates
    });
  } catch (error) {
    console.error('Circuit breaker status error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Retry statistics
router.get('/retry-stats', (req, res) => {
  try {
    const reset = req.query.reset === 'true';
    const retryStats = getRetryStats(reset);
    res.json({
      timestamp: new Date().toISOString(),
      retryStats
    });
  } catch (error) {
    console.error('Retry stats error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Error statistics
router.get('/error-stats', (req, res) => {
  try {
    const reset = req.query.reset === 'true';
    const errorStats = getErrorStats(reset);
    res.json({
      timestamp: new Date().toISOString(),
      errorStats
    });
  } catch (error) {
    console.error('Error stats error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Mock service status
router.get('/mock-status', (req, res) => {
  try {
    const serviceStatus = getServiceStatus();
    res.json({
      timestamp: new Date().toISOString(),
      serviceStatus
    });
  } catch (error) {
    console.error('Mock service status error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Toggle mock service mode
router.post('/mock-mode', (req, res) => {
  try {
    const { mode, serviceOverrides } = req.body;
    
    if (!mode || !['real', 'mock', 'hybrid'].includes(mode)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid mode. Must be one of: real, mock, hybrid'
      });
    }
    
    const mockService = require('../services/mockService');
    const status = mockService.transitionServiceMode(mode, serviceOverrides || {});
    
    res.json({
      timestamp: new Date().toISOString(),
      message: `Service mode changed to ${mode}`,
      status
    });
  } catch (error) {
    console.error('Mock mode change error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Check Bitcoin node status
async function checkBitcoinNodeStatus() {
  try {
    // Use circuit breaker for Bitcoin node check
    const bitcoinCircuitBreaker = getCircuitBreaker('bitcoin-node');
    
    const blockchainInfo = await bitcoinCircuitBreaker.execute(async () => {
      return await commandService.executeBitcoinCommand('getblockchaininfo');
    });
    
    // Check if node is synced
    const isSynced = blockchainInfo.verificationprogress > 0.9999;
    
    return {
      status: isSynced ? 'ok' : 'syncing',
      chain: blockchainInfo.chain,
      blocks: blockchainInfo.blocks,
      headers: blockchainInfo.headers,
      verificationProgress: blockchainInfo.verificationprogress,
      initialBlockDownload: blockchainInfo.initialblockdownload,
      warnings: blockchainInfo.warnings || []
    };
  } catch (error) {
    console.error('Bitcoin node check error:', error);
    return {
      status: 'error',
      error: error.message
    };
  }
}

// Get Bitcoin network info
async function getBitcoinNetworkInfo() {
  try {
    // Use circuit breaker for Bitcoin network check
    const bitcoinCircuitBreaker = getCircuitBreaker('bitcoin-network');
    
    const [networkInfo, peerInfo] = await Promise.all([
      bitcoinCircuitBreaker.execute(async () => {
        return await commandService.executeBitcoinCommand('getnetworkinfo');
      }),
      bitcoinCircuitBreaker.execute(async () => {
        return await commandService.executeBitcoinCommand('getpeerinfo');
      })
    ]);
    
    return {
      version: networkInfo.version,
      subversion: networkInfo.subversion,
      protocolversion: networkInfo.protocolversion,
      connections: {
        total: peerInfo.length,
        inbound: peerInfo.filter(peer => peer.inbound).length,
        outbound: peerInfo.filter(peer => !peer.inbound).length
      },
      networks: networkInfo.networks,
      warnings: networkInfo.warnings || []
    };
  } catch (error) {
    console.error('Bitcoin network check error:', error);
    throw error;
  }
}

// Get server resources
async function getServerResources() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  return {
    cpus: os.cpus().length,
    loadAverage: os.loadavg(),
    memory: {
      total: formatBytes(totalMem),
      free: formatBytes(freeMem),
      used: formatBytes(usedMem),
      usedPercentage: Math.round((usedMem / totalMem) * 100)
    },
    uptime: formatUptime(os.uptime()),
    platform: os.platform(),
    release: os.release()
  };
}

// Format bytes to human-readable format
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  
  return `${bytes.toFixed(2)} ${units[i]}`;
}

// Format uptime to days, hours, minutes, seconds
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

module.exports = router; 