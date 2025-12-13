-- Story Continuation Migration
-- Adds support for story continuations/sequels

-- Add continuation columns to story_sessions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'story_sessions' AND column_name = 'parent_session_id') THEN
        ALTER TABLE story_sessions ADD COLUMN parent_session_id UUID REFERENCES story_sessions(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'story_sessions' AND column_name = 'continuation_number') THEN
        ALTER TABLE story_sessions ADD COLUMN continuation_number INTEGER DEFAULT 0;
    END IF;
END $$;

-- Continuation context table (stores info about the original story for reference)
CREATE TABLE IF NOT EXISTS continuation_context (
    id SERIAL PRIMARY KEY,
    continuation_session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
    original_session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
    original_summary TEXT,
    continuation_idea_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(continuation_session_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON story_sessions(parent_session_id) WHERE parent_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_continuation_context_original ON continuation_context(original_session_id);

COMMENT ON COLUMN story_sessions.parent_session_id IS 'Reference to the original story this continues';
COMMENT ON COLUMN story_sessions.continuation_number IS 'Sequence number in the series (1 = first sequel)';
COMMENT ON TABLE continuation_context IS 'Stores context from original story for continuations';
