/**
 * Model Selection Service
 * Centralized AI model selection based on quality tier and agent category
 *
 * POLICY: Quality > Cost
 * - Premium tier uses GPT-5.2 for creative/coherence agents (best quality)
 * - All tiers use GPT-5-mini/nano for utility agents (fast, cost-effective)
 *
 * This is a PREMIUM product. ElevenLabs TTS + images cost $0.50-$1.00+ per story,
 * so saving a few pennies on LLM tokens at the expense of narrative quality is unacceptable.
 *
 * GPT-5.2 Features (December 2025):
 * - Best general-purpose model, improved over GPT-5.1
 * - Reasoning effort: none, low, medium, high, xhigh
 * - Verbosity: low, medium, high
 * - Works with both Responses API and Chat Completions API
 * - See: https://platform.openai.com/docs/guides/gpt-5.2
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// MODEL DEFINITIONS
// ============================================================================

// Available models with their capabilities
export const MODELS = {
  // GPT-5 family (December 2025) - Latest flagship models
  GPT_5_2: 'gpt-5.2',                 // Best general-purpose, complex reasoning, agentic tasks
  GPT_5_2_PRO: 'gpt-5.2-pro',         // Tougher problems, more compute for harder thinking
  GPT_5_MINI: 'gpt-5-mini',           // Cost-optimized, balances speed/cost/capability
  GPT_5_NANO: 'gpt-5-nano',           // High-throughput, simple tasks, classification
  GPT_5_1_CODEX_MAX: 'gpt-5.1-codex-max', // Specialized for coding tasks

  // GPT-4 family (legacy fallback)
  GPT_4O: 'gpt-4o',                   // Previous best, still capable
  GPT_4O_MINI: 'gpt-4o-mini',         // Previous fast model
  GPT_4_1: 'gpt-4.1',                 // Intermediate model
  GPT_4_1_MINI: 'gpt-4.1-mini'        // Intermediate fast model
};

// Quality tiers
export const QUALITY_TIERS = {
  PREMIUM: 'premium',   // Best quality - GPT-5.2 for creative/coherence
  STANDARD: 'standard'  // Good quality - GPT-4.1 for creative, GPT-5-mini for utility
};

// ============================================================================
// AGENT CATEGORIES
// ============================================================================

/**
 * Agent category definitions
 *
 * CREATIVE: Agents that directly determine story quality
 *   - Story Planner, Scene Writer, D&D GM, CYOA Manager, Devil's Advocate, Author Style
 *   - Premium: gpt-5.2, Standard: gpt-4.1
 *
 * COHERENCE: Agents that maintain long-term consistency
 *   - Lore Keeper, Campaign Memory, Story Bible, Multi-voice agents
 *   - Premium: gpt-5.2, Standard: gpt-4.1
 *
 * UTILITY: Support agents for classification, tagging, routing
 *   - Safety, SFX Tagger, Narrator Director, Orchestrator routing, Dialogue Parser
 *   - Premium: gpt-5-mini, Standard: gpt-5-nano
 */
export const AGENT_CATEGORIES = {
  CREATIVE: 'creative',
  COHERENCE: 'coherence',
  UTILITY: 'utility'
};

// Map each agent to its category
const AGENT_CATEGORY_MAP = {
  // Creative agents - directly impact story quality
  'planner': AGENT_CATEGORIES.CREATIVE,
  'story_planner': AGENT_CATEGORIES.CREATIVE,
  'writer': AGENT_CATEGORIES.CREATIVE,
  'scene_writer': AGENT_CATEGORIES.CREATIVE,
  'game_master': AGENT_CATEGORIES.CREATIVE,
  'gm': AGENT_CATEGORIES.CREATIVE,
  'cyoa': AGENT_CATEGORIES.CREATIVE,
  'cyoa_manager': AGENT_CATEGORIES.CREATIVE,
  'advocate': AGENT_CATEGORIES.CREATIVE,
  'devils_advocate': AGENT_CATEGORIES.CREATIVE,
  'author_style': AGENT_CATEGORIES.CREATIVE,
  'sequel_generator': AGENT_CATEGORIES.CREATIVE,  // Story continuation ideas

  // Coherence agents - maintain consistency AND require precise reasoning
  'lore': AGENT_CATEGORIES.COHERENCE,
  'lore_keeper': AGENT_CATEGORIES.COHERENCE,
  'campaign_memory': AGENT_CATEGORIES.COHERENCE,
  'story_bible': AGENT_CATEGORIES.COHERENCE,
  'world_state': AGENT_CATEGORIES.COHERENCE,

  // Multi-voice agents - CRITICAL for accuracy, upgraded to COHERENCE tier
  // These agents previously had issues with speech tags and segment attribution
  'speech_tag_filter': AGENT_CATEGORIES.COHERENCE,      // Must precisely identify speech tags
  'speaker_validation': AGENT_CATEGORIES.COHERENCE,     // Must correctly attribute speakers
  'voice_assignment': AGENT_CATEGORIES.COHERENCE,       // Must match voices to characters
  'dialogue_segment': AGENT_CATEGORIES.COHERENCE,       // Must correctly segment text
  'emotion_validator': AGENT_CATEGORIES.COHERENCE,      // Must detect dialogue emotions

  // Utility agents - support/classification (fast operations)
  'orchestrator': AGENT_CATEGORIES.UTILITY,
  'narrator': AGENT_CATEGORIES.UTILITY,
  'narrator_director': AGENT_CATEGORIES.UTILITY,
  'safety': AGENT_CATEGORIES.UTILITY,
  'safety_agent': AGENT_CATEGORIES.UTILITY,
  'sfx': AGENT_CATEGORIES.UTILITY,
  'sfx_coordinator': AGENT_CATEGORIES.UTILITY,
  'dialogue_parser': AGENT_CATEGORIES.UTILITY,
  'context_summarizer': AGENT_CATEGORIES.UTILITY,
  'fact_extractor': AGENT_CATEGORIES.UTILITY,
  'story_validator': AGENT_CATEGORIES.UTILITY,
  'config_interpreter': AGENT_CATEGORIES.UTILITY,
  'conversation_router': AGENT_CATEGORIES.UTILITY,
  'cover_validator': AGENT_CATEGORIES.UTILITY,
  'gender_validator': AGENT_CATEGORIES.UTILITY,
  'style_validator': AGENT_CATEGORIES.UTILITY,       // Author style scoring (structured JSON output)
  'unknown': AGENT_CATEGORIES.UTILITY  // Default fallback
};

// ============================================================================
// TIER CONFIGURATION
// ============================================================================

// Model selection by category and tier
// NOTE (2025-12-13): Upgraded to GPT-5.2 for premium quality.
// GPT-5.2 is OpenAI's best general-purpose model with improved reasoning.
// GPT-5-mini/nano used for utility tasks (fast, cost-effective).
// See: https://platform.openai.com/docs/guides/gpt-5.2
const TIER_MODEL_MAP = {
  [QUALITY_TIERS.PREMIUM]: {
    // GPT-5.2 for creative (best quality for story generation)
    [AGENT_CATEGORIES.CREATIVE]: MODELS.GPT_5_2,
    // GPT-5.2 for coherence (consistency requires quality reasoning)
    [AGENT_CATEGORIES.COHERENCE]: MODELS.GPT_5_2,
    // GPT-5-mini for utility (balanced speed/cost/capability)
    [AGENT_CATEGORIES.UTILITY]: MODELS.GPT_5_MINI
  },
  [QUALITY_TIERS.STANDARD]: {
    // GPT-4.1 for creative (very capable, lower cost than 5.2)
    [AGENT_CATEGORIES.CREATIVE]: MODELS.GPT_4_1,
    // GPT-4.1 for coherence
    [AGENT_CATEGORIES.COHERENCE]: MODELS.GPT_4_1,
    // GPT-5-nano for utility (high-throughput, simple tasks)
    [AGENT_CATEGORIES.UTILITY]: MODELS.GPT_5_NANO
  }
};

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Get current quality tier from environment
 * Default: premium (we're building a premium product)
 */
export function getQualityTier() {
  const tier = (process.env.AI_QUALITY_TIER || 'premium').toLowerCase();
  if (tier === 'standard' || tier === 'premium') {
    return tier;
  }
  logger.warn(`[ModelSelection] Invalid AI_QUALITY_TIER "${tier}", defaulting to premium`);
  return QUALITY_TIERS.PREMIUM;
}

/**
 * Get agent category
 */
export function getAgentCategory(agentName) {
  const normalized = agentName.toLowerCase().replace(/[-\s]/g, '_');
  return AGENT_CATEGORY_MAP[normalized] || AGENT_CATEGORIES.UTILITY;
}

// ============================================================================
// MAIN API
// ============================================================================

// Agents that should NEVER use reasoning models (gpt-5.x family)
// These do simple text transformation where reasoning tokens would be wasted
// GPT-5-mini uses ALL tokens for reasoning, leaving 0 for content output
const NON_REASONING_AGENTS = new Set([
  'narrator',           // Text polishing - simple transformation
  'narrator_director',  // Voice direction - classification
  'fact_extractor',     // Extract facts - structured output
  'safety',             // Safety check - classification
  'safety_agent',       // Safety check alias
  'sfx',                // SFX tagging - classification
  'sfx_coordinator',    // SFX coordination - classification
  'dialogue_parser'     // Dialogue parsing - structured output
]);

/**
 * Get the appropriate model for an agent based on current tier
 *
 * @param {string} agentName - Name of the agent (e.g., 'planner', 'writer', 'safety')
 * @param {string} tierOverride - Optional tier override ('premium' or 'standard')
 * @returns {string} Model ID to use
 *
 * @example
 * getModelForAgent('planner')           // 'gpt-5.2' in premium, 'gpt-4.1' in standard
 * getModelForAgent('safety')            // 'gpt-4o-mini' (non-reasoning agent)
 * getModelForAgent('writer', 'standard') // 'gpt-4.1' (forced standard)
 */
export function getModelForAgent(agentName, tierOverride = null) {
  // Check for per-agent environment override first
  const envOverride = getAgentEnvOverride(agentName);
  if (envOverride) {
    logger.debug(`[ModelSelection] Using env override for ${agentName}: ${envOverride}`);
    return envOverride;
  }

  // CRITICAL: Some agents must NOT use reasoning models (gpt-5.x family)
  // GPT-5-mini uses ALL tokens for reasoning, leaving 0 for content output
  // These simple tasks work better with gpt-4o-mini
  const normalized = agentName.toLowerCase().replace(/[-\s]/g, '_');
  if (NON_REASONING_AGENTS.has(normalized)) {
    logger.debug(`[ModelSelection] Agent "${agentName}" using gpt-4o-mini (non-reasoning agent)`);
    return MODELS.GPT_4O_MINI;
  }

  // Get tier and category
  const tier = tierOverride || getQualityTier();
  const category = getAgentCategory(agentName);

  // Get model from tier map
  const model = TIER_MODEL_MAP[tier]?.[category] || MODELS.GPT_4O_MINI;

  logger.debug(`[ModelSelection] Agent "${agentName}" -> category "${category}" -> tier "${tier}" -> model "${model}"`);

  return model;
}

/**
 * Check for per-agent environment override
 * Format: AGENT_{AGENT_NAME}_MODEL=model-id
 *
 * @example
 * AGENT_PLANNER_MODEL=gpt-4o  // Force planner to use gpt-4o
 */
function getAgentEnvOverride(agentName) {
  const normalized = agentName.toUpperCase().replace(/[-\s]/g, '_');
  const envVar = `AGENT_${normalized}_MODEL`;
  return process.env[envVar] || null;
}

/**
 * Get model for creative work (convenience function)
 * Uses current tier setting
 */
export function getCreativeModel(tierOverride = null) {
  const tier = tierOverride || getQualityTier();
  return TIER_MODEL_MAP[tier][AGENT_CATEGORIES.CREATIVE];
}

/**
 * Get model for utility work (convenience function)
 * Always returns gpt-4o-mini
 */
export function getUtilityModel() {
  return MODELS.GPT_4O_MINI;
}

/**
 * Get model for coherence work (convenience function)
 * Uses current tier setting
 */
export function getCoherenceModel(tierOverride = null) {
  const tier = tierOverride || getQualityTier();
  return TIER_MODEL_MAP[tier][AGENT_CATEGORIES.COHERENCE];
}

// ============================================================================
// COST ESTIMATION
// ============================================================================

// Pricing per 1K tokens (as of December 2025)
// Note: Prices are estimates - check OpenAI pricing page for current rates
const MODEL_PRICING = {
  // GPT-5 family
  [MODELS.GPT_5_2]: {
    input: 0.003,     // $3.00 per 1M tokens (estimate)
    output: 0.012,    // $12.00 per 1M tokens (estimate)
    cached: 0.0015    // 50% discount
  },
  [MODELS.GPT_5_2_PRO]: {
    input: 0.006,     // $6.00 per 1M tokens (estimate)
    output: 0.024,    // $24.00 per 1M tokens (estimate)
    cached: 0.003     // 50% discount
  },
  [MODELS.GPT_5_MINI]: {
    input: 0.0004,    // $0.40 per 1M tokens (estimate)
    output: 0.0016,   // $1.60 per 1M tokens (estimate)
    cached: 0.0002    // 50% discount
  },
  [MODELS.GPT_5_NANO]: {
    input: 0.0001,    // $0.10 per 1M tokens (estimate)
    output: 0.0004,   // $0.40 per 1M tokens (estimate)
    cached: 0.00005   // 50% discount
  },
  // GPT-4 family (legacy)
  [MODELS.GPT_4O]: {
    input: 0.0025,    // $2.50 per 1M tokens
    output: 0.01,     // $10 per 1M tokens
    cached: 0.00125   // 50% discount
  },
  [MODELS.GPT_4_1]: {
    input: 0.002,     // $2.00 per 1M tokens
    output: 0.008,    // $8.00 per 1M tokens
    cached: 0.001     // 50% discount
  },
  [MODELS.GPT_4_1_MINI]: {
    input: 0.0004,    // $0.40 per 1M tokens
    output: 0.0016,   // $1.60 per 1M tokens
    cached: 0.0002    // 50% discount
  }
};

/**
 * Estimate cost for a model call
 *
 * @param {string} model - Model ID
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @param {number} cachedTokens - Cached input token count
 * @returns {number} Estimated cost in dollars
 */
export function estimateCost(model, inputTokens, outputTokens, cachedTokens = 0) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[MODELS.GPT_4O_MINI];

  const uncachedInput = inputTokens - cachedTokens;
  const inputCost = (uncachedInput / 1000) * pricing.input;
  const cachedCost = (cachedTokens / 1000) * pricing.cached;
  const outputCost = (outputTokens / 1000) * pricing.output;

  return inputCost + cachedCost + outputCost;
}

/**
 * Compare cost between tiers for a typical story
 *
 * Typical story breakdown (rough estimates):
 * - Planner: 500 input, 1500 output
 * - Writer (x8 scenes): 800 input, 800 output per scene
 * - CYOA (x4 choices): 600 input, 400 output per choice
 * - Lore (x8 checks): 400 input, 200 output per check
 * - Safety (x8 checks): 400 input, 200 output per check
 * - Other utility: ~2000 input, ~1000 output total
 */
export function compareTierCosts() {
  const storyProfile = {
    creative: { input: 500 + (800*8) + (600*4), output: 1500 + (800*8) + (400*4) }, // ~11100 in, ~10500 out
    coherence: { input: 400*8, output: 200*8 },  // ~3200 in, ~1600 out
    utility: { input: 400*8 + 2000, output: 200*8 + 1000 }  // ~5200 in, ~2600 out
  };

  const premiumCost =
    estimateCost(MODELS.GPT_5_2, storyProfile.creative.input, storyProfile.creative.output) +
    estimateCost(MODELS.GPT_5_2, storyProfile.coherence.input, storyProfile.coherence.output) +
    estimateCost(MODELS.GPT_5_MINI, storyProfile.utility.input, storyProfile.utility.output);

  const standardCost =
    estimateCost(MODELS.GPT_4_1, storyProfile.creative.input, storyProfile.creative.output) +
    estimateCost(MODELS.GPT_4_1, storyProfile.coherence.input, storyProfile.coherence.output) +
    estimateCost(MODELS.GPT_5_NANO, storyProfile.utility.input, storyProfile.utility.output);

  return {
    premium: {
      tier: 'premium',
      estimatedLLMCost: premiumCost.toFixed(4),
      creativeModel: MODELS.GPT_5_2,
      coherenceModel: MODELS.GPT_5_2,
      utilityModel: MODELS.GPT_5_MINI,
      note: 'Best narrative quality with GPT-5.2 flagship model'
    },
    standard: {
      tier: 'standard',
      estimatedLLMCost: standardCost.toFixed(4),
      creativeModel: MODELS.GPT_4_1,
      coherenceModel: MODELS.GPT_4_1,
      utilityModel: MODELS.GPT_5_NANO,
      note: 'Good quality with GPT-4.1, lower cost'
    },
    savings: (premiumCost - standardCost).toFixed(4),
    context: 'ElevenLabs TTS typically costs $0.50-$1.00+ per story, making LLM cost a minor factor'
  };
}

// ============================================================================
// LOGGING AND DEBUGGING
// ============================================================================

/**
 * Log current model configuration
 */
export function logConfiguration() {
  const tier = getQualityTier();
  const config = {
    tier,
    creative: TIER_MODEL_MAP[tier][AGENT_CATEGORIES.CREATIVE],
    coherence: TIER_MODEL_MAP[tier][AGENT_CATEGORIES.COHERENCE],
    utility: TIER_MODEL_MAP[tier][AGENT_CATEGORIES.UTILITY]
  };

  logger.info('[ModelSelection] Current configuration:', config);
  return config;
}

/**
 * Get full model configuration for debugging/admin
 */
export function getFullConfiguration() {
  const tier = getQualityTier();
  const costComparison = compareTierCosts();

  return {
    currentTier: tier,
    availableTiers: Object.values(QUALITY_TIERS),
    models: MODELS,
    agentCategories: AGENT_CATEGORIES,
    agentCategoryMap: AGENT_CATEGORY_MAP,
    tierModelMap: TIER_MODEL_MAP,
    pricing: MODEL_PRICING,
    costComparison,
    environmentOverrides: {
      AI_QUALITY_TIER: process.env.AI_QUALITY_TIER || 'premium (default)',
      // List any agent-specific overrides
      ...Object.keys(process.env)
        .filter(k => k.startsWith('AGENT_') && k.endsWith('_MODEL'))
        .reduce((acc, k) => ({ ...acc, [k]: process.env[k] }), {})
    }
  };
}

export default {
  MODELS,
  QUALITY_TIERS,
  AGENT_CATEGORIES,
  getQualityTier,
  getAgentCategory,
  getModelForAgent,
  getCreativeModel,
  getUtilityModel,
  getCoherenceModel,
  estimateCost,
  compareTierCosts,
  logConfiguration,
  getFullConfiguration
};
