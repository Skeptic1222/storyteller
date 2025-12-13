-- =============================================================================
-- MIGRATION: Add Story Recording System
-- Version: 005
-- Date: 2024-12-05
-- Purpose: Enable recording/caching of generated audio for replay without API costs
-- Features: Karaoke word sync, SFX timing, CYOA branching, file integrity
-- =============================================================================

-- =============================================================================
-- STORY RECORDINGS (Master recording entry per story path)
-- =============================================================================

CREATE TABLE IF NOT EXISTS story_recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,

    -- Path identification (for CYOA branching)
    path_hash VARCHAR(64),              -- SHA-256 of choice sequence, NULL for linear
    choice_sequence TEXT,               -- Human-readable: "A-B-C" or NULL for linear

    -- Recording metadata
    title VARCHAR(500),
    total_duration_seconds FLOAT DEFAULT 0,
    scene_count INTEGER DEFAULT 0,

    -- Audio quality settings
    audio_format VARCHAR(20) DEFAULT 'mp3',
    sample_rate INTEGER DEFAULT 44100,
    bitrate INTEGER DEFAULT 128,        -- kbps

    -- File integrity
    checksum VARCHAR(64),               -- SHA-256 hash of combined audio

    -- Recording state
    recording_state VARCHAR(20) DEFAULT 'active', -- active, interrupted, complete, failed
    is_complete BOOLEAN DEFAULT FALSE,
    last_segment_at TIMESTAMP WITH TIME ZONE,
    interrupted_at_segment INTEGER,     -- For recovery of partial recordings
    interrupt_reason VARCHAR(200),

    -- Timestamps
    recording_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    recording_completed_at TIMESTAMP WITH TIME ZONE,

    -- Voice snapshot (preserve voice settings even if voice is later discontinued)
    voice_snapshot JSONB,               -- {voice_id, voice_name, settings, model}

    -- Usage statistics
    play_count INTEGER DEFAULT 0,
    last_played_at TIMESTAMP WITH TIME ZONE,
    total_play_time_seconds FLOAT DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    UNIQUE(story_session_id, path_hash)
);

COMMENT ON TABLE story_recordings IS 'Master recording entries - one per story or CYOA path';
COMMENT ON COLUMN story_recordings.path_hash IS 'SHA-256 of choice sequence for CYOA paths';
COMMENT ON COLUMN story_recordings.voice_snapshot IS 'Preserved voice settings for consistent replay';

-- =============================================================================
-- RECORDING SEGMENTS (Individual scenes within a recording)
-- =============================================================================

CREATE TABLE IF NOT EXISTS recording_segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES story_recordings(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE SET NULL,

    -- Ordering within recording
    sequence_index INTEGER NOT NULL,

    -- Audio file data
    audio_url VARCHAR(500) NOT NULL,    -- Path like /audio/recordings/{session}/{segment}.mp3
    audio_hash VARCHAR(64),             -- MD5 for quick lookup
    file_checksum VARCHAR(64),          -- SHA-256 for integrity validation
    file_size_bytes INTEGER,

    -- Timing
    start_time_seconds FLOAT NOT NULL,  -- Position in full recording
    duration_seconds FLOAT NOT NULL,

    -- *** KARAOKE / READ-ALONG WORD TIMING ***
    word_timings JSONB,
    -- Format: {
    --   words: [{text, start_ms, end_ms, duration_ms, char_start_index, char_end_index}],
    --   total_duration_ms: number,
    --   word_count: number
    -- }

    -- Multi-voice support (future: different voices for dialogue)
    voice_segments JSONB,               -- [{speaker, voice_id, start_ms, end_ms}]

    -- Content for display (cached from scene)
    scene_text TEXT,
    scene_summary VARCHAR(500),

    -- Visual sync for picture books
    image_url VARCHAR(500),
    visual_timeline JSONB,
    -- Format: [{image_url, start_sec, duration_sec, transition: 'fade'|'slide'|'none'}]

    -- *** SFX TIMING DATA ***
    sfx_data JSONB NOT NULL DEFAULT '[]',
    -- Format: [{
    --   sfx_id: string,
    --   sfx_key: 'weather.rain_light',
    --   audio_url: '/audio/sfx/HASH.mp3',
    --   trigger_at_seconds: 0,
    --   fade_in_ms: 2000,
    --   fade_out_ms: 2000,
    --   duration_seconds: 15,
    --   volume: 0.3,
    --   loop: boolean,
    --   keyword: string,
    --   reason: string
    -- }]

    -- CYOA choices at end of this segment (if any)
    choices_at_end JSONB,               -- [{key, text, description}]
    selected_choice_key VARCHAR(10),    -- Which choice was selected after this segment
    has_recording_for_choice JSONB DEFAULT '{}', -- {A: true, B: false, C: true}

    -- Scene metadata
    mood VARCHAR(50),
    chapter_number INTEGER,
    chapter_title VARCHAR(200),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(recording_id, sequence_index)
);

COMMENT ON TABLE recording_segments IS 'Individual audio segments with word timing for karaoke';
COMMENT ON COLUMN recording_segments.word_timings IS 'Word-level timestamps from ElevenLabs for Read Along feature';
COMMENT ON COLUMN recording_segments.sfx_data IS 'SFX playback data with timing for recorded replay';

-- =============================================================================
-- BRANCH NODES (Tree structure for CYOA divergence support)
-- =============================================================================

CREATE TABLE IF NOT EXISTS branch_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,

    -- Position in tree
    parent_node_id UUID REFERENCES branch_nodes(id) ON DELETE CASCADE,
    depth INTEGER NOT NULL DEFAULT 0,   -- 0 = root

    -- Scene reference
    scene_id UUID REFERENCES story_scenes(id) ON DELETE SET NULL,
    scene_index INTEGER NOT NULL,

    -- Choice that led to this node
    choice_key VARCHAR(10),             -- A, B, C, D (NULL for root)
    choice_text TEXT,                   -- Full text of choice made

    -- Path identification
    path_signature VARCHAR(500) NOT NULL,  -- "A-B-C" format
    path_hash VARCHAR(64) NOT NULL,     -- SHA-256 of path_signature

    -- Audio data (duplicated for quick access in tree traversal)
    audio_url VARCHAR(500),
    audio_hash VARCHAR(64),
    audio_duration_seconds FLOAT,
    word_timings JSONB,                 -- Same format as recording_segments

    -- Content
    scene_text TEXT,
    available_choices JSONB,            -- [{key, text, description}]
    has_recording_for_choice JSONB DEFAULT '{}', -- {A: true, B: false}

    -- Visual/SFX
    image_url VARCHAR(500),
    visual_timeline JSONB,
    sfx_data JSONB DEFAULT '[]',

    -- Flags
    is_ending BOOLEAN DEFAULT FALSE,    -- Terminal node (story end)
    is_recorded BOOLEAN DEFAULT FALSE,  -- Has audio recorded
    is_playable BOOLEAN DEFAULT FALSE,  -- Ready for playback

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(story_session_id, path_hash)
);

COMMENT ON TABLE branch_nodes IS 'Tree structure for CYOA paths enabling mid-story divergence';
COMMENT ON COLUMN branch_nodes.path_signature IS 'Human-readable path like "A-B-C"';
COMMENT ON COLUMN branch_nodes.has_recording_for_choice IS 'Map of which choices have recordings';

-- =============================================================================
-- WORD ALIGNMENTS CACHE (Reusable timing data)
-- =============================================================================

CREATE TABLE IF NOT EXISTS word_alignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audio_hash VARCHAR(64) NOT NULL,    -- Links to specific audio generation
    voice_id VARCHAR(100),

    -- Original text
    original_text TEXT,
    text_length INTEGER,

    -- Character-level data from ElevenLabs
    characters TEXT[],
    character_start_times_ms INTEGER[],
    character_end_times_ms INTEGER[],

    -- Word-level aggregated data (processed from characters)
    words JSONB,                        -- [{text, start_ms, end_ms, duration_ms}]
    total_duration_ms INTEGER,
    word_count INTEGER,

    -- Processing metadata
    model_used VARCHAR(50),             -- eleven_multilingual_v2, etc.
    processing_version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(audio_hash, voice_id)
);

COMMENT ON TABLE word_alignments IS 'Cached word-level timing from ElevenLabs for karaoke';

-- =============================================================================
-- PLAYBACK SESSIONS (Track current playback state)
-- =============================================================================

CREATE TABLE IF NOT EXISTS playback_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES story_recordings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Playback state
    current_segment_index INTEGER DEFAULT 0,
    current_position_seconds FLOAT DEFAULT 0,
    playback_speed FLOAT DEFAULT 1.0,

    -- Read Along settings
    read_along_enabled BOOLEAN DEFAULT FALSE,
    fullscreen_enabled BOOLEAN DEFAULT FALSE,

    -- SFX settings during playback
    sfx_enabled BOOLEAN DEFAULT TRUE,
    sfx_volume FLOAT DEFAULT 0.3,

    -- Session tracking
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,

    -- For CYOA - track which path we're playing
    current_path_hash VARCHAR(64),
    divergence_point_segment INTEGER,   -- Segment where user diverged from recording

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE playback_sessions IS 'Tracks current playback state for resume functionality';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Story recordings lookups
CREATE INDEX IF NOT EXISTS idx_story_recordings_session ON story_recordings(story_session_id);
CREATE INDEX IF NOT EXISTS idx_story_recordings_path ON story_recordings(story_session_id, path_hash);
CREATE INDEX IF NOT EXISTS idx_story_recordings_state ON story_recordings(recording_state);
CREATE INDEX IF NOT EXISTS idx_story_recordings_complete ON story_recordings(story_session_id, is_complete);

-- Recording segments
CREATE INDEX IF NOT EXISTS idx_recording_segments_recording ON recording_segments(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_segments_order ON recording_segments(recording_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_recording_segments_scene ON recording_segments(scene_id);

-- Branch nodes
CREATE INDEX IF NOT EXISTS idx_branch_nodes_session ON branch_nodes(story_session_id);
CREATE INDEX IF NOT EXISTS idx_branch_nodes_path ON branch_nodes(story_session_id, path_hash);
CREATE INDEX IF NOT EXISTS idx_branch_nodes_parent ON branch_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_branch_nodes_recorded ON branch_nodes(story_session_id, is_recorded);

-- Word alignments
CREATE INDEX IF NOT EXISTS idx_word_alignments_hash ON word_alignments(audio_hash);
CREATE INDEX IF NOT EXISTS idx_word_alignments_voice ON word_alignments(voice_id);

-- Playback sessions
CREATE INDEX IF NOT EXISTS idx_playback_sessions_recording ON playback_sessions(recording_id);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_user ON playback_sessions(user_id);

-- =============================================================================
-- ALTER EXISTING TABLES
-- =============================================================================

-- Add recording-related columns to story_sessions
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS has_recording BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recording_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS has_branch_recordings BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_recording_id UUID REFERENCES story_recordings(id) ON DELETE SET NULL;

-- Add word timing reference to audio_cache (for karaoke on cached TTS)
ALTER TABLE audio_cache
ADD COLUMN IF NOT EXISTS word_alignment_id UUID REFERENCES word_alignments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS has_timestamps BOOLEAN DEFAULT FALSE;

-- Add recording segment reference to story_scenes
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS recording_segment_id UUID REFERENCES recording_segments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_recorded BOOLEAN DEFAULT FALSE;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update story_sessions recording flags when recording completes
CREATE OR REPLACE FUNCTION update_session_recording_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_complete = true AND (OLD.is_complete = false OR OLD.is_complete IS NULL) THEN
        UPDATE story_sessions
        SET has_recording = true,
            recording_count = (
                SELECT COUNT(*) FROM story_recordings
                WHERE story_session_id = NEW.story_session_id AND is_complete = true
            ),
            has_branch_recordings = (
                SELECT COUNT(*) > 1 FROM story_recordings
                WHERE story_session_id = NEW.story_session_id AND is_complete = true
            ),
            last_recording_id = NEW.id,
            updated_at = NOW()
        WHERE id = NEW.story_session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_session_recording ON story_recordings;
CREATE TRIGGER trigger_update_session_recording
AFTER UPDATE ON story_recordings
FOR EACH ROW EXECUTE FUNCTION update_session_recording_status();

-- Update recording duration when segments are added
CREATE OR REPLACE FUNCTION update_recording_duration()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE story_recordings
    SET total_duration_seconds = (
            SELECT COALESCE(SUM(duration_seconds), 0)
            FROM recording_segments
            WHERE recording_id = NEW.recording_id
        ),
        scene_count = (
            SELECT COUNT(*)
            FROM recording_segments
            WHERE recording_id = NEW.recording_id
        ),
        last_segment_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.recording_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_recording_duration ON recording_segments;
CREATE TRIGGER trigger_update_recording_duration
AFTER INSERT OR UPDATE ON recording_segments
FOR EACH ROW EXECUTE FUNCTION update_recording_duration();

-- Update play count when playback completes
CREATE OR REPLACE FUNCTION update_recording_play_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
        UPDATE story_recordings
        SET play_count = play_count + 1,
            last_played_at = NOW(),
            total_play_time_seconds = total_play_time_seconds +
                COALESCE(NEW.current_position_seconds, 0)
        WHERE id = NEW.recording_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_play_stats ON playback_sessions;
CREATE TRIGGER trigger_update_play_stats
AFTER UPDATE ON playback_sessions
FOR EACH ROW EXECUTE FUNCTION update_recording_play_stats();

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to find longest matching path prefix for CYOA
CREATE OR REPLACE FUNCTION find_longest_path_match(
    p_session_id UUID,
    p_target_path TEXT
) RETURNS TABLE (
    recording_id UUID,
    path_signature TEXT,
    matched_depth INTEGER,
    is_exact_match BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sr.id as recording_id,
        sr.choice_sequence as path_signature,
        COALESCE(array_length(string_to_array(sr.choice_sequence, '-'), 1), 0) as matched_depth,
        (sr.choice_sequence = p_target_path) as is_exact_match
    FROM story_recordings sr
    WHERE sr.story_session_id = p_session_id
      AND sr.is_complete = true
      AND (
          p_target_path LIKE sr.choice_sequence || '-%'
          OR p_target_path = sr.choice_sequence
          OR sr.choice_sequence IS NULL  -- Linear story (matches all paths)
      )
    ORDER BY matched_depth DESC NULLS LAST
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_longest_path_match IS 'Find the longest recorded path prefix for CYOA divergence';

-- Function to check if a choice has a recording
CREATE OR REPLACE FUNCTION has_recording_for_choice(
    p_session_id UUID,
    p_current_path TEXT,
    p_choice_key VARCHAR(10)
) RETURNS BOOLEAN AS $$
DECLARE
    new_path TEXT;
BEGIN
    new_path := CASE
        WHEN p_current_path IS NULL OR p_current_path = ''
        THEN p_choice_key
        ELSE p_current_path || '-' || p_choice_key
    END;

    RETURN EXISTS (
        SELECT 1 FROM story_recordings
        WHERE story_session_id = p_session_id
          AND choice_sequence = new_path
          AND is_complete = true
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION has_recording_for_choice IS 'Check if selecting a choice would lead to a recorded path';

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

-- Add migration record (if migrations table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (5, '005_story_recordings', NOW())
        ON CONFLICT (version) DO NOTHING;
    END IF;
END $$;
