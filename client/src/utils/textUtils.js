/**
 * Text Utilities
 * Client-side text processing helpers
 */

/**
 * Strip [CHAR:Name] and [/CHAR] tags from text
 * Safety net in case tags leak through from server
 * @param {string} text - Text that may contain character tags
 * @returns {string} Clean text with tags removed
 */
export function stripCharacterTags(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/\[CHAR:[^\]]+\]/g, '')
    .replace(/\[\/CHAR\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if text contains [CHAR] tags
 * @param {string} text
 * @returns {boolean}
 */
export function hasCharacterTags(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return /\[CHAR:[^\]]+\]/.test(text);
}
