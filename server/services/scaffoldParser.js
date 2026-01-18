/**
 * scaffoldParser.js
 *
 * Parses placeholders from OpenAI-generated scaffolds and stitches
 * expanded content back together.
 *
 * Part of the Venice Scaffolding Architecture for explicit content quality.
 */

import { PLACEHOLDER_TYPES } from './prompts/scaffoldPromptTemplates.js';

/**
 * Regex pattern to match all placeholder types
 * Matches: [TYPE: param1=value1, param2=value2, ~Nw]
 */
const PLACEHOLDER_REGEX = /\[([A-Z_]+):\s*([^\]]+)\]/g;

/**
 * Parse a single parameter string into key-value pairs
 * Handles: intensity=85, characters="Alice,Bob", mood="passionate", ~800w
 *
 * @param {string} paramString - The parameter string from inside the placeholder
 * @returns {Object} Parsed parameters
 */
function parseParams(paramString) {
  const params = {};

  // Match key=value pairs (with or without quotes)
  const keyValueRegex = /(\w+)=(?:"([^"]+)"|(\d+))/g;
  let match;

  while ((match = keyValueRegex.exec(paramString)) !== null) {
    const key = match[1];
    const value = match[2] || match[3]; // String value or number

    // Convert numeric strings to numbers
    if (match[3]) {
      params[key] = parseInt(value, 10);
    } else {
      params[key] = value;
    }
  }

  // Match word count hint: ~Nw
  const wordCountMatch = paramString.match(/~(\d+)w/);
  if (wordCountMatch) {
    params.targetWords = parseInt(wordCountMatch[1], 10);
  }

  return params;
}

/**
 * Extract surrounding context for a placeholder
 *
 * @param {string} content - Full content string
 * @param {number} position - Position of the placeholder
 * @param {number} chars - Number of characters to extract on each side
 * @returns {Object} Object with before and after context
 */
function extractContext(content, position, chars = 500) {
  const start = Math.max(0, position - chars);
  const beforeText = content.substring(start, position).trim();

  // Find end of placeholder to get "after" context
  const afterStart = content.indexOf(']', position) + 1;
  const afterEnd = Math.min(content.length, afterStart + chars);
  const afterText = content.substring(afterStart, afterEnd).trim();

  return {
    before: beforeText,
    after: afterText
  };
}

/**
 * Parse all placeholders from scaffolded content
 *
 * @param {string} content - The scaffolded content from OpenAI
 * @returns {Object} Object containing original content and array of parsed placeholders
 */
export function parseScaffold(content) {
  const placeholders = [];
  let match;

  // Reset regex lastIndex for fresh iteration
  PLACEHOLDER_REGEX.lastIndex = 0;

  while ((match = PLACEHOLDER_REGEX.exec(content)) !== null) {
    const type = match[1];
    const paramString = match[2];

    // Validate placeholder type
    if (!Object.values(PLACEHOLDER_TYPES).includes(type)) {
      console.warn(`Unknown placeholder type: ${type}, skipping`);
      continue;
    }

    const placeholder = {
      fullMatch: match[0],
      type: type,
      params: parseParams(paramString),
      position: match.index,
      endPosition: match.index + match[0].length,
      surroundingContext: extractContext(content, match.index, 500)
    };

    placeholders.push(placeholder);
  }

  // Sort by position (should already be in order, but ensure it)
  placeholders.sort((a, b) => a.position - b.position);

  return {
    originalContent: content,
    placeholders,
    hasPlaceholders: placeholders.length > 0
  };
}

/**
 * Stitch expanded content back into the scaffold
 * Replaces from end to start to preserve position indices
 *
 * @param {string} scaffoldContent - Original scaffolded content
 * @param {Array} placeholders - Array of parsed placeholder objects
 * @param {Array} expansions - Array of expanded content strings (same order as placeholders)
 * @returns {string} Final stitched content
 */
export function stitchExpandedContent(scaffoldContent, placeholders, expansions) {
  if (placeholders.length !== expansions.length) {
    throw new Error(`Placeholder count (${placeholders.length}) doesn't match expansion count (${expansions.length})`);
  }

  let result = scaffoldContent;

  // Replace from end to start to preserve earlier positions
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const placeholder = placeholders[i];
    const expansion = expansions[i];

    // Validate expansion exists
    if (!expansion || typeof expansion !== 'string') {
      console.warn(`Missing or invalid expansion for placeholder ${i} (${placeholder.type}), using placeholder text`);
      continue; // Keep original placeholder if expansion failed
    }

    // Clean up the expansion (trim, ensure no leftover markers)
    const cleanedExpansion = cleanExpansion(expansion);

    // Replace placeholder with expanded content
    result = result.substring(0, placeholder.position) +
             cleanedExpansion +
             result.substring(placeholder.endPosition);
  }

  return result;
}

/**
 * Clean up an expansion to ensure it integrates smoothly
 *
 * @param {string} expansion - Raw expansion from Venice
 * @returns {string} Cleaned expansion
 */
function cleanExpansion(expansion) {
  let cleaned = expansion.trim();

  // Remove any accidental placeholder markers Venice might have included
  cleaned = cleaned.replace(/^\[.*?\]\s*/g, '');
  cleaned = cleaned.replace(/\s*\[.*?\]$/g, '');

  // Remove any "OUTPUT:" or similar prefixes Venice might add
  cleaned = cleaned.replace(/^(OUTPUT:|EXPANDED:|CONTENT:)\s*/i, '');

  // Ensure proper sentence spacing
  cleaned = cleaned.replace(/\s+/g, ' ');

  return cleaned;
}

/**
 * Validate that all placeholders were successfully expanded
 *
 * @param {string} content - Content to check
 * @returns {Object} Validation result with any remaining placeholders
 */
export function validateNoPlaceholders(content) {
  PLACEHOLDER_REGEX.lastIndex = 0;
  const remaining = [];
  let match;

  while ((match = PLACEHOLDER_REGEX.exec(content)) !== null) {
    remaining.push({
      type: match[1],
      position: match.index,
      fullMatch: match[0]
    });
  }

  return {
    isValid: remaining.length === 0,
    remainingPlaceholders: remaining
  };
}

/**
 * Group placeholders by type for potential parallel processing optimization
 *
 * @param {Array} placeholders - Array of parsed placeholders
 * @returns {Object} Placeholders grouped by type
 */
export function groupPlaceholdersByType(placeholders) {
  const grouped = {};

  for (const placeholder of placeholders) {
    if (!grouped[placeholder.type]) {
      grouped[placeholder.type] = [];
    }
    grouped[placeholder.type].push(placeholder);
  }

  return grouped;
}

/**
 * Get statistics about placeholders in content
 *
 * @param {Array} placeholders - Parsed placeholders
 * @returns {Object} Statistics about the placeholders
 */
export function getPlaceholderStats(placeholders) {
  const stats = {
    total: placeholders.length,
    byType: {},
    averageIntensity: 0,
    estimatedTotalWords: 0
  };

  let intensitySum = 0;
  let intensityCount = 0;

  for (const p of placeholders) {
    // Count by type
    stats.byType[p.type] = (stats.byType[p.type] || 0) + 1;

    // Sum intensities
    if (p.params.intensity) {
      intensitySum += p.params.intensity;
      intensityCount++;
    }

    // Sum estimated words
    if (p.params.targetWords) {
      stats.estimatedTotalWords += p.params.targetWords;
    }
  }

  if (intensityCount > 0) {
    stats.averageIntensity = Math.round(intensitySum / intensityCount);
  }

  return stats;
}

/**
 * Create a preview of the scaffold with placeholder summaries
 * Useful for debugging and QA
 *
 * @param {string} content - Scaffolded content
 * @param {Array} placeholders - Parsed placeholders
 * @returns {string} Preview with placeholder markers
 */
export function createScaffoldPreview(content, placeholders) {
  let preview = content;

  // Replace placeholders with summary markers (from end to preserve positions)
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const p = placeholders[i];
    const summary = `<<${p.type}@${p.params.intensity}%${p.params.targetWords ? '~' + p.params.targetWords + 'w' : ''}>>`;

    preview = preview.substring(0, p.position) +
              summary +
              preview.substring(p.endPosition);
  }

  return preview;
}

export default {
  parseScaffold,
  stitchExpandedContent,
  validateNoPlaceholders,
  groupPlaceholdersByType,
  getPlaceholderStats,
  createScaffoldPreview
};
