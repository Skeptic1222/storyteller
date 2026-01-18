/**
 * Audio Helper Functions
 * Extracted from orchestrator.js for better maintainability.
 *
 * These are helper functions for multi-voice audio generation:
 * - Voice usage logging
 * - Story context building for emotion detection
 * - Audio segment mapping
 */

import { logger } from '../../utils/logger.js';
import { getVoiceNameById } from '../elevenlabs.js';

/**
 * Count and log voice usage across segments.
 *
 * @param {Array} preparedSegments - Segments with voice_id assigned
 * @param {string} logPrefix - Prefix for log messages (e.g., '[MultiVoice]')
 * @returns {object} Voice usage counts keyed by voice_id
 */
export async function logVoiceUsage(preparedSegments, logPrefix = '[MultiVoice]') {
  const voiceUsageCounts = {};

  for (const seg of preparedSegments) {
    voiceUsageCounts[seg.voice_id] = (voiceUsageCounts[seg.voice_id] || 0) + 1;
  }

  logger.info(`${logPrefix} ========== VOICE USAGE SUMMARY ==========`);
  logger.info(`${logPrefix} ${Object.keys(voiceUsageCounts).length} unique voices used:`);

  for (const [voiceId, count] of Object.entries(voiceUsageCounts)) {
    const voiceName = await getVoiceNameById(voiceId);
    logger.info(`${logPrefix}   - "${voiceName}" (${voiceId}): ${count} segment(s)`);
  }

  return voiceUsageCounts;
}

/**
 * Build story context for LLM emotion detection during audio generation.
 *
 * @param {object} options
 * @param {object} options.config - Session config_json
 * @param {string} options.sceneText - Scene text (will be truncated to 300 chars)
 * @param {Array} options.characters - Character array
 * @returns {object} Story context for emotion detection
 */
export function buildEmotionContext({ config, sceneText, characters }) {
  // Extract genre - handle both string and object formats
  const genres = config?.genres || {};
  const genreString = typeof config?.genre === 'string' ? config.genre :
                      genres.primary ? `${genres.primary}${genres.secondary ? ', ' + genres.secondary : ''}` :
                      config?.primaryGenre || 'general fiction';

  // Extract content intensity settings for voice direction
  const intensitySettings = config?.intensitySettings || config?.intensity_settings || config?.intensity || {};
  const adultContent = intensitySettings.adultContent ?? intensitySettings.adult_content ?? 0;
  const violence = intensitySettings.violence ?? 0;
  const gore = intensitySettings.gore ?? 0;
  const romance = intensitySettings.romance ?? 0;
  const sensuality = intensitySettings.sensuality ?? 0;
  const explicitness = intensitySettings.explicitness ?? 0;

  const context = {
    genre: genreString,
    mood: config?.mood || config?.storyMood || 'neutral',
    audience: config?.audience || 'general',
    sceneDescription: sceneText?.substring(0, 500) || '', // Increased from 300 for better context
    characters: characters || [],
    // Content intensity for voice direction
    contentIntensity: {
      adultContent,
      violence,
      gore,
      romance,
      sensuality,
      explicitness,
      isMature: config?.audience === 'mature' || adultContent >= 50 || violence >= 60 || gore >= 60,
      isViolent: violence >= 60 || gore >= 60,
      isErotic: adultContent >= 50 || romance >= 70 || sensuality >= 60 || explicitness >= 50
    }
  };

  logger.info(`[AudioHelpers] Emotion context: genre=${context.genre}, mood=${context.mood}, audience=${context.audience}`);
  logger.info(`[AudioHelpers] Content intensity: adult=${adultContent}, violence=${violence}, gore=${gore}, romance=${romance}, sensuality=${sensuality}, explicitness=${explicitness}`);
  if (context.contentIntensity.isMature) {
    logger.info(`[AudioHelpers] MATURE content detected - voice direction will use intense delivery`);
  }

  return context;
}

/**
 * Map prepared segments to audio segment format for storage/logging.
 *
 * @param {Array} preparedSegments - Segments with voice_id assigned
 * @param {number} previewLength - Length of text preview (default 50)
 * @returns {Array} Audio segments with speaker, voice_id, and text_preview
 */
export function mapToAudioSegments(preparedSegments, previewLength = 50) {
  return preparedSegments.map(s => ({
    speaker: s.speaker,
    voice_id: s.voice_id,
    text_preview: s.text.substring(0, previewLength)
  }));
}

/**
 * Log character voice map with resolved voice names.
 *
 * @param {object} characterVoices - Map of character name (lowercase) to voice ID
 * @param {string} narratorVoiceId - Narrator/DM voice ID
 * @param {string} logPrefix - Prefix for log messages
 */
export async function logCharacterVoiceMap(characterVoices, narratorVoiceId, logPrefix = '[MultiVoice]') {
  logger.info(`${logPrefix} ========== CHARACTER VOICE MAP ==========`);

  const narratorVoiceName = await getVoiceNameById(narratorVoiceId);
  logger.info(`${logPrefix} Narrator: "${narratorVoiceName}" (${narratorVoiceId})`);

  logger.info(`${logPrefix} Character assignments:`);
  for (const [charName, voiceId] of Object.entries(characterVoices)) {
    const voiceName = await getVoiceNameById(voiceId);
    logger.info(`${logPrefix}   - "${charName}" -> "${voiceName}" (${voiceId})`);
  }
}

/**
 * Build audio generation options from session config.
 *
 * @param {object} options
 * @param {object} options.config - Session config_json
 * @param {string} options.sessionId - Session ID for usage tracking
 * @param {number} options.normalizedStyle - Pre-normalized style value (0-1)
 * @returns {object} Options for elevenlabs.generateMultiVoiceAudio
 */
export function buildAudioGenerationOptions({ config, sessionId, normalizedStyle }) {
  return {
    stability: config?.narratorStyleSettings?.stability || 0.5,
    style: normalizedStyle,
    sessionId
  };
}

/**
 * Log single voice narration info.
 *
 * @param {string} voiceId - Narrator voice ID
 * @param {string} textPreview - First 60 chars of text
 * @param {object} options
 * @param {string} options.logPrefix - Log prefix (default '[Orchestrator]')
 * @param {boolean} options.isRecording - Whether recording mode is active
 */
export async function logSingleVoiceNarration(voiceId, textPreview, options = {}) {
  const { logPrefix = '[Orchestrator]', withTimestamps = false } = options;
  const voiceName = await getVoiceNameById(voiceId);

  logger.info(`${logPrefix} ========== SINGLE VOICE NARRATION ==========`);
  logger.info(`${logPrefix} Narrator: "${voiceName}" (${voiceId})`);
  logger.info(`${logPrefix} Text preview: "${textPreview.substring(0, 60)}..."`);

  logger.info(`${logPrefix} Word timings: ${withTimestamps ? 'YES (karaoke-ready)' : 'NO'}`);

  return voiceName;
}

export default {
  logVoiceUsage,
  buildEmotionContext,
  mapToAudioSegments,
  logCharacterVoiceMap,
  buildAudioGenerationOptions,
  logSingleVoiceNarration
};
