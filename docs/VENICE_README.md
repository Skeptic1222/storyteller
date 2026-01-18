# Venice.ai Prompt Engineering Documentation

> **Complete research and implementation package for Venice.ai integration in Storyteller**

---

## Overview

This documentation package provides comprehensive guidance for integrating Venice.ai (Llama 3.3 70B) into the Storyteller application with optimized prompt engineering strategies specifically designed for open-source LLMs.

Venice.ai offers **uncensored creative freedom** for mature content that would trigger OpenAI's content policies, making it ideal for adult fiction, explicit romance, graphic horror, and other mature storytelling.

---

## Documentation Structure

### 📚 Core Documentation

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **VENICE_IMPLEMENTATION_SUMMARY.md** | Executive overview and strategy | Start here for big picture |
| **VENICE_PROMPT_ENGINEERING_GUIDE.md** | Comprehensive technical guide | Deep dive into techniques |
| **VENICE_INTEGRATION_GUIDE.md** | Step-by-step implementation | During development |
| **VENICE_PROMPT_EXAMPLES.md** | Real-world prompt templates | When writing new prompts |
| **VENICE_QUICK_REFERENCE.md** | Developer cheat sheet | Daily reference during coding |

### 💻 Code Templates

| File | Purpose |
|------|---------|
| **server/services/prompts/venicePromptTemplates.js** | Production-ready prompt functions |

---

## Quick Start Guide

### 1. Understand the Landscape

Read **VENICE_IMPLEMENTATION_SUMMARY.md** first. It provides:
- Why Venice.ai vs OpenAI
- When to use each provider
- Expected outcomes and tradeoffs
- Implementation roadmap

**Time:** 15 minutes

### 2. Learn Prompt Engineering

Read **VENICE_PROMPT_ENGINEERING_GUIDE.md** for deep understanding:
- Venice.ai vs OpenAI architectural differences
- Llama 3.3 prompt structure
- Context compacting strategies
- Quality-focused prompting
- Anti-repetition techniques
- JSON reliability protocols

**Time:** 45 minutes

### 3. Implement Integration

Follow **VENICE_INTEGRATION_GUIDE.md** step-by-step:
- Provider routing strategy
- Context management
- Multi-pass enhancement pipeline
- Error handling and fallbacks
- Monitoring and quality assurance

**Time:** 2-4 hours (initial setup)

### 4. Write Your Prompts

Reference **VENICE_PROMPT_EXAMPLES.md** for templates:
- Horror scene (Lovecraftian)
- Romance scene (explicit)
- Action scene (detective noir)
- JSON extraction
- Dialogue enhancement

Copy, modify, and adapt for your scenarios.

**Time:** Ongoing

### 5. Daily Development

Keep **VENICE_QUICK_REFERENCE.md** open while coding:
- Decision trees
- Temperature guide
- Compression formulas
- Copy-paste ready prompts
- Debugging guide

**Time:** Always handy

---

## Key Concepts

### Provider Selection Strategy

```
Children's content → Always OpenAI (safety)
Mature content (intensity >60) → Venice.ai (uncensored)
Utility tasks (validation, JSON) → OpenAI (precision)
General audience → OpenAI (quality)
```

### Prompt Structure for Venice

```markdown
# ROLE
You are {specific_role}

# TASK
{Clear imperative}

# CRITICAL RULES
1. {Top constraint}
2. {Second constraint}

# QUALITY REQUIREMENTS
✓ {Positive}
✗ NO {Anti-pattern}

# ANTI-REPETITION SYSTEM
Track phrases, vary structure

# OUTPUT FORMAT
{Expected format}
```

### Context Compression

Venice has smaller context window (8-32k vs GPT-4's 128k). Compress aggressively:

```
Character: Sarah (32, f, detective): sharp, driven, paranoid. Arc: trust_crisis.
Scene: S7 [Warehouse]: Sarah confronted Marcus, he fled. Mood: tense.
```

### Temperature Settings

- Creative scene: 0.85-0.9 (high for variety)
- Dialogue: 0.75-0.8 (natural variation)
- JSON: 0.3-0.4 (precision)

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Add `VENICE_API_KEY` to environment
- [ ] Create `server/services/prompts/` directory
- [ ] Copy `venicePromptTemplates.js` into place
- [ ] Implement provider selection logic
- [ ] Add basic Venice scene generation
- [ ] Test with mature content scenarios

### Phase 2: Quality
- [ ] Add anti-repetition detection
- [ ] Implement multi-pass pipeline
- [ ] Fine-tune temperature settings
- [ ] A/B test against OpenAI baseline
- [ ] Gather user feedback

### Phase 3: Optimization
- [ ] Implement context compression
- [ ] Add context caching
- [ ] Monitor token usage
- [ ] Track cost savings
- [ ] Optimize prompt templates

### Phase 4: Production
- [ ] Enable for all mature content users
- [ ] Monitor error rates
- [ ] Track quality metrics
- [ ] Document best practices
- [ ] Create maintenance runbook

---

## Common Use Cases

### Use Case 1: Explicit Romance Scene

**Problem:** OpenAI refuses to generate explicit sexual content

**Solution:** Route to Venice with mature content guidance

```javascript
const intensity = { adultContent: 85, romance: 90 };
const provider = selectProvider({ audience: 'mature', intensity });
// Returns 'venice'

const prompt = veniceSceneGenerationPrompt({
  intensity,
  beatDescription: 'First intimate encounter...',
  // ... other params
});
```

**Result:** Uncensored, high-quality romantic scene

### Use Case 2: Graphic Horror

**Problem:** OpenAI softens gore/violence descriptions

**Solution:** Venice allows graphic content

```javascript
const intensity = { gore: 80, violence: 75 };
const provider = selectProvider({ audience: 'mature', intensity });
// Returns 'venice'

// Venice will generate visceral, detailed horror
```

### Use Case 3: Children's Bedtime Story

**Problem:** Need safe, appropriate content

**Solution:** Always route to OpenAI

```javascript
const provider = selectProvider({ audience: 'children', intensity: {} });
// Returns 'openai' (ALWAYS for children)
```

### Use Case 4: JSON Character Extraction

**Problem:** Venice doesn't have native JSON mode

**Solution:** Use strict JSON protocol + extraction parser

```javascript
const prompt = veniceJSONPrompt({
  task: 'Extract characters',
  schema: characterSchema,
  example: exampleOutput
});

const response = await callVenice({ messages: [{ role: 'user', content: prompt }] });
const data = extractJSON(response.content); // Handles markdown fences
```

---

## Troubleshooting

### Issue: Generic/Boring Output

**Symptoms:** Venice generates bland, cliched prose

**Solution:**
1. Add explicit quality checklist to prompt
2. Include anti-patterns (✗ NO cliches)
3. Provide style markers
4. Increase temperature to 0.85-0.9

**Reference:** VENICE_PROMPT_ENGINEERING_GUIDE.md > Quality-Focused Prompting

---

### Issue: Repetitive Phrasing

**Symptoms:** Same phrases appear multiple times in scene

**Solution:**
1. Add anti-repetition system to prompt
2. Increase temperature slightly
3. Use `detectRepetition()` function
4. Regenerate if repetitions >3

**Reference:** VENICE_PROMPT_ENGINEERING_GUIDE.md > Anti-Repetition Techniques

---

### Issue: Ignoring Continuity

**Symptoms:** Scene contradicts previous events or character states

**Solution:**
1. Move critical continuity to top of prompt
2. Use CAPS for emphasis: "CONTINUITY: Start from..."
3. Add coherence checks before output
4. Compress previous scenes more effectively

**Reference:** VENICE_INTEGRATION_GUIDE.md > Context Management

---

### Issue: JSON Contains Markdown

**Symptoms:** Response wrapped in ```json...``` fences or has commentary

**Solution:**
Use `extractJSON()` parser with fallback extraction:

```javascript
function extractJSON(response) {
  try {
    return JSON.parse(response);
  } catch (e) {
    // Try markdown fences
    const fence = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fence) return JSON.parse(fence[1]);
    // ... more fallbacks
  }
}
```

**Reference:** VENICE_INTEGRATION_GUIDE.md > JSON Generation

---

### Issue: Too Verbose

**Symptoms:** Scenes exceed target word count by 30%+

**Solution:**
Add hard word count limit:
```
LENGTH: Target 1000 words (hard limit: 1150 words - Do NOT exceed)
```

Not:
```
LENGTH: Aim for about 1000 words
```

**Reference:** VENICE_QUICK_REFERENCE.md > Common Mistakes

---

## Performance Expectations

### Quality Metrics (After Optimization)

| Metric | Target | Acceptable Range |
|--------|--------|------------------|
| Scene quality (vs baseline) | 8/10 | 7-9/10 |
| Repetition rate | <10% | 5-15% |
| Coherence | 9/10 | 8-10/10 |
| Voice consistency | 7/10 | 6-8/10 |
| Error rate | <5% | 3-10% |

### Cost Savings

| Volume | OpenAI Cost | Venice Cost | Savings |
|--------|-------------|-------------|---------|
| 100 scenes | $8-15 | $2-5 | ~60% |
| 1000 scenes | $80-150 | $20-50 | ~60% |
| 10000 scenes | $800-1500 | $200-500 | ~60% |

### Speed

- Similar latency to OpenAI (depends on API load)
- May need occasional regeneration (factor 1.2x time budget)

---

## Best Practices Summary

### 1. Provider Routing

✅ **DO:**
- Route children's content to OpenAI (always)
- Route mature high-intensity to Venice (>60)
- Route utility tasks to OpenAI (JSON, validation)

❌ **DON'T:**
- Use Venice for children's content
- Use Venice for complex JSON without extraction parser
- Assume Venice understands context without compression

### 2. Prompt Engineering

✅ **DO:**
- Use structured prompt format (Role → Task → Rules → Quality)
- Add explicit quality checklists
- Include anti-repetition system
- Compress context aggressively
- Provide style markers

❌ **DON'T:**
- Write vague prompts ("write a good scene")
- Assume Venice knows story context
- Skip quality requirements
- Use low temperatures for creative tasks (<0.7)

### 3. Quality Control

✅ **DO:**
- Monitor repetition warnings
- Implement fallback to OpenAI
- Track quality metrics
- A/B test prompt variations
- Iterate based on results

❌ **DON'T:**
- Accept first output without validation
- Ignore repetition warnings
- Deploy without testing
- Use same prompts as OpenAI

### 4. Context Management

✅ **DO:**
- Compress characters to 1-2 lines
- Summarize scenes to single sentences
- Include only recent/relevant context
- Reserve 4000+ tokens for output
- Cache context across scenes

❌ **DON'T:**
- Include full character backstories
- Prepend all previous scenes
- Exceed token budget
- Forget to compress

---

## Additional Resources

### External Links

- **Venice.ai Documentation:** https://docs.venice.ai/
- **Llama 3.3 Model Card:** https://ai.meta.com/llama/
- **Prompt Engineering Guide:** https://www.promptingguide.ai/

### Internal Code References

- **Provider selection:** `server/services/llmProviders.js`
- **Scene generation:** `server/services/orchestrator.js`
- **Usage tracking:** `server/services/usageTracker.js`
- **Prompt templates:** `server/services/prompts/venicePromptTemplates.js`

### Community

- Share successful prompt patterns in team docs
- Document edge cases and solutions
- Contribute improvements to templates
- A/B test and share results

---

## Maintenance

### Weekly Tasks
- Review quality metrics dashboard
- Check error logs
- Monitor repetition warnings
- Gather user feedback

### Monthly Tasks
- Analyze cost savings
- A/B test prompt variations
- Update temperature settings
- Refine compression strategies

### Quarterly Tasks
- Major prompt template updates
- Evaluate new models
- Review provider routing
- Update documentation

---

## Getting Help

### For Prompt Engineering Questions
1. Check **VENICE_PROMPT_ENGINEERING_GUIDE.md**
2. Review **VENICE_PROMPT_EXAMPLES.md** for similar scenarios
3. Use **VENICE_QUICK_REFERENCE.md** for quick answers

### For Implementation Questions
1. Follow **VENICE_INTEGRATION_GUIDE.md** step-by-step
2. Review **venicePromptTemplates.js** code
3. Check existing **llmProviders.js** patterns

### For Debugging
1. Enable verbose logging
2. Use **VENICE_QUICK_REFERENCE.md** debugging section
3. Check **provider_usage_metrics** table
4. Review quality warnings

---

## Success Criteria

You'll know Venice.ai integration is successful when:

✅ **Quality:**
- Mature content scenes comparable to OpenAI baseline
- Repetition rate <10%
- User satisfaction maintained or improved

✅ **Cost:**
- 50-70% cost reduction on mature content
- ROI positive within 1 month for high-volume users

✅ **Reliability:**
- Error rate <5%
- Fallback mechanisms working
- No content policy rejections

✅ **User Experience:**
- Uncensored creative freedom enabled
- No noticeable quality degradation
- Faster iteration (cheaper regeneration)

---

## Conclusion

This documentation package provides everything needed for successful Venice.ai integration:

- **Comprehensive theory** (VENICE_PROMPT_ENGINEERING_GUIDE.md)
- **Practical implementation** (VENICE_INTEGRATION_GUIDE.md)
- **Real-world examples** (VENICE_PROMPT_EXAMPLES.md)
- **Daily reference** (VENICE_QUICK_REFERENCE.md)
- **Production code** (venicePromptTemplates.js)

Start with the implementation summary, follow the integration guide, reference examples as needed, and keep the quick reference handy.

**Venice.ai unlocks uncensored creative freedom for mature storytelling while reducing costs by 60%. With proper prompt engineering, it's a powerful addition to Storyteller's AI toolkit.**

---

*All documentation current as of 2025-12-25*
*Storyteller Project*
*Created by Claude Code*
