/**
 * Library Routes
 * Handles story library, bookmarks, reading progress, and e-reader features
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes } from '../middleware/errorHandler.js';
import { cache } from '../services/cache.js';
import { authenticateToken, requireAuth, optionalAuth } from '../middleware/auth.js';

// Cache TTLs for library endpoints
const CACHE_TTL = {
  LIBRARY_LIST: 60,    // 1 minute - user's library changes frequently
  STORY_DETAIL: 300,   // 5 minutes - story details rarely change during read
  STORY_COUNT: 120     // 2 minutes - aggregate counts
};

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

/**
 * HTML escape helper to prevent XSS attacks
 * FAIL LOUD: This is critical for security - used in HTML exports
 * @param {string} str - Untrusted string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') {
    logger.warn(`[Security] escapeHtml received non-string: ${typeof str}`);
    str = String(str);
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize filename for Content-Disposition header
 * Prevents header injection attacks
 * @param {string} filename - Untrusted filename
 * @returns {string} Safe filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'story';
  // Remove any characters that could be used for header injection
  return filename
    .replace(/["\n\r\t\\]/g, '') // Remove quotes, newlines, tabs, backslashes
    .replace(/[^a-zA-Z0-9_\-. ]/g, '_') // Replace other special chars with underscore
    .substring(0, 100); // Limit length
}

/**
 * GET /api/library
 * Get user's story library with progress
 * SECURITY: Requires authentication - uses req.user.id, not query params
 */
router.get('/', authenticateToken, requireAuth, async (req, res) => {
  try {
    // SECURITY FIX: Use authenticated user ID, not from query params (IDOR prevention)
    const userId = req.user.id;
    const filter = req.query.filter || 'all'; // all, in_progress, completed, favorites
    const category = req.query.category || 'all';

    // PERFORMANCE: Check cache first
    const cacheKey = `library:${userId}:${filter}:${category}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`[Library] Cache HIT for ${cacheKey}`);
      return res.json(cached);
    }

    // FIX: Always exclude abandoned stories (unless specifically showing all)
    // Abandoned stories are partial/cancelled sessions that shouldn't appear in library
    let whereClause = "WHERE s.user_id = $1 AND s.current_status IS DISTINCT FROM 'abandoned'";
    if (filter === 'in_progress') {
      whereClause += " AND COALESCE(s.current_status, 'planning') NOT IN ('finished')";
    } else if (filter === 'completed') {
      whereClause += " AND s.current_status = 'finished'";
    } else if (filter === 'favorites') {
      whereClause += ' AND s.is_favorite = true';
    }

    logger.info(`[Library] Cache MISS for ${cacheKey} - fetching from DB`);

    // OPTIMIZED: Use CTEs instead of correlated subqueries to fix N+1 pattern
    // This runs the subqueries once and JOINs the results instead of per-row
    const result = await pool.query(`
      WITH first_scenes AS (
        -- Get first scene for each session (runs once, not per row)
        SELECT DISTINCT ON (story_session_id)
          story_session_id,
          polished_text as first_scene_preview
        FROM story_scenes
        ORDER BY story_session_id, sequence_index
      ),
      bookmark_counts AS (
        -- Count non-auto bookmarks per session (runs once, not per row)
        SELECT story_session_id, COUNT(*) as bookmark_count
        FROM bookmarks
        WHERE NOT is_auto_bookmark
        GROUP BY story_session_id
      ),
      actual_scene_counts AS (
        -- Count actual scenes per session (fixes sync issues with total_scenes counter)
        SELECT story_session_id, COUNT(*) as scene_count
        FROM story_scenes
        GROUP BY story_session_id
      )
      SELECT
        s.id,
        s.title,
        s.mode,
        s.cyoa_enabled,
        s.current_status,
        COALESCE(scene_counts.scene_count, 0) as total_scenes,
        s.current_scene_index,
        s.is_favorite,
        s.cover_image_url,
        s.synopsis,
        s.started_at,
        s.ended_at,
        s.last_read_at,
        s.last_activity_at,
        s.total_reading_time_seconds,
        s.config_json,
        o.themes,
        COALESCE(fs.first_scene_preview, '') as first_scene_preview,
        COALESCE(bc.bookmark_count, 0) as bookmark_count,
        CASE
          WHEN COALESCE(scene_counts.scene_count, 0) > 0 THEN
            ROUND((COALESCE(s.current_scene_index, 0)::NUMERIC / scene_counts.scene_count) * 100)
          ELSE 0
        END as progress_percent
      FROM story_sessions s
      LEFT JOIN story_outlines o ON o.story_session_id = s.id
      LEFT JOIN first_scenes fs ON fs.story_session_id = s.id
      LEFT JOIN bookmark_counts bc ON bc.story_session_id = s.id
      LEFT JOIN actual_scene_counts scene_counts ON scene_counts.story_session_id = s.id
      ${whereClause}
      ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC
    `, [userId]);

    const response = {
      stories: result.rows,
      count: result.rows.length,
      filter,
      category
    };

    // PERFORMANCE: Cache the response
    await cache.set(cacheKey, response, CACHE_TTL.LIBRARY_LIST);

    res.json(response);

  } catch (error) {
    logger.error('Error fetching library:', error);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

/**
 * GET /api/library/:storyId
 * Get full story details for reading
 * Prioritizes recording_segments for audio URLs when available (permanent storage)
 */
router.get('/:storyId', async (req, res) => {
  try {
    const { storyId } = req.params;

    // PERFORMANCE: Check cache first
    const cacheKey = `story:${storyId}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`[Library] Cache HIT for ${cacheKey}`);
      return res.json(cached);
    }

    // OPTIMIZED: Parallelize independent queries
    // Phase 1: Get session + recording in parallel (recording needed for scenes query)
    const [session, recording] = await Promise.all([
      pool.query(`
        SELECT s.*, o.outline_json, o.themes
        FROM story_sessions s
        LEFT JOIN story_outlines o ON o.story_session_id = s.id
        WHERE s.id = $1
      `, [storyId]),
      pool.query(`
        SELECT r.id, r.is_complete, r.scene_count
        FROM story_recordings r
        WHERE r.story_session_id = $1
        ORDER BY r.created_at DESC
        LIMIT 1
      `, [storyId])
    ]);

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const hasRecording = recording.rows.length > 0;
    const recordingId = hasRecording ? recording.rows[0].id : null;

    // Phase 2: Get scenes, characters, bookmarks in parallel (all independent)
    const [scenes, characters, bookmarks] = await Promise.all([
      // Scenes query - joins with recording_segments if available
      // Also aggregates SFX data from scene_sfx table with audio URLs from sfx_cache
      pool.query(`
        SELECT
          sc.id,
          sc.sequence_index,
          sc.branch_key,
          sc.polished_text,
          sc.summary,
          COALESCE(rs.audio_url, sc.audio_url) as audio_url,
          COALESCE(rs.duration_seconds, sc.audio_duration_seconds) as audio_duration_seconds,
          COALESCE(rs.word_timings, sc.word_timings) as word_timings,
          sc.mood,
          sc.word_count,
          COALESCE(
            NULLIF(rs.sfx_data::jsonb, '[]'::jsonb),
            (SELECT jsonb_agg(jsonb_build_object(
              'sfx_id', sf.id,
              'sfx_key', sf.sfx_key,
              'volume', sf.volume,
              'trigger_at_seconds', sf.start_offset_seconds,
              'duration_seconds', COALESCE(sfc.duration_seconds, 30),
              'fade_in_ms', (sf.fade_in_seconds * 1000)::int,
              'fade_out_ms', (sf.fade_out_seconds * 1000)::int,
              'audio_url', CASE
                WHEN sfc.file_path IS NOT NULL
                THEN REPLACE(sfc.file_path, 'C:\\inetpub\\wwwroot\\storyteller\\public', '')
                ELSE NULL
              END,
              'loop', sfc.is_looping
            )) FROM scene_sfx sf
            LEFT JOIN sfx_cache sfc ON sf.sfx_cache_id = sfc.id
            WHERE sf.scene_id = sc.id)
          ) as sfx_data,
          (SELECT json_agg(json_build_object(
            'id', c.id,
            'key', c.choice_key,
            'text', c.choice_text,
            'selected', c.was_selected
          )) FROM story_choices c WHERE c.scene_id = sc.id) as choices
        FROM story_scenes sc
        LEFT JOIN recording_segments rs ON rs.scene_id = sc.id AND rs.recording_id = $2
        WHERE sc.story_session_id = $1
        ORDER BY sc.sequence_index
      `, [storyId, recordingId]),
      // Characters query
      pool.query(`
        SELECT c.*, cva.elevenlabs_voice_id as assigned_voice_id
        FROM characters c
        LEFT JOIN character_voice_assignments cva ON cva.character_id = c.id
        WHERE c.story_session_id = $1
      `, [storyId]),
      // Bookmarks query
      pool.query(`
        SELECT b.*, sc.sequence_index as scene_index
        FROM bookmarks b
        LEFT JOIN story_scenes sc ON sc.id = b.scene_id
        WHERE b.story_session_id = $1
        ORDER BY sc.sequence_index, b.text_position
      `, [storyId])
    ]);

    // Include recording metadata
    const recordingInfo = hasRecording ? {
      hasRecording: true,
      recordingId: recording.rows[0].id,
      isComplete: recording.rows[0].is_complete,
      sceneCount: recording.rows[0].scene_count
    } : { hasRecording: false };

    const response = {
      story: session.rows[0],
      scenes: scenes.rows,
      characters: characters.rows,
      bookmarks: bookmarks.rows,
      recording: recordingInfo,
      total_duration: scenes.rows.reduce((sum, s) => sum + (s.audio_duration_seconds || 0), 0),
      total_words: scenes.rows.reduce((sum, s) => sum + (s.word_count || 0), 0)
    };

    // PERFORMANCE: Cache the response
    await cache.set(cacheKey, response, CACHE_TTL.STORY_DETAIL);

    res.json(response);

  } catch (error) {
    logger.error('Error fetching story:', error);
    res.status(500).json({ error: 'Failed to fetch story' });
  }
});

/**
 * POST /api/library/:storyId/progress
 * Update reading progress
 * SECURITY: Requires authentication - uses req.user.id
 */
router.post('/:storyId/progress', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { storyId } = req.params;
    const { scene_id, scene_index, audio_position, reading_time } = req.body;
    // SECURITY FIX: Use authenticated user ID, not from body (IDOR prevention)
    const userId = req.user.id;

    // Update session - always works even without scene_id
    const updateResult = await pool.query(`
      UPDATE story_sessions
      SET current_scene_index = COALESCE($1, current_scene_index),
          last_read_scene_id = COALESCE($2, last_read_scene_id),
          last_read_at = NOW(),
          total_reading_time_seconds = COALESCE(total_reading_time_seconds, 0) + COALESCE($3, 0),
          last_activity_at = NOW()
      WHERE id = $4 AND user_id = $5
      RETURNING id
    `, [scene_index, scene_id, reading_time || 0, storyId, userId]);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Only create/update auto-bookmark if we have a scene_id
    // SECURITY: Now that auth is required, all users are authenticated
    if (scene_id) {
      try {
        // First try to update existing auto-bookmark for this session
        const updateResult = await pool.query(`
          UPDATE bookmarks
          SET scene_id = $3, audio_position_seconds = $4, updated_at = NOW()
          WHERE story_session_id = $2 AND is_auto_bookmark = true
        `, [userId, storyId, scene_id, audio_position || 0]);

        // If no auto-bookmark exists, create one
        if (updateResult.rowCount === 0) {
          await pool.query(`
            INSERT INTO bookmarks (user_id, story_session_id, scene_id, name, audio_position_seconds, is_auto_bookmark)
            VALUES ($1, $2, $3, 'Last Position', $4, true)
          `, [userId, storyId, scene_id, audio_position || 0]);
        }
      } catch (bookmarkErr) {
        // Bookmark failed but progress still saved - log but don't fail
        logger.warn('Auto-bookmark creation failed:', bookmarkErr.message || bookmarkErr);
      }

      // Log to reading history
      try {
        await pool.query(`
          INSERT INTO reading_history (user_id, story_session_id, scene_id, mode, duration_seconds)
          VALUES ($1, $2, $3, $4, $5)
        `, [userId, storyId, scene_id, req.body.mode || 'audio', reading_time || 0]);
      } catch (historyErr) {
        logger.warn('Reading history log failed:', historyErr.message);
      }
    }

    await cache.delPattern(`library:${userId}:*`);

    res.json({ message: 'Progress saved' });

  } catch (error) {
    logger.error('Error saving progress:', error);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

/**
 * POST /api/library/:storyId/bookmark
 * Create a bookmark
 * SECURITY: Requires authentication - uses req.user.id
 */
router.post('/:storyId/bookmark', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { storyId } = req.params;
    const { scene_id, name, note, color, text_position, audio_position } = req.body;
    // SECURITY FIX: Use authenticated user ID, not from body (IDOR prevention)
    const userId = req.user.id;

    const result = await pool.query(`
      WITH target AS (
        SELECT id FROM story_sessions WHERE id = $2 AND user_id = $1
      )
      INSERT INTO bookmarks (user_id, story_session_id, scene_id, name, note, color, text_position, audio_position_seconds)
      SELECT $1, target.id, $3, $4, $5, $6, $7, $8
      FROM target
      RETURNING *
    `, [userId, storyId, scene_id, name || 'Bookmark', note, color || 'gold', text_position || 0, audio_position || 0]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    await cache.delPattern(`library:${userId}:*`);

    res.status(201).json({ bookmark: result.rows[0] });

  } catch (error) {
    logger.error('Error creating bookmark:', error);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
});

/**
 * DELETE /api/library/:storyId/bookmark/:bookmarkId
 * Delete a bookmark
 */
router.delete('/:storyId/bookmark/:bookmarkId', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { storyId, bookmarkId } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 AND story_session_id = $3 RETURNING id',
      [bookmarkId, userId, storyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    await cache.delPattern(`library:${userId}:*`);

    res.json({ message: 'Bookmark deleted' });

  } catch (error) {
    logger.error('Error deleting bookmark:', error);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
});

/**
 * POST /api/library/:storyId/favorite
 * Toggle favorite status
 */
router.post('/:storyId/favorite', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    const result = await pool.query(`
      UPDATE story_sessions
      SET is_favorite = NOT is_favorite
      WHERE id = $1 AND user_id = $2
      RETURNING is_favorite
    `, [storyId, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    await cache.delPattern(`library:${userId}:*`);

    res.json({ is_favorite: result.rows[0]?.is_favorite });

  } catch (error) {
    logger.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

/**
 * GET /api/library/preferences
 * Get reading preferences for authenticated user
 * SECURITY: Uses req.user.id instead of URL parameter
 */
router.get('/preferences', authenticateToken, requireAuth, async (req, res) => {
  try {
    // SECURITY FIX: Use authenticated user ID, not from params (IDOR prevention)
    const userId = req.user.id;

    let result = await pool.query(
      'SELECT * FROM reading_preferences WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default preferences
      result = await pool.query(`
        INSERT INTO reading_preferences (user_id)
        VALUES ($1)
        RETURNING *
      `, [userId]);
    }

    res.json({ preferences: result.rows[0] });

  } catch (error) {
    logger.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * PUT /api/library/preferences
 * Update reading preferences for authenticated user
 * SECURITY: Uses req.user.id instead of URL parameter
 */
router.put('/preferences', authenticateToken, requireAuth, async (req, res) => {
  try {
    // SECURITY FIX: Use authenticated user ID, not from params (IDOR prevention)
    const userId = req.user.id;
    const {
      font_size, font_family, line_height, theme,
      playback_speed, auto_play_next_scene, sync_highlight,
      auto_bookmark, show_progress_bar, haptic_feedback,
      high_contrast, reduce_motion
    } = req.body;

    const result = await pool.query(`
      UPDATE reading_preferences SET
        font_size = COALESCE($2, font_size),
        font_family = COALESCE($3, font_family),
        line_height = COALESCE($4, line_height),
        theme = COALESCE($5, theme),
        playback_speed = COALESCE($6, playback_speed),
        auto_play_next_scene = COALESCE($7, auto_play_next_scene),
        sync_highlight = COALESCE($8, sync_highlight),
        auto_bookmark = COALESCE($9, auto_bookmark),
        show_progress_bar = COALESCE($10, show_progress_bar),
        haptic_feedback = COALESCE($11, haptic_feedback),
        high_contrast = COALESCE($12, high_contrast),
        reduce_motion = COALESCE($13, reduce_motion),
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `, [userId, font_size, font_family, line_height, theme,
        playback_speed, auto_play_next_scene, sync_highlight,
        auto_bookmark, show_progress_bar, haptic_feedback,
        high_contrast, reduce_motion]);

    res.json({ preferences: result.rows[0] });

  } catch (error) {
    logger.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

/**
 * GET /api/library/:storyId/export
 * Export story in various formats
 */
router.get('/:storyId/export', async (req, res) => {
  try {
    const { storyId } = req.params;
    const format = req.query.format || 'text'; // text, html, json

    // Get story and scenes
    const session = await pool.query('SELECT * FROM story_sessions WHERE id = $1', [storyId]);
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const story = session.rows[0];
    const scenes = await pool.query(`
      SELECT polished_text, sequence_index, mood
      FROM story_scenes
      WHERE story_session_id = $1
      ORDER BY sequence_index
    `, [storyId]);

    if (format === 'json') {
      res.json({
        title: story.title,
        created: story.started_at,
        scenes: scenes.rows.map(s => ({
          index: s.sequence_index,
          text: s.polished_text,
          mood: s.mood
        }))
      });
    } else if (format === 'html') {
      // SECURITY: Escape all user-controlled content to prevent XSS
      const safeTitle = escapeHtml(story.title || 'Story');
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>${safeTitle}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.8; }
    h1 { text-align: center; margin-bottom: 2em; }
    .scene { margin-bottom: 2em; }
    .scene-break { text-align: center; margin: 2em 0; color: #666; }
  </style>
</head>
<body>
  <h1>${escapeHtml(story.title || 'Untitled Story')}</h1>
  ${scenes.rows.map((s, i) => `
    <div class="scene">
      ${(s.polished_text || '').split('\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')}
    </div>
    ${i < scenes.rows.length - 1 ? '<div class="scene-break">* * *</div>' : ''}
  `).join('')}
  <p style="text-align: center; margin-top: 3em; color: #666;">The End</p>
</body>
</html>`;

      res.set('Content-Type', 'text/html');
      // SECURITY: Sanitize filename to prevent header injection
      res.set('Content-Disposition', `attachment; filename="${sanitizeFilename(story.title)}.html"`);
      res.send(html);
    } else {
      // Plain text (no XSS risk, but sanitize filename)
      const text = `${story.title || 'Untitled Story'}
${'='.repeat(50)}

${scenes.rows.map((s, i) => `${s.polished_text}\n\n${i < scenes.rows.length - 1 ? '* * *\n\n' : ''}`).join('')}
THE END
`;

      res.set('Content-Type', 'text/plain');
      // SECURITY: Sanitize filename to prevent header injection
      res.set('Content-Disposition', `attachment; filename="${sanitizeFilename(story.title)}.txt"`);
      res.send(text);
    }

  } catch (error) {
    logger.error('Error exporting story:', error);
    res.status(500).json({ error: 'Failed to export story' });
  }
});

/**
 * DELETE /api/library/:storyId
 * Delete a story from library
 * SECURITY: Requires authentication and verifies story ownership
 */
router.delete('/:storyId', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    // SECURITY: Verify story belongs to authenticated user before deletion
    const ownerCheck = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [storyId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (ownerCheck.rows[0].user_id !== userId && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized to delete this story' });
    }

    // Soft delete by marking as abandoned, or hard delete
    const hardDelete = req.query.hard === 'true';

    if (hardDelete) {
      await pool.query('DELETE FROM story_sessions WHERE id = $1', [storyId]);
    } else {
      await pool.query(
        "UPDATE story_sessions SET current_status = 'abandoned' WHERE id = $1",
        [storyId]
      );
    }

    await cache.delPattern(`library:${userId}:*`);

    res.json({ message: 'Story deleted' });

  } catch (error) {
    logger.error('Error deleting story:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

export default router;
