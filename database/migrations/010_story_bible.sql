-- Migration 010: Story Bible / Library System
-- Reusable characters, worlds, lore, and synopsis across story sessions
-- Supports version tracking and fork lineage

-- =============================================================================
-- USER LIBRARIES (Container)
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_libraries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'My Library',
    description TEXT,
    settings_json JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_libraries_user
ON user_libraries(user_id);

-- =============================================================================
-- LIBRARY CHARACTERS (Reusable across stories)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- Core identity
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(150), -- For variants like "Young Aria" vs "Queen Aria"
    role VARCHAR(100), -- protagonist, antagonist, mentor, companion, etc.

    -- Description
    description TEXT,
    personality TEXT,
    traits_json JSONB DEFAULT '[]',
    backstory TEXT,

    -- Voice/Audio
    voice_description TEXT,
    preferred_voice_id VARCHAR(100), -- ElevenLabs voice ID
    gender VARCHAR(20),
    age_group VARCHAR(30), -- child, teen, young_adult, adult, elderly

    -- Visual
    appearance TEXT,
    portrait_url VARCHAR(500),
    portrait_prompt TEXT, -- For regenerating portraits

    -- Relationships (references other library_characters by ID)
    relationships_json JSONB DEFAULT '{}',

    -- Metadata
    tags TEXT[],
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_characters_library ON library_characters(library_id);
CREATE INDEX IF NOT EXISTS idx_library_characters_name ON library_characters(library_id, name);
CREATE INDEX IF NOT EXISTS idx_library_characters_tags ON library_characters USING GIN(tags);

-- =============================================================================
-- LIBRARY WORLDS (Reusable settings/universes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_worlds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- Core
    name VARCHAR(150) NOT NULL,
    description TEXT,
    genre VARCHAR(100), -- fantasy, sci-fi, contemporary, etc.
    time_period VARCHAR(100), -- medieval, futuristic, modern, etc.

    -- World rules
    magic_system TEXT,
    technology_level TEXT,
    society_structure TEXT,
    key_locations JSONB DEFAULT '[]', -- [{name, description, significance}]

    -- Atmosphere
    tone VARCHAR(50), -- dark, whimsical, epic, cozy, etc.
    themes TEXT[],
    visual_style TEXT, -- For cover art generation

    -- Cover/Banner
    cover_url VARCHAR(500),
    cover_prompt TEXT,

    -- Metadata
    tags TEXT[],
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_worlds_library ON library_worlds(library_id);
CREATE INDEX IF NOT EXISTS idx_library_worlds_genre ON library_worlds(library_id, genre);
CREATE INDEX IF NOT EXISTS idx_library_worlds_tags ON library_worlds USING GIN(tags);

-- =============================================================================
-- LIBRARY LORE (Hierarchical world-building entries)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_lore (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES library_lore(id) ON DELETE SET NULL,

    -- Content
    entry_type VARCHAR(50) NOT NULL, -- location, faction, item, event, rule, history, creature, custom
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,

    -- Organization
    tags TEXT[],
    importance INTEGER DEFAULT 50, -- 0-100, for context pruning
    sort_order INTEGER DEFAULT 0,

    -- Metadata
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_lore_library ON library_lore(library_id);
CREATE INDEX IF NOT EXISTS idx_library_lore_world ON library_lore(world_id);
CREATE INDEX IF NOT EXISTS idx_library_lore_parent ON library_lore(parent_id);
CREATE INDEX IF NOT EXISTS idx_library_lore_type ON library_lore(library_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_library_lore_tags ON library_lore USING GIN(tags);

-- =============================================================================
-- LIBRARY SYNOPSIS (Story templates/outlines)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_synopsis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,

    -- Core
    title VARCHAR(255) NOT NULL,
    logline VARCHAR(500), -- One-sentence pitch
    synopsis TEXT NOT NULL,

    -- Structure
    genre VARCHAR(100),
    target_audience VARCHAR(50), -- children, young_adult, adult, mature
    story_format VARCHAR(50), -- short_story, novella, episodic, etc.
    estimated_length VARCHAR(20), -- short, medium, long

    -- Plot structure
    acts_json JSONB DEFAULT '[]', -- [{act_number, summary, key_events}]
    character_ids UUID[], -- References to library_characters

    -- Themes and tone
    themes TEXT[],
    mood VARCHAR(50),
    content_warnings TEXT[],

    -- Cover
    cover_url VARCHAR(500),
    cover_prompt TEXT,

    -- Metadata
    tags TEXT[],
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_synopsis_library ON library_synopsis(library_id);
CREATE INDEX IF NOT EXISTS idx_library_synopsis_world ON library_synopsis(world_id);
CREATE INDEX IF NOT EXISTS idx_library_synopsis_genre ON library_synopsis(library_id, genre);
CREATE INDEX IF NOT EXISTS idx_library_synopsis_tags ON library_synopsis USING GIN(tags);

-- =============================================================================
-- VERSION HISTORY (Track changes to library entities)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_entity_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Which entity (polymorphic)
    entity_type VARCHAR(50) NOT NULL, -- character, world, lore, synopsis
    entity_id UUID NOT NULL,
    version_number INTEGER NOT NULL,

    -- Snapshot
    data_json JSONB NOT NULL, -- Full snapshot of the entity at this version
    change_summary TEXT, -- What changed

    -- Source tracking
    created_from_session_id UUID REFERENCES story_sessions(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_versions_entity ON library_entity_versions(entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_versions_unique ON library_entity_versions(entity_type, entity_id, version_number);

-- =============================================================================
-- SESSION-LIBRARY LINKS (Fork tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_library_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,

    -- Which library entity was used
    entity_type VARCHAR(50) NOT NULL, -- character, world, lore, synopsis
    library_entity_id UUID NOT NULL,

    -- Which version was used
    version_at_use INTEGER NOT NULL,

    -- If the session modified this entity
    session_entity_id UUID, -- Points to the session's local copy (characters.id, lore_entries.id, etc.)
    was_modified BOOLEAN DEFAULT FALSE,

    -- If modifications were merged back
    merged_to_library BOOLEAN DEFAULT FALSE,
    merged_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_library_links_session ON session_library_links(session_id);
CREATE INDEX IF NOT EXISTS idx_session_library_links_entity ON session_library_links(entity_type, library_entity_id);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to library tables
CREATE TRIGGER trigger_library_characters_updated
BEFORE UPDATE ON library_characters
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_library_worlds_updated
BEFORE UPDATE ON library_worlds
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_library_lore_updated
BEFORE UPDATE ON library_lore
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_library_synopsis_updated
BEFORE UPDATE ON library_synopsis
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_user_libraries_updated
BEFORE UPDATE ON user_libraries
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

-- Increment use_count when linking to session
CREATE OR REPLACE FUNCTION increment_library_use_count()
RETURNS TRIGGER AS $$
BEGIN
    CASE NEW.entity_type
        WHEN 'character' THEN
            UPDATE library_characters SET use_count = use_count + 1 WHERE id = NEW.library_entity_id;
        WHEN 'world' THEN
            UPDATE library_worlds SET use_count = use_count + 1 WHERE id = NEW.library_entity_id;
        WHEN 'lore' THEN
            UPDATE library_lore SET use_count = use_count + 1 WHERE id = NEW.library_entity_id;
        WHEN 'synopsis' THEN
            UPDATE library_synopsis SET use_count = use_count + 1 WHERE id = NEW.library_entity_id;
    END CASE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_library_use
AFTER INSERT ON session_library_links
FOR EACH ROW EXECUTE FUNCTION increment_library_use_count();

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE user_libraries IS 'Container for user''s reusable story elements library';
COMMENT ON TABLE library_characters IS 'Reusable character profiles that can be used across multiple stories';
COMMENT ON TABLE library_worlds IS 'Reusable world/setting definitions with rules and atmosphere';
COMMENT ON TABLE library_lore IS 'Hierarchical lore entries (locations, factions, items, history, etc.)';
COMMENT ON TABLE library_synopsis IS 'Story templates/outlines with plot structure and character references';
COMMENT ON TABLE library_entity_versions IS 'Version history for all library entities';
COMMENT ON TABLE session_library_links IS 'Tracks which library entities were used in which story sessions';
