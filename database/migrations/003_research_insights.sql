-- Migration: 003_research_insights.sql
-- Add columns for research-based enhancements:
-- - Story Bible persistence
-- - Context summarization for long sessions
-- - Lorebook tags for keyword triggers

-- Add story bible JSON column to story_outlines
ALTER TABLE story_outlines
ADD COLUMN IF NOT EXISTS bible_json JSONB DEFAULT NULL;

COMMENT ON COLUMN story_outlines.bible_json IS 'Persistent story knowledge base with world rules, character facts, events';

-- Add context summary column to story_sessions
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS context_summary TEXT DEFAULT NULL;

COMMENT ON COLUMN story_sessions.context_summary IS 'Compressed context summary for long sessions (token management)';

-- Add tags column to lore_entries for keyword triggers
ALTER TABLE lore_entries
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN lore_entries.tags IS 'Keyword tags that trigger this entry to be injected into context';

-- Create index on lore_entries tags for faster lookups
CREATE INDEX IF NOT EXISTS idx_lore_entries_tags ON lore_entries USING GIN (tags);

-- Create index on story_sessions for context summary (to quickly find sessions needing summarization)
CREATE INDEX IF NOT EXISTS idx_story_sessions_status_scenes
ON story_sessions (current_status, total_scenes)
WHERE current_status = 'narrating' AND total_scenes > 5;

-- Add complexity tracking to story_scenes
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS complexity_score DECIMAL(3,2) DEFAULT NULL;

COMMENT ON COLUMN story_scenes.complexity_score IS 'Scene complexity (0-1) used for thinking budget allocation';

-- Update existing lore_entries to have empty tags array if null
UPDATE lore_entries SET tags = '{}' WHERE tags IS NULL;
