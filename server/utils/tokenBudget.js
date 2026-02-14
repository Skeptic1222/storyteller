/**
 * Token Budget Utilities
 *
 * Centralized token management for LLM calls:
 * - Context limits per model
 * - Input token estimation
 * - Agent category classification
 * - Dynamic budget adjustment for reasoning models (GPT-5.2)
 * - Utilization validation
 *
 * Used by both openai.js and llmProviders.js for consistent token handling.
 */

import { logger } from './logger.js';

// =============================================================================
// MODEL CONTEXT LIMITS
// =============================================================================

export const MODEL_CONTEXT_LIMITS = {
  // GPT-5.x family
  'gpt-5': 128000,
  'gpt-5.1': 128000,
  'gpt-5.2': 128000,
  'gpt-5.2-pro': 128000,
  'gpt-5-mini': 128000,
  'gpt-5-nano': 128000,

  // GPT-4.x family
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,

  // Reasoning models
  'o1': 128000,
  'o3': 128000,

  // Venice/LLaMA
  'llama-3.3-70b': 128000,

  // Default for unknown models
  'default': 128000
};

// =============================================================================
// AGENT CATEGORY CLASSIFICATION
// =============================================================================

/**
 * Reasoning-heavy agents that need full token budgets for chain-of-thought.
 * These agents do complex creative/analytical work requiring extensive reasoning.
 *
 * QUALITY FIX (2026-01-31): Added 'narrator' and 'polish' - these agents do
 * creative prose enhancement that requires nuanced understanding of style,
 * tone, and literary quality. They were incorrectly classified as utility
 * agents, causing quality regression due to 8K token cap.
 */
export const REASONING_HEAVY_AGENTS = [
  'planner', 'sceneGenerator', 'voiceDirector', 'beatArchitect',
  'writer', 'storyGenerator', 'proseWriter', 'outliner',
  'characterCreator', 'worldBuilder', 'dialogueWriter',
  'narrator', 'polish'  // QUALITY FIX: These need full creative budgets
];

/**
 * Utility agents that need minimal reasoning buffers.
 * These agents do simple classification/formatting tasks.
 *
 * NOTE: 'narrator' and 'polish' REMOVED - they are creative agents, not utility.
 */
export const UTILITY_AGENTS = [
  'safety', 'sfx', 'emotion', 'lore',
  'validator', 'tagger', 'formatter', 'summarizer', 'classifier'
];

/**
 * Normalize agent name for category matching.
 * Handles variations like 'SafetyAgent', 'safety_agent', 'safety-agent', etc.
 *
 * @param {string} agentName - Raw agent name
 * @returns {string} Normalized agent name (lowercase, no separators, no 'agent' suffix)
 */
export function normalizeAgentName(agentName) {
  if (!agentName || typeof agentName !== 'string') return '';
  return agentName.toLowerCase().replace(/[_-]/g, '').replace(/agent$/, '');
}

/**
 * Classify an agent into a category for token budget decisions.
 *
 * @param {string} agentName - Agent name (e.g., 'WriterAgent', 'safety_validator')
 * @returns {'reasoning-heavy' | 'utility' | 'default'} Agent category
 */
export function classifyAgent(agentName) {
  const normalized = normalizeAgentName(agentName);

  if (REASONING_HEAVY_AGENTS.some(a => normalized.includes(a.toLowerCase()))) {
    return 'reasoning-heavy';
  }

  if (UTILITY_AGENTS.some(a => normalized.includes(a.toLowerCase()))) {
    return 'utility';
  }

  return 'default';
}

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Estimate token count from text using rough approximation.
 * Uses ~4 characters per token as industry standard for English.
 *
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total input tokens from messages array.
 * Includes per-message overhead for role/structure tokens.
 *
 * @param {Array} messages - Array of {role, content} message objects
 * @returns {number} Estimated total input tokens
 */
export function estimateInputTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    return total + estimateTokens(content) + 4; // +4 for message overhead (role, etc.)
  }, 0);
}

// =============================================================================
// CONTEXT LIMIT VALIDATION
// =============================================================================

/**
 * Get context limit for a model.
 *
 * @param {string} model - Model name/ID
 * @returns {number} Context limit in tokens
 */
export function getContextLimit(model) {
  if (!model) return MODEL_CONTEXT_LIMITS.default;

  const modelKey = Object.keys(MODEL_CONTEXT_LIMITS)
    .find(k => k !== 'default' && model.includes(k));

  return MODEL_CONTEXT_LIMITS[modelKey] || MODEL_CONTEXT_LIMITS.default;
}

/**
 * Validate token utilization and log warnings/errors.
 *
 * @param {Object} params - Validation parameters
 * @param {number} params.inputTokens - Estimated input tokens
 * @param {number} params.outputTokens - Requested output tokens (max_tokens)
 * @param {string} params.model - Model name
 * @param {string} params.agentName - Agent name for logging
 * @returns {Object} { valid, utilization, contextLimit, warning }
 */
export function validateTokenUtilization({ inputTokens, outputTokens, model, agentName }) {
  const contextLimit = getContextLimit(model);
  const totalRequired = inputTokens + outputTokens;
  const utilization = Math.round((inputTokens / contextLimit) * 100);

  const result = {
    valid: true,
    utilization,
    contextLimit,
    inputTokens,
    outputTokens,
    totalRequired,
    warning: null
  };

  if (totalRequired > contextLimit) {
    result.valid = false;
    result.warning = `TOKEN_LIMIT_EXCEEDED: input ~${inputTokens} + output ${outputTokens} > limit ${contextLimit}`;
    logger.error(`[TokenBudget] ${agentName}: ${result.warning}`);
  } else if (utilization >= 80) {
    result.warning = `HIGH_UTILIZATION: ${utilization}% of ${contextLimit} context`;
    logger.warn(`[TokenBudget] ${agentName}: ${result.warning}`);
  } else if (utilization >= 50) {
    logger.info(`[TokenBudget] ${agentName}: ${inputTokens} tokens (${utilization}% of ${contextLimit})`);
  }

  return result;
}

// =============================================================================
// GPT-5.2 REASONING MODEL BUDGET ADJUSTMENT
// =============================================================================

/**
 * GPT-5.2 is a reasoning model that uses completion tokens for internal
 * chain-of-thought reasoning BEFORE generating output. The reasoning tokens
 * count toward max_completion_tokens.
 *
 * EVIDENCE FROM PRODUCTION (2026-01-16):
 * - Writer agent with 16000 max_tokens used ALL 16000 for reasoning_tokens
 * - Result: 0 content tokens, complete failure
 * - Reasoning models can use 16000+ tokens for chain-of-thought
 *
 * This function calculates appropriate token budgets based on agent category:
 * - Reasoning-heavy agents: Full buffer for complex creative tasks
 * - Utility agents: Minimal buffer for simple tasks (~60% cost savings)
 * - Default: Moderate buffer for unclassified agents
 *
 * @param {number} requestedTokens - Originally requested max_tokens
 * @param {string} agentName - Agent name for category classification
 * @returns {Object} { budget, reason, originalTokens }
 */
export function calculateGPT52Budget(requestedTokens, agentName) {
  const category = classifyAgent(agentName);
  let budget;

  switch (category) {
    case 'reasoning-heavy':
      // Full reasoning buffer for complex creative tasks
      budget = Math.max(requestedTokens + 20000, 28000);
      break;

    case 'utility':
      // Minimal buffer for utility tasks - they don't need extensive reasoning
      budget = Math.min(requestedTokens + 2000, 8000);
      break;

    default:
      // Moderate buffer for unclassified agents
      budget = Math.max(requestedTokens + 8000, 12000);
      break;
  }

  return {
    budget,
    reason: category,
    originalTokens: requestedTokens,
    increase: budget - requestedTokens
  };
}

/**
 * Check if a model is a reasoning model that needs budget adjustment.
 *
 * @param {string} model - Model name
 * @returns {boolean} True if model needs reasoning budget adjustment
 */
export function isReasoningModel(model) {
  if (!model) return false;
  return model === 'gpt-5.2' || model.startsWith('o1') || model.startsWith('o3');
}

/**
 * Check if a model uses max_completion_tokens instead of max_tokens.
 *
 * @param {string} model - Model name
 * @returns {boolean} True if model uses max_completion_tokens
 */
export function usesCompletionTokensParam(model) {
  if (!model) return false;
  return model.startsWith('o1') || model.startsWith('o3') || model.startsWith('gpt-5');
}

/**
 * Check if a model supports temperature parameter.
 *
 * @param {string} model - Model name
 * @returns {boolean} True if model supports temperature
 */
export function supportsTemperature(model) {
  if (!model) return true;

  // Models that don't support temperature
  const noTempModels = ['gpt-5-mini', 'gpt-5-nano', 'gpt-5.2-pro'];
  if (noTempModels.includes(model)) return false;

  // Reasoning models don't support temperature
  if (model.startsWith('o1') || model.startsWith('o3')) return false;

  return true;
}

/**
 * Check if a model supports response_format parameter.
 *
 * @param {string} model - Model name
 * @returns {boolean} True if model supports response_format
 */
export function supportsResponseFormat(model) {
  if (!model) return true;

  // GPT-5.x and reasoning models don't support response_format
  return !model.startsWith('gpt-5') && !model.startsWith('o1') && !model.startsWith('o3');
}

export default {
  MODEL_CONTEXT_LIMITS,
  REASONING_HEAVY_AGENTS,
  UTILITY_AGENTS,
  normalizeAgentName,
  classifyAgent,
  estimateTokens,
  estimateInputTokens,
  getContextLimit,
  validateTokenUtilization,
  calculateGPT52Budget,
  isReasoningModel,
  usesCompletionTokensParam,
  supportsTemperature,
  supportsResponseFormat
};
