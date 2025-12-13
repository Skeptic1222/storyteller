-- Migration 009: Add Fal AI Character Reference Support
-- Adds reference_image_url column to characters table for character-consistent image generation

-- Add reference_image_url column to characters table
ALTER TABLE characters
ADD COLUMN IF NOT EXISTS reference_image_url VARCHAR(500);

-- Add updated_at column if it doesn't exist (needed for tracking reference updates)
ALTER TABLE characters
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add story_type to story_sessions for provider selection
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS story_type VARCHAR(50) DEFAULT 'standard';

-- Add cover_image_url if not present
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500);

-- Create index for sessions with character references
CREATE INDEX IF NOT EXISTS idx_characters_reference_image
ON characters(story_session_id)
WHERE reference_image_url IS NOT NULL;

-- Create index for story type
CREATE INDEX IF NOT EXISTS idx_story_sessions_type
ON story_sessions(story_type);

COMMENT ON COLUMN characters.reference_image_url IS 'HTTPS URL to character portrait for Fal AI character-consistent generation';
COMMENT ON COLUMN story_sessions.story_type IS 'Type of story: standard, storybook, campaign - determines image provider';
