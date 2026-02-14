/**
 * Winston Logger Configuration
 *
 * ASYNC I/O: Log rotation uses non-blocking async operations to prevent server freezes.
 */

import winston from 'winston';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, stat, rename, readFile, writeFile, readdir, unlink, access } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { gzip } from 'zlib';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Promisify gzip for async operation
const gzipAsync = promisify(gzip);

// Ensure logs directory exists (sync at startup only - acceptable)
const logsDir = join(__dirname, '..', '..', 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// -----------------------------------------------------------------------------
// Lightweight daily rotation + gzip compression (ASYNC - non-blocking)
// -----------------------------------------------------------------------------
function formatDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Check if file exists (async)
 */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rotate and compress log file asynchronously
 * Non-blocking to prevent server freezes during log maintenance
 */
async function rotateAndCompressAsync(baseName, retainDays = 14) {
  const fullPath = join(logsDir, baseName);

  if (!(await fileExists(fullPath))) return;

  try {
    const stats = await stat(fullPath);
    const fileDay = formatDate(stats.mtime);
    const today = formatDate(new Date());

    // Rotate once per day; skip if file already today's log
    if (fileDay === today) return;

    const archivePath = join(logsDir, `${baseName.replace('.log', '')}-${fileDay}.log`);

    try {
      await rename(fullPath, archivePath);

      // Gzip the archived log to save space (async)
      const gzPath = `${archivePath}.gz`;
      const logContent = await readFile(archivePath);
      const gzData = await gzipAsync(logContent);
      await writeFile(gzPath, gzData);
      await unlink(archivePath);
    } catch (err) {
      // Fall back to leaving the file in place; logging still works
      console.warn(`[Logger] Failed to rotate/compress ${baseName}: ${err.message}`);
    }

    // Trim old archives beyond retention (async)
    try {
      const prefix = `${baseName.replace('.log', '')}-`;
      const files = await readdir(logsDir);

      const archivePromises = files
        .filter(f => f.startsWith(prefix) && f.endsWith('.gz'))
        .map(async f => {
          const fileStat = await stat(join(logsDir, f));
          return { name: f, time: fileStat.mtime.getTime() };
        });

      const archives = (await Promise.all(archivePromises))
        .sort((a, b) => b.time - a.time);

      const surplus = archives.slice(retainDays);
      await Promise.all(surplus.map(file => unlink(join(logsDir, file.name))));
    } catch (err) {
      console.warn(`[Logger] Failed to purge old archives for ${baseName}: ${err.message}`);
    }
  } catch (err) {
    console.warn(`[Logger] Failed to rotate ${baseName}: ${err.message}`);
  }
}

// Perform maintenance asynchronously after transports open
// This runs in the background without blocking server startup
const logFiles = ['combined.log', 'error.log', 'ai-calls.log', 'alerts.log'];
Promise.all(logFiles.map(name => rotateAndCompressAsync(name)))
  .then(() => {
    // Optional: log completion if needed
  })
  .catch(err => {
    console.warn(`[Logger] Background log rotation failed: ${err.message}`);
  });

// Custom format for console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message} ${metaStr}`;
  })
);

// Custom format for files
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat
    }),

    // Combined log file
    new winston.transports.File({
      filename: join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),

    // Error log file
    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// Alerts logger (critical events, no fallbacks)
export const alertLogger = winston.createLogger({
  level: 'warn',
  transports: [
    new winston.transports.File({
      filename: join(logsDir, 'alerts.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// Add AI-specific logger
export const aiLogger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.File({
      filename: join(logsDir, 'ai-calls.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10
    })
  ]
});

export function logAlert(level = 'warn', message = '', meta = {}) {
  alertLogger.log(level, message, meta);
  // Mirror into primary logger for correlation
  logger.log(level, `[ALERT] ${message}`, meta);
}

export default logger;
