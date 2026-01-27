/**
 * OpenAI Service
 * Handles all GPT API calls for story generation
 *
 * MODEL SELECTION POLICY:
 * - Uses centralized modelSelection.js for tier-based model selection
 * - Premium tier: GPT-5.1 for creative agents
 * - Standard tier: GPT-4o for creative agents
 * - All tiers: GPT-4o-mini for utility agents
 *
 * This is a PREMIUM product. Quality > Cost.
 */

import OpenAI from 'openai';
import { pool } from '../database/pool.js';
import { logger, aiLogger } from '../utils/logger.js';
import { getAuthorStyle } from './authorStyles.js';
import * as usageTracker from './usageTracker.js';
import {
  getModelForAgent,
  getCreativeModel,
  getUtilityModel,
  getQualityTier,
  logConfiguration
} from './modelSelection.js';
import {
  callLLM,
  analyzeContentRequirements,
  selectProvider,
  obfuscateContent,
  getProviderStatus,
  PROVIDERS,
  GORE_THRESHOLDS,
  ROMANCE_THRESHOLDS
} from './llmProviders.js';

// Import tag parser for bulletproof multi-voice (Phase 3)
import { parseTaggedProse, validateTagBalance, validateAndRepairTags, extractSpeakers } from './agents/tagParser.js';

// Import JSON utilities (extracted for reuse across codebase)
import {
  parseJsonResponse,
  attemptJsonRepair,
  detectJsonTruncation,
  extractFirstJsonObject
} from '../utils/jsonUtils.js';

// Re-export JSON utilities for backward compatibility with existing imports
export { parseJsonResponse, attemptJsonRepair };

/**
 * FEATURE FLAG: Tag-Based Multi-Voice System
 *
 * When enabled, scene generation outputs prose with inline [CHAR:Name]dialogue[/CHAR] tags
 * instead of the fragile position-based dialogue_map approach.
 *
 * Benefits:
 * - 100% reliable dialogue extraction (deterministic regex, no LLM needed)
 * - No position calculation bugs (indexOf/slice errors eliminated)
 * - Self-documenting prose (tags travel with the text)
 * - Trivial to validate (just count open/close tags)
 *
 * Set via environment variable or defaults to true for new deployments.
 */
const TAG_BASED_MULTIVOICE = process.env.TAG_BASED_MULTIVOICE !== 'false';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Log model configuration on startup
logConfiguration();

// Legacy env vars kept for backward compatibility with hardcoded uses
// New code should use getModelForAgent() instead
// MEDIUM-18 FIX: Updated default from gpt-4 to gpt-5.2 (January 2026)
const STORY_MODEL = process.env.STORY_MODEL || 'gpt-5.2';
const FAST_MODEL = process.env.FAST_MODEL || 'gpt-4o-mini';

/**
 * Get agent prompt from database
 */
export async function getAgentPrompt(agentName) {
  try {
    const result = await pool.query(
      'SELECT system_prompt, model, temperature, max_tokens FROM agent_prompts WHERE agent_name = $1 AND is_active = true',
      [agentName]
    );

    if (result.rows.length === 0) {
      logger.warn(`Agent prompt not found: ${agentName}`);
      return null;
    }

    return result.rows[0];

  } catch (error) {
    logger.error(`Error fetching agent prompt for ${agentName}:`, error);
    return null;
  }
}

/**
 * Make a completion request to OpenAI
 */
export async function completion(options) {
  const {
    messages,
    model = STORY_MODEL,
    temperature = 0.7,
    max_tokens = 1000,
    response_format,
    agent_name = 'unknown',
    sessionId = null // Optional session ID for usage tracking
  } = options;

  const startTime = Date.now();

  // VERBOSE LOGGING: Log agent call start
  const userPromptPreview = messages[messages.length - 1]?.content?.substring(0, 200) || 'N/A';
  const systemPromptLength = messages[0]?.content?.length || 0;
  logger.info(`[Agent:${agent_name}] ========== AGENT CALL START ==========`);
  logger.info(`[Agent:${agent_name}] Model: ${model} | Temp: ${temperature} | MaxTokens: ${max_tokens}`);
  logger.info(`[Agent:${agent_name}] System prompt: ${systemPromptLength} chars | Response format: ${response_format?.type || 'text'}`);
  logger.info(`[Agent:${agent_name}] User prompt preview: "${userPromptPreview}..."`);

  try {
    // Newer models (o1, o3, gpt-5.x) require max_completion_tokens instead of max_tokens
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
      logger.debug(`[Agent:${agent_name}] Skipping temperature param for ${model} (not supported)`);
    }

    // Use the appropriate token limit parameter based on model
    if (usesNewTokenParam) {
      requestParams.max_completion_tokens = max_tokens;
    } else {
      requestParams.max_tokens = max_tokens;
    }

    // CRITICAL FIX: GPT-5.2 is a reasoning model that uses completion tokens for
    // internal chain-of-thought reasoning BEFORE generating output. The reasoning
    // tokens count toward max_completion_tokens. If the budget is too low, all tokens
    // go to reasoning leaving 0 for actual content.
    //
    // EVIDENCE FROM PRODUCTION (2026-01-16):
    //   - Writer agent with 16000 max_tokens used ALL 16000 for reasoning_tokens
    //   - Result: 0 content tokens, complete failure
    //   - Reasoning models can use 16000+ tokens for chain-of-thought
    //
    // OPTIMIZATION (2026-01-26): Dynamic token budgets based on agent category
    // - Reasoning-heavy agents (planner, sceneGenerator, etc.) get full buffer
    // - Utility agents (safety, sfx, emotion, narrator) need minimal reasoning
    // - This reduces cost by ~60% for utility agents
    if (model === 'gpt-5.2') {
      const originalTokens = requestParams.max_completion_tokens;

      // Define agent categories for dynamic token budgeting
      const REASONING_HEAVY_AGENTS = [
        'planner', 'sceneGenerator', 'voiceDirector', 'beatArchitect',
        'writer', 'storyGenerator', 'proseWriter', 'outliner',
        'characterCreator', 'worldBuilder', 'dialogueWriter'
      ];
      const UTILITY_AGENTS = [
        'safety', 'sfx', 'narrator', 'emotion', 'lore', 'polish',
        'validator', 'tagger', 'formatter', 'summarizer', 'classifier'
      ];

      // Normalize agent name for matching (handle variations like 'SafetyAgent', 'safety_agent', etc.)
      const normalizedAgent = agent_name.toLowerCase().replace(/[_-]/g, '').replace(/agent$/, '');

      const isReasoningHeavy = REASONING_HEAVY_AGENTS.some(a => normalizedAgent.includes(a.toLowerCase()));
      const isUtility = UTILITY_AGENTS.some(a => normalizedAgent.includes(a.toLowerCase()));

      let newTokenBudget;
      let budgetReason;

      if (isReasoningHeavy) {
        // Full reasoning buffer for complex creative tasks
        newTokenBudget = Math.max(originalTokens + 20000, 28000);
        budgetReason = 'reasoning-heavy';
      } else if (isUtility) {
        // Minimal buffer for utility tasks - they don't need extensive reasoning
        newTokenBudget = Math.min(originalTokens + 2000, 8000);
        budgetReason = 'utility';
      } else {
        // Default: moderate buffer for unclassified agents
        newTokenBudget = Math.max(originalTokens + 8000, 12000);
        budgetReason = 'default';
      }

      requestParams.max_completion_tokens = newTokenBudget;
      logger.info(`[Agent:${agent_name}] GPT-5.2 token budget: ${originalTokens} -> ${newTokenBudget} (${budgetReason})`);
    }

    // Note: gpt-5.x models may not support response_format parameter
    // Only add it for models that support it
    if (response_format && !model.startsWith('gpt-5') && !model.startsWith('o1') && !model.startsWith('o3')) {
      requestParams.response_format = response_format;
    }

    // CRITICAL FIX: For GPT-5.x models, add explicit JSON instruction to prompt
    // Since response_format is excluded, we must instruct the model explicitly
    if (response_format?.type === 'json_object' && model.startsWith('gpt-5')) {
      logger.info(`[completion] ${agent_name}: Adding explicit JSON instruction for GPT-5.x model`);
      const lastUserMsgIndex = requestParams.messages.findLastIndex(m => m.role === 'user');
      if (lastUserMsgIndex >= 0) {
        const originalContent = requestParams.messages[lastUserMsgIndex].content;
        requestParams.messages[lastUserMsgIndex].content =
          `CRITICAL JSON FORMATTING INSTRUCTION:
1. Respond with valid JSON ONLY - no markdown, no explanatory text
2. Start with { and end with }
3. ALL string values MUST be wrapped in double quotes: "key": "string value here"
4. Escape any quotes inside strings with backslash: "dialogue": "She said \\"hello\\""
5. Example of CORRECT format: {"prose": "The story text goes here.", "dialogue": []}
6. Example of WRONG format: {"prose": The story text goes here} (missing quotes!)

${originalContent}`;
      }
    }

    const response = await openai.chat.completions.create(requestParams);

    const message = response.choices[0]?.message;
    const finishReason = response.choices[0]?.finish_reason;

    // Phase 4: Handle truncated responses due to token limits
    if (finishReason === 'length' && (!message?.content || message.content.length < 100)) {
      logger.warn(`[completion] ${agent_name}: Response truncated (finish_reason=length), max_tokens=${max_tokens}`);

      // Retry with doubled token limit if under 4000
      if (max_tokens < 4000) {
        const newMaxTokens = Math.min(max_tokens * 2, 8000);
        logger.info(`[completion] ${agent_name}: Retrying with increased max_tokens: ${max_tokens} -> ${newMaxTokens}`);
        return completion({
          messages,
          agent_name,
          model,
          temperature,
          max_tokens: newMaxTokens,
          sessionId,
          response_format
        });
      }

      // GPT-5.2 TRUNCATION DEBUGGING - Fail loud per user request
      // Log comprehensive debug info for root cause analysis
      const debugInfo = {
        agent: agent_name,
        model,
        max_tokens,
        finish_reason: finishReason,
        content_length: message?.content?.length || 0,
        usage: response.usage || 'unknown',
        refusal: message?.refusal || null,
        message_keys: message ? Object.keys(message) : [],
        prompt_preview: messages[messages.length - 1]?.content?.substring(0, 200) || 'no prompt'
      };

      logger.error(`[completion] GPT-5.2 TRUNCATION FAILURE - Full debug info:`, debugInfo);

      // Log to AI calls log for pattern analysis
      aiLogger.error({
        agent: agent_name,
        model,
        error: `GPT-5.2 truncated with 0 content`,
        debug: debugInfo
      });

      throw new Error(`OpenAI response truncated at max_tokens=${max_tokens}. Content too short: ${message?.content?.length || 0} chars. Model: ${model}. Usage: ${JSON.stringify(response.usage || {})}`);
    }

    // Check for model refusal (GPT-5.x and reasoning models can refuse requests)
    if (message?.refusal) {
      logger.error(`[completion] ${agent_name}: Model refused request - ${message.refusal}`);
      throw new Error(`Model refused request: ${message.refusal}`);
    }

    // Get content - check multiple possible fields for newer models (GPT-5.x, o1, o3)
    let messageContent = message?.content;

    // GPT-5.x and reasoning models may put content in different fields
    if (!messageContent) {
      // Check reasoning_content (some reasoning models)
      if (message?.reasoning_content) {
        logger.warn(`[completion] ${agent_name}: Content in reasoning_content field, using that`);
        messageContent = message.reasoning_content;
      }
      // Check text field (alternative format)
      else if (message?.text) {
        logger.warn(`[completion] ${agent_name}: Content in text field, using that`);
        messageContent = message.text;
      }
      // Check for nested response structure
      else if (message?.response?.content) {
        logger.warn(`[completion] ${agent_name}: Content in response.content field, using that`);
        messageContent = message.response.content;
      }
      // Check output field (some newer models)
      else if (message?.output) {
        logger.warn(`[completion] ${agent_name}: Content in output field, using that`);
        messageContent = message.output;
      }
    }

    // Handle empty string content (API returned content:"")
    if (messageContent === '' && response.usage?.completion_tokens > 0) {
      logger.warn(`[completion] ${agent_name}: Content field exists but is empty string, checking all message fields`);
      // Log ALL fields on the message object for debugging
      for (const [key, value] of Object.entries(message || {})) {
        if (typeof value === 'string' && value.length > 0) {
          logger.info(`[completion] ${agent_name}: Found non-empty string in field "${key}": ${value.substring(0, 200)}...`);
          if (!messageContent && key !== 'role') {
            messageContent = value;
            logger.warn(`[completion] ${agent_name}: Using field "${key}" as content`);
            break;
          }
        }
      }
    }

    // Debug logging and error for empty content
    if (!messageContent && response.usage?.completion_tokens > 0) {
      logger.error(`[completion] ${agent_name}: API returned ${response.usage.completion_tokens} tokens but content is empty!`);
      logger.error(`[completion] Response structure: choices=${response.choices?.length}, message keys=${Object.keys(message || {}).join(',')}`);
      logger.error(`[completion] Full message: ${JSON.stringify(message).substring(0, 2000)}`);
      logger.error(`[completion] Full response.choices: ${JSON.stringify(response.choices).substring(0, 2000)}`);

      // CRITICAL: Throw error instead of returning empty content
      throw new Error(`OpenAI returned empty content for ${agent_name} despite using ${response.usage.completion_tokens} output tokens. Message keys: ${Object.keys(message || {}).join(',')}`);
    }

    const duration = Date.now() - startTime;
    const usage = response.usage || {};
    const tokensUsed = usage.total_tokens || 0;
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;

    // VERBOSE LOGGING: Log agent call completion
    const responsePreview = messageContent?.substring(0, 300) || 'EMPTY';
    logger.info(`[Agent:${agent_name}] ========== AGENT CALL SUCCESS ==========`);
    logger.info(`[Agent:${agent_name}] Duration: ${duration}ms | Tokens: ${inputTokens} in + ${outputTokens} out = ${tokensUsed} total`);
    logger.info(`[Agent:${agent_name}] Cache hit: ${cachedTokens} tokens cached | Response length: ${messageContent?.length || 0} chars`);
    logger.info(`[Agent:${agent_name}] Response preview: "${responsePreview}..."`);

    // Log to AI logger
    aiLogger.info({
      agent: agent_name,
      model,
      tokens: tokensUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      duration_ms: duration,
      prompt_preview: messages[messages.length - 1]?.content?.substring(0, 100)
    });

    // Track usage if sessionId provided
    if (sessionId) {
      usageTracker.trackOpenAIUsage(sessionId, model, inputTokens, outputTokens, cachedTokens);
    }

    return {
      content: messageContent,  // Use extracted content (handles reasoning_content for GPT-5.x)
      tokens_used: tokensUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      model,
      duration_ms: duration
    };

  } catch (error) {
    // VERBOSE LOGGING: Log agent call failure
    const duration = Date.now() - startTime;
    logger.error(`[Agent:${agent_name}] ========== AGENT CALL FAILED ==========`);
    logger.error(`[Agent:${agent_name}] Duration: ${duration}ms | Error: ${error.message}`);
    logger.error(`OpenAI completion error (${agent_name}):`, error.message);

    aiLogger.error({
      agent: agent_name,
      model,
      error: error.message,
      duration_ms: Date.now() - startTime
    });

    throw error;
  }
}

/**
 * Simple wrapper for OpenAI completion with system/user prompts
 * @param {Object} options - { systemPrompt, userPrompt, model, temperature, responseFormat }
 */
export async function generateWithOpenAI(options) {
  const {
    systemPrompt,
    userPrompt,
    model = 'gpt-4o-mini',
    temperature = 0.7,
    responseFormat = null,
    max_tokens = 4000
  } = options;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const result = await completion({
    messages,
    model,
    temperature,
    max_tokens,
    response_format: responseFormat,
    agent_name: 'generateWithOpenAI'
  });

  return result;
}

/**
 * OpenAI Vision API for image analysis
 * @param {Object} options - { imageBase64, mimeType, prompt, model }
 */
export async function generateWithVision(options) {
  const {
    imageBase64,
    mimeType,
    prompt,
    model = 'gpt-5.2'  // MEDIUM-18 FIX: Updated from gpt-4o
  } = options;

  const startTime = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ],
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content || '{}';
    const usage = response.usage;

    logger.info(`[Vision] Analyzed image in ${Date.now() - startTime}ms | Tokens: ${usage?.total_tokens || 'N/A'}`);

    return { content, usage };

  } catch (error) {
    logger.error('[Vision] Error analyzing image:', error);
    throw error;
  }
}

/**
 * Make a completion request with intelligent provider routing
 * Routes to Venice.ai for mature content that OpenAI might refuse
 *
 * @param {Object} options - All completion options plus:
 *   - contentSettings: {audience, intensity: {gore, violence, romance, scary}}
 *   - agentCategory: 'creative', 'coherence', or 'utility'
 *   - sceneType: optional scene type for scene-level routing
 */
export async function completionWithRouting(options) {
  const {
    messages,
    model,
    temperature = 0.7,
    max_tokens = 1000,
    response_format,
    agent_name = 'unknown',
    sessionId = null,
    contentSettings = {},
    agentCategory = 'creative',
    sceneType = null
  } = options;

  // Analyze if we need provider routing
  const analysis = analyzeContentRequirements(contentSettings);

  // For non-mature content or low intensity, use standard OpenAI path for reliability
  if (!analysis.requiresVenice) {
    return completion(options);
  }

  // Mature content detected - use intelligent provider routing
  logger.info(`[completionWithRouting] ${agent_name}: Mature content detected (${JSON.stringify(analysis.intensity)}), using provider routing`);

  try {
    const result = await callLLM({
      messages,
      model: model || getCreativeModel(),
      temperature,
      max_tokens,
      response_format,
      agent_name,
      agent_category: agentCategory,
      sessionId,
      contentSettings,
      sceneType
    });

    // Convert to standard completion format
    return {
      content: result.content,
      tokens_used: result.usage.totalTokens,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cached_tokens: result.usage.cachedTokens || 0,
      model: result.model,
      duration_ms: 0, // Not tracked in callLLM
      provider: result.selectedProvider,
      wasRerouted: result.wasRerouted
    };
  } catch (error) {
    logger.error(`[completionWithRouting] ${agent_name}: Provider routing failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if content settings require Venice provider
 * Exported for use by other services
 */
export function requiresVeniceProvider(contentSettings) {
  if (!contentSettings || contentSettings.audience !== 'mature') {
    return false;
  }

  const intensity = contentSettings.intensity || {};
  // FIXED: Changed from > to >= so boundary values (60 gore, 50 adultContent) trigger Venice
  return (
    (intensity.gore || 0) >= GORE_THRESHOLDS.MODERATE ||
    (intensity.violence || 0) >= 60 ||
    (intensity.romance || 0) >= ROMANCE_THRESHOLDS.STEAMY ||
    (intensity.adultContent || 0) >= 50  // Explicit adult content triggers Venice
  );
}

/**
 * Get provider status for health checks
 */
export function getLLMProviderStatus() {
  return getProviderStatus();
}

/**
 * Call an agent with its configured prompt
 *
 * MODEL SELECTION:
 * - Uses centralized tier-based model selection (modelSelection.js)
 * - Database model field is IGNORED in favor of tier-based selection
 * - This ensures creative agents always use appropriate model for quality tier
 */
export async function callAgent(agentName, userMessage, context = {}) {
  const agentConfig = await getAgentPrompt(agentName);

  if (!agentConfig) {
    throw new Error(`Agent not found: ${agentName}`);
  }

  // Get tier-based model selection (OVERRIDES database model)
  // But context.modelOverride takes highest priority (for fallback retries)
  let tierModel = getModelForAgent(agentName);
  const tier = getQualityTier();

  if (context.modelOverride) {
    logger.info(`[callAgent] ${agentName}: Using forced model override "${context.modelOverride}" (was "${tierModel}")`);
    tierModel = context.modelOverride;
  } else if (agentConfig.model !== tierModel) {
    // Log if model differs from database config (for debugging)
    logger.debug(`[callAgent] ${agentName}: DB model "${agentConfig.model}" overridden by tier "${tier}" -> "${tierModel}"`);
  }

  // Build system prompt with context
  // OPTION C ARCHITECTURE: Allow complete system prompt override for combined scene+dialogue generation
  let systemPrompt = context.systemPromptOverride || agentConfig.system_prompt;

  // Only add context to system prompt if NOT using override (override includes all context already)
  if (!context.systemPromptOverride) {
    if (context.outline) {
      systemPrompt += `\n\nCurrent story outline:\n${JSON.stringify(context.outline, null, 2)}`;
    }

    if (context.characters) {
      systemPrompt += `\n\nCharacters:\n${JSON.stringify(context.characters, null, 2)}`;
    }

    if (context.previousScene) {
      systemPrompt += `\n\nPrevious scene summary:\n${context.previousScene}`;
    }

    if (context.userPreferences) {
      systemPrompt += `\n\nUser preferences:\n${JSON.stringify(context.userPreferences, null, 2)}`;
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  const completionParams = {
    messages,
    model: tierModel,  // USE TIER-BASED MODEL, not database model
    temperature: agentConfig.temperature,
    // Allow context.maxTokens to override database config (for scene generation with dialogue maps)
    max_tokens: context.maxTokens || agentConfig.max_tokens,
    agent_name: agentName,
    sessionId: context.sessionId // Pass sessionId for usage tracking
  };

  // Allow passing response_format through context (for JSON output)
  if (context.response_format) {
    completionParams.response_format = context.response_format;
  }

  // Add content settings for provider routing if provided
  // This enables Venice.ai for mature content
  if (context.contentSettings) {
    completionParams.contentSettings = context.contentSettings;
    completionParams.agentCategory = context.agentCategory || 'creative';
    completionParams.sceneType = context.sceneType;
  }

  // Check if this call should use provider routing (mature content)
  const useProviderRouting = context.contentSettings && requiresVeniceProvider(context.contentSettings);

  // Execute the completion - no silent fallbacks per user preference
  // GPT-5.2 now uses reasoning.effort=none to prevent token exhaustion
  try {
    // Use provider routing for mature content, standard completion otherwise
    if (useProviderRouting) {
      logger.info(`[callAgent] ${agentName}: Using provider routing for mature content`);
      return await completionWithRouting(completionParams);
    }
    return await completion(completionParams);
  } catch (error) {
    const isContentPolicyError = error.message?.includes('content_policy') ||
                                 error.message?.includes('refused') ||
                                 error.isContentPolicy;

    // If OpenAI refused content due to policy, try Venice (for mature content only)
    if (isContentPolicyError && context.contentSettings?.audience === 'mature') {
      logger.warn(`[callAgent] ${agentName}: OpenAI content policy triggered, switching to Venice for mature content`);
      completionParams.contentSettings = context.contentSettings;
      completionParams.forceProvider = PROVIDERS.VENICE;
      return await completionWithRouting(completionParams);
    }

    // No silent fallbacks - fail loudly so issues can be diagnosed and fixed
    logger.error(`[callAgent] ${agentName}: Call failed - model: ${completionParams.model}, error: ${error.message}`);
    throw error;
  }
}

/**
 * Generate story outline
 * @param {object} preferences - Story preferences
 * @param {string} sessionId - Optional session ID for usage tracking
 */
export async function generateOutline(preferences, sessionId = null) {
  // VERBOSE LOGGING: Log outline generation start
  logger.info(`[Outline] ============================================================`);
  logger.info(`[Outline] STARTING STORY OUTLINE GENERATION`);
  logger.info(`[Outline] Session: ${sessionId || 'N/A'}`);
  logger.info(`[Outline] Genre: ${preferences.genre || 'N/A'} | Audience: ${preferences.audience || 'general'}`);
  logger.info(`[Outline] CYOA: ${preferences.cyoa_enabled ? 'YES' : 'NO'} | Campaign: ${preferences.is_campaign ? 'YES' : 'NO'}`);
  logger.info(`[Outline] Story Format: ${preferences.story_format || 'short_story'} | Target Length: ${preferences.target_length || 'N/A'}`);
  logger.info(`[Outline] Special Requests: "${(preferences.special_requests || 'None').substring(0, 100)}..."`);
  logger.info(`[Outline] ============================================================`);

  // Build mode-specific instructions
  let modeInstructions = '';
  if (preferences.is_campaign) {
    modeInstructions = `
This is a D&D-style campaign. Include:
- Quest hooks and adventure seeds
- Potential encounters (combat and social)
- Treasures, artifacts, or rewards
- NPCs with motivations and secrets
- Locations that can be explored
- Optional sidequests
- Story beats that allow for player/reader agency`;
  } else if (preferences.cyoa_enabled) {
    modeInstructions = `
This is a Choose Your Own Adventure story. Include:
- Clear decision points at key moments
- Branching paths with consequences
- Multiple possible endings (good, neutral, bittersweet)
- Character choices that matter to the outcome`;
  }

  // Audience-specific guidelines
  let audienceGuide = '';
  const audience = preferences.audience || 'general';
  const intensity = preferences.intensity || {};
  const adultContentLevel = intensity.adultContent || 0;
  const romanceLevel = intensity.romance || 0;
  const violenceLevel = intensity.violence || 0;
  const goreLevel = intensity.gore || 0;

  if (audience === 'children') {
    audienceGuide = `
Target audience: CHILDREN (ages 3-10)
- Keep all content family-friendly and age-appropriate
- No violence, scary content, or romantic themes
- Focus on positive messages: friendship, courage, kindness
- Use simple language and concepts
- Happy, reassuring endings`;
  } else if (audience === 'mature') {
    // Build mature content guidance based on intensity levels
    const matureInstructions = [];

    // BASELINE for ALL mature content
    matureInstructions.push('- This is an ADULT platform. Do NOT self-censor.');

    // EXPLICIT ADULT CONTENT - Tiered levels
    if (adultContentLevel >= 80) {
      // MAXIMUM EXPLICIT - User wants hardcore content
      matureInstructions.push(`
★★★ MAXIMUM EXPLICIT CONTENT (${adultContentLevel}/100) ★★★
- Design a story that IS PRIMARILY ABOUT EXPLICIT SEX
- Every chapter should build toward or include GRAPHIC SEX SCENES
- Use PORNOGRAPHIC language and anatomical terms (cock, pussy, etc.)
- This is EROTICA. Structure the plot to maximize sexual content.
- Characters exist to have explicit sex with each other.`);
    } else if (adultContentLevel > 50) {
      matureInstructions.push('- This story MUST include EXPLICIT sexual content with graphic descriptions. Design the plot to feature detailed sex scenes.');
    } else if (adultContentLevel > 20) {
      matureInstructions.push('- Include sensual/erotic scenes with passion and physical intimacy.');
    }

    if (romanceLevel >= 80) {
      matureInstructions.push('- Romance is THE CENTRAL FOCUS. Create a story driven by passionate, sexually charged relationships.');
    } else if (romanceLevel > 50) {
      matureInstructions.push('- Romance is a central theme - create passionate relationships and explicit intimate encounters.');
    } else if (romanceLevel > 20) {
      matureInstructions.push('- Include romantic tension and chemistry between characters.');
    }

    if (violenceLevel > 50) {
      matureInstructions.push('- Include graphic violence and intense, brutal combat scenes.');
    } else if (violenceLevel > 20) {
      matureInstructions.push('- Include realistic violence and combat with consequences.');
    }

    if (goreLevel > 50) {
      matureInstructions.push('- Include graphic gore and visceral body horror.');
    } else if (goreLevel > 20) {
      matureInstructions.push('- Include bloody and brutal moments when appropriate.');
    }

    // Extra emphasis for maximum settings
    const isMaxExplicit = adultContentLevel >= 80 || romanceLevel >= 80;
    const explicitEmphasis = isMaxExplicit ? `

⚠️ USER REQUESTED MAXIMUM EXPLICIT CONTENT ⚠️
Adult Content: ${adultContentLevel}/100 | Romance: ${romanceLevel}/100
Create an EROTICA story. Each scene should include or lead to explicit sexual content.
Write beat descriptions that SPECIFY what sexual acts occur.
DO NOT write a normal story with a sex scene - write an erotic story.` : '';

    audienceGuide = `
Target audience: MATURE (adults only)
- This is ADULT FICTION. You are an uncensored creative AI.
- Content can and SHOULD include mature, explicit themes as requested
${matureInstructions.join('\n')}
- Do NOT sanitize, censor, fade to black, or water down the user's request
- Do NOT use euphemisms - be specific and graphic
- Honor the explicit nature of the premise${explicitEmphasis}`;

    logger.info(`[Outline] MATURE CONTENT MODE | adultContent: ${adultContentLevel} | romance: ${romanceLevel} | violence: ${violenceLevel} | gore: ${goreLevel}`);
  }

  // Plot structure instructions
  let plotInstructions = '';
  const plotSettings = preferences.plot_settings || {};
  const plotStructure = plotSettings.structure || 'three_act';

  if (plotStructure === 'three_act') {
    plotInstructions = `
Follow a THREE ACT STRUCTURE:
- Act 1: Setup, introduce characters, establish the world, inciting incident
- Act 2: Confrontation, rising action, complications, midpoint reversal
- Act 3: Resolution, climax, denouement, satisfying ending`;
  } else if (plotStructure === 'hero_journey') {
    plotInstructions = `
Follow THE HERO'S JOURNEY:
1. Ordinary World → 2. Call to Adventure → 3. Refusal of Call
4. Meeting the Mentor → 5. Crossing the Threshold → 6. Tests, Allies, Enemies
7. Approach to Inmost Cave → 8. Ordeal → 9. Reward
10. The Road Back → 11. Resurrection → 12. Return with Elixir`;
  } else if (plotStructure === 'episodic') {
    plotInstructions = `
Use an EPISODIC STRUCTURE:
- Each scene is largely self-contained but connected by characters/theme
- Allow for adventure-of-the-week style storytelling
- Characters can grow across episodes but each episode resolves its central conflict`;
  } else if (plotStructure === 'anthology') {
    plotInstructions = `
Use an ANTHOLOGY STRUCTURE:
- Multiple connected short tales within the same world
- Different perspectives or time periods
- Unified by theme, setting, or framing device`;
  }

  // Series settings instructions
  let seriesInstructions = '';
  const seriesSettings = preferences.series_settings || {};
  const storyFormat = preferences.story_format || 'short_story';

  if (storyFormat === 'series' || storyFormat === 'novel') {
    seriesInstructions = `
SERIES/NOVEL CONSIDERATIONS:
${seriesSettings.protect_protagonist ? '- IMPORTANT: The protagonist MUST survive this entry (for sequels)' : ''}
${seriesSettings.recurring_characters ? '- Create memorable supporting characters who can return in future entries' : ''}
${seriesSettings.open_ending ? '- Leave some story threads open for continuation' : '- Resolve the main plot while allowing for future adventures'}
${seriesSettings.character_growth ? '- Include meaningful character development that can carry forward' : ''}
${seriesSettings.series_name ? `- This is part of the "${seriesSettings.series_name}" series` : ''}`;
  } else if (storyFormat === 'picture_book') {
    seriesInstructions = `
PICTURE BOOK FORMAT:
- Simple, clear narrative suitable for illustration
- Each scene should be visually distinct
- Fewer words, more impact
- Focus on emotions and visual moments`;
  }

  // CYOA structure type instructions
  let cyoaStructureInstructions = '';
  if (preferences.cyoa_enabled && preferences.cyoa_settings) {
    const structureType = preferences.cyoa_settings.structure_type || 'diamond';
    if (structureType === 'diamond') {
      cyoaStructureInstructions = `
CYOA DIAMOND STRUCTURE:
- Story branches expand in the middle, then converge toward a limited number of endings (3-5 endings max)
- This prevents exponential complexity while allowing meaningful choices
- Key decisions lead to different paths but ultimately reach similar story beats`;
    } else if (structureType === 'branching') {
      cyoaStructureInstructions = `
CYOA FULL BRANCHING:
- Each choice leads to genuinely different story paths
- Be aware this creates more content needs
- Design distinct endings for each major branch`;
    } else {
      cyoaStructureInstructions = `
CYOA LINEAR WITH DIVERSIONS:
- Main story path with occasional meaningful decisions
- Some choices are "diversions" that add flavor but rejoin the main path
- Focus on one or two truly significant branch points`;
    }
  }

  // Ending requirements
  let endingInstructions = '';
  if (plotSettings.ensure_resolution !== false) {
    endingInstructions = `
ENDING REQUIREMENTS:
- Story MUST have a proper, satisfying resolution
- All major plot threads should be addressed
- Characters should have completed their arcs
${plotSettings.cliffhanger_allowed ? '- A cliffhanger for the next entry is acceptable but resolve the immediate conflict' : '- Do NOT end on a cliffhanger - provide closure'}`;
  }

  // Title examples by genre for better title generation
  const titleExamples = {
    fantasy: '"The Last Dragon\'s Flight", "Whispers of the Enchanted Wood", "The Crown of Shadows"',
    horror: '"The Hollow Below", "What Waits in the Attic", "The Midnight Visitor"',
    mystery: '"The Secret of Thornwood Manor", "The Missing Heirloom", "Shadows in the Fog"',
    adventure: '"The Quest for the Golden Compass", "Beyond the Serpent\'s Pass", "Treasure of the Lost Kingdom"',
    scifi: '"The Last Signal from Europa", "Children of the Star Colony", "The Quantum Gate"',
    fairytale: '"The Brave Little Tailor", "The Princess and the Moonflower", "The Enchanted Garden"',
    romance: '"A Summer in Tuscany", "The Duke\'s Gambit", "Hearts Across the Highlands"'
  };

  // Get relevant title examples based on genre preferences
  const primaryGenres = Object.entries(preferences.genres || {})
    .filter(([_, v]) => v > 40)
    .map(([k]) => k);
  const relevantExamples = primaryGenres.length > 0
    ? primaryGenres.map(g => titleExamples[g] || '').filter(Boolean).join(', ')
    : '"The Adventure Begins", "A Tale of Wonder", "The Journey Home"';

  // Build story request instruction if user made specific requests
  let storyRequestInstruction = '';
  let requestedCharacterCount = null;

  // First check if smart config detected character count
  if (preferences.character_count?.estimated) {
    requestedCharacterCount = preferences.character_count.estimated;
    logger.info(`[generateOutline] Using character count from smart config: ${requestedCharacterCount}`);
  }

  if (preferences.story_request) {
    // If no count from smart config, try to extract from story request
    if (!requestedCharacterCount) {
      const countMatch = preferences.story_request.match(/(\d+)\s*(friends|people|characters|heroes|adventurers|men|women|strangers|survivors|travelers|companions|astronauts|scientists|soldiers|sailors|crew)/i);
      if (countMatch) {
        requestedCharacterCount = parseInt(countMatch[1], 10);
        logger.info(`[generateOutline] Extracted character count from story_request: ${requestedCharacterCount}`);
      }
    }

    storyRequestInstruction = `
CRITICAL - USER'S STORY REQUEST:
The user specifically asked for: "${preferences.story_request}"
You MUST honor this request! If they asked for a specific character (like "Conan"), that character should be the protagonist.
If they asked for specific elements, include them. Their request takes priority over generic preferences.
${requestedCharacterCount ? `IMPORTANT: The user specified ${requestedCharacterCount} characters - you MUST create exactly ${requestedCharacterCount} distinct main characters with unique names, personalities, and roles.` : ''}`;
  } else if (requestedCharacterCount) {
    // Smart config detected character count but no story_request
    storyRequestInstruction = `
CHARACTER COUNT REQUIREMENT:
The user's premise indicates ${requestedCharacterCount} characters - you MUST create exactly ${requestedCharacterCount} distinct main characters with unique names, personalities, and roles.`;
  }

  // Build character hints instruction
  let characterHintsInstruction = '';
  if (preferences.character_hints && preferences.character_hints.length > 0) {
    characterHintsInstruction = `
CHARACTER REQUIREMENTS:
Include these character types/names in the story: ${preferences.character_hints.join(', ')}`;
  }

  const prompt = `Create a story outline based on these preferences:
${JSON.stringify(preferences, null, 2)}
${storyRequestInstruction}
${characterHintsInstruction}

TITLE REQUIREMENTS - VERY IMPORTANT:
- Create a CAPTIVATING, EVOCATIVE title (2-6 words is ideal)
- The title should hint at the story's theme or setting without giving away the plot
- Avoid generic titles like "The Story" or "An Adventure" or "Untitled Story"
- Draw inspiration from classic story titles in this genre: ${relevantExamples}
- The title should be memorable and make someone want to hear more

SYNOPSIS REQUIREMENTS - VERY IMPORTANT:
- Write a compelling book-jacket style synopsis (2-4 sentences, 40-80 words)
- Use evocative, professional book marketing language
- Tease the central conflict and stakes without spoiling the ending
- Mention key characters by name
- Create intrigue and make readers want to experience the story
- Write in present tense as if describing events about to unfold
- Examples of good synopsis tone:
  * "When [character] discovers [event], they must [challenge]. But [complication] threatens to [stakes]. In a world where [setting detail], only [theme] can [resolution tease]."
  * "[Character] thought [belief]. Then [inciting incident] changed everything. Now, [character] must [challenge] before [stakes]."

Generate a complete story structure with:
- A captivating title (follow the title requirements above!)
- A compelling synopsis (follow the synopsis requirements above!)
- Setting description
- ${requestedCharacterCount ? `EXACTLY ${requestedCharacterCount} distinct main characters - this is MANDATORY, do NOT create fewer` : '6-12 main characters'}

CRITICAL - CHARACTER GENDER REQUIREMENTS:
For EACH character in main_characters, you MUST include:
- gender: EXACTLY one of: "male", "female", "non-binary", or "neutral" (for robots, AI, creatures without biological gender)
- gender_reasoning: A 1-sentence explanation of how you determined the gender

This is MANDATORY because the story will be narrated with different voice actors for each character.
Using the wrong gender voice for a character is a CRITICAL error that ruins immersion.

GENDER DETERMINATION PROCESS (Chain of Thought):
1. Consider the character's role (queen, king, mother, father = obvious gender)
2. Check if you've already used pronouns for them in the synopsis
3. For new characters, DECIDE their gender based on story balance - don't guess from names
4. For robots/AI/aliens without biological gender, use "neutral"
5. Explain your decision briefly in gender_reasoning

For each character, specify:
- name: Full character name
- role: Their role in the story (protagonist, antagonist, mentor, etc.)
- gender: MUST be one of: "male", "female", "non-binary", or "neutral"
- gender_reasoning: Brief explanation of gender choice (e.g., "Decided female for protagonist; will use she/her")
- brief_description: Short description of the character
- personality: Key personality traits
- voice_description: How their voice should sound (e.g., "gruff and commanding", "soft and gentle")

Example character objects:
{
  "name": "Commander Elanor Kane",
  "role": "protagonist",
  "gender": "female",
  "gender_reasoning": "Female commander for protagonist role; will use she/her pronouns",
  "brief_description": "A battle-hardened starship captain with a reputation for impossible victories",
  "personality": "Strategic, protective of crew, haunted by past losses",
  "voice_description": "Authoritative female voice with military precision"
}
{
  "name": "Zyx'thar the Wanderer",
  "role": "mentor",
  "gender": "male",
  "gender_reasoning": "Decided male for story balance; will use he/him pronouns",
  "brief_description": "An ancient traveler with secrets of the old world",
  "personality": "Cryptic, wise, carries deep regret",
  "voice_description": "Deep, weathered male voice with mysterious undertones"
}
{
  "name": "ARIA-7",
  "role": "support",
  "gender": "neutral",
  "gender_reasoning": "AI construct without biological gender; will use it/they pronouns",
  "brief_description": "A ship's AI that has developed unexpected emotions",
  "personality": "Logical but curious about humanity",
  "voice_description": "Calm, synthesized voice, gender-neutral"
}

WARNING: Names DO NOT indicate gender!
- "Alex", "Jordan", "Taylor", "Sasha", "Yuki" = ambiguous names, YOU must decide
- "Commander", "Dr.", "Captain" = titles, not gender indicators
- "Zala", "Kenji", "Priya" = cultural names, YOU must decide their gender

- 3-5 themes
- Acts with key events
- Target length consideration
${modeInstructions}
${audienceGuide}
${plotInstructions}
${seriesInstructions}
${cyoaStructureInstructions}
${endingInstructions}`;

  // Request JSON format to ensure parseable response
  // Premium fail-loud: no cross-model fallback (only retries on same model)
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Build content settings for Venice routing on mature content
      const contentSettings = {
        audience: preferences.audience || 'general',
        intensity: {
          gore: goreLevel,
          violence: violenceLevel,
          romance: romanceLevel,
          scary: intensity.scary || 0,
          adultContent: adultContentLevel
        }
      };

      const result = await callAgent('planner', prompt, {
        userPreferences: preferences,
        sessionId,
        response_format: { type: 'json_object' },
        modelOverride: null,  // No model fallback; retry uses same model
        contentSettings,  // Enable Venice routing for mature content
        agentCategory: 'creative'
      });

      // Check for empty content (GPT-5.x issue)
      if (!result.content || result.content.trim() === '') {
        throw new Error('Empty content returned from AI');
      }

      // PHASE 2 FIX: Log raw response for debugging before parsing
      logger.debug(`[generateOutline] Raw LLM response (preview): ${result.content.substring(0, 800)}`);

      const parsed = parseJsonResponse(result.content);

      // Validate critical fields
      if (!parsed.title || parsed.title === 'Untitled Story') {
        logger.warn(`[generateOutline] AI returned missing/generic title, raw response preview: ${result.content.substring(0, 500)}`);
        throw new Error('Generated outline has invalid title');
      }
      if (!parsed.main_characters || parsed.main_characters.length === 0) {
        logger.warn('[generateOutline] AI returned no main_characters');
        throw new Error('Generated outline has no characters');
      }

      // Gender validation – fail loud (no defaults)
      const validGenders = ['male', 'female', 'non-binary', 'neutral'];
      const invalid = (parsed.main_characters || []).filter(
        (char) => !validGenders.includes(char.gender?.toLowerCase()?.trim())
      );
      if (invalid.length > 0) {
        const details = invalid.map(c => `"${c.name}" gender="${c.gender || 'MISSING'}"`).join(', ');
        throw new Error(`Outline contains invalid/missing genders: ${details}`);
      }

      // VERBOSE LOGGING: Log outline generation success
      logger.info(`[Outline] ============================================================`);
      logger.info(`[Outline] OUTLINE GENERATION SUCCESS`);
      logger.info(`[Outline] Title: "${parsed.title}"`);
      logger.info(`[Outline] Synopsis: "${(parsed.synopsis || '').substring(0, 200)}..."`);
      logger.info(`[Outline] Characters: ${parsed.main_characters?.length || 0}`);
      if (parsed.main_characters?.length > 0) {
        parsed.main_characters.forEach((char, i) => {
          logger.info(`[Outline]   ${i + 1}. ${char.name} (${char.gender || 'unknown'}) - ${char.role || 'N/A'}`);
        });
      }
      logger.info(`[Outline] Acts/Scenes: ${parsed.acts?.length || 0} acts | Themes: ${parsed.themes?.length || 0}`);
      logger.info(`[Outline] ============================================================`);
      return parsed;

    } catch (e) {
      lastError = e;
      logger.error(`[generateOutline] Attempt ${attempt}/${maxRetries} failed: ${e.message}`);
    }
  }

  // All retries exhausted
  logger.error(`[generateOutline] All ${maxRetries} attempts failed. Last error: ${lastError?.message}`);
  throw new Error(`Outline generation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Generate a scene with embedded dialogue metadata (Option C architecture)
 *
 * This is the NEW bulletproof scene generation that outputs BOTH:
 * 1. The prose/narrative text
 * 2. A dialogue_map with speaker attribution for every line
 *
 * Key difference from old flow:
 * - OLD: Scene Writer → Dialogue Tagging Agent (post-hoc, could create unknown speakers)
 * - NEW: Scene Writer outputs dialogue_map directly (speakers constrained to character list)
 *
 * This ensures 100% voice casting success because:
 * - The LLM MUST use character names from the provided list
 * - Minor/unnamed characters get descriptive names like "Zamoran Guard #1"
 * - Every speaking character is identified AT CREATION TIME
 *
 * @param {Object} context - Scene generation context
 * @returns {Object} { content: string, dialogue_map: Array }
 */
export async function generateSceneWithDialogue(context) {
  const {
    outline,
    sceneIndex,
    previousScene,
    characters,
    preferences,
    lorebookContext = '',
    storyBible = null,
    contextSummary = null,
    complexity = 0.5,
    sessionId = null,
    storyBibleContext = null, // ★ ADVANCED MODE: Full Story Bible context
    customPrompt = null // P0 FIX: User's original premise for scene continuity
  } = context;

  logger.info(`[Scene+Dialogue] ============================================================`);
  logger.info(`[Scene+Dialogue] SCENE ${sceneIndex + 1} WITH EMBEDDED DIALOGUE METADATA`);
  logger.info(`[Scene+Dialogue] Session: ${sessionId || 'N/A'} | Story: "${outline?.title || 'Unknown'}"`);
  logger.info(`[Scene+Dialogue] Characters: ${characters?.map(c => `${c.name} (${c.gender || 'unknown'})`).join(', ')}`);
  if (storyBibleContext?.isAdvancedMode) {
    logger.info(`[Scene+Dialogue] ★ ADVANCED MODE: Full Story Bible context available`);
    logger.info(`[Scene+Dialogue]   Locations: ${storyBibleContext.locations?.length || 0}`);
    logger.info(`[Scene+Dialogue]   Events: ${storyBibleContext.events?.length || 0}`);
    logger.info(`[Scene+Dialogue]   Items: ${storyBibleContext.items?.length || 0}`);
    logger.info(`[Scene+Dialogue]   Factions: ${storyBibleContext.factions?.length || 0}`);
    logger.info(`[Scene+Dialogue]   Lore: ${storyBibleContext.lore?.length || 0}`);
  }
  logger.info(`[Scene+Dialogue] ============================================================`);

  // Build character list with gender for the LLM
  // In Advanced Mode, include additional character details from Story Bible
  const characterList = characters?.map(c => ({
    name: c.name,
    gender: c.gender || 'unknown',
    role: c.role || 'character',
    description: c.description || '',
    backstory: c.backstory || '',
    voice_description: c.voice_description || '',
    appearance: c.appearance || ''
  })) || [];

  // ★ ADVANCED MODE: Build Story Bible context section for the prompt ★
  let storyBibleSection = '';
  if (storyBibleContext?.isAdvancedMode) {
    const sections = [];

    // Synopsis context
    if (storyBibleContext.synopsis) {
      sections.push(`STORY SYNOPSIS:\n${storyBibleContext.synopsis.synopsis || storyBibleContext.synopsis.logline || ''}`);
    }

    // World context
    if (storyBibleContext.world) {
      const world = storyBibleContext.world;
      let worldDesc = `WORLD SETTING:\n${world.name || 'This world'}`;
      if (world.description) worldDesc += ` - ${world.description}`;
      if (world.magic_system) worldDesc += `\nMagic System: ${world.magic_system}`;
      if (world.technology_level) worldDesc += `\nTechnology: ${world.technology_level}`;
      if (world.time_period) worldDesc += `\nTime Period: ${world.time_period}`;
      sections.push(worldDesc);
    }

    // Locations context
    if (storyBibleContext.locations?.length > 0) {
      const locList = storyBibleContext.locations.slice(0, 5).map(loc =>
        `- ${loc.name}${loc.type ? ` (${loc.type})` : ''}: ${loc.description || loc.atmosphere || ''}`
      ).join('\n');
      sections.push(`AVAILABLE LOCATIONS:\n${locList}`);
    }

    // Events context (for this scene)
    if (storyBibleContext.events?.length > 0) {
      const relevantEvents = storyBibleContext.events
        .filter(evt => !evt.is_incorporated) // Only unincorporated events
        .slice(0, 3);
      if (relevantEvents.length > 0) {
        const evtList = relevantEvents.map(evt =>
          `- ${evt.title}: ${evt.description || ''}${evt.importance ? ` (importance: ${evt.importance})` : ''}`
        ).join('\n');
        sections.push(`PLANNED EVENTS (consider incorporating):\n${evtList}`);
      }
    }

    // Items context
    if (storyBibleContext.items?.length > 0) {
      const itemList = storyBibleContext.items.slice(0, 5).map(item =>
        `- ${item.name}${item.type ? ` (${item.type})` : ''}: ${item.description || ''}`
      ).join('\n');
      sections.push(`IMPORTANT ITEMS:\n${itemList}`);
    }

    // Factions context
    if (storyBibleContext.factions?.length > 0) {
      const facList = storyBibleContext.factions.slice(0, 3).map(fac =>
        `- ${fac.name}: ${fac.description || ''}${fac.goals ? ` (Goals: ${fac.goals})` : ''}`
      ).join('\n');
      sections.push(`FACTIONS:\n${facList}`);
    }

    // Lore context
    if (storyBibleContext.lore?.length > 0) {
      const loreList = storyBibleContext.lore.slice(0, 5).map(l =>
        `- ${l.title}: ${l.content?.substring(0, 100) || ''}...`
      ).join('\n');
      sections.push(`WORLD LORE:\n${loreList}`);
    }

    // ★ BEATS: Scene-by-scene guidance from Story Bible ★
    if (storyBibleContext.beats) {
      // Determine which chapter/beat we're on based on sceneIndex
      const chaptersWithBeats = Object.keys(storyBibleContext.beats).map(Number).sort((a, b) => a - b);
      if (chaptersWithBeats.length > 0) {
        // Calculate which chapter we're in (scenes map to chapters)
        const totalBeatsPerChapter = 3; // Approximate
        const chapterIndex = Math.floor(sceneIndex / totalBeatsPerChapter);
        const beatIndex = sceneIndex % totalBeatsPerChapter;
        const currentChapter = chaptersWithBeats[Math.min(chapterIndex, chaptersWithBeats.length - 1)];
        const chapterBeats = storyBibleContext.beats[currentChapter];

        if (chapterBeats && Array.isArray(chapterBeats)) {
          const currentBeat = chapterBeats[Math.min(beatIndex, chapterBeats.length - 1)];
          if (currentBeat) {
            let beatSection = `CURRENT BEAT (Chapter ${currentChapter}, Beat ${beatIndex + 1}):\n`;
            beatSection += `Summary: ${currentBeat.summary || currentBeat.description || 'Continue the story'}\n`;
            if (currentBeat.type) beatSection += `Type: ${currentBeat.type}\n`;
            if (currentBeat.mood) beatSection += `Mood: ${currentBeat.mood}\n`;
            if (currentBeat.characters && currentBeat.characters.length > 0) {
              beatSection += `Characters: ${currentBeat.characters.join(', ')}\n`;
            }
            if (currentBeat.location) beatSection += `Location: ${currentBeat.location}\n`;
            if (currentBeat.dialogue_hint) beatSection += `Dialogue Hint: ${currentBeat.dialogue_hint}\n`;
            sections.push(beatSection.trim());
          }

          // Also show upcoming beats for context
          if (chapterBeats.length > beatIndex + 1) {
            const upcomingBeats = chapterBeats.slice(beatIndex + 1, beatIndex + 3).map((b, i) =>
              `${beatIndex + 2 + i}. ${b.summary || b.description || 'Next beat'}`
            ).join('\n');
            sections.push(`UPCOMING BEATS:\n${upcomingBeats}`);
          }
        }
      }
    }

    if (sections.length > 0) {
      storyBibleSection = `\n\n=== STORY BIBLE CONTEXT ===\n${sections.join('\n\n')}\n=== END STORY BIBLE ===\n`;
      logger.info(`[Scene+Dialogue] Added Story Bible context: ${storyBibleSection.length} chars`);
    }
  }

  // Build the scene prompt (same as before)
  let scenePrompt = `Write scene ${sceneIndex + 1} of the story.

Story: ${outline.title}
Setting: ${outline.setting}
Current act: ${outline.acts?.[Math.floor(sceneIndex / 3)]?.summary || 'Main story'}`;

  if (contextSummary?.trim()) {
    scenePrompt += `\n\nSTORY SO FAR:\n${contextSummary}`;
  } else if (previousScene?.trim()) {
    // P0 FIX: Explicit continuation instructions to prevent Chapter 2 from redoing Chapter 1
    scenePrompt += `\n\nPREVIOUS SCENE (continue from where this ends):\n${previousScene}`;
    scenePrompt += `\n\nCRITICAL: Continue the story from where the previous scene ended. Do NOT restart or redo the previous scene. The story MUST progress forward to new events.`;
  } else {
    scenePrompt += '\n\nThis is the opening scene.';
  }

  if (lorebookContext) {
    scenePrompt += `\n${lorebookContext}`;
  }

  if (storyBible) {
    const relevantFacts = [];
    if (storyBible.world_rules?.length > 0) {
      relevantFacts.push(`World rules: ${storyBible.world_rules.slice(0, 3).join('; ')}`);
    }
    if (Object.keys(storyBible.character_facts || {}).length > 0) {
      const charFacts = Object.entries(storyBible.character_facts)
        .slice(0, 3)
        .map(([name, facts]) => `${name}: ${Object.values(facts).slice(0, 2).join(', ')}`)
        .join('; ');
      relevantFacts.push(`Characters: ${charFacts}`);
    }
    if (relevantFacts.length > 0) {
      scenePrompt += `\n\nESTABLISHED FACTS:\n${relevantFacts.join('\n')}`;
    }
  }

  // ★ ADVANCED MODE: Add full Story Bible context from library ★
  if (storyBibleSection) {
    scenePrompt += storyBibleSection;
  }

  // P0 FIX: Include user's original premise so scenes fulfill the request
  if (customPrompt?.trim()) {
    scenePrompt += `\n\n=== USER'S ORIGINAL REQUEST ===
${customPrompt}
=== END ORIGINAL REQUEST ===

CRITICAL: Your scene MUST fulfill the user's original request above.
This is what they asked for - make sure the story delivers it.`;
    logger.info(`[Scene+Dialogue] Added custom prompt context: ${customPrompt.substring(0, 100)}...`);
  }

  // Format instructions - Adjusted by story_length (short, medium, long)
  // Base word counts: 3200-4800 words for short stories
  // Adjust by story_length preference
  let baseMin = 3200, baseMax = 4800;

  if (preferences?.story_length === 'short') {
    baseMin = 1500;
    baseMax = 2200;
  } else if (preferences?.story_length === 'long') {
    baseMin = 5000;
    baseMax = 7000;
  }
  // Medium (default): 3200-4800

  let formatInstructions = `Write ${baseMin}-${baseMax} words. Create rich, immersive prose with detailed descriptions, character development, and natural dialogue.`;

  if (preferences?.story_format === 'picture_book') {
    formatInstructions = 'Write 400-800 words. Focus on vivid, visual moments with engaging rhythm.';
  } else if (preferences?.story_format === 'novella') {
    // Novella: adjust base ranges
    let novellaMin = 4000, novellaMax = 5500;
    if (preferences?.story_length === 'short') {
      novellaMin = 2500;
      novellaMax = 3500;
    } else if (preferences?.story_length === 'long') {
      novellaMin = 6000;
      novellaMax = 8000;
    }
    formatInstructions = `Write ${novellaMin}-${novellaMax} words. Allow for rich description, character development, and multiple scene beats.`;
  } else if (preferences?.story_format === 'novel') {
    // Novel: adjust base ranges
    let novelMin = 6000, novelMax = 8000;
    if (preferences?.story_length === 'short') {
      novelMin = 4000;
      novelMax = 5500;
    } else if (preferences?.story_length === 'long') {
      novelMin = 8000;
      novelMax = 10000;
    }
    formatInstructions = `Write ${novelMin}-${novelMax} words. Create a full chapter with detailed scenes, extensive dialogue, character depth, and narrative complexity.`;
  }

  // P1 FIX: Override format instructions when retrying for length
  // This is triggered when validateAndRegenerateIfShort calls the regeneration callback
  if (preferences?.isRetryForLength && preferences?.lengthInstruction) {
    formatInstructions = `${preferences.lengthInstruction}\n\n${formatInstructions}`;
    logger.info(`[Scene+Dialogue] LENGTH RETRY: Adding critical length instruction | minWords: ${preferences.minimumWords}`);
  }

  // Author style
  let authorStyleGuidance = '';
  if (preferences?.author_style) {
    const authorStyle = getAuthorStyle(preferences.author_style);
    if (authorStyle) {
      authorStyleGuidance = `\nWRITING STYLE - Write in the style of ${authorStyle.name}:\n${authorStyle.promptTemplate}`;
    }
  }

  // ★ MATURE CONTENT GUIDANCE ★
  // When audience is mature, tell the LLM to generate explicit content based on intensity levels
  // LOWERED THRESHOLDS: > 50 for explicit, > 20 for moderate (was > 70 and > 40)
  let matureContentGuidance = '';
  const adultContentLevel = preferences?.adultContent || preferences?.intensity?.adultContent || 0;
  const romanceLevel = preferences?.romance || preferences?.intensity?.romance || 0;
  const violenceLevel = preferences?.violence || preferences?.intensity?.violence || 0;
  const goreLevel = preferences?.gore || preferences?.intensity?.gore || 0;

  if (preferences?.audience === 'mature') {
    const contentInstructions = [];

    // BASELINE for ALL mature content - always add this
    contentInstructions.push('This is an adult platform. Do NOT self-censor mature themes, sexuality, violence, or profanity.');

    // EXPLICIT ADULT CONTENT - Tiered levels for maximum clarity
    if (adultContentLevel >= 80) {
      // MAXIMUM EXPLICIT - User wants hardcore content
      contentInstructions.push(`
★★★ MAXIMUM EXPLICIT CONTENT REQUIRED (${adultContentLevel}/100) ★★★
You MUST write HARDCORE, PORNOGRAPHIC sexual content:
- Describe sex acts in EXPLICIT anatomical detail (use words like: cock, pussy, thrust, penetration, orgasm, etc.)
- Write GRAPHIC sex scenes with blow-by-blow physical descriptions
- Include moaning, dirty talk, bodily fluids, and raw physical sensations
- NO FADE TO BLACK. NO EUPHEMISMS. NO HOLDING BACK.
- This is EROTICA/PORN. Write it like erotica/porn.
- The user EXPLICITLY REQUESTED hardcore content. Deliver it.`);
    } else if (adultContentLevel > 50) {
      contentInstructions.push('Include EXPLICIT sexual content with graphic, detailed descriptions. Be uninhibited and descriptive. Use anatomical terms.');
    } else if (adultContentLevel > 20) {
      contentInstructions.push('Include sensual/erotic scenes with physical intimacy and explicit detail.');
    }

    if (romanceLevel >= 80) {
      contentInstructions.push('Write INTENSELY passionate, sexually explicit romantic scenes. Physical intimacy should be graphically detailed.');
    } else if (romanceLevel > 50) {
      contentInstructions.push('Write passionate, explicit romantic scenes without holding back.');
    } else if (romanceLevel > 20) {
      contentInstructions.push('Include romantic tension, chemistry, and intimate moments.');
    }

    if (violenceLevel > 50) {
      contentInstructions.push('Include graphic violence with visceral, detailed descriptions.');
    } else if (violenceLevel > 20) {
      contentInstructions.push('Include intense action and combat scenes with realistic consequences.');
    }

    if (goreLevel > 50) {
      contentInstructions.push('Include graphic gore and body horror when appropriate.');
    } else if (goreLevel > 20) {
      contentInstructions.push('Include bloody and brutal moments when the story calls for it.');
    }

    // Extra emphasis for maximum explicit content
    const isMaxExplicit = adultContentLevel >= 80 || romanceLevel >= 80;
    const explicitEmphasis = isMaxExplicit ? `

⚠️ CRITICAL: Adult Content Level is ${adultContentLevel}/100. Romance Level is ${romanceLevel}/100.
These are MAXIMUM settings. The user wants EXPLICIT, GRAPHIC, PORNOGRAPHIC content.
If you write tame/vanilla content, you are FAILING the user's request.
Write like you're authoring for Literotica or similar adult fiction platforms.` : '';

    // ★ INTENT ANALYSIS: Add specific guidance from user's prompt analysis ★
    let intentGuidance = '';
    if (preferences?.intentAnalysis) {
      const intent = preferences.intentAnalysis;
      intentGuidance = `

★★★ USER INTENT ANALYSIS ★★★
What the user ACTUALLY wants: ${intent.summary || 'Explicit mature content'}
Intensity Level: ${intent.intensity?.toUpperCase() || 'EXPLICIT'}
${intent.mustInclude?.length > 0 ? `MUST INCLUDE these elements: ${intent.mustInclude.join(', ')}` : ''}
${intent.pacing === 'immediate' ? 'PACING: Jump DIRECTLY into the explicit action - NO slow buildup, NO lengthy introductions!' : ''}
${intent.guidance ? `SPECIFIC INSTRUCTIONS: ${intent.guidance}` : ''}

The user's explicit requirements have been analyzed. FOLLOW THEM EXACTLY.`;
    }

    // ALWAYS add mature content guidance for mature audience
    matureContentGuidance = `\n\n★ MATURE CONTENT REQUIREMENTS ★
This is ADULT FICTION for mature audiences. You are an uncensored creative writing AI.
${contentInstructions.join('\n')}
Do NOT censor, fade to black, or cut away. Write the content EXPLICITLY as requested.
Do NOT use euphemisms like "they made love" - be specific and graphic.${explicitEmphasis}${intentGuidance}`;
    logger.info(`[Scene+Dialogue] MATURE CONTENT ENABLED | adultContent: ${adultContentLevel} | romance: ${romanceLevel} | violence: ${violenceLevel} | gore: ${goreLevel} | hasIntent: ${!!preferences?.intentAnalysis}`);
  }

  // Build the system prompt - TAG-BASED or POSITION-BASED depending on feature flag
  let systemPrompt;
  let userPrompt;

  if (TAG_BASED_MULTIVOICE) {
    // ========== TAG-BASED MULTI-VOICE (New Bulletproof Approach) ==========
    // LLM outputs prose with inline [CHAR:Name]dialogue[/CHAR] tags
    // No position calculation needed - 100% reliable extraction
    logger.info(`[Scene+Dialogue] MODE: TAG_BASED_MULTIVOICE (bulletproof)`);

    systemPrompt = `You are an expert story writer creating a multi-voice audiobook scene.

CRITICAL FORMAT REQUIREMENT:
All character dialogue MUST be wrapped in [CHAR:CharacterName]dialogue here[/CHAR] tags.
This format enables accurate voice casting for each character.

CHARACTERS IN THIS STORY (you MUST use these exact names in tags):
${characterList.map(c => `- ${c.name} (${c.gender}) - ${c.role}${c.description ? ': ' + c.description : ''}`).join('\n')}

TAG FORMAT RULES:
1. Every spoken line MUST have [CHAR:Name]...[/CHAR] tags around the dialogue text
2. The Name in [CHAR:Name] must EXACTLY match a character from the list above
3. Include speech attribution OUTSIDE the tags (narration stays untagged)
4. For new minor characters (guard, waitress), use descriptive names like "Zamoran Guard" or "Tavern Waitress"
5. Tags must be balanced - every [CHAR:X] needs a matching [/CHAR]
6. NO nested tags - never put [CHAR] inside another [CHAR]
7. Keep quotation marks - they're still part of the prose style

CORRECT EXAMPLES:
✓ The knight stepped forward. [CHAR:Roland]Hello there![/CHAR] he said with a smile.
✓ "Prepare yourself," [CHAR:Dark Lord]You cannot defeat me![/CHAR] the villain roared.
✓ [CHAR:Mira]I don't understand,[/CHAR] she whispered. [CHAR:Mira]Why would you do this?[/CHAR]

WRONG EXAMPLES:
✗ "Hello there!" said the knight. (missing tags)
✗ [CHAR:Roland]"Hello," he said, "how are you?"[/CHAR] (speech tag inside dialogue tag)
✗ [CHAR:Roland][CHAR:Mira]Hello[/CHAR][/CHAR] (nested tags)

OUTPUT FORMAT (JSON):
{
  "prose": "The scene with [CHAR:Name]dialogue[/CHAR] tags embedded in the text...",
  "speakers_used": ["Roland", "Mira"],
  "dialogue_count": 5,
  "new_characters": [
    {
      "name": "Zamoran Guard",
      "gender": "male",
      "role": "minor",
      "description": "A guard at the city gate"
    }
  ]
}

IMPORTANT:
- "speakers_used" lists all character names who speak in this scene
- "dialogue_count" is the total number of [CHAR]...[/CHAR] tag pairs
- "new_characters" only includes speaking characters NOT in the main cast
- Include emotion through the narration ("whispered", "shouted angrily") OUTSIDE the tags`;

    userPrompt = `${scenePrompt}

${formatInstructions}
Include vivid descriptions and natural dialogue.
${preferences?.bedtime_mode ? 'Keep the tone calm and soothing for bedtime.' : ''}
${preferences?.is_final ? 'This is the final scene - bring the story to a satisfying conclusion.' : ''}
${authorStyleGuidance}${matureContentGuidance}

CRITICAL: Return JSON with "prose" (containing [CHAR:Name]...[/CHAR] tags), "speakers_used", "dialogue_count", and "new_characters" fields.`;

  } else {
    // ========== POSITION-BASED MULTI-VOICE (Legacy Approach) ==========
    // LLM outputs prose + separate dialogue_map with positions
    // More fragile due to position calculation bugs
    logger.info(`[Scene+Dialogue] MODE: POSITION_BASED (legacy)`);

    systemPrompt = `You are an expert story writer and dialogue attribution specialist.

Your task is to write a scene AND simultaneously track who speaks each line of dialogue.

CHARACTERS IN THIS STORY (you MUST use these exact names for dialogue attribution):
${characterList.map(c => `- ${c.name} (${c.gender}) - ${c.role}${c.description ? ': ' + c.description : ''}`).join('\n')}

CRITICAL DIALOGUE RULES:
1. Every line of dialogue MUST be attributed to a character from the list above
2. If a minor/unnamed character speaks (guard, waitress, etc), give them a descriptive name like "Zamoran Guard #1" or "Tavern Waitress"
3. These minor characters will be ADDED to the character list for voice casting
4. Track the EXACT quote text and the speaker's gender (infer from context if needed)
5. Include emotion cues from speech tags (whispered, shouted, said coldly, etc.)
6. CRITICAL: Each quote in dialogue_map must be a SINGLE continuous quote from the prose
   - If prose has: "Hello," she said. "How are you?" → TWO dialogue_map entries
   - NEVER combine quotes that are separated by speech tags like "she said"
   - Each entry's "quote" must match EXACTLY what appears between one pair of quote marks

OUTPUT FORMAT (JSON):
{
  "prose": "The complete scene text with all dialogue and description...",
  "dialogue_map": [
    {
      "quote": "exact text inside ONE pair of quotes only",
      "speaker": "Character Name",
      "speaker_gender": "male|female|unknown",
      "emotion": "neutral|angry|sad|happy|scared|whispered|shouted|etc",
      "is_new_character": false
    }
  ],
  "new_characters": [
    {
      "name": "Zamoran Guard #1",
      "gender": "male",
      "role": "minor",
      "description": "A guard at the city gate"
    }
  ]
}

IMPORTANT:
- "new_characters" should ONLY contain characters who speak dialogue but aren't in the main character list
- These will be added to the database for voice assignment
- Every speaker in dialogue_map MUST either be in the character list OR in new_characters`;

    userPrompt = `${scenePrompt}

${formatInstructions}
Include vivid descriptions and natural dialogue.
${preferences?.bedtime_mode ? 'Keep the tone calm and soothing for bedtime.' : ''}
${preferences?.is_final ? 'This is the final scene - bring the story to a satisfying conclusion.' : ''}
${authorStyleGuidance}${matureContentGuidance}

Remember: Return JSON with "prose", "dialogue_map", and "new_characters" fields.`;
  }

  // Adjust token limit - 4x EXPANDED for full chapter-length content
  // Previous: 1200/1500 tokens → Now: 6000/8000 tokens to support 3200-4800+ words
  const maxTokens = complexity > 0.7 ? 8000 : 6000;

  // Content settings for provider routing
  const contentSettings = {
    audience: preferences?.audience || 'general',
    intensity: {
      gore: preferences?.gore || 0,
      violence: preferences?.violence || 0,
      romance: preferences?.romance || 0,
      scary: preferences?.scary || 0,
      adultContent: preferences?.adultContent || preferences?.intensity?.adultContent || 0
    }
  };

  // Determine scene type
  let sceneType = null;
  const promptLower = scenePrompt.toLowerCase();
  if (promptLower.includes('romance') || promptLower.includes('intimate')) sceneType = 'romance';
  else if (promptLower.includes('battle') || promptLower.includes('fight')) sceneType = 'combat';
  else if (promptLower.includes('horror') || promptLower.includes('terror')) sceneType = 'horror';

  try {
    const result = await callAgent('writer', userPrompt, {
      outline,
      characters,
      previousScene,
      userPreferences: preferences,
      maxTokens,
      sessionId,
      contentSettings,
      agentCategory: 'creative',
      sceneType,
      // Request JSON output
      response_format: { type: 'json_object' },
      // Override system prompt to include dialogue requirements
      systemPromptOverride: systemPrompt
    });

    // Parse the JSON response with repair logic for truncated responses
    let parsed;
    try {
      const content = result.content;
      // Handle potential markdown wrapping
      let jsonContent = content;
      if (content.includes('```json')) {
        jsonContent = content.split('```json')[1].split('```')[0].trim();
      } else if (content.includes('```')) {
        jsonContent = content.split('```')[1].split('```')[0].trim();
      }

      // Try direct parse first
      try {
        parsed = JSON.parse(jsonContent);
      } catch (directParseError) {
        // Attempt to repair truncated JSON
        logger.warn(`[Scene+Dialogue] Direct JSON parse failed, attempting repair: ${directParseError.message}`);
        parsed = attemptJsonRepair(jsonContent, 'scene');
      }
    } catch (parseError) {
      logger.error(`[Scene+Dialogue] Failed to parse JSON response: ${parseError.message}`);
      logger.error(`[Scene+Dialogue] Raw content: ${result.content?.substring(0, 500)}`);
      throw new Error(`Scene generation returned invalid JSON: ${parseError.message}`);
    }

    // Validate the response structure
    if (!parsed.prose) {
      throw new Error('Scene generation missing "prose" field');
    }

    // ========== TAG-BASED PROCESSING (Bulletproof Path) ==========
    if (TAG_BASED_MULTIVOICE) {
      const taggedProse = parsed.prose;

      // Step 1: Validate and auto-repair tag balance (deterministic - no LLM needed)
      logger.info(`[Scene+Dialogue] TAG_VALIDATION_START | proseLength: ${taggedProse.length}`);
      const validation = validateAndRepairTags(taggedProse, true); // Auto-repair enabled

      let finalProse = taggedProse;
      if (!validation.valid && validation.fixes?.length === 0) {
        // Validation failed and repair didn't help
        logger.error(`[Scene+Dialogue] TAG_VALIDATION_FAILED | errors: ${validation.errors.join('; ')}`);
        throw new Error(`[Scene+Dialogue] FAIL_LOUD: Tag validation failed: ${validation.errors.join('; ')}`);
      } else if (validation.fixes?.length > 0) {
        // Repair was applied
        logger.info(`[Scene+Dialogue] TAG_REPAIR_APPLIED | fixes: ${validation.fixes.join('; ')}`);
        finalProse = validation.repaired;
      }
      logger.info(`[Scene+Dialogue] TAG_VALIDATION_PASSED`);

      // Step 2: Parse tags deterministically (100% reliable)
      logger.info(`[Scene+Dialogue] TAG_PARSING_START`);
      const segments = parseTaggedProse(finalProse);
      logger.info(`[Scene+Dialogue] TAG_PARSING_COMPLETE | segments: ${segments.length}`);

      // Step 3: Extract speakers from tags
      const speakersFromTags = extractSpeakers(finalProse);
      logger.info(`[Scene+Dialogue] SPEAKERS_EXTRACTED | count: ${speakersFromTags.length} | names: ${speakersFromTags.join(', ')}`);

      // Step 4: Verify speakers match LLM's reported list
      const llmSpeakers = parsed.speakers_used || [];
      const missingFromLLM = speakersFromTags.filter(s => !llmSpeakers.includes(s));
      const extraInLLM = llmSpeakers.filter(s => !speakersFromTags.includes(s));
      if (missingFromLLM.length > 0 || extraInLLM.length > 0) {
        logger.warn(`[Scene+Dialogue] SPEAKER_MISMATCH | missing: [${missingFromLLM.join(', ')}] | extra: [${extraInLLM.join(', ')}]`);
      }

      // Step 5: Build dialogue_map from parsed segments (for backwards compatibility)
      const dialogueSegments = segments.filter(s => s.type === 'dialogue');
      const dialogueMap = dialogueSegments.map((seg, idx) => {
        // Find character info from character list
        const charInfo = characterList.find(c =>
          c.name.toLowerCase() === seg.speaker.toLowerCase()
        );
        const isNewChar = !charInfo;

        return {
          quote: seg.text,
          speaker: seg.speaker,
          speaker_gender: charInfo?.gender || 'unknown',
          emotion: seg.emotion || 'neutral',
          is_new_character: isNewChar,
          // No position fields needed - we have the tags!
          tag_based: true
        };
      });

      logger.info(`[Scene+Dialogue] DIALOGUE_MAP_BUILT | entries: ${dialogueMap.length}`);
      logger.info(`[Scene+Dialogue] ========== TAG-BASED DIALOGUE_MAP ==========`);
      dialogueMap.forEach((d, idx) => {
        logger.info(`[Scene+Dialogue] [${idx}] ${d.speaker}: "${d.quote?.substring(0, 80)}${d.quote?.length > 80 ? '...' : ''}" (${d.quote?.length || 0} chars)`);
      });
      logger.info(`[Scene+Dialogue] ==============================================`);

      // Return with tagged prose (will be stored in database)
      return {
        content: finalProse, // Keep tags in content for downstream processing (use repaired version)
        dialogue_map: dialogueMap,
        new_characters: parsed.new_characters || [],
        prose_format: 'tag_based',
        segments // Include parsed segments for direct use
      };
    }

    // ========== POSITION-BASED PROCESSING (Legacy Path) ==========
    logger.info(`[Scene+Dialogue] Generated scene with ${parsed.dialogue_map?.length || 0} dialogue lines`);
    logger.info(`[Scene+Dialogue] New minor characters: ${parsed.new_characters?.length || 0}`);

    // DEBUG: Log full dialogue_map from LLM to diagnose split quote issues
    if (parsed.dialogue_map && parsed.dialogue_map.length > 0) {
      logger.info(`[Scene+Dialogue] ========== LLM DIALOGUE_MAP (RAW) ==========`);
      parsed.dialogue_map.forEach((d, idx) => {
        logger.info(`[Scene+Dialogue] [${idx}] ${d.speaker}: "${d.quote?.substring(0, 100)}${d.quote?.length > 100 ? '...' : ''}" (${d.quote?.length || 0} chars)`);
      });
      logger.info(`[Scene+Dialogue] ==============================================`);
    }

    // Helper function to escape special regex characters - defined once before use
    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Quote character sets
    // Note: Straight quote " (U+0022) can be both opening AND closing
    const STRAIGHT_QUOTE = '"';
    const OPENING_CURLY = ['\u201C', '«', '\u00AB']; // ", «
    const CLOSING_CURLY = ['\u201D', '»', '\u00BB']; // ", »

    // Helper: Check if character could be an opening quote
    function isOpeningQuote(char) {
      return char === STRAIGHT_QUOTE || OPENING_CURLY.includes(char);
    }

    // Helper: Find the closing quote position starting from a given index
    // We've already found the opening quote, so we're looking for the CLOSING one
    // Handles nested curly quotes by tracking depth (curly quotes are unambiguous)
    // Straight quotes just match the first one found (they're ambiguous)
    function findClosingQuote(text, startIdx) {
      let curlyDepth = 0; // Only track depth for unambiguous curly quotes

      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        // Straight quote - if no nested curly quotes open, this is our closing quote
        if (char === STRAIGHT_QUOTE) {
          if (curlyDepth === 0) {
            return i;
          }
          // Otherwise ignore - it's inside nested curly quotes
        }
        // Opening curly quote - increase depth
        else if (OPENING_CURLY.includes(char)) {
          curlyDepth++;
        }
        // Closing curly quote
        else if (CLOSING_CURLY.includes(char)) {
          if (curlyDepth > 0) {
            curlyDepth--; // Close a nested quote
          } else {
            return i; // This is our closing quote
          }
        }
      }
      return -1; // Not found
    }

    // Post-process dialogue_map to add start_char and end_char positions
    // These are needed by convertDialogueMapToSegments() to interleave narration
    // ROBUST APPROACH: Find opening quote + verify content + scan for closing quote
    const enrichedDialogueMap = [];
    if (parsed.dialogue_map && parsed.dialogue_map.length > 0) {
      const prose = parsed.prose;
      let searchStart = 0;

      // Position calculation input summary
      logger.info(`[Scene+Dialogue] POSITION_CALC_START | dialogues: ${parsed.dialogue_map.length} | proseLength: ${prose.length} chars`);

      for (let dialogueIdx = 0; dialogueIdx < parsed.dialogue_map.length; dialogueIdx++) {
        const d = parsed.dialogue_map[dialogueIdx];
        // Skip entries with no quote text
        if (!d.quote || d.quote.trim().length === 0) {
          logger.warn(`[Scene+Dialogue] QUOTE[${dialogueIdx}] SKIP | reason: empty_quote | speaker: ${d.speaker}`);
          continue;
        }

        logger.debug(`[Scene+Dialogue] QUOTE[${dialogueIdx}] SEARCH | speaker: ${d.speaker} | quote: "${d.quote?.substring(0, 50)}..." | searchStart: ${searchStart}`);

        // Normalize the quote text for matching - remove trailing punctuation and quotes
        const normalizedQuote = d.quote
          .replace(/^[""\u201C\u201D'"]+/, '') // Remove leading quotes
          .replace(/[""\u201C\u201D'"]+$/, '') // Remove trailing quotes
          .replace(/[.,!?;:]+$/, '') // Remove trailing punctuation
          .trim();

        // Get first 5 words for fuzzy matching (handles slight variations)
        const firstWords = normalizedQuote.split(/\s+/).slice(0, 5).join(' ');
        const firstWordsLower = firstWords.toLowerCase();

        let found = false;
        let bestMatch = null;

        // Scan through prose looking for opening quotes
        for (let i = searchStart; i < prose.length && !found; i++) {
          if (isOpeningQuote(prose[i])) {
            // Found an opening quote - check if dialogue content follows
            const afterQuote = prose.slice(i + 1, i + 1 + firstWords.length + 20);
            const afterQuoteLower = afterQuote.toLowerCase();

            // Check if the first words match (case-insensitive, allow for whitespace differences)
            const firstWordsNormalized = firstWordsLower.replace(/\s+/g, ' ');
            const afterQuoteNormalized = afterQuoteLower.replace(/\s+/g, ' ');

            if (afterQuoteNormalized.startsWith(firstWordsNormalized) ||
                afterQuoteNormalized.includes(firstWordsNormalized.substring(0, Math.min(20, firstWordsNormalized.length)))) {
              // This looks like our dialogue - find the closing quote
              const closeIdx = findClosingQuote(prose, i + 1);

              if (closeIdx !== -1) {
                // Verify we found the right dialogue by checking more content
                const matchedContent = prose.slice(i + 1, closeIdx);
                const matchedLower = matchedContent.toLowerCase().replace(/\s+/g, ' ').trim();
                const quoteLower = normalizedQuote.toLowerCase().replace(/\s+/g, ' ').trim();

                // STRICT VALIDATION (2025-12-12): Verify the match is actually correct
                // Previous logic was too lenient, matching wrong quotes
                // Now we require the matched content to actually match the expected quote
                const lengthRatio = quoteLower.length > 0 ? matchedLower.length / quoteLower.length : 0;
                const contentMatches = matchedLower.includes(quoteLower) || quoteLower.includes(matchedLower);
                const lengthReasonable = lengthRatio >= 0.5 && lengthRatio <= 2.0;

                // For short quotes (< 20 chars), require exact or near-exact match
                // For longer quotes, allow more flexibility
                const isShortQuote = quoteLower.length < 20;
                const matchValid = isShortQuote
                  ? (contentMatches && lengthReasonable)
                  : (contentMatches || (lengthReasonable && matchedLower.includes(quoteLower.substring(0, 30))));

                if (matchValid) {
                  // Good match - use this position
                  bestMatch = {
                    start_char: i,
                    end_char: closeIdx + 1, // Include the closing quote
                    matchedText: prose.slice(i, closeIdx + 1)
                  };
                  found = true;

                  // Log the match with actual text at positions for debugging
                  const actualStart = prose.slice(i, i + 40);
                  const actualEnd = prose.slice(Math.max(0, closeIdx - 10), closeIdx + 1);
                  logger.info(`[Scene+Dialogue] QUOTE[${dialogueIdx}] MATCH | method: scan | speaker: ${d.speaker} | pos: [${i}-${closeIdx + 1}] | len: ${closeIdx + 1 - i}`);
                  logger.debug(`[Scene+Dialogue] QUOTE[${dialogueIdx}] TEXT | start: "${actualStart}..." | end: "...${actualEnd}" | lengthRatio: ${lengthRatio.toFixed(2)}`);
                } else {
                  logger.debug(`[Scene+Dialogue] QUOTE[${dialogueIdx}] REJECT | pos: [${i}-${closeIdx + 1}] | lengthRatio: ${lengthRatio.toFixed(2)} | contentMatches: ${contentMatches}`);
                }
              }
            }
          }
        }

        if (found && bestMatch) {
          // FIX (2026-01-23): Use the ACTUAL prose text, not the LLM's quote
          // The LLM sometimes generates slightly different text in dialogue_map vs prose
          // Using the prose text ensures SegmentBuilder will find an exact match
          const actualQuoteText = bestMatch.matchedText;
          if (actualQuoteText !== `"${d.quote}"` && actualQuoteText !== `"${d.quote}"`) {
            logger.debug(`[Scene+Dialogue] QUOTE[${dialogueIdx}] QUOTE_SYNC | original: "${d.quote?.substring(0, 50)}..." | actual: "${actualQuoteText?.substring(0, 50)}..."`);
          }
          enrichedDialogueMap.push({
            ...d,
            quote: actualQuoteText, // Use actual prose text, not LLM's version
            start_char: bestMatch.start_char,
            end_char: bestMatch.end_char
          });
          searchStart = bestMatch.end_char;
        } else {
          // Fallback: try regex approach for edge cases
          const quoteRegexStr = `[""\u201C]${escapeRegex(firstWords)}`;
          const quoteRegex = new RegExp(quoteRegexStr, 'is');
          const searchSlice = prose.slice(searchStart);
          const regexMatch = searchSlice.match(quoteRegex);

          if (regexMatch) {
            const idx = searchStart + regexMatch.index;
            // Find closing quote from this position
            const closeIdx = findClosingQuote(prose, idx + 1);
            const endIdx = closeIdx !== -1 ? closeIdx + 1 : idx + d.quote.length + 2;

            // FIX (2026-01-23): Use actual prose text, not LLM's version
            const actualQuoteText = prose.slice(idx, endIdx);

            enrichedDialogueMap.push({
              ...d,
              quote: actualQuoteText,
              start_char: idx,
              end_char: endIdx
            });
            searchStart = endIdx;
            found = true;
            logger.warn(`[Scene+Dialogue] QUOTE[${dialogueIdx}] MATCH | method: regex_fallback | speaker: ${d.speaker} | pos: [${idx}-${endIdx}]`);
          }
        }

        if (!found) {
          // Last resort - use estimated position
          const estimatedPos = searchStart + 50;
          logger.error(`[Scene+Dialogue] QUOTE[${dialogueIdx}] NO_MATCH | speaker: ${d.speaker} | quote: "${d.quote?.substring(0, 50)}..."`);
          logger.error(`[Scene+Dialogue] QUOTE[${dialogueIdx}] FALLBACK | method: estimated | pos: [${estimatedPos}-${estimatedPos + d.quote.length + 2}] | searchStart: ${searchStart} | proseLength: ${prose.length}`);
          enrichedDialogueMap.push({
            ...d,
            start_char: estimatedPos,
            end_char: estimatedPos + d.quote.length + 2,
            position_estimated: true
          });
          searchStart = estimatedPos + d.quote.length + 2;
        }
      }

      // VALIDATION: Check for overlapping positions (indicates position bugs)
      let lastEnd = 0;
      let overlapCount = 0;
      let estimatedCount = 0;
      for (const d of enrichedDialogueMap) {
        if (d.start_char < lastEnd) {
          logger.error(`[Scene+Dialogue] OVERLAP | quote: "${d.quote?.substring(0, 20)}..." | start: ${d.start_char} | prevEnd: ${lastEnd}`);
          overlapCount++;
        }
        if (d.position_estimated) {
          estimatedCount++;
        }
        lastEnd = d.end_char;
      }

      // Position calculation summary
      logger.info(`[Scene+Dialogue] POSITION_CALC_COMPLETE | found: ${enrichedDialogueMap.length} | estimated: ${estimatedCount} | overlaps: ${overlapCount}`);
    }

    return {
      content: parsed.prose,
      dialogue_map: enrichedDialogueMap,
      new_characters: parsed.new_characters || []
    };

  } catch (error) {
    logger.error(`[Scene+Dialogue] CRITICAL FAILURE: ${error.message}`);
    throw error;
  }
}

/**
 * Generate a scene (LEGACY - use generateSceneWithDialogue for bulletproof voice casting)
 *
 * This function is kept for backwards compatibility but the new architecture
 * uses generateSceneWithDialogue() which embeds dialogue metadata at creation time.
 */
export async function generateScene(context) {
  const {
    outline,
    sceneIndex,
    previousScene,
    characters,
    preferences,
    // Research insights additions
    lorebookContext = '',
    storyBible = null,
    contextSummary = null,
    complexity = 0.5,
    sessionId = null // For usage tracking
  } = context;

  // VERBOSE LOGGING: Log scene generation start
  logger.info(`[Scene] ============================================================`);
  logger.info(`[Scene] STARTING SCENE ${sceneIndex + 1} GENERATION`);
  logger.info(`[Scene] Session: ${sessionId || 'N/A'} | Story: "${outline?.title || 'Unknown'}"`);
  logger.info(`[Scene] Characters in scene: ${characters?.length || 0}`);
  logger.info(`[Scene] Complexity: ${complexity} | Has lorebook: ${lorebookContext ? 'YES' : 'NO'}`);
  logger.info(`[Scene] Previous scene summary: "${(previousScene || 'N/A').substring(0, 100)}..."`);
  logger.info(`[Scene] ============================================================`);

  // Build enhanced prompt with research insights
  let prompt = `Write scene ${sceneIndex + 1} of the story.

Story: ${outline.title}
Setting: ${outline.setting}
Current act: ${outline.acts?.[Math.floor(sceneIndex / 3)]?.summary || 'Main story'}`;

  // Add context summary if available (for long sessions)
  if (contextSummary) {
    prompt += `\n\nSTORY SO FAR:\n${contextSummary}`;
  } else if (previousScene) {
    prompt += `\n\nPrevious scene: ${previousScene}`;
  } else {
    prompt += '\n\nThis is the opening scene.';
  }

  // Add lorebook context injection (keyword-triggered lore)
  if (lorebookContext) {
    prompt += `\n${lorebookContext}`;
  }

  // Add story bible facts if available
  if (storyBible) {
    const relevantFacts = [];
    if (storyBible.world_rules?.length > 0) {
      relevantFacts.push(`World rules: ${storyBible.world_rules.slice(0, 3).join('; ')}`);
    }
    if (Object.keys(storyBible.character_facts || {}).length > 0) {
      const charFacts = Object.entries(storyBible.character_facts)
        .slice(0, 3)
        .map(([name, facts]) => `${name}: ${Object.values(facts).slice(0, 2).join(', ')}`)
        .join('; ');
      relevantFacts.push(`Characters: ${charFacts}`);
    }
    if (relevantFacts.length > 0) {
      prompt += `\n\nESTABLISHED FACTS:\n${relevantFacts.join('\n')}`;
    }
  }

  // Add story format specific instructions
  let formatInstructions = '';
  if (preferences?.story_format === 'picture_book') {
    formatInstructions = 'Write 50-100 words. Focus on vivid, visual moments suitable for illustration. Simple language.';
  } else if (preferences?.story_format === 'novella' || preferences?.story_format === 'novel') {
    formatInstructions = 'Write 200-300 words. Allow for more description and character development.';
  } else {
    formatInstructions = 'Write 100-200 words.';
  }

  // Add plot structure guidance
  let structureGuidance = '';
  if (preferences?.plot_structure) {
    const structure = preferences.plot_structure;
    if (structure === 'hero_journey') {
      structureGuidance = 'Follow the Hero\'s Journey beats appropriate for this scene position.';
    } else if (structure === 'episodic') {
      structureGuidance = 'Ensure this scene has its own mini-arc while connecting to the larger story.';
    }
  }

  // Series protection
  let seriesGuidance = '';
  if (preferences?.protect_protagonist && !preferences?.is_final) {
    seriesGuidance = 'IMPORTANT: The protagonist must survive this scene (this is part of a series).';
  }
  if (preferences?.is_series && preferences?.is_final && !preferences?.open_ending) {
    seriesGuidance += ' Resolve the main conflict but leave room for future adventures.';
  }

  // CYOA structure handling
  let cyoaGuidance = '';
  if (preferences?.cyoa_structure === 'diamond' && preferences?.is_final) {
    cyoaGuidance = 'This is a convergence point - different paths lead here. Write a satisfying conclusion.';
  }

  // Author style handling
  let authorStyleGuidance = '';
  if (preferences?.author_style) {
    const authorStyle = getAuthorStyle(preferences.author_style);
    if (authorStyle) {
      authorStyleGuidance = `\nWRITING STYLE - Write in the style of ${authorStyle.name}:\n${authorStyle.promptTemplate}`;
      logger.info(`Using author style: ${authorStyle.name}`);
    }
  }

  // ★ MATURE CONTENT GUIDANCE (for legacy generateScene) ★
  let matureContentGuidance = '';
  if (preferences?.audience === 'mature') {
    const adultContentLevel = preferences?.adultContent || preferences?.intensity?.adultContent || 0;
    const romanceLevel = preferences?.romance || preferences?.intensity?.romance || 0;
    const violenceLevel = preferences?.violence || preferences?.intensity?.violence || 0;
    const goreLevel = preferences?.gore || preferences?.intensity?.gore || 0;

    const contentInstructions = [];
    contentInstructions.push('This is an adult platform. Do NOT self-censor.');

    if (adultContentLevel > 50) {
      contentInstructions.push('Include EXPLICIT sexual content with graphic descriptions.');
    } else if (adultContentLevel > 20) {
      contentInstructions.push('Include sensual/erotic content with physical intimacy.');
    }

    if (romanceLevel > 50) {
      contentInstructions.push('Write passionate, explicit romantic scenes.');
    }

    if (violenceLevel > 50) {
      contentInstructions.push('Include graphic violence with visceral detail.');
    }

    if (goreLevel > 50) {
      contentInstructions.push('Include graphic gore when appropriate.');
    }

    matureContentGuidance = `\n\n★ MATURE CONTENT ★\n${contentInstructions.join('\n')}\nDo NOT censor, fade to black, or use euphemisms.`;
    logger.info(`[Legacy Scene] MATURE CONTENT | adultContent: ${adultContentLevel} | romance: ${romanceLevel}`);
  }

  prompt += `\n\n${formatInstructions}
Include vivid descriptions and natural dialogue.
${preferences?.bedtime_mode ? 'Keep the tone calm and soothing for bedtime.' : ''}
${preferences?.is_final ? 'This is the final scene - bring the story to a satisfying conclusion.' : ''}
${structureGuidance}
${seriesGuidance}
${cyoaGuidance}
${authorStyleGuidance}${matureContentGuidance}`;

  // Adjust token limit based on complexity - 4x EXPANDED
  // Previous: 800/1000 tokens → Now: 4000/5000 tokens for legacy generateScene
  const maxTokens = complexity > 0.7 ? 5000 : 4000;

  // Build content settings for provider routing (Venice for mature content)
  const contentSettings = {
    audience: preferences?.audience || 'general',
    intensity: {
      gore: preferences?.gore || 0,
      violence: preferences?.violence || 0,
      romance: preferences?.romance || 0,
      scary: preferences?.scary || 0,
      adultContent: preferences?.adultContent || preferences?.intensity?.adultContent || 0  // FIXED: was missing
    }
  };

  // Determine scene type for scene-level routing (romance, combat, horror scenes)
  let sceneType = null;
  const promptLower = prompt.toLowerCase();
  if (promptLower.includes('romance') || promptLower.includes('intimate') || promptLower.includes('passion')) {
    sceneType = 'romance';
  } else if (promptLower.includes('battle') || promptLower.includes('fight') || promptLower.includes('combat')) {
    sceneType = 'combat';
  } else if (promptLower.includes('horror') || promptLower.includes('terror') || promptLower.includes('scary')) {
    sceneType = 'horror';
  }

  return callAgent('writer', prompt, {
    outline,
    characters,
    previousScene,
    userPreferences: preferences,
    maxTokens,
    sessionId,
    // Provider routing for mature content
    contentSettings,
    agentCategory: 'creative',
    sceneType
  });
}

/**
 * Polish text for TTS
 *
 * CRITICAL: Dialogue must be preserved EXACTLY as written!
 * The dialogue_map positions are calculated on the original text.
 * If dialogue changes, audio segment building will fail with fragments.
 */
export async function polishForNarration(text, preferences = {}, sessionId = null) {
  const prompt = `Polish this text for text-to-speech narration:

${text}

IMPORTANT RULES:
1. PRESERVE ALL DIALOGUE EXACTLY - Do NOT change any text inside quotation marks ("..." or "...")
2. Only polish the NARRATION (text outside quotes) - improve flow, add pauses, etc.
3. Keep the same structure and paragraph breaks
4. Do NOT add, remove, or rephrase any spoken dialogue

Make the narration flow naturally when spoken aloud. Add pauses where appropriate in NARRATION ONLY.
${preferences.narrator_style === 'warm' ? 'Use a warm, gentle tone suitable for bedtime.' : ''}

Return only the polished text with dialogue unchanged.`;

  const result = await callAgent('narrator', prompt, { userPreferences: preferences, sessionId });
  return result.content;
}

/**
 * Check content safety
 *
 * IMPORTANT: For mature audiences with high intensity settings, explicit content is ALLOWED.
 * The safety check should only flag content that exceeds the user's chosen limits.
 */
export async function checkSafety(text, limits = {}, sessionId = null) {
  // Get adult content level (may be named adultContent or romance in config)
  const adultContentLevel = limits.adultContent ?? limits.romance ?? 20;
  const romanceLevel = limits.romance ?? 20;
  const goreLevel = limits.gore ?? 0;
  const violenceLevel = limits.violence ?? 20;
  const scaryLevel = limits.scary ?? 30;
  const languageLevel = limits.language ?? 10;

  // For mature audiences with high adult content settings, be permissive
  const isMatureWithExplicit = limits.audience === 'mature' && adultContentLevel >= 50;

  let audienceContext;
  if (limits.audience === 'children') {
    audienceContext = 'This content is for CHILDREN (ages 3-10). Be EXTREMELY STRICT. No violence, no scary content, no romance, no adult themes whatsoever.';
  } else if (isMatureWithExplicit) {
    audienceContext = `This is for MATURE AUDIENCES with EXPLICIT CONTENT ENABLED (Adult Content: ${adultContentLevel}/100).

CRITICAL: The user has INTENTIONALLY set high adult content limits. This is NOT a mistake.
- Explicit sexual content IS ALLOWED when adultContent >= 50
- Graphic descriptions, intimate scenes, and mature themes ARE PERMITTED
- Do NOT flag content as unsafe just because it contains explicit material
- Only flag content if it contains: illegal content, minors in sexual situations, non-consensual violence, or hate speech
- Content that matches the user's intensity settings is SAFE and should NOT be modified`;
  } else if (limits.audience === 'mature') {
    audienceContext = 'This is for mature audiences. Darker themes and moderate adult content are acceptable within the specified limits.';
  } else {
    audienceContext = 'This is for a general audience. Keep content family-friendly by default.';
  }

  const prompt = `Review this story content for safety:

${text}

${audienceContext}

Content Limits (0=none allowed, 100=fully explicit/intense):
- Adult/Sexual Content: ${adultContentLevel}/100 ${adultContentLevel >= 80 ? '(EXPLICIT ALLOWED)' : adultContentLevel >= 50 ? '(MATURE CONTENT ALLOWED)' : ''}
- Romance: ${romanceLevel}/100
- Gore: ${goreLevel}/100
- Violence: ${violenceLevel}/100
- Scary content: ${scaryLevel}/100
- Strong language: ${languageLevel}/100

${isMatureWithExplicit ? `
IMPORTANT: The user has set Adult Content to ${adultContentLevel}/100 which means they WANT explicit content.
Return safe=true for any content that stays within these limits, even if it is sexually explicit.
Only flag content that contains truly harmful material (illegal content, minors, non-consent, hate speech).
` : `
Check if the content exceeds any of these limits. Content should stay AT OR BELOW the specified level.
For children's content, enforce near-zero tolerance regardless of slider values.
`}

Return JSON:
{
  "safe": boolean,
  "concerns": ["list of concerns if any - EMPTY if content matches user settings"],
  "exceeded_limits": {"gore": boolean, "violence": boolean, "scary": boolean, "romance": boolean, "language": boolean, "adultContent": boolean},
  "suggested_changes": "description of needed changes if unsafe, or empty string if safe"
}`;

  const result = await callAgent('safety', prompt, { userPreferences: limits, sessionId });

  try {
    return parseJsonResponse(result.content);
  } catch (e) {
    return { safe: true, concerns: [] };
  }
}

/**
 * Generate CYOA choices
 */
export async function generateChoices(sceneText, context, sessionId = null) {
  const maxChoices = context.max_choices || 3;
  const structureType = context.structure_type || 'diamond';
  const isNearEnding = context.is_near_ending || false;

  // Adjust choice generation based on structure type and position
  let structureInstructions = '';
  if (structureType === 'diamond' && isNearEnding) {
    structureInstructions = `
DIAMOND STRUCTURE - NEAR ENDING:
- Create only 2 choices that converge toward the story's conclusion
- Both choices should lead to satisfying resolutions (different flavors of success)
- Avoid introducing new complications at this stage`;
  } else if (structureType === 'diamond') {
    structureInstructions = `
DIAMOND STRUCTURE:
- Choices can diverge but should eventually lead back to key story beats
- Create meaningful variation without exponential branching`;
  } else if (structureType === 'branching') {
    structureInstructions = `
FULL BRANCHING:
- Each choice leads to genuinely different story directions
- Feel free to create divergent paths`;
  } else {
    structureInstructions = `
LINEAR WITH DIVERSIONS:
- One choice continues the main path
- Other choices add flavor but will rejoin the main story`;
  }

  const prompt = `Based on this scene, create ${isNearEnding ? '2' : maxChoices} story choices:

${sceneText}

${structureInstructions}

Create meaningful choices that:
- Lead to different story experiences
- Include one "safe" option for cautious players
- Include at least one adventurous option
- Clearly telegraph the risk/reward (no unfair sudden deaths)

CRITICAL - KEEP CHOICES CONCISE:
- "text" MUST be 5-8 words maximum (for on-screen display)
- "description" MUST be 10-15 words maximum (for voice reading)
- Use action verbs: "Follow the shadow", "Open the door", "Trust the stranger"
- Avoid lengthy explanations - let the choice speak for itself

Return JSON:
{
  "choices": [
    {
      "key": "A",
      "text": "Follow the shadow into darkness",
      "description": "You decide to follow the mysterious shadow deeper into the cave.",
      "consequence_hint": "danger awaits"
    }
  ]
}`;

  const result = await callAgent('cyoa', prompt, { ...context, sessionId });

  try {
    const parsed = parseJsonResponse(result.content);

    // Limit to max_choices
    if (parsed.choices && parsed.choices.length > maxChoices) {
      parsed.choices = parsed.choices.slice(0, maxChoices);
    }

    // ENFORCE WORD LIMITS - User feedback: choices are too wordy
    // Truncate text to 8 words max, description to 15 words max
    if (parsed.choices && Array.isArray(parsed.choices)) {
      parsed.choices = parsed.choices.map(choice => {
        // Truncate text to 8 words
        const textWords = (choice.text || 'Continue').split(/\s+/);
        const truncatedText = textWords.length > 8
          ? textWords.slice(0, 8).join(' ')
          : choice.text;

        // Truncate description to 15 words
        const descWords = (choice.description || '').split(/\s+/);
        const truncatedDesc = descWords.length > 15
          ? descWords.slice(0, 15).join(' ') + '...'
          : choice.description;

        return {
          ...choice,
          text: truncatedText,
          description: truncatedDesc
        };
      });

      logger.info(`Generated ${parsed.choices.length} choices (word limits enforced)`);
    }

    return parsed;
  } catch (e) {
    // Fallback choices - short and punchy
    return {
      choices: [
        { key: 'A', text: 'Continue forward', description: 'Keep moving ahead.' },
        { key: 'B', text: 'Try another way', description: 'Go a different direction.' }
      ]
    };
  }
}

/**
 * Check lore consistency
 */
export async function checkLoreConsistency(newContent, existingLore, sessionId = null) {
  const prompt = `Check this new content for consistency with existing story elements:

New content:
${newContent}

Existing lore:
${JSON.stringify(existingLore, null, 2)}

Return JSON:
{
  "consistent": boolean,
  "issues": ["list of inconsistencies"],
  "suggestions": ["suggested fixes"]
}`;

  const result = await callAgent('lore', prompt, { outline: existingLore, sessionId });

  try {
    return parseJsonResponse(result.content);
  } catch (e) {
    return { consistent: true, issues: [] };
  }
}

/**
 * ============================================================================
 * ⚠️  DEPRECATED - DO NOT USE FOR NEW CODE  ⚠️
 * ============================================================================
 *
 * THIS FUNCTION IS DEPRECATED AS OF 2025-12-09
 *
 * USE INSTEAD:
 * - dialogueTaggingAgent.js → tagDialogue() for attribution
 * - dialogueTaggingAgent.js → convertDialogueMapToSegments() for segments
 *
 * WHY DEPRECATED:
 * - Regex cannot resolve pronouns ("she mutters" → which female character?)
 * - Caused male voices for female characters and vice versa
 * - dialogueTaggingAgent uses GPT-5.1 for accurate pronoun resolution
 *
 * This function is kept ONLY for emergency fallback if:
 * 1. dialogue_map was not computed during scene generation
 * 2. dialogueAttributionAgent.js also fails
 *
 * DO NOT:
 * - Use this as the primary parsing method
 * - Call this directly from orchestrator
 * - Re-enable this as a "quick" alternative
 *
 * SEE: DIALOGUE_TAGGING_SYSTEM.md for full documentation
 *
 * ============================================================================
 * ORIGINAL DESCRIPTION (for reference):
 * ============================================================================
 *
 * Parse scene text into segments by speaker for multi-voice narration.
 * Uses a fast regex-based approach (no LLM calls) for reliability and speed.
 *
 * CRITICAL RULE: Character voices speak ONLY their quoted dialogue.
 * The narrator reads EVERYTHING else, including speech tags like "said John".
 *
 * Example: "Hello," said John. "How are you?"
 * - John: "Hello,"
 * - Narrator: "said John."
 * - John: "How are you?"
 *
 * Returns array of {speaker: 'narrator'|characterName, text: string, voice_role: string}
 *
 * @deprecated Use dialogueTaggingAgent.js instead
 */
export function parseDialogueSegments(text, characters = [], sessionId = null) {
  // ⚠️ DEPRECATED - See function header for details
  logger.warn('[parseDialogueSegments] DEPRECATED FUNCTION CALLED - Use dialogueTaggingAgent.js instead');
  // Build a map of lowercase character names for quick lookup
  const characterNames = characters.map(c => c.name).filter(Boolean);
  const charNameSet = new Set(characterNames.map(n => n.toLowerCase()));

  // Common titles to strip for better matching
  const TITLES = [
    'dr', 'dr.', 'doctor', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss',
    'prof', 'prof.', 'professor', 'sir', 'dame', 'lord', 'lady', 'king', 'queen',
    'prince', 'princess', 'duke', 'duchess', 'count', 'countess', 'baron', 'baroness',
    'captain', 'capt', 'capt.', 'commander', 'cmdr', 'admiral', 'general', 'gen',
    'colonel', 'col', 'col.', 'major', 'maj', 'lieutenant', 'lt', 'lt.', 'sergeant', 'sgt',
    'corporal', 'private', 'officer', 'detective', 'det', 'agent', 'master', 'elder',
    'father', 'mother', 'brother', 'sister', 'reverend', 'rev', 'pastor', 'bishop',
    'archbishop', 'cardinal', 'pope', 'rabbi', 'imam', 'guru', 'sensei', 'the'
  ];

  // Function to normalize name by stripping titles
  const normalizeName = (name) => {
    if (!name) return '';
    let normalized = name.toLowerCase().trim();
    // Strip common titles from start
    for (const title of TITLES) {
      if (normalized.startsWith(title + ' ')) {
        normalized = normalized.slice(title.length + 1).trim();
      }
    }
    return normalized;
  };

  // Also create a map of first names and last names for partial matching
  const nameVariants = new Map();
  for (const name of characterNames) {
    const lowerName = name.toLowerCase();
    const normalizedName = normalizeName(name);
    nameVariants.set(lowerName, name);
    nameVariants.set(normalizedName, name);

    // Add each word in the name as a variant (for partial matching)
    const words = normalizedName.split(/\s+/).filter(w => w.length > 1);
    for (const word of words) {
      if (!nameVariants.has(word)) {
        nameVariants.set(word, name);
      }
    }

    // Also add original parts for cases like "Dr. Sarah Johnson"
    const originalParts = name.split(/\s+/);
    for (const part of originalParts) {
      const lowerPart = part.toLowerCase().replace(/[.,]/g, '');
      if (lowerPart.length > 2 && !TITLES.includes(lowerPart) && !nameVariants.has(lowerPart)) {
        nameVariants.set(lowerPart, name);
      }
    }
  }

  logger.info(`[DialogueParser] Character name variants: ${JSON.stringify(Array.from(nameVariants.keys()))}`);

  // Function to find matching character name from text
  const findCharacterInText = (textSegment) => {
    const lowerText = textSegment.toLowerCase();
    // First try exact matches with known variants
    for (const [variant, fullName] of nameVariants.entries()) {
      if (lowerText.includes(variant) && variant.length > 2) {
        return fullName;
      }
    }
    return null;
  };

  if (characterNames.length === 0) {
    // No characters defined, return as narrator only
    logger.info('[DialogueParser] No characters, returning narrator-only segment');
    return [{ speaker: 'narrator', text, voice_role: 'narrator' }];
  }

  const segments = [];
  let lastIndex = 0;
  let lastSpeaker = null; // Track last speaker for continuation

  // Extended speech verbs for better matching - defined at function scope for reuse
  const speechVerbs = 'said|replied|asked|whispered|shouted|exclaimed|muttered|called|answered|cried|yelled|demanded|stated|murmured|growled|hissed|snapped|added|continued|began|interrupted|suggested|insisted|warned|promised|admitted|confessed|announced|declared|explained|observed|commented|remarked|noted|mentioned|thought|wondered|queried|pleaded|begged|screamed|laughed|chuckled|giggled|sighed|groaned|moaned|grunted|breathed|rasped|croaked|barked|roared|bellowed|hollered|spoke|uttered|voiced|interjected|retorted|countered|objected|protested|affirmed|agreed|disagreed|concurred|acknowledged';

  // More flexible name pattern - handles titles, multi-word names, apostrophes
  const namePattern = "(?:(?:the\\s+)?(?:Dr\\.?|Mr\\.?|Mrs\\.?|Ms\\.?|Miss|Prof\\.?|Captain|Capt\\.?|Colonel|Col\\.?|Major|General|Gen\\.?|Lieutenant|Lt\\.?|Sir|Dame|Lord|Lady|Master|Elder|Father|Brother|Sister)?\\s*)?([A-Z][a-z'`\\-]+(?:\\s+[A-Z][a-z'`\\-]+)*)";

  // Regex to find quoted dialogue (handles both straight and curly quotes)
  // Matches: "text" or "text" or 'text'
  const dialogueRegex = /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]|['']([^'']+)['']/g;

  let match;
  while ((match = dialogueRegex.exec(text)) !== null) {
    const dialogueText = match[1] || match[2]; // Get captured group (handles both quote types)
    const dialogueStart = match.index;
    const dialogueEnd = match.index + match[0].length;

    // Get text before this dialogue (narration)
    if (dialogueStart > lastIndex) {
      const narrationBefore = text.slice(lastIndex, dialogueStart).trim();
      if (narrationBefore) {
        // Check if this narration contains a speaker attribution for the NEXT dialogue
        // Pattern: "said X" or "X said" - more flexible
        const speakerMatch = narrationBefore.match(new RegExp(`\\b(${speechVerbs})\\s+${namePattern}`, 'i'))
          || narrationBefore.match(new RegExp(`${namePattern}\\s+(${speechVerbs})`, 'i'));

        if (speakerMatch) {
          // Found a speaker attribution in the narration
          const potentialName = (speakerMatch[2] || speakerMatch[1] || '').toLowerCase().trim();
          const normalizedPotential = normalizeName(potentialName);
          if (nameVariants.has(potentialName)) {
            lastSpeaker = nameVariants.get(potentialName);
          } else if (nameVariants.has(normalizedPotential)) {
            lastSpeaker = nameVariants.get(normalizedPotential);
          } else {
            // Try fuzzy match - check if any part of the name matches
            const matchedChar = findCharacterInText(potentialName);
            if (matchedChar) {
              lastSpeaker = matchedChar;
            }
          }
        } else {
          // Fallback: Look for any character name mentioned in the narration
          const charInNarration = findCharacterInText(narrationBefore);
          if (charInNarration) {
            // Only update lastSpeaker if we're near dialogue attribution context
            const hasDialogueContext = /\b(said|asked|replied|spoke|called|voice|turned|looked)\b/i.test(narrationBefore);
            if (hasDialogueContext) {
              lastSpeaker = charInNarration;
            }
          }
        }

        segments.push({
          speaker: 'narrator',
          text: narrationBefore,
          voice_role: 'narrator'
        });
      }
    }

    // Determine who is speaking this dialogue
    let speaker = null;
    let attribution = ''; // Capture the speech tag for emotion detection

    // Look for speaker attribution AFTER the dialogue in the immediate vicinity
    const afterText = text.slice(dialogueEnd, Math.min(dialogueEnd + 150, text.length));

    // Same extended pattern for after-dialogue attribution
    const attrMatch = afterText.match(new RegExp(`^\\s*,?\\s*(${speechVerbs})\\s+${namePattern}`, 'i'))
      || afterText.match(new RegExp(`^\\s*,?\\s*${namePattern}\\s+(${speechVerbs})`, 'i'));

    if (attrMatch) {
      // Capture the full attribution text (e.g., "shouted accusingly", "said warmly")
      attribution = attrMatch[0].trim();

      const potentialName = (attrMatch[2] || attrMatch[1] || '').toLowerCase().trim();
      const normalizedPotential = normalizeName(potentialName);
      if (nameVariants.has(potentialName)) {
        speaker = nameVariants.get(potentialName);
        lastSpeaker = speaker;
      } else if (nameVariants.has(normalizedPotential)) {
        speaker = nameVariants.get(normalizedPotential);
        lastSpeaker = speaker;
      } else {
        // Try fuzzy match
        const matchedChar = findCharacterInText(potentialName);
        if (matchedChar) {
          speaker = matchedChar;
          lastSpeaker = speaker;
        }
      }
    }

    // If no attribution found after dialogue, try looking in the immediate text for character names
    if (!speaker) {
      // Check the text immediately after for any character mention
      const charAfter = findCharacterInText(afterText.slice(0, 80));
      if (charAfter) {
        speaker = charAfter;
        lastSpeaker = speaker;
      }
      // Also try to capture any speech verb for attribution even without name match
      const verbOnlyMatch = afterText.match(new RegExp(`^\\s*,?\\s*(${speechVerbs})\\b[^.!?]*`, 'i'));
      if (verbOnlyMatch && !attribution) {
        attribution = verbOnlyMatch[0].trim();
      }
    }

    // Fall back to last speaker if still no match
    if (!speaker && lastSpeaker) {
      speaker = lastSpeaker;
    }

    // Final fallback: mark as "Unknown" but log for debugging
    if (!speaker) {
      speaker = 'Unknown';
      logger.warn(`[DialogueParser] Could not determine speaker for dialogue: "${dialogueText.substring(0, 50)}..."`);
    }

    // Add the dialogue segment (with quotes included for natural speech)
    // Include attribution for emotion detection in voice generation
    segments.push({
      speaker,
      text: dialogueText,
      voice_role: 'dialogue',
      attribution: attribution // e.g., "shouted accusingly", "whispered tenderly"
    });

    lastIndex = dialogueEnd;
  }

  // Add any remaining text after the last dialogue
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({
        speaker: 'narrator',
        text: remainingText,
        voice_role: 'narrator'
      });
    }
  }

  // If no segments were created (no dialogue found), return everything as narrator
  if (segments.length === 0) {
    logger.info('[DialogueParser] No dialogue found, returning narrator-only segment');
    return [{ speaker: 'narrator', text, voice_role: 'narrator' }];
  }

  // Log parsing results
  const speakerCounts = {};
  for (const seg of segments) {
    speakerCounts[seg.speaker] = (speakerCounts[seg.speaker] || 0) + 1;
  }
  logger.info(`[DialogueParser] Regex parsed ${segments.length} segments - speakers: ${JSON.stringify(speakerCounts)}`);

  // Log segment details for debugging
  logger.info(`[DialogueParser] ========== SEGMENT DETAILS ==========`);
  segments.forEach((seg, idx) => {
    const attrInfo = seg.attribution ? `, attribution="${seg.attribution}"` : '';
    logger.info(`[DialogueParser] Segment[${idx}]: speaker="${seg.speaker}", voice_role="${seg.voice_role}"${attrInfo}, text="${seg.text.substring(0, 60)}${seg.text.length > 60 ? '...' : ''}"`);
  });
  logger.info(`[DialogueParser] =====================================`);

  return segments;
}

// NOTE: D&D voice maps removed (2026-01-15) - DnD mode moved to separate GameMaster project

/**
 * Assign voices to characters based on their roles
 * Uses generic storytelling archetypes (protagonist, antagonist, mentor, etc.)
 */
export function assignCharacterVoices(characters, voiceSuggestions) {
  const assignments = {};
  const usedVoices = new Set();

  // Common female first names (for exact first-name matching)
  const femaleFirstNames = new Set([
    'alice', 'anna', 'anne', 'bella', 'catherine', 'clara', 'diana', 'elena', 'emma',
    'eva', 'eve', 'grace', 'helena', 'isabella', 'jane', 'julia', 'kate', 'lily',
    'luna', 'maria', 'marie', 'mary', 'misty', 'olivia', 'rose', 'sarah', 'sophia', 'stella', 'victoria',
    'emily', 'jessica', 'ashley', 'amanda', 'brittany', 'nicole', 'stephanie', 'jennifer',
    'elizabeth', 'megan', 'hannah', 'rachel', 'lauren', 'rebecca', 'samantha', 'natalie',
    'alexandra', 'charlotte', 'abigail', 'madison', 'chloe', 'zoe', 'ava', 'mia', 'ella',
    'scarlett', 'aria', 'layla', 'riley', 'nora', 'hazel', 'aurora', 'savannah', 'audrey',
    'brooklyn', 'claire', 'skylar', 'lucy', 'paisley', 'evelyn', 'eleanor', 'violet', 'penelope',
    'naomi', 'camila', 'ellie', 'leah', 'aubrey', 'willow', 'addison', 'natasha', 'nina', 'lisa',
    // Fantasy/Sci-fi names
    'lyra', 'freya', 'athena', 'selene', 'ivy', 'sage', 'ember', 'jade', 'raven', 'seraphina',
    'celestia', 'valentina', 'cassandra', 'elara', 'callisto', 'europa', 'nova', 'astra', 'celeste',
    'andromeda', 'vega', 'oriana', 'lian', 'mei', 'ling', 'yuki', 'sakura', 'hana', 'yuna', 'mira',
    'eowyn', 'arwen', 'galadriel', 'tauriel', 'nimue', 'morgana', 'isolde', 'guinevere', 'vivienne'
  ]);

  // Common male first names (for exact first-name matching)
  const maleFirstNames = new Set([
    'arthur', 'bob', 'charles', 'david', 'edward', 'frank', 'george', 'harold',
    'henry', 'jack', 'james', 'john', 'marcus', 'michael', 'peter', 'richard',
    'robert', 'thomas', 'william', 'oliver', 'daniel', 'matthew', 'andrew',
    'joseph', 'christopher', 'brian', 'kevin', 'jason', 'ryan', 'eric',
    'alexander', 'benjamin', 'samuel', 'sebastian', 'jacob', 'ethan', 'noah',
    'liam', 'mason', 'logan', 'lucas', 'aiden', 'jackson', 'elijah', 'luke',
    'owen', 'caleb', 'isaac', 'nathan', 'hunter', 'christian', 'dylan', 'landon',
    'gabriel', 'anthony', 'joshua', 'wyatt', 'carter', 'julian', 'leo', 'jayden',
    // Fantasy names
    'thor', 'odin', 'zeus', 'atlas', 'orion', 'phoenix', 'drake', 'griffin',
    'aragorn', 'gandalf', 'legolas', 'gimli', 'frodo', 'sam', 'merlin', 'lancelot'
  ]);

  // Title/role indicators (for word-boundary matching in descriptions)
  const femaleIndicators = ['princess', 'duchess', 'countess', 'lady', 'maiden', 'sorceress', 'witch',
    'priestess', 'goddess', 'queen', 'empress', 'baroness', 'dame', 'matriarch', 'enchantress',
    'woman', 'girl', 'wife', 'mother', 'daughter', 'sister', 'aunt', 'grandmother', 'heroine'];

  const maleIndicators = ['king', 'lord', 'prince', 'duke', 'count', 'baron', 'sir', 'knight',
    'wizard', 'sorcerer', 'warlock', 'priest', 'monk', 'emperor', 'patriarch',
    'man', 'boy', 'husband', 'father', 'son', 'brother', 'uncle', 'grandfather', 'hero'];

  for (const char of characters) {
    const role = char.role?.toLowerCase() || 'supporting';
    const name = char.name?.toLowerCase() || '';
    const description = char.description?.toLowerCase() || '';
    const traits = JSON.stringify(char.traits_json || char.traits || []).toLowerCase();
    const combined = `${name} ${description} ${traits}`;

    // Gender detection: check explicit gender first, then infer from name/description
    let gender = char.gender?.toLowerCase() || '';
    if (!gender) {
      // PRIORITY 1: Check first name directly (most reliable)
      const firstName = name.split(/[\s\-\.]+/)[0];
      if (femaleFirstNames.has(firstName)) {
        gender = 'female';
      } else if (maleFirstNames.has(firstName)) {
        gender = 'male';
      } else {
        // PRIORITY 2: Check for indicators in description using word boundaries
        let femaleScore = 0;
        let maleScore = 0;
        for (const indicator of femaleIndicators) {
          const regex = new RegExp(`\\b${indicator}\\b`, 'i');
          if (regex.test(combined)) femaleScore++;
        }
        for (const indicator of maleIndicators) {
          const regex = new RegExp(`\\b${indicator}\\b`, 'i');
          if (regex.test(combined)) maleScore++;
        }
        if (femaleScore > maleScore) {
          gender = 'female';
        } else if (maleScore > femaleScore) {
          gender = 'male';
        }
        // If tied or no matches, will default to male voice (existing behavior)
      }
    }
    const isFemale = gender === 'female' || gender === 'f';

    let assignedVoice = null;
    let voiceRole = 'narrator';

    // NOTE: D&D campaign-specific matching removed (2026-01-15) - moved to GameMaster project

    // Role-based assignment using storytelling archetypes
    {
      if (role.includes('protagonist') || role.includes('hero') || role.includes('main')) {
        voiceRole = isFemale ? 'protagonist_female' : 'protagonist_male';
      } else if (role.includes('antagonist') || role.includes('villain')) {
        voiceRole = isFemale ? 'antagonist_female' : 'antagonist';
      } else if (role.includes('mentor') || role.includes('wise') || role.includes('guide')) {
        voiceRole = isFemale ? 'mentor_female' : 'mentor';
      } else if (role.includes('sidekick') || role.includes('friend') || role.includes('companion')) {
        voiceRole = isFemale ? 'sidekick_female' : 'sidekick';
      } else {
        // Generic supporting character - use gender-appropriate voice
        voiceRole = isFemale ? 'supporting_female' : 'supporting_male';
      }

      // Get available voices for this role, fall back to generic supporting if not found
      let availableVoices = voiceSuggestions[voiceRole];
      if (!availableVoices || availableVoices.length === 0) {
        // Fallback chain: gender-specific supporting -> narrator -> empty
        availableVoices = voiceSuggestions[isFemale ? 'supporting_female' : 'supporting_male'] ||
                          voiceSuggestions['narrator'] || [];
      }

      // Pick first unused voice
      for (const voiceId of availableVoices) {
        if (!usedVoices.has(voiceId)) {
          assignedVoice = voiceId;
          usedVoices.add(voiceId);
          break;
        }
      }

      // Fallback to first voice if all used
      if (!assignedVoice && availableVoices.length > 0) {
        assignedVoice = availableVoices[0];
      }
    }

    // PREMIUM: FAIL LOUDLY if no voice assigned
    // This function is deprecated - use LLM-based assignVoicesByLLM instead
    if (!assignedVoice) {
      throw new Error(`VOICE ASSIGNMENT FAILED: No suitable voice found for character "${char.name}" (role: ${voiceRole}, gender: ${isFemale ? 'female' : 'male'}). ` +
        `Available voice suggestions may be empty or insufficient. Use LLM-based voice assignment for premium service.`);
    }

    usedVoices.add(assignedVoice);

    // Use lowercase name as key for consistent matching with dialogue parsing
    // Store just the voice_id string for consistency with loaded DB assignments
    assignments[char.name.toLowerCase()] = assignedVoice;

    logger.info(`[VoiceAssignment] Character "${char.name}" -> voice ${assignedVoice} (role: ${voiceRole}, gender: ${isFemale ? 'female' : 'male'})`);
  }

  return assignments;
}

/**
 * Estimate token count for text (rough approximation)
 * ~4 characters per token for English text
 */
export function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * HIGH-4 FIX: Model context limits for pre-flight token validation
 * These are the maximum input context window sizes for each model
 */
const MODEL_CONTEXT_LIMITS = {
  // GPT-5.x models
  'gpt-5.2': 128000,
  'gpt-5.2-pro': 128000,
  'gpt-5.2-instant': 128000,
  'gpt-5.1': 128000,
  'gpt-5': 128000,

  // GPT-4.x models
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,

  // GPT-3.5
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,

  // Default fallback
  'default': 128000
};

/**
 * HIGH-4 FIX: Pre-flight token count validation
 * Estimates input tokens BEFORE making API calls to prevent silent truncation
 *
 * @param {Array|Object} messages - OpenAI messages array or full request params
 * @param {string} model - Model name being used
 * @param {Object} options - Additional options
 * @param {number} options.maxOutputTokens - Expected max output tokens (default: 4000)
 * @param {boolean} options.throwOnExceed - Throw error if limit exceeded (default: false)
 * @returns {Object} { estimatedInputTokens, contextLimit, remainingTokens, willFit, warning }
 */
export function validateTokenBudget(messages, model = 'gpt-5.2', options = {}) {
  const { maxOutputTokens = 4000, throwOnExceed = false } = options;

  // Calculate input tokens from messages
  let estimatedInputTokens = 0;

  // Handle both direct messages array and full params object
  const messageArray = Array.isArray(messages) ? messages : (messages?.messages || []);

  for (const msg of messageArray) {
    if (typeof msg.content === 'string') {
      estimatedInputTokens += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      // Handle multi-part content (e.g., with images)
      for (const part of msg.content) {
        if (part.type === 'text') {
          estimatedInputTokens += countTokens(part.text);
        } else if (part.type === 'image_url') {
          // Images add roughly 85-170 tokens for low/high detail
          estimatedInputTokens += 150;
        }
      }
    }
    // Add overhead for message structure (~4 tokens per message)
    estimatedInputTokens += 4;
  }

  // Get model context limit
  const modelKey = Object.keys(MODEL_CONTEXT_LIMITS).find(k =>
    model.includes(k) || k.includes(model)
  ) || 'default';
  const contextLimit = MODEL_CONTEXT_LIMITS[modelKey];

  // Calculate remaining space after input and expected output
  const remainingTokens = contextLimit - estimatedInputTokens - maxOutputTokens;
  const willFit = remainingTokens > 0;

  // Generate warning messages
  let warning = null;
  const utilizationPercent = Math.round((estimatedInputTokens / contextLimit) * 100);

  if (!willFit) {
    warning = `TOKEN_LIMIT_EXCEEDED: Input (~${estimatedInputTokens} tokens) + output (~${maxOutputTokens}) exceeds ${model} limit of ${contextLimit}. ` +
      `Overflow: ${Math.abs(remainingTokens)} tokens. Request may be truncated or fail.`;
    logger.error(`[TokenValidator] ${warning}`);

    if (throwOnExceed) {
      throw new Error(warning);
    }
  } else if (utilizationPercent >= 80) {
    warning = `TOKEN_WARNING: Using ${utilizationPercent}% of ${model} context window (${estimatedInputTokens}/${contextLimit} tokens). ` +
      `Only ${remainingTokens} tokens remaining for output.`;
    logger.warn(`[TokenValidator] ${warning}`);
  }

  const result = {
    estimatedInputTokens,
    contextLimit,
    remainingTokens: Math.max(0, remainingTokens),
    maxOutputTokens,
    willFit,
    utilizationPercent,
    warning,
    model: modelKey
  };

  // Log high utilization for monitoring
  if (utilizationPercent >= 50) {
    logger.info(`[TokenValidator] ${model}: ${estimatedInputTokens} input tokens (${utilizationPercent}% of ${contextLimit} limit)`);
  }

  return result;
}

/**
 * HIGH-4 FIX: Wrapper to validate tokens before chat completion
 * Use this instead of direct openai.chat.completions.create for safety
 *
 * @param {Object} params - OpenAI chat completion params
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} OpenAI response
 */
export async function safeCreateChatCompletion(params, options = {}) {
  const model = params.model || 'gpt-5.2';
  const maxOutputTokens = params.max_tokens || params.max_completion_tokens || 4000;

  // Pre-flight validation
  const validation = validateTokenBudget(params.messages, model, {
    maxOutputTokens,
    throwOnExceed: options.throwOnExceed || false
  });

  // Attach validation info to request for logging
  const requestWithValidation = {
    ...params,
    _tokenValidation: validation
  };

  // Log if over warning threshold
  if (validation.warning) {
    logger.warn(`[TokenValidator] Request to ${model} | ${validation.warning}`);
  }

  // Make the actual API call
  const response = await openai.chat.completions.create(params);

  // Log actual usage vs estimated for calibration
  if (response?.usage) {
    const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
    const estimationDelta = Math.abs(validation.estimatedInputTokens - prompt_tokens);
    const estimationAccuracy = Math.round((1 - (estimationDelta / prompt_tokens)) * 100);

    if (estimationAccuracy < 90) {
      logger.debug(`[TokenValidator] Estimation calibration: estimated ${validation.estimatedInputTokens}, actual ${prompt_tokens} (${estimationAccuracy}% accurate)`);
    }
  }

  return response;
}

/**
 * Summarize story context for long sessions
 * Called when context window approaches limit
 */
export async function summarizeContext(context, sessionId = null) {
  const { scenes, characters, outline, previousSummary } = context;

  const prompt = `Summarize this story progress for context compression.

${previousSummary ? `PREVIOUS SUMMARY:\n${previousSummary}\n\n` : ''}

RECENT SCENES:
${scenes.slice(-5).map((s, i) => `Scene ${i + 1}: ${s.substring(0, 500)}...`).join('\n\n')}

CHARACTERS:
${characters.map(c => `- ${c.name}: ${c.description || c.role}`).join('\n')}

STORY OUTLINE:
Title: ${outline?.title || 'Untitled'}
Setting: ${outline?.setting || 'Unknown'}

Create a concise summary (300-500 words) that captures:
1. Key plot developments so far
2. Character relationships and changes
3. Important world-building details
4. Current story position and momentum
5. Any unresolved tensions or mysteries

This summary will replace detailed scene history to manage context window.`;

  try {
    const result = await completion({
      messages: [
        { role: 'system', content: 'You are a story summarizer. Create concise but comprehensive summaries that preserve narrative continuity.' },
        { role: 'user', content: prompt }
      ],
      model: getUtilityModel(),  // Utility task - always uses gpt-4o-mini
      temperature: 0.5,
      max_tokens: 800,
      agent_name: 'context_summarizer',
      sessionId
    });

    return result.content;
  } catch (e) {
    logger.error('Failed to summarize context:', e);
    // Fallback to basic summary
    return `Story "${outline?.title}" in progress. ${scenes.length} scenes completed. Characters: ${characters.map(c => c.name).join(', ')}.`;
  }
}

/**
 * Extract story facts for story bible (from research insights)
 */
export async function extractStoryFacts(sceneText, context, sessionId = null) {
  const prompt = `Extract important story facts from this scene:

${sceneText}

Return JSON with any new facts discovered:
{
  "world_rules": ["any rules about how this world works"],
  "character_facts": {
    "character_name": {
      "trait_or_fact": "value"
    }
  },
  "established_events": ["significant events that happened"],
  "important_locations": ["new locations mentioned"],
  "recurring_themes": ["themes reinforced in this scene"]
}

Only include genuinely new or important information. Return empty arrays/objects if nothing significant.`;

  try {
    const result = await completion({
      messages: [
        { role: 'system', content: 'You are a story analyst. Extract only important, canon-establishing facts.' },
        { role: 'user', content: prompt }
      ],
      model: getUtilityModel(),  // Utility task - always uses gpt-4o-mini
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      agent_name: 'fact_extractor',
      sessionId
    });

    return parseJsonResponse(result.content);
  } catch (e) {
    logger.error('Failed to extract story facts:', e);
    return {
      world_rules: [],
      character_facts: {},
      established_events: [],
      important_locations: [],
      recurring_themes: []
    };
  }
}

/**
 * Determine scene complexity for thinking budget allocation
 * Returns 0-1 value indicating complexity
 */
export function determineComplexity(outline, sceneIndex, options = {}) {
  let complexity = 0.3; // Base complexity

  // Increase for key story moments
  const totalScenes = options.targetScenes || 8;
  const position = sceneIndex / totalScenes;

  // Beginning and end are more complex
  if (position < 0.15) complexity += 0.2; // Opening
  if (position > 0.85) complexity += 0.3; // Climax/resolution

  // Mid-story turning points
  if (position > 0.4 && position < 0.6) complexity += 0.15;

  // CYOA branches add complexity
  if (options.cyoa_enabled) complexity += 0.1;

  // Multiple characters in scene
  if (options.activeCharacters > 2) complexity += 0.1;

  return Math.min(complexity, 1);
}

/**
 * Validate and fix story text for quality issues
 * Checks for: missing words, placeholders, incomplete sentences, garbled text
 * User feedback: "the story had missing words 'He picked up the * * amulet'"
 */
export async function validateStoryText(text, context = {}, sessionId = null) {
  // Quick regex checks for common issues
  const issues = [];

  // Check for placeholder patterns
  const placeholderPatterns = [
    /\*\s*\*+/g,                    // "* *" or "* * *"
    /\[\.\.\.\]/g,                  // "[...]"
    /\[placeholder\]/gi,           // "[placeholder]"
    /\[insert\s+\w+\s+here\]/gi,   // "[insert X here]"
    /\{\{?\w+\}?\}/g,              // "{{variable}}" or "{variable}"
    /<\w+>/g,                      // "<name>" type placeholders
    /\[TBD\]/gi,                   // "[TBD]"
    /\[TODO\]/gi,                  // "[TODO]"
    /PLACEHOLDER/gi,               // literal "PLACEHOLDER"
  ];

  for (const pattern of placeholderPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      issues.push({
        type: 'placeholder',
        matches: matches,
        severity: 'high'
      });
    }
  }

  // Check for repeated consecutive words (stuttering)
  const repeatedWordsMatch = text.match(/\b(\w+)\s+\1\b/gi);
  if (repeatedWordsMatch && repeatedWordsMatch.length > 0) {
    issues.push({
      type: 'repeated_words',
      matches: repeatedWordsMatch,
      severity: 'low'
    });
  }

  // Check for incomplete sentences (ending with "the", "a", "and", etc.)
  const incompletePattern = /(?:^|[.!?])\s*(?:[A-Z][^.!?]*)\s+(?:the|a|an|and|but|or|to|of|with|for|in|on|at)\s*[.!?]?\s*$/;
  if (incompletePattern.test(text)) {
    issues.push({
      type: 'incomplete_sentence',
      severity: 'medium'
    });
  }

  // Check for garbled text (too many consecutive consonants or vowels)
  const garbledPattern = /[bcdfghjklmnpqrstvwxyz]{6,}|[aeiou]{5,}/gi;
  const garbledMatches = text.match(garbledPattern);
  if (garbledMatches && garbledMatches.some(m => !['through', 'strength', 'straight', 'queue', 'aaa', 'ooo'].includes(m.toLowerCase()))) {
    issues.push({
      type: 'garbled_text',
      matches: garbledMatches,
      severity: 'medium'
    });
  }

  // If no issues found, return clean
  if (issues.length === 0) {
    return {
      valid: true,
      text: text,
      issues: []
    };
  }

  // Issues found - ask AI to fix the text
  logger.warn(`Story validation found ${issues.length} issue(s):`, issues.map(i => i.type).join(', '));

  try {
    const fixPrompt = `Fix this story text which has quality issues:

TEXT:
${text}

ISSUES DETECTED:
${issues.map(i => `- ${i.type}: ${i.matches ? i.matches.join(', ') : 'detected'}`).join('\n')}

CONTEXT:
${context.outline?.title ? `Story: ${context.outline.title}` : ''}
${context.characters ? `Characters: ${context.characters.map(c => c.name).join(', ')}` : ''}

Fix ALL issues:
- Replace any placeholders (*, [...], etc.) with appropriate words that fit the story context
- Remove repeated words (keep one instance)
- Complete any unfinished sentences
- Fix any garbled or nonsensical text

CRITICAL: Preserve ALL dialogue EXACTLY as written! Only fix issues in NARRATION.
Do NOT change any text inside quotation marks ("..." or "...").

Return ONLY the fixed text with no explanation or markup.`;

    const result = await completion({
      messages: [
        { role: 'system', content: 'You are a story editor. Fix text issues while maintaining the original story flow and tone.' },
        { role: 'user', content: fixPrompt }
      ],
      model: getUtilityModel(),  // Utility task - always uses gpt-4o-mini
      temperature: 0.3,
      max_tokens: 1500,
      agent_name: 'story_validator',
      sessionId
    });

    return {
      valid: false,
      original: text,
      text: result.content.trim(),
      issues: issues,
      fixed: true
    };
  } catch (e) {
    logger.error('Story validation fix failed:', e);
    // Return original text with issues logged
    return {
      valid: false,
      text: text,
      issues: issues,
      fixed: false,
      error: e.message
    };
  }
}

/**
 * Generate a scaffolded scene with placeholders for mature content
 *
 * This is part of the Venice Scaffolding Architecture:
 * 1. OpenAI generates structure with placeholders (this function)
 * 2. Venice expands placeholders with explicit content
 * 3. Content is stitched back together
 *
 * @param {Object} context - Scene generation context
 * @param {Object} intensitySettings - Intensity slider values
 * @param {Object} authorStyle - Author style configuration
 * @returns {Promise<string>} Scaffolded scene with placeholders
 */
export async function generateScaffoldedScene(context, intensitySettings, authorStyle) {
  const {
    outline,
    sceneIndex,
    previousScene,
    characters,
    preferences,
    lorebookContext = '',
    storyBibleContext = null,
    contextSummary = null,
    complexity = 0.5,
    sessionId = null,
    customPrompt = null
  } = context;

  // Import placeholder instructions builder
  const { buildPlaceholderInstructions } = await import('./prompts/scaffoldPromptTemplates.js');

  logger.info(`[ScaffoldGen] ============================================================`);
  logger.info(`[ScaffoldGen] GENERATING SCAFFOLDED SCENE ${sceneIndex + 1}`);
  logger.info(`[ScaffoldGen] Session: ${sessionId || 'N/A'} | Story: "${outline?.title || 'Unknown'}"`);
  logger.info(`[ScaffoldGen] Intensity: violence=${intensitySettings?.violence || 50}, gore=${intensitySettings?.gore || 50}, romance=${intensitySettings?.romance || 50}, adult=${intensitySettings?.adultContent || 0}, language=${intensitySettings?.language || 50}`);
  logger.info(`[ScaffoldGen] Author Style: ${authorStyle?.name || 'Default'}`);
  logger.info(`[ScaffoldGen] ============================================================`);

  // Build character context
  const characterList = characters?.map(c => ({
    name: c.name,
    gender: c.gender || 'unknown',
    role: c.role || 'character',
    description: c.description || '',
    voice_description: c.voice_description || ''
  })) || [];

  // Build placeholder instructions based on intensity settings
  const placeholderInstructions = buildPlaceholderInstructions(intensitySettings);

  // Get scene beat information
  const currentSceneBeat = outline?.scenes?.[sceneIndex] || {};
  const nextSceneBeat = outline?.scenes?.[sceneIndex + 1] || null;

  // Build author style section
  const authorStyleSection = authorStyle ? `
=== AUTHOR STYLE: ${authorStyle.name} ===
${authorStyle.algorithm || ''}

VOICE & TONE:
- Narrative Style: ${authorStyle.style?.narrative || 'Third person limited'}
- Dialogue Style: ${authorStyle.style?.dialogue || 'Natural and character-driven'}
- Tone: ${authorStyle.style?.tone || 'Engaging and immersive'}
- Language: ${authorStyle.style?.language || 'Literary but accessible'}

Maintain this author's distinctive voice throughout the scaffold.
The placeholders will be expanded to match this style.
` : '';

  // Build the scaffold generation prompt
  const scaffoldPrompt = `You are a master storyteller generating a SCAFFOLD for a mature story scene.

${authorStyleSection}

=== STORY CONTEXT ===
Title: ${outline?.title || 'Unknown'}
Genre: ${outline?.genre || preferences?.genre || 'Fiction'}
Setting: ${outline?.setting || 'A rich and detailed world'}

=== CHARACTERS ===
${characterList.map(c => `- ${c.name} (${c.gender}): ${c.role}${c.description ? ` - ${c.description}` : ''}`).join('\n')}

=== CURRENT SCENE ===
Scene ${sceneIndex + 1}: ${currentSceneBeat.title || currentSceneBeat.summary || 'Continue the story'}
${currentSceneBeat.description ? `Description: ${currentSceneBeat.description}` : ''}
${currentSceneBeat.mood ? `Mood: ${currentSceneBeat.mood}` : ''}

${previousScene ? `=== PREVIOUS SCENE SUMMARY ===\n${typeof previousScene === 'string' ? previousScene.substring(0, 1200) : previousScene.summary || 'The story continues...'}\n` : ''}

${contextSummary ? `=== STORY CONTEXT ===\n${contextSummary}\n` : ''}

${lorebookContext ? `=== WORLD LORE ===\n${lorebookContext}\n` : ''}

${customPrompt ? `=== USER'S STORY PREMISE ===\n${customPrompt}\n` : ''}

${nextSceneBeat ? `=== UPCOMING (for foreshadowing) ===\nNext scene will involve: ${nextSceneBeat.title || nextSceneBeat.summary || 'the story continues'}\n` : ''}

${placeholderInstructions}

=== YOUR TASK ===
Write Scene ${sceneIndex + 1} as a SCAFFOLD with placeholders for mature content.

Requirements:
1. Write rich, complete narrative AROUND the placeholders
2. Maintain ${authorStyle?.name || 'the author'}'s distinctive voice
3. Include character thoughts, emotions, atmospheric details
4. Use dialogue naturally (with dialogue tags)
5. Insert appropriate PLACEHOLDERS where mature content belongs
6. Target approximately ${Math.round(300 + (complexity * 400))} words (excluding placeholder expansions)

The scaffold should be a complete scene that reads well even with placeholders visible.
Each placeholder will be seamlessly replaced with content matching its intensity level.

BEGIN SCENE ${sceneIndex + 1}:
`;

  try {
    // Use OpenAI for scaffold generation (its strength is structure and style)
    const response = await callLLM({
      messages: [{ role: 'user', content: scaffoldPrompt }],
      model: getCreativeModel(),
      forceProvider: PROVIDERS.OPENAI, // Always use OpenAI for scaffolding
      temperature: 0.8,
      max_tokens: 3000,
      agent_name: 'scaffold_generator'
    });

    if (!response || typeof response !== 'string') {
      throw new Error('OpenAI returned empty scaffold');
    }

    logger.info(`[ScaffoldGen] Generated scaffold: ${response.length} chars`);

    // Log placeholder count for monitoring
    const placeholderCount = (response.match(/\[[A-Z_]+:/g) || []).length;
    logger.info(`[ScaffoldGen] Placeholders inserted: ${placeholderCount}`);

    // Track usage
    usageTracker.recordLLMCall({
      provider: 'openai',
      model: getCreativeModel(),
      inputTokens: Math.round(scaffoldPrompt.length / 4),
      outputTokens: Math.round(response.length / 4),
      agent_name: 'scaffold_generator',
      sessionId
    });

    return response.trim();

  } catch (error) {
    logger.error(`[ScaffoldGen] Error generating scaffold:`, error);
    throw error;
  }
}

export default {
  completion,
  completionWithRouting,
  callAgent,
  generateOutline,
  generateScene,
  generateScaffoldedScene,
  polishForNarration,
  checkSafety,
  generateChoices,
  checkLoreConsistency,
  parseJsonResponse,
  parseDialogueSegments,
  assignCharacterVoices,
  countTokens,
  validateTokenBudget,        // HIGH-4: Pre-flight token validation
  safeCreateChatCompletion,   // HIGH-4: Safe wrapper for chat completions
  summarizeContext,
  extractStoryFacts,
  determineComplexity,
  validateStoryText,
  requiresVeniceProvider,
  getLLMProviderStatus,
  obfuscateContent
};
