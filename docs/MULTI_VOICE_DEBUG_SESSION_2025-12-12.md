# Multi-Voice Narration Debug Session - 2025-12-12

## The Problem

When multi-voice narration is enabled, the audio output is severely broken:
- **Narrator speaks character dialogue lines**
- **Character voices speak narration text**
- **Lines are repeated, fragmented, or cut off**
- **Text snippets appear in wrong segments**

User quote: "The voice narration issue is so bad it almost seems beyond hope"

## Root Cause Analysis

### The Core Architecture Issue

The multi-voice system uses a **position-based approach** to identify dialogue in the story text:

1. **LLM generates prose** with dialogue
2. **Our code (not LLM)** calculates character positions (`start_char`, `end_char`) for each quote
3. **Positions are stored** in `dialogue_map` array
4. **Later, text may be modified** by validation/polishing agents
5. **Segment builder** uses stored positions to slice text into narrator/dialogue segments
6. **Positions are now INVALID** because text changed

### The Position Calculation Code

Located in `server/services/openai.js` lines 1435-1591:
- 150+ lines of complex quote-finding logic
- Scans prose left-to-right looking for opening quotes
- Matches first 5 words of dialogue (case-insensitive)
- Finds closing quotes with depth tracking
- Falls back to regex if scan fails
- **ESTIMATES position if nothing found** (line 1561: `estimatedPos = searchStart + 50`)

### Text Modification Pipeline

In `server/services/orchestrator.js`:
```
Line 775:  rawText = sceneResult.content           [ORIGINAL PROSE]
Line 778:  sceneDialogueMap = positions calculated on rawText

Line 800:  validateStoryText(rawText)              [MAY MODIFY TEXT]
Line 853:  polishForNarration(rawText)             [MAY MODIFY TEXT]
Line 906:  validateStoryText(polishedText)         [MAY MODIFY TEXT]

Line 963:  Database stores finalText as polished_text
Line 1024: Database stores dialogue_map with ORIGINAL positions

Line 1148: convertDialogueMapToSegments(finalText, dialogueMap)
           ^^^ MISMATCH: positions from original, text is modified!
```

### Example of Position Breakage

```
Original prose (80 chars): "He walked down the street. 'Hello!' he called to the woman."
dialogue_map[0]: {speaker: "he", quote: "Hello!", start_char: 34, end_char: 41}

After polishing (85 chars): "He slowly walked down the long street. 'Hello!' he called out."
Quote is now at position 39, not 34!

convertDialogueMapToSegments tries to extract at [34-41]:
Result: "street. '" (WRONG TEXT - includes part of narration!)
```

## Fixes Applied This Session

### Fix 1: willUseMultiVoice Condition (CRITICAL)

**Problem**: The condition to detect multi-voice was checking `sceneDialogueMap.length > 0` which was too restrictive and never triggered.

**Location**: `server/services/orchestrator.js` lines 783-791

**Before**:
```javascript
const multiVoiceExplicitlyDisabled = this.session.config_json?.multi_voice === false;
const willUseMultiVoice = sceneDialogueMap.length > 0 && this.characters.length > 0 && !multiVoiceExplicitlyDisabled;
```

**After**:
```javascript
const multiVoiceEnabled = this.session.config_json?.multi_voice === true || this.session.config_json?.multiVoice === true;
const willUseMultiVoice = multiVoiceEnabled && this.characters.length > 0;
```

**Why**: Now uses session configuration to determine if multi-voice is intended, rather than checking if dialogue was found.

### Fix 2: Skip Text Modifications for Multi-Voice

**Location**: `server/services/orchestrator.js` lines 796-903

When `willUseMultiVoice` is true:
- Validation is skipped (line 796)
- Polishing is skipped (line 853-858 returns `Promise.resolve(rawText)`)
- `finalText = rawText` directly (line 902)

This preserves the ORIGINAL text that positions were calculated on.

### Fix 3: Added Debug Logging

**Location**: `server/services/orchestrator.js` line 791

```javascript
logger.info(`[Orchestrator] MULTI-VOICE CHECK | config.multi_voice: ${this.session.config_json?.multi_voice} | characters: ${this.characters.length} | dialogueMap: ${sceneDialogueMap.length} | willUseMultiVoice: ${willUseMultiVoice}`);
```

## Comprehensive 10-Agent Analysis Results

### Agent 1: LLM Prompt for Dialogue Extraction
**File**: `server/services/openai.js`

Findings:
- Position calculation is 100% done by OUR CODE, not LLM
- LLM returns only `{quote, speaker, emotion}` - no positions
- Our code adds `start_char`, `end_char` by scanning prose
- Quote normalization removes punctuation, creating matching issues
- LLM may return truncated/paraphrased quotes that don't match prose exactly
- No Unicode normalization (composed vs decomposed characters)
- Estimated position fallback is dangerous (just adds 50 to last position)

### Agent 2: convertDialogueMapToSegments Analysis
**File**: `server/services/agents/dialogueSegmentUtils.js`

Findings:
- Position validation uses only 20-char prefix match (too loose)
- Off-by-one errors in `endPos` calculation (line 313, 346)
- Depth tracking for nested quotes is backwards (line 334-343)
- Overlapping positions cause dialogue to be SKIPPED entirely (line 47-51)
- Quote not found returns null - silent failure (line 364)
- No bounds checking on slice operations

### Agent 3: ElevenLabs Segment Processing
**File**: `server/services/elevenlabs.js`

Findings:
- Empty segment text not filtered before TTS API call
- If segment fails, audioBuffers array has gap (index misalignment)
- Case-sensitive character name matching issues
- Narrator voice ID fallback is silent (uses hardcoded George voice)
- No segment format validation before processing
- Word timing offset calculation assumes all segments succeed

### Agent 4: Speaker Validation Agent
**File**: `server/services/agents/speakerValidationAgent.js`

Findings:
- Speaker names normalized to lowercase in Set (line 88)
- But dialogue_map speakers keep original case (line 96)
- Voice assignments stored with lowercase keys (line 228)
- Narrator entries filtered inconsistently (lowercase check)
- dialogue_map returned unchanged - no position re-verification

### Agent 5: Speech Tag Filter Agent
**File**: `server/services/agents/speechTagFilterAgent.js`

Findings:
- Index mapping vulnerable to LLM errors
- Uses re-indexed narrator segment list (not original indices)
- LLM can return wrong indices, silently skipped
- Text modification without position recalculation
- Can remove story content, not just speech tags
- Cascade failure with voice assignments

### Agent 6: Orchestrator Flow Trace
**File**: `server/services/orchestrator.js`

Findings (flow diagram):
```
generateSceneWithDialogue() → positions on ORIGINAL prose
         ↓
validateStoryText() → may fix text
         ↓
polishForNarration() → may reword sentences
         ↓
validateStoryText() again → may fix more
         ↓
Database stores: polished_text (MODIFIED) + dialogue_map (ORIGINAL positions)
         ↓
convertDialogueMapToSegments(polished_text, dialogue_map) → MISMATCH!
```

### Agent 7: Voice Assignment Agent
**File**: `server/services/agents/voiceAssignmentAgent.js`

Findings:
- Fuzzy prefix matching can match wrong character
  - Example: "Jan" matches both "Janet" and "Jonathan"
  - First match wins (Object.keys iteration order)
- Title stripping incomplete (only 37 titles in list)
- Duplicate voice assignment handled but limited by voice pool
- No confirmation that voice_id is still valid at playback time

### Agent 8: Position Calculation Algorithm
**File**: `server/services/openai.js`

9 Edge Cases Identified:
1. Same quote appears twice → matches first one, might be wrong
2. Smart quotes vs straight quotes → indexOf fails
3. Whitespace normalization → multiple spaces become single
4. LLM returns truncated quotes → length ratio check too permissive (0.5-2.0)
5. Quote boundary off-by-one → `closeIdx + 1` may be wrong
6. Nested quotes not handled → depth tracking exits on wrong quote
7. Position relocation fallback is case-insensitive → matches wrong quotes
8. Fragment detection is reactive, not preventive
9. Text modifications after position calculation → PRIMARY ISSUE

### Agent 9: Text Normalization Operations
**Files**: Multiple

All normalization operations that break positions:
| Location | Operation | Impact |
|----------|-----------|--------|
| openai.js:1478-1479 | `replace(/\s+/g, ' ')` | Whitespace collapsed |
| openai.js:1489-1490 | `.toLowerCase().trim()` | Case + trim |
| openai.js:1460 | `replace(/[.,!?;:]+$/, '')` | Punctuation removed |
| openai.js:1456-1461 | Remove quote marks | Strips quotes |
| dialogueSegmentUtils.js:156,185,278 | `.trim()` | Leading/trailing space |
| promptSecurity.js:39 | `replace(/\n{3,}/g, '\n\n')` | Newline reduction |
| promptSecurity.js:108 | `replace(/\s+/g, ' ')` | Whitespace normalization |
| library.js:28 | `replace(/"/g, '&quot;')` | HTML entity encoding |

### Agent 10: Database Storage & Retrieval
**Files**: `orchestrator.js`, `schema.sql`

Findings:
- Database is fine (JSONB handled correctly, auto-deserializes)
- UTF-8 encoding is default, no issues
- Issue is NOT database encoding
- Issue IS position mismatch between stored dialogue_map and polished_text

## Files Modified This Session

1. **server/services/orchestrator.js**
   - Lines 783-791: Changed willUseMultiVoice condition
   - Line 791: Added debug logging
   - Lines 1090-1094: Fixed variable reference (removed duplicate declaration)

## Database Changes

- Deleted all existing stories: 128 sessions, 129 scenes, 816 characters
- Fresh start for testing

## Remaining Issues (Not Fixed)

### HIGH Priority
1. **Position validation too loose** - 20-char prefix match in dialogueSegmentUtils.js:288-289
2. **Voice prefix matching bug** - elevenlabs.js:1520 can match wrong character
3. **Speech tag filter index errors** - speechTagFilterAgent.js:117 silent failures
4. **Estimated positions** - openai.js:1561 guesses position when quote not found

### MEDIUM Priority
1. **Same quote twice** - matches wrong occurrence
2. **Smart quotes vs straight quotes** - indexOf fails
3. **Empty segments not filtered** - elevenlabs.js empty text passed to TTS
4. **Audio buffer index gaps** - failed segments create gaps

### Long-term Recommendations
1. **Tag-based markup architecture** - Use `[CHAR:John]dialogue[/CHAR]` format instead of positions
   - Eliminates position calculation entirely
   - 100% reliable regardless of text modifications
   - LLM embeds markers directly in prose

2. **Stricter position validation** - Full quote match, not 20-char prefix

3. **Fail loud** - Throw errors on estimated positions instead of guessing

## Test Plan

When testing after compaction:

1. Generate story with multi-voice enabled
2. Look for these logs:
   ```
   [Orchestrator] MULTI-VOICE CHECK | config.multi_voice: true | ...
   [Orchestrator] MULTI-VOICE ENABLED: Skipping polishing/validation...
   [Scene+Dialogue] POSITION_CALC_COMPLETE | found: X | estimated: 0 | overlaps: 0
   [SegmentBuilder] POSITION VERIFICATION START
   [MultiVoice] Using pre-computed dialogue_map with X attributions
   ```
3. If `estimated: 0` is NOT zero, positions are being guessed
4. If `overlaps: 0` is NOT zero, positions are conflicting

## Key Code Locations

| Purpose | File | Lines |
|---------|------|-------|
| Multi-voice decision | orchestrator.js | 783-795 |
| Position calculation | openai.js | 1435-1591 |
| Segment building | dialogueSegmentUtils.js | 247-381 |
| Voice assignment | elevenlabs.js | 1454-1559 |
| Speech tag filtering | speechTagFilterAgent.js | 23-161 |
| Speaker validation | speakerValidationAgent.js | 63-269 |

## Session Commands Used

```powershell
# Delete all stories
cd 'C:\Program Files\PostgreSQL\17\bin'
$env:PGPASSWORD='olivebranch2025'
./psql.exe -U postgres -d storyteller_db -c 'UPDATE story_sessions SET last_read_scene_id = NULL; DELETE FROM story_scenes; DELETE FROM characters; DELETE FROM story_sessions;'

# Restart service
Restart-Service StorytellerService

# Check logs
Get-Content C:\inetpub\wwwroot\storyteller\logs\combined.log -Tail 50
```

## Why the Issue May NOT Be Resolved

The fix (skipping polishing for multi-voice) addresses ONE cause of position mismatch, but:

1. **Position calculation itself is fragile** - 150+ lines of complex matching logic
2. **LLM may return quotes that don't exactly match prose** - paraphrasing, truncation
3. **Quote matching edge cases** - same quote twice, smart quotes, nested quotes
4. **Voice assignment fuzzy matching** - prefix matching can pick wrong character
5. **Speech tag filter** - can corrupt segment list with wrong indices
6. **Position validation** - 20-char prefix is too loose, allows false positives

The fundamental architecture (position-based dialogue extraction) is inherently brittle. A tag-based markup approach would be 100% reliable.
