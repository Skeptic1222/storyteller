/**
 * openRouterParallel.js
 *
 * Handles parallel placeholder expansion via OpenRouter API.
 * OpenRouter can route to Venice models and handle concurrent requests efficiently.
 *
 * Part of the Venice Scaffolding Architecture for explicit content quality.
 */

import OpenAI from 'openai';
import { buildExpansionPrompt } from './prompts/scaffoldPromptTemplates.js';

// OpenRouter client configuration
let openRouterClient = null;

/**
 * Get or create OpenRouter client
 */
function getOpenRouterClient() {
  if (!openRouterClient) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    openRouterClient = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://ay-i-t.com/storyteller',
        'X-Title': 'Storyteller'
      }
    });
  }

  return openRouterClient;
}

// Available Venice models on OpenRouter
const OPENROUTER_MODELS = {
  // Venice's uncensored Llama
  VENICE_LLAMA_70B: 'venice/llama-3.3-70b',
  // Alternative uncensored models via OpenRouter
  DOLPHIN_MIXTRAL: 'cognitivecomputations/dolphin-mixtral-8x22b',
  NOUS_HERMES: 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
  // Fallback creative model
  CLAUDE_HAIKU: 'anthropic/claude-3-haiku-20240307'
};

// Default model for expansion
const DEFAULT_EXPANSION_MODEL = OPENROUTER_MODELS.VENICE_LLAMA_70B;

// OpenRouter-specific parameters for expansion
const OPENROUTER_EXPANSION_PARAMS = {
  temperature: 0.75,
  frequency_penalty: 0.6,
  presence_penalty: 0.4,
  top_p: 0.90,
  max_tokens: 6000
};

/**
 * Expand a single placeholder via OpenRouter
 *
 * @param {Object} placeholder - Parsed placeholder object
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Expanded content
 */
export async function expandViaOpenRouter(placeholder, storyContext, authorStyle, options = {}) {
  const {
    model = DEFAULT_EXPANSION_MODEL,
    logPrefix = '[OpenRouterParallel]'
  } = options;

  const client = getOpenRouterClient();
  const prompt = buildExpansionPrompt(placeholder, storyContext, authorStyle);

  try {
    console.log(`${logPrefix} Expanding ${placeholder.type} via OpenRouter (${model})`);

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are a skilled creative writer specializing in mature fiction. Write vivid, engaging content that matches the requested intensity level exactly. Output only the content, no explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      ...OPENROUTER_EXPANSION_PARAMS,
      // Adjust tokens for scene-level vs inline
      max_tokens: isSceneLevelPlaceholder(placeholder.type) ? 2500 : 1000
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenRouter returned empty response');
    }

    console.log(`${logPrefix} Expanded ${placeholder.type}: ${content.substring(0, 80)}...`);

    return content.trim();

  } catch (error) {
    console.error(`${logPrefix} OpenRouter expansion failed for ${placeholder.type}:`, error.message);

    // Try fallback model if primary fails
    if (model === DEFAULT_EXPANSION_MODEL && options.allowFallback !== false) {
      console.log(`${logPrefix} Trying fallback model...`);
      return expandViaOpenRouter(placeholder, storyContext, authorStyle, {
        ...options,
        model: OPENROUTER_MODELS.DOLPHIN_MIXTRAL,
        allowFallback: false
      });
    }

    throw error;
  }
}

/**
 * Expand multiple placeholders in parallel via OpenRouter
 * OpenRouter handles the concurrent requests and routing
 *
 * @param {Array} placeholders - Array of parsed placeholders
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @param {Object} options - Additional options
 * @returns {Promise<Array<string>>} Array of expanded content
 */
export async function expandBatchParallel(placeholders, storyContext, authorStyle, options = {}) {
  const {
    maxConcurrent = 5,
    model = DEFAULT_EXPANSION_MODEL,
    logPrefix = '[OpenRouterParallel]',
    onProgress
  } = options;

  console.log(`${logPrefix} Expanding ${placeholders.length} placeholders in parallel via OpenRouter`);

  // Split into chunks to respect rate limits
  const chunks = chunkArray(placeholders, maxConcurrent);
  const allExpansions = [];
  let completed = 0;

  for (const chunk of chunks) {
    // Process chunk in parallel
    const chunkResults = await Promise.allSettled(
      chunk.map(p => expandViaOpenRouter(p, storyContext, authorStyle, { model, logPrefix }))
    );

    // Extract results and handle failures
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      const placeholder = chunk[i];

      if (result.status === 'fulfilled') {
        allExpansions.push(result.value);
      } else {
        console.error(`${logPrefix} Failed to expand ${placeholder.type}:`, result.reason);
        allExpansions.push(generateFallbackExpansion(placeholder));
      }

      completed++;
      if (onProgress) {
        onProgress({
          current: completed,
          total: placeholders.length,
          type: placeholder.type,
          success: result.status === 'fulfilled'
        });
      }
    }

    // Small delay between chunks to be nice to OpenRouter
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await delay(200);
    }
  }

  return allExpansions;
}

/**
 * Build messages array for OpenRouter batch request
 * Can be used to prepare requests for manual batching
 *
 * @param {Object} placeholder - Parsed placeholder
 * @param {Object} storyContext - Story context
 * @param {Object} authorStyle - Author style configuration
 * @returns {Array} Messages array for OpenRouter
 */
export function buildExpansionMessages(placeholder, storyContext, authorStyle) {
  const prompt = buildExpansionPrompt(placeholder, storyContext, authorStyle);

  return [
    {
      role: 'system',
      content: 'You are a skilled creative writer specializing in mature fiction. Write vivid, engaging content that matches the requested intensity level exactly. Output only the content, no explanations.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];
}

/**
 * Get available OpenRouter models for expansion
 */
export function getAvailableModels() {
  return { ...OPENROUTER_MODELS };
}

/**
 * Check if OpenRouter is configured and available
 */
export function isOpenRouterAvailable() {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Get OpenRouter API usage/credits (if available)
 */
export async function getOpenRouterStatus() {
  if (!isOpenRouterAvailable()) {
    return { available: false, reason: 'API key not configured' };
  }

  try {
    const client = getOpenRouterClient();

    // OpenRouter doesn't have a standard status endpoint, but we can check auth
    // by making a minimal request to the models endpoint
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return {
        available: true,
        credits: data.data?.limit_remaining,
        usage: data.data?.usage
      };
    }

    return { available: false, reason: 'Auth check failed' };

  } catch (error) {
    return { available: false, reason: error.message };
  }
}

// ============ Helper Functions ============

/**
 * Check if placeholder type is scene-level
 */
function isSceneLevelPlaceholder(type) {
  const sceneLevelTypes = ['INTIMATE_SCENE', 'VIOLENT_CONFRONTATION', 'HORROR_MOMENT'];
  return sceneLevelTypes.includes(type);
}

/**
 * Generate fallback expansion when OpenRouter fails
 */
function generateFallbackExpansion(placeholder) {
  const { type } = placeholder;

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
  expandViaOpenRouter,
  expandBatchParallel,
  buildExpansionMessages,
  getAvailableModels,
  isOpenRouterAvailable,
  getOpenRouterStatus,
  OPENROUTER_MODELS
};
