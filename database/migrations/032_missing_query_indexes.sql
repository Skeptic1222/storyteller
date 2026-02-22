-- Migration 032: Missing indexes for common query patterns
-- Identified in code review 2026-02-22
-- conversation_turns and story_choices are high-traffic tables missing session indexes

-- Index for conversation_turns by session (orchestrator reads full history per session)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_turns_session
  ON conversation_turns(story_session_id);

-- Index for story_choices by session + selection status (choice history query in stories.js)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_story_choices_session_selected
  ON story_choices(story_session_id, was_selected);

-- Index for story_bible_sessions by session (used in generate-outline)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_story_bible_sessions_session
  ON story_bible_sessions(story_session_id);

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES ('032', '032_missing_query_indexes.sql')
ON CONFLICT DO NOTHING;
