/**
 * Admin Routes
 * User management, subscription control, and admin operations
 */

import express from 'express';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { authenticateToken, requireAdmin, getUserUsage } from '../middleware/auth.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

// =============================================================================
// USER MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/users
 * List all users with pagination
 */
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = '';
    const params = [limit, offset];

    if (search) {
      whereClause = 'WHERE u.email ILIKE $3 OR u.display_name ILIKE $3';
      params.push(`%${search}%`);
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_admin,
              u.created_at, u.last_login_at,
              s.tier, s.status as subscription_status,
              s.stories_limit, s.minutes_limit
       FROM users u
       LEFT JOIN user_subscriptions s ON u.id = s.user_id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users u ${whereClause}`,
      search ? [`%${search}%`] : []
    );

    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    logger.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:id
 * Get detailed user info
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const userResult = await pool.query(
      `SELECT u.*, s.*
       FROM users u
       LEFT JOIN user_subscriptions s ON u.id = s.user_id
       WHERE u.id = $1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get usage
    const usage = await getUserUsage(id);

    // Get recent stories
    const storiesResult = await pool.query(
      `SELECT id, title, created_at, current_status
       FROM story_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    // Get admin adjustment history
    const adjustmentsResult = await pool.query(
      `SELECT a.*, admin.display_name as admin_name
       FROM admin_adjustments a
       JOIN users admin ON a.admin_user_id = admin.id
       WHERE a.target_user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isAdmin: user.is_admin,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at
      },
      subscription: {
        tier: user.tier,
        status: user.subscription_status,
        storiesLimit: user.stories_limit,
        minutesLimit: parseFloat(user.minutes_limit),
        profilesLimit: user.profiles_limit,
        paypalSubscriptionId: user.paypal_subscription_id,
        currentPeriodStart: user.current_period_start,
        currentPeriodEnd: user.current_period_end
      },
      usage,
      recentStories: storiesResult.rows,
      adjustmentHistory: adjustmentsResult.rows
    });

  } catch (error) {
    logger.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

/**
 * PUT /api/admin/users/:id/subscription
 * Update user subscription tier
 */
router.put('/users/:id/subscription', async (req, res) => {
  try {
    const { id } = req.params;
    const { tier, reason } = req.body;
    const adminId = req.user.id;

    const validTiers = ['free', 'dreamer', 'storyteller', 'family', 'admin'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Get tier limits
    const tierLimits = {
      free: { stories: 1, minutes: 10, profiles: 1 },
      dreamer: { stories: 5, minutes: 50, profiles: 1 },
      storyteller: { stories: 12, minutes: 120, profiles: 2 },
      family: { stories: 25, minutes: 250, profiles: 5 },
      admin: { stories: 999, minutes: 9999, profiles: 99 }
    };

    const limits = tierLimits[tier];

    // Get current subscription
    const currentResult = await pool.query(
      'SELECT tier FROM user_subscriptions WHERE user_id = $1',
      [id]
    );

    const oldTier = currentResult.rows[0]?.tier || 'none';

    // Update subscription
    await pool.query(
      `INSERT INTO user_subscriptions (user_id, tier, status, stories_limit, minutes_limit, profiles_limit)
       VALUES ($1, $2, 'active', $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         tier = $2,
         stories_limit = $3,
         minutes_limit = $4,
         profiles_limit = $5,
         updated_at = NOW()`,
      [id, tier, limits.stories, limits.minutes, limits.profiles]
    );

    // Update current period usage limits
    await pool.query(
      `UPDATE user_usage
       SET stories_limit = $2, minutes_limit = $3, updated_at = NOW()
       WHERE user_id = $1 AND period_start = DATE_TRUNC('month', CURRENT_DATE)`,
      [id, limits.stories, limits.minutes]
    );

    // Log adjustment
    await pool.query(
      `INSERT INTO admin_adjustments (admin_user_id, target_user_id, adjustment_type, old_value, new_value, reason)
       VALUES ($1, $2, 'tier_change', $3, $4, $5)`,
      [adminId, id, oldTier, tier, reason || 'Admin adjustment']
    );

    logger.info(`Admin ${req.user.email} changed user ${id} tier: ${oldTier} -> ${tier}`);

    res.json({
      success: true,
      message: `Subscription updated to ${tier}`,
      tier,
      limits
    });

  } catch (error) {
    logger.error('Admin update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * POST /api/admin/users/:id/bonus
 * Add bonus credits to user
 */
router.post('/users/:id/bonus', async (req, res) => {
  try {
    const { id } = req.params;
    const { bonusStories, bonusMinutes, reason } = req.body;
    const adminId = req.user.id;

    if (!bonusStories && !bonusMinutes) {
      return res.status(400).json({ error: 'Must specify bonusStories or bonusMinutes' });
    }

    // Update usage limits for current period
    const updateParts = [];
    const values = [id];
    let paramIndex = 2;

    if (bonusStories) {
      updateParts.push(`stories_limit = stories_limit + $${paramIndex}`);
      values.push(bonusStories);
      paramIndex++;
    }

    if (bonusMinutes) {
      updateParts.push(`minutes_limit = minutes_limit + $${paramIndex}`);
      values.push(bonusMinutes);
      paramIndex++;
    }

    await pool.query(
      `UPDATE user_usage
       SET ${updateParts.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 AND period_start = DATE_TRUNC('month', CURRENT_DATE)`,
      values
    );

    // Log adjustment
    const adjustmentValue = [];
    if (bonusStories) adjustmentValue.push(`+${bonusStories} stories`);
    if (bonusMinutes) adjustmentValue.push(`+${bonusMinutes} minutes`);

    await pool.query(
      `INSERT INTO admin_adjustments (admin_user_id, target_user_id, adjustment_type, old_value, new_value, reason)
       VALUES ($1, $2, 'bonus_credits', '', $3, $4)`,
      [adminId, id, adjustmentValue.join(', '), reason || 'Admin bonus']
    );

    logger.info(`Admin ${req.user.email} added bonus to user ${id}: ${adjustmentValue.join(', ')}`);

    res.json({
      success: true,
      message: `Added ${adjustmentValue.join(' and ')}`,
      bonusStories,
      bonusMinutes
    });

  } catch (error) {
    logger.error('Admin add bonus error:', error);
    res.status(500).json({ error: 'Failed to add bonus' });
  }
});

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * GET /api/admin/stats
 * Get overall statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [usersResult, storiesResult, subscriptionsResult, usageResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL \'7 days\') as new_week FROM users'),
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL \'7 days\') as new_week FROM story_sessions'),
      pool.query(`
        SELECT tier, COUNT(*) as count
        FROM user_subscriptions
        GROUP BY tier
      `),
      pool.query(`
        SELECT
          SUM(stories_generated) as total_stories,
          SUM(minutes_used) as total_minutes
        FROM user_usage
        WHERE period_start = DATE_TRUNC('month', CURRENT_DATE)
      `)
    ]);

    const tierCounts = {};
    subscriptionsResult.rows.forEach(row => {
      tierCounts[row.tier] = parseInt(row.count);
    });

    res.json({
      users: {
        total: parseInt(usersResult.rows[0].total),
        newThisWeek: parseInt(usersResult.rows[0].new_week)
      },
      stories: {
        total: parseInt(storiesResult.rows[0].total),
        newThisWeek: parseInt(storiesResult.rows[0].new_week)
      },
      subscriptions: tierCounts,
      currentMonthUsage: {
        storiesGenerated: parseInt(usageResult.rows[0]?.total_stories || 0),
        minutesUsed: parseFloat(usageResult.rows[0]?.total_minutes || 0)
      }
    });

  } catch (error) {
    logger.error('Admin get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// =============================================================================
// PAYPAL PLACEHOLDERS
// =============================================================================

/**
 * POST /api/admin/paypal/sync
 * Sync PayPal subscriptions (placeholder)
 */
router.post('/paypal/sync', async (req, res) => {
  // TODO: Implement PayPal subscription sync
  res.json({
    success: false,
    message: 'PayPal integration not yet configured',
    todo: 'Configure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env'
  });
});

// =============================================================================
// PAYMENT ROUTES PLACEHOLDER
// =============================================================================

/**
 * These routes will be implemented when PayPal is configured:
 *
 * POST /api/paypal/create-subscription
 * - Creates a PayPal subscription for user
 * - Redirects to PayPal for approval
 *
 * GET /api/paypal/subscription/:id
 * - Get subscription details
 *
 * POST /api/paypal/cancel-subscription
 * - Cancel user's subscription
 *
 * POST /api/paypal/webhook
 * - Handle PayPal webhook events:
 *   - BILLING.SUBSCRIPTION.CREATED
 *   - BILLING.SUBSCRIPTION.ACTIVATED
 *   - BILLING.SUBSCRIPTION.CANCELLED
 *   - BILLING.SUBSCRIPTION.SUSPENDED
 *   - PAYMENT.SALE.COMPLETED
 *   - PAYMENT.SALE.REFUNDED
 */

export default router;
