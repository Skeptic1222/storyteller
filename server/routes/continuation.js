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

const router = express.Router();

/**
 * GET /api/continuation/:sessionId/ideas
 * Generate continuation ideas for a completed story
 */
router.get('/:sessionId/ideas', async (req, res) => {
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
router.post('/:sessionId/create', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      userId,
      continuationIdea,
      preserveCharacters = true,
      preserveLore = true
    } = req.body;

    const result = await createContinuation(sessionId, {
      userId,
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
router.get('/:sessionId', async (req, res) => {
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
router.get('/:sessionId/context', async (req, res) => {
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
router.get('/:sessionId/series', async (req, res) => {
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
