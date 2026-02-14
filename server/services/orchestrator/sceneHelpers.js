/**
 * Scene Helper Functions
 * Utilities for scene generation and management.
 *
 * Extracted from orchestrator.js for better maintainability.
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import {
  CONTEXT_LIMITS,
  SCENE_STORAGE,
  CONTENT_VALIDATION
} from '../../constants/sceneGeneration.js';

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
 * MEDIUM-9: Now imported from centralized constants
 */
const MIN_CONTENT_LENGTH = {
  displayText: CONTENT_VALIDATION.MIN_DISPLAY_TEXT_LENGTH,
  rawText: CONTENT_VALIDATION.MIN_RAW_TEXT_LENGTH
};

/**
 * Validate scene content to detect garbage LLM responses
 * Throws an error if content fails validation
 *
 * @param {string} rawText - Raw scene text
 * @param {string} displayText - Display-ready text (tags stripped)
 * @param {object} [options={}] - Validation options
 * @param {boolean} [options.multiVoice=true] - Whether multi-voice mode is enabled (dialogue check skipped for single-voice)
 * @throws {Error} If content is garbage/invalid
 * @returns {object} Validation result with details
 */
export function validateSceneContent(rawText, displayText, options = {}) {
  const { multiVoice = true } = options;
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

  // Repetition guard: detect duplicated sentences/paragraphs and high-frequency 5-grams
  const sentences = textToCheck.split(/(?<=[\\.\\?!])\s+/).map(s => s.trim()).filter(s => s.length > 20);
  const sentenceCounts = sentences.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
  const repeatedSentences = Object.entries(sentenceCounts).filter(([, c]) => c >= 3);
  if (repeatedSentences.length > 0) {
    const top = repeatedSentences[0][0];
    issues.push(`Repeated sentences detected (>=3x): "${top.substring(0,80)}..."`);
  }

  const paragraphs = textToCheck.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 40);
  const paragraphCounts = paragraphs.reduce((m, p) => (m[p] = (m[p] || 0) + 1, m), {});
  const repeatedParas = Object.entries(paragraphCounts).filter(([, c]) => c >= 2);
  if (repeatedParas.length > 0) {
    const top = repeatedParas[0][0];
    issues.push(`Repeated paragraphs detected (>=2x): "${top.substring(0,80)}..."`);
  }

  // 5-gram repetition
  const tokens = textToCheck.toLowerCase().split(/\s+/).filter(Boolean);
  const n = 5;
  const ngramCounts = {};
  for (let i = 0; i <= tokens.length - n; i++) {
    const key = tokens.slice(i, i + n).join(' ');
    ngramCounts[key] = (ngramCounts[key] || 0) + 1;
  }
  const maxNgram = Math.max(0, ...Object.values(ngramCounts));
  if (maxNgram >= 4) {
    const worst = Object.entries(ngramCounts).find(([, c]) => c === maxNgram)?.[0];
    issues.push(`High n-gram repetition: "${worst?.substring(0,80)}..." occurs ${maxNgram} times`);
  }

  // Dialogue density: require some quoted speech in long scenes
  // For tag-based multi-voice, also count speaker tags [SPEAKER: ...] as dialogue
  // SKIP for single-voice mode: narrator agent converts dialogue to prose, so speaker tags are removed
  if (multiVoice) {
    const quotedDialogue = (textToCheck.match(/"[^"]+"/g) || []).length;
    const speakerTags = (rawText.match(/\[[A-Z][^:\]]+:/g) || []).length;
    const dialogueCount = Math.max(quotedDialogue, speakerTags);
    if (wordCount > 300 && dialogueCount < 3) {
      issues.push(`Dialogue too sparse for length (${dialogueCount} dialogue entries over ${wordCount} words)`);
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

    // P0 FIX: Return last N chars (includes scene ending/climax) for better continuity
    // Previously only returned 200-300 chars which caused Chapter 2 to redo Chapter 1
    // MEDIUM-9: Now uses centralized constant
    const contextLength = CONTEXT_LIMITS.PREVIOUS_SCENE_CONTEXT_LENGTH;
    if (fullText.length > 0) {
      return fullText.length > contextLength ? fullText.slice(-contextLength) : fullText;
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
 * @param {boolean} [options.multiVoice=true] - Whether multi-voice mode is enabled
 * @returns {object} Scene record
 * @throws {Error} If content validation fails (unless skipValidation=true)
 */
export async function saveScene({ sessionId, sceneIndex, rawText, displayText, mood, skipValidation = false, multiVoice = true }) {
  // CRITICAL: Validate content before saving to prevent garbage responses
  if (!skipValidation) {
    try {
      const validation = validateSceneContent(rawText, displayText, { multiVoice });
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
    SCENE_STORAGE.DEFAULT_BRANCH_KEY,
    rawText,
    displayText,
    displayText.substring(0, SCENE_STORAGE.SUMMARY_MAX_LENGTH),  // MEDIUM-9: Use constant
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
    adultContent: intensity.adultContent || 0,
    // VAD settings - FOUNDATIONAL: These change HOW stories are written, not just post-processed
    multi_voice: config?.multi_voice === true,
    hide_speech_tags: config?.hide_speech_tags === true
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
