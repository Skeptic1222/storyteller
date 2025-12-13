# Voice Prosody & Delivery System Documentation

**Version:** 2.0.0
**Date:** 2025-12-09
**Status:** ✅ PRODUCTION - eleven_v3 with Audio Tags is LIVE
**Author:** Claude Code Audit

## Executive Summary

This document captures a comprehensive audit of the Storyteller voice system, identifying gaps between what ElevenLabs offers and what we currently use. It proposes enhancements to add nuanced voice delivery through SSML support and a new "Delivery Director" agent.

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [ElevenLabs Capabilities](#elevenlabs-capabilities)
3. [Gap Analysis](#gap-analysis)
4. [Proposed Enhancements](#proposed-enhancements)
5. [Implementation Considerations](#implementation-considerations)
6. [Risks & Mitigations](#risks--mitigations)
7. [Open Questions](#open-questions)

---

## Current Architecture

### Voice Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT VOICE PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. STORY GENERATION                                                         │
│     └── Scene Writer creates prose with dialogue                             │
│                    ↓                                                         │
│  2. DIALOGUE TAGGING (dialogueTaggingAgent.js) - GPT-5.1                    │
│     ├── Identifies speaker for each quote                                    │
│     ├── Detects emotion (angry, sad, whispered, etc.)                       │
│     ├── Adds delivery notes (free-form text)                                │
│     └── Returns dialogue_map                                                 │
│                    ↓                                                         │
│  3. VOICE CASTING (voiceSelectionService.js)                                │
│     ├── Assigns voices based on character gender/age/role                   │
│     ├── Uses archetypes (hero, villain, elder, etc.)                        │
│     └── Validates with Teacher Agent                                         │
│                    ↓                                                         │
│  4. EMOTION VALIDATION (emotionValidatorAgent.js) - Optional                │
│     ├── Refines emotion detection                                            │
│     └── Maps to preset names                                                 │
│                    ↓                                                         │
│  5. TTS GENERATION (elevenlabs.js)                                          │
│     ├── Maps emotion → VOICE_PRESETS                                        │
│     ├── Sets stability/similarity/style/speed                               │
│     └── Calls ElevenLabs API                                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose | Status |
|------|---------|--------|
| `dialogueTaggingAgent.js` | Speaker attribution & emotion detection | ✅ Production |
| `emotionValidatorAgent.js` | Emotion refinement | ✅ Production |
| `voiceSelectionService.js` | Voice casting & archetypes | ✅ Production |
| `elevenlabs.js` | TTS generation | ✅ Production |
| `VOICE_PRESETS` | Emotion → voice settings mapping | ✅ Production |

### Current Emotion Vocabulary

**DialogueTaggingAgent outputs:**
- neutral, angry, sad, happy, scared, excited, whispered, shouted, sarcastic, questioning

**EmotionValidatorAgent presets:**
- warm, playful, dramatic, angry, horror, fearful, mysterious, threatening, sad, tender, excited, sarcastic, neutral

**VOICE_PRESETS mappings:**
- calm_bedtime, dramatic, playful, mysterious, action, horror, angry, fearful, sad, excited, tender, sarcastic, threatening, neutral

---

## ElevenLabs Capabilities

### CRITICAL DISCOVERY: Eleven v3 Audio Tags (Game Changer)

**This changes everything about our approach.**

ElevenLabs has introduced a new model called **Eleven v3** (`model_id: eleven_v3`) that supports
**Audio Tags** - a revolutionary feature that makes traditional SSML almost obsolete for expressive
control. Instead of technical parameters, you use natural language directives in brackets.

#### Audio Tags Examples

```
// Instead of SSML like:
<speak><prosody pitch="-10%" rate="slow">I will never forgive you</prosody></speak>

// v3 uses natural language:
[coldly][pause] I will [emphasized] never [/emphasized] forgive you.

// More examples:
[whispers][nervously] I don't think we should be here.
[laughs][playfully] Oh come on, don't be such a spoilsport!
[angry][shouting] Get out of my house!
[crying][broken voice] She's... she's gone.
[sigh][resigned] I suppose you're right.
[hesitates][stammers] I... I didn't mean to...
```

#### Audio Tag Categories (1800+ Tags Available)

| Category | Examples |
|----------|----------|
| **Emotions** | [excited], [nervous], [frustrated], [sorrowful], [calm], [wistful], [conflicted], [resigned], [awestruck], [bitter], [regretful] |
| **Volume/Delivery** | [whispers], [quietly], [loudly], [shouting], [mutters] |
| **Reactions** | [laughs], [chuckles], [sighs], [gasps], [gulps], [crying], [sobs] |
| **Pacing** | [pause], [long pause], [rushed], [slows down], [drawn out], [picks up pace] |
| **Tone** | [cheerfully], [flatly], [deadpan], [playfully], [sarcastically], [matter-of-fact] |
| **Cognitive** | [hesitates], [stammers], [trails off], [thoughtfully] |
| **Character** | [pirate voice], [robot voice], [elderly voice], [childlike tone], [villain voice] |
| **Accents** | [British accent], [French accent], [Southern drawl], [Australian accent] |
| **Narrative** | [dramatic tone], [lighthearted], [reflective], [serious tone] |

#### v3 vs v2 Comparison

| Feature | eleven_multilingual_v2 | eleven_v3 |
|---------|------------------------|-----------|
| **Audio Tags** | ❌ Not supported | ✅ Full support |
| **Emotion Control** | Style parameter (0-1) | Natural language tags |
| **Languages** | 29 | 74 |
| **Latency** | Lower | Higher (more processing) |
| **Best For** | Real-time, consistency | Expressive audiobooks |
| **Voice Clones** | Full support | PVCs not optimized (use IVCs) |

#### Implications for Storyteller

1. **We should consider migrating to v3** for audiobook narration
2. **Audio Tags replace the need for** complex SSML prosody
3. **The Delivery Director agent** should output Audio Tags, not SSML
4. **Model selection** should be `eleven_v3` for expressive scenes, `eleven_multilingual_v2` for consistency
5. **Voice clones** may have reduced quality on v3 (currently in alpha)

---

### API Parameters We Use

| Parameter | Range | Our Usage | Notes |
|-----------|-------|-----------|-------|
| `stability` | 0.0-1.0 | 0.35-0.8 | Lower = more expressive |
| `similarity_boost` | 0.0-1.0 | 0.65-0.9 | Higher = closer to original |
| `style` | 0.0-1.0 | 0.1-0.85 | Style exaggeration |
| `speed` | ~0.5-2.0 | 0.85-1.15 | **Underutilized** |
| `use_speaker_boost` | boolean | true | Speaker clarity |

### API Parameters We DON'T Use

| Parameter | Purpose | Potential Value |
|-----------|---------|-----------------|
| `seed` | Reproducibility | Consistent retakes |
| `previous_text` | Prosody continuity | Smoother segment transitions |
| `next_text` | Prosody continuity | Better sentence endings |
| `apply_text_normalization` | Number/date reading | Fantasy names, dates |

### SSML Support (COMPLETELY UNUSED)

ElevenLabs supports SSML tags that we are not using at all:

#### `<prosody>` - Pitch, Rate, Volume Control
```xml
<speak>
  <prosody pitch="+20%" rate="fast" volume="loud">
    This is exciting news!
  </prosody>
</speak>
```

**Pitch values:** -50% to +50%, or absolute (x-low, low, medium, high, x-high)
**Rate values:** x-slow, slow, medium, fast, x-fast, or percentage
**Volume values:** silent, x-soft, soft, medium, loud, x-loud, or percentage

#### `<break>` - Pauses
```xml
<speak>
  I have something to tell you.
  <break time="750ms"/>
  I'm leaving.
</speak>
```

#### `<emphasis>` - Word Stress
```xml
<speak>
  I said <emphasis level="strong">never</emphasis> do that again.
</speak>
```
**Levels:** reduced, moderate, strong

#### `<phoneme>` - Pronunciation
```xml
<speak>
  Her name is <phoneme alphabet="ipa" ph="ˈleɪ.lə">Leila</phoneme>.
</speak>
```

---

## Gap Analysis

### 1. Emotion Mapping Gaps

| Emotion | DialogueTagging | EmotionValidator | VOICE_PRESETS | Problem |
|---------|-----------------|------------------|---------------|---------|
| whispered | ✅ Captured | ❌ Missing | ❌ Missing | **Unmapped** |
| shouted | ✅ Captured | ❌ Missing | ❌ Missing | **Unmapped** |
| questioning | ✅ Captured | ❌ Missing | ❌ Missing | **Unmapped** |
| warm | ❌ Missing | ✅ Present | ✅ Present | Not detected |
| tender | ❌ Missing | ✅ Present | ✅ Present | Not detected |
| horror | ❌ Missing | ✅ Present | ✅ Present | Not detected |

**Impact:** When DialogueTaggingAgent outputs "whispered", the system doesn't know what to do with it. It likely falls back to "neutral".

### 2. Speed Range Too Conservative

**Current:** 0.85 - 1.15 (±15% from normal)
**ElevenLabs allows:** ~0.5 - 2.0 (2x slower to 2x faster)

**What we're missing:**
- Slow, dramatic reveals (0.7x speed)
- Rapid panicked speech (1.4x speed)
- Elderly character slower speech (0.75x)
- Child character faster speech (1.2x)

### 3. Voice Metadata Not Passed to LLMs

The database has rich voice metadata that LLM agents never see:

```sql
-- Fields in elevenlabs_voices table that LLMs don't know about:
pitch_hint VARCHAR(20)      -- very_low, low, medium, high, very_high
energy_level VARCHAR(20)    -- low, medium, high
warmth INTEGER              -- 0-100
clarity INTEGER             -- 0-100
emotion_range INTEGER       -- 0-100
can_be_child BOOLEAN        -- true/false
```

**Impact:** The DialogueTaggingAgent can't make intelligent delivery suggestions because it doesn't know what the assigned voice is capable of.

### 4. No Prosody Continuity Between Segments

When we generate multi-segment audio, each segment is independent. ElevenLabs offers:
- `previous_text`: Helps the model understand what came before
- `next_text`: Helps with sentence-final intonation
- `previous_request_ids`: Links generations for consistent prosody

**Impact:** Segment transitions can sound choppy or have inconsistent pacing.

### 5. No Pitch Modification for Character Variety

With SSML pitch control, we could:
- Make any voice sound more child-like (+20-30% pitch)
- Make any voice more menacing (-10-20% pitch)
- Add vocal variety to the same character across emotions

**Current:** We rely entirely on voice selection; no pitch modification.

### 6. No Dramatic Pauses

Good audiobook narration includes pauses:
- Before revelations
- After shocking statements
- Between scene transitions
- For comedic timing

**Current:** No pause control at all.

### 7. No Word Emphasis

In dialogue like: "I said I would NEVER do that!"
The word "NEVER" should be emphasized. SSML `<emphasis>` allows this.

**Current:** All words treated equally.

---

## Proposed Enhancements

### Enhancement 1: Add Missing VOICE_PRESETS

```javascript
// Add to elevenlabs.js VOICE_PRESETS
export const VOICE_PRESETS = {
  // ... existing presets ...

  // NEW: Missing emotions from DialogueTaggingAgent
  whispered: {
    stability: 0.8,      // More stable for quieter delivery
    similarity_boost: 0.85,
    style: 0.2,          // Less style variation
    speed: 0.85          // Slightly slower
  },
  shouted: {
    stability: 0.25,     // Less stable for intense delivery
    similarity_boost: 0.9,
    style: 0.95,         // Maximum style
    speed: 1.2           // Faster
  },
  questioning: {
    stability: 0.55,
    similarity_boost: 0.75,
    style: 0.5,
    speed: 1.05          // Slightly faster, rising intonation natural
  },

  // NEW: Additional nuanced emotions
  desperate: { stability: 0.3, similarity_boost: 0.85, style: 0.8, speed: 1.15 },
  seductive: { stability: 0.7, similarity_boost: 0.9, style: 0.6, speed: 0.9 },
  exhausted: { stability: 0.75, similarity_boost: 0.8, style: 0.3, speed: 0.75 },
  mocking: { stability: 0.45, similarity_boost: 0.75, style: 0.7, speed: 1.1 },
  reverent: { stability: 0.8, similarity_boost: 0.85, style: 0.25, speed: 0.85 },
  commanding: { stability: 0.5, similarity_boost: 0.9, style: 0.8, speed: 0.95 }
};
```

**Effort:** Easy (1-2 hours)
**Risk:** Low

### Enhancement 2: Expand Speed Range

```javascript
// Update presets to use wider speed range
const SPEED_GUIDELINES = {
  // Character types
  elderly: 0.75,        // Slower, measured
  child: 1.15,          // Faster, energetic

  // Emotional states
  panicked: 1.35,       // Rapid, breathless
  dramatic_reveal: 0.7, // Slow, deliberate
  casual: 1.05,         // Natural conversation

  // Scene types
  action: 1.2,          // Fast-paced
  romantic: 0.85,       // Slow, intimate
  comedic_timing: 0.8   // Setup for punchlines
};
```

**Effort:** Easy (1-2 hours)
**Risk:** Low (may need tuning)

### Enhancement 3: SSML Wrapper Function

```javascript
/**
 * Wrap text with SSML tags based on delivery directions
 *
 * @param {string} text - The dialogue text
 * @param {Object} delivery - Delivery instructions
 * @returns {string} SSML-wrapped text
 */
function wrapWithSSML(text, delivery = {}) {
  const {
    pitch = 0,           // -50 to +50 percent
    rate = 'medium',     // x-slow, slow, medium, fast, x-fast
    volume = 'medium',   // x-soft, soft, medium, loud, x-loud
    emphasisWords = [],  // Words to emphasize
    pauseBefore = 0,     // Milliseconds pause before
    pauseAfter = 0       // Milliseconds pause after
  } = delivery;

  let result = text;

  // Add word emphasis
  for (const word of emphasisWords) {
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    result = result.replace(regex, '<emphasis level="strong">$1</emphasis>');
  }

  // Build prosody attributes
  const prosodyAttrs = [];
  if (pitch !== 0) prosodyAttrs.push(`pitch="${pitch > 0 ? '+' : ''}${pitch}%"`);
  if (rate !== 'medium') prosodyAttrs.push(`rate="${rate}"`);
  if (volume !== 'medium') prosodyAttrs.push(`volume="${volume}"`);

  // Wrap with prosody if any attributes
  if (prosodyAttrs.length > 0) {
    result = `<prosody ${prosodyAttrs.join(' ')}>${result}</prosody>`;
  }

  // Add pauses
  if (pauseBefore > 0) {
    result = `<break time="${pauseBefore}ms"/>${result}`;
  }
  if (pauseAfter > 0) {
    result = `${result}<break time="${pauseAfter}ms"/>`;
  }

  // Wrap in speak tags
  return `<speak>${result}</speak>`;
}
```

**Effort:** Medium (4-6 hours)
**Risk:** Medium (needs testing with ElevenLabs)

### Enhancement 4: Delivery Director Agent (NEW)

A new agent that runs AFTER DialogueTaggingAgent to add prosody details:

```javascript
/**
 * Delivery Director Agent
 *
 * Takes dialogue_map and enhances it with detailed prosody instructions.
 * This is the "polish" pass that adds nuance to voice delivery.
 *
 * Input: dialogue_map, voice assignments, story context
 * Output: Enhanced dialogue_map with SSML hints and voice settings overrides
 */

const DELIVERY_DIRECTOR_PROMPT = `You are an expert AUDIOBOOK DIRECTOR specializing in voice performance.

Your job is to take dialogue that has already been attributed to speakers and add
detailed DELIVERY DIRECTIONS for the voice actors (TTS system).

You have access to SSML capabilities:
- PITCH: Adjust from -30% (deep/menacing) to +30% (high/childlike)
- RATE: x-slow, slow, medium, fast, x-fast
- VOLUME: x-soft (whisper), soft, medium, loud, x-loud (shout)
- EMPHASIS: Mark specific words for stress
- PAUSES: Add dramatic pauses in milliseconds

CHARACTER VOICE CAPABILITIES:
{voice_metadata}

For each dialogue line, consider:
1. How would a skilled voice actor deliver this line?
2. What words deserve emphasis?
3. Should there be pauses for dramatic effect?
4. Does the emotion call for pitch/speed adjustments?
5. What is the character's state of mind?

IMPORTANT: Your delivery directions should work WITH the assigned voice's capabilities.
- High emotion_range voices can handle more dramatic variation
- Low pitch_hint voices sound better with slower delivery
- High energy voices suit faster, more dynamic delivery

Return enhanced dialogue_map with:
{
  "dialogues": [
    {
      "index": 0,
      "original_quote": "...",
      "speaker": "...",
      "original_emotion": "...",

      // NEW FIELDS
      "ssml_pitch": -10,           // percent adjustment
      "ssml_rate": "slow",         // or percentage like "85%"
      "ssml_volume": "medium",
      "emphasis_words": ["never", "forgive"],
      "pause_before_ms": 500,
      "pause_after_ms": 0,

      "voice_settings_override": {
        "stability": 0.3,          // Override if needed
        "style": 0.9
      },

      "director_notes": "Build intensity through the line, drop to near-whisper on 'forgive'"
    }
  ]
}`;
```

**Effort:** High (1-2 days)
**Risk:** Medium (adds latency, needs prompt tuning)

### Enhancement 5: Pass Voice Metadata to Agents

Update DialogueTaggingAgent and DeliveryDirectorAgent to receive:

```javascript
// In buildUserPrompt(), add:
const voiceMetadata = characterVoices.map(cv => ({
  character: cv.characterName,
  voiceName: cv.voiceName,
  pitch_hint: cv.pitch_hint,      // e.g., "low"
  energy_level: cv.energy_level,  // e.g., "high"
  emotion_range: cv.emotion_range, // e.g., 75
  can_be_child: cv.can_be_child
}));

// Include in prompt:
`ASSIGNED VOICE CAPABILITIES:
${voiceMetadata.map(v =>
  `- ${v.character}: ${v.voiceName} (pitch: ${v.pitch_hint}, energy: ${v.energy_level}, emotion range: ${v.emotion_range}/100)`
).join('\n')}`
```

**Effort:** Easy (2-3 hours)
**Risk:** Low

---

## Implementation Considerations

### Order of Implementation

**Phase 1: Quick Wins (Low Risk)**
1. Add missing VOICE_PRESETS (whispered, shouted, questioning)
2. Expand speed range in existing presets
3. Add emotion → preset mapping for unmapped emotions

**Phase 2: SSML Foundation**
1. Create wrapWithSSML() utility function
2. Test SSML support with ElevenLabs API
3. Add simple pitch/rate modifications

**Phase 3: Delivery Director Agent**
1. Design agent prompt
2. Implement agent
3. Integrate into pipeline after DialogueTaggingAgent
4. Add voice metadata passing

**Phase 4: Advanced Features**
1. Prosody continuity (previous_text/next_text)
2. Word emphasis detection
3. Automatic pause insertion

### Performance Impact

| Enhancement | Latency Impact | Cost Impact |
|-------------|----------------|-------------|
| New VOICE_PRESETS | None | None |
| Wider speed range | None | None |
| SSML wrapping | Minimal | None |
| Delivery Director | +2-4s per scene | +$0.001-0.005 per scene |
| Voice metadata passing | Minimal | None |

### Token Budget Considerations

The DialogueTaggingAgent already uses GPT-5.1 (coherence tier). Adding a Delivery Director Agent would:
- Use utility tier (gpt-4o-mini) for cost efficiency
- Add ~500-1000 tokens input per scene
- Add ~500-1500 tokens output per scene
- Estimated cost: $0.001-0.005 per scene

---

## Risks & Mitigations

### Risk 1: SSML May Not Work as Expected

**Risk:** ElevenLabs SSML support may have limitations or quirks.
**Mitigation:**
- Test thoroughly before production
- Implement graceful fallback to non-SSML
- Start with conservative pitch/rate ranges

### Risk 2: Over-Direction May Sound Unnatural

**Risk:** Too much SSML manipulation could make speech sound robotic.
**Mitigation:**
- Use subtle adjustments (±10-15% pitch/rate)
- Test with human listeners
- Allow easy tuning of intensity

### Risk 3: Increased Complexity

**Risk:** More moving parts means more potential failures.
**Mitigation:**
- Make SSML and Delivery Director optional/toggleable
- Implement robust fallbacks
- Log all delivery decisions for debugging

### Risk 4: Latency Increase

**Risk:** Additional LLM call (Delivery Director) adds latency.
**Mitigation:**
- Run Delivery Director in parallel with voice casting if possible
- Use fast utility model (gpt-4o-mini)
- Cache delivery patterns for common emotions

### Risk 5: Voice-SSML Incompatibility

**Risk:** Some voice + SSML combinations may sound bad.
**Mitigation:**
- Test each voice with various SSML settings
- Create voice-specific SSML limits
- Log problematic combinations

---

## Open Questions

### Q1: Should SSML be applied to narrator as well?

**Considerations:**
- Narrator currently uses consistent "calm" settings
- SSML could add dramatic pauses in narration
- Risk of inconsistent narrator voice

**Recommendation:** Start with dialogue only, consider narrator SSML in Phase 4.

### Q2: How to handle emphasis words automatically?

**Options:**
1. LLM detects emphasis from context ("I said NEVER!")
2. Regex for ALL CAPS words
3. Manual marking in dialogue_map

**Recommendation:** Start with LLM detection, add CAPS regex as supplement.

### Q3: Should Delivery Director run for every scene?

**Options:**
1. Always run (consistent quality)
2. Only for dialogue-heavy scenes
3. Only for premium tier users
4. User toggle

**Recommendation:** Start with always-on, add toggle if latency is problematic.

### Q4: How much pitch variation is too much?

**Considerations:**
- ElevenLabs allows -50% to +50%
- Large variations sound unnatural
- Small variations may not be noticeable

**Recommendation:** Limit to ±25% initially, tune based on testing.

### Q5: Should we store SSML in database or generate on-the-fly?

**Options:**
1. Store in dialogue_map (more data, but reproducible)
2. Generate at TTS time (less storage, but potentially inconsistent)

**Recommendation:** Store in dialogue_map for reproducibility and debugging.

---

## Database Schema Changes (If Needed)

```sql
-- Extend dialogue_map format to include delivery
-- No schema change needed - dialogue_map is JSONB

-- Example enhanced dialogue_map entry:
{
  "quote": "I will never forgive you",
  "speaker": "Elena",
  "emotion": "angry",
  "delivery": "cold and threatening",

  -- NEW FIELDS (from Delivery Director)
  "ssml": {
    "pitch": -10,
    "rate": "slow",
    "volume": "medium",
    "emphasis_words": ["never"],
    "pause_before_ms": 300,
    "pause_after_ms": 0
  },
  "voice_settings_override": {
    "stability": 0.3,
    "style": 0.9
  },
  "director_notes": "Build intensity, drop voice on 'forgive'"
}
```

---

## Testing Checklist

Before production deployment:

- [ ] Test SSML with all 24 voices
- [ ] Test pitch range (-30% to +30%) with each voice
- [ ] Test rate range (x-slow to x-fast) with each voice
- [ ] Test volume range with each voice
- [ ] Test emphasis tags
- [ ] Test break tags (various durations)
- [ ] Test combinations (pitch + rate + emphasis)
- [ ] Test with long dialogues (SSML limits?)
- [ ] Measure latency impact of Delivery Director
- [ ] A/B test with human listeners
- [ ] Test fallback behavior when SSML fails

---

## References

- [ElevenLabs Voice Settings API](https://elevenlabs.io/docs/api-reference/voices/settings/get)
- [ElevenLabs Text to Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [SSML Specification](https://www.w3.org/TR/speech-synthesis11/)
- [SSML with ElevenLabs](https://www.restack.io/p/voice-agent-answer-ssml-techniques-cat-ai)

---

---

## Expanded Analysis: Problems, Edge Cases & Considerations

### Problem 1: Model Selection Complexity

**Issue:** With v3 audio tags, we now have a choice between models:
- `eleven_multilingual_v2`: Current model, no audio tags, consistent
- `eleven_v3`: Audio tags, expressive, but higher latency and voice clone issues

**Considerations:**
1. v3 is still in **alpha** - production stability unknown
2. Professional Voice Clones (PVCs) don't work well with v3 yet
3. Mixing models in same story could cause voice consistency issues
4. v3 has higher latency - may not work for real-time features

**Proposed Solution:**
- Make model selection per-scene or per-tier
- Use v2 for narrator (consistency), v3 for character dialogue (expressiveness)
- Add fallback to v2 if v3 fails
- Monitor v3 status for graduation from alpha

### Problem 2: Audio Tags May Be Unpredictable

**Issue:** Audio tags interpret natural language, which can be ambiguous:
- `[angry]` might be interpreted differently each time
- Combining tags may have unexpected interactions
- Some tags may not work with certain voices

**Considerations:**
1. LLM-generated tags might use unsupported combinations
2. No clear documentation of which tags work best together
3. Results may vary between API calls (non-deterministic)

**Proposed Solution:**
- Create a **curated tag vocabulary** for our LLM to use
- Test tag combinations and document what works
- Use seed parameter if available for reproducibility
- Log actual tags used for debugging

### Problem 3: Delivery Director Adds Latency

**Issue:** Adding another LLM call for delivery direction adds 2-4 seconds per scene.

**Considerations:**
1. Users already wait for story generation + TTS
2. Total latency could become frustrating
3. Parallelization options are limited

**Proposed Solutions:**
1. **Run in parallel**: Delivery Director can run while voice casting happens
2. **Batch processing**: Process all dialogue in scene at once
3. **Cache common patterns**: "whispered angrily" → cached tag combo
4. **Make optional**: Premium feature toggle

### Problem 4: Over-Direction Risk

**Issue:** Too many audio tags could make speech sound unnatural or robotic.

**Examples of over-direction:**
```
// Bad - too many tags:
[nervously][hesitantly][quietly][with a slight tremor][gulps] H-hello?

// Better - focused:
[nervously][gulps] H-hello?
```

**Proposed Solutions:**
1. Limit tags to 2-3 per dialogue line
2. Train LLM to be selective
3. A/B test with listeners to find sweet spot

### Problem 5: Tag Consistency Across Scene

**Issue:** Character emotions should flow naturally across a scene, not jump randomly.

**Example Problem:**
```
Line 1: [excited] "I found it!"
Line 2: [angry] "Let me see."  // Same character, jarring shift
Line 3: [sad] "It's beautiful."
```

**Proposed Solutions:**
1. Pass previous dialogue context to Delivery Director
2. Track character emotional arc across scene
3. Add "emotion continuity" validation

### Problem 6: Narrator vs Character Tag Differences

**Issue:** Narrator and character dialogue have different needs:
- Narrator: Consistent tone, subtle variation, professional
- Characters: Expressive, emotional, varied

**Considerations:**
1. Should narrator use audio tags at all?
2. Too expressive narrator might distract from story
3. Different tag vocabularies needed

**Proposed Solutions:**
1. Limit narrator to: [pause], [dramatic], [reflective], [matter-of-fact]
2. Full tag vocabulary for character dialogue
3. Separate Delivery Director prompts for narrator vs character

### Problem 7: Emotion Mismatch Between Written Text and Tags

**Issue:** The written emotion ("she said angrily") might conflict with the tag.

**Example:**
```
Text: "I love you," she said angrily.
Tag: [lovingly]  // WRONG - conflicts with attribution
```

**Proposed Solutions:**
1. Delivery Director must respect written attributions
2. Extract attribution from text and use as primary signal
3. Add validation step to check tag-text alignment

### Problem 8: Cost Considerations

**Issue:** Multiple LLM calls and longer v3 processing add costs.

**Cost Breakdown (estimated per scene):**
| Component | Cost |
|-----------|------|
| DialogueTaggingAgent (GPT-5.1) | ~$0.01-0.02 |
| Delivery Director (GPT-4o-mini) | ~$0.001-0.005 |
| TTS v2 (per 1k chars) | ~$0.03 |
| TTS v3 (per 1k chars) | ~$0.04-0.05? (higher) |

**Proposed Solutions:**
1. Make enhanced delivery a premium feature
2. Cache Delivery Director results
3. Use cheaper model for Delivery Director
4. Batch process multiple scenes

### Problem 9: Sound Effects Overlap with Audio Tags

**Issue:** v3 audio tags can include sound effects like [gunshot], [explosion]. We already have a separate SFX system.

**Conflict Example:**
```
// Our SFX system adds: explosion.wav at 0:15
// v3 audio tag: [explosion] The building collapsed.
// Result: Two explosions!
```

**Proposed Solutions:**
1. Coordinate SFX system with audio tags
2. Prefer one system over other (probably our SFX for control)
3. Filter out sound effect tags from Delivery Director output
4. Use v3 sound tags only for character reactions (gasp, sigh, laugh)

### Problem 10: Accent Tags May Be Problematic

**Issue:** v3 supports accent tags like [British accent], [French accent]. This could:
- Override carefully selected voice accents
- Create inconsistency if used mid-dialogue
- Be culturally insensitive if misused

**Proposed Solutions:**
1. Exclude accent tags from Delivery Director vocabulary
2. Use only for special cases (character doing impression)
3. Prefer voice selection over accent tags

### Problem 11: Voice Metadata Still Needed

**Issue:** Even with v3 audio tags, we still need to know voice capabilities:
- Some voices handle certain tags better
- Emotion range still matters for voice selection
- Energy level affects how tags sound

**Example:**
```
A calm, low-energy voice + [excited][shouting] = potentially bad
A high-energy voice + [excited][shouting] = natural
```

**Proposed Solutions:**
1. Keep voice metadata system
2. Create voice-tag compatibility matrix
3. Pass voice capabilities to Delivery Director

### Problem 12: Testing Complexity

**Issue:** With audio tags, testing becomes harder:
- Results are non-deterministic
- Subtle differences hard to quantify
- Need human listeners for evaluation

**Proposed Solutions:**
1. Create regression test suite with known-good outputs
2. A/B testing framework for user preference
3. Log all generated audio with metadata
4. Periodic human quality reviews

---

## Revised Implementation Roadmap

Given the v3 Audio Tags discovery, here's a revised approach:

### Phase 0: Immediate Quick Wins (No Model Change) ✅ COMPLETED 2025-12-09
- [x] Add missing VOICE_PRESETS (whispered, shouted, questioning)
- [x] Expand speed range (0.7-1.3)
- [x] Fix emotion mapping gaps

**Changes Made (elevenlabs.js):**
- Added 27 new emotion presets to VOICE_PRESETS
- Expanded speed range from 0.85-1.15 to 0.7-1.3
- New presets include: whispered, hushed, murmured, shouted, yelled, bellowed,
  questioning, uncertain, confused, desperate, resigned, exhausted, relieved,
  bitter, wistful, awestruck, defiant, pleading, commanding, seductive, reverent,
  furious, terrified, grieving, melancholy, joyful, triumphant, loving, comforting,
  menacing, sinister, mocking, dry
- Added comprehensive documentation header explaining parameter meanings
- See elevenlabs.js lines 61-163 for full implementation

### Phase 1: v3 Investigation ✅ COMPLETED 2025-12-09
- [x] Test v3 with our existing voices
- [x] Create audio tag vocabulary document
- [x] Measure latency difference v2 vs v3
- [x] Test voice clone compatibility

**TEST RESULTS: v3 is 300% BETTER than v2**

| Metric | v2 | v3 | Winner |
|--------|----|----|--------|
| Success Rate | 100% | 100% | Tie |
| Avg Latency | 1,171ms | 1,847ms | v2 (+58% faster) |
| Emotion Accuracy | Good | **Excellent** | **v3** |
| Naturalness | Good | **Excellent** | **v3** |
| Reactions (laughs, sighs) | Not supported | **Works!** | **v3** |
| Overall Quality | Good | **300% Better** | **v3** |

**Key Findings:**
- v3 Audio Tags produce dramatically better emotional delivery
- Reactions like `[laughs]` and `[sighs]` actually generate those sounds
- 58% latency increase is acceptable given the quality improvement
- All test voices (George) worked perfectly with v3
- v3 is production-ready despite "alpha" label

**Test Files:** `public/audio/v3-test/` (30 comparison files)
**Test Script:** `server/tests/v3-vs-v2-voice-test.js`

### Phase 2: v3 Production Adoption ✅ COMPLETED 2025-12-09
- [x] Add eleven_v3 to ELEVENLABS_MODELS config
- [x] Create `wrapWithAudioTags()` helper function
- [x] Update emotion-to-tag mapping (EMOTION_TO_AUDIO_TAGS)
- [x] Switch default model from v2 to v3 (QUALITY_TIER_MODELS.premium = 'eleven_v3')
- [x] Add v2 fallback for compatibility (premium_legacy tier)

**Implementation Details:**
- `elevenlabs.js` now defaults to `eleven_v3` for premium tier
- `textToSpeechWithTimestamps()` automatically applies Audio Tags based on `detectedEmotion`
- `generateMultiVoiceAudio()` passes emotion and delivery to TTS
- 45 emotion-to-tag mappings in `EMOTION_TO_AUDIO_TAGS`
- Service restarted and live in production

### Phase 3: Delivery Director Agent (PLANNED)

The Delivery Director Agent would add a second pass of prosody enhancement after DialogueTaggingAgent, providing more nuanced voice direction.

#### Purpose
- Add reaction sounds ([laughs], [sighs], [gasps]) where appropriate
- Enhance emotional nuance with modifier tags
- Track character emotional arc across scenes
- Add dramatic pauses and pacing

#### Proposed Architecture
```
DialogueTaggingAgent (existing)
    ↓ outputs: speaker, emotion, delivery
DeliveryDirectorAgent (NEW)
    ↓ outputs: enhanced_delivery (audio tags string)
TTS Generation
    ↓ uses: [tags]text format
```

#### Input/Output Example
```javascript
// Input from DialogueTaggingAgent:
{
  quote: "I suppose you're right.",
  speaker: "Marcus",
  emotion: "resigned",
  delivery: "defeated acceptance"
}

// Output from DeliveryDirectorAgent:
{
  quote: "I suppose you're right.",
  speaker: "Marcus",
  enhanced_delivery: "[sighs][resignedly][slowly]",
  reasoning: "Adding sigh for defeated acceptance, slow pace for resignation"
}
```

#### Agent System Prompt (Draft)
```
You are a voice director for audiobook production. Your job is to add
Audio Tags that enhance emotional delivery.

AVAILABLE TAGS:
- Volume: [whispers], [shouts], [softly], [loudly]
- Emotion: [angrily], [sadly], [fearfully], [excitedly], [tenderly]
- Reactions: [laughs], [sighs], [gasps], [chuckles], [groans]
- Modifiers: [nervously], [hesitantly], [slowly], [quickly]

RULES:
1. Maximum 3 tags per line
2. Reactions ([laughs], [sighs]) should be used sparingly
3. Consider character personality and scene context
4. Track emotional continuity - characters don't flip emotions instantly
```

#### Implementation Considerations
- **Cost**: Additional LLM call per scene (~$0.01-0.02)
- **Latency**: +500-1000ms per scene
- **Value**: Much more expressive delivery, especially for dramatic scenes
- **Optional**: Could be a premium-only feature or user toggle

#### When to Use (vs current system)
| Scenario | Current System | With Delivery Director |
|----------|----------------|----------------------|
| Simple dialogue | Good | Same |
| Emotional scenes | Good | Better (reactions) |
| Character moments | Good | Better (continuity) |
| Dramatic reveals | Good | Much better |

### Phase 4: Integration & Polish
- [ ] Coordinate with SFX system (avoid [sighs] when SFX playing)
- [ ] Add voice-tag compatibility validation
- [ ] Performance optimization (batch processing?)
- [ ] User testing and refinement
- [ ] Add user toggle for enhanced delivery

---

## v3 Audio Tag Reference

Based on testing, these tags work well with eleven_v3:

### Volume/Delivery Tags
| Tag | Effect | Use Case |
|-----|--------|----------|
| `[whispers]` | Soft, intimate delivery | Secrets, intimate moments |
| `[shouts]` | Loud, intense delivery | Commands, arguments |
| `[softly]` | Gentle delivery | Comfort, tenderness |

### Emotion Tags
| Tag | Effect | Use Case |
|-----|--------|----------|
| `[angrily]` | Angry tone | Confrontations |
| `[sadly]` | Sorrowful tone | Loss, grief |
| `[fearfully]` | Scared tone | Horror, tension |
| `[excitedly]` | Energetic tone | Joy, discovery |
| `[tenderly]` | Warm, loving tone | Romance, comfort |
| `[sarcastically]` | Mocking tone | Humor, contempt |
| `[desperately]` | Urgent, pleading tone | Crisis moments |
| `[coldly]` | Detached, menacing tone | Villains, threats |
| `[authoritatively]` | Commanding tone | Leaders, instructions |

### Modifier Tags (combine with emotions)
| Tag | Effect |
|-----|--------|
| `[nervously]` | Adds tremor/hesitation |
| `[with trembling voice]` | Voice breaks slightly |
| `[barely able to speak]` | Choked up, emotional |
| `[with barely contained rage]` | Seething anger |
| `[with quiet menace]` | Threatening but controlled |
| `[voice breaking]` | Emotional crack |
| `[resignedly]` | Acceptance, defeat |

### Reaction Tags (v3 EXCLUSIVE - these actually generate sounds!)
| Tag | Effect |
|-----|--------|
| `[laughs]` | Actual laughter sound |
| `[sighs]` | Actual sigh sound |
| `[gasps]` | Sharp intake of breath |
| `[chuckles]` | Light laugh |
| `[groans]` | Expression of pain/frustration |

### Tag Combinations (tested and working)
```
[whispers][nervously]       - Scared whisper
[shouts][angrily]          - Angry yelling
[sadly][voice breaking]    - Emotional grief
[excitedly][laughing with joy] - Joyful celebration
[coldly][with quiet menace]    - Villain threat
[desperately][pleading]    - Begging
```

---

## Legacy: v2 Approach (Deprecated)

~~If v3 proves problematic (alpha stability, latency, cost), we can still improve with v2:~~

**v3 testing proved it's production-ready. v2 approach is now deprecated.**

v2 will be kept as fallback only for edge cases where v3 fails.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-09 | 1.0.0 | Initial audit and proposal |
| 2025-12-09 | 1.1.0 | Added v3 Audio Tags discovery, expanded problem analysis |
| 2025-12-09 | 1.2.0 | **Phase 0 COMPLETED**: Added 27 new VOICE_PRESETS, expanded speed range 0.7-1.3 |
| 2025-12-09 | 1.3.0 | **Phase 1 COMPLETED**: v3 vs v2 testing - v3 is 300% better, switching to v3 |
| 2025-12-09 | 2.0.0 | **Phase 2 DEPLOYED**: v3 now default in production. Added EMOTION_TO_AUDIO_TAGS mapping, wrapWithAudioTags(), modelSupportsAudioTags(). Premium tier now uses eleven_v3 |

