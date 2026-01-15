/**
 * PayPal Payment Routes
 * Subscription management and webhook handling
 *
 * PLACEHOLDER - Configure PayPal credentials to enable
 */

import express from 'express';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { wrapRoutes, ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

// PayPal configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_API_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

/**
 * Get PayPal OAuth access token
 * @returns {Promise<string>} Access token
 */
async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Verify PayPal webhook signature
 * SECURITY: This prevents attackers from forging webhook events
 * @param {object} req - Express request object
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyWebhookSignature(req) {
  if (!PAYPAL_WEBHOOK_ID) {
    logger.warn('PAYPAL_WEBHOOK_ID not configured - skipping signature verification');
    return false;
  }

  try {
    const accessToken = await getPayPalAccessToken();

    const verifyPayload = {
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: req.body
    };

    const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verifyPayload)
    });

    if (!response.ok) {
      logger.error('PayPal webhook verification API error:', response.status);
      return false;
    }

    const result = await response.json();

    if (result.verification_status !== 'SUCCESS') {
      logger.warn('PayPal webhook signature verification failed:', result.verification_status);
      return false;
    }

    logger.info('PayPal webhook signature verified successfully');
    return true;
  } catch (error) {
    logger.error('PayPal webhook verification error:', error);
    return false;
  }
}

// Plan IDs from environment
const PLAN_IDS = {
  dreamer: process.env.PAYPAL_PLAN_ID_DREAMER,
  storyteller: process.env.PAYPAL_PLAN_ID_STORYTELLER,
  family: process.env.PAYPAL_PLAN_ID_FAMILY
};

// Check if PayPal is configured
const isConfigured = () => PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET;

/**
 * GET /api/paypal/status
 * Check if PayPal is configured
 */
router.get('/status', (req, res) => {
  res.json({
    configured: isConfigured(),
    mode: PAYPAL_MODE,
    plans: {
      dreamer: !!PLAN_IDS.dreamer,
      storyteller: !!PLAN_IDS.storyteller,
      family: !!PLAN_IDS.family
    }
  });
});

/**
 * GET /api/paypal/plans
 * Get available subscription plans
 */
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'dreamer',
        name: 'Explorer',
        price: 7.99,
        currency: 'USD',
        interval: 'month',
        features: [
          '5 stories per month',
          '50 minutes of narration',
          'Standard voices',
          '1 user profile'
        ],
        limits: { stories: 5, minutes: 50, profiles: 1 },
        paypalPlanId: PLAN_IDS.dreamer || null
      },
      {
        id: 'storyteller',
        name: 'Creator',
        price: 14.99,
        currency: 'USD',
        interval: 'month',
        popular: true,
        features: [
          '12 stories per month',
          '120 minutes of narration',
          'Premium voices',
          'Interactive branching',
          'Story Bible access',
          '2 user profiles'
        ],
        limits: { stories: 12, minutes: 120, profiles: 2 },
        paypalPlanId: PLAN_IDS.storyteller || null
      },
      {
        id: 'family',
        name: 'Studio',
        price: 24.99,
        currency: 'USD',
        interval: 'month',
        features: [
          '25 stories per month',
          '250 minutes of narration',
          'All premium features',
          'Co-writing sessions',
          'Custom voice cloning',
          '5 user profiles',
          'Offline downloads'
        ],
        limits: { stories: 25, minutes: 250, profiles: 5 },
        paypalPlanId: PLAN_IDS.family || null
      }
    ]
  });
});

/**
 * POST /api/paypal/create-subscription
 * Create a new subscription
 */
router.post('/create-subscription', authenticateToken, requireAuth, async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Payment system not configured',
      message: 'PayPal integration is not yet set up. Please contact support.',
      setupRequired: true
    });
  }

  const { planId } = req.body;

  if (!planId || !PLAN_IDS[planId]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  // TODO: Implement PayPal subscription creation
  // 1. Get access token from PayPal
  // 2. Create subscription via PayPal API
  // 3. Return approval URL for user to complete

  res.status(503).json({
    error: 'Coming soon',
    message: 'Subscription functionality will be available shortly.',
    planId,
    paypalPlanId: PLAN_IDS[planId]
  });
});

/**
 * POST /api/paypal/webhook
 * Handle PayPal webhook events
 * SECURITY: Verifies webhook signature before processing
 */
router.post('/webhook', async (req, res) => {
  if (!isConfigured()) {
    logger.warn('PayPal webhook received but PayPal not configured');
    return res.status(200).send('OK');
  }

  const event = req.body;
  const eventType = event.event_type;

  logger.info(`PayPal webhook received: ${eventType}`);

  try {
    // SECURITY: Verify webhook signature before processing
    const isValidSignature = await verifyWebhookSignature(req);

    if (!isValidSignature) {
      logger.error('PayPal webhook signature verification failed - rejecting event');
      // Return 200 to prevent PayPal from retrying, but don't process the event
      // Alternatively, return 401 to signal rejection
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        // Subscription was created (pending approval)
        logger.info('Subscription created:', event.resource?.id);
        break;

      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        // Subscription is now active
        // TODO: Update user subscription in database
        logger.info('Subscription activated:', event.resource?.id);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        // User cancelled subscription
        // TODO: Mark subscription as cancelled, keep access until period end
        logger.info('Subscription cancelled:', event.resource?.id);
        break;

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        // Payment failed
        // TODO: Update subscription status
        logger.info('Subscription suspended:', event.resource?.id);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        // Recurring payment completed
        // TODO: Reset usage limits for new period
        logger.info('Payment completed:', event.resource?.id);
        break;

      default:
        logger.debug(`Unhandled PayPal event: ${eventType}`);
    }

    res.status(200).send('OK');

  } catch (error) {
    logger.error('PayPal webhook error:', error);
    res.status(500).send('Error');
  }
});

/**
 * POST /api/paypal/cancel-subscription
 * Cancel user's subscription
 */
router.post('/cancel-subscription', authenticateToken, requireAuth, async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Payment system not configured',
      message: 'PayPal integration is not yet set up.'
    });
  }

  // TODO: Implement subscription cancellation
  // 1. Get user's PayPal subscription ID from database
  // 2. Cancel via PayPal API
  // 3. Update database (keep access until current_period_end)

  res.status(503).json({
    error: 'Coming soon',
    message: 'Cancellation functionality will be available shortly.'
  });
});

/**
 * GET /api/paypal/subscription
 * Get user's subscription details
 */
router.get('/subscription', authenticateToken, requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.email
       FROM user_subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ subscription: null });
    }

    const sub = result.rows[0];

    res.json({
      subscription: {
        tier: sub.tier,
        status: sub.status,
        storiesLimit: sub.stories_limit,
        minutesLimit: parseFloat(sub.minutes_limit),
        profilesLimit: sub.profiles_limit,
        paypalSubscriptionId: sub.paypal_subscription_id,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        trialEndsAt: sub.trial_ends_at
      }
    });

  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription details' });
  }
});

export default router;
