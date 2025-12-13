-- =============================================================================
-- MIGRATION 006: Authentication & Subscription System
-- =============================================================================
-- Adds Google OAuth, JWT auth, subscriptions, and usage tracking

-- =============================================================================
-- UPDATE USERS TABLE
-- =============================================================================

-- Add auth columns to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

-- Index for Google ID lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- =============================================================================
-- SUBSCRIPTION TIERS
-- =============================================================================

CREATE TYPE subscription_tier AS ENUM ('free', 'dreamer', 'storyteller', 'family', 'admin');
CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'past_due', 'trial', 'expired');

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Subscription details
    tier subscription_tier NOT NULL DEFAULT 'free',
    status subscription_status NOT NULL DEFAULT 'active',

    -- PayPal integration (placeholder)
    paypal_subscription_id VARCHAR(255),
    paypal_payer_id VARCHAR(255),

    -- Billing periods
    current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE,
    trial_ends_at TIMESTAMP WITH TIME ZONE,

    -- Limits based on tier
    stories_limit INTEGER NOT NULL DEFAULT 1,
    minutes_limit DECIMAL(10,2) NOT NULL DEFAULT 10,
    profiles_limit INTEGER NOT NULL DEFAULT 1,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id)
);

-- =============================================================================
-- USAGE TRACKING
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,

    -- Period
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Story usage
    stories_generated INTEGER DEFAULT 0,
    stories_limit INTEGER NOT NULL,

    -- Narration usage (in minutes)
    minutes_used DECIMAL(10,2) DEFAULT 0,
    minutes_limit DECIMAL(10,2) NOT NULL,

    -- Additional features
    sfx_minutes_used DECIMAL(10,2) DEFAULT 0,
    illustration_credits_used INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, period_start)
);

-- =============================================================================
-- STORY COSTS (Per-story cost tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS story_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Costs
    narration_minutes DECIMAL(10,2) DEFAULT 0,
    sfx_minutes DECIMAL(10,2) DEFAULT 0,
    illustration_credits INTEGER DEFAULT 0,

    -- Regeneration tracking
    regeneration_count INTEGER DEFAULT 0,

    -- Narration control
    narration_enabled BOOLEAN DEFAULT TRUE,
    voice_id VARCHAR(100),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- ADMIN ADJUSTMENTS LOG
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES users(id),
    target_user_id UUID NOT NULL REFERENCES users(id),

    adjustment_type VARCHAR(50) NOT NULL,
    -- Types: tier_change, bonus_minutes, bonus_stories, status_change, manual_override

    old_value TEXT,
    new_value TEXT,
    reason TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- REFRESH TOKENS (for JWT)
-- =============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tier ON user_subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_usage_user ON user_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_period ON user_usage(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_story_costs_session ON story_costs(story_session_id);
CREATE INDEX IF NOT EXISTS idx_story_costs_user ON story_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_adjustments_target ON admin_adjustments(target_user_id);

-- =============================================================================
-- TIER LIMITS REFERENCE
-- =============================================================================

COMMENT ON TABLE user_subscriptions IS 'Tier limits:
  free:        1 story,  10 min, 1 profile
  dreamer:     5 stories, 50 min, 1 profile  ($7.99/mo)
  storyteller: 12 stories, 120 min, 2 profiles ($14.99/mo)
  family:      25 stories, 250 min, 5 profiles ($24.99/mo)
  admin:       unlimited';

-- =============================================================================
-- FUNCTION: Get or create subscription for user
-- =============================================================================

CREATE OR REPLACE FUNCTION get_or_create_subscription(p_user_id UUID)
RETURNS user_subscriptions AS $$
DECLARE
    v_sub user_subscriptions;
BEGIN
    SELECT * INTO v_sub FROM user_subscriptions WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        INSERT INTO user_subscriptions (user_id, tier, status, stories_limit, minutes_limit, profiles_limit)
        VALUES (p_user_id, 'free', 'active', 1, 10, 1)
        RETURNING * INTO v_sub;
    END IF;

    RETURN v_sub;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- FUNCTION: Get or create usage for current period
-- =============================================================================

CREATE OR REPLACE FUNCTION get_or_create_usage(p_user_id UUID)
RETURNS user_usage AS $$
DECLARE
    v_usage user_usage;
    v_sub user_subscriptions;
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    -- Get subscription
    SELECT * INTO v_sub FROM user_subscriptions WHERE user_id = p_user_id;

    -- Calculate current period (monthly, starting from subscription start)
    v_period_start := DATE_TRUNC('month', CURRENT_DATE);
    v_period_end := (v_period_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- Try to find existing usage record
    SELECT * INTO v_usage
    FROM user_usage
    WHERE user_id = p_user_id
      AND period_start = v_period_start;

    IF NOT FOUND THEN
        INSERT INTO user_usage (
            user_id, subscription_id, period_start, period_end,
            stories_limit, minutes_limit
        ) VALUES (
            p_user_id,
            v_sub.id,
            v_period_start,
            v_period_end,
            COALESCE(v_sub.stories_limit, 1),
            COALESCE(v_sub.minutes_limit, 10)
        )
        RETURNING * INTO v_usage;
    END IF;

    RETURN v_usage;
END;
$$ LANGUAGE plpgsql;
