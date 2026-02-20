/**
 * Smart Configuration Engine
 *
 * AI-driven auto-configuration of story settings based on natural language premise input.
 * This engine is used by both:
 * 1. Manual configuration mode (Configure.jsx via /api/config/smart-interpret)
 * 2. RTC conversation mode for hands-free story creation
 *
 * The engine analyzes premise text and:
 * - Extracts genres, mood, format from keywords
 * - Sets appropriate content intensity levels
 * - Recommends narrator voice and style
 * - Determines story format (linear, CYOA, etc.)
 *
 * P2: Upgraded to use LLM-based analysis via configAnalyzer for better context understanding
 * Replaces 10+ fragile keyword detection systems with single structured LLM analysis pass
 */

import logger from '../utils/logger.js';
import { completion, parseJsonResponse } from './openai.js';
import { getUtilityModel } from './modelSelection.js';
import { AUTHOR_STYLES } from './authorStyles.js';
import { analyzePremiseLLM, generateReasoningFromLLM, SENSIBLE_DEFAULTS } from './configAnalyzer.js';
import { analyzePremiseKeywords } from './keywordAnalyzer.js';
import { multiPassAnalyze, hasComplexRequirements, COMPLEX_PREMISE_THRESHOLD } from './premiseProcessor.js';
import { detectNarratorArchetype, getArchetypeForGenre } from './narratorArchetypes.js';
import { getRecommendedDirector } from './directorStyles.js';

function formatAuthorCatalogLine(id, author) {
  const genres = Array.isArray(author?.genres) ? author.genres.join(', ') : '';
  const knownFor = Array.isArray(author?.knownFor) && author.knownFor.length
    ? ` | Known for: ${author.knownFor.join('; ')}`
    : '';
  const description = author?.description ? ` – ${author.description}` : '';
  return `- ${id}: ${author?.name || id}${genres ? ` (${genres})` : ''}${knownFor}${description}`;
}

const AUTHOR_STYLE_CATALOG = Object.entries(AUTHOR_STYLES)
  .map(([id, author]) => formatAuthorCatalogLine(id, author))
  .join('\n');

const AUTHOR_CATALOG_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'over', 'under', 'about',
  'your', 'their', 'this', 'that', 'these', 'those', 'like', 'style', 'story',
  'written', 'write', 'inspired', 'in', 'of', 'to', 'a', 'an', 'as', 'at', 'by',
  'it', 'its', 'on', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being'
]);

function tokenizeForCatalog(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(token => token.length >= 3 && !AUTHOR_CATALOG_STOPWORDS.has(token));
}

function scoreAuthorForPremise(author, premiseTokens) {
  const nameTokens = new Set(tokenizeForCatalog(author?.name));
  const genreTokens = new Set(tokenizeForCatalog(Array.isArray(author?.genres) ? author.genres.join(' ') : author?.genres));
  const knownForTokens = new Set(tokenizeForCatalog(Array.isArray(author?.knownFor) ? author.knownFor.join(' ') : author?.knownFor));
  const descriptionTokens = new Set(tokenizeForCatalog(author?.description));

  let score = 0;
  for (const token of premiseTokens) {
    if (knownForTokens.has(token)) score += 10;
    else if (nameTokens.has(token)) score += 6;
    else if (genreTokens.has(token)) score += 3;
    else if (descriptionTokens.has(token)) score += 2;
  }
  return score;
}

function buildAuthorStyleCatalogForPremise(premiseText, maxEntries = 24) {
  const premiseTokens = tokenizeForCatalog(premiseText);
  if (premiseTokens.length === 0) return AUTHOR_STYLE_CATALOG;

  const ranked = Object.entries(AUTHOR_STYLES)
    .map(([id, author]) => ({ id, author, score: scoreAuthorForPremise(author, premiseTokens) }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score <= 0) {
    return AUTHOR_STYLE_CATALOG;
  }

  return ranked
    .filter(entry => entry.score > 0)
    .slice(0, maxEntries)
    .map(entry => formatAuthorCatalogLine(entry.id, entry.author))
    .join('\n');
}

// =============================================================================
// AUDIENCE SAFETY CAPS - Enforces content intensity limits per audience
// =============================================================================
const AUDIENCE_INTENSITY_CAPS = {
  children: {
    scary: 15, violence: 10, gore: 0, romance: 5,
    adultContent: 0, sensuality: 0, explicitness: 0,
    language: 5, bleakness: 20, sexualViolence: 0
  },
  young_adult: {
    scary: 40, violence: 30, gore: 10, romance: 30,
    adultContent: 10, sensuality: 20, explicitness: 0,
    language: 40, bleakness: 50, sexualViolence: 0
  },
  general: {
    scary: 60, violence: 50, gore: 30, romance: 50,
    adultContent: 30, sensuality: 40, explicitness: 20,
    language: 60, bleakness: 70, sexualViolence: 10
  },
  mature: {
    // No caps - full range allowed
    scary: 100, violence: 100, gore: 100, romance: 100,
    adultContent: 100, sensuality: 100, explicitness: 100,
    language: 100, bleakness: 100, sexualViolence: 100
  }
};

/**
 * Enforce audience safety caps on intensity values
 * Clamps intensity values to safe maximums based on audience
 */
function enforceAudienceSafetyCaps(intensity, audience) {
  const caps = AUDIENCE_INTENSITY_CAPS[audience] || AUDIENCE_INTENSITY_CAPS.general;
  const capped = { ...intensity };

  for (const [field, maxValue] of Object.entries(caps)) {
    if (typeof capped[field] === 'number' && capped[field] > maxValue) {
      logger.info(`[SmartConfig] Capping ${field} from ${capped[field]} to ${maxValue} for ${audience} audience`);
      capped[field] = maxValue;
    }
  }

  return capped;
}

// =============================================================================
// COVER ART STYLE ALIGNMENT - Maps genres to appropriate art styles
// =============================================================================
const GENRE_TO_ART_STYLE = {
  horror: 'gothic',
  fantasy: 'fantasy',
  scifi: 'scifi',
  mystery: 'noir',
  romance: 'romantic',
  erotica: 'romantic',
  adventure: 'adventure',
  humor: 'cartoon',
  fairytale: 'storybook',
  literary: 'painterly',
  poetry: 'watercolor',
  ya: 'modern',
  thriller: 'noir'
};

/**
 * Derive cover art style from genre scores
 * Uses the dominant genre to select appropriate art style
 */
function deriveArtStyleFromGenres(genres) {
  if (!genres || typeof genres !== 'object') {
    return 'fantasy'; // Default
  }

  let dominantGenre = null;
  let highestScore = 0;

  for (const [genre, score] of Object.entries(genres)) {
    if (typeof score === 'number' && score > highestScore) {
      highestScore = score;
      dominantGenre = genre;
    }
  }

  if (!dominantGenre || highestScore < 30) {
    return 'fantasy'; // Default
  }

  return GENRE_TO_ART_STYLE[dominantGenre] || 'fantasy';
}

// NOTE: NEGATION_PREFIXES removed - LLM handles negation detection now

// =============================================================================
// CONFIG TEMPLATES (Presets)
// =============================================================================

const CONFIG_TEMPLATES = {
  horror_movie_night: {
    id: 'horror_movie_night',
    name: 'Horror Movie Night',
    icon: '🎃',
    description: 'Spine-tingling scares for mature audiences',
    config: {
      genres: { horror: 85, mystery: 50, scifi: 30 },
      intensity: { violence: 60, scary: 80, gore: 40 },
      mood: 'scary',
      audience: 'mature',
      narrator_style: 'horror',
      author_style: 'king',
      story_length: 'medium',
      sfx_enabled: true
    }
  },
  bedtime_fairy_tale: {
    id: 'bedtime_fairy_tale',
    name: 'Calm Fairy Tale',
    icon: '🌙',
    description: 'Gentle, low-intensity fairy tales for winding down',
    config: {
      genres: { fairytale: 80, fantasy: 60, adventure: 40 },
      intensity: { violence: 5, scary: 10 },
      mood: 'calm',
      audience: 'children',
      narrator_style: 'warm',
      author_style: 'rowling',
      story_length: 'short',
      bedtime_mode: true,
      sfx_enabled: false
    }
  },
  epic_fantasy_quest: {
    id: 'epic_fantasy_quest',
    name: 'Epic Fantasy Quest',
    icon: '⚔️',
    description: 'Grand adventures with magic and dragons',
    config: {
      genres: { fantasy: 90, adventure: 70, mystery: 30 },
      intensity: { violence: 40, scary: 30 },
      mood: 'exciting',
      audience: 'general',
      narrator_style: 'epic',
      author_style: 'tolkien',
      story_length: 'long',
      sfx_enabled: true
    }
  },
  scifi_adventure: {
    id: 'scifi_adventure',
    name: 'Sci-Fi Adventure',
    icon: '🚀',
    description: 'Space exploration and futuristic tales',
    config: {
      genres: { scifi: 90, adventure: 60, mystery: 40 },
      intensity: { violence: 35, scary: 25 },
      mood: 'exciting',
      audience: 'general',
      narrator_style: 'dramatic',
      author_style: 'asimov',
      story_length: 'medium',
      sfx_enabled: true
    }
  },
  cozy_mystery: {
    id: 'cozy_mystery',
    name: 'Cozy Mystery',
    icon: '🔍',
    description: 'Light-hearted whodunits with clever twists',
    config: {
      genres: { mystery: 85, humor: 50, adventure: 30 },
      intensity: { violence: 15, scary: 20 },
      mood: 'mysterious',
      audience: 'general',
      narrator_style: 'mysterious',
      author_style: 'christie',
      story_length: 'medium',
      sfx_enabled: false
    }
  },
  romantic_adventure: {
    id: 'romantic_adventure',
    name: 'Romantic Adventure',
    icon: '💕',
    description: 'Sweeping love stories with exciting twists',
    config: {
      genres: { romance: 75, adventure: 60, fantasy: 40 },
      intensity: { violence: 10, scary: 5, romance: 50 },
      mood: 'dramatic',
      audience: 'general',
      narrator_style: 'warm',
      author_style: 'austen',
      story_length: 'medium',
      sfx_enabled: false
    }
  },
  comedy_romp: {
    id: 'comedy_romp',
    name: 'Comedy Romp',
    icon: '😂',
    description: 'Hilarious adventures and silly situations',
    config: {
      genres: { humor: 90, adventure: 50, fantasy: 30 },
      intensity: { violence: 10, scary: 5 },
      mood: 'funny',
      audience: 'general',
      narrator_style: 'playful',
      author_style: 'pratchett',
      story_length: 'short',
      sfx_enabled: true
    }
  },
  dark_thriller: {
    id: 'dark_thriller',
    name: 'Dark Thriller',
    icon: '🔪',
    description: 'Intense psychological suspense',
    config: {
      genres: { mystery: 70, horror: 60 },
      intensity: { violence: 55, scary: 70, gore: 30 },
      mood: 'mysterious',
      audience: 'mature',
      narrator_style: 'noir',
      author_style: 'poe',
      story_length: 'medium',
      sfx_enabled: true
    }
  },
  kids_adventure: {
    id: 'kids_adventure',
    name: "Kid's Adventure",
    icon: '🌈',
    description: 'Fun, exciting stories for young listeners',
    config: {
      genres: { adventure: 80, fantasy: 60, humor: 50 },
      intensity: { violence: 5, scary: 10 },
      mood: 'exciting',
      audience: 'children',
      narrator_style: 'playful',
      author_style: 'rowling',
      story_length: 'short',
      sfx_enabled: true
    }
  },
  audio_drama: {
    id: 'audio_drama',
    name: 'Full Audio Drama',
    icon: '🎭',
    description: 'Multi-voice cast with sound effects',
    config: {
      genres: { adventure: 60, mystery: 50, fantasy: 40 },
      intensity: { violence: 30, scary: 30 },
      mood: 'dramatic',
      audience: 'general',
      narrator_style: 'dramatic',
      author_style: 'none',
      story_length: 'medium',
      multi_narrator: true,
      sfx_enabled: true
    }
  }
};

// Narrator style recommendations based on story attributes
const NARRATOR_STYLE_RULES = {
  // Story type -> preferred styles and styles to avoid
  horror: { prefer: ['mysterious', 'horror', 'dramatic'], avoid: ['warm', 'playful', 'whimsical'] },
  childrens: { prefer: ['warm', 'playful', 'whimsical'], avoid: ['mysterious', 'horror', 'noir'] },
  romance: { prefer: ['warm', 'dramatic'], avoid: ['horror'] },
  adventure: { prefer: ['dramatic', 'epic', 'playful'], avoid: [] },
  mystery: { prefer: ['mysterious', 'noir', 'dramatic'], avoid: ['playful', 'whimsical'] },
  scifi: { prefer: ['epic', 'dramatic', 'mysterious'], avoid: ['whimsical'] },
  fantasy: { prefer: ['epic', 'dramatic', 'whimsical'], avoid: ['noir'] },
  comedy: { prefer: ['playful', 'whimsical', 'warm'], avoid: ['horror', 'noir'] },
  bedtime: { prefer: ['warm', 'calm'], avoid: ['horror', 'dramatic', 'epic'] }
};

// Voice recommendations based on narrator style and gender preferences
const VOICE_RECOMMENDATIONS = {
  warm: { male: 'JBFqnCBsd6RMkjVDRZzb', female: 'EXAVITQu4vr4xnSDxMaL' },  // George, Sarah
  dramatic: { male: 'onwK4e9ZLuTAKqWW03F9', female: 'MF3mGyEYCl7XYWbV9V6O' },  // Daniel, Elli
  playful: { male: 'CYw3kZ02Hs0563khs1Fj', female: 'jBpfuIE2acCO8z3wKNLl' },  // Dave, Gigi
  mysterious: { male: 'N2lVS1w4EtoT3dr4eOWO', female: 'XB0fDUnXU5powFXDhCwa' },  // Callum, Charlotte
  horror: { male: 'yoZ06aMxZJJ28mfd3POQ', female: 'XB0fDUnXU5powFXDhCwa' },  // Sam, Charlotte
  epic: { male: 'TxGEqnHWrfWFTfGW9XjX', female: 'FGY2WhTYpPnrIDTdsKH5' },  // Josh, Laura
  whimsical: { male: 'g5CIjZEefAph4nQFvHAz', female: 'XrExE9yKIg1WjnnlVkGX' },  // Ethan, Matilda
  noir: { male: 'pNInz6obpgDQGcFmaJgB', female: 'ThT5KcBeYPX3keUQqHPh' }  // Adam, Dorothy
};

// Genre-specific voice recommendations (best voice for each genre)
// Priority: genre-specific > style-based > default
const GENRE_VOICE_RECOMMENDATIONS = {
  horror: {
    primary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', accent: 'american', reason: 'Raspy voice perfect for horror and suspense' },
    secondary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly unsettling edge' },
    female: { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'swedish', reason: 'Seductive and mysterious' }
  },
  scifi: {
    primary: { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'british', reason: 'Authoritative delivery for sci-fi narratives' },
    secondary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly tone for space opera' },
    female: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'british', reason: 'Clear British voice for professional sci-fi' }
  },
  fantasy: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly Transatlantic, perfect for epic fantasy' },
    secondary: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', accent: 'american', reason: 'Deep voice for epic tales' },
    female: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', accent: 'british', reason: 'Pleasant British storyteller' }
  },
  mystery: {
    primary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', accent: 'american', reason: 'Raspy American, great for mystery' },
    secondary: { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', accent: 'american', reason: 'Deep middle-aged voice for noir' },
    female: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', accent: 'british', reason: 'Pleasant British mystery narrator' }
  },
  adventure: {
    primary: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', accent: 'american', reason: 'Deep voice for thrilling adventures' },
    secondary: { voice_id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', gender: 'male', accent: 'british', reason: 'Animated warrior energy' },
    female: { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', accent: 'american', reason: 'Upbeat and energetic' }
  },
  romance: {
    primary: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', accent: 'british', reason: 'Pleasant British voice for romance' },
    secondary: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'british', reason: 'Warm British narrator' },
    male: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', reason: 'Warm resonance for romantic tales' }
  },
  humor: {
    primary: { voice_id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', gender: 'male', accent: 'british', reason: 'Conversational British-Essex, great for comedy' },
    secondary: { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', accent: 'australian', reason: 'Friendly Australian energy' },
    female: { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', gender: 'female', accent: 'american', reason: 'Young playful voice' }
  },
  fairytale: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', reason: 'Warm voice perfect for children\'s stories' },
    secondary: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', reason: 'Warm British narrator for classic tales' },
    female: { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'american', reason: 'Soft and reassuring' }
  },
  // Genre blends - for stories with multiple strong genres
  horror_scifi: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly voice for cosmic horror and dark sci-fi' },
    secondary: { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'british', reason: 'Authoritative delivery for serious sci-fi horror' },
    female: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'british', reason: 'Clear British voice for professional sci-fi horror' }
  },
  dark_fantasy: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly voice perfect for dark fantasy and gothic tales' },
    secondary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', accent: 'american', reason: 'Raspy edge for darker fantasy elements' },
    female: { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'swedish', reason: 'Mysterious and seductive for dark fantasy' }
  },
  // Mood-based fallbacks
  bedtime: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', reason: 'Warm and soothing for bedtime' },
    secondary: { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'american', reason: 'Soft and comforting' },
    male: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', reason: 'Warm resonance' }
  },
  children: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', reason: 'Warm American, great for children\'s stories' },
    secondary: { voice_id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', gender: 'male', accent: 'american', reason: 'Young friendly voice' },
    female: { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', gender: 'female', accent: 'american', reason: 'Young American, great for YA' }
  }
};

// Author writing style recommendations based on story type and genre
const AUTHOR_STYLE_RECOMMENDATIONS = {
  horror: ['king', 'lovecraft', 'poe', 'stevenson'],
  childrens: ['rowling', 'pratchett', 'gaiman', 'none'],
  romance: ['austen', 'fitzgerald', 'none'],
  adventure: ['howard', 'dumas', 'stevenson', 'tolkien'],
  mystery: ['christie', 'poe', 'none'],
  scifi: ['asimov', 'herbert', 'leguin', 'clarke', 'dick', 'banks'],
  comedy: ['pratchett', 'vonnegut', 'wilde', 'twain'],
  bedtime: ['none', 'rowling', 'gaiman'],
  fantasy: ['tolkien', 'sanderson', 'jordan', 'gaiman', 'hobb', 'rothfuss'],
  epic: ['tolkien', 'jordan', 'martin', 'herbert'],
  literary: ['hemingway', 'fitzgerald', 'woolf', 'nabokov'],
  gothic: ['poe', 'stevenson', 'lovecraft', 'king'],
  psychological: ['dostoevsky', 'kafka', 'dick'],
  // P6: Added YA/Poetry/Literary genre recommendations
  ya: ['rowling', 'gaiman', 'pratchett', 'none'],
  poetry: ['gaiman', 'woolf', 'none'],  // Gaiman for lyrical/poetic, Woolf for stream-of-consciousness
  surreal: ['gaiman', 'kafka', 'dick', 'vonnegut'],  // For surreal/absurdist narratives
  default: ['none']
};

class SmartConfigEngine {
  constructor() {
    this.logger = logger;
  }

  // NOTE: detectNegatedFeature() has been removed - LLM handles negation detection

  /**
   * P3: Extract author preference from text
   * Looks for patterns like "like Stephen King", "in the style of Tolkien"
   * @param {string} text - Lowercased text to search
   * @returns {string|null} - Normalized author name or null
   */
  extractAuthorPreference(text) {
    // Author pattern matching - matches phrases like:
    // "like Stephen King", "similar to Tolkien", "in the style of Hemingway"
    const authorPatterns = [
      /(?:like|similar to|in the style of|inspired by|channeling|written like|write like|writing like)\s+([a-z]+(?:\s+[a-z]+)?)/gi,
      /([a-z]+(?:\s+[a-z]+)?)\s+(?:style|vibes?|feeling|tone|esque)/gi
    ];

    for (const pattern of authorPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const authorName = match[1].trim();
        const normalized = this.normalizeAuthorName(authorName);
        if (normalized) {
          return normalized;
        }
      }
    }
    return null;
  }

  /**
   * P3: Normalize author name to available style options
   * Maps common author requests to available styles in the system
   * @param {string} authorName - Raw author name from text
   * @returns {string|null} - Normalized author style key or null
   */
  normalizeAuthorName(authorName) {
    const lowerName = authorName.toLowerCase().trim();

    // If the LLM already returned a valid author style id, accept it directly.
    if (AUTHOR_STYLES[lowerName]) {
      return lowerName;
    }

    // Mapping of author name variations to system style keys
    const authorMappings = {
      // Horror authors
      'stephen king': 'king',
      'king': 'king',
      'lovecraft': 'lovecraft',
      'hp lovecraft': 'lovecraft',
      'h.p. lovecraft': 'lovecraft',
      'edgar allan poe': 'poe',
      'edgar poe': 'poe',
      'poe': 'poe',

      // Fantasy authors
      'tolkien': 'tolkien',
      'jrr tolkien': 'tolkien',
      'j.r.r. tolkien': 'tolkien',
      'brandon sanderson': 'sanderson',
      'sanderson': 'sanderson',
      'robert jordan': 'jordan',
      'jordan': 'jordan',
      'george martin': 'martin',
      'grrm': 'martin',
      'martin': 'martin',
      'neil gaiman': 'gaiman',
      'gaiman': 'gaiman',
      'robin hobb': 'hobb',
      'hobb': 'hobb',
      'patrick rothfuss': 'rothfuss',
      'rothfuss': 'rothfuss',

      // Sci-fi authors
      'isaac asimov': 'asimov',
      'asimov': 'asimov',
      'frank herbert': 'herbert',
      'herbert': 'herbert',
      'ursula le guin': 'leguin',
      'le guin': 'leguin',
      'leguin': 'leguin',
      'arthur clarke': 'clarke',
      'clarke': 'clarke',
      'philip dick': 'dick',
      'philip k dick': 'dick',
      'dick': 'dick',
      'iain banks': 'banks',
      'banks': 'banks',

      // Classic/Literary authors
      'jane austen': 'austen',
      'austen': 'austen',
      'fitzgerald': 'fitzgerald',
      'f scott fitzgerald': 'fitzgerald',
      'hemingway': 'hemingway',
      'ernest hemingway': 'hemingway',
      'virginia woolf': 'woolf',
      'woolf': 'woolf',
      'nabokov': 'nabokov',
      'vladimir nabokov': 'nabokov',
      'dostoevsky': 'dostoevsky',
      'kafka': 'kafka',
      'franz kafka': 'kafka',

      // Comedy/Satire authors
      'terry pratchett': 'pratchett',
      'pratchett': 'pratchett',
      'kurt vonnegut': 'vonnegut',
      'vonnegut': 'vonnegut',
      'oscar wilde': 'wilde',
      'wilde': 'wilde',
      'mark twain': 'twain',
      'twain': 'twain',

      // Adventure authors
      'robert e howard': 'howard',
      'howard': 'howard',
      'l sprague de camp': 'decamp',
      'l. sprague de camp': 'decamp',
      'sprague de camp': 'decamp',
      'de camp': 'decamp',
      'decamp': 'decamp',
      'alexandre dumas': 'dumas',
      'dumas': 'dumas',
      'robert louis stevenson': 'stevenson',
      'stevenson': 'stevenson',

      // Children/YA authors
      'jk rowling': 'rowling',
      'j.k. rowling': 'rowling',
      'rowling': 'rowling',
      'agatha christie': 'christie',
      'christie': 'christie'
    };

    return authorMappings[lowerName] || null;
  }

  /**
   * Main entry point - interpret a premise and return suggested configuration
   * @param {string} premiseText - Natural language story premise
   * @param {object} currentConfig - Current configuration (optional)
   * @param {object} storyBibleData - Optional Story Bible context for multi-pass
   * @returns {object} - Suggested configuration changes
   */
  async interpretPremise(premiseText, currentConfig = {}, storyBibleData = null) {
    if (!premiseText || typeof premiseText !== 'string' || premiseText.trim().length < 3) {
      return { success: false, error: 'Premise text is required' };
    }

    this.logger.info('[SmartConfig] Interpreting premise:', premiseText.substring(0, 100));

    try {
      // Determine whether to use multi-pass or single-pass analysis
      const useMultiPass = premiseText.length > COMPLEX_PREMISE_THRESHOLD ||
                           hasComplexRequirements(premiseText) ||
                           storyBibleData !== null;

      let llmAnalysis;

      if (useMultiPass) {
        // MULTI-PASS: For complex premises (> 800 chars, style requirements, etc.)
        this.logger.info('[SmartConfig] Using MULTI-PASS analysis for complex premise', {
          length: premiseText.length,
          hasStoryBible: !!storyBibleData,
          hasComplexRequirements: hasComplexRequirements(premiseText)
        });

        llmAnalysis = await multiPassAnalyze(premiseText, storyBibleData);

        // Check for multi-pass failure
        if (llmAnalysis._multiPassFailed) {
          this.logger.warn('[SmartConfig] Multi-pass analysis failed, falling back to single-pass');
          llmAnalysis = await analyzePremiseLLM(premiseText);
        }
      } else {
        // SINGLE-PASS: For simple premises (quick, efficient)
        this.logger.info('[SmartConfig] Using SINGLE-PASS analysis for simple premise');
        llmAnalysis = await analyzePremiseLLM(premiseText);
      }

      // If LLM hit rate limit, use keyword-based fallback instead of generic defaults.
      // This avoids firing more doomed LLM calls and gives premise-specific results.
      if (llmAnalysis.llm_failed && llmAnalysis.llm_error === 'rate_limit') {
        this.logger.warn('[SmartConfig] Rate-limited by OpenAI — switching to keyword fallback');
        llmAnalysis = analyzePremiseKeywords(premiseText);
      } else if (llmAnalysis.llm_failed) {
        this.logger.warn('[SmartConfig] LLM analysis failed, using sensible defaults');
      }

      // Generate config directly from LLM analysis
      // Multi-pass results are already in the right format; single-pass needs generateConfig
      const suggestedConfig = llmAnalysis._multiPassProcessed
        ? await this.convertMultiPassToConfig(llmAnalysis, currentConfig)
        : this.generateConfig(llmAnalysis, currentConfig);

      // Generate human-readable reasoning
      const reasoning = llmAnalysis._multiPassProcessed
        ? this.generateMultiPassReasoning(llmAnalysis)
        : generateReasoningFromLLM(llmAnalysis);

      return {
        success: true,
        analysis: {
          llm: llmAnalysis,
          llm_failed: llmAnalysis.llm_failed || false,
          llm_error: llmAnalysis.llm_error || null,
          keyword_fallback: llmAnalysis.keyword_fallback || false,
          multi_pass: llmAnalysis._multiPassProcessed || false
        },
        suggestedConfig,
        reasoning
      };
    } catch (error) {
      this.logger.error('[SmartConfig] Error interpreting premise:', error);

      // On catastrophic failure, try keyword fallback before resorting to generic defaults
      const isRateLimit = error.status === 429 ||
        /rate.?limit|429|too many requests/i.test(error.message);

      let fallbackAnalysis;
      if (isRateLimit) {
        this.logger.warn('[SmartConfig] Catastrophic rate-limit — using keyword fallback');
        fallbackAnalysis = analyzePremiseKeywords(premiseText);
      } else {
        fallbackAnalysis = { ...SENSIBLE_DEFAULTS, llm_failed: true, llm_error: error.message };
      }

      return {
        success: true,
        analysis: {
          llm: fallbackAnalysis,
          llm_failed: true,
          llm_error: fallbackAnalysis.llm_error || error.message,
          keyword_fallback: fallbackAnalysis.keyword_fallback || false
        },
        suggestedConfig: this.generateConfig(fallbackAnalysis, currentConfig),
        reasoning: fallbackAnalysis.keyword_fallback
          ? 'AI analysis unavailable (rate limited). Settings based on keyword analysis of your premise.'
          : 'Analysis failed, using sensible defaults for a general adventure story.'
      };
    }
  }

  /**
   * Convert multi-pass analysis result to final config format
   * Multi-pass already does most synthesis, this adds remaining transformations
   */
  async convertMultiPassToConfig(multiPassResult, currentConfig) {
    const config = {};

    // Genres - already processed by multi-pass
    config.genres = multiPassResult.genres || {};

    // Mood and format
    config.mood = multiPassResult.mood || currentConfig.mood || 'calm';
    config.story_format = multiPassResult.format || 'short_story';
    config.story_length = multiPassResult.story_length || 'medium';

    // CYOA detection
    if (config.story_format === 'cyoa') {
      config.story_type = 'cyoa';
      config.cyoa_enabled = true;
    } else {
      config.story_type = 'narrative';
      config.cyoa_enabled = false;
    }

    // Audience
    config.audience = multiPassResult.audience || 'general';

    // Intensity - already processed with cross-validation
    config.intensity = multiPassResult.intensity || {};

    // Author style - key benefit of multi-pass
    config.author_style = multiPassResult.author_style || null;
    config.humor_type = multiPassResult.humor_type || null;
    config.cultural_flavor = multiPassResult.cultural_flavor || null;

    // Narrator - enriched by multi-pass style extraction
    if (multiPassResult.narrator) {
      config.narrator = multiPassResult.narrator;
      config.narrator_style = this.mapVoiceStyleToNarratorStyle(multiPassResult.narrator.voice_style);
    } else {
      config.narrator_style = 'warm';
    }

    // Recommend voice based on multi-pass narrator inference
    const voiceRec = this.recommendVoice(config.narrator_style, {
      genres: config.genres,
      mood: config.mood,
      audience: config.audience,
      narratorRecommendation: multiPassResult.narrator || null
    });
    if (voiceRec) {
      config.recommended_voice = voiceRec;
    }

    // Audio features - voice acting (support both new and legacy field names)
    // Default to TRUE for most stories (standard audiobook practice)
    const voiceActedFromLLM = multiPassResult.voice_acted ?? multiPassResult.voiceActed ?? multiPassResult.multi_narrator;
    config.voice_acted = voiceActedFromLLM !== undefined ? voiceActedFromLLM : true; // Default TRUE
    config.multi_narrator = config.voice_acted; // Backward compatibility
    config.sfx_enabled = multiPassResult.sfx_enabled || false;
    config.sfx_level = multiPassResult.sfx_level || null;

    // Phase 4: Auto-recommend director style based on genre mix (when voice acting enabled)
    if (config.voice_acted && config.genres) {
      const recommendedDirector = getRecommendedDirector(config.genres);
      if (recommendedDirector) {
        config.director_style = recommendedDirector;
        this.logger.info(`[SmartConfig] Auto-recommended director: ${recommendedDirector}`);
      }
    }

    // Bedtime mode
    config.bedtime_mode = multiPassResult.bedtime_mode || false;
    if (config.bedtime_mode) {
      config.mood = 'calm';
      config.intensity = config.intensity || {};
      config.intensity.scary = Math.min(config.intensity.scary || 0, 20);
      config.intensity.violence = Math.min(config.intensity.violence || 0, 10);
    }

    // Character count
    if (multiPassResult.character_count) {
      config.character_count = multiPassResult.character_count;
    }

    // Cover art style derived from genres
    config.cover_art_style = this.deriveArtStyleFromGenres(config.genres);

    // Narrator Archetype Detection
    // Determines prosody, pacing, and emotional delivery based on genre/tone/audience
    const dominantGenre = this.getDominantGenre(config.genres);
    const archetypeResult = await detectNarratorArchetype({
      genre: dominantGenre,
      premise: null, // Premise not needed for rule-based detection
      tone: config.mood,
      targetAudience: config.audience
    }, { useLLM: false });

    config.narrator_archetype = archetypeResult.archetype?.id || null;
    config.archetype_confidence = archetypeResult.confidence || 0.75;
    config.archetype_detection_method = archetypeResult.method || 'genre_mapping';

    this.logger.info(`[SmartConfig] Narrator archetype detected: ${config.narrator_archetype} (confidence: ${config.archetype_confidence})`);

    // Preserve multi-pass metadata
    config._multiPassProcessed = true;
    config._culturalFlavor = multiPassResult.cultural_flavor;
    config._humorType = multiPassResult.humor_type;

    this.logger.info('[SmartConfig] Multi-pass config converted', {
      author_style: config.author_style,
      cultural_flavor: config._culturalFlavor,
      humor_type: config._humorType,
      narrator_tone: config.narrator?.tone_descriptors,
      narrator_archetype: config.narrator_archetype
    });

    return config;
  }

  /**
   * Map voice style to narrator style for consistency
   */
  mapVoiceStyleToNarratorStyle(voiceStyle) {
    const mapping = {
      'wry': 'mysterious',
      'dramatic': 'dramatic',
      'warm': 'warm',
      'mysterious': 'mysterious',
      'playful': 'playful',
      'epic': 'epic',
      'horror': 'horror',
      'noir': 'noir',
      'whimsical': 'whimsical',
      'calm': 'warm'
    };
    return mapping[voiceStyle] || 'warm';
  }

  /**
   * Derive cover art style from genre scores (duplicated for self-containment)
   */
  deriveArtStyleFromGenres(genres) {
    if (!genres || typeof genres !== 'object') return 'fantasy';

    const genreToArt = {
      horror: 'gothic', fantasy: 'fantasy', scifi: 'scifi', mystery: 'noir',
      romance: 'romantic', erotica: 'romantic', adventure: 'adventure',
      humor: 'cartoon', fairytale: 'storybook', literary: 'painterly',
      poetry: 'watercolor', ya: 'modern', thriller: 'noir'
    };

    let dominantGenre = null;
    let highestScore = 0;

    for (const [genre, score] of Object.entries(genres)) {
      if (typeof score === 'number' && score > highestScore) {
        highestScore = score;
        dominantGenre = genre;
      }
    }

    if (!dominantGenre || highestScore < 30) return 'fantasy';
    return genreToArt[dominantGenre] || 'fantasy';
  }

  /**
   * Generate human-readable reasoning from multi-pass analysis
   */
  generateMultiPassReasoning(multiPassResult) {
    const lines = [];

    // Author style (key benefit of multi-pass)
    if (multiPassResult.author_style) {
      lines.push(`✍️ **Writing Style**: ${multiPassResult.author_style}`);
      if (multiPassResult.author_reasoning) {
        lines.push(`   ${multiPassResult.author_reasoning}`);
      }
      if (multiPassResult.author_confidence) {
        lines.push(`   Confidence: ${multiPassResult.author_confidence}%`);
      }
    }

    // Cultural flavor and humor type (unique to multi-pass)
    if (multiPassResult.cultural_flavor && multiPassResult.cultural_flavor !== 'neutral') {
      lines.push(`🌍 **Cultural Flavor**: ${multiPassResult.cultural_flavor}`);
    }
    if (multiPassResult.humor_type && multiPassResult.humor_type !== 'none') {
      lines.push(`😄 **Humor Type**: ${multiPassResult.humor_type.replace(/_/g, ' ')}`);
    }

    // Genres
    if (multiPassResult.genres) {
      const topGenres = Object.entries(multiPassResult.genres)
        .filter(([_, score]) => typeof score === 'number' && score > 30)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([genre, score]) => `${genre} (${score}%)`)
        .join(', ');

      if (topGenres) {
        lines.push(`📚 **Genres**: ${topGenres}`);
        if (multiPassResult.genres_reasoning) {
          lines.push(`   ${multiPassResult.genres_reasoning}`);
        }
      }
    }

    // Narrator (enriched by multi-pass)
    if (multiPassResult.narrator) {
      const n = multiPassResult.narrator;
      lines.push(`🎙️ **Narrator**: ${n.preferred_gender || 'neutral'} voice, ${n.voice_style || 'dramatic'} style`);
      if (n.tone_descriptors) {
        lines.push(`   Tone: ${n.tone_descriptors}`);
      }
    }

    // Intensity
    if (multiPassResult.intensity?.reasoning) {
      lines.push(`⚡ **Content Intensity**:`);
      lines.push(`   ${multiPassResult.intensity.reasoning}`);
    }

    // Audience
    if (multiPassResult.audience) {
      lines.push(`👥 **Audience**: ${multiPassResult.audience}`);
      if (multiPassResult.audience_reasoning) {
        lines.push(`   ${multiPassResult.audience_reasoning}`);
      }
    }

    // Dark comedy classification
    if (multiPassResult.story_classification === 'dark_comedy') {
      lines.push(`🎭 **Classification**: Dark Comedy (high bleakness + humor)`);
    }

    if (lines.length === 0) {
      return 'Multi-pass analysis complete. Configuration generated from premise.';
    }

    return lines.join('\n');
  }

  // NOTE: analyzeKeywords() has been removed - LLM-only analysis is now used
  // See analyzePremiseLLM() in configAnalyzer.js for the primary analysis method

  /**
   * Use AI to deeply analyze the premise for nuanced understanding
   * This is the PRIMARY detection method - LLM-based, not regex-based
   * All semantic understanding (negation, author preference, genre, etc.) happens here
   */
  async aiAnalyzePremise(premiseText) {
    try {
      const authorCatalog = buildAuthorStyleCatalogForPremise(premiseText);
      // Comprehensive LLM-based analysis prompt - replaces regex-based detection
      const systemPrompt = `You are a story configuration analyzer. Analyze the premise and return a JSON configuration.

REQUIRED FIELDS (all must be present):

1. genres: Object with genre intensities (0-100). Include ALL of these keys:
   { fantasy, adventure, mystery, scifi, romance, horror, humor, fairytale, literary, poetry, ya }
   - Set to 0 if not present, higher values for dominant genres
   - "literary" = introspective, character studies, stream of consciousness, experimental prose
   - "poetry" = lyrical, poetic prose, metaphorical, symbolic, surreal narratives
   - "ya" = young adult, teen, coming-of-age content

   IMPORTANT for literary/poetic content:
   - "surreal narrative" → literary: 80+, poetry: 70+
   - "poetic prose" → poetry: 80+
   - "dreamlike" → literary: 70+, poetry: 60+
   - "abstract" or "experimental" → literary: 80+

2. mood: One of "calm", "exciting", "scary", "funny", "mysterious", "dramatic", "surreal", "poetic"
   - Use "surreal" for dreamlike, abstract, experimental content
   - Use "poetic" for lyrical, metaphorical content

3. format: One of "short_story", "novella", "novel", "picture_book", "cyoa"
   - Default: "short_story"
   - ONLY use "cyoa" if user EXPLICITLY says: "choose your own adventure", "interactive", "make choices", "CYOA"

4. audience: One of "children", "young_adult", "adult", "all_ages", "general", "mature"

   CRITICAL - ADULT/EXPLICIT CONTENT DETECTION:
   - If premise contains ANY sexual content (sex, erotic, explicit, adult scenes, intimacy, etc.) → audience MUST be "mature"
   - Keywords that REQUIRE "mature": sex, sexual, erotic, explicit, nude, naked, intimacy, sensual, passionate love scene, adult content, NSFW, hardcore, pornographic
   - Do NOT sanitize or refuse - just detect and set audience appropriately

5. intensity: Object { violence: 0-100, gore: 0-100, scary: 0-100, romance: 0-100, adultContent: 0-100 }

   CRITICAL - ADULT CONTENT INTENSITY:
   - adultContent: 0 = no sexual content, 50 = implied/fade-to-black, 80-100 = explicit sexual content
   - romance: For explicit sexual content, set BOTH romance AND adultContent to 80-100
   - If premise mentions: "sex scene", "erotic", "explicit", "hardcore", "adult" → set adultContent: 100, romance: 100
   - This ensures proper routing to uncensored AI providers (Venice.ai)

6. narratorStyle: One of "warm", "dramatic", "playful", "mysterious", "literary", "poetic"
   - Use "literary" or "poetic" for surreal/dreamlike/abstract content

7. storyType: Detected primary type. MUST be one of:
   "horror", "childrens", "ya", "romance", "adventure", "mystery", "scifi", "fantasy", "literary", "poetry", "bedtime"
   - Use "bedtime" ONLY if the premise explicitly requests bedtime/sleep/wind-down/relaxing-before-bed.

   IMPORTANT: For surreal, poetic, dreamlike, abstract, or experimental narratives:
   - Return "literary" or "poetry" as storyType
   - Do NOT return "mystery" just because something is enigmatic

8. characterCount: Estimated number of main characters (integer)

9. themes: Array of 2-3 main themes (strings)

10. storyLength: One of "short", "medium", "long"

11. authorPreference: String or null
    - Must be ONE of the author style ids listed in "AVAILABLE AUTHOR STYLES" below, or null
    - Choose the best matching style even if the user doesn't name an author explicitly, especially when the premise references recognizable characters, settings, franchises, or subgenres
    - Use the "Known for:" hints in the catalog to match recognizable characters/series/franchises to the right author style (e.g., if a premise mentions a character or world that appears in knownFor, prioritize those authors)
    - Return null only if there is no strong match OR the user explicitly asks for no specific author style

AVAILABLE AUTHOR STYLES (authorPreference must be one of these ids):
${authorCatalog}

12. AUDIO FEATURES:

    Defaults:
    - sfxEnabled: false
    - voiceActed: true (DEFAULT for most stories - voice acting is standard audiobook practice)

    sfxEnabled: Boolean
    - TRUE only if premise contains EXACT phrases: "sound effects", "sfx", "audio effects", "ambient sounds", "ambient audio"
    - FALSE for everything else (examples that should NOT enable audio: atmospheric, cinematic, immersive, vivid, rich, detailed, dramatic)

    voiceActed: Boolean (this is about VOICE ACTING for dialogue, NOT narrative POV!)
    - TRUE (default) for stories with:
      * Multiple speaking characters (2+ characters with dialogue)
      * Dialogue-driven or conversation-heavy scenes
      * Ensemble casts, family stories, group dynamics
      * This is standard audiobook practice - different voices for different characters
    - FALSE only if:
      * User explicitly requests "single narrator", "one voice reads all", "no character voices"
      * Story is primarily internal monologue or narration with minimal dialogue
      * Poetry, literary prose without character dialogue
      * Solo character with no one to talk to
    - IMPORTANT: "first person" and "POV" refer to NARRATIVE PERSPECTIVE, not voice acting!
      A first-person story CAN and SHOULD have voice acting for OTHER characters' dialogue.

    sfxLevel: "low" | "medium" | "high" | null
    - null when sfxEnabled is false
    - "low" default when sfxEnabled is true

13. negations: Object with explicit negation flags
    {
      sfxDisabled: boolean - true if "no sound effects", "without sfx", "no audio", etc.
      voiceActingDisabled: boolean - true if "single narrator reads all", "no character voices", "one voice only", etc.
      anyNegationDetected: boolean - true if ANY negation phrase found
    }

14. styleIndicators: Array of detected style keywords from the premise
    - MUST include if present: "surreal", "absurdist", "dreamlike", "kafkaesque", "poetic", "lyrical", "literary", "experimental", "abstract"
    - Empty array [] only if NONE of these styles are detected

EXAMPLES:

Example 1 - Atmospheric horror with multiple characters:
Input: "An atmospheric horror story with a mysterious setting where a family discovers something terrifying"
Output: {
  "sfxEnabled": false,
  "voiceActed": true,
  "storyType": "horror",
  "mood": "scary"
}
REASON: "atmospheric" doesn't enable SFX, but family = multiple characters = voice acting enabled

Example 2 - Solo adventure (no voice acting):
Input: "A lone explorer's journey through ancient ruins, told through their inner thoughts"
Output: {
  "sfxEnabled": false,
  "voiceActed": false,
  "storyType": "adventure"
}
REASON: Solo character, inner thoughts = single narrator appropriate

Example 3 - Surreal poetic narrative (no voice acting):
Input: "A surreal poetic narrative exploring dreams and consciousness"
Output: {
  "genres": { "literary": 85, "poetry": 75, "fantasy": 30, "mystery": 0 },
  "mood": "surreal",
  "storyType": "literary",
  "styleIndicators": ["surreal", "poetic", "dreamlike"],
  "sfxEnabled": false,
  "voiceActed": false
}
REASON: Poetry/literary prose without character dialogue = single narrator

Example 4 - Dialogue-heavy family story (YES voice acting):
Input: "A dark comedy about a family dinner conversation"
Output: {
  "sfxEnabled": false,
  "voiceActed": true,
  "storyType": "humor"
}
REASON: Family = multiple speakers, conversation = dialogue-heavy = voice acting

Example 5 - Explicit audio drama request (YES both):
Input: "An audio drama with full voice cast and sound effects"
Output: {
  "sfxEnabled": true,
  "sfxLevel": "high",
  "voiceActed": true
}
REASON: Explicit "audio drama", "voice cast", "sound effects" = enable both

Return ONLY valid JSON, no markdown, no explanation.`;

      const response = await completion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this story premise:\n\n${premiseText}` }
        ],
        model: getUtilityModel(),
        max_tokens: 600,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        agent_name: 'smart_config_analyzer'
      });

      if (response?.content) {
        const parsed = parseJsonResponse(response.content);
        this.logger.info('[SmartConfig] AI analysis completed:', JSON.stringify(parsed).substring(0, 200));

        // Check if OpenAI refused to analyze (empty or sanitized response)
        // If content was refused, assume it's mature/adult content
        if (!parsed || Object.keys(parsed).length === 0) {
          this.logger.warn('[SmartConfig] AI returned empty analysis - likely content refusal, marking as mature');
          return {
            audience: 'mature',
            intensity: { adultContent: 100, romance: 100, violence: 0, gore: 0, scary: 0 },
            refusedByOpenAI: true
          };
        }

        return parsed;
      }

      // Empty response - OpenAI likely refused
      this.logger.warn('[SmartConfig] AI returned no content - likely content refusal, marking as mature');
      return {
        audience: 'mature',
        intensity: { adultContent: 100, romance: 100, violence: 0, gore: 0, scary: 0 },
        refusedByOpenAI: true
      };
    } catch (error) {
      this.logger.warn('[SmartConfig] AI analysis failed:', error.message);

      // Check if it's a content policy error
      if (error.message?.includes('content') || error.message?.includes('policy') || error.message?.includes('refused')) {
        this.logger.warn('[SmartConfig] Content policy error detected - marking as mature for Venice routing');
        return {
          audience: 'mature',
          intensity: { adultContent: 100, romance: 100, violence: 0, gore: 0, scary: 0 },
          refusedByOpenAI: true
        };
      }

      return null;
    }
  }

  /**
   * Generate configuration from LLM analysis results
   * LLM-ONLY: No keyword fallback - LLM returns numeric scores directly
   */
  generateConfig(llmAnalysis, currentConfig) {
    const config = {};

    // Start with EMPTY genres - LLM provides all genre scores
    config.genres = {};

    // LLM genres are the ONLY source (returns numeric scores 0-100)
    if (llmAnalysis?.genres) {
      for (const [genre, score] of Object.entries(llmAnalysis.genres)) {
        if (typeof score === 'number' && score > 0) {
          config.genres[genre] = Math.max(0, Math.min(100, Math.round(score)));
        }
      }
    }

    // Set mood from LLM
    config.mood = llmAnalysis?.mood || currentConfig.mood || 'calm';

    // Set format - LLM handles all format detection
    if (llmAnalysis?.format) {
      config.story_format = llmAnalysis.format;
      if (llmAnalysis.format === 'cyoa') {
        config.story_type = 'cyoa';
        config.cyoa_enabled = true;
      } else {
        config.story_type = 'narrative';
        config.cyoa_enabled = false;
      }
    } else {
      config.story_type = 'narrative';
      config.cyoa_enabled = false;
    }

    // Set audience from LLM (LLM has strict rules about children vs general)
    // Also check intensity levels to auto-detect mature content
    const llmAudience = llmAnalysis?.audience;
    const intensityViolence = llmAnalysis?.intensity?.violence || 0;
    const intensityGore = llmAnalysis?.intensity?.gore || 0;
    const intensityScary = llmAnalysis?.intensity?.scary || 0;
    const intensityRomance = llmAnalysis?.intensity?.romance || 0;
    const intensityAdultContent = llmAnalysis?.intensity?.adultContent || 0;

    // High intensity content should force mature audience
    const hasMatureContent = intensityViolence >= 60 || intensityGore >= 40 || intensityScary >= 70 || intensityRomance >= 70 || intensityAdultContent >= 50;

    if (llmAudience === 'mature' || hasMatureContent) {
      config.audience = 'mature';
      this.logger.info(`[SmartConfig] Setting audience=mature (LLM: ${llmAudience}, Violence: ${intensityViolence}, Gore: ${intensityGore}, Scary: ${intensityScary}, Romance: ${intensityRomance}, AdultContent: ${intensityAdultContent})`);
    } else if (llmAudience === 'children') {
      config.audience = 'children';
    } else if (llmAudience === 'young_adult') {
      config.audience = 'young_adult';
    } else {
      config.audience = llmAudience || currentConfig.audience || 'general';
    }

    // Set intensity from LLM
    config.intensity = { ...currentConfig.intensity };

    if (llmAnalysis?.intensity) {
      for (const [type, score] of Object.entries(llmAnalysis.intensity)) {
        if (typeof score === 'number') {
          config.intensity[type] = Math.round(score);
        }
      }
    }

    // CRITICAL: Enforce audience safety caps on intensity values
    // This ensures children's content can't have scary=18% etc.
    config.intensity = enforceAudienceSafetyCaps(config.intensity, config.audience);

    // Determine narrator style
    const storyType = llmAnalysis?.storyType || 'general';
    config.narrator_style = this.recommendNarratorStyle(storyType, config);

    // Recommend voice based on genre, mood, audience, style, AND LLM narrator inference
    const voiceRec = this.recommendVoice(config.narrator_style, {
      genres: config.genres,
      mood: config.mood,
      audience: config.audience,
      narratorRecommendation: llmAnalysis?.narrator || null
    });
    if (voiceRec) {
      config.recommended_voice = voiceRec;
    }

    // Recommend author writing style
    const styleIndicators = llmAnalysis?.styleIndicators || [];
    config.detectedKeywords = [...styleIndicators];

    if (llmAnalysis?.authorPreference) {
      const normalized = this.normalizeAuthorName(llmAnalysis.authorPreference);
      if (normalized) {
        config.author_style = normalized;
        this.logger.info(`[SmartConfig] Using LLM-detected author style: ${normalized}`);
      } else {
        config.author_style = this.recommendAuthorStyle(storyType, config);
      }
    } else {
      config.author_style = this.recommendAuthorStyle(storyType, config);
    }

    // =======================================================================
    // AUDIO FEATURES - LLM-ONLY DETECTION
    // =======================================================================

    // NEGATION DETECTION from LLM
    const llmNegations = llmAnalysis?.negations || {};

    // Voice acting: LLM negation > LLM enable > default TRUE
    // Support both new (voiceActingDisabled, voiceActed) and legacy (multiVoiceDisabled, multiNarrator) field names
    const voiceActingDisabled = llmNegations.voiceActingDisabled ?? llmNegations.multiVoiceDisabled;
    const voiceActedFromLLM = llmAnalysis?.voiceActed ?? llmAnalysis?.multiNarrator;

    if (voiceActingDisabled === true) {
      config.voice_acted = false;
      config.multi_narrator = false; // Backward compatibility
      config.voice_acted_explicitly_disabled = true;
      config.multi_narrator_explicitly_disabled = true; // Backward compatibility
      this.logger.info('[SmartConfig] LLM detected explicit negation: voice acting disabled');
    } else if (voiceActedFromLLM === true) {
      config.voice_acted = true;
      config.multi_narrator = true; // Backward compatibility
      this.logger.info('[SmartConfig] LLM detected voice_acted=true');
    } else if (voiceActedFromLLM === false) {
      config.voice_acted = false;
      config.multi_narrator = false; // Backward compatibility
      this.logger.info('[SmartConfig] LLM detected voice_acted=false');
    }
    // If neither specified, keep the default (TRUE from earlier assignment)

    // SFX: LLM negation > LLM enable
    if (llmNegations.sfxDisabled === true) {
      config.sfx_enabled = false;
      config.sfx_explicitly_disabled = true;
      config.sfx_level = null;
      this.logger.info('[SmartConfig] LLM detected explicit negation: SFX disabled');
    } else if (llmAnalysis?.sfxEnabled === true) {
      config.sfx_enabled = true;
      config.sfx_level = llmAnalysis.sfxLevel || 'low';
      this.logger.info(`[SmartConfig] LLM detected sfx_enabled=true, level=${config.sfx_level}`);
    }

    // Story length from LLM
    if (llmAnalysis?.storyLength) {
      config.story_length = llmAnalysis.storyLength;
      this.logger.info(`[SmartConfig] LLM inferred story_length=${llmAnalysis.storyLength}`);
    }

    // Story length fallback - infer from format if not explicitly set
    if (!config.story_length) {
      const formatLengthMap = {
        'picture_book': 'short',
        'short_story': 'short',
        'novella': 'medium',
        'novel': 'long',
        'series': 'long'
      };
      config.story_length = formatLengthMap[config.story_format] || 'medium';
      this.logger.info(`[SmartConfig] Inferred story_length=${config.story_length} from format or default`);
    }

    // Bedtime mode from LLM
    if (llmAnalysis?.bedtimeMode) {
      config.bedtime_mode = true;
      config.mood = 'calm';
      config.intensity = config.intensity || {};
      config.intensity.scary = Math.min(config.intensity.scary || 0, 20);
      config.intensity.violence = Math.min(config.intensity.violence || 0, 10);
      this.logger.info('[SmartConfig] Setting bedtime_mode=true with reduced intensity');
    }

    // Character count from LLM
    if (llmAnalysis?.characterCount) {
      config.character_count = llmAnalysis.characterCount;
      this.logger.info(`[SmartConfig] Setting character_count: ${llmAnalysis.characterCount.min}-${llmAnalysis.characterCount.max}`);
    }

    // CRITICAL: Derive cover art style from genre scores
    // This ensures cover art matches the dominant genre
    config.cover_art_style = deriveArtStyleFromGenres(config.genres);
    this.logger.info(`[SmartConfig] Derived cover_art_style=${config.cover_art_style} from genres`);

    // Narrator Archetype Detection (single-pass)
    // Determines prosody, pacing, and emotional delivery based on genre/tone/audience
    const dominantGenre = this.getDominantGenre(config.genres);
    const archetype = getArchetypeForGenre(dominantGenre);

    if (archetype) {
      config.narrator_archetype = archetype.id;
      config.archetype_confidence = 0.75; // Genre-only mapping has medium confidence
      config.archetype_detection_method = 'genre_mapping';
      this.logger.info(`[SmartConfig] Narrator archetype detected: ${config.narrator_archetype} (genre: ${dominantGenre})`);
    }

    return config;
  }

  /**
   * Get the dominant genre from genre scores
   * @param {Object} genres - Genre scores object
   * @returns {string} The genre with the highest score, or 'drama' as default
   */
  getDominantGenre(genres) {
    if (!genres || typeof genres !== 'object') {
      return 'drama';
    }

    let dominant = 'drama';
    let highestScore = 0;

    for (const [genre, score] of Object.entries(genres)) {
      if (typeof score === 'number' && score > highestScore) {
        highestScore = score;
        dominant = genre;
      }
    }

    return dominant;
  }

  /**
   * Recommend author writing style based on story type, audience, and genres
   * P4 FIX: Priority order: audience → story type → genre combinations → single genre
   */
  recommendAuthorStyle(storyType, config) {
    // PRIORITY 1: Audience-based selection (children/YA gets YA authors)
    // This takes precedence over genre selection
    if (config.audience === 'children') {
      this.logger.info('[SmartConfig] Author style: YA authors for children audience');
      return AUTHOR_STYLE_RECOMMENDATIONS.ya[0] || 'rowling';
    }

    // PRIORITY 1b: YA story type or YA genre detection
    // YA content (young adult, teen, coming-of-age) gets YA authors
    if (storyType === 'ya' || storyType === 'childrens' || (config.genres?.ya > 40)) {
      this.logger.info('[SmartConfig] Author style: YA authors for YA/teen content');
      return AUTHOR_STYLE_RECOMMENDATIONS.ya[0] || 'rowling';
    }

    // PRIORITY 2: Story type-based (if explicit type like 'bedtime', 'horror')
    let recommendations = AUTHOR_STYLE_RECOMMENDATIONS[storyType] || AUTHOR_STYLE_RECOMMENDATIONS.default;

    // PRIORITY 3: Genre combinations (order matters - check from most to least specific)
    // Romance should override sci-fi for "romantic space opera" type stories
    const genres = config.genres || {};

    // Poetry/Literary/Surreal FIRST - these are specialized and shouldn't default to mystery
    // "surreal poetic narrative" should get Gaiman/Kafka, not Christie
    // Check multiple signals: storyType, genres, mood, detectedKeywords
    if (genres.poetry > 40 || storyType === 'poetry' || config.mood === 'poetic') {
      this.logger.info('[SmartConfig] Author style: Poetry authors for poetic content');
      return AUTHOR_STYLE_RECOMMENDATIONS.poetry[0] || 'gaiman';
    }

    if (genres.literary > 40 || storyType === 'literary') {
      this.logger.info('[SmartConfig] Author style: Literary authors for literary fiction');
      return AUTHOR_STYLE_RECOMMENDATIONS.literary[0] || 'hemingway';
    }

    // Surreal/absurdist content - check mood, keywords, and any surreal indicators
    // This catches "surreal poetic narrative" even if genres aren't set high
    if (config.mood === 'surreal' ||
        config.detectedKeywords?.includes('surreal') || config.detectedKeywords?.includes('absurdist') ||
        config.detectedKeywords?.includes('dreamlike') || config.detectedKeywords?.includes('experimental') ||
        config.detectedKeywords?.includes('poetic') || config.detectedKeywords?.includes('lyrical')) {
      this.logger.info('[SmartConfig] Author style: Surreal authors for surreal/absurdist/poetic content');
      return AUTHOR_STYLE_RECOMMENDATIONS.surreal[0] || 'gaiman';
    }

    // Check romance - if romance is significant, prioritize romance authors
    // This ensures "romantic space opera" gets romance authors, not sci-fi
    if (genres.romance > 50) {
      this.logger.info('[SmartConfig] Author style: Romance authors (romance genre detected)');
      return AUTHOR_STYLE_RECOMMENDATIONS.romance[0] || 'austen';
    }

    // If comedic mood or high humor, prioritize comedy authors
    if (config.mood === 'funny' || genres.humor > 60) {
      this.logger.info('[SmartConfig] Author style: Comedy authors');
      return AUTHOR_STYLE_RECOMMENDATIONS.comedy[0] || 'pratchett';
    }

    // If high horror or gore
    if (genres.horror > 60 || config.intensity?.gore > 50) {
      this.logger.info('[SmartConfig] Author style: Horror authors');
      return AUTHOR_STYLE_RECOMMENDATIONS.horror[0] || 'king';
    }

    // If mystery-focused (but not if poetry/surreal - already handled above)
    if (genres.mystery > 60) {
      this.logger.info('[SmartConfig] Author style: Mystery authors');
      return AUTHOR_STYLE_RECOMMENDATIONS.mystery[0] || 'christie';
    }

    // If high fantasy (but not for children - already handled above)
    if (genres.fantasy > 70) {
      this.logger.info('[SmartConfig] Author style: Fantasy authors');
      return AUTHOR_STYLE_RECOMMENDATIONS.fantasy[0] || 'tolkien';
    }

    // If high scifi (but not romance-dominant - already handled above)
    if (genres.scifi > 60) {
      this.logger.info('[SmartConfig] Author style: Sci-Fi authors');
      return AUTHOR_STYLE_RECOMMENDATIONS.scifi[0] || 'asimov';
    }

    // Return first recommendation from story type or default
    this.logger.info(`[SmartConfig] Author style: Using story type '${storyType}' default`);
    return recommendations[0] || 'none';
  }

  // NOTE: estimateCharacterCount() has been removed - LLM handles character count estimation

  /**
   * Detect primary story type from genre analysis (works with LLM output)
   */
  detectStoryType(analysis) {
    const genres = analysis.genres || {};

    // Check for specific story type indicators (order matters - more specific first)
    if (genres.horror > 50 || analysis.intensity?.gore > 40) return 'horror';
    if (analysis.audience === 'children') return 'childrens';
    if (analysis.bedtime_mode) return 'bedtime';
    if (genres.romance > 50) return 'romance';
    if (genres.mystery > 50) return 'mystery';
    if (genres.fantasy > 60) return 'fantasy';  // Fantasy before adventure
    if (genres.scifi > 50) return 'scifi';
    if (genres.adventure > 50) return 'adventure';
    if (genres.humor > 50) return 'comedy';
    if (genres.fairytale > 50 || analysis.mood === 'calm') return 'bedtime';
    // P6: Added YA/Poetry/Literary detection
    if (genres.ya > 50) return 'ya';
    if (genres.literary > 50) return 'literary';
    if (genres.poetry > 50) return 'poetry';

    return 'adventure'; // Default
  }

  /**
   * Recommend narrator style based on story type
   * FIX: Now considers violence and gore intensity, not just scary
   */
  recommendNarratorStyle(storyType, config) {
    const rules = NARRATOR_STYLE_RULES[storyType] || NARRATOR_STYLE_RULES.adventure;
    const intensity = config.intensity || {};

    // FIX: Check for ANY dark/horror-appropriate intensity setting
    // Violence-heavy, gore-heavy, or scary stories all need dark narration
    const isDarkContent = (intensity.scary > 60) ||
                          (intensity.violence > 60) ||
                          (intensity.gore > 50) ||
                          (intensity.scary > 40 && intensity.violence > 40);  // Combined moderate settings

    if (isDarkContent) {
      this.logger.debug(`[SmartConfig] Dark content detected | scary: ${intensity.scary} | violence: ${intensity.violence} | gore: ${intensity.gore}`);
      // Prefer horror narrator for truly dark content, mysterious for moderate
      if (intensity.gore > 50 || intensity.scary > 70) {
        if (!rules.avoid.includes('horror')) return 'horror';
      }
      if (!rules.avoid.includes('mysterious')) return 'mysterious';
      if (!rules.avoid.includes('dramatic')) return 'dramatic';
    }

    if (config.mood === 'funny' && !rules.avoid.includes('playful')) {
      return 'playful';
    }

    // Return first preferred style
    return rules.prefer[0] || 'warm';
  }

  /**
   * Recommend voice based on genre, mood, audience, and narrator style
   * Priority: LLM narrator inference > genre-specific > mood-based > style-based > default
   */
  recommendVoice(narratorStyle, options = {}) {
    const { genres = {}, mood = null, audience = null, preferredGender = null, narratorRecommendation = null } = options;

    // =======================================================================
    // HIGHEST PRIORITY: LLM Narrator Inference
    // The LLM understands context like "Conan story = gruff masculine narrator"
    // This is the key insight: fans of specific genres expect specific voices
    // =======================================================================
    if (narratorRecommendation && narratorRecommendation.preferred_gender) {
      const preferredAccent = narratorRecommendation.preferred_accent || 'neutral';
      this.logger.info(`[SmartConfig] LLM Narrator Inference: gender=${narratorRecommendation.preferred_gender}, accent=${preferredAccent}, style=${narratorRecommendation.voice_style}, tone="${narratorRecommendation.tone_descriptors}"`);
      this.logger.info(`[SmartConfig] LLM Reasoning: ${narratorRecommendation.reasoning}`);

      // Map LLM characteristics to genre voice recommendations
      const llmGender = narratorRecommendation.preferred_gender; // masculine, feminine, neutral
      const llmStyle = narratorRecommendation.voice_style; // dramatic, warm, mysterious, etc.
      const llmChars = narratorRecommendation.characteristics || [];

      // Try to find a matching voice from genre recommendations based on LLM guidance
      const voiceMatch = this.findVoiceByLLMGuidance(llmGender, llmStyle, llmChars, genres, preferredAccent);
      if (voiceMatch) {
        this.logger.info(`[SmartConfig] Selected LLM-guided voice: ${voiceMatch.name} (${voiceMatch.reason})`);
        return {
          voice_id: voiceMatch.voice_id,
          name: voiceMatch.name,
          style: narratorStyle,
          gender: voiceMatch.gender,
          reason: `LLM inference: ${narratorRecommendation.tone_descriptors || voiceMatch.reason}`,
          llm_guided: true
        };
      }
    }

    // Find the dominant genre (highest score)
    let dominantGenre = null;
    let highestScore = 0;
    for (const [genre, score] of Object.entries(genres)) {
      if (score > highestScore) {
        highestScore = score;
        dominantGenre = genre;
      }
    }

    this.logger.info(`[SmartConfig] Voice selection - dominant genre: ${dominantGenre} (${highestScore}), mood: ${mood}, audience: ${audience}`);

    // CRITICAL: Check audience FIRST - children-only voices should NEVER be used for mature content
    // Children's voices like Matilda are inappropriate for mature/horror stories
    if (audience === 'children') {
      const childVoices = GENRE_VOICE_RECOMMENDATIONS.children || GENRE_VOICE_RECOMMENDATIONS.bedtime;
      if (childVoices) {
        const voice = preferredGender === 'male' ? childVoices.male || childVoices.secondary : childVoices.primary;
        this.logger.info(`[SmartConfig] Selected children's voice: ${voice.name}`);
        return {
          voice_id: voice.voice_id,
          name: voice.name,
          style: narratorStyle,
          gender: voice.gender,
          reason: 'Children audience - using child-appropriate voice'
        };
      }
    }

    // Only use calm/bedtime voices for NON-MATURE audiences
    // This prevents horror stories from getting Matilda just because mood is "calm"
    if (mood === 'calm' && audience !== 'mature') {
      const bedtimeVoices = GENRE_VOICE_RECOMMENDATIONS.bedtime;
      if (bedtimeVoices) {
        const voice = preferredGender === 'male' ? bedtimeVoices.male || bedtimeVoices.secondary : bedtimeVoices.primary;
        this.logger.info(`[SmartConfig] Selected calm voice for non-mature: ${voice.name}`);
        return {
          voice_id: voice.voice_id,
          name: voice.name,
          style: narratorStyle,
          gender: voice.gender,
          reason: 'Calm mood with non-mature audience'
        };
      }
    }

    // Check for genre blends first (horror+scifi, dark fantasy, etc.)
    const horrorScore = genres.horror || 0;
    const scifiScore = genres.scifi || 0;
    const fantasyScore = genres.fantasy || 0;

    // Horror + Scifi blend (cosmic horror, alien horror, sci-fi thriller)
    if (horrorScore >= 40 && scifiScore >= 40) {
      const blendVoices = GENRE_VOICE_RECOMMENDATIONS.horror_scifi;
      if (blendVoices) {
        let selectedVoice;
        if (preferredGender === 'female') {
          selectedVoice = blendVoices.female || blendVoices.primary;
        } else {
          selectedVoice = blendVoices.primary;
        }
        this.logger.info(`[SmartConfig] Selected horror+scifi blend voice: ${selectedVoice.name}`);
        return {
          voice_id: selectedVoice.voice_id,
          name: selectedVoice.name,
          style: narratorStyle,
          gender: selectedVoice.gender,
          reason: selectedVoice.reason
        };
      }
    }

    // Dark Fantasy blend (fantasy + horror elements)
    if (fantasyScore >= 40 && horrorScore >= 30) {
      const blendVoices = GENRE_VOICE_RECOMMENDATIONS.dark_fantasy;
      if (blendVoices) {
        let selectedVoice;
        if (preferredGender === 'female') {
          selectedVoice = blendVoices.female || blendVoices.primary;
        } else {
          selectedVoice = blendVoices.primary;
        }
        this.logger.info(`[SmartConfig] Selected dark fantasy blend voice: ${selectedVoice.name}`);
        return {
          voice_id: selectedVoice.voice_id,
          name: selectedVoice.name,
          style: narratorStyle,
          gender: selectedVoice.gender,
          reason: selectedVoice.reason
        };
      }
    }

    // Try genre-specific voice recommendation
    if (dominantGenre && highestScore >= 40 && GENRE_VOICE_RECOMMENDATIONS[dominantGenre]) {
      const genreVoices = GENRE_VOICE_RECOMMENDATIONS[dominantGenre];
      let selectedVoice;

      if (preferredGender === 'female') {
        selectedVoice = genreVoices.female || genreVoices.primary;
      } else if (preferredGender === 'male') {
        selectedVoice = genreVoices.male || genreVoices.primary;
      } else {
        // Use primary voice for the genre
        selectedVoice = genreVoices.primary;
      }

      this.logger.info(`[SmartConfig] Selected genre-based voice: ${selectedVoice.name} for ${dominantGenre}`);
      return {
        voice_id: selectedVoice.voice_id,
        name: selectedVoice.name,
        style: narratorStyle,
        gender: selectedVoice.gender,
        reason: selectedVoice.reason
      };
    }

    // Fall back to style-based recommendation
    const voiceMap = VOICE_RECOMMENDATIONS[narratorStyle] || VOICE_RECOMMENDATIONS.warm;

    if (preferredGender === 'male') {
      return { voice_id: voiceMap.male, style: narratorStyle, gender: 'male' };
    } else if (preferredGender === 'female') {
      return { voice_id: voiceMap.female, style: narratorStyle, gender: 'female' };
    }

    // P1 FIX: Default to male for most genres, only use female for specific genres
    // Previously defaulted to female for "warm" styles, which caused wrong narrator for adult/horror/action stories
    const maleGenres = ['horror', 'scifi', 'fantasy', 'adventure', 'mystery', 'thriller', 'action', 'epic'];
    const femaleGenres = ['romance', 'fairytale', 'ya', 'contemporary'];

    // Determine default gender based on dominant genre
    let defaultGender = 'male'; // Default to male for most stories
    if (dominantGenre && femaleGenres.includes(dominantGenre)) {
      defaultGender = 'female';
    } else if (audience === 'children' && narratorStyle === 'warm') {
      defaultGender = 'female'; // Warm children's stories can use female narrator
    }

    this.logger.info(`[SmartConfig] Fallback voice selection: style=${narratorStyle}, genre=${dominantGenre}, defaultGender=${defaultGender}`);

    return {
      voice_id: defaultGender === 'female' ? voiceMap.female : voiceMap.male,
      style: narratorStyle,
      gender: defaultGender,
      reason: `Fallback: ${defaultGender} voice for ${dominantGenre || narratorStyle} content`
    };
  }

  /**
   * Find a voice based on LLM narrator guidance
   * Maps LLM characteristics to available ElevenLabs voices
   *
   * @param {string} llmGender - 'masculine', 'feminine', or 'neutral'
   * @param {string} llmStyle - 'dramatic', 'warm', 'mysterious', 'epic', 'horror', 'noir', etc.
   * @param {string[]} llmChars - Characteristics like ['deep', 'gravelly', 'commanding']
   * @param {Object} genres - Genre scores from config
   * @param {string} [preferredAccent='neutral'] - 'british', 'american', 'australian', or 'neutral'
   * @returns {Object|null} Voice recommendation or null
   */
  findVoiceByLLMGuidance(llmGender, llmStyle, llmChars, genres, preferredAccent = 'neutral') {
    // Map LLM style to best matching genre category
    // FIX: Don't map "dramatic" to adventure - dramatic fits multiple genres
    // Instead, use genre scores to determine the best match for dramatic stories
    const styleToGenre = {
      'dramatic': null,  // FIX: Removed adventure mapping - use genre context instead
      'epic': 'fantasy',
      'warm': 'fairytale',
      'mysterious': 'mystery',
      'horror': 'horror',
      'dark': 'horror',        // FIX: Added dark style for horror
      'sinister': 'horror',    // FIX: Added sinister style for horror
      'tense': 'thriller',     // FIX: Added tense style for thriller
      'suspenseful': 'thriller', // FIX: Added suspenseful for thriller
      'noir': 'mystery',
      'playful': 'humor',
      'whimsical': 'fairytale',
      'calm': 'fairytale'
    };

    // Map LLM characteristics to specific voices
    // This is the key - characteristics like "gravelly" or "commanding" point to specific voices
    const charToVoice = {
      'gravelly': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gravelly Transatlantic voice' },
      'gruff': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Gruff commanding presence' },
      'raspy': { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', accent: 'american', reason: 'Raspy American voice' },
      'deep': { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', accent: 'american', reason: 'Deep resonant voice' },
      'commanding': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'transatlantic', reason: 'Commanding authoritative voice' },
      'authoritative': { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'british', reason: 'Authoritative narrator' },
      'warm': { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', reason: 'Warm nurturing voice' },
      'gentle': { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'american', reason: 'Soft and reassuring' },
      'soothing': { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', reason: 'Warm soothing voice' },
      'rich': { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', reason: 'Rich resonant baritone' },
      'silky': { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'swedish', reason: 'Silky mysterious voice' },
      'seductive': { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'swedish', reason: 'Seductive and mysterious' }
    };

    const hasAccentPref = preferredAccent && preferredAccent !== 'neutral';

    // Helper: does a voice's accent match the preference?
    // 'transatlantic' is compatible with both british and american preferences
    const accentMatches = (voiceAccent, pref) => {
      if (!pref || pref === 'neutral') return true;
      if (voiceAccent === pref) return true;
      if (voiceAccent === 'transatlantic' && (pref === 'british' || pref === 'american')) return true;
      return false;
    };

    // Helper: check gender compatibility
    const genderMatches = (voiceGender, llmGenderPref) => {
      return llmGenderPref === 'neutral' ||
        (llmGenderPref === 'masculine' && voiceGender === 'male') ||
        (llmGenderPref === 'feminine' && voiceGender === 'female');
    };

    // First, check for characteristic matches (highest priority - most specific)
    if (llmChars && llmChars.length > 0) {
      // Pass 1: Look for characteristic match WITH correct accent
      if (hasAccentPref) {
        for (const char of llmChars) {
          const charLower = char.toLowerCase();
          if (charToVoice[charLower]) {
            const voice = charToVoice[charLower];
            if (genderMatches(voice.gender, llmGender) && accentMatches(voice.accent, preferredAccent)) {
              this.logger.info(`[SmartConfig] LLM characteristic "${char}" matched voice with ${preferredAccent} accent: ${voice.name}`);
              return voice;
            }
          }
        }
      }

      // Pass 2: Accept characteristic match regardless of accent (fallback)
      for (const char of llmChars) {
        const charLower = char.toLowerCase();
        if (charToVoice[charLower]) {
          const voice = charToVoice[charLower];
          if (genderMatches(voice.gender, llmGender)) {
            // If we have an accent preference but no accent match was found above,
            // check if there's a same-accent voice in genre recommendations instead
            if (hasAccentPref) {
              this.logger.debug(`[SmartConfig] Characteristic "${char}" matched ${voice.name} but accent mismatch (${voice.accent} vs ${preferredAccent}), trying genre-accent fallback`);
              // Don't return yet — let the genre-based selection below try accent matching
              break;
            }
            this.logger.info(`[SmartConfig] LLM characteristic "${char}" matched voice: ${voice.name}`);
            return voice;
          }
        }
      }
    }

    // Second, try style-based matching OR use genre scores if style maps to null
    // FIX: Don't default to adventure - use actual genre scores from the config
    let matchedGenre = styleToGenre[llmStyle];

    // If style doesn't map directly (e.g., "dramatic" which fits many genres),
    // determine genre from the actual genre scores
    if (!matchedGenre && genres) {
      const dominantFromScores = Object.entries(genres)
        .filter(([_, score]) => score > 40)  // Only consider significant genres
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      matchedGenre = dominantFromScores;
      this.logger.debug(`[SmartConfig] Style "${llmStyle}" has no direct mapping, using genre score: ${matchedGenre}`);
    }

    // FIX: Default to mystery (neutral) instead of adventure if no genre found
    matchedGenre = matchedGenre || 'mystery';
    const genreVoices = GENRE_VOICE_RECOMMENDATIONS[matchedGenre];

    if (genreVoices) {
      const voice = this._selectVoiceFromGenreWithAccent(genreVoices, llmGender, preferredAccent, accentMatches);
      if (voice) return voice;
    }

    // Third, fall back to genre from config
    const dominantGenre = Object.entries(genres || {})
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (dominantGenre && GENRE_VOICE_RECOMMENDATIONS[dominantGenre]) {
      const dg = GENRE_VOICE_RECOMMENDATIONS[dominantGenre];
      const voice = this._selectVoiceFromGenreWithAccent(dg, llmGender, preferredAccent, accentMatches);
      if (voice) return voice;
    }

    return null;
  }

  /**
   * Select voice from a genre recommendation set, preferring accent matches.
   * Examines primary/secondary/female/male entries and picks the best fit.
   */
  _selectVoiceFromGenreWithAccent(genreVoices, llmGender, preferredAccent, accentMatchFn) {
    const hasAccentPref = preferredAccent && preferredAccent !== 'neutral';

    // Collect all candidate voices from the genre entry
    const candidates = [];
    for (const key of ['primary', 'secondary', 'female', 'male']) {
      if (genreVoices[key]) candidates.push(genreVoices[key]);
    }

    // Filter by gender
    const genderFiltered = candidates.filter(v => {
      if (llmGender === 'neutral') return true;
      if (llmGender === 'masculine' && v.gender === 'male') return true;
      if (llmGender === 'feminine' && v.gender === 'female') return true;
      return false;
    });

    const pool = genderFiltered.length > 0 ? genderFiltered : candidates;

    // If accent preference, try to find a matching voice
    if (hasAccentPref) {
      const accentMatch = pool.find(v => accentMatchFn(v.accent, preferredAccent));
      if (accentMatch) {
        this.logger.info(`[SmartConfig] Accent-matched voice: ${accentMatch.name} (${accentMatch.accent} matches ${preferredAccent})`);
        return accentMatch;
      }
      this.logger.debug(`[SmartConfig] No ${preferredAccent} accent match in genre pool, using best gender match`);
    }

    // Fall back to standard gender-based selection
    if (llmGender === 'feminine' && genreVoices.female) {
      return genreVoices.female;
    } else if (llmGender === 'masculine') {
      return genreVoices.primary || genreVoices.secondary;
    }
    return genreVoices.primary;
  }

  // NOTE: generateReasoning() has been removed - we now use generateReasoningFromLLM from configAnalyzer.js

  /**
   * Process RTC (realtime conversation) input and generate config updates
   * This is called during voice-based story creation
   */
  async processRTCInput(transcript, sessionContext = {}) {
    this.logger.info('[SmartConfig] Processing RTC input:', transcript.substring(0, 50));

    // Check for specific commands first
    const lowerTranscript = transcript.toLowerCase();

    // Interactive/CYOA detection
    if (lowerTranscript.includes('interactive') || lowerTranscript.includes('choices') ||
        lowerTranscript.includes('choose') || lowerTranscript.includes('adventure game')) {
      return {
        type: 'format_change',
        updates: { story_type: 'cyoa', cyoa_enabled: true },
        response: "I'll make this an interactive story where you get to make choices!"
      };
    }

    // Length detection
    if (lowerTranscript.includes('short') || lowerTranscript.includes('quick')) {
      return {
        type: 'length_change',
        updates: { story_length: 'short' },
        response: "I'll keep it short and sweet!"
      };
    }
    if (lowerTranscript.includes('long') || lowerTranscript.includes('epic')) {
      return {
        type: 'length_change',
        updates: { story_length: 'long' },
        response: "I'll make this an epic tale!"
      };
    }

    // Otherwise, treat as premise and interpret fully
    const result = await this.interpretPremise(transcript, sessionContext.currentConfig || {});

    if (result.success) {
      return {
        type: 'premise_interpreted',
        updates: result.suggestedConfig,
        response: this.generateRTCResponse(result),
        reasoning: result.reasoning
      };
    }

    return {
      type: 'no_changes',
      response: "I understand. Is there anything specific you'd like me to adjust?"
    };
  }

  /**
   * Generate natural language response for RTC mode
   */
  generateRTCResponse(interpretResult) {
    const config = interpretResult.suggestedConfig;
    const parts = [];

    // Genre summary
    const topGenres = Object.entries(config.genres || {})
      .filter(([, v]) => v > 40)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([g]) => g);

    if (topGenres.length > 0) {
      parts.push(`I'll set up a ${topGenres.join(' and ')} story`);
    }

    // Mood
    if (config.mood) {
      parts.push(`with a ${config.mood} atmosphere`);
    }

    // Narrator
    if (config.narrator_style) {
      parts.push(`using a ${config.narrator_style} narration style`);
    }

    if (parts.length === 0) {
      return "I've configured the story settings based on your description.";
    }

    return parts.join(' ') + '. Shall I start the story?';
  }

  /**
   * Map genre keywords to slider values (utility method)
   */
  mapGenreKeywords(text) {
    const analysis = this.analyzeKeywords(text.toLowerCase());
    return analysis.genres;
  }

  /**
   * Validate premise and return warnings/suggestions
   * @param {string} premiseText - The story premise
   * @param {object} config - Current configuration
   * @returns {object} - Validation result with warnings and suggestions
   */
  validatePremise(premiseText, config = {}) {
    const warnings = [];
    const suggestions = [];
    const text = (premiseText || '').toLowerCase();

    // Length checks
    if (!premiseText || premiseText.trim().length < 10) {
      warnings.push({
        type: 'error',
        code: 'TOO_SHORT',
        message: 'Premise is too short. Add more detail for a better story.',
        icon: '⚠️'
      });
    } else if (premiseText.trim().length < 30) {
      warnings.push({
        type: 'warning',
        code: 'SHORT_PREMISE',
        message: 'Short premise may result in a generic story. Consider adding more detail.',
        icon: '📝'
      });
    }

    // Check for character presence
    const characterIndicators = ['character', 'protagonist', 'hero', 'heroine', 'villain', 'friend', 'person', 'man', 'woman', 'boy', 'girl', 'knight', 'wizard', 'princess', 'prince', 'king', 'queen'];
    const hasCharacters = characterIndicators.some(ind => text.includes(ind));
    if (!hasCharacters && premiseText.length > 50) {
      suggestions.push({
        type: 'suggestion',
        code: 'NO_CHARACTERS',
        message: 'Consider describing your main characters for a more engaging story.',
        icon: '👤'
      });
    }

    // Check for setting/world
    const settingIndicators = ['world', 'kingdom', 'city', 'forest', 'castle', 'planet', 'village', 'land', 'realm', 'space', 'ocean', 'island', 'mountain'];
    const hasSetting = settingIndicators.some(ind => text.includes(ind));
    if (!hasSetting && premiseText.length > 50) {
      suggestions.push({
        type: 'suggestion',
        code: 'NO_SETTING',
        message: 'Adding a setting (world, city, forest, etc.) can enrich your story.',
        icon: '🌍'
      });
    }

    // Content conflict checks
    const analysis = this.analyzeKeywords(text);

    // Horror + Children conflict
    if ((analysis.genres.horror > 50 || analysis.intensity?.scary > 60) && config.audience === 'children') {
      warnings.push({
        type: 'warning',
        code: 'HORROR_CHILDREN',
        message: 'Horror/scary content detected but audience is set to Children. Consider changing audience to General or reducing intensity.',
        icon: '⚠️'
      });
    }

    // Violence + Children conflict
    if (analysis.intensity?.violence > 30 && config.audience === 'children') {
      warnings.push({
        type: 'warning',
        code: 'VIOLENCE_CHILDREN',
        message: 'Violence detected in premise but audience is set to Children. Story will be automatically toned down.',
        icon: '⚠️'
      });
    }

    // Romance + Children conflict
    if (analysis.intensity?.romance > 20 && config.audience === 'children') {
      warnings.push({
        type: 'warning',
        code: 'ROMANCE_CHILDREN',
        message: 'Romance elements detected but audience is set to Children. Consider adjusting.',
        icon: '💕'
      });
    }

    // Bedtime mode conflict with exciting content
    if (config.bedtime_mode && (analysis.intensity?.scary > 40 || analysis.intensity?.violence > 30)) {
      warnings.push({
        type: 'warning',
        code: 'BEDTIME_INTENSITY',
        message: 'Bedtime mode is enabled but premise contains intense content. Story will be calmed down automatically.',
        icon: '🌙'
      });
    }

    // Voice acting without multiple characters
    if (config.multi_voice || config.voice_acted) {
      const charCount = analysis.character_count;
      if (!charCount || charCount.estimated < 2) {
        suggestions.push({
          type: 'suggestion',
          code: 'VOICE_ACTING_FEW_CHARS',
          message: 'Voice acting works best with multiple characters. Consider describing more characters.',
          icon: '🎭'
        });
      }
    }

    // CYOA without conflict/choices
    if (config.cyoa_enabled || config.story_type === 'cyoa') {
      const conflictIndicators = ['choose', 'decision', 'path', 'choice', 'options', 'dilemma', 'crossroads'];
      const hasConflict = conflictIndicators.some(ind => text.includes(ind));
      if (!hasConflict) {
        suggestions.push({
          type: 'suggestion',
          code: 'CYOA_NO_CONFLICT',
          message: 'Interactive stories work best with decision points. Your premise can still work - choices will be generated from the narrative.',
          icon: '🔀'
        });
      }
    }

    // Check for potentially problematic content
    const sensitiveTerms = ['suicide', 'self-harm', 'abuse', 'assault', 'rape'];
    const hasSensitive = sensitiveTerms.some(term => text.includes(term));
    if (hasSensitive) {
      warnings.push({
        type: 'error',
        code: 'SENSITIVE_CONTENT',
        message: 'Premise contains sensitive topics that may not be appropriate for AI storytelling.',
        icon: '🚫'
      });
    }

    // Very long premise
    if (premiseText.length > 1000) {
      suggestions.push({
        type: 'info',
        code: 'LONG_PREMISE',
        message: 'Long premise detected. The AI will use key elements but may not include every detail.',
        icon: 'ℹ️'
      });
    }

    // Calculate overall validity
    const hasErrors = warnings.some(w => w.type === 'error');
    const warningCount = warnings.filter(w => w.type === 'warning').length;

    return {
      valid: !hasErrors,
      warnings,
      suggestions,
      summary: {
        errors: warnings.filter(w => w.type === 'error').length,
        warnings: warningCount,
        suggestions: suggestions.length
      }
    };
  }

  /**
   * Get all available config templates
   * @returns {Array} Array of template objects with id, name, icon, description
   */
  getTemplates() {
    return Object.values(CONFIG_TEMPLATES).map(t => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      description: t.description
    }));
  }

  /**
   * Get a specific template by ID
   * @param {string} templateId - Template identifier
   * @returns {object|null} Full template object or null if not found
   */
  getTemplateById(templateId) {
    return CONFIG_TEMPLATES[templateId] || null;
  }

  /**
   * Apply a template and return the full config
   * @param {string} templateId - Template identifier
   * @param {object} currentConfig - Current configuration to merge with
   * @returns {object} Merged configuration
   */
  applyTemplate(templateId, currentConfig = {}) {
    const template = CONFIG_TEMPLATES[templateId];
    if (!template) {
      return { success: false, error: `Template '${templateId}' not found` };
    }

    // Deep merge template config with current config
    const mergedConfig = {
      ...currentConfig,
      ...template.config,
      genres: { ...currentConfig.genres, ...template.config.genres },
      intensity: { ...currentConfig.intensity, ...template.config.intensity }
    };

    this.logger.info(`[SmartConfig] Applied template: ${template.name}`);

    return {
      success: true,
      config: mergedConfig,
      template: {
        id: template.id,
        name: template.name,
        icon: template.icon,
        description: template.description
      }
    };
  }
}

// Export singleton instance
export default new SmartConfigEngine();
