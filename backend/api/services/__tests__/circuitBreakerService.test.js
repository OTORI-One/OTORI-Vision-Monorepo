/**
 * Test for Circuit Breaker Service
 */

const { getCircuitBreaker, getAllCircuitBreakerStates, STATES } = require('../circuitBreakerService');

// Mock config
jest.mock('../configService', () => ({
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 1000,
    halfOpenTimeout: 500
  }
}));

describe('Circuit Breaker Service', () => {
  let originalConsole;
  
  beforeAll(() => {
    // Mock console functions
    originalConsole = { ...console };
    console.log = jest.fn();
    console.error = jest.fn();
  });
  
  afterAll(() => {
    // Restore console functions
    console.log = originalConsole.log;
    console.error = originalConsole.error;
  });
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });
  
  test('should execute a function in closed state', async () => {
    const breaker = getCircuitBreaker('test-execute');
    
    const testFn = jest.fn().mockResolvedValue('success');
    const result = await breaker.execute(testFn, 'test-arg');
    
    expect(testFn).toHaveBeenCalledTimes(1);
    expect(testFn).toHaveBeenCalledWith('test-arg');
    expect(result).toBe('success');
  });
  
  test('should open the circuit after reaching failure threshold', async () => {
    const breaker = getCircuitBreaker('test-open', { failureThreshold: 2 });
    
    const errorFn = jest.fn().mockRejectedValue(new Error('test error'));
    
    // First failure
    await expect(breaker.execute(errorFn)).rejects.toThrow('test error');
    expect(errorFn).toHaveBeenCalledTimes(1);
    
    // Second failure should open the circuit
    await expect(breaker.execute(errorFn)).rejects.toThrow('test error');
    expect(errorFn).toHaveBeenCalledTimes(2);
    
    // Third call should fail fast (not call the function)
    await expect(breaker.execute(errorFn)).rejects.toThrow('Circuit test-open is open');
    // Function should not be called since circuit is open
    expect(errorFn).toHaveBeenCalledTimes(2);
    
    // Check if circuit is open
    expect(breaker.getState().status).toBe(STATES.OPEN);
  });
  
  test('should transition to half-open state after reset timeout', async () => {
    const breaker = getCircuitBreaker('test-half-open', { 
      failureThreshold: 1,
      resetTimeout: 100
    });
    
    // Force open the circuit
    breaker.forceOpen();
    expect(breaker.getState().status).toBe(STATES.OPEN);
    
    // Wait for reset timeout
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Now attempt to execute - should transition to half-open
    const testFn = jest.fn().mockResolvedValue('success');
    await breaker.execute(testFn);
    
    // Function should be called once in half-open state
    expect(testFn).toHaveBeenCalledTimes(1);
    expect(breaker.getState().status).toBe(STATES.HALF_OPEN);
  });
  
  test('should close circuit after success in half-open state', async () => {
    const breaker = getCircuitBreaker('test-reclose');
    
    // Force circuit into half-open state
    breaker.forceOpen();
    const state = breaker.getState();
    state.status = STATES.HALF_OPEN;
    
    // First success in half-open
    const testFn = jest.fn().mockResolvedValue('success');
    await breaker.execute(testFn);
    
    // Second success should close the circuit
    await breaker.execute(testFn);
    
    // Check if circuit is closed
    expect(breaker.getState().status).toBe(STATES.CLOSED);
  });
  
  test('should reopen circuit on failure in half-open state', async () => {
    const breaker = getCircuitBreaker('test-reopen');
    
    // Force circuit into half-open state
    breaker.forceOpen();
    const state = breaker.getState();
    state.status = STATES.HALF_OPEN;
    
    // Failure in half-open should reopen the circuit
    const errorFn = jest.fn().mockRejectedValue(new Error('test error'));
    await expect(breaker.execute(errorFn)).rejects.toThrow('test error');
    
    // Check if circuit is open
    expect(breaker.getState().status).toBe(STATES.OPEN);
  });
  
  test('should use fallback function when circuit is open', async () => {
    const fallbackFn = jest.fn().mockReturnValue('fallback result');
    const breaker = getCircuitBreaker('test-fallback', { fallbackFn });
    
    // Force open the circuit
    breaker.forceOpen();
    
    // Attempt to execute
    const result = await breaker.execute(() => {
      throw new Error('Should not be called');
    });
    
    // Fallback should be called
    expect(fallbackFn).toHaveBeenCalledTimes(1);
    expect(result).toBe('fallback result');
  });
  
  test('should reset circuit state on demand', async () => {
    const breaker = getCircuitBreaker('test-reset');
    
    // Force open
    breaker.forceOpen();
    expect(breaker.getState().status).toBe(STATES.OPEN);
    
    // Reset
    breaker.reset();
    expect(breaker.getState().status).toBe(STATES.CLOSED);
    
    // Should be able to execute normally after reset
    const testFn = jest.fn().mockResolvedValue('success');
    const result = await breaker.execute(testFn);
    expect(result).toBe('success');
  });
  
  test('should get all circuit breaker states', async () => {
    // Create a few circuit breakers
    getCircuitBreaker('test-states-1');
    getCircuitBreaker('test-states-2');
    
    // Get all states
    const states = getAllCircuitBreakerStates();
    
    // Should have states for at least the two we just created
    expect(states['test-states-1']).toBeDefined();
    expect(states['test-states-2']).toBeDefined();
  });
}); 