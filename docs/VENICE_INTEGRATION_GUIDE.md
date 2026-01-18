# Venice.ai Integration Guide

> **Practical implementation guide for integrating Venice.ai prompts into Storyteller**

---

## Quick Start

### 1. Import the Templates

```javascript
// In your scene generation service (e.g., openai.js or new veniceService.js)
import {
  veniceSceneGenerationPrompt,
  veniceExpansionPassPrompt,
  veniceDialogueEnhancementPrompt,
  venicePolishPassPrompt,
  veniceJSONPrompt,
  buildVeniceContext,
  detectRepetition
} from './prompts/venicePromptTemplates.js';

import { callVenice } from './llmProviders.js';
```

### 2. Basic Scene Generation Example

```javascript
/**
 * Generate scene using Venice.ai with optimized prompts
 */
async function generateSceneWithVenice({
  sessionId,
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  context
}) {
  // Build prepended context
  const storyContext = buildVeniceContext({
    synopsis: context.synopsis,
    characters: context.characters,
    previousScenes: context.previousScenes,
    activePlotThreads: context.plotThreads,
    worldRules: context.worldRules,
    storyBible: context.storyBible,
    currentSceneNumber: sceneNumber,
    totalScenes: context.totalScenes,
    styleGuide: context.styleGuide
  });

  // Build scene generation prompt
  const scenePrompt = veniceSceneGenerationPrompt({
    sceneNumber,
    beatDescription,
    characters,
    location,
    mood,
    previousSceneEnding,
    targetWordCount: 1000,
    intensity: context.intensity,
    authorStyle: context.styleGuide?.author || 'modern fiction',
    pov: context.styleGuide?.pov || 'third-person limited'
  });

  // Combine context + prompt
  const messages = [
    { role: 'system', content: storyContext },
    { role: 'user', content: scenePrompt }
  ];

  // Call Venice with optimal settings
  const response = await callVenice({
    messages,
    model: 'llama-3.3-70b',
    temperature: 0.85, // High for creative prose
    max_tokens: 2048
  });

  // Check for repetition
  const repetitions = detectRepetition(response.content);
  if (repetitions.length > 3) {
    logger.warn(`[Venice] Scene ${sceneNumber} has repetitive phrases, consider regeneration`);
  }

  return {
    content: response.content,
    usage: response.usage,
    quality_warnings: repetitions.length > 3 ? ['repetitive_phrasing'] : []
  };
}
```

### 3. Multi-Pass Enhancement Pipeline

For highest quality, use a **3-pass system**:

```javascript
/**
 * Generate high-quality scene with multi-pass enhancement
 */
async function generateEnhancedScene({
  sessionId,
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  context
}) {
  // Pass 1: Initial generation (Venice)
  logger.info(`[Scene ${sceneNumber}] Pass 1: Initial generation`);
  const initialScene = await generateSceneWithVenice({
    sessionId,
    sceneNumber,
    beatDescription,
    characters,
    location,
    mood,
    previousSceneEnding,
    context
  });

  // Pass 2: Expansion for sensory detail (Venice)
  logger.info(`[Scene ${sceneNumber}] Pass 2: Expansion`);
  const expansionPrompt = veniceExpansionPassPrompt({
    rawScene: initialScene.content,
    focusAreas: ['sensory', 'emotion', 'atmosphere'],
    targetWordCount: 1500,
    currentWordCount: initialScene.content.split(' ').length
  });

  const expandedScene = await callVenice({
    messages: [{ role: 'user', content: expansionPrompt }],
    model: 'llama-3.3-70b',
    temperature: 0.7, // Lower for controlled expansion
    max_tokens: 2500
  });

  // Pass 3: Dialogue enhancement (Venice)
  logger.info(`[Scene ${sceneNumber}] Pass 3: Dialogue enhancement`);
  const dialoguePrompt = veniceDialogueEnhancementPrompt({
    scene: expandedScene.content,
    characters,
    conflict: context.currentConflict,
    subtext: context.subtext
  });

  const enhancedScene = await callVenice({
    messages: [{ role: 'user', content: dialoguePrompt }],
    model: 'llama-3.3-70b',
    temperature: 0.75,
    max_tokens: 2500
  });

  // Pass 4: Final polish (optional, can use GPT-4 for precision)
  logger.info(`[Scene ${sceneNumber}] Pass 4: Polish`);
  const polishPrompt = venicePolishPassPrompt({
    scene: enhancedScene.content,
    authorStyle: context.styleGuide?.author || 'modern fiction',
    targetMood: mood,
    specificIssues: []
  });

  const polishedScene = await callVenice({
    messages: [{ role: 'user', content: polishPrompt }],
    model: 'llama-3.3-70b',
    temperature: 0.6, // Lowest for precision edits
    max_tokens: 2500
  });

  return {
    content: polishedScene.content,
    passes: 4,
    total_usage: {
      inputTokens: initialScene.usage.inputTokens + expandedScene.usage.inputTokens +
        enhancedScene.usage.inputTokens + polishedScene.usage.inputTokens,
      outputTokens: initialScene.usage.outputTokens + expandedScene.usage.outputTokens +
        enhancedScene.usage.outputTokens + polishedScene.usage.outputTokens
    }
  };
}
```

---

## Provider Routing Strategy

### When to Use Venice vs OpenAI

```javascript
/**
 * Intelligent provider selection based on content requirements
 */
function selectProviderForTask({ audience, intensity, taskType, agentName }) {
  // Children's content: Always OpenAI
  if (audience === 'children') {
    return {
      provider: 'openai',
      model: 'gpt-4o',
      reason: 'children_content_safety'
    };
  }

  // High-intensity mature content: Venice required
  if (audience === 'mature' && (
    intensity.adultContent > 60 ||
    intensity.gore > 60 ||
    intensity.violence > 60 ||
    intensity.romance > 60
  )) {
    return {
      provider: 'venice',
      model: 'llama-3.3-70b',
      reason: 'uncensored_mature_content'
    };
  }

  // Utility/validation tasks: OpenAI (better instruction following)
  const utilityTasks = [
    'safety_check',
    'coherence_validation',
    'continuity_check',
    'character_extraction',
    'json_parsing'
  ];

  if (utilityTasks.includes(taskType) || utilityTasks.includes(agentName)) {
    return {
      provider: 'openai',
      model: 'gpt-4o-mini',
      reason: 'utility_precision'
    };
  }

  // Creative tasks for general audience: Prefer OpenAI for quality
  if (taskType === 'creative' && audience === 'general') {
    return {
      provider: 'openai',
      model: 'gpt-4o',
      reason: 'general_creative_quality'
    };
  }

  // Default: OpenAI
  return {
    provider: 'openai',
    model: 'gpt-4o',
    reason: 'default'
  };
}
```

### Usage Example

```javascript
// In orchestrator or scene generation
const providerChoice = selectProviderForTask({
  audience: session.config_json?.audience || 'general',
  intensity: session.config_json?.intensity || {},
  taskType: 'creative',
  agentName: 'scene_generator'
});

logger.info(`[Provider] Using ${providerChoice.provider} (${providerChoice.model}) - reason: ${providerChoice.reason}`);

if (providerChoice.provider === 'venice') {
  // Use Venice-optimized prompts
  const scene = await generateSceneWithVenice({ /* params */ });
} else {
  // Use existing OpenAI flow
  const scene = await generateSceneWithDialogue({ /* params */ });
}
```

---

## Context Management for Venice

### Problem: Smaller Context Window

Venice.ai has ~8-32k context window vs GPT-4's 128k. We need aggressive compression.

### Solution: Dynamic Context Building

```javascript
/**
 * Build optimized context that fits in Venice's window
 */
function buildOptimizedVeniceContext({
  sessionId,
  sceneNumber,
  allCharacters,
  allScenes,
  storyBible,
  outline
}) {
  // TOKEN BUDGET (for 8k context window):
  // - System prompt: ~800 tokens
  // - Story context: ~1500 tokens
  // - Recent scenes: ~1000 tokens
  // - Current prompt: ~500 tokens
  // - RESERVED for output: ~4000 tokens
  // - Safety buffer: ~1200 tokens

  // 1. Compress characters (only include active characters)
  const activeCharacters = allCharacters
    .filter(c => c.scenes_appeared?.includes(sceneNumber) ||
                 c.scenes_appeared?.includes(sceneNumber - 1) ||
                 c.importance > 80)
    .slice(0, 8) // Max 8 characters
    .map(c => compressCharacter(c));

  // 2. Summarize previous scenes (only last 3)
  const recentScenes = allScenes
    .filter(s => s.sequence_index < sceneNumber)
    .slice(-3)
    .map((s, i) => compressScene(s, sceneNumber - (3 - i)));

  // 3. Extract critical plot threads only
  const activePlotThreads = storyBible?.plot_threads
    ?.filter(t => t.status === 'active')
    .slice(0, 5) // Max 5 threads
    .map(t => ({ name: t.name, status: t.status }));

  // 4. Compress world rules to essentials
  const essentialRules = outline?.world_rules
    ?.filter(r => r.importance > 70)
    .slice(0, 5);

  return {
    characters: activeCharacters,
    previousScenes: recentScenes,
    plotThreads: activePlotThreads,
    worldRules: essentialRules,
    synopsis: {
      title: outline?.title,
      genre: outline?.genre,
      themes: outline?.themes?.slice(0, 3), // Max 3 themes
      synopsis: outline?.synopsis?.split(' ').slice(0, 100).join(' ') // 100 word limit
    },
    storyBible: {
      revealed_secrets: storyBible?.revealed_secrets?.slice(-5) || [],
      pending_secrets: storyBible?.pending_secrets?.slice(0, 3) || []
    },
    totalScenes: outline?.target_scenes || 10,
    styleGuide: outline?.style_guide || {}
  };
}
```

---

## JSON Generation with Venice

### Challenge: Venice doesn't have native JSON mode

```javascript
/**
 * Generate structured data with Venice using strict protocol
 */
async function extractCharactersWithVenice(text, context) {
  const schema = {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        description: 'All named characters found in text',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['name', 'role']
        }
      }
    },
    required: ['characters']
  };

  const example = {
    characters: [
      { name: 'Sarah Mitchell', role: 'protagonist', description: 'Detective investigating murder' },
      { name: 'Marcus Kane', role: 'antagonist', description: 'Corrupt captain' }
    ]
  };

  const prompt = veniceJSONPrompt({
    task: 'Extract all named characters from the text below',
    schema,
    example,
    context: text
  });

  const response = await callVenice({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b',
    temperature: 0.3, // Low for structured output
    max_tokens: 1500
  });

  // Parse with fallback extraction
  return extractJSONFromResponse(response.content);
}

/**
 * Robust JSON extraction from Venice responses
 */
function extractJSONFromResponse(responseText) {
  try {
    // Try direct parse first
    return JSON.parse(responseText);
  } catch (e) {
    // Try extracting from markdown code fences
    const fenceMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch (e2) {
        // Continue to next fallback
      }
    }

    // Try finding JSON object
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e3) {
        // Continue to next fallback
      }
    }

    // Last resort: look for key-value pattern and construct object
    logger.error('[Venice] Failed to extract JSON from response:', responseText.substring(0, 200));
    throw new Error('No valid JSON found in Venice response');
  }
}
```

---

## Error Handling & Fallbacks

### Graceful Degradation

```javascript
/**
 * Generate scene with automatic fallback
 */
async function generateSceneWithFallback({
  sessionId,
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  context
}) {
  const providerChoice = selectProviderForTask({
    audience: context.audience,
    intensity: context.intensity,
    taskType: 'creative'
  });

  try {
    if (providerChoice.provider === 'venice') {
      logger.info(`[Scene ${sceneNumber}] Attempting Venice generation`);
      return await generateSceneWithVenice({
        sessionId,
        sceneNumber,
        beatDescription,
        characters,
        location,
        mood,
        previousSceneEnding,
        context
      });
    } else {
      logger.info(`[Scene ${sceneNumber}] Using OpenAI generation`);
      return await generateSceneWithOpenAI({
        sessionId,
        sceneNumber,
        beatDescription,
        characters,
        location,
        mood,
        previousSceneEnding,
        context
      });
    }
  } catch (error) {
    // Check if content policy error from OpenAI
    if (error.isContentPolicy && providerChoice.provider === 'openai') {
      logger.warn(`[Scene ${sceneNumber}] OpenAI content policy triggered, falling back to Venice`);
      return await generateSceneWithVenice({
        sessionId,
        sceneNumber,
        beatDescription,
        characters,
        location,
        mood,
        previousSceneEnding,
        context
      });
    }

    // Check if Venice API error
    if (providerChoice.provider === 'venice') {
      logger.warn(`[Scene ${sceneNumber}] Venice failed, falling back to OpenAI`);
      // Try with safer prompt
      return await generateSceneWithOpenAI({
        sessionId,
        sceneNumber,
        beatDescription,
        characters,
        location,
        mood,
        previousSceneEnding,
        context: {
          ...context,
          intensity: {
            ...context.intensity,
            adultContent: Math.min(context.intensity.adultContent || 0, 40),
            gore: Math.min(context.intensity.gore || 0, 40),
            violence: Math.min(context.intensity.violence || 0, 40)
          }
        }
      });
    }

    throw error;
  }
}
```

---

## Monitoring & Quality Assurance

### Track Provider Performance

```javascript
/**
 * Log provider usage and quality metrics
 */
async function trackProviderMetrics({
  provider,
  model,
  taskType,
  sceneNumber,
  inputTokens,
  outputTokens,
  duration,
  qualityWarnings
}) {
  await pool.query(`
    INSERT INTO provider_usage_metrics (
      session_id, provider, model, task_type, scene_number,
      input_tokens, output_tokens, duration_ms, quality_warnings, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
  `, [
    sessionId,
    provider,
    model,
    taskType,
    sceneNumber,
    inputTokens,
    outputTokens,
    duration,
    JSON.stringify(qualityWarnings)
  ]);

  logger.info(`[Metrics] ${provider}/${model} - ${taskType} - ${outputTokens} tokens in ${duration}ms - warnings: ${qualityWarnings.length}`);
}
```

### Quality Dashboard Queries

```sql
-- Provider performance comparison
SELECT
  provider,
  model,
  COUNT(*) as total_calls,
  AVG(output_tokens) as avg_output_tokens,
  AVG(duration_ms) as avg_duration_ms,
  SUM(CASE WHEN quality_warnings != '[]' THEN 1 ELSE 0 END) as warnings_count
FROM provider_usage_metrics
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY provider, model
ORDER BY total_calls DESC;

-- Identify scenes with quality issues
SELECT
  scene_number,
  provider,
  quality_warnings,
  output_tokens
FROM provider_usage_metrics
WHERE quality_warnings != '[]'
ORDER BY scene_number;
```

---

## Migration Path

### Gradual Rollout Strategy

**Phase 1: Testing (Week 1)**
- Enable Venice for mature content only (intensity > 70)
- Monitor quality and error rates
- Compare side-by-side with OpenAI baseline

**Phase 2: Expansion (Week 2)**
- Enable Venice for all mature content (intensity > 60)
- Add multi-pass enhancement pipeline
- Gather user feedback

**Phase 3: Optimization (Week 3)**
- Fine-tune temperature and prompts based on metrics
- Optimize context compression
- Implement caching for repeated contexts

**Phase 4: Full Rollout (Week 4)**
- Make Venice default for mature content
- Keep OpenAI for children/general content
- Document final best practices

---

## Best Practices Summary

1. **Use Venice for:**
   - Mature content (intensity >60)
   - Creative prose generation
   - Uncensored fiction

2. **Use OpenAI for:**
   - Children's content
   - Utility agents (validation, safety, coherence)
   - JSON generation
   - General audience content

3. **Optimize Prompts:**
   - Use structured format with clear sections
   - Add explicit quality checklists
   - Include anti-repetition mechanisms
   - Compress context aggressively

4. **Multi-Pass Enhancement:**
   - Pass 1: Initial generation (Venice)
   - Pass 2: Expansion (Venice)
   - Pass 3: Dialogue enhancement (Venice)
   - Pass 4: Polish (Venice or GPT-4)

5. **Monitor Quality:**
   - Track repetition warnings
   - Log provider metrics
   - A/B test against baselines
   - Gather user feedback

---

## Code Integration Checklist

- [ ] Create `server/services/prompts/venicePromptTemplates.js`
- [ ] Update `server/services/llmProviders.js` with provider selection logic
- [ ] Add `selectProviderForTask()` function to orchestrator
- [ ] Implement `generateSceneWithVenice()` function
- [ ] Add multi-pass enhancement pipeline (optional)
- [ ] Create provider usage metrics table
- [ ] Add fallback error handling
- [ ] Update config to include Venice API key
- [ ] Add provider selection UI (Configure page)
- [ ] Test with mature content scenarios
- [ ] Document prompt templates for future editing

---

*Last updated: 2025-12-25*
*Author: Claude Code*
