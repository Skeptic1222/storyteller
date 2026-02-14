/**
 * Story Sharing API Routes
 */

import express from 'express';
import {
  createShareLink,
  accessSharedStory,
  getSessionShares,
  deleteShareLink,
  updateShareSettings,
  getPublicStories,
  addComment,
  getComments
} from '../services/storySharing.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { pool } from '../database/pool.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

/**
 * POST /api/sharing/create
 * Create a new share link for a story
 */
router.post('/create', authenticateToken, requireAuth, async (req, res) => {
  try {
    const {
      sessionId,
      expiresInDays,
      allowComments,
      isPublic,
      password
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const sessionCheck = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }
    const ownerId = sessionCheck.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized to share this story' });
    }

    const result = await createShareLink(sessionId, {
      userId: req.user.id,
      expiresInDays,
      allowComments,
      isPublic,
      password
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error creating share link:', error);
    res.status(500).json({ error: error.message || 'Failed to create share link' });
  }
});

/**
 * GET /api/sharing/story/:shareCode
 * Access a shared story
 */
router.get('/story/:shareCode', async (req, res) => {
  try {
    const { shareCode } = req.params;
    const { password } = req.query;

    const result = await accessSharedStory(shareCode, password);

    if (!result.success) {
      return res.status(result.requiresPassword ? 401 : 404).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Error accessing shared story:', error);
    res.status(500).json({ error: 'Failed to access shared story' });
  }
});

/**
 * POST /api/sharing/story/:shareCode/access
 * Access a password-protected shared story
 */
router.post('/story/:shareCode/access', async (req, res) => {
  try {
    const { shareCode } = req.params;
    const { password } = req.body;

    const result = await accessSharedStory(shareCode, password);

    if (!result.success) {
      return res.status(result.requiresPassword ? 401 : 404).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Error accessing shared story:', error);
    res.status(500).json({ error: 'Failed to access shared story' });
  }
});

/**
 * GET /api/sharing/session/:sessionId
 * Get all share links for a session
 */
router.get('/session/:sessionId', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const shares = await getSessionShares(sessionId, userId);

    res.json({
      success: true,
      shares
    });
  } catch (error) {
    logger.error('Error fetching session shares:', error);
    res.status(500).json({ error: 'Failed to fetch shares' });
  }
});

/**
 * DELETE /api/sharing/:shareId
 * Delete a share link
 */
router.delete('/:shareId', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { shareId } = req.params;

    await deleteShareLink(shareId, req.user.id);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting share link:', error);
    res.status(500).json({ error: error.message || 'Failed to delete share link' });
  }
});

/**
 * PUT /api/sharing/:shareId
 * Update share settings
 */
router.put('/:shareId', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { shareId } = req.params;
    const { ...settings } = req.body;

    const result = await updateShareSettings(shareId, req.user.id, settings);

    res.json({
      success: true,
      share: result
    });
  } catch (error) {
    logger.error('Error updating share settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update share' });
  }
});

/**
 * GET /api/sharing/discover
 * Get public stories for discovery
 */
router.get('/discover', async (req, res) => {
  try {
    const {
      limit = 20,
      offset = 0,
      genre,
      sortBy = 'recent'
    } = req.query;

    const stories = await getPublicStories({
      limit: Math.min(Math.max(parseInt(limit) || 20, 1), 100),
      offset: Math.max(parseInt(offset) || 0, 0),
      genre,
      sortBy
    });

    res.json({
      success: true,
      stories
    });
  } catch (error) {
    logger.error('Error fetching public stories:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

/**
 * POST /api/sharing/story/:shareCode/comment
 * Add a comment to a shared story
 */
router.post('/story/:shareCode/comment', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { shareCode } = req.params;
    const { comment, authorName } = req.body;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Comment text required' });
    }

    if (comment.length > 1000) {
      return res.status(400).json({ error: 'Comment too long (max 1000 characters)' });
    }

    const result = await addComment(shareCode, comment.trim(), authorName);

    res.json({
      success: true,
      comment: result
    });
  } catch (error) {
    logger.error('Error adding comment:', error);
    res.status(500).json({ error: error.message || 'Failed to add comment' });
  }
});

/**
 * GET /api/sharing/story/:shareCode/comments
 * Get comments for a shared story
 */
router.get('/story/:shareCode/comments', async (req, res) => {
  try {
    const { shareCode } = req.params;
    const { limit = 50 } = req.query;

    const comments = await getComments(shareCode, parseInt(limit));

    res.json({
      success: true,
      comments
    });
  } catch (error) {
    logger.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

export default router;
