/**
 * Voice Selection Service
 *
 * Provides intelligent voice selection for narration and characters
 * using database-driven archetypes and dynamic queries.
 *
 * Key Functions:
 * - getNarratorVoice(config) - Select narrator based on mood/genre
 * - getCharacterVoice(descriptor) - Select character voice with constraints
 * - getVoiceCast(characters, config) - Assign voices to entire cast
 * - inferCharacterArchetype(character) - Determine best archetype match
 */

import { pool } from '../database/pool.js';
import OpenAI from 'openai';
import { cache } from './cache.js';

// Initialize OpenAI for Teacher agent
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cache for voice data to reduce DB queries
let voiceCache = null;
let archetypeCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track assigned voices per story to prevent duplicates
const storyVoiceAssignments = new Map();

/**
 * Clear voice assignment tracking for a story
 */
export async function clearStoryAssignments(sessionId) {
  storyVoiceAssignments.delete(sessionId);
  await cache.invalidateVoiceAssignments(sessionId);
}

/**
 * Get assigned voices for a story
 */
export function getStoryAssignments(sessionId) {
  return storyVoiceAssignments.get(sessionId) || new Map();
}

/**
 * Refresh voice and archetype caches
 */
async function refreshCaches(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && voiceCache && archetypeCache && (now - cacheTimestamp) < CACHE_TTL) {
    return;
  }

  try {
    // Fetch all active voices
    const voicesResult = await pool.query(`
      SELECT
        voice_id,
        name,
        gender,
        age_group,
        accent,
        description,
        preview_url,
        tags,
        language_codes,
        quality_score,
        energy_level,
        is_narrator_suitable as narrator_suitable,
        is_character_suitable as character_suitable,
        pitch_hint,
        is_available as available
      FROM elevenlabs_voices
      WHERE is_available = true
      ORDER BY quality_score DESC NULLS LAST, name ASC
    `);

    voiceCache = voicesResult.rows;

    // Fetch all archetypes
    const archetypesResult = await pool.query(`
      SELECT
        id,
        name as archetype_key,
        display_name,
        description,
        selection_criteria,
        suitable_roles as example_roles,
        priority
      FROM voice_archetypes
      WHERE is_active = true
      ORDER BY priority DESC, name
    `);

    // Transform archetypes to include parsed selection criteria
    archetypeCache = archetypesResult.rows.map(row => {
      const criteria = row.selection_criteria || {};
      return {
        ...row,
        gender_filter: criteria.gender || 'any',
        age_filter: criteria.age_group || null,
        energy_range: criteria.energy_range || null,
        pitch_range: criteria.pitch_range || null
      };
    });
    cacheTimestamp = now;

    console.log(`[VoiceSelection] Refreshed cache: ${voiceCache.length} voices, ${archetypeCache.length} archetypes`);
  } catch (error) {
    console.error('[VoiceSelection] Failed to refresh caches:', error);
    // Keep existing cache if refresh fails
  }
}

/**
 * Get voice preferences based on story format/type
 * Used to filter and score voices appropriately for different story types
 *
 * @param {string} storyFormat - The story format (picture_book, standard, etc.)
 * @param {string} storyType - The story type (standard, cyoa, etc.)
 * @returns {Object} Voice preferences with style preferences and exclusions
 */
export function getStoryFormatVoicePreferences(storyFormat, storyType = 'standard') {
  if (storyFormat === 'picture_book') {
    return {
      narrator: {
        preferredStyle: 'warm',
        preferredAge: 'adult', // Not too young, not too old - middle age works best
        preferredTags: ['warm', 'friendly', 'gentle', 'soothing', 'storytelling'],
        excludeTags: ['deep', 'gravelly', 'intense', 'dark', 'menacing', 'raspy'],
        excludeDescriptionKeywords: ['deep', 'gravelly', 'intense', 'dramatic', 'powerful', 'booming'],
        energyRange: [30, 60] // Medium energy - engaging but not overwhelming
      }
    };
  }

  if (storyType === 'cyoa') {
    return {
      narrator: {
        preferredStyle: 'engaging',
        preferredTags: ['clear', 'dynamic', 'expressive'],
        excludeTags: [],
        energyRange: [40, 70]
      }
    };
  }

  // Default preferences for standard stories
  return {
    narrator: {
      preferredStyle: null,
      preferredTags: [],
      excludeTags: [],
      energyRange: null
    }
  };
}

/**
 * Get narrator voice based on story configuration
 *
 * @param {Object} config - Story configuration
 * @param {string} config.mood - Story mood (dark, whimsical, dramatic, etc.)
 * @param {string} config.genre - Primary genre
 * @param {string} config.language - Target language code
 * @param {string} config.preferredGender - User preference for narrator gender
 * @param {string} config.preferredVoiceId - Specific voice ID if user selected one
 * @param {string} config.qualityTier - Quality tier (premium, standard, economy, fast)
 * @param {string} config.storyFormat - Story format (picture_book, standard, etc.)
 * @param {string} config.storyType - Story type (standard, cyoa, etc.)
 * @returns {Object} Selected voice with settings
 */
export async function getNarratorVoice(config = {}) {
  await refreshCaches();

  const {
    mood = 'neutral',
    genre = 'fantasy',
    language = 'en',
    preferredGender = null,
    preferredVoiceId = null,
    qualityTier = 'standard',
    storyFormat = 'standard',
    storyType = 'standard'
  } = config;

  // Get format-specific voice preferences
  const formatPrefs = getStoryFormatVoicePreferences(storyFormat, storyType);

  // If user specified a voice, use it
  if (preferredVoiceId) {
    const voice = voiceCache.find(v => v.voice_id === preferredVoiceId);
    if (voice) {
      return formatVoiceResponse(voice, 'user_selected');
    }
  }

  // Filter to narrator-suitable voices
  let candidates = voiceCache.filter(v => v.narrator_suitable);

  // Apply language filter
  if (language) {
    const langFiltered = candidates.filter(v =>
      v.language_codes?.includes(language) ||
      v.language_codes?.includes(language.split('-')[0])
    );
    if (langFiltered.length > 0) {
      candidates = langFiltered;
    }
  }

  // Apply gender preference
  if (preferredGender) {
    const genderFiltered = candidates.filter(v =>
      v.gender?.toLowerCase() === preferredGender.toLowerCase()
    );
    if (genderFiltered.length > 0) {
      candidates = genderFiltered;
    }
  }

  // Apply format-specific filtering (e.g., picture book voice preferences)
  const narratorPrefs = formatPrefs.narrator;
  if (narratorPrefs.excludeTags?.length > 0 || narratorPrefs.excludeDescriptionKeywords?.length > 0) {
    const formatFiltered = candidates.filter(voice => {
      const voiceTags = (voice.tags || []).map(t => t.toLowerCase());
      const voiceDesc = (voice.description || '').toLowerCase();

      // Check for excluded tags
      if (narratorPrefs.excludeTags?.length > 0) {
        for (const excludeTag of narratorPrefs.excludeTags) {
          if (voiceTags.some(t => t.includes(excludeTag.toLowerCase()))) {
            return false;
          }
        }
      }

      // Check for excluded description keywords
      if (narratorPrefs.excludeDescriptionKeywords?.length > 0) {
        for (const keyword of narratorPrefs.excludeDescriptionKeywords) {
          if (voiceDesc.includes(keyword.toLowerCase())) {
            return false;
          }
        }
      }

      return true;
    });

    // Only apply if we still have candidates (don't leave with empty list)
    if (formatFiltered.length > 0) {
      candidates = formatFiltered;
      console.log(`[VoiceSelection] Format filter (${storyFormat}): ${formatFiltered.length} candidates after excluding ${narratorPrefs.excludeTags?.join(', ')}`);
    }
  }

  // Apply energy range filter for format-specific preferences
  if (narratorPrefs.energyRange) {
    const [minEnergy, maxEnergy] = narratorPrefs.energyRange;
    const energyFiltered = candidates.filter(voice => {
      const energy = voice.energy_level || 50;
      return energy >= minEnergy && energy <= maxEnergy;
    });
    if (energyFiltered.length > 0) {
      candidates = energyFiltered;
      console.log(`[VoiceSelection] Energy filter (${minEnergy}-${maxEnergy}): ${energyFiltered.length} candidates`);
    }
  }

  // Score candidates based on mood/genre match
  const scoredCandidates = candidates.map(voice => {
    let score = voice.quality_score || 50;

    // Mood-based scoring
    const moodScores = getMoodScores(voice, mood);
    score += moodScores;

    // Genre-based scoring
    const genreScores = getGenreScores(voice, genre);
    score += genreScores;

    // Quality tier adjustment
    score += getQualityTierBonus(voice, qualityTier);

    // Format-specific scoring (preferred tags for picture book, etc.)
    if (narratorPrefs.preferredTags?.length > 0) {
      const voiceTags = (voice.tags || []).map(t => t.toLowerCase());
      for (const prefTag of narratorPrefs.preferredTags) {
        if (voiceTags.some(t => t.includes(prefTag.toLowerCase()))) {
          score += 12; // Significant bonus for matching preferred tags
        }
      }
    }

    return { voice, score };
  });

  // Sort by score and select best match
  scoredCandidates.sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    throw new Error('[VoiceSelection] No narrator candidates found (fail-loud)');
  }

  const selected = scoredCandidates[0].voice;
  console.log(`[VoiceSelection] Selected narrator: ${selected.name} (score: ${scoredCandidates[0].score})`);

  return formatVoiceResponse(selected, 'auto_selected', {
    mood,
    genre,
    score: scoredCandidates[0].score
  });
}

/**
 * Get voice for a character based on descriptor
 *
 * @param {Object} descriptor - Character description
 * @param {string} descriptor.name - Character name
 * @param {string} descriptor.gender - Character gender
 * @param {string} descriptor.age - Age descriptor (child, young, adult, elder)
 * @param {string} descriptor.archetype - Character archetype (hero, villain, comic, etc.)
 * @param {string} descriptor.personality - Personality traits
 * @param {string} descriptor.role - Role in story (protagonist, antagonist, support)
 * @param {string} descriptor.species - Species (human, creature, etc.)
 * @param {Object} options - Selection options
 * @param {string} options.sessionId - Story session ID for uniqueness tracking
 * @param {boolean} options.allowDuplicates - Allow reusing voices
 * @param {string} options.qualityTier - Quality tier
 * @returns {Object} Selected voice with settings
 */
export async function getCharacterVoice(descriptor, options = {}) {
  await refreshCaches();

  const {
    name = 'Unknown',
    gender = null,
    age = null,
    age_group = null,  // Database field - takes priority over age
    archetype = null,
    personality = null,
    role = 'support',
    species = 'human'
  } = descriptor;

  // age_group from DB takes priority, fallback to age param, then 'adult'
  const resolvedAge = age_group || age || 'adult';

  const {
    sessionId = null,
    allowDuplicates = false,
    qualityTier = 'standard'
  } = options;

  // Get already assigned voices for this story
  const assignedVoices = sessionId ? getStoryAssignments(sessionId) : new Map();

  // Determine archetype from character info
  const resolvedArchetype = archetype || inferCharacterArchetype(descriptor);

  // Get archetype configuration
  const archetypeConfig = archetypeCache.find(a => a.archetype_key === resolvedArchetype);

  // Filter to character-suitable voices
  let candidates = voiceCache.filter(v => v.character_suitable);

  // Apply gender filter
  const inferredGender = gender || inferGenderFromName(name);
  if (inferredGender && inferredGender !== 'neutral') {
    const genderFiltered = candidates.filter(v =>
      v.gender?.toLowerCase() === inferredGender.toLowerCase() ||
      v.gender?.toLowerCase() === 'neutral'
    );
    if (genderFiltered.length > 0) {
      candidates = genderFiltered;
    }
  }

  // Apply archetype filters if available
  if (archetypeConfig) {
    candidates = applyArchetypeFilters(candidates, archetypeConfig);
  }

  // Filter out already assigned voices (unless duplicates allowed)
  if (!allowDuplicates && assignedVoices.size > 0) {
    const availableCandidates = candidates.filter(v => !assignedVoices.has(v.voice_id));
    if (availableCandidates.length > 0) {
      candidates = availableCandidates;
    }
  }

  // Score remaining candidates
  const scoredCandidates = candidates.map(voice => {
    let score = voice.quality_score || 50;

    // Age matching - uses resolvedAge which prioritizes age_group from DB
    score += getAgeMatchScore(voice, resolvedAge);

    // Personality/energy matching
    score += getPersonalityMatchScore(voice, personality, archetypeConfig);

    // Role importance bonus (protagonists get higher quality voices)
    score += getRoleBonus(role);

    // Species handling
    if (species !== 'human') {
      score += getSpeciesScore(voice, species);
    }

    // Quality tier adjustment
    score += getQualityTierBonus(voice, qualityTier);

    // Add some randomness to prevent always picking same voice
    score += Math.random() * 5;

    return { voice, score };
  });

  // Sort by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    throw new Error(`[VoiceSelection] No voice candidates for ${name} (fail-loud)`);
  }

  const selected = scoredCandidates[0].voice;

  // Track assignment
  if (sessionId) {
    if (!storyVoiceAssignments.has(sessionId)) {
      storyVoiceAssignments.set(sessionId, new Map());
    }
    storyVoiceAssignments.get(sessionId).set(selected.voice_id, name);
  }

  console.log(`[VoiceSelection] Selected voice for ${name}: ${selected.name} (archetype: ${resolvedArchetype}, score: ${scoredCandidates[0].score})`);

  return formatVoiceResponse(selected, 'auto_selected', {
    character: name,
    archetype: resolvedArchetype,
    inferredGender,
    score: scoredCandidates[0].score
  });
}

/**
 * Assign voices to an entire character cast
 *
 * @param {Array} characters - Array of character descriptors
 * @param {Object} config - Story configuration
 * @returns {Map} Map of character name to voice assignment
 */
export async function getVoiceCast(characters, config = {}) {
  await refreshCaches();

  const { sessionId, qualityTier = 'standard' } = config;

  // Clear any existing assignments for this session
  if (sessionId) {
    clearStoryAssignments(sessionId);
  }

  const voiceCast = new Map();

  // Sort characters by importance (protagonists first)
  const sortedCharacters = [...characters].sort((a, b) => {
    const roleOrder = { protagonist: 0, antagonist: 1, major: 2, support: 3, minor: 4 };
    return (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3);
  });

  // Assign voices in order of importance
  for (const character of sortedCharacters) {
    const voice = await getCharacterVoice(character, {
      sessionId,
      allowDuplicates: false,
      qualityTier
    });

    voiceCast.set(character.name, voice);
  }

  // Save assignments to database
  if (sessionId) {
    await saveVoiceAssignments(sessionId, voiceCast);
  }

  return voiceCast;
}

/**
 * Infer character archetype from descriptor
 */
export function inferCharacterArchetype(descriptor) {
  const { gender, age, age_group, role, personality, species } = descriptor;

  // Resolve age - age_group from DB takes priority
  const resolvedAge = age_group || age || 'adult';

  // Non-human species
  if (species && species !== 'human') {
    return 'creature';
  }

  // Children - check both age_group values and legacy age values
  if (resolvedAge === 'child' || resolvedAge === 'young' || resolvedAge === 'teen') {
    return 'child';
  }

  // Gender-specific archetypes
  const genderPrefix = gender?.toLowerCase() === 'female' ? 'female_' : 'male_';

  // Role-based assignment
  if (role === 'protagonist' || role === 'hero') {
    return `${genderPrefix}hero`;
  }
  if (role === 'antagonist' || role === 'villain') {
    return `${genderPrefix}villain`;
  }

  // Personality-based assignment
  const personalityLower = (personality || '').toLowerCase();

  if (personalityLower.includes('comic') || personalityLower.includes('funny') ||
      personalityLower.includes('humor') || personalityLower.includes('silly')) {
    return `${genderPrefix}comic`;
  }

  if (personalityLower.includes('wise') || personalityLower.includes('mentor') ||
      personalityLower.includes('sage') || age === 'elder') {
    return `${genderPrefix}elder`;
  }

  if (personalityLower.includes('young') || personalityLower.includes('innocent') ||
      personalityLower.includes('naive') || age === 'young') {
    return `${genderPrefix}young`;
  }

  // Default to hero archetype
  return `${genderPrefix}hero`;
}

/**
 * Infer gender from character name
 * Uses comprehensive name lists with confidence scoring
 */
export function inferGenderFromName(name) {
  if (!name) return 'neutral';

  const firstName = name.split(/[\s-]/)[0].toLowerCase();

  // Female names (comprehensive list)
  const femaleNames = new Set([
    // Western names
    'alice', 'anna', 'anne', 'bella', 'beth', 'betty', 'carol', 'catherine', 'charlotte',
    'claire', 'clara', 'diana', 'donna', 'dorothy', 'elena', 'eliza', 'elizabeth', 'ella',
    'emily', 'emma', 'eva', 'eve', 'fiona', 'grace', 'hannah', 'helen', 'isabella', 'jane',
    'janet', 'jennifer', 'jessica', 'julia', 'karen', 'kate', 'katherine', 'laura', 'lily',
    'linda', 'lisa', 'lucy', 'margaret', 'maria', 'marie', 'mary', 'megan', 'melissa',
    'nancy', 'natalie', 'nicole', 'olivia', 'patricia', 'rachel', 'rebecca', 'rose', 'ruth',
    'samantha', 'sarah', 'sophia', 'susan', 'victoria', 'violet', 'wendy', 'zoe',
    // Space/sci-fi names
    'aurora', 'celestia', 'luna', 'nova', 'stella', 'vega', 'andromeda', 'cassiopeia',
    'lyra', 'orion', 'nebula', 'galaxy', 'astrid', 'selene', 'artemis', 'athena',
    // Asian names
    'mei', 'yuki', 'sakura', 'hana', 'aiko', 'keiko', 'yoko', 'akiko', 'michiko',
    'haruka', 'ayumi', 'rina', 'mika', 'sora', 'hikari', 'lin', 'xiao', 'ming',
    'jia', 'wei', 'yan', 'ying', 'li', 'chen', 'hui', 'fang', 'hong',
    // Fantasy names
    'aria', 'arwen', 'elara', 'freya', 'gaia', 'iris', 'ivy', 'jade', 'luna',
    'lydia', 'mira', 'nadia', 'petra', 'raven', 'serena', 'thea', 'vera', 'willow',
    'aurora', 'celeste', 'dawn', 'ember', 'fern', 'hazel', 'ivy', 'juniper',
    'marigold', 'meadow', 'pearl', 'poppy', 'river', 'sage', 'sky', 'summer', 'wren',
    // Additional common names
    'amy', 'andrea', 'angela', 'ashley', 'brenda', 'brittany', 'cynthia', 'danielle',
    'deborah', 'denise', 'diane', 'heather', 'jacqueline', 'jasmine', 'joyce', 'julie',
    'kimberly', 'kristin', 'lauren', 'leslie', 'marie', 'michelle', 'monica', 'pamela',
    'sandra', 'shannon', 'sharon', 'shirley', 'stephanie', 'tammy', 'teresa', 'theresa',
    'tiffany', 'tracy', 'valerie', 'vanessa', 'veronica', 'virginia', 'whitney'
  ]);

  // Male names (comprehensive list)
  const maleNames = new Set([
    // Western names
    'adam', 'alan', 'albert', 'alexander', 'alfred', 'andrew', 'anthony', 'arthur',
    'benjamin', 'brian', 'bruce', 'carl', 'charles', 'christopher', 'daniel', 'david',
    'donald', 'edward', 'eric', 'frank', 'frederick', 'gary', 'george', 'harold',
    'henry', 'howard', 'jack', 'jacob', 'james', 'jason', 'jeffrey', 'jeremy', 'john',
    'jonathan', 'joseph', 'joshua', 'kenneth', 'kevin', 'lawrence', 'leo', 'louis',
    'mark', 'matthew', 'michael', 'nathan', 'nicholas', 'oliver', 'patrick', 'paul',
    'peter', 'philip', 'raymond', 'richard', 'robert', 'ronald', 'samuel', 'scott',
    'stephen', 'steven', 'theodore', 'thomas', 'timothy', 'victor', 'walter', 'william',
    // Space/sci-fi names
    'apollo', 'atlas', 'cosmo', 'orion', 'phoenix', 'titan', 'zephyr', 'blaze',
    'cyrus', 'drake', 'falcon', 'griffin', 'hawk', 'hunter', 'jett', 'lance',
    // Asian names
    'akira', 'daiki', 'haruto', 'hiroshi', 'ichiro', 'jun', 'kai', 'kenji', 'koji',
    'makoto', 'masato', 'ren', 'ryu', 'shin', 'takeshi', 'taro', 'yoshi', 'yuto',
    'chen', 'feng', 'huang', 'jin', 'lei', 'long', 'ming', 'wei', 'zhang',
    // Fantasy names
    'aldric', 'bran', 'cedric', 'darius', 'eamon', 'felix', 'gareth', 'hadrian',
    'ivan', 'jasper', 'kieran', 'liam', 'magnus', 'nolan', 'oswald', 'percival',
    'quentin', 'rowan', 'silas', 'tristan', 'ulric', 'vaughn', 'wyatt', 'xavier',
    // Additional common names
    'aaron', 'austin', 'billy', 'bobby', 'bradley', 'brandon', 'brett', 'bryan',
    'chad', 'christian', 'clarence', 'craig', 'dale', 'darren', 'dean', 'dennis',
    'derek', 'douglas', 'earl', 'eugene', 'francis', 'gerald', 'glen', 'gordon',
    'gregory', 'harry', 'ian', 'jerry', 'jesse', 'joe', 'johnny', 'jordan', 'jose',
    'keith', 'kelly', 'kenny', 'kyle', 'larry', 'leonard', 'lloyd', 'marcus', 'martin',
    'maurice', 'melvin', 'mitchell', 'neil', 'norman', 'oscar', 'ralph', 'randy',
    'ray', 'roger', 'roy', 'russell', 'sean', 'seth', 'shane', 'shawn', 'terry',
    'todd', 'tony', 'travis', 'troy', 'tyler', 'vernon', 'vincent', 'wayne', 'wesley'
  ]);

  if (femaleNames.has(firstName)) {
    return 'female';
  }
  if (maleNames.has(firstName)) {
    return 'male';
  }

  // Check name endings as heuristic (not a fallback)
  if (firstName.endsWith('a') || firstName.endsWith('ia') || firstName.endsWith('ie') ||
      firstName.endsWith('ette') || firstName.endsWith('elle') || firstName.endsWith('ina')) {
    return 'female';
  }

  return 'neutral';
}

/**
 * Apply archetype-specific filters to voice candidates
 */
function applyArchetypeFilters(candidates, archetypeConfig) {
  let filtered = [...candidates];

  // Gender filter
  if (archetypeConfig.gender_filter && archetypeConfig.gender_filter !== 'any') {
    const genderFiltered = filtered.filter(v =>
      v.gender?.toLowerCase() === archetypeConfig.gender_filter.toLowerCase()
    );
    if (genderFiltered.length > 0) {
      filtered = genderFiltered;
    }
  }

  // Age filter
  if (archetypeConfig.age_filter) {
    const ageFiltered = filtered.filter(v =>
      !v.age_group || v.age_group === archetypeConfig.age_filter
    );
    if (ageFiltered.length > 0) {
      filtered = ageFiltered;
    }
  }

  // Energy range filter
  if (archetypeConfig.energy_range) {
    const [minEnergy, maxEnergy] = archetypeConfig.energy_range;
    const energyFiltered = filtered.filter(v => {
      const energy = v.energy_level || 50;
      return energy >= minEnergy && energy <= maxEnergy;
    });
    if (energyFiltered.length > 0) {
      filtered = energyFiltered;
    }
  }

  // Pitch range filter
  if (archetypeConfig.pitch_range) {
    const pitchMap = { low: 1, medium: 2, high: 3 };
    const [minPitch, maxPitch] = archetypeConfig.pitch_range.map(p => pitchMap[p] || 2);
    const pitchFiltered = filtered.filter(v => {
      const pitch = pitchMap[v.pitch_hint] || 2;
      return pitch >= minPitch && pitch <= maxPitch;
    });
    if (pitchFiltered.length > 0) {
      filtered = pitchFiltered;
    }
  }

  return filtered;
}

/**
 * Score voice based on mood match
 */
function getMoodScores(voice, mood) {
  const tags = voice.tags || [];
  const moodKeywords = {
    dark: ['mysterious', 'dramatic', 'deep', 'intense', 'gravelly'],
    whimsical: ['playful', 'warm', 'light', 'friendly', 'cheerful'],
    dramatic: ['theatrical', 'powerful', 'emotional', 'expressive', 'dramatic'],
    calm: ['soothing', 'gentle', 'warm', 'soft', 'relaxed'],
    tense: ['intense', 'urgent', 'sharp', 'crisp', 'serious'],
    romantic: ['warm', 'smooth', 'gentle', 'romantic', 'soft'],
    comedic: ['playful', 'energetic', 'bright', 'funny', 'animated'],
    epic: ['powerful', 'deep', 'authoritative', 'dramatic', 'resonant']
  };

  const keywords = moodKeywords[mood.toLowerCase()] || [];
  let score = 0;

  for (const keyword of keywords) {
    if (tags.some(t => t.toLowerCase().includes(keyword))) {
      score += 10;
    }
    if (voice.description?.toLowerCase().includes(keyword)) {
      score += 5;
    }
  }

  return score;
}

/**
 * Score voice based on genre match
 */
function getGenreScores(voice, genre) {
  const tags = voice.tags || [];
  const genreKeywords = {
    fantasy: ['magical', 'epic', 'storytelling', 'theatrical'],
    horror: ['dark', 'mysterious', 'creepy', 'intense'],
    romance: ['warm', 'smooth', 'gentle', 'romantic'],
    scifi: ['clear', 'crisp', 'modern', 'technical'],
    mystery: ['mysterious', 'thoughtful', 'measured', 'intriguing'],
    adventure: ['energetic', 'dynamic', 'exciting', 'bold'],
    comedy: ['playful', 'bright', 'animated', 'funny'],
    drama: ['emotional', 'expressive', 'dramatic', 'nuanced']
  };

  const keywords = genreKeywords[genre.toLowerCase()] || [];
  let score = 0;

  for (const keyword of keywords) {
    if (tags.some(t => t.toLowerCase().includes(keyword))) {
      score += 8;
    }
  }

  return score;
}

/**
 * Get quality tier bonus for voice selection
 */
function getQualityTierBonus(voice, tier) {
  const qualityScore = voice.quality_score || 50;

  switch (tier) {
    case 'premium':
      // Strongly prefer highest quality voices
      return qualityScore > 80 ? 30 : qualityScore > 60 ? 10 : 0;
    case 'standard':
      // Balanced preference
      return qualityScore > 60 ? 15 : qualityScore > 40 ? 10 : 5;
    case 'economy':
      // Slight preference for good voices but not required
      return qualityScore > 70 ? 10 : 5;
    case 'fast':
      // Prefer voices that work well with fast models
      return 0; // No quality preference for fast tier
    default:
      return 0;
  }
}

/**
 * Score voice based on age match
 */
function getAgeMatchScore(voice, targetAge) {
  const voiceAge = voice.age_group || 'adult';

  if (voiceAge === targetAge) {
    return 25;
  }

  // Adjacent age groups get partial score
  const ageOrder = ['child', 'young', 'adult', 'elder'];
  const voiceIdx = ageOrder.indexOf(voiceAge);
  const targetIdx = ageOrder.indexOf(targetAge);

  if (Math.abs(voiceIdx - targetIdx) === 1) {
    return 10;
  }

  return 0;
}

/**
 * Score voice based on personality/energy match
 */
function getPersonalityMatchScore(voice, personality, archetypeConfig) {
  let score = 0;
  const voiceEnergy = voice.energy_level || 50;

  if (archetypeConfig?.selection_criteria) {
    const criteria = archetypeConfig.selection_criteria;

    // Energy match
    if (criteria.energy_preference) {
      const targetEnergy = criteria.energy_preference === 'high' ? 70 :
                          criteria.energy_preference === 'low' ? 30 : 50;
      const energyDiff = Math.abs(voiceEnergy - targetEnergy);
      score += Math.max(0, 20 - energyDiff / 2);
    }

    // Tag preferences
    if (criteria.preferred_tags && voice.tags) {
      for (const tag of criteria.preferred_tags) {
        if (voice.tags.includes(tag)) {
          score += 8;
        }
      }
    }
  }

  // Personality keyword matching
  if (personality) {
    const personalityLower = personality.toLowerCase();
    const voiceDesc = (voice.description || '').toLowerCase();
    const tags = (voice.tags || []).map(t => t.toLowerCase());

    const energeticKeywords = ['energetic', 'excited', 'enthusiastic', 'lively'];
    const calmKeywords = ['calm', 'peaceful', 'serene', 'composed'];
    const darkKeywords = ['dark', 'brooding', 'sinister', 'menacing'];
    const warmKeywords = ['warm', 'friendly', 'kind', 'gentle'];

    for (const keyword of energeticKeywords) {
      if (personalityLower.includes(keyword)) {
        score += voiceEnergy > 60 ? 10 : 0;
      }
    }
    for (const keyword of calmKeywords) {
      if (personalityLower.includes(keyword)) {
        score += voiceEnergy < 40 ? 10 : 0;
      }
    }
    for (const keyword of darkKeywords) {
      if (personalityLower.includes(keyword)) {
        score += tags.some(t => t.includes('dark') || t.includes('mysterious')) ? 15 : 0;
      }
    }
    for (const keyword of warmKeywords) {
      if (personalityLower.includes(keyword)) {
        score += tags.some(t => t.includes('warm') || t.includes('friendly')) ? 15 : 0;
      }
    }
  }

  return score;
}

/**
 * Get bonus for character role importance
 */
function getRoleBonus(role) {
  switch (role?.toLowerCase()) {
    case 'protagonist':
    case 'hero':
      return 20;
    case 'antagonist':
    case 'villain':
      return 15;
    case 'major':
      return 10;
    case 'support':
      return 5;
    default:
      return 0;
  }
}

/**
 * Score voice for non-human species
 */
function getSpeciesScore(voice, species) {
  const tags = voice.tags || [];
  const description = (voice.description || '').toLowerCase();

  // Creature voices should have certain characteristics
  if (species === 'creature' || species === 'monster') {
    if (tags.some(t => t.includes('creature') || t.includes('monster') || t.includes('growl'))) {
      return 30;
    }
    if (description.includes('raspy') || description.includes('growl') || description.includes('deep')) {
      return 15;
    }
  }

  // Robot/AI voices
  if (species === 'robot' || species === 'ai') {
    if (tags.some(t => t.includes('robotic') || t.includes('synthetic'))) {
      return 30;
    }
    if (description.includes('mechanical') || description.includes('digital')) {
      return 15;
    }
  }

  return 0;
}

/**
 * Format voice response with settings
 */
function formatVoiceResponse(voice, selectionMethod, metadata = {}, characterProfile = null) {
  // Use character profile base_settings if available, otherwise voice defaults, then fallbacks
  // Character profile allows per-character voice personality (e.g., an excitable character = lower stability)
  const profileSettings = characterProfile?.base_settings || {};

  return {
    voiceId: voice.voice_id,
    name: voice.name,
    gender: voice.gender,
    ageGroup: voice.age_group,
    previewUrl: voice.preview_url,
    selectionMethod,
    metadata,
    settings: {
      stability: profileSettings.stability ?? voice.default_stability ?? 0.5,
      similarity_boost: voice.default_similarity_boost ?? 0.75,
      style: profileSettings.style ?? voice.default_style ?? 0.3, // Better default: 0.3 not 0
      speed: profileSettings.speed_modifier ?? voice.default_speed ?? 1.0,
      use_speaker_boost: voice.use_speaker_boost ?? true
    }
  };
}

/**
 * Save voice assignments to database
 */
async function saveVoiceAssignments(sessionId, voiceCast) {
  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Clear existing assignments for this session
      await client.query(
        'DELETE FROM story_voice_assignments WHERE session_id = $1',
        [sessionId]
      );

      // Insert new assignments
      for (const [characterName, voice] of voiceCast) {
        await client.query(`
          INSERT INTO story_voice_assignments
            (session_id, character_name, voice_id, selection_method, settings_json)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          sessionId,
          characterName,
          voice.voiceId,
          voice.selectionMethod,
          JSON.stringify(voice.settings)
        ]);
      }

      await client.query('COMMIT');

      // Update cache with new assignments
      await cache.setVoiceAssignments(sessionId, Object.fromEntries(voiceCast));

      console.log(`[VoiceSelection] Saved ${voiceCast.size} voice assignments for session ${sessionId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    // FAIL-LOUD: Voice assignment save failures must not be silently ignored
    console.error('[VoiceSelection] Failed to save voice assignments:', error);
    throw error;
  }
}

/**
 * Load voice assignments from database with Redis caching
 */
export async function loadVoiceAssignments(sessionId) {
  try {
    // Check Redis cache first
    const cached = await cache.getVoiceAssignments(sessionId);
    if (cached) {
      console.log(`[VoiceSelection] Loaded voice assignments from cache for ${sessionId}`);
      const assignments = new Map(Object.entries(cached));

      // Update in-memory tracking
      if (assignments.size > 0) {
        const voiceMap = new Map();
        for (const [name, voice] of assignments) {
          voiceMap.set(voice.voiceId, name);
        }
        storyVoiceAssignments.set(sessionId, voiceMap);
      }

      return assignments;
    }

    // Fetch from database
    const result = await pool.query(`
      SELECT
        sva.character_name,
        sva.voice_id,
        sva.selection_method,
        sva.settings_json,
        ev.name as voice_name,
        ev.gender,
        ev.preview_url
      FROM story_voice_assignments sva
      LEFT JOIN elevenlabs_voices ev ON ev.voice_id = sva.voice_id
      WHERE sva.session_id = $1
    `, [sessionId]);

    const assignments = new Map();

    for (const row of result.rows) {
      assignments.set(row.character_name, {
        voiceId: row.voice_id,
        name: row.voice_name,
        gender: row.gender,
        previewUrl: row.preview_url,
        selectionMethod: row.selection_method,
        settings: row.settings_json || {}
      });
    }

    // Update in-memory tracking
    if (assignments.size > 0) {
      const voiceMap = new Map();
      for (const [name, voice] of assignments) {
        voiceMap.set(voice.voiceId, name);
      }
      storyVoiceAssignments.set(sessionId, voiceMap);

      // Cache in Redis (convert Map to object for serialization)
      await cache.setVoiceAssignments(sessionId, Object.fromEntries(assignments));
    }

    return assignments;
  } catch (error) {
    // FAIL-LOUD: Silent empty Map causes all voice assignments to be lost
    console.error('[VoiceSelection] Failed to load voice assignments:', error);
    throw error;
  }
}

/**
 * Get all available archetypes
 */
export async function getArchetypes() {
  await refreshCaches();
  return archetypeCache || [];
}

/**
 * Get voices filtered by archetype
 */
export async function getVoicesByArchetype(archetypeKey) {
  await refreshCaches();

  const archetype = archetypeCache.find(a => a.archetype_key === archetypeKey);
  if (!archetype) {
    return [];
  }

  let candidates = voiceCache.filter(v => v.character_suitable);
  candidates = applyArchetypeFilters(candidates, archetype);

  return candidates.map(v => ({
    voiceId: v.voice_id,
    name: v.name,
    gender: v.gender,
    ageGroup: v.age_group,
    previewUrl: v.preview_url,
    qualityScore: v.quality_score
  }));
}

/**
 * Force refresh of voice caches
 */
export async function refreshVoiceCaches() {
  await refreshCaches(true);
  return {
    voiceCount: voiceCache?.length || 0,
    archetypeCount: archetypeCache?.length || 0
  };
}

/**
 * =============================================================================
 * VOICE CAST TEACHER AGENT
 * =============================================================================
 *
 * The "School Teacher" that validates voice assignments for multi-voice stories.
 * Ensures narrator is never used for character dialogue and voice choices are appropriate.
 */

/**
 * Teacher Agent: First Pass - Analyze character descriptions and validate voice matches
 * @param {Array} characters - Array of character objects with names, descriptions, roles
 * @param {Map} voiceCast - Map of character name to voice assignment
 * @param {Object} narratorVoice - The narrator voice assignment
 * @param {Object} config - Story configuration
 */
export async function teacherValidateVoiceCast(characters, voiceCast, narratorVoice, config = {}) {
  console.log('[VoiceCastTeacher] Starting voice cast validation...');

  const characterList = characters.map(c => ({
    name: c.name,
    gender: c.gender || inferGenderFromName(c.name),
    age: c.age || 'adult',
    role: c.role || 'support',
    personality: c.personality || c.description || '',
    species: c.species || 'human'
  }));

  const voiceAssignmentList = [];
  for (const [charName, voice] of voiceCast) {
    voiceAssignmentList.push({
      character: charName,
      voiceId: voice.voiceId,
      voiceName: voice.name,
      voiceGender: voice.gender,
      voiceAge: voice.ageGroup || 'adult'
    });
  }

  const prompt = `You are the HEAD CASTING DIRECTOR (the "Teacher") reviewing voice assignments for an audiobook.
Your job is to ensure EVERY character has an appropriate, distinct voice and the narrator is NEVER used for characters.

## STORY CONFIGURATION
- Genre: ${config.genre || 'fantasy'}
- Mood: ${config.mood || 'dramatic'}
- Multi-voice mode: ENABLED (each character should have their own unique voice)

## NARRATOR VOICE (for narration ONLY, NOT for character dialogue)
- Voice ID: ${narratorVoice?.voiceId || 'unknown'}
- Voice Name: ${narratorVoice?.name || 'Unknown Narrator'}
- Voice Gender: ${narratorVoice?.gender || 'unknown'}

## CHARACTERS IN STORY
${characterList.map((c, i) => `${i + 1}. ${c.name}
   - Gender: ${c.gender}
   - Age: ${c.age}
   - Role: ${c.role}
   - Personality: ${c.personality || 'not specified'}`).join('\n')}

## CURRENT VOICE ASSIGNMENTS
${voiceAssignmentList.map((v, i) => `${i + 1}. ${v.character} → ${v.voiceName} (${v.voiceGender}, ${v.voiceAge})`).join('\n')}

## YOUR VALIDATION TASK

As the Teacher/Casting Director, check:

1. **NARRATOR SEPARATION** (CRITICAL!)
   - Is the narrator voice (${narratorVoice?.name || 'Unknown'}) assigned to ANY character?
   - If YES, this is a CRITICAL ERROR - narrator should ONLY narrate, not voice characters
   - Flag which characters incorrectly have the narrator voice

2. **GENDER MATCHING**
   - Does each character's voice match their gender?
   - A female character should have a female voice
   - A male character should have a male voice
   - Flag any mismatches

3. **AGE APPROPRIATENESS**
   - Does each voice match the character's age?
   - Child characters need young voices
   - Elder characters need mature voices
   - Flag any age mismatches

4. **UNIQUENESS**
   - Are there duplicate voice assignments?
   - Each major character should have a unique voice for distinctiveness
   - Minor characters may share voices if needed

5. **ROLE SUITABILITY**
   - Do protagonists have strong, appealing voices?
   - Do villains have appropriately dramatic/menacing voices?
   - Do comic relief characters have playful voices?

Respond with JSON:
{
  "isValid": true|false,
  "criticalIssues": [
    { "character": "name", "issue": "description of critical problem", "fix": "recommended fix" }
  ],
  "warnings": [
    { "character": "name", "issue": "description of warning", "suggestion": "recommended improvement" }
  ],
  "narratorUsedForCharacters": ["list of character names using narrator voice"],
  "genderMismatches": ["list of characters with wrong gender voice"],
  "duplicateVoices": ["list of characters sharing same voice"],
  "overallScore": 0.0-1.0,
  "grade": "A|B|C|D|F",
  "feedback": "Detailed feedback on the voice casting quality",
  "recommendations": [
    { "character": "name", "currentVoice": "current", "suggestedChange": "what to change" }
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log(`[VoiceCastTeacher] Validation complete - Grade: ${result.grade}, Valid: ${result.isValid}`);
      console.log(`[VoiceCastTeacher] Critical issues: ${result.criticalIssues?.length || 0}, Warnings: ${result.warnings?.length || 0}`);

      if (result.narratorUsedForCharacters?.length > 0) {
        console.error(`[VoiceCastTeacher] CRITICAL: Narrator voice used for characters: ${result.narratorUsedForCharacters.join(', ')}`);
      }

      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    // FAIL-LOUD: Returning isValid:true on validation failure hides problems
    console.error('[VoiceCastTeacher] Validation failed:', error.message);
    throw new Error(`Voice cast validation failed: ${error.message}`);
  }
}

/**
 * Teacher Agent: Second Pass - Re-evaluate and suggest fixes
 * Called when first pass finds critical issues
 */
export async function teacherSuggestVoiceFixes(characters, voiceCast, narratorVoice, firstPassResult, availableVoices) {
  if (!firstPassResult.criticalIssues || firstPassResult.criticalIssues.length === 0) {
    console.log('[VoiceCastTeacher] No critical issues to fix');
    return { fixes: [], success: true };
  }

  console.log('[VoiceCastTeacher] Generating voice fixes for critical issues...');

  // Build available voice list
  const voiceList = (availableVoices || []).map(v => ({
    id: v.voice_id || v.voiceId,
    name: v.name,
    gender: v.gender,
    age: v.age_group || v.ageGroup || 'adult',
    tags: v.tags || []
  }));

  // Build list of voices already in use
  const usedVoiceIds = new Set();
  usedVoiceIds.add(narratorVoice?.voiceId);
  for (const [, voice] of voiceCast) {
    usedVoiceIds.add(voice.voiceId);
  }

  const prompt = `You are fixing voice casting problems for an audiobook.

## CRITICAL ISSUES TO FIX
${firstPassResult.criticalIssues.map((issue, i) =>
  `${i + 1}. Character "${issue.character}": ${issue.issue}`
).join('\n')}

## NARRATOR VOICE (CANNOT be used for characters)
- ID: ${narratorVoice?.voiceId}
- Name: ${narratorVoice?.name}

## CHARACTERS NEEDING NEW VOICES
${firstPassResult.criticalIssues.map(issue => {
  const char = characters.find(c => c.name === issue.character);
  return char ? `- ${char.name} (${char.gender || 'unknown'}, ${char.role || 'support'})` : `- ${issue.character}`;
}).join('\n')}

## AVAILABLE VOICES (not currently in use)
${voiceList.filter(v => !usedVoiceIds.has(v.id)).map(v =>
  `- ${v.name} (${v.id}): ${v.gender}, ${v.age}`
).join('\n')}

For each character with an issue, select the BEST available replacement voice.
Match gender and age appropriately.

Respond with JSON:
{
  "fixes": [
    {
      "character": "character name",
      "newVoiceId": "voice_id",
      "newVoiceName": "voice name",
      "reason": "why this voice is better"
    }
  ],
  "success": true|false,
  "notes": "any additional notes"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log(`[VoiceCastTeacher] Generated ${result.fixes?.length || 0} voice fixes`);
      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    console.error('[VoiceCastTeacher] Fix generation failed:', error.message);
    return { fixes: [], success: false, notes: 'Fix generation failed: ' + error.message };
  }
}

/**
 * Full voice cast validation with automatic fixes
 * Main entry point for the School Teacher pattern
 */
export async function validateAndFixVoiceCast(characters, voiceCast, narratorVoice, config = {}) {
  console.log('[VoiceCastTeacher] Starting full validation and fix pipeline...');

  // Step 1: First pass validation
  const validationResult = await teacherValidateVoiceCast(characters, voiceCast, narratorVoice, config);

  // If valid with no critical issues, return early
  if (validationResult.isValid && (!validationResult.criticalIssues || validationResult.criticalIssues.length === 0)) {
    console.log('[VoiceCastTeacher] Voice cast is valid, no fixes needed');
    return {
      voiceCast,
      validation: validationResult,
      fixesApplied: [],
      success: true
    };
  }

  // Step 2: If critical issues found (especially narrator used for characters), get fixes
  if (validationResult.criticalIssues && validationResult.criticalIssues.length > 0) {
    console.log(`[VoiceCastTeacher] Found ${validationResult.criticalIssues.length} critical issues, generating fixes...`);

    // Get available voices from cache
    await refreshCaches();
    const availableVoices = voiceCache || [];

    const fixResult = await teacherSuggestVoiceFixes(
      characters,
      voiceCast,
      narratorVoice,
      validationResult,
      availableVoices
    );

    // Step 3: Apply fixes
    const updatedVoiceCast = new Map(voiceCast);
    const appliedFixes = [];

    for (const fix of (fixResult.fixes || [])) {
      if (fix.character && fix.newVoiceId) {
        const voice = availableVoices.find(v => (v.voice_id || v.voiceId) === fix.newVoiceId);
        if (voice) {
          updatedVoiceCast.set(fix.character, {
            voiceId: fix.newVoiceId,
            name: fix.newVoiceName || voice.name,
            gender: voice.gender,
            ageGroup: voice.age_group,
            selectionMethod: 'teacher_fix',
            settings: {
              stability: voice.default_stability || 0.5,
              similarity_boost: voice.default_similarity_boost || 0.75,
              style: voice.default_style || 0,
              speed: voice.default_speed || 1.0
            }
          });
          appliedFixes.push(fix);
          console.log(`[VoiceCastTeacher] Fixed: ${fix.character} → ${fix.newVoiceName} (was using narrator)`);
        }
      }
    }

    // Step 4: Re-validate after fixes
    const revalidationResult = await teacherValidateVoiceCast(characters, updatedVoiceCast, narratorVoice, config);

    return {
      voiceCast: updatedVoiceCast,
      originalVoiceCast: voiceCast,
      validation: revalidationResult,
      initialValidation: validationResult,
      fixesApplied: appliedFixes,
      success: revalidationResult.isValid
    };
  }

  // Warnings only, no critical issues
  return {
    voiceCast,
    validation: validationResult,
    fixesApplied: [],
    success: true
  };
}

/**
 * Quick check if narrator voice is used for any character
 * Fast pre-check before full validation
 */
export function quickCheckNarratorSeparation(voiceCast, narratorVoiceId) {
  if (!narratorVoiceId) return { valid: true, conflicts: [] };

  const conflicts = [];
  for (const [charName, voice] of voiceCast) {
    if (voice.voiceId === narratorVoiceId) {
      conflicts.push(charName);
    }
  }

  if (conflicts.length > 0) {
    console.warn(`[VoiceCastTeacher] QUICK CHECK FAILED: Narrator voice used for: ${conflicts.join(', ')}`);
  }

  return {
    valid: conflicts.length === 0,
    conflicts
  };
}

export default {
  getNarratorVoice,
  getCharacterVoice,
  getVoiceCast,
  inferCharacterArchetype,
  inferGenderFromName,
  clearStoryAssignments,
  getStoryAssignments,
  loadVoiceAssignments,
  getArchetypes,
  getVoicesByArchetype,
  refreshVoiceCaches,
  getStoryFormatVoicePreferences,
  // Teacher agent exports
  teacherValidateVoiceCast,
  teacherSuggestVoiceFixes,
  validateAndFixVoiceCast,
  quickCheckNarratorSeparation
};
