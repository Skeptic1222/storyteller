-- Migration 025: Phonetic Mappings for ElevenLabs Fallback
-- Created: 2026-01-16
-- Description: Tables for storing phonetic respellings when ElevenLabs refuses profanity/objectionable content

-- Phonetic word mappings for TTS fallback
CREATE TABLE IF NOT EXISTS profanity_phonetic_mappings (
  id SERIAL PRIMARY KEY,
  original_word VARCHAR(100) NOT NULL UNIQUE,
  phonetic_tts_text VARCHAR(100) NOT NULL,      -- What gets sent to TTS
  phonetic_display_text VARCHAR(100),            -- Optional: what shows in UI (if different)
  confidence FLOAT DEFAULT 1.0,
  model_version VARCHAR(20),                     -- LLM model that generated this
  usage_count INT DEFAULT 0,                     -- Track how often this mapping is used
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_phonetic_original_word ON profanity_phonetic_mappings(original_word);

-- Word alignment tracking for karaoke sync
CREATE TABLE IF NOT EXISTS phonetic_word_alignments (
  id SERIAL PRIMARY KEY,
  original_text_hash VARCHAR(64) NOT NULL,       -- SHA-256 of original text
  phonetic_text TEXT NOT NULL,                   -- Full phonetic version
  voice_id VARCHAR(50) NOT NULL,                 -- Voice used for TTS
  mapping_json JSONB,                            -- Per-word timing adjustments
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(original_text_hash, voice_id)
);

-- Index for alignment lookups
CREATE INDEX IF NOT EXISTS idx_phonetic_text_hash ON phonetic_word_alignments(original_text_hash);

-- Provider attribution per segment (Phase 5.3)
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS provider_segments JSONB;
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS has_explicit_content BOOLEAN DEFAULT false;
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS explicit_types TEXT[];

-- Comments for documentation
COMMENT ON TABLE profanity_phonetic_mappings IS 'Stores phonetic respellings for words that ElevenLabs refuses to narrate';
COMMENT ON COLUMN profanity_phonetic_mappings.phonetic_tts_text IS 'Phonetic spelling sent to TTS (e.g., "fuhk" for profanity)';
COMMENT ON COLUMN profanity_phonetic_mappings.phonetic_display_text IS 'Optional display text for UI (original word shown in karaoke)';

COMMENT ON TABLE phonetic_word_alignments IS 'Caches word timing alignments for phonetic text to sync karaoke highlighting';
COMMENT ON COLUMN phonetic_word_alignments.mapping_json IS 'JSON array mapping original words to phonetic word positions and timings';

COMMENT ON COLUMN story_scenes.provider_segments IS 'JSON tracking which LLM provider generated each segment (OpenAI/Venice/OpenRouter)';
COMMENT ON COLUMN story_scenes.has_explicit_content IS 'Flag indicating scene contains explicit content (Venice-generated)';
COMMENT ON COLUMN story_scenes.explicit_types IS 'Array of explicit content types present (violence, sexual, gore, etc.)';

-- Track migration
INSERT INTO schema_migrations (version, name) VALUES ('025', 'phonetic_mappings')
ON CONFLICT (version) DO NOTHING;
