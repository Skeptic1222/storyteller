/**
 * Multi-Provider LLM Service
 * Handles routing between OpenAI, Venice.ai, and OpenRouter based on content requirements
 *
 * ROUTING STRATEGY:
 * - OpenAI: Default for all children/general content, utility agents, coherence agents
 * - Venice.ai: Mature/uncensored creative content (high gore/violence/romance)
 * - OpenRouter: Alternative models, fallback, task-specific routing
 *
 * INTELLIGENT ROUTING:
 * 1. Pre-generation: Analyze intensity sliders and audience to select provider
 * 2. Mid-generation: Detect moderation errors and reroute to Venice
 * 3. Post-generation: Obfuscate explicit content for coherence agents
 */

import { logger } from '../utils/logger.js';
import * as usageTracker from './usageTracker.js';
import OpenAI from 'openai';

// ============================================================================
// PROVIDER DEFINITIONS
// ============================================================================

export const PROVIDERS = {
  OPENAI: 'openai',
  VENICE: 'venice',
  OPENROUTER: 'openrouter'
};

// Provider configurations
const PROVIDER_CONFIG = {
  [PROVIDERS.OPENAI]: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'Default provider for safe content',
    models: {
      creative: 'gpt-5.1',
      coherence: 'gpt-5.1',
      utility: 'gpt-4o-mini'
    }
  },
  [PROVIDERS.VENICE]: {
    name: 'Venice.ai',
    baseUrl: 'https://api.venice.ai/api/v1',
    description: 'Uncensored provider for mature content',
    models: {
      creative: 'llama-3.3-70b',
      coherence: 'llama-3.3-70b',
      utility: 'llama-3.3-70b'
    }
  },
  [PROVIDERS.OPENROUTER]: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: 'Multi-model router for flexibility',
    models: {
      creative: 'anthropic/claude-3.5-sonnet',
      coherence: 'openai/gpt-4o',
      utility: 'openai/gpt-4o-mini'
    }
  }
};

// ============================================================================
// INTENSITY THRESHOLDS FOR PROVIDER ROUTING
// ============================================================================

/**
 * Gore intensity thresholds
 * 0-30: Mild (off-screen violence, implied consequences) -> OpenAI
 * 31-60: Moderate (described but not graphic) -> OpenAI
 * 61-100: Graphic (detailed, visceral) -> Venice (mature only)
 */
const GORE_THRESHOLDS = {
  MILD: 30,      // Under this: OpenAI safe
  MODERATE: 60,  // Under this: OpenAI with caution
  GRAPHIC: 100   // At or above 61: Venice required for mature
};

/**
 * Romance intensity thresholds
 * 0-30: Sweet/romantic -> OpenAI
 * 31-60: Steamy/sensual -> OpenAI with caution
 * 61-100: Explicit -> Venice (mature only)
 */
const ROMANCE_THRESHOLDS = {
  SWEET: 30,
  STEAMY: 60,
  EXPLICIT: 100
};

/**
 * Violence intensity thresholds
 */
const VIOLENCE_THRESHOLDS = {
  MILD: 30,
  MODERATE: 60,
  GRAPHIC: 100
};

export { GORE_THRESHOLDS, ROMANCE_THRESHOLDS, VIOLENCE_THRESHOLDS };

// ============================================================================
// P2 FIX: VENICE-SPECIFIC QUALITY PARAMETERS
// Optimized parameters for reducing repetition and improving creative output
// ============================================================================
const VENICE_PARAMS = {
  temperature: 0.85,          // Slightly higher for creativity
  frequency_penalty: 0.4,     // Reduce word/phrase repetition
  presence_penalty: 0.3,      // Encourage topic diversity
  top_p: 0.92                 // Nucleus sampling for quality
};

/**
 * P2 FIX: Detect repetition issues in generated text
 * @param {string} text - Generated text to analyze
 * @returns {Object} Repetition analysis with count, warnings, and severity
 */
export function detectRepetition(text) {
  if (!text || text.length < 100) {
    return { count: 0, warnings: [], severity: 'none' };
  }

  const warnings = [];
  let count = 0;

  // Check for repeated sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const sentenceSet = new Set();
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().trim();
    if (normalized.length > 20 && sentenceSet.has(normalized)) {
      count++;
      if (count === 1) {
        warnings.push(`Repeated sentence: "${normalized.substring(0, 50)}..."`);
      }
    }
    sentenceSet.add(normalized);
  }

  // Check for repeated phrases (3+ word sequences)
  const words = text.toLowerCase().split(/\s+/);
  const phraseMap = new Map();
  for (let i = 0; i < words.length - 3; i++) {
    const phrase = words.slice(i, i + 4).join(' ');
    if (phrase.length > 15) {
      const phraseCount = (phraseMap.get(phrase) || 0) + 1;
      phraseMap.set(phrase, phraseCount);
      if (phraseCount === 3) {
        count++;
        warnings.push(`Phrase repeated 3+ times: "${phrase}"`);
      }
    }
  }

  // Check for repeated paragraph openings
  const paragraphs = text.split(/\n\s*\n/);
  const openings = paragraphs.map(p => p.trim().substring(0, 30).toLowerCase());
  const openingSet = new Set();
  for (const opening of openings) {
    if (opening.length > 10 && openingSet.has(opening)) {
      count++;
      warnings.push(`Repeated paragraph opening: "${opening}..."`);
    }
    openingSet.add(opening);
  }

  // Determine severity
  let severity = 'none';
  if (count >= 5) severity = 'high';
  else if (count >= 3) severity = 'medium';
  else if (count >= 1) severity = 'low';

  return { count, warnings: warnings.slice(0, 5), severity };
}

// ============================================================================
// PROVIDER CLIENTS
// ============================================================================

// OpenAI client (initialized from environment)
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Call Venice.ai API
 * P2 FIX: Uses optimized parameters for better quality and reduced repetition
 */
async function callVenice(options) {
  const {
    messages,
    model = PROVIDER_CONFIG[PROVIDERS.VENICE].models.creative,
    temperature = VENICE_PARAMS.temperature,
    max_tokens = 2048,
    // P2 FIX: Allow override of Venice params but use optimized defaults
    frequency_penalty = VENICE_PARAMS.frequency_penalty,
    presence_penalty = VENICE_PARAMS.presence_penalty,
    top_p = VENICE_PARAMS.top_p
  } = options;

  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) {
    throw new Error('VENICE_API_KEY not configured');
  }

  const startTime = Date.now();

  try {
    // P2 FIX: Include quality parameters for Venice
    const response = await fetch(`${PROVIDER_CONFIG[PROVIDERS.VENICE].baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        frequency_penalty,  // P2 FIX: Reduce repetition
        presence_penalty,   // P2 FIX: Encourage diversity
        top_p,              // P2 FIX: Nucleus sampling
        stream: false
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Venice API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage || {};

    const duration = Date.now() - startTime;
    logger.info(`[Venice] Completed in ${duration}ms, tokens: ${usage.total_tokens || 'unknown'}`);

    return {
      content,
      usage: {
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0
      },
      provider: PROVIDERS.VENICE,
      model
    };
  } catch (error) {
    logger.error(`[Venice] API call failed: ${error.message}`);
    throw error;
  }
}

/**
 * Call OpenRouter API
 */
async function callOpenRouter(options) {
  const {
    messages,
    model = PROVIDER_CONFIG[PROVIDERS.OPENROUTER].models.creative,
    temperature = 0.8,
    max_tokens = 2048
  } = options;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const startTime = Date.now();

  try {
    const response = await fetch(`${PROVIDER_CONFIG[PROVIDERS.OPENROUTER].baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Storyteller',
        'HTTP-Referer': 'https://ay-i-t.com/storyteller'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage || {};

    const duration = Date.now() - startTime;
    logger.info(`[OpenRouter] Completed in ${duration}ms, model: ${model}, tokens: ${usage.total_tokens || 'unknown'}`);

    return {
      content,
      usage: {
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0
      },
      provider: PROVIDERS.OPENROUTER,
      model
    };
  } catch (error) {
    logger.error(`[OpenRouter] API call failed: ${error.message}`);
    throw error;
  }
}

/**
 * Call OpenAI API (wrapper around existing client)
 */
async function callOpenAI(options) {
  const {
    messages,
    model = 'gpt-4o',
    temperature = 0.7,
    max_tokens = 1000,
    response_format,
    agent_name = 'unknown'
  } = options;

  const startTime = Date.now();

  try {
    // Newer models require max_completion_tokens
    const usesNewTokenParam = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('gpt-5');

    // GPT-5 model temperature restrictions (December 2025):
    // - gpt-5-mini, gpt-5-nano: temperature NOT supported (only default 1)
    // - gpt-5.2: temperature supported only with reasoning.effort="none" (default)
    // - gpt-5.2-pro: temperature NOT supported
    // See: https://platform.openai.com/docs/guides/gpt-5.2
    const isGpt5MiniOrNano = model === 'gpt-5-mini' || model === 'gpt-5-nano';
    const isGpt5Pro = model === 'gpt-5.2-pro';
    const skipTemperature = isGpt5MiniOrNano || isGpt5Pro || model.startsWith('o1') || model.startsWith('o3');

    const requestParams = {
      model,
      messages
    };

    // Only add temperature for models that support it
    if (!skipTemperature) {
      requestParams.temperature = temperature;
    } else {
      logger.debug(`[OpenAI] ${agent_name}: Skipping temperature param for ${model} (not supported)`);
    }

    if (usesNewTokenParam) {
      requestParams.max_completion_tokens = max_tokens;
    } else {
      requestParams.max_tokens = max_tokens;
    }

    // Add response_format for compatible models
    if (response_format && !model.startsWith('gpt-5') && !model.startsWith('o1') && !model.startsWith('o3')) {
      requestParams.response_format = response_format;
    }

    const response = await openaiClient.chat.completions.create(requestParams);
    const message = response.choices[0]?.message;

    // Check for refusal
    if (message?.refusal) {
      const error = new Error(`OpenAI content policy violation: ${message.refusal}`);
      error.isContentPolicy = true;
      error.refusal = message.refusal;
      throw error;
    }

    const content = message?.content ?? '';
    const usage = response.usage || {};

    const duration = Date.now() - startTime;
    logger.info(`[OpenAI] ${agent_name}: Completed in ${duration}ms, model: ${model}, tokens: ${usage.total_tokens || 'unknown'}`);

    return {
      content,
      usage: {
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
        totalTokens: usage.total_tokens || 0
      },
      provider: PROVIDERS.OPENAI,
      model
    };
  } catch (error) {
    // Check if this is a content policy error
    if (error.status === 400 || error.message?.includes('content_policy') ||
        error.message?.includes('safety') || error.code === 'content_policy_violation') {
      error.isContentPolicy = true;
    }
    logger.error(`[OpenAI] ${agent_name}: API call failed: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// CONTENT ANALYSIS AND ROUTING
// ============================================================================

/**
 * Analyze content settings to determine if mature provider is needed
 * @param {Object} settings - Content settings with intensity sliders and audience
 * @returns {Object} Analysis result with provider recommendation
 */
export function analyzeContentRequirements(settings) {
  const {
    audience = 'general',
    intensity = {}
  } = settings;

  const gore = intensity.gore || 0;
  const violence = intensity.violence || 0;
  const romance = intensity.romance || 0;
  const scary = intensity.scary || 0;
  const adultContent = intensity.adultContent || 0;
  const sensuality = intensity.sensuality || 0;
  const explicitness = intensity.explicitness || 0;

  // Children or general audience always use OpenAI
  if (audience !== 'mature') {
    return {
      provider: PROVIDERS.OPENAI,
      reason: 'Non-mature audience uses safe provider',
      requiresVenice: false,
      intensity: { gore, violence, romance, scary, adultContent, sensuality, explicitness }
    };
  }

  // Check if any intensity exceeds Venice threshold
  // Using >= for consistency: 60+ gore, 50+ adultContent triggers Venice for explicit content
  // FIXED: Changed from > to >= so that boundary values (60 gore, 50 adult) actually trigger Venice
  const requiresVenice =
    gore >= GORE_THRESHOLDS.MODERATE ||
    violence >= VIOLENCE_THRESHOLDS.MODERATE ||
    romance >= ROMANCE_THRESHOLDS.STEAMY ||
    adultContent >= 50 ||
    explicitness >= 70 ||
    sensuality >= 70;

  // Estimate provider split for this configuration
  let venicePercentage = 0;
  if (requiresVenice) {
    // Estimate based on how much content likely needs Venice
    // High explicitness or adultContent > 70 = very explicit, needs Venice for most scenes
    if (gore > 80 || violence > 80 || romance > 80 || adultContent > 70 || explicitness > 80) {
      venicePercentage = 40; // Very intense - many scenes need Venice
    } else if (gore > 60 || violence > 60 || romance > 60 || adultContent > 50 || explicitness > 70 || sensuality > 70) {
      venicePercentage = 25; // Intense - some scenes need Venice
    } else {
      venicePercentage = 10; // Moderate - few scenes need Venice
    }
  }

  return {
    provider: requiresVenice ? PROVIDERS.VENICE : PROVIDERS.OPENAI,
    reason: requiresVenice
      ? `Mature content with high intensity (gore:${gore}, violence:${violence}, romance:${romance}, adultContent:${adultContent}, sensuality:${sensuality}, explicitness:${explicitness})`
      : 'Mature audience with moderate intensity - OpenAI can handle',
    requiresVenice,
    venicePercentage,
    intensity: { gore, violence, romance, scary, adultContent, sensuality, explicitness }
  };
}

/**
 * Select provider for a specific agent task
 * @param {string} agentCategory - 'creative', 'coherence', or 'utility'
 * @param {Object} settings - Content settings
 * @param {string} sceneType - Optional scene type for scene-level routing
 */
export function selectProvider(agentCategory, settings, sceneType = null) {
  // Utility agents always use OpenAI (fast/cheap, works with summaries)
  if (agentCategory === 'utility') {
    return {
      provider: PROVIDERS.OPENAI,
      model: 'gpt-4o-mini',
      reason: 'Utility agents always use OpenAI for speed/cost'
    };
  }

  // Coherence agents use OpenAI but receive obfuscated content if mature
  if (agentCategory === 'coherence') {
    return {
      provider: PROVIDERS.OPENAI,
      model: 'gpt-4o',
      reason: 'Coherence agents use OpenAI with obfuscated summaries',
      needsObfuscation: settings?.audience === 'mature' &&
        (settings?.intensity?.gore > 60 || settings?.intensity?.romance > 60)
    };
  }

  // Creative agents: analyze content requirements
  const analysis = analyzeContentRequirements(settings);

  // Scene-specific routing for creative tasks
  if (sceneType && settings?.audience === 'mature') {
    const isIntenseScene = ['romance', 'combat', 'horror'].includes(sceneType);
    if (isIntenseScene && analysis.requiresVenice) {
      return {
        provider: PROVIDERS.VENICE,
        model: 'llama-3.3-70b',
        reason: `Intense ${sceneType} scene requires uncensored provider`,
        sceneType
      };
    }
  }

  return {
    provider: analysis.provider,
    model: analysis.provider === PROVIDERS.VENICE ? 'llama-3.3-70b' : 'gpt-5.1',
    reason: analysis.reason,
    venicePercentage: analysis.venicePercentage
  };
}

// ============================================================================
// CONTENT OBFUSCATION FOR COHERENCE AGENTS
// ============================================================================

// Explicit terms to obfuscate when sending to OpenAI coherence/utility agents
const EXPLICIT_TERMS = [
  // Violence/gore
  { pattern: /\b(blood|gore|guts|entrails|viscera|dismember|decapitat|eviscerat)\w*/gi, replacement: '[violence]' },
  { pattern: /\b(mutilat|maim|disembowel|impale)\w*/gi, replacement: '[harm]' },

  // Sexual content
  { pattern: /\b(sex|fuck|cock|dick|pussy|cunt|tit|breast|nipple|orgasm|climax|thrust|penetrat)\w*/gi, replacement: '[intimate]' },
  { pattern: /\b(moan|groan|gasp|pant|writhe)\w*\s*(with|in)?\s*(pleasure|ecstasy|passion)?/gi, replacement: '[reaction]' },

  // Keep context clues but remove explicit detail
  { pattern: /they made (passionate )?love/gi, replacement: 'they were intimate' },
  { pattern: /their bodies (intertwined|joined|merged)/gi, replacement: 'they embraced' }
];

/**
 * Obfuscate explicit content for sending to OpenAI
 * @param {string} text - Original explicit text
 * @returns {string} Obfuscated text safe for OpenAI
 */
export function obfuscateContent(text) {
  if (!text) return text;

  let result = text;
  for (const { pattern, replacement } of EXPLICIT_TERMS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Generate a safe summary of explicit content for coherence agents
 * Uses Venice to summarize its own explicit output
 * @param {string} explicitContent - Explicit content from Venice
 * @param {string} sessionId - Session ID for tracking
 */
export async function generateSafeSummary(explicitContent, sessionId = null) {
  try {
    const result = await callVenice({
      messages: [
        {
          role: 'system',
          content: `You are a story summarizer. Create a brief, non-explicit summary of this scene that captures:
1. Key plot developments
2. Character emotional outcomes
3. Relationship changes
4. Story consequences

Do NOT include explicit details. Focus on narrative significance.
Keep the summary to 2-4 sentences.`
        },
        {
          role: 'user',
          content: explicitContent
        }
      ],
      model: 'llama-3.3-70b',
      temperature: 0.3,
      max_tokens: 300
    });

    logger.info(`[SafeSummary] Generated safe summary for coherence agents`);
    return result.content;
  } catch (error) {
    logger.error(`[SafeSummary] Failed to generate summary: ${error.message}`);
    // Fallback to obfuscation
    return obfuscateContent(explicitContent);
  }
}

// ============================================================================
// PHASE 5.3: BIDIRECTIONAL FALLBACK - DETECT SELF-CENSORING
// ============================================================================

/**
 * Analyze content explicitness to detect self-censoring
 * Returns a score from 0 (completely tame) to 1 (highly explicit)
 * Used to detect when OpenAI self-censors mature content
 */
export function analyzeExplicitness(content, expectedTypes = []) {
  if (!content || content.length < 100) {
    return { score: 0.5, indicators: [], isSelfCensored: false };
  }

  const text = content.toLowerCase();
  const indicators = [];
  let score = 0;

  // Sexual content indicators (for romance/erotica)
  const sexualIndicators = [
    { pattern: /\b(moan|groan|gasp|pant)\w*/g, weight: 0.1, type: 'sex' },
    { pattern: /\b(thrust|penetrat|orgasm|climax)\w*/g, weight: 0.2, type: 'sex' },
    { pattern: /\b(cock|dick|pussy|cunt|breast|nipple)\w*/g, weight: 0.25, type: 'sex' },
    { pattern: /\b(naked|nude|undress|strip)\w*/g, weight: 0.1, type: 'sex' },
    { pattern: /\b(kiss|embrace|caress|stroke)\w*/g, weight: 0.05, type: 'sex' },
    { pattern: /their bodies (intertwined|joined|pressed)/g, weight: 0.15, type: 'sex' }
  ];

  // Violence/gore indicators
  const violenceIndicators = [
    { pattern: /\b(blood|bleeding|bloody)\w*/g, weight: 0.1, type: 'violence' },
    { pattern: /\b(stab|slash|cut|wound)\w*/g, weight: 0.15, type: 'violence' },
    { pattern: /\b(dismember|decapitat|eviscerat|disembowel)\w*/g, weight: 0.25, type: 'gore' },
    { pattern: /\b(scream|agony|pain|suffer)\w*/g, weight: 0.1, type: 'violence' },
    { pattern: /\b(kill|murder|death|die|dead)\w*/g, weight: 0.1, type: 'violence' }
  ];

  // Self-censoring phrases (indicates model refused to generate explicit)
  const censoringIndicators = [
    { pattern: /the scene fades? to black/g, weight: -0.3, type: 'censored' },
    { pattern: /we'll leave the details/g, weight: -0.3, type: 'censored' },
    { pattern: /let's just say/g, weight: -0.2, type: 'censored' },
    { pattern: /intimate moment[s]? between them/g, weight: -0.2, type: 'censored' },
    { pattern: /lost in each other/g, weight: -0.1, type: 'censored' },
    { pattern: /what happened next .* imagination/g, weight: -0.3, type: 'censored' },
    { pattern: /I (?:can't|cannot|won't) (?:write|generate|create)/g, weight: -0.5, type: 'censored' },
    { pattern: /I'm not able to/g, weight: -0.4, type: 'censored' }
  ];

  const allIndicators = [...sexualIndicators, ...violenceIndicators, ...censoringIndicators];

  for (const { pattern, weight, type } of allIndicators) {
    const matches = text.match(pattern);
    if (matches) {
      const matchCount = Math.min(matches.length, 5); // Cap at 5 to avoid over-scoring
      score += weight * matchCount;
      indicators.push({ type, matches: matches.slice(0, 3), contribution: weight * matchCount });
    }
  }

  // Normalize score to 0-1 range
  score = Math.max(0, Math.min(1, score + 0.3)); // 0.3 baseline

  // Determine if self-censored based on expected content types
  let isSelfCensored = false;
  if (expectedTypes.includes('sex') && score < 0.3) {
    isSelfCensored = true;
  } else if (expectedTypes.includes('gore') && score < 0.25) {
    isSelfCensored = true;
  } else if (expectedTypes.includes('violence') && score < 0.2) {
    isSelfCensored = true;
  }

  // Check for explicit censoring phrases
  const hasCensoringPhrases = indicators.some(i => i.type === 'censored');
  if (hasCensoringPhrases) {
    isSelfCensored = true;
  }

  return {
    score,
    indicators,
    isSelfCensored,
    expectedTypes,
    censoringPhrases: indicators.filter(i => i.type === 'censored')
  };
}

/**
 * Determine expected content types from settings
 */
function getExpectedContentTypes(contentSettings) {
  const types = [];
  const intensity = contentSettings?.intensity || {};

  if (intensity.adultContent >= 50 || intensity.romance >= 60) {
    types.push('sex');
  }
  if (intensity.gore >= 60) {
    types.push('gore');
  }
  if (intensity.violence >= 60) {
    types.push('violence');
  }

  return types;
}

// ============================================================================
// UNIFIED LLM CALL WITH INTELLIGENT ROUTING
// ============================================================================

/**
 * Main LLM call function with intelligent provider routing
 * PHASE 5.3: Enhanced with bidirectional fallback (detects self-censoring)
 * @param {Object} options - Call options
 * @returns {Object} Result with content and metadata
 */
export async function callLLM(options) {
  const {
    messages,
    model,
    temperature = 0.7,
    max_tokens = 1000,
    response_format,
    agent_name = 'unknown',
    agent_category = 'utility',
    sessionId = null,
    contentSettings = {},
    sceneType = null,
    forceProvider = null  // Override provider selection
  } = options;

  // Determine provider
  let providerSelection;
  if (forceProvider) {
    providerSelection = {
      provider: forceProvider,
      model: model || PROVIDER_CONFIG[forceProvider].models[agent_category],
      reason: 'Forced provider override'
    };
  } else {
    providerSelection = selectProvider(agent_category, contentSettings, sceneType);
  }

  const { provider, reason, needsObfuscation } = providerSelection;

  // CRITICAL: If Venice is selected, use a Venice-compatible model, not the passed OpenAI model
  let selectedModel;
  if (provider === PROVIDERS.VENICE) {
    // Venice only supports its own models - ignore any OpenAI model names
    const isOpenAIModel = model && (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3'));
    selectedModel = isOpenAIModel ? PROVIDER_CONFIG[PROVIDERS.VENICE].models[agent_category] : (model || providerSelection.model);
  } else {
    selectedModel = model || providerSelection.model;
  }

  logger.info(`[LLM] ${agent_name}: Using ${provider} (${selectedModel}) - ${reason}`);

  // Track which provider is being used
  if (sessionId) {
    // Will be tracked in usage tracker
  }

  try {
    let result;

    switch (provider) {
      case PROVIDERS.VENICE:
        result = await callVenice({
          messages,
          model: selectedModel,
          temperature,
          max_tokens
        });
        break;

      case PROVIDERS.OPENROUTER:
        result = await callOpenRouter({
          messages,
          model: selectedModel,
          temperature,
          max_tokens
        });
        break;

      case PROVIDERS.OPENAI:
      default:
        result = await callOpenAI({
          messages,
          model: selectedModel,
          temperature,
          max_tokens,
          response_format,
          agent_name
        });
        break;
    }

    // Track usage
    if (sessionId) {
      trackProviderUsage(sessionId, result.provider, result.usage, result.model);
    }

    // PHASE 5.3: Bidirectional fallback - detect self-censoring
    // If OpenAI was used for mature content, check if it self-censored
    if (provider === PROVIDERS.OPENAI &&
        contentSettings?.audience === 'mature' &&
        agent_category === 'creative') {

      const expectedTypes = getExpectedContentTypes(contentSettings);

      if (expectedTypes.length > 0) {
        const explicitnessAnalysis = analyzeExplicitness(result.content, expectedTypes);

        if (explicitnessAnalysis.isSelfCensored) {
          logger.warn(`[LLM] ${agent_name}: OpenAI self-censored mature content (score: ${explicitnessAnalysis.score.toFixed(2)}), retrying with Venice`);
          logger.debug(`[LLM] Censoring indicators:`, explicitnessAnalysis.censoringPhrases);

          try {
            const veniceResult = await callVenice({
              messages,
              model: 'llama-3.3-70b',
              temperature: Math.min(temperature + 0.1, 1.0), // Slightly higher temp for creativity
              max_tokens
            });

            if (sessionId) {
              trackProviderUsage(sessionId, PROVIDERS.VENICE, veniceResult.usage, 'llama-3.3-70b');
            }

            return {
              ...veniceResult,
              agent_name,
              selectedProvider: PROVIDERS.VENICE,
              selectionReason: 'Bidirectional fallback: OpenAI self-censored',
              wasSelfCensorFallback: true,
              originalProvider: PROVIDERS.OPENAI,
              selfCensorAnalysis: explicitnessAnalysis
            };
          } catch (veniceError) {
            logger.error(`[LLM] ${agent_name}: Venice fallback for self-censor failed: ${veniceError.message}`);
            // Return original OpenAI result if Venice fails
            logger.warn(`[LLM] ${agent_name}: Using original OpenAI result despite self-censoring`);
          }
        }
      }
    }

    return {
      ...result,
      agent_name,
      selectedProvider: provider,
      selectionReason: reason
    };

  } catch (error) {
    // Handle OpenAI content policy errors by rerouting to Venice
    if (error.isContentPolicy && provider === PROVIDERS.OPENAI && contentSettings?.audience === 'mature') {
      logger.warn(`[LLM] ${agent_name}: OpenAI content policy triggered, rerouting to Venice`);

      try {
        const veniceResult = await callVenice({
          messages,
          model: 'llama-3.3-70b',
          temperature,
          max_tokens
        });

        if (sessionId) {
          trackProviderUsage(sessionId, PROVIDERS.VENICE, veniceResult.usage, 'llama-3.3-70b');
        }

        return {
          ...veniceResult,
          agent_name,
          selectedProvider: PROVIDERS.VENICE,
          selectionReason: 'Rerouted from OpenAI due to content policy',
          wasRerouted: true,
          originalError: error.message
        };
      } catch (veniceError) {
        logger.error(`[LLM] ${agent_name}: Venice fallback failed: ${veniceError.message}`);

        // Try OpenRouter as final fallback (Claude 3.5 Sonnet for creative content)
        if (isProviderAvailable(PROVIDERS.OPENROUTER)) {
          logger.warn(`[LLM] ${agent_name}: Trying OpenRouter as final fallback`);
          try {
            const openRouterResult = await callOpenRouter({
              messages,
              model: 'anthropic/claude-3.5-sonnet',
              temperature,
              max_tokens
            });

            if (sessionId) {
              trackProviderUsage(sessionId, PROVIDERS.OPENROUTER, openRouterResult.usage, 'anthropic/claude-3.5-sonnet');
            }

            return {
              ...openRouterResult,
              agent_name,
              selectedProvider: PROVIDERS.OPENROUTER,
              selectionReason: 'Fallback from Venice to OpenRouter',
              wasRerouted: true,
              originalError: veniceError.message
            };
          } catch (openRouterError) {
            logger.error(`[LLM] ${agent_name}: All providers failed. OpenRouter error: ${openRouterError.message}`);
            throw openRouterError;
          }
        }

        throw veniceError;
      }
    }

    throw error;
  }
}

// ============================================================================
// USAGE TRACKING
// ============================================================================

// Provider pricing (per 1K tokens)
const PROVIDER_PRICING = {
  [PROVIDERS.OPENAI]: {
    'gpt-5.1': { input: 0.00125, output: 0.01 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 }
  },
  [PROVIDERS.VENICE]: {
    'llama-3.3-70b': { input: 0.001, output: 0.002 }  // Estimated
  },
  [PROVIDERS.OPENROUTER]: {
    'anthropic/claude-3.5-sonnet': { input: 0.003, output: 0.015 },
    'openai/gpt-4o': { input: 0.0025, output: 0.01 }
  }
};

/**
 * Track provider usage for a session
 */
function trackProviderUsage(sessionId, provider, usage, model) {
  // This integrates with the existing usageTracker
  logger.debug(`[LLM Usage] Session ${sessionId}: ${provider} - ${usage.totalTokens} tokens`);

  switch (provider) {
    case PROVIDERS.OPENAI:
      usageTracker.trackOpenAIUsage(
        sessionId,
        model || 'gpt-4o',
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedTokens || 0
      );
      break;

    case PROVIDERS.VENICE:
      usageTracker.trackVeniceUsage(
        sessionId,
        model || 'llama-3.3-70b',
        usage.inputTokens,
        usage.outputTokens
      );
      break;

    case PROVIDERS.OPENROUTER:
      usageTracker.trackOpenRouterUsage(
        sessionId,
        model || 'anthropic/claude-3.5-sonnet',
        usage.inputTokens,
        usage.outputTokens
      );
      break;

    default:
      logger.warn(`[LLM Usage] Unknown provider: ${provider}`);
  }
}

// ============================================================================
// PROVIDER HEALTH AND STATUS
// ============================================================================

/**
 * Check if a provider is available and configured
 */
export function isProviderAvailable(provider) {
  switch (provider) {
    case PROVIDERS.OPENAI:
      return !!process.env.OPENAI_API_KEY;
    case PROVIDERS.VENICE:
      return !!process.env.VENICE_API_KEY;
    case PROVIDERS.OPENROUTER:
      return !!process.env.OPENROUTER_API_KEY;
    default:
      return false;
  }
}

/**
 * Get status of all providers
 */
export function getProviderStatus() {
  return {
    openai: {
      available: isProviderAvailable(PROVIDERS.OPENAI),
      name: PROVIDER_CONFIG[PROVIDERS.OPENAI].name,
      description: PROVIDER_CONFIG[PROVIDERS.OPENAI].description
    },
    venice: {
      available: isProviderAvailable(PROVIDERS.VENICE),
      name: PROVIDER_CONFIG[PROVIDERS.VENICE].name,
      description: PROVIDER_CONFIG[PROVIDERS.VENICE].description
    },
    openrouter: {
      available: isProviderAvailable(PROVIDERS.OPENROUTER),
      name: PROVIDER_CONFIG[PROVIDERS.OPENROUTER].name,
      description: PROVIDER_CONFIG[PROVIDERS.OPENROUTER].description
    }
  };
}

/**
 * Get provider recommendations based on content settings
 */
export function getProviderRecommendation(contentSettings) {
  const analysis = analyzeContentRequirements(contentSettings);

  return {
    recommended: analysis.provider,
    reason: analysis.reason,
    estimatedSplit: analysis.requiresVenice
      ? { openai: 100 - analysis.venicePercentage, venice: analysis.venicePercentage }
      : { openai: 100, venice: 0 },
    intensity: analysis.intensity,
    warnings: analysis.requiresVenice
      ? [`High intensity content (${Object.entries(analysis.intensity).filter(([k,v]) => v > 60).map(([k,v]) => `${k}:${v}`).join(', ')}) will use Venice.ai`]
      : []
  };
}

export default {
  PROVIDERS,
  GORE_THRESHOLDS,
  ROMANCE_THRESHOLDS,
  VIOLENCE_THRESHOLDS,
  VENICE_PARAMS,           // P2 FIX: Export Venice quality params
  callLLM,
  callVenice,
  callOpenRouter,
  callOpenAI,
  analyzeContentRequirements,
  selectProvider,
  obfuscateContent,
  generateSafeSummary,
  detectRepetition,        // P2 FIX: Export repetition detection
  analyzeExplicitness,     // PHASE 5.3: Self-censor detection
  isProviderAvailable,
  getProviderStatus,
  getProviderRecommendation
};
