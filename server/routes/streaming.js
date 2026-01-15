/**
 * Audio Streaming API Routes
 */

import express from 'express';
import {
  generateStreamingAudio,
  getStreamStatus,
  streamAudioFile,
  cleanupOldStreams,
  generateChunkedAudio,
  preloadAudio,
  AUDIO_CACHE_DIR
} from '../services/audioStreaming.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { wrapRoutes, NotFoundError } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching
router.use(authenticateToken);

/**
 * POST /api/streaming/generate
 * Generate streaming audio from text
 */
router.post('/generate', requireAuth, rateLimiters.tts, async (req, res) => {
  try {
    const { text, voiceId, options = {} } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }

    if (!voiceId) {
      return res.status(400).json({ error: 'Voice ID required' });
    }

    const result = await generateStreamingAudio(text, voiceId, options);

    // Set headers for streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Stream-Id', result.streamId);
    res.setHeader('X-Audio-Url', result.publicUrl);

    // Pipe the stream to response
    result.stream.pipe(res);

  } catch (error) {
    logger.error('Error generating streaming audio:', error);
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

/**
 * POST /api/streaming/generate-async
 * Start audio generation and return immediately with stream info
 */
router.post('/generate-async', requireAuth, rateLimiters.tts, async (req, res) => {
  try {
    const { text, voiceId, options = {} } = req.body;

    if (!text || !voiceId) {
      return res.status(400).json({ error: 'Text and voice ID required' });
    }

    // Start generation in background
    generateStreamingAudio(text, voiceId, options)
      .then(result => {
        logger.info(`[Streaming] Async generation started: ${result.streamId}`);
      })
      .catch(error => {
        logger.error('[Streaming] Async generation failed:', error);
      });

    // Return immediately
    res.json({
      success: true,
      message: 'Audio generation started',
      estimatedDuration: Math.ceil(text.length / 15) // Rough estimate: 15 chars/second
    });

  } catch (error) {
    logger.error('Error starting async audio generation:', error);
    res.status(500).json({ error: 'Failed to start audio generation' });
  }
});

/**
 * GET /api/streaming/status/:streamId
 * Get status of a streaming generation
 */
router.get('/status/:streamId', requireAuth, (req, res) => {
  try {
    const { streamId } = req.params;
    const status = getStreamStatus(streamId);

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    logger.error('Error getting stream status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /api/streaming/audio/:filename
 * Stream an audio file with range support
 * SECURITY: Path traversal protection - only serves files from AUDIO_CACHE_DIR
 */
router.get('/audio/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // SECURITY: Validate filename to prevent path traversal attacks
    // FAIL LOUD: Reject any suspicious filenames immediately
    if (!filename || typeof filename !== 'string') {
      logger.error('[Security] BLOCKED: Missing or invalid filename in audio request');
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Reject path traversal attempts: .., /, \, encoded variants
    const dangerousPatterns = [
      /\.\./,           // Parent directory traversal
      /[\/\\]/,         // Forward or back slashes (shouldn't be in filename)
      /%2e%2e/i,        // URL-encoded ..
      /%2f/i,           // URL-encoded /
      /%5c/i,           // URL-encoded \
      /\x00/,           // Null bytes
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filename)) {
        logger.error(`[Security] BLOCKED PATH TRAVERSAL ATTEMPT: ${filename}`);
        return res.status(400).json({ error: 'Invalid filename' });
      }
    }

    // Additional validation: only allow expected file extensions
    const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.webm'];
    const hasValidExtension = allowedExtensions.some(ext =>
      filename.toLowerCase().endsWith(ext)
    );
    if (!hasValidExtension) {
      logger.error(`[Security] BLOCKED: Invalid file extension in ${filename}`);
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Construct path and verify it's still within AUDIO_CACHE_DIR
    const filepath = path.join(AUDIO_CACHE_DIR, filename);
    const resolvedPath = path.resolve(filepath);
    const resolvedCacheDir = path.resolve(AUDIO_CACHE_DIR);

    if (!resolvedPath.startsWith(resolvedCacheDir + path.sep)) {
      logger.error(`[Security] BLOCKED PATH ESCAPE: ${filename} resolved to ${resolvedPath}`);
      return res.status(400).json({ error: 'Invalid filename' });
    }

    await streamAudioFile(filepath, req, res);
  } catch (error) {
    logger.error('Error streaming audio file:', error);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

/**
 * POST /api/streaming/chunked
 * Generate audio in chunks (sentence by sentence)
 */
router.post('/chunked', requireAuth, rateLimiters.tts, async (req, res) => {
  try {
    const { text, voiceId, options = {} } = req.body;

    if (!text || !voiceId) {
      return res.status(400).json({ error: 'Text and voice ID required' });
    }

    // For SSE streaming of chunk progress
    if (req.headers.accept === 'text/event-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const result = await generateChunkedAudio(text, voiceId, {
        ...options,
        onChunkReady: (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      });

      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
      res.end();
    } else {
      // Regular JSON response
      const result = await generateChunkedAudio(text, voiceId, options);

      res.json({
        success: true,
        ...result
      });
    }
  } catch (error) {
    logger.error('Error generating chunked audio:', error);
    res.status(500).json({ error: 'Failed to generate chunked audio' });
  }
});

/**
 * POST /api/streaming/preload
 * Check if audio files are cached and ready
 */
router.post('/preload', requireAuth, async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'URLs array required' });
    }

    const results = await preloadAudio(urls);

    res.json({
      success: true,
      results
    });
  } catch (error) {
    logger.error('Error preloading audio:', error);
    res.status(500).json({ error: 'Failed to preload audio' });
  }
});

/**
 * POST /api/streaming/cleanup
 * Clean up old streaming files
 */
router.post('/cleanup', requireAuth, async (req, res) => {
  try {
    const { maxAgeHours = 24 } = req.body;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    const result = await cleanupOldStreams(maxAgeMs);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error cleaning up streams:', error);
    res.status(500).json({ error: 'Failed to cleanup' });
  }
});

export default router;
