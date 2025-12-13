-- =============================================================================
-- DIALOGUE MAP MIGRATION
-- =============================================================================
-- Adds dialogue_map JSONB column to story_scenes for storing pre-computed
-- speaker attribution from the Dialogue Tagging Agent
-- Run: psql -U postgres -d storyteller_db -f 012_dialogue_map.sql
-- Date: 2025-12-09

-- =============================================================================
-- 1. ADD DIALOGUE_MAP COLUMN TO STORY_SCENES
-- =============================================================================

-- Add dialogue_map column to store pre-computed dialogue attributions
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS dialogue_map JSONB DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN story_scenes.dialogue_map IS 'Pre-computed dialogue attributions from DialogueTaggingAgent. Format: [{quote, speaker, emotion, delivery, start_char, end_char, confidence, reasoning}]';

-- =============================================================================
-- 2. ADD INDEX FOR EFFICIENT LOOKUP
-- =============================================================================

-- Index for checking if dialogue_map exists (common query pattern)
CREATE INDEX IF NOT EXISTS idx_story_scenes_has_dialogue_map
ON story_scenes ((dialogue_map IS NOT NULL))
WHERE dialogue_map IS NOT NULL;

-- =============================================================================
-- 3. ADD DIALOGUE_TAGGING_STATUS COLUMN
-- =============================================================================

-- Track the status of dialogue tagging for each scene
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS dialogue_tagging_status VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN story_scenes.dialogue_tagging_status IS 'Status of dialogue tagging: pending, completed, failed, skipped (no dialogue)';

-- Index for finding scenes that need tagging
CREATE INDEX IF NOT EXISTS idx_story_scenes_tagging_status
ON story_scenes (dialogue_tagging_status)
WHERE dialogue_tagging_status IS NOT NULL;

-- =============================================================================
-- 4. ADD TAGGING ERROR LOG
-- =============================================================================

-- Store any tagging errors for debugging
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS dialogue_tagging_error TEXT DEFAULT NULL;

COMMENT ON COLUMN story_scenes.dialogue_tagging_error IS 'Error message if dialogue tagging failed';

-- =============================================================================
-- 5. VERIFY CHANGES
-- =============================================================================

-- Verify the columns were added
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'dialogue_map'
    ) THEN
        RAISE EXCEPTION 'dialogue_map column was not created';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'dialogue_tagging_status'
    ) THEN
        RAISE EXCEPTION 'dialogue_tagging_status column was not created';
    END IF;

    RAISE NOTICE 'Dialogue map migration completed successfully';
END $$;
