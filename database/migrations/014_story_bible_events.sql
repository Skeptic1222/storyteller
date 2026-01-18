-- Migration 014: Story Bible Events
-- Planned story moments that should occur during the narrative
-- Distinct from Lore (past events/history) - Events are future/planned moments
--
-- Events capture scenes, confrontations, revelations, and key moments that
-- the author wants to happen, without dictating their sequence or exact timing.
-- The synopsis/outline/beats system incorporates these events into the narrative.

-- =============================================================================
-- LIBRARY_EVENTS (Planned Story Moments)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,

    -- Core Identity
    name VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,

    -- Classification
    event_type VARCHAR(50) NOT NULL DEFAULT 'action',
    -- Types: action, confrontation, revelation, emotional, transition, discovery,
    --        chase, escape, battle, reunion, betrayal, sacrifice, transformation
    importance VARCHAR(20) DEFAULT 'major',
    -- Importance: major (must happen), supporting (should happen), minor (nice to have)

    -- Participants
    characters_involved TEXT[], -- Character names
    character_ids UUID[], -- References to library_characters
    factions_involved TEXT[], -- Faction names

    -- Location
    location_name VARCHAR(300),
    location_id UUID REFERENCES library_locations(id) ON DELETE SET NULL,
    location_notes TEXT, -- "somewhere isolated", "in a public place", etc.

    -- Timing hints (not prescriptive, just guidance)
    suggested_timing VARCHAR(100), -- "early", "middle", "climax", "resolution", "any"
    prerequisites TEXT[], -- What needs to happen before this event
    consequences TEXT[], -- What this event leads to or enables

    -- Story impact
    emotional_tone VARCHAR(100), -- tense, triumphant, tragic, hopeful, terrifying
    stakes TEXT, -- What's at risk
    conflict_type VARCHAR(50), -- physical, verbal, internal, supernatural, political

    -- Details
    key_elements TEXT[], -- Specific things that must be part of this event
    dialogue_hints TEXT, -- Key lines or exchanges
    visual_details TEXT, -- Imagery, settings details
    notes TEXT, -- Author notes

    -- Execution tracking
    is_incorporated BOOLEAN DEFAULT FALSE, -- Has this been added to outline/beats?
    incorporated_in_chapter INTEGER, -- Which chapter it was placed in
    incorporated_beat_id UUID, -- Reference to the beat that contains this event

    -- Visual
    image_url VARCHAR(500),
    image_prompt TEXT,

    -- Metadata
    tags TEXT[],
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    confidence VARCHAR(20) DEFAULT 'medium',
    extraction_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_events_library ON library_events(library_id);
CREATE INDEX IF NOT EXISTS idx_library_events_world ON library_events(world_id);
CREATE INDEX IF NOT EXISTS idx_library_events_type ON library_events(library_id, event_type);
CREATE INDEX IF NOT EXISTS idx_library_events_importance ON library_events(library_id, importance);
CREATE INDEX IF NOT EXISTS idx_library_events_location ON library_events(location_id);
CREATE INDEX IF NOT EXISTS idx_library_events_incorporated ON library_events(library_id, is_incorporated);
CREATE INDEX IF NOT EXISTS idx_library_events_tags ON library_events USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_library_events_character_ids ON library_events USING GIN(character_ids);

-- Trigger for updated_at
CREATE TRIGGER trigger_library_events_updated
BEFORE UPDATE ON library_events
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

-- =============================================================================
-- CHARACTER-EVENT PARTICIPATION (Which characters are in which events)
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_event_participation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES library_events(id) ON DELETE CASCADE,

    -- Participation details
    role_in_event VARCHAR(100), -- protagonist, antagonist, witness, victim, savior, catalyst
    significance VARCHAR(50) DEFAULT 'primary', -- primary, secondary, background
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(character_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_char_event_participation_library ON character_event_participation(library_id);
CREATE INDEX IF NOT EXISTS idx_char_event_participation_char ON character_event_participation(character_id);
CREATE INDEX IF NOT EXISTS idx_char_event_participation_event ON character_event_participation(event_id);

-- =============================================================================
-- UPDATE extraction_runs TO TRACK EVENTS
-- =============================================================================

ALTER TABLE extraction_runs
ADD COLUMN IF NOT EXISTS events_extracted INTEGER DEFAULT 0;

-- =============================================================================
-- UPDATE entity_classifications TO INCLUDE EVENTS
-- =============================================================================

-- Events can now be a primary_category
COMMENT ON COLUMN entity_classifications.primary_category IS 'character, location, item, ability, faction, lore, world, event';

-- =============================================================================
-- UPDATE library_entity_search VIEW TO INCLUDE EVENTS
-- =============================================================================

DROP VIEW IF EXISTS library_entity_search;

CREATE OR REPLACE VIEW library_entity_search AS
SELECT
    id, library_id, 'character' as category, name, description, tags, importance, created_at
FROM library_characters
UNION ALL
SELECT
    id, library_id, 'location' as category, name, description, tags, importance, created_at
FROM library_locations
UNION ALL
SELECT
    id, library_id, 'item' as category, name, description, tags, importance, created_at
FROM library_items
UNION ALL
SELECT
    id, library_id, 'ability' as category, name, description, tags, importance, created_at
FROM library_abilities
UNION ALL
SELECT
    id, library_id, 'faction' as category, name, description, tags, importance, created_at
FROM library_factions
UNION ALL
SELECT
    id, library_id, 'lore' as category, title as name, content as description, tags, importance, created_at
FROM library_lore
UNION ALL
SELECT
    id, library_id, 'event' as category, name, description, tags,
    CASE importance WHEN 'major' THEN 90 WHEN 'supporting' THEN 60 ELSE 30 END as importance,
    created_at
FROM library_events;

-- =============================================================================
-- COMMENTS AND DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE library_events IS '
EXTRACT AS EVENT IF:
- Is a scene, moment, or occurrence that should happen during the story
- Describes an action, confrontation, revelation, or emotional moment
- Has specific participants or consequences
- "A fight breaks out in the park"
- "Character discovers the secret"
- "A daring escape via gyrocopter"
- "The final showdown at the warehouse"

DISTINCTION FROM LORE:
- EVENTS = Things that SHOULD/WILL happen (future/planned)
- LORE = Things that HAVE happened (past/history/backstory)

Examples:
- "The Great War of 1042" → LORE (happened in the past)
- "A battle at the old fortress" → EVENT (planned to happen)
- "Shannon was born in Texas" → LORE (backstory)
- "Shannon escapes via gyrocopter" → EVENT (planned scene)

DO NOT EXTRACT AS EVENT:
- Historical events or backstory (→ library_lore)
- Character traits or descriptions (→ library_characters)
- Location descriptions (→ library_locations)
- Item descriptions (→ library_items)
';

COMMENT ON COLUMN library_events.event_type IS 'action, confrontation, revelation, emotional, transition, discovery, chase, escape, battle, reunion, betrayal, sacrifice, transformation';
COMMENT ON COLUMN library_events.importance IS 'major (must happen), supporting (should happen), minor (nice to have)';
COMMENT ON COLUMN library_events.suggested_timing IS 'Guidance for when in the story: early, middle, climax, resolution, any';
COMMENT ON COLUMN library_events.is_incorporated IS 'True when this event has been placed into the outline/chapter beats';
