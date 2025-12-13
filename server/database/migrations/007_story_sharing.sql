-- Story Sharing Migration
-- Creates tables for story sharing functionality

-- Story shares table
CREATE TABLE IF NOT EXISTS story_shares (
    id SERIAL PRIMARY KEY,
    story_session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
    share_code VARCHAR(16) UNIQUE NOT NULL,
    created_by VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_public BOOLEAN DEFAULT true,
    allow_comments BOOLEAN DEFAULT false,
    password_hash VARCHAR(64),
    view_count INTEGER DEFAULT 0,
    last_viewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Story comments table
CREATE TABLE IF NOT EXISTS story_comments (
    id SERIAL PRIMARY KEY,
    story_share_id INTEGER NOT NULL REFERENCES story_shares(id) ON DELETE CASCADE,
    author_name VARCHAR(100) DEFAULT 'Anonymous',
    comment_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add cover image and illustration columns if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'story_sessions' AND column_name = 'cover_image_url') THEN
        ALTER TABLE story_sessions ADD COLUMN cover_image_url VARCHAR(500);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'story_scenes' AND column_name = 'illustration_url') THEN
        ALTER TABLE story_scenes ADD COLUMN illustration_url VARCHAR(500);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'characters' AND column_name = 'portrait_url') THEN
        ALTER TABLE characters ADD COLUMN portrait_url VARCHAR(500);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'characters' AND column_name = 'appearance_json') THEN
        ALTER TABLE characters ADD COLUMN appearance_json JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'characters' AND column_name = 'species') THEN
        ALTER TABLE characters ADD COLUMN species VARCHAR(100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'characters' AND column_name = 'gender') THEN
        ALTER TABLE characters ADD COLUMN gender VARCHAR(50);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'characters' AND column_name = 'age') THEN
        ALTER TABLE characters ADD COLUMN age INTEGER;
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_story_shares_session ON story_shares(story_session_id);
CREATE INDEX IF NOT EXISTS idx_story_shares_code ON story_shares(share_code);
CREATE INDEX IF NOT EXISTS idx_story_shares_public ON story_shares(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_story_comments_share ON story_comments(story_share_id);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_story_shares_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_shares_updated_at ON story_shares;
CREATE TRIGGER story_shares_updated_at
    BEFORE UPDATE ON story_shares
    FOR EACH ROW
    EXECUTE FUNCTION update_story_shares_updated_at();

COMMENT ON TABLE story_shares IS 'Shareable links for stories';
COMMENT ON TABLE story_comments IS 'Comments on shared stories';
