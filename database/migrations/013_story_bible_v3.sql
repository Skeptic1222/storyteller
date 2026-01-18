-- Migration 013: Story Bible v3 - Comprehensive Entity System
-- Redesigned extraction with proper categorization, deduplication, and D&D support
--
-- KEY CHANGES:
-- 1. Enhanced library_characters with comprehensive vital status tracking
-- 2. New library_items table for objects, vehicles, weapons, artifacts, books
-- 3. New library_abilities table for D&D spells, skills, feats, powers
-- 4. New library_factions table for organizations, groups, guilds
-- 5. Entity type classification system to prevent cross-category duplicates
-- 6. Enhanced relationships with cross-entity links

-- =============================================================================
-- ENHANCED LIBRARY_CHARACTERS
-- =============================================================================

-- Add comprehensive vital status and character fields
ALTER TABLE library_characters
ADD COLUMN IF NOT EXISTS is_alive BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS vital_status_summary TEXT,
ADD COLUMN IF NOT EXISTS death_details JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS species VARCHAR(100) DEFAULT 'human',
ADD COLUMN IF NOT EXISTS is_animal_companion BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS companion_to_character_id UUID REFERENCES library_characters(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS age_specific VARCHAR(50),
ADD COLUMN IF NOT EXISTS occupation VARCHAR(200),
ADD COLUMN IF NOT EXISTS former_occupations TEXT[],
ADD COLUMN IF NOT EXISTS social_status VARCHAR(100),
ADD COLUMN IF NOT EXISTS education TEXT,
ADD COLUMN IF NOT EXISTS origin VARCHAR(200),
ADD COLUMN IF NOT EXISTS abilities TEXT[],
ADD COLUMN IF NOT EXISTS skills TEXT[],
ADD COLUMN IF NOT EXISTS weaknesses TEXT[],
ADD COLUMN IF NOT EXISTS signature_moves TEXT[],
ADD COLUMN IF NOT EXISTS motivations TEXT,
ADD COLUMN IF NOT EXISTS secrets TEXT,
ADD COLUMN IF NOT EXISTS internal_conflicts TEXT,
ADD COLUMN IF NOT EXISTS external_conflicts TEXT,
ADD COLUMN IF NOT EXISTS enemies TEXT[],
ADD COLUMN IF NOT EXISTS allies TEXT[],
ADD COLUMN IF NOT EXISTS romantic_interests TEXT[],
ADD COLUMN IF NOT EXISTS family TEXT[],
ADD COLUMN IF NOT EXISTS dialogue_style TEXT,
ADD COLUMN IF NOT EXISTS first_appearance_context TEXT,
ADD COLUMN IF NOT EXISTS character_arc TEXT,
ADD COLUMN IF NOT EXISTS symbolic_role TEXT,
ADD COLUMN IF NOT EXISTS values_json JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS fears TEXT[],
ADD COLUMN IF NOT EXISTS flaws TEXT[],
ADD COLUMN IF NOT EXISTS strengths TEXT[],
ADD COLUMN IF NOT EXISTS physical_condition TEXT,
ADD COLUMN IF NOT EXISTS clothing_style TEXT,
ADD COLUMN IF NOT EXISTS faction_allegiance VARCHAR(200),
ADD COLUMN IF NOT EXISTS extraction_notes TEXT,
ADD COLUMN IF NOT EXISTS confidence VARCHAR(20) DEFAULT 'medium';

-- Create index for animal companions
CREATE INDEX IF NOT EXISTS idx_library_characters_companion ON library_characters(is_animal_companion);
CREATE INDEX IF NOT EXISTS idx_library_characters_companion_to ON library_characters(companion_to_character_id);
CREATE INDEX IF NOT EXISTS idx_library_characters_species ON library_characters(library_id, species);
CREATE INDEX IF NOT EXISTS idx_library_characters_alive ON library_characters(library_id, is_alive);

COMMENT ON COLUMN library_characters.vital_status_summary IS 'Clear status like "DECEASED - Killed by X during Y" or "ALIVE - Protagonist"';
COMMENT ON COLUMN library_characters.death_details IS 'JSON with cause, timing, location, killer, circumstances, impact, body_status';
COMMENT ON COLUMN library_characters.is_animal_companion IS 'True for pets, mounts, familiars that belong to another character';
COMMENT ON COLUMN library_characters.species IS 'human, dog, cat, dragon, elf, orc, robot, AI, etc.';

-- =============================================================================
-- LIBRARY_ITEMS (Objects, Vehicles, Weapons, Artifacts, Books, Equipment)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,

    -- Core Identity
    name VARCHAR(200) NOT NULL,
    display_name VARCHAR(250),
    item_type VARCHAR(50) NOT NULL, -- weapon, armor, vehicle, tool, artifact, book, clothing, consumable, container, key, currency, document, misc
    subtype VARCHAR(100), -- sword, spaceship, potion, etc.

    -- Description
    description TEXT NOT NULL,
    appearance TEXT,
    size VARCHAR(50), -- tiny, small, medium, large, huge, colossal
    material VARCHAR(100),
    condition VARCHAR(50), -- pristine, good, worn, damaged, broken, ancient

    -- Properties
    magical_properties TEXT,
    mundane_properties TEXT,
    abilities TEXT[], -- what it can do
    limitations TEXT[], -- restrictions, requirements
    rarity VARCHAR(50), -- common, uncommon, rare, very_rare, legendary, unique, artifact
    value_description TEXT, -- "priceless", "worth a small fortune", "10 gold pieces"

    -- Ownership & Location
    current_owner VARCHAR(200), -- character name or "unknown"
    owner_character_id UUID REFERENCES library_characters(id) ON DELETE SET NULL,
    current_location VARCHAR(200),
    location_id UUID REFERENCES library_locations(id) ON DELETE SET NULL,

    -- History
    origin TEXT, -- where it came from
    creator VARCHAR(200), -- who made it
    history TEXT, -- notable events in its past

    -- D&D Specific (optional)
    stats_json JSONB DEFAULT NULL, -- {damage: "1d8", armor_class: 15, weight: "5 lbs", etc.}
    attunement_required BOOLEAN DEFAULT FALSE,
    attunement_requirements TEXT,
    charges INTEGER,
    recharge_condition TEXT,

    -- Visual
    image_url VARCHAR(500),
    image_prompt TEXT,

    -- Metadata
    tags TEXT[],
    importance INTEGER DEFAULT 50,
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    confidence VARCHAR(20) DEFAULT 'medium',
    extraction_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_items_library ON library_items(library_id);
CREATE INDEX IF NOT EXISTS idx_library_items_world ON library_items(world_id);
CREATE INDEX IF NOT EXISTS idx_library_items_type ON library_items(library_id, item_type);
CREATE INDEX IF NOT EXISTS idx_library_items_owner ON library_items(owner_character_id);
CREATE INDEX IF NOT EXISTS idx_library_items_location ON library_items(location_id);
CREATE INDEX IF NOT EXISTS idx_library_items_tags ON library_items USING GIN(tags);

COMMENT ON TABLE library_items IS 'Physical objects: weapons, armor, vehicles, tools, artifacts, books, documents, keys, etc.';

-- =============================================================================
-- LIBRARY_ABILITIES (D&D Spells, Skills, Feats, Powers, Techniques)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_abilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,

    -- Core Identity
    name VARCHAR(200) NOT NULL,
    ability_type VARCHAR(50) NOT NULL, -- spell, skill, feat, trait, technique, power, curse, blessing, class_feature, racial_ability
    school VARCHAR(100), -- for spells: evocation, necromancy, etc. For others: combat, social, etc.

    -- Description
    description TEXT NOT NULL,
    effect TEXT, -- what it does mechanically
    visual_description TEXT, -- how it looks when used

    -- Requirements & Limitations
    prerequisites TEXT[], -- what you need to have/be
    requirements TEXT, -- conditions for use
    limitations TEXT[], -- restrictions, side effects
    cooldown VARCHAR(100), -- "once per day", "recharges at dawn", etc.
    resource_cost TEXT, -- mana, spell slots, ki points, etc.

    -- D&D Specific (optional)
    level INTEGER, -- spell level 0-9, or character level requirement
    casting_time VARCHAR(100),
    range VARCHAR(100),
    components VARCHAR(100), -- V, S, M
    duration VARCHAR(100),
    concentration BOOLEAN DEFAULT FALSE,
    ritual BOOLEAN DEFAULT FALSE,
    damage VARCHAR(100), -- "3d6 fire"
    saving_throw VARCHAR(50), -- "DEX", "WIS", etc.
    attack_bonus INTEGER,

    -- Classification
    source_type VARCHAR(100), -- arcane, divine, psionic, martial, natural, technological
    class_restrictions TEXT[], -- which classes can use it

    -- Visual
    icon_url VARCHAR(500),

    -- Metadata
    tags TEXT[],
    importance INTEGER DEFAULT 50,
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    confidence VARCHAR(20) DEFAULT 'medium',
    extraction_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_abilities_library ON library_abilities(library_id);
CREATE INDEX IF NOT EXISTS idx_library_abilities_world ON library_abilities(world_id);
CREATE INDEX IF NOT EXISTS idx_library_abilities_type ON library_abilities(library_id, ability_type);
CREATE INDEX IF NOT EXISTS idx_library_abilities_school ON library_abilities(library_id, school);
CREATE INDEX IF NOT EXISTS idx_library_abilities_tags ON library_abilities USING GIN(tags);

COMMENT ON TABLE library_abilities IS 'Character abilities: spells, skills, feats, powers, techniques for D&D and other RPG systems';

-- =============================================================================
-- LIBRARY_FACTIONS (Organizations, Groups, Guilds, Nations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_factions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    world_id UUID REFERENCES library_worlds(id) ON DELETE SET NULL,
    parent_faction_id UUID REFERENCES library_factions(id) ON DELETE SET NULL,

    -- Core Identity
    name VARCHAR(200) NOT NULL,
    faction_type VARCHAR(50) NOT NULL, -- guild, kingdom, cult, company, military, tribe, gang, religion, school, family, alliance, government
    alignment VARCHAR(100), -- lawful_good, chaotic_evil, neutral, etc. or general description

    -- Description
    description TEXT NOT NULL,
    motto VARCHAR(500),
    symbol_description TEXT,

    -- Structure
    leadership_type VARCHAR(100), -- monarchy, democracy, council, dictatorship, etc.
    leader_name VARCHAR(200),
    leader_character_id UUID REFERENCES library_characters(id) ON DELETE SET NULL,
    hierarchy TEXT, -- description of ranks and structure
    member_count VARCHAR(100), -- "thousands", "a dozen", "unknown"

    -- Goals & Methods
    goals TEXT[], -- what they want to achieve
    methods TEXT[], -- how they operate
    values TEXT[], -- what they believe in
    secrets TEXT, -- hidden agendas, unknown truths

    -- Relationships
    allies TEXT[], -- faction names
    enemies TEXT[], -- faction names
    neutral_relations TEXT[], -- faction names

    -- Territory & Resources
    headquarters VARCHAR(200),
    headquarters_location_id UUID REFERENCES library_locations(id) ON DELETE SET NULL,
    territories TEXT[], -- areas they control
    resources TEXT[], -- what they have access to

    -- History
    founding TEXT, -- when and how they were founded
    history TEXT, -- major events
    current_state TEXT, -- what's happening now

    -- Visual
    symbol_url VARCHAR(500),
    symbol_prompt TEXT,

    -- Metadata
    tags TEXT[],
    importance INTEGER DEFAULT 50,
    is_favorite BOOLEAN DEFAULT FALSE,
    use_count INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    confidence VARCHAR(20) DEFAULT 'medium',
    extraction_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_factions_library ON library_factions(library_id);
CREATE INDEX IF NOT EXISTS idx_library_factions_world ON library_factions(world_id);
CREATE INDEX IF NOT EXISTS idx_library_factions_parent ON library_factions(parent_faction_id);
CREATE INDEX IF NOT EXISTS idx_library_factions_type ON library_factions(library_id, faction_type);
CREATE INDEX IF NOT EXISTS idx_library_factions_tags ON library_factions USING GIN(tags);

COMMENT ON TABLE library_factions IS 'Organizations and groups: guilds, kingdoms, cults, companies, religions, families, etc.';

-- =============================================================================
-- CHARACTER-FACTION MEMBERSHIPS
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_faction_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
    faction_id UUID NOT NULL REFERENCES library_factions(id) ON DELETE CASCADE,

    -- Membership Details
    rank VARCHAR(100),
    role VARCHAR(200), -- their function in the faction
    join_date VARCHAR(100), -- "5 years ago", "at birth", etc.
    status VARCHAR(50) DEFAULT 'active', -- active, former, founding, honorary, secret

    -- Details
    loyalty_level VARCHAR(50), -- fanatical, loyal, moderate, wavering, infiltrator
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(character_id, faction_id)
);

CREATE INDEX IF NOT EXISTS idx_char_faction_memberships_library ON character_faction_memberships(library_id);
CREATE INDEX IF NOT EXISTS idx_char_faction_memberships_char ON character_faction_memberships(character_id);
CREATE INDEX IF NOT EXISTS idx_char_faction_memberships_faction ON character_faction_memberships(faction_id);

-- =============================================================================
-- CHARACTER-ABILITY LINKS (Which characters have which abilities)
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_abilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
    ability_id UUID NOT NULL REFERENCES library_abilities(id) ON DELETE CASCADE,

    -- Details
    proficiency_level VARCHAR(50), -- novice, apprentice, journeyman, expert, master, legendary
    how_acquired TEXT, -- how they learned/gained it
    signature_use BOOLEAN DEFAULT FALSE, -- is this their signature ability?
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(character_id, ability_id)
);

CREATE INDEX IF NOT EXISTS idx_char_abilities_library ON character_abilities(library_id);
CREATE INDEX IF NOT EXISTS idx_char_abilities_char ON character_abilities(character_id);
CREATE INDEX IF NOT EXISTS idx_char_abilities_ability ON character_abilities(ability_id);

-- =============================================================================
-- CHARACTER-ITEM LINKS (Ownership and associations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,

    -- Relationship
    relationship_type VARCHAR(50) NOT NULL, -- owns, carries, created, seeks, lost, guards, attuned
    acquisition_context TEXT, -- how they got it
    significance TEXT, -- why it matters to them
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(character_id, item_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_char_items_library ON character_items(library_id);
CREATE INDEX IF NOT EXISTS idx_char_items_char ON character_items(character_id);
CREATE INDEX IF NOT EXISTS idx_char_items_item ON character_items(item_id);

-- =============================================================================
-- ENTITY CLASSIFICATION TABLE (For deduplication tracking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_classifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- What was classified
    entity_name VARCHAR(300) NOT NULL, -- normalized lowercase name

    -- Classification result
    primary_category VARCHAR(50) NOT NULL, -- character, location, item, ability, faction, lore, world
    entity_id UUID NOT NULL, -- ID in the primary category table

    -- Alternative classifications (if something could be multiple)
    secondary_categories TEXT[], -- other valid categories
    classification_notes TEXT, -- why this classification was chosen

    -- Extraction tracking
    extraction_run_id UUID, -- to track which import created this
    confidence VARCHAR(20) DEFAULT 'high',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent duplicate names in same library
    UNIQUE(library_id, entity_name)
);

CREATE INDEX IF NOT EXISTS idx_entity_classifications_library ON entity_classifications(library_id);
CREATE INDEX IF NOT EXISTS idx_entity_classifications_name ON entity_classifications(entity_name);
CREATE INDEX IF NOT EXISTS idx_entity_classifications_category ON entity_classifications(library_id, primary_category);

COMMENT ON TABLE entity_classifications IS 'Central registry of all extracted entities. Prevents same entity from appearing in multiple categories. Used for deduplication.';

-- =============================================================================
-- EXTRACTION RUNS (Track import operations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS extraction_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id UUID NOT NULL REFERENCES user_libraries(id) ON DELETE CASCADE,

    -- Source
    source_type VARCHAR(50) NOT NULL, -- document, text, url, file
    source_name VARCHAR(500),
    source_hash VARCHAR(64), -- SHA-256 of source content
    document_length INTEGER,

    -- Results
    status VARCHAR(50) DEFAULT 'running', -- running, completed, failed, cancelled

    -- Entity counts (final)
    characters_extracted INTEGER DEFAULT 0,
    locations_extracted INTEGER DEFAULT 0,
    items_extracted INTEGER DEFAULT 0,
    abilities_extracted INTEGER DEFAULT 0,
    factions_extracted INTEGER DEFAULT 0,
    lore_extracted INTEGER DEFAULT 0,
    relationships_extracted INTEGER DEFAULT 0,

    -- Quality metrics
    deduplication_merges INTEGER DEFAULT 0, -- how many entities were merged
    cross_category_fixes INTEGER DEFAULT 0, -- how many were moved to correct category
    inferences_applied INTEGER DEFAULT 0,

    -- Performance
    total_tokens_used INTEGER DEFAULT 0,
    total_duration_ms INTEGER,

    -- Metadata
    settings_json JSONB DEFAULT '{}', -- extraction settings used
    error_message TEXT,

    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_library ON extraction_runs(library_id);
CREATE INDEX IF NOT EXISTS idx_extraction_runs_status ON extraction_runs(status);

-- =============================================================================
-- UPDATE LIBRARY_LORE TO EXCLUDE ITEMS
-- =============================================================================

-- Add field to mark lore that should have been in another category
ALTER TABLE library_lore
ADD COLUMN IF NOT EXISTS should_be_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS migrated_to_id UUID,
ADD COLUMN IF NOT EXISTS confidence VARCHAR(20) DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS extraction_notes TEXT;

COMMENT ON COLUMN library_lore.should_be_category IS 'If set, indicates this lore entry should be in items, abilities, or factions instead';
COMMENT ON COLUMN library_lore.migrated_to_id IS 'If migrated to another table, the ID in that table';

-- Update library_lore entry_type to exclude what's now in other tables
COMMENT ON COLUMN library_lore.entry_type IS 'Valid types: event, rule, history, legend, prophecy, custom. Items, locations, creatures, factions now have dedicated tables.';

-- =============================================================================
-- UPDATE LIBRARY_LOCATIONS
-- =============================================================================

ALTER TABLE library_locations
ADD COLUMN IF NOT EXISTS confidence VARCHAR(20) DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS extraction_notes TEXT;

-- =============================================================================
-- TRIGGERS FOR NEW TABLES
-- =============================================================================

CREATE TRIGGER trigger_library_items_updated
BEFORE UPDATE ON library_items
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_library_abilities_updated
BEFORE UPDATE ON library_abilities
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

CREATE TRIGGER trigger_library_factions_updated
BEFORE UPDATE ON library_factions
FOR EACH ROW EXECUTE FUNCTION update_library_updated_at();

-- =============================================================================
-- HELPFUL VIEWS
-- =============================================================================

-- View to get full character with all relationships
CREATE OR REPLACE VIEW character_full_profile AS
SELECT
    c.*,
    -- Faction memberships
    COALESCE(
        (SELECT json_agg(jsonb_build_object(
            'faction_id', f.id,
            'faction_name', f.name,
            'rank', cfm.rank,
            'role', cfm.role,
            'status', cfm.status
        ))
        FROM character_faction_memberships cfm
        JOIN library_factions f ON f.id = cfm.faction_id
        WHERE cfm.character_id = c.id),
        '[]'::json
    ) as faction_memberships,
    -- Known abilities
    COALESCE(
        (SELECT json_agg(jsonb_build_object(
            'ability_id', a.id,
            'ability_name', a.name,
            'ability_type', a.ability_type,
            'proficiency', ca.proficiency_level
        ))
        FROM character_abilities ca
        JOIN library_abilities a ON a.id = ca.ability_id
        WHERE ca.character_id = c.id),
        '[]'::json
    ) as known_abilities,
    -- Owned items
    COALESCE(
        (SELECT json_agg(jsonb_build_object(
            'item_id', i.id,
            'item_name', i.name,
            'item_type', i.item_type,
            'relationship', ci.relationship_type
        ))
        FROM character_items ci
        JOIN library_items i ON i.id = ci.item_id
        WHERE ci.character_id = c.id),
        '[]'::json
    ) as items
FROM library_characters c;

-- View for entity search across all categories
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
FROM library_lore;

-- =============================================================================
-- ENTITY TYPE DEFINITIONS (Reference data for extraction agents)
-- =============================================================================

COMMENT ON TABLE library_characters IS '
EXTRACT AS CHARACTER IF:
- Has a name and can take actions (sentient beings)
- Is a person, creature, animal companion, pet, familiar, monster, AI, robot, spirit, ghost
- Can speak, think, or make decisions
- Has relationships with other characters
- Dogs, cats, horses, dragons with names = CHARACTERS (even if non-speaking)

DO NOT EXTRACT AS CHARACTER:
- Named vehicles (→ library_items)
- Named weapons or equipment (→ library_items)
- Organizations or groups (→ library_factions)
- Species descriptions without specific individuals (→ library_lore)
';

COMMENT ON TABLE library_items IS '
EXTRACT AS ITEM IF:
- Is a physical object that can be owned, carried, or used
- Vehicles: cars, ships, aircraft, spaceships, wagons, mounts (non-sentient)
- Weapons: swords, guns, staffs, bows
- Armor and clothing
- Tools and equipment
- Artifacts and magical items
- Books, scrolls, documents
- Keys, currency, gems
- Containers, furniture, structures (small enough to move)

DO NOT EXTRACT AS ITEM:
- Sentient vehicles that can think/speak (→ library_characters)
- Buildings or permanent structures (→ library_locations)
- Abstract abilities or powers (→ library_abilities)
';

COMMENT ON TABLE library_abilities IS '
EXTRACT AS ABILITY IF:
- Is a skill, power, spell, feat, or technique
- Can be learned, used, or cast
- Has mechanical effects in gameplay
- Is a class feature, racial ability, or special power

DO NOT EXTRACT AS ABILITY:
- Items that grant abilities (→ library_items with abilities noted)
- Natural character traits like "strong" or "clever" (→ library_characters.traits)
';

COMMENT ON TABLE library_factions IS '
EXTRACT AS FACTION IF:
- Is an organization, group, guild, or collective
- Has multiple members
- Has goals, leadership, or structure
- Kingdoms, nations, tribes, families (as political entities)
- Religions, cults, schools, companies

DO NOT EXTRACT AS FACTION:
- Individual characters who lead factions (→ library_characters)
- Locations where factions operate (→ library_locations)
';

COMMENT ON TABLE library_lore IS '
EXTRACT AS LORE IF:
- Historical events, wars, treaties
- World rules, natural laws, magic system rules
- Legends, myths, prophecies
- General species information (without specific individuals)
- Customs, traditions, holidays
- Economic systems, political systems

DO NOT EXTRACT AS LORE:
- Specific characters (→ library_characters)
- Specific locations (→ library_locations)
- Specific items (→ library_items)
- Specific abilities (→ library_abilities)
- Specific organizations (→ library_factions)
';

-- =============================================================================
-- INITIAL DATA CLEANUP NOTE
-- =============================================================================

-- NOTE: Run this after the migration to clean up existing data:
--
-- 1. Identify lore entries that should be items:
--    SELECT * FROM library_lore WHERE entry_type IN ('item', 'object', 'weapon', 'vehicle', 'artifact');
--
-- 2. Identify lore entries that should be factions:
--    SELECT * FROM library_lore WHERE entry_type IN ('faction', 'organization', 'guild', 'group');
--
-- 3. Identify lore entries that should be creatures (characters):
--    SELECT * FROM library_lore WHERE entry_type = 'creature' AND content LIKE '%named%';
