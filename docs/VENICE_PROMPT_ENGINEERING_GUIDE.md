# Venice.ai & Open-Source LLM Prompt Engineering Guide

> **Project:** Storyteller
> **Focus:** Optimizing prompts for Venice.ai (Llama 3.3 70B) and open-source models
> **Date:** 2025-12-25

---

## Table of Contents

1. [Venice.ai vs OpenAI: Key Differences](#venicai-vs-openai-key-differences)
2. [Llama 3.3 Prompt Structure](#llama-33-prompt-structure)
3. [Context Compacting Strategies](#context-compacting-strategies)
4. [Quality-Focused Prompting](#quality-focused-prompting)
5. [Venice-Specific Optimizations](#venice-specific-optimizations)
6. [Prepending Strategy](#prepending-strategy)
7. [Prompt Templates](#prompt-templates)
8. [Anti-Repetition Techniques](#anti-repetition-techniques)
9. [JSON Reliability](#json-reliability)
10. [Temperature & Sampling Recommendations](#temperature--sampling-recommendations)

---

## Venice.ai vs OpenAI: Key Differences

### Architectural Differences

| Aspect | OpenAI (GPT-4/5) | Venice.ai (Llama 3.3 70B) |
|--------|------------------|---------------------------|
| **Training** | Instruction-tuned with RLHF | Less heavily fine-tuned |
| **Censorship** | Strict content policies | Uncensored for mature content |
| **Instruction Following** | Excellent (9/10) | Good (7/10) |
| **JSON Reliability** | Excellent (native support) | Moderate (needs guidance) |
| **Context Window** | 128k tokens | 8k-32k tokens (verify current) |
| **Repetition Tendency** | Low | Higher (needs mitigation) |
| **Verbose Output** | Controlled | Can be verbose (needs constraints) |

### When to Use Each Provider

**Use Venice.ai for:**
- Mature/adult content (romance >60, gore >60, violence >60)
- Uncensored creative fiction
- Content that might trigger OpenAI moderation
- Scenes requiring explicit detail

**Use OpenAI for:**
- Children's content
- Utility agents (coherence, validation, safety)
- JSON-heavy tasks
- Content requiring strict instruction following

---

## Llama 3.3 Prompt Structure

### Optimal Format

Llama models respond best to **clear role definition + explicit instructions + structured examples**.

```markdown
# ROLE
You are {specific_role} with expertise in {domain}.

# TASK
{Clear, imperative statement of what you need}

# CRITICAL RULES
1. {Most important constraint}
2. {Second most important}
3. {Third most important}

# CONTEXT
{Story context, character info, etc.}

# OUTPUT FORMAT
{Exact structure expected}

# EXAMPLE
{Few-shot example if applicable}

# NOW GENERATE
{Final prompt with dynamic content}
```

### Why This Works

1. **Headings as anchors**: Llama models use markdown headings as attention anchors
2. **Numbered lists**: Better than bullets for procedural instructions
3. **Imperative voice**: "Generate X" beats "Please generate X"
4. **Explicit negatives**: "Do NOT use euphemisms" is clearer than "Be direct"

---

## Context Compacting Strategies

### Problem: Limited Context Window

Venice.ai has a smaller context window than GPT-4. For Storyteller, we need to fit:
- Story synopsis (500-1000 tokens)
- Character profiles (100-300 tokens each)
- Previous scenes (500-2000 tokens)
- Lorebook entries (variable)
- Instructions (500-1000 tokens)

### Solution: Hierarchical Compression

#### 1. Story Bible Compression

**DON'T:**
```
The protagonist, Sarah Mitchell, is a 32-year-old detective with the Chicago PD.
She has brown hair, green eyes, and stands 5'7". She's known for her sharp wit
and dedication to justice. Her father was killed in the line of duty when she
was 15, which motivated her to become a detective herself...
```

**DO:**
```
Sarah Mitchell (32, f, detective): Sharp wit, justice-driven. Father killed in
duty (15yo). Trust issues. Mentor: Captain Harris. Quirk: taps pen when thinking.
```

**Compression Template:**
```
{Name} ({age}, {gender_code}, {role}): {top_3_traits}. {key_backstory_beat}.
{current_conflict}. Quirk: {memorable_detail}.
```

#### 2. Scene Summarization

**Previous Scene Summary Template:**
```
S{scene_num} [{location}]: {protagonist} {main_action}. Outcome: {result}.
Mood: {mood}. Hook: {cliffhanger_or_transition}.
```

**Example:**
```
S7 [Warehouse District]: Sarah confronted Marcus about the missing evidence.
Outcome: He fled, left behind encrypted phone. Mood: tense. Hook: Phone rings.
```

#### 3. Plot State Encoding

Use **plot tags** to compress narrative state:

```
PLOT_STATE:
- MAIN_GOAL: Find killer before next victim
- ACTIVE_LEADS: [encrypted_phone, witness_testimony, dna_sample]
- OBSTACLES: [corrupt_captain, 48hr_deadline, partner_injured]
- SUBPLOTS: [romance_tension_marcus, father_investigation_connection]
- SECRETS_REVEALED: [victim_knew_father, captain_taking_bribes]
- SECRETS_PENDING: [marcus_undercover_fbi, sarah_half_sister_victim]
```

**Token savings:** ~60% compared to prose

---

## Quality-Focused Prompting

### The Quality Gap

Venice.ai can produce **high-quality prose**, but it needs more explicit guidance than GPT-4.

### Anti-Pattern Recognition

**Bad Prompt (produces generic output):**
```
Write the next scene where Sarah interrogates the suspect.
```

**Good Prompt (produces quality output):**
```
Write Scene 12 as a tense interrogation between Sarah and Marcus.

QUALITY REQUIREMENTS:
- Show psychological tension through micro-behaviors (fidgeting, eye contact, breathing)
- Use subtext: characters say one thing, mean another
- Vary sentence length: short for impact, long for introspection
- NO cliches: avoid "beads of sweat", "racing heart", "held breath"
- Sensory anchors: sounds of fluorescent lights, smell of coffee, cold metal table

BEAT STRUCTURE:
1. Opening: Marcus's false confidence
2. Pivot: Sarah reveals she knows about the phone
3. Escalation: Marcus's facade cracks
4. Climax: Sarah plays recorded message
5. Resolution: Marcus's silence (withholding confession for next scene)

Aim for 800-1000 words. Prioritize tension over exposition.
```

### Prose Quality Checklist

Include this in creative prompts:

```
PROSE QUALITY:
✓ Varied sentence structure (mix short/long)
✓ Show emotion through action, not labels ("she was angry" → "her fists clenched")
✓ Specific sensory details (not "beautiful sunset" → "amber light slicing through smog")
✓ Active voice where possible
✓ Dialogue reveals character (word choice, speech patterns)
✓ Subtext > exposition
✗ NO purple prose ("her heart sang a symphony of longing")
✗ NO filter words ("she felt", "he saw", "they heard")
✗ NO adverb abuse ("very", "really", "quite")
```

---

## Venice-Specific Optimizations

### 1. Handling Uncensored Freedom

Venice doesn't refuse mature content, but it can be **too eager** and derail into gratuitous content.

**Control Mechanism:**
```
MATURE CONTENT CONTROL:
- Adult content level: {intensity_score}/100
- Include explicit scenes: {yes/no based on intensity >60}
- Narrative purpose: Sexual tension reveals {plot_point}
- Boundaries: Focus on {specific_aspect}, avoid {avoid_aspect}

IF including explicit content:
- Tie to character development or plot
- Match established tone (passionate vs clinical vs playful)
- Respect character voices and agency
```

### 2. Avoiding Common Failure Modes

**Failure Mode 1: Repetitive Phrasing**

Venice tends to reuse phrases within a response.

**Mitigation:**
```
ANTI-REPETITION RULES:
- Track your word choices: Do NOT repeat distinctive phrases
- Vary descriptors: If you use "piercing gaze" once, find alternatives
- Check rhythm: Avoid repeating sentence structures
- Read aloud mentally: Does it sound natural?
```

**Failure Mode 2: Overwriting**

Llama models can be **verbose** without constraints.

**Mitigation:**
```
LENGTH CONSTRAINT:
- Target: {min_words}-{max_words} words
- Hard limit: Do NOT exceed {max_words} words
- If approaching limit: Prioritize dialogue and action over description
- Count as you write: Stop at target
```

**Failure Mode 3: Ignoring Continuity**

Open-source models have weaker long-term memory.

**Mitigation:**
```
CONTINUITY ANCHORS (prepend these):
- Previous scene ended with: {specific_detail}
- Character states: Sarah (injured shoulder), Marcus (on edge)
- Active props: encrypted phone (in evidence), gun (Sarah's holster)
- Time: 3:47 AM, 6 hours until deadline
- Weather: rain (still falling), temperature (cold)

IF you reference events: They MUST be in the context above.
IF you introduce new info: Mark with [NEW:...] for tracking.
```

### 3. Coherence Enforcement

**System Prompt Addition:**
```
COHERENCE CHECKS (before finalizing):
1. Does this contradict established facts? {list key facts}
2. Are character voices consistent? {list voice markers per character}
3. Does the timeline make sense? {current time, elapsed time}
4. Are all mentioned characters in the scene? {scene_present list}
5. Does the mood match the intent? {target_mood}

If ANY check fails: Revise before outputting.
```

### 4. Style Consistency

Venice needs **explicit style anchoring**.

**Style Anchor Template:**
```
AUTHOR STYLE: {author_name}
Key markers:
- Sentence rhythm: {pattern}
- Vocabulary: {archaic/modern/technical/colloquial}
- POV: {first/third limited/omniscient}
- Tense: {past/present}
- Dialogue tags: {said-only/descriptive/minimal}
- Paragraph length: {short/medium/long}

EXAMPLE (from {author}):
{2-3 sentences showing style}

MIMIC THIS STYLE for the scene below.
```

---

## Prepending Strategy

### What to Prepend to Every Scene Generation Request

Create a **compressed story bible** that gets prepended to all creative prompts:

```javascript
// Template for prepended context
const buildVeniceContext = (storyData) => {
  const {
    synopsis,
    characters,
    storyBible,
    previousSceneSummaries,
    activePlotThreads,
    worldRules,
    styleGuide,
    currentSceneNumber,
    totalScenes
  } = storyData;

  return `
# STORY BIBLE (v${currentSceneNumber})

## META
Genre: ${synopsis.genre} | Themes: ${synopsis.themes.join(', ')}
Progress: Scene ${currentSceneNumber}/${totalScenes} (${Math.round(currentSceneNumber/totalScenes*100)}%)

## SYNOPSIS
${compressSynopsis(synopsis, 100)} // 100 word limit

## CHARACTERS
${characters.map(c => compressCharacter(c)).join('\n')}

## PLOT STATE
Active threads: ${activePlotThreads.map(t => `[${t.name}: ${t.status}]`).join(', ')}
Secrets revealed: ${storyBible.revealed_secrets.join(', ')}
Secrets pending: ${storyBible.pending_secrets.join(', ')}

## RECENT SCENES
${previousSceneSummaries.slice(-3).map((s, i) =>
  `S${currentSceneNumber - 3 + i} [${s.location}]: ${s.compressed_summary}`
).join('\n')}

## WORLD RULES
${worldRules.map(r => `- ${r.rule}: ${r.consequence}`).join('\n')}

## STYLE
Author: ${styleGuide.author} | Voice: ${styleGuide.voice} | POV: ${styleGuide.pov}
---
`;
};
```

### Character Compression Function

```javascript
const compressCharacter = (char) => {
  // Format: Name (age, gender, role): traits. Arc. Relationships. Voice.
  const traits = char.traits?.slice(0, 3).join(', ') || 'n/a';
  const arc = char.current_arc || 'status quo';
  const relationships = char.relationships
    ?.map(r => `${r.target}:${r.type}`)
    .join(', ') || 'none';
  const voice = char.voice_markers?.join('; ') || 'neutral';

  return `${char.name} (${char.age}, ${char.gender[0]}, ${char.role}): ${traits}. Arc: ${arc}. Rel: ${relationships}. Voice: "${voice}"`;
};

// Example output:
// Sarah (32, f, detective): sharp, driven, paranoid. Arc: trust_crisis. Rel: Marcus:tension, Harris:mentor. Voice: "clipped sentences; cop jargon; dark humor"
```

### Token Budget Allocation

For Venice.ai with ~8k context window:

| Section | Tokens | Purpose |
|---------|--------|---------|
| System prompt | 500-800 | Role, rules, quality checklist |
| Prepended context | 1500-2000 | Story bible, characters, state |
| Previous scenes | 500-1000 | Last 2-3 scenes compressed |
| Current scene prompt | 300-500 | Specific instructions for this scene |
| **Reserved for output** | **~4000** | Model's generation space |
| Safety buffer | 1000 | Avoid truncation |

---

## Prompt Templates

### Template 1: Scene Generation (Narrative Mode)

```javascript
const sceneGenerationPrompt = ({
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  targetWordCount,
  intensity
}) => `
# ROLE
You are a professional fiction writer generating Scene ${sceneNumber}.

# TASK
Write a compelling scene based on the beat description below.

# CRITICAL RULES
1. CONTINUITY: Start from previous scene ending: "${previousSceneEnding}"
2. LENGTH: Target ${targetWordCount} words (±10%)
3. CHARACTERS: Only use characters in PRESENT list
4. LOCATION: Scene takes place at ${location}
5. MOOD: Maintain ${mood} tone throughout
6. POV: Third-person limited (${characters[0].name}'s perspective)

${intensity.adultContent > 60 ? `
# MATURE CONTENT GUIDANCE
- Audience: Adults only
- Explicit content: ALLOWED and encouraged where narratively appropriate
- Specificity: Use direct language, NOT euphemisms
- Purpose: Ensure mature content serves character/plot development
` : ''}

# BEAT DESCRIPTION
${beatDescription}

# CHARACTERS PRESENT
${characters.map(c => `- ${c.name}: ${c.description} | Current state: ${c.current_state}`).join('\n')}

# QUALITY REQUIREMENTS
✓ Show don't tell: Reveal emotion through action
✓ Sensory details: 2-3 specific sensory anchors
✓ Varied pacing: Mix short punchy sentences with flowing description
✓ Subtext: Characters don't say exactly what they mean
✓ Distinct voices: Each character's dialogue reflects personality
✗ NO cliches or purple prose
✗ NO filter words ("felt", "saw", "heard")
✗ NO repetitive phrasing

# OUTPUT FORMAT
Raw prose only. No meta-commentary. Start immediately with the scene.

# NOW GENERATE SCENE ${sceneNumber}
`;
```

### Template 2: Expansion Pass (Polish)

Used after initial generation to enhance quality:

```javascript
const expansionPassPrompt = ({ rawScene, focusAreas, targetWordCount }) => `
# ROLE
You are a professional fiction editor performing an expansion pass.

# TASK
Enhance this scene by expanding ${focusAreas.join(', ')}.

# CRITICAL RULES
1. PRESERVE: Keep all plot beats and dialogue structure
2. EXPAND: Add depth without changing events
3. LENGTH: Expand to ~${targetWordCount} words
4. CONSISTENCY: Maintain original tone and voice

# FOCUS AREAS
${focusAreas.map(area => {
  const guidance = {
    sensory: "Add 2-3 specific sensory details per paragraph",
    emotion: "Show internal emotion through physical reactions and thoughts",
    atmosphere: "Build environmental mood through description",
    subtext: "Add layers to dialogue through body language and pauses",
    pacing: "Vary sentence rhythm for dramatic effect"
  };
  return `- ${area.toUpperCase()}: ${guidance[area]}`;
}).join('\n')}

# ORIGINAL SCENE
${rawScene}

# OUTPUT
Enhanced scene with expanded ${focusAreas.join(' and ')}.
`;
```

### Template 3: Dialogue Enhancement

```javascript
const dialogueEnhancementPrompt = ({ scene, characters, conflict }) => `
# ROLE
You are a dialogue specialist enhancing character voices.

# TASK
Rewrite the dialogue in this scene to make it sharper and more distinctive.

# CRITICAL RULES
1. PRESERVE: Keep exact same events and plot beats
2. VOICES: Each character sounds unique (see profiles below)
3. SUBTEXT: Characters have hidden agendas
4. NATURAL: People interrupt, trail off, speak in fragments
5. CONFLICT: Dialogue reflects underlying tension: ${conflict}

# CHARACTER VOICE PROFILES
${characters.map(c => `
${c.name}:
- Speech pattern: ${c.speech_pattern}
- Vocabulary: ${c.vocabulary_level}
- Tells: ${c.speech_tells} // e.g., "uses cop jargon when defensive"
- Current emotion: ${c.current_emotion}
- Hidden agenda: ${c.hidden_agenda || 'none'}
`).join('\n')}

# DIALOGUE QUALITY CHECKLIST
✓ Each character has distinct voice
✓ Subtext > surface meaning
✓ Interruptions and overlaps feel natural
✓ Body language punctuates dialogue
✓ Silences are meaningful
✗ NO exposition dumps
✗ NO "as you know" dialogue
✗ NO perfectly formed sentences (unless character trait)

# SCENE WITH WEAK DIALOGUE
${scene}

# OUTPUT
Same scene with enhanced dialogue. Keep all non-dialogue text unchanged.
`;
```

### Template 4: Polish Pass (Final Quality)

```javascript
const polishPassPrompt = ({ scene, authorStyle, targetMood }) => `
# ROLE
You are a line editor performing final polish.

# TASK
Refine this scene to match ${authorStyle} style and ${targetMood} mood.

# POLISH CHECKLIST
1. RHYTHM: Vary sentence length (check for 3+ consecutive similar-length sentences)
2. WORD CHOICE: Replace weak verbs with strong verbs
3. REDUNDANCY: Cut unnecessary words (very, really, just, that)
4. FLOW: Ensure smooth transitions between beats
5. STYLE: Match ${authorStyle}'s voice markers
6. MOOD: Every element reinforces ${targetMood}

# ${authorStyle.toUpperCase()} STYLE MARKERS
${getAuthorStyleMarkers(authorStyle)}

# SCENE TO POLISH
${scene}

# OUTPUT
Polished scene. Make targeted edits, not wholesale rewrites.
`;
```

---

## Anti-Repetition Techniques

### Problem: Llama's Repetition Tendency

Open-source models can fall into **repetitive loops**, especially:
- Repeating distinctive phrases
- Recycling sentence structures
- Overusing favorite adjectives

### Solution 1: Explicit Vocabulary Tracking

```
ANTI-REPETITION SYSTEM:
Track distinctive words/phrases you use. If you've used:
- "piercing gaze" → BANNED, find alternative
- "heart pounded" → BANNED
- "she felt..." x3 → BANNED, rephrase

VOCABULARY ROTATION:
Instead of reusing descriptors, rotate through synonyms:
- First use: "sharp" → second use: "keen" → third use: "acute"
- Track your adjectives as you write
```

### Solution 2: Pattern Detection Prompt

Add to system prompt:

```
BEFORE FINALIZING:
1. Scan your output for repeated phrases (2+ word sequences)
2. If ANY phrase appears more than once: Revise with synonym
3. Check sentence openings: Do 3+ sentences start the same way?
4. If YES: Vary sentence structure
```

### Solution 3: Stylistic Variation Database

Maintain a **variation database** for common descriptions:

```javascript
const variationDB = {
  eyes: ['piercing gaze', 'sharp stare', 'intense focus', 'unwavering look', 'steely glare'],
  speech: ['said', 'replied', 'muttered', 'whispered', 'snapped', 'drawled'],
  movement: ['walked', 'strode', 'shuffled', 'paced', 'stalked', 'crept'],
  // ... etc
};

// Inject into prompt:
const variations = `
VOCABULARY VARIATION (use different option each time):
- Eyes/gaze: ${variationDB.eyes.join(' | ')}
- Speech tags: ${variationDB.speech.join(' | ')}
- Movement: ${variationDB.movement.join(' | ')}
`;
```

---

## JSON Reliability

### Problem: Venice.ai JSON Compliance

Unlike GPT-4 with native JSON mode, Llama 3.3 can:
- Add markdown code fences
- Include commentary outside JSON
- Use invalid JSON syntax
- Forget required fields

### Solution: Strict JSON Protocol

```javascript
const jsonPrompt = ({ task, schema, example }) => `
# CRITICAL: JSON OUTPUT ONLY

You MUST return ONLY valid JSON. No markdown, no commentary, no extra text.

# SCHEMA
${JSON.stringify(schema, null, 2)}

# REQUIRED FIELDS
${Object.keys(schema.properties).map(k => `- ${k}: ${schema.properties[k].type}`).join('\n')}

# VALIDATION RULES
1. ALL required fields must be present
2. Field types must match schema exactly
3. String values in quotes, numbers without quotes
4. Arrays use [], objects use {}
5. No trailing commas
6. No comments (// or /* */)

# EXAMPLE (correct format)
${JSON.stringify(example, null, 2)}

# YOUR TASK
${task}

# OUTPUT FORMAT
Return ONLY the JSON object. First character must be {, last character must be }
No markdown fences, no explanations.

JSON:
`;
```

### Post-Processing: JSON Extraction

Always parse Venice responses with fallback extraction:

```javascript
const extractJSON = (response) => {
  try {
    // Try direct parse
    return JSON.parse(response);
  } catch (e) {
    // Try extracting from markdown fences
    const fenceMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1]);
    }

    // Try finding JSON object
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  }
};
```

---

## Temperature & Sampling Recommendations

### Venice.ai Temperature Guide

| Task | Temperature | Top-P | Reasoning |
|------|-------------|-------|-----------|
| **Creative scenes** | 0.8-0.9 | 0.9 | High creativity, varied prose |
| **Dialogue** | 0.7-0.8 | 0.85 | Natural variation, avoid robotic |
| **Expansion/polish** | 0.6-0.7 | 0.85 | Enhance without wild changes |
| **JSON generation** | 0.3-0.5 | 0.8 | Structured output needs consistency |
| **Coherence/validation** | 0.2-0.3 | 0.75 | Logical analysis, minimal creativity |

### Why Higher Temps for Venice?

Llama models have **less training on instruction following**, so they need:
- Higher temperature to explore quality outputs
- More explicit constraints (which higher temp helps bypass repetition)
- Wider sampling (top-p) to find varied phrasing

**OpenAI comparison:**
- GPT-4 at temp 0.7 = Venice at temp 0.9 (similar creativity)
- GPT-4 at temp 0.3 = Venice at temp 0.5 (similar precision)

### Dynamic Temperature Adjustment

```javascript
const selectTemperature = ({ taskType, sceneNumber, intensity }) => {
  let baseTemp = 0.7;

  // Task type
  if (taskType === 'creative') baseTemp = 0.85;
  if (taskType === 'polish') baseTemp = 0.65;
  if (taskType === 'json') baseTemp = 0.4;

  // Early scenes: lower temp for establishment
  if (sceneNumber < 3) baseTemp -= 0.1;

  // High intensity: higher temp for bold choices
  if (intensity > 70) baseTemp += 0.1;

  return Math.min(Math.max(baseTemp, 0.2), 1.0);
};
```

---

## Implementation Checklist

### Migrating Existing Prompts to Venice

- [ ] **Step 1:** Audit current prompts in `openai.js` for OpenAI-specific features
  - [ ] Remove reliance on `response_format: { type: 'json_object' }`
  - [ ] Add explicit JSON formatting instructions
  - [ ] Add anti-repetition rules

- [ ] **Step 2:** Compress context for smaller window
  - [ ] Implement character compression function
  - [ ] Implement scene summarization function
  - [ ] Build prepended context builder

- [ ] **Step 3:** Add quality controls
  - [ ] Add prose quality checklist to creative prompts
  - [ ] Add style consistency markers
  - [ ] Add coherence checks

- [ ] **Step 4:** Test and iterate
  - [ ] Generate test scenes with Venice
  - [ ] Compare quality to GPT-4 baseline
  - [ ] Adjust temperatures and prompts
  - [ ] Document successful patterns

### Provider Routing Logic

```javascript
const selectProvider = ({ audience, intensity, taskType }) => {
  // Children's content: Always OpenAI
  if (audience === 'children') return PROVIDERS.OPENAI;

  // Mature content with high intensity: Venice
  if (audience === 'mature' && (
    intensity.adultContent > 60 ||
    intensity.gore > 60 ||
    intensity.violence > 60
  )) {
    return PROVIDERS.VENICE;
  }

  // Utility tasks: OpenAI (better instruction following)
  if (['json', 'validation', 'safety', 'coherence'].includes(taskType)) {
    return PROVIDERS.OPENAI;
  }

  // Creative tasks for general audience: OpenAI (higher quality)
  return PROVIDERS.OPENAI;
};
```

---

## Debugging Venice Responses

### Common Issues and Fixes

**Issue 1: Generic/boring output**
- **Cause:** Prompt too vague, lacks quality checklist
- **Fix:** Add explicit quality requirements, examples, anti-patterns

**Issue 2: Repetitive phrasing**
- **Cause:** Model falls into attention loop
- **Fix:** Add anti-repetition instructions, increase temperature

**Issue 3: Ignoring continuity**
- **Cause:** Context not prominent enough
- **Fix:** Move critical continuity to top of prompt, use CAPS for emphasis

**Issue 4: Inconsistent JSON**
- **Cause:** Model adds commentary or formatting
- **Fix:** Use strict JSON protocol, post-process with extraction

**Issue 5: Overly verbose**
- **Cause:** No length constraint
- **Fix:** Add hard word count limit, "Do NOT exceed X words"

**Issue 6: Style drift**
- **Cause:** Weak style anchoring
- **Fix:** Add author example passage, explicit style markers

---

## Future Optimization Opportunities

1. **Few-Shot Learning:** Build library of high-quality Venice outputs to use as examples
2. **Prompt Chaining:** Break complex tasks into smaller Venice calls (outline → beats → scene → polish)
3. **Hybrid Approach:** Venice for creative, GPT-4 for coherence validation
4. **Fine-Tuning:** If Venice offers fine-tuning, create storyteller-specific model
5. **Context Caching:** Cache compressed story bible to save tokens across scenes

---

## Conclusion

Venice.ai and open-source LLMs require **more explicit guidance** than GPT-4, but can produce **equally high-quality creative content** with proper prompt engineering.

**Key Takeaways:**
1. Use structured prompts with clear sections
2. Compress context aggressively for token efficiency
3. Add explicit quality checklists and anti-patterns
4. Implement anti-repetition mechanisms
5. Use higher temperatures (0.8-0.9) for creative tasks
6. Post-process JSON with fallback extraction
7. Route tasks intelligently between providers

**Remember:** Venice is a creative partner, not a servant. Guide it with specificity, trust its uncensored capability, and validate its output with utility agents.

---

*Document version: 1.0*
*Last updated: 2025-12-25*
*Author: Claude Code*
