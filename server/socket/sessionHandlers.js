/**
 * Session Socket Handlers
 * Handles session lifecycle: join, leave, disconnect, rooms
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import {
  activeSessions,
  generationProgress,
  activeLaunchSequences,
  pendingAudio,
  canAddToMap,
  getExpressApp
} from './state.js';
import { requireSocketAuth } from './socketAuth.js';

/**
 * Setup session-related socket handlers
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function setupSessionHandlers(socket, io) {

  // Join a story session room
  socket.on('join-session', async (data) => {
    const { session_id } = data;
    const user = requireSocketAuth(socket);
    if (!user) return;

    logger.info(`[Socket:Recv] EVENT: join-session | socketId: ${socket.id} | session_id: ${session_id} | user_id: ${user.id}`);

    if (!session_id) {
      logger.warn(`[Socket:Emit] EVENT: error | socketId: ${socket.id} | reason: missing_session_id`);
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    try {
      // Verify session exists and ownership
      const session = await pool.query(
        'SELECT * FROM story_sessions WHERE id = $1',
        [session_id]
      );

      if (session.rows.length === 0) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      const ownerId = session.rows[0].user_id;
      if (ownerId !== user.id && !user.is_admin) {
        socket.emit('error', { message: 'Not authorized for this session' });
        return;
      }

      socket.join(session_id);

      // Check capacity before adding
      canAddToMap('activeSessions');
      activeSessions.set(socket.id, { session_id, user_id: user.id, timestamp: Date.now() });

      logger.info(`[Socket:Emit] EVENT: session-joined | socketId: ${socket.id} | session_id: ${session_id} | status: ${session.rows[0].current_status}`);
      socket.emit('session-joined', {
        session_id,
        status: session.rows[0].current_status
      });
    } catch (error) {
      if (error.message?.includes('CAPACITY EXCEEDED')) {
        socket.emit('error', { message: 'Server at capacity. Please try again later.' });
      } else {
        logger.error(`[Socket] join-session error:`, error);
        socket.emit('error', { message: 'Failed to join session' });
      }
    }
  });

  // Rejoin session after reconnection - restores generation state
  // This allows clients to recover progress after a page refresh or network disconnect
  socket.on('rejoin-session', async (data) => {
    const { session_id } = data;
    const user = requireSocketAuth(socket);
    if (!user) return;

    logger.info(`[Socket:Recv] EVENT: rejoin-session | socketId: ${socket.id} | session_id: ${session_id} | user_id: ${user.id}`);

    if (!session_id) {
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    try {
      // Verify session ownership
      const session = await pool.query(
        'SELECT * FROM story_sessions WHERE id = $1',
        [session_id]
      );

      if (session.rows.length === 0) {
        socket.emit('session-state', { session_id, found: false, error: 'Session not found' });
        return;
      }

      const ownerId = session.rows[0].user_id;
      if (ownerId !== user.id && !user.is_admin) {
        socket.emit('session-state', { session_id, found: false, error: 'Not authorized' });
        return;
      }

      // Rejoin the room
      socket.join(session_id);
      canAddToMap('activeSessions');
      activeSessions.set(socket.id, { session_id, user_id: user.id, timestamp: Date.now() });

      // Check if there's active generation state to restore
      const progress = generationProgress.get(session_id);
      const isGenerating = activeLaunchSequences.has(session_id);
      const hasPendingAudio = pendingAudio.has(session_id);

      // Calculate elapsed time if generation is in progress
      let elapsedSeconds = 0;
      if (progress?.startTime) {
        elapsedSeconds = Math.floor((Date.now() - progress.startTime) / 1000);
      }

      const stateResponse = {
        session_id,
        found: true,
        status: session.rows[0].current_status,
        isGenerating: isGenerating || (progress?.isGenerating ?? false),
        hasPendingAudio,
        progress: progress ? {
          step: progress.step || 0,
          percent: progress.percent || 0,
          message: progress.message || '',
          elapsedSeconds,
          startTime: progress.startTime
        } : null
      };

      logger.info(`[Socket:Emit] EVENT: session-state | socketId: ${socket.id} | isGenerating: ${stateResponse.isGenerating} | elapsed: ${elapsedSeconds}s`);
      socket.emit('session-state', stateResponse);

    } catch (error) {
      logger.error(`[Socket] rejoin-session error:`, error);
      socket.emit('session-state', { session_id, found: false, error: 'Failed to rejoin session' });
    }
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
  // SECURITY FIX: Requires authentication and room ownership validation
  socket.on('join-room', (roomId) => {
    const user = requireSocketAuth(socket);
    if (!user) return;

    logger.info(`[Socket:Recv] EVENT: join-room | socketId: ${socket.id} | roomId: ${roomId} | user_id: ${user.id}`);

    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error', { message: 'Valid roomId is required' });
      return;
    }

    // SECURITY: Validate room ownership via extractions Map
    const expressApp = getExpressApp();
    const extractions = expressApp?.locals?.extractions;

    if (extractions && extractions.has(roomId)) {
      const extraction = extractions.get(roomId);
      // Verify the extraction belongs to this user
      if (extraction.userId && extraction.userId !== user.id && !user.is_admin) {
        logger.warn(`[Socket] JOIN_ROOM_DENIED | roomId: ${roomId} | user_id: ${user.id} | owner: ${extraction.userId}`);
        socket.emit('error', { message: 'Not authorized for this room' });
        return;
      }
    } else {
      // SECURITY: Do not allow arbitrary UUID room joins.
      // Allow only the user's currently joined session room (set by join-session/rejoin-session).
      const sessionData = activeSessions.get(socket.id);
      const activeSessionId = sessionData?.session_id;
      if (!activeSessionId || roomId !== activeSessionId) {
        logger.warn(`[Socket] JOIN_ROOM_DENIED | roomId: ${roomId} | reason: arbitrary room join blocked | user_id: ${user.id}`);
        socket.emit('error', { message: 'Join session room via join-session first' });
        return;
      }
    }

    socket.join(roomId);
    logger.info(`[Socket] JOINED_ROOM | socketId: ${socket.id} | roomId: ${roomId}`);
  });

  // Leave a generic room
  // SECURITY FIX: Requires authentication
  socket.on('leave-room', (roomId) => {
    const user = requireSocketAuth(socket);
    if (!user) return;

    logger.info(`[Socket:Recv] EVENT: leave-room | socketId: ${socket.id} | roomId: ${roomId}`);
    if (roomId) {
      socket.leave(roomId);
      logger.info(`[Socket] LEFT_ROOM | socketId: ${socket.id} | roomId: ${roomId}`);
    }
  });

  // Start extraction - triggered after client joins room
  socket.on('start-extraction', async (roomId) => {
    const user = requireSocketAuth(socket);
    if (!user) return;

    logger.info(`[Socket:Recv] EVENT: start-extraction | socketId: ${socket.id} | roomId: ${roomId}`);

    const expressApp = getExpressApp();
    const extractions = expressApp?.locals?.extractions;

    if (!extractions || !extractions.has(roomId)) {
      logger.warn(`[Socket] START_EXTRACTION_FAILED | roomId: ${roomId} | reason: extraction not found`);
      socket.emit('extraction:error', { error: 'Extraction not found or expired' });
      return;
    }

    const extraction = extractions.get(roomId);

    // SECURITY FIX: Verify extraction ownership
    if (extraction.userId && extraction.userId !== user.id && !user.is_admin) {
      logger.warn(`[Socket] START_EXTRACTION_DENIED | roomId: ${roomId} | user_id: ${user.id} | owner: ${extraction.userId}`);
      socket.emit('extraction:error', { error: 'Not authorized for this extraction' });
      return;
    }

    if (extraction.status !== 'pending') {
      logger.info(`[Socket] START_EXTRACTION_SKIPPED | roomId: ${roomId} | status: ${extraction.status}`);
      return;
    }

    // Mark as running
    extraction.status = 'running';
    extraction.startedAt = new Date();

    logger.info(`[Socket] START_EXTRACTION | roomId: ${roomId} | textLength: ${extraction.text?.length}`);

    try {
      const { extractFromDocument } = await import('../services/storyBibleExtractor.js');

      const onProgress = (event, data) => {
        io.to(roomId).emit(event, data);
        logger.debug(`[StoryBible:Advanced] ${event}:`, JSON.stringify(data).substring(0, 200));
      };

      const extractionPromise = extractFromDocument(extraction.text, { libraryId: extraction.libraryId }, onProgress);
      extraction.promise = extractionPromise;

      // RACE CONDITION FIX: Flag to prevent updates after socket disconnect
      // Without this, Promise callbacks can update extraction state after cleanup
      let isActive = true;
      const cleanupOnDisconnect = () => {
        isActive = false;
        logger.debug(`[Socket] Extraction socket disconnected | roomId: ${roomId}`);
      };
      socket.once('disconnect', cleanupOnDisconnect);

      extractionPromise.then(result => {
        socket.off('disconnect', cleanupOnDisconnect);
        if (!isActive) {
          logger.debug(`[Socket] Skipping extraction update - socket disconnected | roomId: ${roomId}`);
          return;
        }
        extraction.status = 'complete';
        extraction.result = result;
        logger.info(`[Socket] EXTRACTION_COMPLETE | roomId: ${roomId}`);
      }).catch(error => {
        socket.off('disconnect', cleanupOnDisconnect);
        if (!isActive) {
          logger.debug(`[Socket] Skipping extraction error update - socket disconnected | roomId: ${roomId}`);
          return;
        }
        extraction.status = 'error';
        extraction.error = error.message;
        logger.error(`[Socket] EXTRACTION_ERROR | roomId: ${roomId} | error: ${error.message}`);
        io.to(roomId).emit('extraction:error', { error: error.message });
      });
    } catch (error) {
      logger.error(`[Socket] start-extraction error:`, error);
      socket.emit('extraction:error', { error: error.message });
    }
  });

  // Client-side log bridge
  socket.on('client-log', (data) => {
    const { level, prefix, message, data: logData } = data;
    const sessionData = activeSessions.get(socket.id);
    const sessionId = sessionData?.session_id || 'no-session';

    const fullPrefix = `[Client${prefix || ''}]`;
    const dataStr = logData ? ` | data: ${JSON.stringify(logData)}` : '';
    const logMessage = `${fullPrefix} ${message} | session: ${sessionId}${dataStr}`;

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

  // Disconnect cleanup
  socket.on('disconnect', () => {
    logger.info(`[Socket:Recv] EVENT: disconnect | socketId: ${socket.id}`);
    const sessionData = activeSessions.get(socket.id);
    if (sessionData) {
      activeSessions.delete(socket.id);
      logger.info(`[Socket] DISCONNECTED | socketId: ${socket.id} | was in session: ${sessionData.session_id}`);
    }
  });
}
