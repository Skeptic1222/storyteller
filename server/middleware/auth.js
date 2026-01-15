/**
 * Authentication Middleware
 * JWT validation and user context injection
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

// FAIL LOUD: JWT_SECRET must be configured
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;

// Generate a random fallback for development ONLY - changes on every restart
// This prevents tokens from being reused across restarts in dev
const DEV_RANDOM_SECRET = crypto.randomBytes(32).toString('hex');

if (!JWT_SECRET) {
  if (NODE_ENV === 'production') {
    const error = new Error(
      'FATAL: JWT_SECRET environment variable is not set. ' +
      'This is required in production to prevent token forgery attacks. ' +
      'Set JWT_SECRET to a secure random string (minimum 32 characters).'
    );
    logger.error(error.message);
    throw error;
  } else {
    // Development only - use random secret that changes on restart
    // This is secure but means tokens don't persist across server restarts
    logger.warn('='.repeat(80));
    logger.warn('WARNING: JWT_SECRET not set - using random per-instance secret');
    logger.warn('Tokens will be invalidated on server restart (dev only)');
    logger.warn('Set JWT_SECRET in .env for persistent sessions');
    logger.warn('='.repeat(80));
  }
}

// Use configured secret, or random secret in development
const EFFECTIVE_JWT_SECRET = JWT_SECRET || DEV_RANDOM_SECRET;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

async function loadUserById(userId) {
  const result = await pool.query(
    `SELECT u.*, s.tier, s.status as subscription_status, s.stories_limit, s.minutes_limit
     FROM users u
     LEFT JOIN user_subscriptions s ON u.id = s.user_id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  user.is_admin = user.is_admin || ADMIN_EMAILS.includes(user.email?.toLowerCase());
  return user;
}

export async function authenticateSocketToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    return await loadUserById(decoded.userId);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Socket token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.debug('Invalid socket token');
    } else {
      logger.error('Socket auth error:', error);
    }
    return null;
  }
}

/**
 * Verify JWT token and attach user to request
 * Does NOT block unauthenticated requests - use requireAuth for that
 */
export async function authenticateToken(req, res, next) {
  try {
    const authHeader =
      req.headers.authorization ||
      req.headers['x-authorization'] ||
      req.headers['x-auth-token'] ||
      req.headers['x-access-token'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (!token || token === 'null' || token === 'undefined') {
      req.user = null;
      return next();
    }

    const user = await authenticateSocketToken(token);
    req.user = user;
    return next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    req.user = null;
    return next();
  }
}

/**
 * Require authentication - returns 401 if not authenticated
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Require admin role
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Optional auth - attaches user if token present but doesn't require it
 */
export const optionalAuth = authenticateToken;

/**
 * Generate JWT token for user
 */
export function generateToken(userId, expiresIn = process.env.JWT_EXPIRES_IN || '7d') {
  return jwt.sign({ userId }, EFFECTIVE_JWT_SECRET, { expiresIn });
}

/**
 * Get current usage for user
 */
export async function getUserUsage(userId) {
  try {
    // Get or create usage record for current period
    const result = await pool.query(
      `SELECT * FROM get_or_create_usage($1)`,
      [userId]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting user usage:', error);
    return null;
  }
}

/**
 * Check if user can generate a story
 */
export async function canGenerateStory(userId) {
  const usage = await getUserUsage(userId);
  if (!usage) return { allowed: false, reason: 'Usage tracking error' };

  if (usage.stories_generated >= usage.stories_limit) {
    return {
      allowed: false,
      reason: 'Story limit reached for this period',
      usage
    };
  }

  return { allowed: true, usage };
}

/**
 * Check if user can generate narration
 */
export async function canGenerateNarration(userId, estimatedMinutes = 0) {
  const usage = await getUserUsage(userId);
  if (!usage) return { allowed: false, reason: 'Usage tracking error' };

  const remainingMinutes = usage.minutes_limit - usage.minutes_used;

  if (remainingMinutes <= 0) {
    return {
      allowed: false,
      reason: 'Narration minutes exhausted for this period',
      usage,
      remainingMinutes: 0
    };
  }

  if (estimatedMinutes > remainingMinutes) {
    return {
      allowed: true,
      partial: true,
      reason: `Only ${remainingMinutes.toFixed(1)} minutes remaining`,
      usage,
      remainingMinutes
    };
  }

  return { allowed: true, usage, remainingMinutes };
}

/**
 * Record story generation usage
 * @param {string} userId - User ID
 * @param {object} client - Optional database client for transaction support
 */
export async function recordStoryUsage(userId, client = null) {
  try {
    const db = client || pool;
    await db.query(
      `UPDATE user_usage
       SET stories_generated = stories_generated + 1, updated_at = NOW()
       WHERE user_id = $1 AND period_start = DATE_TRUNC('month', CURRENT_DATE)`,
      [userId]
    );
  } catch (error) {
    logger.error('Error recording story usage:', error);
  }
}

/**
 * Record narration usage
 */
export async function recordNarrationUsage(userId, minutes) {
  try {
    await pool.query(
      `UPDATE user_usage
       SET minutes_used = minutes_used + $2, updated_at = NOW()
       WHERE user_id = $1 AND period_start = DATE_TRUNC('month', CURRENT_DATE)`,
      [userId, minutes]
    );
  } catch (error) {
    logger.error('Error recording narration usage:', error);
  }
}

export default {
  authenticateToken,
  authenticateSocketToken,
  requireAuth,
  requireAdmin,
  optionalAuth,
  generateToken,
  getUserUsage,
  canGenerateStory,
  canGenerateNarration,
  recordStoryUsage,
  recordNarrationUsage
};
