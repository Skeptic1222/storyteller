# Storyteller Logging Standards

**Version**: 1.0.0
**Last Updated**: 2025-12-12
**Purpose**: Enable complete system visibility without user middleman for debugging

> "If it cannot be measured then it cannot be managed"

## Quick Reference

| Prefix | Category | Location | Priority |
|--------|----------|----------|----------|
| `[Audio]` | Audio state machine | Client Story.jsx | Tier 1 |
| `[SFX]` | Sound effects trigger/block | Client Story.jsx | Tier 1 |
| `[Socket:Emit]` | Client socket emissions | Client various | Tier 2 |
| `[Socket:Recv]` | Client socket receives | Client various | Tier 2 |
| `[Socket]` | Connection state | Client SocketContext.jsx | Tier 2 |
| `[Scene+Dialogue]` | Position calculation | Server openai.js | Tier 1 |
| `[SegmentBuilder]` | Segment conversion | Server dialogueSegmentUtils.js | Tier 1 |
| `[SpeechTagAgent]` | Speech tag filtering | Server speechTagFilterAgent.js | Tier 1 |
| `[MultiVoice]` | Voice segment processing | Server elevenlabs.js | Tier 2 |
| `[AudioTags]` | Prosody tag wrapping | Server elevenlabs.js | Tier 2 |
| `[VoiceAssignment]` | Voice casting | Server voiceAssignmentAgent.js | Tier 3 |
| `[CoverArt]` | Cover generation | Server handlers.js | Tier 3 |
| `[Provider]` | LLM routing | Server llmProviders.js | Tier 3 |
| `[Queue]` | Audio queue state | Client AudioContext.jsx | Tier 2 |
| `[Karaoke]` | Word timing sync | Client Story.jsx | Tier 3 |
| `[Launch]` | Launch sequence | Client useLaunchSequence.js | Tier 2 |
| `[Orchestrator]` | Scene coordination | Server orchestrator.js | Tier 2 |
| `[Story]` | Story page state | Client Story.jsx | Tier 2 |

## Tier 1: Critical Path Logging (Must Have)

### Audio State Machine (Story.jsx)

Track all state transitions with timestamps:

```javascript
// State: IDLE → INTRO_QUEUED → INTRO_PLAYING → INTRO_ENDED → SCENE_QUEUED → SCENE_PLAYING → ENDED

// On intro-audio-ready
console.log('[Audio] STATE: IDLE → INTRO_QUEUED | introAudioQueued=true');

// On intro audio starts playing (via AudioContext callback)
console.log('[Audio] STATE: INTRO_QUEUED → INTRO_PLAYING');

// On scene audio queued
console.log('[Audio] STATE: INTRO_PLAYING → SCENE_QUEUED | sceneAudioQueued=true');

// On scene audio onStart callback
console.log('[Audio] STATE: SCENE_QUEUED → SCENE_PLAYING | sceneAudioStarted=true');

// On audio ends
console.log('[Audio] STATE: SCENE_PLAYING → ENDED | isPlaying=false');
```

**Required state variables to log**:
- `introAudioQueued` (boolean)
- `sceneAudioQueued` (boolean)
- `sceneAudioStarted` (boolean)
- `isPlaying` (from AudioContext)
- `isPaused` (from AudioContext)

### SFX Trigger Logging (Story.jsx)

Every SFX trigger attempt must log:

```javascript
// Blocked triggers
console.log('[SFX] TRIGGER_BLOCKED | reason: intro_audio_active | introAudioQueued:', introAudioQueued, '| sceneAudioStarted:', sceneAudioStartedRef.current);

// Successful triggers
console.log('[SFX] TRIGGER_SUCCESS | source: onStart_callback | effects:', sfxList.length, '| keys:', sfxList.map(s => s.sfx_key));

// Skipped (disabled or empty)
console.log('[SFX] TRIGGER_SKIPPED | enabled:', sfxEnabled, '| sfxList:', sfxList?.length || 0);
```

**Trigger sources to identify**:
- `onStart_callback` - Scene audio started playing
- `text_only_mode` - User chose text-only
- `sfxDetails_change` - SFX details updated (should NOT trigger during intro)
- `manual_retry` - User regenerated SFX

### Position Calculation (openai.js)

Log the quote-finding algorithm steps:

```javascript
// For each dialogue entry
logger.info(`[Scene+Dialogue] Finding quote[${idx}]: "${quote.substring(0, 40)}..." by ${speaker}`);

// Character-by-character search (debug level)
logger.debug(`[Scene+Dialogue]   Scanning from pos ${searchStart}, found opening quote char '${char}' at ${i}`);

// Match attempt
logger.debug(`[Scene+Dialogue]   Checking if afterQuote starts with "${firstWords.substring(0, 30)}..."`);

// Match found
logger.info(`[Scene+Dialogue]   MATCH: [${startPos}-${endPos}] | matchedText: "${matchedText.substring(0, 50)}..."`);

// Match failed - CRITICAL
logger.error(`[Scene+Dialogue]   NO_MATCH: Could not locate quote in prose | searchStart: ${searchStart} | proseLength: ${prose.length}`);

// Position validation
logger.info(`[Scene+Dialogue] Position validation: ${enrichedDialogueMap.length} quotes | overlaps: ${overlapCount}`);
```

### Segment Building (dialogueSegmentUtils.js)

Log the segment construction:

```javascript
// Input summary
logger.info(`[SegmentBuilder] INPUT: sceneText=${sceneText.length} chars | dialogueMap=${dialogueMap.length} entries`);

// Per-segment creation
logger.debug(`[SegmentBuilder] SEGMENT[${idx}]: type=${speaker === 'narrator' ? 'NARRATION' : 'DIALOGUE'} | speaker=${speaker} | chars=[${startPos}-${endPos}] | length=${text.length}`);
logger.debug(`[SegmentBuilder]   text: "${text.substring(0, 80)}..."`);

// Deduplication detection
logger.warn(`[SegmentBuilder] DUPLICATE_DETECTED: narration contains dialogue quote | removing "${duplicate.substring(0, 40)}..."`);

// Output summary
logger.info(`[SegmentBuilder] OUTPUT: ${segments.length} segments | narration=${narratorCount} | dialogue=${dialogueCount} | totalChars=${totalChars}`);

// Duplication warning
logger.error(`[SegmentBuilder] CHAR_OVERFLOW: segments total ${totalChars} but scene is ${sceneText.length} chars (${((totalChars/sceneText.length)*100).toFixed(1)}%)`);
```

### Speech Tag Filtering (speechTagFilterAgent.js)

Log LLM analysis and filtering decisions:

```javascript
// Input
logger.info(`[SpeechTagAgent] INPUT: ${segments.length} segments | ${narratorSegments.length} narrator segments to analyze`);

// LLM call
logger.info(`[SpeechTagAgent] LLM_CALL: agent=SpeechTagFilter | model=utility | temperature=0.1`);

// Per-segment decision (debug level but CRITICAL for debugging)
logger.debug(`[SpeechTagAgent] SEGMENT[${idx}]: action=${action} | original="${original.substring(0, 50)}..." | result="${result.substring(0, 50)}..."`);
// where action = KEPT | STRIPPED | REMOVED

// Summary
logger.info(`[SpeechTagAgent] OUTPUT: removed=${removedCount} entire | stripped=${strippedCount} partial | unchanged=${unchangedCount}`);
logger.info(`[SpeechTagAgent] RESULT: ${finalSegments.length} segments (was ${segments.length})`);
```

## Tier 2: Supporting Visibility

### Socket Event Logging

**Client emissions** (log BEFORE emit):
```javascript
console.log('[Socket:Emit] EVENT: continue-story | data:', { session_id: sessionId, voice_id: voiceId, autoplay });
console.log('[Socket:Emit] EVENT: submit-choice | data:', { session_id: sessionId, choice_key: choiceKey });
console.log('[Socket:Emit] EVENT: start-playback | data:', { session_id: sessionId });
```

**Client receives** (log on receive):
```javascript
console.log('[Socket:Recv] EVENT: intro-audio-ready | hasAudio:', !!data.audio, '| format:', data.format);
console.log('[Socket:Recv] EVENT: audio-ready | hasTimings:', !!data.wordTimings, '| wordCount:', data.wordTimings?.words?.length);
console.log('[Socket:Recv] EVENT: sfx-ready | count:', data.sfxList?.length);
```

### Audio Queue State (AudioContext.jsx)

```javascript
console.log('[Queue] ENQUEUE | type:', audioType, '| hasOnStart:', !!onStart, '| queueLength:', queue.length + 1);
console.log('[Queue] DEQUEUE | playing:', currentItem?.type, '| remaining:', queue.length);
console.log('[Queue] CLEAR | cleared:', queue.length, 'items');
console.log('[Queue] CALLBACK | onStart fired for:', currentItem?.type);
```

### Audio Tag Wrapping (elevenlabs.js)

```javascript
logger.debug(`[AudioTags] WRAP: emotion=${emotion} | tag=${audioTag} | original="${text.substring(0, 40)}..." | wrapped="${wrapped.substring(0, 50)}..."`);
logger.info(`[AudioTags] SUMMARY: ${wrappedCount}/${totalSegments} segments wrapped with audio tags`);
```

### Launch Sequence (useLaunchSequence.js)

```javascript
console.log('[Launch] STAGE_UPDATE | stage:', stageName, '| status:', status, '| error:', error || 'none');
console.log('[Launch] COUNTDOWN | phase:', phase, '| value:', value, '| autoplay:', autoplayEnabled);
console.log('[Launch] READY | stats:', { title, voiceCount, sfxCount, coverReady });
```

### Orchestrator (orchestrator.js)

```javascript
logger.info(`[Orchestrator] SCENE_START | sceneIdx: ${idx} | sessionId: ${sessionId}`);
logger.info(`[Orchestrator] AGENT_CALL | agent: ${agentName} | input: ${JSON.stringify(input).substring(0, 100)}...`);
logger.info(`[Orchestrator] SCENE_COMPLETE | sceneIdx: ${idx} | duration: ${duration}ms | segments: ${segmentCount}`);
```

## Tier 3: Extended Diagnostics

### Provider Selection (llmProviders.js)

```javascript
logger.info(`[Provider] SELECT | gore: ${gore}% | romance: ${romance}% | adult: ${adult}% | selected: ${provider}`);
logger.info(`[Provider] ROUTE | agent: ${agentName} | category: ${category} | model: ${model} | tokens: ${maxTokens}`);
```

### Cover Art Generation (handlers.js)

```javascript
logger.info(`[CoverArt] PROMPT_GEN | tier1: "${tier1.substring(0, 60)}..." | tier2: "${tier2.substring(0, 60)}..." | tier3: "${tier3.substring(0, 60)}..."`);
logger.info(`[CoverArt] ATTEMPT | tier: ${tierNum} | prompt: "${prompt.substring(0, 80)}..."`);
logger.info(`[CoverArt] RESULT | tier: ${tierNum} | success: ${success} | fallback: ${fellBack}`);
```

### Voice Assignment (voiceAssignmentAgent.js)

```javascript
logger.info(`[VoiceAssignment] INPUT | characters: ${characters.length} | availableVoices: ${voices.length}`);
logger.debug(`[VoiceAssignment] ASSIGN | character: ${charName} | voice: ${voiceName} | reason: ${reasoning}`);
logger.info(`[VoiceAssignment] REPAIR | duplicates: ${duplicateCount} | repaired: ${repairedCount}`);
logger.info(`[VoiceAssignment] OUTPUT | assignments: ${Object.keys(assignments).length}`);
```

## Log Format Standards

### Structured Format

Use consistent key=value pairs for machine parsing:

```
[Prefix] ACTION | key1: value1 | key2: value2 | key3: value3
```

### Timestamp Format

- **Server (Winston)**: Auto-added as JSON `timestamp` field
- **Client**: Use `performance.now()` for timing-critical logs:

```javascript
const audioStart = performance.now();
// ... audio operation
console.log(`[Audio] DURATION: ${(performance.now() - audioStart).toFixed(1)}ms`);
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `error` | Something failed that shouldn't have |
| `warn` | Unexpected but handled condition |
| `info` | Significant state changes, summaries |
| `debug` | Per-item details, algorithm steps |

### Text Truncation

Always truncate long text in logs:

```javascript
const truncate = (text, maxLen = 50) =>
  text?.length > maxLen ? `${text.substring(0, maxLen)}...` : text;

logger.info(`[Prefix] text: "${truncate(longText, 80)}"`);
```

## Implementation Checklist

### Tier 1 (Critical) - COMPLETE THESE FIRST

- [x] **Story.jsx**: Audio state transitions with explicit state names
- [x] **Story.jsx**: SFX trigger/block with reason codes
- [x] **openai.js**: Position calculation character-by-character logging
- [x] **dialogueSegmentUtils.js**: Segment building with char positions
- [x] **speechTagFilterAgent.js**: LLM filtering decisions

### Tier 2 (Supporting)

- [x] **Story.jsx**: Socket emissions before every `socket.emit()`
- [x] **Story.jsx**: Socket receives for all `socket.on()` handlers
- [x] **AudioContext.jsx**: Queue operations (enqueue, dequeue, clear)
- [x] **elevenlabs.js**: Audio tag wrapping details
- [x] **useLaunchSequence.js**: Stage transitions and countdown

### Tier 3 (Extended)

- [x] **llmProviders.js**: Provider selection with intensity scores
- [x] **handlers.js**: Cover art tier selection and fallbacks
- [x] **handlers.js**: Server-side socket handler logging
- [x] **voiceAssignmentAgent.js**: Assignment reasoning
- [x] **orchestrator.js**: Scene coordination timeline

## Debugging Scenarios

### "SFX plays during synopsis"

Look for:
```
[Audio] STATE: * → INTRO_QUEUED
[SFX] TRIGGER_* | introAudioQueued: true | sceneAudioStarted: false
```

If SFX triggered with `introAudioQueued=true` and `sceneAudioStarted=false`, the guard failed.

### "Narrator repeats dialogue"

Look for:
```
[SegmentBuilder] DUPLICATE_DETECTED
[SegmentBuilder] CHAR_OVERFLOW
[Scene+Dialogue] OVERLAP
```

### "Wrong voice speaks line"

Look for:
```
[Scene+Dialogue] MATCH | speaker: X
[VoiceAssignment] ASSIGN | character: X | voice: Y
[MultiVoice] Segment[n] speaker: X → voice: Y
```

### "Quote not found"

Look for:
```
[Scene+Dialogue] NO_MATCH
[Scene+Dialogue] QUOTE NOT FOUND
```

Then check the prose content and quote text in surrounding logs.

## Client Debug Mode

Enable verbose client logging in browser console:

```javascript
localStorage.setItem('storyteller_debug', 'true');
// Refresh page
```

Or use exposed function:
```javascript
window.storytellerDebug(true);  // Enable
window.storytellerDebug(false); // Disable
```

## Server Log Files

| File | Content |
|------|---------|
| `logs/combined.log` | All server logs (JSON format) |
| `logs/error.log` | Errors only |
| `logs/ai-calls.log` | LLM API calls |

View recent logs:
```powershell
Get-Content C:\inetpub\wwwroot\storyteller\logs\combined.log -Tail 100
```

Search for specific prefix:
```powershell
Select-String -Path C:\inetpub\wwwroot\storyteller\logs\combined.log -Pattern "\[SpeechTagAgent\]" | Select-Object -Last 50
```
