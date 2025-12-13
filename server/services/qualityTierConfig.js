/**
 * Quality Tier Configuration Service
 *
 * Manages quality tiers for TTS generation with cost controls
 * and session-based tier selection.
 *
 * Tiers:
 * - premium: Best quality, eleven_multilingual_v2, full style support
 * - standard: Good balance, eleven_turbo_v2_5, fast with style
 * - economy: Cost-effective, eleven_turbo_v2_5, reduced settings
 * - fast: Preview/draft, eleven_flash_v2_5, minimal latency
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { ELEVENLABS_MODELS, QUALITY_TIER_MODELS, TIER_DEFAULT_SETTINGS, estimateTTSCost } from './elevenlabs.js';

// Session tier cache
const sessionTierCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Cost limits per tier (characters per story)
const TIER_LIMITS = {
  premium: {
    maxCharsPerStory: 50000,  // ~$15 per story max
    maxCharsPerScene: 5000,   // ~$1.50 per scene
    maxSegmentsPerScene: 20,
    warningThreshold: 0.8     // Warn at 80% usage
  },
  standard: {
    maxCharsPerStory: 100000, // ~$15 per story max (0.5x cost)
    maxCharsPerScene: 8000,
    maxSegmentsPerScene: 30,
    warningThreshold: 0.8
  },
  economy: {
    maxCharsPerStory: 150000, // ~$22 per story max
    maxCharsPerScene: 10000,
    maxSegmentsPerScene: 40,
    warningThreshold: 0.9
  },
  fast: {
    maxCharsPerStory: 200000, // Highest volume allowed
    maxCharsPerScene: 15000,
    maxSegmentsPerScene: 50,
    warningThreshold: 0.95
  }
};

// Usage tracking per session
const usageTracking = new Map();

/**
 * Get quality tier configuration
 * @param {string} tier - Tier name
 * @returns {Object} Tier configuration
 */
export function getTierConfig(tier = 'standard') {
  const validTier = QUALITY_TIER_MODELS[tier] ? tier : 'standard';
  const modelId = QUALITY_TIER_MODELS[validTier];
  const modelConfig = ELEVENLABS_MODELS[modelId];
  const settings = TIER_DEFAULT_SETTINGS[validTier];
  const limits = TIER_LIMITS[validTier];

  return {
    tier: validTier,
    model: modelId,
    modelConfig,
    settings,
    limits,
    costMultiplier: modelConfig.cost_multiplier
  };
}

/**
 * Get all tier configurations
 * @returns {Object} All tier configs
 */
export function getAllTierConfigs() {
  const configs = {};

  for (const tier of Object.keys(QUALITY_TIER_MODELS)) {
    configs[tier] = getTierConfig(tier);
  }

  return configs;
}

/**
 * Set quality tier for a session
 * @param {string} sessionId - Story session ID
 * @param {string} tier - Quality tier
 */
export async function setSessionTier(sessionId, tier) {
  const config = getTierConfig(tier);

  // Update cache
  sessionTierCache.set(sessionId, {
    tier: config.tier,
    timestamp: Date.now()
  });

  // Update database
  try {
    await pool.query(`
      UPDATE story_sessions
      SET config_json = jsonb_set(
        COALESCE(config_json, '{}'),
        '{quality_tier}',
        $2::jsonb
      )
      WHERE id = $1
    `, [sessionId, JSON.stringify(config.tier)]);

    logger.info(`[QualityTier] Set session ${sessionId} to tier: ${config.tier}`);
  } catch (error) {
    logger.error('[QualityTier] Failed to set session tier:', error);
  }

  return config;
}

/**
 * Get quality tier for a session
 * @param {string} sessionId - Story session ID
 * @returns {Promise<Object>} Tier configuration
 */
export async function getSessionTier(sessionId) {
  // Check cache
  const cached = sessionTierCache.get(sessionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return getTierConfig(cached.tier);
  }

  // Check database
  try {
    const result = await pool.query(`
      SELECT config_json->>'quality_tier' as tier
      FROM story_sessions
      WHERE id = $1
    `, [sessionId]);

    if (result.rows.length > 0 && result.rows[0].tier) {
      const tier = result.rows[0].tier;
      sessionTierCache.set(sessionId, { tier, timestamp: Date.now() });
      return getTierConfig(tier);
    }
  } catch (error) {
    logger.error('[QualityTier] Failed to get session tier:', error);
  }

  // Default to standard
  return getTierConfig('standard');
}

/**
 * Track TTS usage for a session
 * @param {string} sessionId - Story session ID
 * @param {number} characters - Characters generated
 * @param {string} tier - Quality tier used
 */
export function trackUsage(sessionId, characters, tier = 'standard') {
  if (!usageTracking.has(sessionId)) {
    usageTracking.set(sessionId, {
      totalChars: 0,
      sceneChars: 0,
      segments: 0,
      tier,
      startTime: Date.now()
    });
  }

  const usage = usageTracking.get(sessionId);
  usage.totalChars += characters;
  usage.sceneChars += characters;
  usage.segments += 1;

  return usage;
}

/**
 * Reset scene usage counter (called after scene completion)
 */
export function resetSceneUsage(sessionId) {
  const usage = usageTracking.get(sessionId);
  if (usage) {
    usage.sceneChars = 0;
    usage.segments = 0;
  }
}

/**
 * Check if session can generate more TTS
 * @param {string} sessionId - Story session ID
 * @param {number} plannedChars - Characters to be generated
 * @returns {Object} { allowed: boolean, reason?: string, warning?: string }
 */
export async function checkUsageLimits(sessionId, plannedChars = 0) {
  const tierConfig = await getSessionTier(sessionId);
  const limits = tierConfig.limits;
  const usage = usageTracking.get(sessionId) || { totalChars: 0, sceneChars: 0, segments: 0 };

  // Check story limit
  const projectedTotal = usage.totalChars + plannedChars;
  if (projectedTotal > limits.maxCharsPerStory) {
    return {
      allowed: false,
      reason: `Story character limit exceeded (${projectedTotal}/${limits.maxCharsPerStory})`,
      usage,
      limits
    };
  }

  // Check scene limit
  const projectedScene = usage.sceneChars + plannedChars;
  if (projectedScene > limits.maxCharsPerScene) {
    return {
      allowed: false,
      reason: `Scene character limit exceeded (${projectedScene}/${limits.maxCharsPerScene})`,
      usage,
      limits
    };
  }

  // Check segment limit
  if (usage.segments >= limits.maxSegmentsPerScene) {
    return {
      allowed: false,
      reason: `Scene segment limit exceeded (${usage.segments}/${limits.maxSegmentsPerScene})`,
      usage,
      limits
    };
  }

  // Generate warning if approaching limit
  const usageRatio = projectedTotal / limits.maxCharsPerStory;
  let warning = null;
  if (usageRatio >= limits.warningThreshold) {
    const percentUsed = Math.round(usageRatio * 100);
    warning = `Approaching TTS limit: ${percentUsed}% used (${projectedTotal}/${limits.maxCharsPerStory} chars)`;
  }

  return {
    allowed: true,
    warning,
    usage,
    limits,
    remaining: {
      story: limits.maxCharsPerStory - usage.totalChars,
      scene: limits.maxCharsPerScene - usage.sceneChars,
      segments: limits.maxSegmentsPerScene - usage.segments
    }
  };
}

/**
 * Estimate cost for planned TTS generation
 * @param {Array} segments - Planned segments
 * @param {string} tier - Quality tier
 * @returns {Object} Cost estimate
 */
export function estimateCost(segments, tier = 'standard') {
  const tierConfig = getTierConfig(tier);
  let totalChars = 0;

  for (const segment of segments) {
    if (segment.text) {
      totalChars += segment.text.length;
    }
  }

  const cost = estimateTTSCost('x'.repeat(totalChars), tier);

  return {
    segments: segments.length,
    characters: totalChars,
    estimatedCost: cost.costUsd,
    credits: cost.credits,
    tier,
    model: tierConfig.model
  };
}

/**
 * Get usage statistics for a session
 * @param {string} sessionId - Story session ID
 * @returns {Object} Usage stats
 */
export async function getUsageStats(sessionId) {
  const tierConfig = await getSessionTier(sessionId);
  const usage = usageTracking.get(sessionId) || { totalChars: 0, sceneChars: 0, segments: 0, startTime: Date.now() };
  const limits = tierConfig.limits;

  const cost = estimateTTSCost('x'.repeat(usage.totalChars), tierConfig.tier);

  return {
    tier: tierConfig.tier,
    model: tierConfig.model,
    usage: {
      totalChars: usage.totalChars,
      sceneChars: usage.sceneChars,
      segments: usage.segments,
      duration: Date.now() - usage.startTime
    },
    limits: {
      maxCharsPerStory: limits.maxCharsPerStory,
      maxCharsPerScene: limits.maxCharsPerScene,
      maxSegmentsPerScene: limits.maxSegmentsPerScene
    },
    remaining: {
      storyChars: limits.maxCharsPerStory - usage.totalChars,
      sceneChars: limits.maxCharsPerScene - usage.sceneChars,
      segments: limits.maxSegmentsPerScene - usage.segments
    },
    percentUsed: {
      story: Math.round((usage.totalChars / limits.maxCharsPerStory) * 100),
      scene: Math.round((usage.sceneChars / limits.maxCharsPerScene) * 100)
    },
    estimatedCost: cost.costUsd,
    credits: cost.credits
  };
}

/**
 * Recommend tier based on story parameters
 * @param {Object} storyConfig - Story configuration
 * @returns {Object} Recommended tier with reasoning
 */
export function recommendTier(storyConfig = {}) {
  const {
    expectedScenes = 10,
    averageSceneLength = 500,
    multiVoice = true,
    hasAmbientSFX = false,
    prioritizeQuality = false,
    budgetSensitive = false
  } = storyConfig;

  // Estimate total characters
  const estimatedChars = expectedScenes * averageSceneLength * (multiVoice ? 1.2 : 1);

  // Decision matrix
  if (prioritizeQuality && !budgetSensitive) {
    return {
      tier: 'premium',
      reason: 'Quality prioritized, budget not a concern',
      estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'premium').costUsd
    };
  }

  if (budgetSensitive) {
    if (estimatedChars > 100000) {
      return {
        tier: 'fast',
        reason: 'Large story with budget constraints',
        estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'fast').costUsd
      };
    }
    return {
      tier: 'economy',
      reason: 'Budget-sensitive, moderate story length',
      estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'economy').costUsd
    };
  }

  // Default recommendation based on story size
  if (estimatedChars < 30000) {
    return {
      tier: 'premium',
      reason: 'Short story, premium quality recommended',
      estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'premium').costUsd
    };
  }

  if (estimatedChars < 80000) {
    return {
      tier: 'standard',
      reason: 'Medium story, standard quality is optimal',
      estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'standard').costUsd
    };
  }

  return {
    tier: 'economy',
    reason: 'Long story, economy tier recommended for cost control',
    estimatedCost: estimateTTSCost('x'.repeat(estimatedChars), 'economy').costUsd
  };
}

/**
 * Get tier comparison for UI display
 * @returns {Array} Tier comparison data
 */
export function getTierComparison() {
  return [
    {
      tier: 'premium',
      name: 'Premium',
      model: 'Multilingual v2',
      description: 'Best quality for final stories',
      features: ['Full style control', '29 languages', 'Best prosody'],
      costPer1000Chars: '$0.30',
      latency: 'Medium',
      recommended: 'Short stories, final output'
    },
    {
      tier: 'standard',
      name: 'Standard',
      model: 'Turbo v2.5',
      description: 'Great balance of quality and speed',
      features: ['Style support', '32 languages', 'Speed control'],
      costPer1000Chars: '$0.15',
      latency: 'Low',
      recommended: 'Most stories, good default'
    },
    {
      tier: 'economy',
      name: 'Economy',
      model: 'Turbo v2.5 (reduced)',
      description: 'Cost-effective for long stories',
      features: ['Basic settings', '32 languages', 'Lower quality'],
      costPer1000Chars: '$0.15',
      latency: 'Low',
      recommended: 'Long stories, budget-conscious'
    },
    {
      tier: 'fast',
      name: 'Fast',
      model: 'Flash v2.5',
      description: 'Ultra-fast for previews',
      features: ['Speed only', '32 languages', 'Minimal latency'],
      costPer1000Chars: '$0.075',
      latency: 'Very Low',
      recommended: 'Previews, drafts, testing'
    }
  ];
}

/**
 * Clear usage tracking for a session
 */
export function clearUsageTracking(sessionId) {
  usageTracking.delete(sessionId);
  sessionTierCache.delete(sessionId);
}

/**
 * Load tier configurations from database
 * @returns {Promise<Object>} Database tier configs
 */
export async function loadTierConfigsFromDB() {
  try {
    const result = await pool.query(`
      SELECT name, display_name, narrator_model, main_character_model,
             cost_multiplier, enable_crossfade, crossfade_ms
      FROM voice_quality_tiers
      WHERE is_active = true
      ORDER BY sort_order
    `);

    const configs = {};
    for (const row of result.rows) {
      configs[row.name] = {
        displayName: row.display_name,
        narratorModel: row.narrator_model,
        characterModel: row.main_character_model,
        costMultiplier: parseFloat(row.cost_multiplier),
        enableCrossfade: row.enable_crossfade,
        crossfadeMs: row.crossfade_ms
      };
    }

    return configs;
  } catch (error) {
    logger.warn('[QualityTier] Failed to load DB configs, using defaults:', error.message);
    return null;
  }
}

export default {
  getTierConfig,
  getAllTierConfigs,
  setSessionTier,
  getSessionTier,
  trackUsage,
  resetSceneUsage,
  checkUsageLimits,
  estimateCost,
  getUsageStats,
  recommendTier,
  getTierComparison,
  clearUsageTracking,
  loadTierConfigsFromDB,
  TIER_LIMITS
};
