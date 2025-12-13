# ChatGPT Architecture Review Prompt

Copy and paste this entire prompt into ChatGPT (GPT-4 or later) to get improvement ideas for the Storyteller application.

---

## PROMPT START

I have built a **Storyteller** application - a mobile-first bedtime storytelling web app that generates personalized audio stories using AI. I need your help identifying areas for improvement, optimization opportunities, and innovative features I might be missing.

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Backend | Node.js + Express | API server, agent orchestration |
| Frontend | React + Vite + TailwindCSS | Mobile-first touch/voice UI |
| Database | PostgreSQL | Story sessions, lore, characters, audio cache |
| AI - Text | OpenAI GPT-4/4o-mini | Story generation, multi-agent collaboration |
| AI - Voice In | OpenAI Whisper | Speech-to-text via microservice |
| AI - Voice Out | ElevenLabs TTS | Story narration, multi-voice characters |
| AI - SFX | ElevenLabs SFX API | AI-generated sound effects |
| AI - Images | DALL-E 3 | Story cover art generation |
| Real-time | Socket.IO | Voice streaming, live updates |
| Hosting | Windows IIS | Reverse proxy to Node.js backend |

### Multi-Agent System Architecture

The storytelling engine uses 8+ specialized AI agents coordinated by an orchestrator:

```
Orchestrator (session lifecycle, agent routing, parallel execution)
    ├── Story Planner (outline, acts, scenes, character introductions)
    ├── Lore Agent (characters, locations, timeline consistency)
    ├── Scene Writer (prose generation with author style matching)
    ├── Narration Director (TTS optimization, pacing, sentence simplification)
    ├── Voice Agent (ElevenLabs integration, multi-voice character assignment)
    ├── CYOA Manager (branching choices, diamond structure convergence)
    ├── Safety Agent (content filtering, gore/violence/romance limits)
    ├── Validation Agent (catch missing words, placeholders, TTS artifacts)
    └── SFX Coordinator (AI-powered ambient sound detection and selection)
```

**Parallel Execution Pattern:**
```javascript
// Run independent checks in parallel for responsiveness
const [safetyResult, loreResult, polishedText, storyFacts] = await Promise.all([
  checkSafety(rawText, preferences),
  checkLoreConsistency(rawText, characters, lore),
  polishForNarration(rawText),
  extractStoryFacts(rawText, outline)
]);
```

### Database Schema (Key Tables)

- `story_sessions` - User sessions with config_json (JSONB for flexible settings)
- `story_outlines` - Narrative structure with acts, synopsis, bible_json
- `story_scenes` - Individual scenes with audio_url, mood, branch_key (CYOA)
- `story_choices` - CYOA branching with leads_to_scene_id relationships
- `characters` - Character data with traits_json, relationships_json
- `character_voice_assignments` - Persist voice consistency across scenes
- `lore_entries` - World-building with keyword triggers and importance weights
- `audio_cache` - Deduplication via SHA-256(text + voice_id)
- `recordings` - Complete story playback with word-level timings
- `recording_segments` - Scene audio + SFX + choice data for replay

### Key Features Implemented

1. **Choose Your Own Adventure (CYOA)**
   - Diamond structure (converges toward ending, prevents infinite branches)
   - Checkpoint system with backtracking
   - Choice history visualization with tree view
   - Voice command support ("Option A", "Follow the shadow")

2. **Multi-Voice Narration**
   - Dialogue parsing to identify speakers
   - Automatic character → voice assignment based on role/gender/personality
   - Voice consistency persisted across all scenes
   - Narrator + multiple character voices in single audio stream

3. **Karaoke-Style Read-Along**
   - Word-level timestamps from ElevenLabs API
   - Binary search for efficient word highlighting
   - Smooth CSS transitions between words
   - Fullscreen mode with cover art background

4. **AI Sound Effects**
   - SFX Coordinator agent analyzes scene mood/setting/genre
   - Library of 100+ ambient sounds (weather, locations, creatures, etc.)
   - On-demand generation via ElevenLabs SFX API
   - Crossfade between ambient layers

5. **Pre-Playback Launch Sequence**
   - Sequential validation: Voices → SFX → Cover Art → Quality Checks
   - Visual progress indicators with retry capability
   - Cinematic countdown (Pre-cue → 5...4...3...2...1 → GO!)
   - OCR validation on cover art to verify title text

6. **Story Recording & Replay**
   - Complete story recordings with all audio + SFX + choices
   - Path recovery for interrupted playbacks
   - Divergence handling (play recording or make different choice)
   - Export capability

7. **Conversation Engine (Voice-First)**
   - Natural language story setup ("Tell me a scary story about dragons")
   - Multi-step conversational flow for configuration
   - 8 narrator style presets (warm, dramatic, playful, noir, epic, etc.)
   - Voice command interpretation for story control

8. **Dynamic Lorebook**
   - Keyword-triggered context injection
   - Importance-weighted entries for context pruning
   - Prevents contradictions (character names, locations, timeline)
   - Hierarchical location support

### API Structure (12 Route Modules)

- `/api/stories` - Session management, scene generation, CYOA choices
- `/api/voices` - ElevenLabs voice library, previews, character matching
- `/api/config` - User preferences, narrator styles, agent prompts
- `/api/library` - Story history, bookmarks, favorites
- `/api/recordings` - Recording CRUD, playback, path recovery
- `/api/sfx` - Sound effect library, generation, scene detection
- `/api/lorebook` - World-building entries, triggers, import/export
- `/api/multiplayer` - Collaborative storytelling (turn-based)
- `/api/auth` - Google OAuth, usage tracking
- `/api/paypal` - Subscription management
- `/api/admin` - User management, system stats
- `/api/health` - Service health checks

### Socket.IO Events

**Client → Server:** join-session, voice-input, continue-story, start-playback, submit-choice, pause/resume, rtc-audio, retry-stage, regenerate-cover

**Server → Client:** session-joined, generating, scene-generated, audio-ready, choice-accepted, launch-sequence-ready, countdown updates, error events

### Current Configuration Options

```json
{
  "story_type": "cyoa|narrative|campaign",
  "story_length": "short|medium|long",
  "genre": "fantasy|scifi|mystery|romance|horror",
  "voice_id": "elevenlabs_voice_id",
  "narrator_style": "warm|dramatic|playful|noir|epic|mysterious|gentle|authoritative",
  "author_style": "tolkien|king|shakespeare|rowling|sanderson",
  "bedtime_mode": true,
  "cyoa_enabled": true,
  "multi_voice": true,
  "sfx_enabled": true,
  "intensity": { "gore": 0, "scary": 30, "romance": 20, "violence": 20 },
  "audience": "general|children|mature",
  "story_format": "short_story|novella|novel|series",
  "plot_settings": { "structure": "three_act", "ensure_resolution": true }
}
```

### Known Issues / Pain Points

1. **ElevenLabs Credit Usage**: Audio is pre-generated during scene creation even if user doesn't start playback. Should defer to playback time.

2. **Context Window Management**: Long stories can exceed token limits. Currently auto-summarize at 80% of 120k budget.

3. **Mobile Performance**: Large audio buffers (base64 in Socket.IO) can cause memory pressure on older devices.

4. **CYOA Complexity**: Diamond structure works but limits creative branching possibilities.

---

## Questions for Analysis

Based on this architecture, please provide:

1. **Architecture Improvements**: What structural changes would improve scalability, maintainability, or performance?

2. **Feature Gaps**: What features are common in similar applications that I'm missing?

3. **AI Agent Optimization**: How could the multi-agent system be improved? Are there better patterns for agent coordination?

4. **User Experience Enhancements**: What UX improvements would make bedtime storytelling more engaging?

5. **Cost Optimization**: How can I reduce OpenAI/ElevenLabs API costs without sacrificing quality?

6. **Technical Debt**: What anti-patterns do you see that should be refactored?

7. **Innovative Ideas**: What unique features could differentiate this from competitors?

8. **Security Concerns**: Any security vulnerabilities in this architecture?

9. **Accessibility**: How can I improve accessibility for users with disabilities?

10. **Monetization**: What premium features would users pay for?

Please be specific and provide actionable recommendations with implementation considerations.

---

## PROMPT END
