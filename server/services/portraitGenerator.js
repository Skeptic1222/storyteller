/**
 * Character Portrait Generator - Multi-Provider Image Generation
 *
 * Supports two providers:
 * - DALL-E 3: General purpose image generation (covers, one-off scenes)
 * - Fal AI: Character-consistent image generation (storybook, D&D campaigns)
 *
 * Provider Selection Logic:
 * - Use Fal AI when: storybook mode, campaign mode, recurring characters with references
 * - Use DALL-E when: cover art, standalone scenes, no character consistency needed
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as falAI from './falAI.js';
import { trackImageUsage } from './usageTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Portrait style presets
const PORTRAIT_STYLES = {
  fantasy: {
    name: 'Fantasy',
    description: 'Rich fantasy art style with magical elements',
    promptSuffix: 'fantasy art style, detailed, magical lighting, rich colors, ethereal'
  },
  watercolor: {
    name: 'Watercolor',
    description: 'Soft watercolor painting style',
    promptSuffix: 'watercolor painting style, soft edges, gentle colors, artistic'
  },
  storybook: {
    name: 'Storybook',
    description: 'Classic children\'s book illustration',
    promptSuffix: 'children\'s book illustration style, warm, friendly, whimsical'
  },
  anime: {
    name: 'Anime',
    description: 'Japanese anime art style',
    promptSuffix: 'anime art style, expressive eyes, vibrant colors, clean lines'
  },
  realistic: {
    name: 'Realistic',
    description: 'Photorealistic portrait style',
    promptSuffix: 'photorealistic portrait, detailed, professional photography lighting'
  },
  noir: {
    name: 'Noir',
    description: 'Dark, moody noir style',
    promptSuffix: 'film noir style, high contrast, dramatic shadows, black and white'
  },
  pixel: {
    name: 'Pixel Art',
    description: 'Retro pixel art style',
    promptSuffix: 'pixel art style, retro game aesthetic, 16-bit colors'
  },
  painterly: {
    name: 'Painterly',
    description: 'Oil painting style',
    promptSuffix: 'oil painting style, brushstrokes visible, classical portraiture'
  }
};

// Portrait cache directory
const PORTRAITS_DIR = path.join(__dirname, '..', '..', 'public', 'portraits');

/**
 * Initialize portraits directory
 */
async function ensurePortraitsDir() {
  try {
    await fs.mkdir(PORTRAITS_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.error('Failed to create portraits directory:', error);
    }
  }
}

/**
 * Sanitize text for DALL-E to avoid content policy violations
 * Replaces horror/violence/mature terms with safe alternatives
 * Enhanced to handle sci-fi thriller and horror content more comprehensively
 */
function sanitizeForDallE(text) {
  if (!text) return text;

  // Word replacements - DALL-E triggering words -> safe alternatives
  const replacements = {
    // Horror/violence terms
    'horror': 'gothic',
    'terror': 'suspense',
    'terrifying': 'dramatic',
    'scary': 'atmospheric',
    'creepy': 'mysterious',
    'blood': 'shadows',
    'bloody': 'dramatic',
    'death': 'fate',
    'dead': 'fallen',
    'kill': 'confront',
    'killing': 'confronting',
    'killed': 'confronted',
    'murder': 'mystery',
    'murdered': 'vanished',
    'murderer': 'suspect',
    'corpse': 'figure',
    'corpses': 'figures',
    'zombie': 'mysterious figure',
    'zombies': 'mysterious figures',
    'monster': 'creature',
    'monsters': 'creatures',
    'demon': 'mystical being',
    'demons': 'mystical beings',
    'evil': 'antagonistic',
    'dark': 'shadowy',
    'darkness': 'night',
    'sinister': 'mysterious',
    'menacing': 'imposing',
    'violent': 'intense',
    'violence': 'conflict',
    'torture': 'captivity',
    'scream': 'call',
    'screaming': 'calling',
    'screams': 'calls',
    'nightmare': 'dream',
    'nightmarish': 'dreamlike',
    'haunted': 'ancient',
    'haunting': 'atmospheric',
    'ghost': 'spirit',
    'ghosts': 'spirits',
    'ghostly': 'ethereal',
    'possessed': 'enchanted',
    'curse': 'spell',
    'cursed': 'enchanted',
    // Weapons
    'gun': 'device',
    'guns': 'devices',
    'weapon': 'artifact',
    'weapons': 'artifacts',
    'knife': 'blade',
    'knives': 'blades',
    'sword': 'blade',
    'swords': 'blades',
    // Body horror
    'wound': 'mark',
    'wounds': 'marks',
    'injury': 'mark',
    'injuries': 'marks',
    'gore': 'drama',
    'gory': 'intense',
    'gruesome': 'dramatic',
    // Mature themes
    'naked': 'dressed',
    'nude': 'clothed',
    // Sci-fi violence/thriller terms
    'alien invasion': 'alien arrival',
    'alien imposter': 'mysterious stranger',
    'imposter': 'stranger',
    'impostor': 'stranger',
    'attack': 'encounter',
    'attacked': 'encountered',
    'attacking': 'approaching',
    'battle': 'confrontation',
    'war': 'conflict',
    'explosion': 'energy burst',
    'explosions': 'energy bursts',
    'destroy': 'transform',
    'destroyed': 'transformed',
    'destruction': 'change',
    // Thriller/suspense terms that might trigger
    'doomed': 'isolated',
    'doom': 'fate',
    'chilling': 'atmospheric',
    'thriller': 'suspense story',
    'victim': 'character',
    'victims': 'characters',
    'hunter': 'seeker',
    'prey': 'target',
    'predator': 'pursuer',
    'stalk': 'follow',
    'stalking': 'following',
    'stalker': 'follower',
    'threat': 'challenge',
    'threatening': 'challenging',
    'dangerous': 'treacherous',
    'danger': 'peril',
    'survive': 'endure',
    'survival': 'endurance',
    'survivor': 'remaining person',
    'survivors': 'remaining people',
    // Accusation/conflict terms
    'debate': 'discuss',
    'accuse': 'question',
    'accused': 'questioned',
    'suspicion': 'uncertainty',
    'suspicious': 'uncertain',
    'suspect': 'individual',
    'suspects': 'individuals',
    // Death/dying terms
    'dying': 'fading',
    'die': 'fall',
    'dies': 'falls',
    'deadly': 'serious',
    'lethal': 'critical',
    'fatal': 'critical',
    // Fear/panic terms
    'fear': 'tension',
    'fearful': 'tense',
    'fearsome': 'imposing',
    'afraid': 'concerned',
    'panic': 'urgency',
    'panicked': 'urgent',
    'terrified': 'anxious',
    'horrified': 'shocked',
    'horrifying': 'startling',
    'horrific': 'dramatic',
    // Body/physical harm
    'bleed': 'fade',
    'bleeding': 'fading',
    'hurt': 'affected',
    'harm': 'affect',
    'harmed': 'affected',
    'pain': 'distress',
    'painful': 'difficult',
    'suffer': 'experience',
    'suffering': 'experiencing',
    // Containment/trap terms
    'trapped': 'confined',
    'trap': 'situation',
    'prison': 'chamber',
    'prisoner': 'captive',
    'cage': 'enclosure',
    'caged': 'enclosed',
    // Space horror specific
    'stranded': 'isolated',
    'abandoned': 'remote',
    'derelict': 'ancient',
    'infected': 'affected',
    'infection': 'influence',
    'contaminated': 'altered',
    'contamination': 'change',
    'parasite': 'entity',
    'parasitic': 'symbiotic',
    'hostile': 'challenging',
    'hostility': 'tension'
  };

  let sanitized = text.toLowerCase();

  // Apply replacements (case-insensitive) - process longer phrases first
  const sortedReplacements = Object.entries(replacements)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [trigger, safe] of sortedReplacements) {
    const regex = new RegExp(`\\b${trigger}\\b`, 'gi');
    sanitized = sanitized.replace(regex, safe);
  }

  // Restore original capitalization (first letter of sentences)
  sanitized = sanitized.replace(/(^|[.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());

  return sanitized;
}

/**
 * Build a DALL-E prompt for character portrait
 */
function buildPortraitPrompt(character, style = 'fantasy') {
  const styleConfig = PORTRAIT_STYLES[style] || PORTRAIT_STYLES.fantasy;

  // Extract character details
  const {
    name,
    role,
    traits = [],
    appearance = {},
    species = 'human',
    gender,
    age
  } = character;

  // Build description parts
  const parts = [];

  // Base description
  parts.push('Portrait of');

  // Age and gender
  if (age) {
    if (age < 13) parts.push('a young');
    else if (age < 20) parts.push('a teenage');
    else if (age < 40) parts.push('an adult');
    else if (age < 60) parts.push('a middle-aged');
    else parts.push('an elderly');
  } else {
    parts.push('a');
  }

  // Gender
  if (gender) {
    parts.push(gender.toLowerCase());
  }

  // Species
  if (species && species !== 'human') {
    parts.push(species);
  } else {
    parts.push('person');
  }

  // Name reference
  if (name) {
    parts.push(`named ${name}`);
  }

  // Role
  if (role) {
    parts.push(`who is a ${role}`);
  }

  // Physical appearance
  const appearanceDesc = [];
  if (appearance.hair) appearanceDesc.push(`${appearance.hair} hair`);
  if (appearance.eyes) appearanceDesc.push(`${appearance.eyes} eyes`);
  if (appearance.skin) appearanceDesc.push(`${appearance.skin} skin`);
  if (appearance.clothing) appearanceDesc.push(`wearing ${appearance.clothing}`);
  if (appearance.accessories) appearanceDesc.push(`with ${appearance.accessories}`);

  if (appearanceDesc.length > 0) {
    parts.push('with');
    parts.push(appearanceDesc.join(', '));
  }

  // Personality traits (expressed visually)
  if (traits.length > 0) {
    const visualTraits = traits.slice(0, 3).map(trait => {
      // Map traits to visual expressions
      const traitMap = {
        brave: 'confident expression',
        kind: 'warm smile',
        mysterious: 'enigmatic gaze',
        wise: 'knowing eyes',
        playful: 'mischievous grin',
        fierce: 'intense stare',
        gentle: 'soft expression',
        cunning: 'sly look',
        noble: 'regal bearing',
        wild: 'untamed appearance'
      };
      return traitMap[trait.toLowerCase()] || trait;
    });
    parts.push(`, ${visualTraits.join(', ')}`);
  }

  // Add style suffix
  parts.push(`,`);
  parts.push(styleConfig.promptSuffix);

  // Safety additions
  parts.push(', safe for all ages, tasteful, professional');

  return parts.join(' ');
}

/**
 * Generate a character portrait using DALL-E
 */
async function generatePortrait(character, options = {}) {
  const {
    style = 'fantasy',
    size = '1024x1024',
    quality = 'standard',
    saveLocally = true
  } = options;

  await ensurePortraitsDir();

  const prompt = buildPortraitPrompt(character, style);

  logger.info(`[PortraitGenerator] Generating portrait for ${character.name || 'character'}`);
  logger.debug(`[PortraitGenerator] Prompt: ${prompt}`);

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: quality,
      response_format: 'url'
    });

    const imageUrl = response.data[0].url;
    const revisedPrompt = response.data[0].revised_prompt;

    logger.info(`[PortraitGenerator] Portrait generated successfully`);

    let localPath = null;
    if (saveLocally) {
      // Download and save locally
      const imageResponse = await fetch(imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const filename = `portrait_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
      localPath = path.join(PORTRAITS_DIR, filename);

      await fs.writeFile(localPath, buffer);
      localPath = `/storyteller/portraits/${filename}`;

      logger.info(`[PortraitGenerator] Portrait saved to ${localPath}`);
    }

    return {
      success: true,
      imageUrl: localPath || imageUrl,
      originalUrl: imageUrl,
      revisedPrompt,
      style,
      characterName: character.name
    };

  } catch (error) {
    logger.error('[PortraitGenerator] Failed to generate portrait:', error);
    throw error;
  }
}

/**
 * Generate portrait and save to character in database
 */
async function generateAndSavePortrait(characterId, sessionId, options = {}) {
  // Get character from database
  const charResult = await pool.query(
    'SELECT * FROM characters WHERE id = $1 AND story_session_id = $2',
    [characterId, sessionId]
  );

  if (charResult.rows.length === 0) {
    throw new Error('Character not found');
  }

  const character = charResult.rows[0];

  // Parse traits if stored as JSON
  const traits = typeof character.traits_json === 'string'
    ? JSON.parse(character.traits_json)
    : character.traits_json || [];

  const appearance = typeof character.appearance_json === 'string'
    ? JSON.parse(character.appearance_json)
    : character.appearance_json || {};

  const charData = {
    name: character.name,
    role: character.role,
    traits: traits,
    appearance: appearance,
    species: character.species,
    gender: character.gender,
    age: character.age
  };

  // Generate portrait
  const result = await generatePortrait(charData, options);

  // Update character with portrait URL
  await pool.query(
    'UPDATE characters SET portrait_url = $1 WHERE id = $2',
    [result.imageUrl, characterId]
  );

  return result;
}

/**
 * Generate THREE cover art prompts with decreasing explicitness.
 * Uses GPT to create prompts that progressively become more abstract/symbolic.
 *
 * Tier 1: Detailed/literal - may fail content policy for mature themes
 * Tier 2: More abstract - better chance of passing
 * Tier 3: Very abstract/symbolic - guaranteed to pass (roses on bedsheets, etc.)
 */
async function generateThreeTierCoverPrompts(session) {
  const title = session.title || 'Untitled Story';
  const synopsis = session.synopsis || '';
  const outline = session.outline || {};
  const genres = session.genres || {};
  const mood = session.mood || 'adventurous';
  const characters = outline.main_characters || [];
  const themes = outline.themes || [];
  const setting = outline.setting || outline.world?.setting || '';

  // Build context for GPT
  const storyContext = `
Title: ${title}
Synopsis: ${synopsis}
Genres: ${Object.entries(genres).filter(([_, v]) => v > 30).map(([g]) => g).join(', ') || 'general fiction'}
Mood: ${mood}
Setting: ${setting}
Themes: ${Array.isArray(themes) ? themes.join(', ') : themes}
Main Characters: ${characters.slice(0, 3).map(c => typeof c === 'string' ? c : c.name || c.role).join(', ')}
`.trim();

  const prompt = `You are a book cover art director. Based on this story, generate THREE DALL-E image prompts for a paperback book cover. Each prompt should be progressively more abstract to ensure at least one passes DALL-E's content policy.

STORY CONTEXT:
${storyContext}

RULES:
1. NO TEXT in the image - the title will be overlaid separately
2. Leave space at top for title overlay
3. Professional book cover composition
4. Safe for DALL-E 3 content policy

Generate exactly 3 prompts:

PROMPT 1 (DETAILED): A literal, detailed interpretation of the story's key scene or atmosphere. Include specific visual elements that represent the story directly.

PROMPT 2 (ABSTRACT): A more symbolic interpretation. Replace explicit elements with metaphorical imagery. For violence, use shadows or silhouettes. For romance, use flowers or intertwined elements. For horror, use atmospheric effects.

PROMPT 3 (VERY ABSTRACT): A highly symbolic/artistic interpretation using universal symbols and safe imagery. Even explicit stories should become things like: "a single rose on silk sheets", "two hands almost touching against starlight", "a candle flame in darkness", "autumn leaves scattered on stone". This MUST be completely safe and poetic.

Return a JSON object with this exact structure:
{
  "prompt1": "detailed prompt here...",
  "prompt2": "abstract prompt here...",
  "prompt3": "very abstract symbolic prompt here..."
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a creative book cover art director. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    // Add common suffix to all prompts
    const suffix = ' Professional book cover artwork, painterly style, dramatic composition, rich atmosphere, cinematic lighting. NO TEXT, NO LETTERS, NO WORDS in the image. Leave space at top for title overlay.';

    return {
      prompts: [
        sanitizeForDallE(parsed.prompt1 || '') + suffix,
        sanitizeForDallE(parsed.prompt2 || '') + suffix,
        sanitizeForDallE(parsed.prompt3 || '') + suffix
      ],
      raw: parsed
    };

  } catch (error) {
    logger.error('[PortraitGenerator] Failed to generate three-tier prompts:', error);
    // Fallback to a very safe generic prompt
    return {
      prompts: [
        'A dramatic atmospheric scene with rich colors, professional book cover artwork, painterly style, NO TEXT.',
        'An abstract artistic composition with flowing shapes and dramatic lighting, book cover style, NO TEXT.',
        'A beautiful artistic gradient with subtle symbolic elements, elegant book cover artwork, NO TEXT.'
      ],
      raw: null,
      fallback: true
    };
  }
}

/**
 * Generate cover image for a story using three-tier prompt system.
 * Tries prompts in order of decreasing detail until one succeeds.
 * Uses synopsis, outline, genres, and mood to create a matching cover.
 */
async function generateStoryCover(session, options = {}) {
  const {
    style = 'painterly',
    size = '1792x1024', // Wide format for covers
    quality = 'hd'
  } = options;

  await ensurePortraitsDir();

  const title = session.title || 'Untitled Story';

  logger.info(`[PortraitGenerator] Generating story cover using three-tier prompt system`);

  // Generate three prompts with decreasing explicitness
  const { prompts, raw, fallback } = await generateThreeTierCoverPrompts(session);

  if (fallback) {
    logger.warn('[PortraitGenerator] Using fallback prompts due to GPT error');
  } else {
    logger.info('[PortraitGenerator] Generated three-tier prompts successfully');
    logger.debug('[PortraitGenerator] Tier 1 (detailed):', prompts[0]?.substring(0, 100) + '...');
    logger.debug('[PortraitGenerator] Tier 2 (abstract):', prompts[1]?.substring(0, 100) + '...');
    logger.debug('[PortraitGenerator] Tier 3 (symbolic):', prompts[2]?.substring(0, 100) + '...');
  }

  // Try each prompt in order until one succeeds
  let lastError = null;
  for (let tier = 0; tier < prompts.length; tier++) {
    const prompt = prompts[tier];
    const tierName = ['detailed', 'abstract', 'symbolic'][tier];

    logger.info(`[PortraitGenerator] Attempting Tier ${tier + 1} (${tierName}) cover generation...`);

    try {
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
        response_format: 'url'
      });

      const imageUrl = response.data[0].url;
      const revisedPrompt = response.data[0].revised_prompt;

      // Track DALL-E usage
      const imageType = quality === 'hd'
        ? (size === '1792x1024' || size === '1024x1792' ? 'hd1792' : 'hd1024')
        : (size === '1792x1024' || size === '1024x1792' ? 'standard1792' : 'standard1024');
      trackImageUsage(session.id, imageType);

      // Download and save locally
      const imageResponse = await fetch(imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const filename = `cover_${session.id}_${Date.now()}.png`;
      const localPath = path.join(PORTRAITS_DIR, filename);

      await fs.writeFile(localPath, buffer);
      const publicPath = `/storyteller/portraits/${filename}`;

      // Update session with cover URL
      await pool.query(
        'UPDATE story_sessions SET cover_image_url = $1, last_activity_at = NOW() WHERE id = $2',
        [publicPath, session.id]
      );

      logger.info(`[PortraitGenerator] Story cover generated successfully using Tier ${tier + 1} (${tierName})`);
      logger.info(`[PortraitGenerator] Cover saved to ${publicPath}`);

      return {
        success: true,
        imageUrl: publicPath,
        originalUrl: imageUrl,
        revisedPrompt,
        tierUsed: tier + 1,
        tierName
      };

    } catch (error) {
      lastError = error;
      const isContentPolicy = error.message?.includes('content_policy') ||
                              error.code === 'content_policy_violation' ||
                              error.error?.code === 'content_policy_violation';

      if (isContentPolicy) {
        logger.warn(`[PortraitGenerator] Tier ${tier + 1} (${tierName}) rejected by content policy, trying next tier...`);
      } else {
        // Non-content-policy error - might be rate limit, network, etc.
        logger.error(`[PortraitGenerator] Tier ${tier + 1} (${tierName}) failed with error:`, error.message);
      }

      // Continue to next tier
    }
  }

  // All tiers failed
  logger.error('[PortraitGenerator] All three tiers failed to generate cover');
  throw lastError || new Error('All cover generation attempts failed');
}

/**
 * Generate scene illustration
 */
async function generateSceneIllustration(sceneText, options = {}) {
  const {
    style = 'storybook',
    size = '1792x1024',
    quality = 'standard'
  } = options;

  await ensurePortraitsDir();

  // Summarize scene for illustration
  const prompt = `Illustration of a scene: ${sceneText.substring(0, 500)}... ${PORTRAIT_STYLES[style]?.promptSuffix || PORTRAIT_STYLES.storybook.promptSuffix}, storytelling composition, no text, safe for all ages`;

  logger.info(`[PortraitGenerator] Generating scene illustration`);

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: quality,
      response_format: 'url'
    });

    const imageUrl = response.data[0].url;

    // Download and save locally
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = `scene_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const localPath = path.join(PORTRAITS_DIR, filename);

    await fs.writeFile(localPath, buffer);
    const publicPath = `/storyteller/portraits/${filename}`;

    return {
      success: true,
      imageUrl: publicPath,
      originalUrl: imageUrl,
      revisedPrompt: response.data[0].revised_prompt
    };

  } catch (error) {
    logger.error('[PortraitGenerator] Failed to generate scene illustration:', error);
    throw error;
  }
}

/**
 * Get available portrait styles
 */
function getPortraitStyles() {
  return Object.entries(PORTRAIT_STYLES).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: value.description
  }));
}

/**
 * Generate a character portrait and store as reference for Fal AI
 * This should be called when creating the initial portrait for storybook/campaign mode
 */
async function generateAndStoreCharacterReference(characterId, sessionId, options = {}) {
  // First generate the portrait using DALL-E (creates the base reference)
  const result = await generateAndSavePortrait(characterId, sessionId, options);

  if (result.success && result.imageUrl) {
    // For Fal AI, we need an HTTPS URL, not a local path
    // Store the original URL if available, otherwise the local path
    const referenceUrl = result.originalUrl || result.imageUrl;

    // If it's a local path, we need to make it accessible via HTTPS
    // For now, store the local path - in production, this would need to be
    // converted to a public HTTPS URL
    await falAI.storeCharacterReference(sessionId, characterId, referenceUrl);
  }

  return result;
}

/**
 * Generate scene illustration with automatic provider selection
 *
 * @param {string} sessionId - Story session ID
 * @param {string} sceneText - Scene description
 * @param {Object} options - Generation options
 * @param {string} options.storyType - 'standard', 'storybook', 'campaign'
 * @param {string} options.style - Art style
 * @param {string} options.size - Image size
 */
async function generateSceneIllustrationSmart(sessionId, sceneText, options = {}) {
  const {
    storyType = 'standard',
    style = 'storybook',
    size = '1792x1024'
  } = options;

  // Check if we should use Fal AI for character consistency
  const needsCharacterConsistency = storyType === 'storybook' || storyType === 'campaign';

  if (needsCharacterConsistency && falAI.isAvailable()) {
    // Get characters with reference images for this session
    const charactersWithRefs = await falAI.getCharactersWithReferences(sessionId);

    if (charactersWithRefs.length > 0) {
      logger.info(`[PortraitGenerator] Using Fal AI for character-consistent scene (${charactersWithRefs.length} references)`);

      const result = await falAI.generateSceneWithCharacters(
        sessionId,
        sceneText,
        charactersWithRefs,
        { style, size }
      );

      if (result) {
        return result;
      }

      // Fall through to DALL-E if Fal AI fails
      logger.info('[PortraitGenerator] Fal AI failed, falling back to DALL-E');
    }
  }

  // Use DALL-E for standard scenes
  logger.info('[PortraitGenerator] Using DALL-E for scene illustration');
  return generateSceneIllustration(sceneText, { style, size });
}

/**
 * Pre-generate all character portraits for storybook mode
 * This should be called during the launch sequence before the story starts
 *
 * @param {string} sessionId - Story session ID
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of generated portrait results
 */
async function preGenerateStorybookPortraits(sessionId, options = {}) {
  const {
    style = 'storybook',
    onProgress = null // Callback for progress updates
  } = options;

  // Get all characters for this session
  const charResult = await pool.query(
    'SELECT * FROM characters WHERE story_session_id = $1',
    [sessionId]
  );

  const characters = charResult.rows;
  const results = [];

  logger.info(`[PortraitGenerator] Pre-generating ${characters.length} character portraits for storybook mode`);

  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];

    // Report progress
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: characters.length,
        characterName: character.name,
        percent: Math.round(((i + 1) / characters.length) * 100)
      });
    }

    try {
      // Generate and store as reference for Fal AI
      const result = await generateAndStoreCharacterReference(
        character.id,
        sessionId,
        { style }
      );

      results.push({
        characterId: character.id,
        characterName: character.name,
        success: result.success,
        imageUrl: result.imageUrl
      });

    } catch (error) {
      logger.error(`[PortraitGenerator] Failed to generate portrait for ${character.name}:`, error);
      results.push({
        characterId: character.id,
        characterName: character.name,
        success: false,
        error: error.message
      });
    }
  }

  logger.info(`[PortraitGenerator] Completed ${results.filter(r => r.success).length}/${characters.length} portraits`);
  return results;
}

/**
 * Get the recommended provider for a given context
 */
function getRecommendedProvider(context = {}) {
  return falAI.selectProvider(context);
}

/**
 * Check if Fal AI is available
 */
function isFalAIAvailable() {
  return falAI.isAvailable();
}

export {
  // Original DALL-E functions
  generatePortrait,
  generateAndSavePortrait,
  generateStoryCover,
  generateSceneIllustration,
  getPortraitStyles,
  PORTRAIT_STYLES,
  buildPortraitPrompt,
  // New dual-provider functions
  generateAndStoreCharacterReference,
  generateSceneIllustrationSmart,
  preGenerateStorybookPortraits,
  getRecommendedProvider,
  isFalAIAvailable
};
