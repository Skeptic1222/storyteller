-- =============================================================================
-- TAG-BASED PROSE MIGRATION
-- =============================================================================
-- Adds support for the bulletproof tag-based multi-voice system.
-- Scenes now use [CHAR:Name]dialogue[/CHAR] tags instead of position-based
-- dialogue_map for 100% reliable dialogue extraction.
--
-- Run: psql -U postgres -d storyteller_db -f 014_tag_based_prose.sql
-- Date: 2025-12-12
-- =============================================================================

-- =============================================================================
-- 1. ADD PROSE_FORMAT COLUMN TO STORY_SCENES
-- =============================================================================

-- Indicates whether the scene uses position-based or tag-based prose
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS prose_format VARCHAR(20) DEFAULT 'position_based';

-- Add check constraint for valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'story_scenes_prose_format_check'
    ) THEN
        ALTER TABLE story_scenes
        ADD CONSTRAINT story_scenes_prose_format_check
        CHECK (prose_format IN ('position_based', 'tag_based'));
    END IF;
END $$;

COMMENT ON COLUMN story_scenes.prose_format IS 'Format of dialogue markup: position_based (legacy dialogue_map) or tag_based (inline [CHAR:Name] tags)';

-- =============================================================================
-- 2. ADD TAG_VALIDATION_STATUS COLUMN
-- =============================================================================

-- Track the validation status of tag-based prose
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS tag_validation_status VARCHAR(20) DEFAULT NULL;

-- Add check constraint for valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'story_scenes_tag_validation_status_check'
    ) THEN
        ALTER TABLE story_scenes
        ADD CONSTRAINT story_scenes_tag_validation_status_check
        CHECK (tag_validation_status IN ('pending', 'validated', 'failed', 'legacy', 'na'));
    END IF;
END $$;

COMMENT ON COLUMN story_scenes.tag_validation_status IS 'Tag validation status: pending, validated, failed, legacy (position-based), na (narrator-only)';

-- =============================================================================
-- 3. ADD TAG_VALIDATION_ERRORS COLUMN
-- =============================================================================

-- Store any tag validation errors for debugging
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS tag_validation_errors JSONB DEFAULT NULL;

COMMENT ON COLUMN story_scenes.tag_validation_errors IS 'Array of tag validation errors if any: [{type, message, position}]';

-- =============================================================================
-- 4. ADD SPEAKERS_EXTRACTED COLUMN
-- =============================================================================

-- Store the list of speakers extracted from tags (for quick lookup)
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS speakers_extracted TEXT[] DEFAULT NULL;

COMMENT ON COLUMN story_scenes.speakers_extracted IS 'Array of unique speaker names extracted from [CHAR:Name] tags';

-- =============================================================================
-- 5. ADD INDEXES FOR EFFICIENT QUERIES
-- =============================================================================

-- Index for format queries (find all tag-based or position-based scenes)
CREATE INDEX IF NOT EXISTS idx_story_scenes_prose_format
ON story_scenes (prose_format);

-- Index for validation status queries
CREATE INDEX IF NOT EXISTS idx_story_scenes_tag_validation_status
ON story_scenes (tag_validation_status)
WHERE tag_validation_status IS NOT NULL;

-- =============================================================================
-- 6. MARK EXISTING SCENES AS LEGACY
-- =============================================================================

-- Update all existing scenes to legacy format
UPDATE story_scenes
SET prose_format = 'position_based',
    tag_validation_status = 'legacy'
WHERE prose_format IS NULL
   OR prose_format = 'position_based';

-- =============================================================================
-- 7. ADD STORY_SESSION SETTING FOR TAG-BASED MODE
-- =============================================================================

-- Track whether the session was created with tag-based mode
-- (stored in config_json, no schema change needed - just documentation)

COMMENT ON COLUMN story_sessions.config_json IS 'Session configuration including: multi_voice, hide_speech_tags, tag_based_multivoice (new)';

-- =============================================================================
-- 8. VERIFY CHANGES
-- =============================================================================

DO $$
BEGIN
    -- Verify prose_format column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'prose_format'
    ) THEN
        RAISE EXCEPTION 'prose_format column was not created';
    END IF;

    -- Verify tag_validation_status column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'tag_validation_status'
    ) THEN
        RAISE EXCEPTION 'tag_validation_status column was not created';
    END IF;

    -- Verify tag_validation_errors column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'tag_validation_errors'
    ) THEN
        RAISE EXCEPTION 'tag_validation_errors column was not created';
    END IF;

    -- Verify speakers_extracted column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_scenes' AND column_name = 'speakers_extracted'
    ) THEN
        RAISE EXCEPTION 'speakers_extracted column was not created';
    END IF;

    RAISE NOTICE 'Tag-based prose migration completed successfully';
    RAISE NOTICE 'New columns: prose_format, tag_validation_status, tag_validation_errors, speakers_extracted';
END $$;

-- =============================================================================
-- 9. USAGE NOTES
-- =============================================================================

/*
HOW THE TAG-BASED SYSTEM WORKS:

1. Scene Generation (openai.js):
   - When TAG_BASED_MULTIVOICE=true, scenes are generated with inline tags
   - Example: "The knight said, [CHAR:Roland]Hello there![/CHAR] and smiled."

2. Tag Parsing (tagParser.js):
   - Deterministic regex-based parsing (no LLM needed)
   - Extracts segments: [{type: 'narrator', text: '...'}, {type: 'dialogue', speaker: 'Roland', text: '...'}]

3. Tag Validation (tagValidationAgent.js):
   - Pass 1: Tag balance check (deterministic)
   - Pass 2: Speaker verification (LLM-assisted)
   - Pass 3: Untagged dialogue detection (LLM-assisted)

4. Storage:
   - prose_format = 'tag_based' indicates the text column contains tagged prose
   - dialogue_map is STILL populated (for backwards compatibility) but with tag_based: true flag
   - speakers_extracted stores the extracted speaker names for quick lookup

5. Audio Generation:
   - Segments are created directly from tag parsing (no position calculation)
   - Speech tag filter still runs to remove "he said" phrases from narrator segments

BACKWARDS COMPATIBILITY:
- Existing scenes with prose_format = 'position_based' or 'legacy' continue to use dialogue_map
- New scenes with TAG_BASED_MULTIVOICE=true use tag-based format
- The orchestrator handles both formats transparently

TO ENABLE:
- Set environment variable: TAG_BASED_MULTIVOICE=true (default)
- Or: TAG_BASED_MULTIVOICE=false to revert to position-based mode
*/
