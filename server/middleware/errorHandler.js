/**
 * Centralized Error Handling Middleware
 * Provides consistent error responses across all routes.
 */

import { logger } from '../utils/logger.js';

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

/**
 * External service error (502)
 */
export class ExternalServiceError extends AppError {
  constructor(service, message = 'External service error') {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database error') {
    super(message, 500, 'DATABASE_ERROR');
  }
}

// =============================================================================
// ERROR HANDLER MIDDLEWARE
// =============================================================================

/**
 * Format error response
 */
function formatErrorResponse(err, includeStack = false) {
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    }
  };

  // Add validation details if present
  if (err.details) {
    response.error.details = err.details;
  }

  // Add retry-after for rate limits
  if (err.retryAfter) {
    response.error.retryAfter = err.retryAfter;
  }

  // Add stack trace in development
  if (includeStack && err.stack) {
    response.error.stack = err.stack;
  }

  return response;
}

/**
 * Main error handler middleware
 */
export function errorHandler(err, req, res, next) {
  // Default to 500 if no status code
  err.statusCode = err.statusCode || 500;

  // Log error
  const logData = {
    method: req.method,
    path: req.path,
    statusCode: err.statusCode,
    code: err.code,
    message: err.message,
    userId: req.user?.id || 'anonymous',
    ip: req.ip
  };

  if (err.statusCode >= 500) {
    logger.error('[ErrorHandler]', logData, err.stack);
  } else if (err.statusCode >= 400) {
    logger.warn('[ErrorHandler]', logData);
  }

  // Don't expose internal errors in production
  const isDev = process.env.NODE_ENV === 'development';
  const isOperational = err.isOperational === true;

  // For non-operational errors in production, send generic message
  if (!isOperational && !isDev) {
    err.message = 'An unexpected error occurred';
    err.code = 'INTERNAL_ERROR';
  }

  // Set rate limit header if applicable
  if (err.retryAfter) {
    res.set('Retry-After', err.retryAfter);
  }

  // Send response
  res.status(err.statusCode).json(formatErrorResponse(err, isDev));
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req, res, next) {
  next(new NotFoundError('Endpoint'));
}

/**
 * Async handler wrapper - catches async errors
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Wrap all routes in a router with async error handling
 */
export function wrapRoutes(router) {
  const originalGet = router.get.bind(router);
  const originalPost = router.post.bind(router);
  const originalPut = router.put.bind(router);
  const originalPatch = router.patch.bind(router);
  const originalDelete = router.delete.bind(router);

  const wrapHandler = (handler) => {
    if (typeof handler === 'function') {
      return asyncHandler(handler);
    }
    return handler;
  };

  const wrapHandlers = (handlers) => handlers.map(wrapHandler);

  router.get = (path, ...handlers) => originalGet(path, ...wrapHandlers(handlers));
  router.post = (path, ...handlers) => originalPost(path, ...wrapHandlers(handlers));
  router.put = (path, ...handlers) => originalPut(path, ...wrapHandlers(handlers));
  router.patch = (path, ...handlers) => originalPatch(path, ...wrapHandlers(handlers));
  router.delete = (path, ...handlers) => originalDelete(path, ...wrapHandlers(handlers));

  return router;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Assert condition or throw validation error
 */
export function assertValid(condition, message, details = null) {
  if (!condition) {
    throw new ValidationError(message, details);
  }
}

/**
 * Assert resource exists or throw not found
 */
export function assertExists(resource, name = 'Resource') {
  if (!resource) {
    throw new NotFoundError(name);
  }
  return resource;
}

/**
 * Handle database errors
 */
export function handleDbError(err, context = 'Database operation') {
  logger.error(`[DB] ${context}:`, err);

  // PostgreSQL unique violation
  if (err.code === '23505') {
    throw new ValidationError('Duplicate entry', { constraint: err.constraint });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    throw new ValidationError('Referenced record not found', { constraint: err.constraint });
  }

  // PostgreSQL not null violation
  if (err.code === '23502') {
    throw new ValidationError('Required field missing', { column: err.column });
  }

  throw new DatabaseError(`${context} failed`);
}

export default {
  AppError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ExternalServiceError,
  DatabaseError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  wrapRoutes,
  assertValid,
  assertExists,
  handleDbError
};
