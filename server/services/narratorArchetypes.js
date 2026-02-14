/**
 * Narrator Archetype System
 *
 * Provides 12 distinct narrator personas for genre-appropriate prosody and delivery.
 * Each archetype defines voice settings, pause patterns, emotional strengths,
 * and delivery notes that integrate with ElevenLabs, voice direction, and audio assembly.
 */

import { logger } from '../utils/logger.js';

/**
 * 12 Narrator Archetypes
 *
 * Each archetype is optimized for specific genres and storytelling styles.
 */
export const NARRATOR_ARCHETYPES = {
  theatrical_baritone: {
    id: 'theatrical_baritone',
    name: 'Theatrical Baritone',
    description: 'Gravitas and dramatic pauses. Commanding presence with resonant depth.',

    voiceSettings: {
      stability: 0.35,        // Low stability for expressive variation
      similarity_boost: 0.85, // High similarity for consistent character
      style: 0.85,            // High style for theatrical delivery
      speed: 0.9              // Slightly slower for gravitas
    },

    pauseFrequency: 'high',
    pausePattern: {
      sentenceEnd: 800,
      paragraphEnd: 1500,
      dramaticMoment: 2000,
      beforeReveal: 1200
    },

    preferredV3Tags: ['dramatic', 'commanding', 'intense', 'gravitas'],
    avoidV3Tags: ['playful', 'childish', 'giggly'],

    deliveryNotes: 'Speak with resonant depth and commanding presence. Use dramatic pauses before important revelations. Let the weight of each word settle before moving on. Channel classical theater and audiobook gravitas.',

    emotionalStrengths: ['dramatic', 'epic', 'tense', 'authoritative', 'mysterious'],
    emotionalWeaknesses: ['playful', 'cute', 'comedic'],

    bestFor: ['epic', 'drama', 'historical', 'tragedy']
  },

  sardonic_observer: {
    id: 'sardonic_observer',
    name: 'Sardonic Observer',
    description: 'Dry wit and unexpected timing. Detached amusement with understated irony.',

    voiceSettings: {
      stability: 0.55,        // Medium stability for controlled delivery
      similarity_boost: 0.80,
      style: 0.65,            // Medium style for subtle expression
      speed: 1.0              // Normal speed with deliberate pacing
    },

    pauseFrequency: 'irregular',
    pausePattern: {
      sentenceEnd: 500,
      paragraphEnd: 1000,
      dramaticMoment: 1500,
      beforeReveal: 800       // Short pauses for deadpan timing
    },

    preferredV3Tags: ['dry', 'wry', 'matter-of-fact', 'understated'],
    avoidV3Tags: ['excited', 'over-the-top', 'gushing'],

    deliveryNotes: 'Maintain an air of detached amusement. Let irony land through understatement rather than emphasis. Pause before punchlines but deliver them flatly. Channel the tone of a knowing observer who has seen it all.',

    emotionalStrengths: ['witty', 'ironic', 'observational', 'knowing', 'cynical'],
    emotionalWeaknesses: ['earnest', 'enthusiastic', 'wholesome'],

    bestFor: ['mystery', 'satire', 'literary', 'dark_comedy']
  },

  animated_storyteller: {
    id: 'animated_storyteller',
    name: 'Animated Storyteller',
    description: 'Enthusiastic energy and playful voices. Infectious joy in storytelling.',

    voiceSettings: {
      stability: 0.25,        // Very low stability for expressive range
      similarity_boost: 0.75,
      style: 0.95,            // Very high style for maximum expression
      speed: 1.1              // Slightly faster for energy
    },

    pauseFrequency: 'medium',
    pausePattern: {
      sentenceEnd: 400,
      paragraphEnd: 900,
      dramaticMoment: 1200,
      beforeReveal: 600
    },

    preferredV3Tags: ['excited', 'playful', 'surprised', 'delighted', 'animated'],
    avoidV3Tags: ['solemn', 'grim', 'depressed'],

    deliveryNotes: 'Bring infectious enthusiasm to every moment. Use vocal variety to create distinct character voices. React with genuine delight to story developments. Make every scene feel like an adventure. Channel a beloved storytime narrator.',

    emotionalStrengths: ['playful', 'joyful', 'surprising', 'adventurous', 'whimsical'],
    emotionalWeaknesses: ['tragic', 'grim', 'disturbing'],

    bestFor: ['children', 'comedy', 'adventure', 'fairy_tale']
  },

  intimate_confessor: {
    id: 'intimate_confessor',
    name: 'Intimate Confessor',
    description: 'Whispered secrets and vulnerable honesty. Direct connection with the listener.',

    voiceSettings: {
      stability: 0.45,        // Medium-low for emotional nuance
      similarity_boost: 0.90, // High similarity for intimacy
      style: 0.70,            // Medium-high style for emotional depth
      speed: 0.85             // Slower for intimacy
    },

    pauseFrequency: 'high',
    pausePattern: {
      sentenceEnd: 700,
      paragraphEnd: 1400,
      dramaticMoment: 1800,
      beforeReveal: 1100
    },

    preferredV3Tags: ['intimate', 'vulnerable', 'soft', 'confessional', 'tender'],
    avoidV3Tags: ['booming', 'aggressive', 'harsh'],

    deliveryNotes: 'Speak as if sharing a secret with a close friend. Let vulnerability color the delivery. Use silence to let emotions breathe. Create a sense of private confession and emotional truth.',

    emotionalStrengths: ['romantic', 'vulnerable', 'tender', 'reflective', 'intimate'],
    emotionalWeaknesses: ['action', 'bombastic', 'aggressive'],

    bestFor: ['romance', 'literary', 'memoir', 'contemporary']
  },

  hardboiled_narrator: {
    id: 'hardboiled_narrator',
    name: 'Hardboiled Narrator',
    description: 'Noir cynicism and clipped delivery. World-weary wisdom in every word.',

    voiceSettings: {
      stability: 0.50,        // Medium stability for controlled grit
      similarity_boost: 0.85,
      style: 0.60,            // Medium style for understated toughness
      speed: 0.95             // Slightly slower for weight
    },

    pauseFrequency: 'medium',
    pausePattern: {
      sentenceEnd: 550,
      paragraphEnd: 1100,
      dramaticMoment: 1400,
      beforeReveal: 900
    },

    preferredV3Tags: ['gritty', 'weary', 'cynical', 'matter-of-fact', 'tough'],
    avoidV3Tags: ['cheerful', 'innocent', 'naive'],

    deliveryNotes: 'Deliver with the weariness of someone who has seen too much. Keep sentences clipped and punchy. Let cynicism color observations. Channel classic noir narration with its streetwise poetry.',

    emotionalStrengths: ['cynical', 'tense', 'streetwise', 'weary', 'dangerous'],
    emotionalWeaknesses: ['innocent', 'naive', 'hopeful'],

    bestFor: ['noir', 'thriller', 'crime', 'detective']
  },

  documentary_voice: {
    id: 'documentary_voice',
    name: 'Documentary Voice',
    description: 'Objective authority and measured pacing. Credible and informative.',

    voiceSettings: {
      stability: 0.70,        // High stability for authoritative consistency
      similarity_boost: 0.85,
      style: 0.45,            // Lower style for objective delivery
      speed: 0.95             // Measured pace
    },

    pauseFrequency: 'low',
    pausePattern: {
      sentenceEnd: 450,
      paragraphEnd: 900,
      dramaticMoment: 1200,
      beforeReveal: 700
    },

    preferredV3Tags: ['authoritative', 'clear', 'informative', 'measured'],
    avoidV3Tags: ['emotional', 'panicked', 'over-the-top'],

    deliveryNotes: 'Maintain objective authority while keeping engagement. Present information clearly and credibly. Use measured pacing to convey importance without melodrama. Channel nature documentaries and science programs.',

    emotionalStrengths: ['informative', 'authoritative', 'fascinating', 'revelatory'],
    emotionalWeaknesses: ['melodramatic', 'panicked', 'silly'],

    bestFor: ['scifi', 'historical', 'educational', 'techno_thriller']
  },

  bardic_epic: {
    id: 'bardic_epic',
    name: 'Bardic Epic',
    description: 'Poetic grandeur and mythic sweep. The voice of legend and lore.',

    voiceSettings: {
      stability: 0.30,        // Low stability for epic expression
      similarity_boost: 0.85,
      style: 0.90,            // Very high style for mythic delivery
      speed: 0.85             // Slower for epic weight
    },

    pauseFrequency: 'high',
    pausePattern: {
      sentenceEnd: 900,
      paragraphEnd: 1700,
      dramaticMoment: 2200,
      beforeReveal: 1400
    },

    preferredV3Tags: ['epic', 'mythic', 'grand', 'heroic', 'solemn'],
    avoidV3Tags: ['casual', 'modern', 'chatty'],

    deliveryNotes: 'Speak as if recounting tales that shaped the world. Let language have poetic rhythm and mythic weight. Use long pauses to mark the passage of ages. Channel ancient bards and epic poetry.',

    emotionalStrengths: ['epic', 'mythic', 'heroic', 'tragic', 'legendary'],
    emotionalWeaknesses: ['casual', 'modern', 'mundane'],

    bestFor: ['epic_fantasy', 'mythology', 'heroic_fantasy', 'legend']
  },

  fractured_unreliable: {
    id: 'fractured_unreliable',
    name: 'Fractured Unreliable',
    description: 'Self-interrupting and uncertain. Reality bending in the telling.',

    voiceSettings: {
      stability: 0.20,        // Very low stability for erratic delivery
      similarity_boost: 0.70,
      style: 0.80,            // High style for emotional volatility
      speed: 1.05             // Slightly faster, uneven
    },

    pauseFrequency: 'irregular',
    pausePattern: {
      sentenceEnd: 600,
      paragraphEnd: 1100,
      dramaticMoment: 1600,
      beforeReveal: 1000
    },

    preferredV3Tags: ['uncertain', 'fragmented', 'distressed', 'confused', 'unstable'],
    avoidV3Tags: ['confident', 'certain', 'authoritative'],

    deliveryNotes: 'Allow hesitation and self-correction to color delivery. Question your own reliability. Let uncertainty creep into confident statements. Create a sense that truth is slippery and memory unreliable.',

    emotionalStrengths: ['unstable', 'paranoid', 'confused', 'fragmented', 'psychological'],
    emotionalWeaknesses: ['confident', 'straightforward', 'reliable'],

    bestFor: ['psychological', 'horror', 'unreliable_narrator', 'literary_thriller']
  },

  warm_storybook: {
    id: 'warm_storybook',
    name: 'Warm Storybook',
    description: 'Cozy comfort and gentle guidance. Safe and soothing bedtime presence.',

    voiceSettings: {
      stability: 0.55,        // Medium stability for warm consistency
      similarity_boost: 0.90,
      style: 0.65,            // Medium style for gentle expression
      speed: 0.8              // Slower for bedtime comfort
    },

    pauseFrequency: 'high',
    pausePattern: {
      sentenceEnd: 800,
      paragraphEnd: 1500,
      dramaticMoment: 1800,
      beforeReveal: 1000
    },

    preferredV3Tags: ['warm', 'gentle', 'soothing', 'comforting', 'soft'],
    avoidV3Tags: ['scary', 'intense', 'aggressive'],

    deliveryNotes: 'Create a sense of warmth and safety. Let the voice wrap around the listener like a cozy blanket. Use gentle pacing that allows for drowsy listening. Channel the beloved bedtime storyteller.',

    emotionalStrengths: ['comforting', 'gentle', 'warm', 'safe', 'nurturing'],
    emotionalWeaknesses: ['scary', 'intense', 'violent'],

    bestFor: ['bedtime', 'children', 'family', 'cozy_mystery']
  },

  suspense_weaver: {
    id: 'suspense_weaver',
    name: 'Suspense Weaver',
    description: 'Tension builder with hushed dread. Every word heightens unease.',

    voiceSettings: {
      stability: 0.40,        // Medium-low for building tension
      similarity_boost: 0.85,
      style: 0.75,            // High style for atmospheric delivery
      speed: 0.85             // Slower for dread
    },

    pauseFrequency: 'high',
    pausePattern: {
      sentenceEnd: 900,
      paragraphEnd: 1600,
      dramaticMoment: 2500,   // Extra long for maximum tension
      beforeReveal: 1500
    },

    preferredV3Tags: ['hushed', 'tense', 'ominous', 'creeping', 'dreadful'],
    avoidV3Tags: ['cheerful', 'upbeat', 'bright'],

    deliveryNotes: 'Build tension through restraint. Let silence become threatening. Lower the voice before moments of horror. Make the listener lean in, then freeze them with revelation. Channel classic horror narration.',

    emotionalStrengths: ['tense', 'dreadful', 'creeping', 'ominous', 'terrifying'],
    emotionalWeaknesses: ['cheerful', 'safe', 'comforting'],

    bestFor: ['horror', 'suspense', 'gothic', 'dark_fantasy']
  },

  campfire_bard: {
    id: 'campfire_bard',
    name: 'Campfire Bard',
    description: 'Folksy engagement and conspiratorial warmth. Tales shared among friends.',

    voiceSettings: {
      stability: 0.45,        // Medium-low for expressive storytelling
      similarity_boost: 0.80,
      style: 0.70,            // Medium-high for engaging delivery
      speed: 0.95             // Natural conversational pace
    },

    pauseFrequency: 'medium',
    pausePattern: {
      sentenceEnd: 600,
      paragraphEnd: 1200,
      dramaticMoment: 1500,
      beforeReveal: 900
    },

    preferredV3Tags: ['folksy', 'warm', 'conspiratorial', 'engaging', 'friendly'],
    avoidV3Tags: ['formal', 'distant', 'cold'],

    deliveryNotes: 'Tell the story as if sharing with friends around a fire. Create moments of conspiratorial connection with the listener. Balance warmth with adventure. Channel oral storytelling traditions.',

    emotionalStrengths: ['engaging', 'adventurous', 'warm', 'friendly', 'exciting'],
    emotionalWeaknesses: ['formal', 'clinical', 'detached'],

    bestFor: ['adventure', 'folk_tale', 'western', 'tall_tale']
  },

  clinical_detached: {
    id: 'clinical_detached',
    name: 'Clinical Detached',
    description: 'Cold precision and matter-of-fact horror. Unnerving objectivity.',

    voiceSettings: {
      stability: 0.75,        // High stability for clinical consistency
      similarity_boost: 0.85,
      style: 0.35,            // Low style for flat delivery
      speed: 0.95             // Measured, deliberate
    },

    pauseFrequency: 'low',
    pausePattern: {
      sentenceEnd: 400,
      paragraphEnd: 800,
      dramaticMoment: 1100,
      beforeReveal: 600
    },

    preferredV3Tags: ['clinical', 'flat', 'matter-of-fact', 'cold', 'detached'],
    avoidV3Tags: ['emotional', 'warm', 'passionate'],

    deliveryNotes: 'Describe horrors with clinical detachment. Let the contrast between content and delivery create unease. Maintain objectivity even when describing the unthinkable. Channel scientific observation and medical reports.',

    emotionalStrengths: ['clinical', 'unsettling', 'cold', 'objective', 'disturbing'],
    emotionalWeaknesses: ['warm', 'emotional', 'passionate'],

    bestFor: ['scifi_horror', 'medical_thriller', 'dystopia', 'cosmic_horror']
  }
};

/**
 * Genre to Archetype Mapping
 *
 * Maps genres to their optimal narrator archetypes with primary and alternative choices.
 */
export const GENRE_TO_ARCHETYPE_MAPPING = {
  // Horror & Thriller
  horror: { primary: 'suspense_weaver', alternatives: ['clinical_detached', 'fractured_unreliable'] },
  thriller: { primary: 'hardboiled_narrator', alternatives: ['suspense_weaver', 'sardonic_observer'] },
  suspense: { primary: 'suspense_weaver', alternatives: ['hardboiled_narrator', 'fractured_unreliable'] },
  gothic: { primary: 'suspense_weaver', alternatives: ['theatrical_baritone', 'fractured_unreliable'] },
  psychological: { primary: 'fractured_unreliable', alternatives: ['intimate_confessor', 'clinical_detached'] },

  // Mystery & Crime
  mystery: { primary: 'sardonic_observer', alternatives: ['hardboiled_narrator', 'documentary_voice'] },
  noir: { primary: 'hardboiled_narrator', alternatives: ['sardonic_observer', 'suspense_weaver'] },
  crime: { primary: 'hardboiled_narrator', alternatives: ['sardonic_observer', 'documentary_voice'] },
  detective: { primary: 'sardonic_observer', alternatives: ['hardboiled_narrator', 'documentary_voice'] },
  cozy_mystery: { primary: 'warm_storybook', alternatives: ['sardonic_observer', 'campfire_bard'] },
  legal_thriller: { primary: 'theatrical_baritone', alternatives: ['suspense_weaver', 'documentary_voice'] },

  // Fantasy
  fantasy: { primary: 'bardic_epic', alternatives: ['theatrical_baritone', 'campfire_bard'] },
  epic_fantasy: { primary: 'bardic_epic', alternatives: ['theatrical_baritone', 'documentary_voice'] },
  dark_fantasy: { primary: 'suspense_weaver', alternatives: ['bardic_epic', 'theatrical_baritone'] },
  grimdark: { primary: 'clinical_detached', alternatives: ['hardboiled_narrator', 'suspense_weaver'] },
  urban_fantasy: { primary: 'sardonic_observer', alternatives: ['campfire_bard', 'hardboiled_narrator'] },
  fairy_tale: { primary: 'animated_storyteller', alternatives: ['warm_storybook', 'campfire_bard'] },
  mythology: { primary: 'bardic_epic', alternatives: ['theatrical_baritone', 'documentary_voice'] },

  // Science Fiction
  scifi: { primary: 'documentary_voice', alternatives: ['clinical_detached', 'sardonic_observer'] },
  space_opera: { primary: 'theatrical_baritone', alternatives: ['documentary_voice', 'bardic_epic'] },
  military_scifi: { primary: 'documentary_voice', alternatives: ['hardboiled_narrator', 'theatrical_baritone'] },
  dystopia: { primary: 'clinical_detached', alternatives: ['fractured_unreliable', 'documentary_voice'] },
  cyberpunk: { primary: 'hardboiled_narrator', alternatives: ['clinical_detached', 'sardonic_observer'] },
  scifi_horror: { primary: 'clinical_detached', alternatives: ['suspense_weaver', 'documentary_voice'] },

  // Romance & Drama
  romance: { primary: 'intimate_confessor', alternatives: ['warm_storybook', 'animated_storyteller'] },
  paranormal_romance: { primary: 'intimate_confessor', alternatives: ['suspense_weaver', 'animated_storyteller'] },
  drama: { primary: 'theatrical_baritone', alternatives: ['intimate_confessor', 'sardonic_observer'] },
  literary: { primary: 'intimate_confessor', alternatives: ['sardonic_observer', 'theatrical_baritone'] },
  contemporary: { primary: 'intimate_confessor', alternatives: ['sardonic_observer', 'campfire_bard'] },
  historical: { primary: 'documentary_voice', alternatives: ['theatrical_baritone', 'bardic_epic'] },

  // Children & Family
  children: { primary: 'animated_storyteller', alternatives: ['warm_storybook', 'campfire_bard'] },
  bedtime: { primary: 'warm_storybook', alternatives: ['animated_storyteller', 'campfire_bard'] },
  family: { primary: 'warm_storybook', alternatives: ['animated_storyteller', 'campfire_bard'] },
  young_adult: { primary: 'animated_storyteller', alternatives: ['sardonic_observer', 'campfire_bard'] },

  // Comedy & Satire
  comedy: { primary: 'animated_storyteller', alternatives: ['sardonic_observer', 'campfire_bard'] },
  satire: { primary: 'sardonic_observer', alternatives: ['animated_storyteller', 'clinical_detached'] },
  dark_comedy: { primary: 'sardonic_observer', alternatives: ['hardboiled_narrator', 'clinical_detached'] },

  // Adventure & Action
  adventure: { primary: 'campfire_bard', alternatives: ['animated_storyteller', 'theatrical_baritone'] },
  action: { primary: 'theatrical_baritone', alternatives: ['campfire_bard', 'hardboiled_narrator'] },
  western: { primary: 'campfire_bard', alternatives: ['hardboiled_narrator', 'sardonic_observer'] },

  // Other
  memoir: { primary: 'intimate_confessor', alternatives: ['documentary_voice', 'warm_storybook'] },
  educational: { primary: 'documentary_voice', alternatives: ['animated_storyteller', 'warm_storybook'] },
  medical_drama: { primary: 'clinical_detached', alternatives: ['documentary_voice', 'theatrical_baritone'] },
  sports: { primary: 'animated_storyteller', alternatives: ['campfire_bard', 'documentary_voice'] }
};

/**
 * Get archetype by ID
 * @param {string} archetypeId - The archetype ID
 * @returns {Object|null} The archetype definition or null if not found
 */
export function getArchetype(archetypeId) {
  return NARRATOR_ARCHETYPES[archetypeId] || null;
}

/**
 * Get primary archetype for a genre
 * @param {string} genre - The genre name
 * @returns {Object} The archetype definition
 */
export function getArchetypeForGenre(genre) {
  const normalized = genre?.toLowerCase().replace(/[^a-z_]/g, '_') || 'drama';
  const mapping = GENRE_TO_ARCHETYPE_MAPPING[normalized];

  if (mapping) {
    return getArchetype(mapping.primary);
  }

  // Default to theatrical_baritone for unknown genres
  logger.debug(`[NarratorArchetypes] Unknown genre "${genre}", defaulting to theatrical_baritone`);
  return getArchetype('theatrical_baritone');
}

/**
 * Get alternative archetypes for a genre
 * @param {string} genre - The genre name
 * @returns {Array<Object>} Array of alternative archetype definitions
 */
export function getAlternativeArchetypesForGenre(genre) {
  const normalized = genre?.toLowerCase().replace(/[^a-z_]/g, '_') || 'drama';
  const mapping = GENRE_TO_ARCHETYPE_MAPPING[normalized];

  if (mapping?.alternatives) {
    return mapping.alternatives.map(id => getArchetype(id)).filter(Boolean);
  }

  return [];
}

/**
 * Detect optimal narrator archetype based on story configuration
 *
 * @param {Object} storyConfig - Story configuration object
 * @param {string} storyConfig.genre - Primary genre
 * @param {string} storyConfig.premise - Story premise
 * @param {string} storyConfig.tone - Story tone (dark, light, neutral, etc.)
 * @param {string} storyConfig.targetAudience - Target audience
 * @param {Object} options - Detection options
 * @param {boolean} options.useLLM - Whether to use LLM for sophisticated detection
 * @returns {Object} Detected archetype with confidence
 */
export async function detectNarratorArchetype(storyConfig, options = {}) {
  const { genre, premise, tone, targetAudience } = storyConfig;
  const { useLLM = false } = options;

  // Quick path: genre-based detection
  const genreArchetype = getArchetypeForGenre(genre);

  // If no LLM needed or no premise, use quick path
  if (!useLLM || !premise) {
    logger.info(`[NarratorArchetypes] Quick detection: ${genreArchetype.id} for genre "${genre}"`);
    return {
      archetype: genreArchetype,
      method: 'genre_mapping',
      confidence: 0.75
    };
  }

  // Tone-based adjustments
  let adjustedArchetype = genreArchetype;
  let confidence = 0.75;

  if (tone) {
    const toneAdjustments = {
      'dark': ['suspense_weaver', 'hardboiled_narrator', 'clinical_detached'],
      'grim': ['suspense_weaver', 'clinical_detached', 'hardboiled_narrator'],
      'light': ['animated_storyteller', 'warm_storybook', 'campfire_bard'],
      'playful': ['animated_storyteller', 'sardonic_observer', 'campfire_bard'],
      'serious': ['theatrical_baritone', 'documentary_voice', 'intimate_confessor'],
      'comedic': ['animated_storyteller', 'sardonic_observer', 'campfire_bard'],
      'romantic': ['intimate_confessor', 'warm_storybook', 'theatrical_baritone'],
      'epic': ['bardic_epic', 'theatrical_baritone', 'documentary_voice'],
      'intimate': ['intimate_confessor', 'warm_storybook', 'campfire_bard'],
      'cynical': ['sardonic_observer', 'hardboiled_narrator', 'clinical_detached']
    };

    const normalizedTone = tone.toLowerCase();
    const toneArchetypes = toneAdjustments[normalizedTone];

    if (toneArchetypes && !toneArchetypes.includes(genreArchetype.id)) {
      // Tone conflicts with genre archetype, check alternatives
      const alternatives = getAlternativeArchetypesForGenre(genre);
      const toneMatch = alternatives.find(alt => toneArchetypes.includes(alt.id));

      if (toneMatch) {
        adjustedArchetype = toneMatch;
        confidence = 0.85; // Higher confidence when tone matches alternative
        logger.info(`[NarratorArchetypes] Tone-adjusted: ${adjustedArchetype.id} (tone="${tone}")`);
      }
    }
  }

  // Audience-based adjustments
  if (targetAudience) {
    const audiencePreferences = {
      'children': ['animated_storyteller', 'warm_storybook', 'campfire_bard'],
      'young_adult': ['animated_storyteller', 'campfire_bard', 'sardonic_observer'],
      'adult': null, // No restriction
      'mature': ['hardboiled_narrator', 'intimate_confessor', 'clinical_detached', 'fractured_unreliable']
    };

    const normalizedAudience = targetAudience.toLowerCase();
    const audienceArchetypes = audiencePreferences[normalizedAudience];

    if (audienceArchetypes && !audienceArchetypes.includes(adjustedArchetype.id)) {
      const alternatives = getAlternativeArchetypesForGenre(genre);
      const audienceMatch = alternatives.find(alt => audienceArchetypes.includes(alt.id))
                          || getArchetype(audienceArchetypes[0]);

      if (audienceMatch) {
        adjustedArchetype = audienceMatch;
        confidence = 0.9; // High confidence for audience-appropriate selection
        logger.info(`[NarratorArchetypes] Audience-adjusted: ${adjustedArchetype.id} (audience="${targetAudience}")`);
      }
    }
  }

  logger.info(`[NarratorArchetypes] Detected: ${adjustedArchetype.id} | genre="${genre}" | tone="${tone || 'none'}" | confidence=${confidence}`);

  return {
    archetype: adjustedArchetype,
    method: 'rule_based',
    confidence
  };
}

/**
 * Build voice direction prompt based on archetype
 *
 * @param {Object} archetype - The narrator archetype
 * @param {Object} context - Scene/segment context
 * @returns {string} Voice direction prompt for LLM
 */
export function buildArchetypeDirectionPrompt(archetype, context = {}) {
  const { emotion, intensity, sceneType } = context;

  let prompt = `NARRATOR ARCHETYPE: ${archetype.name}\n\n`;
  prompt += `DELIVERY STYLE: ${archetype.deliveryNotes}\n\n`;

  prompt += `EMOTIONAL STRENGTHS (lean into these): ${archetype.emotionalStrengths.join(', ')}\n`;
  prompt += `EMOTIONAL WEAKNESSES (avoid or minimize): ${archetype.emotionalWeaknesses.join(', ')}\n\n`;

  prompt += `PREFERRED V3 TAGS: ${archetype.preferredV3Tags.join(', ')}\n`;
  prompt += `AVOID V3 TAGS: ${archetype.avoidV3Tags.join(', ')}\n\n`;

  prompt += `PAUSE FREQUENCY: ${archetype.pauseFrequency}\n`;
  prompt += `- Sentence end: ${archetype.pausePattern.sentenceEnd}ms\n`;
  prompt += `- Paragraph end: ${archetype.pausePattern.paragraphEnd}ms\n`;
  prompt += `- Dramatic moment: ${archetype.pausePattern.dramaticMoment}ms\n`;
  prompt += `- Before reveal: ${archetype.pausePattern.beforeReveal}ms\n`;

  if (emotion) {
    const isStrength = archetype.emotionalStrengths.includes(emotion.toLowerCase());
    const isWeakness = archetype.emotionalWeaknesses.includes(emotion.toLowerCase());

    if (isStrength) {
      prompt += `\nCURRENT EMOTION: ${emotion} (STRENGTH - fully embrace this)\n`;
    } else if (isWeakness) {
      prompt += `\nCURRENT EMOTION: ${emotion} (WEAKNESS - adapt delivery while maintaining archetype character)\n`;
    } else {
      prompt += `\nCURRENT EMOTION: ${emotion}\n`;
    }
  }

  return prompt;
}

/**
 * Get ElevenLabs voice settings for an archetype
 *
 * @param {Object} archetype - The narrator archetype
 * @param {Object} overrides - Optional setting overrides
 * @returns {Object} ElevenLabs voice settings
 */
export function getArchetypeVoiceSettings(archetype, overrides = {}) {
  return {
    stability: overrides.stability ?? archetype.voiceSettings.stability,
    similarity_boost: overrides.similarity_boost ?? archetype.voiceSettings.similarity_boost,
    style: overrides.style ?? archetype.voiceSettings.style,
    // Note: speed is applied post-generation via audioAssembler
  };
}

/**
 * Get archetype speed modifier for post-processing
 *
 * @param {Object} archetype - The narrator archetype
 * @returns {number} Speed modifier (0.5 to 2.0)
 */
export function getArchetypeSpeedModifier(archetype) {
  return archetype.voiceSettings.speed;
}

/**
 * Get all archetype IDs
 * @returns {Array<string>} Array of archetype IDs
 */
export function getAllArchetypeIds() {
  return Object.keys(NARRATOR_ARCHETYPES);
}

/**
 * Get archetype summary for configuration display
 * @returns {Array<Object>} Array of archetype summaries
 */
export function getArchetypeSummaries() {
  return Object.values(NARRATOR_ARCHETYPES).map(arch => ({
    id: arch.id,
    name: arch.name,
    description: arch.description,
    bestFor: arch.bestFor
  }));
}

export default {
  NARRATOR_ARCHETYPES,
  GENRE_TO_ARCHETYPE_MAPPING,
  getArchetype,
  getArchetypeForGenre,
  getAlternativeArchetypesForGenre,
  detectNarratorArchetype,
  buildArchetypeDirectionPrompt,
  getArchetypeVoiceSettings,
  getArchetypeSpeedModifier,
  getAllArchetypeIds,
  getArchetypeSummaries
};
