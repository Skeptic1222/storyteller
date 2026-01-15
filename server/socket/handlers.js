/**
 * Socket.IO Event Handlers
 * Main entry point - delegates to specialized handler modules
 *
 * Modular Structure:
 * - state.js: Shared state (Maps, broadcasting, cleanup)
 * - sessionHandlers.js: Session lifecycle (join, leave, rooms)
 * - audioHandlers.js: Audio streaming and playback
 * - storyHandlers.js: Story progression (continue, choices)
 * - validation.js: Input validation middleware
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { Orchestrator } from '../services/orchestrator.js';
import { setupRTCHandlers } from '../services/realtimeConversation.js';
// DnD campaign handlers removed - migrated to GameMaster (2026-01-08)
import { LaunchSequenceManager } from '../services/launchSequenceManager.js';
import * as pictureBookImageGenerator from '../services/pictureBookImageGenerator.js';
import { createWriteStream } from 'fs';
import { createValidationMiddleware } from './validation.js';

// Import shared state and utilities
import {
  activeSessions,
  pendingAudio,
  activeLaunchSequences,
  registerIOInstance,
  setExpressApp,
  broadcastToRoom,
  getBroadcastIO,
  canAddToMap
} from './state.js';

// Import handler modules
import { setupSessionHandlers } from './sessionHandlers.js';
import { setupPlaybackHandlers, streamSceneAudio, streamAudioResponse } from './audioHandlers.js';
import { setupStoryHandlers } from './storyHandlers.js';
import { requireSessionOwner } from './socketAuth.js';

// Re-export for backward compatibility
export { getBroadcastIO };

/**
 * Generate picture book images asynchronously
 */
async function generatePictureBookImagesAsync(sessionId, scene, wordTimings, configJson) {
  try {
    const isPictureBook = await pictureBookImageGenerator.isPictureBookMode(sessionId);
    if (!isPictureBook && configJson?.story_format !== 'picture_book') {
      return;
    }

    logger.info(`[PictureBook] Starting background image generation for scene ${scene.id}`);
    broadcastToRoom(sessionId, 'picture-book-generating', {
      message: 'Generating storybook illustrations...',
      sceneId: scene.id
    });

    const charResult = await pool.query(
      'SELECT id, name, role, description, appearance, reference_image_url FROM characters WHERE story_session_id = $1',
      [sessionId]
    );
    const characters = charResult.rows;

    if (characters.length === 0) {
      logger.warn(`[PictureBook] No characters found for session ${sessionId}`);
      return;
    }

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
      broadcastToRoom(sessionId, 'scene-images-ready', {
        sceneId: scene.id,
        sceneImages: images.map(img => ({
          image_url: img.image_url,
          trigger_word_index: img.trigger_word_index,
          trigger_time_ms: img.trigger_time_ms,
          sequence_index: img.sequence_index
        }))
      });
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
 */
export function setupSocketHandlers(io, app = null) {
  if (app) {
    setExpressApp(app);
  }

  registerIOInstance(io);

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (path: ${io.path()})`);

    // Apply validation middleware
    createValidationMiddleware(socket);

    // Setup modular handlers
    setupRTCHandlers(socket);
    // DnD campaign/map handlers removed - migrated to GameMaster (2026-01-08)
    setupSessionHandlers(socket, io);
    setupPlaybackHandlers(socket, io);
    setupStoryHandlers(socket, io);

    // =========================================================================
    // LAUNCH SEQUENCE HANDLERS
    // =========================================================================

    socket.on('cancel-launch-sequence', async (data) => {
      const { session_id } = data;
      logger.info(`[Socket:Recv] EVENT: cancel-launch-sequence | session_id: ${session_id}`);

      if (session_id) {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

        if (activeLaunchSequences.has(session_id)) {
          activeLaunchSequences.get(session_id).cancel();
          activeLaunchSequences.delete(session_id);
        }
        if (pendingAudio.has(session_id)) {
          pendingAudio.delete(session_id);
        }
        socket.emit('launch-sequence-cancelled', { session_id });
      }
    });

    socket.on('confirm-ready', async (data) => {
      const { session_id } = data;
      if (session_id && activeLaunchSequences.has(session_id)) {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

        const manager = activeLaunchSequences.get(session_id);
        if (manager.confirmReady) {
          manager.confirmReady();
        }
      }
    });

    socket.on('retry-stage', async (data) => {
      const { session_id, stage } = data;
      if (!session_id || !stage) {
        socket.emit('error', { message: 'session_id and stage required' });
        return;
      }

      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      if (!activeLaunchSequences.has(session_id)) {
        socket.emit('error', { message: 'No active launch sequence' });
        return;
      }

      try {
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
        logger.error(`[RetryStage] Error:`, error);
        socket.emit('retry-stage-complete', {
          session_id,
          stage,
          success: false,
          error: error.message
        });
      }
    });

    // =========================================================================
    // REGENERATION HANDLERS
    // =========================================================================

    socket.on('regenerate-cover', async (data) => {
      const { session_id } = data;
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

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
        broadcastToRoom(session_id, 'cover-regenerating', { session_id, title: session.title });

        const config = session.config_json || {};
        const outlineData = session.outline_json || {};
        const title = session.title || outlineData.title || 'Untitled Story';
        const synopsis = session.synopsis || outlineData.synopsis || '';
        const genre = config.genre || config.story_type || 'fantasy';
        const authorStyle = config.author_style || '';

        const coverPrompt = `A dramatic paperback book cover illustration for a ${genre} story titled "${title}".
${synopsis ? `Story synopsis: ${synopsis.substring(0, 200)}` : ''}
Style: Professional book cover art, cinematic lighting, rich colors, NO TEXT on the image.`;

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
        if (!dalleUrl) throw new Error('No image URL returned');

        const fs = await import('fs/promises');
        const path = await import('path');
        const https = await import('https');

        const coversDir = path.join(process.cwd(), 'public', 'covers');
        await fs.mkdir(coversDir, { recursive: true }).catch(() => {});

        const filename = `cover_${session_id}_${Date.now()}.png`;
        const localPath = path.join(coversDir, filename);

        await new Promise((resolve, reject) => {
          https.get(dalleUrl, (response) => {
            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }
            const fileStream = createWriteStream(localPath);
            response.pipe(fileStream);
            fileStream.on('close', resolve);
            fileStream.on('error', reject);
          }).on('error', reject);
        });

        const localUrl = `/storyteller/covers/${filename}`;
        await pool.query('UPDATE story_sessions SET cover_image_url = $1 WHERE id = $2', [localUrl, session_id]);

        broadcastToRoom(session_id, 'cover-regenerated', {
          session_id,
          success: true,
          cover_url: localUrl
        });

      } catch (error) {
        logger.error(`[RegenerateCover] Error:`, error);
        socket.emit('cover-regenerated', { session_id, success: false, error: error.message });
      }
    });

    socket.on('regenerate-synopsis', async (data) => {
      const { session_id } = data;
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

        const sessionResult = await pool.query(
          'SELECT title FROM story_sessions WHERE id = $1',
          [session_id]
        );

        if (sessionResult.rows.length === 0) {
          socket.emit('synopsis-regenerated', { session_id, success: false, error: 'Session not found' });
          return;
        }

        const orchestrator = new Orchestrator(session_id);
        const newSynopsis = await orchestrator.regenerateSynopsis();

        broadcastToRoom(session_id, 'synopsis-regenerated', {
          session_id,
          success: true,
          title: sessionResult.rows[0].title,
          synopsis: newSynopsis
        });

      } catch (error) {
        logger.error(`[RegenerateSynopsis] Error:`, error);
        socket.emit('synopsis-regenerated', { session_id, success: false, error: error.message });
      }
    });

    socket.on('regenerate-sfx', async (data) => {
      const { session_id } = data;
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

        const pending = pendingAudio.get(session_id);
        if (!pending?.scene) {
          socket.emit('sfx-regenerated', { session_id, success: false, error: 'No scene available' });
          return;
        }

        if (activeLaunchSequences.has(session_id)) {
          const manager = activeLaunchSequences.get(session_id);
          if (manager.runSFXGeneration) {
            await manager.runSFXGeneration();
          }
        } else {
          const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());
          launchManager.scene = pending.scene;
          await launchManager.runSFXGeneration();
        }

      } catch (error) {
        logger.error(`[RegenerateSfx] Error:`, error);
        socket.emit('sfx-regenerated', { session_id, success: false, error: error.message });
      }
    });

    socket.on('regenerate-voices', async (data) => {
      const { session_id } = data;
      if (!session_id) {
        socket.emit('error', { message: 'session_id required' });
        return;
      }

      try {
        const user = await requireSessionOwner(socket, session_id);
        if (!user) return;

        if (activeLaunchSequences.has(session_id)) {
          const manager = activeLaunchSequences.get(session_id);
          if (manager.runVoiceAssignment) {
            await manager.runVoiceAssignment();
          }
        } else {
          const pending = pendingAudio.get(session_id);
          if (!pending) {
            socket.emit('voices-regenerated', { session_id, success: false, error: 'No pending session' });
            return;
          }
          const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());
          launchManager.scene = pending.scene;
          await launchManager.runVoiceAssignment();
        }

      } catch (error) {
        logger.error(`[RegenerateVoices] Error:`, error);
        socket.emit('voices-regenerated', { session_id, success: false, error: error.message });
      }
    });
  });

  return io;
}
