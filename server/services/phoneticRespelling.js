/**
 * Phonetic Respelling Service
 *
 * Handles ElevenLabs content policy refusals by generating phonetic respellings
 * of objectionable words using Venice.ai, then retrying TTS with the phonetic version.
 *
 * Flow:
 * 1. ElevenLabs refuses to narrate text (422 content policy)
 * 2. Detect which words/phrases triggered the refusal
 * 3. Look up cached phonetic mappings from database
 * 4. For uncached words, call Venice.ai to generate phonetic respelling
 * 5. Store new mappings in database
 * 6. Return phonetic text for TTS retry
 * 7. Karaoke displays original text, audio plays phonetic version
 */

import { pool } from '../database/pool.js';
import { callLLM } from './llmProviders.js';
import logger from '../utils/logger.js';

// Common profanity patterns that might trigger ElevenLabs refusal
const PROFANITY_PATTERNS = [
  /\b(fuck|fucking|fucked|fucker|fucks)\b/gi,
  /\b(shit|shitting|shitty|bullshit)\b/gi,
  /\b(cock|cocks|dick|dicks|penis)\b/gi,
  /\b(pussy|pussies|cunt|cunts)\b/gi,
  /\b(ass|asshole|assholes|asses)\b/gi,
  /\b(bitch|bitches|bitching)\b/gi,
  /\b(damn|damned|goddamn)\b/gi,
  /\b(bastard|bastards)\b/gi,
  /\b(whore|whores|slut|sluts)\b/gi,
  /\b(nigger|nigga|faggot|retard)\b/gi, // Slurs - highest priority for replacement
];

// Violent/graphic content patterns
const VIOLENT_PATTERNS = [
  /\b(kill|killing|murder|murdered|slaughter)\b/gi,
  /\b(blood|bloody|bleeding|gore|gory)\b/gi,
  /\b(rape|raped|raping)\b/gi,
  /\b(torture|tortured|torturing)\b/gi,
  /\b(dismember|decapitate|eviscerate)\b/gi,
];

/**
 * Check if text likely contains content that ElevenLabs might refuse
 */
export function containsPotentiallyRefusedContent(text) {
  const allPatterns = [...PROFANITY_PATTERNS, ...VIOLENT_PATTERNS];
  for (const pattern of allPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract potentially problematic words from text
 */
export function extractProblematicWords(text) {
  const words = new Set();
  const allPatterns = [...PROFANITY_PATTERNS, ...VIOLENT_PATTERNS];

  for (const pattern of allPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => words.add(m.toLowerCase()));
    }
  }

  return Array.from(words);
}

/**
 * Get cached phonetic mapping from database
 */
async function getCachedMapping(word) {
  try {
    const result = await pool.query(
      `SELECT phonetic_tts_text, confidence
       FROM profanity_phonetic_mappings
       WHERE original_word = $1`,
      [word.toLowerCase()]
    );

    if (result.rows.length > 0) {
      // Update usage count
      await pool.query(
        `UPDATE profanity_phonetic_mappings
         SET usage_count = usage_count + 1, last_used_at = NOW()
         WHERE original_word = $1`,
        [word.toLowerCase()]
      );
      return result.rows[0];
    }
    return null;
  } catch (error) {
    logger.warn(`[Cache] Error fetching mapping for "${word}": ${error.message}`);
    return null;
  }
}

/**
 * Store new phonetic mapping in database
 */
async function storeMappingInCache(original, phonetic, modelVersion = 'venice-uncensored') {
  try {
    await pool.query(
      `INSERT INTO profanity_phonetic_mappings
         (original_word, phonetic_tts_text, model_version, usage_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (original_word) DO UPDATE
       SET phonetic_tts_text = $2, model_version = $3, usage_count = profanity_phonetic_mappings.usage_count + 1`,
      [original.toLowerCase(), phonetic, modelVersion]
    );
    logger.info(`[Cache] Stored mapping: "${original}" -> "${phonetic}"`);
  } catch (error) {
    logger.warn(`[Cache] Error storing mapping: ${error.message}`);
  }
}

/**
 * Generate phonetic respelling using Venice.ai
 * Venice is uncensored and will generate phonetic versions of any content
 */
async function generatePhoneticRespelling(word) {
  const prompt = `You are a phonetic spelling assistant. Your task is to create a phonetic respelling of a word that:
1. Sounds identical when spoken aloud by a text-to-speech system
2. Uses only common, innocent-looking letter combinations
3. Does NOT contain the original word or obvious variations

Word to respell: "${word}"

Examples of good phonetic respellings:
- "fuck" -> "fuhk" or "phuck"
- "shit" -> "shitt" or "shiht"
- "ass" -> "ahss" or "azz"
- "damn" -> "dahm" or "damm"
- "bitch" -> "bihch" or "bich"

Return ONLY the phonetic respelling, nothing else. No quotes, no explanation.`;

  try {
    const result = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
      agent_name: 'PhoneticRespelling',
      provider: 'venice' // Use Venice for uncensored phonetic generation
    });

    const phonetic = result.content?.trim();

    // Validate the result
    if (!phonetic || phonetic.length < 2 || phonetic.length > 20) {
      logger.warn(`[Generate] Invalid phonetic result for "${word}": "${phonetic}"`);
      return null;
    }

    // Ensure it doesn't just return the original word
    if (phonetic.toLowerCase() === word.toLowerCase()) {
      logger.warn(`[Generate] Phonetic result same as original for "${word}"`);
      return null;
    }

    logger.info(`[Generate] Created phonetic: "${word}" -> "${phonetic}"`);
    return phonetic;
  } catch (error) {
    logger.error(`[Generate] Failed to generate phonetic for "${word}": ${error.message}`);
    return null;
  }
}

/**
 * Get phonetic respelling for a word (cached or generated)
 */
export async function getPhoneticRespelling(word) {
  // Check cache first
  const cached = await getCachedMapping(word);
  if (cached) {
    logger.debug(`[Phonetic] Cache hit for "${word}": "${cached.phonetic_tts_text}"`);
    return cached.phonetic_tts_text;
  }

  // Generate new respelling
  const phonetic = await generatePhoneticRespelling(word);
  if (phonetic) {
    await storeMappingInCache(word, phonetic);
    return phonetic;
  }

  // Fallback: return original word (TTS will likely still fail)
  return word;
}

/**
 * Apply phonetic respellings to text
 * Returns both the phonetic text (for TTS) and a mapping (for karaoke sync)
 */
export async function applyPhoneticRespellings(text) {
  const problematicWords = extractProblematicWords(text);

  if (problematicWords.length === 0) {
    return {
      phoneticText: text,
      mappings: [],
      hasReplacements: false
    };
  }

  logger.info(`[Apply] Processing ${problematicWords.length} potentially problematic words`);

  const mappings = [];
  let phoneticText = text;

  for (const word of problematicWords) {
    const phonetic = await getPhoneticRespelling(word);

    if (phonetic !== word) {
      // Create case-preserving replacement
      const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');

      phoneticText = phoneticText.replace(pattern, (match) => {
        // Preserve original casing
        if (match === match.toUpperCase()) {
          return phonetic.toUpperCase();
        } else if (match[0] === match[0].toUpperCase()) {
          return phonetic.charAt(0).toUpperCase() + phonetic.slice(1).toLowerCase();
        }
        return phonetic.toLowerCase();
      });

      mappings.push({
        original: word,
        phonetic: phonetic,
        positions: findWordPositions(text, word)
      });
    }
  }

  logger.info(`[Apply] Applied ${mappings.length} phonetic replacements`);

  return {
    phoneticText,
    mappings,
    hasReplacements: mappings.length > 0
  };
}

/**
 * Store word alignment for karaoke synchronization
 */
export async function storeWordAlignment(originalText, phoneticText, voiceId, wordTimings) {
  const crypto = await import('crypto');
  const textHash = crypto.createHash('sha256').update(originalText).digest('hex');

  try {
    await pool.query(
      `INSERT INTO phonetic_word_alignments
         (original_text_hash, phonetic_text, voice_id, mapping_json)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (original_text_hash, voice_id) DO UPDATE
       SET phonetic_text = $2, mapping_json = $4`,
      [textHash, phoneticText, voiceId, JSON.stringify(wordTimings)]
    );
    logger.debug(`[Alignment] Stored alignment for hash ${textHash.substring(0, 8)}...`);
  } catch (error) {
    logger.warn(`[Alignment] Error storing alignment: ${error.message}`);
  }
}

/**
 * Retrieve word alignment for karaoke
 */
export async function getWordAlignment(originalText, voiceId) {
  const crypto = await import('crypto');
  const textHash = crypto.createHash('sha256').update(originalText).digest('hex');

  try {
    const result = await pool.query(
      `SELECT mapping_json FROM phonetic_word_alignments
       WHERE original_text_hash = $1 AND voice_id = $2`,
      [textHash, voiceId]
    );

    if (result.rows.length > 0) {
      return result.rows[0].mapping_json;
    }
  } catch (error) {
    logger.warn(`[Alignment] Error fetching alignment: ${error.message}`);
  }
  return null;
}

// Helper functions
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findWordPositions(text, word) {
  const positions = [];
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
  let match;

  while ((match = pattern.exec(text)) !== null) {
    positions.push({
      start: match.index,
      end: match.index + match[0].length,
      original: match[0]
    });
  }

  return positions;
}

export default {
  containsPotentiallyRefusedContent,
  extractProblematicWords,
  getPhoneticRespelling,
  applyPhoneticRespellings,
  storeWordAlignment,
  getWordAlignment
};
