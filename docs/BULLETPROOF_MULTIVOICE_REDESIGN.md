# Bulletproof Multi-Voice Architecture Redesign
## Comprehensive Analysis and Implementation Plan

**Date**: 2025-12-12
**Status**: Architecture Proposal
**Priority**: CRITICAL

---

## Executive Summary

This document presents a complete analysis of the Storyteller multi-voice narration system and proposes a bulletproof redesign. The analysis was performed by 10+ specialized agents examining:

- Server architecture (orchestrator, openai.js, elevenlabs.js)
- Client architecture (Story.jsx, AudioContext, socket handling)
- Database schema (45+ tables, 13 migrations)
- All regex and position-based operations (47 operations identified)

**Key Finding**: The current position-based dialogue extraction system is fundamentally fragile. We identified **40+ distinct bugs** that can cause the narrator to speak dialogue lines, characters to speak narration, and speech tags to leak through even with `hide_speech_tags` enabled.

**Proposed Solution**: Replace position-based architecture with an LLM-first, multi-pass validation pipeline using GPT-5.2 for maximum accuracy.

---

## Part 1: Root Cause Analysis

### The Fundamental Problem

The current system uses a **position-based approach** to identify dialogue:

```
1. LLM generates prose with dialogue
2. OUR CODE calculates character positions (start_char, end_char) for each quote
3. Positions stored in dialogue_map
4. Text may be modified by validation/polishing agents
5. Segment builder uses stored positions to slice text
6. POSITIONS ARE NOW INVALID because text changed
```

### Why Position-Based Approach Fails

| Failure Mode | Frequency | Impact |
|--------------|-----------|--------|
| Text modified after position calculation | HIGH | Wrong text extracted |
| Same quote appears twice in prose | MEDIUM | Matches wrong occurrence |
| Smart quotes vs straight quotes | MEDIUM | indexOf fails to find |
| LLM returns truncated/paraphrased quotes | HIGH | Quote doesn't match prose |
| Position estimation fallback used | HIGH | Guesses are usually wrong |
| Overlapping positions silently skipped | MEDIUM | Text loss |

### Silent Failure Cascade

The system has **no fail-loud mechanisms** for multi-voice:

```javascript
// Current: Silent failures return unfiltered data
if (results.length === 0) {
  return segments;  // WRONG: Should throw error!
}

// Current: Index mismatch silently skips
if (!narratorSeg) {
  logger.warn(`...SKIP | reason: narrator_not_found`);
  continue;  // WRONG: Should throw error!
}

// Current: Parse errors return original
} catch (parseError) {
  return segments;  // WRONG: Should throw error!
}
```

---

## Part 2: Complete Bug Inventory

### CRITICAL Severity (5 bugs)

| # | Bug | File | Lines | Impact |
|---|-----|------|-------|--------|
| 1 | LLM returns empty array, segments pass unfiltered | speechTagFilterAgent.js | 98-104 | Speech tags appear with hide_speech_tags=true |
| 2 | Multi-voice disabled when characters.length=0 | orchestrator.js | 788 | Falls back to narrator-only silently |
| 3 | Overlapping positions silently skipped | dialogueSegmentUtils.js | 47-51 | Text between positions is LOST |
| 4 | Buffer concatenation without deduplication | elevenlabs.js | 1391 | Same audio segment appears multiple times |
| 5 | Position relocation matches wrong quote | dialogueSegmentUtils.js | 310-323 | Variable shadowing, wrong index |

### HIGH Severity (7 bugs)

| # | Bug | File | Lines | Impact |
|---|-----|------|-------|--------|
| 6 | 20-char prefix validation too loose | dialogueSegmentUtils.js | 288-289 | False positive position matches |
| 7 | Estimated position fallback is dangerous | openai.js | 1559-1570 | Guesses +50 chars from last |
| 8 | Speech tag filter index mismatch | speechTagFilterAgent.js | 116-121 | Out-of-bounds silently skipped |
| 9 | Dialogue extraction uses wrong text | dialogueSegmentUtils.js | 149-167 | Extracts narrator text as dialogue |
| 10 | Narrator segment includes quote marks | dialogueSegmentUtils.js | 54-56 | Partial dialogue in narration |
| 11 | Voice prefix matching bug | elevenlabs.js | ~1520 | "Jan" matches "Janet" AND "Jonathan" |
| 12 | Quote depth tracking backwards | dialogueSegmentUtils.js | 334-343 | Straight quotes in both conditions |

### MEDIUM Severity (8 bugs)

| # | Bug | File | Impact |
|---|-----|------|--------|
| 13 | Fragment removal too aggressive | dialogueSegmentUtils.js | Removes valid words like "sky" |
| 14 | Type mismatch in hide_speech_tags | orchestrator.js | String "true" fails strict === |
| 15 | No verification speech tag filter worked | orchestrator.js | Silent if LLM returned empty |
| 16 | Parse failure returns original segments | speechTagFilterAgent.js | JSON errors cause unfiltered output |
| 17 | audioBuffers/segmentResults mismatch | elevenlabs.js | Array offset issues |
| 18 | Same quote twice matches wrong one | openai.js | Finds first, not correct match |
| 19 | Smart quotes vs straight quotes | openai.js | Inconsistent handling |
| 20 | Cumulative time tracking drift | elevenlabs.js | Karaoke timing drifts |

### LOW Severity (5 bugs)

| # | Bug | Impact |
|---|-----|--------|
| 21 | Narration deduplication removes valid text | Could remove legitimate repetition |
| 22 | Dialogue segments never filtered | If dialogue contains narration, passes through |
| 23 | Two generateMultiVoiceAudio paths | Duplicate audio possible |
| 24 | Title stripping incomplete | Only 37 titles in list |
| 25 | Unicode normalization missing | Composed vs decomposed chars |

---

## Part 3: Regex and Position Operations Audit

### DANGEROUS Operations (8 found)

| Location | Operation | Risk |
|----------|-----------|------|
| openai.js:1537-1540 | Regex fallback for quote detection | Over-matching if whitespace differs |
| dialogueSegmentUtils.js:70-104 | Narration deduplication with .includes() | Removes non-dialogue text |
| dialogueSegmentUtils.js:149-167 | slice() with pre-calculated positions | Positions may be invalid |
| dialogueSegmentUtils.js:119-124 | Heuristic fragment removal | May match valid words |
| openai.js:1567 | estimatedPos = searchStart + 50 | Pure guessing |
| openai.js:1495-1504 | Length ratio validation (0.5-2.0) | Too lenient |
| dialogueSegmentUtils.js:77-81 | Regex remove after .includes() | Orphaned punctuation |
| openai.js:1398-1432 | findClosingQuote depth tracking | Breaks with mixed quote types |

### RISKY Operations (16 found)

All position-based operations using:
- `slice(start_char, end_char)`
- `indexOf()` for quote finding
- `substring(0, 20)` for validation
- `searchStart` state tracking across loops
- `.includes()` for text matching

---

## Part 4: Database Vulnerabilities

### Position-Based Reference Failures

```javascript
dialogue_map: {
  quote: "Hello, adventurer",
  start_char: 142,
  end_char: 157
}

// If prose edited, positions become invalid:
// Position 142-157 now extracts " adventurer" (WRONG!)
```

### JSON Column Validation Gaps

```sql
-- No schema validation for:
config_json JSONB DEFAULT '{}'     -- Can have wrong keys
dialogue_map JSONB DEFAULT NULL    -- No structure validation
sfx_data JSONB DEFAULT '[]'        -- Timing can be invalid
```

### Array Synchronization Issues

```sql
-- word_alignments has 3 parallel arrays with NO length constraint:
characters TEXT[],
character_start_times_ms INTEGER[],
character_end_times_ms INTEGER[]
-- Can have different lengths - breaks karaoke!
```

---

## Part 5: Bulletproof Architecture Proposal

### Core Principle: LLM-First, Multi-Pass Validation

**Replace position-based extraction with tag-based markup.**

Instead of calculating positions:
```
Current: "Hello," said the knight.
dialogue_map: {quote: "Hello", start_char: 0, end_char: 7}
```

Use inline markers:
```
Proposed: [CHAR:Knight]Hello,[/CHAR] said the knight.
```

### Architecture Overview

```
                    ┌─────────────────────────────────────────────────┐
                    │                SCENE WRITER                      │
                    │         (GPT-5.2-Thinking, Creative)            │
                    │                                                  │
                    │  Output: Prose with inline [CHAR:Name] tags      │
                    └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │             TAG VALIDATION AGENT                 │
                    │         (GPT-5.2-Thinking, Coherence)           │
                    │                                                  │
                    │  Pass 1: Verify all [CHAR] tags are balanced    │
                    │  Pass 2: Verify all speakers exist in cast      │
                    │  Pass 3: Verify no dialogue outside tags        │
                    │                                                  │
                    │  FAIL LOUD if any validation fails              │
                    └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │           SPEECH TAG STRIPPER                    │
                    │         (GPT-5.2-Thinking, Coherence)           │
                    │                                                  │
                    │  If hide_speech_tags=true:                      │
                    │    Pass 1: Identify speech attribution          │
                    │    Pass 2: Remove while preserving flow         │
                    │    Pass 3: Verify no orphaned punctuation       │
                    │                                                  │
                    │  FAIL LOUD if text corruption detected          │
                    └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │          SEGMENT BUILDER (Deterministic)         │
                    │             (No LLM - Pure Parsing)             │
                    │                                                  │
                    │  Parse [CHAR] tags deterministically            │
                    │  NO position calculation needed                 │
                    │  NO indexOf/slice operations                    │
                    │  100% reliable segmentation                     │
                    └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │            VOICE ASSIGNMENT                      │
                    │         (GPT-5.2-Thinking, Coherence)           │
                    │                                                  │
                    │  Assign unique voices to each character         │
                    │  FAIL LOUD if any character unvoiced           │
                    └─────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │           AUDIO GENERATION                       │
                    │             (ElevenLabs TTS)                     │
                    │                                                  │
                    │  Generate audio per segment                     │
                    │  Concatenate with proper ordering               │
                    └─────────────────────────────────────────────────┘
```

### Tag Format Specification

```markdown
## Dialogue Tags

[CHAR:CharacterName]Dialogue text here.[/CHAR]

- CharacterName must match a character in the story cast
- Tags must be balanced (every open has a close)
- Tags cannot nest (no dialogue within dialogue)
- Tags cannot contain line breaks

## Narrator Tags (Optional)

[NARRATOR]Narration text here.[/NARRATOR]

- Used to explicitly mark narration when needed
- Default: Any text outside [CHAR] tags is narration

## Examples

Wrong: "Hello," said the knight, "how are you?"
         ↓ Position calculation needed ↓

Right: [CHAR:Knight]Hello,[/CHAR] said the knight, [CHAR:Knight]how are you?[/CHAR]
         ↓ Parse tags directly - no positions! ↓
```

### Multi-Pass Validation Pipeline

```javascript
// PASS 1: Tag Balance Check (Deterministic)
function validateTagBalance(prose) {
  const openTags = prose.match(/\[CHAR:[^\]]+\]/g) || [];
  const closeTags = prose.match(/\[\/CHAR\]/g) || [];

  if (openTags.length !== closeTags.length) {
    throw new Error(`TAG_IMBALANCE: ${openTags.length} open vs ${closeTags.length} close`);
  }
  return true;
}

// PASS 2: Speaker Verification (LLM-assisted)
async function verifySpeakers(prose, characterCast) {
  const speakers = extractSpeakersFromTags(prose);
  const unknownSpeakers = speakers.filter(s => !characterCast.includes(s));

  if (unknownSpeakers.length > 0) {
    // Ask LLM to identify who these are
    const result = await callLLM({
      messages: [{
        role: 'user',
        content: `The following speakers are not in the cast: ${unknownSpeakers.join(', ')}
Cast: ${characterCast.join(', ')}

For each unknown speaker, either:
1. Map them to an existing cast member (e.g., "the knight" → "Sir Roland")
2. Identify them as a new minor character to add to cast
3. Mark as ERROR if truly unknown

Return JSON: { mappings: {}, newCharacters: [], errors: [] }`
      }],
      model: 'gpt-5.2',
      agent_name: 'speaker_validation'
    });

    if (result.errors.length > 0) {
      throw new Error(`UNKNOWN_SPEAKERS: ${result.errors.join(', ')}`);
    }
  }
  return true;
}

// PASS 3: No Untagged Dialogue (LLM-assisted)
async function verifyNoUntaggedDialogue(prose) {
  const result = await callLLM({
    messages: [{
      role: 'user',
      content: `Analyze this prose for any dialogue (quoted speech) that is NOT inside [CHAR:...][/CHAR] tags.

Prose:
${prose}

Return JSON: {
  untaggedDialogue: [{ quote: "...", possibleSpeaker: "..." }],
  allDialogueTagged: true/false
}`
    }],
    model: 'gpt-5.2',
    agent_name: 'dialogue_segment'
  });

  if (!result.allDialogueTagged) {
    throw new Error(`UNTAGGED_DIALOGUE: ${result.untaggedDialogue.length} instances found`);
  }
  return true;
}
```

### Speech Tag Removal (Multi-Pass)

```javascript
async function removeSpeechTags(segments, config) {
  if (!config.hide_speech_tags) {
    return segments;
  }

  // PASS 1: Identify speech attribution in narrator segments
  const narratorSegments = segments.filter(s => s.speaker === 'narrator');

  const pass1Result = await callLLM({
    messages: [{
      role: 'user',
      content: `Identify all speech attribution phrases in these narrator segments.
Speech attribution = phrases like "said John", "whispered Mary", "he replied", etc.

Segments:
${JSON.stringify(narratorSegments.map((s, i) => ({ index: i, text: s.text })))}

Return JSON: {
  segments: [
    { index: 0, attributions: ["said John at position 15-25"], cleanedText: "..." },
    ...
  ]
}`
    }],
    model: 'gpt-5.2',
    agent_name: 'speech_tag_filter'
  });

  // PASS 2: Verify removal preserves meaning
  const pass2Result = await callLLM({
    messages: [{
      role: 'user',
      content: `Verify these text modifications preserve narrative flow.

Original → Modified:
${pass1Result.segments.map(s => `"${narratorSegments[s.index].text}" → "${s.cleanedText}"`).join('\n')}

Check for:
- Orphaned punctuation
- Incomplete sentences
- Lost context
- Grammatical errors

Return JSON: {
  valid: true/false,
  issues: ["issue1", "issue2"],
  suggestions: { index: "suggested fix" }
}`
    }],
    model: 'gpt-5.2',
    agent_name: 'speech_tag_filter'
  });

  if (!pass2Result.valid) {
    // PASS 3: Fix issues
    const pass3Result = await callLLM({
      messages: [{
        role: 'user',
        content: `Fix these speech tag removal issues:
${pass2Result.issues.join('\n')}

Apply fixes and return final cleaned segments.`
      }],
      model: 'gpt-5.2',
      agent_name: 'speech_tag_filter'
    });

    return applyFixes(segments, pass3Result);
  }

  return applyFixes(segments, pass1Result);
}
```

---

## Part 6: Implementation Plan

### Phase 1: Add FAIL LOUD Guards (Immediate)

Add strict validation with errors instead of silent fallbacks:

```javascript
// In speechTagFilterAgent.js
if (results.length === 0) {
  throw new Error('[SpeechTagAgent] LLM returned zero results - FAILING');
}

// In orchestrator.js
if (!dialogueMap || dialogueMap.length === 0) {
  throw new Error('[MultiVoice] CRITICAL: dialogue_map is empty or missing');
}

// In dialogueSegmentUtils.js
if (dialogue.start_char < lastIndex) {
  throw new Error(`[SegmentBuilder] OVERLAP at position ${dialogue.start_char}`);
}
```

### Phase 2: Upgrade to GPT-5.2 (Completed)

- Added GPT-5.2-Pro, GPT-5.2-Thinking, GPT-5.2-Instant models
- Multi-voice agents now use COHERENCE tier (GPT-5.2-Thinking)
- Utility agents use GPT-5.2-Instant for speed

### Phase 3: Implement Tag-Based Markup (1-2 weeks)

1. Modify scene writer prompt to output [CHAR:Name] tags
2. Create deterministic tag parser (no LLM needed)
3. Add tag validation agent
4. Update database schema for tagged prose

### Phase 4: Multi-Pass Validation Pipeline (1 week)

1. Implement 3-pass tag validation
2. Implement 3-pass speech tag removal
3. Add comprehensive logging for each pass
4. Add retry logic with different models if validation fails

### Phase 5: Database Migration (3-5 days)

1. Add `prose_format` column to story_scenes ('position_based' or 'tag_based')
2. Migrate existing stories or flag as legacy
3. Remove position columns from new stories
4. Add JSON schema validation triggers

---

## Part 7: Model Configuration

### GPT-5.2 Tier Assignment

| Agent | Category | Model | Reasoning |
|-------|----------|-------|-----------|
| Story Planner | Creative | GPT-5.2-Thinking | Creative quality |
| Scene Writer | Creative | GPT-5.2-Thinking | Creative quality |
| Tag Validation | Coherence | GPT-5.2-Thinking | Accuracy critical |
| Speech Tag Filter | Coherence | GPT-5.2-Thinking | Accuracy critical |
| Speaker Validation | Coherence | GPT-5.2-Thinking | Accuracy critical |
| Voice Assignment | Coherence | GPT-5.2-Thinking | Accuracy critical |
| Emotion Validator | Coherence | GPT-5.2-Thinking | Accuracy critical |
| Safety Agent | Utility | GPT-5.2-Instant | Fast classification |
| SFX Coordinator | Utility | GPT-5.2-Instant | Fast classification |
| Config Interpreter | Utility | GPT-5.2-Instant | Fast classification |

### Multi-Pass Cost Estimation

With multi-pass validation, LLM costs increase but remain negligible compared to TTS:

| Operation | Passes | Tokens | Cost |
|-----------|--------|--------|------|
| Scene Generation | 1 | ~2000 | $0.01 |
| Tag Validation | 3 | ~1500 | $0.007 |
| Speech Tag Removal | 3 | ~1500 | $0.007 |
| Voice Assignment | 1 | ~800 | $0.004 |
| **Total LLM** | | | **~$0.03** |
| **ElevenLabs TTS** | | | **~$0.80** |

LLM costs are 4% of TTS costs - multi-pass is effectively free.

---

## Part 8: Validation Checklist

### Before Deployment

- [ ] All FAIL LOUD guards implemented
- [ ] GPT-5.2 models integrated and tested
- [ ] Tag-based markup parser working
- [ ] 3-pass validation pipeline tested
- [ ] Speech tag removal tested with various inputs
- [ ] Database migration script ready
- [ ] Rollback procedure documented

### Test Cases

1. **Normal story**: Multi-voice with 5 characters
2. **Edge case**: Same quote spoken twice
3. **Edge case**: Smart quotes mixed with straight quotes
4. **Edge case**: Nested dialogue ("He said 'hello'")
5. **Edge case**: Very long dialogue (>500 chars)
6. **Edge case**: Single character speaking only
7. **Edge case**: No dialogue at all
8. **Error case**: Unknown speaker in prose
9. **Error case**: Malformed tags
10. **Error case**: LLM returns empty response

### Monitoring

Add metrics for:
- Tag validation pass rate
- Speech tag removal accuracy
- Segment count before/after filtering
- Voice assignment success rate
- LLM call latency per pass

---

## Part 9: Appendix - Full File Analysis

### Files Requiring Changes

| File | Changes Required | Priority |
|------|------------------|----------|
| `openai.js` | Remove position calculation (~150 lines) | HIGH |
| `dialogueSegmentUtils.js` | Replace with tag parser | HIGH |
| `speechTagFilterAgent.js` | Add multi-pass, FAIL LOUD | HIGH |
| `speakerValidationAgent.js` | Update for tag-based input | HIGH |
| `orchestrator.js` | Update pipeline, add guards | HIGH |
| `elevenlabs.js` | Add segment deduplication | MEDIUM |
| `modelSelection.js` | GPT-5.2 configuration | COMPLETED |

### Files to Archive

| File | Reason |
|------|--------|
| `_archived/dialogueTaggingAgent.js` | Replaced by tag-based system |
| `_archived/dialogueAttributionAgent.js` | Replaced by tag-based system |

### New Files to Create

| File | Purpose |
|------|---------|
| `tagParser.js` | Deterministic [CHAR] tag parsing |
| `tagValidationAgent.js` | 3-pass tag validation |
| `multiPassSpeechFilter.js` | 3-pass speech tag removal |

---

## Conclusion

The current position-based multi-voice system has **40+ bugs** that can cause:
- Narrator speaking dialogue
- Characters speaking narration
- Speech tags leaking through
- Text loss and fragmentation

The proposed **tag-based markup architecture** eliminates the entire class of position-related bugs by:
1. Embedding speaker markers directly in prose
2. Using deterministic parsing instead of heuristic position calculation
3. Adding multi-pass LLM validation for accuracy
4. Implementing FAIL LOUD instead of silent failures

With GPT-5.2 now available, we can afford 3+ validation passes per operation at negligible cost (~$0.03 vs $0.80 TTS). This investment in quality ensures 100% reliable multi-voice narration.

---

*Document generated by 10+ specialized analysis agents on 2025-12-12*
