/**
 * Socket State Management
 * Centralized state for socket connections, sessions, and cleanup
 */

import { logger } from '../utils/logger.js';

// =============================================================================
// SHARED STATE
// =============================================================================

// Track active sessions with timestamps for TTL cleanup
export const activeSessions = new Map();

// Track pending audio for sessions waiting for play signal
export const pendingAudio = new Map();

// Track active launch sequences for cancellation
export const activeLaunchSequences = new Map();

// Track generation progress for state persistence across reconnections
// Key: session_id, Value: { startTime, progress, step, message, isGenerating }
export const generationProgress = new Map();

// Track all io instances for unified broadcasting
export const ioInstances = [];

// Store app reference for accessing app.locals in socket handlers
let expressApp = null;

export function setExpressApp(app) {
  expressApp = app;
}

export function getExpressApp() {
  return expressApp;
}

// =============================================================================
// TTL CONFIGURATION
// =============================================================================

export const TTL_CONFIG = {
  SESSION_TTL_MS: 30 * 60 * 1000,         // 30 minutes
  PENDING_AUDIO_TTL_MS: 10 * 60 * 1000,   // 10 minutes
  LAUNCH_SEQUENCE_TTL_MS: 15 * 60 * 1000, // 15 minutes
  GENERATION_PROGRESS_TTL_MS: 20 * 60 * 1000 // 20 minutes (keep longer for reconnection)
};

// =============================================================================
// MAP SIZE LIMITS (Fail Loud)
// =============================================================================

const MAP_SIZE_LIMITS = {
  activeSessions: { max: 1000, warn: 800, name: 'activeSessions' },
  pendingAudio: { max: 500, warn: 400, name: 'pendingAudio' },
  activeLaunchSequences: { max: 200, warn: 160, name: 'activeLaunchSequences' },
  generationProgress: { max: 500, warn: 400, name: 'generationProgress' }
};

/**
 * Check Map sizes and log loud warnings/errors when approaching limits
 */
export function checkMapSizeLimits() {
  const checks = [
    { map: activeSessions, limits: MAP_SIZE_LIMITS.activeSessions },
    { map: pendingAudio, limits: MAP_SIZE_LIMITS.pendingAudio },
    { map: activeLaunchSequences, limits: MAP_SIZE_LIMITS.activeLaunchSequences },
    { map: generationProgress, limits: MAP_SIZE_LIMITS.generationProgress }
  ];

  for (const { map, limits } of checks) {
    const size = map.size;

    if (size >= limits.max) {
      logger.error('='.repeat(80));
      logger.error(`CRITICAL: ${limits.name} Map at capacity! Size: ${size}/${limits.max}`);
      logger.error('This indicates a memory leak or abnormal load. Investigate immediately!');
      logger.error('='.repeat(80));
    } else if (size >= limits.warn) {
      logger.warn(`WARNING: ${limits.name} Map approaching capacity: ${size}/${limits.max} (${Math.round(size/limits.max*100)}%)`);
    }
  }

  const totalEntries = activeSessions.size + pendingAudio.size + activeLaunchSequences.size + generationProgress.size;
  if (totalEntries > 0) {
    logger.info(`[MapStats] activeSessions: ${activeSessions.size}, pendingAudio: ${pendingAudio.size}, launchSequences: ${activeLaunchSequences.size}, genProgress: ${generationProgress.size}`);
  }
}

/**
 * Check if a Map can accept new entries (Fail Loud)
 * @param {string} mapName - 'activeSessions' | 'pendingAudio' | 'activeLaunchSequences' | 'generationProgress'
 * @returns {boolean} true if space available
 * @throws {Error} if at capacity
 */
export function canAddToMap(mapName) {
  const maps = {
    activeSessions,
    pendingAudio,
    activeLaunchSequences,
    generationProgress
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
 * RACE CONDITION FIX: Uses two-pass approach to avoid modifying Maps during iteration
 * This prevents issues when socket handlers concurrently add/delete entries
 */
export function cleanupStaleSessions() {
  const now = Date.now();

  // PASS 1: Identify stale entries (no modifications during iteration)
  const staleSessions = [];
  const staleAudio = [];
  const staleLaunch = [];
  const staleProgress = [];

  for (const [socketId, data] of activeSessions) {
    if (data.timestamp && now - data.timestamp > TTL_CONFIG.SESSION_TTL_MS) {
      staleSessions.push(socketId);
    }
  }

  for (const [sessionId, data] of pendingAudio) {
    if (data.timestamp && now - data.timestamp > TTL_CONFIG.PENDING_AUDIO_TTL_MS) {
      staleAudio.push(sessionId);
    }
  }

  for (const [sessionId, manager] of activeLaunchSequences) {
    if (manager.startTime && now - manager.startTime > TTL_CONFIG.LAUNCH_SEQUENCE_TTL_MS) {
      staleLaunch.push({ sessionId, manager });
    }
  }

  for (const [sessionId, data] of generationProgress) {
    // Clean up completed generations after TTL, or stale generating entries
    const isStale = data.startTime && now - data.startTime > TTL_CONFIG.GENERATION_PROGRESS_TTL_MS;
    const isCompletedOld = !data.isGenerating && data.lastUpdate && now - data.lastUpdate > 5 * 60 * 1000; // 5 min for completed
    if (isStale || isCompletedOld) {
      staleProgress.push(sessionId);
    }
  }

  // PASS 2: Delete identified stale entries (safe - not during iteration)
  for (const socketId of staleSessions) {
    activeSessions.delete(socketId);
  }

  for (const sessionId of staleAudio) {
    pendingAudio.delete(sessionId);
  }

  for (const { sessionId, manager } of staleLaunch) {
    try {
      manager.cancel();
    } catch (e) {
      // Ignore cancel errors
    }
    activeLaunchSequences.delete(sessionId);
  }

  for (const sessionId of staleProgress) {
    generationProgress.delete(sessionId);
  }

  const total = staleSessions.length + staleAudio.length + staleLaunch.length + staleProgress.length;
  if (total > 0) {
    logger.info(`[SocketCleanup] Cleaned: ${staleSessions.length} sessions, ${staleAudio.length} pending audio, ${staleLaunch.length} launch sequences, ${staleProgress.length} gen progress`);
  }

  checkMapSizeLimits();
}

// Start cleanup interval
setInterval(cleanupStaleSessions, 1 * 60 * 1000);

// =============================================================================
// BROADCASTING UTILITIES
// =============================================================================

/**
 * Broadcast to all io instances (for multi-path socket support)
 */
export function broadcastToRoom(room, event, data) {
  for (const io of ioInstances) {
    io.to(room).emit(event, data);
  }
}

/**
 * Get the number of sockets in a room
 */
export function getRoomSocketCount(room) {
  if (ioInstances.length === 0) return 0;
  const roomSet = ioInstances[0].sockets.adapter.rooms.get(room);
  return roomSet ? roomSet.size : 0;
}

/**
 * Get a broadcast-capable io wrapper for use in other modules
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
 * Register an io instance for broadcasting
 */
export function registerIOInstance(io) {
  if (!ioInstances.includes(io)) {
    ioInstances.push(io);
    logger.info(`[Socket] Registered io instance (total: ${ioInstances.length})`);
  }
}
