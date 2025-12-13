-- =============================================================================
-- E-READER & LIBRARY FEATURES MIGRATION
-- =============================================================================
-- Adds bookmarks, reading progress, user reading preferences, and session management
-- Run: psql -U postgres -d storyteller_db -f 002_ereader_features.sql

-- =============================================================================
-- READING PROGRESS TRACKING
-- =============================================================================

-- Add reading progress columns to story_sessions
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS last_read_scene_id UUID REFERENCES story_scenes(id);
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS total_reading_time_seconds INTEGER DEFAULT 0;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500);
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS synopsis TEXT;

-- =============================================================================
-- BOOKMARKS
-- =============================================================================

CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,

    -- Bookmark details
    name VARCHAR(100),                       -- User-defined name or auto "Scene 5"
    note TEXT,                               -- User notes about this bookmark
    color VARCHAR(20) DEFAULT 'gold',        -- Visual marker color

    -- Position within scene (for mid-scene bookmarks)
    text_position INTEGER DEFAULT 0,         -- Character offset within polished_text
    audio_position_seconds FLOAT DEFAULT 0,  -- Position in audio

    -- Auto or manual
    is_auto_bookmark BOOLEAN DEFAULT FALSE,  -- System-created (last position) vs user-created

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- USER READING PREFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS reading_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,

    -- Display settings
    font_size INTEGER DEFAULT 18,            -- pixels
    font_family VARCHAR(50) DEFAULT 'Georgia',
    line_height FLOAT DEFAULT 1.6,
    theme VARCHAR(20) DEFAULT 'dark',        -- dark, light, sepia, midnight

    -- Audio settings
    playback_speed FLOAT DEFAULT 1.0,
    auto_play_next_scene BOOLEAN DEFAULT TRUE,
    sync_highlight BOOLEAN DEFAULT TRUE,     -- Highlight text as audio plays

    -- Reading behavior
    auto_bookmark BOOLEAN DEFAULT TRUE,      -- Auto-save position on close
    show_progress_bar BOOLEAN DEFAULT TRUE,
    haptic_feedback BOOLEAN DEFAULT TRUE,

    -- Accessibility
    high_contrast BOOLEAN DEFAULT FALSE,
    reduce_motion BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- READING HISTORY (detailed tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS reading_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,

    -- Session info
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,

    -- Reading mode
    mode VARCHAR(20) DEFAULT 'audio',        -- audio, text, both
    completed_scene BOOLEAN DEFAULT FALSE,

    -- Device info (optional)
    device_type VARCHAR(50),                 -- mobile, tablet, desktop

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- STORY COLLECTIONS/FOLDERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS story_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    cover_color VARCHAR(20) DEFAULT '#6366f1',
    icon VARCHAR(50) DEFAULT 'folder',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES story_collections(id) ON DELETE CASCADE,
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sort_order INTEGER DEFAULT 0,
    UNIQUE(collection_id, story_session_id)
);

-- =============================================================================
-- MULTIPLAYER / PARTICIPANTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Participant info
    display_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    voice_print_hash VARCHAR(64),            -- For voice identification

    -- Role in session
    role VARCHAR(50) DEFAULT 'player',       -- host, player, spectator
    character_id UUID REFERENCES characters(id),  -- If playing a character

    -- Turn management
    current_turn BOOLEAN DEFAULT FALSE,
    turns_taken INTEGER DEFAULT 0,
    last_active_at TIMESTAMP WITH TIME ZONE,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- CHARACTER VOICE ASSIGNMENTS (for multi-voice narration)
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_voice_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
    elevenlabs_voice_id VARCHAR(100) NOT NULL,
    voice_settings_json JSONB DEFAULT '{}',  -- stability, style, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(story_session_id, character_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_session ON bookmarks(story_session_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_scene ON bookmarks(scene_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_user ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_session ON reading_history(story_session_id);
CREATE INDEX IF NOT EXISTS idx_story_collections_user ON story_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_session ON session_participants(story_session_id);
CREATE INDEX IF NOT EXISTS idx_character_voice_assignments_session ON character_voice_assignments(story_session_id);

-- =============================================================================
-- UPDATE TRIGGER FOR LAST READ
-- =============================================================================

CREATE OR REPLACE FUNCTION update_last_read()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE story_sessions
    SET last_read_at = NOW(),
        last_read_scene_id = NEW.scene_id
    WHERE id = NEW.story_session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_last_read ON reading_history;
CREATE TRIGGER trigger_update_last_read
AFTER INSERT ON reading_history
FOR EACH ROW EXECUTE FUNCTION update_last_read();

-- =============================================================================
-- DEFAULT READING PREFERENCES FOR EXISTING USERS
-- =============================================================================

INSERT INTO reading_preferences (user_id)
SELECT id FROM users
WHERE id NOT IN (SELECT user_id FROM reading_preferences WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;

-- =============================================================================
-- HELPFUL VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW library_stories AS
SELECT
    s.id,
    s.user_id,
    s.title,
    s.mode,
    s.cyoa_enabled,
    s.current_status,
    s.total_scenes,
    s.current_scene_index,
    s.is_favorite,
    s.cover_image_url,
    s.synopsis,
    s.started_at,
    s.ended_at,
    s.last_read_at,
    s.total_reading_time_seconds,
    o.themes,
    COALESCE(
        (SELECT polished_text FROM story_scenes
         WHERE story_session_id = s.id
         ORDER BY sequence_index LIMIT 1),
        ''
    ) as first_scene_preview,
    (SELECT COUNT(*) FROM bookmarks WHERE story_session_id = s.id AND NOT is_auto_bookmark) as bookmark_count,
    CASE
        WHEN s.total_scenes > 0 THEN
            ROUND((COALESCE(s.current_scene_index, 0)::NUMERIC / s.total_scenes) * 100)
        ELSE 0
    END as progress_percent
FROM story_sessions s
LEFT JOIN story_outlines o ON o.story_session_id = s.id
ORDER BY s.last_activity_at DESC;

COMMENT ON TABLE bookmarks IS 'User bookmarks for story positions';
COMMENT ON TABLE reading_preferences IS 'User reading/display preferences';
COMMENT ON TABLE reading_history IS 'Detailed reading session tracking';
COMMENT ON TABLE story_collections IS 'User-created story folders/collections';
COMMENT ON TABLE session_participants IS 'Multiplayer session participants';
COMMENT ON TABLE character_voice_assignments IS 'Voice assignments for multi-voice narration';
