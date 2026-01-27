/**
 * Scene Generation Constants
 *
 * MEDIUM-9 FIX: Centralized magic numbers for scene generation.
 * All configurable limits and thresholds should be defined here.
 *
 * Created: 2026-01-26
 * Purpose: Fix hardcoded magic numbers scattered across files
 */

/**
 * Context window and token management
 */
export const CONTEXT_LIMITS = {
  // Maximum tokens before context summarization is triggered
  MAX_CONTEXT_TOKENS: 120000,

  // Threshold (percentage) at which to start summarizing context
  CONTEXT_SUMMARY_THRESHOLD: 0.8,

  // How much of previous scene to include for continuity (chars)
  // P0 FIX: Increased from 500 to allow proper scene transitions
  PREVIOUS_SCENE_CONTEXT_LENGTH: 1500,

  // How much of previous scene is actually used in prompts (chars)
  // P0 FIX: Increased from 500 to 1200 for better continuity
  PREVIOUS_SCENE_PROMPT_LENGTH: 1200
};

/**
 * Scene content validation thresholds
 */
export const CONTENT_VALIDATION = {
  // Minimum characters for display-ready content
  MIN_DISPLAY_TEXT_LENGTH: 100,

  // Minimum characters for raw text (may have tags)
  MIN_RAW_TEXT_LENGTH: 50,

  // Minimum word count for valid scene
  MIN_WORD_COUNT: 20,

  // Maximum word frequency ratio (same word > this % = repetitive)
  MAX_WORD_FREQUENCY_RATIO: 0.3
};

/**
 * Scene summary and storage
 */
export const SCENE_STORAGE = {
  // Character limit for scene summary stored in DB
  SUMMARY_MAX_LENGTH: 200,

  // Default branch key for linear stories
  DEFAULT_BRANCH_KEY: 'main'
};

/**
 * LLM token allocation by task type
 */
export const LLM_TOKEN_BUDGETS = {
  // Venice mature content expansion
  VENICE_MAX_TOKENS: 8000,

  // Standard scene generation
  SCENE_GENERATION_MAX_TOKENS: 4000,

  // Summarization tasks
  SUMMARY_MAX_TOKENS: 1000,

  // Safety check responses
  SAFETY_CHECK_MAX_TOKENS: 300,

  // Dialogue extraction
  DIALOGUE_EXTRACTION_MAX_TOKENS: 2000,

  // Scaffold generation (without expansion)
  SCAFFOLD_MAX_TOKENS: 3000,

  // Full hybrid pipeline expansion
  HYBRID_EXPANSION_MAX_TOKENS: 10000
};

/**
 * Scene count targets by story configuration
 */
export const SCENE_COUNTS = {
  // Base counts by length
  BY_LENGTH: {
    short: 5,
    medium: 10,
    long: 20
  },

  // Multipliers by format
  FORMAT_MULTIPLIERS: {
    picture_book: 0.5,
    short_story: 1,
    novella: 1.5,
    novel: 2,
    series: 1
  },

  // Minimum scenes regardless of config
  MINIMUM: 3
};

/**
 * Repetition detection thresholds
 */
export const REPETITION_DETECTION = {
  // Minimum characters before repetition check is meaningful
  MIN_TEXT_LENGTH_FOR_CHECK: 500,

  // Minimum Levenshtein similarity to flag as duplicate sentence
  SIMILARITY_THRESHOLD: 0.85,

  // How many warnings to include in result (cap for performance)
  MAX_WARNINGS_RETURNED: 5
};

/**
 * Helper to get context limit for a model
 * @param {string} model - Model name
 * @returns {number} Context token limit
 */
export function getModelContextLimit(model) {
  const limits = {
    'gpt-5.2': 128000,
    'gpt-5.1': 128000,
    'gpt-5': 128000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-3.5-turbo': 16385,
    'llama-3.3-70b': 128000
  };

  const key = Object.keys(limits).find(k => model?.includes(k));
  return limits[key] || 128000;
}

export default {
  CONTEXT_LIMITS,
  CONTENT_VALIDATION,
  SCENE_STORAGE,
  LLM_TOKEN_BUDGETS,
  SCENE_COUNTS,
  REPETITION_DETECTION,
  getModelContextLimit
};
