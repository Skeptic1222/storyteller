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
    if (typeof character.traits_json === 'string') {
      return JSON.parse(character.traits_json);
    }
    return character.traits_json;
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

/**
 * Parse JSON response from LLM
 * Handles markdown code blocks, raw JSON, and various error cases
 *
 * @param {string} content - Raw LLM response content
 * @param {string} agentName - Agent name for logging
 * @returns {object|null} Parsed JSON or null on failure
 */
export function parseLLMJsonResponse(content, agentName = 'Agent') {
  if (!content) {
    logger.warn(`[${agentName}] Empty response content`);
    return null;
  }

  try {
    // Try direct JSON parse first
    return JSON.parse(content);
  } catch (directError) {
    // Try extracting from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (blockError) {
        logger.warn(`[${agentName}] Failed to parse JSON from code block:`, blockError.message);
      }
    }

    // Try finding JSON object/array in content
    const objectMatch = content.match(/\{[\s\S]*\}/);
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = objectMatch?.[0] || arrayMatch?.[0];

    if (jsonStr) {
      try {
        return JSON.parse(jsonStr);
      } catch (extractError) {
        logger.warn(`[${agentName}] Failed to parse extracted JSON:`, extractError.message);
      }
    }

    logger.error(`[${agentName}] Could not parse JSON from response:`, content.substring(0, 200));
    return null;
  }
}

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

/**
 * Extract dialogue segments from text
 * Shared utility for dialogue attribution and tagging agents
 *
 * @param {string} text - Text containing dialogue
 * @returns {Array} Array of {text, isDialogue, startIndex, endIndex}
 */
export function extractDialogueSegments(text) {
  const segments = [];
  let currentIndex = 0;

  // Match quoted dialogue (both single and double quotes)
  const dialogueRegex = /["']([^"']+)["']/g;
  let match;

  while ((match = dialogueRegex.exec(text)) !== null) {
    // Add narration before this dialogue
    if (match.index > currentIndex) {
      segments.push({
        text: text.slice(currentIndex, match.index),
        isDialogue: false,
        startIndex: currentIndex,
        endIndex: match.index
      });
    }

    // Add the dialogue
    segments.push({
      text: match[0],
      dialogueText: match[1],
      isDialogue: true,
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });

    currentIndex = match.index + match[0].length;
  }

  // Add remaining narration
  if (currentIndex < text.length) {
    segments.push({
      text: text.slice(currentIndex),
      isDialogue: false,
      startIndex: currentIndex,
      endIndex: text.length
    });
  }

  return segments;
}

export default {
  parseCharacterTraits,
  buildCharacterContext,
  parseLLMJsonResponse,
  validateResponseFields,
  createAgentError,
  extractDialogueSegments
};
