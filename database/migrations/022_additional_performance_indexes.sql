-- =============================================================================
-- MIGRATION 022: Additional Performance Indexes
-- =============================================================================
-- Added during code review to optimize common query patterns

-- =============================================================================
-- SESSION STATUS QUERIES
-- =============================================================================

-- Index for filtering sessions by status (very common in library/dashboard)
CREATE INDEX IF NOT EXISTS idx_story_sessions_status
    ON story_sessions(current_status);

-- Index for user's sessions sorted by activity (library listing)
CREATE INDEX IF NOT EXISTS idx_story_sessions_user_activity
    ON story_sessions(user_id, last_activity_at DESC);

-- Index for public/shared sessions
CREATE INDEX IF NOT EXISTS idx_story_sessions_public
    ON story_sessions(is_public, created_at DESC)
    WHERE is_public = true;

-- =============================================================================
-- SCENE QUERIES
-- =============================================================================

-- Composite index for finding scenes by session in order
CREATE INDEX IF NOT EXISTS idx_story_scenes_session_order
    ON story_scenes(story_session_id, scene_number);

-- Index for finding scenes by type
CREATE INDEX IF NOT EXISTS idx_story_scenes_type
    ON story_scenes(scene_type);

-- =============================================================================
-- CHARACTER AND VOICE QUERIES
-- =============================================================================

-- Index for finding session characters quickly
CREATE INDEX IF NOT EXISTS idx_session_characters_session
    ON session_characters(story_session_id);

-- Index for finding character voice assignments
CREATE INDEX IF NOT EXISTS idx_character_voices_session
    ON character_voice_assignments(story_session_id);

-- =============================================================================
-- RECORDING QUERIES
-- =============================================================================

-- Index for finding recordings by session
CREATE INDEX IF NOT EXISTS idx_story_recordings_session
    ON story_recordings(story_session_id);

-- Index for finding user's recordings
CREATE INDEX IF NOT EXISTS idx_story_recordings_user
    ON story_recordings(user_id, created_at DESC);

-- =============================================================================
-- USAGE TRACKING
-- =============================================================================

-- Index for finding current period usage
CREATE INDEX IF NOT EXISTS idx_user_usage_period
    ON user_usage(user_id, period_start);

-- =============================================================================
-- LORE AND CONTEXT QUERIES
-- =============================================================================

-- Index for session lore entries
CREATE INDEX IF NOT EXISTS idx_lore_entries_session
    ON lore_entries(story_session_id);

-- Full text search on lore content (if needed for search features)
-- CREATE INDEX IF NOT EXISTS idx_lore_entries_content_fts
--     ON lore_entries USING gin(to_tsvector('english', content));

-- =============================================================================
-- SFX CUES
-- =============================================================================

-- Index for finding SFX cues by scene
CREATE INDEX IF NOT EXISTS idx_sfx_cues_scene
    ON sfx_cues(scene_id);

-- =============================================================================
-- SUBSCRIPTION QUERIES
-- =============================================================================

-- Index for finding active subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
    ON user_subscriptions(user_id, status);

-- =============================================================================
-- CLEANUP OLD PARTIAL INDEXES IF NEEDED
-- =============================================================================

-- The existing idx_active_sessions partial index is good, but let's add one
-- for completed sessions too (for archival/stats queries)
CREATE INDEX IF NOT EXISTS idx_completed_sessions
    ON story_sessions(user_id, completed_at DESC)
    WHERE current_status = 'completed';

-- =============================================================================
-- ANALYZE TABLES FOR OPTIMIZER
-- =============================================================================

-- Update table statistics after adding indexes
ANALYZE story_sessions;
ANALYZE story_scenes;
ANALYZE session_characters;
ANALYZE character_voice_assignments;
ANALYZE story_recordings;
ANALYZE user_usage;
ANALYZE lore_entries;
ANALYZE sfx_cues;
ANALYZE user_subscriptions;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON INDEX idx_story_sessions_status IS 'Fast filtering by session status';
COMMENT ON INDEX idx_story_sessions_user_activity IS 'Optimized for library listing with recent first';
COMMENT ON INDEX idx_story_scenes_session_order IS 'Fast scene retrieval in narrative order';
COMMENT ON INDEX idx_user_usage_period IS 'Quick lookup of current period usage';
COMMENT ON INDEX idx_completed_sessions IS 'Partial index for completed sessions only';
