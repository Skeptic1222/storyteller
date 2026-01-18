-- Migration: 021_picture_book_images.sql
-- Picture Book Image Generation for Storyteller
-- Stores generated scene images synchronized with narration timing

-- Store generated scene images
CREATE TABLE IF NOT EXISTS scene_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,

    -- Image details
    image_url VARCHAR(500) NOT NULL,
    image_hash VARCHAR(64),           -- For deduplication
    prompt TEXT,                      -- FALAI prompt used
    prompt_abstract_level INTEGER,    -- 1=direct, 2=symbolic, 3=abstract (fallback tiers)

    -- Timing sync
    sequence_index INTEGER NOT NULL,  -- Order within scene (0, 1, 2, 3, 4)
    trigger_word_index INTEGER,       -- Which word triggers this image
    trigger_time_ms INTEGER,          -- Calculated from word timings

    -- Character consistency
    primary_character_id UUID REFERENCES characters(id),
    characters_in_image TEXT[],       -- Character names appearing

    -- Generation metadata
    provider VARCHAR(20) DEFAULT 'fal-ai', -- 'fal-ai' or 'dall-e'
    model VARCHAR(100),
    generation_time_ms INTEGER,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast scene image lookup
CREATE INDEX IF NOT EXISTS idx_scene_images_scene ON scene_images(scene_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_scene_images_session ON scene_images(story_session_id);

-- Add visual_mode to story_sessions if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'story_sessions' AND column_name = 'visual_mode'
    ) THEN
        ALTER TABLE story_sessions ADD COLUMN visual_mode VARCHAR(20) DEFAULT 'none';
        COMMENT ON COLUMN story_sessions.visual_mode IS 'Image generation mode: none, cover_only, picture_book';
    END IF;
END $$;

-- Comment on table
COMMENT ON TABLE scene_images IS 'Stores generated scene images for picture book mode, synchronized with narration timing';
