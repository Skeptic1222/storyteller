# ElevenLabs V3 TTS API - Complete Guide for Storyteller

**Last Updated:** 2026-01-15
**Model Version:** Eleven v3 (Alpha) - Current flagship emotional TTS model

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Model Versions & Selection](#model-versions--selection)
3. [Core Parameters Deep Dive](#core-parameters-deep-dive)
4. [Audio Tags System (V3)](#audio-tags-system-v3)
5. [Multi-Voice Consistency](#multi-voice-consistency)
6. [Voice Library & Character Diversity](#voice-library--character-diversity)
7. [Genre-Specific Recommendations](#genre-specific-recommendations)
8. [Code Examples](#code-examples)
9. [Performance & Cost Implications](#performance--cost-implications)
10. [Best Practices for Story Narration](#best-practices-for-story-narration)
11. [Limitations & Edge Cases](#limitations--edge-cases)
12. [Implementation Recommendations](#implementation-recommendations)

---

## Executive Summary

### Quick Comparison: V3 vs V2

| Feature | Eleven v3 | Multilingual v2 | Turbo v2.5 |
|---------|-----------|-----------------|------------|
| **Best For** | Emotional narratives, audiobooks | Stable long-form content | Real-time, conversational |
| **Emotional Range** | Highest (breathtaking) | Moderate | Moderate |
| **Stability** | Requires more tuning | Most stable | Very stable |
| **Languages** | 70+ | 29 | 32 |
| **Character Limit** | 5,000 (~5 min) | 10,000 (~10 min) | 40,000 (~40 min) |
| **Latency** | High (~1-2s) | Medium (~500ms) | Low (~250-300ms) |
| **Cost/Character** | Standard | Standard | 0.5x (50% cheaper) |
| **Audio Tags** | ✅ Yes | ❌ No | ❌ No |
| **Speaker Boost** | ❌ Not available | ✅ Yes | ✅ Yes |
| **Real-time Use** | ❌ Not suitable | ✅ Possible | ✅ Ideal |

**Key Insight:** V3 trades consistency for emotional expressiveness. It's perfect for pre-generated story content but not for real-time conversation.

---

## Model Versions & Selection

### Current Model Lineup (January 2026)

#### 1. **Eleven v3 (Alpha)** - `eleven_v3`
- **Status:** Newest flagship model (alpha)
- **Specialty:** Most emotionally rich and expressive speech synthesis
- **Languages:** 70+ supported
- **Character Limit:** 5,000 per request
- **Audio Duration:** ~5 minutes per request
- **Unique Features:**
  - Audio Tags system for emotional control
  - Contextual understanding of emotional flow
  - Natural reactions (sighs, whispers, laughs)
  - Multi-character dialogue support
- **Drawbacks:**
  - Requires more prompt engineering
  - Higher latency (not real-time capable)
  - Professional Voice Clones (PVCs) not fully optimized yet
  - Less consistent than v2 (nondeterministic)

#### 2. **Eleven Multilingual v2** - `eleven_multilingual_v2`
- **Status:** Legacy premium model (still excellent)
- **Specialty:** Lifelike, consistent quality speech synthesis
- **Languages:** 29 supported
- **Character Limit:** 10,000 per request
- **Audio Duration:** ~10 minutes per request
- **Strengths:**
  - Most stable for long-form generation
  - Excellent for professional content
  - Speaker boost available
  - Style parameter support
- **Best For:** When consistency > emotional range

#### 3. **Eleven Turbo v2.5** - `eleven_turbo_v2_5`
- **Status:** Current production workhorse
- **Specialty:** High quality with low latency
- **Languages:** 32 supported
- **Character Limit:** 40,000 per request
- **Latency:** ~250-300ms
- **Cost:** 0.5 credits/character (50% cheaper)
- **Best For:** Standard quality stories, conversational AI

#### 4. **Eleven Flash v2.5** - `eleven_flash_v2_5`
- **Status:** Fastest model
- **Specialty:** Lowest latency
- **Languages:** 32 supported
- **Character Limit:** 40,000 per request
- **Latency:** ~75ms
- **Cost:** 0.5 credits/character (50% cheaper)
- **Best For:** Real-time applications, bulk processing

### Model Selection Matrix

```
Use Case                              → Recommended Model
────────────────────────────────────────────────────────────
Emotional audiobook narration         → eleven_v3
Multi-character story with emotions   → eleven_v3
Professional audiobook (stability)    → eleven_multilingual_v2
Standard story narration              → eleven_turbo_v2_5
Real-time interactive story           → eleven_turbo_v2_5
Bulk generation (cost-conscious)      → eleven_flash_v2_5
Highest quality, cost no object       → eleven_v3
```

---

## Core Parameters Deep Dive

### 1. Seed Parameter

**Purpose:** Attempts to make generation deterministic for reproducibility.

**Range:** 0 to 4,294,967,295 (32-bit unsigned integer)

**How It Works:**
- ElevenLabs makes a "best effort" to sample deterministically
- Same seed + same parameters *should* return similar results
- Models are inherently nondeterministic, so perfect reproducibility is NOT guaranteed

**Reliability:**
- ⚠️ **Subtle differences still occur** even with identical seeds
- More reliable for shorter text snippets
- Less reliable across different API versions or model updates
- Environmental factors (server load, etc.) can affect output

**When to Use Seed:**
```javascript
// Use case 1: Regenerating a specific segment without changing voice
const options = {
  seed: 12345678,
  stability: 0.5,
  similarity_boost: 0.75
};

// Use case 2: A/B testing different settings with same "random" baseline
const testA = { seed: 42, stability: 0.3, ... };
const testB = { seed: 42, stability: 0.7, ... };

// Use case 3: Voice consistency across sessions (limited effectiveness)
const characterSeed = parseInt(characterId.slice(0, 8), 16);
```

**Best Practice:**
- Don't rely on seed for absolute consistency
- Use it as a "soft anchor" for reducing variability
- For true consistency, cache and reuse generated audio files
- For Storyteller: Consider using `storyId + chapterId + segmentId` hash as seed

**Code Example:**
```javascript
// Generate a deterministic seed from story metadata
function generateSeed(storyId, chapterId, segmentIdx) {
  const seedString = `${storyId}-${chapterId}-${segmentIdx}`;
  const hash = crypto.createHash('sha256').update(seedString).digest('hex');
  return parseInt(hash.slice(0, 8), 16); // First 32 bits as seed
}

const audioBuffer = await elevenlabs.textToSpeech(text, voiceId, {
  seed: generateSeed(story.id, chapter.id, 0),
  quality_tier: 'premium',
  stability: 0.5
});
```

**Storyteller Implementation Recommendation:**
```javascript
// In server/services/elevenlabs.js
async textToSpeech(text, voiceId, options = {}) {
  // Auto-generate seed from sessionId + segment info for soft consistency
  const seed = options.seed || (options.sessionId
    ? this.generateSessionSeed(options.sessionId, text.slice(0, 50))
    : undefined);

  const requestBody = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
    seed // Include if provided or auto-generated
  };
  // ... rest of implementation
}

generateSessionSeed(sessionId, textSnippet) {
  const combined = `${sessionId}-${textSnippet}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}
```

---

### 2. Stability Parameter

**Range:** 0.0 - 1.0 (float)

**Default:** 0.5

**What It Controls:**
- Voice consistency and variability between generations
- Emotional range and expressiveness

**Behavior:**

| Value | Effect | Emotional Range | Consistency | Use Case |
|-------|--------|-----------------|-------------|----------|
| 0.0-0.3 | **Very expressive** | Maximum | Low | Dramatic scenes, intense emotions |
| 0.3-0.5 | **Expressive** | High | Medium | Character dialogue, action |
| 0.5-0.7 | **Balanced** | Moderate | Good | General narration, storytelling |
| 0.7-0.9 | **Stable** | Limited | High | Consistent narrator, documentary |
| 0.9-1.0 | **Very stable** | Minimal | Maximum | Monotone, robotic, data reading |

**ElevenLabs Official Guidance:**
> "A lower stability setting means a wider range of variability between generations, but it also introduces inter-generational variability, where the AI can be a bit more performative."

**V3-Specific Notes:**
- V3 has three stability modes: **Creative** (0.0-0.3), **Natural** (0.4-0.7), **Robust** (0.8-1.0)
- **Creative mode** enables emotional expressiveness but risks hallucinations (unexpected sounds)
- **Natural mode** provides balanced performance closest to original voice recordings
- **Robust mode** ensures consistency but reduces responsiveness to audio tags

**Recommended Settings by Content Type:**
```javascript
const STABILITY_RECOMMENDATIONS = {
  // Story types
  horror: 0.6,           // Controlled dread, not chaotic
  romance: 0.7,          // Smooth, intimate delivery
  action: 0.35,          // Dynamic, energetic
  mystery: 0.65,         // Steady, deliberate
  comedy: 0.5,           // Balanced for timing
  drama: 0.4,            // Emotional but coherent

  // Speaker types
  narrator: 0.65,        // Consistent throughline
  protagonist: 0.5,      // Balanced expressiveness
  antagonist: 0.45,      // Slightly more volatile
  child_character: 0.4,  // More animated

  // Emotional states (character dialogue)
  angry: 0.3,
  sad: 0.7,
  excited: 0.35,
  fearful: 0.55,
  calm: 0.75,
  neutral: 0.6
};
```

**Current Storyteller Implementation:**
Your `VOICE_PRESETS` in `server/services/elevenlabs.js` already implements excellent stability ranges:
- Calm/tender emotions: 0.7-0.8 (high stability)
- Intense emotions (angry, terrified): 0.2-0.4 (low stability)
- Neutral/balanced: 0.5-0.6

**✅ No changes needed** - your current implementation aligns with best practices.

---

### 3. Similarity Boost Parameter

**Range:** 0.0 - 1.0 (float)

**Default:** 0.75

**What It Controls:**
- How closely the AI adheres to the original voice characteristics
- Voice fidelity vs. creative interpretation

**Behavior:**

| Value | Effect | Voice Fidelity | Flexibility | Use Case |
|-------|--------|----------------|-------------|----------|
| 0.0-0.5 | **Creative interpretation** | Low | High | Character variety, stylized delivery |
| 0.5-0.7 | **Balanced** | Medium | Medium | General use, subtle variation |
| 0.7-0.85 | **High fidelity** | High | Limited | Match original voice closely |
| 0.85-1.0 | **Maximum fidelity** | Maximum | Minimal | Voice cloning, brand voices |

**Official Documentation:**
> "The similarity slider dictates how closely the AI should adhere to the original voice when attempting to replicate it."

**Relationship with Stability:**
- **High similarity + High stability** = Very consistent, predictable voice
- **High similarity + Low stability** = Expressive but still sounds like the original voice
- **Low similarity + Low stability** = Maximum creative freedom (can sound very different)

**Recommended Settings:**
```javascript
const SIMILARITY_RECOMMENDATIONS = {
  // Use cases
  voice_cloning: 0.9,           // Match the original as closely as possible
  brand_voice: 0.85,            // Consistent brand identity
  character_consistency: 0.8,   // Same character across chapters
  narrator: 0.75,               // Standard storytelling
  character_variety: 0.7,       // Allow some creative interpretation
  stylized_performance: 0.6,    // More theatrical

  // Character types
  main_character: 0.8,          // Maintain clear identity
  supporting_character: 0.75,   // Balanced
  background_character: 0.7,    // Can vary more
};
```

**Common Setting:**
> "The most common setting is stability around 50, similarity around 75"

**Current Storyteller Implementation:**
Your presets use 0.7-0.9 similarity_boost:
- Intense emotions (angry, threatening): 0.9 (stay true to character even when intense)
- Sarcasm/humor: 0.75 (allow flexibility)
- Neutral: 0.75 (standard)

**✅ Excellent** - this aligns perfectly with best practices.

---

### 4. Speaker Boost Parameter

**Parameter Name:** `use_speaker_boost` (boolean)

**Default:** `true`

**What It Does:**
> "This setting boosts the similarity to the original speaker."

**Trade-offs:**
- ✅ **Benefit:** Increases voice fidelity and consistency
- ❌ **Cost:** Higher computational load = increased latency (~10-20% slower)

**Model Compatibility:**
| Model | Speaker Boost Support |
|-------|----------------------|
| eleven_v3 | ❌ **NOT AVAILABLE** |
| eleven_multilingual_v2 | ✅ Available |
| eleven_turbo_v2_5 | ✅ Available |
| eleven_flash_v2_5 | ✅ Available |

**⚠️ Critical Note for V3:**
Speaker boost is **not available** for the Eleven v3 model. If you're using V3, this parameter will be ignored.

**When to Use:**
```javascript
// Use speaker_boost: true
- Voice cloning projects
- Brand consistency (company voices)
- Character voices that must sound identical across episodes
- Professional narration where consistency is critical

// Use speaker_boost: false
- When using eleven_v3 (it's not available anyway)
- Real-time applications where latency matters
- Economy tier (reduce processing costs)
- When creative variation is acceptable
```

**Current Storyteller Implementation:**
```javascript
// From server/services/elevenlabs.js
export const TIER_DEFAULT_SETTINGS = {
  premium: { use_speaker_boost: true },   // ⚠️ Won't work with v3
  standard: { use_speaker_boost: true },
  economy: { use_speaker_boost: false },  // ✅ Saves processing
  fast: { use_speaker_boost: false }      // ✅ Reduces latency
};
```

**⚠️ Recommendation:**
Since Storyteller now defaults to `eleven_v3` for premium tier, update the logic:

```javascript
// Recommended fix
const useSpeakerBoost = modelId === 'eleven_v3'
  ? false  // Not supported by V3
  : (options.use_speaker_boost ?? tierDefaults.use_speaker_boost);
```

---

### 5. Style Parameter

**Range:** 0.0 - 1.0 (float)

**Default:** ~0.0-0.3 (varies by tier)

**Model Compatibility:**
| Model | Style Support |
|-------|---------------|
| eleven_v3 | ✅ Yes |
| eleven_multilingual_v2 | ✅ Yes |
| eleven_turbo_v2_5 | ✅ Yes |
| eleven_flash_v2_5 | ❌ No |
| eleven_turbo_v2 | ❌ No |

**What It Controls:**
- Exaggeration and dramatic emphasis
- Theatrical vs. natural delivery
- Performance intensity

**Behavior:**

| Value | Effect | Delivery Style | Use Case |
|-------|--------|----------------|----------|
| 0.0-0.2 | **Natural** | Conversational, understated | Intimate narration, whispers |
| 0.2-0.4 | **Slightly enhanced** | Clear storytelling | Standard audiobook |
| 0.4-0.6 | **Moderate drama** | Engaging performance | Character dialogue |
| 0.6-0.8 | **Dramatic** | Theatrical, emphasized | Action scenes, villains |
| 0.8-1.0 | **Maximum drama** | Over-the-top, intense | Extreme emotions, comedy |

**Best Practices:**
- **Narrator:** Keep style low (0.2-0.4) for smooth, pleasant listening
- **Characters:** Increase style (0.5-0.8) for distinct personalities
- **Intense emotions:** Higher style values amplify the emotion

**Current Storyteller Implementation:**
```javascript
// Your current presets (excellent!)
calm_bedtime: { style: 0.2 },      // ✅ Gentle
dramatic: { style: 0.7 },          // ✅ Theatrical
action: { style: 0.8 },            // ✅ Intense
angry: { style: 0.9 },             // ✅ Maximum intensity
whispered: { style: 0.15 },        // ✅ Subtle
```

**✅ Your implementation is excellent** - well-calibrated style ranges.

---

### 6. Speed Parameter

**Range:** 0.5 - 1.5 (float)

**Default:** 1.0 (normal speed)

**API Documentation Range:** 0.7 - 1.3 is recommended for natural speech

**What It Controls:**
- Speech rate (talking speed)
- Pacing and urgency

**Model Compatibility:**
- **Supported:** Turbo v2.5, Flash v2.5 (both v2.5 models)
- **Not Supported:** V3, Multilingual v2, Turbo v2

**Behavior:**

| Value | Speed | Perception | Use Case |
|-------|-------|------------|----------|
| 0.7 | Very slow | Deliberate, somber | Grief, exhaustion, dread |
| 0.8 | Slow | Thoughtful, careful | Sad, mysterious, horror |
| 0.9 | Slightly slow | Calm, intimate | Tender moments, whispers |
| 1.0 | Normal | Standard pace | Default narration |
| 1.1 | Slightly fast | Energetic | Excitement, curiosity |
| 1.2 | Fast | Urgent, intense | Action, panic, anger |
| 1.3 | Very fast | Rushed, frantic | Extreme urgency, terror |

**⚠️ Important Notes:**
1. Speed parameter only works with models that support it (Turbo/Flash v2.5)
2. For V3, speed is controlled through **audio tags** like `[rushed]` or context
3. Extreme values (0.5, 1.5) can sound unnatural - use sparingly

**Current Storyteller Implementation:**
```javascript
// Your speed ranges (2025-12-09 expansion)
exhausted: { speed: 0.75 },      // ✅ Very slow
grieving: { speed: 0.75 },       // ✅ Very slow
terror: { speed: 1.25 },         // ✅ Fast
excited: { speed: 1.2 },         // ✅ Fast
action: { speed: 1.2 },          // ✅ Fast
```

**Storyteller uses 0.7-1.3 range** - perfect alignment with best practices! ✅

---

## Audio Tags System (V3)

### Overview

**Audio Tags** are the revolutionary feature of Eleven v3. They're words wrapped in square brackets that the model interprets to direct emotional delivery, sound effects, and character performance.

**Syntax:** `[tag_name]`

**Example:**
```javascript
const text = "[whispers] I think someone's following us. [nervous] We should leave. Now! [urgently]";
```

### Complete Tag Categories

#### 1. **Emotional States**
Control the emotional tone of delivery.

```javascript
// Core emotions
[excited]      // High energy, enthusiasm
[nervous]      // Anxious, uneasy
[frustrated]   // Irritated, impatient
[sorrowful]    // Deep sadness, grief
[calm]         // Peaceful, relaxed
[sad]          // Unhappy, down
[angry]        // Upset, furious
[happy]        // Joyful, pleased
[fearful]      // Scared, afraid
[curious]      // Inquisitive, interested
[mischievous]  // Playful, sly

// Nuanced emotions
[bitter]       // Resentful
[relieved]     // Weight lifted
[desperate]    // Urgent pleading
[resigned]     // Accepting defeat
[wistful]      // Nostalgic longing
[awestruck]    // Wonder, amazement
[defiant]      // Standing ground
```

#### 2. **Reactions & Human Sounds**
Natural human vocalizations and reactions.

```javascript
[sigh]          // Exhale, frustration or relief
[laughs]        // Laughter
[giggles]       // Light laughter
[gulps]         // Nervous swallow
[gasps]         // Sharp intake of breath
[clears throat] // Ahem sound
[crying]        // Sobbing sounds
[sniffles]      // Post-crying
[groans]        // Pain or frustration
[yawns]         // Tiredness
```

#### 3. **Volume & Intensity**
Control delivery volume and force.

```javascript
[whispers]      // Very quiet, intimate
[hushed]        // Quiet but urgent
[murmured]      // Low, soft
[shouts]        // Loud, raised voice
[yelled]        // Very loud, intense
[bellowed]      // Deep, loud, commanding
[screams]       // Highest intensity
```

#### 4. **Delivery Control**
Modify pacing and speech patterns.

```javascript
[pause]         // Brief silence
[pauses]        // Multiple short breaks
[rushed]        // Fast, hurried speech
[stammers]      // St-stuttering effect
[hesitates]     // Uncertain pauses
[drawn out]     // Stretched words
[slowly]        // Deliberate pacing
```

#### 5. **Tone Modifiers**
Adjust the manner of speaking.

```javascript
[cheerfully]    // Happy, bright
[flatly]        // Emotionless, monotone
[deadpan]       // Dry, no emotion
[playfully]     // Fun, lighthearted
[sarcastically] // Ironic, mocking
[seriously]     // Grave, important
[matter-of-fact] // Straightforward
[dramatically]  // Theatrical
```

#### 6. **Accent Emulation**
Request specific accent styles.

```javascript
[French accent]
[British accent]
[Australian accent]
[Southern US accent]
[American accent]
[Irish accent]
[Scottish accent]
[German accent]
[Italian accent]
[Spanish accent]
[Russian accent]

// Intensity modifiers
[strong X accent]
[slight X accent]
```

#### 7. **Character Archetypes**
Instant character voice transformations.

```javascript
[pirate voice]
[evil scientist voice]
[childlike tone]
[old wizard voice]
[robot voice]
[fantasy narrator]
[sci-fi AI voice]
[classic film noir]
[cartoon character]
[villain voice]
```

#### 8. **Sound Effects** (V3 Experimental)
Environmental and action sounds.

```javascript
[gunshot]
[explosion]
[applause]
[clapping]
[footsteps]
[gentle footsteps]
[leaves rustling]
[door creaking]
[glass breaking]
[thunder]
[rain]
[wind]
```

#### 9. **Contextual Scenarios**
Scene-specific delivery styles.

```javascript
[football commentary]
[wrestling match]
[auctioneer]
[news broadcast]
[radio DJ]
[meditation guide]
[sports announcer]
```

#### 10. **Multi-Character Dialogue**
Manage overlapping speech and interruptions.

```javascript
[interrupting]
[overlapping]
[talking over]
[simultaneous]
```

### Audio Tags Best Practices

#### 1. **Tag Placement**
```javascript
// ✅ GOOD: Place tags before the text they modify
"[whispers] Don't make a sound."

// ✅ GOOD: Multiple tags for layered effect
"[nervous] [whispers] I think they heard us."

// ❌ BAD: Tags after the text (less effective)
"Don't make a sound. [whispers]"

// ✅ GOOD: Mid-sentence transitions
"Everything is fine. [nervous] I mean, it's probably fine."
```

#### 2. **Tag Combinations**
```javascript
// Emotion + Delivery
"[angry] [shouts] How dare you!"

// Volume + Emotion
"[whispers] [fearful] They're getting closer."

// Reaction + Emotion
"[sigh] [resigned] I suppose you're right."

// Multiple reactions
"[gasps] [shocked] You can't be serious!"
```

#### 3. **Voice-Dependent Effectiveness**
- **Expressive voices** (high emotional range) respond better to emotional tags
- **Neutral voices** provide stable baseline for diverse tag application
- **Character voices** may have built-in emotional tendencies that interact with tags

#### 4. **Context Matters**
```javascript
// ✅ GOOD: Provide context for better interpretation
"After weeks of searching, [relieved] [sighs] we finally found it."

// vs.

// ❌ LESS EFFECTIVE: Tag without context
"[relieved] We found it."
```

#### 5. **Don't Overuse**
```javascript
// ❌ BAD: Too many tags, overwhelming
"[excited] [happy] [energetic] [loudly] We won!"

// ✅ GOOD: 1-2 tags maximum
"[excited] We won!"
```

### Current Storyteller Implementation

Your `EMOTION_TO_AUDIO_TAGS` mapping in `server/services/elevenlabs.js` is excellent:

```javascript
export const EMOTION_TO_AUDIO_TAGS = {
  whispered: '[whispers]',
  shouted: '[shouts]',
  yelled: '[yells]',
  nervous: '[nervous]',
  fearful: '[fearful]',
  // ... etc
};
```

**✅ Already implemented perfectly!**

### Advanced: Combining Audio Tags with Voice Settings

For V3, you can layer both approaches:

```javascript
// V3 with audio tags AND voice settings
const text = "[nervous] [whispers] I think someone's following us.";
const options = {
  model_id: 'eleven_v3',
  stability: 0.5,      // Still affects base behavior
  similarity_boost: 0.75,
  // Audio tags in text provide emotional direction
  // Voice settings provide baseline control
};
```

**Effect:** Audio tags provide **specific emotional cues**, while voice settings control **overall delivery characteristics**.

---

## Multi-Voice Consistency

### Challenge: Maintaining Voice Identity Across Sessions

**Problem:** Each TTS generation is semi-random, so the same character might sound slightly different between chapters or sessions.

**Solutions (Ranked by Effectiveness):**

### 1. **Use Seed Parameter** (Partial Solution)
```javascript
// Generate consistent seed per character
function getCharacterSeed(characterId) {
  const hash = crypto.createHash('sha256')
    .update(characterId)
    .digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}

// Use for all dialogue from this character
const audioBuffer = await elevenlabs.textToSpeech(
  dialogue,
  characterVoiceId,
  { seed: getCharacterSeed(character.id) }
);
```

**Effectiveness:** ⭐⭐⭐ (3/5) - Helps but not guaranteed

### 2. **Lock Voice Settings Per Character** (Recommended)
```javascript
// Store character voice configuration in database
const characterVoiceConfig = {
  character_id: 'hero_01',
  voice_id: 'pNInz6obpgDQGcFmaJgB',  // Adam (ElevenLabs voice)
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.4,
  speed: 1.0,
  seed: 12345678  // Character-specific seed
};

// Always use same settings for this character
function getCharacterVoice(characterId) {
  return db.query(
    'SELECT * FROM character_voices WHERE character_id = $1',
    [characterId]
  );
}
```

**Effectiveness:** ⭐⭐⭐⭐ (4/5) - Highly consistent

### 3. **Cache Generated Audio** (Best Solution)
```javascript
// Hash-based caching
function getCacheKey(text, voiceConfig) {
  const configStr = JSON.stringify({
    voice_id: voiceConfig.voice_id,
    stability: voiceConfig.stability,
    similarity_boost: voiceConfig.similarity_boost,
    model_id: voiceConfig.model_id
  });
  return crypto.createHash('sha256')
    .update(text + configStr)
    .digest('hex');
}

async function getOrGenerateTTS(text, voiceConfig) {
  const cacheKey = getCacheKey(text, voiceConfig);

  // Check if already generated
  const cached = await db.query(
    'SELECT audio_url FROM tts_cache WHERE cache_key = $1',
    [cacheKey]
  );

  if (cached.rows.length > 0) {
    return cached.rows[0].audio_url;  // Perfect consistency!
  }

  // Generate new
  const audioBuffer = await elevenlabs.textToSpeech(text, voiceConfig.voice_id, voiceConfig);

  // Save to cache
  await saveToCDN(cacheKey, audioBuffer);

  return audioUrl;
}
```

**Effectiveness:** ⭐⭐⭐⭐⭐ (5/5) - Perfect consistency

### 4. **Voice Selection Strategy**

**Best Practices:**
```javascript
// 1. ASSIGN DISTINCT VOICES PER CHARACTER
const characterVoices = {
  narrator: 'pNInz6obpgDQGcFmaJgB',    // Adam (mature male)
  hero: 'EXAVITQu4vr4xnSDxMaL',        // Bella (young female)
  villain: '21m00Tcm4TlvDq8ikWAM',     // Rachel (calm female)
  sidekick: 'AZnzlk1XvdvUeBnXmlld',   // Domi (young male)
};

// 2. CHOOSE VOICES WITH DISTINCT CHARACTERISTICS
- Age (child vs adult vs elderly)
- Gender
- Accent/dialect
- Tone (bright vs dark, warm vs cold)
- Energy level

// 3. USE INSTANT VOICE CLONES OR DESIGNED VOICES FOR V3
// (Professional Voice Clones not fully optimized for V3 yet)
```

### 5. **Long-Form Narrative Best Practices**

From official ElevenLabs documentation:

#### **Segment Long Content**
```javascript
// For stories longer than model character limit
async function generateLongStory(fullText, voiceConfig) {
  const maxChars = voiceConfig.model_id === 'eleven_v3' ? 5000 : 10000;

  // Split on natural boundaries (paragraphs, scenes)
  const segments = splitOnNaturalBreaks(fullText, maxChars);

  const audioSegments = [];
  for (const segment of segments) {
    const audio = await elevenlabs.textToSpeech(
      segment.text,
      voiceConfig.voice_id,
      {
        ...voiceConfig,
        seed: voiceConfig.seed  // Same seed for consistency
      }
    );
    audioSegments.push(audio);
  }

  // Concatenate audio files
  return concatenateAudio(audioSegments);
}
```

#### **Maintain Emotional Continuity**
```javascript
// Track emotional state across segments
let currentEmotion = 'neutral';

for (const segment of storySegments) {
  // Carry forward emotion if not explicitly changed
  const emotion = segment.emotion || currentEmotion;

  const audio = await generateWithEmotion(
    segment.text,
    emotion,
    characterVoice
  );

  currentEmotion = segment.emotion || currentEmotion;
}
```

#### **Use Studio for Multi-Paragraph Generation**
- ElevenLabs Studio allows generating multiple paragraphs at once
- Can apply voice changes across paragraphs
- Supports different voices within the same paragraph (character dialogue)

### Storyteller-Specific Recommendations

**Current Implementation Analysis:**
Your `generateMultiVoiceTTS()` function already implements excellent practices:

```javascript
// ✅ You're already doing this:
1. Distinct voice assignment per speaker
2. Emotion-based voice settings variation
3. Audio tags for V3
4. Session-based consistency tracking
```

**Recommended Enhancements:**

```javascript
// 1. Add seed-based consistency
async generateMultiVoiceTTS(segments, voiceSettings, options) {
  // Generate session-consistent seed
  const sessionSeed = this.generateSessionSeed(options.sessionId);

  for (const segment of segments) {
    // Character-specific seed offset
    const characterOffset = hashString(segment.speaker);
    const segmentSeed = sessionSeed + characterOffset;

    const segmentSettings = {
      ...voiceSettings,
      seed: segmentSeed  // <-- ADD THIS
    };

    // ... rest of generation
  }
}

// 2. Add character voice profile caching
async getCharacterVoice(characterName, storyId) {
  const cacheKey = `character_voice:${storyId}:${characterName}`;

  let profile = await this.cache.get(cacheKey);

  if (!profile) {
    profile = await db.query(
      'SELECT voice_id, stability, similarity_boost, style FROM character_voices WHERE story_id = $1 AND name = $2',
      [storyId, characterName]
    );

    await this.cache.set(cacheKey, profile, 3600); // 1 hour
  }

  return profile;
}
```

---

## Voice Library & Character Diversity

### Available Voices

**Total Library:** 10,000+ community-shared voices

**Character-Specific:** Hundreds of professionally designed character voices

**Categories:**
- Narrative & Story voices
- Character voices
- Animation voices
- Gaming voices
- Educational voices
- Professional voices
- Conversational voices

### Voice Selection for Multi-Character Stories

#### **Diversity Factors**

When selecting voices for different characters, ensure variation in:

1. **Gender**
   - Male, Female, Gender-neutral options

2. **Age**
   - Child (young, energetic)
   - Young adult (clear, vibrant)
   - Adult (mature, stable)
   - Elderly (weathered, experienced)

3. **Accent/Origin**
   - American (various regions)
   - British (RP, Cockney, Scottish, Irish, Welsh)
   - Australian
   - European (French, German, Italian, Spanish, etc.)
   - Asian (Japanese, Korean, Mandarin, etc.)
   - Global variety

4. **Tone Quality**
   - Warm vs. Cold
   - Bright vs. Dark
   - Smooth vs. Raspy
   - Calm vs. Energetic

5. **Speaking Style**
   - Conversational
   - Theatrical
   - News anchor
   - Friendly
   - Authoritative
   - Whimsical

#### **Recommended Narrator Voices**

From ElevenLabs Voice Library (Narrative category):

```javascript
const NARRATOR_VOICES = {
  // Male narrators
  adam: {
    id: 'pNInz6obpgDQGcFmaJgB',
    description: 'Deep, mature, authoritative',
    best_for: 'Fantasy, thriller, documentary'
  },
  antoni: {
    id: 'ErXwobaYiN019PkySvjV',
    description: 'Well-rounded, versatile',
    best_for: 'General fiction, educational'
  },
  josh: {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    description: 'Young, energetic',
    best_for: 'YA fiction, adventure'
  },

  // Female narrators
  rachel: {
    id: '21m00Tcm4TlvDq8ikWAM',
    description: 'Calm, clear, pleasant',
    best_for: 'Romance, self-help, audiobooks'
  },
  bella: {
    id: 'EXAVITQu4vr4xnSDxMaL',
    description: 'Soft, young, gentle',
    best_for: 'Children stories, YA, romance'
  },
  elli: {
    id: 'MF3mGyEYCl7XYWbV9V6O',
    description: 'Emotional, expressive',
    best_for: 'Drama, emotional narratives'
  }
};
```

#### **Character Voice Archetypes**

```javascript
const CHARACTER_ARCHETYPES = {
  hero_male_young: ['Josh', 'Callum', 'Liam'],
  hero_male_mature: ['Adam', 'Sam', 'Michael'],
  hero_female_young: ['Bella', 'Elli', 'Grace'],
  hero_female_mature: ['Rachel', 'Charlotte', 'Serena'],

  villain_male: ['Clyde', 'Dave', 'Finn'],
  villain_female: ['Dorothy', 'Glinda', 'Matilda'],

  child_male: ['George', 'Thomas'],
  child_female: ['Lily', 'Emily'],

  elderly_male: ['Arnold', 'Bill'],
  elderly_female: ['Dorothy', 'Freya'],

  comedic_sidekick: ['Domi', 'Ethan', 'Gigi'],
  wise_mentor: ['Patrick', 'Arnold'],

  fantasy_mystical: ['Aria', 'Freya', 'Ethan'],
  sci_fi_tech: ['Sarah', 'Callum']
};
```

### API: Fetching Available Voices

```javascript
// List all available voices
async function getVoiceLibrary() {
  const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY
    }
  });

  return response.data.voices;
}

// Filter voices by category
async function getVoicesByCategory(category) {
  const voices = await getVoiceLibrary();

  return voices.filter(voice =>
    voice.category === category ||
    voice.labels?.category === category
  );
}

// Get voices suitable for characters
async function getCharacterVoices() {
  const voices = await getVoiceLibrary();

  return voices.filter(voice =>
    voice.labels?.use_case?.includes('character') ||
    voice.labels?.use_case?.includes('gaming') ||
    voice.labels?.use_case?.includes('animation')
  );
}
```

### Storyteller Implementation Recommendation

**Add Voice Library Browser:**

```javascript
// New route: GET /api/voices/library
router.get('/library', async (req, res) => {
  const { category, gender, age, accent } = req.query;

  try {
    let voices = await elevenlabsService.getVoiceLibrary();

    // Filter by criteria
    if (category) {
      voices = voices.filter(v => v.category === category);
    }
    if (gender) {
      voices = voices.filter(v => v.labels?.gender === gender);
    }
    if (age) {
      voices = voices.filter(v => v.labels?.age === age);
    }
    if (accent) {
      voices = voices.filter(v => v.labels?.accent?.includes(accent));
    }

    res.json({ voices });
  } catch (error) {
    logger.error('[Voices] Failed to fetch library:', error);
    res.status(500).json({ error: 'Failed to fetch voice library' });
  }
});
```

**Character Voice Assignment UI:**
Create a voice picker component where users can:
1. Browse voice library by category
2. Preview voice samples
3. Assign voices to characters
4. Save character voice profiles

---

## Genre-Specific Recommendations

### Horror

**Model:** `eleven_v3` (emotional range for fear/dread)

**Voice Settings:**
```javascript
const HORROR_SETTINGS = {
  narrator: {
    stability: 0.6,           // Controlled, not chaotic
    similarity_boost: 0.85,
    style: 0.4,               // Moderate drama
    speed: 0.8                // Slower, deliberate
  },

  victim: {
    stability: 0.4,           // More emotional variability
    similarity_boost: 0.8,
    style: 0.7,               // Heightened drama
    speed: 1.1                // Slightly rushed when scared
  },

  threat: {
    stability: 0.6,           // Controlled menace
    similarity_boost: 0.9,
    style: 0.65,
    speed: 0.85               // Slow, threatening
  }
};
```

**Recommended Voices:**
- **Narrator:** Adam (deep, ominous), Clyde (dark)
- **Victim:** Elli (vulnerable), Bella (young, scared)
- **Threat:** Fin (sinister), Dorothy (unsettling)

**Audio Tags:**
```javascript
"[whispers] [fearful] I heard something in the darkness."
"[nervous] [stammers] W-we should leave."
"[menacing] [slowly] You shouldn't have come here."
"[terrified] [screams] No! Stay away!"
```

---

### Romance

**Model:** `eleven_multilingual_v2` (smooth, consistent)

**Voice Settings:**
```javascript
const ROMANCE_SETTINGS = {
  narrator: {
    stability: 0.7,           // Smooth, pleasant
    similarity_boost: 0.75,
    style: 0.2,               // Natural, not overdramatic
    speed: 0.9                // Slightly slower, intimate
  },

  love_interest_1: {
    stability: 0.75,
    similarity_boost: 0.85,
    style: 0.25,
    speed: 0.9
  },

  love_interest_2: {
    stability: 0.7,
    similarity_boost: 0.85,
    style: 0.3,
    speed: 0.95
  }
};
```

**Recommended Voices:**
- **Narrator:** Rachel (warm, pleasant), Charlotte (mature elegance)
- **Female Lead:** Bella (gentle), Elli (emotional), Freya (sophisticated)
- **Male Lead:** Antoni (smooth), Callum (charming), Liam (romantic)

**Audio Tags:**
```javascript
"[tender] [softly] I've wanted to tell you for so long."
"[lovingly] You mean everything to me."
"[whispers] [intimate] Come closer."
"[sad] [resigned] I can't do this anymore."
```

---

### Sci-Fi

**Model:** `eleven_turbo_v2_5` (technical, clear)

**Voice Settings:**
```javascript
const SCIFI_SETTINGS = {
  narrator: {
    stability: 0.65,
    similarity_boost: 0.75,
    style: 0.35,
    speed: 1.0                // Normal pace
  },

  ai_character: {
    stability: 0.85,          // Very consistent (robotic)
    similarity_boost: 0.7,
    style: 0.1,               // Minimal emotion
    speed: 1.0
  },

  human_character: {
    stability: 0.5,
    similarity_boost: 0.8,
    style: 0.5,
    speed: 1.05
  }
};
```

**Recommended Voices:**
- **Narrator:** Adam (authoritative), Sam (documentary style)
- **AI/Robot:** Sarah (technical), Callum (precise)
- **Captain/Leader:** Adam (commanding), Rachel (calm authority)
- **Scientist:** Antoni (intelligent), Charlotte (analytical)

**Audio Tags:**
```javascript
"[robot voice] [flatly] Systems nominal. All parameters within acceptable range."
"[urgently] Hull breach detected! Evacuate sector seven immediately!"
"[awestruck] [slowly] By the stars... it's beautiful."
```

---

### Fantasy

**Model:** `eleven_v3` (emotional, magical)

**Voice Settings:**
```javascript
const FANTASY_SETTINGS = {
  narrator: {
    stability: 0.6,
    similarity_boost: 0.8,
    style: 0.5,               // Theatrical storytelling
    speed: 0.95
  },

  wizard_mentor: {
    stability: 0.75,          // Wise, controlled
    similarity_boost: 0.85,
    style: 0.4,
    speed: 0.85               // Deliberate, measured
  },

  young_hero: {
    stability: 0.45,          // More emotional
    similarity_boost: 0.8,
    style: 0.65,
    speed: 1.1                // Energetic
  },

  dark_lord: {
    stability: 0.6,
    similarity_boost: 0.9,
    style: 0.75,              // Dramatic
    speed: 0.85               // Menacing, slow
  }
};
```

**Recommended Voices:**
- **Narrator:** Adam (epic), Antoni (versatile fantasy)
- **Wizard:** Arnold (elderly wise), Patrick (mystical)
- **Young Hero:** Josh (adventurous), Bella (young protagonist)
- **Villain:** Clyde (dark), Fin (sinister)
- **Elf:** Freya (ethereal), Grace (light, graceful)
- **Dwarf:** Bill (gruff), Dave (sturdy)

**Audio Tags:**
```javascript
"[mystical tone] [slowly] The ancient magic stirs once more."
"[young voice] [excited] I'll prove myself worthy!"
"[dark voice] [menacing] Your quest ends here, child."
"[reverent] [whispers] The prophecy speaks of one who will rise."
```

---

### Comedy

**Model:** `eleven_turbo_v2_5` (clear timing for jokes)

**Voice Settings:**
```javascript
const COMEDY_SETTINGS = {
  narrator: {
    stability: 0.5,           // Flexible for timing
    similarity_boost: 0.7,
    style: 0.5,
    speed: 1.05               // Slightly faster pacing
  },

  comedic_character: {
    stability: 0.4,           // Variable for emphasis
    similarity_boost: 0.75,
    style: 0.7,
    speed: 1.1                // Faster = funnier often
  },

  straight_man: {
    stability: 0.7,           // Deadpan consistency
    similarity_boost: 0.75,
    style: 0.3,
    speed: 1.0
  }
};
```

**Recommended Voices:**
- **Comedic Lead:** Domi (energetic), Ethan (playful), Gigi (bubbly)
- **Straight Man:** Antoni (neutral), Sam (deadpan)
- **Over-the-Top:** Josh (enthusiastic), Charlotte (dramatic)

**Audio Tags:**
```javascript
"[sarcastically] Oh, brilliant idea. What could possibly go wrong?"
"[deadpan] That's the third explosion this week."
"[laughs] [excited] This is going to be amazing!"
"[dry] [flatly] I'm thrilled. Truly."
```

---

### Mystery/Thriller

**Model:** `eleven_multilingual_v2` (consistent, suspenseful)

**Voice Settings:**
```javascript
const MYSTERY_SETTINGS = {
  narrator: {
    stability: 0.65,          // Steady, building tension
    similarity_boost: 0.8,
    style: 0.4,
    speed: 0.9                // Deliberate pacing
  },

  detective: {
    stability: 0.7,           // Analytical, controlled
    similarity_boost: 0.85,
    style: 0.35,
    speed: 0.95
  },

  suspect: {
    stability: 0.5,           // Nervous, variable
    similarity_boost: 0.8,
    style: 0.5,
    speed: 1.0
  }
};
```

**Recommended Voices:**
- **Detective:** Adam (serious), Rachel (calm investigation)
- **Narrator:** Antoni (mysterious), Charlotte (suspenseful)
- **Suspect:** Varies (match character archetype)

**Audio Tags:**
```javascript
"[mysterious] [slowly] Something didn't add up."
"[nervous] [stammers] I-I don't know what you're talking about."
"[flatly] [matter-of-fact] The evidence speaks for itself."
"[shocked] [gasps] You... you're the one?"
```

---

### Children's Stories

**Model:** `eleven_turbo_v2_5` (friendly, clear)

**Voice Settings:**
```javascript
const CHILDRENS_SETTINGS = {
  narrator: {
    stability: 0.65,
    similarity_boost: 0.75,
    style: 0.5,               // Animated storytelling
    speed: 1.0
  },

  child_character: {
    stability: 0.4,           // Energetic, variable
    similarity_boost: 0.8,
    style: 0.7,
    speed: 1.15               // Faster, excited
  },

  parent_character: {
    stability: 0.75,          // Warm, comforting
    similarity_boost: 0.8,
    style: 0.3,
    speed: 0.9
  }
};
```

**Recommended Voices:**
- **Narrator:** Bella (gentle), Charlotte (warm storyteller)
- **Child:** Emily (young girl), George (young boy)
- **Parent:** Rachel (comforting mother), Antoni (friendly father)
- **Magical Creature:** Freya (whimsical), Ethan (playful)

**Audio Tags:**
```javascript
"[cheerfully] Once upon a time, in a magical forest..."
"[excited] [childlike] Can we go on an adventure?"
"[lovingly] [gently] It's time for bed, little one."
"[playfully] [giggles] That tickles!"
```

---

## Code Examples

### Example 1: Basic TTS with Seed

```javascript
const ElevenLabs = require('elevenlabs-node');
const crypto = require('crypto');

const elevenlabs = new ElevenLabs({
  apiKey: process.env.ELEVENLABS_API_KEY
});

async function generateConsistentVoice(text, characterId) {
  // Generate deterministic seed from character ID
  const seed = parseInt(
    crypto.createHash('sha256')
      .update(characterId)
      .digest('hex')
      .slice(0, 8),
    16
  );

  const audioBuffer = await elevenlabs.textToSpeech({
    text,
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
    modelId: 'eleven_multilingual_v2',
    seed,
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      use_speaker_boost: true
    }
  });

  return audioBuffer;
}
```

### Example 2: V3 with Audio Tags

```javascript
async function generateEmotionalDialogue(dialogue, emotion) {
  // Map emotion to audio tag
  const emotionTags = {
    angry: '[angry]',
    sad: '[sad]',
    excited: '[excited]',
    fearful: '[fearful]',
    whispered: '[whispers]'
  };

  const tag = emotionTags[emotion] || '';
  const taggedText = tag ? `${tag} ${dialogue}` : dialogue;

  const audioBuffer = await elevenlabs.textToSpeech({
    text: taggedText,
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella
    modelId: 'eleven_v3',
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.5
      // Note: use_speaker_boost not available for V3
    }
  });

  return audioBuffer;
}
```

### Example 3: Multi-Character Scene

```javascript
async function generateMultiCharacterScene(scene) {
  const characterVoices = {
    narrator: 'pNInz6obpgDQGcFmaJgB',  // Adam
    hero: 'EXAVITQu4vr4xnSDxMaL',      // Bella
    villain: '21m00Tcm4TlvDq8ikWAM'    // Rachel
  };

  const audioSegments = [];

  for (const line of scene.lines) {
    const voiceId = characterVoices[line.speaker];

    // Apply emotion via audio tags for V3
    let text = line.text;
    if (line.emotion) {
      text = `[${line.emotion}] ${text}`;
    }

    const audio = await elevenlabs.textToSpeech({
      text,
      voiceId,
      modelId: 'eleven_v3',
      voiceSettings: {
        stability: line.speaker === 'narrator' ? 0.65 : 0.5,
        similarity_boost: 0.8,
        style: line.speaker === 'narrator' ? 0.3 : 0.6
      }
    });

    audioSegments.push({
      speaker: line.speaker,
      audio,
      duration: estimateDuration(line.text)
    });
  }

  return audioSegments;
}
```

### Example 4: Dynamic Voice Settings Based on Context

```javascript
function getVoiceSettingsForContext(speaker, emotion, genre) {
  const baseSettings = {
    narrator: { stability: 0.65, style: 0.3 },
    character: { stability: 0.5, style: 0.5 }
  };

  const emotionModifiers = {
    angry: { stability: -0.2, style: +0.3, speed: 1.15 },
    sad: { stability: +0.1, style: -0.1, speed: 0.85 },
    excited: { stability: -0.15, style: +0.2, speed: 1.2 },
    calm: { stability: +0.15, style: -0.1, speed: 0.9 }
  };

  const genreModifiers = {
    horror: { stability: +0.1, style: +0.1, speed: 0.9 },
    comedy: { stability: -0.1, style: +0.2, speed: 1.1 },
    romance: { stability: +0.1, style: -0.1, speed: 0.95 }
  };

  let settings = { ...baseSettings[speaker === 'narrator' ? 'narrator' : 'character'] };

  // Apply emotion modifier
  if (emotion && emotionModifiers[emotion]) {
    const mod = emotionModifiers[emotion];
    settings.stability = Math.max(0, Math.min(1, settings.stability + (mod.stability || 0)));
    settings.style = Math.max(0, Math.min(1, settings.style + (mod.style || 0)));
    settings.speed = mod.speed || 1.0;
  }

  // Apply genre modifier
  if (genre && genreModifiers[genre]) {
    const mod = genreModifiers[genre];
    settings.stability = Math.max(0, Math.min(1, settings.stability + (mod.stability || 0)));
    settings.style = Math.max(0, Math.min(1, settings.style + (mod.style || 0)));
    settings.speed = settings.speed * (mod.speed || 1.0);
  }

  return {
    stability: settings.stability,
    similarity_boost: 0.75,
    style: settings.style,
    speed: settings.speed || 1.0
  };
}

// Usage
const settings = getVoiceSettingsForContext('character', 'angry', 'horror');
// { stability: 0.45, similarity_boost: 0.75, style: 0.9, speed: 1.035 }
```

### Example 5: Caching for Consistency

```javascript
class TTSCache {
  constructor() {
    this.cache = new Map();
  }

  getCacheKey(text, voiceConfig) {
    const normalized = text.trim().toLowerCase();
    const configStr = JSON.stringify({
      voice_id: voiceConfig.voiceId,
      model_id: voiceConfig.modelId,
      stability: voiceConfig.stability,
      similarity_boost: voiceConfig.similarityBoost
    });

    return crypto.createHash('sha256')
      .update(normalized + configStr)
      .digest('hex');
  }

  async getOrGenerate(text, voiceConfig) {
    const key = this.getCacheKey(text, voiceConfig);

    // Check memory cache
    if (this.cache.has(key)) {
      console.log('[Cache HIT] Reusing cached audio');
      return this.cache.get(key);
    }

    // Check persistent cache (database/CDN)
    const cached = await db.query(
      'SELECT audio_url FROM tts_cache WHERE cache_key = $1',
      [key]
    );

    if (cached.rows.length > 0) {
      console.log('[Cache HIT] Loading from database');
      const audioBuffer = await fetchFromCDN(cached.rows[0].audio_url);
      this.cache.set(key, audioBuffer);
      return audioBuffer;
    }

    // Generate new
    console.log('[Cache MISS] Generating new audio');
    const audioBuffer = await elevenlabs.textToSpeech({
      text,
      voiceId: voiceConfig.voiceId,
      modelId: voiceConfig.modelId,
      voiceSettings: {
        stability: voiceConfig.stability,
        similarity_boost: voiceConfig.similarityBoost,
        style: voiceConfig.style,
        speed: voiceConfig.speed
      }
    });

    // Save to cache
    const audioUrl = await uploadToCDN(key, audioBuffer);
    await db.query(
      'INSERT INTO tts_cache (cache_key, audio_url, created_at) VALUES ($1, $2, NOW())',
      [key, audioUrl]
    );

    this.cache.set(key, audioBuffer);

    return audioBuffer;
  }
}

// Usage
const cache = new TTSCache();

const audio = await cache.getOrGenerate(
  "Hello, this is a test.",
  {
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    modelId: 'eleven_multilingual_v2',
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.3
  }
);
```

---

## Performance & Cost Implications

### Pricing Structure (2026)

**Credit System:**
- 1 character of text = 1 credit (for most models)
- Turbo/Flash models = 0.5 credits per character (50% cheaper)

**Plans:**
```
Free:      10,000 characters/month
Starter:   $5/mo  →  30,000 characters
Creator:   $22/mo → 100,000 characters (after promo)
Pro:       $99/mo → 500,000 characters
Scale:     $330/mo → 2,000,000 characters
Business:  Custom pricing
```

**Per-Model Costs:**
| Model | Credits/Char | Cost per 1000 chars (Pro plan) |
|-------|--------------|-------------------------------|
| eleven_v3 | 1.0 | ~$0.198 |
| eleven_multilingual_v2 | 1.0 | ~$0.198 |
| eleven_turbo_v2_5 | 0.5 | ~$0.099 |
| eleven_flash_v2_5 | 0.5 | ~$0.099 |

### Cost Optimization Strategies

#### 1. **Model Selection Based on Importance**

```javascript
function selectModelByImportance(segment) {
  if (segment.isKeyMoment || segment.hasEmotionalDialogue) {
    return 'eleven_v3';  // Premium quality for important moments
  } else if (segment.speaker === 'narrator') {
    return 'eleven_turbo_v2_5';  // Good quality, 50% cheaper
  } else {
    return 'eleven_flash_v2_5';  // Fast, cheap for background
  }
}
```

**Savings:** ~40% cost reduction without sacrificing key moments

#### 2. **Aggressive Caching**

```javascript
// Cache common phrases
const COMMON_PHRASES = [
  "Chapter One",
  "The End",
  "Meanwhile...",
  "Later that day...",
  // etc.
];

// Pre-generate and cache
for (const phrase of COMMON_PHRASES) {
  await cache.getOrGenerate(phrase, standardVoiceConfig);
}
```

**Savings:** Eliminates regeneration of repeated content

#### 3. **Batch Processing**

```javascript
// Combine short segments to reduce API overhead
function batchShortSegments(segments, maxLength = 1000) {
  const batched = [];
  let currentBatch = [];
  let currentLength = 0;

  for (const segment of segments) {
    if (segment.speaker !== currentBatch[0]?.speaker) {
      // Different speaker, can't batch
      if (currentBatch.length > 0) {
        batched.push(currentBatch);
      }
      currentBatch = [segment];
      currentLength = segment.text.length;
    } else if (currentLength + segment.text.length <= maxLength) {
      // Same speaker, within limit
      currentBatch.push(segment);
      currentLength += segment.text.length;
    } else {
      // Would exceed limit
      batched.push(currentBatch);
      currentBatch = [segment];
      currentLength = segment.text.length;
    }
  }

  if (currentBatch.length > 0) {
    batched.push(currentBatch);
  }

  return batched;
}
```

**Savings:** Reduce API calls, improve throughput

#### 4. **Quality Tier Selection**

```javascript
const TIER_SELECTION_LOGIC = {
  premium: {
    model: 'eleven_v3',
    when: 'User has subscription OR is demo/preview'
  },
  standard: {
    model: 'eleven_turbo_v2_5',
    when: 'Default for most users'
  },
  economy: {
    model: 'eleven_flash_v2_5',
    when: 'High-volume generation OR background narration'
  }
};
```

#### 5. **Character Limit Awareness**

Respect model character limits to avoid failed generations:

```javascript
const MODEL_LIMITS = {
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_turbo_v2_5: 40000,
  eleven_flash_v2_5: 40000
};

function splitForModel(text, modelId) {
  const limit = MODEL_LIMITS[modelId] || 5000;
  const safeLimit = limit - 100; // Buffer

  if (text.length <= safeLimit) {
    return [text];
  }

  // Split on paragraph boundaries
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + para).length > safeLimit) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}
```

### Performance Considerations

#### Latency by Model

| Model | Typical Latency | Best Use Case |
|-------|----------------|---------------|
| eleven_flash_v2_5 | ~75ms | Real-time, conversational |
| eleven_turbo_v2_5 | ~250-300ms | Standard interactive |
| eleven_multilingual_v2 | ~500ms | Pre-generated content |
| eleven_v3 | ~1-2 seconds | Pre-generated, emotional content |

#### Generation Speed

**Factors affecting speed:**
1. **Text length** - Longer text = longer generation
2. **Model complexity** - V3 is slowest, Flash is fastest
3. **API server load** - Peak times may be slower
4. **Network latency** - Your connection to ElevenLabs servers

**Optimization:**
```javascript
// Parallel generation for multi-voice scenes
async function generateSceneInParallel(segments, maxConcurrent = 3) {
  const queue = [...segments];
  const results = [];

  async function processNext() {
    if (queue.length === 0) return;

    const segment = queue.shift();
    const audio = await generateAudio(segment);
    results.push({ segment, audio });

    return processNext();
  }

  // Process up to maxConcurrent segments at once
  await Promise.all(
    Array(maxConcurrent).fill(null).map(() => processNext())
  );

  return results.sort((a, b) => a.segment.index - b.segment.index);
}
```

#### Speaker Boost Performance Impact

- **No speaker boost:** Baseline performance
- **With speaker boost:** ~10-20% latency increase
- **Recommendation:** Use only when consistency is critical

---

## Best Practices for Story Narration

### 1. **Narrator Selection**

**Choose based on:**
- **Genre alignment** (deep voice for thriller, warm for children's)
- **Consistency** (use same narrator throughout book/series)
- **Emotional range** (expressive voices for dramatic stories)

**Test multiple voices:**
```javascript
const NARRATOR_CANDIDATES = [
  'pNInz6obpgDQGcFmaJgB',  // Adam
  'ErXwobaYiN019PkySvjV',  // Antoni
  '21m00Tcm4TlvDq8ikWAM'   // Rachel
];

for (const voiceId of NARRATOR_CANDIDATES) {
  const sample = await elevenlabs.generatePreview(
    voiceId,
    firstParagraphOfStory
  );
  // Let user choose
}
```

### 2. **Emotional Pacing**

**Don't overuse extreme emotions:**
```javascript
// ❌ BAD: Constant intensity
every_line.emotion = 'angry';

// ✅ GOOD: Build and release tension
scene.lines = [
  { emotion: 'neutral', text: '...' },
  { emotion: 'nervous', text: '...' },
  { emotion: 'fearful', text: '...' },
  { emotion: 'terrified', text: '...' },
  { emotion: 'relieved', text: '...' },  // Release
  { emotion: 'calm', text: '...' }       // Return to baseline
];
```

### 3. **Punctuation for Prosody**

**Use punctuation strategically:**
```javascript
// Create pauses with ellipses
"He waited... listening... then heard it again."

// Emphasis with dashes
"The treasure—the one they'd searched for—was finally here."

// Questions for intonation
"What was that sound? Who's there?"

// Exclamations for intensity
"Run! The bridge is collapsing!"
```

### 4. **Avoid Audio Tag Overload**

```javascript
// ❌ BAD: Too many tags
"[excited] [loudly] [quickly] We found it!"

// ✅ GOOD: 1-2 tags maximum
"[excited] We found it!"

// ✅ GOOD: Context does the work
"After weeks of searching, we finally found it!"  // Naturally sounds excited
```

### 5. **Character Voice Consistency**

**Create character voice profiles:**
```javascript
const CHARACTER_PROFILES = {
  hero: {
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    stability: 0.55,
    similarity_boost: 0.8,
    style: 0.5,
    seed: 12345,
    description: 'Young, brave, optimistic'
  },
  mentor: {
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    stability: 0.75,
    similarity_boost: 0.85,
    style: 0.35,
    seed: 67890,
    description: 'Wise, calm, authoritative'
  }
};

function getCharacterVoice(characterName) {
  return CHARACTER_PROFILES[characterName] || CHARACTER_PROFILES.hero;
}
```

### 6. **Scene Transitions**

**Use audio cues for scene changes:**
```javascript
const sceneTransitions = [
  { type: 'time_jump', narrator_text: '[pause] Later that evening..." },
  { type: 'location_change', narrator_text: "Meanwhile, across town..." },
  { type: 'perspective_shift', narrator_text: "Back at the castle..." }
];
```

### 7. **Quality Assurance**

**Always validate generated audio:**
```javascript
async function validateAudio(audioBuffer, expectedText) {
  // Check duration
  const duration = estimateAudioDuration(audioBuffer);
  const expectedDuration = estimateTextDuration(expectedText);

  if (Math.abs(duration - expectedDuration) > 5) {
    console.warn('Duration mismatch - possible generation issue');
  }

  // Check file size
  if (audioBuffer.length < 1000) {
    throw new Error('Audio buffer too small - generation likely failed');
  }

  // Check for silence
  const isSilent = detectSilence(audioBuffer);
  if (isSilent) {
    throw new Error('Generated audio is silent');
  }

  return true;
}
```

### 8. **Provide User Previews**

```javascript
// Let users preview voice before full generation
async function generateVoicePreview(voiceId, storyGenre) {
  const previewTexts = {
    fantasy: "In a realm where magic flows like rivers and dragons soar through ancient skies...",
    mystery: "The detective studied the evidence carefully, knowing something didn't add up...",
    romance: "Their eyes met across the crowded room, and time seemed to stand still...",
    scifi: "The starship emerged from hyperspace into an unknown sector of the galaxy..."
  };

  const text = previewTexts[storyGenre] || previewTexts.fantasy;

  return await elevenlabs.textToSpeech({
    text,
    voiceId,
    modelId: 'eleven_turbo_v2_5',  // Fast preview
    voiceSettings: { stability: 0.5, similarity_boost: 0.75 }
  });
}
```

---

## Limitations & Edge Cases

### 1. **Seed Non-Determinism**

**Issue:** Seeds provide "best effort" consistency, not guaranteed reproducibility.

**Impact:**
- Same text + same settings + same seed ≠ identical audio
- Subtle variations in tone, pacing, or pronunciation
- Across API version updates, behavior may change

**Mitigation:**
- Cache generated audio for true consistency
- Use seeds as "soft anchors" only
- Don't rely on perfect reproducibility for critical applications

### 2. **Speaker Boost Not Available on V3**

**Issue:** `use_speaker_boost` parameter ignored by `eleven_v3` model.

**Impact:**
- Voice fidelity control reduced for V3
- May sound less consistent than V2 with speaker boost

**Mitigation:**
```javascript
// Auto-disable speaker boost for V3
const useSpeakerBoost = modelId === 'eleven_v3'
  ? false
  : options.use_speaker_boost;
```

### 3. **Professional Voice Clones with V3**

**Issue:** PVCs not fully optimized for V3 yet (as of Jan 2026).

**Recommendation:** Use Instant Voice Clones or Designed Voices for V3 projects.

**Impact:**
- PVCs may sound inconsistent with V3
- Better results with V2 for cloned voices

**Mitigation:**
```javascript
if (voiceConfig.isCloned && modelId === 'eleven_v3') {
  console.warn('PVC with V3 may have quality issues');
  // Option: fallback to v2
  modelId = 'eleven_multilingual_v2';
}
```

### 4. **Character Limits Per Model**

**Issue:** Different models have different max character limits.

| Model | Limit | Audio Duration |
|-------|-------|----------------|
| eleven_v3 | 5,000 | ~5 min |
| eleven_multilingual_v2 | 10,000 | ~10 min |
| eleven_turbo_v2_5 | 40,000 | ~40 min |

**Impact:** Long stories must be split into chunks.

**Mitigation:**
```javascript
function splitStory(text, modelId) {
  const limits = {
    eleven_v3: 4900,  // Leave buffer
    eleven_multilingual_v2: 9900,
    eleven_turbo_v2_5: 39900
  };

  const limit = limits[modelId] || 4900;

  // Split on natural boundaries (paragraphs, sentences)
  return smartSplit(text, limit);
}
```

### 5. **Audio Tags Voice-Dependent**

**Issue:** Tag effectiveness varies by voice.

**Example:**
- Expressive voices respond well to `[excited]`, `[sad]`
- Neutral/robotic voices may not convey emotions as strongly
- Some voices better at certain accents

**Mitigation:**
- Test tags with specific voices
- Choose voices appropriate for your tag usage
- Fallback to voice settings if tags don't work

### 6. **Number Pronunciation**

**Issue:** Models may mispronounce numbers, especially:
- Phone numbers (555-1234)
- Dates (12/25/2024)
- Currency ($1,234.56)
- Large numbers (1,000,000)

**Mitigation:**
```javascript
function normalizeNumbers(text) {
  // Phone numbers
  text = text.replace(/(\d{3})-(\d{3})-(\d{4})/g, '$1 $2 $3');

  // Currency
  text = text.replace(/\$(\d+),(\d+)/g, '$1 thousand $2 dollars');

  // Dates
  text = text.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (match, m, d, y) => {
    const months = ['January', 'February', 'March', /*...*/];
    return `${months[parseInt(m)-1]} ${d}, ${y}`;
  });

  return text;
}
```

**Or enable auto-normalization:**
```javascript
// API supports automatic text normalization
const response = await elevenlabs.textToSpeech({
  text,
  voiceId,
  apply_text_normalization: 'auto'  // Enable automatic normalization
});
```

### 7. **Latency for Real-Time Applications**

**Issue:** V3 has 1-2 second latency, unsuitable for real-time.

**Models by Latency:**
- **Real-time capable:** Flash v2.5 (~75ms), Turbo v2.5 (~250-300ms)
- **Not real-time:** V3 (~1-2s), Multilingual v2 (~500ms)

**Mitigation:**
- Use Flash/Turbo for conversational AI
- Use V3 only for pre-generated content
- Consider streaming API for perceived lower latency

### 8. **Audio Tags No Complete List**

**Issue:** ElevenLabs states there's no exhaustive list of supported tags.

**Impact:**
- Some tags may work, others may not
- Tag behavior may change over time
- Voice-dependent effectiveness

**Mitigation:**
- Test tags before production use
- Maintain your own list of verified tags for your voices
- Have fallback to voice settings if tags fail

### 9. **API Rate Limits**

**Issue:** ElevenLabs enforces rate limits based on plan.

**Typical Limits:**
- Free: 10 requests/minute
- Paid: Higher limits (varies by plan)

**Mitigation:**
```javascript
// Implement rate limiting
const rateLimiter = new RateLimiter({
  maxRequests: 10,
  perMilliseconds: 60000  // 1 minute
});

await rateLimiter.wait();
const audio = await elevenlabs.textToSpeech(/*...*/);
```

### 10. **Failed Generations Still Charge Credits**

**Issue:** If generation fails (network error, timeout), credits may still be deducted.

**Mitigation:**
- Implement retry logic with exponential backoff
- Validate audio before accepting
- Contact support for credit refunds on failures

```javascript
async function generateWithRetry(text, voiceConfig, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const audio = await elevenlabs.textToSpeech(text, voiceConfig);

      // Validate before accepting
      if (audio.length < 1000) {
        throw new Error('Audio too small, likely failed');
      }

      return audio;
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
      }

      // Exponential backoff
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}
```

---

## Implementation Recommendations for Storyteller

Based on analysis of your current implementation and ElevenLabs best practices:

### ✅ What You're Already Doing Right

1. **Excellent emotion-to-settings mapping** - Your `VOICE_PRESETS` are well-calibrated
2. **V3 audio tags integration** - `EMOTION_TO_AUDIO_TAGS` is properly implemented
3. **Multi-voice support** - `generateMultiVoiceTTS` handles character voices well
4. **Model selection by tier** - Quality tier system is good
5. **Speed range (0.7-1.3)** - Aligns perfectly with best practices

### 🔧 Recommended Enhancements

#### 1. **Add Seed-Based Consistency**

```javascript
// In server/services/elevenlabs.js

// Add seed generation helper
generateDeterministicSeed(sessionId, speaker, segmentIndex) {
  const combined = `${sessionId}-${speaker}-${segmentIndex}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}

// In textToSpeech method
async textToSpeech(text, voiceId, options = {}) {
  // ... existing code ...

  // Auto-generate seed if session info available
  const seed = options.seed || (options.sessionId && options.speaker
    ? this.generateDeterministicSeed(options.sessionId, options.speaker, options.segmentIndex || 0)
    : undefined);

  const requestBody = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings
  };

  if (seed !== undefined) {
    requestBody.seed = seed;
  }

  // ... rest of method
}
```

#### 2. **Fix Speaker Boost for V3**

```javascript
// In textToSpeech method, around line 936

// Current code:
const useSpeakerBoost = options.use_speaker_boost ?? tierDefaults.use_speaker_boost;

// Enhanced version:
const useSpeakerBoost = modelId === 'eleven_v3'
  ? false  // Speaker boost not available on V3
  : (options.use_speaker_boost ?? tierDefaults.use_speaker_boost);

// Add to voice settings only if supported
const voiceSettings = {
  stability,
  similarity_boost: similarityBoost
};

// Only add speaker boost if model supports it
if (modelId !== 'eleven_v3') {
  voiceSettings.use_speaker_boost = useSpeakerBoost;
}
```

#### 3. **Character Voice Profile Database**

```sql
-- Add to database/schema.sql

CREATE TABLE character_voice_profiles (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  character_name VARCHAR(255) NOT NULL,
  voice_id VARCHAR(50) NOT NULL,
  stability DECIMAL(3,2) DEFAULT 0.5,
  similarity_boost DECIMAL(3,2) DEFAULT 0.75,
  style DECIMAL(3,2) DEFAULT 0.3,
  speed DECIMAL(3,2) DEFAULT 1.0,
  seed INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(story_id, character_name)
);
```

```javascript
// In server/services/elevenlabs.js

async getCharacterVoiceProfile(storyId, characterName) {
  const result = await db.query(
    'SELECT * FROM character_voice_profiles WHERE story_id = $1 AND character_name = $2',
    [storyId, characterName]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Return default profile
  return {
    voice_id: this.defaultVoiceId,
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    speed: 1.0
  };
}

async saveCharacterVoiceProfile(storyId, characterName, profile) {
  await db.query(
    `INSERT INTO character_voice_profiles
     (story_id, character_name, voice_id, stability, similarity_boost, style, speed, seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (story_id, character_name)
     DO UPDATE SET
       voice_id = $3, stability = $4, similarity_boost = $5,
       style = $6, speed = $7, seed = $8`,
    [storyId, characterName, profile.voice_id, profile.stability,
     profile.similarity_boost, profile.style, profile.speed, profile.seed]
  );
}
```

#### 4. **Voice Library Browser API**

```javascript
// In server/routes/voices.js (new file)

const express = require('express');
const router = express.Router();
const elevenlabsService = require('../services/elevenlabs');

// GET /api/voices/library - Browse ElevenLabs voice library
router.get('/library', async (req, res) => {
  try {
    const { category, gender, age, accent, language } = req.query;

    const voices = await elevenlabsService.getVoiceLibrary({
      category,
      gender,
      age,
      accent,
      language
    });

    res.json({ voices });
  } catch (error) {
    logger.error('[Voices] Failed to fetch library:', error);
    res.status(500).json({ error: 'Failed to fetch voice library' });
  }
});

// GET /api/voices/:voiceId/preview - Generate preview sample
router.get('/:voiceId/preview', async (req, res) => {
  try {
    const { voiceId } = req.params;
    const { genre } = req.query;

    const previewAudio = await elevenlabsService.generatePreview(voiceId, genre);

    res.set('Content-Type', 'audio/mpeg');
    res.send(previewAudio);
  } catch (error) {
    logger.error('[Voices] Preview generation failed:', error);
    res.status(500).json({ error: 'Preview generation failed' });
  }
});

module.exports = router;
```

```javascript
// In server/services/elevenlabs.js

async getVoiceLibrary(filters = {}) {
  const response = await axios.get(`${ELEVENLABS_API_URL}/voices`, {
    headers: { 'xi-api-key': this.apiKey }
  });

  let voices = response.data.voices;

  // Apply filters
  if (filters.category) {
    voices = voices.filter(v => v.category === filters.category);
  }
  if (filters.gender) {
    voices = voices.filter(v => v.labels?.gender === filters.gender);
  }
  // ... more filters

  return voices;
}
```

#### 5. **Enhanced TTS Caching**

```javascript
// In server/services/elevenlabs.js

async getOrGenerateCached(text, voiceConfig, options = {}) {
  const cacheKey = this.getCacheKey(text, voiceConfig);

  // Check cache
  const cached = await db.query(
    'SELECT audio_url, created_at FROM tts_cache WHERE cache_key = $1',
    [cacheKey]
  );

  if (cached.rows.length > 0) {
    const cacheAge = Date.now() - new Date(cached.rows[0].created_at).getTime();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (cacheAge < maxAge) {
      logger.info('[TTS Cache HIT]', { cacheKey: cacheKey.slice(0, 16) });

      // Return cached URL
      return {
        audioUrl: cached.rows[0].audio_url,
        cached: true
      };
    }
  }

  // Generate new
  logger.info('[TTS Cache MISS] Generating new audio');
  const audioBuffer = await this.textToSpeech(text, voiceConfig.voice_id, options);

  // Save to filesystem and database
  const filename = `${cacheKey}.mp3`;
  const filepath = path.join(__dirname, '../../public/tts_cache', filename);
  await fs.promises.writeFile(filepath, audioBuffer);

  const audioUrl = `/tts_cache/${filename}`;

  await db.query(
    `INSERT INTO tts_cache (cache_key, audio_url, text_preview, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET audio_url = $2, created_at = NOW()`,
    [cacheKey, audioUrl, text.slice(0, 100)]
  );

  return { audioUrl, cached: false };
}
```

#### 6. **Add Cost Tracking**

```javascript
// In server/services/elevenlabs.js

async trackUsage(userId, storyId, characterCount, modelId, cost) {
  await db.query(
    `INSERT INTO tts_usage
     (user_id, story_id, character_count, model_id, cost, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, storyId, characterCount, modelId, cost]
  );
}

async getUserUsageStats(userId, startDate, endDate) {
  const result = await db.query(
    `SELECT
       SUM(character_count) as total_characters,
       SUM(cost) as total_cost,
       COUNT(*) as total_generations,
       model_id,
       DATE(created_at) as date
     FROM tts_usage
     WHERE user_id = $1 AND created_at BETWEEN $2 AND $3
     GROUP BY model_id, DATE(created_at)
     ORDER BY date DESC`,
    [userId, startDate, endDate]
  );

  return result.rows;
}
```

#### 7. **Quality Validation**

```javascript
// In server/services/elevenlabs.js

validateGeneratedAudio(audioBuffer, expectedText) {
  // Check minimum size
  if (audioBuffer.length < 1000) {
    throw new Error('Generated audio is too small, likely failed');
  }

  // Estimate expected duration
  const expectedDuration = this.estimateAudioDuration(expectedText);
  const actualDuration = this.getAudioDuration(audioBuffer);

  const durationDiff = Math.abs(actualDuration - expectedDuration);
  if (durationDiff > 5) {
    logger.warn('[TTS Validation] Duration mismatch', {
      expected: expectedDuration,
      actual: actualDuration,
      diff: durationDiff
    });
  }

  return true;
}

estimateAudioDuration(text) {
  // Average speaking rate: ~150 words per minute
  const words = text.split(/\s+/).length;
  return (words / 150) * 60; // seconds
}
```

---

## Summary & Quick Reference

### Model Selection Cheat Sheet

```
Real-time conversation     → eleven_flash_v2_5
Standard story narration   → eleven_turbo_v2_5
Emotional audiobook        → eleven_v3
Stable long-form content   → eleven_multilingual_v2
Cost-conscious bulk gen    → eleven_flash_v2_5
```

### Voice Settings Quick Guide

| Characteristic | Stability | Similarity | Style |
|----------------|-----------|------------|-------|
| Consistent narrator | 0.7 | 0.75 | 0.3 |
| Expressive character | 0.4 | 0.8 | 0.6 |
| Emotional dialogue | 0.3 | 0.85 | 0.8 |
| Calm narrator | 0.75 | 0.75 | 0.2 |
| Action scene | 0.35 | 0.9 | 0.8 |

### Audio Tags Most Useful

```
Emotions: [excited] [nervous] [sad] [angry] [calm]
Volume: [whispers] [shouts] [yells]
Delivery: [pause] [rushed] [stammers] [slowly]
Reactions: [sigh] [laughs] [gasps]
Tone: [sarcastically] [flatly] [playfully]
```

### Key Takeaways

1. **V3 is for emotion, V2 is for stability**
2. **Audio tags only work with V3**
3. **Speaker boost NOT available on V3**
4. **Seed provides soft consistency, not perfect reproducibility**
5. **Cache generated audio for true consistency**
6. **Use distinct voices per character for clarity**
7. **Test voices before production use**
8. **Monitor costs - V3/V2 = 1 credit/char, Turbo/Flash = 0.5**

---

## Sources

- [ElevenLabs Text-to-Speech API Documentation](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [ElevenLabs Models Overview](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs Best Practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
- [ElevenLabs Audio Tags Guide](https://elevenlabs.io/blog/v3-audiotags)
- [ElevenLabs Voice Settings Documentation](https://elevenlabs.io/docs/api-reference/voices/settings/get)
- [ElevenLabs Voice Library](https://elevenlabs.io/voice-library)
- [ElevenLabs Pricing](https://elevenlabs.io/pricing/api)

---

**Document Version:** 1.0
**Last Updated:** 2026-01-15
**Next Review:** 2026-02-15 (monthly review recommended due to rapid API evolution)
