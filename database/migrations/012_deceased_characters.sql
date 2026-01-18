-- Migration 012: Deceased Character Support
-- Adds ability to track characters who are deceased/historical figures
-- They can be referenced in lore but won't appear as living characters

-- Add deceased tracking columns to library_characters
ALTER TABLE library_characters
ADD COLUMN IF NOT EXISTS is_deceased BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS death_context TEXT,
ADD COLUMN IF NOT EXISTS is_historical BOOLEAN DEFAULT FALSE;

-- Add comments for clarity
COMMENT ON COLUMN library_characters.is_deceased IS 'True if character has died in the story/canon';
COMMENT ON COLUMN library_characters.death_context IS 'How/when the character died - for lore reference';
COMMENT ON COLUMN library_characters.is_historical IS 'True if character only exists in history/lore, never appears as living';

-- Create an index for filtering living vs deceased characters
CREATE INDEX IF NOT EXISTS idx_library_characters_deceased ON library_characters(library_id, is_deceased);
