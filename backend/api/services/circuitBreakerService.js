/**
 * Circuit Breaker Service for OTORI Vision
 * 
 * Implements the Circuit Breaker pattern to prevent cascading failures
 * and provide fallback mechanisms during service disruptions.
 */

const config = require('./configService');
const EventEmitter = require('events');

// Circuit breaker event emitter
const breaker = new EventEmitter();

// Circuit breaker states
const STATES = {
  CLOSED: 'closed',     // Normal operation - requests flow through
  OPEN: 'open',         // Failure threshold reached - fail fast, prevent requests
  HALF_OPEN: 'halfOpen' // Testing if service recovered - allow limited requests
};

/**
 * Creates a new circuit breaker
 * @param {string} name - Unique name for the circuit breaker
 * @param {Object} options - Circuit breaker options
 * @returns {Object} Circuit breaker instance
 */
function createCircuitBreaker(name, options = {}) {
  const state = {
    name,
    status: STATES.CLOSED,
    failures: 0,
    successes: 0,
    lastFailure: null,
    lastSuccess: null,
    lastStateChange: Date.now(),
    options: {
      failureThreshold: options.failureThreshold || config.circuitBreaker.failureThreshold || 5,
      resetTimeout: options.resetTimeout || config.circuitBreaker.resetTimeout || 300000, // 5 minutes by default
      halfOpenTimeout: options.halfOpenTimeout || config.circuitBreaker.halfOpenTimeout || 60000, // 1 minute by default
      monitorInterval: options.monitorInterval || 30000, // 30 seconds by default
      fallbackFn: options.fallbackFn || null,
      logFn: options.logFn || console.log,
      errorFn: options.errorFn || console.error,
    }
  };

  // Set up monitoring interval to check for state transitions
  const monitorInterval = setInterval(() => {
    checkCircuitState(state);
  }, state.options.monitorInterval);

  /**
   * Executes a function with circuit breaker protection
   * @param {Function} fn - Function to execute
   * @param {Array} args - Arguments to pass to the function
   * @returns {Promise} Result of function or fallback
   */
  async function execute(fn, ...args) {
    // Check current circuit state
    if (state.status === STATES.OPEN) {
      const now = Date.now();
      const elapsed = now - state.lastStateChange;
      
      // If reset timeout has elapsed, move to half-open state
      if (elapsed >= state.options.resetTimeout) {
        transitionTo(STATES.HALF_OPEN);
      } else {
        // Circuit is open, execute fallback or throw error
        if (state.options.fallbackFn) {
          return state.options.fallbackFn(...args);
        }
        throw new Error(`Circuit ${name} is open: Service is unavailable (${Math.round((state.options.resetTimeout - elapsed) / 1000)}s remaining)`);
      }
    }

    try {
      // Execute the function
      const result = await fn(...args);
      
      // Record success
      recordSuccess();
      
      return result;
    } catch (error) {
      // Record failure
      recordFailure(error);
      
      // If fallback is provided, use it
      if (state.options.fallbackFn) {
        return state.options.fallbackFn(...args);
      }
      
      // Otherwise, propagate the error
      throw error;
    }
  }

  /**
   * Records a successful operation
   */
  function recordSuccess() {
    state.lastSuccess = Date.now();
    
    // If in half-open state, increase success counter
    if (state.status === STATES.HALF_OPEN) {
      state.successes++;
      
      // If success threshold reached, close the circuit
      if (state.successes >= 2) { // Require 2 consecutive successes to close
        transitionTo(STATES.CLOSED);
      }
    } else if (state.status === STATES.CLOSED) {
      // Reset failure count on success in closed state
      state.failures = 0;
    }
  }

  /**
   * Records a failed operation
   * @param {Error} error - Error that occurred
   */
  function recordFailure(error) {
    state.lastFailure = Date.now();
    state.failures++;
    
    // Log the failure
    state.options.errorFn(`Circuit ${name} failure: ${error.message}`, { 
      failures: state.failures, 
      threshold: state.options.failureThreshold 
    });
    
    // If failure threshold reached, open the circuit
    if (state.status === STATES.CLOSED && state.failures >= state.options.failureThreshold) {
      transitionTo(STATES.OPEN);
    } else if (state.status === STATES.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      transitionTo(STATES.OPEN);
    }
  }

  /**
   * Transitions the circuit to a new state
   * @param {string} newState - New state
   */
  function transitionTo(newState) {
    if (state.status === newState) return;
    
    const oldState = state.status;
    state.status = newState;
    state.lastStateChange = Date.now();
    
    // Reset counters on state change
    if (newState === STATES.CLOSED) {
      state.failures = 0;
    } else if (newState === STATES.HALF_OPEN) {
      state.successes = 0;
    }
    
    // Log state change
    state.options.logFn(`Circuit ${name} state changed from ${oldState} to ${newState}`);
    
    // Emit event
    breaker.emit('stateChanged', {
      name,
      from: oldState,
      to: newState,
      timestamp: state.lastStateChange
    });
  }

  /**
   * Checks and potentially updates circuit state
   */
  function checkCircuitState() {
    const now = Date.now();
    
    // If circuit is open and reset timeout has passed, transition to half-open
    if (state.status === STATES.OPEN && (now - state.lastStateChange) >= state.options.resetTimeout) {
      transitionTo(STATES.HALF_OPEN);
    }
  }

  /**
   * Gets current circuit state information
   * @returns {Object} Circuit state
   */
  function getState() {
    return {
      name: state.name,
      status: state.status,
      failures: state.failures,
      successes: state.status === STATES.HALF_OPEN ? state.successes : null,
      lastFailure: state.lastFailure,
      lastSuccess: state.lastSuccess,
      lastStateChange: state.lastStateChange,
      inOpenStateSince: state.status === STATES.OPEN ? state.lastStateChange : null,
      openRemainingTime: state.status === STATES.OPEN ? 
        Math.max(0, state.options.resetTimeout - (Date.now() - state.lastStateChange)) : null
    };
  }

  /**
   * Manually resets the circuit breaker to closed state
   */
  function reset() {
    state.failures = 0;
    state.successes = 0;
    transitionTo(STATES.CLOSED);
  }

  /**
   * Manually opens the circuit breaker
   */
  function forceOpen() {
    transitionTo(STATES.OPEN);
  }

  /**
   * Clean up resources when the circuit breaker is no longer needed
   */
  function shutdown() {
    clearInterval(monitorInterval);
  }

  // Return the circuit breaker interface
  return {
    execute,
    getState,
    reset,
    forceOpen,
    shutdown
  };
}

// Registry of circuit breakers
const circuitBreakers = {};

/**
 * Gets or creates a circuit breaker
 * @param {string} name - Circuit breaker name
 * @param {Object} options - Circuit breaker options
 * @returns {Object} Circuit breaker instance
 */
function getCircuitBreaker(name, options = {}) {
  if (!circuitBreakers[name]) {
    circuitBreakers[name] = createCircuitBreaker(name, options);
  }
  return circuitBreakers[name];
}

/**
 * Gets states of all circuit breakers
 * @returns {Object} States of all circuit breakers
 */
function getAllCircuitBreakerStates() {
  const states = {};
  Object.keys(circuitBreakers).forEach(name => {
    states[name] = circuitBreakers[name].getState();
  });
  return states;
}

// Listen for state change events
breaker.on('stateChanged', (event) => {
  console.log(`Circuit ${event.name} changed from ${event.from} to ${event.to}`);
});

module.exports = {
  STATES,
  getCircuitBreaker,
  getAllCircuitBreakerStates
}; 