/**
 * Input Validation Middleware
 * Lightweight validation without external dependencies
 */

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 */
export function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim()
    .substring(0, 10000); // Limit length
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

export default {
  isValidUUID,
  isNonEmptyString,
  isValidInteger,
  isOneOf,
  sanitizeString,
  validateSessionId,
  validateUserId,
  validateStoryStart,
  validateChoice,
  validateConversation,
  validateVoicePreview,
  validatePagination
};
