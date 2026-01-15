/**
 * Analytics API Routes
 */

import express from 'express';
import {
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
  getDashboardSummary
} from '../services/analytics.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken, requireAuth, requireAdmin);

/**
 * GET /api/analytics/dashboard
 * Get complete dashboard summary
 */
router.get('/dashboard', async (req, res) => {
  try {
    const summary = await getDashboardSummary();

    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    logger.error('Error getting dashboard:', error);
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

/**
 * GET /api/analytics/stats
 * Get system statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getSystemStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/analytics/genres
 * Get genre distribution
 */
router.get('/genres', async (req, res) => {
  try {
    const genres = await getGenreDistribution();

    res.json({
      success: true,
      genres
    });
  } catch (error) {
    logger.error('Error getting genres:', error);
    res.status(500).json({ error: 'Failed to get genres' });
  }
});

/**
 * GET /api/analytics/timeline
 * Get stories over time
 */
router.get('/timeline', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const timeline = await getStoriesOverTime(parseInt(days));

    res.json({
      success: true,
      timeline
    });
  } catch (error) {
    logger.error('Error getting timeline:', error);
    res.status(500).json({ error: 'Failed to get timeline' });
  }
});

/**
 * GET /api/analytics/activity
 * Get activity by hour
 */
router.get('/activity', async (req, res) => {
  try {
    const activity = await getActivityByHour();

    res.json({
      success: true,
      activity
    });
  } catch (error) {
    logger.error('Error getting activity:', error);
    res.status(500).json({ error: 'Failed to get activity' });
  }
});

/**
 * GET /api/analytics/characters
 * Get top characters
 */
router.get('/characters', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const characters = await getTopCharacters(parseInt(limit));

    res.json({
      success: true,
      characters
    });
  } catch (error) {
    logger.error('Error getting characters:', error);
    res.status(500).json({ error: 'Failed to get characters' });
  }
});

/**
 * GET /api/analytics/completion
 * Get completion rate
 */
router.get('/completion', async (req, res) => {
  try {
    const completion = await getCompletionRate();

    res.json({
      success: true,
      ...completion
    });
  } catch (error) {
    logger.error('Error getting completion rate:', error);
    res.status(500).json({ error: 'Failed to get completion rate' });
  }
});

/**
 * GET /api/analytics/user/:userId
 * Get user engagement metrics
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const engagement = await getUserEngagement(userId);

    res.json({
      success: true,
      engagement
    });
  } catch (error) {
    logger.error('Error getting user engagement:', error);
    res.status(500).json({ error: 'Failed to get user engagement' });
  }
});

/**
 * GET /api/analytics/bedtime
 * Get bedtime analysis
 */
router.get('/bedtime', async (req, res) => {
  try {
    const bedtime = await getBedtimeAnalysis();

    res.json({
      success: true,
      bedtime
    });
  } catch (error) {
    logger.error('Error getting bedtime analysis:', error);
    res.status(500).json({ error: 'Failed to get bedtime analysis' });
  }
});

/**
 * GET /api/analytics/api-usage
 * Get API usage metrics
 */
router.get('/api-usage', async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const usage = await getApiUsageMetrics(parseInt(days));

    res.json({
      success: true,
      usage
    });
  } catch (error) {
    logger.error('Error getting API usage:', error);
    res.status(500).json({ error: 'Failed to get API usage' });
  }
});

/**
 * GET /api/analytics/safety
 * Get safety metrics
 */
router.get('/safety', async (req, res) => {
  try {
    const safety = await getSafetyMetrics();

    res.json({
      success: true,
      safety
    });
  } catch (error) {
    logger.error('Error getting safety metrics:', error);
    res.status(500).json({ error: 'Failed to get safety metrics' });
  }
});

export default router;
