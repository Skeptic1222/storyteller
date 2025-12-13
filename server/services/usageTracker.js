/**
 * Usage Tracker Service
 * Tracks token/character usage and calculates estimated costs for:
 * - ElevenLabs TTS (characters)
 * - OpenAI GPT models (tokens)
 * - OpenAI Whisper transcription (minutes)
 * - OpenAI Realtime API (sessions/tokens)
 *
 * Pricing as of December 2025:
 * - ElevenLabs: ~$0.20 per 1,000 characters (varies by plan)
 * - GPT-4: $0.01/1K input, $0.03/1K output
 * - GPT-4o-mini: $0.15/1M input ($0.00015/1K), $0.60/1M output ($0.0006/1K)
 * - Whisper: $0.006/minute
 * - Realtime API: Varies by model
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

// Pricing constants (per 1,000 tokens/characters unless otherwise noted)
const PRICING = {
  elevenlabs: {
    // Characters cost ~$0.20 per 1,000 (Creator plan average)
    perCharacter: 0.0002,
    // Credits are 1:1 with characters for Multilingual v2
    creditsPerCharacter: 1
  },
  openai: {
    // GPT-5.1 - Frontier reasoning model (Premium tier creative agents)
    'gpt-5.1': {
      input: 0.00125,   // per 1K tokens ($1.25/1M) - CHEAPER than GPT-4o input!
      output: 0.01,     // per 1K tokens ($10/1M) - same as GPT-4o output
      cached: 0.000625  // per 1K tokens (50% discount)
    },
    'gpt-4': {
      input: 0.01,  // per 1K tokens
      output: 0.03, // per 1K tokens
      cached: 0.005 // per 1K tokens (50% discount)
    },
    'gpt-4o': {
      input: 0.0025,  // per 1K tokens ($2.50/1M)
      output: 0.01,   // per 1K tokens ($10/1M)
      cached: 0.00125 // per 1K tokens
    },
    'gpt-4o-mini': {
      input: 0.00015,   // per 1K tokens ($0.15/1M)
      output: 0.0006,   // per 1K tokens ($0.60/1M)
      cached: 0.000075  // per 1K tokens
    },
    'gpt-4-turbo': {
      input: 0.01,
      output: 0.03,
      cached: 0.005
    },
    'gpt-3.5-turbo': {
      input: 0.0005,
      output: 0.0015,
      cached: 0.00025
    },
    whisper: {
      perMinute: 0.006 // $0.006/minute
    },
    realtime: {
      // GPT-4o Realtime: $5/1M input, $20/1M output audio tokens
      audioInput: 0.005,  // per 1K tokens
      audioOutput: 0.02,  // per 1K tokens
      textInput: 0.0025,  // per 1K tokens
      textOutput: 0.01    // per 1K tokens
    },
    'dall-e-3': {
      standard1024: 0.04,  // per image
      hd1024: 0.08,        // per image
      standard1792: 0.08,  // per image
      hd1792: 0.12         // per image
    }
  },
  // Fal AI pricing (estimated based on public rates)
  falai: {
    instantCharacter: 0.03,  // per image (instant-character model)
    minimax: 0.05,           // per image (minimax subject-reference)
    default: 0.04            // fallback rate
  },
  // Venice.ai pricing (uncensored content)
  venice: {
    'llama-3.3-70b': {
      input: 0.001,   // per 1K tokens (estimated)
      output: 0.002   // per 1K tokens (estimated)
    },
    'default': {
      input: 0.001,
      output: 0.002
    }
  },
  // OpenRouter pricing (varies by model)
  openrouter: {
    'anthropic/claude-3.5-sonnet': {
      input: 0.003,   // per 1K tokens
      output: 0.015   // per 1K tokens
    },
    'openai/gpt-4o': {
      input: 0.0025,
      output: 0.01
    },
    'openai/gpt-4o-mini': {
      input: 0.00015,
      output: 0.0006
    },
    'default': {
      input: 0.002,
      output: 0.008
    }
  }
};

// Session-level usage tracking (in-memory for current session)
const sessionUsage = new Map();

// Socket.io instances per session for real-time emission
const sessionIO = new Map();

// FAIL LOUD: Size limits for Maps to prevent memory exhaustion
const USAGE_MAP_LIMITS = {
  sessionUsage: { max: 500, warn: 400 },
  sessionIO: { max: 500, warn: 400 }
};

// TTL for usage data (2 hours - stories should complete within this time)
const USAGE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Check and enforce Map size limits
 * FAIL LOUD: Throws error if at capacity (prevents silent memory exhaustion)
 */
function enforceMapLimit(mapName) {
  const maps = { sessionUsage, sessionIO };
  const map = maps[mapName];
  const limits = USAGE_MAP_LIMITS[mapName];

  if (map.size >= limits.max) {
    const error = new Error(
      `CAPACITY EXCEEDED: ${mapName} Map is at capacity (${map.size}/${limits.max}). ` +
      `Request REJECTED to prevent memory exhaustion. Consider calling clearSessionUsage() for completed sessions.`
    );
    logger.error('='.repeat(80));
    logger.error(error.message);
    logger.error('='.repeat(80));
    throw error;
  }

  if (map.size >= limits.warn) {
    logger.warn(`WARNING: ${mapName} approaching capacity: ${map.size}/${limits.max}`);
  }
}

/**
 * Cleanup stale usage entries (older than TTL)
 * Called periodically to prevent memory leaks from abandoned sessions
 */
function cleanupStaleUsage() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [sessionId, usage] of sessionUsage.entries()) {
    const age = now - new Date(usage.startedAt).getTime();
    if (age > USAGE_TTL_MS) {
      // Save to database before cleanup (fire-and-forget)
      saveUsageToDatabase(sessionId).catch(err => {
        logger.warn(`[UsageTracker] Failed to save stale session ${sessionId}: ${err.message}`);
      });
      sessionUsage.delete(sessionId);
      sessionIO.delete(sessionId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.info(`[UsageTracker] Cleaned up ${cleanedCount} stale sessions (TTL: ${USAGE_TTL_MS / 60000} min)`);
  }

  // Log current Map sizes
  if (sessionUsage.size > 0 || sessionIO.size > 0) {
    logger.debug(`[UsageTracker] Active sessions: ${sessionUsage.size}, IO instances: ${sessionIO.size}`);
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupStaleUsage, 10 * 60 * 1000);

/**
 * Set the socket.io instance for a session
 */
export function setUsageTrackingIO(sessionId, io) {
  enforceMapLimit('sessionIO');
  sessionIO.set(sessionId, io);
  logger.info(`[UsageTracker] Socket.IO set for session ${sessionId}`);
}

/**
 * Build usage update payload for socket emission
 */
function buildUsageUpdatePayload(usage) {
  return {
    elevenlabs: {
      characters: usage.elevenlabs.characters,
      requests: usage.elevenlabs.requests,
      cost: usage.costs.elevenlabs
    },
    openai: {
      inputTokens: usage.openai.inputTokens,
      outputTokens: usage.openai.outputTokens,
      cachedTokens: usage.openai.cachedTokens,
      requests: usage.openai.requests,
      cost: usage.costs.openai,
      byModel: Object.fromEntries(
        Object.entries(usage.openai.models).map(([model, data]) => [
          model,
          { input: data.input, output: data.output, cached: data.cached, cost: calculateModelCost(model, data) }
        ])
      )
    },
    whisper: {
      minutes: usage.whisper.minutes,
      requests: usage.whisper.requests,
      cost: usage.costs.whisper
    },
    realtime: {
      audioInputTokens: usage.realtime.audioInputTokens,
      audioOutputTokens: usage.realtime.audioOutputTokens,
      textInputTokens: usage.realtime.textInputTokens,
      textOutputTokens: usage.realtime.textOutputTokens,
      cost: usage.costs.realtime
    },
    images: {
      count: usage.images.count,
      cost: usage.costs.images
    },
    falai: {
      count: usage.falai.count,
      model: usage.falai.model,
      cost: usage.costs.falai
    },
    venice: {
      inputTokens: usage.venice?.inputTokens || 0,
      outputTokens: usage.venice?.outputTokens || 0,
      requests: usage.venice?.requests || 0,
      cost: usage.costs.venice || 0,
      byModel: usage.venice?.models ? Object.fromEntries(
        Object.entries(usage.venice.models).map(([model, data]) => [
          model,
          { input: data.input, output: data.output, cost: calculateVeniceCost(model, data) }
        ])
      ) : {}
    },
    openrouter: {
      inputTokens: usage.openrouter?.inputTokens || 0,
      outputTokens: usage.openrouter?.outputTokens || 0,
      requests: usage.openrouter?.requests || 0,
      cost: usage.costs.openrouter || 0,
      byModel: usage.openrouter?.models ? Object.fromEntries(
        Object.entries(usage.openrouter.models).map(([model, data]) => [
          model,
          { input: data.input, output: data.output, cost: calculateOpenRouterCost(model, data) }
        ])
      ) : {}
    },
    total: {
      cost: usage.costs.total,
      formatted: `$${usage.costs.total.toFixed(4)}`
    },
    providerSplit: {
      openai: usage.openai?.requests || 0,
      venice: usage.venice?.requests || 0,
      openrouter: usage.openrouter?.requests || 0
    }
  };
}

/**
 * Calculate cost for Venice model usage
 */
function calculateVeniceCost(model, tokens) {
  const pricing = PRICING.venice[model] || PRICING.venice['default'];
  return (tokens.input / 1000) * pricing.input +
         (tokens.output / 1000) * pricing.output;
}

/**
 * Calculate cost for OpenRouter model usage
 */
function calculateOpenRouterCost(model, tokens) {
  const pricing = PRICING.openrouter[model] || PRICING.openrouter['default'];
  return (tokens.input / 1000) * pricing.input +
         (tokens.output / 1000) * pricing.output;
}

/**
 * Calculate cost for a specific model's usage
 */
function calculateModelCost(model, tokens) {
  const pricing = PRICING.openai[model] || PRICING.openai['gpt-4o-mini'];
  return (tokens.input / 1000) * pricing.input +
         (tokens.output / 1000) * pricing.output +
         (tokens.cached / 1000) * pricing.cached;
}

/**
 * Emit usage update to clients
 */
function emitUsageUpdate(sessionId, usage) {
  const io = sessionIO.get(sessionId);
  if (io) {
    const payload = buildUsageUpdatePayload(usage);
    io.to(sessionId).emit('usage-update', payload);
    logger.debug(`[UsageTracker] Emitted usage-update for session ${sessionId}`);
  }
}

/**
 * Initialize usage tracking for a session
 */
export function initSessionUsage(sessionId, io = null) {
  // FAIL LOUD: Check capacity before adding
  enforceMapLimit('sessionUsage');
  if (io) {
    enforceMapLimit('sessionIO');
    sessionIO.set(sessionId, io);
  }
  sessionUsage.set(sessionId, {
    sessionId,
    startedAt: new Date(),
    elevenlabs: {
      characters: 0,
      requests: 0,
      audioBytesGenerated: 0
    },
    openai: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      requests: 0,
      models: {}
    },
    whisper: {
      minutes: 0,
      requests: 0
    },
    realtime: {
      audioInputTokens: 0,
      audioOutputTokens: 0,
      textInputTokens: 0,
      textOutputTokens: 0,
      sessionMinutes: 0
    },
    images: {
      count: 0,
      type: 'standard1024'
    },
    falai: {
      count: 0,
      model: 'instant-character'
    },
    venice: {
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      models: {}
    },
    openrouter: {
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      models: {}
    },
    costs: {
      elevenlabs: 0,
      openai: 0,
      whisper: 0,
      realtime: 0,
      images: 0,
      falai: 0,
      venice: 0,
      openrouter: 0,
      total: 0
    }
  });

  logger.info(`[UsageTracker] Initialized usage tracking for session ${sessionId}`);
  return sessionUsage.get(sessionId);
}

/**
 * Get or initialize session usage
 */
export function getSessionUsage(sessionId) {
  if (!sessionUsage.has(sessionId)) {
    return initSessionUsage(sessionId);
  }
  return sessionUsage.get(sessionId);
}

/**
 * Track ElevenLabs TTS usage
 */
export function trackElevenLabsUsage(sessionId, text, audioBytesGenerated = 0) {
  const usage = getSessionUsage(sessionId);
  const characters = text.length;

  usage.elevenlabs.characters += characters;
  usage.elevenlabs.requests += 1;
  usage.elevenlabs.audioBytesGenerated += audioBytesGenerated;

  // Calculate cost
  usage.costs.elevenlabs = usage.elevenlabs.characters * PRICING.elevenlabs.perCharacter;
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] ElevenLabs: +${characters} chars, total: ${usage.elevenlabs.characters} chars, cost: $${usage.costs.elevenlabs.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track OpenAI API usage
 */
export function trackOpenAIUsage(sessionId, model, inputTokens, outputTokens, cachedTokens = 0) {
  const usage = getSessionUsage(sessionId);

  usage.openai.inputTokens += inputTokens;
  usage.openai.outputTokens += outputTokens;
  usage.openai.cachedTokens += cachedTokens;
  usage.openai.requests += 1;

  // Track by model
  if (!usage.openai.models[model]) {
    usage.openai.models[model] = { input: 0, output: 0, cached: 0, requests: 0 };
  }
  usage.openai.models[model].input += inputTokens;
  usage.openai.models[model].output += outputTokens;
  usage.openai.models[model].cached += cachedTokens;
  usage.openai.models[model].requests += 1;

  // Calculate cost
  usage.costs.openai = calculateOpenAICost(usage);
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] OpenAI ${model}: +${inputTokens}/${outputTokens} tokens, total: ${usage.openai.inputTokens}/${usage.openai.outputTokens}, cost: $${usage.costs.openai.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track Whisper transcription usage
 */
export function trackWhisperUsage(sessionId, durationSeconds) {
  const usage = getSessionUsage(sessionId);
  const minutes = durationSeconds / 60;

  usage.whisper.minutes += minutes;
  usage.whisper.requests += 1;

  // Calculate cost
  usage.costs.whisper = usage.whisper.minutes * PRICING.openai.whisper.perMinute;
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] Whisper: +${minutes.toFixed(2)} min, total: ${usage.whisper.minutes.toFixed(2)} min, cost: $${usage.costs.whisper.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track Realtime API usage
 */
export function trackRealtimeUsage(sessionId, audioInputTokens, audioOutputTokens, textInputTokens, textOutputTokens) {
  const usage = getSessionUsage(sessionId);

  usage.realtime.audioInputTokens += audioInputTokens;
  usage.realtime.audioOutputTokens += audioOutputTokens;
  usage.realtime.textInputTokens += textInputTokens;
  usage.realtime.textOutputTokens += textOutputTokens;

  // Calculate cost
  const rtPricing = PRICING.openai.realtime;
  usage.costs.realtime = (
    (usage.realtime.audioInputTokens / 1000) * rtPricing.audioInput +
    (usage.realtime.audioOutputTokens / 1000) * rtPricing.audioOutput +
    (usage.realtime.textInputTokens / 1000) * rtPricing.textInput +
    (usage.realtime.textOutputTokens / 1000) * rtPricing.textOutput
  );
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] Realtime: audio=${audioInputTokens}/${audioOutputTokens}, text=${textInputTokens}/${textOutputTokens}, cost: $${usage.costs.realtime.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track image generation usage
 */
export function trackImageUsage(sessionId, imageType = 'standard1024') {
  const usage = getSessionUsage(sessionId);

  usage.images.count += 1;
  usage.images.type = imageType;

  // Calculate cost
  usage.costs.images = usage.images.count * PRICING.openai['dall-e-3'][imageType];
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] DALL-E: +1 image (${imageType}), total: ${usage.images.count}, cost: $${usage.costs.images.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track Fal AI image generation usage
 */
export function trackFalAIUsage(sessionId, model = 'instant-character') {
  const usage = getSessionUsage(sessionId);

  usage.falai.count += 1;
  usage.falai.model = model;

  // Calculate cost based on model
  const modelKey = model.includes('minimax') ? 'minimax' :
                   model.includes('instant-character') ? 'instantCharacter' : 'default';
  usage.costs.falai = usage.falai.count * PRICING.falai[modelKey];
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] Fal AI: +1 image (${model}), total: ${usage.falai.count}, cost: $${usage.costs.falai.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track Venice.ai API usage (uncensored content provider)
 */
export function trackVeniceUsage(sessionId, model, inputTokens, outputTokens) {
  const usage = getSessionUsage(sessionId);

  usage.venice.inputTokens += inputTokens;
  usage.venice.outputTokens += outputTokens;
  usage.venice.requests += 1;

  // Track by model
  if (!usage.venice.models[model]) {
    usage.venice.models[model] = { input: 0, output: 0, requests: 0 };
  }
  usage.venice.models[model].input += inputTokens;
  usage.venice.models[model].output += outputTokens;
  usage.venice.models[model].requests += 1;

  // Calculate cost
  usage.costs.venice = calculateVeniceModelsCost(usage);
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] Venice ${model}: +${inputTokens}/${outputTokens} tokens, total: ${usage.venice.inputTokens}/${usage.venice.outputTokens}, cost: $${usage.costs.venice.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Track OpenRouter API usage (multi-model router)
 */
export function trackOpenRouterUsage(sessionId, model, inputTokens, outputTokens) {
  const usage = getSessionUsage(sessionId);

  usage.openrouter.inputTokens += inputTokens;
  usage.openrouter.outputTokens += outputTokens;
  usage.openrouter.requests += 1;

  // Track by model
  if (!usage.openrouter.models[model]) {
    usage.openrouter.models[model] = { input: 0, output: 0, requests: 0 };
  }
  usage.openrouter.models[model].input += inputTokens;
  usage.openrouter.models[model].output += outputTokens;
  usage.openrouter.models[model].requests += 1;

  // Calculate cost
  usage.costs.openrouter = calculateOpenRouterModelsCost(usage);
  usage.costs.total = calculateTotalCost(usage);

  logger.info(`[UsageTracker] OpenRouter ${model}: +${inputTokens}/${outputTokens} tokens, total: ${usage.openrouter.inputTokens}/${usage.openrouter.outputTokens}, cost: $${usage.costs.openrouter.toFixed(4)}`);

  // Emit real-time update
  emitUsageUpdate(sessionId, usage);

  return usage;
}

/**
 * Calculate Venice cost based on model usage
 */
function calculateVeniceModelsCost(usage) {
  let cost = 0;

  for (const [model, tokens] of Object.entries(usage.venice.models)) {
    const pricing = PRICING.venice[model] || PRICING.venice['default'];
    cost += (tokens.input / 1000) * pricing.input;
    cost += (tokens.output / 1000) * pricing.output;
  }

  return cost;
}

/**
 * Calculate OpenRouter cost based on model usage
 */
function calculateOpenRouterModelsCost(usage) {
  let cost = 0;

  for (const [model, tokens] of Object.entries(usage.openrouter.models)) {
    const pricing = PRICING.openrouter[model] || PRICING.openrouter['default'];
    cost += (tokens.input / 1000) * pricing.input;
    cost += (tokens.output / 1000) * pricing.output;
  }

  return cost;
}

/**
 * Calculate OpenAI cost based on model usage
 */
function calculateOpenAICost(usage) {
  let cost = 0;

  for (const [model, tokens] of Object.entries(usage.openai.models)) {
    const pricing = PRICING.openai[model] || PRICING.openai['gpt-4o-mini'];
    cost += (tokens.input / 1000) * pricing.input;
    cost += (tokens.output / 1000) * pricing.output;
    cost += (tokens.cached / 1000) * pricing.cached;
  }

  return cost;
}

/**
 * Calculate total cost across all services
 */
function calculateTotalCost(usage) {
  return (
    usage.costs.elevenlabs +
    usage.costs.openai +
    usage.costs.whisper +
    usage.costs.realtime +
    usage.costs.images +
    usage.costs.falai +
    (usage.costs.venice || 0) +
    (usage.costs.openrouter || 0)
  );
}

/**
 * Get usage summary for a session
 */
export function getUsageSummary(sessionId) {
  const usage = getSessionUsage(sessionId);

  return {
    sessionId: usage.sessionId,
    duration: Math.round((new Date() - usage.startedAt) / 1000 / 60), // minutes
    elevenlabs: {
      characters: usage.elevenlabs.characters,
      creditsUsed: usage.elevenlabs.characters, // 1:1 for Multilingual v2
      requests: usage.elevenlabs.requests,
      audioMB: (usage.elevenlabs.audioBytesGenerated / 1024 / 1024).toFixed(2),
      estimatedCost: `$${usage.costs.elevenlabs.toFixed(4)}`
    },
    openai: {
      totalTokens: usage.openai.inputTokens + usage.openai.outputTokens,
      inputTokens: usage.openai.inputTokens,
      outputTokens: usage.openai.outputTokens,
      cachedTokens: usage.openai.cachedTokens,
      requests: usage.openai.requests,
      byModel: usage.openai.models,
      estimatedCost: `$${usage.costs.openai.toFixed(4)}`
    },
    whisper: {
      minutes: usage.whisper.minutes.toFixed(2),
      requests: usage.whisper.requests,
      estimatedCost: `$${usage.costs.whisper.toFixed(4)}`
    },
    realtime: {
      audioInputTokens: usage.realtime.audioInputTokens,
      audioOutputTokens: usage.realtime.audioOutputTokens,
      textInputTokens: usage.realtime.textInputTokens,
      textOutputTokens: usage.realtime.textOutputTokens,
      estimatedCost: `$${usage.costs.realtime.toFixed(4)}`
    },
    images: {
      count: usage.images.count,
      type: usage.images.type,
      estimatedCost: `$${usage.costs.images.toFixed(4)}`
    },
    falai: {
      count: usage.falai.count,
      model: usage.falai.model,
      estimatedCost: `$${usage.costs.falai.toFixed(4)}`
    },
    venice: {
      totalTokens: (usage.venice?.inputTokens || 0) + (usage.venice?.outputTokens || 0),
      inputTokens: usage.venice?.inputTokens || 0,
      outputTokens: usage.venice?.outputTokens || 0,
      requests: usage.venice?.requests || 0,
      byModel: usage.venice?.models || {},
      estimatedCost: `$${(usage.costs.venice || 0).toFixed(4)}`
    },
    openrouter: {
      totalTokens: (usage.openrouter?.inputTokens || 0) + (usage.openrouter?.outputTokens || 0),
      inputTokens: usage.openrouter?.inputTokens || 0,
      outputTokens: usage.openrouter?.outputTokens || 0,
      requests: usage.openrouter?.requests || 0,
      byModel: usage.openrouter?.models || {},
      estimatedCost: `$${(usage.costs.openrouter || 0).toFixed(4)}`
    },
    totalCost: {
      amount: usage.costs.total,
      formatted: `$${usage.costs.total.toFixed(4)}`,
      breakdown: {
        elevenlabs: usage.costs.elevenlabs,
        openai: usage.costs.openai,
        whisper: usage.costs.whisper,
        realtime: usage.costs.realtime,
        images: usage.costs.images,
        falai: usage.costs.falai,
        venice: usage.costs.venice || 0,
        openrouter: usage.costs.openrouter || 0
      }
    },
    providerSplit: {
      openai: usage.openai?.requests || 0,
      venice: usage.venice?.requests || 0,
      openrouter: usage.openrouter?.requests || 0
    }
  };
}

/**
 * Save usage to database for persistence
 */
export async function saveUsageToDatabase(sessionId) {
  const usage = getSessionUsage(sessionId);
  const summary = getUsageSummary(sessionId);

  try {
    // Check if usage_tracking table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'usage_tracking'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      // Create usage tracking table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS usage_tracking (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          story_session_id UUID REFERENCES story_sessions(id),
          elevenlabs_characters INTEGER DEFAULT 0,
          elevenlabs_requests INTEGER DEFAULT 0,
          elevenlabs_cost DECIMAL(10,6) DEFAULT 0,
          openai_input_tokens INTEGER DEFAULT 0,
          openai_output_tokens INTEGER DEFAULT 0,
          openai_requests INTEGER DEFAULT 0,
          openai_cost DECIMAL(10,6) DEFAULT 0,
          whisper_minutes DECIMAL(10,4) DEFAULT 0,
          whisper_requests INTEGER DEFAULT 0,
          whisper_cost DECIMAL(10,6) DEFAULT 0,
          realtime_audio_input_tokens INTEGER DEFAULT 0,
          realtime_audio_output_tokens INTEGER DEFAULT 0,
          realtime_cost DECIMAL(10,6) DEFAULT 0,
          image_count INTEGER DEFAULT 0,
          image_cost DECIMAL(10,6) DEFAULT 0,
          total_cost DECIMAL(10,6) DEFAULT 0,
          usage_json JSONB,
          tracked_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      logger.info('[UsageTracker] Created usage_tracking table');
    }

    // Insert or update usage record
    await pool.query(`
      INSERT INTO usage_tracking (
        story_session_id,
        elevenlabs_characters, elevenlabs_requests, elevenlabs_cost,
        openai_input_tokens, openai_output_tokens, openai_requests, openai_cost,
        whisper_minutes, whisper_requests, whisper_cost,
        realtime_audio_input_tokens, realtime_audio_output_tokens, realtime_cost,
        image_count, image_cost,
        total_cost, usage_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (story_session_id) DO UPDATE SET
        elevenlabs_characters = $2,
        elevenlabs_requests = $3,
        elevenlabs_cost = $4,
        openai_input_tokens = $5,
        openai_output_tokens = $6,
        openai_requests = $7,
        openai_cost = $8,
        whisper_minutes = $9,
        whisper_requests = $10,
        whisper_cost = $11,
        realtime_audio_input_tokens = $12,
        realtime_audio_output_tokens = $13,
        realtime_cost = $14,
        image_count = $15,
        image_cost = $16,
        total_cost = $17,
        usage_json = $18,
        tracked_at = NOW()
    `, [
      sessionId,
      usage.elevenlabs.characters,
      usage.elevenlabs.requests,
      usage.costs.elevenlabs,
      usage.openai.inputTokens,
      usage.openai.outputTokens,
      usage.openai.requests,
      usage.costs.openai,
      usage.whisper.minutes,
      usage.whisper.requests,
      usage.costs.whisper,
      usage.realtime.audioInputTokens,
      usage.realtime.audioOutputTokens,
      usage.costs.realtime,
      usage.images.count,
      usage.costs.images,
      usage.costs.total,
      JSON.stringify(summary)
    ]);

    logger.info(`[UsageTracker] Saved usage to database for session ${sessionId}: $${usage.costs.total.toFixed(4)}`);
    return true;

  } catch (error) {
    logger.error(`[UsageTracker] Failed to save usage to database:`, error.message);
    return false;
  }
}

/**
 * Clear session usage from memory
 */
export function clearSessionUsage(sessionId) {
  sessionUsage.delete(sessionId);
  logger.info(`[UsageTracker] Cleared usage tracking for session ${sessionId}`);
}

/**
 * Get all active session usages (for admin)
 */
export function getAllActiveUsage() {
  const result = [];
  for (const [sessionId, usage] of sessionUsage.entries()) {
    result.push(getUsageSummary(sessionId));
  }
  return result;
}

export default {
  initSessionUsage,
  getSessionUsage,
  setUsageTrackingIO,
  trackElevenLabsUsage,
  trackOpenAIUsage,
  trackWhisperUsage,
  trackRealtimeUsage,
  trackImageUsage,
  trackFalAIUsage,
  trackVeniceUsage,
  trackOpenRouterUsage,
  getUsageSummary,
  saveUsageToDatabase,
  clearSessionUsage,
  getAllActiveUsage,
  PRICING
};
