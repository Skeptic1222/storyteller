/**
 * JSON Parsing Utilities
 * Extracted from openai.js for reuse across the codebase.
 *
 * Functions:
 * - parseJsonResponse() - Parse JSON from LLM responses with multiple strategies
 * - attemptJsonRepair() - Repair truncated JSON responses
 * - detectJsonTruncation() - Detect if JSON was truncated due to max_tokens
 * - extractFirstJsonObject() - Extract first complete JSON object from text
 */

import { logger } from './logger.js';

/**
 * FAIL LOUD: Detect if JSON response was truncated due to max_tokens limit
 * Returns object with isTruncated boolean and array of reasons
 *
 * @param {string} content - Raw content to check
 * @returns {object} { isTruncated: boolean, reasons: string[], stats: object }
 */
export function detectJsonTruncation(content) {
  const reasons = [];

  // Count brackets to detect unclosed structures
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }

  // Check for unclosed structures
  if (braceCount > 0) {
    reasons.push(`${braceCount} unclosed brace(s) '{'`);
  }
  if (bracketCount > 0) {
    reasons.push(`${bracketCount} unclosed bracket(s) '['`);
  }

  // Check if we're in an unclosed string (odd number of unescaped quotes)
  if (inString) {
    reasons.push('unclosed string (ends inside quotes)');
  }

  // Check for malformed structure (more closing than opening)
  if (braceCount < 0) {
    reasons.push(`${Math.abs(braceCount)} extra closing brace(s) '}'`);
  }
  if (bracketCount < 0) {
    reasons.push(`${Math.abs(bracketCount)} extra closing bracket(s) ']'`);
  }

  // Check for common truncation patterns at end of content
  const lastChars = content.substring(Math.max(0, content.length - 20)).trim();
  const last50 = content.substring(Math.max(0, content.length - 50)).trim();

  // Ends with incomplete key-value (no closing quote or value)
  if (/"\s*:\s*$/.test(lastChars)) {
    reasons.push('ends with incomplete key-value pair');
  }

  // Ends with comma (expecting more content)
  if (/,\s*$/.test(lastChars) && (braceCount > 0 || bracketCount > 0)) {
    reasons.push('ends with comma inside structure');
  }

  // Ends with truncated boolean or null keyword
  // Match partial: tru, fal, fals, nul at end of content
  if (/:\s*(tru|fal|fals|nul)\s*$/i.test(last50)) {
    reasons.push('ends with truncated boolean/null keyword');
  }

  // Ends with backslash (incomplete escape sequence)
  if (/\\$/.test(content)) {
    reasons.push('ends with incomplete escape sequence');
  }

  // Ends with colon followed by whitespace only (value expected)
  if (/:\s*$/.test(lastChars) && !inString) {
    reasons.push('ends after colon with no value');
  }

  // Ends mid-number (digit followed by nothing, inside a structure)
  if (/:\s*-?\d+$/.test(lastChars) && (braceCount > 0 || bracketCount > 0)) {
    // This could be valid (e.g., "count": 5}) but combined with unclosed structure it's suspicious
    // Only flag if there's already evidence of truncation
    if (braceCount > 0 || bracketCount > 0) {
      reasons.push('potentially truncated number value (unclosed structure)');
    }
  }

  return {
    isTruncated: reasons.length > 0,
    reasons,
    stats: { braceCount, bracketCount, inString }
  };
}

/**
 * Extract the first complete JSON object from text using bracket depth tracking
 * This handles cases where LLM adds explanation text after the JSON
 *
 * @param {string} text - Text potentially containing JSON
 * @returns {string|null} Extracted JSON string or null if not found
 */
export function extractFirstJsonObject(text) {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          // Found the matching closing brace
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  // No complete JSON object found (unclosed braces)
  return null;
}

/**
 * Fix multi-line unquoted string values (GPT-5.2 bug)
 * Handles prose fields that span multiple lines without quotes
 * Example: "prose": The story text...\nmore text...\n"dialogue_map": [
 * Fixed:   "prose": "The story text...\nmore text...",\n"dialogue_map": [
 *
 * @param {string} content - JSON content with potentially unquoted multi-line strings
 * @returns {string} Fixed JSON string
 */
export function fixMultiLineUnquotedStrings(content) {
  // Pattern: "prose": followed by unquoted text until the next JSON field
  // Captures: "prose": (unquoted multi-line content) ,"next_field":
  // Uses lazy matching to find the shortest valid capture

  // Match "prose": followed by text that doesn't start with a quote,
  // capturing everything until we hit ,\n"something": pattern
  const prosePattern = /("prose"\s*:\s*)(?!")([^]*?)(\s*,\s*"\w+"\s*:)/;

  const match = content.match(prosePattern);
  if (match) {
    const [fullMatch, keyPart, unquotedValue, nextField] = match;

    // Clean the value: trim, escape quotes, and escape newlines for JSON
    let cleanValue = unquotedValue.trim();
    // Escape backslashes first, then quotes, then newlines
    cleanValue = cleanValue
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    const fixed = content.replace(fullMatch, `${keyPart}"${cleanValue}"${nextField}`);
    logger.info(`[fixMultiLineUnquotedStrings] Fixed unquoted multi-line prose (${unquotedValue.length} chars)`);
    return fixed;
  }

  return content;
}

/**
 * Attempt to fix unquoted string values in JSON (GPT-5.2 bug)
 * Fixes patterns like: "prose": The story text...
 * To proper JSON: "prose": "The story text..."
 *
 * @param {string} content - JSON content with potentially unquoted strings
 * @returns {string} Fixed JSON string
 */
export function fixUnquotedStringValues(content) {
  // First, try to fix multi-line unquoted strings (like prose)
  let fixed = fixMultiLineUnquotedStrings(content);

  // Pattern explanation:
  // ("[\w]+"\s*:\s*) - captures "key":
  // (?!["{\[\d]|true|false|null) - NOT followed by valid JSON value starters
  // ([^\n,}\]]+) - captures the unquoted value until delimiter

  // This regex finds patterns like "prose": Some text here, or "name": Value
  // and wraps the unquoted value in quotes

  let iterations = 0;
  const maxIterations = 100; // Prevent infinite loops

  // Keep trying until no more matches or max iterations
  while (iterations < maxIterations) {
    iterations++;

    // Match: "key": unquoted_value (where value is not a valid JSON type)
    // This regex captures the key and the unquoted string value
    const unquotedValuePattern = /("[\w_]+"\s*:\s*)(?!["{\[\d]|true\b|false\b|null\b)([^,}\]"\n]+)/g;

    const newFixed = fixed.replace(unquotedValuePattern, (match, keyPart, valuePart) => {
      // Clean the value - trim and escape any internal quotes
      const cleanValue = valuePart.trim().replace(/"/g, '\\"');
      logger.debug(`[fixUnquotedStringValues] Fixed unquoted value: ${keyPart}${valuePart.substring(0, 50)}...`);
      return `${keyPart}"${cleanValue}"`;
    });

    // If no changes were made, we're done
    if (newFixed === fixed) {
      break;
    }

    fixed = newFixed;
  }

  if (iterations > 1) {
    logger.info(`[fixUnquotedStringValues] Fixed unquoted string values in ${iterations} iterations`);
  }

  return fixed;
}

/**
 * Parse JSON from GPT response
 * Improved to handle edge cases where LLM adds text before/after JSON
 *
 * Strategies (in order):
 * 1. Direct parse - fastest path for clean JSON
 * 2. Fix unquoted strings - GPT-5.2 bug workaround
 * 3. Code block extraction - handles ```json ... ```
 * 4. Smart bracket matching - depth tracking extraction
 * 5. Greedy regex - last resort
 *
 * @param {string} content - Raw content from LLM response
 * @returns {object} Parsed JSON object
 * @throws {Error} If JSON cannot be parsed
 */
export function parseJsonResponse(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Invalid content: expected non-empty string');
  }

  const trimmed = content.trim();

  // Debug: Log content type and length
  logger.debug(`[parseJsonResponse] Input type: ${typeof content}, length: ${content.length}, trimmed length: ${trimmed.length}`);
  logger.debug(`[parseJsonResponse] First 100 chars: ${trimmed.substring(0, 100)}`);

  // FAIL LOUD: Detect JSON truncation before attempting parse
  // Truncation happens when max_tokens is too low - response gets cut off mid-JSON
  const truncationIndicators = detectJsonTruncation(trimmed);
  if (truncationIndicators.isTruncated) {
    const errorMsg = `FATAL: JSON response appears TRUNCATED. ` +
      `Indicators: ${truncationIndicators.reasons.join(', ')}. ` +
      `Content length: ${trimmed.length} chars. ` +
      `Last 100 chars: "${trimmed.substring(Math.max(0, trimmed.length - 100))}". ` +
      `This typically means max_tokens is too low for the response. Increase max_tokens in agent config.`;
    logger.error(`[parseJsonResponse] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Strategy 1: Direct parse (fastest path for clean JSON)
  try {
    const result = JSON.parse(trimmed);
    logger.debug('[parseJsonResponse] Strategy 1 (direct parse) succeeded');
    return result;
  } catch (e) {
    logger.debug(`[parseJsonResponse] Strategy 1 failed: ${e.message}`);
    // Continue to extraction strategies
  }

  // Strategy 2: Fix unquoted string values (GPT-5.2 bug workaround)
  // GPT-5.2 sometimes outputs: "prose": The story text... instead of "prose": "The story text..."
  const quotedFixed = fixUnquotedStringValues(trimmed);
  if (quotedFixed !== trimmed) {
    try {
      const result = JSON.parse(quotedFixed);
      logger.info('[parseJsonResponse] Strategy 2 (fix unquoted strings) succeeded - GPT-5.2 bug workaround applied');
      return result;
    } catch (e) {
      logger.debug(`[parseJsonResponse] Strategy 2 failed: ${e.message}`);
    }
  }

  // Strategy 3: Extract JSON from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const result = JSON.parse(codeBlockMatch[1].trim());
      logger.debug('[parseJsonResponse] Strategy 3 (code block) succeeded');
      return result;
    } catch (e) {
      logger.debug(`[parseJsonResponse] Strategy 3 failed: ${e.message}`);
    }

    // Also try fixing unquoted strings inside code blocks
    const codeBlockFixed = fixUnquotedStringValues(codeBlockMatch[1].trim());
    if (codeBlockFixed !== codeBlockMatch[1].trim()) {
      try {
        const result = JSON.parse(codeBlockFixed);
        logger.info('[parseJsonResponse] Strategy 3b (code block + fix unquoted) succeeded');
        return result;
      } catch (e) {
        logger.debug(`[parseJsonResponse] Strategy 3b failed: ${e.message}`);
      }
    }
  }

  // Strategy 4: Smart bracket-matching extraction
  // Find the first '{' and match to its closing '}' using depth tracking
  const extracted = extractFirstJsonObject(trimmed);
  if (extracted) {
    try {
      const result = JSON.parse(extracted);
      logger.debug('[parseJsonResponse] Strategy 4 (bracket matching) succeeded');
      return result;
    } catch (e) {
      logger.debug(`[parseJsonResponse] Strategy 4 failed: ${e.message}`);
    }

    // Also try fixing unquoted strings in extracted JSON
    const extractedFixed = fixUnquotedStringValues(extracted);
    if (extractedFixed !== extracted) {
      try {
        const result = JSON.parse(extractedFixed);
        logger.info('[parseJsonResponse] Strategy 4b (bracket matching + fix unquoted) succeeded');
        return result;
      } catch (e) {
        logger.debug(`[parseJsonResponse] Strategy 4b failed: ${e.message}`);
      }
    }
  } else {
    logger.debug('[parseJsonResponse] Strategy 4: No JSON object extracted');
  }

  // Strategy 5: Greedy regex as last resort (original behavior)
  const greedyMatch = trimmed.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      const result = JSON.parse(greedyMatch[0]);
      logger.debug('[parseJsonResponse] Strategy 5 (greedy regex) succeeded');
      return result;
    } catch (e) {
      // Try fixing unquoted strings in greedy match too
      const greedyFixed = fixUnquotedStringValues(greedyMatch[0]);
      if (greedyFixed !== greedyMatch[0]) {
        try {
          const result = JSON.parse(greedyFixed);
          logger.info('[parseJsonResponse] Strategy 5b (greedy + fix unquoted) succeeded');
          return result;
        } catch (e2) {
          logger.debug(`[parseJsonResponse] Strategy 5b failed: ${e2.message}`);
        }
      }

      logger.error(`[parseJsonResponse] All extraction strategies failed. Last error: ${e.message}`);
      logger.error(`[parseJsonResponse] Content preview (first 500 chars): ${trimmed.substring(0, 500)}`);
      logger.error(`[parseJsonResponse] Content preview (last 200 chars): ${trimmed.substring(Math.max(0, trimmed.length - 200))}`);
    }
  } else {
    logger.error('[parseJsonResponse] No JSON object found in response at all');
    logger.error(`[parseJsonResponse] Full content: ${trimmed.substring(0, 1000)}`);
  }

  throw new Error('Could not parse JSON from response');
}

/**
 * Attempt to repair truncated JSON responses
 * Common when max_tokens is hit mid-generation
 *
 * @param {string} content - Truncated JSON content
 * @param {string} type - Type hint ('scene', 'generic')
 * @returns {object} Repaired JSON object with _repaired flag
 * @throws {Error} If repair fails
 */
export function attemptJsonRepair(content, type = 'generic') {
  logger.info(`[JsonRepair] Attempting to repair ${type} JSON (${content.length} chars)`);

  // First, try to extract just the prose if it's a scene
  if (type === 'scene') {
    // Try to extract prose field even from truncated JSON
    const proseMatch = content.match(/"prose"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/s);
    if (proseMatch) {
      let prose = proseMatch[1];

      // Clean up any trailing incomplete escape sequences
      prose = prose.replace(/\\+$/, '');

      // Try to extract dialogue_map if present
      let dialogueMap = [];
      const dialogueMapMatch = content.match(/"dialogue_map"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
      if (dialogueMapMatch) {
        try {
          // Try to parse complete dialogue entries
          const dialogueContent = dialogueMapMatch[1];
          const dialogueEntries = dialogueContent.match(/\{[^{}]*\}/g) || [];
          for (const entry of dialogueEntries) {
            try {
              const parsed = JSON.parse(entry);
              if (parsed.quote && parsed.speaker) {
                dialogueMap.push(parsed);
              }
            } catch (e) {
              // Skip incomplete entries
            }
          }
        } catch (e) {
          logger.debug(`[JsonRepair] Could not extract dialogue_map entries`);
        }
      }

      logger.info(`[JsonRepair] Recovered prose (${prose.length} chars) and ${dialogueMap.length} dialogue entries`);

      return {
        prose: prose,
        dialogue_map: dialogueMap,
        new_characters: [],
        _repaired: true,
        _repair_note: 'JSON was truncated, recovered what was available'
      };
    }
  }

  // Generic repair: try to close unclosed brackets/braces
  let repaired = content;

  // Count unclosed structures
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;

  // Close any unterminated strings
  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }

  // Close brackets/braces
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  try {
    const parsed = JSON.parse(repaired);
    parsed._repaired = true;
    logger.info(`[JsonRepair] Successfully repaired JSON by closing ${openBraces - closeBraces} braces, ${openBrackets - closeBrackets} brackets`);
    return parsed;
  } catch (e) {
    logger.error(`[JsonRepair] Repair failed: ${e.message}`);
    throw new Error(`JSON repair failed: ${e.message}`);
  }
}

/**
 * Fix common JSON syntax errors from LLM outputs
 * Handles: trailing commas, missing commas, unescaped newlines in strings
 *
 * @param {string} content - Potentially malformed JSON
 * @returns {string} Cleaned JSON string
 */
export function fixCommonJsonErrors(content) {
  let fixed = content;

  // 1. Remove trailing commas before closing brackets/braces
  // Pattern: ,\s*] or ,\s*}
  fixed = fixed.replace(/,(\s*[\]}])/g, '$1');

  // 2. Fix missing commas between array elements
  // Pattern: }\s*{ without comma (common in arrays of objects)
  fixed = fixed.replace(/\}(\s*)\{/g, '},$1{');

  // 3. Fix unescaped newlines inside strings
  // This is tricky - we need to be careful not to break valid JSON
  // Look for patterns like "...\n..." inside strings and escape them
  // We do this by tracking string boundaries
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < fixed.length; i++) {
    const char = fixed[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }

    // If we're inside a string and hit a real newline, escape it
    if (inString && (char === '\n' || char === '\r')) {
      result += char === '\n' ? '\\n' : '\\r';
      continue;
    }

    result += char;
  }

  // 4. Fix single quotes to double quotes for property names
  // Pattern: {'key': or { 'key':
  // Only do this outside of string values
  result = result.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');

  return result;
}

/**
 * Robust JSON repair specifically for VoiceDirector responses
 * Handles large arrays of direction objects that may have formatting issues
 *
 * @param {string} content - Raw LLM response
 * @returns {object|null} Parsed JSON or null if unrecoverable
 */
export function repairVoiceDirectorJson(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  logger.debug(`[repairVoiceDirectorJson] Input length: ${content.length}`);

  // Step 1: Strip markdown code blocks
  let cleaned = content;
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
    logger.debug('[repairVoiceDirectorJson] Stripped markdown code block');
  }

  // Step 2: Apply common fixes
  cleaned = fixCommonJsonErrors(cleaned);

  // Step 3: Try to parse
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    logger.debug(`[repairVoiceDirectorJson] First parse attempt failed: ${e1.message}`);
  }

  // Step 4: Try extracting first JSON object
  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch (e2) {
      // Try fixing the extracted portion
      const fixedExtracted = fixCommonJsonErrors(extracted);
      try {
        return JSON.parse(fixedExtracted);
      } catch (e3) {
        logger.debug(`[repairVoiceDirectorJson] Extracted JSON parse failed: ${e3.message}`);
      }
    }
  }

  // Step 5: Try to salvage individual direction objects from the array
  // Look for "directions": [ ... ] pattern
  const directionsMatch = cleaned.match(/"directions"\s*:\s*\[([\s\S]*)\]/);
  if (directionsMatch) {
    const arrayContent = directionsMatch[1];
    const directions = [];

    // Extract individual objects using bracket matching
    let depth = 0;
    let objectStart = -1;
    let inStr = false;
    let escNext = false;

    for (let i = 0; i < arrayContent.length; i++) {
      const c = arrayContent[i];

      if (escNext) {
        escNext = false;
        continue;
      }
      if (c === '\\' && inStr) {
        escNext = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }

      if (!inStr) {
        if (c === '{') {
          if (depth === 0) objectStart = i;
          depth++;
        } else if (c === '}') {
          depth--;
          if (depth === 0 && objectStart !== -1) {
            const objStr = arrayContent.substring(objectStart, i + 1);
            try {
              const obj = JSON.parse(fixCommonJsonErrors(objStr));
              if (typeof obj.index === 'number') {
                directions.push(obj);
              }
            } catch (e) {
              // Skip malformed individual objects
              logger.debug(`[repairVoiceDirectorJson] Skipping malformed direction object at index ~${directions.length}`);
            }
            objectStart = -1;
          }
        }
      }
    }

    if (directions.length > 0) {
      logger.info(`[repairVoiceDirectorJson] Salvaged ${directions.length} direction objects from malformed JSON`);
      return { directions };
    }
  }

  logger.error(`[repairVoiceDirectorJson] All repair strategies failed. Content preview: ${cleaned.substring(0, 300)}...`);
  return null;
}

export default {
  parseJsonResponse,
  attemptJsonRepair,
  detectJsonTruncation,
  extractFirstJsonObject,
  fixUnquotedStringValues,
  fixMultiLineUnquotedStrings,
  fixCommonJsonErrors,
  repairVoiceDirectorJson
};
