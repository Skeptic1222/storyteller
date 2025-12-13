-- Migration 010: TTS Gating
-- Adds columns to track TTS usage per story for Section 3 of Storyteller Gospel
-- Allows per-story character limits and usage tracking

-- Add TTS tracking columns to story_sessions
ALTER TABLE story_sessions
ADD COLUMN IF NOT EXISTS tts_chars_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tts_segment_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tts_audio_bytes BIGINT DEFAULT 0;

-- Add index for usage queries
CREATE INDEX IF NOT EXISTS idx_story_sessions_tts_usage
ON story_sessions(tts_chars_used)
WHERE tts_chars_used > 0;

-- Comment for documentation
COMMENT ON COLUMN story_sessions.tts_chars_used IS 'Total characters sent to ElevenLabs TTS for this story';
COMMENT ON COLUMN story_sessions.tts_segment_count IS 'Number of TTS API calls made for this story';
COMMENT ON COLUMN story_sessions.tts_audio_bytes IS 'Total bytes of audio generated for this story';

-- Add TTS config to story session config view (for debugging)
-- This query shows TTS usage for all stories
-- SELECT id, title, tts_chars_used, tts_segment_count, tts_audio_bytes,
--        ROUND(tts_chars_used::numeric / 50000 * 100, 1) as pct_of_limit
-- FROM story_sessions
-- WHERE tts_chars_used > 0
-- ORDER BY tts_chars_used DESC;
