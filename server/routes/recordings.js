/**
 * Recording Management Routes
 * Handles story recording playback, retrieval, and management
 */

import { Router } from 'express';
import { recordingService } from '../services/recording.js';
import { logger } from '../utils/logger.js';

const router = Router();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/recordings/session/:sessionId
 * Get all recordings for a story session
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Validate UUID format
    if (!UUID_REGEX.test(sessionId)) {
      return res.json({
        recordings: [],
        count: 0,
        hasComplete: false
      });
    }

    const recordings = await recordingService.getSessionRecordings(sessionId);

    res.json({
      recordings,
      count: recordings.length,
      hasComplete: recordings.some(r => r.is_complete)
    });

  } catch (error) {
    logger.error('Error fetching session recordings:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

/**
 * GET /api/recordings/:id
 * Get a specific recording with its segments
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const recording = await recordingService.getRecording(id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const segments = await recordingService.getSegments(id);

    res.json({
      recording,
      segments,
      segmentCount: segments.length,
      totalDuration: recording.total_duration_seconds
    });

  } catch (error) {
    logger.error('Error fetching recording:', error);
    res.status(500).json({ error: 'Failed to fetch recording' });
  }
});

/**
 * GET /api/recordings/:id/segments
 * Get segments for a recording
 */
router.get('/:id/segments', async (req, res) => {
  try {
    const { id } = req.params;

    const segments = await recordingService.getSegments(id);

    res.json({
      segments,
      count: segments.length
    });

  } catch (error) {
    logger.error('Error fetching segments:', error);
    res.status(500).json({ error: 'Failed to fetch segments' });
  }
});

/**
 * GET /api/recordings/:id/segment/:index
 * Get a specific segment by index
 */
router.get('/:id/segment/:index', async (req, res) => {
  try {
    const { id, index } = req.params;

    const segment = await recordingService.getSegment(id, parseInt(index, 10));
    if (!segment) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.json(segment);

  } catch (error) {
    logger.error('Error fetching segment:', error);
    res.status(500).json({ error: 'Failed to fetch segment' });
  }
});

/**
 * POST /api/recordings/check-path
 * Check if a CYOA path has a recording
 */
router.post('/check-path', async (req, res) => {
  try {
    const { sessionId, choices } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const result = await recordingService.findLongestMatchingPath(sessionId, choices || []);

    res.json({
      hasRecording: result.hasMatch,
      isExactMatch: result.isExactMatch || false,
      matchedPath: result.matchedPath,
      matchedDepth: result.matchedDepth || 0,
      divergencePoint: result.divergencePoint,
      remainingChoices: result.remainingChoices?.length || 0,
      recordingId: result.matchedRecording?.id
    });

  } catch (error) {
    logger.error('Error checking path:', error);
    res.status(500).json({ error: 'Failed to check path' });
  }
});

/**
 * POST /api/recordings/check-choice
 * Check if a specific choice has a recording from current position
 */
router.post('/check-choice', async (req, res) => {
  try {
    const { sessionId, currentPath, choiceKey } = req.body;

    if (!sessionId || !choiceKey) {
      return res.status(400).json({ error: 'sessionId and choiceKey required' });
    }

    const hasRecording = await recordingService.hasRecordingForChoice(
      sessionId,
      currentPath || null,
      choiceKey
    );

    res.json({ hasRecording, choiceKey });

  } catch (error) {
    logger.error('Error checking choice:', error);
    res.status(500).json({ error: 'Failed to check choice' });
  }
});

/**
 * GET /api/recordings/session/:sessionId/available-paths
 * Get available recorded paths from current position
 */
router.get('/session/:sessionId/available-paths', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { currentPath } = req.query;

    const recordedChoices = await recordingService.getRecordedChoicesAt(
      sessionId,
      currentPath || null
    );

    res.json({
      recordedChoices,
      count: Object.keys(recordedChoices).length
    });

  } catch (error) {
    logger.error('Error fetching available paths:', error);
    res.status(500).json({ error: 'Failed to fetch available paths' });
  }
});

/**
 * POST /api/recordings/:id/validate
 * Validate a recording's integrity
 */
router.post('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;

    const validation = await recordingService.validateRecording(id);

    res.json(validation);

  } catch (error) {
    logger.error('Error validating recording:', error);
    res.status(500).json({ error: 'Failed to validate recording' });
  }
});

/**
 * POST /api/recordings/:id/interrupt
 * Mark a recording as interrupted (for recovery)
 * Called via sendBeacon on page unload
 */
router.post('/:id/interrupt', async (req, res) => {
  try {
    const { id } = req.params;
    const { lastSegmentIndex, interruptedAt } = req.body;

    const recording = await recordingService.interruptRecording(
      id,
      lastSegmentIndex || 0,
      'browser_close'
    );

    res.json({
      success: true,
      recordingId: id,
      state: recording?.recording_state
    });

  } catch (error) {
    logger.error('Error marking recording interrupted:', error);
    res.status(500).json({ error: 'Failed to mark recording interrupted' });
  }
});

/**
 * GET /api/recordings/session/:sessionId/recover
 * Check for and recover interrupted recordings
 */
router.get('/session/:sessionId/recover', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const recovery = await recordingService.recoverInterruptedRecording(sessionId);

    if (!recovery.hasInterrupted) {
      return res.json({ hasInterrupted: false });
    }

    res.json({
      hasInterrupted: true,
      recording: recovery.recording,
      lastValidSegment: recovery.lastValidSegment,
      segmentCount: recovery.segmentCount,
      validation: recovery.validation
    });

  } catch (error) {
    logger.error('Error recovering recording:', error);
    res.status(500).json({ error: 'Failed to recover recording' });
  }
});

/**
 * POST /api/recordings/:id/resume
 * Resume an interrupted recording
 */
router.post('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;

    const recording = await recordingService.resumeRecording(id);

    res.json({
      success: true,
      recording
    });

  } catch (error) {
    logger.error('Error resuming recording:', error);
    res.status(500).json({ error: 'Failed to resume recording' });
  }
});

/**
 * DELETE /api/recordings/:id
 * Delete a recording and its files
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await recordingService.deleteRecording(id);

    res.json({
      success: true,
      message: 'Recording deleted'
    });

  } catch (error) {
    logger.error('Error deleting recording:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

/**
 * POST /api/recordings/:id/play
 * Record a play event for analytics
 */
router.post('/:id/play', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    await recordingService.recordPlay(id);
    const playback = await recordingService.startPlayback(id, userId);

    res.json({
      success: true,
      playbackId: playback.id
    });

  } catch (error) {
    logger.error('Error recording play:', error);
    res.status(500).json({ error: 'Failed to record play' });
  }
});

/**
 * POST /api/recordings/playback/:playbackId/position
 * Update playback position
 */
router.post('/playback/:playbackId/position', async (req, res) => {
  try {
    const { playbackId } = req.params;
    const { segmentIndex, positionSeconds } = req.body;

    const playback = await recordingService.updatePlaybackPosition(
      playbackId,
      segmentIndex,
      positionSeconds
    );

    res.json({ success: true, playback });

  } catch (error) {
    logger.error('Error updating playback position:', error);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

/**
 * POST /api/recordings/playback/:playbackId/complete
 * Mark playback as complete
 */
router.post('/playback/:playbackId/complete', async (req, res) => {
  try {
    const { playbackId } = req.params;

    const playback = await recordingService.completePlayback(playbackId);

    res.json({ success: true, playback });

  } catch (error) {
    logger.error('Error completing playback:', error);
    res.status(500).json({ error: 'Failed to complete playback' });
  }
});

export default router;
