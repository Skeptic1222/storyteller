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
 * Strip ElevenLabs Audio/Prosody tags from text
 * Tags like [tenderly], [dramatically], [whispers], [angrily], etc.
 * @param {string} text - Text that may contain prosody tags
 * @returns {string} Clean text with tags removed
 */
export function stripProsodyTags(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  // Match [word] or [multiple words] patterns that are prosody tags
  // These are typically at the start of sentences or dialogue
  return text
    .replace(/\[(whispers|shouts|softly|quietly|urgently|intensely|deeply|fearfully|terrified|panicking|nervously|angrily|with barely contained rage|sadly|grief-stricken|voice breaking|wistfully|excitedly|joyfully|laughing|laughs|triumphantly|tenderly|lovingly|gently|reassuringly|menacingly|coldly|with quiet menace|darkly|ominously|sarcastically|mockingly|dryly|curiously|uncertainly|hesitantly|confusedly|desperately|pleading|pleadingly|resignedly|sighs|wearily|tiredly|with relief|bitterly|nostalgically|in awe|breathlessly|defiantly|authoritatively|firmly|seductively|reverently|solemnly|warmly|dramatically|theatrically|playfully|energetically|mysteriously)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip ALL special tags from text (character tags + prosody tags)
 * Use this for final display to users
 *
 * IMPORTANT: Restores quotation marks around dialogue for proper display.
 * Tags like [CHAR:Name]Hello[/CHAR] become "Hello" with quotes.
 *
 * @param {string} text - Text with potential tags
 * @returns {string} Clean text for display (dialogue wrapped in quotes)
 */
export function stripAllTags(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    // Character tags: [CHAR:Name]dialogue[/CHAR] → "dialogue" (restore quotes)
    .replace(/\[CHAR:[^\]]+\]([\s\S]*?)\[\/CHAR\]/g, (match, dialogue) => {
      const trimmedDialogue = dialogue.trim();
      // Only add quotes if dialogue isn't empty and doesn't already have quotes
      if (!trimmedDialogue) return '';
      if (/^[""\u201C]/.test(trimmedDialogue)) return trimmedDialogue; // Already has opening quote
      return `"${trimmedDialogue}"`;
    })
    // Prosody/Audio tags: [anything in brackets that looks like a tag]
    // More aggressive pattern to catch any [word] or [words words] pattern
    .replace(/\[[a-z][a-z\s\-']*\]/gi, '')
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

/**
 * Get quote characters based on style preference
 * @param {'double' | 'single' | 'guillemet'} style
 * @returns {{ open: string, close: string }}
 */
export function getQuoteChars(style = 'double') {
  switch (style) {
    case 'single':
      return { open: '\u2018', close: '\u2019' }; // ' '
    case 'guillemet':
      return { open: '\u00AB', close: '\u00BB' }; // « »
    case 'double':
    default:
      return { open: '\u201C', close: '\u201D' }; // " "
  }
}

/**
 * Process text for display, optionally restoring dialogue quotes
 *
 * This function:
 * 1. Strips all special tags (prosody, character)
 * 2. Optionally restores quotes around dialogue when [CHAR:] tags are present
 *
 * @param {string} text - Raw text that may contain tags
 * @param {Object} options - Processing options
 * @param {boolean} options.showQuotes - Whether to add quotes around dialogue
 * @param {'double' | 'single' | 'guillemet'} options.quoteStyle - Quote style
 * @returns {string} Processed text for display
 */
export function processTextForDisplay(text, options = {}) {
  const { showQuotes = true, quoteStyle = 'double' } = options;

  if (!text || typeof text !== 'string') {
    return '';
  }

  const quotes = getQuoteChars(quoteStyle);

  if (showQuotes) {
    // Character tags: [CHAR:Name]dialogue[/CHAR] → "dialogue" (restore quotes)
    text = text.replace(/\[CHAR:[^\]]+\]([\s\S]*?)\[\/CHAR\]/g, (match, dialogue) => {
      const trimmedDialogue = dialogue.trim();
      if (!trimmedDialogue) return '';
      // Only add quotes if dialogue isn't empty and doesn't already have quotes
      if (/^[""\u201C''\u2018«]/.test(trimmedDialogue)) return trimmedDialogue;
      return `${quotes.open}${trimmedDialogue}${quotes.close}`;
    });
  } else {
    // Just strip the tags without adding quotes
    text = text
      .replace(/\[CHAR:[^\]]+\]/g, '')
      .replace(/\[\/CHAR\]/g, '');
  }

  // Strip prosody/audio tags
  text = text.replace(/\[[a-z][a-z\s\-']*\]/gi, '');

  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}
