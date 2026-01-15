/**
 * Story Continuation API Routes
 */

import express from 'express';
import {
  generateContinuationIdeas,
  createContinuation,
  getStoryContinuations,
  getContinuationContext,
  getStorySeries
} from '../services/storyContinuation.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { pool } from '../database/pool.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken, requireAuth);

async function requireSessionOwner(req, res, next) {
  try {
    const { sessionId } = req.params;
    const result = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized to access this story' });
    }

    return next();
  } catch (error) {
    logger.error('Error verifying session owner:', error);
    return res.status(500).json({ error: 'Failed to verify session access' });
  }
}

/**
 * GET /api/continuation/:sessionId/ideas
 * Generate continuation ideas for a completed story
 */
router.get('/:sessionId/ideas', requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await generateContinuationIdeas(sessionId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error generating continuation ideas:', error);
    res.status(500).json({ error: error.message || 'Failed to generate ideas' });
  }
});

/**
 * POST /api/continuation/:sessionId/create
 * Create a new continuation story
 */
router.post('/:sessionId/create', requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      continuationIdea,
      preserveCharacters = true,
      preserveLore = true
    } = req.body;

    const result = await createContinuation(sessionId, {
      userId: req.user.id,
      continuationIdea,
      preserveCharacters,
      preserveLore
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error creating continuation:', error);
    res.status(500).json({ error: error.message || 'Failed to create continuation' });
  }
});

/**
 * GET /api/continuation/:sessionId
 * Get all continuations for a story
 */
router.get('/:sessionId', requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await getStoryContinuations(sessionId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error getting continuations:', error);
    res.status(500).json({ error: 'Failed to get continuations' });
  }
});

/**
 * GET /api/continuation/:sessionId/context
 * Get continuation context (for orchestrator use)
 */
router.get('/:sessionId/context', requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const context = await getContinuationContext(sessionId);

    res.json({
      success: true,
      isContinuation: !!context,
      context
    });
  } catch (error) {
    logger.error('Error getting continuation context:', error);
    res.status(500).json({ error: 'Failed to get context' });
  }
});

/**
 * GET /api/continuation/:sessionId/series
 * Get the full story series
 */
router.get('/:sessionId/series', requireSessionOwner, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const series = await getStorySeries(sessionId);

    res.json({
      success: true,
      ...series
    });
  } catch (error) {
    logger.error('Error getting story series:', error);
    res.status(500).json({ error: 'Failed to get series' });
  }
});

export default router;
