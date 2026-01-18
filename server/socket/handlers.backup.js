/**
 * Socket.IO Event Handlers
 * Handles real-time voice streaming and story interactions
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { ElevenLabsService, getVoiceNameById } from '../services/elevenlabs.js';
import { Orchestrator } from '../services/orchestrator.js';
import { setupRTCHandlers } from '../services/realtimeConversation.js';
import { initializeCampaignHandlers } from './campaignHandlers.js';
import { ValidationAgent } from '../services/agents/validationAgent.js';
import { LaunchSequenceManager } from '../services/launchSequenceManager.js';
import { recordingService } from '../services/recording.js';
import * as pictureBookImageGenerator from '../services/pictureBookImageGenerator.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createValidationMiddleware, checkRateLimit } from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || join(__dirname, '..', '..', 'public', 'audio');

const elevenlabs = new ElevenLabsService();
const validationAgent = new ValidationAgent();

// Track active sessions with timestamps for TTL cleanup
const activeSessions = new Map();

// Track pending audio for sessions waiting for play signal
const pendingAudio = new Map();

// Track active launch sequences for cancellation
const activeLaunchSequences = new Map();

// TTL cleanup interval (runs every 5 minutes)
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PENDING_AUDIO_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LAUNCH_SEQUENCE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// FAIL LOUD: Size limits for Maps - warn at 80%, error at 100%
const MAP_SIZE_LIMITS = {
  activeSessions: { max: 1000, warn: 800, name: 'activeSessions' },
  pendingAudio: { max: 500, warn: 400, name: 'pendingAudio' },
  activeLaunchSequences: { max: 200, warn: 160, name: 'activeLaunchSequences' }
};

/**
 * Check Map sizes and log loud warnings/errors when approaching limits
 * Does NOT silently drop entries - alerts so we can investigate
 */
function checkMapSizeLimits() {
  const checks = [
    { map: activeSessions, limits: MAP_SIZE_LIMITS.activeSessions },
    { map: pendingAudio, limits: MAP_SIZE_LIMITS.pendingAudio },
    { map: activeLaunchSequences, limits: MAP_SIZE_LIMITS.activeLaunchSequences }
  ];

  for (const { map, limits } of checks) {
    const size = map.size;

    if (size >= limits.max) {
      // CRITICAL: At or over limit
      logger.error('='.repeat(80));
      logger.error(`CRITICAL: ${limits.name} Map at capacity! Size: ${size}/${limits.max}`);
      logger.error('This indicates a memory leak or abnormal load. Investigate immediately!');
      logger.error('='.repeat(80));
    } else if (size >= limits.warn) {
      // WARNING: Approaching limit
      logger.warn(`WARNING: ${limits.name} Map approaching capacity: ${size}/${limits.max} (${Math.round(size/limits.max*100)}%)`);
    }
  }

  // Log current sizes every time for monitoring
  const totalEntries = activeSessions.size + pendingAudio.size + activeLaunchSequences.size;
  if (totalEntries > 0) {
    logger.info(`[MapStats] activeSessions: ${activeSessions.size}, pendingAudio: ${pendingAudio.size}, launchSequences: ${activeLaunchSequences.size}`);
  }
}

/**
 * FAIL LOUD: Check if a Map can accept new entries
 * Returns true if space available, throws error if at capacity
 * @param {string} mapName - 'activeSessions' | 'pendingAudio' | 'activeLaunchSequences'
 * @returns {boolean} true if space available
 * @throws {Error} if at capacity
 */
function canAddToMap(mapName) {
  const maps = {
    activeSessions,
    pendingAudio,
    activeLaunchSequences
  };
  const map = maps[mapName];
  const limits = MAP_SIZE_LIMITS[mapName];

  if (!map || !limits) {
    throw new Error(`Unknown map: ${mapName}`);
  }

  if (map.size >= limits.max) {
    const error = new Error(
      `CAPACITY EXCEEDED: ${mapName} Map is at capacity (${map.size}/${limits.max}). ` +
      `This request has been REJECTED to prevent memory exhaustion. ` +
      `This indicates either a memory leak or abnormal load.`
    );
    logger.error('='.repeat(80));
    logger.error(error.message);
    logger.error('='.repeat(80));
    throw error;
  }

  if (map.size >= limits.warn) {
    logger.warn(`[MapCapacity] ${mapName} approaching limit: ${map.size}/${limits.max}`);
  }

  return true;
}

/**
 * Cleanup stale entries from Maps to prevent memory leaks
 */
function cleanupStaleSessions() {
  const now = Date.now();
  let cleanedSessions = 0, cleanedAudio = 0, cleanedLaunch = 0;

  // Clean stale active sessions
  for (const [socketId, data] of activeSessions) {
    if (data.timestamp && now - data.timestamp > SESSION_TTL_MS) {
      activeSessions.delete(socketId);
      cleanedSessions++;
    }
  }

  // Clean stale pending audio
  for (const [sessionId, data] of pendingAudio) {
    if (data.timestamp && now - data.timestamp > PENDING_AUDIO_TTL_MS) {
      pendingAudio.delete(sessionId);
      cleanedAudio++;
    }
  }

  // Clean stale launch sequences
  for (const [sessionId, manager] of activeLaunchSequences) {
    if (manager.startTime && now - manager.startTime > LAUNCH_SEQUENCE_TTL_MS) {
      try {
        manager.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
      activeLaunchSequences.delete(sessionId);
      cleanedLaunch++;
    }
  }

  if (cleanedSessions + cleanedAudio + cleanedLaunch > 0) {
    logger.info(`[SocketCleanup] Cleaned: ${cleanedSessions} sessions, ${cleanedAudio} pending audio, ${cleanedLaunch} launch sequences`);
  }

  // Check Map sizes after cleanup - FAIL LOUD if still too large
  checkMapSizeLimits();
}

// Start cleanup interval - every 1 minute for faster detection of issues
setInterval(cleanupStaleSessions, 1 * 60 * 1000); // Every 1 minute (reduced from 5)

// Track all io instances for unified broadcasting
const ioInstances = [];

/**
 * Broadcast to all io instances (for multi-path socket support)
 * @param {string} room - Room/session ID to broadcast to
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
function broadcastToRoom(room, event, data) {
  for (const io of ioInstances) {
    io.to(room).emit(event, data);
  }
}

/**
 * Get the number of sockets in a room (for logging)
 * Uses first io instance since all share the same adapter
 */
function getRoomSocketCount(room) {
  if (ioInstances.length === 0) return 0;
  const roomSet = ioInstances[0].sockets.adapter.rooms.get(room);
  return roomSet ? roomSet.size : 0;
}

/**
 * Get a broadcast-capable io wrapper for use in other modules
 * Returns an object with the same interface but broadcasts to all instances
 */
export function getBroadcastIO() {
  return {
    to: (room) => ({
      emit: (event, data) => broadcastToRoom(room, event, data)
    }),
    emit: (event, data) => {
      for (const io of ioInstances) {
        io.emit(event, data);
      }
    }
  };
}

/**
 * Generate picture book images asynchronously (don't block audio playback)
 * Images are sent via 'scene-images-ready' event when complete
 */
async function generatePictureBookImagesAsync(sessionId, scene, wordTimings, configJson) {
  try {
    // Check if picture book mode is enabled
    const isPictureBook = await pictureBookImageGenerator.isPictureBookMode(sessionId);
    if (!isPictureBook && configJson?.story_format !== 'picture_book') {
      logger.debug(`[PictureBook] Skipping image generation - not in picture book mode`);
      return;
    }

    logger.info(`[PictureBook] Starting background image generation for scene ${scene.id}`);
    broadcastToRoom(sessionId, 'picture-book-generating', {
      message: 'Generating storybook illustrations...',
      sceneId: scene.id
    });

    // Get characters for this session
    const charResult = await pool.query(
      'SELECT id, name, role, description, appearance, reference_image_url FROM characters WHERE story_session_id = $1',
      [sessionId]
    );
    const characters = charResult.rows;

    if (characters.length === 0) {
      logger.warn(`[PictureBook] No characters found for session ${sessionId}, skipping images`);
      return;
    }

    // Generate scene images
    const sceneText = scene.polished_text || scene.summary || '';
    const style = configJson?.picture_book_style || 'storybook';

    const images = await pictureBookImageGenerator.generateSceneImages(
      scene.id,
      sceneText,
      characters,
      wordTimings,
      { sessionId, style }
    );

    if (images && images.length > 0) {
      logger.info(`[PictureBook] Generated ${images.length} images for scene ${scene.id}`);

      // Emit images to client
      broadcastToRoom(sessionId, 'scene-images-ready', {
        sceneId: scene.id,
        sceneImages: images.map(img => ({
          image_url: img.image_url,
          trigger_word_index: img.trigger_word_index,
          trigger_time_ms: img.trigger_time_ms,
          sequence_index: img.sequence_index
        }))
      });
    } else {
      logger.warn(`[PictureBook] No images generated for scene ${scene.id}`);
    }

  } catch (error) {
    logger.error(`[PictureBook] Image generation failed:`, error);
    broadcastToRoom(sessionId, 'picture-book-error', {
      message: 'Failed to generate storybook illustrations',
      error: error.message
    });
  }
}

/**
 * Setup all socket event handlers
 * Can be called multiple times with different io instances (e.g., for different paths)
 * All instances share the same session state and broadcast to all connected clients
 */
// Store app reference for accessing app.locals in socket handlers
let expressApp = null;

export function setupSocketHandlers(io, app = null) {
  // Store app reference if provided
  if (app) {
    expressApp = app;
  }

  // Register this io instance for broadcasting
  if (!ioInstances.includes(io)) {
    ioInstances.push(io);
    logger.info(`[Socket] Registered io instance (total: ${ioInstances.length})`);
  }

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (path: ${io.path()})`);

    // Apply validation middleware to sanitize all incoming events
    createValidationMiddleware(socket);

    // Setup RTC (Realtime Conversation) handlers
    setupRTCHandlers(socket);

    // Setup D&D Campaign handlers
    initializeCampaignHandlers(io, socket);

    // Join a story session room
    socket.on('join-session', async (data) => {
      const { session_id, user_id } = data;
      logger.info(`[Socket:Recv] EVENT: join-session | socketId: ${socket.id} | session_id: ${session_id} | user_id: ${user_id || 'anonymous'}`);

      if (!session_id) {
        logger.warn(`[Socket:Emit] EVENT: error | socketId: ${socket.id} | reason: missing_session_id`);
        socket.emit('error', { message: 'session_id is required' });
        return;
      }

      // Verify session exists
      const session = await pool.query(
        'SELECT * FROM story_sessions WHERE id = $1',
        [session_id]
      );

      if (session.rows.length === 0) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      socket.join(session_id);

      // FAIL LOUD: Check capacity before adding
      try {
        canAddToMap('activeSessions');
        activeSessions.set(socket.id, { session_id, user_id, timestamp: Date.now() });
      } catch (capacityError) {
        socket.emit('error', { message: 'Server at capacity. Please try again later.' });
        return;
      }

      logger.info(`[Socket:Emit] EVENT: session-joined | socketId: ${socket.id} | session_id: ${session_id} | status: ${session.rows[0].current_status}`);
      socket.emit('session-joined', {
        session_id,
        status: session.rows[0].current_status
      });
    });

    // Leave session
    socket.on('leave-session', () => {
      logger.info(`[Socket:Recv] EVENT: leave-session | socketId: ${socket.id}`);
      const sessionData = activeSessions.get(socket.id);
      if (sessionData) {
        socket.leave(sessionData.session_id);
        activeSessions.delete(socket.id);
        logger.info(`[Socket] LEFT_SESSION | socketId: ${socket.id} | session_id: ${sessionData.session_id}`);
      }
    });

    // Join a generic room (used for extraction progress, etc.)
    socket.on('join-room', (roomId) => {
      logger.info(`[Socket:Recv] EVENT: join-room | socketId: ${socket.id} | roomId: ${roomId}`);
      if (roomId) {
        socket.join(roomId);
        logger.info(`[Socket] JOINED_ROOM | socketId: ${socket.id} | roomId: ${roomId}`);
      }
    });

    // Start extraction - triggered after client joins room to avoid race condition
    socket.on('start-extraction', async (roomId) => {
      logger.info(`[Socket:Recv] EVENT: start-extraction | socketId: ${socket.id} | roomId: ${roomId}`);

      // Get pending extraction from app locals
      const extractions = expressApp?.locals?.extractions;
      if (!extractions || !extractions.has(roomId)) {
        logger.warn(`[Socket] START_EXTRACTION_FAILED | roomId: ${roomId} | reason: extraction not found | hasApp: ${!!expressApp} | hasLocals: ${!!expressApp?.locals} | hasExtractions: ${!!expressApp?.locals?.extractions}`);
        socket.emit('extraction:error', { error: 'Extraction not found or expired' });
        return;
      }

      const extraction = extractions.get(roomId);
      if (extraction.status !== 'pending') {
        logger.info(`[Socket] START_EXTRACTION_SKIPPED | roomId: ${roomId} | status: ${extraction.status}`);
        return; // Already started
      }

      // Mark as running
      extraction.status = 'running';
      extraction.startedAt = new Date();

      logger.info(`[Socket] START_EXTRACTION | roomId: ${roomId} | textLength: ${extraction.text?.length}`);

      // Import the multi-agent extractor
      const { extractFromDocument } = await import('../services/storyBibleExtractor.js');

      // Progress callback for Socket.IO - emit to the room
      const onProgress = (event, data) => {
        io.to(roomId).emit(event, data);
        logger.debug(`[StoryBible:Advanced] ${event}:`, JSON.stringify(data).substring(0, 200));
      };

      // Start extraction
      const extractionPromise = extractFromDocument(extraction.text, { libraryId: extraction.libraryId }, onProgress);
      extraction.promise = extractionPromise;

      // Handle completion
      extractionPromise.then(result => {
        extraction.status = 'complete';
        extraction.result = result;
        logger.info(`[Socket] EXTRACTION_COMPLETE | roomId: ${roomId}`);
      }).catch(error => {
        extraction.status = 'error';
        extraction.error = error.message;
        logger.error(`[Socket] EXTRACTION_ERROR | roomId: ${roomId} | error: ${error.message}`);
        io.to(roomId).emit('extraction:error', { error: error.message });
      });
    });

    // Leave a generic room
    socket.on('leave-room', (roomId) => {
      logger.info(`[Socket:Recv] EVENT: leave-room | socketId: ${socket.id} | roomId: ${roomId}`);
      if (roomId) {
        socket.leave(roomId);
        logger.info(`[Socket] LEFT_ROOM | socketId: ${socket.id} | roomId: ${roomId}`);
      }
    });

    // Client-side log bridge - receives logs from browser and writes to server log
    socket.on('client-log', (data) => {
      const { level, prefix, message, data: logData, timestamp, url } = data;
      const sessionData = activeSessions.get(socket.id);
      const sessionId = sessionData?.session_id || 'no-session';

      // Format: [Client:<prefix>] <message> | session: <id> | data: <json>
      const fullPrefix = `[Client${prefix}]`;
      const dataStr = logData ? ` | data: ${JSON.stringify(logData)}` : '';
      const logMessage = `${fullPrefix} ${message} | session: ${sessionId}${dataStr}`;

      // Route to appropriate log level
      switch (level) {
        case 'error':
          logger.error(logMessage);
          break;
        case 'warn':
          logger.warn(logMessage);
          break;
        case 'debug':
          logger.debug(logMessage);
          break;
        case 'info':
        default:
          logger.info(logMessage);
          break;
      }
    });

    // Voice input from Whisper
    socket.on('voice-input', async (data) => {
      const { session_id, transcript, confidence } = data;
      logger.info(`[Socket:Recv] EVENT: voice-input | socketId: ${socket.id} | session_id: ${session_id} | confidence: ${confidence} | transcript: "${transcript?.substring(0, 40)}..."`);

      if (!session_id || !transcript) {
        socket.emit('error', { message: 'session_id and transcript required' });
        return;
      }

      try {
        // Log the voice input
        await pool.query(`
          INSERT INTO conversation_turns (story_session_id, role, modality, content)
          VALUES ($1, 'user', 'voice', $2)
        `, [session_id, transcript]);

        // Emit acknowledgment
        socket.emit('voice-received', { transcript, confidence });

        // Process with orchestrator
        const orchestrator = new Orchestrator(session_id);
        const response = await orchestrator.processVoiceInput(transcript);

        // Emit text response
        broadcastToRoom(session_id, 'story-response', {
          type: response.type,
          text: response.text,
          message: response.message
        });

        // Generate and stream audio if text response
        if (response.text && response.generateAudio !== false) {
          await streamAudioResponse(session_id, response.text, response.voice_id);
        }

      } catch (error) {
        logger.error('Voice input processing error:', error);
        socket.emit('error', { message: 'Failed to process voice input' });
      }
    });

    // Request next scene - uses LaunchSequenceManager for sequential validation
    socket.on('continue-story', async (data) => {
      const { session_id, voice_id, autoplay = false } = data;
      logger.info(`[Socket:Recv] EVENT: continue-story | socketId: ${socket.id} | session_id: ${session_id} | voice_id: ${voice_id} | autoplay: ${autoplay}`);

      if (!session_id) {
        socket.emit('error', { message: 'session_id is required' });
        return;
      }

      try {
        // Cancel any existing launch sequence for this session
        if (activeLaunchSequences.has(session_id)) {
          activeLaunchSequences.get(session_id).cancel();
          activeLaunchSequences.delete(session_id);
        }

        // Emit progress with phases for scene generation
        const emitProgress = (step, percent, message, stats = null) => {
          socket.emit('generating', { step, percent, message, stats });
        };

        emitProgress(1, 10, 'Loading story context...');

        const orchestrator = new Orchestrator(session_id);

        // Progress callback for orchestrator (scene generation phase)
        orchestrator.onProgress = (phase, detail) => {
          const phases = {
            'loading': { step: 1, percent: 15, message: 'Loading story context...' },
            'planning': { step: 2, percent: 25, message: 'Planning next scene...' },
            'generating': { step: 3, percent: 40, message: 'Writing story content...' },
            'validating': { step: 4, percent: 55, message: 'Checking story quality...' },
            'polishing': { step: 5, percent: 70, message: 'Polishing narration...' },
            'choices': { step: 6, percent: 80, message: 'Creating choices...' },
            'saving': { step: 7, percent: 90, message: 'Saving scene...' }
          };
          const p = phases[phase] || { step: 3, percent: 50, message: detail || 'Processing...' };
          emitProgress(p.step, p.percent, p.message);
        };

        // Generate the scene content WITHOUT audio (deferAudio=true saves TTS tokens)
        // Audio will be generated on-demand when user confirms playback
        const scene = await orchestrator.generateNextScene(voice_id, { deferAudio: true });

        emitProgress(8, 92, 'Preparing launch sequence...');

        // Create and run the launch sequence for sequential validation
        // Use broadcast wrapper to ensure events go to all socket instances
        const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());

        // FAIL LOUD: Check capacity before adding
        try {
          canAddToMap('activeLaunchSequences');
          activeLaunchSequences.set(session_id, launchManager);
        } catch (capacityError) {
          socket.emit('error', { message: 'Server at capacity for story generation. Please try again later.' });
          return;
        }

        // Run sequential validation: voices -> sfx -> cover -> qa
        const launchResult = await launchManager.run(scene, voice_id);

        // Remove from active sequences
        activeLaunchSequences.delete(session_id);

        if (!launchResult || !launchResult.success) {
          logger.warn(`[ContinueStory] Launch sequence failed or cancelled for session ${session_id}`);
          return;
        }

        logger.info(`[Socket] CONTINUE_STORY_COMPLETE | session_id: ${session_id} | valid: ${launchResult.stats.isValid} | sfxCount: ${launchResult.stats.sfxCount} | narratorCount: ${launchResult.stats.narratorCount}`);

        // Store pending audio info - client will request playback after countdown
        // FAIL LOUD: Check capacity before adding
        try {
          canAddToMap('pendingAudio');
          const existingPending = pendingAudio.get(session_id);
          if (existingPending) {
            logger.warn(`[ContinueStory] OVERWRITING pendingAudio | old_sequence_index: ${existingPending.scene?.sequence_index} | new_sequence_index: ${scene.sequence_index}`);
          }
          logger.info(`[ContinueStory] Setting pendingAudio | sequence_index: ${scene.sequence_index} | hasTitle: ${!!launchResult.stats.title} | hasSynopsis: ${!!launchResult.stats.synopsis}`);
          pendingAudio.set(session_id, {
            scene,
            voice_id,
            stats: launchResult.stats,
            timestamp: Date.now()
          });
        } catch (capacityError) {
          socket.emit('error', { message: 'Server audio queue at capacity. Please try again later.' });
          return;
        }

        // NOTE: We no longer auto-start playback on server side
        // The client controls the countdown and emits 'start-playback' when ready
        // This ensures client countdown is in sync with server state

      } catch (error) {
        logger.error(`[Socket] CONTINUE_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
        activeLaunchSequences.delete(session_id);
        socket.emit('error', { message: 'Failed to generate next scene' });
      }
    });

    // Client signals it's ready to start playback (after countdown)
    socket.on('start-playback', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: start-playback | socketId: ${socket.id} | session_id: ${session_id}`);

      if (!session_id) {
        socket.emit('error', { message: 'session_id is required' });
        return;
      }

      const pending = pendingAudio.get(session_id);
      if (!pending) {
        socket.emit('error', { message: 'No pending audio for this session' });
        return;
      }

      const { scene, voice_id, stats } = pending;
      const isFirstScene = scene.sequence_index === 0;
      logger.info(`[StartPlayback] Scene info | sequence_index: ${scene.sequence_index} | isFirstScene: ${isFirstScene} | hasTitle: ${!!stats.title} | hasSynopsis: ${!!stats.synopsis}`);

      try {
        logger.info(`[StartPlayback] Starting playback for session ${session_id}`);

        // Notify client that we're now generating audio (deferred from scene generation)
        // This is when ElevenLabs tokens are actually consumed
        broadcastToRoom(session_id, 'playback-starting', {
          message: 'Generating narration audio...',
          hasAudio: !!scene.audio_url,
          isDeferred: !scene.audio_url
        });

        // Stream the audio using stats from launch sequence
        // Audio is generated on-demand here if deferAudio was true during scene generation
        await streamSceneAudio(
          session_id,
          scene,
          voice_id,
          stats.title,
          stats.synopsis,
          isFirstScene
        );

        pendingAudio.delete(session_id);

      } catch (error) {
        logger.error('Start playback error:', error);
        socket.emit('error', { message: 'Failed to start playback' });
      }
    });

    // Cancel the launch sequence (before countdown completes)
    socket.on('cancel-launch-sequence', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: cancel-launch-sequence | socketId: ${socket.id} | session_id: ${session_id}`);
      if (session_id) {
        // Cancel active launch sequence
        if (activeLaunchSequences.has(session_id)) {
          activeLaunchSequences.get(session_id).cancel();
          activeLaunchSequences.delete(session_id);
          logger.info(`[Socket] LAUNCH_CANCELLED | session_id: ${session_id}`);
        }
        // Also clear pending audio
        if (pendingAudio.has(session_id)) {
          pendingAudio.delete(session_id);
        }
        logger.info(`[Socket:Emit] EVENT: launch-sequence-cancelled | session_id: ${session_id}`);
        socket.emit('launch-sequence-cancelled', { session_id });
      }
    });

    // Confirm ready event received (cancels server-side watchdog)
    socket.on('confirm-ready', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: confirm-ready | socketId: ${socket.id} | session_id: ${session_id}`);
      if (session_id && activeLaunchSequences.has(session_id)) {
        const manager = activeLaunchSequences.get(session_id);
        if (manager.confirmReady) {
          manager.confirmReady();
        }
        logger.info(`[Socket] READY_CONFIRMED | session_id: ${session_id}`);
      }
    });

    // Retry a specific failed stage
    socket.on('retry-stage', async (data) => {
      const { session_id, stage } = data;
      logger.info(`[Socket:Recv] EVENT: retry-stage | socketId: ${socket.id} | session_id: ${session_id} | stage: ${stage}`);
      if (!session_id || !stage) {
        socket.emit('error', { message: 'session_id and stage required' });
        return;
      }

      if (!activeLaunchSequences.has(session_id)) {
        socket.emit('error', { message: 'No active launch sequence for this session' });
        return;
      }

      try {
        logger.info(`[Socket] RETRY_STAGE | session_id: ${session_id} | stage: ${stage}`);
        const manager = activeLaunchSequences.get(session_id);
        const result = await manager.retryStage(stage);

        socket.emit('retry-stage-complete', {
          session_id,
          stage,
          success: result.success,
          status: result.status,
          error: result.error
        });

      } catch (error) {
        logger.error(`[RetryStage] Error retrying stage ${stage}:`, error);
        socket.emit('retry-stage-complete', {
          session_id,
          stage,
          success: false,
          error: error.message
        });
      }
    });

    // Request cover art regeneration
    socket.on('regenerate-cover', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: regenerate-cover | socketId: ${socket.id} | session_id: ${session_id}`);
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        logger.info(`[Socket] REGENERATE_COVER | session_id: ${session_id}`);

        // Get session info with outline
        const sessionResult = await pool.query(`
          SELECT s.title, s.synopsis, s.config_json, o.themes, o.outline_json
          FROM story_sessions s
          LEFT JOIN story_outlines o ON o.story_session_id = s.id
          WHERE s.id = $1
        `, [session_id]);

        if (sessionResult.rows.length === 0) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        const session = sessionResult.rows[0];

        // Notify client that generation started
        broadcastToRoom(session_id, 'cover-regenerating', {
          session_id,
          title: session.title
        });

        // Actually generate the cover using DALL-E
        const config = session.config_json || {};
        const outlineData = session.outline_json || {};
        const rawSynopsis = session.synopsis || outlineData.synopsis || '';
        const rawThemes = session.themes || outlineData.themes || [];
        const rawTitle = session.title || outlineData.title || 'Untitled Story';
        const genre = config.genre || config.story_type || 'fantasy';
        const authorStyle = config.author_style || '';

        // Sanitize content for DALL-E safety
        const sanitize = (text, genre) => {
          if (!text) return text;
          let s = text;
          const replacements = [
            [/\b(blood|bloody|bleeding)\b/gi, 'crimson'],
            [/\b(gore|gory|gruesome)\b/gi, 'dramatic'],
            [/\b(kill|killing|killed|murder|murdered)\b/gi, 'confrontation'],
            [/\b(death|dead|dying|die|dies)\b/gi, 'fate'],
            [/\b(corpse|corpses|body|bodies)\b/gi, 'figure'],
            [/\b(severed|dismembered|mutilated)\b/gi, 'shadowy'],
            [/\b(torture|torment)\b/gi, 'struggle'],
            [/\b(weapon|knife|sword|gun|blade)\b/gi, 'object'],
            [/\b(attack|attacked|attacking)\b/gi, 'encounter'],
            [/\b(victim|victims)\b/gi, 'character'],
            [/\b(scream|screaming|screams)\b/gi, 'call'],
            [/\b(terror|terrorize|terrifying)\b/gi, 'intense'],
            [/\b(horrific|horrifying)\b/gi, 'dramatic'],
            [/\b(nightmare|nightmarish)\b/gi, 'dreamlike'],
            [/\b(demon|demonic|devil)\b/gi, 'ethereal being'],
            [/\b(monster|monstrous)\b/gi, 'mysterious creature'],
            [/\b(zombie|zombies|undead)\b/gi, 'spectral figure'],
            [/\b(evil|sinister|malevolent)\b/gi, 'enigmatic'],
            [/\b(haunted|haunting)\b/gi, 'atmospheric'],
            [/\b(ghost|ghosts|ghostly)\b/gi, 'ethereal presence'],
            [/\b(skull|skulls)\b/gi, 'symbol'],
            [/\b(grave|graveyard|cemetery)\b/gi, 'ancient grounds'],
            [/\b(fear|fearsome|afraid)\b/gi, 'tension'],
            [/\b(creepy|creeping)\b/gi, 'mysterious'],
            [/\b(horror)\b/gi, 'gothic suspense'],
            [/\b(thriller)\b/gi, 'mystery suspense'],
            [/\b(scary)\b/gi, 'atmospheric']
          ];
          for (const [pattern, replacement] of replacements) {
            s = s.replace(pattern, replacement);
          }
          return s;
        };

        const title = sanitize(rawTitle, genre);
        const synopsis = sanitize(rawSynopsis, genre);
        const themes = rawThemes.map(t => sanitize(t, genre));
        const safeGenre = sanitize(genre, genre);

        const coverPrompt = `A dramatic paperback book cover illustration for a ${safeGenre} story titled "${title}".
${synopsis ? `Story synopsis: ${synopsis.substring(0, 200)}` : ''}
${themes.length > 0 ? `Themes: ${themes.slice(0, 3).join(', ')}` : ''}
${authorStyle ? `In the visual style reminiscent of ${authorStyle} book covers` : ''}

Style: Professional book cover art, cinematic lighting, rich colors, evocative atmosphere, NO TEXT on the image.
Art style: tasteful, atmospheric, suitable for all audiences.`;

        logger.info(`[RegenerateCover] Generating with DALL-E for ${session_id}`);

        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const imageResponse = await openai.images.generate({
          model: 'dall-e-3',
          prompt: coverPrompt,
          n: 1,
          size: '1024x1792',
          quality: 'standard',
          style: 'vivid'
        });

        const dalleUrl = imageResponse.data[0]?.url;
        if (!dalleUrl) {
          throw new Error('No image URL returned from DALL-E');
        }

        // Save locally
        const fs = await import('fs/promises');
        const path = await import('path');
        const https = await import('https');
        const { createWriteStream } = await import('fs');

        const coversDir = path.join(process.cwd(), 'public', 'covers');
        try {
          await fs.mkdir(coversDir, { recursive: true });
        } catch (e) {
          // Only log if not EEXIST (directory already exists is expected)
          if (e.code !== 'EEXIST') {
            logger.warn(`[RegenerateCover] Failed to create covers directory: ${e.message}`);
          }
        }

        const filename = `cover_${session_id}_${Date.now()}.png`;
        const localPath = path.join(coversDir, filename);

        await new Promise((resolve, reject) => {
          https.get(dalleUrl, (response) => {
            // Check for successful HTTP response
            if (response.statusCode !== 200) {
              reject(new Error(`Failed to download cover: HTTP ${response.statusCode}`));
              return;
            }

            const fileStream = createWriteStream(localPath);
            response.pipe(fileStream);

            // FIXED: Use close event instead of calling close() manually
            // This ensures the file is fully written and closed before resolving
            fileStream.on('close', resolve);
            fileStream.on('error', (err) => {
              // Clean up partial file on error
              fileStream.close();
              reject(err);
            });
          }).on('error', reject);
        });

        const localUrl = `/storyteller/covers/${filename}`;

        // Update database
        await pool.query(`
          UPDATE story_sessions SET cover_image_url = $1, last_activity_at = NOW() WHERE id = $2
        `, [localUrl, session_id]);

        logger.info(`[RegenerateCover] Cover saved: ${localUrl}`);

        // Emit success
        broadcastToRoom(session_id, 'cover-regenerated', {
          session_id,
          success: true,
          cover_url: localUrl
        });

      } catch (error) {
        logger.error(`[RegenerateCover] Error:`, error);
        socket.emit('cover-regenerated', {
          session_id,
          success: false,
          error: error.message
        });
      }
    });

    // Request synopsis regeneration
    socket.on('regenerate-synopsis', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: regenerate-synopsis | socketId: ${socket.id} | session_id: ${session_id}`);
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        logger.info(`[Socket] REGENERATE_SYNOPSIS | session_id: ${session_id}`);

        // Get session and outline
        const sessionResult = await pool.query(
          'SELECT title, synopsis, config_json FROM story_sessions WHERE id = $1',
          [session_id]
        );

        const outlineResult = await pool.query(
          'SELECT * FROM story_outlines WHERE story_session_id = $1',
          [session_id]
        );

        if (sessionResult.rows.length === 0) {
          socket.emit('synopsis-regenerated', { session_id, success: false, error: 'Session not found' });
          return;
        }

        const session = sessionResult.rows[0];
        const outline = outlineResult.rows[0]?.outline_json || {};

        // Regenerate synopsis using orchestrator
        const orchestrator = new Orchestrator(session_id);
        const newSynopsis = await orchestrator.regenerateSynopsis();

        broadcastToRoom(session_id, 'synopsis-regenerated', {
          session_id,
          success: true,
          title: session.title,
          synopsis: newSynopsis
        });

        logger.info(`[RegenerateSynopsis] Synopsis regenerated for session ${session_id}`);

      } catch (error) {
        logger.error(`[RegenerateSynopsis] Error:`, error);
        socket.emit('synopsis-regenerated', {
          session_id,
          success: false,
          error: error.message
        });
      }
    });

    // Request SFX re-detection
    socket.on('regenerate-sfx', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: regenerate-sfx | socketId: ${socket.id} | session_id: ${session_id}`);
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        logger.info(`[Socket] REGENERATE_SFX | session_id: ${session_id}`);

        // Get the pending scene if available
        const pending = pendingAudio.get(session_id);
        if (!pending || !pending.scene) {
          socket.emit('sfx-regenerated', { session_id, success: false, error: 'No scene available for SFX detection' });
          return;
        }

        const scene = pending.scene;

        // Run SFX detection on the scene text
        if (activeLaunchSequences.has(session_id)) {
          const manager = activeLaunchSequences.get(session_id);
          if (manager.runSFXGeneration) {
            await manager.runSFXGeneration();
          }
        } else {
          // Create a temporary manager just for SFX
          const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());
          launchManager.scene = scene;
          await launchManager.runSFXGeneration();
        }

        logger.info(`[RegenerateSfx] SFX re-detected for session ${session_id}`);

      } catch (error) {
        logger.error(`[RegenerateSfx] Error:`, error);
        socket.emit('sfx-regenerated', {
          session_id,
          success: false,
          error: error.message
        });
      }
    });

    // Request voice reassignment
    socket.on('regenerate-voices', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: regenerate-voices | socketId: ${socket.id} | session_id: ${session_id}`);
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        logger.info(`[Socket] REGENERATE_VOICES | session_id: ${session_id}`);

        // Run voice assignment stage
        if (activeLaunchSequences.has(session_id)) {
          const manager = activeLaunchSequences.get(session_id);
          if (manager.runVoiceAssignment) {
            await manager.runVoiceAssignment();
          }
        } else {
          // Create a temporary manager just for voices
          const pending = pendingAudio.get(session_id);
          if (!pending) {
            socket.emit('voices-regenerated', { session_id, success: false, error: 'No pending session' });
            return;
          }

          const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());
          launchManager.scene = pending.scene;
          await launchManager.runVoiceAssignment();
        }

        logger.info(`[RegenerateVoices] Voices reassigned for session ${session_id}`);

      } catch (error) {
        logger.error(`[RegenerateVoices] Error:`, error);
        socket.emit('voices-regenerated', {
          session_id,
          success: false,
          error: error.message
        });
      }
    });

    // Client wants to cancel pending playback
    socket.on('cancel-playback', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: cancel-playback | socketId: ${socket.id} | session_id: ${session_id}`);
      if (session_id && pendingAudio.has(session_id)) {
        pendingAudio.delete(session_id);
        logger.info(`[Socket] PLAYBACK_CANCELLED | session_id: ${session_id}`);
        socket.emit('playback-cancelled', { session_id });
      }
    });

    // Submit CYOA choice
    socket.on('submit-choice', async (data) => {
      const { session_id, choice_key } = data;
      logger.info(`[Socket:Recv] EVENT: submit-choice | socketId: ${socket.id} | session_id: ${session_id} | choice_key: ${choice_key}`);

      if (!session_id || !choice_key) {
        socket.emit('error', { message: 'session_id and choice_key required' });
        return;
      }

      try {
        // Mark choice as selected
        const result = await pool.query(`
          UPDATE story_choices
          SET was_selected = true, selected_at = NOW()
          WHERE story_session_id = $1 AND choice_key = $2 AND was_selected = false
          RETURNING *
        `, [session_id, choice_key.toUpperCase()]);

        if (result.rows.length === 0) {
          socket.emit('error', { message: 'Choice not found or already selected' });
          return;
        }

        const choice = result.rows[0];

        // Log choice
        await pool.query(`
          INSERT INTO conversation_turns (story_session_id, role, modality, content)
          VALUES ($1, 'user', 'voice', $2)
        `, [session_id, `Selected: ${choice.choice_key} - ${choice.choice_text}`]);

        broadcastToRoom(session_id, 'choice-accepted', {
          key: choice.choice_key,
          text: choice.choice_text
        });

      } catch (error) {
        logger.error('Submit choice error:', error);
        socket.emit('error', { message: 'Failed to submit choice' });
      }
    });

    // Pause story
    socket.on('pause-story', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: pause-story | socketId: ${socket.id} | session_id: ${session_id}`);

      if (!session_id) return;

      try {
        await pool.query(
          "UPDATE story_sessions SET current_status = 'paused' WHERE id = $1",
          [session_id]
        );

        logger.info(`[Socket] STORY_PAUSED | session_id: ${session_id}`);
        logger.info(`[Socket:Emit] EVENT: story-paused | session_id: ${session_id}`);
        broadcastToRoom(session_id, 'story-paused', { message: 'Story paused' });

      } catch (error) {
        logger.error(`[Socket] PAUSE_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
      }
    });

    // Resume story
    socket.on('resume-story', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: resume-story | socketId: ${socket.id} | session_id: ${session_id}`);

      if (!session_id) return;

      try {
        await pool.query(
          "UPDATE story_sessions SET current_status = 'narrating' WHERE id = $1",
          [session_id]
        );

        logger.info(`[Socket] STORY_RESUMED | session_id: ${session_id}`);
        logger.info(`[Socket:Emit] EVENT: story-resumed | session_id: ${session_id}`);
        broadcastToRoom(session_id, 'story-resumed', { message: 'Story resumed' });

      } catch (error) {
        logger.error(`[Socket] RESUME_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const sessionData = activeSessions.get(socket.id);
      if (sessionData) {
        activeSessions.delete(socket.id);
        logger.info(`[Socket] DISCONNECT | socketId: ${socket.id} | session_id: ${sessionData.session_id} | hadSession: true`);
      } else {
        logger.info(`[Socket] DISCONNECT | socketId: ${socket.id} | hadSession: false`);
      }
    });
  });

  return io;
}

/**
 * Generate narration text for CYOA choices
 */
function generateChoiceNarration(choices) {
  if (!choices || choices.length === 0) return '';

  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
  let narration = 'What will you do? ';

  choices.forEach((choice, index) => {
    const ordinal = ordinals[index] || `Option ${index + 1}`;
    // Use choice_text if available, otherwise use the choice object itself
    const choiceText = choice.choice_text || choice.text || choice;
    narration += `${ordinal}, ${choiceText}. `;
  });

  narration += 'Speak your choice, or tap to select.';
  return narration;
}

/**
 * Stream choice narration audio to clients
 */
async function streamChoiceAudio(sessionId, text, voiceId) {
  try {
    logger.info(`[ChoiceAudio] Generating choice narration for session ${sessionId}`);

    // If no voiceId provided, load from session config
    let effectiveVoiceId = voiceId;
    if (!effectiveVoiceId && sessionId) {
      try {
        const result = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        if (result.rows[0]?.config_json) {
          effectiveVoiceId = result.rows[0].config_json.voice_id || result.rows[0].config_json.narratorVoice;
          logger.info(`[ChoiceAudio] Loaded voice_id from session config: ${effectiveVoiceId}`);
        }
      } catch (err) {
        logger.warn(`[ChoiceAudio] Failed to load session config for voice: ${err.message}`);
      }
    }

    logger.info(`[ChoiceAudio] Using voiceId: ${effectiveVoiceId || 'DEFAULT'}`);
    const audioBuffer = await elevenlabs.textToSpeech(text, effectiveVoiceId);

    // Convert buffer to base64 for transmission
    const audioBase64 = audioBuffer.toString('base64');

    logger.info(`[ChoiceAudio] Emitting choice-audio-ready to session ${sessionId} (${audioBase64.length} chars)`);

    broadcastToRoom(sessionId, 'choice-audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: audioBuffer.length,
      text: text
    });

    logger.info(`[ChoiceAudio] choice-audio-ready emitted successfully`);

  } catch (error) {
    logger.error('[ChoiceAudio] Choice audio streaming error:', error);
    // Don't block on choice audio failure - just skip it
    broadcastToRoom(sessionId, 'choice-audio-error', { message: 'Failed to generate choice audio' });
  }
}

/**
 * Stream scene audio with optional title/synopsis narration for first scene
 * Handles the complete audio playback sequence including:
 * 1. Title and synopsis narration (first scene only)
 * 2. Main scene audio (now supports MULTI-VOICE via orchestrator!)
 * 3. Choice narration (if CYOA)
 */
async function streamSceneAudio(sessionId, scene, voiceId, title, synopsis, isFirstScene) {
  try {
    const startTime = Date.now();
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Preparing audio...' });

    // IMPORTANT: Load voice from session config if not provided
    // This fixes the bug where intro/narration uses ElevenLabs default instead of user's selected voice
    let effectiveVoiceId = voiceId;
    let sessionConfig = null;
    if (!effectiveVoiceId && sessionId) {
      try {
        const result = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        if (result.rows[0]?.config_json) {
          sessionConfig = result.rows[0].config_json;
          effectiveVoiceId = sessionConfig.voice_id || sessionConfig.narratorVoice;
          logger.info(`[SceneAudio] Loaded voice_id from session config: ${effectiveVoiceId}`);
        }
      } catch (err) {
        logger.warn(`[SceneAudio] Failed to load session config for voice: ${err.message}`);
      }
    }

    // =========================================================================
    // PARALLEL AUDIO GENERATION: Generate intro + scene audio simultaneously
    // This reduces lag by 1.5-2.5 seconds compared to sequential generation
    // =========================================================================

    // Build intro text if first scene
    let introText = null;
    logger.info(`[SceneAudio] Intro check | isFirstScene: ${isFirstScene} | hasTitle: ${!!title} | hasSynopsis: ${!!synopsis}`);
    if (isFirstScene && (title || synopsis)) {
      introText = '';
      if (title) introText += title + '. ';
      if (synopsis) introText += synopsis + '. ';
      introText += 'And now, our story begins.';
      logger.info(`[SceneAudio] Will generate intro audio in parallel (${introText.length} chars)`);
    } else if (!isFirstScene) {
      logger.info(`[SceneAudio] Skipping intro audio - not first scene`);
    } else {
      logger.info(`[SceneAudio] Skipping intro audio - no title or synopsis available`);
    }

    // Prepare scene audio generation config
    let configJson = sessionConfig;
    let useMultiVoice = false;
    let characterCount = 0;

    // Load config and character count (needed for both paths)
    if (!configJson || !sessionConfig) {
      try {
        const sessionResult = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        configJson = sessionResult.rows[0]?.config_json;
        if (!effectiveVoiceId && configJson) {
          effectiveVoiceId = configJson.voice_id || configJson.narratorVoice;
        }
      } catch (checkErr) {
        logger.warn(`[SceneAudio] Failed to load session config: ${checkErr.message}`);
      }
    }

    // Check for characters
    if (scene.polished_text && scene.id) {
      try {
        const charResult = await pool.query(
          'SELECT COUNT(*) as count FROM characters WHERE story_session_id = $1',
          [sessionId]
        );
        characterCount = parseInt(charResult.rows[0]?.count || 0, 10);
        const multiVoiceExplicitlyDisabled = configJson?.multi_voice === false || configJson?.multiVoice === false;
        useMultiVoice = characterCount > 0 && !multiVoiceExplicitlyDisabled;
        logger.info(`[SceneAudio] multi_voice: characters=${characterCount}, explicitlyDisabled=${multiVoiceExplicitlyDisabled}, resolved=${useMultiVoice}`);
      } catch (charErr) {
        logger.warn(`[SceneAudio] Failed to check characters: ${charErr.message}`);
      }
    }

    // =========================================================================
    // PARALLEL GENERATION STRATEGY:
    // 1. Start intro generation immediately (Promise)
    // 2. Start scene generation immediately (Promise)
    // 3. Wait for both to complete
    // 4. Emit intro-audio-ready first, then audio-ready
    // This saves ~1.5-2.5 seconds vs sequential generation
    // =========================================================================

    broadcastToRoom(sessionId, 'intro-audio-generating', { message: 'Narrating story introduction...' });
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Generating story audio...' });

    // Create intro generation promise (if needed)
    const introPromise = introText
      ? elevenlabs.textToSpeech(introText, effectiveVoiceId).catch(err => {
          logger.error(`[SceneAudio] Intro audio failed: ${err.message}`);
          return null; // Don't fail the whole flow
        })
      : Promise.resolve(null);

    // Create scene generation promise
    let scenePromise;

    if (scene.audio_url) {
      // Scene audio already cached - just return the URL
      logger.info(`[SceneAudio] Scene has pre-generated audio: ${scene.audio_url}`);
      scenePromise = Promise.resolve({ type: 'cached', audioUrl: scene.audio_url });
    } else if (scene.polished_text) {
      if (useMultiVoice && scene.id) {
        // Multi-voice generation via orchestrator
        logger.info(`[SceneAudio] Starting PARALLEL multi-voice generation for session ${sessionId}`);
        scenePromise = (async () => {
          try {
            const orchestrator = new Orchestrator(sessionId);
            const result = await orchestrator.generateSceneAudio(scene.id, effectiveVoiceId);
            return { type: 'multivoice', ...result };
          } catch (err) {
            logger.error(`[SceneAudio] Multi-voice failed, will fallback: ${err.message}`);
            return { type: 'fallback', text: scene.polished_text };
          }
        })();
      } else {
        // Single-voice generation
        logger.info(`[SceneAudio] Starting PARALLEL single-voice generation for session ${sessionId}`);
        scenePromise = elevenlabs.textToSpeechWithTimestamps(scene.polished_text, effectiveVoiceId, {
          sessionId,
          speaker: 'narrator'
        }).then(result => ({ type: 'singlevoice', ...result }))
          .catch(err => {
            logger.error(`[SceneAudio] Single-voice failed: ${err.message}`);
            return null;
          });
      }
    } else {
      scenePromise = Promise.resolve(null);
    }

    // Wait for BOTH to complete in parallel
    const parallelStart = Date.now();
    const [introBuffer, sceneResult] = await Promise.all([introPromise, scenePromise]);
    const parallelDuration = Date.now() - parallelStart;
    logger.info(`[SceneAudio] Parallel generation completed in ${parallelDuration}ms`);

    // Emit intro audio first (if available)
    if (introBuffer) {
      const introBase64 = introBuffer.toString('base64');
      broadcastToRoom(sessionId, 'intro-audio-ready', {
        audio: introBase64,
        format: 'mp3',
        size: introBuffer.length,
        title,
        synopsis
      });
      logger.info(`[SceneAudio] Intro audio emitted (${introBuffer.length} bytes)`);

      // Record intro audio to the active recording (if scene 0 started a recording)
      const activeRecordingId = recordingService.getActiveRecording(sessionId);
      if (activeRecordingId) {
        try {
          await recordingService.addIntroSegment(activeRecordingId, {
            audioBuffer: introBuffer,
            title,
            synopsis
          });
          logger.info(`[Recording] Intro segment saved for session ${sessionId}`);
        } catch (recordErr) {
          logger.error(`[Recording] Failed to save intro segment: ${recordErr.message}`);
          // Don't fail the whole flow if recording fails
        }
      } else {
        logger.debug(`[Recording] No active recording for intro segment (session ${sessionId})`);
      }
    }

    // Emit scene audio and track buffer for recording
    let sceneAudioBuffer = null;
    let sceneWordTimings = null;

    if (sceneResult) {
      if (sceneResult.type === 'cached') {
        await streamCachedAudio(sessionId, sceneResult.audioUrl);
        // Cached audio - no buffer to record (already saved)
      } else if (sceneResult.type === 'multivoice') {
        if (sceneResult.audioBuffer) {
          const audioBase64 = sceneResult.audioBuffer.toString('base64');
          broadcastToRoom(sessionId, 'audio-ready', {
            audio: audioBase64,
            format: 'mp3',
            size: sceneResult.audioBuffer.length,
            wordTimings: sceneResult.wordTimings
          });
          logger.info(`[SceneAudio] Multi-voice audio emitted (${sceneResult.wordTimings?.words?.length || 0} word timings)`);
          // Track for recording
          sceneAudioBuffer = sceneResult.audioBuffer;
          sceneWordTimings = sceneResult.wordTimings;
        } else if (sceneResult.audioUrl) {
          await streamCachedAudio(sessionId, sceneResult.audioUrl);
        }
      } else if (sceneResult.type === 'singlevoice') {
        if (sceneResult.audio) {
          const audioBase64 = sceneResult.audio.toString('base64');
          broadcastToRoom(sessionId, 'audio-ready', {
            audio: audioBase64,
            format: 'mp3',
            size: sceneResult.audio.length,
            wordTimings: sceneResult.wordTimings
          });
          logger.info(`[SceneAudio] Single-voice audio emitted`);
          // Track for recording
          sceneAudioBuffer = sceneResult.audio;
          sceneWordTimings = sceneResult.wordTimings;
        }
      } else if (sceneResult.type === 'fallback') {
        // Multi-voice failed, fallback to single-voice (already logged)
        await streamAudioResponse(sessionId, sceneResult.text, effectiveVoiceId);
        // Fallback doesn't provide buffer - handled in streamAudioResponse
      }
    } else if (scene.polished_text) {
      // Both failed, try one more time with simple TTS
      logger.warn(`[SceneAudio] Parallel generation returned null, attempting fallback`);
      await streamAudioResponse(sessionId, scene.polished_text, effectiveVoiceId);
    } else {
      logger.warn(`[SceneAudio] No audio content for scene`);
    }

    // Generate picture book images in background (don't block audio playback)
    // Images will be sent via 'scene-images-ready' event when complete
    if (sceneWordTimings && scene.id) {
      generatePictureBookImagesAsync(sessionId, scene, sceneWordTimings, configJson);
    }

    // Record scene segment to active recording (if any)
    if (sceneAudioBuffer) {
      const activeRecordingId = recordingService.getActiveRecording(sessionId);
      if (activeRecordingId) {
        try {
          // Load SFX data for this scene from database
          let sfxData = [];
          try {
            const sfxResult = await pool.query(
              'SELECT sfx_key, detected_keyword, detection_reason, volume FROM scene_sfx WHERE scene_id = $1',
              [scene.id]
            );
            sfxData = sfxResult.rows.map(sfx => ({
              sfx_key: sfx.sfx_key,
              keyword: sfx.detected_keyword,
              reason: sfx.detection_reason,
              volume: sfx.volume,
              trigger_at_seconds: 0 // Default; could be calculated if word timings available
            }));
          } catch (sfxErr) {
            logger.warn(`[Recording] Failed to load SFX data: ${sfxErr.message}`);
          }

          await recordingService.addSegment(activeRecordingId, {
            sceneId: scene.id,
            sequenceIndex: scene.sequence_index,
            audioBuffer: sceneAudioBuffer,
            wordTimings: sceneWordTimings,
            sceneText: scene.polished_text,
            sceneSummary: scene.summary,
            sfxData,
            choicesAtEnd: scene.choices?.length > 0 ? scene.choices : null,
            mood: scene.mood,
            chapterNumber: scene.sequence_index + 1,
            chapterTitle: `Chapter ${scene.sequence_index + 1}`
          });
          logger.info(`[Recording] Scene segment ${scene.sequence_index} saved for session ${sessionId}`);
        } catch (recordErr) {
          logger.error(`[Recording] Failed to save scene segment: ${recordErr.message}`);
          // Don't fail the whole flow if recording fails
        }
      } else {
        logger.debug(`[Recording] No active recording for scene segment (session ${sessionId})`);
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info(`[SceneAudio] Total audio generation took ${totalDuration}ms (parallel: ${parallelDuration}ms)`)

    // If there are choices, generate and send choice narration (after main audio)
    if (scene.choices && scene.choices.length > 0 && !scene.is_final) {
      logger.info(`[SceneAudio] Generating choice narration for ${scene.choices.length} choices`);
      const choiceText = generateChoiceNarration(scene.choices);
      await streamChoiceAudio(sessionId, choiceText, effectiveVoiceId);
    }

  } catch (error) {
    logger.error('[SceneAudio] Scene audio streaming error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to generate scene audio' });
  }
}

/**
 * Stream audio response to clients
 */
async function streamAudioResponse(sessionId, text, voiceId) {
  try {
    logger.info(`[Audio] Emitting audio-generating to session ${sessionId}`);
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Generating audio...' });

    // If no voiceId provided, load from session config (bug fix: voice was being ignored)
    let effectiveVoiceId = voiceId;
    if (!effectiveVoiceId && sessionId) {
      try {
        const result = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        if (result.rows[0]?.config_json) {
          effectiveVoiceId = result.rows[0].config_json.voice_id || result.rows[0].config_json.narratorVoice;
          logger.info(`[Audio] Loaded voice_id from session config: ${effectiveVoiceId}`);
        }
      } catch (err) {
        logger.warn(`[Audio] Failed to load session config for voice: ${err.message}`);
      }
    }

    // Get voice name for enhanced logging
    const voiceName = await getVoiceNameById(effectiveVoiceId || 'DEFAULT');
    logger.info(`[Audio] ========== STREAMING AUDIO ==========`);
    logger.info(`[Audio] Voice: "${voiceName}" (ID: ${effectiveVoiceId || 'DEFAULT'})`);
    logger.info(`[Audio] Session: ${sessionId}`);
    logger.info(`[Audio] Text preview: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    // Use textToSpeechWithTimestamps to get word-level timing for karaoke/read-along feature
    const result = await elevenlabs.textToSpeechWithTimestamps(text, effectiveVoiceId, {
      sessionId, // For usage tracking
      speaker: 'narrator' // For logging
    });

    // Convert buffer to base64 for transmission
    const audioBase64 = result.audio.toString('base64');

    // Check how many sockets are in the room
    const socketCount = getRoomSocketCount(sessionId);
    logger.info(`[Audio] Emitting audio-ready to session ${sessionId} (${socketCount} sockets in room, ${audioBase64.length} chars, ${result.wordTimings?.word_count || 0} word timings)`);

    broadcastToRoom(sessionId, 'audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: result.audio.length,
      wordTimings: result.wordTimings // Include word timings for karaoke/read-along
    });

    logger.info(`[Audio] ✓ audio-ready emitted successfully`);
    logger.info(`[VOICE_PLAYED] narrator → "${voiceName}" (${effectiveVoiceId}) [STREAM]`);
    logger.info(`[Audio] ========================================`);

  } catch (error) {
    logger.error('Audio streaming error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to generate audio' });
  }
}

/**
 * Stream pre-cached audio file to clients
 * Used when audio was already generated (e.g., multi-voice audio)
 */
async function streamCachedAudio(sessionId, audioUrl) {
  try {
    logger.info(`[CachedAudio] Streaming cached audio for session ${sessionId}: ${audioUrl}`);
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Loading audio...' });

    // Extract filename from URL (e.g., /audio/abc123.mp3 -> abc123.mp3)
    const filename = audioUrl.replace(/^\/audio\//, '');
    const filePath = join(AUDIO_CACHE_DIR, filename);

    if (!existsSync(filePath)) {
      logger.error(`[CachedAudio] Audio file not found: ${filePath}`);
      broadcastToRoom(sessionId, 'audio-error', { message: 'Audio file not found' });
      return;
    }

    // Use async readFile to avoid blocking the event loop
    const audioBuffer = await readFile(filePath);
    const audioBase64 = audioBuffer.toString('base64');

    const socketCount = getRoomSocketCount(sessionId);
    logger.info(`[CachedAudio] Emitting audio-ready to session ${sessionId} (${socketCount} sockets, ${audioBase64.length} chars)`);

    broadcastToRoom(sessionId, 'audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: audioBuffer.length
    });

    logger.info(`[CachedAudio] audio-ready emitted successfully`);

  } catch (error) {
    logger.error('[CachedAudio] Cached audio streaming error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to load cached audio' });
  }
}

/**
 * Connect to Whisper service for voice transcription
 */
export async function connectToWhisperService(io) {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:3003';

  try {
    const { default: ioClient } = await import('socket.io-client');
    const whisperSocket = ioClient(whisperUrl);

    whisperSocket.on('connect', () => {
      logger.info('Connected to Whisper service');
    });

    whisperSocket.on('transcription', (data) => {
      const { session_id, transcript, confidence } = data;

      if (session_id) {
        broadcastToRoom(session_id, 'voice-input', {
          transcript,
          confidence
        });
      }
    });

    whisperSocket.on('disconnect', () => {
      logger.warn('Disconnected from Whisper service');
    });

    whisperSocket.on('error', (error) => {
      logger.error('Whisper service error:', error);
    });

    return whisperSocket;

  } catch (error) {
    logger.error('Failed to connect to Whisper service:', error);
    return null;
  }
}

export default { setupSocketHandlers, connectToWhisperService };
