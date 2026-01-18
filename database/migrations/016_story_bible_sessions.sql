-- Migration 016: Story Bible Sessions
-- Stores full Story Bible context for Advanced mode story generation
-- This allows the orchestrator to access all character, location, event, lore data

-- Table to link story sessions to their originating Story Bible data
CREATE TABLE IF NOT EXISTS story_bible_sessions (
    story_session_id UUID PRIMARY KEY REFERENCES story_sessions(id) ON DELETE CASCADE,
    library_id UUID REFERENCES user_libraries(id) ON DELETE SET NULL,
    synopsis_id UUID REFERENCES library_synopsis(id) ON DELETE SET NULL,
    full_context JSONB NOT NULL, -- Contains ALL Story Bible data (characters, locations, events, etc.)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for looking up by library_id (useful for finding all stories from a Story Bible)
CREATE INDEX IF NOT EXISTS idx_story_bible_sessions_library ON story_bible_sessions(library_id);

-- Index for looking up by synopsis_id
CREATE INDEX IF NOT EXISTS idx_story_bible_sessions_synopsis ON story_bible_sessions(synopsis_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_story_bible_sessions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_bible_sessions_updated_at ON story_bible_sessions;
CREATE TRIGGER story_bible_sessions_updated_at
    BEFORE UPDATE ON story_bible_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_story_bible_sessions_timestamp();

-- Comment for documentation
COMMENT ON TABLE story_bible_sessions IS 'Links story sessions to their Story Bible source data for Advanced mode generation';
COMMENT ON COLUMN story_bible_sessions.full_context IS 'Full JSONB context: {synopsis, outline, beats, characters, locations, items, factions, lore, events, world}';
