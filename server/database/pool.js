/**
 * PostgreSQL Connection Pool
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const { Pool } = pg;

// Create connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

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
      console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    console.error('Query error:', { text: text.substring(0, 100), error: error.message });
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
      console.error('CRITICAL: Rollback failed after transaction error:', {
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

export default { pool, query, testConnection, withTransaction };
