/**
 * Deterministic Tag Parser
 *
 * Parses [CHAR:Name]dialogue[/CHAR] tags without LLM involvement.
 * This is the core of the bulletproof multi-voice architecture.
 *
 * Benefits over position-based approach:
 * - 100% reliable - no position calculations
 * - No indexOf/slice operations that can break
 * - Works regardless of text modifications
 * - Deterministic - same input always produces same output
 *
 * @module tagParser
 */

import { logger } from '../../utils/logger.js';

// Tag patterns
const CHAR_TAG_OPEN = /\[CHAR:([^\]]+)\]/g;
const CHAR_TAG_CLOSE = /\[\/CHAR\]/g;
const FULL_TAG_PATTERN = /\[CHAR:([^\]]+)\]([\s\S]*?)\[\/CHAR\]/g;

/**
 * Parse tagged prose into audio segments
 *
 * @param {string} prose - Prose with [CHAR:Name]dialogue[/CHAR] tags
 * @returns {Array} Segments in format [{type, speaker, text, voice_role, emotion}]
 *
 * @example
 * Input: "The knight said, [CHAR:Roland]Hello there![/CHAR] and smiled."
 * Output: [
 *   { type: 'narrator', speaker: 'narrator', text: 'The knight said,', voice_role: 'narrator', emotion: 'neutral' },
 *   { type: 'dialogue', speaker: 'Roland', text: 'Hello there!', voice_role: 'dialogue', emotion: 'neutral' },
 *   { type: 'narrator', speaker: 'narrator', text: 'and smiled.', voice_role: 'narrator', emotion: 'neutral' }
 * ]
 */
export function parseTaggedProse(prose) {
  if (!prose || typeof prose !== 'string') {
    logger.warn('[TagParser] Empty or invalid prose input');
    return [];
  }

  const segments = [];
  let lastIndex = 0;

  logger.info(`[TagParser] ========== TAG PARSING START ==========`);
  logger.info(`[TagParser] INPUT | proseLength: ${prose.length} chars`);

  // Reset regex lastIndex
  FULL_TAG_PATTERN.lastIndex = 0;

  let match;
  let dialogueCount = 0;

  while ((match = FULL_TAG_PATTERN.exec(prose)) !== null) {
    const speaker = match[1].trim();
    const dialogueText = match[2].trim();
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    dialogueCount++;

    // Add narrator segment before this dialogue (if any)
    if (matchStart > lastIndex) {
      const narratorText = prose.slice(lastIndex, matchStart).trim();
      if (narratorText) {
        segments.push({
          type: 'narrator',
          speaker: 'narrator',
          text: narratorText,
          voice_role: 'narrator',
          emotion: 'neutral'
        });
        logger.debug(`[TagParser] NARRATOR | text: "${narratorText.substring(0, 50)}..." | len: ${narratorText.length}`);
      }
    }

    // Add dialogue segment
    if (dialogueText) {
      segments.push({
        type: 'dialogue',
        speaker: speaker,
        text: dialogueText,
        voice_role: 'dialogue',
        emotion: 'neutral' // Will be enriched by emotion validator later
      });
      logger.debug(`[TagParser] DIALOGUE[${dialogueCount}] | speaker: ${speaker} | text: "${dialogueText.substring(0, 50)}..." | len: ${dialogueText.length}`);
    } else {
      logger.warn(`[TagParser] EMPTY_DIALOGUE | speaker: ${speaker} | skipping empty tag`);
    }

    lastIndex = matchEnd;
  }

  // Add remaining narrator text after last dialogue
  if (lastIndex < prose.length) {
    const remainingText = prose.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({
        type: 'narrator',
        speaker: 'narrator',
        text: remainingText,
        voice_role: 'narrator',
        emotion: 'neutral'
      });
      logger.debug(`[TagParser] FINAL_NARRATOR | text: "${remainingText.substring(0, 50)}..." | len: ${remainingText.length}`);
    }
  }

  // Summary
  const narratorCount = segments.filter(s => s.type === 'narrator').length;
  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);

  logger.info(`[TagParser] COMPLETE | segments: ${segments.length} | narrator: ${narratorCount} | dialogue: ${dialogueCount}`);
  logger.info(`[TagParser] CHARS | total: ${totalChars} | original: ${prose.length} | coverage: ${Math.round(totalChars / prose.length * 100)}%`);

  return segments;
}

/**
 * Validate that all [CHAR] tags are properly balanced
 *
 * @param {string} prose - Prose to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTagBalance(prose) {
  if (!prose || typeof prose !== 'string') {
    return { valid: true, errors: [] }; // Empty prose is valid
  }

  const errors = [];

  // Reset regex lastIndex
  CHAR_TAG_OPEN.lastIndex = 0;
  CHAR_TAG_CLOSE.lastIndex = 0;

  const openTags = (prose.match(CHAR_TAG_OPEN) || []);
  const closeTags = (prose.match(CHAR_TAG_CLOSE) || []);

  if (openTags.length !== closeTags.length) {
    errors.push(`TAG_IMBALANCE: ${openTags.length} opening tags vs ${closeTags.length} closing tags`);
  }

  // Check for nested tags (not allowed)
  let depth = 0;
  let pos = 0;
  const combinedPattern = /(\[CHAR:[^\]]+\])|(\[\/CHAR\])/g;
  let tagMatch;

  while ((tagMatch = combinedPattern.exec(prose)) !== null) {
    if (tagMatch[1]) { // Opening tag
      depth++;
      if (depth > 1) {
        errors.push(`NESTED_TAG at position ${tagMatch.index}: Nested [CHAR] tags are not allowed`);
      }
    } else if (tagMatch[2]) { // Closing tag
      depth--;
      if (depth < 0) {
        errors.push(`UNMATCHED_CLOSE at position ${tagMatch.index}: Closing tag without opening tag`);
        depth = 0; // Reset to continue checking
      }
    }
  }

  if (depth > 0) {
    errors.push(`UNCLOSED_TAG: ${depth} opening tag(s) without closing tags`);
  }

  // Check for empty speaker names
  for (const tag of openTags) {
    const speakerMatch = tag.match(/\[CHAR:([^\]]*)\]/);
    if (speakerMatch && (!speakerMatch[1] || speakerMatch[1].trim() === '')) {
      errors.push(`EMPTY_SPEAKER at "${tag}": Speaker name cannot be empty`);
    }
  }

  const isValid = errors.length === 0;
  if (!isValid) {
    logger.error(`[TagParser] VALIDATION_FAILED | errors: ${errors.join('; ')}`);
  } else {
    logger.debug(`[TagParser] VALIDATION_PASSED | tags: ${openTags.length}`);
  }

  return { valid: isValid, errors };
}

/**
 * Extract all unique speaker names from tagged prose
 *
 * @param {string} prose - Prose with [CHAR:Name] tags
 * @returns {string[]} Array of unique speaker names
 */
export function extractSpeakers(prose) {
  if (!prose || typeof prose !== 'string') {
    return [];
  }

  const speakers = new Set();
  CHAR_TAG_OPEN.lastIndex = 0;

  let match;
  while ((match = CHAR_TAG_OPEN.exec(prose)) !== null) {
    const speaker = match[1].trim();
    if (speaker) {
      speakers.add(speaker);
    }
  }

  const result = Array.from(speakers);
  logger.debug(`[TagParser] SPEAKERS_EXTRACTED | count: ${result.length} | names: ${result.join(', ')}`);

  return result;
}

/**
 * Check if prose contains any [CHAR] tags
 *
 * @param {string} prose - Prose to check
 * @returns {boolean} True if contains tags
 */
export function hasCharacterTags(prose) {
  if (!prose || typeof prose !== 'string') {
    return false;
  }
  return CHAR_TAG_OPEN.test(prose);
}

/**
 * Strip all [CHAR] tags from prose, leaving only the text content
 * Useful for text-only display or narrator-only audio generation
 *
 * @param {string} prose - Prose with [CHAR:Name] tags
 * @returns {string} Plain text without tags
 */
export function stripTags(prose) {
  if (!prose || typeof prose !== 'string') {
    return '';
  }

  // Remove opening and closing tags, keeping content
  return prose
    .replace(/\[CHAR:[^\]]+\]/g, '')
    .replace(/\[\/CHAR\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Add [CHAR] tags around quoted dialogue in plain prose
 * This is a helper for migration from position-based to tag-based format
 *
 * NOTE: This is a simple regex-based approach for migration only.
 * New content should be generated with tags directly from the LLM.
 *
 * @param {string} prose - Plain prose with quoted dialogue
 * @param {Array} dialogueMap - Position-based dialogue_map
 * @returns {string} Prose with [CHAR] tags inserted
 */
export function addTagsFromDialogueMap(prose, dialogueMap) {
  if (!prose || !dialogueMap || dialogueMap.length === 0) {
    return prose;
  }

  logger.info(`[TagParser] MIGRATION | adding tags from ${dialogueMap.length} dialogue_map entries`);

  // Sort by position (reverse order so we don't mess up positions as we insert)
  const sorted = [...dialogueMap].sort((a, b) => b.start_char - a.start_char);

  let result = prose;
  for (const d of sorted) {
    if (d.start_char >= 0 && d.end_char > d.start_char && d.end_char <= prose.length) {
      const before = result.slice(0, d.start_char);
      const dialogue = result.slice(d.start_char, d.end_char);
      const after = result.slice(d.end_char);

      // Clean the dialogue text (remove surrounding quotes)
      const cleanDialogue = dialogue
        .replace(/^[""\u201C\u201D'"]+/, '')
        .replace(/[""\u201C\u201D'"]+$/, '')
        .trim();

      if (cleanDialogue && d.speaker) {
        result = before + `[CHAR:${d.speaker}]${cleanDialogue}[/CHAR]` + after;
        logger.debug(`[TagParser] MIGRATED | speaker: ${d.speaker} | pos: [${d.start_char}-${d.end_char}]`);
      }
    }
  }

  return result;
}

/**
 * Detect emotion in dialogue text (basic heuristics)
 * For more accurate emotion detection, use emotionValidatorAgent
 *
 * @param {string} text - Dialogue text
 * @returns {string} Detected emotion
 */
export function detectBasicEmotion(text) {
  if (!text) return 'neutral';

  const lower = text.toLowerCase();

  // Exclamations suggest excitement or anger
  if (text.includes('!')) {
    if (lower.includes('help') || lower.includes('no') || lower.includes('stop')) {
      return 'urgent';
    }
    return 'excited';
  }

  // Questions
  if (text.includes('?')) {
    if (lower.includes('what') || lower.includes('why') || lower.includes('how')) {
      return 'curious';
    }
    return 'questioning';
  }

  // Ellipsis suggests trailing off or uncertainty
  if (text.includes('...')) {
    return 'hesitant';
  }

  // Caps suggest shouting
  if (text === text.toUpperCase() && text.length > 3) {
    return 'shouting';
  }

  return 'neutral';
}

export default {
  parseTaggedProse,
  validateTagBalance,
  extractSpeakers,
  hasCharacterTags,
  stripTags,
  addTagsFromDialogueMap,
  detectBasicEmotion
};
