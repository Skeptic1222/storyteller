/**
 * Caching Service
 * Redis-backed cache with in-memory fallback for high-frequency data access.
 *
 * Caches:
 * - Voice assignments (per session)
 * - Session config/metadata
 * - Character data
 * - Outline data
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

// Cache TTLs in seconds
const TTL = {
  SESSION: 30 * 60,           // 30 minutes
  VOICE_ASSIGNMENTS: 60 * 60, // 1 hour
  CHARACTERS: 30 * 60,        // 30 minutes
  OUTLINE: 60 * 60,           // 1 hour
  CONFIG: 15 * 60,            // 15 minutes
  VOICES_LIST: 24 * 60 * 60   // 24 hours (ElevenLabs voice list)
};

// Cache key prefixes
const PREFIX = {
  SESSION: 'session:',
  VOICE_ASSIGN: 'voices:',
  CHARACTERS: 'chars:',
  OUTLINE: 'outline:',
  CONFIG: 'config:',
  VOICES_LIST: 'voicelist'
};

class CacheService {
  constructor() {
    this.redis = null;
    this.memoryCache = new Map();
    this.memoryTTLs = new Map();
    this.isRedisConnected = false;
    this.connectionAttempted = false;
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    if (this.connectionAttempted) return this.isRedisConnected;
    this.connectionAttempted = true;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('[Cache] Redis connection failed, using memory fallback');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true
      });

      this.redis.on('connect', () => {
        this.isRedisConnected = true;
        logger.info('[Cache] Redis connected');
      });

      this.redis.on('error', (err) => {
        if (this.isRedisConnected) {
          logger.warn('[Cache] Redis error:', err.message);
        }
        this.isRedisConnected = false;
      });

      this.redis.on('close', () => {
        this.isRedisConnected = false;
        logger.info('[Cache] Redis disconnected');
      });

      await this.redis.connect();
      return true;
    } catch (err) {
      logger.warn('[Cache] Redis unavailable, using memory cache:', err.message);
      this.isRedisConnected = false;
      return false;
    }
  }

  /**
   * Get value from cache
   */
  async get(key) {
    try {
      if (this.isRedisConnected && this.redis) {
        const value = await this.redis.get(key);
        if (value) {
          return JSON.parse(value);
        }
        return null;
      }

      // Memory fallback
      const cached = this.memoryCache.get(key);
      if (cached) {
        const ttl = this.memoryTTLs.get(key);
        if (ttl && Date.now() > ttl) {
          this.memoryCache.delete(key);
          this.memoryTTLs.delete(key);
          return null;
        }
        return cached;
      }
      return null;
    } catch (err) {
      logger.error('[Cache] Get error:', err.message);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      const serialized = JSON.stringify(value);

      if (this.isRedisConnected && this.redis) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        // Memory fallback
        this.memoryCache.set(key, value);
        this.memoryTTLs.set(key, Date.now() + (ttlSeconds * 1000));

        // Limit memory cache size
        if (this.memoryCache.size > 1000) {
          const firstKey = this.memoryCache.keys().next().value;
          this.memoryCache.delete(firstKey);
          this.memoryTTLs.delete(firstKey);
        }
      }
      return true;
    } catch (err) {
      logger.error('[Cache] Set error:', err.message);
      return false;
    }
  }

  /**
   * Delete from cache
   */
  async del(key) {
    try {
      if (this.isRedisConnected && this.redis) {
        await this.redis.del(key);
      }
      this.memoryCache.delete(key);
      this.memoryTTLs.delete(key);
      return true;
    } catch (err) {
      logger.error('[Cache] Delete error:', err.message);
      return false;
    }
  }

  /**
   * Delete all keys matching pattern
   */
  async delPattern(pattern) {
    try {
      if (this.isRedisConnected && this.redis) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      // Memory fallback - delete matching keys
      for (const key of this.memoryCache.keys()) {
        if (key.includes(pattern.replace('*', ''))) {
          this.memoryCache.delete(key);
          this.memoryTTLs.delete(key);
        }
      }
      return true;
    } catch (err) {
      logger.error('[Cache] DelPattern error:', err.message);
      return false;
    }
  }

  // ==========================================================================
  // HIGH-LEVEL CACHE METHODS
  // ==========================================================================

  /**
   * Get/set session data
   */
  async getSession(sessionId) {
    return this.get(`${PREFIX.SESSION}${sessionId}`);
  }

  async setSession(sessionId, data) {
    return this.set(`${PREFIX.SESSION}${sessionId}`, data, TTL.SESSION);
  }

  async invalidateSession(sessionId) {
    return this.del(`${PREFIX.SESSION}${sessionId}`);
  }

  /**
   * Get/set voice assignments for a session
   */
  async getVoiceAssignments(sessionId) {
    return this.get(`${PREFIX.VOICE_ASSIGN}${sessionId}`);
  }

  async setVoiceAssignments(sessionId, assignments) {
    return this.set(`${PREFIX.VOICE_ASSIGN}${sessionId}`, assignments, TTL.VOICE_ASSIGNMENTS);
  }

  async invalidateVoiceAssignments(sessionId) {
    return this.del(`${PREFIX.VOICE_ASSIGN}${sessionId}`);
  }

  /**
   * Get/set characters for a session
   */
  async getCharacters(sessionId) {
    return this.get(`${PREFIX.CHARACTERS}${sessionId}`);
  }

  async setCharacters(sessionId, characters) {
    return this.set(`${PREFIX.CHARACTERS}${sessionId}`, characters, TTL.CHARACTERS);
  }

  async invalidateCharacters(sessionId) {
    return this.del(`${PREFIX.CHARACTERS}${sessionId}`);
  }

  /**
   * Get/set outline for a session
   */
  async getOutline(sessionId) {
    return this.get(`${PREFIX.OUTLINE}${sessionId}`);
  }

  async setOutline(sessionId, outline) {
    return this.set(`${PREFIX.OUTLINE}${sessionId}`, outline, TTL.OUTLINE);
  }

  /**
   * Get/set ElevenLabs voice list (global)
   */
  async getVoicesList() {
    return this.get(PREFIX.VOICES_LIST);
  }

  async setVoicesList(voices) {
    return this.set(PREFIX.VOICES_LIST, voices, TTL.VOICES_LIST);
  }

  /**
   * Invalidate all cache for a session
   */
  async invalidateSessionAll(sessionId) {
    // ERROR HANDLING FIX: Use Promise.allSettled so one failing invalidation doesn't stop others
    const results = await Promise.allSettled([
      this.invalidateSession(sessionId),
      this.invalidateVoiceAssignments(sessionId),
      this.invalidateCharacters(sessionId),
      this.del(`${PREFIX.OUTLINE}${sessionId}`),
      this.del(`${PREFIX.CONFIG}${sessionId}`)
    ]);
    // Log any failures but don't throw
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn(`[Cache] ${failures.length}/${results.length} invalidations failed for session ${sessionId}`);
    }
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      isRedisConnected: this.isRedisConnected,
      memoryCacheSize: this.memoryCache.size,
      backend: this.isRedisConnected ? 'redis' : 'memory'
    };
  }

  /**
   * Close connection
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
export const cache = new CacheService();

// Auto-connect on import (non-blocking)
// Note: connect() already logs detailed errors internally
cache.connect().catch(err => {
  // This catch is a safety net - connect() handles its own errors
  logger.info(`[Cache] Running with memory cache only${err?.message ? ` (${err.message})` : ''}`);
});

export default cache;
