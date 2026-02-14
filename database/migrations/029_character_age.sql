-- Migration 029: Add age_group field to characters table
-- This addresses the critical issue where child characters get assigned adult voices
-- because age information was never extracted from the story outline.
--
-- Age groups: child (0-12), teen (13-17), young_adult (18-25), adult (26-59),
--             middle_aged (40-59), elderly (60+)

-- Add age_group column to characters table
ALTER TABLE characters ADD COLUMN IF NOT EXISTS age_group VARCHAR(30) DEFAULT 'adult';

-- Add age_reasoning column to track AI's reasoning for age determination
ALTER TABLE characters ADD COLUMN IF NOT EXISTS age_reasoning VARCHAR(500);

-- Create index for age queries (useful for voice filtering)
CREATE INDEX IF NOT EXISTS idx_characters_age_group ON characters(age_group);

-- Add comment explaining the field
COMMENT ON COLUMN characters.age_group IS 'Character age group for voice casting: child, teen, young_adult, adult, middle_aged, elderly';
COMMENT ON COLUMN characters.age_reasoning IS 'AI reasoning for age group determination';

-- Insert migration record
INSERT INTO schema_migrations (version, name) VALUES ('029', 'character_age')
ON CONFLICT (version) DO NOTHING;
