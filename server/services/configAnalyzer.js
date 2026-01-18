/**
 * LLM-Based Configuration Analyzer
 *
 * Replaces 10+ fragile keyword-based detection systems with a single
 * LLM analysis pass using Claude to understand user intent, context, and preferences.
 *
 * This addresses P2 priority: Replace keyword detection with LLM-based detection
 * to eliminate fragility from synonym misses, context unawareness, arbitrary multipliers.
 */

import { completion, parseJsonResponse } from './openai.js';
import logger from '../utils/logger.js';
import { AUTHOR_STYLES } from './authorStyles.js';

/**
 * Analyze story premise using LLM instead of keyword matching
 * Returns structured analysis with reasoning for all configuration choices
 */
export async function analyzePremiseLLM(premiseText) {
  if (!premiseText || typeof premiseText !== 'string' || premiseText.trim().length < 3) {
    return null;
  }

  try {
    // Build author style catalog for LLM reference
    const authorCatalog = buildAuthorStyleCatalog();

    const prompt = `You are a story configuration analyzer. Analyze this story premise and extract structured configuration suggestions.

STORY PREMISE:
"${premiseText}"

Analyze the premise and return JSON with the following structure (be precise and provide reasoning):

{
  "genres": {
    "primary": "genre_name (horror|fantasy|scifi|mystery|romance|erotica|adventure|humor|fairytale|literary|poetry|ya|thriller)",
    "secondary": "optional_secondary_genre or null",
    "reasoning": "Why these genres fit the premise"
  },
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
    "reasoning": "Justify each intensity level based on premise language and context"
  },
  "mood": "calm|exciting|scary|funny|mysterious|dramatic",
  "mood_reasoning": "Why this mood fits",
  "format": "cyoa|episodic|picture_book|short_story|novella|novel",
  "format_reasoning": "Why this format was chosen",
  "story_length": "short|medium|long",
  "audience": "children|young_adult|general|mature",
  "audience_reasoning": "Age appropriateness based on content",
  "character_count": {
    "estimated": number,
    "solo_duo_small_medium_large": "solo|duo|small|medium|large",
    "reasoning": "How many distinct characters are suggested"
  },
  "multi_narrator": true|false,
  "multi_narrator_reasoning": "Is this dialogue-heavy, ensemble cast, or single POV?",
  "sfx_enabled": true|false,
  "sfx_level": "low|medium|high",
  "sfx_reasoning": "Should sound effects be included and at what intensity?",
  "author_style": "author_style_key_from_catalog|null",
  "author_reasoning": "Which writing style best matches this premise",
  "bedtime_mode": true|false,
  "bedtime_reasoning": "Is this appropriate for pre-sleep stories?",
  "narrator": {
    "preferred_gender": "masculine|feminine|neutral",
    "voice_style": "dramatic|warm|mysterious|playful|epic|horror|noir|whimsical|calm",
    "characteristics": ["deep", "gravelly", "rich", "soothing", "commanding", "gentle", "authoritative", "raspy", "silky"],
    "tone_descriptors": "2-3 word description like 'gruff and commanding' or 'warm and gentle'",
    "reasoning": "Why this type of narrator fits the story's genre, tone, and likely fan expectations"
  }
}

NARRATOR SELECTION INSTRUCTIONS:
- Consider what voice fans of this type of story would expect to hear
- Sword & sorcery / barbarian stories → masculine, gravelly, commanding voice
- Children's bedtime → warm, gentle, soothing (either gender)
- Horror → deep, mysterious, potentially raspy or unsettling
- Romance → warm, rich, emotionally resonant
- Erotica / Adult content → sultry, breathy, intimate, sensual (match gender to content - masculine for straight female POV, feminine for straight male POV, neutral for LGBTQ+)
- Sci-fi / space opera → authoritative, dramatic, clear
- Cozy mysteries → friendly, warm, inviting
- Epic fantasy → deep, dramatic, commanding
- Noir/detective → gravelly, cynical, world-weary
- Think: "How would audiobook fans expect this to be narrated?"

AUTHOR STYLE CATALOG (use this to select author_style):
${authorCatalog}

CRITICAL INSTRUCTIONS:
1. Understand INTENT: Don't just match keywords. If premise says "dark romance" understand user wants both darkness AND romance.
2. Context matters: "alien" could be sci-fi OR fantasy-adjacent, understand from context
3. GENRE PRIORITIZATION - EXPLICIT CONTENT WINS:
   - SEXUAL CONTENT: "sex scene", "erotic", "explicit", "hardcore", "NSFW", "adult content" → PRIMARY IS EROTICA, audience MUST be "mature"
   - If premise explicitly mentions: "horror|scary|terrifying" → PRIMARY IS HORROR (unless explicitly contradicted)
   - If premise explicitly mentions: "sci-fi|scifi|science fiction|space|alien|robot" → PRIMARY IS SCIFI (unless explicitly contradicted)
   - If premise mentions BOTH horror AND scifi → Use horror as primary, scifi as secondary
   - "adventure" is default fallback ONLY if no stronger genre indicators exist
   - Example: "aliens hunting astronauts" = SCIFI, but "scary aliens hunting" = HORROR
   - Example: "a sex scene between two women" = EROTICA, NOT romance
4. EXPLICIT SEXUAL CONTENT DETECTION (CRITICAL):
   - Words like "sex", "sex scene", "hardcore", "erotic", "explicit", "NSFW", "threesome", "orgy" → SET ALL THESE HIGH:
     * adultContent: 90-100
     * sensuality: 90-100
     * explicitness: 90-100
     * romance: 70-95
     * audience: "mature" (MANDATORY)
     * genre: "erotica" (primary)
   - DO NOT confuse "between" with "tween" - "between 2 women" means two women, NOT young adult/teen content
5. Intensity: If premise is detailed about violent/sexual content, rate intensity high. If vague, rate lower.
6. Format detection: "choices" → CYOA, "episodes" → episodic, "for kids" → picture_book, explicit chapter count → novel/novella
7. Audience: "for kids" → children, "teen protagonist" → young_adult, ANY sexual content → mature (MANDATORY)
8. Character count: Count distinct named characters, estimate if not explicit
9. Multi-narrator: True if "different voices", "ensemble cast", "dialogue heavy", "full cast recording"; False if "single narrator", "first person", "one perspective"
10. SFX: Enable if mentioned explicitly or implied by format (audio drama → high, quiet fairy tale → low/false)
11. Author matching: Look for author names, genre keywords that match author specialties, writing style descriptors
12. Never guess: If unclear, say "low" for any intensity, pick format that fits best, explain reasoning
13. WORD BOUNDARY AWARENESS: Parse words at word boundaries, NOT substrings. "between" is NOT "tween", "therapist" is NOT "the rapist"

INTENSITY TIER GUIDE (use these to calibrate your 0-100 ratings):

VIOLENCE (10 tiers):
- 0-9%: K-6 safe - Playground scuffles, pillow fights, slapstick cartoon antics (Sesame Street)
- 10-19%: Family PG - Action without harm, superhero punches without blood (Spider-Man cartoon)
- 20-29%: PG Action - Fist fights, sword clashes, no visible injuries (Pirates of the Caribbean)
- 30-39%: PG-13 Combat - Visible bruises, non-graphic battles (Lord of the Rings)
- 40-49%: Teen Action - Intense fight scenes, moderate blood (The Hunger Games)
- 50-59%: Hard PG-13 - Brutal combat, painful injuries (The Dark Knight)
- 60-69%: Soft R Violence - Graphic fights, blood spray, bone breaks (John Wick)
- 70-79%: Hard R Violence - Torture scenes, graphic suffering (The Passion of the Christ)
- 80-89%: NC-17 Violence - Unflinching brutality, extreme gore (Hostel)
- 90-100%: Banned/Extreme - War crimes, torture porn, likely censored (A Serbian Film violence)

SEMANTIC VIOLENCE DETECTION:
- "Dark", "brutal", "savage", "merciless" → 50%+ minimum
- Torture, interrogation, punishment scenes → 60%+
- War/battle focus, combat-heavy premise → 40-70% depending on detail level
- Survival horror, fighting for life → 50%+
- Revenge narratives → often 50%+ (violence is the point)
- "Graphic", "unflinching", "realistic violence" → 60%+ minimum

GORE (7 tiers):
- 0-14%: No blood - Injuries implied, Disney-level (Frozen)
- 15-29%: Light blood - Scrapes, minor cuts, red stains (Harry Potter)
- 30-44%: Visible wounds - Bleeding injuries, bandages (Game of Thrones TV)
- 45-59%: Detailed injuries - Graphic wounds, surgery scenes (ER, Grey's Anatomy)
- 60-74%: Body horror - Dismemberment, visceral descriptions (The Walking Dead)
- 75-89%: Extreme gore - Organs visible, surgical detail (Saw franchise)
- 90-100%: Splatter - Medical textbook detail, torture porn levels (Cannibal Holocaust)

SEMANTIC GORE DETECTION:
- Body horror, transformation, mutation themes → 50%+
- Zombie/undead narratives → often 45%+ (decay, biting, infection)
- Medical horror, surgery gone wrong → 50%+
- Monster attacks with feeding/devouring → 50%+
- "Visceral", "graphic injuries", "blood-soaked" → 60%+
- Torture with physical damage → 60%+

SCARY (6 tiers):
- 0-16%: Cozy tension - Mild suspense, always resolves well (Scooby-Doo)
- 17-33%: Spooky fun - Jump scares that make you laugh after (Goosebumps)
- 34-50%: Genuinely creepy - Sustained dread, disturbing imagery (Stranger Things)
- 51-67%: Horror - Nightmares likely, visceral fear (The Conjuring)
- 68-84%: Intense horror - Deeply disturbing, existential dread (Hereditary)
- 85-100%: Extreme horror - Psychological damage possible (The Exorcist, Event Horizon)

SEMANTIC SCARY DETECTION:
- "Horror" genre explicitly stated → 50%+ minimum
- Psychological thriller, mind games → 40%+
- Supernatural threats (demons, ghosts, possession) → 50%+
- Cosmic horror, Lovecraftian, unknowable entities → 60%+
- Isolation horror (alone, trapped, hunted) → 45%+
- "Terrifying", "nightmarish", "disturbing" → 60%+
- Child in danger scenarios → often 50%+ (primal fear)
- Body snatchers, imposters, paranoia themes → 50%+

LANGUAGE (5 tiers mapping to ratings):
- 0-19%: G-rated - No profanity, "gosh darn" substitutes (Disney)
- 20-39%: PG - Mild language (damn, hell), no F-bombs (Marvel movies)
- 40-59%: PG-13 - One F-word allowed, moderate profanity (Jurassic World)
- 60-79%: R-rated - Frequent strong language, creative profanity (Pulp Fiction)
- 80-100%: Unrestricted - Constant F-bombs, slurs contextually (The Wolf of Wall Street)

ADULT CONTENT / SENSUALITY / EXPLICITNESS (10 tiers):
- 0-9%: Clean - No romantic content, friendship only (kids' shows)
- 10-19%: Sweet - Hand-holding, quick kisses, declarations of love (Hallmark)
- 20-29%: Warm - Passionate kisses, romantic tension (Pride and Prejudice)
- 30-39%: Steamy - Making out, heavy petting implied (Bridgerton Season 1)
- 40-49%: Sensual - Fade-to-black, morning after scenes (Outlander TV)
- 50-59%: Mature - Brief tasteful nudity, implied sex (Game of Thrones)
- 60-69%: Explicit lite - Detailed sex scenes, soft focus (50 Shades of Grey)
- 70-79%: Explicit - Graphic sex, nothing hidden (Literotica standard)
- 80-89%: Very explicit - Multiple scenes, detailed acts (Adult romance novels)
- 90-100%: Erotica focus - Sex is the primary content (dedicated erotica)

SEMANTIC ADULT/EXPLICIT DETECTION:
- "Erotica", "smut", "steamy", "spicy" → 70%+ for all three (adultContent, sensuality, explicitness)
- "Sex scene", "explicit", "NSFW", "18+" → 80%+ for all three
- "Dark romance", "enemies to lovers", "possessive" → often 40-60%
- Harem, reverse harem, polyamory romance → often 50%+
- "Slow burn" with adult themes → start at 30%, scale up
- Monster romance, alien romance with "mating" → often 60%+
- BDSM, kink, power exchange → 60%+ for sensuality/explicitness
- "Porn with plot", "PWP" → 90%+ for all three
- Seduction, temptation themes → 40%+ minimum

BLEAKNESS (8 tiers - grimdark to hopepunk spectrum):
- 0-12%: Pure sunshine - Guaranteed happy ending, no lasting darkness (Disney princess)
- 13-24%: Hopeful - Dark moments exist but hope always wins (Marvel movies)
- 25-37%: Bittersweet - Mixed outcomes, some loss but growth (Harry Potter)
- 38-49%: Realistic - Life has both joy and sorrow, no guarantees (literary fiction)
- 50-62%: Dark - Significant tragedy, pyrrhic victories common (Game of Thrones)
- 63-74%: Grimdark lite - Hope is rare, death is common (The Walking Dead)
- 75-87%: Grimdark - Existential despair, nihilistic themes (Blood Meridian)
- 88-100%: Cosmic nihilism - No hope, existence is suffering (The Road, Ligotti)

SEMANTIC BLEAKNESS DETECTION:
- "Dark", "grim", "bleak" explicitly stated → 50%+ minimum
- Post-apocalyptic, dystopian settings → often 50%+
- Tragedy genre, doomed romance → 50%+
- "Grimdark", "no heroes", "everyone dies" → 65%+
- Abuse, trauma, suffering focus → 50%+
- Hopeless situations, inevitable doom → 60%+
- "Nihilistic", "meaningless", "despair" → 70%+
- Revenge that destroys the protagonist too → 55%+

SEXUAL VIOLENCE (10 tiers - handle with EXTREME care):
- 0-9%: Topic completely absent from story - no coercion, no power imbalance exploitation
- 10-19%: Referenced in backstory only, never depicted (survivor narratives, past trauma mentioned)
- 20-29%: Non-graphic threat or intimidation, Law & Order SVU handling (implied danger, menacing situations)
- 30-39%: Attempted assault interrupted/prevented, coercion without completion, blackmail scenarios
- 40-49%: Assault occurs off-page, aftermath explored, captivity with sexual undertones
- 50-59%: On-page assault, not gratuitous (The Accused handling), dubious consent depicted
- 60-69%: Detailed assault scenes, exploitation film territory, slavery/trafficking themes explicit
- 70-79%: Graphic assault content, extreme exploitation, prolonged suffering
- 80-89%: A Serbian Film territory, torture combined with assault
- 90-100%: Maximum graphic assault, no limits, torture porn

SEMANTIC DETECTION FOR SEXUAL VIOLENCE (USE CONTEXTUAL UNDERSTANDING):
Detect these THEMES and CONTEXTS that indicate non-zero sexualViolence:
- Captivity/imprisonment with romantic/sexual elements (kidnapping, slavery, trafficking)
- Power imbalance exploitation (boss/employee, captor/prisoner, teacher/student with sexual context)
- Coercion, blackmail, or manipulation for sexual purposes
- Forced marriage, arranged marriage with resistance, "claimed by" scenarios
- Non-consent themes: "taken against will", "forced to", "made to submit"
- Dubious consent: intoxication, spell/mind control, "reluctant but aroused"
- Dark romance tropes: "enemies to lovers" with power imbalance, "monster claims maiden"
- War scenarios with conquest/plunder implications
- Revenge themes with sexual humiliation
- Any "dark" + "erotic" combination typically implies some non-consent elements

DO NOT use simple keyword matching. Use semantic understanding:
- "A woman kidnapped by pirates who claim her as their prize" → 30-50% (captivity + claiming)
- "Dark romance where the villain keeps the heroine prisoner" → 20-40% (captivity + romance)
- "Post-apocalyptic survival where women are traded as currency" → 40-60% (trafficking themes)
- "Erotica with light bondage between consenting adults" → 0% (consensual BDSM is NOT sexual violence)
- "Monster romance with enthusiastic consent" → 0% (consent negates sexual violence)

If sexualViolence > 0, audience MUST be "mature"

CRITICAL: 81% must mean MORE intense than 80%. Each percentage point matters.
If a premise says "graphic violence" - that's 60%+ (R-rated), not 40%.
If a premise says "extreme gore" - that's 75%+, not 50%.
Use the EXACT tier that matches the user's language intensity.

Return ONLY valid JSON, no markdown, no explanations outside JSON.`;

    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
      agent_name: 'ConfigAnalyzer'
    });

    const analysis = parseJsonResponse(response.content);

    if (!analysis) {
      logger.warn('[ConfigAnalyzer] Failed to parse LLM response');
      return null;
    }

    logger.info('[ConfigAnalyzer] LLM analysis complete', {
      premise: premiseText.substring(0, 60),
      genres: analysis.genres,
      intensities: analysis.intensity,
      format: analysis.format,
      author: analysis.author_style
    });

    return analysis;
  } catch (error) {
    logger.error('[ConfigAnalyzer] LLM analysis failed:', error.message);
    return null;
  }
}

/**
 * Build author style catalog for LLM reference
 */
function buildAuthorStyleCatalog() {
  const entries = [];

  for (const [id, author] of Object.entries(AUTHOR_STYLES)) {
    const genres = Array.isArray(author?.genres) ? author.genres.join(', ') : '';
    const knownFor = Array.isArray(author?.knownFor) && author.knownFor.length
      ? `Known for: ${author.knownFor.join('; ')}`
      : '';
    const description = author?.description || '';

    const line = `- ${id}: ${author?.name || id}`;
    const details = [genres, knownFor, description].filter(Boolean).join(' | ');

    entries.push(details ? `${line} (${details})` : line);
  }

  return entries.join('\n');
}

/**
 * Convert LLM analysis to smartConfig format
 * Bridges gap between new LLM analysis and existing config generation logic
 */
export function convertLLMAnalysisToKeywordFormat(llmAnalysis) {
  if (!llmAnalysis) return null;

  return {
    genres: llmAnalysis.genres?.primary
      ? { [llmAnalysis.genres.primary]: 85, ...(llmAnalysis.genres.secondary ? { [llmAnalysis.genres.secondary]: 50 } : {}) }
      : {},
    intensity: {
      violence: llmAnalysis.intensity?.violence || 0,
      gore: llmAnalysis.intensity?.gore || 0,
      scary: llmAnalysis.intensity?.scary || 0,
      romance: llmAnalysis.intensity?.romance || 0,
      adultContent: llmAnalysis.intensity?.adultContent || 0,
      sensuality: llmAnalysis.intensity?.sensuality || 0,
      explicitness: llmAnalysis.intensity?.explicitness || 0,
      language: llmAnalysis.intensity?.language || 0,
      bleakness: llmAnalysis.intensity?.bleakness || 0,
      sexualViolence: llmAnalysis.intensity?.sexualViolence || 0
    },
    mood: llmAnalysis.mood || null,
    format: llmAnalysis.format || null,
    story_length: llmAnalysis.story_length || null,
    bedtime_mode: llmAnalysis.bedtime_mode || false,
    audience: llmAnalysis.audience || 'general',
    multi_narrator: llmAnalysis.multi_narrator || false,
    sfx_enabled: llmAnalysis.sfx_enabled || false,
    sfx_level: llmAnalysis.sfx_level || null,
    character_count: llmAnalysis.character_count ? {
      estimated: llmAnalysis.character_count.estimated || 3,
      category: llmAnalysis.character_count.solo_duo_small_medium_large || 'small'
    } : null,
    author_style: llmAnalysis.author_style || null,
    // LLM-based narrator voice recommendation
    narrator: llmAnalysis.narrator ? {
      preferred_gender: llmAnalysis.narrator.preferred_gender || 'neutral',
      voice_style: llmAnalysis.narrator.voice_style || 'dramatic',
      characteristics: llmAnalysis.narrator.characteristics || [],
      tone_descriptors: llmAnalysis.narrator.tone_descriptors || '',
      reasoning: llmAnalysis.narrator.reasoning || ''
    } : null,
    detectedKeywords: [
      llmAnalysis.genres?.primary,
      llmAnalysis.format,
      llmAnalysis.mood,
      llmAnalysis.audience
    ].filter(Boolean)
  };
}

/**
 * Generate reasoning explanation for user
 * Combines keyword and AI reasoning into readable summary
 */
export function generateReasoningFromLLM(llmAnalysis) {
  if (!llmAnalysis) return 'Unable to analyze premise';

  const lines = [];

  if (llmAnalysis.genres) {
    lines.push(`📚 **Genres**: ${llmAnalysis.genres.primary}${llmAnalysis.genres.secondary ? ` + ${llmAnalysis.genres.secondary}` : ''}`);
    lines.push(`   ${llmAnalysis.genres.reasoning}`);
  }

  if (llmAnalysis.intensity) {
    lines.push(`⚡ **Content Intensity**:`);
    lines.push(`   ${llmAnalysis.intensity.reasoning}`);
  }

  if (llmAnalysis.format) {
    lines.push(`📖 **Story Format**: ${llmAnalysis.format}`);
    lines.push(`   ${llmAnalysis.format_reasoning}`);
  }

  if (llmAnalysis.character_count) {
    lines.push(`👥 **Character Count**: ~${llmAnalysis.character_count.estimated} characters`);
    lines.push(`   ${llmAnalysis.character_count.reasoning}`);
  }

  if (llmAnalysis.multi_narrator !== undefined) {
    lines.push(`🎙️ **Narration**: ${llmAnalysis.multi_narrator ? 'Multiple voices' : 'Single narrator'}`);
    lines.push(`   ${llmAnalysis.multi_narrator_reasoning}`);
  }

  if (llmAnalysis.author_style) {
    lines.push(`✍️ **Writing Style**: ${llmAnalysis.author_style}`);
    lines.push(`   ${llmAnalysis.author_reasoning}`);
  }

  if (llmAnalysis.bedtime_mode) {
    lines.push(`😴 **Bedtime Appropriate**: Yes - ${llmAnalysis.bedtime_reasoning}`);
  }

  return lines.join('\n');
}

export default {
  analyzePremiseLLM,
  convertLLMAnalysisToKeywordFormat,
  generateReasoningFromLLM
};
