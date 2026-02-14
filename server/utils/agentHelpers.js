/**
 * Agent Helpers - Shared utilities for LLM agents
 * Consolidates common patterns across dialogue, voice, emotion, and other agents
 */

import { logger } from './logger.js';

/**
 * Parse traits_json from a character object
 * Handles both string and object formats consistently
 *
 * @param {object} character - Character object with traits_json field
 * @returns {object} Parsed traits object with fallback to empty object
 */
export function parseCharacterTraits(character) {
  if (!character?.traits_json) {
    return {};
  }

  try {
    let parsed = character.traits_json;

    // If it's a JSON string, parse it
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Plain string like "calm, wise, bold" - treat as comma-separated trait list
        return { traits: parsed.split(',').map(t => t.trim()).filter(Boolean) };
      }
    }

    // If it's an array, wrap it in an object for consistent access
    if (Array.isArray(parsed)) {
      return { traits: parsed };
    }

    // Object - return as-is (may have .personality, .traits, etc.)
    return parsed;
  } catch (error) {
    logger.warn(`[AgentHelpers] Failed to parse traits for ${character.name}:`, error.message);
    return {};
  }
}

/**
 * Build character context string for LLM prompts
 * Standardized format across all dialogue/voice agents
 *
 * @param {Array} characters - Array of character objects
 * @param {object} options - Configuration options
 * @param {boolean} options.includeGender - Include gender in context (default: true)
 * @param {boolean} options.includeTraits - Include personality traits (default: true)
 * @param {boolean} options.includeVoice - Include voice description (default: false)
 * @returns {string} Formatted character context
 */
export function buildCharacterContext(characters, options = {}) {
  const {
    includeGender = true,
    includeTraits = true,
    includeVoice = false
  } = options;

  if (!characters || characters.length === 0) {
    return 'No characters defined.';
  }

  return characters.map(char => {
    const traits = parseCharacterTraits(char);
    const parts = [`**${char.name}**`];

    if (char.role) {
      parts.push(`(${char.role})`);
    }

    if (includeGender && char.gender) {
      parts.push(`- Gender: ${char.gender}`);
    }

    if (char.description) {
      parts.push(`- ${char.description}`);
    }

    if (includeTraits) {
      const traitList = traits.personality || traits.traits || [];
      if (traitList.length > 0) {
        parts.push(`- Traits: ${traitList.join(', ')}`);
      }
    }

    if (includeVoice && char.voice_description) {
      parts.push(`- Voice: ${char.voice_description}`);
    }

    return parts.join(' ');
  }).join('\n');
}

// NOTE: parseLLMJsonResponse was REMOVED (dead code - never called)
// Use parseJsonResponse from services/openai.js instead - it's the robust, well-tested implementation

/**
 * Validate required fields in parsed JSON response
 *
 * @param {object} data - Parsed JSON data
 * @param {Array<string>} requiredFields - List of required field names
 * @param {string} agentName - Agent name for logging
 * @returns {boolean} True if all required fields present
 */
export function validateResponseFields(data, requiredFields, agentName = 'Agent') {
  if (!data) {
    logger.warn(`[${agentName}] No data to validate`);
    return false;
  }

  const missingFields = requiredFields.filter(field => !(field in data));

  if (missingFields.length > 0) {
    logger.warn(`[${agentName}] Missing required fields: ${missingFields.join(', ')}`);
    return false;
  }

  return true;
}

/**
 * Create standardized error response for agent failures
 *
 * @param {Error} error - Original error
 * @param {string} agentName - Agent name
 * @param {object} context - Additional context for debugging
 * @returns {object} Standardized error response
 */
export function createAgentError(error, agentName, context = {}) {
  logger.error(`[${agentName}] Error:`, error.message, context);

  return {
    success: false,
    error: error.message,
    agent: agentName,
    timestamp: new Date().toISOString(),
    context
  };
}

// extractDialogueSegments was REMOVED - dead code, never called
// Use dialogueSegmentUtils.js for dialogue parsing instead

export default {
  parseCharacterTraits,
  buildCharacterContext,
  // parseLLMJsonResponse was REMOVED - use parseJsonResponse from services/openai.js
  validateResponseFields,
  createAgentError
  // extractDialogueSegments was REMOVED - use dialogueSegmentUtils.js
};
