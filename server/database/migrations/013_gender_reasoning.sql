-- =============================================================================
-- GENDER REASONING MIGRATION
-- =============================================================================
-- Adds gender_reasoning column to characters table for storing LLM's
-- chain-of-thought explanation for gender determination.
-- This supports the LLM-first gender detection system.
-- Run: psql -U postgres -d storyteller_db -f 013_gender_reasoning.sql
-- Date: 2025-12-10

-- =============================================================================
-- 1. ADD GENDER_REASONING COLUMN TO CHARACTERS
-- =============================================================================

-- Add gender_reasoning column to store LLM's chain of thought
ALTER TABLE characters
ADD COLUMN IF NOT EXISTS gender_reasoning TEXT DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN characters.gender_reasoning IS
  'LLM chain-of-thought explanation for gender determination (e.g., "Decided female for protagonist role; will use she/her pronouns")';

-- =============================================================================
-- 2. UPDATE EXISTING NULL GENDERS (BACKFILL)
-- =============================================================================

-- For any characters that somehow got NULL gender, set to 'neutral'
-- This should not happen with the new validation, but handles legacy data
UPDATE characters
SET
  gender = 'neutral',
  gender_confidence = 'backfilled',
  gender_source = 'migration_backfill',
  gender_reasoning = 'Backfilled to neutral during 013_gender_reasoning migration - original gender was NULL'
WHERE gender IS NULL;

-- Log how many were backfilled
DO $$
DECLARE
  backfilled_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfilled_count
  FROM characters
  WHERE gender_source = 'migration_backfill';

  IF backfilled_count > 0 THEN
    RAISE NOTICE 'Backfilled % characters with NULL gender to neutral', backfilled_count;
  ELSE
    RAISE NOTICE 'No characters needed gender backfill';
  END IF;
END $$;

-- =============================================================================
-- 3. ADD INDEX FOR QUERYING BY GENDER SOURCE
-- =============================================================================

-- Index for finding characters by gender determination source
-- Useful for debugging and auditing
CREATE INDEX IF NOT EXISTS idx_characters_gender_source
ON characters (gender_source)
WHERE gender_source IS NOT NULL;

-- =============================================================================
-- 4. VERIFY CHANGES
-- =============================================================================

-- Verify the column was added
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'characters' AND column_name = 'gender_reasoning'
    ) THEN
        RAISE EXCEPTION 'gender_reasoning column was not created';
    END IF;

    RAISE NOTICE 'Gender reasoning migration completed successfully';
END $$;
