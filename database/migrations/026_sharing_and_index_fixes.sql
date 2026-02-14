-- =============================================================================
-- MIGRATION 026: Add sharing columns and fix index references
-- =============================================================================
-- Simplified version - only includes statements for tables that exist

-- =============================================================================
-- ADD SHARING COLUMNS TO story_sessions
-- =============================================================================

ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS shared_at TIMESTAMP WITH TIME ZONE;

-- =============================================================================
-- CREATE INDEXES FOR story_sessions
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_story_sessions_public
    ON story_sessions(is_public, started_at DESC)
    WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_story_sessions_share_token
    ON story_sessions(share_token)
    WHERE share_token IS NOT NULL;

DROP INDEX IF EXISTS idx_completed_sessions;

CREATE INDEX IF NOT EXISTS idx_finished_sessions
    ON story_sessions(user_id, ended_at DESC)
    WHERE current_status = 'finished';

CREATE INDEX IF NOT EXISTS idx_story_sessions_status
    ON story_sessions(current_status);

CREATE INDEX IF NOT EXISTS idx_story_sessions_user_activity
    ON story_sessions(user_id, last_activity_at DESC);

-- =============================================================================
-- CREATE INDEXES FOR story_scenes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_story_scenes_session_order
    ON story_scenes(story_session_id, sequence_index);

-- =============================================================================
-- CREATE INDEXES FOR character_voice_assignments
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_character_voices_session
    ON character_voice_assignments(story_session_id);

-- =============================================================================
-- CREATE INDEXES FOR story_recordings
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_story_recordings_session
    ON story_recordings(story_session_id);

CREATE INDEX IF NOT EXISTS idx_story_recordings_created
    ON story_recordings(created_at DESC);

-- =============================================================================
-- CREATE INDEXES FOR user_usage
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_user_usage_period
    ON user_usage(user_id, period_start);

-- =============================================================================
-- CREATE INDEXES FOR lore_entries
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_lore_entries_session
    ON lore_entries(story_session_id);

-- =============================================================================
-- CREATE INDEXES FOR scene_sfx (not sfx_cues)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_scene_sfx_scene
    ON scene_sfx(scene_id);

-- =============================================================================
-- CREATE INDEXES FOR user_subscriptions
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
    ON user_subscriptions(user_id, status);

-- =============================================================================
-- LIBRARY LISTING COMPOSITE INDEX (critical for performance)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_library_listing
    ON story_sessions(user_id, current_status, last_activity_at DESC)
    INCLUDE (title, synopsis, cover_image_url, total_scenes, is_favorite);

-- =============================================================================
-- CREATE INDEXES FOR recording_segments
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_recording_segments_recording
    ON recording_segments(recording_id, sequence_index);

-- =============================================================================
-- ANALYZE TABLES
-- =============================================================================

ANALYZE story_sessions;
ANALYZE story_scenes;
ANALYZE character_voice_assignments;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN story_sessions.is_public IS 'Whether this story appears in public discovery';
COMMENT ON COLUMN story_sessions.share_token IS 'Unique token for private sharing links';
COMMENT ON COLUMN story_sessions.shared_at IS 'When the story was first shared';

-- Track migration
INSERT INTO schema_migrations (version, name) VALUES ('026', 'sharing_and_index_fixes')
ON CONFLICT (version) DO NOTHING;
