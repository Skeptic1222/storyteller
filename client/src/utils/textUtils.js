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
