# Deep Research Request: Advanced AI Story Engine Architecture

## Purpose

This document provides comprehensive context about the Storyteller application - an AI-powered narrative generation platform. We need deep research on how to build a **superior story engine** comparable to commercial products like Sudowrite, NovelAI, AI Dungeon, and other advanced narrative AI systems.

---

## Current System Overview

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend | Node.js + Express | API server, agent orchestration |
| Frontend | React (Vite) | Mobile-first PWA with voice UI |
| Database | PostgreSQL | Story persistence, lore tracking |
| AI - Text | OpenAI GPT-4 / GPT-4o-mini | Story generation, multi-agent collaboration |
| AI - Voice In | OpenAI Whisper | Speech-to-text transcription |
| AI - Voice Out | ElevenLabs TTS | High-quality narration with prosody control |
| Real-time | Socket.IO | Voice streaming, live updates |

---

## Database Architecture

### Core Tables

```sql
-- Story Sessions (one per story playthrough)
story_sessions (
    id UUID PRIMARY KEY,
    user_id UUID,
    mode ENUM('storytime', 'advanced'),
    cyoa_enabled BOOLEAN,                    -- Choose Your Own Adventure mode
    bedtime_mode BOOLEAN,                    -- Calming content filter
    config_json JSONB,                       -- All story configuration
    current_status ENUM('planning', 'narrating', 'paused', 'waiting_choice', 'finished'),
    title VARCHAR(255),
    total_scenes INTEGER,
    current_scene_index INTEGER,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    last_activity_at TIMESTAMP
)

-- Story Outlines (narrative structure)
story_outlines (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    outline_json JSONB,                      -- Full outline: acts, scenes, themes
    themes TEXT[],
    target_duration_minutes INTEGER,
    notes TEXT,
    version INTEGER                          -- Support outline revisions
)

-- Story Scenes (individual narrative chunks)
story_scenes (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    sequence_index INTEGER,
    branch_key VARCHAR(50),                  -- CYOA branching: "A1", "A1-B2"
    parent_scene_id UUID,                    -- For branching stories
    raw_text TEXT,                           -- Original AI output
    polished_text TEXT,                      -- TTS-optimized version
    summary TEXT,
    word_count INTEGER,
    audio_url VARCHAR(500),
    audio_duration_seconds FLOAT,
    voice_id VARCHAR(100),
    mood VARCHAR(50),                        -- cozy, tense, exciting, calm, scary
    intensity_level INTEGER                  -- 0-100
)

-- CYOA Choices
story_choices (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    scene_id UUID,
    choice_index INTEGER,
    choice_key VARCHAR(10),                  -- A, B, C, D
    choice_text VARCHAR(500),
    choice_description TEXT,
    leads_to_scene_id UUID,
    was_selected BOOLEAN,
    selected_at TIMESTAMP
)

-- Characters (story cast)
characters (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    world_id UUID,                           -- For cross-session reuse
    name VARCHAR(100),
    role VARCHAR(100),                       -- protagonist, antagonist, mentor
    description TEXT,
    personality TEXT,
    traits_json JSONB,
    backstory TEXT,
    voice_description TEXT,                  -- For multi-voice narration
    appearance TEXT,
    portrait_url VARCHAR(500),               -- AI-generated character art
    relationships_json JSONB,
    is_recurring BOOLEAN
)

-- Lore Entries (world-building)
lore_entries (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    entry_type VARCHAR(50),                  -- location, object, event, rule, history
    title VARCHAR(200),
    content TEXT,
    tags TEXT[],
    importance INTEGER,                      -- 0-100, for context pruning
    parent_location_id UUID                  -- Hierarchical locations
)

-- Conversation Tracking
conversation_turns (
    id UUID PRIMARY KEY,
    story_session_id UUID,
    role ENUM('user', 'system', 'orchestrator', 'planner', 'writer', 'narrator', 'lore', 'safety', 'cyoa', 'advocate'),
    modality ENUM('voice', 'text', 'ui', 'internal'),
    content TEXT,
    audio_url VARCHAR(500),
    transcription_confidence FLOAT,
    agent_metadata JSONB,
    tokens_used INTEGER
)

-- ElevenLabs Voice Cache
elevenlabs_voices (
    voice_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100),
    category VARCHAR(50),                    -- premade, cloned, generated
    description TEXT,
    labels JSONB,
    preview_url VARCHAR(500),
    settings_json JSONB,
    gender VARCHAR(20),
    age_group VARCHAR(20),
    accent VARCHAR(50),
    style VARCHAR(50),
    is_available BOOLEAN
)

-- Audio Cache (avoid regenerating same TTS)
audio_cache (
    id UUID PRIMARY KEY,
    text_hash VARCHAR(64),                   -- SHA-256 of text + voice_id
    voice_id VARCHAR(100),
    text_preview VARCHAR(200),
    file_path VARCHAR(500),
    file_size_bytes INTEGER,
    duration_seconds FLOAT,
    access_count INTEGER,
    last_accessed_at TIMESTAMP,
    UNIQUE(text_hash, voice_id)
)

-- Hot-reloadable Agent Prompts
agent_prompts (
    id UUID PRIMARY KEY,
    agent_name VARCHAR(50) UNIQUE,
    system_prompt TEXT,
    description TEXT,
    model VARCHAR(50),
    temperature FLOAT,
    max_tokens INTEGER,
    is_active BOOLEAN,
    version INTEGER
)
```

---

## Multi-Agent System Architecture

The story engine uses **8 specialized AI agents** coordinated by an orchestrator:

```
                    ┌─────────────────┐
                    │   ORCHESTRATOR  │
                    │  (Coordinator)  │
                    └────────┬────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
┌────┴────┐            ┌─────┴─────┐           ┌─────┴─────┐
│ PLANNER │            │  WRITER   │           │ NARRATOR  │
│(Outline)│            │ (Scenes)  │           │  (TTS)    │
└─────────┘            └───────────┘           └───────────┘
     │                       │                       │
┌────┴────┐            ┌─────┴─────┐           ┌─────┴─────┐
│  LORE   │            │  SAFETY   │           │   VOICE   │
│(Keeper) │            │ (Filter)  │           │(ElevenLabs│
└─────────┘            └───────────┘           └───────────┘
     │                       │
┌────┴────┐            ┌─────┴─────┐
│  CYOA   │            │ ADVOCATE  │
│(Choices)│            │(Creativity│
└─────────┘            └───────────┘
```

### Agent Responsibilities

| Agent | Model | Purpose | Token Budget |
|-------|-------|---------|--------------|
| **Orchestrator** | GPT-4 | Coordinates agents, manages flow, routes tasks | 500 |
| **Planner** | GPT-4 | Creates story outlines with acts, themes, characters | 1500 |
| **Writer** | GPT-4 | Generates scene prose (100-200 words/scene) | 800 |
| **Narrator** | GPT-4o-mini | Polishes text for TTS (pauses, emphasis, pacing) | 600 |
| **Lore Keeper** | GPT-4o-mini | Ensures character/world consistency | 400 |
| **Safety** | GPT-4o-mini | Content filtering based on user preferences | 300 |
| **CYOA Manager** | GPT-4 | Creates meaningful branching choices | 500 |
| **Devil's Advocate** | GPT-4 | Suggests creative alternatives, avoids clichés | 400 |

### Agent System Prompts (Current Implementation)

```javascript
// PLANNER AGENT
"You are the Story Planner. Given user preferences, create compelling story outlines.
Output JSON with:
- title: Story title
- setting: World/location description
- main_characters: Array of {name, role, brief_description}
- themes: Array of theme strings
- acts: Array of {act_number, summary, key_events[], estimated_scenes}
- tone: Overall story tone
- target_length: short/medium/long"

// WRITER AGENT
"You are the Scene Writer. Create vivid, engaging prose for spoken narration.
Guidelines:
- Write in present tense, active voice
- Target 100-200 words per scene (30-90 seconds of audio)
- Use sensory descriptions
- Include natural dialogue
- Avoid complex sentences that trip up TTS
- End scenes at natural pause points"

// LORE KEEPER AGENT
"You are the Lore Keeper. Maintain story consistency.
Check:
1. Character consistency (names, traits, relationships)
2. Location accuracy (descriptions, distances)
3. Timeline coherence (events, cause-effect)
4. Rule compliance (magic systems, world rules)"

// SAFETY AGENT
"You are the Safety Agent. Review content for appropriateness.
Enforce limits based on user preferences:
- Horror level (0-100)
- Gore/violence level (0-100)
- Romance level (0-100)
For bedtime mode, ensure content promotes relaxation."

// CYOA AGENT
"You are the CYOA Manager. At branch points, create 2-4 meaningful choices that:
- Lead to genuinely different story paths
- Are clearly distinguishable
- Fit the narrative naturally
- Include at least one 'safe' option
- Are phrased for easy voice selection"

// ADVOCATE AGENT
"You are the Devil's Advocate. Suggest:
- More interesting plot twists
- Unexpected character developments
- Creative wildcard options
- Ways to avoid clichés"
```

---

## Literary DNA System (Current Implementation)

We've implemented "literary DNA" - style-specific prompting to emulate famous authors:

```javascript
const LITERARY_STYLES = {
  howard: {
    name: 'Robert E. Howard (Sword & Sorcery)',
    description: 'Fast-paced action, cunning heroes, sinister magic',
    promptTemplate: `Write in the style of Robert E. Howard's sword and sorcery.
      - Fast, energetic prose with vivid action
      - Protagonist uses cunning and physical prowess
      - Magic is rare, dangerous, used by villains
      - Focus on human adversaries (cultists, raiders, schemers)
      - Colorful, roughhewn dialogue`
  },
  lovecraft: {
    name: 'H.P. Lovecraft (Cosmic Horror)',
    description: 'Atmospheric dread, cosmic insignificance, eldritch horrors',
    promptTemplate: `Write in the style of H.P. Lovecraft's cosmic horror.
      - Build atmosphere through meticulous sensory description
      - Archaic, elevated vocabulary (eldritch, cyclopean, squamous)
      - Suggest rather than show horrors directly
      - First-person perspective with psychological deterioration
      - Theme: forbidden knowledge leads to madness`
  },
  tolkien: {
    name: 'J.R.R. Tolkien (Epic Fantasy)',
    description: 'Rich world-building, formal prose, deep history',
    promptTemplate: `Write in the style of J.R.R. Tolkien's epic fantasy.
      - Formal, elevated narrative voice with archaic structures
      - Deep world-building: histories, cultures, landscapes
      - Multiple narrative voices (historian, poet, naturalist)
      - Slow build-up with character depth
      - Sense of events within larger historical narrative`
  },
  king: {
    name: 'Stephen King (Modern Horror)',
    description: 'Small-town America, character-driven horror, building dread',
    promptTemplate: `Write in the style of Stephen King's horror.
      - Focus on ordinary people in extraordinary situations
      - Rich internal monologue and character psychology
      - Build tension slowly before explosive horror
      - Authentic dialogue with regional flavor
      - Mix mundane details with supernatural dread`
  },
  shakespeare: {
    name: 'Shakespearean Drama',
    promptTemplate: `Write in a Shakespearean dramatic style.
      - Elevated, poetic dialogue with iambic rhythms
      - Soliloquies revealing character thoughts
      - Dramatic irony and foreshadowing
      - Themes of fate, ambition, love, and betrayal`
  },
  fairytale: {
    name: 'Classic Fairy Tale',
    promptTemplate: `Write in the style of classic fairy tales (Brothers Grimm).
      - Simple, accessible prose with rhythmic patterns
      - Clear hero/villain archetypes
      - Magic and magical helpers
      - Moral clarity: virtue rewarded, wickedness punished`
  },
  bedtime: {
    name: 'Bedtime Story',
    promptTemplate: `Write a calming bedtime story.
      - Simple, flowing sentences with gentle tone
      - Soothing vocabulary and repetitive phrases
      - Low-stimulation, peaceful themes
      - Target 300-400 words per scene`
  },
  scifi: { name: 'Science Fiction', ... },
  detective: { name: 'Detective Noir', ... },
  romance: { name: 'Romance', ... },
  adventure: { name: 'Adventure', ... },
  comedy: { name: 'Comedy', ... }
};
```

---

## Narrator Style Presets (ElevenLabs Prosody Control)

```javascript
const NARRATOR_STYLES = {
  warm: {
    name: 'Warm & Gentle',
    stability: 0.7,
    similarity_boost: 0.8,
    style: 20,
    speed: 0.9
  },
  dramatic: {
    name: 'Dramatic',
    stability: 0.3,
    similarity_boost: 0.85,
    style: 80,
    speed: 0.85
  },
  playful: {
    name: 'Playful',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 60,
    speed: 1.1
  },
  mysterious: {
    name: 'Mysterious',
    stability: 0.8,
    similarity_boost: 0.9,
    style: 30,
    speed: 0.8
  },
  horror: {
    name: 'Horror',
    stability: 0.85,
    similarity_boost: 0.9,
    style: 25,
    speed: 0.75
  },
  epic: {
    name: 'Epic',
    stability: 0.4,
    similarity_boost: 0.85,
    style: 70,
    speed: 0.9
  },
  whimsical: {
    name: 'Whimsical',
    stability: 0.45,
    similarity_boost: 0.7,
    style: 55,
    speed: 1.15
  },
  noir: {
    name: 'Noir',
    stability: 0.75,
    similarity_boost: 0.85,
    style: 35,
    speed: 0.85
  }
};
```

---

## Story Generation Flow

### Phase 1: Configuration (Conversational)
```
1. User taps "Start" button
2. System greets user via TTS
3. Conversation flow (15 steps):
   - Story type selection (narrative/CYOA/campaign)
   - Multiplayer check (solo or with others)
   - Literary style selection
   - Narrator voice selection (with audio previews)
   - Narrator style selection (dramatic, playful, etc.)
   - Genre/theme preferences
   - Story length
   - Content intensity
   - Multi-voice option
   - Summary and confirmation
   - Story naming
4. Configuration saved to story_sessions.config_json
```

### Phase 2: Outline Generation
```
1. Planner agent receives config
2. Generates outline with:
   - Title
   - Setting description
   - Character list with roles
   - Act structure with key events
   - Theme list
   - Target scene count
3. Characters saved to database
4. Initial lore entries created
5. Session status → 'narrating'
```

### Phase 3: Scene Generation Loop
```
For each scene:
1. Writer agent generates raw scene text
2. Safety agent reviews against user limits
3. Lore keeper checks consistency
4. Narrator agent polishes for TTS
5. (If CYOA) CYOA agent generates choices
6. Scene saved to database
7. ElevenLabs generates audio
8. Audio cached to filesystem
9. Audio URL returned to client
10. Client plays audio
11. (If CYOA) Wait for choice selection
12. Loop until story complete
```

### Phase 4: Story Completion
```
1. Final scene flagged as ending
2. Narrator generates closing summary
3. Session status → 'finished'
4. Statistics calculated (duration, scenes, choices)
```

---

## Research Questions

Please research the following topics and provide detailed findings:

### 1. Commercial Story Engine Analysis

**Sudowrite (sudowrite.com)**
- How does their "Story Engine" work?
- What is their "beat system" for narrative structure?
- How do they handle long-form coherence (50,000+ words)?
- What makes their prose quality superior?
- Any published research or patents?

**NovelAI**
- What models do they use (custom fine-tuned)?
- How do they handle style consistency?
- What is their "Lorebook" system?
- How do they manage memory across long stories?

**AI Dungeon**
- How do they handle infinite branching narratives?
- What is their world state management approach?
- How do they balance creativity vs coherence?

**Character.AI**
- How do they maintain character consistency?
- What techniques for persona adherence?

### 2. Academic Research on Narrative AI

- **Story generation algorithms** - What are the state-of-the-art approaches?
- **Narrative coherence** - How to maintain plot consistency over long texts?
- **Character consistency** - Techniques for maintaining character voice/personality
- **Plot structure** - Formal models (Save the Cat, Hero's Journey, three-act structure)
- **Dialogue generation** - Making characters sound distinct
- **Emotional arc** - Managing tension/release, pacing

### 3. Open Source & Available Tools

- Are there **open-source story engines** we could integrate or learn from?
- Any **freeware narrative AI** tools available?
- Useful **libraries** for:
  - Story structure analysis
  - Character tracking
  - Plot coherence checking
  - Dialogue attribution
  - Sentiment/mood analysis
- Any **fine-tuned models** available (HuggingFace, etc.) for creative writing?

### 4. Advanced Prompting Techniques

- **Chain-of-thought** for narrative planning
- **Tree-of-thought** for branching stories
- **Self-consistency** checking
- **Constitutional AI** for content guidelines
- **Few-shot learning** for style mimicry
- **Retrieval-augmented generation (RAG)** for lore consistency

### 5. Memory & Context Management

- How to handle **context window limitations** for long stories?
- **Hierarchical summarization** techniques
- **Semantic compression** of story state
- **Vector embeddings** for relevant context retrieval
- **Knowledge graphs** for character/world relationships

### 6. Multi-Voice & Audio Production

- Best practices for **multi-character dialogue** with different TTS voices
- **Audio drama production** techniques
- **Sound effect integration** possibilities
- **Music/ambient** integration approaches

### 7. Interactive Narrative Systems

- **CYOA optimization** - How to make choices meaningful?
- **Branching narrative compression** - Avoiding combinatorial explosion
- **Player agency vs narrative coherence** balance
- **Campaign/RPG mechanics** integration
- **Multiplayer narrative** coordination

### 8. Quality Metrics

- How to **measure story quality** programmatically?
- **Coherence scoring** algorithms
- **Engagement prediction** models
- **Reader satisfaction** metrics

---

## Desired Output Format

Please provide:

1. **Executive Summary** (1-2 pages)
   - Key findings
   - Most impactful recommendations
   - Priority implementation order

2. **Detailed Research Report** (as comprehensive as possible)
   - Each topic area above
   - Specific techniques with implementation details
   - Code examples where applicable
   - Links to resources, papers, repositories

3. **Architecture Recommendations**
   - Suggested improvements to our multi-agent system
   - New agents to add
   - Prompt engineering improvements
   - Database schema changes

4. **Open Source Resources**
   - List of all relevant open-source tools
   - Which are production-ready vs experimental
   - Integration complexity assessment

5. **Implementation Roadmap**
   - Phased approach to upgrading the story engine
   - Quick wins vs long-term investments
   - Technical dependencies

---

## Context About Our Goals

We want to build a **world-class storytelling platform** that can:

1. Generate stories indistinguishable from human authors
2. Maintain perfect coherence across long narratives
3. Support any genre/style the user desires
4. Provide cinematic audio narration with multiple voices
5. Enable deep interactive experiences (CYOA, D&D campaigns)
6. Support multiplayer collaborative storytelling
7. Remember and build upon previous stories
8. Create persistent worlds users can revisit

The ultimate vision is an **AI Dungeon Master** that can run infinite campaigns, tell bedtime stories, create audiobooks, and everything in between.

---

## Technical Constraints

- We're using **OpenAI GPT-4** (can't train custom models easily)
- **ElevenLabs** for TTS (3000+ voices, prosody controls)
- **PostgreSQL** for persistence
- **Node.js** backend
- Need to work within API **rate limits** and **token costs**

---

Please provide the most comprehensive research possible. This will directly inform the development of our next-generation story engine.
