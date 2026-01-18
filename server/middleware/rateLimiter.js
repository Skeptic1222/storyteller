/**
 * Rate Limiting Middleware
 * Centralized rate limiting configurations for different endpoint types.
 *
 * Usage:
 *   import { rateLimiters } from '../middleware/rateLimiter.js';
 *   router.post('/expensive-op', rateLimiters.ai, handler);
 */

import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';

// =============================================================================
// KEY GENERATOR (handles IIS proxy IP:port format)
// =============================================================================

/**
 * Extract client IP from request, handling IIS proxy format
 */
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = forwarded ? forwarded.split(',')[0].trim() : req.ip || 'unknown';
  // Strip port if present (IIS sometimes sends IP:port format)
  return ip.split(':')[0] || ip;
}

/**
 * Generate rate limit key from IP + optional session/user
 */
function createKeyGenerator(includeSession = false) {
  return (req) => {
    const ip = getClientIP(req);
    if (includeSession) {
      const sessionId = req.params.id || req.params.sessionId || req.body?.session_id || '';
      return `${ip}_${sessionId}`;
    }
    return ip;
  };
}

// =============================================================================
// RATE LIMITER CONFIGURATIONS
// =============================================================================

/**
 * Standard API rate limiter
 * 100 requests per minute - for normal API operations
 */
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(false),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] Standard limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * AI/LLM rate limiter
 * 10 requests per minute - for OpenAI API calls
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many AI requests, please wait before trying again' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(false),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] AI limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * Story generation rate limiter
 * 5 requests per 5 minutes - for expensive story generation
 */
export const storyGenerationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: { error: 'Too many story generation requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(false),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] Story generation limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * Image generation rate limiter (DALL-E)
 * 3 requests per 5 minutes - for cover/portrait generation
 */
export const imageGenerationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3,
  message: { error: 'Too many image generation requests. Please wait 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(true), // Include session to allow multiple users
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] Image generation limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * TTS rate limiter (ElevenLabs)
 * 20 requests per minute - for audio generation
 */
export const ttsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many audio generation requests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(true),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] TTS limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * Auth rate limiter
 * 10 requests per 15 minutes - for login/auth attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(false),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] Auth limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

/**
 * Strict rate limiter
 * 3 requests per minute - for very expensive operations
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: { error: 'Rate limit exceeded. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: createKeyGenerator(false),
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (req, res, next, options) => {
    logger.warn(`[RateLimit] Strict limit exceeded for ${getClientIP(req)}`);
    res.status(429).json(options.message);
  }
});

// =============================================================================
// NAMED EXPORT FOR EASY ACCESS
// =============================================================================

export const rateLimiters = {
  standard: standardLimiter,
  ai: aiLimiter,
  storyGeneration: storyGenerationLimiter,
  imageGeneration: imageGenerationLimiter,
  tts: ttsLimiter,
  auth: authLimiter,
  strict: strictLimiter
};

export default rateLimiters;
