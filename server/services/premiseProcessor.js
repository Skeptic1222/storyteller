/**
 * Multi-Pass Premise Processor
 *
 * Replaces single-pass LLM analysis with a multi-pass extraction architecture
 * that better captures nuanced requirements from complex premises.
 *
 * Architecture:
 * - Pass 0: Premise Normalization (conditional, for long premises)
 * - Pass 1: Style & Tone Extraction (parallel)
 * - Pass 2: Content & Genre Extraction (parallel)
 * - Pass 3: Intensity & Audience Extraction (parallel)
 * - Pass 4: Synthesis & Validation
 *
 * This addresses issues with:
 * - Detail loss in long/complex prompts (e.g., 3500 char British comedy losing British aspect)
 * - JSON truncation
 * - Subtle requirements getting lost (author style, humor type, narrative voice)
 * - No cross-validation between related fields
 */

import { completion, parseJsonResponse } from './openai.js';
import logger from '../utils/logger.js';
import { AUTHOR_STYLES } from './authorStyles.js';
import { SENSIBLE_DEFAULTS } from './configAnalyzer.js';

// Thresholds for multi-pass processing
const LONG_PREMISE_THRESHOLD = 1500;
const COMPLEX_PREMISE_THRESHOLD = 800;

/**
 * Build a condensed author style catalog for LLM reference
 */
function buildAuthorStyleCatalog() {
  const entries = [];

  for (const [id, author] of Object.entries(AUTHOR_STYLES)) {
    const genres = Array.isArray(author?.genres) ? author.genres.join(', ') : '';
    const knownFor = Array.isArray(author?.knownFor) && author.knownFor.length
      ? `Known for: ${author.knownFor.slice(0, 3).join('; ')}`
      : '';

    const line = `- ${id}: ${author?.name || id}`;
    const details = [genres, knownFor].filter(Boolean).join(' | ');

    entries.push(details ? `${line} (${details})` : line);
  }

  return entries.join('\n');
}

// ============================================================================
// PASS 0: PREMISE NORMALIZATION
// ============================================================================

/**
 * Pass 0: Normalize long premises into structured intent manifest
 * Only triggered for premises > 1500 chars or with Story Bible data
 *
 * @param {string} premise - Raw user premise
 * @param {object} storyBibleData - Optional Story Bible context
 * @returns {object} Structured intent manifest
 */
async function normalizePremise(premise, storyBibleData = null) {
  logger.info('[PremiseProcessor] Pass 0: Normalizing premise', {
    premiseLength: premise.length,
    hasStoryBible: !!storyBibleData
  });

  const storyBibleContext = storyBibleData
    ? `\n\nSTORY BIBLE CONTEXT:\n${JSON.stringify(storyBibleData, null, 2)}`
    : '';

  const prompt = `You are a premise analyzer. Extract the key aspects from this story premise into a structured format.

STORY PREMISE:
"${premise}"${storyBibleContext}

Extract and return JSON with these fields:
{
  "core_concept": "2-3 sentence summary of the core story idea",
  "style_requirements": ["list of explicit style requirements like 'British humor', 'dry wit', 'Terry Pratchett style'"],
  "content_elements": ["list of key content elements like 'post-apocalyptic', 'family dynamics', 'cannibalism theme'"],
  "tone_descriptors": ["list of tone words like 'bleak', 'darkly funny', 'satirical', 'dry'"],
  "explicit_constraints": ["list of explicit constraints like '2000-4000 words', 'short story format', 'no romance'"],
  "key_characters": ["list of mentioned or implied characters"],
  "setting": "brief setting description",
  "cultural_context": "any cultural context like 'British', 'American', 'Japanese' or null"
}

CRITICAL INSTRUCTIONS:
1. PRESERVE all style indicators - if the premise says "British comedy" or "Terry Pratchett style", these MUST appear in style_requirements
2. PRESERVE tone - "dry wit", "darkly funny", "satirical" etc. go in tone_descriptors
3. Cultural markers like "British", "American" are important for voice selection
4. Don't interpret or modify - extract what's explicitly or strongly implied
5. If the premise mentions word counts or formats, capture in explicit_constraints

Return ONLY valid JSON, no markdown.`;

  try {
    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
      agent_name: 'PremiseNormalizer'
    });

    const manifest = parseJsonResponse(response.content);

    if (!manifest) {
      logger.warn('[PremiseProcessor] Pass 0 failed to parse, returning original premise');
      return { core_concept: premise, normalized: false };
    }

    logger.info('[PremiseProcessor] Pass 0 complete', {
      coreConceptLength: manifest.core_concept?.length,
      styleRequirements: manifest.style_requirements?.length || 0,
      culturalContext: manifest.cultural_context
    });

    return { ...manifest, normalized: true };
  } catch (error) {
    logger.error('[PremiseProcessor] Pass 0 error:', error.message);
    return { core_concept: premise, normalized: false, error: error.message };
  }
}

// ============================================================================
// PASS 1: STYLE & TONE EXTRACTION
// ============================================================================

/**
 * Pass 1: Extract writing style, author influence, and narrator voice
 * Runs in parallel with Pass 2 and Pass 3
 *
 * @param {object|string} normalizedPremise - Intent manifest or raw premise
 * @param {string} originalPremise - Original user premise for reference
 * @returns {object} Style extraction results
 */
async function extractStyle(normalizedPremise, originalPremise) {
  logger.info('[PremiseProcessor] Pass 1: Extracting style and tone');

  const authorCatalog = buildAuthorStyleCatalog();

  // Build context from normalized premise or use raw
  const premiseContext = typeof normalizedPremise === 'object' && normalizedPremise.normalized
    ? `EXTRACTED STYLE REQUIREMENTS: ${JSON.stringify(normalizedPremise.style_requirements || [])}
EXTRACTED TONE DESCRIPTORS: ${JSON.stringify(normalizedPremise.tone_descriptors || [])}
CULTURAL CONTEXT: ${normalizedPremise.cultural_context || 'not specified'}
CORE CONCEPT: ${normalizedPremise.core_concept}`
    : `PREMISE: ${originalPremise}`;

  const prompt = `You are a style analyst. Analyze this story premise and extract style/tone configuration.

${premiseContext}

ORIGINAL PREMISE (for reference):
"${originalPremise}"

AUTHOR STYLE CATALOG (use id values only):
${authorCatalog}

Return JSON with ONLY these fields:
{
  "author_style": "author_id_from_catalog or null",
  "author_confidence": 0-100,
  "author_reasoning": "Why this author style matches",
  "humor_type": "british_dry_wit|american_slapstick|dark_comedy|satire|absurdist|none",
  "cultural_flavor": "british|american|european|asian|neutral",
  "narrator": {
    "preferred_gender": "masculine|feminine|neutral",
    "voice_style": "wry|dramatic|warm|mysterious|playful|epic|horror|noir|whimsical|calm",
    "tone_descriptors": "2-3 word description like 'dry, sardonic' or 'warm, gentle'",
    "characteristics": ["list of voice characteristics like 'understated', 'ironic', 'observational'"]
  },
  "writing_voice": "first_person|third_person_limited|omniscient_narrator|second_person"
}

CRITICAL STYLE DETECTION RULES:

1. BRITISH STYLE MARKERS:
   - Words: "British", "UK", "England", "London", "pub", "queue", "bloody", "bollocks"
   - Authors: Terry Pratchett, Douglas Adams, P.G. Wodehouse, Neil Gaiman (British works)
   - Humor: "dry wit", "deadpan", "understatement", "absurdist"
   - If ANY British markers → cultural_flavor = "british", humor_type = "british_dry_wit"

2. AUTHOR MATCHING:
   - "Terry Pratchett", "Discworld", "satirical fantasy" → author_style = "pratchett"
   - "Stephen King", "horror", "Maine" → author_style = "king"
   - Dark comedy + British + fantasy → strongly consider "pratchett"
   - Dark comedy + American + horror → strongly consider "king" or "vonnegut"

3. NARRATOR INFERENCE:
   - British dry comedy → narrator.voice_style = "wry", tone = "dry, sardonic, deadpan"
   - Epic fantasy → narrator.voice_style = "epic", tone = "commanding, resonant"
   - Horror → narrator.voice_style = "horror" or "mysterious"
   - Cozy/bedtime → narrator.voice_style = "warm" or "calm"

4. HUMOR TYPE DETECTION:
   - "dry wit", "deadpan", "understatement" → british_dry_wit
   - "slapstick", "physical comedy", "over the top" → american_slapstick
   - "dark humor", "gallows humor", "morbid jokes" → dark_comedy
   - "satirical", "social commentary" → satire
   - "absurd", "surreal", "Monty Python" → absurdist

Return ONLY valid JSON, no markdown.`;

  try {
    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1500,
      agent_name: 'StyleExtractor'
    });

    const styleResult = parseJsonResponse(response.content);

    if (!styleResult) {
      logger.warn('[PremiseProcessor] Pass 1 failed to parse');
      return { pass1_failed: true };
    }

    logger.info('[PremiseProcessor] Pass 1 complete', {
      author_style: styleResult.author_style,
      author_confidence: styleResult.author_confidence,
      humor_type: styleResult.humor_type,
      cultural_flavor: styleResult.cultural_flavor
    });

    return styleResult;
  } catch (error) {
    logger.error('[PremiseProcessor] Pass 1 error:', error.message);
    return { pass1_failed: true, error: error.message };
  }
}

// ============================================================================
// PASS 2: CONTENT & GENRE EXTRACTION
// ============================================================================

/**
 * Pass 2: Extract genres, format, themes, and content elements
 * Runs in parallel with Pass 1 and Pass 3
 *
 * @param {object|string} normalizedPremise - Intent manifest or raw premise
 * @param {string} originalPremise - Original user premise for reference
 * @returns {object} Content extraction results
 */
async function extractContent(normalizedPremise, originalPremise) {
  logger.info('[PremiseProcessor] Pass 2: Extracting content and genres');

  const premiseContext = typeof normalizedPremise === 'object' && normalizedPremise.normalized
    ? `CONTENT ELEMENTS: ${JSON.stringify(normalizedPremise.content_elements || [])}
EXPLICIT CONSTRAINTS: ${JSON.stringify(normalizedPremise.explicit_constraints || [])}
SETTING: ${normalizedPremise.setting || 'not specified'}
CORE CONCEPT: ${normalizedPremise.core_concept}`
    : `PREMISE: ${originalPremise}`;

  const prompt = `You are a content analyst. Analyze this story premise and extract genre/content configuration.

${premiseContext}

ORIGINAL PREMISE (for reference):
"${originalPremise}"

Return JSON with ONLY these fields:
{
  "genres": {
    "horror": 0-100,
    "fantasy": 0-100,
    "scifi": 0-100,
    "mystery": 0-100,
    "romance": 0-100,
    "erotica": 0-100,
    "adventure": 0-100,
    "humor": 0-100,
    "fairytale": 0-100,
    "literary": 0-100,
    "poetry": 0-100,
    "ya": 0-100,
    "thriller": 0-100
  },
  "genres_reasoning": "Explain genre score decisions",
  "mood": "calm|exciting|scary|funny|mysterious|dramatic|surreal|poetic",
  "format": "cyoa|episodic|picture_book|short_story|novella|novel",
  "story_length": "short|medium|long",
  "themes": ["array", "of", "thematic", "elements"],
  "setting_type": "post_apocalyptic|urban|fantasy_realm|space|historical|contemporary|surreal"
}

GENRE SCORING RULES:

1. HUMOR GENRE (CRITICAL):
   - "comedy", "funny", "humor", "comedic" → humor: 60+
   - "dark comedy", "black humor" → humor: 70+, horror: 30-50
   - "satire", "satirical" → humor: 70+
   - British dry wit + any genre → humor: 60+ (British comedy is inherently humorous)
   - "Terry Pratchett style" → humor: 80+ (he's primarily a comedic writer)

2. HORROR + HUMOR COMBO (Dark Comedy):
   - If BOTH horror themes AND humor/comedy → BOTH get high scores
   - Dark comedy about death/apocalypse → horror: 50-70, humor: 70-85
   - Comedic horror → horror: 60+, humor: 60+

3. FORMAT DETECTION:
   - Word count mentioned (e.g., "2000-4000 words") → short_story
   - "short story" mentioned → short_story
   - "choose your own adventure", "interactive" → cyoa
   - "episodes", "serial" → episodic
   - "for children", "picture book" → picture_book
   - "novella" or 15000-40000 words → novella
   - "novel" or 40000+ words → novel

4. MOOD VS GENRE:
   - Dark content with humor → mood = "funny" (the humor treatment defines mood)
   - Horror without humor → mood = "scary" or "mysterious"
   - Light adventure → mood = "exciting"

Return ONLY valid JSON, no markdown.`;

  try {
    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1500,
      agent_name: 'ContentExtractor'
    });

    const contentResult = parseJsonResponse(response.content);

    if (!contentResult) {
      logger.warn('[PremiseProcessor] Pass 2 failed to parse');
      return { pass2_failed: true };
    }

    // Log top genres
    const topGenres = Object.entries(contentResult.genres || {})
      .filter(([_, score]) => score > 30)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g, s]) => `${g}:${s}`);

    logger.info('[PremiseProcessor] Pass 2 complete', {
      topGenres: topGenres.join(', '),
      mood: contentResult.mood,
      format: contentResult.format
    });

    return contentResult;
  } catch (error) {
    logger.error('[PremiseProcessor] Pass 2 error:', error.message);
    return { pass2_failed: true, error: error.message };
  }
}

// ============================================================================
// PASS 3: INTENSITY & AUDIENCE EXTRACTION
// ============================================================================

/**
 * Pass 3: Extract content intensity levels and audience targeting
 * Runs in parallel with Pass 1 and Pass 2
 *
 * @param {object|string} normalizedPremise - Intent manifest or raw premise
 * @param {string} originalPremise - Original user premise for reference
 * @returns {object} Intensity extraction results
 */
async function extractIntensity(normalizedPremise, originalPremise) {
  logger.info('[PremiseProcessor] Pass 3: Extracting intensity and audience');

  const premiseContext = typeof normalizedPremise === 'object' && normalizedPremise.normalized
    ? `TONE DESCRIPTORS: ${JSON.stringify(normalizedPremise.tone_descriptors || [])}
CONTENT ELEMENTS: ${JSON.stringify(normalizedPremise.content_elements || [])}
EXPLICIT CONSTRAINTS: ${JSON.stringify(normalizedPremise.explicit_constraints || [])}
CORE CONCEPT: ${normalizedPremise.core_concept}`
    : `PREMISE: ${originalPremise}`;

  const prompt = `You are a content intensity analyst. Analyze this story premise and extract intensity/audience configuration.

${premiseContext}

ORIGINAL PREMISE (for reference):
"${originalPremise}"

Return JSON with ONLY these fields:
{
  "intensity": {
    "violence": 0-100,
    "gore": 0-100,
    "scary": 0-100,
    "romance": 0-100,
    "adultContent": 0-100,
    "sensuality": 0-100,
    "explicitness": 0-100,
    "language": 0-100,
    "bleakness": 0-100,
    "sexualViolence": 0-100,
    "reasoning": "Justify intensity levels based on premise"
  },
  "audience": "children|young_adult|general|mature",
  "audience_reasoning": "Why this audience level",
  "bedtime_mode": true|false,
  "character_count": {
    "estimated": number,
    "category": "solo|duo|small|medium|large"
  },
  "voice_acted": true|false,
  "sfx_enabled": true|false,
  "sfx_level": "low|medium|high|null"
}

INTENSITY TIER GUIDE:

VIOLENCE (calibrate carefully):
- 0-20%: Family-friendly action (pillow fights, cartoon antics)
- 20-40%: PG-13 combat (sword fights, no blood)
- 40-60%: Intense action (graphic fights, visible injuries)
- 60-80%: R-rated violence (torture, brutal combat)
- 80-100%: Extreme violence (war crimes, unflinching brutality)

GORE:
- 0-30%: No/light blood (Disney level)
- 30-50%: Visible wounds (Game of Thrones TV)
- 50-70%: Body horror, dismemberment
- 70-100%: Extreme gore (Saw, splatter)

BLEAKNESS (IMPORTANT for dark comedy):
- 0-25%: Hope always wins, happy endings
- 25-50%: Bittersweet, some tragedy
- 50-75%: Dark themes, pyrrhic victories
- 75-100%: Grimdark, nihilistic

LANGUAGE:
- 0-20%: G-rated (no profanity)
- 20-40%: PG (damn, hell)
- 40-60%: PG-13 (occasional F-word)
- 60-80%: R-rated (frequent strong language)
- 80-100%: Unrestricted

AUDIENCE RULES:
- "children" - ONLY for explicit children's content (bedtime story, picture book for kids)
- "young_adult" - Teen-focused, coming-of-age, no explicit content
- "general" - DEFAULT for most stories
- "mature" - REQUIRED if violence > 60, gore > 40, scary > 70, any sexual content, explicit language

DARK COMEDY HANDLING:
- Dark themes (death, apocalypse, cannibalism) treated with HUMOR → bleakness can be high but audience may still be "general" or "mature" depending on graphic detail
- Comedic treatment REDUCES effective intensity for audience purposes
- A "darkly funny" cannibalism dinner party → bleakness: 70-80, but violence might only be 30-40 if not graphically described

AUDIO FEATURES (STRICT):
- sfx_enabled: TRUE only if "sound effects", "sfx", "audio effects" explicitly mentioned
- voice_acted: TRUE only if "multiple voices", "full cast", "audio drama", "voice acting", "character voices" explicitly mentioned
  NOTE: This is about VOICE ACTING for dialogue, NOT narrative POV. A first-person story CAN have voice acting for other characters.
- Default both to false unless explicitly requested

Return ONLY valid JSON, no markdown.`;

  try {
    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 1500,
      agent_name: 'IntensityExtractor'
    });

    const intensityResult = parseJsonResponse(response.content);

    if (!intensityResult) {
      logger.warn('[PremiseProcessor] Pass 3 failed to parse');
      return { pass3_failed: true };
    }

    logger.info('[PremiseProcessor] Pass 3 complete', {
      audience: intensityResult.audience,
      violence: intensityResult.intensity?.violence,
      bleakness: intensityResult.intensity?.bleakness,
      voice_acted: intensityResult.voice_acted
    });

    return intensityResult;
  } catch (error) {
    logger.error('[PremiseProcessor] Pass 3 error:', error.message);
    return { pass3_failed: true, error: error.message };
  }
}

// ============================================================================
// PASS 4: SYNTHESIS & VALIDATION
// ============================================================================

/**
 * Pass 4: Synthesize all pass results, cross-validate, and resolve conflicts
 *
 * @param {object} passResults - Results from all passes
 * @param {string[]} errors - Any errors from previous passes
 * @returns {object} Final synthesized configuration
 */
async function synthesizeConfig(passResults, errors = []) {
  const { style, content, intensity, originalPremise, intentManifest } = passResults;

  logger.info('[PremiseProcessor] Pass 4: Synthesizing configuration', {
    hasStyle: !!style && !style.pass1_failed,
    hasContent: !!content && !content.pass2_failed,
    hasIntensity: !!intensity && !intensity.pass3_failed,
    errorCount: errors.length
  });

  // Start with sensible defaults
  const config = { ...SENSIBLE_DEFAULTS };

  // Merge style results (Pass 1)
  if (style && !style.pass1_failed) {
    if (style.author_style) config.author_style = style.author_style;
    if (style.humor_type) config.humor_type = style.humor_type;
    if (style.cultural_flavor) config.cultural_flavor = style.cultural_flavor;
    if (style.narrator) config.narrator = { ...config.narrator, ...style.narrator };
    if (style.writing_voice) config.writing_voice = style.writing_voice;
    config.author_confidence = style.author_confidence || 0;
    config.author_reasoning = style.author_reasoning || '';
  }

  // Merge content results (Pass 2)
  if (content && !content.pass2_failed) {
    if (content.genres) config.genres = content.genres;
    if (content.mood) config.mood = content.mood;
    if (content.format) config.format = content.format;
    if (content.story_length) config.story_length = content.story_length;
    if (content.themes) config.themes = content.themes;
    if (content.setting_type) config.setting_type = content.setting_type;
    config.genres_reasoning = content.genres_reasoning || '';
  }

  // Merge intensity results (Pass 3)
  if (intensity && !intensity.pass3_failed) {
    if (intensity.intensity) config.intensity = intensity.intensity;
    if (intensity.audience) config.audience = intensity.audience;
    if (intensity.bedtime_mode !== undefined) config.bedtime_mode = intensity.bedtime_mode;
    if (intensity.character_count) config.character_count = intensity.character_count;
    if (intensity.voice_acted !== undefined) {
      config.voice_acted = intensity.voice_acted;
      config.multi_narrator = intensity.voice_acted; // Backward compatibility
    }
    if (intensity.sfx_enabled !== undefined) config.sfx_enabled = intensity.sfx_enabled;
    if (intensity.sfx_level !== undefined) config.sfx_level = intensity.sfx_level;
    config.audience_reasoning = intensity.audience_reasoning || '';
  }

  // =========================================================================
  // CROSS-VALIDATION RULES
  // =========================================================================

  // Rule 1: If author_style is a comedic author, ensure humor genre is high enough
  const comedyAuthors = ['pratchett', 'vonnegut', 'wilde', 'twain', 'adams'];
  if (comedyAuthors.includes(config.author_style)) {
    if (!config.genres.humor || config.genres.humor < 60) {
      logger.info(`[PremiseProcessor] Cross-validation: Boosting humor for ${config.author_style} style`);
      config.genres.humor = Math.max(config.genres.humor || 0, 70);
    }
  }

  // Rule 2: If cultural_flavor is British with humor, ensure british_dry_wit
  if (config.cultural_flavor === 'british' && config.genres.humor > 40) {
    if (!config.humor_type || config.humor_type === 'none') {
      logger.info('[PremiseProcessor] Cross-validation: Setting british_dry_wit for British comedy');
      config.humor_type = 'british_dry_wit';
    }
  }

  // Rule 3: If British comedy, adjust narrator tone
  if (config.cultural_flavor === 'british' && config.humor_type === 'british_dry_wit') {
    if (config.narrator && !config.narrator.tone_descriptors?.includes('dry')) {
      logger.info('[PremiseProcessor] Cross-validation: Adjusting narrator for British dry wit');
      config.narrator.voice_style = config.narrator.voice_style || 'wry';
      config.narrator.tone_descriptors = 'dry, sardonic, deadpan';
      config.narrator.characteristics = config.narrator.characteristics || [];
      if (!config.narrator.characteristics.includes('understated')) {
        config.narrator.characteristics.push('understated', 'ironic');
      }
    }
  }

  // Rule 4: High bleakness + high humor = dark comedy classification
  if (config.intensity?.bleakness > 60 && config.genres?.humor > 50) {
    logger.info('[PremiseProcessor] Cross-validation: Classifying as dark comedy');
    config.story_classification = 'dark_comedy';
    // Dark comedy can still be general/mature audience
    if (!config.audience || config.audience === 'children') {
      config.audience = 'mature';
    }
  }

  // Rule 5: Ensure audience matches intensity levels
  const v = config.intensity?.violence || 0;
  const g = config.intensity?.gore || 0;
  const s = config.intensity?.scary || 0;
  const ac = config.intensity?.adultContent || 0;

  if (v > 60 || g > 40 || s > 70 || ac > 30) {
    if (config.audience !== 'mature') {
      logger.info('[PremiseProcessor] Cross-validation: Upgrading to mature audience due to intensity');
      config.audience = 'mature';
    }
  }

  // Rule 6: If horror author, ensure horror genre presence
  const horrorAuthors = ['king', 'lovecraft', 'poe'];
  if (horrorAuthors.includes(config.author_style)) {
    if (!config.genres.horror || config.genres.horror < 40) {
      logger.info(`[PremiseProcessor] Cross-validation: Adding horror for ${config.author_style} style`);
      config.genres.horror = Math.max(config.genres.horror || 0, 50);
    }
  }

  // Rule 7: Preserve intent manifest data for downstream use
  if (intentManifest && intentManifest.normalized) {
    config._intentManifest = intentManifest;
  }

  // Mark as multi-pass processed
  config._multiPassProcessed = true;
  config._passErrors = errors;

  logger.info('[PremiseProcessor] Pass 4 complete - Final config', {
    author_style: config.author_style,
    humor_type: config.humor_type,
    cultural_flavor: config.cultural_flavor,
    topGenres: Object.entries(config.genres || {})
      .filter(([_, s]) => s > 30)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g, s]) => `${g}:${s}`)
      .join(', '),
    audience: config.audience,
    mood: config.mood
  });

  return config;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Check if premise has complex requirements that benefit from multi-pass
 * @param {string} premise - User's story premise
 * @returns {boolean} True if complex processing recommended
 */
function hasComplexRequirements(premise) {
  const complexIndicators = [
    // Author style mentions
    /style of|in the manner of|like \w+ writes|inspired by|channeling/i,
    // Cultural/regional markers
    /british|american|japanese|french|german|australian/i,
    // Specific humor types
    /dark comedy|dry wit|satirical|absurdist|gallows humor|black humor/i,
    // Word count specifications
    /\d{1,4}[-–]\d{1,4}\s*words/i,
    // Explicit tone requirements
    /tone should|narration style|voice should|narrator should/i,
    // Multiple genre combinations
    /horror.*comedy|comedy.*horror|dark.*funny|funny.*dark/i,
    // Explicit author names (partial list)
    /pratchett|tolkien|king|lovecraft|gaiman|austen|hemingway/i,
    // Complex narrative requirements
    /unreliable narrator|multiple perspectives|epistolary|stream of consciousness/i
  ];

  return complexIndicators.some(p => p.test(premise));
}

/**
 * Main entry point for multi-pass premise analysis
 *
 * @param {string} premise - User's story premise
 * @param {object} storyBibleData - Optional Story Bible context
 * @returns {object} Final configuration
 */
export async function multiPassAnalyze(premise, storyBibleData = null) {
  logger.info('[PremiseProcessor] Starting multi-pass analysis', {
    premiseLength: premise.length,
    hasStoryBible: !!storyBibleData
  });

  const startTime = Date.now();

  // Step 1: Normalize if needed (Pass 0)
  let normalizedPremise = premise;
  let intentManifest = null;

  if (premise.length > LONG_PREMISE_THRESHOLD || storyBibleData) {
    intentManifest = await normalizePremise(premise, storyBibleData);
    normalizedPremise = intentManifest;
    logger.info('[PremiseProcessor] Premise normalized', {
      normalized: intentManifest.normalized,
      styleRequirementsCount: intentManifest.style_requirements?.length || 0
    });
  }

  // Step 2: Run parallel extraction passes
  const results = { style: null, content: null, intensity: null };
  const errors = [];

  const passes = await Promise.allSettled([
    extractStyle(normalizedPremise, premise).then(r => { results.style = r; return r; }),
    extractContent(normalizedPremise, premise).then(r => { results.content = r; return r; }),
    extractIntensity(normalizedPremise, premise).then(r => { results.intensity = r; return r; })
  ]);

  // Collect errors but continue
  passes.forEach((p, i) => {
    if (p.status === 'rejected') {
      const passNames = ['Style', 'Content', 'Intensity'];
      errors.push({ pass: passNames[i], error: p.reason?.message || p.reason });
      logger.warn(`[PremiseProcessor] Pass ${i + 1} (${passNames[i]}) failed:`, p.reason);
    }
  });

  // Check if all passes failed - fall back to single-pass
  const allFailed =
    (results.style?.pass1_failed || !results.style) &&
    (results.content?.pass2_failed || !results.content) &&
    (results.intensity?.pass3_failed || !results.intensity);

  if (allFailed) {
    logger.warn('[PremiseProcessor] All passes failed, returning sensible defaults');
    return {
      ...SENSIBLE_DEFAULTS,
      _multiPassFailed: true,
      _errors: errors
    };
  }

  // Step 3: Synthesize and validate (Pass 4)
  const finalConfig = await synthesizeConfig({
    style: results.style,
    content: results.content,
    intensity: results.intensity,
    originalPremise: premise,
    intentManifest
  }, errors);

  const elapsed = Date.now() - startTime;
  logger.info(`[PremiseProcessor] Multi-pass analysis complete in ${elapsed}ms`);

  return finalConfig;
}

// Export individual functions for testing
export {
  normalizePremise,
  extractStyle,
  extractContent,
  extractIntensity,
  synthesizeConfig,
  hasComplexRequirements,
  LONG_PREMISE_THRESHOLD,
  COMPLEX_PREMISE_THRESHOLD
};

export default {
  multiPassAnalyze,
  normalizePremise,
  extractStyle,
  extractContent,
  extractIntensity,
  synthesizeConfig,
  hasComplexRequirements
};
