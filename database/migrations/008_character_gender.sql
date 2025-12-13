-- Migration 008: Add explicit gender field to characters table
-- This addresses the critical gender detection issue where characters like
-- "Commander Elanor Kane" were being mis-gendered due to inference from "Commander"

-- Add gender column to characters table
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

-- Add gender_confidence column to track how certain we are about the gender
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender_confidence VARCHAR(20) DEFAULT 'explicit';
-- Values: 'explicit' (from AI), 'inferred' (from name analysis), 'unknown'

-- Add gender_source column to track where the gender came from
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender_source VARCHAR(50) DEFAULT 'outline';
-- Values: 'outline', 'llm_validation', 'manual', 'inferred'

-- Create index for gender queries
CREATE INDEX IF NOT EXISTS idx_characters_gender ON characters(gender);

-- Add comment explaining the field
COMMENT ON COLUMN characters.gender IS 'Explicit gender from story outline: male, female, non-binary, neutral';
COMMENT ON COLUMN characters.gender_confidence IS 'How certain we are: explicit (from AI), inferred (from name), unknown';
COMMENT ON COLUMN characters.gender_source IS 'Where gender came from: outline, llm_validation, manual, inferred';
