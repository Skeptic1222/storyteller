-- Migration 009: Add word_timings to story_scenes for karaoke/read-along feature
-- This allows caching word-level timestamps with the scene for playback

-- Add word_timings column to story_scenes
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS word_timings JSONB;

COMMENT ON COLUMN story_scenes.word_timings IS 'Word-level timestamps from ElevenLabs for karaoke/read-along feature. Format: { words: [{text, start_ms, end_ms}], total_duration_ms, word_count }';

-- Add index for scenes with word timings (useful for queries)
CREATE INDEX IF NOT EXISTS idx_story_scenes_has_word_timings
ON story_scenes ((word_timings IS NOT NULL))
WHERE word_timings IS NOT NULL;
