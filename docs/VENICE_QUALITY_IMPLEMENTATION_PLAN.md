# Venice.ai Quality Enhancement - Consolidated Implementation Plan

> **Project:** Storyteller
> **Date:** 2025-12-25
> **Status:** Ready for Implementation
> **Priority:** HIGH

---

## Executive Summary

This document consolidates findings from 6 specialized subagent investigations into a prioritized implementation plan for improving Venice.ai story generation quality. The plan addresses:

1. **4x Content Expansion** - Increase initial chapter length from ~1000 to ~4000 words
2. **Multi-Pass Enhancement Pipeline** - 6-phase pipeline for quality improvement
3. **Context Compacting** - Efficient token management for scene continuity
4. **Prompt Engineering** - Venice-optimized prompts with quality controls
5. **Quality Validation Gates** - Automated quality scoring with retry logic

---

## Current State Assessment

### What's Working
- Venice.ai routing triggers correctly for mature content (adultContent >50)
- Provider selection uses correct model (llama-3.3-70b)
- Mature content guidance now included in prompts (fixed in previous session)
- Settings properly stored and passed through call chain

### Quality Gaps Identified

| Issue | Root Cause | Impact |
|-------|------------|--------|
| Short scenes (~800-1200 words) | max_tokens=1500 | Stories feel rushed |
| Repetitive phrasing | No anti-repetition system | Quality degradation |
| Generic prose | Vague prompt instructions | Lacks depth |
| Continuity errors | Context too large/uncompressed | Story inconsistency |
| No quality validation | Missing scoring/retry | Bad scenes published |
| Single-pass generation | No enhancement pipeline | Missed polish |

---

## Phase 1: 4x Content Expansion (Priority: CRITICAL)

### Objective
Increase initial chapter generation from ~1000 words to ~4000 words.

### Code Changes Required

#### 1.1 Update Token Limits in `openai.js`

**File:** `server/services/openai.js`

```javascript
// BEFORE (line ~1350)
max_tokens: 1500,

// AFTER
max_tokens: isMatureContent ? 6000 : 4000,
```

#### 1.2 Update Word Count Targets

**File:** `server/services/agents/beatGenerationPipeline.js`

```javascript
// BEFORE
const targetWordCount = preferences?.targetWordCount || 1000;

// AFTER
const targetWordCount = preferences?.targetWordCount || 4000;
const minWordCount = Math.floor(targetWordCount * 0.8); // 3200 minimum
const maxWordCount = Math.ceil(targetWordCount * 1.1);  // 4400 maximum
```

#### 1.3 Update Scene Generation Prompts

Add explicit word count enforcement:

```javascript
// Add to scene generation prompt
LENGTH REQUIREMENTS:
- Target: ${targetWordCount} words
- Minimum: ${minWordCount} words (do NOT write less)
- Maximum: ${maxWordCount} words (hard limit)
- IMPORTANT: Count as you write. If approaching limit, conclude gracefully.
```

#### 1.4 Update Outline Chapter Planning

**File:** `server/services/openai.js` (generateOutline function)

```javascript
// Update chapter planning to expect longer content
For each chapter, plan:
- 4-6 major scenes (instead of 2-3)
- Multiple dramatic beats per scene
- Expanded character development moments
- Extended dialogue exchanges
- Rich environmental description
```

### Validation
- [ ] Generate 5 test stories with new word counts
- [ ] Verify average chapter length is 3500-4500 words
- [ ] Check that content quality is maintained

---

## Phase 2: Multi-Pass Enhancement Pipeline (Priority: HIGH)

### Pipeline Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Phase 1:    │───▶│ Phase 2:    │───▶│ Phase 3:    │
│ Skeleton    │    │ Expansion   │    │ Stitching   │
│ (800 words) │    │ (3000 words)│    │ (Coherence) │
└─────────────┘    └─────────────┘    └─────────────┘
                                             │
┌─────────────┐    ┌─────────────┐    ┌──────▼──────┐
│ Phase 6:    │◀───│ Phase 5:    │◀───│ Phase 4:    │
│ Tagging     │    │ Validation  │    │ Enhancement │
│ (Dialogue)  │    │ (Scoring)   │    │ (Polish)    │
└─────────────┘    └─────────────┘    └─────────────┘
```

### Phase Details

#### Phase 1: Skeleton Generation
- **Purpose:** Generate core plot/dialogue structure
- **Output:** 800-1000 word skeleton with all beats
- **Provider:** Venice (creative)
- **Temperature:** 0.85

```javascript
async function generateSkeleton(beatDescription, context) {
  return await callVenice({
    prompt: `Generate a SKELETON scene with:
    - All major plot beats
    - Key dialogue exchanges
    - Character positions and actions
    - Emotional arc markers

    DO NOT: Add description, prose, or atmosphere
    DO: Focus on story structure

    Target: 800-1000 words (skeleton only)`,
    temperature: 0.85
  });
}
```

#### Phase 2: Expansion Pass
- **Purpose:** Expand skeleton to full prose
- **Output:** 2500-3500 words with sensory detail
- **Provider:** Venice (creative)
- **Temperature:** 0.7

```javascript
async function expandScene(skeleton, context) {
  return await callVenice({
    prompt: `Expand this skeleton into full prose:

    ADD:
    - Rich sensory descriptions (sight, sound, smell, touch)
    - Internal character thoughts and emotions
    - Environmental atmosphere
    - Subtext in dialogue
    - Physical actions and reactions

    PRESERVE:
    - All plot beats
    - Dialogue content
    - Character positions

    Target: 2500-3500 words`,
    temperature: 0.7
  });
}
```

#### Phase 3: Coherence Stitching
- **Purpose:** Ensure continuity with previous scenes
- **Provider:** OpenAI (precision)
- **Temperature:** 0.3

```javascript
async function stitchCoherence(expandedScene, previousScenes, storyBible) {
  return await callOpenAI({
    prompt: `Review this scene for continuity:

    VERIFY:
    - Characters present match scene requirements
    - Timeline is consistent
    - References to past events are accurate
    - Character states (injuries, emotions) carry over
    - World rules are followed

    FIX: Any inconsistencies found

    DO NOT: Change prose style or voice`,
    temperature: 0.3
  });
}
```

#### Phase 4: Enhancement Pass
- **Purpose:** Polish prose quality
- **Provider:** Venice (creative)
- **Temperature:** 0.6

```javascript
async function enhanceScene(scene, styleGuide) {
  return await callVenice({
    prompt: `Polish this scene:

    ENHANCE:
    - Sentence rhythm variety (mix short/long)
    - Stronger verbs (replace weak verbs)
    - Cut filter words (felt, saw, heard)
    - Deepen subtext
    - Sharpen dialogue voice

    PRESERVE:
    - All plot beats
    - Character positions
    - Scene structure

    Target: Similar length, higher quality`,
    temperature: 0.6
  });
}
```

#### Phase 5: Quality Validation
- **Purpose:** Score quality, decide on retry
- **Provider:** OpenAI (analysis)
- **Temperature:** 0.2

```javascript
async function validateQuality(scene) {
  const scores = await callOpenAI({
    prompt: `Score this scene (0.0-1.0):

    {
      "prose_quality": 0.0-1.0,
      "dialogue_quality": 0.0-1.0,
      "consistency": 0.0-1.0,
      "sensory_richness": 0.0-1.0,
      "pacing": 0.0-1.0,
      "repetition_score": 0.0-1.0 (1.0 = no repetition)
    }

    CRITICAL: Be harsh. Only score 0.8+ for exceptional quality.`,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const avgScore = Object.values(scores).reduce((a,b) => a+b, 0) / 6;

  if (avgScore < 0.7) {
    return { pass: false, reason: 'Quality below threshold', scores };
  }

  return { pass: true, scores };
}
```

#### Phase 6: Dialogue Tagging
- **Purpose:** Add speaker tags for multi-voice
- **Provider:** OpenAI (precision)
- **Temperature:** 0.2

```javascript
async function tagDialogue(scene, characters) {
  return await callOpenAI({
    prompt: `Add speaker tags to dialogue:

    FORMAT: [CHAR:CharacterName]dialogue[/CHAR]

    RULES:
    - Every dialogue line must have speaker tag
    - Match speaker to correct character
    - Narrator description stays untagged
    - Character names must match: ${characters.map(c => c.name).join(', ')}

    Example:
    [CHAR:Sarah]"I don't trust him,"[/CHAR] she whispered.

    Tag ALL dialogue in this scene:`,
    temperature: 0.2
  });
}
```

### Implementation File Structure

```
server/services/
├── enhancementPipeline/
│   ├── index.js           # Pipeline orchestration
│   ├── skeletonPhase.js   # Phase 1
│   ├── expansionPhase.js  # Phase 2
│   ├── coherencePhase.js  # Phase 3
│   ├── enhancePhase.js    # Phase 4
│   ├── validationPhase.js # Phase 5
│   └── taggingPhase.js    # Phase 6
```

---

## Phase 3: Context Compacting (Priority: HIGH)

### Token Budget (8k Venice Context)

| Component | Tokens | Content |
|-----------|--------|---------|
| System prompt | 800 | Role, rules, quality checklist |
| Story context | 1200 | Compressed synopsis, characters |
| Previous scenes | 800 | Last 2-3 scenes summarized |
| Current prompt | 500 | Beat description, instructions |
| **Output reserved** | **4500** | Scene generation space |
| Safety buffer | 200 | Prevent truncation |

### Compression Functions

#### Character Compression

```javascript
function compressCharacter(char) {
  // From: 500+ tokens → To: ~50 tokens
  return `${char.name} (${char.age}, ${char.gender[0]}, ${char.role}): ` +
    `${char.traits?.slice(0,3).join(', ')}. ` +
    `Arc: ${char.current_arc || 'stable'}. ` +
    `Voice: "${char.speech_pattern || 'neutral'}"`;
}

// Example output:
// "Sarah (32, f, detective): sharp, driven, paranoid. Arc: trust_crisis. Voice: 'clipped, cop jargon'"
```

#### Scene Summarization

```javascript
function compressScene(scene) {
  // From: 3000+ tokens → To: ~100 tokens
  return `S${scene.index} [${scene.location}]: ` +
    `${scene.protagonist} ${scene.main_action}. ` +
    `Outcome: ${scene.outcome}. Mood: ${scene.mood}. ` +
    `Hook: ${scene.cliffhanger}`;
}

// Example output:
// "S7 [Warehouse]: Sarah confronted Marcus about evidence. Outcome: He fled. Mood: tense. Hook: phone rings"
```

#### Story State Encoding

```javascript
function encodeStoryState(storyBible) {
  return `PLOT_STATE:
- GOAL: ${storyBible.main_goal}
- LEADS: [${storyBible.active_leads.join(', ')}]
- OBSTACLES: [${storyBible.obstacles.join(', ')}]
- REVEALED: [${storyBible.secrets_revealed.join(', ')}]
- PENDING: [${storyBible.secrets_pending.join(', ')}]`;
}
```

### Context Builder

```javascript
function buildVeniceContext(storyData, sceneNumber) {
  const { synopsis, characters, scenes, storyBible, style } = storyData;

  // Get only relevant characters (present in scene + major)
  const relevantChars = characters.filter(c =>
    c.role === 'protagonist' ||
    c.role === 'antagonist' ||
    scenes[sceneNumber].characters?.includes(c.name)
  ).slice(0, 6); // Max 6 characters

  // Get last 3 scenes only
  const recentScenes = scenes.slice(Math.max(0, sceneNumber - 3), sceneNumber);

  return `# STORY BIBLE (Scene ${sceneNumber})

## SYNOPSIS (compressed)
${compressSynopsis(synopsis, 80)} // 80 word max

## CHARACTERS
${relevantChars.map(compressCharacter).join('\n')}

## RECENT SCENES
${recentScenes.map(compressScene).join('\n')}

## STORY STATE
${encodeStoryState(storyBible)}

## STYLE
Author: ${style.author} | POV: ${style.pov} | Tense: ${style.tense}
---`;
}
```

---

## Phase 4: Prompt Engineering Improvements (Priority: HIGH)

### Venice-Optimized Prompt Structure

```markdown
# ROLE
You are {specific_role} creating Scene {number}.

# TASK
{Clear imperative statement}

# CRITICAL RULES (most important first)
1. {Top constraint - CAPS for emphasis}
2. {Second constraint}
3. {Third constraint}

# MATURE CONTENT GUIDANCE (if applicable)
★ This is ADULT FICTION for mature audiences ★
- Adult content level: {intensity}/100
- Include explicit content: {yes/no}
- Boundaries: {specific guidance}

# QUALITY REQUIREMENTS
✓ Show don't tell
✓ Sensory anchors (2-3 per scene)
✓ Varied sentence rhythm
✓ Subtext > exposition
✗ NO cliches
✗ NO filter words (felt, saw, heard)
✗ NO repetitive phrasing

# ANTI-REPETITION SYSTEM
- Track distinctive phrases as you write
- If you've used a phrase once, BANNED for rest of scene
- Rotate vocabulary: sharp → keen → acute
- Vary sentence openings

# CONTEXT
{Compressed story bible}

# BEAT TO GENERATE
{Beat description with emotional beats}

# OUTPUT FORMAT
Raw prose only. Start immediately with scene.
Target: {word_count} words (±10%)
```

### Temperature Settings

| Task | Venice Temp | Reasoning |
|------|-------------|-----------|
| Skeleton | 0.85-0.9 | High creativity, exploratory |
| Expansion | 0.7-0.75 | Balanced creativity/consistency |
| Enhancement | 0.6-0.65 | Controlled polish |
| Validation | 0.2-0.3 | Analytical precision |
| JSON | 0.3-0.4 | Structured output |

---

## Phase 5: Quality Validation Gates (Priority: MEDIUM)

### Quality Scoring Schema

```javascript
const QUALITY_THRESHOLDS = {
  prose_quality: 0.7,      // Writing quality
  dialogue_quality: 0.7,   // Character voice distinctiveness
  consistency: 0.8,        // Continuity with story
  sensory_richness: 0.6,   // Descriptive detail
  pacing: 0.7,             // Scene flow
  repetition_score: 0.7    // 1.0 = no repetition
};

const MINIMUM_OVERALL = 0.7;
const MAX_RETRIES = 2;
```

### Validation Flow

```javascript
async function generateSceneWithValidation(params) {
  let scene = null;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;

    // Run full pipeline
    scene = await runEnhancementPipeline(params);

    // Validate quality
    const validation = await validateQuality(scene);

    if (validation.pass) {
      logger.info(`Scene passed validation on attempt ${attempt}`, validation.scores);
      return scene;
    }

    logger.warn(`Scene failed validation, attempt ${attempt}/${MAX_RETRIES}`, {
      scores: validation.scores,
      reason: validation.reason
    });

    // Add feedback for retry
    params.feedback = `Previous attempt failed: ${validation.reason}.
      Low scores: ${Object.entries(validation.scores)
        .filter(([k,v]) => v < QUALITY_THRESHOLDS[k])
        .map(([k,v]) => `${k}: ${v}`)
        .join(', ')}
      Focus on improving these areas.`;
  }

  // Return best attempt if all fail
  logger.error('All validation attempts failed, using best effort');
  return scene;
}
```

### Repetition Detection

```javascript
function detectRepetition(text) {
  const words = text.toLowerCase().split(/\s+/);
  const phrases = [];

  // Build 3-word phrases
  for (let i = 0; i < words.length - 2; i++) {
    phrases.push(words.slice(i, i + 3).join(' '));
  }

  // Count occurrences
  const counts = {};
  phrases.forEach(p => counts[p] = (counts[p] || 0) + 1);

  // Find repetitions (>2 occurrences of same phrase)
  const repetitions = Object.entries(counts)
    .filter(([phrase, count]) => count > 2)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    hasRepetition: repetitions.length > 0,
    repetitions,
    score: 1 - (repetitions.length * 0.1) // Deduct 0.1 per repetition
  };
}
```

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Implement 4x word count changes (Phase 1)
- [ ] Update openai.js max_tokens
- [ ] Update beatGenerationPipeline.js targets
- [ ] Update prompt word count guidance
- [ ] Test with 5 sample stories

### Week 2: Enhancement Pipeline
- [ ] Create enhancementPipeline/ directory structure
- [ ] Implement Phase 1 (Skeleton)
- [ ] Implement Phase 2 (Expansion)
- [ ] Implement Phase 3 (Coherence)
- [ ] Test pipeline flow

### Week 3: Quality & Polish
- [ ] Implement Phase 4 (Enhancement)
- [ ] Implement Phase 5 (Validation)
- [ ] Implement Phase 6 (Tagging)
- [ ] Integrate quality gates
- [ ] Add repetition detection

### Week 4: Context & Integration
- [ ] Implement context compression functions
- [ ] Build Venice context builder
- [ ] Update orchestrator to use new pipeline
- [ ] Full integration testing
- [ ] Performance optimization

---

## Configuration Changes

### Environment Variables

```bash
# Add to .env
VENICE_MAX_TOKENS=6000
VENICE_SCENE_TARGET_WORDS=4000
VENICE_QUALITY_THRESHOLD=0.7
VENICE_MAX_RETRIES=2
VENICE_TEMPERATURE_CREATIVE=0.85
VENICE_TEMPERATURE_POLISH=0.6
```

### Database Updates

```sql
-- Track quality metrics per scene
ALTER TABLE story_scenes ADD COLUMN quality_scores JSONB;
ALTER TABLE story_scenes ADD COLUMN generation_attempts INTEGER DEFAULT 1;
ALTER TABLE story_scenes ADD COLUMN pipeline_phases_completed TEXT[];

-- Example quality_scores:
-- {"prose_quality":0.8,"dialogue_quality":0.75,"consistency":0.9,"sensory_richness":0.7,"pacing":0.8,"repetition_score":0.85}
```

---

## Success Metrics

### Quality Targets

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Avg scene length | 800-1200 words | 3500-4500 words | Word count |
| Prose quality score | N/A | >0.7 | LLM scoring |
| Repetition rate | ~20% | <10% | Detection |
| Continuity errors | ~15% | <5% | Coherence check |
| User satisfaction | Baseline | +20% | Feedback |

### Cost Estimates

| Component | Tokens/Scene | Cost (Venice) |
|-----------|--------------|---------------|
| Skeleton | ~1500 in, ~1000 out | $0.003 |
| Expansion | ~2000 in, ~3500 out | $0.007 |
| Coherence | ~4000 in, ~4000 out | $0.012 (OpenAI) |
| Enhancement | ~4500 in, ~4500 out | $0.012 |
| Validation | ~4500 in, ~500 out | $0.008 (OpenAI) |
| Tagging | ~4500 in, ~4500 out | $0.015 (OpenAI) |
| **Total** | ~21000 in, ~18000 out | **~$0.06/scene** |

### Comparison
- Current single-pass: ~$0.015/scene (shorter, lower quality)
- New pipeline: ~$0.06/scene (4x longer, validated quality)
- Cost increase: 4x, but content increase: 4x+

---

## Risk Mitigation

### Risk 1: Pipeline Too Slow
- **Mitigation:** Run phases in parallel where possible (skeleton while compressing context)
- **Fallback:** Skip enhancement phase for time-sensitive generation

### Risk 2: Quality Gate Stuck in Loop
- **Mitigation:** Hard limit of 2 retries, accept best effort
- **Monitoring:** Track retry rates, adjust thresholds if >30% scenes retry

### Risk 3: Context Window Overflow
- **Mitigation:** Dynamic compression based on available tokens
- **Fallback:** Truncate oldest scenes first

### Risk 4: Venice API Instability
- **Mitigation:** Automatic fallback to OpenAI for creative phases
- **Monitoring:** Track Venice error rates, alert if >5%

---

## Files to Modify

### Existing Files
1. `server/services/openai.js` - Update max_tokens, add pipeline calls
2. `server/services/agents/beatGenerationPipeline.js` - Update word targets
3. `server/services/orchestrator.js` - Integrate new pipeline
4. `server/services/llmProviders.js` - Temperature config
5. `server/socket/handlers.js` - Progress events for pipeline

### New Files to Create
1. `server/services/enhancementPipeline/index.js`
2. `server/services/enhancementPipeline/skeletonPhase.js`
3. `server/services/enhancementPipeline/expansionPhase.js`
4. `server/services/enhancementPipeline/coherencePhase.js`
5. `server/services/enhancementPipeline/enhancePhase.js`
6. `server/services/enhancementPipeline/validationPhase.js`
7. `server/services/enhancementPipeline/taggingPhase.js`
8. `server/services/contextCompactor.js`
9. `server/services/qualityScorer.js`
10. `server/services/repetitionDetector.js`

---

## Quick Start Implementation

### Step 1: Immediate Win (30 minutes)
Update max_tokens and word count targets for instant 4x content:

```javascript
// openai.js line ~1350
max_tokens: preferences?.audience === 'mature' ? 6000 : 4000,

// beatGenerationPipeline.js
const targetWordCount = 4000;
```

### Step 2: Add Quality Prompt (1 hour)
Add quality checklist to Venice prompts:

```javascript
const qualitySection = `
# QUALITY REQUIREMENTS
✓ Show emotion through action, not labels
✓ 2-3 sensory details per scene
✓ Varied sentence rhythm
✗ NO filter words (felt, saw, heard)
✗ NO repetitive phrases
`;
```

### Step 3: Add Repetition Check (2 hours)
Implement basic repetition detection and warning:

```javascript
const repetition = detectRepetition(generatedScene);
if (repetition.score < 0.7) {
  logger.warn('High repetition detected', repetition);
  // Optionally regenerate
}
```

---

## Conclusion

This implementation plan addresses all identified quality gaps:

1. **4x Content** - Longer, richer initial chapters
2. **Multi-Pass Pipeline** - Systematic quality improvement
3. **Context Compacting** - Efficient token use for continuity
4. **Prompt Engineering** - Venice-optimized structure
5. **Quality Validation** - Automated scoring with retry

Start with Phase 1 (4x content) for immediate impact, then progressively implement the enhancement pipeline. Monitor quality metrics and adjust thresholds based on user feedback.

**Total Estimated Implementation Time:** 4 weeks
**Estimated Quality Improvement:** 50-100%
**Estimated Cost Increase:** 4x (offset by 4x content)

---

*Document created: 2025-12-25*
*Last updated: 2025-12-25*
*Status: Ready for implementation*
*Author: Claude Code*
