/**
 * Subscription Helper
 * Centralized logic for subscription creation and management
 */

import { pool } from '../database/pool.js';
import { logger } from './logger.js';

/**
 * Subscription tier configurations
 * Centralized source of truth for tier limits
 */
export const SUBSCRIPTION_TIERS = {
  free: {
    tier: 'free',
    storiesLimit: 1,
    minutesLimit: 10,
    profilesLimit: 1
  },
  basic: {
    tier: 'basic',
    storiesLimit: 10,
    minutesLimit: 60,
    profilesLimit: 3
  },
  premium: {
    tier: 'premium',
    storiesLimit: 50,
    minutesLimit: 300,
    profilesLimit: 10
  },
  admin: {
    tier: 'admin',
    storiesLimit: 999,
    minutesLimit: 9999,
    profilesLimit: 99
  }
};

/**
 * Get the subscription tier config based on admin status
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {object} - Tier configuration
 */
export function getDefaultTierConfig(isAdmin) {
  return isAdmin ? SUBSCRIPTION_TIERS.admin : SUBSCRIPTION_TIERS.free;
}

/**
 * Create a default subscription for a user
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Whether the user is an admin
 * @param {object} client - Optional database client for transactions
 * @returns {Promise<object>} - The created subscription
 */
export async function createDefaultSubscription(userId, isAdmin = false, client = null) {
  const db = client || pool;
  const tier = getDefaultTierConfig(isAdmin);

  try {
    const result = await db.query(
      `INSERT INTO user_subscriptions (
        user_id, tier, status, stories_limit, minutes_limit, profiles_limit
      ) VALUES ($1, $2, 'active', $3, $4, $5)
      RETURNING *`,
      [userId, tier.tier, tier.storiesLimit, tier.minutesLimit, tier.profilesLimit]
    );

    logger.info(`Created ${tier.tier} subscription for user ${userId}`);
    return result.rows[0];
  } catch (error) {
    // Handle duplicate key error gracefully
    if (error.code === '23505') {
      logger.warn(`Subscription already exists for user ${userId}`);
      const existing = await db.query(
        'SELECT * FROM user_subscriptions WHERE user_id = $1',
        [userId]
      );
      return existing.rows[0];
    }
    throw error;
  }
}

/**
 * Get or create subscription for a user
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {Promise<object>} - The subscription
 */
export async function getOrCreateSubscription(userId, isAdmin = false) {
  // Try to get existing subscription
  const existing = await pool.query(
    'SELECT * FROM user_subscriptions WHERE user_id = $1',
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new subscription
  return createDefaultSubscription(userId, isAdmin);
}

/**
 * Upgrade a subscription to a new tier
 * @param {string} userId - User ID
 * @param {string} newTier - New tier name ('basic', 'premium', etc.)
 * @param {object} options - Additional options (expiresAt, etc.)
 * @returns {Promise<object>} - Updated subscription
 */
export async function upgradeSubscription(userId, newTier, options = {}) {
  const tierConfig = SUBSCRIPTION_TIERS[newTier];
  if (!tierConfig) {
    throw new Error(`Invalid subscription tier: ${newTier}`);
  }

  const result = await pool.query(
    `UPDATE user_subscriptions
     SET tier = $2,
         stories_limit = $3,
         minutes_limit = $4,
         profiles_limit = $5,
         current_period_end = COALESCE($6, current_period_end),
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [
      userId,
      tierConfig.tier,
      tierConfig.storiesLimit,
      tierConfig.minutesLimit,
      tierConfig.profilesLimit,
      options.expiresAt || null
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(`No subscription found for user ${userId}`);
  }

  logger.info(`Upgraded user ${userId} to ${newTier} tier`);
  return result.rows[0];
}

/**
 * Format subscription for API response
 * @param {object} subscription - Raw subscription from database
 * @returns {object} - Formatted subscription object
 */
export function formatSubscriptionResponse(subscription) {
  if (!subscription) return null;

  return {
    tier: subscription.tier,
    status: subscription.status,
    storiesLimit: subscription.stories_limit,
    minutesLimit: parseFloat(subscription.minutes_limit),
    profilesLimit: subscription.profiles_limit,
    currentPeriodEnd: subscription.current_period_end,
    trialEndsAt: subscription.trial_ends_at
  };
}

export default {
  SUBSCRIPTION_TIERS,
  getDefaultTierConfig,
  createDefaultSubscription,
  getOrCreateSubscription,
  upgradeSubscription,
  formatSubscriptionResponse
};
