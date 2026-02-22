-- Migration 031: Missing indexes for common query patterns + agent_prompts table
-- Fixes identified in code review 2026-02-19

-- Index for story_choices by scene_id (used in library detail scene fetch)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_story_choices_scene_id
  ON story_choices(scene_id);

-- Composite index for recording_segments (used in library detail LEFT JOIN)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recording_segments_scene_recording
  ON recording_segments(scene_id, recording_id);

-- Index for scene_sfx FK join column
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scene_sfx_cache_id
  ON scene_sfx(sfx_cache_id);

-- Composite index for scene_voice_directions batch fetch
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scene_voice_dirs_session_status
  ON scene_voice_directions(story_session_id, audio_status);

-- Create agent_prompts table if not exists (was only in schema.sql, missing from migrations)
-- Migration 030 inserts into this table but never creates it
-- Must include ALL columns that 030 references (description, model, temperature, max_tokens)
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

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES ('031', '031_missing_indexes_and_agent_prompts.sql')
ON CONFLICT DO NOTHING;
