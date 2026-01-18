# Library & Story Generation System Requirements

**Created**: 2025-12-13
**Status**: Requirements Documented - Implementation Pending
**Priority**: HIGH - Foundation for cost-aware user experience

## Overview

The library system must support stories in various states of completion, with clear visibility into token costs and the ability to generate/preview content before committing to expensive audio generation.

## Core Concept: Separation of Text and Audio Generation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GENERATION PHASES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PHASE 1: TEXT GENERATION (Low Cost - OpenAI tokens)                    │
│  ├── Story outline, title, synopsis                                     │
│  ├── All chapter text content                                           │
│  ├── Character definitions                                              │
│  ├── Dialogue attribution (who says what)                               │
│  └── SFX detection (what sounds, when)                                  │
│                                                                          │
│  PHASE 2: ASSET GENERATION (Medium Cost - DALL-E)                       │
│  ├── Cover art                                                          │
│  └── Scene images (optional)                                            │
│                                                                          │
│  PHASE 3: AUDIO GENERATION (High Cost - ElevenLabs tokens)              │
│  ├── Voice assignment                                                   │
│  ├── TTS narration per chapter                                          │
│  ├── Multi-voice dialogue                                               │
│  └── SFX audio files                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Principle**: Users should be able to iterate on Phase 1 and Phase 2 freely before committing to Phase 3 (the expensive part).

## Story States

### State Definitions

| State | Description | Token Cost to Play | Visual Indicator |
|-------|-------------|-------------------|------------------|
| `draft` | Outline only, no chapters | HIGH (full generation) | Gray / Draft badge |
| `text_complete` | All chapters written, no audio | HIGH (audio generation) | Blue / Text Only badge |
| `partial_audio` | Some chapters have audio | MEDIUM (remaining chapters) | Yellow / Partial badge |
| `fully_narrated` | All chapters have audio | FREE | Green / Complete badge |

### Database Schema Addition

```sql
-- Add to story_sessions table
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS generation_state VARCHAR(20)
  DEFAULT 'draft'
  CHECK (generation_state IN ('draft', 'text_complete', 'partial_audio', 'fully_narrated'));

ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS total_chapters INTEGER DEFAULT 0;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS narrated_chapters INTEGER DEFAULT 0;

-- Track which chapters have audio
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS has_audio BOOLEAN DEFAULT FALSE;
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS audio_generated_at TIMESTAMP;
```

### State Transitions

```
draft → text_complete (when all chapters generated as text)
text_complete → partial_audio (when first chapter gets audio)
partial_audio → fully_narrated (when all chapters have audio)

Any state → draft (if user regenerates story from scratch)
partial_audio → text_complete (if user clears all audio)
```

## Library Display Requirements

### Story Card Information

Each story in the library should display:

```
┌────────────────────────────────────────────────────┐
│ [Cover Image]                                       │
│                                                     │
│ Title: "The Haunted Station"                       │
│ Genre: Horror/Sci-Fi                               │
│                                                     │
│ Status: [PARTIAL - 2/5 Narrated]  ← Yellow badge   │
│                                                     │
│ ⚠️ Playing will use tokens for chapters 3-5        │
│                                                     │
│ [▶ Play] [📝 Edit] [🔊 Generate Audio] [🗑️ Delete] │
└────────────────────────────────────────────────────┘
```

### Token Warning System

Before playing a story that isn't fully narrated:

```
┌────────────────────────────────────────────────────┐
│  ⚠️ This story is not fully narrated               │
│                                                     │
│  Playing will generate audio for:                  │
│  • Chapters 3, 4, 5 (estimated 15 min audio)       │
│  • ~50,000 ElevenLabs characters                   │
│                                                     │
│  [Generate All Audio First]  [Play Anyway]  [Cancel]│
└────────────────────────────────────────────────────┘
```

## Text-First Generation Mode

### User Flow

1. **Configure Story** → User sets premise, genre, settings
2. **Generate Text** → All chapters generated as TEXT ONLY
3. **Review & Refine** → User can:
   - Read all chapters
   - Regenerate specific chapters
   - Regenerate entire story
   - Adjust character names/traits
   - Preview detected SFX
4. **Generate Audio** → When satisfied, commit to audio generation
5. **Play** → Story is now fully narrated and free to replay

### UI Toggle/Option

On the Configure page, add option:

```
Generation Mode:
○ Full Generation (text + audio immediately)
● Text First (review before audio)  ← DEFAULT for cost-conscious users

[ℹ️] Text First mode lets you review and refine your story
    before using ElevenLabs tokens for narration.
```

### Text-First Preview Screen

After text generation completes:

```
┌─────────────────────────────────────────────────────────────────┐
│  "The Haunted Station" - Text Preview                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Chapter 1: The Arrival          [Regenerate] [Edit]            │
│  ──────────────────────────────────────────────────             │
│  Captain Torres stepped off the shuttle and onto...              │
│  [Read More ↓]                                                   │
│                                                                  │
│  Chapter 2: Strange Sounds       [Regenerate] [Edit]            │
│  ──────────────────────────────────────────────────             │
│  The first night aboard the station was anything but...          │
│  [Read More ↓]                                                   │
│                                                                  │
│  ... (chapters 3-5)                                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Sound Effects Detected: 12                    [Preview SFX →]   │
│  Characters: 5                                 [View Cast →]     │
│  Estimated Audio: ~18 minutes                                    │
├─────────────────────────────────────────────────────────────────┤
│  [← Back to Edit]    [🔊 Generate All Audio]    [Save Draft]    │
└─────────────────────────────────────────────────────────────────┘
```

## Regeneration Capabilities

### What Can Be Regenerated

| Item | Scope | Cost | Notes |
|------|-------|------|-------|
| Entire story | Full regeneration | OpenAI tokens | Keeps config, regenerates all |
| Single chapter | Chapter text only | OpenAI tokens | Maintains continuity with lore agent |
| Chapter audio | Re-narrate one chapter | ElevenLabs tokens | Keep same text |
| Cover art | New image | DALL-E tokens | Three-tier prompt system |
| SFX detection | Re-scan all chapters | OpenAI tokens | Find new SFX opportunities |
| Single SFX | Generate new sound | ElevenLabs/SFX API | Replace one sound effect |

### Regeneration UI

Each chapter should have a menu:

```
Chapter 3: The Discovery
├── [🔄 Regenerate Text] - Rewrite this chapter
├── [🔊 Regenerate Audio] - Re-narrate (same text)
├── [🎵 Re-scan SFX] - Find new sound effects
└── [✏️ Edit Text] - Manual editing (future feature)
```

## SFX System Requirements

### SFX Data Model

```javascript
// Enhanced SFX data structure
{
  id: "sfx_001",
  scene_id: "scene_uuid",
  sfx_key: "sword_clash",           // Asset identifier

  // Timing (word-index based)
  timing_type: "word_range" | "looping" | "point",
  start_word_index: 45,             // Index into word_timings.words[]
  end_word_index: 48,               // For word_range type
  // OR for looping:
  loop: true,
  loop_start_word: 0,               // Start at beginning
  loop_fade_out_word: null,         // Fade out at end of scene

  // Audio properties
  volume: 0.3,
  fade_in_ms: 500,
  fade_out_ms: 1000,

  // Detection metadata
  trigger_text: "leaped to the side",  // The text that triggered detection
  reason: "Sword attack dodge action",
  detected_at: "2025-12-13T...",

  // Preview state
  preview_url: "/audio/sfx/sword_clash.mp3",
  is_approved: true,                 // User approved after preview
  user_modified: false               // User changed settings
}
```

### SFX Timing Types

| Type | Description | Example |
|------|-------------|---------|
| `point` | Single moment, short sound | Sword clash at "blocked" |
| `word_range` | Start to end over phrase | Whoosh during "leaped to the side" |
| `looping` | Continuous ambient sound | Engine hum throughout scene |

### SFX Preview Interface

```
┌─────────────────────────────────────────────────────────────────┐
│  Sound Effects for Chapter 1                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 🔊 Engine Hum (ambient_engine_hum)                          │
│     Type: Looping (entire scene)                                │
│     Trigger: "The hum of the ships engines"                     │
│     [▶ Preview]  [🔄 Regenerate]  [❌ Remove]  [📍 Show in Text] │
│                                                                  │
│  2. 🔊 Sword Whoosh (combat_sword_swing)                        │
│     Type: Word Range (words 12-15)                              │
│     Trigger: "leaped to the side"                               │
│     [▶ Preview]  [🔄 Regenerate]  [❌ Remove]  [📍 Show in Text] │
│                                                                  │
│  3. 🔊 Sword Clash (combat_sword_block)                         │
│     Type: Point (word 28)                                       │
│     Trigger: "blocked"                                          │
│     [▶ Preview]  [🔄 Regenerate]  [❌ Remove]  [📍 Show in Text] │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [+ Add Custom SFX]  [Re-scan All]  [✓ Approve All & Continue]  │
└─────────────────────────────────────────────────────────────────┘
```

### "Show in Text" Feature

When user clicks [📍 Show in Text], the chapter text is displayed with highlighting:

```
┌─────────────────────────────────────────────────────────────────┐
│  SFX: Sword Whoosh                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Conan [HIGHLIGHT START →]leaped to the side[← HIGHLIGHT END]   │
│  just in time to avoid a sword slash to the chest, then         │
│  countered with a death blow that was blocked by his foe        │
│  at the last moment.                                            │
│                                                                  │
│  Legend: [███] = SFX plays during this text                     │
│                                                                  │
│  [← Back to SFX List]  [Adjust Timing]  [▶ Preview with Audio]  │
└─────────────────────────────────────────────────────────────────┘
```

For looping sounds:

```
┌─────────────────────────────────────────────────────────────────┐
│  SFX: Engine Hum (LOOPING)                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [███ LOOPING SOUND - ENTIRE SCENE ███████████████████████████] │
│                                                                  │
│  He walked down the hallway, observing the open rooms as he     │
│  passes. The hum of the ships engines a constant comfort as     │
│  he heads to the deck.                                          │
│                                                                  │
│  🔄 This sound loops continuously throughout the scene          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema Updates

### Enhanced SFX Table

```sql
-- Replace or enhance scene_sfx table
CREATE TABLE IF NOT EXISTS scene_sfx_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,

  -- Asset reference
  sfx_key VARCHAR(100) NOT NULL,
  sfx_category VARCHAR(50),  -- 'ambient', 'combat', 'nature', etc.

  -- Timing (word-index based)
  timing_type VARCHAR(20) NOT NULL CHECK (timing_type IN ('point', 'word_range', 'looping')),
  start_word_index INTEGER,      -- Index into word_timings.words[]
  end_word_index INTEGER,        -- For word_range, null for point/looping
  loop BOOLEAN DEFAULT FALSE,

  -- Audio properties
  volume DECIMAL(3,2) DEFAULT 0.30,
  fade_in_ms INTEGER DEFAULT 500,
  fade_out_ms INTEGER DEFAULT 1000,

  -- Detection metadata
  trigger_text TEXT,             -- The phrase that triggered detection
  detection_reason TEXT,
  detected_at TIMESTAMP DEFAULT NOW(),

  -- User approval workflow
  is_approved BOOLEAN DEFAULT FALSE,
  user_modified BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMP,

  -- Generated audio reference
  audio_url VARCHAR(500),
  audio_generated_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_scene_sfx_v2_scene ON scene_sfx_v2(scene_id);
CREATE INDEX idx_scene_sfx_v2_approved ON scene_sfx_v2(scene_id, is_approved);
```

### Story Session State Tracking

```sql
-- Enhanced story_sessions for generation state
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(20)
  DEFAULT 'full'
  CHECK (generation_mode IN ('full', 'text_first'));

ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS generation_state VARCHAR(20)
  DEFAULT 'draft'
  CHECK (generation_state IN ('draft', 'text_complete', 'partial_audio', 'fully_narrated'));

ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS sfx_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS sfx_approval_required BOOLEAN DEFAULT TRUE;
```

## API Endpoints Needed

### Story Generation Control

```
POST /api/stories/:id/generate-text-only
  - Generate all chapter text without audio
  - Returns: { chapters: [...], sfx_detected: [...] }

POST /api/stories/:id/generate-chapter/:chapterIndex
  - Regenerate specific chapter text
  - Maintains lore consistency

POST /api/stories/:id/generate-audio
  - Generate audio for all chapters (after text approval)
  - Can be called incrementally

POST /api/stories/:id/chapters/:chapterIndex/generate-audio
  - Generate audio for single chapter
```

### SFX Management

```
GET /api/stories/:id/sfx
  - Get all SFX for story with timing info

POST /api/stories/:id/sfx/rescan
  - Re-detect SFX opportunities

PUT /api/stories/:id/sfx/:sfxId
  - Update SFX settings (timing, volume, etc.)

DELETE /api/stories/:id/sfx/:sfxId
  - Remove an SFX

POST /api/stories/:id/sfx/:sfxId/regenerate
  - Generate new audio for this SFX

POST /api/stories/:id/sfx/approve-all
  - Mark all SFX as approved

GET /api/stories/:id/sfx/:sfxId/text-highlight
  - Get word indices for highlighting
```

### Library Queries

```
GET /api/library
  - Returns stories with generation_state
  - Include token cost estimates for incomplete stories

GET /api/library/:id/playability
  - Returns detailed cost estimate if played
  - Which chapters need generation
```

## User Preferences

```javascript
// User preferences for generation
{
  default_generation_mode: 'text_first' | 'full',
  require_sfx_approval: true,
  auto_play_after_generation: false,
  show_token_warnings: true,

  // Per-story overrides possible
}
```

## Summary: What Must Be True Before Audio Generation

Before any ElevenLabs tokens are spent, the system should verify:

1. ✅ All chapter text is generated and reviewed
2. ✅ Characters are defined with voice preferences
3. ✅ SFX are detected and approved (if approval required)
4. ✅ User has explicitly chosen to generate audio
5. ✅ Token warning shown (if story not fully narrated)

This ensures users never accidentally spend tokens on content they haven't reviewed.

## Implementation Priority

1. **Phase 1**: Story state tracking (generation_state column)
2. **Phase 2**: Text-first generation mode toggle
3. **Phase 3**: Library UI with state badges and warnings
4. **Phase 4**: SFX preview and approval workflow
5. **Phase 5**: Word-index based SFX timing
6. **Phase 6**: Regeneration capabilities

## Current State Assessment

### Database Schema Gap Analysis (2025-12-13)

**story_sessions table:**
| Column | Current | Needed | Gap |
|--------|---------|--------|-----|
| `generation_state` | ❌ None | draft/text_complete/partial_audio/fully_narrated | **ADD** |
| `generation_mode` | ❌ None | full/text_first | **ADD** |
| `total_chapters` | ✅ `total_scenes` exists | - | OK |
| `narrated_chapters` | ❌ None | Count of scenes with audio | **ADD** |
| `sfx_approved` | ❌ None | Boolean | **ADD** |
| `current_status` | ✅ Exists (planning/narrating/etc) | - | OK (different purpose) |

**story_scenes table:**
| Column | Current | Needed | Gap |
|--------|---------|--------|-----|
| `audio_url` | ✅ Exists | Presence indicates audio | OK |
| `is_recorded` | ✅ Exists | - | OK |
| `word_timings` | ✅ JSONB exists | Per-word timing for karaoke | OK |
| `has_audio` | ❌ Implicit only | Explicit boolean | **ADD** (or use audio_url IS NOT NULL) |
| `audio_generated_at` | ❌ None | Timestamp | **ADD** |

**scene_sfx table:**
| Column | Current | Needed | Gap |
|--------|---------|--------|-----|
| `timing_type` | ❌ None | point/word_range/looping | **ADD** |
| `start_word_index` | ❌ None (has start_offset_seconds) | Word index | **ADD** |
| `end_word_index` | ❌ None | Word index for ranges | **ADD** |
| `loop` | ❌ None | Boolean | **ADD** |
| `is_approved` | ❌ None | User approval flag | **ADD** |
| `trigger_text` | ✅ `detected_keyword` exists | - | OK (rename?) |
| `volume` | ✅ Exists | - | OK |
| `fade_in/out` | ✅ Exists (seconds) | Change to ms? | MINOR |

### Feature Gap Summary

| Feature | Current State | Gap |
|---------|--------------|-----|
| Story states | ❌ Not tracked | Need `generation_state` column |
| Text-first mode | ❌ Not available | Need toggle + workflow |
| Token warnings | ❌ Not shown | Need cost estimation UI |
| SFX preview | ❌ Not available | Need preview UI |
| SFX word timing | ⚠️ Time-based only | Need word-index precision |
| SFX approval | ❌ Not tracked | Need approval workflow |
| Regeneration | ⚠️ Partial | Need per-chapter controls |
| Looping SFX | ⚠️ Implicit | Need explicit `loop` flag |

### Recommended Migration

```sql
-- Phase 1: Story state tracking
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS generation_state VARCHAR(20)
  DEFAULT 'draft' CHECK (generation_state IN ('draft', 'text_complete', 'partial_audio', 'fully_narrated'));
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(20)
  DEFAULT 'full' CHECK (generation_mode IN ('full', 'text_first'));
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS narrated_chapters INTEGER DEFAULT 0;
ALTER TABLE story_sessions ADD COLUMN IF NOT EXISTS sfx_approved BOOLEAN DEFAULT FALSE;

-- Phase 2: Scene audio tracking
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS audio_generated_at TIMESTAMP;

-- Phase 3: Enhanced SFX timing
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS timing_type VARCHAR(20) DEFAULT 'point'
  CHECK (timing_type IN ('point', 'word_range', 'looping'));
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS start_word_index INTEGER;
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS end_word_index INTEGER;
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS loop BOOLEAN DEFAULT FALSE;
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE scene_sfx ADD COLUMN IF NOT EXISTS trigger_text TEXT;
```

This document should be reviewed before implementing the recording system to ensure the foundation supports these requirements.
