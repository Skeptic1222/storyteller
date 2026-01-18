# Venice.ai Quick Reference

> **Developer cheat sheet for Venice.ai prompt engineering**

---

## Provider Selection Decision Tree

```
START
│
├─ Is audience = "children"?
│  └─ YES → Use OpenAI (ALWAYS)
│  └─ NO → Continue
│
├─ Is intensity.adultContent > 60 OR gore > 60 OR violence > 60?
│  └─ YES → Use Venice.ai
│  └─ NO → Continue
│
├─ Is taskType in [safety, coherence, validation, json]?
│  └─ YES → Use OpenAI (better instruction following)
│  └─ NO → Continue
│
└─ Default → Use OpenAI (higher quality for general content)
```

---

## Temperature Guide

| Task Type | Venice Temp | OpenAI Temp | Reasoning |
|-----------|-------------|-------------|-----------|
| Creative scene | 0.85-0.9 | 0.7 | Venice needs higher for quality variety |
| Dialogue | 0.75-0.8 | 0.6-0.7 | Natural variation |
| Expansion/polish | 0.6-0.7 | 0.5-0.6 | Controlled enhancement |
| JSON generation | 0.3-0.4 | 0.2-0.3 | Precision required |
| Validation | 0.2-0.3 | 0.2 | Logical analysis |

---

## Prompt Structure Template

```markdown
# ROLE
You are {specific_role} with expertise in {domain}.

# TASK
{Clear, imperative statement}

# CRITICAL RULES
1. {Most important constraint}
2. {Second most important}
3. {Third most important}

# {CONTEXT_SECTION}
{Compressed story bible or relevant data}

# QUALITY REQUIREMENTS
✓ {Positive requirement 1}
✓ {Positive requirement 2}
✗ NO {Anti-pattern 1}
✗ NO {Anti-pattern 2}

# ANTI-REPETITION SYSTEM
Track distinctive phrases. If used once, BANNED - find alternative.

# STYLE GUIDE: {AUTHOR_STYLE}
{Style-specific markers}

# OUTPUT FORMAT
{Expected format}

# NOW GENERATE {TASK}
```

---

## Context Compression Formulas

### Character Compression
```
{Name} ({age}, {gender_code}, {role}): {top_3_traits}. Arc: {arc}.
Rel: {relationships}. Voice: "{voice_markers}"
```

**Example:**
```
Sarah (32, f, detective): sharp, driven, paranoid. Arc: trust_crisis.
Rel: Marcus:tension, Harris:mentor. Voice: "clipped; cop jargon; dark humor"
```

### Scene Compression
```
S{num} [{location}]: {action_summary}. Mood: {mood}. Hook: {transition}.
```

**Example:**
```
S7 [Warehouse]: Sarah confronted Marcus, he fled. Mood: tense. Hook: Phone rings.
```

### Token Budget (8k context window)
- System prompt: 800 tokens
- Story context: 1500 tokens
- Recent scenes: 1000 tokens
- Current prompt: 500 tokens
- **Output reserved:** 4000 tokens
- Safety buffer: 1200 tokens

---

## Common Prompts (Copy-Paste Ready)

### 1. Scene Generation (Venice)

```javascript
const prompt = `# ROLE
You are a professional fiction writer generating Scene ${sceneNum}.

# TASK
Write compelling scene based on beat description.

# CRITICAL RULES
1. CONTINUITY: Start from: "${previousEnding}"
2. LENGTH: ${targetWords} words (hard limit: ${Math.floor(targetWords*1.15)})
3. LOCATION: ${location}
4. MOOD: ${mood}
5. POV: ${pov}

# BEAT DESCRIPTION
${beatDesc}

# CHARACTERS PRESENT
${characters.map(c => `- ${c.name}: ${c.description}`).join('\n')}

# QUALITY REQUIREMENTS
✓ Show don't tell ✓ Sensory details ✓ Varied pacing
✗ NO cliches ✗ NO filter words ✗ NO purple prose

# ANTI-REPETITION
Track phrases. Used once = BANNED. Vary sentence openings.

# OUTPUT
Raw prose only. Start immediately.`;
```

### 2. JSON Extraction (Venice)

```javascript
const prompt = `# CRITICAL: JSON OUTPUT ONLY

# TASK
${task}

# SCHEMA
${JSON.stringify(schema, null, 2)}

# EXAMPLE
${JSON.stringify(example, null, 2)}

# VALIDATION RULES
1. All required fields present
2. Valid JSON syntax
3. No extra text

# OUTPUT
ONLY JSON. Start with {, end with }`;
```

### 3. Dialogue Enhancement (Venice)

```javascript
const prompt = `# ROLE
Dialogue specialist enhancing voices and subtext.

# TASK
Rewrite ONLY dialogue. Keep events/actions unchanged.

# CRITICAL RULES
1. PRESERVE: Plot beats unchanged
2. VOICES: Each character sounds unique
3. SUBTEXT: Hidden meanings in every exchange

# CHARACTER VOICES
${characters.map(c => `
${c.name}:
- Pattern: ${c.speech_pattern}
- Vocabulary: ${c.vocab}
- Tells: ${c.tells}
- Current emotion: ${c.emotion}
`).join('\n')}

# SCENE
${scene}

# OUTPUT
Enhanced dialogue. Keep non-dialogue text unchanged.`;
```

---

## Anti-Repetition Checklist

Add to creative prompts:

```markdown
# ANTI-REPETITION SYSTEM
As you write, track distinctive phrases:
- If phrase used (2+ words), BANNED - find alternative
- 3+ sentences same opening? Vary structure
- Rotate descriptors: "sharp" → "keen" → "acute"
- Read mentally: Sound repetitive? Revise.
```

---

## Quality Checklists by Genre

### Horror/Thriller
```
✓ Build atmosphere through sensory details
✓ Suggest terror, don't show directly
✓ Escalate tension gradually
✗ NO jump scares every paragraph
✗ NO gore without purpose
```

### Romance
```
✓ Emotional intimacy alongside physical
✓ Clear, enthusiastic consent
✓ Character vulnerability shown
✗ NO clinical terminology
✗ NO purple prose ("throbbing manhood")
```

### Detective Noir
```
✓ First-person cynical narration
✓ Snappy dialogue with subtext
✓ Atmospheric urban settings
✗ NO perfect grammar in dialogue
✗ NO explaining the mystery too early
```

### Fantasy/Sci-Fi
```
✓ World-building woven into narrative
✓ Show magic/tech through use
✓ Balance exposition with action
✗ NO info dumps
✗ NO modern slang in medieval fantasy
```

---

## JSON Extraction (Venice-Safe)

### Robust Parser

```javascript
function extractJSON(response) {
  try {
    return JSON.parse(response);
  } catch (e) {
    // Try markdown fences
    const fence = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fence) return JSON.parse(fence[1]);

    // Try finding JSON object
    const obj = response.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]);

    throw new Error('No valid JSON in response');
  }
}
```

---

## Error Handling

### Content Policy Fallback

```javascript
try {
  return await callOpenAI(prompt);
} catch (error) {
  if (error.isContentPolicy) {
    logger.warn('OpenAI refused, falling back to Venice');
    return await callVenice(prompt);
  }
  throw error;
}
```

### Venice API Error Fallback

```javascript
try {
  return await callVenice(prompt);
} catch (error) {
  logger.warn('Venice failed, falling back to OpenAI with safer prompt');
  return await callOpenAI(saferPrompt);
}
```

---

## Common Mistakes to Avoid

### ❌ DON'T: Vague prompts
```
"Write a good scene with tension"
```

### ✅ DO: Specific requirements
```
"Write 1000-word scene. Tension through:
- Character hidden agendas (Sarah suspects Marcus)
- Ticking clock (48hr deadline)
- Environmental pressure (rain, cold)
Mood: desperate. POV: third-limited (Sarah)."
```

---

### ❌ DON'T: Assume Venice knows context
```
"Continue the story where we left off"
```

### ✅ DO: Prepend compressed context
```
# STORY BIBLE
[Previous 3 scenes compressed]
[Active characters]
[Plot state]

Now continue from: "${lastSentence}"
```

---

### ❌ DON'T: Request JSON without protocol
```
"Return the characters as JSON"
```

### ✅ DO: Use strict JSON protocol
```
# CRITICAL: JSON OUTPUT ONLY
[Schema]
[Validation rules]
[Example]
Output ONLY JSON. No markdown fences.
```

---

### ❌ DON'T: Generic quality guidance
```
"Make it good and engaging"
```

### ✅ DO: Specific quality checklist
```
✓ Show emotion through action, not labels
✓ Include 2-3 sensory details per paragraph
✓ Vary sentence length for rhythm
✗ NO cliches ("beads of sweat")
✗ NO filter words ("felt", "saw")
```

---

## Debugging Venice Responses

### Issue: Generic/Boring Output
**Solution:** Add explicit quality checklist + anti-patterns + examples

### Issue: Repetitive Phrasing
**Solution:** Add anti-repetition system + increase temperature to 0.85+

### Issue: Ignoring Continuity
**Solution:** Move critical info to top of prompt + use CAPS for emphasis

### Issue: Verbose Output
**Solution:** Add hard word count limit: "Do NOT exceed X words"

### Issue: JSON Has Markdown Fences
**Solution:** Use extraction parser (see above)

### Issue: Style Drift
**Solution:** Add author example passage + explicit style markers

---

## Performance Tips

1. **Batch similar calls**: Generate multiple scenes in one session
2. **Cache context**: Reuse compressed story bible across scenes
3. **Parallel processing**: Generate scene + validate continuity simultaneously
4. **Temperature tuning**: Start high (0.9), lower if quality issues
5. **Monitor tokens**: Track usage to optimize context compression

---

## Testing Checklist

When implementing Venice:

- [ ] Test with children's content (should route to OpenAI)
- [ ] Test with mature content intensity >60 (should route to Venice)
- [ ] Test JSON extraction (verify parser handles fences)
- [ ] Test fallback on content policy error
- [ ] Test fallback on API failure
- [ ] Check repetition detection
- [ ] Verify context compression (check token counts)
- [ ] A/B test against OpenAI baseline
- [ ] Monitor quality warnings
- [ ] Track cost vs OpenAI

---

## Quick Implementation

```javascript
// 1. Import templates
import { veniceSceneGenerationPrompt, buildVeniceContext } from './prompts/venicePromptTemplates.js';
import { callVenice } from './llmProviders.js';

// 2. Select provider
const provider = selectProviderForTask({ audience, intensity, taskType });

// 3. Generate with Venice
if (provider.provider === 'venice') {
  const context = buildVeniceContext({ synopsis, characters, previousScenes, ... });
  const prompt = veniceSceneGenerationPrompt({ sceneNumber, beatDescription, ... });
  const response = await callVenice({
    messages: [
      { role: 'system', content: context },
      { role: 'user', content: prompt }
    ],
    temperature: 0.85,
    max_tokens: 2048
  });
  return response.content;
}
```

---

## Resources

- **Full Guide:** `VENICE_PROMPT_ENGINEERING_GUIDE.md`
- **Integration:** `VENICE_INTEGRATION_GUIDE.md`
- **Examples:** `VENICE_PROMPT_EXAMPLES.md`
- **Templates:** `server/services/prompts/venicePromptTemplates.js`

---

*Keep this cheat sheet handy while developing. Copy-paste templates and adjust for your use case.*

*Last updated: 2025-12-25*
