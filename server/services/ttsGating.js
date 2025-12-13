/**
 * TTS Gating Module
 * Controls when TTS (ElevenLabs) calls are allowed and tracks usage.
 *
 * Implements Section 3 of the Storyteller Gospel:
 * - Hard gating: No TTS until StoryReadyForAudio is true
 * - TTS_ENABLED debug mode: Simulate TTS without API calls
 * - TTS_MAX_CHARS_PER_STORY: Per-story character limit
 * - Character tracking per story
 *
 * MODEL: This is a UTILITY module - no LLM calls
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

// Configuration from environment
const NODE_ENV = process.env.NODE_ENV || 'development';
const TTS_ENABLED = process.env.TTS_ENABLED !== 'false'; // Default to enabled
const TTS_MAX_CHARS_PER_STORY = parseInt(process.env.TTS_MAX_CHARS_PER_STORY) || 50000; // ~10 minutes of audio
const TTS_WARN_THRESHOLD = 0.8; // Warn at 80% of limit

// FAIL LOUD: TTS debug mode (TTS_ENABLED=false) is only allowed in development
if (!TTS_ENABLED && NODE_ENV === 'production') {
  const error = new Error(
    'FATAL: TTS_ENABLED=false is not allowed in production. ' +
    'This would cause fake audio to be served to users. ' +
    'Either enable TTS or set NODE_ENV=development for testing.'
  );
  logger.error(error.message);
  throw error;
}

// In-memory tracking of TTS usage per session
const sessionTTSUsage = new Map();

// Track IO instances for emitting TTS status
const sessionIO = new Map();

/**
 * Check if TTS is globally enabled
 * @returns {boolean} True if TTS API calls are allowed
 */
export function isTTSEnabled() {
  return TTS_ENABLED;
}

/**
 * Get the per-story character limit
 * @returns {number} Maximum characters allowed per story
 */
export function getMaxCharsPerStory() {
  return TTS_MAX_CHARS_PER_STORY;
}

/**
 * Set IO instance for a session (for emitting TTS status events)
 * @param {string} sessionId - Story session ID
 * @param {Object} io - Socket.IO instance
 */
export function setSessionIO(sessionId, io) {
  sessionIO.set(sessionId, io);
}

/**
 * Get current TTS usage for a session
 * @param {string} sessionId - Story session ID
 * @returns {Object} Usage stats { charsUsed, charsRemaining, percentUsed, isAtLimit }
 */
export function getSessionUsage(sessionId) {
  const usage = sessionTTSUsage.get(sessionId) || { charsUsed: 0, segmentCount: 0 };
  const charsRemaining = Math.max(0, TTS_MAX_CHARS_PER_STORY - usage.charsUsed);
  const percentUsed = (usage.charsUsed / TTS_MAX_CHARS_PER_STORY) * 100;

  return {
    charsUsed: usage.charsUsed,
    charsRemaining,
    percentUsed: Math.round(percentUsed * 10) / 10, // 1 decimal place
    segmentCount: usage.segmentCount,
    maxChars: TTS_MAX_CHARS_PER_STORY,
    isAtLimit: charsRemaining <= 0,
    isNearLimit: percentUsed >= (TTS_WARN_THRESHOLD * 100)
  };
}

/**
 * Check if a TTS request is allowed for a session
 * @param {string} sessionId - Story session ID
 * @param {number} charCount - Number of characters to synthesize
 * @returns {Object} { allowed, reason, usage }
 */
export function canRequestTTS(sessionId, charCount = 0) {
  // Check if TTS is globally disabled
  if (!TTS_ENABLED) {
    return {
      allowed: false,
      reason: 'TTS is disabled (TTS_ENABLED=false). Running in text-only debug mode.',
      usage: getSessionUsage(sessionId),
      debugMode: true
    };
  }

  const usage = getSessionUsage(sessionId);

  // Check if already at limit
  if (usage.isAtLimit) {
    return {
      allowed: false,
      reason: `TTS character limit exceeded (${usage.charsUsed}/${TTS_MAX_CHARS_PER_STORY} chars used). No further audio generation allowed for this story.`,
      usage,
      debugMode: false
    };
  }

  // Check if this request would exceed limit
  const projectedUsage = usage.charsUsed + charCount;
  if (projectedUsage > TTS_MAX_CHARS_PER_STORY) {
    return {
      allowed: false,
      reason: `TTS request would exceed limit (${charCount} chars requested, only ${usage.charsRemaining} remaining).`,
      usage,
      debugMode: false
    };
  }

  // Allowed - emit warning if near limit
  if (usage.isNearLimit) {
    logger.warn(`[TTSGating] Session ${sessionId} approaching TTS limit: ${usage.percentUsed}% used`);
    emitTTSWarning(sessionId, usage);
  }

  return {
    allowed: true,
    reason: null,
    usage,
    debugMode: false
  };
}

/**
 * Record TTS usage for a session
 * @param {string} sessionId - Story session ID
 * @param {number} charCount - Characters synthesized
 * @param {number} audioBytes - Resulting audio size in bytes
 */
export function recordTTSUsage(sessionId, charCount, audioBytes = 0) {
  const current = sessionTTSUsage.get(sessionId) || {
    charsUsed: 0,
    segmentCount: 0,
    audioBytes: 0,
    timestamps: []
  };

  current.charsUsed += charCount;
  current.segmentCount += 1;
  current.audioBytes += audioBytes;
  current.timestamps.push({
    time: Date.now(),
    chars: charCount,
    bytes: audioBytes
  });

  sessionTTSUsage.set(sessionId, current);

  // Persist to database
  persistUsage(sessionId, current).catch(err => {
    logger.warn(`[TTSGating] Failed to persist usage: ${err.message}`);
  });

  // Emit usage update
  emitUsageUpdate(sessionId, getSessionUsage(sessionId));

  logger.info(`[TTSGating] Session ${sessionId}: +${charCount} chars, total ${current.charsUsed}/${TTS_MAX_CHARS_PER_STORY}`);

  return getSessionUsage(sessionId);
}

/**
 * Persist TTS usage to database
 */
async function persistUsage(sessionId, usage) {
  try {
    await pool.query(`
      UPDATE story_sessions
      SET tts_chars_used = $1,
          tts_segment_count = $2,
          tts_audio_bytes = $3
      WHERE id = $4
    `, [usage.charsUsed, usage.segmentCount, usage.audioBytes, sessionId]);
  } catch (error) {
    // If columns don't exist, try to add them
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      logger.info('[TTSGating] TTS tracking columns missing, attempting to add...');
      // Will be handled by migration
    }
    throw error;
  }
}

/**
 * Load TTS usage from database for a session
 * @param {string} sessionId - Story session ID
 */
export async function loadSessionUsage(sessionId) {
  try {
    const result = await pool.query(`
      SELECT tts_chars_used, tts_segment_count, tts_audio_bytes
      FROM story_sessions
      WHERE id = $1
    `, [sessionId]);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row.tts_chars_used !== null) {
        sessionTTSUsage.set(sessionId, {
          charsUsed: row.tts_chars_used || 0,
          segmentCount: row.tts_segment_count || 0,
          audioBytes: row.tts_audio_bytes || 0,
          timestamps: []
        });
        logger.info(`[TTSGating] Loaded usage for session ${sessionId}: ${row.tts_chars_used} chars`);
      }
    }
  } catch (error) {
    // Columns might not exist yet
    logger.debug(`[TTSGating] Could not load usage: ${error.message}`);
  }
}

/**
 * Reset TTS usage for a session (e.g., when starting a new story)
 * @param {string} sessionId - Story session ID
 */
export function resetSessionUsage(sessionId) {
  sessionTTSUsage.delete(sessionId);
  logger.info(`[TTSGating] Reset TTS usage for session ${sessionId}`);
}

/**
 * Emit TTS usage update to client
 */
function emitUsageUpdate(sessionId, usage) {
  const io = sessionIO.get(sessionId);
  if (io) {
    io.to(sessionId).emit('tts-usage-update', {
      sessionId,
      ...usage,
      timestamp: Date.now()
    });
  }
}

/**
 * Emit TTS warning to client
 */
function emitTTSWarning(sessionId, usage) {
  const io = sessionIO.get(sessionId);
  if (io) {
    io.to(sessionId).emit('tts-warning', {
      sessionId,
      message: `Approaching TTS character limit: ${usage.percentUsed}% used (${usage.charsUsed}/${usage.maxChars})`,
      usage,
      timestamp: Date.now()
    });
  }
}

/**
 * Emit TTS limit exceeded error to client
 */
export function emitTTSLimitExceeded(sessionId) {
  const usage = getSessionUsage(sessionId);
  const io = sessionIO.get(sessionId);
  if (io) {
    io.to(sessionId).emit('tts-limit-exceeded', {
      sessionId,
      message: 'TTS character limit exceeded. Audio generation stopped.',
      usage,
      timestamp: Date.now()
    });
  }

  logger.error(`[TTSGating] TTS LIMIT EXCEEDED for session ${sessionId}: ${usage.charsUsed}/${usage.maxChars} chars`);
}

/**
 * Simulate TTS for debug mode (when TTS_ENABLED=false)
 * Returns a fake audio buffer for testing pipeline without API calls
 * @param {string} text - Text that would be synthesized
 * @param {string} voiceId - Voice that would be used
 * @returns {Object} Simulated TTS result
 */
export function simulateTTS(text, voiceId) {
  const estimatedDuration = (text.length / 5 / 150) * 60; // ~150 words/min, ~5 chars/word
  const fakeByteSize = Math.round(estimatedDuration * 16000); // ~16KB/sec for MP3

  logger.info(`[TTSGating] SIMULATED TTS: "${text.substring(0, 50)}..." (${text.length} chars, ~${Math.round(estimatedDuration)}s)`);

  return {
    simulated: true,
    text,
    voiceId,
    charCount: text.length,
    estimatedDurationSeconds: estimatedDuration,
    fakeByteSize,
    message: 'TTS_ENABLED=false: Simulated TTS response for debug mode'
  };
}

/**
 * Get TTS configuration for display/debugging
 */
export function getTTSConfig() {
  return {
    enabled: TTS_ENABLED,
    maxCharsPerStory: TTS_MAX_CHARS_PER_STORY,
    warnThreshold: TTS_WARN_THRESHOLD,
    debugMode: !TTS_ENABLED
  };
}

/**
 * Cleanup session data (call when session ends)
 * @param {string} sessionId - Story session ID
 */
export function cleanupSession(sessionId) {
  sessionTTSUsage.delete(sessionId);
  sessionIO.delete(sessionId);
}

export default {
  isTTSEnabled,
  getMaxCharsPerStory,
  setSessionIO,
  getSessionUsage,
  canRequestTTS,
  recordTTSUsage,
  loadSessionUsage,
  resetSessionUsage,
  simulateTTS,
  getTTSConfig,
  cleanupSession,
  emitTTSLimitExceeded
};
