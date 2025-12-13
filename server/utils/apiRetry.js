/**
 * API Retry Utility - Exponential backoff with circuit breaker
 * Consolidates retry logic for ElevenLabs, OpenAI, and other external APIs
 */

import { logger } from './logger.js';

/**
 * Retry configuration defaults
 */
const DEFAULT_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,      // 1 second
  maxDelay: 10000,      // 10 seconds
  backoffMultiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']
};

/**
 * Circuit breaker state per service
 */
const circuitBreakers = new Map();

/**
 * Check if error is retryable
 */
function isRetryable(error, config) {
  // Check HTTP status codes
  if (error.response?.status && config.retryableStatuses.includes(error.response.status)) {
    return true;
  }
  // Check network errors
  if (error.code && config.retryableErrors.includes(error.code)) {
    return true;
  }
  // Rate limit errors
  if (error.response?.status === 429) {
    return true;
  }
  return false;
}

/**
 * Get circuit breaker state for a service
 */
function getCircuitBreaker(serviceName) {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, {
      failures: 0,
      lastFailure: null,
      isOpen: false,
      cooldownUntil: null
    });
  }
  return circuitBreakers.get(serviceName);
}

/**
 * Record failure for circuit breaker
 */
function recordFailure(serviceName, error) {
  const breaker = getCircuitBreaker(serviceName);
  breaker.failures++;
  breaker.lastFailure = Date.now();

  // Open circuit after 5 consecutive failures
  if (breaker.failures >= 5) {
    breaker.isOpen = true;
    breaker.cooldownUntil = Date.now() + 60000; // 1 minute cooldown
    logger.warn(`[CircuitBreaker] ${serviceName} circuit OPEN - too many failures`);
  }
}

/**
 * Record success - reset circuit breaker
 */
function recordSuccess(serviceName) {
  const breaker = getCircuitBreaker(serviceName);
  breaker.failures = 0;
  breaker.isOpen = false;
  breaker.cooldownUntil = null;
}

/**
 * Check if circuit is open
 */
function isCircuitOpen(serviceName) {
  const breaker = getCircuitBreaker(serviceName);

  // Check if cooldown has passed
  if (breaker.isOpen && breaker.cooldownUntil && Date.now() > breaker.cooldownUntil) {
    breaker.isOpen = false;
    breaker.failures = 0;
    logger.info(`[CircuitBreaker] ${serviceName} circuit CLOSED - cooldown passed`);
  }

  return breaker.isOpen;
}

/**
 * Execute function with retry logic and circuit breaker
 *
 * @param {string} serviceName - Name for logging and circuit breaker
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Override default config
 * @returns {Promise} - Result of fn or throws after all retries fail
 */
export async function withRetry(serviceName, fn, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  // Check circuit breaker
  if (isCircuitOpen(serviceName)) {
    throw new Error(`${serviceName} circuit breaker is OPEN - service temporarily unavailable`);
  }

  let lastError;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(serviceName);
      return result;
    } catch (error) {
      lastError = error;

      // Check if this is a quota exceeded error - don't retry these
      if (error.message?.includes('quota') || error.response?.data?.detail?.status === 'quota_exceeded') {
        recordFailure(serviceName, error);
        throw error; // Fast fail on quota errors
      }

      // Check if retryable
      if (!isRetryable(error, config) || attempt === config.maxRetries) {
        recordFailure(serviceName, error);
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1) + Math.random() * 500,
        config.maxDelay
      );

      logger.warn(`[${serviceName}] Attempt ${attempt}/${config.maxRetries} failed, retrying in ${delay}ms: ${error.message}`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Batch retry helper - retry a batch of operations, collecting successes and failures
 */
export async function withBatchRetry(serviceName, items, processFn, options = {}) {
  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const result = await withRetry(serviceName, () => processFn(item), options);
      results.push({ item, result, success: true });
    } catch (error) {
      errors.push({ item, error, success: false });
    }
  }

  return { results, errors, allSuccessful: errors.length === 0 };
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus() {
  const status = {};
  for (const [name, breaker] of circuitBreakers) {
    status[name] = {
      failures: breaker.failures,
      isOpen: breaker.isOpen,
      cooldownRemaining: breaker.cooldownUntil ? Math.max(0, breaker.cooldownUntil - Date.now()) : 0
    };
  }
  return status;
}

/**
 * Reset circuit breaker for a service (admin use)
 */
export function resetCircuitBreaker(serviceName) {
  if (circuitBreakers.has(serviceName)) {
    circuitBreakers.delete(serviceName);
    logger.info(`[CircuitBreaker] ${serviceName} manually reset`);
  }
}

export default { withRetry, withBatchRetry, getCircuitBreakerStatus, resetCircuitBreaker };
