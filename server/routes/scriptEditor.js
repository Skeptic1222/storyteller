/**
 * Script Editor API Routes
 *
 * Provides endpoints for the Script Editor feature, which allows users to:
 * - Load a full script view of all scenes and segments
 * - Generate AI voice direction suggestions (emotion, stability, style, audio tags)
 * - Apply user overrides to individual segments
 * - Render TTS audio for individual or all segments
 * - Preview TTS without persisting
 * - Change character voices and cascade staleness
 * - Estimate rendering costs
 *
 * Database table: scene_voice_directions (migration 030)
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { ElevenLabsService } from '../services/elevenlabs.js';
import { canRequestTTS, recordTTSUsage, getSessionUsage, getMaxCharsPerStory } from '../services/ttsGating.js';
import { directVoiceActing } from '../services/agents/voiceDirectorAgent.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
wrapRoutes(router);
router.use(authenticateToken);

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Verify that the authenticated user owns the story session (or is admin).
 * Uses :sessionId param (distinct from stories.js which uses :id).
 */
async function requireSessionOwner(req, res, next) {
  try {
    const sessionId = req.params.sessionId;
    const result = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }
    if (result.rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    return next();
  } catch (error) {
    logger.error('[ScriptEditor] Error verifying session access:', error);
    return res.status(500).json({ error: 'Failed to verify session access' });
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve the effective value for a voice direction field.
 * User overrides take precedence over AI suggestions, with a fallback default.
 *
 * @param {*} userValue - User-provided override (may be null)
 * @param {*} aiValue - AI-generated suggestion (may be null)
 * @param {*} fallback - Default value if both are null
 * @returns {*} The resolved effective value
 */
function resolveEffective(userValue, aiValue, fallback) {
  if (userValue !== null && userValue !== undefined) return userValue;
  if (aiValue !== null && aiValue !== undefined) return aiValue;
  return fallback;
}

// =============================================================================
// 1. GET /:sessionId - Load full script
// =============================================================================

/**
 * GET /api/script-editor/:sessionId
 *
 * Load the full script for a story session, including all scenes, voice
 * direction segments, cast list, and TTS usage information.
 *
 * @returns {{ session, scenes, segments, cast, usage }}
 */
router.get('/:sessionId', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Fetch session info
    const sessionResult = await pool.query(
      `SELECT id, title, synopsis, mode, current_status, config_json,
              script_editor_state, voice_direction_preferences,
              tts_chars_used, tts_segment_count
       FROM story_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }
    const session = sessionResult.rows[0];

    // Fetch all scenes ordered by scene_order / sequence_index
    const scenesResult = await pool.query(
      `SELECT id, sequence_index, branch_key, summary, polished_text,
              mood, dialogue_map, scene_order
       FROM story_scenes
       WHERE story_session_id = $1
       ORDER BY COALESCE(scene_order, sequence_index)`,
      [sessionId]
    );

    // Fetch all voice direction segments joined with their scene
    const segmentsResult = await pool.query(
      `SELECT svd.*, ss.sequence_index AS scene_sequence_index
       FROM scene_voice_directions svd
       JOIN story_scenes ss ON svd.scene_id = ss.id
       WHERE svd.story_session_id = $1
       ORDER BY ss.sequence_index, svd.segment_index`,
      [sessionId]
    );

    // Fetch cast (characters assigned to this session)
    const castResult = await pool.query(
      `SELECT id, name, role, description, voice_id, voice_name, gender
       FROM characters
       WHERE story_session_id = $1
       ORDER BY role, name`,
      [sessionId]
    );

    // Calculate usage metrics
    const usage = getSessionUsage(sessionId);
    const renderedChars = segmentsResult.rows
      .filter(s => s.audio_status === 'rendered')
      .reduce((sum, s) => sum + (s.char_count || 0), 0);

    res.json({
      session,
      scenes: scenesResult.rows,
      segments: segmentsResult.rows,
      cast: castResult.rows,
      usage: {
        totalChars: usage.charsUsed,
        renderedChars,
        maxChars: usage.maxChars,
        percentUsed: usage.percentUsed,
        isNearLimit: usage.isNearLimit,
        isAtLimit: usage.isAtLimit
      }
    });

  } catch (error) {
    logger.error('[ScriptEditor] Error loading script:', error);
    res.status(500).json({ error: 'Failed to load script' });
  }
});

// =============================================================================
// 2. POST /:sessionId/generate-directions - AI voice direction generation
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/generate-directions
 *
 * Invoke the Voice Director Agent to generate AI emotion, stability, style,
 * and audio tag suggestions for every segment in the story. Existing AI
 * fields are updated, but user overrides are never touched.
 *
 * @returns {{ generated: number }}
 */
router.post('/:sessionId/generate-directions', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Load session config for genre/mood context
    const sessionResult = await pool.query(
      `SELECT config_json, title FROM story_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }
    const config = sessionResult.rows[0].config_json || {};

    // Load all scenes with their dialogue maps
    const scenesResult = await pool.query(
      `SELECT id, sequence_index, polished_text, dialogue_map, mood, summary
       FROM story_scenes
       WHERE story_session_id = $1
       ORDER BY COALESCE(scene_order, sequence_index)`,
      [sessionId]
    );

    if (scenesResult.rows.length === 0) {
      return res.status(400).json({ error: 'No scenes found for this session' });
    }

    let generatedCount = 0;

    for (const scene of scenesResult.rows) {
      const dialogueMap = scene.dialogue_map;
      if (!dialogueMap || !Array.isArray(dialogueMap) || dialogueMap.length === 0) {
        logger.warn(`[ScriptEditor] Scene ${scene.id} has no dialogue_map, skipping direction generation`);
        continue;
      }

      // Build segments array in the format directVoiceActing expects
      const segments = dialogueMap.map((entry, idx) => ({
        index: idx,
        speaker: entry.speaker || 'narrator',
        text: entry.quote || entry.text || '',
        isDialogue: entry.speaker && entry.speaker.toLowerCase() !== 'narrator'
      }));

      // Build context for the Voice Director Agent
      const context = {
        genre: config.genre || config.story_type || 'general',
        mood: scene.mood || config.mood || 'neutral',
        audience: config.audience || 'adult',
        sceneSummary: scene.summary || '',
        narratorArchetype: config.narrator_archetype || null
      };

      // Call Voice Director Agent
      let directedSegments;
      try {
        directedSegments = await directVoiceActing(segments, context, sessionId);
      } catch (agentError) {
        logger.error(`[ScriptEditor] Voice Director failed for scene ${scene.id}:`, agentError.message);
        continue;
      }

      // Upsert each directed segment into scene_voice_directions
      for (let i = 0; i < directedSegments.length; i++) {
        const seg = directedSegments[i];
        const originalEntry = dialogueMap[i] || {};
        const segmentText = originalEntry.quote || originalEntry.text || seg.text || '';
        const speaker = originalEntry.speaker || seg.speaker || 'narrator';

        // Extract AI direction values from the directed segment
        const aiEmotion = seg.detectedEmotion || seg.emotion || null;
        const aiV3AudioTags = seg.v3AudioTags || seg.delivery || null;
        const aiStability = seg.stability !== undefined ? seg.stability : null;
        const aiStyle = seg.style !== undefined ? seg.style : null;
        const aiReasoning = seg.reasoning || seg.directionReasoning || null;

        await pool.query(
          `INSERT INTO scene_voice_directions
             (id, story_session_id, scene_id, segment_index, speaker, segment_text,
              ai_emotion, ai_v3_audio_tags, ai_stability, ai_style, ai_reasoning,
              char_count, audio_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
           ON CONFLICT (scene_id, segment_index)
           DO UPDATE SET
             ai_emotion = EXCLUDED.ai_emotion,
             ai_v3_audio_tags = EXCLUDED.ai_v3_audio_tags,
             ai_stability = EXCLUDED.ai_stability,
             ai_style = EXCLUDED.ai_style,
             ai_reasoning = EXCLUDED.ai_reasoning,
             updated_at = NOW()`,
          [
            uuidv4(), sessionId, scene.id, i, speaker, segmentText,
            aiEmotion, aiV3AudioTags, aiStability, aiStyle, aiReasoning,
            segmentText.length
          ]
        );
        generatedCount++;
      }
    }

    logger.info(`[ScriptEditor] Generated voice directions for ${generatedCount} segments in session ${sessionId}`);

    res.json({ generated: generatedCount });

  } catch (error) {
    logger.error('[ScriptEditor] Error generating directions:', error);
    res.status(500).json({ error: 'Failed to generate voice directions' });
  }
});

// =============================================================================
// 3. PATCH /:sessionId/segment/:segmentId - Update user overrides
// =============================================================================

/**
 * PATCH /api/script-editor/:sessionId/segment/:segmentId
 *
 * Apply user overrides to a single voice direction segment. Only fields
 * present in the request body are updated. If the segment was previously
 * rendered, its audio_status is set to 'stale'.
 *
 * @param {Object} body - { user_emotion, user_v3_audio_tags, user_stability, user_style, user_custom_tags }
 * @returns {Object} The updated segment row
 */
router.patch('/:sessionId/segment/:segmentId', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId, segmentId } = req.params;
    const { user_emotion, user_v3_audio_tags, user_stability, user_style, user_custom_tags } = req.body;

    // Verify the segment belongs to this session
    const existing = await pool.query(
      `SELECT id, audio_status FROM scene_voice_directions
       WHERE id = $1 AND story_session_id = $2`,
      [segmentId, sessionId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found in this session' });
    }

    // Build dynamic SET clause for only non-null fields
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (user_emotion !== undefined) {
      setClauses.push(`user_emotion = $${paramIndex++}`);
      values.push(user_emotion);
    }
    if (user_v3_audio_tags !== undefined) {
      setClauses.push(`user_v3_audio_tags = $${paramIndex++}`);
      values.push(user_v3_audio_tags);
    }
    if (user_stability !== undefined) {
      setClauses.push(`user_stability = $${paramIndex++}`);
      values.push(user_stability);
    }
    if (user_style !== undefined) {
      setClauses.push(`user_style = $${paramIndex++}`);
      values.push(user_style);
    }
    if (user_custom_tags !== undefined) {
      setClauses.push(`user_custom_tags = $${paramIndex++}`);
      values.push(user_custom_tags);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Always update timestamp
    setClauses.push(`updated_at = NOW()`);

    // Mark as stale if previously rendered
    if (existing.rows[0].audio_status === 'rendered') {
      setClauses.push(`audio_status = 'stale'`);
    }

    values.push(segmentId);
    values.push(sessionId);

    const result = await pool.query(
      `UPDATE scene_voice_directions
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex++} AND story_session_id = $${paramIndex}
       RETURNING *`,
      values
    );

    logger.info(`[ScriptEditor] Updated user overrides for segment ${segmentId} in session ${sessionId}`);

    res.json(result.rows[0]);

  } catch (error) {
    logger.error('[ScriptEditor] Error updating segment:', error);
    res.status(500).json({ error: 'Failed to update segment' });
  }
});

// =============================================================================
// 4. POST /:sessionId/segment/:segmentId/render - TTS render one segment
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/segment/:segmentId/render
 *
 * Generate TTS audio for a single voice direction segment. Resolves
 * effective values from user overrides / AI suggestions, calls ElevenLabs,
 * persists the audio file and metadata, and records TTS usage.
 *
 * @returns {{ audio_url, duration_ms, word_timings }}
 */
router.post('/:sessionId/segment/:segmentId/render', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId, segmentId } = req.params;

    // Load segment
    const segResult = await pool.query(
      `SELECT svd.*, c.voice_id AS character_voice_id, c.voice_name AS character_voice_name
       FROM scene_voice_directions svd
       LEFT JOIN characters c ON c.story_session_id = svd.story_session_id
         AND LOWER(c.name) = LOWER(svd.speaker)
       WHERE svd.id = $1 AND svd.story_session_id = $2`,
      [segmentId, sessionId]
    );
    if (segResult.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found in this session' });
    }
    const segment = segResult.rows[0];

    // Resolve effective direction values
    const emotion = resolveEffective(segment.user_emotion, segment.ai_emotion, 'neutral');
    const v3AudioTags = resolveEffective(segment.user_v3_audio_tags, segment.ai_v3_audio_tags, null);
    const stability = resolveEffective(segment.user_stability, segment.ai_stability, 0.5);
    const style = resolveEffective(segment.user_style, segment.ai_style, 0.5);
    const voiceId = segment.voice_id || segment.character_voice_id || null;

    // Check TTS gating
    const charCount = segment.char_count || segment.segment_text.length;
    const gateCheck = canRequestTTS(sessionId, charCount);
    if (!gateCheck.allowed) {
      return res.status(429).json({
        error: gateCheck.reason,
        usage: gateCheck.usage
      });
    }

    // Generate TTS
    const tts = new ElevenLabsService();
    const ttsResult = await tts.textToSpeechWithTimestamps(
      segment.segment_text,
      voiceId,
      {
        sessionId,
        detectedEmotion: emotion,
        v3AudioTags: v3AudioTags,
        stability,
        style,
        speaker: segment.speaker
      }
    );

    // Build audio URL from result
    const audioUrl = ttsResult.audioUrl || ttsResult.audio_url || null;
    const durationMs = ttsResult.durationSeconds
      ? Math.round(ttsResult.durationSeconds * 1000)
      : (ttsResult.duration_ms || null);
    const wordTimings = ttsResult.wordTimings || ttsResult.word_timings || null;

    // Persist render result to the segment row
    await pool.query(
      `UPDATE scene_voice_directions
       SET audio_url = $1,
           audio_duration_ms = $2,
           word_timings = $3,
           audio_status = 'rendered',
           voice_id = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [audioUrl, durationMs, wordTimings ? JSON.stringify(wordTimings) : null, voiceId, segmentId]
    );

    // Record TTS usage
    recordTTSUsage(sessionId, charCount);

    logger.info(`[ScriptEditor] Rendered segment ${segmentId}: ${charCount} chars, ${durationMs}ms`);

    res.json({
      audio_url: audioUrl,
      duration_ms: durationMs,
      word_timings: wordTimings
    });

  } catch (error) {
    logger.error('[ScriptEditor] Error rendering segment:', error);
    res.status(500).json({ error: 'Failed to render segment audio' });
  }
});

// =============================================================================
// 5. POST /:sessionId/segment/:segmentId/preview - Quick TTS preview
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/segment/:segmentId/preview
 *
 * Generate a quick TTS preview for a segment without persisting to the DB.
 * If the segment text exceeds 200 characters, only the first 200 are used.
 * Returns the raw audio buffer as an MP3 response.
 *
 * @returns {Buffer} MP3 audio stream
 */
router.post('/:sessionId/segment/:segmentId/preview', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId, segmentId } = req.params;

    // Load segment
    const segResult = await pool.query(
      `SELECT svd.*, c.voice_id AS character_voice_id
       FROM scene_voice_directions svd
       LEFT JOIN characters c ON c.story_session_id = svd.story_session_id
         AND LOWER(c.name) = LOWER(svd.speaker)
       WHERE svd.id = $1 AND svd.story_session_id = $2`,
      [segmentId, sessionId]
    );
    if (segResult.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found in this session' });
    }
    const segment = segResult.rows[0];

    // Use truncated text for preview
    const previewText = segment.segment_text.length > 200
      ? segment.segment_text.substring(0, 200) + '...'
      : segment.segment_text;

    // Resolve effective direction values
    const emotion = resolveEffective(segment.user_emotion, segment.ai_emotion, 'neutral');
    const v3AudioTags = resolveEffective(segment.user_v3_audio_tags, segment.ai_v3_audio_tags, null);
    const stability = resolveEffective(segment.user_stability, segment.ai_stability, 0.5);
    const style = resolveEffective(segment.user_style, segment.ai_style, 0.5);
    const voiceId = segment.voice_id || segment.character_voice_id || null;

    // Generate TTS (not persisted)
    const tts = new ElevenLabsService();
    const ttsResult = await tts.textToSpeechWithTimestamps(
      previewText,
      voiceId,
      {
        sessionId,
        detectedEmotion: emotion,
        v3AudioTags: v3AudioTags,
        stability,
        style,
        speaker: segment.speaker
      }
    );

    // Return raw audio as MP3
    if (ttsResult.audio && Buffer.isBuffer(ttsResult.audio)) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', ttsResult.audio.length);
      return res.send(ttsResult.audio);
    }

    // Fallback: return the audio URL if no buffer available
    res.json({
      audio_url: ttsResult.audioUrl || ttsResult.audio_url || null,
      preview: true,
      text_length: previewText.length
    });

  } catch (error) {
    logger.error('[ScriptEditor] Error previewing segment:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// =============================================================================
// 6. POST /:sessionId/render-all - Batch render pending/stale segments
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/render-all
 *
 * Batch-render all segments with audio_status IN ('pending', 'stale').
 * Segments are processed sequentially to avoid ElevenLabs rate limits.
 *
 * @returns {{ rendered: number, failed: number, errors: Array }}
 */
router.post('/:sessionId/render-all', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Load all pending/stale segments
    const pendingResult = await pool.query(
      `SELECT svd.*, c.voice_id AS character_voice_id, c.voice_name AS character_voice_name
       FROM scene_voice_directions svd
       LEFT JOIN characters c ON c.story_session_id = svd.story_session_id
         AND LOWER(c.name) = LOWER(svd.speaker)
       WHERE svd.story_session_id = $1 AND svd.audio_status IN ('pending', 'stale')
       ORDER BY svd.created_at`,
      [sessionId]
    );

    if (pendingResult.rows.length === 0) {
      return res.json({ rendered: 0, failed: 0, errors: [], message: 'No segments need rendering' });
    }

    // Check total char count against TTS quota
    const totalChars = pendingResult.rows.reduce((sum, s) => sum + (s.char_count || s.segment_text.length), 0);
    const gateCheck = canRequestTTS(sessionId, totalChars);
    if (!gateCheck.allowed) {
      return res.status(429).json({
        error: gateCheck.reason,
        usage: gateCheck.usage,
        pendingSegments: pendingResult.rows.length,
        totalChars
      });
    }

    const tts = new ElevenLabsService();
    let rendered = 0;
    let failed = 0;
    const errors = [];

    // Process sequentially to respect rate limits
    for (const segment of pendingResult.rows) {
      try {
        const emotion = resolveEffective(segment.user_emotion, segment.ai_emotion, 'neutral');
        const v3AudioTags = resolveEffective(segment.user_v3_audio_tags, segment.ai_v3_audio_tags, null);
        const stability = resolveEffective(segment.user_stability, segment.ai_stability, 0.5);
        const style = resolveEffective(segment.user_style, segment.ai_style, 0.5);
        const voiceId = segment.voice_id || segment.character_voice_id || null;

        const charCount = segment.char_count || segment.segment_text.length;

        // Per-segment gating check
        const segGateCheck = canRequestTTS(sessionId, charCount);
        if (!segGateCheck.allowed) {
          errors.push({
            segmentId: segment.id,
            speaker: segment.speaker,
            error: segGateCheck.reason
          });
          failed++;
          continue;
        }

        const ttsResult = await tts.textToSpeechWithTimestamps(
          segment.segment_text,
          voiceId,
          {
            sessionId,
            detectedEmotion: emotion,
            v3AudioTags,
            stability,
            style,
            speaker: segment.speaker
          }
        );

        const audioUrl = ttsResult.audioUrl || ttsResult.audio_url || null;
        const durationMs = ttsResult.durationSeconds
          ? Math.round(ttsResult.durationSeconds * 1000)
          : (ttsResult.duration_ms || null);
        const wordTimings = ttsResult.wordTimings || ttsResult.word_timings || null;

        await pool.query(
          `UPDATE scene_voice_directions
           SET audio_url = $1,
               audio_duration_ms = $2,
               word_timings = $3,
               audio_status = 'rendered',
               voice_id = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [audioUrl, durationMs, wordTimings ? JSON.stringify(wordTimings) : null, voiceId, segment.id]
        );

        recordTTSUsage(sessionId, charCount);
        rendered++;

      } catch (segError) {
        logger.error(`[ScriptEditor] Batch render failed for segment ${segment.id}:`, segError.message);
        errors.push({
          segmentId: segment.id,
          speaker: segment.speaker,
          error: segError.message
        });
        failed++;
      }
    }

    logger.info(`[ScriptEditor] Batch render complete for session ${sessionId}: ${rendered} rendered, ${failed} failed`);

    res.json({ rendered, failed, errors });

  } catch (error) {
    logger.error('[ScriptEditor] Error in batch render:', error);
    res.status(500).json({ error: 'Failed to batch render segments' });
  }
});

// =============================================================================
// 7. POST /:sessionId/assemble - FFmpeg stitch final audio
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/assemble
 *
 * Assemble all rendered audio segments into a single final audio file
 * using FFmpeg concatenation. Currently returns 501 Not Implemented.
 *
 * @returns {{ message: string }}
 */
router.post('/:sessionId/assemble', requireAuth, requireSessionOwner, async (req, res) => {
  // TODO: Will use ffmpeg to concatenate audio segments in order
  return res.status(501).json({ message: 'Assembly not yet implemented' });
});

// =============================================================================
// 8. PATCH /:sessionId/character/:charId/voice - Change character voice
// =============================================================================

/**
 * PATCH /api/script-editor/:sessionId/character/:charId/voice
 *
 * Update the ElevenLabs voice assigned to a character. All existing
 * voice direction segments for that speaker are marked 'stale' so they
 * will be re-rendered with the new voice on the next render pass.
 *
 * @param {Object} body - { voice_id, voice_name }
 * @returns {{ updated: number }}
 */
router.patch('/:sessionId/character/:charId/voice', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId, charId } = req.params;
    const { voice_id, voice_name } = req.body;

    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    // Verify character belongs to this session and get the name
    const charResult = await pool.query(
      `SELECT id, name FROM characters
       WHERE id = $1 AND story_session_id = $2`,
      [charId, sessionId]
    );
    if (charResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found in this session' });
    }
    const characterName = charResult.rows[0].name;

    // Update character voice
    await pool.query(
      `UPDATE characters SET voice_id = $1, voice_name = $2 WHERE id = $3`,
      [voice_id, voice_name || null, charId]
    );

    // Mark all segments for this speaker as stale (case-insensitive match)
    const staleResult = await pool.query(
      `UPDATE scene_voice_directions
       SET audio_status = 'stale', updated_at = NOW()
       WHERE story_session_id = $1
         AND LOWER(speaker) = LOWER($2)
         AND audio_status = 'rendered'
       RETURNING id`,
      [sessionId, characterName]
    );

    const updatedCount = staleResult.rowCount;

    logger.info(`[ScriptEditor] Changed voice for "${characterName}" to ${voice_id}, marked ${updatedCount} segments stale`);

    res.json({ updated: updatedCount });

  } catch (error) {
    logger.error('[ScriptEditor] Error changing character voice:', error);
    res.status(500).json({ error: 'Failed to change character voice' });
  }
});

// =============================================================================
// 9. POST /:sessionId/rerun-voice-direction - Force regenerate all directions
// =============================================================================

/**
 * POST /api/script-editor/:sessionId/rerun-voice-direction
 *
 * Force-regenerate AI voice directions for all segments. Unlike
 * generate-directions, this always overwrites existing AI suggestions
 * (user overrides are still preserved).
 *
 * @returns {{ regenerated: number }}
 */
router.post('/:sessionId/rerun-voice-direction', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Clear existing AI fields so they are fully regenerated
    await pool.query(
      `UPDATE scene_voice_directions
       SET ai_emotion = NULL,
           ai_v3_audio_tags = NULL,
           ai_stability = NULL,
           ai_style = NULL,
           ai_reasoning = NULL,
           updated_at = NOW()
       WHERE story_session_id = $1`,
      [sessionId]
    );

    // Load session config
    const sessionResult = await pool.query(
      `SELECT config_json, title FROM story_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }
    const config = sessionResult.rows[0].config_json || {};

    // Load all scenes
    const scenesResult = await pool.query(
      `SELECT id, sequence_index, polished_text, dialogue_map, mood, summary
       FROM story_scenes
       WHERE story_session_id = $1
       ORDER BY COALESCE(scene_order, sequence_index)`,
      [sessionId]
    );

    let regeneratedCount = 0;

    for (const scene of scenesResult.rows) {
      const dialogueMap = scene.dialogue_map;
      if (!dialogueMap || !Array.isArray(dialogueMap) || dialogueMap.length === 0) {
        continue;
      }

      const segments = dialogueMap.map((entry, idx) => ({
        index: idx,
        speaker: entry.speaker || 'narrator',
        text: entry.quote || entry.text || '',
        isDialogue: entry.speaker && entry.speaker.toLowerCase() !== 'narrator'
      }));

      const context = {
        genre: config.genre || config.story_type || 'general',
        mood: scene.mood || config.mood || 'neutral',
        audience: config.audience || 'adult',
        sceneSummary: scene.summary || '',
        narratorArchetype: config.narrator_archetype || null
      };

      let directedSegments;
      try {
        directedSegments = await directVoiceActing(segments, context, sessionId);
      } catch (agentError) {
        logger.error(`[ScriptEditor] Rerun: Voice Director failed for scene ${scene.id}:`, agentError.message);
        continue;
      }

      for (let i = 0; i < directedSegments.length; i++) {
        const seg = directedSegments[i];

        const aiEmotion = seg.detectedEmotion || seg.emotion || null;
        const aiV3AudioTags = seg.v3AudioTags || seg.delivery || null;
        const aiStability = seg.stability !== undefined ? seg.stability : null;
        const aiStyle = seg.style !== undefined ? seg.style : null;
        const aiReasoning = seg.reasoning || seg.directionReasoning || null;

        await pool.query(
          `UPDATE scene_voice_directions
           SET ai_emotion = $1,
               ai_v3_audio_tags = $2,
               ai_stability = $3,
               ai_style = $4,
               ai_reasoning = $5,
               updated_at = NOW()
           WHERE scene_id = $6 AND segment_index = $7`,
          [aiEmotion, aiV3AudioTags, aiStability, aiStyle, aiReasoning, scene.id, i]
        );
        regeneratedCount++;
      }
    }

    logger.info(`[ScriptEditor] Regenerated voice directions for ${regeneratedCount} segments in session ${sessionId}`);

    res.json({ regenerated: regeneratedCount });

  } catch (error) {
    logger.error('[ScriptEditor] Error rerunning voice direction:', error);
    res.status(500).json({ error: 'Failed to regenerate voice directions' });
  }
});

// =============================================================================
// 10. GET /:sessionId/usage-estimate - Cost estimate for pending renders
// =============================================================================

/**
 * GET /api/script-editor/:sessionId/usage-estimate
 *
 * Compute a cost estimate for all pending and stale segments that would
 * need TTS rendering. Uses ElevenLabs v3 pricing (~$0.30 per 1000 chars).
 *
 * @returns {{ pendingSegments, totalChars, estimatedCost, remainingQuota }}
 */
router.get('/:sessionId/usage-estimate', requireAuth, requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Count pending/stale segments and total characters
    const pendingResult = await pool.query(
      `SELECT
         COUNT(*) AS pending_segments,
         COALESCE(SUM(char_count), 0) AS total_chars
       FROM scene_voice_directions
       WHERE story_session_id = $1
         AND audio_status IN ('pending', 'stale')`,
      [sessionId]
    );

    const pendingSegments = parseInt(pendingResult.rows[0].pending_segments, 10);
    const totalChars = parseInt(pendingResult.rows[0].total_chars, 10);

    // ElevenLabs v3 pricing: approximately $0.30 per 1000 characters
    const COST_PER_1000_CHARS = 0.30;
    const estimatedCost = Math.round((totalChars / 1000) * COST_PER_1000_CHARS * 100) / 100;

    // Remaining quota from TTS gating
    const usage = getSessionUsage(sessionId);
    const maxChars = getMaxCharsPerStory();
    const remainingQuota = Math.max(0, maxChars - usage.charsUsed);

    res.json({
      pendingSegments,
      totalChars,
      estimatedCost,
      remainingQuota,
      maxChars,
      costPer1000Chars: COST_PER_1000_CHARS,
      canRenderAll: totalChars <= remainingQuota
    });

  } catch (error) {
    logger.error('[ScriptEditor] Error calculating usage estimate:', error);
    res.status(500).json({ error: 'Failed to calculate usage estimate' });
  }
});

export default router;
