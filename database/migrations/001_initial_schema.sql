-- Migration 001: Initial Schema
-- Created: 2026-01-09
-- Description: Base schema for Storyteller application
-- Note: This file documents the initial schema. If database already exists, skip this migration.

-- Schema Migrations Tracking Table
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version);

-- Insert this migration record
INSERT INTO schema_migrations (version, name) VALUES ('001', 'initial_schema')
ON CONFLICT (version) DO NOTHING;

-- ============================================
-- CORE TABLES (Only create if not exists)
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    google_id VARCHAR(255) UNIQUE,
    display_name VARCHAR(255),
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Story status enum
DO $$ BEGIN
    CREATE TYPE story_status AS ENUM ('generating', 'paused', 'active', 'completed', 'error');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Story sessions table
CREATE TABLE IF NOT EXISTS story_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500),
    premise TEXT,
    author_style VARCHAR(100),
    audience VARCHAR(50) DEFAULT 'general',
    config JSONB DEFAULT '{}',
    status story_status DEFAULT 'generating',
    current_scene_number INTEGER DEFAULT 1,
    total_scenes INTEGER,
    cover_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scenes table
CREATE TABLE IF NOT EXISTS scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_number INTEGER NOT NULL,
    title VARCHAR(500),
    content TEXT,
    summary TEXT,
    is_ending BOOLEAN DEFAULT FALSE,
    audio_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(story_id, scene_number)
);

-- Choices table (for CYOA branching)
CREATE TABLE IF NOT EXISTS choices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    choice_text TEXT NOT NULL,
    next_scene_id UUID REFERENCES scenes(id) ON DELETE SET NULL,
    choice_order INTEGER DEFAULT 0,
    is_selected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Characters table
CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    voice_id VARCHAR(100),
    voice_settings JSONB DEFAULT '{}',
    is_narrator BOOLEAN DEFAULT FALSE,
    first_appearance INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Lore/World-building table
CREATE TABLE IF NOT EXISTS lore (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    category VARCHAR(100),
    name VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Library entries table
CREATE TABLE IF NOT EXISTS library_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    last_scene_number INTEGER DEFAULT 1,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    is_bookmarked BOOLEAN DEFAULT FALSE,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, story_id)
);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_story_sessions_user ON story_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_story_sessions_status ON story_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scenes_story ON scenes(story_id);
CREATE INDEX IF NOT EXISTS idx_scenes_story_number ON scenes(story_id, scene_number);
CREATE INDEX IF NOT EXISTS idx_choices_scene ON choices(scene_id);
CREATE INDEX IF NOT EXISTS idx_characters_story ON characters(story_id);
CREATE INDEX IF NOT EXISTS idx_lore_story ON lore(story_id);
CREATE INDEX IF NOT EXISTS idx_library_entries_user ON library_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_library_entries_story ON library_entries(story_id);

-- ============================================
-- END OF INITIAL SCHEMA
-- ============================================
