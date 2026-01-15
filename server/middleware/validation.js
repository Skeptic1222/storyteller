/**
 * Input Validation Middleware
 * Zod-based validation with XSS protection
 *
 * Usage:
 *   import { validateBody, schemas } from '../middleware/validation.js';
 *   router.post('/start', validateBody(schemas.storyStart), handler);
 */

import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { ValidationError } from './errorHandler.js';

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Strict sanitization config - removes all HTML
const STRICT_SANITIZE_CONFIG = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'recursiveEscape'
};

// Lenient config for user content that may contain basic formatting
const BASIC_SANITIZE_CONFIG = {
  allowedTags: ['b', 'i', 'em', 'strong', 'br'],
  allowedAttributes: {},
  disallowedTagsMode: 'recursiveEscape'
};

/**
 * Validate that a value is a valid UUID v4
 */
export function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate that a value is a non-empty string
 */
export function isNonEmptyString(value, maxLength = 10000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/**
 * Validate that a value is a safe integer within range
 */
export function isValidInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Validate that a value is one of allowed values
 */
export function isOneOf(value, allowedValues) {
  return allowedValues.includes(value);
}

/**
 * Sanitize string input - remove potential XSS vectors
 * Uses sanitize-html for comprehensive protection against:
 * - Script injection
 * - Event handler injection
 * - CSS injection
 * - javascript: URLs
 * - data: URLs with scripts
 *
 * @param {string} value - Input string to sanitize
 * @param {object} options - Optional config override
 * @returns {string} - Sanitized string
 */
export function sanitizeString(value, options = {}) {
  if (typeof value !== 'string') return '';

  const config = options.allowBasicFormatting
    ? BASIC_SANITIZE_CONFIG
    : STRICT_SANITIZE_CONFIG;

  return sanitizeHtml(value, config)
    .trim()
    .substring(0, options.maxLength || 10000);
}

/**
 * Sanitize for plain text contexts (story prompts, messages)
 * Strips ALL HTML - for content that should never have formatting
 */
export function sanitizeText(value, maxLength = 10000) {
  if (typeof value !== 'string') return '';
  return sanitizeHtml(value, STRICT_SANITIZE_CONFIG)
    .trim()
    .substring(0, maxLength);
}

/**
 * Validate session ID parameter
 */
export function validateSessionId(req, res, next) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }

  next();
}

/**
 * Validate user ID parameter
 */
export function validateUserId(req, res, next) {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  if (!isValidUUID(userId)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  next();
}

/**
 * Validate story start request body
 */
export function validateStoryStart(req, res, next) {
  const { mode, config } = req.body;

  // Validate mode if provided
  if (mode && !isOneOf(mode, ['storytime', 'advanced', 'quick'])) {
    return res.status(400).json({ error: 'Invalid mode. Must be: storytime, advanced, or quick' });
  }

  // Validate config is an object if provided
  if (config && (typeof config !== 'object' || Array.isArray(config))) {
    return res.status(400).json({ error: 'Config must be an object' });
  }

  next();
}

/**
 * Validate choice submission
 */
export function validateChoice(req, res, next) {
  const { choice_id, choice_key } = req.body;

  if (!choice_id && !choice_key) {
    return res.status(400).json({ error: 'choice_id or choice_key is required' });
  }

  if (choice_id && !isValidUUID(choice_id)) {
    return res.status(400).json({ error: 'Invalid choice_id format' });
  }

  if (choice_key && !isOneOf(choice_key.toUpperCase(), ['A', 'B', 'C', 'D'])) {
    return res.status(400).json({ error: 'Invalid choice_key. Must be: A, B, C, or D' });
  }

  next();
}

/**
 * Validate conversation message
 */
export function validateConversation(req, res, next) {
  const { message, transcript } = req.body;
  const content = message || transcript;

  if (!content) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  if (!isNonEmptyString(content, 5000)) {
    return res.status(400).json({ error: 'Message must be a non-empty string under 5000 characters' });
  }

  // Sanitize the message
  req.body.message = sanitizeString(content);
  req.body.transcript = sanitizeString(content);

  next();
}

/**
 * Validate voice preview request
 */
export function validateVoicePreview(req, res, next) {
  const { voice_id, text } = req.body;

  if (!voice_id) {
    return res.status(400).json({ error: 'voice_id is required' });
  }

  if (!isNonEmptyString(voice_id, 100)) {
    return res.status(400).json({ error: 'Invalid voice_id' });
  }

  if (text && !isNonEmptyString(text, 500)) {
    return res.status(400).json({ error: 'Preview text must be under 500 characters' });
  }

  next();
}

/**
 * Validate pagination parameters
 */
export function validatePagination(req, res, next) {
  const { page, limit } = req.query;

  if (page && !isValidInteger(page, 1, 1000)) {
    return res.status(400).json({ error: 'Page must be a positive integer (max 1000)' });
  }

  if (limit && !isValidInteger(limit, 1, 100)) {
    return res.status(400).json({ error: 'Limit must be between 1 and 100' });
  }

  // Set defaults
  req.query.page = parseInt(page, 10) || 1;
  req.query.limit = parseInt(limit, 10) || 20;

  next();
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

// Common schemas
const uuidSchema = z.string().uuid('Invalid UUID format');

export const schemas = {
  // UUID validation
  uuid: uuidSchema,

  // Session ID in params
  sessionIdParam: z.object({
    id: uuidSchema,
    sessionId: uuidSchema.optional()
  }).partial().refine(data => data.id || data.sessionId, {
    message: 'Session ID is required'
  }),

  // Pagination
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  }),

  // Story start
  storyStart: z.object({
    mode: z.enum(['storytime', 'advanced', 'quick', 'cyoa', 'conversation', 'campaign']).default('storytime'),
    config: z.object({
      genre: z.string().max(100).optional(),
      themes: z.array(z.string().max(50)).max(10).optional(),
      audience: z.enum(['children', 'young_adult', 'adult', 'all_ages', 'general', 'mature']).optional(),
      length: z.enum(['short', 'medium', 'long', 'epic']).optional(),
      voice_id: z.string().max(50).optional(),
      narrator_style: z.string().max(50).optional(),
      author_style: z.string().max(50).optional(),
      multi_voice: z.boolean().optional(),
      hide_speech_tags: z.boolean().optional(),
      sfx_enabled: z.boolean().optional(),
      autoplay: z.boolean().optional(),
      bedtime_mode: z.boolean().optional(),
      cyoa_enabled: z.boolean().optional(),
      custom_prompt: z.string().max(2000).optional()
    }).passthrough().default({}),
    cyoa_enabled: z.boolean().default(false),
    bedtime_mode: z.boolean().default(false),
    storyBibleContext: z.any().nullable().optional()
  }).passthrough(),

  // Choice submission
  storyChoice: z.object({
    session_id: uuidSchema,
    choice_key: z.string().min(1).max(50),
    choice_text: z.string().max(500).optional(),
    from_recording: z.boolean().optional(),
    diverge_at_segment: z.number().int().min(0).optional()
  }),

  // Continue story
  storyContinue: z.object({
    session_id: uuidSchema,
    voice_id: z.string().max(50).optional(),
    autoplay: z.boolean().optional()
  }),

  // Backtrack
  storyBacktrack: z.object({
    scene_id: uuidSchema,
    scene_index: z.number().int().min(0)
  }),

  // Library progress
  libraryProgress: z.object({
    scene_id: uuidSchema.nullable().optional(),
    scene_index: z.number().int().min(0),
    reading_time: z.number().int().min(0).max(3600).default(0)
  }),

  // Voice preview
  voicePreview: z.object({
    voice_id: z.string().min(1).max(50),
    text: z.string().min(1).max(500).optional()
  }),

  // Config update
  configUpdate: z.object({
    voice_id: z.string().max(50).optional(),
    narrator_style: z.string().max(50).optional(),
    sfx_enabled: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    multi_voice: z.boolean().optional()
  }).passthrough(),

  // Smart interpret
  smartInterpret: z.object({
    prompt: z.string().min(1).max(2000),
    context: z.any().optional()
  }),

  // Lorebook entry
  lorebookEntry: z.object({
    name: z.string().min(1).max(100),
    content: z.string().min(1).max(5000),
    keywords: z.array(z.string().max(50)).max(20).optional(),
    category: z.enum(['character', 'location', 'item', 'event', 'lore', 'other']).default('other'),
    priority: z.number().int().min(0).max(100).default(50)
  }),

  // Share create
  shareCreate: z.object({
    session_id: uuidSchema,
    is_public: z.boolean().default(false),
    allow_comments: z.boolean().default(true)
  }),

  // D&D dice roll
  diceRoll: z.object({
    dice: z.string().regex(/^\d+d\d+([+-]\d+)?$/, 'Invalid dice notation'),
    advantage: z.boolean().optional(),
    disadvantage: z.boolean().optional()
  })
};

// =============================================================================
// ZOD VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Validate request body with Zod schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        next(new ValidationError('Invalid request body', details));
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate URL params with Zod schema
 */
export function validateParams(schema) {
  return (req, res, next) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        next(new ValidationError('Invalid URL parameters', details));
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate query string with Zod schema
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        next(new ValidationError('Invalid query parameters', details));
      } else {
        next(error);
      }
    }
  };
}

export default {
  // Legacy validators
  isValidUUID,
  isNonEmptyString,
  isValidInteger,
  isOneOf,
  sanitizeString,
  sanitizeText,
  validateSessionId,
  validateUserId,
  validateStoryStart,
  validateChoice,
  validateConversation,
  validateVoicePreview,
  validatePagination,
  // Zod validators
  schemas,
  validateBody,
  validateParams,
  validateQuery
};
