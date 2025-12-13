# Storyteller Changelog

## 2025-12-13: Multi-Voice Tag Display Fix (CRITICAL)

**Problem**: `[CHAR:Name]dialogue[/CHAR]` tags were appearing in the displayed story text, making it unreadable:
```
[CHAR:ARIA-7]Emergency lockdown initiated.[/CHAR] ARIA-7 announced.
Commander Mara Vance watched the pressure readouts. [CHAR:Commander Mara Vance]Four tons doesn't appear.[/CHAR]
```

**Root Causes Found (via parallel sub-agent analysis)**:

1. **orchestrator.js:1568 - Return Statement Bug** (CRITICAL)
   - `polished_text: finalText` returned unstripped text to client
   - Database was saving correctly, but API return bypassed the stripped version
   - **Fix**: Changed to `polished_text: stripTags(finalText)`

2. **handlers.js - `io is not defined` Error**
   - `streamAudioResponse()` and `streamCachedAudio()` called `io.sockets.adapter.rooms.get()` but `io` wasn't in scope
   - This caused scene audio streaming to fail silently
   - **Fix**: Added `getRoomSocketCount()` helper using `ioInstances[0]`
   - **Fix**: Removed incorrect `io` parameter from function calls at lines 1234, 1246, 1278

3. **speechTagFilterAgent.js - Single Object Response**
   - LLM sometimes returned `{index, cleaned, removed}` instead of array
   - Parser expected array, threw "zero results" error
   - **Fix**: Added handling to wrap single object in array

4. **Client Bundle Stale**
   - `stripCharacterTags()` safety net added but client not rebuilt
   - **Fix**: Rebuilt Vite bundle (`npm run build`)

**Files Changed**:
- `server/services/orchestrator.js` (line 1568) - Strip tags in return statement
- `server/socket/handlers.js` - Fix `io` scope issues, add `getRoomSocketCount()`
- `server/services/agents/speechTagFilterAgent.js` - Handle single object LLM response
- `client/src/utils/textUtils.js` (NEW) - Client-side `stripCharacterTags()` safety net
- `client/src/pages/Story.jsx` - Import and use `stripCharacterTags()`
- `client/src/pages/Reader.jsx` - Import and use `stripCharacterTags()`

**Verification**:
- Database `polished_text` column: Clean (0 rows with tags)
- Multi-voice audio: Working correctly
- Tag display: Fixed - no tags visible in UI

**Known Issue (Minor)**:
- Slight clicking sound (~fraction of second) at end of voice-acted lines before next speaker
- Does not affect functionality, audio plays correctly
- Likely related to audio segment concatenation in `audioAssembler.js`
- **Status**: Noted for future optimization

---

## 2025-12-11: Progress Bar UI & Component Refactoring

**Progress Bar UI Improvements**:
- Responsive milestone badges (smaller on mobile: 8x8 → 10x10)
- Shorter stage names on mobile ("Story Generation" → "Story")
- Better edge handling for first/last badges (left/right aligned labels)
- Responsive progress bar margins and padding
- Reduced margins for wider progress bar (`mx-4 sm:mx-8 md:mx-12 lg:mx-16`)
- Added `overflow-visible` for edge labels
- Activity feed message now uses `line-clamp-2` for truncation
- **Files Changed**: `client/src/components/LaunchScreen.jsx`

**Cover Art Layout (BookPageLayout.jsx) - VERIFIED COMPLETE**:
- Cover floats left with CSS `float: left` and `shape-outside: margin-box`
- Text wraps around cover like old-school book indent
- Cover top aligns with title (margin-top: 0)
- Minimize icon (`_`) appears on cover hover (top-right)
- Regenerate icon on cover hover (bottom-left)
- Text box minimize icon appears on hover (top-right of text area)
- Click anywhere on cover opens fullscreen view

**Component Refactoring - Constants Extraction**:
- **`client/src/constants/authorStyles.js`** (NEW): Extracted ~120 lines of author style data from Configure.jsx
  - `PROVIDER_THRESHOLDS`, `AUTHOR_STYLES_BY_CATEGORY`, `AUTHOR_STYLES`
  - Helper functions: `findAuthorById()`, `getAuthorCategory()`
- **`client/src/constants/launchStages.js`** (NEW): Extracted ~70 lines of stage constants from LaunchScreen.jsx
  - `STAGES`, `STATUS`, `COUNTDOWN_PHASE`, `STAGE_CONFIG`
  - Helper functions: `getStageConfig()`, `getStageIds()`

**Component Refactoring - Sub-components**:
- **`client/src/components/launch/StageIndicator.jsx`** (NEW): Extracted StageIndicator component (~110 lines)
- **`client/src/components/launch/CountdownDisplay.jsx`** (NEW): Extracted CountdownDisplay component (~85 lines)
- **`client/src/components/launch/index.js`** (NEW): Re-exports for launch components
- **`client/src/components/configure/AuthorStylePicker.jsx`** (NEW): Extracted AuthorStylePicker component (~165 lines)
- **`client/src/components/configure/index.js`** (NEW): Re-exports for configure components

**Results**:
- Configure.jsx: 2138 → ~1860 lines (-13%)
- LaunchScreen.jsx: 2015 → ~1560 lines (-22.6%)
- Total: ~450+ lines extracted to reusable modules

**Deprecated Agent Files - ARCHIVED (Fail instead of Fallback)**:
- `dialogueAttributionAgent.js` → moved to `_archived/`
- `dialogueTaggingAgent.js` → moved to `_archived/`
- **`dialogueSegmentUtils.js`** (NEW): Utility functions extracted from deprecated agents
  - `convertDialogueMapToSegments()` - still needed by C+E architecture
  - `validateDialogueMap()` - validation utility
- **orchestrator.js**: Now FAILS LOUD if `dialogue_map` is missing (no fallbacks)

---

## 2025-12-10: Cover Art & SFX Timing Improvements

**Three-Tier Cover Art Prompts - NEW**:
- **Feature**: LLM generates 3 image prompts with increasing abstraction levels
  - Level 1: Direct scene interpretation from story
  - Level 2: Abstract/symbolic representation
  - Level 3: Highly abstract (guaranteed safe for DALL-E)
- **Benefit**: Stories with sensitive content can still get cover art via abstract fallbacks
- **Files Changed**: `server/routes/stories.js` (new `generateCoverPrompts()` function)

**Cover Art Layout - VERIFIED**:
- Cover floats left with CSS `float: left` and `shape-outside: margin-box`
- Text wraps around cover like an old-school book indent
- Minimize icon changed from icon to `_` underscore symbol (appears on hover)
- Click anywhere else on cover opens fullscreen view
- **Files Changed**: `client/src/components/BookPageLayout.jsx`

**SFX Timing Fix - REINFORCED**:
- **Problem**: SFX should ONLY play during story narration, not during title/synopsis
- **Solution**: Added multiple guards to ensure SFX waits for scene audio:
  1. `playSfx()` now checks `introAudioQueued && !sceneAudioStartedRef.current`
  2. Secondary karaoke trigger also checks `introAudioQueued && !sceneAudioQueued`
  3. Clear comments documenting the SFX timing requirements
- **Files Changed**: `client/src/pages/Story.jsx`

---

## 2025-12-10: Bug Fixes & Code Quality Improvements

**SFX Not Playing Bug - FIXED**:
- **Problem**: SFX was detected during story generation but wouldn't play during narration
- **Root Cause**: Two separate SFX libraries existed with different category schemes:
  - `GENRE_SFX_LIBRARY` in `sfxAgents.js` uses genre-based categories (`fantasy.footsteps_stone`, `scifi.laser_blast`)
  - `AMBIENT_SFX_LIBRARY` in `soundEffects.js` uses action-based categories (`actions.footsteps_stone`, `combat.sword_clash`)
- **Fix**: Updated `/api/sfx/ambient` endpoint in `server/routes/sfx.js` to check BOTH libraries
- **Files Changed**: `server/routes/sfx.js` (added GENRE_SFX_LIBRARY import and fallback lookup)

**Voice Assignment Names-to-IDs Fix**:
- **Problem**: LLM returned voice names ("Josh", "Elli") instead of voice_ids
- **Fix**: Added `resolveVoiceNamesToIds()` function in `voiceAssignmentAgent.js` as safety net
- **Files Changed**: `server/services/agents/voiceAssignmentAgent.js`

**WhisperService EventEmitter Fix**:
- **Problem**: WhisperService called `this.emit()` but didn't extend EventEmitter
- **Fix**: Added `extends EventEmitter` and `super()` call, plus connection timeout cleanup
- **Files Changed**: `server/services/whisper.js`

**AudioContext Event Listener Leak Fix**:
- **Problem**: `tempErrorHandler` could remain attached if exception thrown during unlock
- **Fix**: Wrapped in try-finally to guarantee `removeEventListener` is called
- **Files Changed**: `client/src/context/AudioContext.jsx`

**Empty Catch Blocks in audioAssembler.js**:
- **Problem**: 6 empty catch blocks silently swallowed cleanup errors
- **Fix**: Added `logger.debug()` calls for all cleanup error paths
- **Files Changed**: `server/services/audioAssembler.js`

**RealtimeConversation Promise & Timer Fixes**:
- **Problem**: Unhandled promise rejection from `extractStoryConfigAndSave()`, timer callbacks could fire on destroyed instance
- **Fix**: Added `.catch()` handler with error notification, stored timer IDs for cleanup in `close()` method
- **Files Changed**: `server/services/realtimeConversation.js`

**Directory Creation Error Handling**:
- **Problem**: Empty catch blocks for `fs.mkdir()` hid non-EEXIST errors (permission denied, disk full)
- **Fix**: Added conditional logging for non-EEXIST errors
- **Files Changed**: `server/routes/stories.js`, `server/socket/handlers.js`

---

## 2025-12-09: Dialogue Tagging System (MAJOR FEATURE)

**Problem Solved**: Multi-voice narration was broken - all characters used wrong voices because:
- Regex-based `parseDialogueSegments()` couldn't understand pronouns ("she mutters" → which female?)
- Post-hoc LLM attribution was called during audio generation (too late, context lost)
- Speaker mismatches occurred frequently (male voice for female character)

**Solution**: Capture speaker metadata **AT THE SOURCE** - immediately after scene is written.

**New Files**:
- `server/services/agents/dialogueTaggingAgent.js` - PRIMARY dialogue attribution agent
- `server/services/agents/DIALOGUE_TAGGING_SYSTEM.md` - Comprehensive documentation
- `server/database/migrations/012_dialogue_map.sql` - Database schema changes

**Database Changes** (migration 012):
```sql
ALTER TABLE story_scenes ADD COLUMN dialogue_map JSONB DEFAULT NULL;
ALTER TABLE story_scenes ADD COLUMN dialogue_tagging_status VARCHAR(20) DEFAULT NULL;
ALTER TABLE story_scenes ADD COLUMN dialogue_tagging_error TEXT DEFAULT NULL;
```

**Orchestrator Integration** (`server/services/orchestrator.js`):
- Lines ~860-917: `tagDialogue()` called immediately after scene save
- Lines ~1009-1027: Audio generation uses pre-computed dialogue_map
- Lines ~1477-1494: On-demand audio reads dialogue_map from database

---

## 2025-12-09: Enhanced Progress Bar & Bug Fixes

**Progress Bar**: Full-width progress bar now shows from "Start Story" click through all generation phases.

### PENDING REQUIREMENTS

**Progress Bar UI**:
1. Add "Crafting Story" milestone at 0%
2. Widen progress bar (text cutoff on "Quality Checks")
3. Fix live activity feed truncation

**Text Box & Cover Art Layout**:
4. Text box top aligns with cover art top, text wraps around cover
5. Add `_` minimize icon on text box hover
6. Cover art: regenerate icon to bottom-left, minimize to top-right

**Critical Bugs**:
7. ~~SFX not playing during narration (detected but silent)~~ - FIXED 2025-12-10 (library lookup)
8. ~~Voice assignment broken~~ - FIXED via Dialogue Tagging System + name-to-ID resolution

---

## 2025-12-08 (Session 3): SFX Status & UI Fixes

- **SFX Loading Animation**: Fixed race condition with 100ms delay between emits
- **SFX Badge Labels**: "cached" → "from library", "new" → "generating"
- **Synopsis Layout**: Hero grid layout for PC (cover left, text right)
- **SFX During Synopsis**: Disabled (SFX only on scene text)
- **TTS Artifacts**: Removed ellipses from intro text
- **Static SFX**: Added "static", "buzz", "crackle" keywords
- **Dynamic SFX Indicator**: Floating waveform at bottom of screen

---

## 2025-12-08 (Session 2): Voice Assignment & Karaoke

- **Voice Assignment**: Title stripping for character names (Dr., Lt., Captain, etc.)
- **Narration Skipping**: Fixed `parseDialogueSegments()` prompt to never skip text
- **Karaoke**: 50ms polling with binary search for word highlighting
- **Unified Layout**: `story-hero` CSS grid for cover + synopsis
- **SFX Display**: Animated waveforms, color-coded badges
- **Anonymous User**: Skip auto-bookmark for anonymous users

---

## 2025-12-08 (Session 1): Multi-Voice Karaoke & UX

- **Karaoke Timings**: `generateMultiVoiceAudio()` uses timestamps, cumulative offsets
- **Dialogue Parsing**: Combine short narrator segments, attributions to narration
- **Cover Art**: Enhanced DALL-E sanitization (60+ word replacements)
- **SFX Config**: Fixed snake_case/camelCase handling
- **Auto-Advance**: Respects `autoplayEnabled` setting
- **Button Text**: "Begin Chapter {chapterNumber}"
- **Synopsis Audio**: Fixed cut-off via queueAudio instead of playAudio
