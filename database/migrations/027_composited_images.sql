-- Migration: 027_composited_images.sql
-- Picture Book Compositing Enhancement for Storyteller
-- Adds support for Sharp compositing and Ken Burns effects

-- Add compositing columns to scene_images
ALTER TABLE scene_images
ADD COLUMN IF NOT EXISTS is_composited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS background_image_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS character_image_urls TEXT[],  -- Array of character images composited
ADD COLUMN IF NOT EXISTS ken_burns_effect VARCHAR(50) DEFAULT 'zoomIn';

-- Comment on new columns
COMMENT ON COLUMN scene_images.is_composited IS 'Whether image was composited from background + character(s)';
COMMENT ON COLUMN scene_images.background_image_url IS 'Original background URL before compositing';
COMMENT ON COLUMN scene_images.character_image_urls IS 'Array of character PNG URLs with transparent backgrounds';
COMMENT ON COLUMN scene_images.ken_burns_effect IS 'Ken Burns effect for this image: zoomIn, zoomOut, panLeft, panRight, panUp, panDown, zoomPanNE, zoomPanSW';

-- Story video exports table for optional video generation
CREATE TABLE IF NOT EXISTS story_video_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,

    -- Video details
    video_url VARCHAR(500),
    video_format VARCHAR(20) DEFAULT 'mp4', -- 'mp4', 'webm'
    duration_seconds INTEGER,
    file_size_bytes BIGINT,

    -- Generation status
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,

    -- Options used
    include_ken_burns BOOLEAN DEFAULT TRUE,
    include_audio BOOLEAN DEFAULT TRUE,
    resolution VARCHAR(20) DEFAULT '1080p', -- '720p', '1080p', '4k'

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for fast video export lookup
CREATE INDEX IF NOT EXISTS idx_video_exports_session ON story_video_exports(story_session_id);
CREATE INDEX IF NOT EXISTS idx_video_exports_status ON story_video_exports(status);

-- Comment on table
COMMENT ON TABLE story_video_exports IS 'Tracks video exports of picture book stories with Ken Burns effects';
