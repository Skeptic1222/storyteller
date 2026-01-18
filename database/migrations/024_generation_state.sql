-- Migration 024: Generation State Persistence
-- Created: 2026-01-16
-- Description: Adds columns for tracking generation state to enable recovery after interruptions

-- Add generation state columns to story_sessions
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS generation_state JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS generation_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Index for finding interrupted sessions
CREATE INDEX IF NOT EXISTS idx_story_sessions_generation_state
ON story_sessions(generation_updated_at)
WHERE generation_state IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN story_sessions.generation_state IS 'JSON state for recovering interrupted story generation';
COMMENT ON COLUMN story_sessions.generation_updated_at IS 'Timestamp of last generation state update';

-- Track migration
INSERT INTO schema_migrations (version, name) VALUES ('024', 'generation_state')
ON CONFLICT (version) DO NOTHING;
