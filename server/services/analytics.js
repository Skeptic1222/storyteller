/**
 * Analytics Service
 * Tracks and reports on story usage, engagement, and system metrics
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

/**
 * Get overall system statistics
 */
async function getSystemStats() {
  const stats = {};

  // Total stories
  const storiesResult = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'active') as active,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d
     FROM story_sessions`
  );
  stats.stories = storiesResult.rows[0];

  // Total scenes
  const scenesResult = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE audio_url IS NOT NULL) as with_audio
     FROM story_scenes`
  );
  stats.scenes = scenesResult.rows[0];

  // Total users
  const usersResult = await pool.query(
    `SELECT COUNT(DISTINCT user_id) as total,
            COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_24h
     FROM story_sessions WHERE user_id IS NOT NULL`
  );
  stats.users = usersResult.rows[0];

  // Characters created
  const charsResult = await pool.query(`SELECT COUNT(*) as total FROM characters`);
  stats.characters = { total: charsResult.rows[0].total };

  // Shares
  const sharesResult = await pool.query(
    `SELECT COUNT(*) as total,
            SUM(view_count) as total_views
     FROM story_shares`
  );
  stats.shares = sharesResult.rows[0];

  // Average story length
  const avgLengthResult = await pool.query(
    `SELECT AVG(scene_count) as avg_scenes
     FROM (
       SELECT story_session_id, COUNT(*) as scene_count
       FROM story_scenes
       GROUP BY story_session_id
     ) sub`
  );
  stats.averageScenes = Math.round(avgLengthResult.rows[0]?.avg_scenes || 0);

  return stats;
}

/**
 * Get genre distribution
 */
async function getGenreDistribution() {
  const result = await pool.query(
    `SELECT genre, COUNT(*) as count
     FROM story_sessions
     WHERE genre IS NOT NULL
     GROUP BY genre
     ORDER BY count DESC`
  );

  return result.rows;
}

/**
 * Get stories over time (for charts)
 */
async function getStoriesOverTime(days = 30) {
  const result = await pool.query(
    `SELECT DATE(created_at) as date, COUNT(*) as count
     FROM story_sessions
     WHERE created_at > NOW() - INTERVAL '${days} days'
     GROUP BY DATE(created_at)
     ORDER BY date`
  );

  return result.rows;
}

/**
 * Get most active hours
 */
async function getActivityByHour() {
  const result = await pool.query(
    `SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
     FROM story_sessions
     GROUP BY hour
     ORDER BY hour`
  );

  return result.rows.map(r => ({
    hour: parseInt(r.hour),
    count: parseInt(r.count)
  }));
}

/**
 * Get top characters by appearances
 */
async function getTopCharacters(limit = 10) {
  const result = await pool.query(
    `SELECT name, role, COUNT(*) as appearances
     FROM characters
     GROUP BY name, role
     ORDER BY appearances DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

/**
 * Get completion rate
 */
async function getCompletionRate() {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       COUNT(*) FILTER (WHERE status = 'abandoned') as abandoned,
       COUNT(*) FILTER (WHERE status = 'active') as in_progress
     FROM story_sessions`
  );

  const row = result.rows[0];
  const total = parseInt(row.total);

  return {
    total,
    completed: parseInt(row.completed),
    abandoned: parseInt(row.abandoned),
    inProgress: parseInt(row.in_progress),
    completionRate: total > 0 ? ((parseInt(row.completed) / total) * 100).toFixed(1) : 0
  };
}

/**
 * Get user engagement metrics
 */
async function getUserEngagement(userId) {
  if (!userId) {
    return { error: 'User ID required' };
  }

  const stats = {};

  // User's stories
  const storiesResult = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'completed') as completed
     FROM story_sessions WHERE user_id = $1`,
    [userId]
  );
  stats.stories = storiesResult.rows[0];

  // Total listening time (estimated from scenes)
  const listeningResult = await pool.query(
    `SELECT COUNT(*) as scene_count
     FROM story_scenes ss
     JOIN story_sessions s ON s.id = ss.story_session_id
     WHERE s.user_id = $1 AND ss.audio_url IS NOT NULL`,
    [userId]
  );
  stats.estimatedListeningMinutes = Math.round(parseInt(listeningResult.rows[0].scene_count) * 1.5);

  // Favorite genre
  const genreResult = await pool.query(
    `SELECT genre, COUNT(*) as count
     FROM story_sessions
     WHERE user_id = $1 AND genre IS NOT NULL
     GROUP BY genre
     ORDER BY count DESC
     LIMIT 1`,
    [userId]
  );
  stats.favoriteGenre = genreResult.rows[0]?.genre || null;

  // Streak (consecutive days with stories)
  const streakResult = await pool.query(
    `WITH daily_activity AS (
       SELECT DISTINCT DATE(created_at) as activity_date
       FROM story_sessions
       WHERE user_id = $1
       ORDER BY activity_date DESC
     )
     SELECT COUNT(*) as streak
     FROM (
       SELECT activity_date,
              activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC))::int as grp
       FROM daily_activity
       WHERE activity_date >= CURRENT_DATE - 30
     ) sub
     WHERE grp = (
       SELECT activity_date - 0 FROM daily_activity ORDER BY activity_date DESC LIMIT 1
     )`,
    [userId]
  );
  stats.currentStreak = parseInt(streakResult.rows[0]?.streak || 0);

  return stats;
}

/**
 * Get popular story times (bedtime analysis)
 */
async function getBedtimeAnalysis() {
  const result = await pool.query(
    `SELECT
       CASE
         WHEN EXTRACT(HOUR FROM created_at) BETWEEN 18 AND 21 THEN 'Early Evening (6-9 PM)'
         WHEN EXTRACT(HOUR FROM created_at) BETWEEN 21 AND 23 THEN 'Bedtime (9-11 PM)'
         WHEN EXTRACT(HOUR FROM created_at) >= 23 OR EXTRACT(HOUR FROM created_at) < 1 THEN 'Late Night (11 PM-1 AM)'
         ELSE 'Other Times'
       END as time_slot,
       COUNT(*) as count
     FROM story_sessions
     GROUP BY time_slot
     ORDER BY count DESC`
  );

  return result.rows;
}

/**
 * Get API usage metrics
 */
async function getApiUsageMetrics(days = 7) {
  // This would need a separate tracking table in production
  // For now, estimate from story/scene creation
  const result = await pool.query(
    `SELECT DATE(created_at) as date,
            COUNT(*) as stories_created,
            (SELECT COUNT(*) FROM story_scenes WHERE DATE(created_at) = DATE(ss.created_at)) as scenes_generated
     FROM story_sessions ss
     WHERE created_at > NOW() - INTERVAL '${days} days'
     GROUP BY DATE(created_at)
     ORDER BY date`
  );

  return result.rows;
}

/**
 * Get content safety metrics
 */
async function getSafetyMetrics() {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE config_json->>'bedtimeMode' = 'true') as bedtime_mode_count,
       AVG((config_json->>'intensity')::jsonb->>'violence')::numeric as avg_violence,
       AVG((config_json->>'intensity')::jsonb->>'horror')::numeric as avg_horror
     FROM story_sessions
     WHERE config_json IS NOT NULL`
  );

  return result.rows[0];
}

/**
 * Record analytics event
 */
async function recordEvent(eventType, eventData, sessionId = null, userId = null) {
  try {
    await pool.query(
      `INSERT INTO analytics_events (event_type, event_data, session_id, user_id)
       VALUES ($1, $2, $3, $4)`,
      [eventType, JSON.stringify(eventData), sessionId, userId]
    );
  } catch (error) {
    // Don't fail on analytics errors
    logger.warn('[Analytics] Failed to record event:', error.message);
  }
}

/**
 * Get dashboard summary
 */
async function getDashboardSummary() {
  const [
    systemStats,
    genreDistribution,
    completionRate,
    activityByHour,
    bedtimeAnalysis
  ] = await Promise.all([
    getSystemStats(),
    getGenreDistribution(),
    getCompletionRate(),
    getActivityByHour(),
    getBedtimeAnalysis()
  ]);

  return {
    systemStats,
    genreDistribution,
    completionRate,
    activityByHour,
    bedtimeAnalysis,
    generatedAt: new Date().toISOString()
  };
}

export {
  getSystemStats,
  getGenreDistribution,
  getStoriesOverTime,
  getActivityByHour,
  getTopCharacters,
  getCompletionRate,
  getUserEngagement,
  getBedtimeAnalysis,
  getApiUsageMetrics,
  getSafetyMetrics,
  recordEvent,
  getDashboardSummary
};
