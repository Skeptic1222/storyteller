/**
 * Recording Management Routes
 * Handles story recording playback, retrieval, and management
 */

import { Router } from 'express';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { recordingService } from '../services/recording.js';
import { pool } from '../database/pool.js';
import { assembleMultiVoiceAudio, mixWithSFX, ASSEMBLY_PRESETS } from '../services/audioAssembler.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken, requireAuth);

async function requireSessionOwner(req, res, next, sessionId) {
  try {
    const result = await pool.query(
      'SELECT user_id FROM story_sessions WHERE id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Story session not found' });
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    return next();
  } catch (error) {
    logger.error('Error verifying session owner:', error);
    return res.status(500).json({ error: 'Failed to verify session access' });
  }
}

async function requireRecordingOwner(req, res, next, recordingId) {
  try {
    const result = await pool.query(
      `SELECT s.user_id
       FROM story_recordings r
       JOIN story_sessions s ON s.id = r.story_session_id
       WHERE r.id = $1`,
      [recordingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized for this recording' });
    }

    return next();
  } catch (error) {
    logger.error('Error verifying recording owner:', error);
    return res.status(500).json({ error: 'Failed to verify recording access' });
  }
}

async function requirePlaybackOwner(req, res, next, playbackId) {
  try {
    const result = await pool.query(
      'SELECT user_id FROM playback_sessions WHERE id = $1',
      [playbackId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playback session not found' });
    }

    const ownerId = result.rows[0].user_id;
    if (ownerId !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized for this playback session' });
    }

    return next();
  } catch (error) {
    logger.error('Error verifying playback owner:', error);
    return res.status(500).json({ error: 'Failed to verify playback access' });
  }
}

router.param('sessionId', requireSessionOwner);
router.param('id', requireRecordingOwner);
router.param('playbackId', requirePlaybackOwner);

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

    // Verify session ownership
    const ownerCheck = await pool.query('SELECT user_id FROM story_sessions WHERE id = $1', [sessionId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (ownerCheck.rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized for this session' });
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

    // Verify session ownership
    const ownerCheck = await pool.query('SELECT user_id FROM story_sessions WHERE id = $1', [sessionId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (ownerCheck.rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized for this session' });
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

    await recordingService.recordPlay(id);
    const playback = await recordingService.startPlayback(id, req.user.id);

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

/**
 * GET /api/recordings/:id/export
 * Export recording as MP3 file for download
 * Query params:
 *   - includeSfx: 'true'|'false' - Whether to mix in SFX (default: false)
 *   - format: 'srt'|'vtt' - Return subtitle file instead of audio
 */
router.get('/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const { includeSfx = 'false', format } = req.query;

    // Validate recording exists
    const recording = await recordingService.getRecording(id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Get all segments
    const segments = await recordingService.getSegments(id);
    if (!segments || segments.length === 0) {
      return res.status(400).json({ error: 'Recording has no audio segments' });
    }

    // If subtitle format requested, generate and return that instead
    if (format === 'srt' || format === 'vtt') {
      const subtitles = generateSubtitles(segments, format);
      const filename = sanitizeFilename(recording.title || 'story') + '.' + format;

      res.setHeader('Content-Type', format === 'srt' ? 'text/plain' : 'text/vtt');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(subtitles);
    }

    logger.info(`[Export] Assembling ${segments.length} segments for recording ${id}`);

    // Prepare audio segments for assembly
    const audioSegments = [];
    const sfxTracks = [];
    let cumulativeTime = 0;

    for (const segment of segments) {
      if (!segment.audio_url) {
        logger.warn(`[Export] Segment ${segment.sequence_index} has no audio_url, skipping`);
        continue;
      }

      const audioPath = join(__dirname, '..', '..', 'public', segment.audio_url);

      if (!existsSync(audioPath)) {
        logger.warn(`[Export] Audio file not found: ${audioPath}`);
        continue;
      }

      const audioBuffer = await readFile(audioPath);

      audioSegments.push({
        audio: audioBuffer,
        speaker: segment.speaker || 'narrator',
        type: segment.segment_type || 'narrator',
        duration: (segment.duration_seconds || 0) * 1000
      });

      // Collect SFX data if present and requested
      if (includeSfx === 'true' && segment.sfx_data) {
        const sfxData = typeof segment.sfx_data === 'string'
          ? JSON.parse(segment.sfx_data)
          : segment.sfx_data;

        if (Array.isArray(sfxData)) {
          for (const sfx of sfxData) {
            if (sfx.audio_url) {
              const sfxPath = join(__dirname, '..', '..', 'public', sfx.audio_url);
              if (existsSync(sfxPath)) {
                sfxTracks.push({
                  audio: await readFile(sfxPath),
                  startMs: cumulativeTime + (sfx.start_time || 0) * 1000,
                  volume: sfx.volume || 0.4
                });
              }
            }
          }
        }
      }

      cumulativeTime += (segment.duration_seconds || 0) * 1000;
    }

    if (audioSegments.length === 0) {
      return res.status(400).json({ error: 'No valid audio segments found' });
    }

    // Assemble audio with natural transitions
    const assembled = await assembleMultiVoiceAudio(audioSegments, {
      ...ASSEMBLY_PRESETS.natural,
      outputFormat: 'mp3'
    });

    let finalAudio = assembled.audio;

    // Mix in SFX if requested and present
    if (includeSfx === 'true' && sfxTracks.length > 0) {
      logger.info(`[Export] Mixing ${sfxTracks.length} SFX tracks`);
      finalAudio = await mixWithSFX(finalAudio, sfxTracks);
    }

    // Generate filename
    const filename = sanitizeFilename(recording.title || 'story') +
      (includeSfx === 'true' ? '_with_sfx' : '') + '.mp3';

    // Send as download
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', finalAudio.length);

    logger.info(`[Export] Sending ${finalAudio.length} bytes as ${filename}`);
    res.send(finalAudio);

  } catch (error) {
    logger.error('Error exporting recording:', error);
    res.status(500).json({ error: 'Failed to export recording' });
  }
});

/**
 * GET /api/recordings/:id/export-info
 * Get export metadata (available formats, duration, etc.)
 */
router.get('/:id/export-info', async (req, res) => {
  try {
    const { id } = req.params;

    const recording = await recordingService.getRecording(id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const segments = await recordingService.getSegments(id);
    const hasSfx = segments.some(s => s.sfx_data && Object.keys(s.sfx_data).length > 0);
    const hasWordTimings = segments.some(s => s.word_timings?.words?.length > 0);

    res.json({
      recordingId: id,
      title: recording.title,
      duration: recording.total_duration_seconds,
      segmentCount: segments.length,
      hasSfx,
      hasWordTimings,
      availableFormats: ['mp3'],
      subtitleFormats: hasWordTimings ? ['srt', 'vtt'] : []
    });

  } catch (error) {
    logger.error('Error getting export info:', error);
    res.status(500).json({ error: 'Failed to get export info' });
  }
});

/**
 * Generate SRT or VTT subtitles from word timings
 */
function generateSubtitles(segments, format) {
  const cues = [];
  let cumulativeMs = 0;

  for (const segment of segments) {
    const wordTimings = segment.word_timings?.words || [];
    if (wordTimings.length === 0) {
      // No word timings - create a single cue for the segment
      if (segment.content) {
        cues.push({
          start: cumulativeMs,
          end: cumulativeMs + (segment.duration_seconds || 5) * 1000,
          text: segment.content.substring(0, 200) // Truncate long segments
        });
      }
    } else {
      // Group words into ~5 second cues
      let cueStart = cumulativeMs;
      let cueWords = [];
      let cueFirstWordStart = wordTimings[0]?.start_ms || 0;

      for (let i = 0; i < wordTimings.length; i++) {
        const word = wordTimings[i];
        cueWords.push(word.text);

        // Start new cue every ~5 seconds or at end
        const wordEnd = word.end_ms || word.start_ms + 200;
        const elapsed = wordEnd - cueFirstWordStart;
        const isLastWord = i === wordTimings.length - 1;

        if (elapsed >= 5000 || isLastWord) {
          cues.push({
            start: cueStart,
            end: cumulativeMs + wordEnd,
            text: cueWords.join(' ')
          });
          cueStart = cumulativeMs + wordEnd;
          cueWords = [];
          // Set the start of the next cue to the next word's start time
          if (!isLastWord) {
            cueFirstWordStart = wordTimings[i + 1]?.start_ms || wordEnd;
          }
        }
      }
    }

    cumulativeMs += (segment.duration_seconds || 0) * 1000;
  }

  if (format === 'vtt') {
    return generateVTT(cues);
  }
  return generateSRT(cues);
}

/**
 * Generate SRT format subtitles
 */
function generateSRT(cues) {
  return cues.map((cue, i) => {
    const start = formatSRTTime(cue.start);
    const end = formatSRTTime(cue.end);
    return `${i + 1}\n${start} --> ${end}\n${cue.text}\n`;
  }).join('\n');
}

/**
 * Generate WebVTT format subtitles
 */
function generateVTT(cues) {
  const lines = ['WEBVTT\n'];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const start = formatVTTTime(cue.start);
    const end = formatVTTTime(cue.end);
    lines.push(`${i + 1}`);
    lines.push(`${start} --> ${end}`);
    lines.push(cue.text);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format time for SRT (HH:MM:SS,mmm)
 */
function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * Format time for VTT (HH:MM:SS.mmm)
 */
function formatVTTTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/**
 * Pad number with leading zeros
 */
function pad(num, length = 2) {
  return String(num).padStart(length, '0');
}

/**
 * Sanitize filename for download
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

export default router;
