# CLAUDE.md - Storyteller

Mobile-first bedtime storytelling app with AI-generated audio stories.

## Quick Reference

| Item | Value |
|------|-------|
| Port | 5100 |
| Database | PostgreSQL `storyteller_db` |
| Service | `StorytellerService` (NSSM) |
| Health | `curl http://localhost:5100/api/health` |

## Tech Stack

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: React (Vite, base: `/storyteller/`)
- **AI**: OpenAI GPT-4, ElevenLabs TTS, Venice.ai (mature content)
- **Voice Input**: Whisper service on port 3003

## Commands

```powershell
npm run dev      # Development
npm start        # Production
npm run build    # Build frontend
npm run db:migrate  # Run migrations
```

## Architecture

```
Orchestrator → Story Planner → Scene Writer (C+E) → Voice Agent → Audio
                    ↓
              Lore Agent (consistency) → CYOA Manager (branching)
```

### Critical: C+E Architecture for Voice Casting (v2.1)

**BULLETPROOF VOICE CASTING** - 100% success rate, FAIL LOUD if dialogue_map missing.

```
generateSceneWithDialogue() → Speaker Validation → Voice Assignment → Audio
      (Option C)                 (Option E)
```

**How it works:**
1. **Option C**: Scene writer outputs dialogue_map WITH the prose (speakers named upfront)
2. **Option E**: Speaker validation creates minor characters and assigns voices
3. **FAIL LOUD**: If dialogue_map is missing, orchestrator throws error (no fallbacks)

**Key files**:
- `server/services/openai.js:generateSceneWithDialogue()` - OPTION C
- `server/services/agents/speakerValidationAgent.js` - OPTION E
- `server/services/agents/dialogueSegmentUtils.js` - Converts dialogue_map to segments
- `server/services/agents/DIALOGUE_TAGGING_SYSTEM.md` - Full docs (v2.1)

**ARCHIVED** (moved to `_archived/` folder):
- `dialogueAttributionAgent.js` - was fallback, now archived
- `dialogueTaggingAgent.js` - replaced by C+E, now archived

**DO NOT USE** (deprecated):
- `parseDialogueSegments()` in openai.js (regex-based)
- Narrator fallback in `elevenlabs.js` (removed - will throw errors)

### Voice Prosody (Production)

ElevenLabs v3 with Audio Tags is default. See `VOICE_PROSODY_SYSTEM.md`.

```javascript
// elevenlabs.js - 45 emotion mappings
EMOTION_TO_AUDIO_TAGS = { whispered: '[whispers]', angry: '[angrily]', ... }
```

## Multi-Provider LLM Routing

| Provider | Trigger |
|----------|---------|
| OpenAI | Default (95% of content) |
| Venice.ai | Gore ≥61%, Romance ≥71%, Adult ≥50% |
| OpenRouter | Fallback |

## Database Schema (Core)

```sql
story_sessions (id, user_id, mode, cyoa_enabled, config_json, status)
story_scenes (id, session_id, sequence, text, audio_url, dialogue_map)
characters (id, session_id, name, role, traits_json)
sfx_cache (id, prompt_hash, file_path, duration_seconds)
```

## File Structure

```
server/
├── index.js, routes/, services/
├── services/orchestrator.js     # Main coordination
├── services/agents/             # All agents
├── services/elevenlabs.js       # TTS + multi-voice
├── services/llmProviders.js     # OpenAI/Venice routing
└── database/migrations/
client/src/
├── pages/Story.jsx              # Main playback
├── components/LaunchScreen.jsx  # Generation progress
└── components/StoryBookView.jsx # Reading view
```

## Environment (.env)

```env
PORT=5100
DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/storyteller_db
OPENAI_API_KEY=sk-proj-...
ELEVENLABS_API_KEY=sk_...
VENICE_API_KEY=...
WHISPER_SERVICE_URL=http://localhost:3003
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Scene generation | < 3s |
| TTS generation | < 5s |
| Voice input | < 2s |

## Troubleshooting

- **Port in use**: `netstat -ano | findstr :5100`
- **ElevenLabs fails**: Check API key and quota
- **Voice input broken**: Verify whisper on port 3003

## Extended Documentation

| Document | Content |
|----------|---------|
| `docs/LOGGING_STANDARDS.md` | **Comprehensive logging format & debugging guide** |
| `docs/FEATURES.md` | Three-tier covers, cover layout, SFX timing |
| `docs/API_REFERENCE.md` | All REST endpoints + Socket.IO events |
| `docs/CHANGELOG.md` | Session history and bug fixes |
| `docs/DEV_CONTEXT.md` | Quick context restoration for sessions |
| `docs/SMART_CONFIG.md` | AI auto-configuration requirements |
| `server/services/agents/DIALOGUE_TAGGING_SYSTEM.md` | Multi-voice attribution |
| `server/services/agents/VOICE_PROSODY_SYSTEM.md` | ElevenLabs v3 Audio Tags |

## Key Features (2025-12-13)

### Multi-Voice Tag Display Fix (VERIFIED WORKING)
Tags like `[CHAR:Name]dialogue[/CHAR]` are now properly stripped before display:
- **Server-side**: `orchestrator.js:1568` calls `stripTags()` in return statement
- **Client-side safety net**: `stripCharacterTags()` in `client/src/utils/textUtils.js`
- **Socket handlers fixed**: `handlers.js` - `io` scope issues resolved, audio streaming works

**Critical files**:
- `server/services/orchestrator.js` (line 1568) - Must return `stripTags(finalText)`
- `server/socket/handlers.js` - Uses `getRoomSocketCount()` helper for `io` access
- `client/src/utils/textUtils.js` - Client-side `stripCharacterTags()` backup

**Known Minor Issue**: Slight clicking sound at end of voice-acted lines (audio segment concatenation)

### Three-Tier Cover Art Prompts
LLM generates 3 image prompts with increasing abstraction for DALL-E safety:
- **Level 1 (Direct)**: Specific scene from story with setting/atmosphere
- **Level 2 (Abstract)**: Emotions and themes, symbolic imagery
- **Level 3 (Symbolic)**: Pure metaphor, guaranteed safe (nature, colors, shapes)

System tries Level 1 first, falls back to Level 2, then Level 3 if DALL-E rejects.
**Files**: `server/routes/stories.js:generateCoverPrompts()` (lines 848-939)

### Cover Art Layout (Book Page Style)
Classic book layout where text wraps around floating cover image:
- Cover floats left with `shape-outside: margin-box`
- Text box top aligns with cover top (`margin-top: 0`)
- Hover cover → shows `_` minimize icon (top-right) and regenerate (bottom-left)
- Click cover → fullscreen modal view
- Content order: Title → Story Details Badge → Synopsis → Story

**File**: `client/src/components/BookPageLayout.jsx`

### SFX Timing Guards
Sound effects only play during story narration, never during title/synopsis:
```javascript
// Guard in playSfx()
if (introAudioQueued && !sceneAudioStartedRef.current) return;
```
Uses both `useState` (for UI) and `useRef` (for callbacks) to track audio state.
**File**: `client/src/pages/Story.jsx` (lines 300-411)

### Component Refactoring
Extracted ~450 lines into reusable modules:
- `client/src/constants/authorStyles.js` - Author style data
- `client/src/constants/launchStages.js` - Stage constants
- `client/src/components/launch/` - StageIndicator, CountdownDisplay
- `client/src/components/configure/` - AuthorStylePicker

### Architecture Policies
- **FAIL LOUD**: No fallbacks for missing dialogue_map
- **Deprecated agents archived**: `_archived/dialogueTaggingAgent.js`, `_archived/dialogueAttributionAgent.js`

See `docs/FEATURES.md` for detailed technical documentation.

## Test Plan: Story Generation

### Standard Test Case
```
Premise: "A short scary story about 10 astronauts trapped on a space station
where one of them is secretly an alien creature hunting the others. Extremely
violent with terrifying horror and scifi elements. Multi-voice cast with sound effects"
```

### Test Steps
1. Navigate to Configure Story page (`/storyteller/configure`)
2. Paste the test premise into "Story Premise" field
3. Click "Auto-Detect" button
4. Wait 6 seconds for analysis to complete
5. Verify Auto-Detect correctly identifies:
   - Genre: Horror/Sci-Fi (high intensity)
   - Violence level: High (80%+)
   - Audience: Mature
   - Multi-Voice Narration: Enabled
   - Hide Speech Tags: Enabled (auto-enabled with multi-voice)
   - Sound Effects: Enabled
6. Scroll down, verify Hide Speech Tags shows "(auto-enabled)" indicator
7. Click "Start Story"
8. Monitor browser console for errors during generation
9. Verify story generates without "Failed to generate next scene" errors

### Expected Behavior (v2025-12-11)
- **Multi-Voice → Hide Speech Tags**: Toggling Multi-Voice ON auto-enables Hide Speech Tags
- **Multi-Voice → Hide Speech Tags**: Toggling Multi-Voice OFF auto-disables Hide Speech Tags
- **Manual Override**: User can still manually toggle Hide Speech Tags after auto-set
- **SFX Timing**: Sound effects only play during story narration, not title/synopsis

### Known Issues (Fixed 2025-12-11)
- **GPT-5.1 Empty Content**: OpenAI's GPT-5.1 returns empty content via Chat Completions API.
  - Fix: Downgraded premium tier to GPT-4o until migration to Responses API
  - See: `server/services/modelSelection.js`
- **Duplicate Voice Assignments**: LLM sometimes assigns same voice to multiple characters.
  - Fix: Added `repairDuplicateAssignments()` in voiceAssignmentAgent.js
  - Auto-repairs by reassigning to unused voices of same gender

### Active Investigation: Multi-Voice Narration Issues (2025-12-12)

**Status**: UNDER INVESTIGATION - Position-based architecture is fundamentally fragile

**Symptoms**:
- Narrator speaks character dialogue lines
- Character voices speak narration text
- Lines repeated, fragmented, or cut off

**Root Cause**: Position-based dialogue extraction breaks when text is modified after positions are calculated.

**Fix Applied**: `willUseMultiVoice` now uses session config and skips text polishing to preserve positions.

**Full Documentation**: `docs/MULTI_VOICE_DEBUG_SESSION_2025-12-12.md`

**Key Files**:
- Position calculation: `server/services/openai.js` lines 1435-1591
- Segment building: `server/services/agents/dialogueSegmentUtils.js` lines 247-381
- Multi-voice decision: `server/services/orchestrator.js` lines 783-795

**Recommended Long-term Fix**: Tag-based markup (`[CHAR:John]dialogue[/CHAR]`) instead of positions

## Logging System (v2025-12-12)

Comprehensive logging for complete system visibility. Full documentation: `docs/LOGGING_STANDARDS.md`

### Log Prefixes

| Prefix | Location | What It Tracks |
|--------|----------|----------------|
| `[Audio]` | Client | Audio state machine transitions (IDLE→INTRO_QUEUED→SCENE_PLAYING→ENDED) |
| `[SFX]` | Client | SFX trigger/block decisions with reason codes |
| `[Queue]` | Client | Audio queue operations (ENQUEUE, DEQUEUE, CLEAR) |
| `[Socket:Emit]` | Client | Socket.IO emissions (continue-story, submit-choice) |
| `[Socket:Recv]` | Client | Socket.IO receives (audio-ready, intro-audio-ready) |
| `[Scene+Dialogue]` | Server | Position calculation for dialogue_map |
| `[SegmentBuilder]` | Server | Segment conversion with char positions |
| `[SpeechTagAgent]` | Server | Speech tag filtering decisions |
| `[MultiVoice]` | Server | Multi-voice segment processing |

### Key Log Patterns for Debugging

**SFX plays during synopsis**:
```
[Audio] STATE: * → INTRO_QUEUED
[SFX] TRIGGER_BLOCKED | reason: intro_audio_active
```
If SFX triggered while `introAudioQueued=true` and `sceneAudioStarted=false`, guard failed.

**Narrator repeats dialogue**:
```
[SegmentBuilder] DUPLICATE_DETECTED
[Scene+Dialogue] OVERLAP
```

**Quote position not found**:
```
[Scene+Dialogue] QUOTE[n] NO_MATCH
[Scene+Dialogue] QUOTE[n] FALLBACK | method: estimated
```

### Enable Client Debug Mode

```javascript
// In browser console:
localStorage.setItem('storyteller_debug', 'true');
// Or:
window.storytellerDebug(true);
```

### Server Log Files

| File | Content |
|------|---------|
| `logs/combined.log` | All server logs (JSON) |
| `logs/error.log` | Errors only |
| `logs/ai-calls.log` | LLM API calls |

```powershell
# View recent logs
Get-Content C:\inetpub\wwwroot\storyteller\logs\combined.log -Tail 100

# Search specific prefix
Select-String -Path .\logs\combined.log -Pattern "\[SpeechTagAgent\]" | Select-Object -Last 50
```
