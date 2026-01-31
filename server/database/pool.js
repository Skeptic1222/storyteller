/**
 * PostgreSQL Connection Pool
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const { Pool } = pg;

// Create connection pool with optimized settings
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                        // Maximum connections in pool
  min: 2,                         // Keep 2 connections warm
  idleTimeoutMillis: 30000,       // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Increased from 2s - prevents timeout under load
  allowExitOnIdle: false          // Keep pool alive for server lifetime
});

// =============================================================================
// CONNECTION POOL MONITORING
// =============================================================================
// Track pool health for diagnostics and alerting

let poolStats = {
  acquireCount: 0,
  releaseCount: 0,
  errorCount: 0,
  lastError: null,
  lastErrorTime: null
};

// Log when connection is acquired
pool.on('connect', (client) => {
  poolStats.acquireCount++;
  if (process.env.LOG_POOL === 'true') {
    logger.debug(`[DB Pool] Connection acquired | total: ${pool.totalCount} | idle: ${pool.idleCount} | waiting: ${pool.waitingCount}`);
  }
});

// Log when connection is released
pool.on('remove', (client) => {
  poolStats.releaseCount++;
  if (process.env.LOG_POOL === 'true') {
    logger.debug(`[DB Pool] Connection removed | total: ${pool.totalCount} | idle: ${pool.idleCount}`);
  }
});

// FAIL LOUDLY: Log pool errors prominently
pool.on('error', (err, client) => {
  poolStats.errorCount++;
  poolStats.lastError = err.message;
  poolStats.lastErrorTime = new Date().toISOString();
  logger.error('[DB Pool] ERROR - Idle client error:', err.message);
});

// Periodic pool stats logging (every 5 minutes in production)
const STATS_INTERVAL = process.env.NODE_ENV === 'production' ? 300000 : 60000;
setInterval(() => {
  const stats = getPoolStats();
  if (stats.waiting > 0 || stats.utilization > 80) {
    // FAIL LOUDLY: Warn if pool is under pressure
    logger.warn('[DB Pool] WARNING - High utilization:', stats);
  } else if (process.env.LOG_POOL === 'true') {
    logger.debug('[DB Pool] Stats:', stats);
  }
}, STATS_INTERVAL);

/**
 * Get current pool statistics
 * @returns {object} Pool stats for monitoring/health checks
 */
export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    utilization: pool.totalCount > 0
      ? Math.round(((pool.totalCount - pool.idleCount) / pool.totalCount) * 100)
      : 0,
    acquireCount: poolStats.acquireCount,
    errorCount: poolStats.errorCount,
    lastError: poolStats.lastError,
    lastErrorTime: poolStats.lastErrorTime
  };
}

// Test connection
export async function testConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW()');
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Query helper with error logging
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (process.env.LOG_QUERIES === 'true') {
      logger.debug('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    logger.error('Query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
}

// Transaction helper with proper error handling
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // FAIL LOUD: Preserve original error even if rollback fails
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('CRITICAL: Rollback failed after transaction error:', {
        originalError: error.message,
        rollbackError: rollbackError.message
      });
      // Throw the original error with rollback info appended
      error.message = `${error.message} (ROLLBACK also failed: ${rollbackError.message})`;
    }
    throw error;
  } finally {
    client.release();
  }
}

export default { pool, query, testConnection, withTransaction, getPoolStats };
