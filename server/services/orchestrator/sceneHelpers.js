/**
 * Scene Helper Functions
 * Utilities for scene generation and management.
 *
 * Extracted from orchestrator.js for better maintainability.
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';

// ============ Content Validation ============

/**
 * Garbage content patterns that indicate LLM meta-text or failed responses
 * These patterns match responses where the LLM describes what it would write
 * instead of actually writing the story content.
 */
const GARBAGE_PATTERNS = [
  // Meta-references to "the story" or "content"
  /^the\s+(revised\s+)?story\s+(above|below|here)/i,
  /^here\s+is\s+(the|your|a)\s+(revised\s+)?(story|scene|content|chapter)/i,
  /^(this|the)\s+(revised\s+)?(story|scene|content|chapter)\s+(is|has|includes)/i,

  // Refusal patterns
  /^i\s+(cannot|can't|won't|am\s+unable\s+to)/i,
  /^(sorry|apologies),?\s+i\s+(cannot|can't|won't)/i,
  /^i\s+apologize,?\s+(but\s+)?i\s+(cannot|can't)/i,
  /^as\s+an?\s+(ai|language\s+model)/i,

  // HTML/code artifacts
  /^<!doctype/i,
  /^<html/i,
  /^<\?xml/i,
  /^\s*\{\s*"error"/i,

  // Empty or placeholder content
  /^\[content\s+(unavailable|removed|redacted)\]/i,
  /^placeholder/i,
  /^lorem\s+ipsum/i,

  // Self-referential LLM text
  /^(let\s+me|i('ll| will))\s+(write|create|generate|craft)/i,
  /^(continuing|proceeding)\s+(with|to)/i,
  /^(here's|here is)\s+the\s+(continuation|next\s+part)/i
];

/**
 * Minimum content length thresholds
 * Content below these limits is considered garbage/incomplete
 */
const MIN_CONTENT_LENGTH = {
  displayText: 100,  // Minimum characters for readable content
  rawText: 50        // Minimum for raw (may have tags stripped)
};

/**
 * Validate scene content to detect garbage LLM responses
 * Throws an error if content fails validation
 *
 * @param {string} rawText - Raw scene text
 * @param {string} displayText - Display-ready text (tags stripped)
 * @throws {Error} If content is garbage/invalid
 * @returns {object} Validation result with details
 */
export function validateSceneContent(rawText, displayText) {
  const issues = [];

  // Check minimum lengths
  if (!displayText || displayText.length < MIN_CONTENT_LENGTH.displayText) {
    issues.push(`Content too short: ${displayText?.length || 0} chars (min: ${MIN_CONTENT_LENGTH.displayText})`);
  }

  if (!rawText || rawText.length < MIN_CONTENT_LENGTH.rawText) {
    issues.push(`Raw text too short: ${rawText?.length || 0} chars (min: ${MIN_CONTENT_LENGTH.rawText})`);
  }

  // Check for garbage patterns in display text
  const textToCheck = (displayText || '').trim();
  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(textToCheck)) {
      issues.push(`Garbage pattern detected: "${textToCheck.substring(0, 50)}..." matches ${pattern}`);
      break; // One match is enough
    }
  }

  // Check for suspiciously low word count (less than 20 words)
  const wordCount = textToCheck.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 20) {
    issues.push(`Word count too low: ${wordCount} words (min: 20)`);
  }

  // Check for excessive repetition (same word more than 30% of content)
  if (wordCount > 10) {
    const words = textToCheck.toLowerCase().split(/\s+/);
    const wordFreq = {};
    words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
    const maxFreq = Math.max(...Object.values(wordFreq));
    if (maxFreq / words.length > 0.3) {
      const mostCommon = Object.entries(wordFreq).find(([, v]) => v === maxFreq)?.[0];
      issues.push(`Excessive repetition: "${mostCommon}" appears ${maxFreq}/${words.length} times`);
    }
  }

  if (issues.length > 0) {
    const error = new Error(`Content validation failed: ${issues.join('; ')}`);
    error.code = 'CONTENT_VALIDATION_FAILED';
    error.issues = issues;
    error.contentPreview = textToCheck.substring(0, 100);
    throw error;
  }

  return {
    valid: true,
    wordCount,
    charCount: textToCheck.length
  };
}

/**
 * Get current scene count for a session
 * @param {string} sessionId
 * @returns {number} Scene count
 */
export async function getSceneCount(sessionId) {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM story_scenes WHERE story_session_id = $1',
    [sessionId]
  );
  return parseInt(result.rows[0].count);
}

/**
 * Get the previous scene for context
 * @param {string} sessionId
 * @returns {string|null} Summary or text preview of previous scene
 */
export async function getPreviousScene(sessionId) {
  const result = await pool.query(`
    SELECT summary, polished_text FROM story_scenes
    WHERE story_session_id = $1
    ORDER BY sequence_index DESC LIMIT 1
  `, [sessionId]);

  if (result.rows.length > 0) {
    const fullText = result.rows[0].polished_text || '';
    const summary = result.rows[0].summary || '';

    // P0 FIX: Return last 1500 chars (includes scene ending/climax) for better continuity
    // Previously only returned 200-300 chars which caused Chapter 2 to redo Chapter 1
    if (fullText.length > 0) {
      return fullText.length > 1500 ? fullText.slice(-1500) : fullText;
    }
    return summary;
  }
  return null;
}

/**
 * Get target scene count based on story length and format
 * @param {object} config - Session config_json
 * @returns {number} Target number of scenes
 */
export function getTargetSceneCount(config) {
  const length = config?.story_length || 'medium';
  const format = config?.story_format || 'short_story';

  // Base counts by length - increased for fuller stories
  const baseCounts = {
    short: 5,
    medium: 10,
    long: 20
  };

  // Adjust for story format
  const formatMultipliers = {
    picture_book: 0.5,    // Fewer scenes, more illustrations
    short_story: 1,       // Standard
    novella: 1.5,         // More scenes
    novel: 2,             // Many more scenes
    series: 1             // Per entry, standard length
  };

  const baseCount = baseCounts[length] || 8;
  const multiplier = formatMultipliers[format] || 1;

  return Math.max(3, Math.round(baseCount * multiplier));
}

/**
 * Determine scene mood from text
 * @param {string} text - Scene text
 * @returns {string} Mood classification
 */
export function determineMood(text) {
  const lowered = text.toLowerCase();

  if (lowered.includes('laugh') || lowered.includes('giggle') || lowered.includes('funny')) {
    return 'playful';
  }
  if (lowered.includes('dark') || lowered.includes('shadow') || lowered.includes('creep')) {
    return 'mysterious';
  }
  if (lowered.includes('battle') || lowered.includes('fight') || lowered.includes('ran')) {
    return 'exciting';
  }
  if (lowered.includes('sleep') || lowered.includes('dream') || lowered.includes('peaceful')) {
    return 'calm';
  }
  if (lowered.includes('sad') || lowered.includes('tear') || lowered.includes('miss')) {
    return 'emotional';
  }

  return 'neutral';
}

/**
 * Save scene to database
 * @param {object} options
 * @param {string} options.sessionId
 * @param {number} options.sceneIndex
 * @param {string} options.rawText
 * @param {string} options.displayText - Text with tags stripped
 * @param {string} options.mood
 * @param {boolean} [options.skipValidation=false] - Skip content validation (use with caution)
 * @returns {object} Scene record
 * @throws {Error} If content validation fails (unless skipValidation=true)
 */
export async function saveScene({ sessionId, sceneIndex, rawText, displayText, mood, skipValidation = false }) {
  // CRITICAL: Validate content before saving to prevent garbage responses
  if (!skipValidation) {
    try {
      const validation = validateSceneContent(rawText, displayText);
      logger.info(`[SceneHelpers] Content validated: ${validation.wordCount} words, ${validation.charCount} chars`);
    } catch (validationError) {
      logger.error(`[SceneHelpers] Content validation FAILED for session ${sessionId}, scene ${sceneIndex}:`, {
        error: validationError.message,
        issues: validationError.issues,
        preview: validationError.contentPreview
      });
      // Re-throw to prevent saving garbage content
      throw validationError;
    }
  }

  const result = await pool.query(`
    INSERT INTO story_scenes (
      story_session_id, sequence_index, branch_key, raw_text, polished_text,
      summary, mood, word_count
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    sessionId,
    sceneIndex,
    'main',
    rawText,
    displayText,
    displayText.substring(0, 200),
    mood,
    displayText.split(/\s+/).length
  ]);

  logger.info(`[SceneHelpers] Scene saved | raw: ${rawText.length} chars | display: ${displayText.length} chars`);
  return result.rows[0];
}

/**
 * Save dialogue map to scene
 * @param {object} options
 * @param {number} options.sceneId
 * @param {Array} options.dialogueMap
 * @param {string} options.proseFormat
 * @param {Array} options.speakersExtracted
 */
export async function saveDialogueMap({ sceneId, dialogueMap, proseFormat, speakersExtracted }) {
  const tagValidationStatus = proseFormat === 'tag_based' ? 'validated' : 'legacy';

  await pool.query(`
    UPDATE story_scenes
    SET dialogue_map = $1,
        dialogue_tagging_status = 'completed',
        prose_format = $2,
        tag_validation_status = $3,
        speakers_extracted = $4
    WHERE id = $5
  `, [JSON.stringify(dialogueMap), proseFormat, tagValidationStatus, speakersExtracted, sceneId]);

  logger.info(`[SceneHelpers] Saved ${dialogueMap.length} dialogue attributions for scene ${sceneId} (format: ${proseFormat})`);
}

/**
 * Mark dialogue tagging as failed
 * @param {number} sceneId
 * @param {string} errorMessage
 */
export async function markDialogueTaggingFailed(sceneId, errorMessage) {
  await pool.query(`
    UPDATE story_scenes
    SET dialogue_tagging_status = 'failed', dialogue_tagging_error = $1
    WHERE id = $2
  `, [errorMessage, sceneId]);
}

/**
 * Mark dialogue tagging as skipped
 * @param {number} sceneId
 */
export async function markDialogueTaggingSkipped(sceneId) {
  await pool.query(`
    UPDATE story_scenes
    SET dialogue_tagging_status = 'skipped'
    WHERE id = $1
  `, [sceneId]);
}

/**
 * Save CYOA choices for a scene
 * @param {string} sessionId
 * @param {number} sceneId
 * @param {Array} choices
 */
export async function saveChoices(sessionId, sceneId, choices) {
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    await pool.query(`
      INSERT INTO story_choices (
        story_session_id, scene_id, choice_index, choice_key, choice_text, choice_description
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      sessionId,
      sceneId,
      i,
      choice.key,
      choice.text,
      choice.description
    ]);
  }

  logger.info(`[SceneHelpers] Saved ${choices.length} choices for scene ${sceneId}`);
}

/**
 * Update session after scene generation
 * @param {string} sessionId
 */
export async function updateSessionAfterScene(sessionId) {
  await pool.query(`
    UPDATE story_sessions
    SET total_scenes = total_scenes + 1, last_activity_at = NOW()
    WHERE id = $1
  `, [sessionId]);
}

/**
 * Save audio data to scene.
 *
 * Note: Karaoke/read-along relies on `word_timings` being persisted on `story_scenes`
 * (not only on recording segments). This enables karaoke to work after refreshes and
 * outside recording playback.
 *
 * @param {string} sceneId
 * @param {string} audioUrl
 * @param {object} [options]
 * @param {object|null} [options.wordTimings]
 * @param {number|null} [options.durationSeconds]
 * @param {string|null} [options.voiceId]
 */
export async function saveSceneAudio(sceneId, audioUrl, options = {}) {
  const { wordTimings = null, durationSeconds = null, voiceId = null } = options || {};

  await pool.query(
    `UPDATE story_scenes
     SET audio_url = $1,
         audio_duration_seconds = COALESCE($2, audio_duration_seconds),
         voice_id = COALESCE($3, voice_id),
         word_timings = COALESCE($4, word_timings)
     WHERE id = $5`,
    [audioUrl, durationSeconds, voiceId, wordTimings ? JSON.stringify(wordTimings) : null, sceneId]
  );
}

/**
 * Get scene for on-demand audio generation
 * @param {number} sceneId
 * @param {string} sessionId
 * @returns {object|null} Scene data
 */
export async function getSceneForAudio(sceneId, sessionId) {
  const result = await pool.query(
    `SELECT
      id,
      polished_text,
      audio_url,
      audio_duration_seconds,
      voice_id,
      word_timings,
      dialogue_map,
      dialogue_tagging_status
    FROM story_scenes
    WHERE id = $1 AND story_session_id = $2`,
    [sceneId, sessionId]
  );

  return result.rows[0] || null;
}

/**
 * Build scene generation preferences from config
 * @param {object} options
 * @param {object} options.config - Session config_json
 * @param {boolean} options.isFinal - Whether this is the final scene
 * @param {number} options.sceneIndex
 * @param {number} options.targetScenes
 * @returns {object} Preferences for scene generation
 */
export function buildScenePreferences({ config, isFinal, sceneIndex, targetScenes }) {
  const plotSettings = config?.plot_settings || { structure: 'three_act', ensure_resolution: true };
  const seriesSettings = config?.series_settings || { protect_protagonist: true };
  const cyoaSettings = config?.cyoa_settings || { structure_type: 'diamond', max_branches: 3 };
  const storyFormat = config?.story_format || 'short_story';
  const storyLength = config?.story_length || 'medium';
  const intensity = config?.intensity || {};

  return {
    bedtime_mode: config?.bedtime_mode,
    is_final: isFinal,
    plot_structure: plotSettings.structure,
    ensure_resolution: plotSettings.ensure_resolution,
    subplot_count: plotSettings.subplot_count || 1,
    protect_protagonist: seriesSettings.protect_protagonist,
    open_ending: seriesSettings.open_ending,
    is_series: storyFormat === 'series' || storyFormat === 'novel',
    story_format: storyFormat,
    story_length: storyLength,
    cyoa_structure: config?.cyoa_enabled ? cyoaSettings.structure_type : null,
    author_style: config?.author_style || null,
    // Content settings for Venice.ai routing
    audience: config?.audience || 'general',
    intensity: intensity,
    gore: intensity.gore || 0,
    violence: intensity.violence || 0,
    romance: intensity.romance || 0,
    scary: intensity.scary || 0,
    adultContent: intensity.adultContent || 0
  };
}

export default {
  validateSceneContent,
  getSceneCount,
  getPreviousScene,
  getTargetSceneCount,
  determineMood,
  saveScene,
  saveDialogueMap,
  markDialogueTaggingFailed,
  markDialogueTaggingSkipped,
  saveChoices,
  updateSessionAfterScene,
  saveSceneAudio,
  getSceneForAudio,
  buildScenePreferences
};
