/**
 * Authentication Routes
 * Google OAuth and JWT-based authentication
 */

import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { authenticateToken, requireAuth, generateToken, getUserUsage } from '../middleware/auth.js';
import {
  createDefaultSubscription,
  getOrCreateSubscription,
  formatSubscriptionResponse
} from '../utils/subscriptionHelper.js';
import { wrapRoutes } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

// Google OAuth client
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// SECURITY: Dev login ONLY allowed in development environment
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEV_LOGIN_ENABLED = NODE_ENV === 'development' && process.env.DEV_LOGIN_ENABLED === 'true';
const DEV_LOGIN_TOKEN = process.env.DEV_LOGIN_TOKEN;
const DEV_LOGIN_EMAIL = (process.env.DEV_LOGIN_EMAIL || 'dev@storyteller.local').toLowerCase();
const DEV_LOGIN_NAME = process.env.DEV_LOGIN_NAME || 'Developer';
const DEV_LOGIN_IS_ADMIN = process.env.DEV_LOGIN_IS_ADMIN === 'true';

/**
 * POST /api/auth/google
 * Authenticate with Google ID token (from frontend Google Sign-In)
 */
router.post('/google', rateLimiters.auth, async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential required' });
    }

    if (!googleClient) {
      logger.error('Google OAuth not configured');
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    logger.info(`Google auth for: ${email}`);

    // Check if user exists
    let result = await pool.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );

    let user;
    let isNewUser = false;

    if (result.rows.length === 0) {
      // Create new user
      isNewUser = true;
      const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

      result = await pool.query(
        `INSERT INTO users (google_id, email, display_name, avatar_url, is_admin, last_login_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [googleId, email, name, picture, isAdmin]
      );

      user = result.rows[0];

      // Create default subscription using centralized helper
      await createDefaultSubscription(user.id, isAdmin);

      logger.info(`Created new user: ${email} (admin: ${isAdmin})`);
    } else {
      // Update existing user
      user = result.rows[0];

      await pool.query(
        `UPDATE users
         SET google_id = COALESCE(google_id, $1),
             avatar_url = COALESCE($2, avatar_url),
             display_name = COALESCE($3, display_name),
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE id = $4`,
        [googleId, picture, name, user.id]
      );

      // Refresh user data
      result = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      user = result.rows[0];
    }

    // Check if admin
    user.is_admin = user.is_admin || ADMIN_EMAILS.includes(email.toLowerCase());

    // Get or create subscription using centralized helper
    const subscription = await getOrCreateSubscription(user.id, user.is_admin);

    // Get current usage
    const usage = await getUserUsage(user.id);

    // Generate JWT
    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isAdmin: user.is_admin,
        isNewUser
      },
      subscription: formatSubscriptionResponse(subscription),
      usage: usage ? {
        storiesGenerated: usage.stories_generated,
        storiesLimit: usage.stories_limit,
        storiesRemaining: usage.stories_limit - usage.stories_generated,
        minutesUsed: parseFloat(usage.minutes_used),
        minutesLimit: parseFloat(usage.minutes_limit),
        minutesRemaining: parseFloat(usage.minutes_limit) - parseFloat(usage.minutes_used)
      } : null
    });

  } catch (error) {
    logger.error('Google auth error:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });

    const message = error.message || '';
    if (message.includes('Token used too late')) {
      return res.status(401).json({ error: 'Token expired. Please sign in again.' });
    }
    if (message.includes('Wrong number of segments') || message.includes('Wrong recipient') || message.includes('audience')) {
      return res.status(401).json({ error: 'Invalid Google credential. Please sign in again.' });
    }

    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /api/auth/dev-login
 * Development login using a shared token (disabled unless explicitly enabled)
 */
router.post('/dev-login', rateLimiters.auth, async (req, res) => {
  try {
    if (!DEV_LOGIN_ENABLED || !DEV_LOGIN_TOKEN) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { token, email, displayName } = req.body;
    if (!token || token !== DEV_LOGIN_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const loginEmail = (email || DEV_LOGIN_EMAIL).toLowerCase();
    const name = displayName || DEV_LOGIN_NAME;
    const isAdmin = DEV_LOGIN_IS_ADMIN || ADMIN_EMAILS.includes(loginEmail);

    let result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [loginEmail]
    );

    let user;
    let isNewUser = false;

    if (result.rows.length === 0) {
      isNewUser = true;
      result = await pool.query(
        `INSERT INTO users (email, display_name, is_admin, last_login_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [loginEmail, name, isAdmin]
      );
      user = result.rows[0];
      await createDefaultSubscription(user.id, isAdmin);
      logger.warn(`[DevLogin] Created dev user: ${loginEmail} (admin: ${isAdmin})`);
    } else {
      user = result.rows[0];
      await pool.query(
        `UPDATE users
         SET display_name = COALESCE($1, display_name),
             is_admin = $2,
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [name, isAdmin, user.id]
      );
      result = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      user = result.rows[0];
    }

    const subscription = await getOrCreateSubscription(user.id, isAdmin);
    const usage = await getUserUsage(user.id);
    const devToken = generateToken(user.id);

    res.json({
      success: true,
      token: devToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isAdmin: user.is_admin,
        isNewUser
      },
      subscription: formatSubscriptionResponse(subscription),
      usage: usage ? {
        storiesGenerated: usage.stories_generated,
        storiesLimit: usage.stories_limit,
        storiesRemaining: usage.stories_limit - usage.stories_generated,
        minutesUsed: parseFloat(usage.minutes_used),
        minutesLimit: parseFloat(usage.minutes_limit),
        minutesRemaining: parseFloat(usage.minutes_limit) - parseFloat(usage.minutes_used)
      } : null
    });
  } catch (error) {
    logger.error('Dev login error:', error);
    res.status(500).json({ error: 'Dev login failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get or create subscription using centralized helper
    const subscription = await getOrCreateSubscription(user.id, user.is_admin);

    // Get current usage
    const usage = await getUserUsage(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isAdmin: user.is_admin
      },
      subscription: formatSubscriptionResponse(subscription),
      usage: usage ? {
        storiesGenerated: usage.stories_generated,
        storiesLimit: usage.stories_limit,
        storiesRemaining: Math.max(0, usage.stories_limit - usage.stories_generated),
        minutesUsed: parseFloat(usage.minutes_used),
        minutesLimit: parseFloat(usage.minutes_limit),
        minutesRemaining: Math.max(0, parseFloat(usage.minutes_limit) - parseFloat(usage.minutes_used))
      } : null
    });

  } catch (error) {
    logger.error('Get user error:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal, optional server-side cleanup)
 */
router.post('/logout', authenticateToken, (req, res) => {
  // JWT is stateless, so logout is handled client-side
  // Could add token to blacklist here if needed
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/usage
 * Get current usage statistics
 */
router.get('/usage', authenticateToken, requireAuth, async (req, res) => {
  try {
    const usage = await getUserUsage(req.user.id);

    if (!usage) {
      return res.status(500).json({ error: 'Failed to get usage data' });
    }

    res.json({
      period: {
        start: usage.period_start,
        end: usage.period_end
      },
      stories: {
        used: usage.stories_generated,
        limit: usage.stories_limit,
        remaining: Math.max(0, usage.stories_limit - usage.stories_generated)
      },
      narration: {
        minutesUsed: parseFloat(usage.minutes_used),
        minutesLimit: parseFloat(usage.minutes_limit),
        minutesRemaining: Math.max(0, parseFloat(usage.minutes_limit) - parseFloat(usage.minutes_used))
      },
      extras: {
        sfxMinutesUsed: parseFloat(usage.sfx_minutes_used || 0),
        illustrationCreditsUsed: usage.illustration_credits_used || 0
      }
    });

  } catch (error) {
    logger.error('Get usage error:', error);
    res.status(500).json({ error: 'Failed to get usage data' });
  }
});

export default router;
