/**
 * Keyword-Based Configuration Analyzer (Fallback)
 *
 * Regex-based premise analysis that runs without any LLM calls.
 * Used as a fallback when OpenAI returns 429 rate-limit errors or is otherwise unavailable.
 * Produces the same output shape as configAnalyzer.analyzePremiseLLM so it's a drop-in replacement.
 */

import { SENSIBLE_DEFAULTS } from './configAnalyzer.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Genre keyword patterns (case-insensitive)
// ---------------------------------------------------------------------------
const GENRE_PATTERNS = {
  horror:    /\b(horror|scary|terrifying|haunted|ghost|demon|zombie|undead|nightmare|creep|fright|slasher|paranormal)\b/i,
  fantasy:   /\b(fantasy|magic|wizard|witch|dragon|elf|elves|dwarf|dwarves|fairy|fae|enchant|sorcerer|kingdom|quest|sword.{0,5}sorcery|mythic)\b/i,
  scifi:     /\b(sci[\s-]?fi|science.?fiction|space|alien|robot|android|cyborg|starship|galactic|planet|mars|interstellar|dystopi|cyberpunk|future|nanotech|AI\b|artificial.?intelligence)\b/i,
  mystery:   /\b(mystery|detective|whodunit|clue|sleuth|investigation|murder.?mystery|crime|solve)\b/i,
  romance:   /\b(romance|romantic|love.?story|enemies.?to.?lovers|slow.?burn|love.?interest|courtship|heart|passion(?!ate\s+fight))\b/i,
  erotica:   /\b(erotic|erotica|smut|explicit.?sex|sex.?scene|nsfw|hardcore|steamy|spicy|porn|18\+|adult.?content)\b/i,
  adventure: /\b(adventure|quest|journey|exploration|treasure|expedition|voyage|safari|pirate)\b/i,
  humor:     /\b(comedy|humor|humour|funny|hilarious|satire|parody|slapstick|comedic|farce|wit)\b/i,
  fairytale: /\b(fairy.?tale|fable|once.?upon|storybook|nursery|bedtime.?story|princess|prince)\b/i,
  literary:  /\b(literary|literary.?fiction|literary.?novel|literary.?style|literary.?prose)\b/i,
  poetry:    /\b(poem|poetry|verse|haiku|sonnet|lyric|spoken.?word)\b/i,
  ya:        /\b(young.?adult|coming.?of.?age|teen|high.?school|adolescen)\b/i,
  thriller:  /\b(thriller|suspense|tense|chase|espionage|spy|conspiracy|cat.?and.?mouse|hunt)\b/i,
};

// ---------------------------------------------------------------------------
// Mood patterns
// ---------------------------------------------------------------------------
const MOOD_PATTERNS = {
  scary:      /\b(scary|terrifying|creepy|horrifying|dread|sinister|horror|haunted)\b/i,
  exciting:   /\b(exciting|action|thrill|adrenaline|epic|intense)\b/i,
  funny:      /\b(funny|hilarious|comedy|humor|comedic|laughs)\b/i,
  mysterious: /\b(mysterious|enigma|puzzle|secret|unknown|cryptic)\b/i,
  dramatic:   /\b(dramatic|emotional|tragic|heartbreak|bittersweet)\b/i,
  calm:       /\b(calm|peaceful|soothing|gentle|relaxing|serene|cozy|cosy|bedtime)\b/i,
};

// ---------------------------------------------------------------------------
// Format patterns
// ---------------------------------------------------------------------------
const FORMAT_PATTERNS = {
  cyoa:         /\b(choose.?your.?own|CYOA|interactive|choice|branching)\b/i,
  episodic:     /\b(episod|serial|series|chapter.?by.?chapter|weekly)\b/i,
  picture_book: /\b(picture.?book|illustrated|for.?kids|toddler|preschool)\b/i,
  novella:      /\b(novella)\b/i,
  novel:        /\b(novel|full.?length|epic.?saga)\b/i,
};

// ---------------------------------------------------------------------------
// Audience patterns
// ---------------------------------------------------------------------------
const AUDIENCE_PATTERNS = {
  children:    /\b(for.?kids|for.?children|bedtime.?story|toddler|preschool|children'?s.?story)\b/i,
  young_adult: /\b(young.?adult|YA\b|teen|coming.?of.?age|high.?school)\b/i,
  mature:      /\b(mature|adult|nsfw|18\+|explicit|erotic|gore|torture|graphic.?violence)\b/i,
};

// ---------------------------------------------------------------------------
// Intensity keyword escalators (additive scores)
// ---------------------------------------------------------------------------
const INTENSITY_KEYWORDS = {
  violence:  [
    { pattern: /\b(battle|fight|combat|war|sword)\b/i, score: 35 },
    { pattern: /\b(brutal|savage|merciless|violent)\b/i, score: 55 },
    { pattern: /\b(torture|graphic.?violence|gore)\b/i, score: 70 },
  ],
  gore: [
    { pattern: /\b(blood|wound|injury)\b/i, score: 25 },
    { pattern: /\b(gore|dismember|viscera|splatter)\b/i, score: 60 },
  ],
  scary: [
    { pattern: /\b(spooky|eerie|creepy)\b/i, score: 30 },
    { pattern: /\b(horror|terrifying|nightmare)\b/i, score: 55 },
    { pattern: /\b(cosmic.?horror|lovecraft|existential.?dread)\b/i, score: 70 },
  ],
  romance: [
    { pattern: /\b(romance|love|kiss)\b/i, score: 30 },
    { pattern: /\b(passion|desire|intimate)\b/i, score: 50 },
  ],
  adultContent: [
    { pattern: /\b(erotic|sex|smut|nsfw|explicit)\b/i, score: 85 },
  ],
  sensuality: [
    { pattern: /\b(sensual|sultry|seduct|steamy)\b/i, score: 60 },
    { pattern: /\b(erotic|explicit.?sex|nsfw)\b/i, score: 90 },
  ],
  explicitness: [
    { pattern: /\b(explicit|graphic.?sex|hardcore|nsfw)\b/i, score: 85 },
  ],
  language: [
    { pattern: /\b(profan|swear|f.bomb|gritty.?dialogue)\b/i, score: 50 },
    { pattern: /\b(unrestricted.?language|vulgar)\b/i, score: 75 },
  ],
  bleakness: [
    { pattern: /\b(dark|grim|bleak)\b/i, score: 50 },
    { pattern: /\b(grimdark|nihilis|despair|hopeless)\b/i, score: 70 },
    { pattern: /\b(post.?apocalyp|dystopi)\b/i, score: 55 },
  ],
  sexualViolence: [
    { pattern: /\b(non.?con|forced|captive|slave.?girl|trafficking)\b/i, score: 40 },
  ],
};

// ---------------------------------------------------------------------------
// Narrator patterns
// ---------------------------------------------------------------------------
const NARRATOR_GENDER_HINTS = {
  masculine: /\b(barbarian|warrior|soldier|king|knight|gruff|battle.?hardened|noir|detective|he\b|his\b|hero\b)\b/i,
  feminine:  /\b(princess|queen|heroine|she\b|her\b|witch|sorceress|maiden|ballerina)\b/i,
};

// ---------------------------------------------------------------------------
// Accent detection patterns
// ---------------------------------------------------------------------------
const ACCENT_PATTERNS = {
  british:    /\b(british|london|england|english|uk\b|cockney|oxford|cambridge|dickens|pratchett|austen|monty.?python|bloke|victorian|regency|sherlock)\b/i,
  american:   /\b(american|new.?york|texas|western|cowboy|manhattan|chicago|noir|los.?angeles|hollywood|deep.?south)\b/i,
  australian: /\b(australian|outback|sydney|melbourne|mate\b|aussie)\b/i,
};

const NARRATOR_STYLE_MAP = {
  horror:    { voice_style: 'horror',     characteristics: ['deep', 'raspy'],      tone: 'dark and unsettling' },
  fantasy:   { voice_style: 'epic',       characteristics: ['deep', 'commanding'], tone: 'rich and dramatic' },
  scifi:     { voice_style: 'dramatic',   characteristics: ['authoritative'],      tone: 'clear and commanding' },
  mystery:   { voice_style: 'noir',       characteristics: ['gravelly', 'rich'],   tone: 'world-weary and cynical' },
  romance:   { voice_style: 'warm',       characteristics: ['rich', 'soothing'],   tone: 'warm and intimate' },
  erotica:   { voice_style: 'warm',       characteristics: ['silky', 'rich'],      tone: 'sultry and intimate' },
  humor:     { voice_style: 'playful',    characteristics: ['gentle'],             tone: 'light and playful' },
  fairytale: { voice_style: 'whimsical',  characteristics: ['gentle', 'soothing'], tone: 'warm and gentle' },
  thriller:  { voice_style: 'dramatic',   characteristics: ['authoritative'],      tone: 'tense and gripping' },
};

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Analyze story premise using keyword/regex matching (no LLM calls).
 * Returns the same shape as configAnalyzer.analyzePremiseLLM.
 *
 * @param {string} premiseText - The user's story premise
 * @returns {object} Analysis result compatible with LLM analyzer output
 */
export function analyzePremiseKeywords(premiseText) {
  if (!premiseText || typeof premiseText !== 'string' || premiseText.trim().length < 3) {
    return { ...SENSIBLE_DEFAULTS, llm_failed: true, llm_error: 'keyword_fallback', keyword_fallback: true };
  }

  const text = premiseText;

  // --- Genres ---
  const genres = {};
  let maxGenreScore = 0;
  let dominantGenre = 'adventure';

  for (const [genre, pattern] of Object.entries(GENRE_PATTERNS)) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    const score = matches ? Math.min(matches.length * 40, 90) : 0;
    genres[genre] = score;
    if (score > maxGenreScore) {
      maxGenreScore = score;
      dominantGenre = genre;
    }
  }

  // If nothing matched, give adventure a base score
  if (maxGenreScore === 0) {
    genres.adventure = 40;
    dominantGenre = 'adventure';
  }

  // --- Mood ---
  let mood = 'exciting';
  let bestMoodScore = 0;
  for (const [m, pattern] of Object.entries(MOOD_PATTERNS)) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    const score = matches ? matches.length : 0;
    if (score > bestMoodScore) {
      bestMoodScore = score;
      mood = m;
    }
  }

  // --- Format ---
  let format = 'short_story';
  for (const [fmt, pattern] of Object.entries(FORMAT_PATTERNS)) {
    if (pattern.test(text)) {
      format = fmt;
      break;
    }
  }

  // --- Audience ---
  let audience = 'general';
  for (const [aud, pattern] of Object.entries(AUDIENCE_PATTERNS)) {
    if (pattern.test(text)) {
      audience = aud;
      break; // Priority: children > young_adult > mature (first match wins from ordered patterns)
    }
  }

  // Force mature if erotica detected
  if (genres.erotica > 0) {
    audience = 'mature';
  }

  // --- Intensity ---
  const intensity = {
    violence: 0, gore: 0, scary: 0, romance: 0,
    adultContent: 0, sensuality: 0, explicitness: 0,
    language: 0, bleakness: 0, sexualViolence: 0,
  };

  for (const [field, rules] of Object.entries(INTENSITY_KEYWORDS)) {
    let best = 0;
    for (const { pattern, score } of rules) {
      if (pattern.test(text)) {
        best = Math.max(best, score);
      }
    }
    intensity[field] = best;
  }

  // --- Story length ---
  let story_length = 'medium';
  if (/\b(short|brief|quick|flash)\b/i.test(text)) story_length = 'short';
  if (/\b(long|epic|saga|novel|lengthy)\b/i.test(text)) story_length = 'long';

  // --- Character count ---
  const charCountMatch = text.match(/(\d+)\s*characters?/i);
  const estimatedChars = charCountMatch ? parseInt(charCountMatch[1], 10) : 3;
  const castSize = estimatedChars <= 1 ? 'solo' : estimatedChars <= 2 ? 'duo' : estimatedChars <= 5 ? 'small' : estimatedChars <= 10 ? 'medium' : 'large';

  // --- Voice acted ---
  const voice_acted = estimatedChars >= 3;

  // --- SFX ---
  const sfx_enabled = /\b(sound.?effect|sfx|audio.?drama|immersive)\b/i.test(text);

  // --- Bedtime mode ---
  const bedtime_mode = /\b(bedtime|sleep|lullaby|soothing|night.?time)\b/i.test(text);

  // --- Narrator ---
  let preferred_gender = 'neutral';
  if (NARRATOR_GENDER_HINTS.masculine.test(text)) preferred_gender = 'masculine';
  else if (NARRATOR_GENDER_HINTS.feminine.test(text)) preferred_gender = 'feminine';

  // --- Accent ---
  let preferred_accent = 'neutral';
  if (ACCENT_PATTERNS.british.test(text)) preferred_accent = 'british';
  else if (ACCENT_PATTERNS.american.test(text)) preferred_accent = 'american';
  else if (ACCENT_PATTERNS.australian.test(text)) preferred_accent = 'australian';

  const narratorMap = NARRATOR_STYLE_MAP[dominantGenre] || NARRATOR_STYLE_MAP.fantasy;

  const narrator = {
    preferred_gender,
    preferred_accent,
    voice_style: narratorMap.voice_style,
    characteristics: narratorMap.characteristics,
    tone_descriptors: narratorMap.tone,
    reasoning: `Keyword-based: dominant genre is ${dominantGenre}${preferred_accent !== 'neutral' ? `, accent: ${preferred_accent}` : ''}`,
  };

  logger.info('[KeywordAnalyzer] Keyword-based analysis complete', {
    premise: premiseText.substring(0, 60),
    dominantGenre,
    mood,
    audience,
  });

  return {
    genres,
    genres_reasoning: `Keyword match: dominant genre is ${dominantGenre}`,
    intensity,
    mood,
    mood_reasoning: `Keyword match: ${mood}`,
    format,
    format_reasoning: `Keyword match: ${format}`,
    story_length,
    audience,
    audience_reasoning: `Keyword match: ${audience}`,
    character_count: {
      estimated: estimatedChars,
      solo_duo_small_medium_large: castSize,
      reasoning: `Keyword-based estimate: ${estimatedChars} characters`,
    },
    voice_acted,
    voice_acted_reasoning: `${estimatedChars >= 3 ? 'Multiple characters detected' : 'Few characters detected'}`,
    sfx_enabled,
    sfx_level: sfx_enabled ? 'medium' : null,
    sfx_reasoning: 'Keyword-based detection',
    author_style: null,
    author_reasoning: 'Author style requires LLM analysis',
    bedtime_mode,
    bedtime_reasoning: bedtime_mode ? 'Bedtime keywords detected' : 'No bedtime indicators',
    narrator,
    // Metadata flags
    llm_failed: true,
    llm_error: 'rate_limit',
    keyword_fallback: true,
  };
}

export default { analyzePremiseKeywords };
