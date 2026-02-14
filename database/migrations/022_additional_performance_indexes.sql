-- =============================================================================
-- MIGRATION 022: Additional Performance Indexes (schema-drift safe)
-- =============================================================================
-- This migration intentionally checks table/column existence before creating
-- each index so it can run safely across legacy and current schemas.

DO $$
BEGIN
  -- story_sessions status index (supports either current_status or status)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'current_status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_sessions_status ON story_sessions(current_status)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_sessions_status ON story_sessions(status)';
  END IF;

  -- user activity ordering in library/dashboard
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'last_activity_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_sessions_user_activity ON story_sessions(user_id, last_activity_at DESC)';
  END IF;

  -- shared/public story listing
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'is_public'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'started_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_sessions_public ON story_sessions(is_public, started_at DESC) WHERE is_public = true';
  END IF;

  -- story_scenes ordering (supports sequence_index; falls back to scene_number)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_scenes' AND column_name = 'story_session_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_scenes' AND column_name = 'sequence_index'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_scenes_session_order ON story_scenes(story_session_id, sequence_index)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_scenes' AND column_name = 'story_session_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_scenes' AND column_name = 'scene_number'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_scenes_session_order ON story_scenes(story_session_id, scene_number)';
  END IF;

  -- characters by session
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'characters' AND column_name = 'story_session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_session_characters_session ON characters(story_session_id)';
  END IF;

  -- character voice assignments by session
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'character_voice_assignments' AND column_name = 'story_session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_character_voices_session ON character_voice_assignments(story_session_id)';
  END IF;

  -- recordings
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_recordings' AND column_name = 'story_session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_recordings_session ON story_recordings(story_session_id)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_recordings' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_recordings' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_story_recordings_user ON story_recordings(user_id, created_at DESC)';
  END IF;

  -- usage period lookups
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_usage' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_usage' AND column_name = 'period_start'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_usage_period ON user_usage(user_id, period_start)';
  END IF;

  -- lore entries by session
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lore_entries' AND column_name = 'story_session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lore_entries_session ON lore_entries(story_session_id)';
  END IF;

  -- SFX by scene (scene_sfx in current schema)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scene_sfx' AND column_name = 'scene_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_scene_sfx_scene ON scene_sfx(scene_id)';
  END IF;

  -- subscription lookups
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_subscriptions' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_subscriptions' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON user_subscriptions(user_id, status)';
  END IF;

  -- finished/completed sessions archive index
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'current_status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'ended_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_finished_sessions ON story_sessions(user_id, ended_at DESC) WHERE current_status = ''finished''';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'ended_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_sessions' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_finished_sessions ON story_sessions(user_id, ended_at DESC) WHERE status = ''completed''';
  END IF;
END $$;

-- Refresh stats on known tables if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'story_sessions') THEN
    EXECUTE 'ANALYZE story_sessions';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'story_scenes') THEN
    EXECUTE 'ANALYZE story_scenes';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'characters') THEN
    EXECUTE 'ANALYZE characters';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'character_voice_assignments') THEN
    EXECUTE 'ANALYZE character_voice_assignments';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'story_recordings') THEN
    EXECUTE 'ANALYZE story_recordings';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_usage') THEN
    EXECUTE 'ANALYZE user_usage';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lore_entries') THEN
    EXECUTE 'ANALYZE lore_entries';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scene_sfx') THEN
    EXECUTE 'ANALYZE scene_sfx';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_subscriptions') THEN
    EXECUTE 'ANALYZE user_subscriptions';
  END IF;
END $$;

