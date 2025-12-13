-- =============================================================================
-- MIGRATION 007: Performance Indexes
-- =============================================================================
-- Adds missing indexes identified during code review

-- =============================================================================
-- MISSING INDEXES FOR COMMON QUERIES
-- =============================================================================

-- Index for finding pending choices by session (used in backtrack queries)
CREATE INDEX IF NOT EXISTS idx_story_choices_session
    ON story_choices(story_session_id);

-- Composite index for finding pending/selected choices
CREATE INDEX IF NOT EXISTS idx_story_choices_session_selected
    ON story_choices(story_session_id, was_selected);

-- Index for filtering conversation turns by role (for agent turn lookups)
CREATE INDEX IF NOT EXISTS idx_conversation_turns_role
    ON conversation_turns(role);

-- Index for conversation turns by session
CREATE INDEX IF NOT EXISTS idx_conversation_turns_session
    ON conversation_turns(story_session_id);

-- =============================================================================
-- CHECK CONSTRAINTS FOR DATA INTEGRITY
-- =============================================================================

-- Ensure intensity_level is within valid range
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_scene_intensity'
    ) THEN
        ALTER TABLE story_scenes
            ADD CONSTRAINT chk_scene_intensity
            CHECK (intensity_level IS NULL OR (intensity_level >= 0 AND intensity_level <= 100));
    END IF;
END $$;

-- Ensure lore entry importance is within valid range
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_lore_importance'
    ) THEN
        ALTER TABLE lore_entries
            ADD CONSTRAINT chk_lore_importance
            CHECK (importance IS NULL OR (importance >= 0 AND importance <= 100));
    END IF;
END $$;

-- Ensure reading preferences have valid ranges
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_font_size'
    ) THEN
        ALTER TABLE reading_preferences
            ADD CONSTRAINT chk_font_size
            CHECK (font_size IS NULL OR (font_size >= 8 AND font_size <= 48));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_playback_speed'
    ) THEN
        ALTER TABLE reading_preferences
            ADD CONSTRAINT chk_playback_speed
            CHECK (playback_speed IS NULL OR (playback_speed >= 0.5 AND playback_speed <= 2.0));
    END IF;
END $$;

-- Ensure user_usage minutes are non-negative
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_minutes_positive'
    ) THEN
        ALTER TABLE user_usage
            ADD CONSTRAINT chk_minutes_positive
            CHECK (minutes_used >= 0);
    END IF;
END $$;

-- =============================================================================
-- PARTIAL INDEX FOR ACTIVE SESSIONS
-- =============================================================================

-- Faster queries for finding active sessions
CREATE INDEX IF NOT EXISTS idx_active_sessions
    ON story_sessions(user_id, last_activity_at)
    WHERE current_status IN ('narrating', 'paused', 'waiting_choice');

-- =============================================================================
-- COMMENT UPDATES
-- =============================================================================

COMMENT ON INDEX idx_story_choices_session IS 'Fast lookup of choices by session for backtrack operations';
COMMENT ON INDEX idx_story_choices_session_selected IS 'Composite index for pending/selected choice queries';
COMMENT ON INDEX idx_active_sessions IS 'Partial index for active sessions only - faster dashboard queries';
