-- Migration 011: Story Bible v2 - Collaborative refinement, connections, locations, chapter beats
-- Adds iterative refinement, character connections, locations, and chapter beats

-- =============================================================================
-- CHANGE WORLDS TO SINGULAR WORLD (one per library)
-- =============================================================================

-- Add singular world reference to library
ALTER TABLE user_libraries
ADD COLUMN IF NOT EXISTS world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL;

-- =============================================================================
-- LOCATIONS (Subset of World)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,
    parent_location_id UUID REFERENCES library_locations(id) ON DELETE SET NULL,

    -- Core
    name VARCHAR(200) NOT NULL,
    location_type VARCHAR(50), -- planet, continent, country, city, building, room, etc.
    description TEXT,
    atmosphere TEXT, -- mood, feeling, sensory details

    -- Details
    notable_features JSONB DEFAULT '[]', -- [{name, description}]
    history TEXT,
    current_state TEXT, -- what's happening there now

    -- Visual
    image_url VARCHAR(500),
    image_prompt TEXT,

    -- Metadata
    tags TEXT[],
    importance INTEGER DEFAULT 50,
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_locations_library ON library_locations(library_id);
CREATE INDEX IF NOT EXISTS idx_library_locations_world ON library_locations(world_id);
CREATE INDEX IF NOT EXISTS idx_library_locations_parent ON library_locations(parent_location_id);
CREATE INDEX IF NOT EXISTS idx_library_locations_type ON library_locations(library_id, location_type);

-- =============================================================================
-- CHARACTER CONNECTIONS (Relationships between characters)
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- The two characters
    character_a_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
    character_b_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,

    -- Relationship details
    relationship_type VARCHAR(50) NOT NULL, -- married, parent, child, sibling, friend, enemy, rival, mentor, student, colleague, lover, ex, etc.
    relationship_label VARCHAR(100), -- custom label like "childhood best friend"

    -- Direction matters for some relationships
    -- e.g., character_a is "parent" TO character_b (who is "child")
    is_directional BOOLEAN DEFAULT FALSE,
    reverse_relationship_type VARCHAR(50), -- if directional: what B is to A (e.g., "child")

    -- Details
    description TEXT, -- how they met, history of relationship
    current_status VARCHAR(50) DEFAULT 'active', -- active, estranged, deceased, complicated
    dynamics TEXT, -- how they interact, tensions, bonds

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent duplicate connections
    UNIQUE(character_a_id, character_b_id)
);

CREATE INDEX IF NOT EXISTS idx_character_connections_library ON character_connections(library_id);
CREATE INDEX IF NOT EXISTS idx_character_connections_char_a ON character_connections(character_a_id);
CREATE INDEX IF NOT EXISTS idx_character_connections_char_b ON character_connections(character_b_id);

-- =============================================================================
-- REFINEMENT HISTORY (Track iterative changes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_refinements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- Which entity was refined
    entity_type VARCHAR(50) NOT NULL, -- character, world, location, lore, synopsis, outline
    entity_id UUID NOT NULL,

    -- The refinement
    user_prompt TEXT NOT NULL, -- what the user asked for
    ai_response TEXT, -- summary of what changed

    -- Snapshot before/after
    before_snapshot JSONB,
    after_snapshot JSONB,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_refinements_entity ON entity_refinements(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_refinements_library ON entity_refinements(library_id);

-- =============================================================================
-- CHAPTER BEATS (Generated from Outline)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chapter_beats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    synopsis_id UUID NOT NULL REFERENCES library_synopsis(id) ON DELETE CASCADE,

    -- Chapter info
    chapter_number INTEGER NOT NULL,
    chapter_title VARCHAR(255),
    chapter_summary TEXT,

    -- Beats for this chapter
    beats JSONB NOT NULL DEFAULT '[]',
    -- Structure: [{ beat_number, type, summary, characters, location_id, mood, notes }]
    -- Types: opening, rising_action, climax, falling_action, resolution, transition, flashback, etc.

    -- Generation metadata
    generated_from JSONB, -- which entities were used to generate this
    is_locked BOOLEAN DEFAULT FALSE, -- prevent regeneration

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapter_beats_synopsis ON chapter_beats(synopsis_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_beats_unique ON chapter_beats(synopsis_id, chapter_number);

-- =============================================================================
-- UPDATE LIBRARY_SYNOPSIS FOR OUTLINE SUPPORT
-- =============================================================================

ALTER TABLE library_synopsis
ADD COLUMN IF NOT EXISTS outline_json JSONB,
ADD COLUMN IF NOT EXISTS is_outline_generated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS outline_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS beats_generated BOOLEAN DEFAULT FALSE;

-- =============================================================================
-- ADD REFINEMENT PROMPT HISTORY TO ENTITIES
-- =============================================================================

-- Track last refinement for quick re-refinement
ALTER TABLE library_characters ADD COLUMN IF NOT EXISTS last_refinement_prompt TEXT;
ALTER TABLE library_worlds ADD COLUMN IF NOT EXISTS last_refinement_prompt TEXT;
ALTER TABLE library_locations ADD COLUMN IF NOT EXISTS last_refinement_prompt TEXT;
ALTER TABLE library_lore ADD COLUMN IF NOT EXISTS last_refinement_prompt TEXT;
ALTER TABLE library_synopsis ADD COLUMN IF NOT EXISTS last_refinement_prompt TEXT;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE TRIGGER trigger_library_locations_updated
BEFORE UPDATE ON library_locations
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_chapter_beats_updated
BEFORE UPDATE ON chapter_beats
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

-- =============================================================================
-- COMMON RELATIONSHIP TYPES (Reference data)
-- =============================================================================

COMMENT ON TABLE character_connections IS 'Relationships between characters. Common types: married, engaged, dating, ex, parent, child, sibling, grandparent, grandchild, aunt_uncle, niece_nephew, cousin, friend, best_friend, enemy, rival, nemesis, mentor, student, colleague, boss, employee, ally, partner, acquaintance';

COMMENT ON TABLE library_locations IS 'Physical locations within the world. Can be hierarchical (continent > country > city > building > room)';

COMMENT ON TABLE entity_refinements IS 'History of collaborative refinements. Each entry captures a user prompt and the resulting changes to an entity';

COMMENT ON TABLE chapter_beats IS 'Detailed beats for each chapter, generated from the outline. Each beat is a distinct story moment';

-- =============================================================================
-- HELPFUL VIEWS
-- =============================================================================

-- View to get characters with their connections
CREATE OR REPLACE VIEW character_with_connections AS
SELECT
    c.*,
    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'connection_id', cc.id,
                'related_character_id', CASE WHEN cc.character_a_id = c.id THEN cc.character_b_id ELSE cc.character_a_id END,
                'related_character_name', rc.name,
                'relationship_type', CASE
                    WHEN cc.character_a_id = c.id THEN cc.relationship_type
                    ELSE COALESCE(cc.reverse_relationship_type, cc.relationship_type)
                END,
                'relationship_label', cc.relationship_label,
                'status', cc.current_status
            )
        ) FILTER (WHERE cc.id IS NOT NULL),
        '[]'
    ) as connections
FROM library_characters c
LEFT JOIN character_connections cc
    ON (cc.character_a_id = c.id OR cc.character_b_id = c.id)
LEFT JOIN library_characters rc
    ON rc.id = CASE WHEN cc.character_a_id = c.id THEN cc.character_b_id ELSE cc.character_a_id END
GROUP BY c.id;

-- View to get locations with hierarchy
CREATE OR REPLACE VIEW location_hierarchy AS
WITH RECURSIVE location_tree AS (
    -- Base case: top-level locations
    SELECT
        id, library_id, world_id, parent_location_id, name, location_type,
        description, 0 as depth, ARRAY[name] as path
    FROM library_locations
    WHERE parent_location_id IS NULL

    UNION ALL

    -- Recursive case: child locations
    SELECT
        l.id, l.library_id, l.world_id, l.parent_location_id, l.name, l.location_type,
        l.description, lt.depth + 1, lt.path || l.name
    FROM library_locations l
    JOIN location_tree lt ON l.parent_location_id = lt.id
)
SELECT * FROM location_tree;
