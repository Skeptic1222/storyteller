# Multi-Voice Narration System - Developer Notes

## Overview

This document describes the upgraded multi-voice narration system implemented as part of the ChatGPT upgrade plan. The system provides intelligent voice selection, quality tier management, and professional audio assembly for story narration.

## Architecture

### New Services Created

| Service | File | Purpose |
|---------|------|---------|
| Voice Selection | `server/services/voiceSelectionService.js` | AI-driven voice matching for narrators and characters |
| Voice Sync | `server/services/elevenlabsVoiceSync.js` | Sync voices from ElevenLabs API to database |
| Quality Tier Config | `server/services/qualityTierConfig.js` | Manage TTS quality tiers and cost controls |
| Audio Assembler | `server/services/audioAssembler.js` | Professional audio assembly with crossfades |
| Gender Inference | `server/utils/genderInference.js` | Name-based gender detection with confidence scoring |

### Database Changes

Migration: `server/database/migrations/011_voice_system_upgrade.sql`

**Extended Tables:**
- `elevenlabs_voices` - 20+ new columns for voice metadata (tags, language_codes, quality_score, energy_level, pitch_hint, narrator_suitable, character_suitable, etc.)

**New Tables:**
- `voice_archetypes` - 12 character archetypes with selection criteria
- `story_voice_assignments` - Per-story voice casting
- `voice_sync_log` - Voice sync operation history
- `voice_quality_tiers` - Configurable quality tier settings

## Voice Selection System

### Archetypes

The system includes 12 pre-defined voice archetypes:

| Key | Description | Gender | Age | Energy |
|-----|-------------|--------|-----|--------|
| `male_hero` | Confident male protagonist | Male | Adult | 50-80 |
| `male_villain` | Menacing male antagonist | Male | Adult | 40-70 |
| `male_elder` | Wise older male | Male | Elder | 20-50 |
| `male_comic` | Light-hearted male | Male | Any | 60-90 |
| `male_young` | Youthful male | Male | Young | 50-85 |
| `female_hero` | Confident female protagonist | Female | Adult | 50-80 |
| `female_villain` | Menacing female antagonist | Female | Adult | 40-70 |
| `female_elder` | Wise older female | Female | Elder | 20-50 |
| `female_comic` | Light-hearted female | Female | Any | 60-90 |
| `female_young` | Youthful female | Female | Young | 50-85 |
| `creature` | Non-human entity | Any | Any | 30-100 |
| `child` | Child character | Any | Child | 50-90 |

### Usage Examples

```javascript
import * as voiceSelection from './services/voiceSelectionService.js';

// Get narrator voice
const narrator = await voiceSelection.getNarratorVoice({
  mood: 'mysterious',
  genre: 'fantasy',
  language: 'en',
  qualityTier: 'premium'
});

// Get character voice
const characterVoice = await voiceSelection.getCharacterVoice({
  name: 'Lord Blackwood',
  gender: 'male',
  age: 'elder',
  role: 'antagonist',
  personality: 'menacing, calculating'
}, {
  sessionId: 'story-123',
  qualityTier: 'standard'
});

// Get voice cast for multiple characters
const cast = await voiceSelection.getVoiceCast([
  { name: 'Elena', role: 'protagonist', gender: 'female' },
  { name: 'Marcus', role: 'support', gender: 'male' },
  { name: 'The Dragon', role: 'antagonist', species: 'creature' }
], { sessionId: 'story-123' });
```

## Quality Tiers

### Tier Configuration

| Tier | Model | Cost | Latency | Use Case |
|------|-------|------|---------|----------|
| `premium` | eleven_multilingual_v2 | 1.0x | Medium | Final output, short stories |
| `standard` | eleven_turbo_v2_5 | 0.5x | Low | Most stories (default) |
| `economy` | eleven_turbo_v2_5 | 0.5x | Low | Long stories, budget-conscious |
| `fast` | eleven_flash_v2_5 | 0.25x | Very Low | Previews, drafts |

### Usage Limits

```javascript
const TIER_LIMITS = {
  premium: { maxCharsPerStory: 50000, maxCharsPerScene: 5000 },
  standard: { maxCharsPerStory: 100000, maxCharsPerScene: 8000 },
  economy: { maxCharsPerStory: 150000, maxCharsPerScene: 10000 },
  fast: { maxCharsPerStory: 200000, maxCharsPerScene: 15000 }
};
```

### Cost Estimation

```javascript
import { estimateTTSCost } from './services/elevenlabs.js';

const cost = estimateTTSCost('Your story text here...', 'standard');
// Returns: { characters: 25, credits: 13, costUsd: 0.004, model: 'eleven_turbo_v2_5' }
```

## Audio Assembly

### FFmpeg-Based Crossfades

When FFmpeg is available, the audio assembler provides:
- Smooth crossfade transitions between speakers
- Gap insertion between segments
- Audio normalization
- SFX mixing support

### Assembly Presets

```javascript
import { ASSEMBLY_PRESETS, assembleMultiVoiceAudio } from './services/audioAssembler.js';

// Available presets
ASSEMBLY_PRESETS.bedtime   // Smooth transitions, longer gaps
ASSEMBLY_PRESETS.dramatic  // Quick cuts, shorter gaps
ASSEMBLY_PRESETS.natural   // Balanced pacing
ASSEMBLY_PRESETS.raw       // No transitions (debug)

// Usage
const result = await assembleMultiVoiceAudio(segments, {
  crossfadeMs: 100,
  gapMs: 200,
  normalize: true
});
```

## Gender Inference

### Confidence Levels

| Confidence | Level | Source |
|------------|-------|--------|
| 0.9+ | Very High | Explicit pronouns (she/her, he/him) |
| 0.8-0.9 | High | Name database match |
| 0.65-0.8 | Medium | Name ending patterns |
| 0.55-0.65 | Low | Context keywords |
| <0.55 | Uncertain | No clear indicators |

### Usage

```javascript
import { inferGender, getConfidenceLabel } from './utils/genderInference.js';

const result = inferGender('Elena Blackwood', {
  description: 'A fierce warrior queen',
  role: 'protagonist'
});
// Returns: { gender: 'female', confidence: 0.92, reason: 'female_name_western' }

getConfidenceLabel(0.92); // 'very_high'
```

## API Endpoints

### Voice Selection

```
POST /api/voices/select-narrator
POST /api/voices/select-character
POST /api/voices/cast
POST /api/voices/infer-gender
```

### Archetypes

```
GET  /api/voices/archetypes
GET  /api/voices/archetypes/:key
```

### Quality Tiers

```
GET  /api/voices/quality-tiers
POST /api/voices/quality-tiers/recommend
GET  /api/voices/usage/:sessionId
POST /api/voices/usage/check
POST /api/voices/cost-estimate
```

### Voice Management

```
POST /api/voices/sync-full
GET  /api/voices/sync-status
POST /api/voices/preview-styled
GET  /api/voices/hud/:sessionId
```

## ElevenLabs Model Support

### Models

| Model ID | Name | Features |
|----------|------|----------|
| `eleven_multilingual_v2` | Multilingual v2 | Full style, 29 languages, best quality |
| `eleven_turbo_v2_5` | Turbo v2.5 | Style + speed, 32 languages, fast |
| `eleven_flash_v2_5` | Flash v2.5 | Speed only, 32 languages, ultra-fast |
| `eleven_monolingual_v1` | Monolingual v1 | English only, legacy |

### Voice Settings

```javascript
// Voice settings structure
{
  stability: 0.5,          // 0-1: Lower = more expressive
  similarity_boost: 0.75,  // 0-1: Voice consistency
  style: 0.3,              // 0-1: Style exaggeration (model-dependent)
  use_speaker_boost: true  // Enhance voice clarity
}
```

### Preset Voice Settings

```javascript
// Available presets in VOICE_PRESETS
calm_bedtime, dramatic, playful, mysterious, action, horror,
warm_gentle, dramatic_theatrical, playful_energetic, mysterious_dark
```

## Voice Sync Process

### Automatic Sync

```javascript
import * as voiceSync from './services/elevenlabsVoiceSync.js';

// Full sync from ElevenLabs account
const result = await voiceSync.syncVoicesFromElevenLabs({
  includeDisabled: false,
  updateExisting: true
});

// Check sync status
const status = await voiceSync.getSyncStatus();
```

### What Gets Synced

- Voice ID, name, description
- Labels (gender, age, accent)
- Preview URLs
- Auto-extracted tags from voice name
- Inferred metadata (energy_level, pitch_hint, narrator_suitable)

## Migration Instructions

### Running the Migration

```sql
-- Run migration
psql -U postgres -d storyteller_db -f server/database/migrations/011_voice_system_upgrade.sql
```

### Post-Migration Steps

1. **Sync voices from ElevenLabs:**
   ```bash
   curl -X POST http://localhost:5100/api/voices/sync-full
   ```

2. **Verify archetypes seeded:**
   ```bash
   curl http://localhost:5100/api/voices/archetypes
   ```

3. **Test voice selection:**
   ```bash
   curl -X POST http://localhost:5100/api/voices/select-narrator \
     -H "Content-Type: application/json" \
     -d '{"mood":"mysterious","genre":"fantasy"}'
   ```

## Troubleshooting

### FFmpeg Not Available

If FFmpeg is not installed, the audio assembler falls back to simple buffer concatenation. This may cause audio artifacts at segment boundaries.

**Solution:** Install FFmpeg:
```bash
# Windows
choco install ffmpeg

# Or download from https://ffmpeg.org/download.html
```

### Voice Not Found Errors

If voice selection returns fallback voices:
1. Run `/api/voices/sync-full` to sync from ElevenLabs
2. Check that voices have `available = true` in database
3. Verify archetypes match voice metadata

### Tier Limits Exceeded

If TTS generation fails due to limits:
1. Check usage with `/api/voices/usage/:sessionId`
2. Consider upgrading to higher tier or extending limits
3. Reset scene usage after scene completion

## Performance Considerations

### Voice Cache

- Voice data is cached in memory for 5 minutes
- Refresh with `voiceSelectionService.refreshVoiceCaches()`

### Audio Cache

- Generated audio is cached to disk
- Cache key: SHA-256 of text + voice_id
- Clean old cache with `elevenlabs.cleanCache(30)` (30 days)

### Database Indexes

Ensure indexes exist on:
- `elevenlabs_voices(voice_id)`
- `elevenlabs_voices(gender, available)`
- `story_voice_assignments(session_id)`
- `voice_archetypes(archetype_key)`

## Future Improvements

1. **Voice Cloning Support** - User-uploaded voice samples
2. **Emotion Detection** - Auto-adjust voice settings based on scene emotion
3. **Real-time Streaming** - WebSocket-based audio streaming
4. **Multi-language Stories** - Dynamic language switching per character
5. **Voice Aging** - Modify voice for flashback/flash-forward scenes
