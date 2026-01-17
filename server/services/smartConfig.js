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
import { analyzePremiseLLM, convertLLMAnalysisToKeywordFormat, generateReasoningFromLLM } from './configAnalyzer.js';

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

// Genre keyword mappings for rule-based detection
const GENRE_KEYWORDS = {
  horror: ['horror', 'scary', 'terrifying', 'frightening', 'creepy', 'haunted', 'ghost', 'demon', 'monster', 'nightmare', 'blood', 'gore', 'zombie', 'vampire', 'werewolf', 'slasher', 'halloween', 'spooky'],
  fantasy: ['fantasy', 'magic', 'wizard', 'dragon', 'elf', 'dwarf', 'kingdom', 'quest', 'sword', 'sorcery', 'spell', 'enchanted', 'mythical', 'fairy', 'unicorn', 'castle', 'knight', 'princess', 'prince'],
  scifi: ['scifi', 'sci-fi', 'science fiction', 'space', 'alien', 'robot', 'android', 'cyborg', 'spaceship', 'galaxy', 'planet', 'future', 'dystopian', 'cyberpunk', 'laser', 'technology', 'AI', 'artificial intelligence'],
  mystery: ['mystery', 'detective', 'murder', 'crime', 'investigation', 'clue', 'suspect', 'whodunit', 'thriller', 'suspense', 'noir', 'case', 'evidence', 'spy', 'espionage', 'conspiracy', 'secret'],
  romance: ['romance', 'love', 'romantic', 'relationship', 'dating', 'wedding', 'passion', 'heart', 'kiss', 'couple', 'soulmate', 'affection', 'desire'],
  adventure: ['adventure', 'quest', 'journey', 'explore', 'expedition', 'treasure', 'hunt', 'discover', 'voyage', 'travel', 'escape', 'survival', 'action'],
  humor: ['humor', 'funny', 'comedy', 'comedic', 'hilarious', 'silly', 'joke', 'laugh', 'absurd', 'parody', 'satire', 'witty', 'whimsical'],
  fairytale: ['fairytale', 'fairy tale', 'once upon a time', 'princess', 'prince', 'enchanted', 'magical kingdom', 'happily ever after', 'fable', 'folklore', 'bedtime'],
  // P6: Added YA/Poetry/Literary genres
  literary: ['literary', 'literary fiction', 'character study', 'introspective', 'stream of consciousness', 'experimental', 'avant-garde', 'postmodern', 'surreal', 'surrealist', 'absurdist', 'dreamlike', 'kafkaesque'],
  poetry: ['poetic', 'poetry', 'lyrical', 'verse', 'prose poetry', 'metaphorical', 'symbolic', 'abstract narrative', 'lyrical prose'],
  ya: ['young adult', 'ya', 'teen', 'teenager', 'coming of age', 'high school', 'middle grade', 'tween']
};

// Intensity keyword mappings
const INTENSITY_KEYWORDS = {
  violence: ['violent', 'violence', 'battle', 'war', 'fight', 'combat', 'attack', 'kill', 'killing', 'death', 'weapon', 'sword fight', 'gun', 'explosion', 'murder', 'slaughter', 'massacre'],
  gore: ['gore', 'gory', 'blood', 'bloody', 'graphic', 'gruesome', 'dismember', 'brutal', 'visceral', 'intestines', 'decapitate', 'mutilate'],
  scary: ['scary', 'terrifying', 'frightening', 'creepy', 'haunted', 'nightmare', 'dread', 'fear', 'suspenseful', 'tense', 'eerie', 'horrifying', 'chilling'],
  romance: ['steamy', 'passionate', 'intimate', 'sensual', 'erotic', 'seductive', 'explicit', 'adult romance', 'love scene', 'sex scene', 'sexual encounter', 'making love'],
  adultContent: ['explicit', 'adult only', 'mature content', 'nsfw', '18+', 'erotic', 'sexual', 'nude', 'nudity', 'x-rated', 'sex', 'sex scene', 'hardcore', 'porn', 'pornographic', 'smut', 'xxx', 'intercourse', 'orgasm', 'foreplay', 'threesome', 'orgy']
};

// Mood keyword mappings
const MOOD_KEYWORDS = {
  calm: ['calm', 'peaceful', 'relaxing', 'soothing', 'gentle', 'serene', 'bedtime', 'cozy', 'warm', 'comforting', 'quiet'],
  exciting: ['exciting', 'action', 'thrilling', 'fast-paced', 'intense', 'adrenaline', 'energetic', 'dynamic', 'explosive'],
  scary: ['scary', 'horror', 'creepy', 'frightening', 'terrifying', 'spooky', 'eerie', 'unsettling', 'disturbing'],
  funny: ['funny', 'comedy', 'humorous', 'hilarious', 'silly', 'comedic', 'witty', 'absurd', 'lighthearted'],
  mysterious: ['mysterious', 'mystery', 'enigmatic', 'suspenseful', 'intriguing', 'secrets', 'unknown', 'noir'],
  dramatic: ['dramatic', 'emotional', 'intense', 'epic', 'powerful', 'sweeping', 'tragic', 'poignant']
};

// Format detection keywords
const FORMAT_KEYWORDS = {
  cyoa: ['interactive', 'choices', 'choose your own', 'cyoa', 'adventure game', 'branching', 'decision', 'you decide', 'multiple endings'],
  episodic: ['episodic', 'series', 'episode', 'chapter', 'serial', 'ongoing', 'anthology'],
  picture_book: ['picture book', 'illustrated', 'children\'s book', 'kids', 'young children', 'toddler', 'preschool'],
  short_story: ['short story', 'a short', 'quick story', 'brief story', 'one-shot', 'standalone', '5 minute', '10 minute', '15 minute'],
  novella: ['novella', 'medium length', 'longer story', 'medium story', '30 minute', '45 minute'],
  novel: ['novel', 'long story', 'full-length', 'epic saga', 'epic story', '60 minute', 'hour long']
};

// Story length detection keywords (P2: Expanded)
const LENGTH_KEYWORDS = {
  short: ['short', 'quick', 'brief', '5 minute', '10 minute', 'one scene', 'flash fiction', 'micro story', 'quick tale', 'mini story', 'bite-sized'],
  medium: ['medium', 'normal', '15 minute', '20 minute', 'standard', 'regular length', 'moderate length', 'typical story'],
  long: ['long', 'epic', 'extended', '30 minute', '45 minute', 'hour long', 'feature length', 'full length', 'spanning', 'multi-volume', 'several books', 'saga', 'sprawling', 'extensive', 'lengthy', 'marathon']
};

// Bedtime mode keywords - use word boundaries to avoid false positives like "hyper sleep"
const BEDTIME_KEYWORDS = ['bedtime', 'before bed', 'wind down', 'relaxing story', 'calm story', 'soothing story', 'night time story', 'good night', 'go to sleep', 'falling asleep', 'sleepy time'];

// Character count estimation patterns
const CHARACTER_COUNT_PATTERNS = {
  // Explicit numbers
  numbers: {
    pattern: /(\d+)\s*(?:characters?|people|heroes?|protagonists?|adventurers?|friends?|companions?|warriors?|members?|astronauts?|scientists?|soldiers?|sailors?|survivors?|strangers?|travelers?|explorers?|knights?|wizards?|crew\s*members?|men|women|kids|children|teens|students|agents?|detectives?|officers?|victims?)/gi,
    extract: (match) => parseInt(match[1])
  },
  // Word numbers
  wordNumbers: {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'a dozen': 12, 'several': 4, 'few': 3, 'couple': 2, 'pair': 2,
    'handful': 5, 'many': 8, 'group': 5, 'team': 5, 'party': 4
  },
  // Cast size indicators
  solo: ['lone', 'solo', 'solitary', 'single hero', 'one person', 'alone'],
  duo: ['two friends', 'two heroes', 'pair of', 'couple of', 'partners', 'duo'],
  small: ['small group', 'few friends', 'trio', 'small team', 'band of'],
  medium: ['group of', 'team of', 'party of', 'several', 'companions'],
  large: ['large group', 'army', 'many characters', 'ensemble', 'large cast', 'full cast']
};

// Multi-narrator / voice cast keywords
const MULTI_NARRATOR_KEYWORDS = [
  'multi-narrator', 'multi narrator', 'multiple narrators', 'voice cast',
  'different voices', 'multiple voices', 'voice for each', 'voices for each',
  'character voices', 'distinct voices', 'unique voices', 'full cast',
  'audio drama', 'radio play', 'dramatized', 'voiced characters'
];

// Sound effects keywords (P1: Tuned - explicit only, removed broad terms)
const SFX_KEYWORDS = [
  'sound effects', 'sfx', 'sound fx', 'audio effects', 'ambient sounds',
  'ambient audio', 'background sounds', 'environmental sounds'
];

// SFX Level detection keywords - determines low/medium/high intensity
// IMPORTANT: Keywords must be specific to avoid false positives
// "with sound effects" should NOT match - only explicit quantity phrases should
const SFX_LEVEL_KEYWORDS = {
  high: [
    // Explicit "lots" phrases - require full phrase
    'lots of sound effects', 'lots of sfx', 'lot of sound effects',
    'many sound effects', 'tons of sound effects', 'tons of sfx',
    // Immersive/quality descriptors
    'full soundscape', 'rich soundscape', 'immersive audio experience',
    'maximum immersion', 'full immersion', 'fully immersive',
    'audio drama', 'radio drama', 'cinematic audio', 'cinematic sound',
    'film-quality audio', 'movie-quality sound', 'professional audio',
    'hollywood sound', 'blockbuster audio', 'full audio experience',
    'sound design heavy', 'heavy sound design',
    'every sound effect', 'all the sound effects'
  ],
  medium: [
    // Moderate quantity phrases
    'more sound effects', 'some sound effects', 'several sound effects',
    'frequent sound effects', 'regular sound effects',
    'enhanced audio', 'better audio', 'improved sound',
    'extra sound effects', 'additional sound effects',
    'good amount of sound effects', 'decent sound effects'
  ]
  // 'low'/default: generic phrases like "with sound effects", "sound effects"
};

// Intensity boosters - words that increase intensity scores
const INTENSITY_BOOSTERS = ['really', 'very', 'extremely', 'extreme', 'super', 'incredibly', 'intensely', 'highly', 'absolutely', 'totally', 'brutal', 'graphic', 'intense', 'severe', 'heavy', 'maximum', 'full'];

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
    primary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', reason: 'Raspy voice perfect for horror and suspense' },
    secondary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly unsettling edge' },
    female: { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', reason: 'Seductive and mysterious' }
  },
  scifi: {
    primary: { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', reason: 'Authoritative delivery for sci-fi narratives' },
    secondary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly tone for space opera' },
    female: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', reason: 'Clear British voice for professional sci-fi' }
  },
  fantasy: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly Transatlantic, perfect for epic fantasy' },
    secondary: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', reason: 'Deep voice for epic tales' },
    female: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', reason: 'Pleasant British storyteller' }
  },
  mystery: {
    primary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', reason: 'Raspy American, great for mystery' },
    secondary: { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', reason: 'Deep middle-aged voice for noir' },
    female: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', reason: 'Pleasant British mystery narrator' }
  },
  adventure: {
    primary: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', reason: 'Deep voice for thrilling adventures' },
    secondary: { voice_id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', gender: 'male', reason: 'Animated warrior energy' },
    female: { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', reason: 'Upbeat and energetic' }
  },
  romance: {
    primary: { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', reason: 'Pleasant British voice for romance' },
    secondary: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', reason: 'Warm British narrator' },
    male: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', reason: 'Warm resonance for romantic tales' }
  },
  humor: {
    primary: { voice_id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', gender: 'male', reason: 'Conversational British-Essex, great for comedy' },
    secondary: { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', reason: 'Friendly Australian energy' },
    female: { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', gender: 'female', reason: 'Young playful voice' }
  },
  fairytale: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', reason: 'Warm voice perfect for children\'s stories' },
    secondary: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', reason: 'Warm British narrator for classic tales' },
    female: { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', reason: 'Soft and reassuring' }
  },
  // Genre blends - for stories with multiple strong genres
  horror_scifi: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly voice for cosmic horror and dark sci-fi' },
    secondary: { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', reason: 'Authoritative delivery for serious sci-fi horror' },
    female: { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', reason: 'Clear British voice for professional sci-fi horror' }
  },
  dark_fantasy: {
    primary: { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly voice perfect for dark fantasy and gothic tales' },
    secondary: { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', reason: 'Raspy edge for darker fantasy elements' },
    female: { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', reason: 'Mysterious and seductive for dark fantasy' }
  },
  // Mood-based fallbacks
  bedtime: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', reason: 'Warm and soothing for bedtime' },
    secondary: { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', reason: 'Soft and comforting' },
    male: { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', reason: 'Warm resonance' }
  },
  children: {
    primary: { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', reason: 'Warm American, great for children\'s stories' },
    secondary: { voice_id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', gender: 'male', reason: 'Young friendly voice' },
    female: { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', gender: 'female', reason: 'Young American, great for YA' }
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

// P0: Negation prefixes for feature detection
const NEGATION_PREFIXES = ['no ', 'not ', 'without ', "don't ", "doesn't ", 'never ', 'avoid ', 'skip ', 'disable '];

class SmartConfigEngine {
  constructor() {
    this.logger = logger;
  }

  /**
   * P0: Detect if a feature keyword is negated in text
   * Returns { detected: boolean, negated: boolean }
   * @param {string} text - Lowercased text to search
   * @param {Array} keywords - Keywords to look for
   * @param {string} featureName - Name of feature for logging
   */
  detectNegatedFeature(text, keywords, featureName) {
    for (const keyword of keywords) {
      for (const neg of NEGATION_PREFIXES) {
        if (text.includes(neg + keyword)) {
          this.logger.info(`[SmartConfig] Negation detected: "${neg}${keyword}" - disabling ${featureName}`);
          return { detected: true, negated: true };
        }
      }
      if (text.includes(keyword)) {
        return { detected: true, negated: false };
      }
    }
    return { detected: false, negated: false };
  }

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
   * @returns {object} - Suggested configuration changes
   */
  async interpretPremise(premiseText, currentConfig = {}) {
    if (!premiseText || typeof premiseText !== 'string' || premiseText.trim().length < 3) {
      return { success: false, error: 'Premise text is required' };
    }

    const text = premiseText.toLowerCase();
    this.logger.info('[SmartConfig] Interpreting premise:', premiseText.substring(0, 100));

    try {
      // P2: Primary analysis is now LLM-based via configAnalyzer
      // This replaces the 10+ fragile keyword detection systems with structured LLM analysis
      let llmAnalysis = null;

      // Always run LLM analysis for better context understanding
      // Fallback to keyword-only if LLM analysis fails
      this.logger.info('[SmartConfig] Running LLM-based analysis (replaces keyword detection)');
      llmAnalysis = await analyzePremiseLLM(premiseText);

      if (!llmAnalysis) {
        this.logger.warn('[SmartConfig] LLM analysis failed, falling back to keyword-based analysis');
      }

      // Convert LLM analysis to keywordAnalysis format for compatibility with existing config generation
      const keywordAnalysis = llmAnalysis
        ? convertLLMAnalysisToKeywordFormat(llmAnalysis)
        : this.analyzeKeywords(text);

      // Step 3: Generate config from analysis
      // P1 FIX: Pass llmAnalysis as the AI analysis parameter (was incorrectly passing null)
      // This ensures narrator moods, voice preferences, and other LLM-derived settings are used
      const suggestedConfig = this.generateConfig(keywordAnalysis, llmAnalysis, currentConfig);

      // Use LLM reasoning if available, otherwise use keyword reasoning
      const reasoning = llmAnalysis
        ? generateReasoningFromLLM(llmAnalysis)
        : this.generateReasoning(keywordAnalysis, null);

      return {
        success: true,
        analysis: {
          llm: llmAnalysis,
          fallbackKeywords: llmAnalysis ? null : keywordAnalysis  // Include keywords only if LLM failed
        },
        suggestedConfig,
        reasoning
      };
    } catch (error) {
      this.logger.error('[SmartConfig] Error interpreting premise:', error);
      // Fall back to keyword-only analysis
      const keywordAnalysis = this.analyzeKeywords(text);
      return {
        success: true,
        analysis: { fallbackKeywords: keywordAnalysis },
        suggestedConfig: this.generateConfig(keywordAnalysis, null, currentConfig),
        reasoning: this.generateReasoning(keywordAnalysis, null)
      };
    }
  }

  /**
   * Analyze premise text using keyword matching
   */
  analyzeKeywords(text) {
    const analysis = {
      genres: {},
      intensity: {},
      mood: null,
      format: null,
      story_length: null,
      bedtime_mode: false,
      audience: 'general',
      multi_narrator: false,
      multi_narrator_explicitly_disabled: false,  // P0: Negation detection flag
      sfx_enabled: false,
      sfx_explicitly_disabled: false,  // P0: Negation detection flag
      sfx_level: null,  // null = default, 'medium', 'high'
      character_count: null,  // { min: X, max: Y, estimated: Z }
      detectedKeywords: []
    };

    // Check for intensity boosters in the text
    const hasBooster = INTENSITY_BOOSTERS.some(b => text.includes(b));
    const boosterMultiplier = hasBooster ? 1.5 : 1.0;

    // Genre detection
    for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
      const matches = keywords.filter(kw => text.includes(kw));
      if (matches.length > 0) {
        // Score based on number of matches and keyword specificity
        const score = Math.min(100, 30 + (matches.length * 15));
        analysis.genres[genre] = score;
        analysis.detectedKeywords.push(...matches);
      }
    }

    // Intensity detection with booster support
    for (const [type, keywords] of Object.entries(INTENSITY_KEYWORDS)) {
      const matches = keywords.filter(kw => text.includes(kw));
      if (matches.length > 0) {
        // Higher base for explicit keywords, apply booster if present
        let score = 20 + (matches.length * 25);

        // Check if this specific intensity type has a booster nearby
        // e.g., "really violent" or "very scary"
        let boosted = false;
        for (const booster of INTENSITY_BOOSTERS) {
          if (boosted) break;
          for (const kw of matches) {
            // Direct pattern: "really scary"
            if (text.includes(`${booster} ${kw}`)) {
              score = Math.min(100, score * 1.5);
              boosted = true;
              break;
            }
            // Compound pattern: "really violent and scary" should boost scary too
            if (text.match(new RegExp(`${booster}\\s+\\w+\\s+and\\s+${kw}`))) {
              score = Math.min(100, score * 1.4);
              boosted = true;
              break;
            }
          }
        }

        analysis.intensity[type] = Math.min(100, Math.round(score));
        analysis.detectedKeywords.push(...matches);
      }
    }

    // Also detect "scary" from mood keywords for intensity
    if (!analysis.intensity.scary) {
      const scaryMoodKeywords = MOOD_KEYWORDS.scary || [];
      const scaryMatches = scaryMoodKeywords.filter(kw => text.includes(kw));
      if (scaryMatches.length > 0) {
        let score = 30 + (scaryMatches.length * 20);
        // Check for boosters - direct pattern or compound pattern like "really X and scary"
        for (const booster of INTENSITY_BOOSTERS) {
          if (scaryMatches.some(kw => text.includes(`${booster} ${kw}`))) {
            score = Math.min(100, score * 1.5);
            break;
          }
          // Also check for compound patterns: "really violent and scary"
          if (text.match(new RegExp(`${booster}\\s+\\w+\\s+and\\s+(${scaryMatches.join('|')})`))) {
            score = Math.min(100, score * 1.4);
            break;
          }
        }
        analysis.intensity.scary = Math.min(100, Math.round(score));
        analysis.detectedKeywords.push(...scaryMatches);
      }
    }

    // Mood detection
    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        analysis.mood = mood;
        break;
      }
    }

    // Format detection - check all formats and pick the best match
    for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        analysis.format = format;
        this.logger.info(`[SmartConfig] Detected format: ${format}`);
        break;
      }
    }

    // Multi-narrator detection with negation support (P0)
    const multiNarratorResult = this.detectNegatedFeature(text, MULTI_NARRATOR_KEYWORDS, 'multi_narrator');
    if (multiNarratorResult.detected) {
      if (multiNarratorResult.negated) {
        analysis.multi_narrator = false;
        analysis.multi_narrator_explicitly_disabled = true;
        analysis.detectedKeywords.push('multi-narrator-disabled');
        this.logger.info('[SmartConfig] Multi-narrator explicitly disabled by user');
      } else {
        analysis.multi_narrator = true;
        analysis.detectedKeywords.push('multi-narrator');
        this.logger.info('[SmartConfig] Detected multi-narrator request');
      }
    }

    // Sound effects detection with negation support (P0)
    const sfxResult = this.detectNegatedFeature(text, SFX_KEYWORDS, 'sfx_enabled');
    if (sfxResult.detected) {
      if (sfxResult.negated) {
        analysis.sfx_enabled = false;
        analysis.sfx_explicitly_disabled = true;
        analysis.detectedKeywords.push('sfx-disabled');
        this.logger.info('[SmartConfig] Sound effects explicitly disabled by user');
      } else {
        analysis.sfx_enabled = true;
        analysis.detectedKeywords.push('sound effects');
        this.logger.info('[SmartConfig] Detected sound effects request');
      }
    }

    // SFX Level detection - check for phrases indicating more sound effects
    // High level: "lots of sound effects", "immersive audio", "audio drama"
    // Medium level: "more sounds", "enhanced audio"
    if (SFX_LEVEL_KEYWORDS.high.some(kw => text.includes(kw))) {
      analysis.sfx_level = 'high';
      analysis.sfx_enabled = true;  // Implicitly enable SFX if asking for lots
      analysis.detectedKeywords.push('high sfx level');
      this.logger.info('[SmartConfig] Detected HIGH sfx level request');
    } else if (SFX_LEVEL_KEYWORDS.medium.some(kw => text.includes(kw))) {
      analysis.sfx_level = 'medium';
      analysis.sfx_enabled = true;  // Implicitly enable SFX if asking for more
      analysis.detectedKeywords.push('medium sfx level');
      this.logger.info('[SmartConfig] Detected MEDIUM sfx level request');
    }

    // Story length detection
    for (const [length, keywords] of Object.entries(LENGTH_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        analysis.story_length = length;
        this.logger.info(`[SmartConfig] Detected story length: ${length}`);
        break;
      }
    }

    // Bedtime mode detection
    if (BEDTIME_KEYWORDS.some(kw => text.includes(kw))) {
      analysis.bedtime_mode = true;
      analysis.audience = 'children'; // Bedtime implies child-friendly
      analysis.mood = analysis.mood || 'calm';
      this.logger.info('[SmartConfig] Detected bedtime mode');
    }

    // Character count estimation
    analysis.character_count = this.estimateCharacterCount(text);
    if (analysis.character_count) {
      this.logger.info(`[SmartConfig] Estimated character count: ${analysis.character_count.min}-${analysis.character_count.max} (est: ${analysis.character_count.estimated})`);
    }

    // Audience detection - be more aggressive about setting mature
    // Horror + Violence = mature
    // High intensity in any violent/scary category = mature
    const isViolent = (analysis.intensity.violence || 0) > 40 || (analysis.intensity.gore || 0) > 30;
    const isHorror = (analysis.genres.horror || 0) > 40;
    const isScary = (analysis.intensity.scary || 0) > 50;

    if (analysis.intensity.adultContent > 0 || analysis.intensity.gore > 50) {
      analysis.audience = 'mature';
    } else if ((isHorror && isViolent) || (isHorror && isScary) || (isViolent && isScary)) {
      // Combination of horror/violence/scary suggests mature content
      analysis.audience = 'mature';
      this.logger.info('[SmartConfig] Auto-detected mature audience from content combination');
    } else if (text.includes('for children') || text.includes('for kids') || text.includes('bedtime') ||
               text.includes('young children') || text.includes('preschool') || text.includes('toddler') ||
               text.includes('kid friendly') || text.includes('child friendly')) {
      analysis.audience = 'children';
    }

    // P3: Author preference extraction
    // Need to use original case text for proper author name detection
    const authorPreference = this.extractAuthorPreference(text);
    if (authorPreference) {
      analysis.authorPreference = authorPreference;
      analysis.detectedKeywords.push(`author:${authorPreference}`);
      this.logger.info(`[SmartConfig] Detected author preference: ${authorPreference}`);
    }

    return analysis;
  }

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

12. AUDIO FEATURES - EXTREMELY STRICT RULES:

    Defaults:
    - sfxEnabled: false
    - multiNarrator: false

    sfxEnabled: Boolean
    - TRUE only if premise contains EXACT phrases: "sound effects", "sfx", "audio effects", "ambient sounds", "ambient audio"
    - FALSE for everything else (examples that should NOT enable audio: atmospheric, cinematic, immersive, vivid, rich, detailed, dramatic)

    multiNarrator: Boolean
    - TRUE only if premise contains EXACT phrases: "multi-voice", "multiple voices", "voice cast", "different voices for", "audio drama", "radio play", "full cast", "voiced characters"
    - FALSE for everything else (examples that should NOT enable multiNarrator: multiple characters, dialogue-heavy, many speakers, conversations)

    sfxLevel: "low" | "medium" | "high" | null
    - null when sfxEnabled is false
    - "low" default when sfxEnabled is true

13. negations: Object with explicit negation flags
    {
      sfxDisabled: boolean - true if "no sound effects", "without sfx", "no audio", etc.
      multiVoiceDisabled: boolean - true if "single narrator", "no multiple voices", "one voice", etc.
      anyNegationDetected: boolean - true if ANY negation phrase found
    }

14. styleIndicators: Array of detected style keywords from the premise
    - MUST include if present: "surreal", "absurdist", "dreamlike", "kafkaesque", "poetic", "lyrical", "literary", "experimental", "abstract"
    - Empty array [] only if NONE of these styles are detected

EXAMPLES:

Example 1 - Atmospheric horror (NO audio features):
Input: "An atmospheric horror story with a mysterious setting"
Output: {
  "sfxEnabled": false,
  "multiNarrator": false,
  "storyType": "horror",
  "mood": "scary"
}
REASON: "atmospheric" describes mood, NOT audio request

Example 2 - Cinematic adventure (NO audio features):
Input: "A cinematic adventure through ancient ruins"
Output: {
  "sfxEnabled": false,
  "multiNarrator": false,
  "storyType": "adventure"
}
REASON: "cinematic" describes visual style, NOT audio request

Example 3 - Surreal poetic narrative (literary, NOT mystery):
Input: "A surreal poetic narrative exploring dreams and consciousness"
Output: {
  "genres": { "literary": 85, "poetry": 75, "fantasy": 30, "mystery": 0 },
  "mood": "surreal",
  "storyType": "literary",
  "styleIndicators": ["surreal", "poetic", "dreamlike"],
  "sfxEnabled": false,
  "multiNarrator": false
}
REASON: Surreal/poetic content = literary storyType, NOT mystery

Example 4 - Explicit audio drama request (YES audio features):
Input: "An audio drama with full voice cast and sound effects"
Output: {
  "sfxEnabled": true,
  "sfxLevel": "high",
  "multiNarrator": true
}
REASON: Explicit "audio drama", "voice cast", "sound effects" = enable audio

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
   * Generate configuration from analysis results
   * PRIORITY: AI analysis is PRIMARY for all semantic understanding
   * Keywords are SECONDARY backup only
   */
  generateConfig(keywordAnalysis, aiAnalysis, currentConfig) {
    const config = {};

    // P2 FIX: Start with EMPTY genres, not currentConfig.genres
    // This ensures Auto-Detect fully resets genres instead of merging with old values
    // The frontend will overlay these on its own defaults
    config.genres = {};

    // AI genres are PRIMARY source
    if (aiAnalysis?.genres) {
      for (const [genre, score] of Object.entries(aiAnalysis.genres)) {
        if (typeof score === 'number') {
          config.genres[genre] = Math.round(score);
        }
      }
    }

    // Apply keyword-detected genres only as fallback
    for (const [genre, score] of Object.entries(keywordAnalysis.genres)) {
      // Only add if AI didn't detect this genre AND keyword detection found something significant
      if (!config.genres[genre] && score > 40) {
        config.genres[genre] = score;
      }
    }

    // Set mood - AI takes precedence
    config.mood = aiAnalysis?.mood || keywordAnalysis.mood || currentConfig.mood || 'calm';

    // Set format - AI takes precedence for semantic understanding
    // CRITICAL FIX: Always set story_type based on format (cyoa vs narrative)
    if (aiAnalysis?.format) {
      config.story_format = aiAnalysis.format;
      if (aiAnalysis.format === 'cyoa') {
        config.story_type = 'cyoa';
        config.cyoa_enabled = true;
      } else {
        // All other formats are narrative stories
        config.story_type = 'narrative';
        config.cyoa_enabled = false;
      }
    } else if (keywordAnalysis.format) {
      config.story_format = keywordAnalysis.format;
      if (keywordAnalysis.format === 'cyoa') {
        config.story_type = 'cyoa';
        config.cyoa_enabled = true;
      } else {
        // All other formats are narrative stories
        config.story_type = 'narrative';
        config.cyoa_enabled = false;
      }
    } else {
      // No format detected - default to narrative
      config.story_type = config.story_type || 'narrative';
      config.cyoa_enabled = false;
    }

    // Set audience - if EITHER AI or keywords detect mature, use mature (safety first)
    // Also check intensity levels to auto-detect mature content
    const aiAudience = aiAnalysis?.audience;
    const keywordAudience = keywordAnalysis.audience;
    const intensityViolence = config.intensity?.violence || aiAnalysis?.intensity?.violence || keywordAnalysis.intensity?.violence || 0;
    const intensityGore = config.intensity?.gore || aiAnalysis?.intensity?.gore || keywordAnalysis.intensity?.gore || 0;
    const intensityScary = config.intensity?.scary || aiAnalysis?.intensity?.scary || keywordAnalysis.intensity?.scary || 0;
    const intensityRomance = config.intensity?.romance || aiAnalysis?.intensity?.romance || keywordAnalysis.intensity?.romance || 0;
    const intensityAdultContent = config.intensity?.adultContent || aiAnalysis?.intensity?.adultContent || keywordAnalysis.intensity?.adultContent || 0;

    // High intensity content should force mature audience
    // Include romance and adultContent for explicit sexual content detection
    const hasMatureContent = intensityViolence >= 60 || intensityGore >= 40 || intensityScary >= 70 || intensityRomance >= 70 || intensityAdultContent >= 50;

    if (aiAudience === 'mature' || keywordAudience === 'mature' || hasMatureContent) {
      config.audience = 'mature';
      this.logger.info(`[SmartConfig] Setting audience=mature (AI: ${aiAudience}, Keywords: ${keywordAudience}, Violence: ${intensityViolence}, Gore: ${intensityGore}, Scary: ${intensityScary}, Romance: ${intensityRomance}, AdultContent: ${intensityAdultContent})`);
    } else if (aiAudience === 'children' || keywordAudience === 'children') {
      config.audience = 'children';
    } else {
      config.audience = aiAudience || keywordAudience || currentConfig.audience || 'general';
    }

    // Set intensity - AI takes precedence
    config.intensity = { ...currentConfig.intensity };

    const intensitySource = aiAnalysis?.intensity || keywordAnalysis.intensity;
    if (intensitySource) {
      for (const [type, score] of Object.entries(intensitySource)) {
        if (typeof score === 'number') {
          config.intensity[type] = Math.round(score);
        }
      }
    }

    // Determine narrator style
    config.narrator_style = this.recommendNarratorStyle(
      aiAnalysis?.storyType || this.detectStoryType(keywordAnalysis),
      config
    );

    // Recommend voice based on genre, mood, audience, style, AND LLM narrator inference
    // LLM narrator recommendations are highest priority - they understand "Conan should have a gruff masculine narrator"
    const voiceRec = this.recommendVoice(config.narrator_style, {
      genres: config.genres,
      mood: config.mood,
      audience: config.audience,
      // LLM narrator inference from configAnalyzer
      narratorRecommendation: aiAnalysis?.narrator || null
    });
    if (voiceRec) {
      config.recommended_voice = voiceRec;
    }

    // Recommend author writing style
    // PRIORITY ORDER: AI-detected author > user-extracted author > style-based recommendation
    const storyType = aiAnalysis?.storyType || this.detectStoryType(keywordAnalysis);

    // Pass styleIndicators from AI to author recommendation for surreal/poetic detection
    const styleIndicators = aiAnalysis?.styleIndicators || [];
    config.detectedKeywords = [...(keywordAnalysis.detectedKeywords || []), ...styleIndicators];

    if (aiAnalysis?.authorPreference) {
      const normalized = this.normalizeAuthorName(aiAnalysis.authorPreference);
      if (normalized) {
        config.author_style = normalized;
        this.logger.info(`[SmartConfig] Using AI-detected author style: ${normalized}`);
      } else {
        config.author_style = this.recommendAuthorStyle(storyType, config);
      }
    } else if (keywordAnalysis.authorPreference) {
      config.author_style = keywordAnalysis.authorPreference;
      this.logger.info(`[SmartConfig] Using keyword-extracted author style: ${keywordAnalysis.authorPreference}`);
    } else {
      config.author_style = this.recommendAuthorStyle(storyType, config);
    }

    // =======================================================================
    // AUDIO FEATURES - LLM-BASED DETECTION IS PRIMARY (not keywords)
    // The AI prompt has STRICT rules about what enables audio features
    // =======================================================================

    // NEGATION DETECTION: AI semantic understanding is PRIMARY
    // Check AI negations FIRST before any enables
    const aiNegations = aiAnalysis?.negations || {};

    // Multi-narrator: AI negation > AI enable > keyword negation > keyword enable
    if (aiNegations.multiVoiceDisabled === true) {
      config.multi_narrator = false;
      config.multi_narrator_explicitly_disabled = true;
      this.logger.info('[SmartConfig] AI detected explicit negation: multi-voice disabled');
    } else if (keywordAnalysis.multi_narrator_explicitly_disabled) {
      config.multi_narrator = false;
      config.multi_narrator_explicitly_disabled = true;
      this.logger.info('[SmartConfig] Keywords detected multi-narrator negation');
    } else if (aiAnalysis?.multiNarrator === true) {
      // AI says ENABLE - trust it (it has strict rules)
      config.multi_narrator = true;
      this.logger.info('[SmartConfig] AI detected multi_narrator=true (explicit request found)');
    } else if (keywordAnalysis.multi_narrator) {
      config.multi_narrator = true;
      this.logger.info('[SmartConfig] Keywords detected multi_narrator=true');
    }
    // If neither AI nor keywords found multi-narrator request, it stays undefined (false)

    // SFX: AI negation > AI enable > keyword negation > keyword enable
    if (aiNegations.sfxDisabled === true) {
      config.sfx_enabled = false;
      config.sfx_explicitly_disabled = true;
      config.sfx_level = null;
      this.logger.info('[SmartConfig] AI detected explicit negation: SFX disabled');
    } else if (keywordAnalysis.sfx_explicitly_disabled) {
      config.sfx_enabled = false;
      config.sfx_explicitly_disabled = true;
      config.sfx_level = null;
      this.logger.info('[SmartConfig] Keywords detected SFX negation');
    } else if (aiAnalysis?.sfxEnabled === true) {
      // AI says ENABLE - trust it (it has strict rules that filter out "atmospheric", "cinematic", etc.)
      config.sfx_enabled = true;
      config.sfx_level = aiAnalysis.sfxLevel || 'low';
      this.logger.info(`[SmartConfig] AI detected sfx_enabled=true, level=${config.sfx_level} (explicit request found)`);
    } else if (keywordAnalysis.sfx_enabled) {
      config.sfx_enabled = true;
      config.sfx_level = keywordAnalysis.sfx_level || 'low';
      this.logger.info(`[SmartConfig] Keywords detected sfx_enabled=true, level=${config.sfx_level}`);
    }
    // If neither AI nor keywords found SFX request, it stays undefined (false)

    // Story length: AI analysis takes precedence
    if (aiAnalysis?.storyLength) {
      config.story_length = aiAnalysis.storyLength;
      this.logger.info(`[SmartConfig] AI inferred story_length=${aiAnalysis.storyLength} from context`);
    } else if (keywordAnalysis.story_length) {
      config.story_length = keywordAnalysis.story_length;
      this.logger.info(`[SmartConfig] Keywords detected story_length=${keywordAnalysis.story_length}`);
    }

    // P2: Story length fallback - infer from format if not explicitly set
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

    // Pass through bedtime mode if detected
    if (keywordAnalysis.bedtime_mode) {
      config.bedtime_mode = true;
      // Bedtime mode implies calm settings
      config.mood = 'calm';
      config.intensity = config.intensity || {};
      config.intensity.scary = Math.min(config.intensity.scary || 0, 20);
      config.intensity.violence = Math.min(config.intensity.violence || 0, 10);
      this.logger.info('[SmartConfig] Setting bedtime_mode=true with reduced intensity');
    }

    // Pass through character count estimation if detected
    if (keywordAnalysis.character_count) {
      config.character_count = keywordAnalysis.character_count;
      this.logger.info(`[SmartConfig] Setting character_count: ${keywordAnalysis.character_count.min}-${keywordAnalysis.character_count.max}`);
    }

    return config;
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

  /**
   * Estimate character count from premise text
   * Returns { min, max, estimated } or null if can't determine
   */
  estimateCharacterCount(text) {
    let explicitSum = 0;  // Sum of explicit numbers like "5 men and 5 women"
    let explicitCount = 0;
    const estimates = [];  // For vague indicators

    // Check for explicit numeric patterns: "5 men and 5 women" or "10 characters"
    // These should be SUMMED (5 men + 5 women = 10 characters)
    const numericMatches = text.matchAll(/(\d+)\s*(?:men|women|characters?|people|heroes?|protagonists?|adventurers?|friends?|companions?|warriors?|members?|players?|astronauts?|scientists?|soldiers?|sailors?|survivors?|strangers?|travelers?|explorers?|knights?|wizards?|crew\s*members?|kids|children|teens|students|agents?|detectives?|officers?|victims?)/gi);
    for (const match of numericMatches) {
      explicitSum += parseInt(match[1]);
      explicitCount++;
    }

    // Check for word number patterns: "five friends", "three heroes"
    // Word must be followed by a character-related noun (required, not optional)
    for (const [word, num] of Object.entries(CHARACTER_COUNT_PATTERNS.wordNumbers)) {
      const regex = new RegExp(`${word}\\s+(?:men|women|characters?|people|heroes?|protagonists?|adventurers?|friends?|companions?|warriors?|members?|players?|astronauts?|scientists?|soldiers?|sailors?|survivors?|strangers?|travelers?|explorers?|knights?|wizards?|crew\\s*members?|kids|children|teens|students|agents?|detectives?|officers?|victims?)\\b`, 'gi');
      if (text.match(regex)) {
        explicitSum += num;
        explicitCount++;
      }
    }

    // If we found explicit counts, use those
    if (explicitCount > 0) {
      return {
        min: explicitSum,
        max: explicitSum,
        estimated: explicitSum,
        confidence: explicitCount > 1 ? 'high' : 'medium'
      };
    }

    // Otherwise, check cast size indicators for estimates
    if (CHARACTER_COUNT_PATTERNS.solo.some(kw => text.includes(kw))) {
      estimates.push({ min: 1, max: 1 });
    }
    if (CHARACTER_COUNT_PATTERNS.duo.some(kw => text.includes(kw))) {
      estimates.push({ min: 2, max: 2 });
    }
    if (CHARACTER_COUNT_PATTERNS.small.some(kw => text.includes(kw))) {
      estimates.push({ min: 3, max: 4 });
    }
    if (CHARACTER_COUNT_PATTERNS.medium.some(kw => text.includes(kw))) {
      estimates.push({ min: 4, max: 6 });
    }
    if (CHARACTER_COUNT_PATTERNS.large.some(kw => text.includes(kw))) {
      estimates.push({ min: 8, max: 15 });
    }

    // If no estimates detected, return null
    if (estimates.length === 0) {
      return null;
    }

    // Calculate ranges from estimates
    const minVal = Math.min(...estimates.map(e => e.min));
    const maxVal = Math.max(...estimates.map(e => e.max));
    const estimated = Math.round((minVal + maxVal) / 2);

    return {
      min: minVal,
      max: maxVal,
      estimated,
      confidence: estimates.length > 1 ? 'high' : 'medium'
    };
  }

  /**
   * Detect primary story type from keyword analysis
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
      this.logger.info(`[SmartConfig] LLM Narrator Inference: gender=${narratorRecommendation.preferred_gender}, style=${narratorRecommendation.voice_style}, tone="${narratorRecommendation.tone_descriptors}"`);
      this.logger.info(`[SmartConfig] LLM Reasoning: ${narratorRecommendation.reasoning}`);

      // Map LLM characteristics to genre voice recommendations
      const llmGender = narratorRecommendation.preferred_gender; // masculine, feminine, neutral
      const llmStyle = narratorRecommendation.voice_style; // dramatic, warm, mysterious, etc.
      const llmChars = narratorRecommendation.characteristics || [];

      // Try to find a matching voice from genre recommendations based on LLM guidance
      const voiceMatch = this.findVoiceByLLMGuidance(llmGender, llmStyle, llmChars, genres);
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
   * @returns {Object|null} Voice recommendation or null
   */
  findVoiceByLLMGuidance(llmGender, llmStyle, llmChars, genres) {
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
      'gravelly': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gravelly Transatlantic voice' },
      'gruff': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Gruff commanding presence' },
      'raspy': { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', reason: 'Raspy American voice' },
      'deep': { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', reason: 'Deep resonant voice' },
      'commanding': { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', reason: 'Commanding authoritative voice' },
      'authoritative': { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', reason: 'Authoritative narrator' },
      'warm': { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', reason: 'Warm nurturing voice' },
      'gentle': { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', reason: 'Soft and reassuring' },
      'soothing': { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', reason: 'Warm soothing voice' },
      'rich': { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', reason: 'Rich resonant baritone' },
      'silky': { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', reason: 'Silky mysterious voice' },
      'seductive': { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', reason: 'Seductive and mysterious' }
    };

    // First, check for characteristic matches (highest priority - most specific)
    if (llmChars && llmChars.length > 0) {
      for (const char of llmChars) {
        const charLower = char.toLowerCase();
        if (charToVoice[charLower]) {
          const voice = charToVoice[charLower];
          // Verify gender preference matches (masculine->male, feminine->female)
          const genderMatch =
            llmGender === 'neutral' ||
            (llmGender === 'masculine' && voice.gender === 'male') ||
            (llmGender === 'feminine' && voice.gender === 'female');

          if (genderMatch) {
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
      // Select based on LLM gender preference
      if (llmGender === 'feminine' && genreVoices.female) {
        return genreVoices.female;
      } else if (llmGender === 'masculine') {
        return genreVoices.primary || genreVoices.secondary;
      } else {
        // Neutral - use genre default
        return genreVoices.primary;
      }
    }

    // Third, fall back to genre from config
    const dominantGenre = Object.entries(genres || {})
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (dominantGenre && GENRE_VOICE_RECOMMENDATIONS[dominantGenre]) {
      const dg = GENRE_VOICE_RECOMMENDATIONS[dominantGenre];
      if (llmGender === 'feminine' && dg.female) {
        return dg.female;
      }
      return dg.primary;
    }

    return null;
  }

  /**
   * Generate human-readable reasoning for the configuration choices
   */
  generateReasoning(keywordAnalysis, aiAnalysis) {
    const reasons = [];

    // Detected keywords
    if (keywordAnalysis.detectedKeywords.length > 0) {
      const uniqueKeywords = [...new Set(keywordAnalysis.detectedKeywords)].slice(0, 5);
      reasons.push(`Detected keywords: ${uniqueKeywords.join(', ')}`);
    }

    // Genre reasoning
    const topGenres = Object.entries(keywordAnalysis.genres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g);
    if (topGenres.length > 0) {
      reasons.push(`Primary genres: ${topGenres.join(', ')}`);
    }

    // Mood reasoning
    if (keywordAnalysis.mood) {
      reasons.push(`Story mood: ${keywordAnalysis.mood}`);
    }

    // Audience reasoning
    if (keywordAnalysis.audience !== 'general') {
      reasons.push(`Audience level: ${keywordAnalysis.audience}`);
    }

    // AI insights
    if (aiAnalysis?.themes) {
      reasons.push(`Themes: ${aiAnalysis.themes.join(', ')}`);
    }

    return reasons;
  }

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

    // Multi-narrator without multiple characters
    if (config.multi_voice || config.multi_narrator) {
      const charCount = analysis.character_count;
      if (!charCount || charCount.estimated < 2) {
        suggestions.push({
          type: 'suggestion',
          code: 'MULTI_VOICE_FEW_CHARS',
          message: 'Multi-voice narration works best with multiple characters. Consider describing more characters.',
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
