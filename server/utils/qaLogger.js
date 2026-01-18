/**
 * QA Logger Utility
 * Appends QA validation errors to a JSONL log file for debugging and analysis.
 *
 * Log file: server/logs/qa-errors.jsonl
 * Format: One JSON object per line, timestamped
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure logs directory exists
const logsDir = join(__dirname, '..', '..', 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

const QA_LOG_FILE = join(logsDir, 'qa-errors.jsonl');

/**
 * Log a QA error to the JSONL file
 *
 * @param {object} entry - The QA error entry
 * @param {string} entry.type - Error type (e.g., 'intensity_mismatch', 'content_violation')
 * @param {string} entry.sessionId - Story session ID
 * @param {object} entry.expected - Expected values (slider settings)
 * @param {object} entry.actual - Actual analyzed values
 * @param {Array} entry.mismatches - Array of mismatch details
 * @param {string} [entry.context] - Additional context
 * @param {string} [entry.excerpt] - Content excerpt for debugging
 */
export async function logQAError(entry) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...entry
    };

    // Append to JSONL file (one JSON per line)
    await fs.appendFile(QA_LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf8');

    logger.warn('[QALogger] Logged QA error:', {
      type: entry.type,
      sessionId: entry.sessionId,
      mismatchCount: entry.mismatches?.length || 0
    });
  } catch (error) {
    // Don't throw - QA logging should never break the main flow
    logger.error('[QALogger] Failed to write QA log:', error.message);
  }
}

/**
 * Log a content intensity mismatch
 *
 * @param {string} sessionId - Story session ID
 * @param {object} sliderSettings - User's slider settings
 * @param {object} analyzedIntensity - LLM-analyzed intensity scores
 * @param {Array} mismatches - Array of { dimension, expected, actual, delta, severity }
 * @param {string} contentExcerpt - First 500 chars of content for debugging
 */
export async function logIntensityMismatch(sessionId, sliderSettings, analyzedIntensity, mismatches, contentExcerpt) {
  await logQAError({
    type: 'intensity_mismatch',
    sessionId,
    expected: sliderSettings,
    actual: analyzedIntensity,
    mismatches,
    context: getMismatchContext(mismatches),
    excerpt: contentExcerpt?.substring(0, 500) + (contentExcerpt?.length > 500 ? '...' : '')
  });
}

/**
 * Generate human-readable context for mismatches
 */
function getMismatchContext(mismatches) {
  if (!mismatches || mismatches.length === 0) {
    return 'No mismatches';
  }

  const descriptions = mismatches.map(m => {
    const direction = m.delta > 0 ? 'exceeded' : 'under-delivered';
    return `${m.dimension}: expected ${m.expected}%, got ${m.actual}% (${direction} by ${Math.abs(m.delta)}%)`;
  });

  return descriptions.join('; ');
}

/**
 * Read recent QA errors for debugging
 *
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} Recent QA error entries
 */
export async function getRecentQAErrors(limit = 50) {
  try {
    const content = await fs.readFile(QA_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);

    // Parse last N lines
    const entries = lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist yet
    }
    logger.error('[QALogger] Failed to read QA log:', error.message);
    return [];
  }
}

/**
 * Get QA error statistics
 *
 * @param {number} hours - Time window in hours (default: 24)
 * @returns {object} Statistics summary
 */
export async function getQAStats(hours = 24) {
  try {
    const errors = await getRecentQAErrors(1000);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const recentErrors = errors.filter(e => new Date(e.timestamp) >= cutoff);

    // Count by type
    const byType = {};
    const byDimension = {};

    for (const error of recentErrors) {
      byType[error.type] = (byType[error.type] || 0) + 1;

      if (error.mismatches) {
        for (const m of error.mismatches) {
          byDimension[m.dimension] = (byDimension[m.dimension] || 0) + 1;
        }
      }
    }

    return {
      totalErrors: recentErrors.length,
      timeWindowHours: hours,
      byType,
      byDimension,
      oldestError: recentErrors[0]?.timestamp,
      newestError: recentErrors[recentErrors.length - 1]?.timestamp
    };
  } catch (error) {
    logger.error('[QALogger] Failed to compute stats:', error.message);
    return { totalErrors: 0, byType: {}, byDimension: {} };
  }
}

export default {
  logQAError,
  logIntensityMismatch,
  getRecentQAErrors,
  getQAStats
};
