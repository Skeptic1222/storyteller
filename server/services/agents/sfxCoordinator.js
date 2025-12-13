/**
 * SFX Coordinator Agent
 * AI-powered sound effects coordination for immersive storytelling
 *
 * This agent analyzes story content and determines optimal SFX placement,
 * timing, and layering for maximum immersion.
 *
 * UPDATED: Now uses multi-agent collaboration for context-aware SFX detection
 * - Agent 1: Context Analyzer (genre, setting, forbidden sounds)
 * - Agent 2: Scene Detector (finds sound opportunities)
 * - Agent 3: Library Matcher (maps to appropriate sounds)
 * - Agent 4: Validator (quality check)
 *
 * MODEL: This is a UTILITY agent - always uses gpt-4o-mini regardless of tier
 */

import { completion, parseJsonResponse } from '../openai.js';
import { SoundEffectsService, AMBIENT_SFX_LIBRARY, SFX_KEYWORD_MAP } from '../soundEffects.js';
import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { getUtilityModel } from '../modelSelection.js';
import { detectSFXMultiAgent, GENRE_SFX_LIBRARY } from '../sfxAgents.js';

// Extended SFX prompt templates for dynamic generation
const SFX_GENERATION_TEMPLATES = {
  // Weather (10 variations)
  weather: [
    'Light drizzle on window pane, cozy indoor atmosphere',
    'Heavy monsoon rain, intense tropical storm',
    'Freezing rain hitting metal surfaces',
    'Thunder crack followed by rolling rumble',
    'Gentle summer breeze through open window',
    'Arctic wind howling through cracks',
    'Hailstorm hitting rooftops',
    'Morning fog with distant foghorn',
    'Humid tropical air with cicadas',
    'Desert wind with sand particles'
  ],

  // Environments (20 variations)
  environments: [
    'Ancient stone temple, echoing chambers, dripping water',
    'Bustling bazaar, merchants calling, exotic spices',
    'Haunted mansion, creaking floors, distant moans',
    'Royal court, hushed whispers, rustling silk',
    'Ship deck in storm, waves crashing, wood creaking',
    'Underground mine, pickaxes, cart wheels on rails',
    'Garden maze, wind through hedges, fountain',
    'Battlefield aftermath, distant cries, crows calling',
    'Alchemist laboratory, bubbling potions, glass clinking',
    'Elven forest, magical chimes, ethereal atmosphere',
    'Dwarf forge, hammering metal, bellows pumping',
    'Pirate cove, waves on rocks, seagulls',
    'Wizard tower, arcane humming, turning pages',
    'Village festival, music, laughter, dancing',
    'Graveyard at midnight, wind, owls, rustling leaves',
    'Dragon\'s lair, rumbling breath, gold coins',
    'Prison tower, chains rattling, distant screams',
    'Mountain peak, thin wind, snow crunching',
    'Swamp, bubbling mud, insects, frogs',
    'Celestial realm, heavenly choir, wind chimes'
  ],

  // Actions (15 variations)
  actions: [
    'Climbing rope, strain, fabric friction',
    'Breaking glass window, shatter, tinkle',
    'Lock picking, metal clicks, tension',
    'Pouring liquid into goblet, splash',
    'Unfurling scroll, parchment crinkle',
    'Striking flint, sparks, fire igniting',
    'Rowing boat, oars in water, creak',
    'Sharpening blade on whetstone',
    'Climbing stone wall, scraping, pebbles falling',
    'Opening treasure chest, rusty hinges',
    'Drawing curtains, fabric whoosh',
    'Turning heavy mechanism, gears grinding',
    'Breaking chains, metal snap',
    'Lighting torch, flame catching',
    'Sealing letter with wax, sizzle'
  ],

  // Combat (12 variations)
  combat: [
    'Staff striking shield, wood on metal',
    'Dagger throwing, whoosh and thunk',
    'Shield bash impact, metal clang',
    'Crossbow loading and firing',
    'War hammer crushing armor',
    'Spear thrust and impact',
    'Bare knuckle combat, grunts, hits',
    'Cavalry charge, many horses, battle cries',
    'Siege weapons launching, catapult',
    'Assassin\'s blade, silent and deadly',
    'Magical sword clash, energy crackle',
    'Monster claws slashing, roar'
  ],

  // Magic (15 variations)
  magic: [
    'Healing spell, warm energy, chimes',
    'Ice spell casting, crystallization',
    'Fire ball launching, whoosh, explosion',
    'Telekinesis, objects floating, low hum',
    'Time manipulation, temporal distortion',
    'Summoning ritual, demonic voices',
    'Illusion dissolving, reality shift',
    'Shield spell activating, energy barrier',
    'Mind reading, psychic whispers',
    'Transformation magic, bones cracking',
    'Necromancy, dark energy, whispers',
    'Light spell, radiant burst',
    'Curse being cast, dark words',
    'Potion bubbling, magical effect',
    'Enchantment completing, power surge'
  ],

  // Creatures (12 variations)
  creatures: [
    'Wolf pack approaching, multiple growls',
    'Giant spider skittering, clicking',
    'Troll lumbering, heavy footsteps',
    'Fairy wings fluttering, tiny bells',
    'Serpent slithering, hissing',
    'Goblin cackling, mischievous sounds',
    'Griffin screech, powerful wings',
    'Undead groaning, shuffling',
    'Phoenix rising, flames, triumphant cry',
    'Kraken tentacles, water churning',
    'Banshee wailing, piercing scream',
    'Elemental forming, raw power'
  ],

  // Emotional (10 variations)
  emotional: [
    'Heartbeat racing, suspense building',
    'Collective gasp of crowd',
    'Reverent silence, single candle',
    'Joyous celebration, cheers',
    'Mournful silence, single bell toll',
    'Romantic atmosphere, gentle strings',
    'Creeping dread, low drone',
    'Triumphant fanfare, horns',
    'Peaceful meditation, om chanting',
    'Intense confrontation, bass rumble'
  ]
};

// SFX timing suggestions based on narrative elements
const TIMING_PATTERNS = {
  scene_start: { offset: 0, fadeIn: 2000, volume: 0.3 },
  action: { offset: 0, fadeIn: 500, volume: 0.7 },
  dialogue: { offset: 0, fadeIn: 1000, volume: 0.2 },
  transition: { offset: -1000, fadeIn: 1500, volume: 0.4 },
  climax: { offset: 0, fadeIn: 500, volume: 0.8 },
  resolution: { offset: 0, fadeIn: 2000, volume: 0.3 }
};

// SFX Level configurations
// Controls how many sound effects are detected/generated
export const SFX_LEVELS = {
  low: {
    name: 'Default',
    description: 'Occasional sounds - wind, rain, sword clangs',
    targetEffects: { min: 4, max: 6 },
    promptGuidance: `Provide 4-6 sound effects per scene focusing on key atmospheric and action sounds.
Include: 1-2 ambient/background sounds (environment, weather), 2-3 action sounds (footsteps, doors, objects), plus any key dramatic moments.
IMPORTANT: Always include sounds for any mentioned hissing, beeping, humming, or atmospheric elements.`
  },
  medium: {
    name: 'More Sounds',
    description: 'Frequent sounds - engine hums, footsteps, ambient environment',
    targetEffects: { min: 6, max: 10 },
    promptGuidance: `Provide 6-10 sound effects per scene for an immersive experience.
Include: 2-3 ambient layers (background, atmosphere, environmental), 3-4 action/movement sounds, 2-3 detail sounds.
Every mentioned sound should have an effect: hissing, humming, beeping, creaking, footsteps, breathing, etc.
Consider: continuous ambient sounds, character actions, environmental details (echoes, machinery, nature).`
  },
  high: {
    name: 'Lots of Sounds',
    description: 'Nearly continuous audio - immersive soundscape',
    targetEffects: { min: 10, max: 18 },
    promptGuidance: `Provide 10-18 sound effects per scene for MAXIMUM immersion.
There should almost NEVER be a moment without some sound playing.
Layer multiple ambient sounds: constant background (engine hum, wind, crowd murmur), environmental details (console beeps, footsteps, fabric rustling), action sounds.
Include subtle sounds: breathing, fabric movement, small objects, distant echoes, atmospheric pressure changes.
Every action, every movement, every environmental element should have accompanying audio.
Think like a film sound designer creating a rich soundscape. If it's mentioned, it needs a sound!`
  }
};

export class SFXCoordinatorAgent {
  constructor() {
    this.sfxService = new SoundEffectsService();
    // Use centralized model selection - SFX is a UTILITY agent
    this.model = getUtilityModel();
  }

  /**
   * Analyze a scene and determine all SFX opportunities
   * NOW USES MULTI-AGENT COLLABORATION for context-aware detection
   *
   * @param {string} sceneText - The scene narrative
   * @param {object} context - Scene context (mood, setting, characters, sfxLevel)
   * @returns {Array} Ordered list of SFX with timing
   */
  async analyzeScene(sceneText, context = {}) {
    try {
      // Get SFX level configuration (default to 'low' for backwards compatibility)
      const sfxLevel = context.sfxLevel || 'low';
      const levelConfig = SFX_LEVELS[sfxLevel] || SFX_LEVELS.low;

      // Build story config from context for multi-agent system
      const storyConfig = {
        title: context.title || '',
        genre: context.genre || context.setting || '',
        setting: context.setting || '',
        premise: context.premise || sceneText.substring(0, 500),
        specialRequests: context.specialRequests || ''
      };

      // Use the new multi-agent SFX detection pipeline (pass sfxLevel!)
      logger.info(`[SFXCoordinator] Using multi-agent SFX detection (level: ${sfxLevel})`);
      const multiAgentResult = await detectSFXMultiAgent(sceneText, storyConfig, context.outline, sfxLevel);

      if (multiAgentResult.success && multiAgentResult.sfxList.length > 0) {
        logger.info(`[SFXCoordinator] Multi-agent detected ${multiAgentResult.sfxList.length} sounds for ${multiAgentResult.context.genre} genre`);

        // Apply SFX level limits
        const maxEffects = levelConfig.targetEffects.max;
        const sfxList = multiAgentResult.sfxList.slice(0, maxEffects);

        // Transform to expected format
        return sfxList.map((sfx, index) => ({
          id: `sfx_${Date.now()}_${index}`,
          sfx_type: sfx.category,
          sfx_key: sfx.sfxKey,
          sfxKey: sfx.sfxKey,
          description: sfx.name,
          timing: sfx.timing || 'start',
          duration: sfx.duration < 5 ? 'short' : sfx.duration > 12 ? 'long' : 'medium',
          loop: sfx.loop || false,
          volume: 0.5,
          reason: sfx.reason,
          offset: 0,
          fadeIn: sfx.loop ? 2000 : 500,
          // Multi-agent metadata
          genre: multiAgentResult.context.genre,
          validationScore: multiAgentResult.validation?.score
        }));
      }

      // Fallback to old method if multi-agent fails
      logger.warn('[SFXCoordinator] Multi-agent failed, falling back to legacy detection');
      return this.legacyAnalyzeScene(sceneText, context, levelConfig);

    } catch (error) {
      logger.error('[SFXCoordinator] Analysis error:', error);
      // Fall back to keyword-based detection with level awareness
      return this.sfxService.detectSceneSFX(sceneText, { ...context, sfxLevel: context.sfxLevel || 'low' });
    }
  }

  /**
   * Legacy scene analysis (fallback if multi-agent fails)
   */
  async legacyAnalyzeScene(sceneText, context, levelConfig) {
    const sfxLevel = context.sfxLevel || 'low';

    const prompt = this.buildAnalysisPrompt(sceneText, context);

    const response = await completion({
      messages: [
        {
          role: 'system',
          content: `You are an expert sound designer for audio storytelling. Analyze narrative text and identify sound effect opportunities for immersive listening.

For each opportunity, provide:
1. sfx_type: category of sound (weather, environment, action, combat, magic, creature, emotional)
2. description: specific sound to generate (be detailed for AI generation)
3. timing: when in the narrative (start, middle, action_moment, end)
4. duration: short (1-3s), medium (5-10s), long (15-30s)
5. loop: true if ambient/continuous, false if one-shot
6. volume: soft (0.2), medium (0.5), loud (0.8)
7. reason: why this sound enhances the scene

SFX INTENSITY LEVEL: ${levelConfig.name.toUpperCase()}
${levelConfig.promptGuidance}

Include both ambient layers and punctuating sounds as appropriate for this level.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: this.model,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: sfxLevel === 'high' ? 2500 : sfxLevel === 'medium' ? 2000 : 1500,
      agent_name: 'sfx_coordinator'
    });

    const analysis = parseJsonResponse(response.content);
    return this.processSFXAnalysis(analysis, sceneText, sfxLevel);
  }

  /**
   * Analyze entire story for comprehensive SFX planning
   * @param {string} sessionId - Story session ID
   * @param {Array} scenes - All story scenes
   * @returns {object} Complete SFX plan with timing
   */
  async analyzeFullStory(sessionId, scenes) {
    try {
      // Get story context
      const sessionResult = await pool.query(
        'SELECT config_json, title FROM story_sessions WHERE id = $1',
        [sessionId]
      );
      const config = sessionResult.rows[0]?.config_json || {};

      const sfxPlan = {
        sessionId,
        totalScenes: scenes.length,
        sfxByScene: [],
        totalEffects: 0,
        ambientLayers: [],
        punctuatingEffects: []
      };

      // Determine global ambient based on setting
      const globalAmbient = this.determineGlobalAmbient(config);
      if (globalAmbient) {
        sfxPlan.ambientLayers.push(globalAmbient);
      }

      // Get SFX level from config (default to 'low')
      const sfxLevel = config.sfx_level || 'low';
      logger.info(`[SFXCoordinator] Using SFX level: ${sfxLevel}`);

      // Analyze each scene
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const context = {
          sceneIndex: i,
          totalScenes: scenes.length,
          mood: scene.mood,
          setting: config.setting,
          genre: config.genre,
          sfxLevel, // Pass SFX level to scene analysis
          isFirstScene: i === 0,
          isLastScene: i === scenes.length - 1,
          previousScene: i > 0 ? scenes[i - 1] : null
        };

        const sceneSFX = await this.analyzeScene(scene.polished_text || scene.text, context);
        sfxPlan.sfxByScene.push({
          sceneIndex: i,
          sceneId: scene.id,
          effects: sceneSFX
        });
        sfxPlan.totalEffects += sceneSFX.length;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Identify recurring/layered ambient sounds
      sfxPlan.ambientLayers = this.identifyAmbientLayers(sfxPlan.sfxByScene);

      logger.info(`[SFXCoordinator] Analyzed ${scenes.length} scenes, found ${sfxPlan.totalEffects} SFX opportunities`);

      return sfxPlan;
    } catch (error) {
      logger.error('[SFXCoordinator] Full story analysis error:', error);
      return { error: error.message };
    }
  }

  /**
   * Generate custom SFX based on scene-specific needs
   * @param {string} description - Detailed sound description
   * @param {object} options - Generation options
   */
  async generateCustomSFX(description, options = {}) {
    try {
      // First try to find a close match in library
      const libraryMatch = this.findLibraryMatch(description);
      if (libraryMatch) {
        logger.info(`[SFXCoordinator] Using library match: ${libraryMatch}`);
        return {
          source: 'library',
          sfxKey: libraryMatch,
          audio: await this.sfxService.getAmbientSound(libraryMatch)
        };
      }

      // Generate custom sound
      const duration = options.duration || 'medium';
      const durationSeconds = duration === 'short' ? 3 : duration === 'long' ? 20 : 8;

      logger.info(`[SFXCoordinator] Generating custom SFX: ${description.substring(0, 50)}...`);

      const audio = await this.sfxService.generateSoundEffect(description, {
        duration: durationSeconds,
        loop: options.loop || false
      });

      return {
        source: 'generated',
        description,
        audio
      };
    } catch (error) {
      logger.error('[SFXCoordinator] Custom SFX generation error:', error);
      return null;
    }
  }

  /**
   * Build analysis prompt for GPT
   */
  buildAnalysisPrompt(sceneText, context) {
    let prompt = `Analyze this scene for sound effect opportunities:\n\n"${sceneText}"\n\n`;

    if (context.mood) prompt += `Mood: ${context.mood}\n`;
    if (context.setting) prompt += `Setting: ${context.setting}\n`;
    if (context.genre) prompt += `Genre: ${context.genre}\n`;
    if (context.isFirstScene) prompt += `Note: This is the opening scene - set the atmosphere.\n`;
    if (context.isLastScene) prompt += `Note: This is the final scene - emphasize emotional impact.\n`;

    prompt += `\nProvide a JSON response with an "effects" array containing all SFX opportunities.`;

    return prompt;
  }

  /**
   * Process GPT analysis into SFX specifications
   */
  processSFXAnalysis(analysis, sceneText) {
    if (!analysis?.effects || !Array.isArray(analysis.effects)) {
      // Fallback to basic detection
      return this.sfxService.detectSceneSFX(sceneText, {});
    }

    return analysis.effects.map((effect, index) => {
      const timing = TIMING_PATTERNS[effect.timing] || TIMING_PATTERNS.scene_start;
      const sfxType = effect.sfx_type || 'ambient';

      // Pass sfx_type for fallback matching
      const matchedKey = this.findLibraryMatch(effect.description, sfxType);

      return {
        id: `sfx_${Date.now()}_${index}`,
        sfx_type: sfxType,
        description: effect.description,
        sfxKey: matchedKey,
        needsGeneration: !matchedKey,
        timing: effect.timing || 'start',
        duration: effect.duration || 'medium',
        loop: effect.loop || false,
        volume: parseFloat(effect.volume) || 0.5,
        reason: effect.reason,
        offset: timing.offset,
        fadeIn: timing.fadeIn
      };
    });
  }

  /**
   * Find best matching library SFX for a description
   * Enhanced with fuzzy matching, fallback logic, and GENRE-AWARE matching
   */
  findLibraryMatch(description, sfxType = null, genre = null) {
    const lowerDesc = description.toLowerCase();

    // FIRST: Check genre-specific library if genre is provided
    if (genre && GENRE_SFX_LIBRARY[genre]) {
      const genreLib = GENRE_SFX_LIBRARY[genre];
      for (const [effectName, effect] of Object.entries(genreLib)) {
        const promptLower = effect.prompt.toLowerCase();
        // Check for significant word matches
        const descWords = lowerDesc.split(/\s+/).filter(w => w.length > 3);
        const matchCount = descWords.filter(word => promptLower.includes(word)).length;
        if (matchCount >= 2) {
          return `${genre}.${effectName}`;
        }
      }
    }

    // Check keyword map (exact keyword match)
    for (const [keyword, sfxKey] of Object.entries(SFX_KEYWORD_MAP)) {
      if (lowerDesc.includes(keyword)) {
        return sfxKey;
      }
    }

    // Extended keyword matching for common AI descriptions
    const extendedKeywords = {
      // Tavern/inn sounds
      'mug': 'locations.tavern',
      'clinking': 'locations.tavern',
      'glasses': 'locations.tavern',
      'laughter': 'locations.tavern',
      'bawdy': 'locations.tavern',
      'revelry': 'locations.tavern',
      'chatter': 'locations.tavern',
      'crowd': 'locations.tavern',
      'toast': 'locations.tavern',
      'mead': 'locations.tavern',
      'ale': 'locations.tavern',
      // Fire sounds
      'crackling': 'nature.fire_campfire',
      'fireplace': 'nature.fire_campfire',
      'hearth': 'nature.fire_campfire',
      'torch': 'nature.fire_torch',
      'flames': 'nature.fire_large',
      // Combat sounds
      'sword': 'combat.sword_clash',
      'blade': 'combat.sword_draw',
      'steel': 'combat.sword_clash',
      'clashing': 'combat.sword_clash',
      'armor': 'combat.armor_movement',
      // Nature sounds
      'wind': 'weather.wind_gentle',
      'breeze': 'weather.wind_gentle',
      'howling': 'weather.wind_strong',
      'rain': 'weather.rain_light',
      'dripping': 'locations.cave',
      // Magic sounds
      'magical': 'magic.magic_ambient',
      'spell': 'magic.spell_cast',
      'enchant': 'magic.enchant',
      'arcane': 'magic.magic_ambient',
      // Environment
      'forest': 'locations.forest_day',
      'birds': 'nature.birds_morning',
      'ocean': 'locations.ocean',
      'waves': 'locations.ocean',
      'dungeon': 'locations.dungeon',
      'cave': 'locations.cave',
      'stone': 'actions.footsteps_stone',
      // Emotional/atmosphere
      'tense': 'atmosphere.tension',
      'suspense': 'atmosphere.tension',
      'mysterious': 'atmosphere.mysterious',
      'eerie': 'atmosphere.scary',
      'peaceful': 'atmosphere.peaceful',
      'triumphant': 'atmosphere.triumphant'
    };

    for (const [keyword, sfxKey] of Object.entries(extendedKeywords)) {
      if (lowerDesc.includes(keyword)) {
        return sfxKey;
      }
    }

    // Check library prompts with lower threshold (1 significant word match)
    let bestMatch = null;
    let bestScore = 0;

    for (const [category, effects] of Object.entries(AMBIENT_SFX_LIBRARY)) {
      for (const [effectName, effect] of Object.entries(effects)) {
        const promptLower = effect.prompt.toLowerCase();
        // Check for significant word overlap
        const descWords = lowerDesc.split(/\s+/).filter(w => w.length > 3);
        const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);

        // Count bidirectional matches
        const descInPrompt = descWords.filter(word => promptLower.includes(word)).length;
        const promptInDesc = promptWords.filter(word => lowerDesc.includes(word)).length;
        const score = descInPrompt + promptInDesc;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = `${category}.${effectName}`;
        }
      }
    }

    // Return best match if score is at least 2 (reduced from previous strict matching)
    if (bestScore >= 2) {
      return bestMatch;
    }

    // Fallback based on sfx_type if provided
    if (sfxType) {
      const typeFallbacks = {
        'weather': 'weather.wind_gentle',
        'environment': 'locations.forest_day',
        'action': 'actions.footsteps_stone',
        'combat': 'combat.sword_clash',
        'magic': 'magic.magic_ambient',
        'creature': 'creatures.wolf_howl',
        'emotional': 'atmosphere.peaceful',
        'ambient': 'atmosphere.peaceful'
      };

      if (typeFallbacks[sfxType]) {
        logger.info(`[SFX] Using fallback for type '${sfxType}': ${typeFallbacks[sfxType]}`);
        return typeFallbacks[sfxType];
      }
    }

    return null;
  }

  /**
   * Determine global ambient sound based on story setting
   */
  determineGlobalAmbient(config) {
    const setting = (config.setting || '').toLowerCase();
    const genre = (config.genre || '').toLowerCase();

    // Setting-based ambient
    if (setting.includes('forest') || setting.includes('wood')) {
      return { sfxKey: 'locations.forest_day', volume: 0.2, loop: true };
    }
    if (setting.includes('castle') || setting.includes('fortress')) {
      return { sfxKey: 'locations.castle_interior', volume: 0.15, loop: true };
    }
    if (setting.includes('ocean') || setting.includes('sea') || setting.includes('ship')) {
      return { sfxKey: 'locations.ocean', volume: 0.2, loop: true };
    }
    if (setting.includes('cave') || setting.includes('dungeon')) {
      return { sfxKey: 'locations.dungeon', volume: 0.15, loop: true };
    }
    if (setting.includes('city') || setting.includes('town')) {
      return { sfxKey: 'locations.city_medieval', volume: 0.15, loop: true };
    }

    // Genre-based fallback
    if (genre.includes('horror') || genre.includes('dark')) {
      return { sfxKey: 'atmosphere.scary', volume: 0.2, loop: true };
    }
    if (genre.includes('mystery')) {
      return { sfxKey: 'atmosphere.mysterious', volume: 0.2, loop: true };
    }

    return null;
  }

  /**
   * Identify consistent ambient layers across scenes
   */
  identifyAmbientLayers(sfxByScene) {
    const ambientCounts = {};

    // Count ambient SFX occurrences
    for (const scene of sfxByScene) {
      for (const effect of scene.effects) {
        if (effect.loop) {
          const key = effect.sfxKey || effect.description;
          ambientCounts[key] = (ambientCounts[key] || 0) + 1;
        }
      }
    }

    // Return ambient sounds that appear in multiple scenes
    return Object.entries(ambientCounts)
      .filter(([key, count]) => count >= 2)
      .map(([key, count]) => ({
        key,
        occurrences: count,
        recommended: count >= Math.floor(sfxByScene.length / 2)
      }));
  }

  /**
   * Get SFX recommendations for a CYOA story with branches
   */
  async analyzeCYOAStory(sessionId) {
    try {
      // Get all scenes including branches
      const scenesResult = await pool.query(`
        SELECT id, sequence_index, branch_key, polished_text, mood
        FROM story_scenes
        WHERE story_session_id = $1
        ORDER BY sequence_index, branch_key
      `, [sessionId]);

      const scenes = scenesResult.rows;

      // Get choices
      const choicesResult = await pool.query(`
        SELECT sc.*, ss.sequence_index as scene_index
        FROM story_choices sc
        JOIN story_scenes ss ON sc.scene_id = ss.id
        WHERE sc.story_session_id = $1
      `, [sessionId]);

      const sfxPlan = await this.analyzeFullStory(sessionId, scenes);

      // Add branch-specific recommendations
      sfxPlan.branches = {};
      for (const scene of scenes) {
        if (scene.branch_key) {
          if (!sfxPlan.branches[scene.branch_key]) {
            sfxPlan.branches[scene.branch_key] = [];
          }
          const sceneSFX = sfxPlan.sfxByScene.find(s => s.sceneId === scene.id);
          if (sceneSFX) {
            sfxPlan.branches[scene.branch_key].push(sceneSFX);
          }
        }
      }

      return sfxPlan;
    } catch (error) {
      logger.error('[SFXCoordinator] CYOA analysis error:', error);
      return { error: error.message };
    }
  }
}

// Expanded SFX templates for on-demand generation
export const EXPANDED_SFX_TEMPLATES = SFX_GENERATION_TEMPLATES;

export default SFXCoordinatorAgent;
