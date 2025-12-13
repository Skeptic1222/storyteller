/**
 * Prompt Security Utilities
 * Prevents prompt injection attacks by sanitizing user input before embedding in LLM prompts
 */

import { logger } from './logger.js';

/**
 * Dangerous patterns that could manipulate prompt behavior
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?|prompts?)/gi,
  /disregard\s+(all\s+)?(previous|above|prior)/gi,
  /forget\s+(everything|all|your)\s+(instructions?|rules?)/gi,
  /you\s+are\s+now\s+(a|an)\s+/gi,
  /new\s+instructions?:/gi,
  /system\s*:\s*/gi,
  /\[system\]/gi,
  /\[assistant\]/gi,
  /\[user\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /```\s*(system|assistant)/gi,
  /roleplay\s+as/gi,
  /pretend\s+(you('re|'re| are)|to\s+be)/gi,
  /act\s+as\s+(if\s+you('re|'re| are)|a|an)/gi,
];

/**
 * Escape special characters that could break prompt structure
 */
function escapePromptDelimiters(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/"""/g, '\\"\\"\\"')  // Escape triple quotes
    .replace(/```/g, '\\`\\`\\`')   // Escape code blocks
    .replace(/\${/g, '\\${')        // Escape template literals
    .replace(/\n{3,}/g, '\n\n');    // Limit consecutive newlines
}

/**
 * Remove or neutralize injection attempts
 */
function neutralizeInjections(text) {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text;

  // Check for and log injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      logger.warn(`[PromptSecurity] Potential injection detected: ${pattern.toString()}`);
      // Replace the injection attempt with a harmless placeholder
      sanitized = sanitized.replace(pattern, '[filtered]');
    }
  }

  return sanitized;
}

/**
 * Limit input length to prevent token exhaustion attacks
 */
function limitLength(text, maxLength = 2000) {
  if (!text || typeof text !== 'string') return '';

  if (text.length > maxLength) {
    logger.warn(`[PromptSecurity] Input truncated from ${text.length} to ${maxLength} chars`);
    return text.substring(0, maxLength) + '...';
  }

  return text;
}

/**
 * Main sanitization function - use this for all user input going into prompts
 *
 * @param {string} input - Raw user input
 * @param {Object} options - Configuration options
 * @param {number} options.maxLength - Maximum allowed length (default: 2000)
 * @param {boolean} options.strict - Enable strict mode with more aggressive filtering
 * @returns {string} Sanitized input safe for prompt embedding
 */
export function sanitizeForPrompt(input, options = {}) {
  const { maxLength = 2000, strict = false } = options;

  if (!input || typeof input !== 'string') {
    return '';
  }

  // Trim whitespace
  let sanitized = input.trim();

  // Limit length first
  sanitized = limitLength(sanitized, maxLength);

  // Neutralize injection attempts
  sanitized = neutralizeInjections(sanitized);

  // Escape delimiters
  sanitized = escapePromptDelimiters(sanitized);

  // In strict mode, remove any remaining special characters
  if (strict) {
    sanitized = sanitized
      .replace(/[<>[\]{}|\\^`]/g, '') // Remove shell-like special chars
      .replace(/\s+/g, ' ');          // Normalize whitespace
  }

  return sanitized;
}

/**
 * Create a safe prompt template with user input
 * Uses XML-style tags to clearly delineate user content
 *
 * @param {string} template - Prompt template with {placeholder} markers
 * @param {Object} values - Key-value pairs of placeholders and their values
 * @returns {string} Safe prompt with user content clearly marked
 */
export function buildSafePrompt(template, values = {}) {
  let prompt = template;

  for (const [key, rawValue] of Object.entries(values)) {
    const value = sanitizeForPrompt(String(rawValue));
    // Wrap user content in clear XML-style tags
    const safeValue = `<user_input name="${key}">\n${value}\n</user_input>`;
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }

  return prompt;
}

/**
 * Validate that a string looks like expected content type
 */
export function validateContentType(input, expectedType) {
  if (!input) return false;

  switch (expectedType) {
    case 'story_prompt':
      // Should be natural language, not code or commands
      return !/^[\s]*[{[\/<]/.test(input) && input.length > 3;

    case 'character_name':
      // Alphanumeric with spaces, apostrophes, hyphens
      return /^[\w\s'\-]+$/.test(input) && input.length <= 100;

    case 'genre':
      // Simple word or short phrase
      return /^[\w\s]+$/.test(input) && input.length <= 50;

    default:
      return true;
  }
}

export default { sanitizeForPrompt, buildSafePrompt, validateContentType };
