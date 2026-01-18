/**
 * Voice Helper Functions
 * Extracted from orchestrator.js for better maintainability.
 *
 * These are pure functions that help with:
 * - Voice ID selection
 * - Segment preparation
 * - Voice assignment validation
 */

import { logger } from '../../utils/logger.js';
import { DEFAULT_NARRATOR_VOICE_ID } from '../../constants/voices.js';

/**
 * Get the effective voice ID based on priority:
 * 1. Explicit voiceId parameter
 * 2. Session config (voice_id or narratorVoice)
 * 3. Default narrator
 *
 * @param {object} options
 * @param {string} options.voiceId - Explicit voice ID parameter
 * @param {object} options.config - Session config_json
 * @returns {string} Effective voice ID (never null)
 */
export function getEffectiveVoiceId({ voiceId, config }) {
  const configVoiceId = config?.voice_id || config?.narratorVoice;
  const effective = voiceId || configVoiceId || DEFAULT_NARRATOR_VOICE_ID;

  logger.info(`[VoiceHelpers] Voice selection: param=${voiceId}, config=${configVoiceId}, effective=${effective}`);

  return effective;
}

/**
 * Check if hide_speech_tags is enabled (handles both boolean and string values)
 *
 * @param {object} config - Session config_json
 * @returns {boolean} Whether speech tags should be hidden
 */
export function shouldHideSpeechTags(config) {
  const raw = config?.hide_speech_tags;
  const enabled = raw === true || raw === 'true';

  logger.info(`[VoiceHelpers] hide_speech_tags: ${enabled} (raw: ${raw}, type: ${typeof raw})`);

  return enabled;
}

/**
 * Check if multi-voice narration should be used.
 *
 * @param {object} options
 * @param {object} options.config - Session config_json
 * @param {Array} options.characters - Array of character objects
 * @param {boolean} options.willPolish - Whether text will be polished (affects position-based parsing)
 * @returns {boolean} Whether to use multi-voice
 */
export function shouldUseMultiVoice({ config, characters, willPolish = false }) {
  // Check if explicitly disabled
  const explicitlyDisabled = config?.multi_voice === false || config?.multiVoice === false;

  if (explicitlyDisabled) {
    logger.info('[VoiceHelpers] Multi-voice explicitly disabled');
    return false;
  }

  // Check if explicitly enabled
  const explicitlyEnabled = config?.multi_voice === true || config?.multiVoice === true;

  // Default: enabled if characters exist
  const hasCharacters = characters && characters.length > 0;
  const enabled = explicitlyEnabled || hasCharacters;

  logger.info(`[VoiceHelpers] Multi-voice: explicit=${explicitlyEnabled}, characters=${hasCharacters}, enabled=${enabled}`);

  return enabled;
}

/**
 * Convert tag-parser segments to TTS-ready format.
 *
 * @param {Array} preComputedSegments - Segments from tag parser
 * @returns {Array} TTS-ready segments
 */
export function convertTagSegmentsToTTS(preComputedSegments) {
  if (!preComputedSegments || preComputedSegments.length === 0) {
    return [];
  }

  const segments = preComputedSegments.map(seg => ({
    speaker: seg.speaker,
    text: seg.text,
    voice_role: seg.voice_role || (seg.type === 'narrator' ? 'narrator' : 'dialogue'),
    emotion: seg.emotion || 'neutral',
    type: seg.type
  }));

  const narratorCount = segments.filter(s => s.type === 'narrator').length;
  const dialogueCount = segments.filter(s => s.type === 'dialogue').length;

  logger.info(`[VoiceHelpers] TAG-BASED | ${segments.length} segments | narrator: ${narratorCount} | dialogue: ${dialogueCount}`);

  return segments;
}

/**
 * Log segment analysis for debugging.
 *
 * @param {Array} segments - Parsed segments
 * @param {string} inputText - Original input text
 */
export function logSegmentAnalysis(segments, inputText) {
  const inputLength = inputText?.length || 0;

  logger.info(`[VoiceHelpers] ========== SEGMENT ANALYSIS ==========`);
  logger.info(`[VoiceHelpers] Input text length: ${inputLength} chars`);
  logger.info(`[VoiceHelpers] Parsed ${segments.length} segments`);

  let totalChars = 0;
  segments.forEach((seg, idx) => {
    totalChars += seg.text.length;
    const preview = seg.text.length > 80 ? seg.text.substring(0, 80) + '...' : seg.text;
    logger.info(`[VoiceHelpers] Segment[${idx}] ${seg.speaker}: "${preview}" (${seg.text.length} chars)`);
  });

  logger.info(`[VoiceHelpers] Total segment chars: ${totalChars}`);

  if (inputLength > 0 && totalChars < inputLength * 0.9) {
    const coverage = Math.round(totalChars / inputLength * 100);
    logger.warn(`[VoiceHelpers] WARNING: Text loss detected! Only ${coverage}% preserved`);
  }

  logger.info(`[VoiceHelpers] =====================================`);
}

/**
 * Build voice assignments map from database rows.
 *
 * @param {Array} dbRows - Rows from character_voice_assignments query
 * @returns {object} Map of lowercase character name to voice ID
 */
export function buildVoiceAssignmentsMap(dbRows) {
  const voiceMap = {};

  for (const row of dbRows) {
    if (row.name && row.elevenlabs_voice_id) {
      voiceMap[row.name.toLowerCase()] = row.elevenlabs_voice_id;
    }
  }

  logger.info(`[VoiceHelpers] Built voice map with ${Object.keys(voiceMap).length} assignments`);

  return voiceMap;
}

/**
 * Build story context object for LLM voice assignment.
 *
 * @param {object} options
 * @param {object} options.session - Session object
 * @param {object} options.outline - Story outline
 * @param {Array} options.characters - Character array
 * @returns {object} Story context for LLM
 */
export function buildVoiceAssignmentContext({ session, outline, characters }) {
  const context = {
    genre: session?.config_json?.genre || 'general fiction',
    mood: session?.config_json?.mood || 'neutral',
    audience: session?.config_json?.audience || 'general',
    synopsis: outline?.synopsis || session?.config_json?.synopsis || '',
    title: session?.title || outline?.title || 'Untitled',
    themes: outline?.themes || session?.config_json?.themes || [],
    setting: outline?.setting || session?.config_json?.setting || '',
    characters: characters || []
  };

  logger.info(`[VoiceHelpers] Voice context: genre=${context.genre}, mood=${context.mood}, audience=${context.audience}`);

  return context;
}

export default {
  getEffectiveVoiceId,
  shouldHideSpeechTags,
  shouldUseMultiVoice,
  convertTagSegmentsToTTS,
  logSegmentAnalysis,
  buildVoiceAssignmentsMap,
  buildVoiceAssignmentContext
};
