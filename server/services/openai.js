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
import { parseTaggedProse, validateTagBalance, extractSpeakers } from './agents/tagParser.js';

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
const STORY_MODEL = process.env.STORY_MODEL || 'gpt-4';
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
          `CRITICAL INSTRUCTION: You MUST respond with valid JSON only. No markdown code blocks, no explanatory text before or after - just raw JSON starting with { and ending with }.\n\n${originalContent}`;
      }
    }

    const response = await openai.chat.completions.create(requestParams);

    const message = response.choices[0]?.message;

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
  return (
    (intensity.gore || 0) > GORE_THRESHOLDS.MODERATE ||
    (intensity.violence || 0) > 60 ||
    (intensity.romance || 0) > ROMANCE_THRESHOLDS.STEAMY
  );
}

/**
 * Get provider status for health checks
 */
export function getLLMProviderStatus() {
  return getProviderStatus();
}

/**
 * FAIL LOUD: Detect if JSON response was truncated due to max_tokens limit
 * Returns object with isTruncated boolean and array of reasons
 */
function detectJsonTruncation(content) {
  const reasons = [];

  // Count brackets to detect unclosed structures
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }

  // Check for unclosed structures
  if (braceCount > 0) {
    reasons.push(`${braceCount} unclosed brace(s) '{'`);
  }
  if (bracketCount > 0) {
    reasons.push(`${bracketCount} unclosed bracket(s) '['`);
  }

  // Check if we're in an unclosed string (odd number of unescaped quotes)
  if (inString) {
    reasons.push('unclosed string (ends inside quotes)');
  }

  // Check for common truncation patterns at end of content
  const lastChars = content.substring(Math.max(0, content.length - 20)).trim();

  // Ends with incomplete key-value (no closing quote or value)
  if (/"\s*:\s*$/.test(lastChars)) {
    reasons.push('ends with incomplete key-value pair');
  }

  // Ends with comma (expecting more content)
  if (/,\s*$/.test(lastChars) && (braceCount > 0 || bracketCount > 0)) {
    reasons.push('ends with comma inside structure');
  }

  return {
    isTruncated: reasons.length > 0,
    reasons,
    stats: { braceCount, bracketCount, inString }
  };
}

/**
 * Parse JSON from GPT response
 * Improved to handle edge cases where LLM adds text before/after JSON
 */
export function parseJsonResponse(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Invalid content: expected non-empty string');
  }

  const trimmed = content.trim();

  // Debug: Log content type and length
  logger.debug(`[parseJsonResponse] Input type: ${typeof content}, length: ${content.length}, trimmed length: ${trimmed.length}`);
  logger.debug(`[parseJsonResponse] First 100 chars: ${trimmed.substring(0, 100)}`);

  // FAIL LOUD: Detect JSON truncation before attempting parse
  // Truncation happens when max_tokens is too low - response gets cut off mid-JSON
  const truncationIndicators = detectJsonTruncation(trimmed);
  if (truncationIndicators.isTruncated) {
    const errorMsg = `FATAL: JSON response appears TRUNCATED. ` +
      `Indicators: ${truncationIndicators.reasons.join(', ')}. ` +
      `Content length: ${trimmed.length} chars. ` +
      `Last 100 chars: "${trimmed.substring(Math.max(0, trimmed.length - 100))}". ` +
      `This typically means max_tokens is too low for the response. Increase max_tokens in agent config.`;
    logger.error(`[parseJsonResponse] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Strategy 1: Direct parse (fastest path for clean JSON)
  try {
    const result = JSON.parse(trimmed);
    logger.debug('[parseJsonResponse] Strategy 1 (direct parse) succeeded');
    return result;
  } catch (e) {
    logger.debug(`[parseJsonResponse] Strategy 1 failed: ${e.message}`);
    // Continue to extraction strategies
  }

  // Strategy 2: Extract JSON from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const result = JSON.parse(codeBlockMatch[1].trim());
      logger.debug('[parseJsonResponse] Strategy 2 (code block) succeeded');
      return result;
    } catch (e) {
      logger.debug(`[parseJsonResponse] Strategy 2 failed: ${e.message}`);
    }
  }

  // Strategy 3: Smart bracket-matching extraction
  // Find the first '{' and match to its closing '}' using depth tracking
  const extracted = extractFirstJsonObject(trimmed);
  if (extracted) {
    try {
      const result = JSON.parse(extracted);
      logger.debug('[parseJsonResponse] Strategy 3 (bracket matching) succeeded');
      return result;
    } catch (e) {
      logger.debug(`[parseJsonResponse] Strategy 3 failed: ${e.message}`);
    }
  } else {
    logger.debug('[parseJsonResponse] Strategy 3: No JSON object extracted');
  }

  // Strategy 4: Greedy regex as last resort (original behavior)
  const greedyMatch = trimmed.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      const result = JSON.parse(greedyMatch[0]);
      logger.debug('[parseJsonResponse] Strategy 4 (greedy regex) succeeded');
      return result;
    } catch (e) {
      logger.error(`[parseJsonResponse] All extraction strategies failed. Last error: ${e.message}`);
      logger.error(`[parseJsonResponse] Content preview (first 500 chars): ${trimmed.substring(0, 500)}`);
      logger.error(`[parseJsonResponse] Content preview (last 200 chars): ${trimmed.substring(Math.max(0, trimmed.length - 200))}`);
    }
  } else {
    logger.error('[parseJsonResponse] No JSON object found in response at all');
    logger.error(`[parseJsonResponse] Full content: ${trimmed.substring(0, 1000)}`);
  }

  throw new Error('Could not parse JSON from response');
}

/**
 * Extract the first complete JSON object from text using bracket depth tracking
 * This handles cases where LLM adds explanation text after the JSON
 */
function extractFirstJsonObject(text) {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          // Found the matching closing brace
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  // No complete JSON object found (unclosed braces)
  return null;
}

/**
 * Attempt to repair truncated JSON responses
 * Common when max_tokens is hit mid-generation
 */
export function attemptJsonRepair(content, type = 'generic') {
  logger.info(`[JsonRepair] Attempting to repair ${type} JSON (${content.length} chars)`);

  // First, try to extract just the prose if it's a scene
  if (type === 'scene') {
    // Try to extract prose field even from truncated JSON
    const proseMatch = content.match(/"prose"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/s);
    if (proseMatch) {
      let prose = proseMatch[1];

      // Clean up any trailing incomplete escape sequences
      prose = prose.replace(/\\+$/, '');

      // Try to extract dialogue_map if present
      let dialogueMap = [];
      const dialogueMapMatch = content.match(/"dialogue_map"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
      if (dialogueMapMatch) {
        try {
          // Try to parse complete dialogue entries
          const dialogueContent = dialogueMapMatch[1];
          const dialogueEntries = dialogueContent.match(/\{[^{}]*\}/g) || [];
          for (const entry of dialogueEntries) {
            try {
              const parsed = JSON.parse(entry);
              if (parsed.quote && parsed.speaker) {
                dialogueMap.push(parsed);
              }
            } catch (e) {
              // Skip incomplete entries
            }
          }
        } catch (e) {
          logger.debug(`[JsonRepair] Could not extract dialogue_map entries`);
        }
      }

      logger.info(`[JsonRepair] Recovered prose (${prose.length} chars) and ${dialogueMap.length} dialogue entries`);

      return {
        prose: prose,
        dialogue_map: dialogueMap,
        new_characters: [],
        _repaired: true,
        _repair_note: 'JSON was truncated, recovered what was available'
      };
    }
  }

  // Generic repair: try to close unclosed brackets/braces
  let repaired = content;

  // Count unclosed structures
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;

  // Close any unterminated strings
  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }

  // Close brackets/braces
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  try {
    const parsed = JSON.parse(repaired);
    parsed._repaired = true;
    logger.info(`[JsonRepair] Successfully repaired JSON by closing ${openBraces - closeBraces} braces, ${openBrackets - closeBrackets} brackets`);
    return parsed;
  } catch (e) {
    logger.error(`[JsonRepair] Repair failed: ${e.message}`);
    throw new Error(`JSON repair failed: ${e.message}`);
  }
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

  // CRITICAL FIX: Retry with fallback model if GPT-5.x returns empty content
  const maxRetries = 2;
  const fallbackModel = 'gpt-4o';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use provider routing for mature content, standard completion otherwise
      if (useProviderRouting) {
        logger.info(`[callAgent] ${agentName}: Using provider routing for mature content`);
        return await completionWithRouting(completionParams);
      }
      return await completion(completionParams);
    } catch (error) {
      const isEmptyContentError = error.message?.includes('empty content') ||
                                   error.message?.includes('returned empty');
      const isGpt5Model = completionParams.model?.startsWith('gpt-5');
      const isContentPolicyError = error.message?.includes('content_policy') ||
                                   error.message?.includes('refused') ||
                                   error.isContentPolicy;

      // If OpenAI refused content, try Venice (for mature content)
      if (isContentPolicyError && context.contentSettings?.audience === 'mature') {
        logger.warn(`[callAgent] ${agentName}: OpenAI content policy triggered, switching to Venice`);
        completionParams.contentSettings = context.contentSettings;
        completionParams.forceProvider = PROVIDERS.VENICE;
        return await completionWithRouting(completionParams);
      }

      if (isEmptyContentError && isGpt5Model && attempt < maxRetries) {
        logger.warn(`[callAgent] ${agentName}: Attempt ${attempt}/${maxRetries} failed with empty content from ${completionParams.model}, retrying with ${fallbackModel}`);
        completionParams.model = fallbackModel;
        continue;
      }

      // Re-throw for non-retryable errors or final attempt
      throw error;
    }
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
  if (audience === 'children') {
    audienceGuide = `
Target audience: CHILDREN (ages 3-10)
- Keep all content family-friendly and age-appropriate
- No violence, scary content, or romantic themes
- Focus on positive messages: friendship, courage, kindness
- Use simple language and concepts
- Happy, reassuring endings`;
  } else if (audience === 'mature') {
    audienceGuide = `
Target audience: MATURE (teens and adults)
- Content can include more complex themes
- Respect the intensity sliders for gore, violence, romance, etc.
- Can explore darker themes if requested
- More nuanced character motivations`;
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
  // Attempt with primary model first, fall back to GPT-4o if it fails
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // On retry, force GPT-4o model which has better JSON reliability
    const useModelOverride = attempt > 1 ? 'gpt-4o' : null;

    try {
      if (useModelOverride) {
        logger.warn(`[generateOutline] Retry ${attempt}/${maxRetries} with fallback model: ${useModelOverride}`);
      }

      const result = await callAgent('planner', prompt, {
        userPreferences: preferences,
        sessionId,
        response_format: { type: 'json_object' },
        modelOverride: useModelOverride  // Force specific model on retry
      });

      // Check for empty content (GPT-5.x issue)
      if (!result.content || result.content.trim() === '') {
        throw new Error('Empty content returned from AI');
      }

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

      // CRITICAL: Validate gender for ALL characters - fail loud if missing
      // This ensures LLM provides gender, eliminating need for regex inference
      const validGenders = ['male', 'female', 'non-binary', 'neutral'];
      const genderErrors = [];

      for (const char of parsed.main_characters) {
        const gender = char.gender?.toLowerCase()?.trim();
        if (!gender || !validGenders.includes(gender)) {
          genderErrors.push(`"${char.name}": gender is "${char.gender || 'MISSING'}"`);
        }
      }

      if (genderErrors.length > 0) {
        logger.error(`[generateOutline] Gender validation FAILED for ${genderErrors.length} characters:`);
        genderErrors.forEach(err => logger.error(`[generateOutline]   - ${err}`));
        throw new Error(`Outline missing valid gender for: ${genderErrors.join(', ')}. Gender MUST be one of: male, female, non-binary, neutral`);
      }

      logger.info(`[generateOutline] Gender validation PASSED - all ${parsed.main_characters.length} characters have valid gender`);

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

      if (attempt < maxRetries) {
        logger.info(`[generateOutline] Will retry with fallback model...`);
      }
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
    sessionId = null
  } = context;

  logger.info(`[Scene+Dialogue] ============================================================`);
  logger.info(`[Scene+Dialogue] SCENE ${sceneIndex + 1} WITH EMBEDDED DIALOGUE METADATA`);
  logger.info(`[Scene+Dialogue] Session: ${sessionId || 'N/A'} | Story: "${outline?.title || 'Unknown'}"`);
  logger.info(`[Scene+Dialogue] Characters: ${characters?.map(c => `${c.name} (${c.gender || 'unknown'})`).join(', ')}`);
  logger.info(`[Scene+Dialogue] ============================================================`);

  // Build character list with gender for the LLM
  const characterList = characters?.map(c => ({
    name: c.name,
    gender: c.gender || 'unknown',
    role: c.role || 'character',
    description: c.description || ''
  })) || [];

  // Build the scene prompt (same as before)
  let scenePrompt = `Write scene ${sceneIndex + 1} of the story.

Story: ${outline.title}
Setting: ${outline.setting}
Current act: ${outline.acts?.[Math.floor(sceneIndex / 3)]?.summary || 'Main story'}`;

  if (contextSummary) {
    scenePrompt += `\n\nSTORY SO FAR:\n${contextSummary}`;
  } else if (previousScene) {
    scenePrompt += `\n\nPrevious scene: ${previousScene}`;
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

  // Format instructions
  let formatInstructions = 'Write 100-200 words.';
  if (preferences?.story_format === 'picture_book') {
    formatInstructions = 'Write 50-100 words. Focus on vivid, visual moments.';
  } else if (preferences?.story_format === 'novella' || preferences?.story_format === 'novel') {
    formatInstructions = 'Write 200-300 words. Allow for more description.';
  }

  // Author style
  let authorStyleGuidance = '';
  if (preferences?.author_style) {
    const authorStyle = getAuthorStyle(preferences.author_style);
    if (authorStyle) {
      authorStyleGuidance = `\nWRITING STYLE - Write in the style of ${authorStyle.name}:\n${authorStyle.promptTemplate}`;
    }
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
${authorStyleGuidance}

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
${authorStyleGuidance}

Remember: Return JSON with "prose", "dialogue_map", and "new_characters" fields.`;
  }

  // Adjust token limit
  const maxTokens = complexity > 0.7 ? 1500 : 1200;

  // Content settings for provider routing
  const contentSettings = {
    audience: preferences?.audience || 'general',
    intensity: {
      gore: preferences?.gore || 0,
      violence: preferences?.violence || 0,
      romance: preferences?.romance || 0,
      scary: preferences?.scary || 0
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

      // Step 1: Validate tag balance (deterministic - no LLM needed)
      logger.info(`[Scene+Dialogue] TAG_VALIDATION_START | proseLength: ${taggedProse.length}`);
      const validation = validateTagBalance(taggedProse);
      if (!validation.valid) {
        logger.error(`[Scene+Dialogue] TAG_VALIDATION_FAILED | errors: ${validation.errors.join('; ')}`);
        throw new Error(`[Scene+Dialogue] FAIL_LOUD: Tag validation failed: ${validation.errors.join('; ')}`);
      }
      logger.info(`[Scene+Dialogue] TAG_VALIDATION_PASSED`);

      // Step 2: Parse tags deterministically (100% reliable)
      logger.info(`[Scene+Dialogue] TAG_PARSING_START`);
      const segments = parseTaggedProse(taggedProse);
      logger.info(`[Scene+Dialogue] TAG_PARSING_COMPLETE | segments: ${segments.length}`);

      // Step 3: Extract speakers from tags
      const speakersFromTags = extractSpeakers(taggedProse);
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
        content: taggedProse, // Keep tags in content for downstream processing
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
          enrichedDialogueMap.push({
            ...d,
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

            enrichedDialogueMap.push({
              ...d,
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

  prompt += `\n\n${formatInstructions}
Include vivid descriptions and natural dialogue.
${preferences?.bedtime_mode ? 'Keep the tone calm and soothing for bedtime.' : ''}
${preferences?.is_final ? 'This is the final scene - bring the story to a satisfying conclusion.' : ''}
${structureGuidance}
${seriesGuidance}
${cyoaGuidance}
${authorStyleGuidance}`;

  // Adjust token limit based on complexity
  const maxTokens = complexity > 0.7 ? 1000 : 800;

  // Build content settings for provider routing (Venice for mature content)
  const contentSettings = {
    audience: preferences?.audience || 'general',
    intensity: {
      gore: preferences?.gore || 0,
      violence: preferences?.violence || 0,
      romance: preferences?.romance || 0,
      scary: preferences?.scary || 0
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
 */
export async function checkSafety(text, limits = {}, sessionId = null) {
  const audienceContext = limits.audience === 'children'
    ? 'This content is for CHILDREN (ages 3-10). Be STRICT about all limits.'
    : limits.audience === 'mature'
    ? 'This is for mature audiences. Some darker themes are acceptable within limits.'
    : 'This is for a general audience. Keep content family-friendly by default.';

  const prompt = `Review this story content for safety:

${text}

${audienceContext}

Content Limits (0=none allowed, 100=maximum intensity):
- Gore: ${limits.gore ?? 0}/100
- Violence: ${limits.violence ?? 20}/100
- Scary content: ${limits.scary ?? 30}/100
- Romance: ${limits.romance ?? 20}/100
- Strong language: ${limits.language ?? 10}/100

Check if the content exceeds any of these limits. Content should stay AT OR BELOW the specified level.
For children's content, enforce near-zero tolerance regardless of slider values.

Return JSON:
{
  "safe": boolean,
  "concerns": ["list of concerns if any"],
  "exceeded_limits": {"gore": boolean, "violence": boolean, "scary": boolean, "romance": boolean, "language": boolean},
  "suggested_changes": "description of needed changes if unsafe"
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

/**
 * All available voices for comprehensive D&D character assignment
 */
const DND_VOICE_MAP = {
  // Deep British/American male voices
  george: 'JBFqnCBsd6RMkjVDRZzb',
  brian: 'nPczCjzI2devNBz1zQrb',
  callum: 'N2lVS1w4EtoT3dr4eOWO',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  adam: 'pNInz6obpgDQGcFmaJgB',
  antoni: 'ErXwobaYiN019PkySvjV',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  // Female voices
  charlotte: 'XB0fDUnXU5powFXDhCwa',
  aria: '9BWtsMINqrJLrRacOk9x',
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  elli: 'MF3mGyEYCl7XYWbV9V6O'
};

/**
 * D&D character type to voice mapping
 */
const DND_CHARACTER_VOICES = {
  // Class-based assignments
  fighter: DND_VOICE_MAP.arnold,
  barbarian: DND_VOICE_MAP.callum,
  paladin: DND_VOICE_MAP.george,
  ranger: DND_VOICE_MAP.brian,
  rogue: DND_VOICE_MAP.adam,
  wizard: DND_VOICE_MAP.daniel,
  sorcerer: DND_VOICE_MAP.daniel,
  warlock: DND_VOICE_MAP.callum,
  cleric: DND_VOICE_MAP.george,
  druid: DND_VOICE_MAP.josh,
  bard: DND_VOICE_MAP.josh,
  monk: DND_VOICE_MAP.sam,
  // Race-based adjustments
  elf: DND_VOICE_MAP.daniel,
  dwarf: DND_VOICE_MAP.arnold,
  halfling: DND_VOICE_MAP.sam,
  gnome: DND_VOICE_MAP.sam,
  orc: DND_VOICE_MAP.callum,
  goblin: DND_VOICE_MAP.elli,
  dragon: DND_VOICE_MAP.callum,
  // NPC types
  tavern_keeper: DND_VOICE_MAP.antoni,
  merchant: DND_VOICE_MAP.sam,
  guard: DND_VOICE_MAP.josh,
  noble: DND_VOICE_MAP.daniel,
  peasant: DND_VOICE_MAP.sam,
  villain: DND_VOICE_MAP.callum,
  mysterious: DND_VOICE_MAP.callum,
  wise: DND_VOICE_MAP.antoni,
  // Female variants
  fighter_female: DND_VOICE_MAP.domi,
  barbarian_female: DND_VOICE_MAP.domi,
  paladin_female: DND_VOICE_MAP.charlotte,
  ranger_female: DND_VOICE_MAP.charlotte,
  rogue_female: DND_VOICE_MAP.aria,
  wizard_female: DND_VOICE_MAP.rachel,
  sorcerer_female: DND_VOICE_MAP.rachel,
  warlock_female: DND_VOICE_MAP.rachel,
  cleric_female: DND_VOICE_MAP.bella,
  druid_female: DND_VOICE_MAP.bella,
  bard_female: DND_VOICE_MAP.aria,
  elf_female: DND_VOICE_MAP.charlotte,
  noble_female: DND_VOICE_MAP.rachel,
  villain_female: DND_VOICE_MAP.domi
};

/**
 * Assign voices to characters based on their roles
 * Supports both regular stories and D&D campaigns
 */
export function assignCharacterVoices(characters, voiceSuggestions, isCampaign = false) {
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

    // For D&D campaigns, try to match character archetypes
    if (isCampaign) {
      const combined = `${role} ${name} ${description} ${traits}`;

      // Check for D&D classes
      const classMatches = [
        ['fighter', 'warrior', 'knight', 'soldier'],
        ['barbarian', 'berserker', 'savage'],
        ['paladin', 'holy', 'divine', 'crusader'],
        ['ranger', 'hunter', 'archer', 'scout'],
        ['rogue', 'thief', 'assassin', 'spy', 'shadow'],
        ['wizard', 'mage', 'archmage', 'spellcaster'],
        ['sorcerer', 'magic', 'elemental'],
        ['warlock', 'dark', 'pact', 'demon'],
        ['cleric', 'priest', 'healer', 'holy'],
        ['druid', 'nature', 'forest', 'wild'],
        ['bard', 'musician', 'singer', 'performer'],
        ['monk', 'martial', 'fist']
      ];

      for (const [dndClass, ...keywords] of classMatches) {
        if (keywords.some(k => combined.includes(k)) || combined.includes(dndClass)) {
          const voiceKey = isFemale ? `${dndClass}_female` : dndClass;
          assignedVoice = DND_CHARACTER_VOICES[voiceKey] || DND_CHARACTER_VOICES[dndClass];
          voiceRole = dndClass;
          break;
        }
      }

      // Check for races if no class match
      if (!assignedVoice) {
        const raceMatches = [
          ['elf', 'elven', 'elvish'],
          ['dwarf', 'dwarven', 'stout'],
          ['orc', 'orcish', 'half-orc'],
          ['goblin', 'kobold', 'imp'],
          ['dragon', 'wyrm', 'drake'],
          ['halfling', 'hobbit', 'small']
        ];

        for (const [race, ...keywords] of raceMatches) {
          if (keywords.some(k => combined.includes(k)) || combined.includes(race)) {
            const voiceKey = isFemale ? `${race}_female` : race;
            assignedVoice = DND_CHARACTER_VOICES[voiceKey] || DND_CHARACTER_VOICES[race];
            voiceRole = race;
            break;
          }
        }
      }

      // Check for NPC types
      if (!assignedVoice) {
        const npcMatches = [
          ['tavern_keeper', 'innkeeper', 'bartender', 'tavern'],
          ['merchant', 'shop', 'trader', 'vendor'],
          ['guard', 'soldier', 'patrol'],
          ['noble', 'lord', 'lady', 'king', 'queen', 'prince', 'princess'],
          ['villain', 'evil', 'dark lord', 'necromancer'],
          ['mysterious', 'stranger', 'hooded', 'cloaked'],
          ['wise', 'elder', 'sage', 'old']
        ];

        for (const [npcType, ...keywords] of npcMatches) {
          if (keywords.some(k => combined.includes(k)) || combined.includes(npcType)) {
            const voiceKey = isFemale ? `${npcType}_female` : npcType;
            assignedVoice = DND_CHARACTER_VOICES[voiceKey] || DND_CHARACTER_VOICES[npcType];
            voiceRole = npcType;
            break;
          }
        }
      }
    }

    // Fallback to standard role-based assignment
    if (!assignedVoice) {
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

export default {
  completion,
  completionWithRouting,
  callAgent,
  generateOutline,
  generateScene,
  polishForNarration,
  checkSafety,
  generateChoices,
  checkLoreConsistency,
  parseJsonResponse,
  parseDialogueSegments,
  assignCharacterVoices,
  countTokens,
  summarizeContext,
  extractStoryFacts,
  determineComplexity,
  validateStoryText,
  requiresVeniceProvider,
  getLLMProviderStatus,
  obfuscateContent
};
