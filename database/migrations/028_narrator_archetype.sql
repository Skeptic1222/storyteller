-- =============================================================================
-- MIGRATION 028: Narrator archetype indexes in session config JSON
-- =============================================================================
-- The application persists narrator archetype metadata inside story_sessions.config_json.
-- This migration adds expression indexes for faster lookup/filtering without requiring
-- a separate story_config table.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'story_sessions'
      AND column_name = 'config_json'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_story_sessions_cfg_narrator_archetype
      ON story_sessions ((config_json->>''narrator_archetype''))
      WHERE config_json ? ''narrator_archetype''
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_story_sessions_cfg_archetype_method
      ON story_sessions ((config_json->>''archetype_detection_method''))
      WHERE config_json ? ''archetype_detection_method''
    ';
  END IF;
END $$;

