-- =============================================================================
-- VOICE SYSTEM UPGRADE MIGRATION
-- =============================================================================
-- Extends the voice system for dynamic voice catalog and archetype-based selection
-- Run: psql -U postgres -d storyteller_db -f 011_voice_system_upgrade.sql
-- Date: 2025-12-08

-- =============================================================================
-- 1. EXTEND ELEVENLABS_VOICES TABLE
-- =============================================================================

-- Add new columns for enhanced voice metadata
ALTER TABLE elevenlabs_voices
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'default',
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS language_codes TEXT[] DEFAULT ARRAY['en'],
ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS energy_level VARCHAR(20) DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS is_narrator_suitable BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS is_character_suitable BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS can_be_child BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pitch_hint VARCHAR(20) DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS warmth INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS clarity INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS emotion_range INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS model_preferences TEXT[] DEFAULT ARRAY['eleven_multilingual_v2'],
ADD COLUMN IF NOT EXISTS cost_tier VARCHAR(20) DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS voice_library_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS shared_voice_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS sample_audio_duration_seconds FLOAT,
ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_synced BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sync_error TEXT;

-- Add comment for source field
COMMENT ON COLUMN elevenlabs_voices.source IS 'Voice source: default, library, cloned, designed, community';

-- Add comment for tags field
COMMENT ON COLUMN elevenlabs_voices.tags IS 'Array of trait tags: hero, villain, young, old, british, american, etc.';

-- Add comment for energy_level field
COMMENT ON COLUMN elevenlabs_voices.energy_level IS 'Voice energy: low, medium, high';

-- Add comment for pitch_hint field
COMMENT ON COLUMN elevenlabs_voices.pitch_hint IS 'Pitch range: very_low, low, medium, high, very_high';

-- Add comment for cost_tier field
COMMENT ON COLUMN elevenlabs_voices.cost_tier IS 'Cost tier for model selection: premium, standard, economy';

-- =============================================================================
-- 2. VOICE ARCHETYPES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_archetypes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Selection criteria (stored as JSONB for flexibility)
    selection_criteria JSONB NOT NULL DEFAULT '{}',
    -- Example: {"gender": "male", "tags": ["hero", "young"], "energy_level": "high", "age_group": "young_adult"}

    -- Pool configuration
    min_voices INTEGER DEFAULT 3,
    max_per_story INTEGER DEFAULT 2,
    priority INTEGER DEFAULT 50,

    -- Fallback chain (ordered list of archetype names to try if this pool is exhausted)
    fallback_archetypes TEXT[] DEFAULT '{}',

    -- Role hints (what character roles this archetype suits)
    suitable_roles TEXT[] DEFAULT '{}',
    -- Example: ['protagonist', 'hero', 'warrior', 'knight']

    -- Genre preferences (higher = better match)
    genre_scores JSONB DEFAULT '{}',
    -- Example: {"fantasy": 90, "scifi": 70, "romance": 40}

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for archetype lookups
CREATE INDEX IF NOT EXISTS idx_voice_archetypes_active ON voice_archetypes(is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_voice_archetypes_name ON voice_archetypes(name);

-- =============================================================================
-- 3. VOICE ASSIGNMENTS TABLE (Track per-story assignments)
-- =============================================================================

CREATE TABLE IF NOT EXISTS story_voice_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    character_id UUID REFERENCES characters(id) ON DELETE CASCADE,

    voice_id VARCHAR(100) REFERENCES elevenlabs_voices(voice_id) ON DELETE SET NULL,
    archetype_used VARCHAR(50),

    -- Assignment metadata
    gender_inferred VARCHAR(20),
    gender_confidence FLOAT DEFAULT 0.5,
    match_reason TEXT,

    -- Voice settings for this assignment
    voice_settings JSONB DEFAULT '{}',
    -- Example: {"stability": 0.5, "similarity_boost": 0.75, "style": 0.3}

    -- Performance metrics
    segments_generated INTEGER DEFAULT 0,
    total_characters INTEGER DEFAULT 0,

    is_narrator BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(story_session_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_assignments_session ON story_voice_assignments(story_session_id);
CREATE INDEX IF NOT EXISTS idx_voice_assignments_voice ON story_voice_assignments(voice_id);

-- =============================================================================
-- 4. VOICE SYNC LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sync_type VARCHAR(50) NOT NULL, -- 'full', 'incremental', 'library', 'shared'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Results
    voices_added INTEGER DEFAULT 0,
    voices_updated INTEGER DEFAULT 0,
    voices_deactivated INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    errors_detail JSONB DEFAULT '[]',

    status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'failed'
    triggered_by VARCHAR(50) DEFAULT 'manual' -- 'manual', 'cron', 'startup'
);

CREATE INDEX IF NOT EXISTS idx_voice_sync_log_status ON voice_sync_log(status, started_at DESC);

-- =============================================================================
-- 5. QUALITY TIER CONFIGURATION TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_quality_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Model selection rules
    narrator_model VARCHAR(50) DEFAULT 'eleven_multilingual_v2',
    main_character_model VARCHAR(50) DEFAULT 'eleven_multilingual_v2',
    minor_character_model VARCHAR(50) DEFAULT 'eleven_turbo_v2_5',
    background_model VARCHAR(50) DEFAULT 'eleven_flash_v2_5',

    -- Cost multiplier relative to base
    cost_multiplier FLOAT DEFAULT 1.0,

    -- Quality characteristics
    max_latency_ms INTEGER DEFAULT 5000,
    audio_quality VARCHAR(20) DEFAULT 'high', -- 'high', 'standard', 'low'

    -- Feature flags
    enable_streaming BOOLEAN DEFAULT FALSE,
    enable_timestamps BOOLEAN DEFAULT TRUE,
    enable_crossfade BOOLEAN DEFAULT TRUE,
    crossfade_ms INTEGER DEFAULT 75,

    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure only one default tier
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_quality_tiers_default
ON voice_quality_tiers(is_default) WHERE is_default = TRUE;

-- =============================================================================
-- 6. SEED DEFAULT ARCHETYPES
-- =============================================================================

INSERT INTO voice_archetypes (name, display_name, description, selection_criteria, suitable_roles, fallback_archetypes, genre_scores) VALUES

-- Male archetypes
('male_hero', 'Male Hero', 'Heroic, confident male voices for protagonists and heroes',
 '{"gender": "male", "tags": ["hero", "heroic", "confident", "brave"], "energy_level": ["medium", "high"], "age_group": ["young_adult", "adult"]}',
 ARRAY['protagonist', 'hero', 'warrior', 'knight', 'prince'],
 ARRAY['male_young', 'male_elder', 'male_comic'],
 '{"fantasy": 90, "adventure": 95, "scifi": 80, "romance": 60, "mystery": 50, "horror": 40}'),

('male_villain', 'Male Villain', 'Dark, menacing male voices for antagonists',
 '{"gender": "male", "tags": ["villain", "dark", "menacing", "sinister", "threatening"], "energy_level": ["medium", "low"]}',
 ARRAY['antagonist', 'villain', 'dark_lord', 'warlock', 'evil'],
 ARRAY['creature', 'male_elder'],
 '{"fantasy": 85, "horror": 95, "thriller": 90, "mystery": 80, "adventure": 60}'),

('male_elder', 'Male Elder', 'Wise, warm male voices for mentors and elders',
 '{"gender": "male", "tags": ["wise", "elder", "grandfather", "mentor", "sage"], "age_group": ["adult", "elderly"], "energy_level": ["low", "medium"]}',
 ARRAY['mentor', 'wizard', 'sage', 'king', 'grandfather', 'narrator'],
 ARRAY['male_hero', 'male_villain'],
 '{"fantasy": 95, "mystery": 80, "adventure": 75, "romance": 60, "horror": 50}'),

('male_comic', 'Male Comic', 'Witty, expressive male voices for comic relief',
 '{"gender": "male", "tags": ["comic", "funny", "witty", "expressive", "trickster"], "energy_level": ["medium", "high"]}',
 ARRAY['sidekick', 'jester', 'bard', 'trickster', 'innkeeper'],
 ARRAY['male_young', 'male_hero'],
 '{"comedy": 95, "adventure": 80, "fantasy": 75, "romance": 60, "mystery": 50}'),

('male_young', 'Male Young', 'Youthful, energetic male voices for young characters',
 '{"gender": "male", "tags": ["young", "youthful", "boyish", "teen"], "age_group": ["child", "young_adult"], "energy_level": ["medium", "high"]}',
 ARRAY['boy', 'teen', 'apprentice', 'squire', 'young_hero'],
 ARRAY['male_hero', 'male_comic'],
 '{"adventure": 90, "fantasy": 85, "scifi": 75, "comedy": 70, "mystery": 50}'),

-- Female archetypes
('female_hero', 'Female Hero', 'Strong, confident female voices for protagonists',
 '{"gender": "female", "tags": ["hero", "strong", "confident", "elegant"], "energy_level": ["medium", "high"], "age_group": ["young_adult", "adult"]}',
 ARRAY['protagonist', 'heroine', 'warrior', 'princess', 'queen'],
 ARRAY['female_young', 'female_elder'],
 '{"fantasy": 90, "adventure": 95, "scifi": 80, "romance": 75, "mystery": 65}'),

('female_villain', 'Female Villain', 'Seductive, dark female voices for antagonists',
 '{"gender": "female", "tags": ["villain", "seductive", "dark", "menacing", "witch"], "energy_level": ["medium", "low"]}',
 ARRAY['antagonist', 'witch', 'sorceress', 'villainess', 'dark_queen'],
 ARRAY['female_elder', 'creature'],
 '{"fantasy": 85, "horror": 90, "thriller": 85, "mystery": 80, "romance": 60}'),

('female_elder', 'Female Elder', 'Wise, nurturing female voices for mentors',
 '{"gender": "female", "tags": ["wise", "elder", "grandmother", "mentor", "nurturing"], "age_group": ["adult", "elderly"], "energy_level": ["low", "medium"]}',
 ARRAY['mentor', 'grandmother', 'wise_woman', 'queen_mother', 'narrator'],
 ARRAY['female_hero', 'female_young'],
 '{"fantasy": 90, "romance": 80, "mystery": 70, "adventure": 65, "horror": 40}'),

('female_comic', 'Female Comic', 'Animated, playful female voices for comic characters',
 '{"gender": "female", "tags": ["comic", "funny", "animated", "playful", "quirky"], "energy_level": ["medium", "high"]}',
 ARRAY['sidekick', 'fairy', 'sprite', 'companion', 'barmaid'],
 ARRAY['female_young', 'female_hero'],
 '{"comedy": 95, "adventure": 80, "fantasy": 85, "romance": 70, "mystery": 40}'),

('female_young', 'Female Young', 'Youthful, bright female voices for young characters',
 '{"gender": "female", "tags": ["young", "youthful", "bright", "teen", "girl"], "age_group": ["child", "young_adult"], "energy_level": ["medium", "high"]}',
 ARRAY['girl', 'teen', 'princess_young', 'apprentice', 'young_heroine'],
 ARRAY['female_hero', 'child'],
 '{"adventure": 90, "fantasy": 90, "comedy": 80, "romance": 65, "mystery": 50}'),

-- Special archetypes
('creature', 'Creature/Monster', 'Otherworldly, inhuman voices for creatures and monsters',
 '{"tags": ["creature", "monster", "otherworldly", "inhuman", "gravelly", "raspy"]}',
 ARRAY['dragon', 'demon', 'monster', 'beast', 'alien', 'spirit', 'ghost'],
 ARRAY['male_villain', 'female_villain'],
 '{"fantasy": 95, "horror": 95, "scifi": 85, "adventure": 70, "mystery": 60}'),

('child', 'Child', 'Childlike, innocent voices for young characters',
 '{"tags": ["child", "childlike", "innocent", "young"], "age_group": ["child"], "can_be_child": true}',
 ARRAY['child', 'boy', 'girl', 'fairy', 'sprite', 'young_creature'],
 ARRAY['female_young', 'male_young'],
 '{"children": 100, "fantasy": 85, "adventure": 80, "comedy": 90, "bedtime": 95}')

ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    selection_criteria = EXCLUDED.selection_criteria,
    suitable_roles = EXCLUDED.suitable_roles,
    fallback_archetypes = EXCLUDED.fallback_archetypes,
    genre_scores = EXCLUDED.genre_scores,
    updated_at = NOW();

-- =============================================================================
-- 7. SEED DEFAULT QUALITY TIERS
-- =============================================================================

INSERT INTO voice_quality_tiers (name, display_name, description, narrator_model, main_character_model, minor_character_model, background_model, cost_multiplier, enable_streaming, enable_timestamps, enable_crossfade, crossfade_ms, is_default, sort_order) VALUES

('premium', 'Premium Quality', 'Highest quality, best emotional range, all features enabled',
 'eleven_multilingual_v2', 'eleven_multilingual_v2', 'eleven_multilingual_v2', 'eleven_turbo_v2_5',
 1.5, TRUE, TRUE, TRUE, 100, FALSE, 10),

('standard', 'Standard Quality', 'Balanced quality and cost, good for most stories',
 'eleven_multilingual_v2', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5',
 1.0, FALSE, TRUE, TRUE, 75, TRUE, 20),

('economy', 'Economy Mode', 'Faster generation, lower cost, good for longer stories',
 'eleven_turbo_v2_5', 'eleven_turbo_v2_5', 'eleven_flash_v2_5', 'eleven_flash_v2_5',
 0.6, FALSE, FALSE, TRUE, 50, FALSE, 30),

('fast', 'Fast Mode', 'Lowest latency, streaming enabled, real-time feel',
 'eleven_flash_v2_5', 'eleven_flash_v2_5', 'eleven_flash_v2_5', 'eleven_flash_v2_5',
 0.4, TRUE, FALSE, FALSE, 0, FALSE, 40)

ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    narrator_model = EXCLUDED.narrator_model,
    main_character_model = EXCLUDED.main_character_model,
    minor_character_model = EXCLUDED.minor_character_model,
    background_model = EXCLUDED.background_model,
    cost_multiplier = EXCLUDED.cost_multiplier,
    enable_streaming = EXCLUDED.enable_streaming,
    enable_timestamps = EXCLUDED.enable_timestamps,
    enable_crossfade = EXCLUDED.enable_crossfade,
    crossfade_ms = EXCLUDED.crossfade_ms;

-- =============================================================================
-- 8. UPDATE ELEVENLABS_VOICES WITH TAGS FOR EXISTING VOICES
-- =============================================================================

-- Update existing voices with appropriate tags based on their names and styles
UPDATE elevenlabs_voices SET
    tags = CASE
        WHEN name IN ('George', 'Brian', 'Adam') THEN ARRAY['narrator', 'warm', 'elder', 'storyteller']
        WHEN name IN ('Daniel', 'Arnold') THEN ARRAY['hero', 'authoritative', 'confident']
        WHEN name IN ('Callum', 'Sam') THEN ARRAY['villain', 'dark', 'gravelly', 'mysterious']
        WHEN name IN ('Josh', 'Ethan', 'Charlie') THEN ARRAY['young', 'energetic', 'friendly']
        WHEN name IN ('Dave', 'Eric') THEN ARRAY['comic', 'conversational', 'witty']
        WHEN name IN ('Bella', 'Dorothy', 'Matilda') THEN ARRAY['warm', 'nurturing', 'storyteller', 'bedtime']
        WHEN name IN ('Lily', 'Laura', 'Elli') THEN ARRAY['hero', 'strong', 'confident']
        WHEN name IN ('Charlotte', 'Emily') THEN ARRAY['villain', 'seductive', 'mysterious']
        WHEN name IN ('Gigi', 'Rachel', 'Domi') THEN ARRAY['young', 'energetic', 'playful']
        ELSE ARRAY['general']
    END,
    is_narrator_suitable = CASE
        WHEN name IN ('George', 'Brian', 'Adam', 'Daniel', 'Bella', 'Dorothy', 'Matilda', 'Lily') THEN TRUE
        ELSE FALSE
    END,
    is_character_suitable = TRUE,
    can_be_child = CASE
        WHEN name IN ('Matilda', 'Domi', 'Rachel', 'Gigi') THEN TRUE
        ELSE FALSE
    END,
    energy_level = CASE
        WHEN name IN ('Callum', 'Sam', 'Dorothy', 'Bella') THEN 'low'
        WHEN name IN ('Josh', 'Ethan', 'Gigi', 'Rachel', 'Charlie', 'Patrick') THEN 'high'
        ELSE 'medium'
    END
WHERE tags = '{}' OR tags IS NULL;

-- =============================================================================
-- 9. CREATE INDEXES FOR NEW COLUMNS
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_source ON elevenlabs_voices(source);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_tags ON elevenlabs_voices USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_gender ON elevenlabs_voices(gender);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_narrator ON elevenlabs_voices(is_narrator_suitable) WHERE is_narrator_suitable = TRUE;
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_character ON elevenlabs_voices(is_character_suitable) WHERE is_character_suitable = TRUE;
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_energy ON elevenlabs_voices(energy_level);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_voices_available ON elevenlabs_voices(is_available) WHERE is_available = TRUE;

-- =============================================================================
-- 10. ADD UPDATE TRIGGER FOR VOICE USAGE
-- =============================================================================

CREATE OR REPLACE FUNCTION update_voice_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE elevenlabs_voices
    SET usage_count = usage_count + 1,
        last_used_at = NOW()
    WHERE voice_id = NEW.voice_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_voice_usage ON story_voice_assignments;
CREATE TRIGGER trigger_update_voice_usage
AFTER INSERT ON story_voice_assignments
FOR EACH ROW EXECUTE FUNCTION update_voice_usage();

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE voice_archetypes IS 'Voice archetype definitions for intelligent character voice matching';
COMMENT ON TABLE story_voice_assignments IS 'Per-story voice assignments tracking which voice is used for each character';
COMMENT ON TABLE voice_sync_log IS 'Log of voice synchronization operations from ElevenLabs';
COMMENT ON TABLE voice_quality_tiers IS 'Quality tier configurations controlling model selection and features';
