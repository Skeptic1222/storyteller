/**
 * Progressive Audio Streaming Service
 * Enables streaming audio playback while generation is in progress
 */

import { logger } from '../utils/logger.js';
import axios from 'axios';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PassThrough } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Audio cache directory
const AUDIO_CACHE_DIR = path.join(__dirname, '..', '..', 'public', 'audio', 'stream');

// Active streams tracking
const activeStreams = new Map();

/**
 * Ensure audio cache directory exists
 */
async function ensureAudioCacheDir() {
  try {
    await fs.mkdir(AUDIO_CACHE_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.error('Failed to create audio cache directory:', error);
    }
  }
}

/**
 * Generate audio with streaming support
 * Returns a stream that can be piped to response while generation continues
 */
async function generateStreamingAudio(text, voiceId, options = {}) {
  const {
    modelId = 'eleven_turbo_v2_5',
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0,
    speakerBoost = true,
    outputFormat = 'mp3_44100_128'
  } = options;

  await ensureAudioCacheDir();

  const streamId = `stream_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const filename = `${streamId}.mp3`;
  const filepath = path.join(AUDIO_CACHE_DIR, filename);

  logger.info(`[AudioStreaming] Starting stream generation: ${streamId}`);

  try {
    // Create a PassThrough stream for piping
    const passThrough = new PassThrough();

    // Track the stream
    activeStreams.set(streamId, {
      stream: passThrough,
      filepath,
      status: 'generating',
      startTime: Date.now(),
      bytesWritten: 0
    });

    // Start streaming generation using axios
    const response = await axios({
      method: 'POST',
      url: `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}/stream`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      data: {
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: speakerBoost
        }
      },
      responseType: 'stream'
    });

    const audioStream = response.data;

    // Also write to file for caching
    const fileStream = createWriteStream(filepath);

    // Pipe audio to both file and passthrough
    audioStream.on('data', (chunk) => {
      passThrough.write(chunk);
      fileStream.write(chunk);

      const streamInfo = activeStreams.get(streamId);
      if (streamInfo) {
        streamInfo.bytesWritten += chunk.length;
      }
    });

    audioStream.on('end', () => {
      passThrough.end();
      fileStream.end();

      const streamInfo = activeStreams.get(streamId);
      if (streamInfo) {
        streamInfo.status = 'completed';
        streamInfo.endTime = Date.now();
        streamInfo.duration = streamInfo.endTime - streamInfo.startTime;
      }

      logger.info(`[AudioStreaming] Stream completed: ${streamId} (${activeStreams.get(streamId)?.bytesWritten} bytes)`);
    });

    audioStream.on('error', (error) => {
      logger.error(`[AudioStreaming] Stream error: ${streamId}`, error);
      passThrough.destroy(error);
      fileStream.destroy(error);

      const streamInfo = activeStreams.get(streamId);
      if (streamInfo) {
        streamInfo.status = 'error';
        streamInfo.error = error.message;
      }
    });

    return {
      streamId,
      stream: passThrough,
      filepath,
      publicUrl: `/storyteller/audio/stream/${filename}`
    };

  } catch (error) {
    logger.error(`[AudioStreaming] Failed to start stream: ${streamId}`, error);
    activeStreams.delete(streamId);
    throw error;
  }
}

/**
 * Get stream status
 */
function getStreamStatus(streamId) {
  const streamInfo = activeStreams.get(streamId);
  if (!streamInfo) {
    return { found: false };
  }

  return {
    found: true,
    status: streamInfo.status,
    bytesWritten: streamInfo.bytesWritten,
    duration: streamInfo.duration || (Date.now() - streamInfo.startTime),
    filepath: streamInfo.filepath
  };
}

/**
 * Stream existing audio file with range support
 */
async function streamAudioFile(filepath, req, res) {
  try {
    const stat = await fs.stat(filepath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Handle range requests for seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg'
      });

      const stream = createReadStream(filepath, { start, end });
      stream.pipe(res);
    } else {
      // Full file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes'
      });

      const stream = createReadStream(filepath);
      stream.pipe(res);
    }
  } catch (error) {
    logger.error('[AudioStreaming] Error streaming file:', error);
    res.status(404).json({ error: 'Audio file not found' });
  }
}

/**
 * Clean up old stream files
 */
async function cleanupOldStreams(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const files = await fs.readdir(AUDIO_CACHE_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filepath = path.join(AUDIO_CACHE_DIR, file);
      const stat = await fs.stat(filepath);

      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(filepath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[AudioStreaming] Cleaned up ${cleaned} old stream files`);
    }

    return { cleaned };
  } catch (error) {
    logger.error('[AudioStreaming] Cleanup error:', error);
    return { error: error.message };
  }
}

/**
 * Generate audio chunks for long text (sentence by sentence)
 */
async function generateChunkedAudio(text, voiceId, options = {}) {
  const {
    onChunkReady,
    ...ttsOptions
  } = options;

  // Split text into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  const chunks = [];
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    try {
      const result = await generateStreamingAudio(trimmedSentence, voiceId, ttsOptions);

      const chunkInfo = {
        index: chunkIndex,
        text: trimmedSentence,
        streamId: result.streamId,
        url: result.publicUrl
      };

      chunks.push(chunkInfo);

      // Notify caller when chunk is ready
      if (onChunkReady) {
        onChunkReady(chunkInfo);
      }

      chunkIndex++;
    } catch (error) {
      logger.error(`[AudioStreaming] Failed to generate chunk ${chunkIndex}:`, error);
    }
  }

  return { chunks, totalChunks: chunks.length };
}

/**
 * Preload audio for smoother playback
 */
async function preloadAudio(urls) {
  const results = [];

  for (const url of urls) {
    try {
      // Convert public URL to file path
      const filename = path.basename(url);
      const filepath = path.join(AUDIO_CACHE_DIR, filename);

      // Check file existence with proper error handling
      let exists = false;
      try {
        await fs.access(filepath);
        exists = true;
      } catch (err) {
        // Only ENOENT (file not found) is expected - other errors warrant logging
        if (err.code !== 'ENOENT') {
          logger.warn(`[AudioStreaming] Unexpected file access error: ${err.message}`);
        }
        exists = false;
      }

      results.push({
        url,
        cached: exists,
        ready: exists
      });
    } catch (error) {
      results.push({
        url,
        cached: false,
        ready: false,
        error: error.message
      });
    }
  }

  return results;
}

export {
  generateStreamingAudio,
  getStreamStatus,
  streamAudioFile,
  cleanupOldStreams,
  generateChunkedAudio,
  preloadAudio,
  ensureAudioCacheDir,
  AUDIO_CACHE_DIR
};
