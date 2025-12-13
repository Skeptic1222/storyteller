-- Migration: Add Sound Effects support
-- Version: 004
-- Date: 2024-12-05

-- =============================================================================
-- SFX CACHE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS sfx_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 of prompt + duration + loop
    prompt_preview VARCHAR(200), -- First 200 chars for debugging

    file_path VARCHAR(500) NOT NULL,
    file_size_bytes INTEGER,
    duration_seconds FLOAT,
    is_looping BOOLEAN DEFAULT FALSE,

    access_count INTEGER DEFAULT 1,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sfx_cache_hash ON sfx_cache(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_sfx_cache_accessed ON sfx_cache(last_accessed_at);

COMMENT ON TABLE sfx_cache IS 'Generated sound effect cache to avoid regenerating same content';

-- =============================================================================
-- SCENE SFX TRACKING
-- =============================================================================

-- Track which SFX are used in each scene for playback
CREATE TABLE IF NOT EXISTS scene_sfx (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,
    sfx_key VARCHAR(100) NOT NULL, -- e.g., 'weather.rain_light', 'locations.forest_day'
    sfx_cache_id UUID REFERENCES sfx_cache(id) ON DELETE SET NULL,

    -- Playback settings
    volume FLOAT DEFAULT 0.3, -- 0.0-1.0, lower for background
    start_offset_seconds FLOAT DEFAULT 0, -- When to start playing
    fade_in_seconds FLOAT DEFAULT 2,
    fade_out_seconds FLOAT DEFAULT 2,

    detected_keyword VARCHAR(100), -- What triggered this SFX
    detection_reason TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_sfx_scene ON scene_sfx(scene_id);

-- =============================================================================
-- ADD SFX SETTINGS TO STORY SESSIONS
-- =============================================================================

-- Add SFX enabled flag to config (if not exists in config_json)
-- We'll use config_json.sfx_enabled instead of a column

COMMENT ON TABLE scene_sfx IS 'Sound effects detected and applied to story scenes';
