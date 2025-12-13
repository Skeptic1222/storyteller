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

const router = express.Router();

/**
 * POST /api/sharing/create
 * Create a new share link for a story
 */
router.post('/create', async (req, res) => {
  try {
    const {
      sessionId,
      userId,
      expiresInDays,
      allowComments,
      isPublic,
      password
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const result = await createShareLink(sessionId, {
      userId,
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
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.query;

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
router.delete('/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { userId } = req.body;

    await deleteShareLink(shareId, userId);

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
router.put('/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { userId, ...settings } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const result = await updateShareSettings(shareId, userId, settings);

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
      limit: parseInt(limit),
      offset: parseInt(offset),
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
router.post('/story/:shareCode/comment', async (req, res) => {
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
