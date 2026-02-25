-- Migration 030: Style Score + Voice Directions
-- Phase 3: Author Style Validation scoring column
-- Phase 5: Script Editor voice direction table (added now to avoid a second migration)
--
-- Run with:
--   psql -d storyteller_db -f database/migrations/030_style_score_and_voice_directions.sql

-- ============================================================================
-- Phase 3: Author Style Validation
-- ============================================================================

-- Stores the composite style adherence score (0-100) from authorStyleValidator.
-- NULL means the scene was generated without an author style or has not been scored.
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS style_score INTEGER;

-- ============================================================================
-- Phase 5: Script Editor - Voice Directions
-- ============================================================================

-- Per-segment voice direction table for the Script Editor.
-- Each row represents one TTS segment within a scene: a narrator passage or
-- a character's dialogue line. AI-generated emotion/tag suggestions are stored
-- alongside user overrides so the original analysis is never lost.
CREATE TABLE IF NOT EXISTS scene_voice_directions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    speaker VARCHAR(100) NOT NULL,
    segment_text TEXT NOT NULL,

    -- AI-generated voice direction suggestions
    ai_emotion VARCHAR(50),
    ai_v3_audio_tags TEXT,
    ai_stability FLOAT,
    ai_style FLOAT,
    ai_reasoning TEXT,

    -- User overrides (NULL = use AI suggestion)
    user_emotion VARCHAR(50),
    user_v3_audio_tags TEXT,
    user_stability FLOAT,
    user_style FLOAT,
    user_custom_tags TEXT,

    -- Voice assignment
    voice_id VARCHAR(100),
    voice_name VARCHAR(100),

    -- Audio generation state
    audio_status VARCHAR(20) DEFAULT 'pending',
    audio_url VARCHAR(500),
    audio_duration_ms INTEGER,
    word_timings JSONB,
    char_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each scene has exactly one row per segment index
    UNIQUE(scene_id, segment_index)
);

-- Script editor state on the session (e.g. 'idle', 'editing', 'generating', 'complete')
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS script_editor_state VARCHAR(20);

-- Per-session voice direction preferences (default emotions, stability ranges, etc.)
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS voice_direction_preferences JSONB DEFAULT '{}';

-- ============================================================================
-- Agent Prompt: style_validator
-- ============================================================================

-- Ensure prompt table exists on legacy databases before upserting.
CREATE TABLE IF NOT EXISTS agent_prompts (
  id SERIAL PRIMARY KEY,
  agent_name VARCHAR(100) NOT NULL UNIQUE,
  system_prompt TEXT,
  description TEXT,
  model VARCHAR(50) DEFAULT 'gpt-4o-mini',
  temperature FLOAT DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2000,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- The style_validator agent is used by authorStyleValidator.js for scoring.
-- It is a UTILITY agent (structured JSON output, fast model).
INSERT INTO agent_prompts (agent_name, system_prompt, description, model, temperature, max_tokens)
VALUES (
  'style_validator',
  'You are a literary style analysis agent. You evaluate prose passages and score how well they match a target author''s writing style across six dimensions: sentence_structure, vocabulary, pov_consistency, pacing, tone, and thematic_elements. Each score is 0-100. Always respond with valid JSON only.',
  'Scores author style adherence for generated scenes',
  'gpt-4o-mini',
  0.3,
  500
)
ON CONFLICT (agent_name) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  description = EXCLUDED.description,
  model = EXCLUDED.model,
  temperature = EXCLUDED.temperature,
  max_tokens = EXCLUDED.max_tokens,
  updated_at = NOW();

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup of all voice directions for a session (Script Editor main view)
CREATE INDEX IF NOT EXISTS idx_voice_directions_session
    ON scene_voice_directions(story_session_id);

-- Fast lookup of voice directions for a single scene
CREATE INDEX IF NOT EXISTS idx_voice_directions_scene
    ON scene_voice_directions(scene_id);

-- Filter segments by audio generation status (batch processing)
CREATE INDEX IF NOT EXISTS idx_voice_directions_status
    ON scene_voice_directions(audio_status);
