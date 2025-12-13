# Multi-Voice Narration Issues - Comprehensive Analysis v2
## Session: 2025-12-12 (Continued Investigation)

## Executive Summary

10 agents analyzed the multi-voice narration system assuming the previous fixes didn't resolve the issue. **25+ distinct bugs identified** across 6 key files that can cause:
- Narrator speaking character dialogue lines
- Character voices speaking narration text
- "He said" speech tags appearing even with hide_speech_tags enabled
- Lines repeated, fragmented, or cut off

---

## CRITICAL BUGS BY SEVERITY

### SEVERITY: CRITICAL (5 bugs)

#### BUG 1: Silent LLM Zero-Results in Speech Tag Filter
**File**: `speechTagFilterAgent.js` lines 98-104

```javascript
results = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.results || ... || []);
// If LLM returns empty array, loop at line 116 never executes
// All segments pass through UNFILTERED
```
**Impact**: Speech tags like "he said" appear even when hide_speech_tags=true

---

#### BUG 2: Multi-Voice Silently Disabled When No Characters
**File**: `orchestrator.js` line 788

```javascript
const willUseMultiVoice = multiVoiceEnabled && this.characters.length > 0;
```
**Impact**: If story has no characters in database, filter never runs, speech tags leak

---

#### BUG 3: Overlapping Positions Silently Skipped
**File**: `dialogueSegmentUtils.js` lines 47-51

```javascript
if (dialogue.start_char < lastIndex) {
  logger.error(`OVERLAP_ERROR[${i}]...`);
  continue;  // Text between positions is LOST
}
```
**Impact**: Text loss when dialogue positions overlap (no recovery attempt)

---

#### BUG 4: Buffer Concatenation Without Deduplication
**File**: `elevenlabs.js` line 1391

```javascript
const combinedBuffer = Buffer.concat(audioBuffers);
// No check for duplicate segments in audioBuffers array
```
**Impact**: Same audio segment can appear multiple times in output

---

#### BUG 5: Position Relocation Can Match Wrong Quote
**File**: `dialogueSegmentUtils.js` lines 310-323

When position is invalid, the code searches for the quote text but:
- May match a DIFFERENT occurrence of the same quote
- Variable `idx` shadows outer loop variable (line 311)
- Error logs show wrong dialogue index

---

### SEVERITY: HIGH (7 bugs)

#### BUG 6: 20-Character Prefix Validation Too Loose
**File**: `dialogueSegmentUtils.js` lines 288-289

```javascript
const positionValid = textAtPosNormalized.toLowerCase().includes(normalizedQuote.substring(0, 20).toLowerCase())
```
Only checks first 20 chars - can validate wrong positions

---

#### BUG 7: Estimated Position Fallback is Dangerous
**File**: `openai.js` lines 1559-1570

```javascript
if (!found) {
  const estimatedPos = searchStart + 50;  // GUESSING!
  enrichedDialogueMap.push({ ...d, start_char: estimatedPos, ... });
}
```
When quote not found, position is guessed (+50 chars from last)

---

#### BUG 8: Speech Tag Filter Index Mismatch
**File**: `speechTagFilterAgent.js` lines 116-121

```javascript
const narratorSeg = narratorSegments[result.index];
if (!narratorSeg) {
  logger.warn(`...SKIP | reason: narrator_not_found`);
  continue;  // Silently skips - segment unfiltered
}
```
If LLM returns out-of-bounds index, segment is skipped

---

#### BUG 9: Dialogue Extraction Uses Wrong Text
**File**: `dialogueSegmentUtils.js` lines 149-167

Extracts dialogue from prose at calculated position:
```javascript
const proseAtPosition = sceneText.slice(dialogue.start_char, dialogue.end_char);
```
If positions are wrong, extracts wrong text (may include narrator text)

---

#### BUG 10: Narrator Segment Includes Quote Marks
**File**: `dialogueSegmentUtils.js` lines 54-56

```javascript
let narration = sceneText.slice(lastIndex, dialogue.start_char).trim();
```
If `start_char` is position of quote mark, narrator gets text UP TO but not including it. But if position is INSIDE the quote, narrator gets partial dialogue.

---

#### BUG 11: Voice Prefix Matching Bug
**File**: `elevenlabs.js` line 1520 (approx)

Character names matched by prefix:
- "Jan" matches both "Janet" AND "Jonathan"
- First match wins (Object.keys iteration order)

---

#### BUG 12: Quote Depth Tracking is Backwards
**File**: `dialogueSegmentUtils.js` lines 334-343

```javascript
if (char === '"' || char === '"') {
  if (depth === 0) break;
  depth--;
} else if (char === '"' || char === '"') {
  depth++;
}
```
Straight quotes `"` appear in BOTH conditions - logic is confused

---

### SEVERITY: MEDIUM (8 bugs)

#### BUG 13: Fragment Removal Too Aggressive
**File**: `dialogueSegmentUtils.js` lines 118-124

```javascript
if (firstWord.length <= 6 && /^[^aeiouAEIOU]*['']?s?$/.test(firstWord)) {
  // Removes words like "sky", "pst", "hmm"
}
```

---

#### BUG 14: Type Mismatch in hide_speech_tags Check
**File**: `orchestrator.js` line 1163

```javascript
const hideSpeechTags = this.session.config_json?.hide_speech_tags === true;
```
Uses strict `===`. If value is string `"true"` instead of boolean, condition fails.

---

#### BUG 15: No Verification Speech Tag Filter Worked
**File**: `orchestrator.js` lines 1173-1175

Only logs if segments were REMOVED (count decreased). Silent if:
- LLM modified text but didn't remove segments
- LLM failed silently (returned empty results)

---

#### BUG 16: Parse Failure Returns Original Segments
**File**: `speechTagFilterAgent.js` lines 105-108

```javascript
} catch (parseError) {
  logger.error(`PARSE_ERROR...`);
  return segments;  // Unfiltered!
}
```

---

#### BUG 17: audioBuffers and segmentResults Array Mismatch
**File**: `elevenlabs.js` lines 1320, 1362

```javascript
audioBuffers.push(result.audio);      // Only on success
segmentResults.push(segmentInfo);     // Always pushed (line 1362)
```
Arrays may have different lengths, causing offset issues.

---

#### BUG 18: Same Quote Twice Matches Wrong One
**File**: `openai.js` lines 1471-1526

When scanning for quote, finds FIRST match:
```javascript
for (let i = searchStart; i < prose.length && !found; i++) {
  if (isOpeningQuote(prose[i])) { ... }
}
```
If same quote appears twice, always matches first occurrence.

---

#### BUG 19: Smart Quotes vs Straight Quotes
**File**: `openai.js` line 1472

```javascript
if (isOpeningQuote(prose[i])) { ... }
```
Function may not handle all quote types consistently (straight `"` vs curly `""`)

---

#### BUG 20: Cumulative Time Tracking Drift
**File**: `elevenlabs.js` lines 1335-1339

```javascript
cumulativeTimeMs += segmentDuration;
```
If segment processed twice, duration added twice → karaoke timing drifts.

---

### SEVERITY: LOW (5 bugs)

#### BUG 21: Narration Deduplication May Remove Valid Text
**File**: `dialogueSegmentUtils.js` lines 70-87

Removes narration that matches any dialogue quote - could remove legitimate repetition.

---

#### BUG 22: Dialogue Segments Never Filtered
**File**: `speechTagFilterAgent.js` lines 25-27

By design, only narrator segments are filtered. If dialogue segment somehow contains narration, it passes through.

---

#### BUG 23: Two generateMultiVoiceAudio Paths
**File**: `orchestrator.js` lines 1322 and 1792

Two independent calls - if both execute for same scene, audio duplicated.

---

#### BUG 24: Title Stripping Incomplete
**File**: `voiceAssignmentAgent.js`

Only 37 titles in strip list - "Sergeant", "Chief", etc. may be missed.

---

#### BUG 25: Unicode Normalization Missing
**File**: `openai.js` lines 1489-1490

No Unicode normalization (composed vs decomposed characters).

---

## ROOT CAUSE ANALYSIS

### Primary Root Cause: Position-Based Architecture is Fragile

The system calculates character positions (`start_char`, `end_char`) for dialogue quotes, then later uses those positions to slice text. This fails when:

1. **Text is modified** after positions are calculated
2. **Same quote appears twice** (matches wrong one)
3. **Quotes have punctuation variations** (smart quotes, etc.)
4. **Positions overlap or are estimated** instead of found

### Secondary Root Cause: Silent Failures Throughout

Almost every failure mode results in **silent continuation**:
- LLM returns empty results → segments pass through
- Position invalid → tries relocation → if fails, skips segment
- Parse error → returns original
- No logging when filter "succeeds" but didn't actually filter

### Tertiary Root Cause: Multiple Code Paths

- Two calls to `generateMultiVoiceAudio` in orchestrator
- Two calls to `convertDialogueMapToSegments`
- Multiple validation paths that may or may not run

---

## FILES AFFECTED

| File | Line Range | Issue Count |
|------|------------|-------------|
| `dialogueSegmentUtils.js` | 21-420 | 9 bugs |
| `speechTagFilterAgent.js` | 23-161 | 5 bugs |
| `orchestrator.js` | 783-1792 | 4 bugs |
| `elevenlabs.js` | 1236-1408 | 4 bugs |
| `openai.js` | 1435-1591 | 3 bugs |
| `voiceAssignmentAgent.js` | various | 2 bugs |

---

## RECOMMENDED FIXES BY PRIORITY

### Immediate (Fix Now)

1. **Add validation that speech tag filter actually worked** (orchestrator.js)
```javascript
const beforeText = segments.map(s => s.text).join('');
segments = await filterSpeechTagsWithLLM(...);
const afterText = segments.map(s => s.text).join('');
if (beforeText === afterText) {
  logger.warn('[MultiVoice] Speech tag filter made NO changes');
}
```

2. **FAIL LOUD on empty LLM results** (speechTagFilterAgent.js)
```javascript
if (results.length === 0) {
  logger.error(`[SpeechTagAgent] LLM returned zero results - FAILING`);
  throw new Error('Speech tag filter failed: empty results');
}
```

3. **Fix variable shadowing in quote relocation** (dialogueSegmentUtils.js line 311)
```javascript
const foundIdx = sceneText.indexOf(pattern, searchStart);  // Rename from idx
```

4. **Handle overlapping positions with recovery** (dialogueSegmentUtils.js lines 47-51)
```javascript
if (dialogue.start_char < lastIndex) {
  // Instead of skipping, extend the gap
  lastIndex = dialogue.end_char;  // Skip overlapping portion
}
```

### Short-Term (This Week)

5. **Stricter position validation** - Require 50%+ of quote to match, not just 20 chars
6. **Log estimated positions as errors** - Make them visible in monitoring
7. **Add segment deduplication before audio generation**
8. **Fix type comparison for hide_speech_tags** - Accept truthy values

### Long-Term (Architecture Change)

9. **Tag-based markup architecture** - Replace positions with inline tags:
```
[CHAR:Jensen]Hello there![/CHAR] the commander said.
```
- 100% reliable regardless of text modifications
- LLM embeds markers directly in prose
- No position calculation needed

---

## DIAGNOSTIC QUERIES

### Check for Estimated Positions in Logs
```powershell
Select-String -Path .\logs\combined.log -Pattern "FALLBACK.*estimated" | Select-Object -Last 20
```

### Check for Position Overlaps
```powershell
Select-String -Path .\logs\combined.log -Pattern "OVERLAP_ERROR" | Select-Object -Last 20
```

### Check Speech Tag Filter Results
```powershell
Select-String -Path .\logs\combined.log -Pattern "\[SpeechTagAgent\]" | Select-Object -Last 50
```

### Check Database for hide_speech_tags Type
```sql
SELECT
  pg_typeof(config_json->'hide_speech_tags') as type,
  config_json->>'hide_speech_tags' as value,
  COUNT(*)
FROM story_sessions
GROUP BY 1, 2;
```

---

## Test Verification Checklist

When testing fixes:

- [ ] Generate story with multi-voice + hide_speech_tags enabled
- [ ] Check logs for: `[MultiVoice] hide_speech_tags setting: true`
- [ ] Check logs for: `[SpeechTagAgent] LLM_RESPONSE | resultCount: X` (X > 0)
- [ ] Check logs for: `[SpeechTagAgent] OUTPUT | removed: X | stripped: Y`
- [ ] Check logs for ABSENCE of: `OVERLAP_ERROR`, `FALLBACK.*estimated`
- [ ] Listen to audio: narrator should NOT speak dialogue
- [ ] Listen to audio: no "he said", "she whispered" phrases

---

## Session Summary

This investigation identified 25+ bugs that can cause multi-voice narration issues. The most critical are:

1. **Speech tag filter silently failing** on empty LLM results
2. **Multi-voice disabled when no characters** in database
3. **Overlapping positions causing text loss**
4. **Position estimation** when quotes not found
5. **Loose 20-char validation** accepting wrong positions

The fundamental position-based architecture is inherently fragile. A tag-based markup approach would eliminate the entire class of position-related bugs.
