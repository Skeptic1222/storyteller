/**
 * veniceEnhancer.js
 *
 * Handles Venice-based expansion of placeholders in the scaffolding pipeline.
 * Supports both sequential and parallel expansion.
 *
 * Part of the Venice Scaffolding Architecture for explicit content quality.
 */

import { callLLM, PROVIDERS } from './llmProviders.js';
import { buildExpansionPrompt } from './prompts/scaffoldPromptTemplates.js';
import { parseScaffold, stitchExpandedContent, validateNoPlaceholders, getPlaceholderStats } from './scaffoldParser.js';

// Venice-optimized parameters for explicit content expansion
const VENICE_EXPANSION_PARAMS = {
  temperature: 0.75,        // Balanced: creative but coherent
  frequency_penalty: 0.6,   // Strong repetition reduction for longer content
  presence_penalty: 0.4,    // Encourage topic variety
  top_p: 0.90,              // Tighter sampling for quality
  max_tokens: 6000          // Increased for 4500+ word scenes
};

// Venice-optimized parameters for coherence pass (lower temperature)
const VENICE_COHERENCE_PARAMS = {
  temperature: 0.7,
  frequency_penalty: 0.3,
  presence_penalty: 0.2,
  top_p: 0.9,
  max_tokens: 4000
};

/**
 * Expand a single placeholder using Venice
 *
 * @param {Object} placeholder - Parsed placeholder object
 * @param {Object} storyContext - Story context (characters, plot, etc.)
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Expanded content
 */
export async function expandPlaceholder(placeholder, storyContext, authorStyle, options = {}) {
  const { logPrefix = '[VeniceEnhancer]' } = options;

  try {
    const prompt = buildExpansionPrompt(placeholder, storyContext, authorStyle);

    console.log(`${logPrefix} Expanding ${placeholder.type} placeholder (intensity: ${placeholder.params.intensity}%)`);

    const response = await callLLM('llama-3.3-70b', prompt, {
      forceProvider: PROVIDERS.VENICE,
      ...VENICE_EXPANSION_PARAMS,
      // Allow higher tokens for scene-level placeholders
      max_tokens: isSceneLevelPlaceholder(placeholder.type) ? 2500 : 1000
    });

    if (!response || typeof response !== 'string') {
      throw new Error('Venice returned empty or invalid response');
    }

    console.log(`${logPrefix} Expanded ${placeholder.type}: ${response.substring(0, 100)}...`);

    return response.trim();

  } catch (error) {
    console.error(`${logPrefix} Error expanding placeholder ${placeholder.type}:`, error.message);

    // Return a fallback that maintains narrative flow
    return generateFallbackExpansion(placeholder);
  }
}

/**
 * Expand all placeholders sequentially
 * Use when Venice rate limits are a concern or for debugging
 *
 * @param {Array} placeholders - Array of parsed placeholders
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<Array<string>>} Array of expanded content
 */
export async function expandAllSequential(placeholders, storyContext, authorStyle, options = {}) {
  const { logPrefix = '[VeniceEnhancer]', onProgress } = options;

  console.log(`${logPrefix} Expanding ${placeholders.length} placeholders sequentially`);

  const expansions = [];

  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];

    const expansion = await expandPlaceholder(placeholder, storyContext, authorStyle, options);
    expansions.push(expansion);

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: placeholders.length,
        type: placeholder.type,
        success: !!expansion
      });
    }

    // Small delay between requests to be kind to Venice API
    if (i < placeholders.length - 1) {
      await delay(200);
    }
  }

  return expansions;
}

/**
 * Expand all placeholders in parallel using Promise.all
 * Faster but may hit rate limits with many placeholders
 *
 * @param {Array} placeholders - Array of parsed placeholders
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<Array<string>>} Array of expanded content
 */
export async function expandAllParallel(placeholders, storyContext, authorStyle, options = {}) {
  const { logPrefix = '[VeniceEnhancer]', maxConcurrent = 3 } = options;

  console.log(`${logPrefix} Expanding ${placeholders.length} placeholders in parallel (max ${maxConcurrent} concurrent)`);

  // Use chunked parallel execution to avoid overwhelming Venice
  const chunks = chunkArray(placeholders, maxConcurrent);
  const allExpansions = [];

  for (const chunk of chunks) {
    const chunkExpansions = await Promise.all(
      chunk.map(p => expandPlaceholder(p, storyContext, authorStyle, options))
    );
    allExpansions.push(...chunkExpansions);

    // OPTIMIZATION: Reduced delay between chunks (was 300ms, now 100ms)
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await delay(100);
    }
  }

  return allExpansions;
}

/**
 * Run coherence pass on stitched content to smooth transitions
 *
 * @param {string} content - Stitched content
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Polished content
 */
export async function runCoherencePass(content, authorStyle, options = {}) {
  const { logPrefix = '[VeniceEnhancer]' } = options;

  console.log(`${logPrefix} Running coherence pass on ${content.length} characters`);

  const prompt = `You are a skilled editor reviewing a story written in ${authorStyle?.name || 'a distinctive'} style.

=== YOUR TASK ===
Review and polish this scene to ensure:
1. Smooth transitions between all sections (no jarring shifts)
2. No repetitive phrases or sentence structures
3. Consistent voice and tone throughout
4. Natural pacing and flow
5. Character voices remain consistent

=== AUTHOR STYLE ===
${authorStyle?.algorithm || 'Vivid, engaging prose with emotional depth.'}
Tone: ${authorStyle?.style?.tone || 'immersive'}
Language: ${authorStyle?.style?.language || 'literary but accessible'}

=== RULES ===
- Do NOT censor or tone down explicit content
- Do NOT add content warnings or disclaimers
- Do NOT change the intensity level of mature content
- DO fix awkward transitions
- DO eliminate repetition
- DO ensure consistent voice

=== SCENE TO POLISH ===
${content}

=== OUTPUT ===
Return the polished scene. No explanations or meta-commentary.`;

  try {
    const response = await callLLM('llama-3.3-70b', prompt, {
      forceProvider: PROVIDERS.VENICE,
      ...VENICE_COHERENCE_PARAMS
    });

    if (!response || typeof response !== 'string') {
      console.warn(`${logPrefix} Coherence pass returned empty response, using original`);
      return content;
    }

    console.log(`${logPrefix} Coherence pass complete`);
    return response.trim();

  } catch (error) {
    console.error(`${logPrefix} Coherence pass failed:`, error.message);
    return content; // Return original if coherence pass fails
  }
}

/**
 * Complete scaffolding pipeline: parse -> expand -> stitch -> (optional) coherence
 *
 * @param {string} scaffoldContent - OpenAI-generated scaffold with placeholders
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Pipeline options
 * @returns {Promise<Object>} Pipeline result with final content and stats
 */
export async function runScaffoldingPipeline(scaffoldContent, storyContext, authorStyle, options = {}) {
  const {
    logPrefix = '[ScaffoldPipeline]',
    parallel = true,
    coherencePass = true,
    maxConcurrent = 3,
    onProgress
  } = options;

  const startTime = Date.now();
  console.log(`${logPrefix} Starting scaffolding pipeline`);

  // Phase 1: Parse scaffold
  const { originalContent, placeholders, hasPlaceholders } = parseScaffold(scaffoldContent);

  if (!hasPlaceholders) {
    console.log(`${logPrefix} No placeholders found, returning original content`);
    return {
      content: originalContent,
      stats: { placeholdersExpanded: 0, coherencePassApplied: false },
      duration: Date.now() - startTime
    };
  }

  const stats = getPlaceholderStats(placeholders);
  console.log(`${logPrefix} Found ${stats.total} placeholders:`, stats.byType);

  if (onProgress) {
    onProgress({ phase: 'parsing', placeholders: stats.total });
  }

  // Phase 2: Expand placeholders
  let expansions;
  if (parallel && placeholders.length > 1) {
    expansions = await expandAllParallel(placeholders, storyContext, authorStyle, {
      logPrefix,
      maxConcurrent
    });
  } else {
    expansions = await expandAllSequential(placeholders, storyContext, authorStyle, {
      logPrefix,
      onProgress: onProgress ? (p) => onProgress({ phase: 'expanding', ...p }) : undefined
    });
  }

  if (onProgress) {
    onProgress({ phase: 'stitching' });
  }

  // Phase 3: Stitch content
  let finalContent = stitchExpandedContent(originalContent, placeholders, expansions);

  // Validate no placeholders remain
  const validation = validateNoPlaceholders(finalContent);
  if (!validation.isValid) {
    console.warn(`${logPrefix} ${validation.remainingPlaceholders.length} placeholders remain after stitching`);
  }

  // Phase 4: Optional coherence pass
  let coherenceApplied = false;
  if (coherencePass && stats.averageIntensity >= 70) {
    if (onProgress) {
      onProgress({ phase: 'coherence' });
    }

    finalContent = await runCoherencePass(finalContent, authorStyle, { logPrefix });
    coherenceApplied = true;
  }

  const duration = Date.now() - startTime;
  console.log(`${logPrefix} Pipeline complete in ${duration}ms`);

  return {
    content: finalContent,
    stats: {
      placeholdersExpanded: placeholders.length,
      byType: stats.byType,
      averageIntensity: stats.averageIntensity,
      coherencePassApplied: coherenceApplied,
      remainingPlaceholders: validation.remainingPlaceholders.length
    },
    duration
  };
}

// ============ Helper Functions ============

/**
 * Check if placeholder type is scene-level (multi-paragraph)
 */
function isSceneLevelPlaceholder(type) {
  const sceneLevelTypes = ['INTIMATE_SCENE', 'VIOLENT_CONFRONTATION', 'HORROR_MOMENT'];
  return sceneLevelTypes.includes(type);
}

/**
 * Generate fallback expansion when Venice fails
 */
function generateFallbackExpansion(placeholder) {
  const { type, params } = placeholder;

  // Minimal fallback that at least maintains narrative flow
  const fallbacks = {
    INTIMATE_SCENE: 'They came together in a moment of passion, the world falling away around them.',
    VIOLENT_CONFRONTATION: 'The confrontation was brutal and swift, leaving its mark on all involved.',
    HORROR_MOMENT: 'What they witnessed defied description, burning itself into their memory.',
    EXPLICIT_DESCRIPTION: 'the scene was vivid and unforgettable',
    PROFANE_DIALOGUE: '"Damn it all," they said.',
    SENSUAL_DETAIL: 'the touch lingered, electric and warm',
    GORE_DETAIL: 'the wound was severe',
    CRUDE_LANGUAGE: 'an unrepeatable phrase'
  };

  return fallbacks[type] || '[Content unavailable]';
}

/**
 * Split array into chunks
 */
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Promise-based delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  expandPlaceholder,
  expandAllSequential,
  expandAllParallel,
  runCoherencePass,
  runScaffoldingPipeline
};
