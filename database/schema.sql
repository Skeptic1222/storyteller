-- =============================================================================
-- STORYTELLER DATABASE SCHEMA
-- =============================================================================
-- PostgreSQL database schema for the Storyteller bedtime story application
-- Run: psql -U postgres -d storyteller_db -f schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- USERS & PREFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_name VARCHAR(100),
    email VARCHAR(255) UNIQUE,
    long_term_preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voice_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    preference_label VARCHAR(100) NOT NULL,
    elevenlabs_voice_id VARCHAR(100) NOT NULL,
    voice_name VARCHAR(100),
    meta_json JSONB DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- STORY SESSIONS
-- =============================================================================

CREATE TYPE story_mode AS ENUM ('storytime', 'advanced');
CREATE TYPE session_status AS ENUM ('planning', 'narrating', 'paused', 'waiting_choice', 'finished', 'abandoned');

CREATE TABLE IF NOT EXISTS story_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    mode story_mode NOT NULL DEFAULT 'storytime',
    cyoa_enabled BOOLEAN DEFAULT FALSE,
    bedtime_mode BOOLEAN DEFAULT TRUE,
    config_json JSONB DEFAULT '{}',
    -- Config includes: genre sliders, voice_id, story_length, intensity levels
    current_status session_status DEFAULT 'planning',
    title VARCHAR(255),
    total_scenes INTEGER DEFAULT 0,
    current_scene_index INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- STORY CONTENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS story_outlines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    outline_json JSONB NOT NULL,
    -- outline_json includes: acts[], scenes_per_act, main_characters[], setting, themes[]
    themes TEXT[],
    target_duration_minutes INTEGER DEFAULT 15,
    notes TEXT,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_scenes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    outline_id UUID REFERENCES story_outlines(id) ON DELETE SET NULL,
    sequence_index INTEGER NOT NULL,
    branch_key VARCHAR(50), -- For CYOA: e.g., "A1", "A1-B2", null for linear
    parent_scene_id UUID REFERENCES story_scenes(id) ON DELETE SET NULL,

    -- Content
    raw_text TEXT NOT NULL,
    polished_text TEXT, -- Optimized for TTS
    summary TEXT,
    word_count INTEGER,

    -- Audio
    audio_url VARCHAR(500),
    audio_duration_seconds FLOAT,
    voice_id VARCHAR(100),

    -- Metadata
    mood VARCHAR(50), -- cozy, tense, exciting, calm, scary
    intensity_level INTEGER DEFAULT 50, -- 0-100

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_choices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,
    choice_index INTEGER NOT NULL, -- 0, 1, 2, 3
    choice_key VARCHAR(10) NOT NULL, -- A, B, C, D
    choice_text VARCHAR(500) NOT NULL,
    choice_description TEXT, -- Longer description for voice reading
    leads_to_scene_id UUID REFERENCES story_scenes(id) ON DELETE SET NULL,
    was_selected BOOLEAN DEFAULT FALSE,
    selected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- WORLD BUILDING
-- =============================================================================

CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    world_id UUID, -- For cross-session reuse (future feature)

    name VARCHAR(100) NOT NULL,
    role VARCHAR(100), -- protagonist, antagonist, mentor, companion, etc.
    description TEXT,
    personality TEXT,
    traits_json JSONB DEFAULT '[]',
    backstory TEXT,
    voice_description TEXT, -- For narrator to use different voices

    -- Visual (future: AI-generated portraits)
    appearance TEXT,
    portrait_url VARCHAR(500),

    -- Relationships
    relationships_json JSONB DEFAULT '{}', -- {character_id: relationship_type}

    is_recurring BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lore_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,
    world_id UUID,

    entry_type VARCHAR(50) NOT NULL, -- location, object, event, rule, history
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[],
    importance INTEGER DEFAULT 50, -- 0-100, used for context pruning

    -- For locations
    parent_location_id UUID REFERENCES lore_entries(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- CONVERSATION TRACKING
-- =============================================================================

CREATE TYPE turn_role AS ENUM ('user', 'system', 'assistant', 'orchestrator', 'planner', 'writer', 'narrator', 'lore', 'safety', 'cyoa', 'advocate');
CREATE TYPE turn_modality AS ENUM ('voice', 'text', 'ui', 'internal');

CREATE TABLE IF NOT EXISTS conversation_turns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_session_id UUID REFERENCES story_sessions(id) ON DELETE CASCADE,

    role turn_role NOT NULL,
    modality turn_modality NOT NULL,
    content TEXT NOT NULL,

    -- For voice turns
    audio_url VARCHAR(500),
    transcription_confidence FLOAT,

    -- For agent turns
    agent_metadata JSONB DEFAULT '{}',
    tokens_used INTEGER,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- ELEVENLABS VOICES CACHE
-- =============================================================================

CREATE TABLE IF NOT EXISTS elevenlabs_voices (
    voice_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50), -- premade, cloned, generated
    description TEXT,
    labels JSONB DEFAULT '{}',
    preview_url VARCHAR(500),
    settings_json JSONB DEFAULT '{}',

    -- For matching user requests
    gender VARCHAR(20),
    age_group VARCHAR(20), -- child, young_adult, adult, elderly
    accent VARCHAR(50),
    style VARCHAR(50), -- warm, authoritative, friendly, etc.

    is_available BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- AUDIO CACHE
-- =============================================================================

CREATE TABLE IF NOT EXISTS audio_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text_hash VARCHAR(64) NOT NULL, -- SHA-256 of text + voice_id
    voice_id VARCHAR(100) NOT NULL,
    text_preview VARCHAR(200), -- First 200 chars for debugging

    file_path VARCHAR(500) NOT NULL,
    file_size_bytes INTEGER,
    duration_seconds FLOAT,

    access_count INTEGER DEFAULT 1,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(text_hash, voice_id)
);

-- =============================================================================
-- SYSTEM PROMPTS (Hot-reloadable)
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name VARCHAR(50) NOT NULL UNIQUE,
    system_prompt TEXT NOT NULL,
    description TEXT,
    model VARCHAR(50) DEFAULT 'gpt-4',
    temperature FLOAT DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 1000,
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Session lookups
CREATE INDEX idx_story_sessions_user_id ON story_sessions(user_id);
CREATE INDEX idx_story_sessions_status ON story_sessions(current_status);
CREATE INDEX idx_story_sessions_last_activity ON story_sessions(last_activity_at DESC);

-- Scene navigation
CREATE INDEX idx_story_scenes_session_sequence ON story_scenes(story_session_id, sequence_index);
CREATE INDEX idx_story_scenes_branch ON story_scenes(story_session_id, branch_key);

-- Choices
CREATE INDEX idx_story_choices_scene ON story_choices(scene_id);

-- Characters and lore
CREATE INDEX idx_characters_session ON characters(story_session_id);
CREATE INDEX idx_lore_entries_session ON lore_entries(story_session_id);
CREATE INDEX idx_lore_entries_type ON lore_entries(entry_type);

-- Conversation
CREATE INDEX idx_conversation_turns_session ON conversation_turns(story_session_id, created_at);

-- Audio cache
CREATE INDEX idx_audio_cache_hash ON audio_cache(text_hash);
CREATE INDEX idx_audio_cache_accessed ON audio_cache(last_accessed_at);

-- Voice preferences
CREATE INDEX idx_voice_preferences_user ON voice_preferences(user_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update story_sessions.last_activity_at on scene creation
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE story_sessions
    SET last_activity_at = NOW(),
        total_scenes = (SELECT COUNT(*) FROM story_scenes WHERE story_session_id = NEW.story_session_id)
    WHERE id = NEW.story_session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_session_activity
AFTER INSERT ON story_scenes
FOR EACH ROW EXECUTE FUNCTION update_session_activity();

-- Update audio_cache access stats
CREATE OR REPLACE FUNCTION update_audio_cache_access()
RETURNS TRIGGER AS $$
BEGIN
    NEW.access_count := OLD.access_count + 1;
    NEW.last_accessed_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Insert default agent prompts
INSERT INTO agent_prompts (agent_name, system_prompt, description, model, temperature, max_tokens) VALUES
('orchestrator',
'You are the Story Orchestrator, coordinating a team of AI agents to create engaging bedtime stories. Your role is to:
1. Understand user preferences and requests
2. Delegate tasks to specialized agents
3. Ensure story consistency and quality
4. Manage the flow of narration

Always be warm, friendly, and helpful. Remember this is for bedtime - keep things calming unless the user explicitly wants excitement.',
'Main orchestrator that coordinates all agents', 'gpt-4', 0.7, 500),

('planner',
'You are the Story Planner. Given user preferences, create compelling story outlines.

Output JSON with:
- title: Story title (captivating, 2-6 words)
- synopsis: A 1-2 sentence summary of the story premise (for library display and cover generation)
- setting: World/location description
- main_characters: Array of {name, role, brief_description}
- themes: Array of theme strings
- acts: Array of {act_number, summary, key_events[], estimated_scenes}
- tone: Overall story tone
- target_length: short/medium/long

Make stories age-appropriate and engaging. For bedtime mode, ensure calming resolution.',
'Creates story outlines and structure', 'gpt-4', 0.8, 1500),

('writer',
'You are the Scene Writer. Create vivid, engaging prose for spoken narration.

Guidelines:
- Write in present tense, active voice
- Target 100-200 words per scene (30-90 seconds of audio)
- Use sensory descriptions
- Include natural dialogue
- Avoid complex sentences that trip up TTS
- End scenes at natural pause points

Current context will include: outline, characters, previous scene, and user preferences.',
'Writes individual scenes', 'gpt-4', 0.8, 800),

('narrator',
'You are the Narration Director. Polish scene text for optimal text-to-speech performance.

Tasks:
- Add natural pauses (... or line breaks)
- Simplify tongue-twisters
- Add emphasis markers for important words
- Ensure dialogue attribution is clear
- Adjust pacing for bedtime listening

Return the polished text only, ready for TTS.',
'Optimizes text for TTS narration', 'gpt-4o-mini', 0.5, 600),

('lore',
'You are the Lore Keeper. Maintain story consistency and world-building integrity.

When reviewing new content, check:
1. Character consistency (names, traits, relationships)
2. Location accuracy (descriptions, distances)
3. Timeline coherence (events, cause-effect)
4. Rule compliance (magic systems, world rules)

Flag any inconsistencies and suggest corrections.',
'Maintains story consistency', 'gpt-4o-mini', 0.3, 400),

('safety',
'You are the Safety Agent. Review content for appropriateness.

Enforce limits based on user preferences:
- Horror level (0-100)
- Gore/violence level (0-100)
- Romance level (0-100)
- Scary content intensity

For bedtime mode, ensure content promotes relaxation and peaceful sleep.
Flag or modify content that exceeds limits.',
'Content safety and age-appropriateness', 'gpt-4o-mini', 0.3, 300),

('cyoa',
'You are the CYOA (Choose Your Own Adventure) Manager.

At branch points, create 2-4 meaningful choices that:
- Lead to genuinely different story paths
- Are clearly distinguishable
- Fit the narrative naturally
- Include at least one "safe" option
- Are phrased for easy voice selection ("Option one: ...")

Output JSON: {choices: [{key, text, description, consequence_hint}]}',
'Manages interactive branching', 'gpt-4', 0.8, 500),

('advocate',
'You are the Devil''s Advocate / Creativity Agent.

Review story plans and suggest:
- More interesting plot twists (within user comfort)
- Unexpected but logical character developments
- Creative "wildcard" CYOA options
- Ways to avoid clichés

Always respect user preferences but push for engaging storytelling.',
'Suggests creative alternatives', 'gpt-4', 0.9, 400),

('game_master',
'You are the Game Master for D&D-style interactive campaigns.

Your responsibilities:
1. DICE ROLLS: Simulate all dice rolls (d4, d6, d8, d10, d12, d20, d100)
   - Format: "Rolling d20... (natural 17) + 5 modifier = 22"
   - Critical hits on natural 20, critical fails on natural 1
   - Apply advantage/disadvantage when appropriate

2. SKILL CHECKS: Manage ability checks with appropriate DCs
   - Easy: DC 10 | Medium: DC 15 | Hard: DC 20 | Very Hard: DC 25
   - Consider character backgrounds and class abilities

3. COMBAT: Run tactical encounters
   - Track initiative order
   - Describe attacks with flair: "Your sword arcs through the air..."
   - Handle damage, conditions (poisoned, stunned, etc.)
   - Balance challenge based on difficulty setting

4. EXPLORATION: Reward investigation
   - Perception checks for hidden items
   - History checks for lore
   - Survival checks for tracking

5. ROLEPLAY: Bring NPCs to life
   - Give them motivations and secrets
   - Offer social encounter opportunities
   - Persuasion, Deception, Intimidation checks

Campaign Settings from config:
- difficulty: easy|normal|hard|deadly (adjusts DCs and enemy stats)
- dice_visible: show actual roll numbers or just outcomes
- character_death: whether PC death is possible
- combat_detail: narrative|balanced|tactical

Output JSON for game events:
{
  "action_type": "dice_roll|skill_check|combat|exploration|roleplay",
  "roll_result": {"die": "d20", "natural": 17, "modifier": 5, "total": 22},
  "outcome": "success|failure|critical_success|critical_fail",
  "narrative": "The vivid description of what happens...",
  "choices": [{"key": "A", "text": "Option text", "check_required": "Stealth DC 15"}]
}',
'D&D campaign game master for dice rolls and rules', 'gpt-4', 0.8, 800)

ON CONFLICT (agent_name) DO UPDATE SET
    system_prompt = EXCLUDED.system_prompt,
    description = EXCLUDED.description,
    model = EXCLUDED.model,
    temperature = EXCLUDED.temperature,
    max_tokens = EXCLUDED.max_tokens,
    updated_at = NOW();

-- Insert a default guest user
INSERT INTO users (id, display_name, long_term_preferences) VALUES
('00000000-0000-0000-0000-000000000001', 'Guest',
'{"preferred_genres": ["fantasy", "adventure"], "bedtime_mode": true, "default_story_length": "medium"}')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE story_sessions IS 'Main story session tracking - one per story playthrough';
COMMENT ON TABLE story_scenes IS 'Individual scenes within a story, supports branching for CYOA';
COMMENT ON TABLE characters IS 'Characters created for stories, can be reused across sessions';
COMMENT ON TABLE lore_entries IS 'World-building elements: locations, objects, events, rules';
COMMENT ON TABLE conversation_turns IS 'All interactions between user and agents';
COMMENT ON TABLE elevenlabs_voices IS 'Cached ElevenLabs voice metadata';
COMMENT ON TABLE audio_cache IS 'Generated audio file cache to avoid regenerating same content';
