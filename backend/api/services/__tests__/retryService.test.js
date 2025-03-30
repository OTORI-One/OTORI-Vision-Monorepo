/**
 * Test for Retry Service
 */

const { withRetry, calculateBackoff, getRetryStats } = require('../retryService');
const path = require('path');
const fs = require('fs');

// Mock fs and path
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn()
}));

jest.mock('path', () => ({
  join: jest.fn().mockImplementation((...args) => args.join('/'))
}));

// Mock config
jest.mock('../configService', () => ({
  paths: {
    logDirectory: '/mock/logs'
  }
}));

describe('Retry Service', () => {
  let originalConsole;
  
  beforeAll(() => {
    // Mock console functions
    originalConsole = { ...console };
    console.warn = jest.fn();
    console.error = jest.fn();
  });
  
  afterAll(() => {
    // Restore console functions
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
  });
  
  test('should retry a failing function the specified number of times', async () => {
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('Success');
    
    const result = await withRetry(mockFn, 'test-operation', {
      attempts: 3,
      initialDelay: 10,
      retryLogEnabled: false
    });
    
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(result).toBe('Success');
  });
  
  test('should throw after exhausting retry attempts', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Persistent failure'));
    
    await expect(withRetry(mockFn, 'test-failure', {
      attempts: 2,
      initialDelay: 10,
      retryLogEnabled: false
    })).rejects.toThrow('Persistent failure');
    
    expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
  
  test('should not retry if shouldRetry returns false', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('No retry failure'));
    
    await expect(withRetry(mockFn, 'test-no-retry', {
      attempts: 3,
      initialDelay: 10,
      retryLogEnabled: false,
      shouldRetry: () => false
    })).rejects.toThrow('No retry failure');
    
    expect(mockFn).toHaveBeenCalledTimes(1); // Only initial attempt
  });
  
  test('should call onRetry callback before each retry', async () => {
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('Failure 1'))
      .mockRejectedValueOnce(new Error('Failure 2'))
      .mockResolvedValueOnce('Success');
    
    const onRetry = jest.fn();
    
    await withRetry(mockFn, 'test-callback', {
      attempts: 3,
      initialDelay: 10,
      retryLogEnabled: false,
      onRetry
    });
    
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2);
  });
  
  test('should calculate backoff with exponential factor', () => {
    const options = {
      initialDelay: 100,
      backoffFactor: 2,
      maxDelay: 10000,
      jitter: 0
    };
    
    // First attempt should be initialDelay
    const firstBackoff = calculateBackoff(0, options);
    expect(firstBackoff).toBe(100);
    
    // Second attempt should be initialDelay * backoffFactor
    const secondBackoff = calculateBackoff(1, options);
    expect(secondBackoff).toBe(200);
    
    // Third attempt should be initialDelay * backoffFactor^2
    const thirdBackoff = calculateBackoff(2, options);
    expect(thirdBackoff).toBe(400);
  });
  
  test('should respect maxDelay limit', () => {
    const options = {
      initialDelay: 100,
      backoffFactor: 2,
      maxDelay: 300,
      jitter: 0
    };
    
    // Third attempt would be 400, but maxDelay is 300
    const thirdBackoff = calculateBackoff(2, options);
    expect(thirdBackoff).toBe(300);
  });
  
  test('should log retry attempts if enabled', async () => {
    fs.existsSync.mockReturnValue(false);
    
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('Log this failure'))
      .mockResolvedValueOnce('Success');
    
    await withRetry(mockFn, 'test-logging', {
      attempts: 3,
      initialDelay: 10,
      retryLogEnabled: true
    });
    
    // Should have created log directory if it doesn't exist
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.mkdirSync).toHaveBeenCalled();
    
    // Should have logged the retry
    expect(fs.appendFileSync).toHaveBeenCalled();
    expect(fs.appendFileSync.mock.calls[0][1]).toContain('Log this failure');
  });
  
  test('should update statistics after successful retry', async () => {
    const mockFn = jest.fn()
      .mockRejectedValueOnce(new Error('Failure'))
      .mockResolvedValueOnce('Success');
    
    await withRetry(mockFn, 'test-stats-success', {
      attempts: 3,
      initialDelay: 10,
      retryLogEnabled: false
    });
    
    const stats = getRetryStats();
    
    // Should have incremented total operations
    expect(stats.totalOperations).toBeGreaterThan(0);
    
    // Should have incremented successful operations
    expect(stats.successfulOperations).toBeGreaterThan(0);
    
    // Should have incremented retried operations
    expect(stats.retriedOperations).toBeGreaterThan(0);
    
    // Should have incremented total retries
    expect(stats.totalRetries).toBeGreaterThan(0);
  });
  
  test('should update statistics after failed retry', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Persistent failure'));
    
    await expect(withRetry(mockFn, 'test-stats-failure', {
      attempts: 1,
      initialDelay: 10,
      retryLogEnabled: false
    })).rejects.toThrow();
    
    const stats = getRetryStats();
    
    // Should have incremented failed operations
    expect(stats.failedOperations).toBeGreaterThan(0);
  });
  
  test('should reset statistics when requested', () => {
    // Get stats with reset flag
    const stats = getRetryStats(true);
    
    // Get stats again
    const newStats = getRetryStats();
    
    // Should have reset counters
    expect(newStats.totalOperations).toBe(0);
    expect(newStats.successfulOperations).toBe(0);
    expect(newStats.failedOperations).toBe(0);
    expect(newStats.retriedOperations).toBe(0);
    expect(newStats.totalRetries).toBe(0);
  });
  
  test('should timeout operations that take too long', async () => {
    const slowFn = jest.fn(() => new Promise(resolve => setTimeout(resolve, 500)));
    
    await expect(withRetry(slowFn, 'test-timeout', {
      attempts: 1,
      initialDelay: 10,
      timeout: 50,
      retryLogEnabled: false
    })).rejects.toThrow('Operation timed out');
    
    expect(slowFn).toHaveBeenCalledTimes(1);
  });
}); 