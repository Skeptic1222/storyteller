/**
 * Socket.IO Input Validation Middleware
 * Validates incoming socket events before they reach handlers
 */

import { logger } from '../utils/logger.js';
import { sanitizeText } from '../middleware/validation.js';

// UUID v4 regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Event validation schemas
 * Each key is an event name, value is a validation function
 * Returns { valid: boolean, error?: string, sanitized?: object }
 */
const eventSchemas = {
  'join-session': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    const userId = data.userId || data.user_id;

    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid session_id format' };
    }
    return {
      valid: true,
      sanitized: {
        // Return both formats for compatibility
        sessionId: sessionId,
        session_id: sessionId,
        userId: userId && UUID_REGEX.test(userId) ? userId : null,
        user_id: userId && UUID_REGEX.test(userId) ? userId : null
      }
    };
  },

  'rejoin-session': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid session_id format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId,
        session_id: sessionId
      }
    };
  },

  'leave-session': () => ({ valid: true }),

  'join-room': (data) => {
    if (typeof data !== 'string' || !UUID_REGEX.test(data)) {
      return { valid: false, error: 'Invalid room ID format' };
    }
    return { valid: true, sanitized: data };
  },

  'leave-room': (data) => {
    if (typeof data !== 'string' || !UUID_REGEX.test(data)) {
      return { valid: false, error: 'Invalid room ID format' };
    }
    return { valid: true, sanitized: data };
  },

  'start-extraction': (data) => {
    if (typeof data !== 'string' || !UUID_REGEX.test(data)) {
      return { valid: false, error: 'Invalid room ID format' };
    }
    return { valid: true, sanitized: data };
  },

  'client-log': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Sanitize and limit log data
    return {
      valid: true,
      sanitized: {
        level: ['debug', 'info', 'warn', 'error'].includes(data.level) ? data.level : 'info',
        message: sanitizeText(String(data.message || ''), 1000),
        context: data.context ? sanitizeText(JSON.stringify(data.context).substring(0, 500)) : null
      }
    };
  },

  'voice-input': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    // transcript can be empty for voice-only input
    return {
      valid: true,
      sanitized: {
        sessionId: sessionId,
        session_id: sessionId,
        transcript: data.transcript ? sanitizeText(String(data.transcript), 5000) : '',
        audio: data.audio, // Audio buffer, validated by type
        confidence: Number.isFinite(data.confidence) ? Math.max(0, Math.min(1, data.confidence)) : null
      }
    };
  },

  'continue-story': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId: sessionId,
        session_id: sessionId,
        direction: data.direction ? sanitizeText(String(data.direction), 1000) : null,
        voice_id: data.voice_id || data.voiceId || null,
        autoplay: data.autoplay === true
      }
    };
  },

  'start-playback': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId: sessionId,
        session_id: sessionId
      }
    };
  },

  'cancel-launch-sequence': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'confirm-ready': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'check-ready': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId, session_id: sessionId } };
  },

  'retry-stage': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    const validStages = ['voices', 'sfx', 'cover', 'qa', 'audio'];
    if (!data.stage || !validStages.includes(data.stage)) {
      return { valid: false, error: `Invalid stage. Must be one of: ${validStages.join(', ')}` };
    }
    return {
      valid: true,
      sanitized: {
        sessionId: sessionId,
        session_id: sessionId,
        stage: data.stage
      }
    };
  },

  'regenerate-cover': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'regenerate-synopsis': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'regenerate-sfx': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'regenerate-voices': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'cancel-playback': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'submit-choice': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    // Choice can be ID or key (A, B, C, D)
    const choiceKey = data.choice_key || data.choiceKey;
    const choiceId = data.choice_id || data.choiceId;

    if (!choiceKey && !choiceId) {
      return { valid: false, error: 'choice_key or choice_id required' };
    }
    if (choiceKey && !['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd'].includes(choiceKey)) {
      return { valid: false, error: 'Invalid choice_key. Must be A, B, C, or D' };
    }
    if (choiceId && !UUID_REGEX.test(choiceId)) {
      return { valid: false, error: 'Invalid choice_id format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId: sessionId,
        session_id: sessionId,
        choice_key: choiceKey ? choiceKey.toUpperCase() : null,
        choice_id: choiceId || null,
        from_recording: data.from_recording === true,
        diverge_at_segment: Number.isInteger(data.diverge_at_segment) ? data.diverge_at_segment : null
      }
    };
  },

  'request-picture-book-images': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    const sessionId = data.sessionId || data.session_id;
    const sceneId = data.sceneId || data.scene_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    if (!sceneId || !UUID_REGEX.test(sceneId)) {
      return { valid: false, error: 'Invalid scene_id format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId,
        session_id: sessionId,
        sceneId,
        scene_id: sceneId
      }
    };
  },

  'request-scene-audio': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    const sessionId = data.sessionId || data.session_id;
    const sceneId = data.sceneId || data.scene_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    if (sceneId && !UUID_REGEX.test(sceneId)) {
      return { valid: false, error: 'Invalid scene_id format' };
    }
    return {
      valid: true,
      sanitized: {
        sessionId,
        session_id: sessionId,
        sceneId: sceneId || null,
        scene_id: sceneId || null
      }
    };
  },

  'pause-story': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  },

  'resume-story': (data) => {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Data must be an object' };
    }
    // Support both snake_case and camelCase
    const sessionId = data.sessionId || data.session_id;
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
      return { valid: false, error: 'Invalid sessionId format' };
    }
    return { valid: true, sanitized: { sessionId: sessionId, session_id: sessionId } };
  }
};

/**
 * Validate socket event data
 * @param {string} event - Event name
 * @param {any} data - Event data
 * @returns {{ valid: boolean, error?: string, sanitized?: any }}
 */
export function validateSocketEvent(event, data) {
  const validator = eventSchemas[event];

  if (!validator) {
    // Unknown events pass through (may be handled by other middleware)
    // Log for monitoring
    logger.debug(`[SocketValidation] Unknown event type: ${event}`);
    return { valid: true, sanitized: data };
  }

  try {
    return validator(data);
  } catch (error) {
    logger.error(`[SocketValidation] Validation error for ${event}:`, error);
    return { valid: false, error: 'Validation failed' };
  }
}

/**
 * Create Socket.IO middleware that validates all events
 * @param {Socket} socket - Socket.IO socket instance
 */
export function createValidationMiddleware(socket) {
  const originalOn = socket.on.bind(socket);

  socket.on = function(event, handler) {
    // Skip internal Socket.IO events
    if (event === 'disconnect' || event === 'error' || event === 'connect') {
      return originalOn(event, handler);
    }

    return originalOn(event, async (data, ...args) => {
      // SECURITY FIX: Apply rate limiting before validation
      if (!checkRateLimit(socket, event)) {
        logger.warn(`[SocketValidation] Rate limited ${event} from socket ${socket.id}`);
        socket.emit('rate-limited', {
          event,
          error: 'Too many requests. Please slow down.',
          retryAfter: rateLimitConfig[event]?.windowMs || rateLimitConfig.default.windowMs
        });
        return;
      }

      const result = validateSocketEvent(event, data);

      if (!result.valid) {
        logger.warn(`[SocketValidation] Rejected ${event}: ${result.error}`);
        socket.emit('validation-error', {
          event,
          error: result.error
        });
        return;
      }

      // Call handler with sanitized data
      try {
        await handler(result.sanitized || data, ...args);
      } catch (error) {
        logger.error(`[SocketHandler] Error in ${event}:`, error);
        socket.emit('error', {
          event,
          message: 'Internal server error'
        });
      }
    });
  };
}

/**
 * Rate limiting state per socket
 */
const socketRateLimits = new WeakMap();

/**
 * Rate limit configuration per event type
 */
const rateLimitConfig = {
  'voice-input': { maxRequests: 10, windowMs: 1000 },
  'continue-story': { maxRequests: 5, windowMs: 5000 },
  'submit-choice': { maxRequests: 10, windowMs: 5000 },
  'request-scene-audio': { maxRequests: 10, windowMs: 5000 },
  'request-picture-book-images': { maxRequests: 10, windowMs: 10000 },
  'regenerate-cover': { maxRequests: 3, windowMs: 30000 },
  'regenerate-synopsis': { maxRequests: 3, windowMs: 30000 },
  'regenerate-sfx': { maxRequests: 3, windowMs: 30000 },
  'regenerate-voices': { maxRequests: 3, windowMs: 30000 },
  'client-log': { maxRequests: 50, windowMs: 10000 },
  'default': { maxRequests: 30, windowMs: 10000 }
};

/**
 * Check if socket event should be rate limited
 * @param {Socket} socket - Socket.IO socket
 * @param {string} event - Event name
 * @returns {boolean} - true if should allow, false if rate limited
 */
export function checkRateLimit(socket, event) {
  let limits = socketRateLimits.get(socket);
  if (!limits) {
    limits = {};
    socketRateLimits.set(socket, limits);
  }

  const config = rateLimitConfig[event] || rateLimitConfig.default;
  const now = Date.now();
  const key = event;

  if (!limits[key]) {
    limits[key] = { requests: [], windowStart: now };
  }

  const bucket = limits[key];

  // Remove old requests outside window
  bucket.requests = bucket.requests.filter(t => now - t < config.windowMs);

  if (bucket.requests.length >= config.maxRequests) {
    logger.warn(`[RateLimit] Socket ${socket.id} rate limited on ${event}`);
    return false;
  }

  bucket.requests.push(now);
  return true;
}

export default {
  validateSocketEvent,
  createValidationMiddleware,
  checkRateLimit
};
