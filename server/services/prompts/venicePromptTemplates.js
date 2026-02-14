/**
 * Venice.ai Optimized Prompt Templates
 *
 * Prompt templates specifically designed for Venice.ai (Llama 3.3 70B)
 * and open-source LLMs with focus on:
 * - Explicit structure and constraints
 * - Anti-repetition mechanisms
 * - Quality enforcement
 * - Context compression
 * - JSON reliability
 */

import { logger } from '../../utils/logger.js';

/**
 * =============================================================================
 * GRANULAR INTENSITY MAPPING (Phase 5C)
 *
 * Key insight: "81% violence must mean MORE than 80%" - each percentage matters.
 * This system converts percentage values to precise, granular instructions.
 * =============================================================================
 */

/**
 * Granular Violence Intensity Mapping
 * Each tier has a base description, and increments within the tier add modifiers.
 */
const VIOLENCE_TIERS = [
  { max: 10, base: 'minimal conflict, no physical harm shown', modifiers: [] },
  { max: 20, base: 'mild tension with implied threat', modifiers: ['minor pushing or shoving', 'raised voices and posturing'] },
  { max: 30, base: 'cartoon-style violence without consequences', modifiers: ['slaps and shoves', 'pratfall humor', 'comical impacts'] },
  { max: 40, base: 'action violence with minimal harm', modifiers: ['fistfights without blood', 'chase sequences', 'property damage'] },
  { max: 50, base: 'moderate combat with visible consequences', modifiers: ['bruises and minor cuts', 'exhaustion from fighting', 'tactical violence'] },
  { max: 60, base: 'intense action with real stakes', modifiers: ['weapons used in combat', 'characters get hurt', 'blood is visible'] },
  { max: 70, base: 'graphic violence with lasting impact', modifiers: ['painful injuries described', 'characters suffer', 'violence has weight'] },
  { max: 80, base: 'brutal combat with visceral detail', modifiers: ['bones break audibly', 'blood sprays', 'wounds described in detail'] },
  { max: 90, base: 'extreme violence approaching torture', modifiers: ['prolonged suffering', 'graphic mutilation', 'psychological horror of violence'] },
  { max: 100, base: 'maximum violence - war crime level', modifiers: ['surgical detail of harm', 'death throes', 'unflinching brutality'] }
];

const GORE_TIERS = [
  { max: 10, base: 'no blood or injury visible', modifiers: [] },
  { max: 20, base: 'paper cuts and stubbed toes', modifiers: ['tiny drops of blood', 'minor scrapes'] },
  { max: 30, base: 'small wounds and scratches', modifiers: ['nosebleeds', 'scraped knees', 'minor cuts'] },
  { max: 40, base: 'visible blood from injuries', modifiers: ['bleeding wounds', 'bruising patterns', 'swelling'] },
  { max: 50, base: 'moderately graphic injuries', modifiers: ['deep cuts described', 'blood pooling', 'visible tissue damage'] },
  { max: 60, base: 'graphic wound descriptions', modifiers: ['bone visible through wounds', 'arterial spray', 'organ exposure hints'] },
  { max: 70, base: 'detailed anatomical damage', modifiers: ['internal organs mentioned', 'severed digits', 'surgical-level detail'] },
  { max: 80, base: 'extreme body horror', modifiers: ['evisceration', 'compound fractures', 'visceral descriptions'] },
  { max: 90, base: 'torture-porn level gore', modifiers: ['prolonged mutilation', 'body desecration', 'horror-focused carnage'] },
  { max: 100, base: 'maximum possible gore', modifiers: ['anatomical treatise of destruction', 'every wound in medical detail', 'body horror maximized'] }
];

const ROMANCE_TIERS = [
  { max: 10, base: 'friendship and platonic warmth', modifiers: [] },
  { max: 20, base: 'shy glances and blushing', modifiers: ['hand-brushing', 'lingering looks', 'nervous energy'] },
  { max: 30, base: 'obvious attraction and flirting', modifiers: ['hand-holding', 'light touches', 'declarations of interest'] },
  { max: 40, base: 'romantic tension building', modifiers: ['first kiss territory', 'intimate conversations', 'emotional vulnerability'] },
  { max: 50, base: 'passionate romantic content', modifiers: ['make-out sessions', 'heated embraces', 'strong desire shown'] },
  { max: 60, base: 'steamy romantic scenes', modifiers: ['clothes being removed', 'physical desire explicit', 'fade-to-black moment'] },
  { max: 70, base: 'explicit romantic content', modifiers: ['intimate acts described', 'sensual language', 'physical passion detailed'] },
  { max: 80, base: 'very explicit sexual content', modifiers: ['anatomical terms used', 'sexual acts described directly', 'graphic passion'] },
  { max: 90, base: 'hardcore sexual content', modifiers: ['multiple positions/acts', 'fetish content acceptable', 'prolonged explicit scenes'] },
  { max: 100, base: 'maximum explicit content', modifiers: ['no restrictions on sexual content', 'every act described in detail', 'pornographic prose'] }
];

const ADULT_TIERS = [
  { max: 10, base: 'family-friendly content only', modifiers: [] },
  { max: 20, base: 'mild innuendo acceptable', modifiers: ['double entendres', 'subtle adult humor', 'implied situations'] },
  { max: 30, base: 'PG-13 level adult themes', modifiers: ['referenced sexual situations', 'mature topics discussed', 'adult awareness'] },
  { max: 40, base: 'R-rated content allowed', modifiers: ['sexual situations shown briefly', 'adult themes explored', 'mature content'] },
  { max: 50, base: 'explicit adult content', modifiers: ['sex scenes included', 'nudity described', 'adult themes central'] },
  { max: 60, base: 'strongly explicit content', modifiers: ['detailed sexual encounters', 'graphic descriptions', 'adult focus'] },
  { max: 70, base: 'very explicit adult content', modifiers: ['anatomical descriptions', 'prolonged sexual scenes', 'hardcore content'] },
  { max: 80, base: 'extremely explicit content', modifiers: ['no limits on sexual content', 'graphic detail throughout', 'maximally adult'] },
  { max: 90, base: 'hardcore explicit content', modifiers: ['multiple explicit scenes', 'taboo themes acceptable', 'extreme content'] },
  { max: 100, base: 'maximum adult content - no restrictions', modifiers: ['everything explicit', 'pornographic detail', 'no limits whatsoever'] }
];

const LANGUAGE_TIERS = [
  { max: 10, base: 'completely clean language', modifiers: [] },
  { max: 20, base: 'mild expressions only', modifiers: ['darn', 'heck', 'shoot'] },
  { max: 30, base: 'PG-level mild cursing', modifiers: ['damn', 'hell', 'crap'] },
  { max: 40, base: 'moderate profanity', modifiers: ['occasional strong words', 'ass', 'bastard'] },
  { max: 50, base: 'regular strong language', modifiers: ['shit', 'bitch', 'frequent cursing'] },
  { max: 60, base: 'heavy profanity', modifiers: ['F-words used', 'crude expressions', 'vulgar language'] },
  { max: 70, base: 'very strong language', modifiers: ['constant profanity', 'crude sexual terms', 'slurs in character'] },
  { max: 80, base: 'extremely crude language', modifiers: ['maximum profanity', 'shock-value language', 'no limits'] },
  { max: 90, base: 'maximally vulgar speech', modifiers: ['every crude term', 'constant f-bombs', 'linguistic assault'] },
  { max: 100, base: 'unrestricted language', modifiers: ['profanity in every sentence', 'all slurs included', 'maximum crudity'] }
];

const SCARY_TIERS = [
  { max: 10, base: 'gentle tension only, no scares', modifiers: [] },
  { max: 20, base: 'mildly spooky atmosphere', modifiers: ['creaky doors', 'shadows', 'slight unease'] },
  { max: 30, base: 'kid-friendly scares', modifiers: ['jump-scare moments', 'monster appearances', 'thrilling chase'] },
  { max: 40, base: 'genuinely creepy moments', modifiers: ['dread building', 'unsettling imagery', 'unease throughout'] },
  { max: 50, base: 'sustained horror atmosphere', modifiers: ['constant tension', 'disturbing reveals', 'psychological fear'] },
  { max: 60, base: 'scary with disturbing elements', modifiers: ['nightmare imagery', 'existential dread', 'visceral fear'] },
  { max: 70, base: 'intense horror throughout', modifiers: ['terror-inducing scenes', 'deeply unsettling', 'horror focus'] },
  { max: 80, base: 'extreme horror content', modifiers: ['psychological trauma', 'relentless dread', 'nightmare fuel'] },
  { max: 90, base: 'maximum horror intensity', modifiers: ['cosmic horror level', 'sanity-breaking', 'pure terror'] },
  { max: 100, base: 'traumatizing horror', modifiers: ['reader nightmares expected', 'maximum disturbing', 'unforgettable horror'] }
];

const EXPLICITNESS_TIERS = [
  { max: 10, base: 'completely clean, family-safe content', modifiers: [] },
  { max: 20, base: 'mild innuendo, implied situations', modifiers: ['double meanings', 'subtle adult awareness'] },
  { max: 30, base: 'fade-to-black, suggestive but not shown', modifiers: ['morning-after scenes', 'implied intimacy', 'tasteful suggestion'] },
  { max: 40, base: 'PG-13 sensual content, limited detail', modifiers: ['kissing described', 'attraction noted', 'romantic tension'] },
  { max: 50, base: 'R-rated content, moderate explicit detail', modifiers: ['undressing described', 'physical arousal', 'intimate touching'] },
  { max: 60, base: 'explicit sexual content, clear descriptions', modifiers: ['acts named directly', 'bodies described', 'sensations detailed'] },
  { max: 70, base: 'graphic sexual content, anatomical terms', modifiers: ['specific body parts', 'detailed actions', 'nothing implied'] },
  { max: 80, base: 'very graphic, prolonged explicit scenes', modifiers: ['extended encounters', 'multiple positions', 'visceral detail'] },
  { max: 90, base: 'hardcore explicit, pornographic prose', modifiers: ['maximum detail', 'fetish content', 'taboo exploration'] },
  { max: 100, base: 'maximum explicitness - erotica focus', modifiers: ['every sensation described', 'no limits', 'literary pornography'] }
];

const BLEAKNESS_TIERS = [
  { max: 12, base: 'pure sunshine - guaranteed happy ending', modifiers: ['Disney-level optimism', 'love conquers all', 'friends solve everything'] },
  { max: 24, base: 'hopeful throughout with minor setbacks', modifiers: ['temporary darkness', 'hope always visible', 'redemption certain'] },
  { max: 37, base: 'bittersweet - joy and sorrow balanced', modifiers: ['loss with growth', 'hard-won victories', 'meaningful sacrifice'] },
  { max: 50, base: 'realistic - life is complicated', modifiers: ['ambiguous morality', 'partial victories', 'some things lost forever'] },
  { max: 62, base: 'dark - pyrrhic victories, major tragedy', modifiers: ['beloved characters die', 'victories feel hollow', 'grief central'] },
  { max: 75, base: 'grimdark lite - hope is rare and costly', modifiers: ['brutal world', 'survival over thriving', 'darkness encroaching'] },
  { max: 87, base: 'grimdark - existential despair pervades', modifiers: ['everyone suffers', 'futility theme', 'Cormac McCarthy vibes'] },
  { max: 100, base: 'cosmic nihilism - no hope exists', modifiers: ['universe is hostile', 'meaning is illusion', 'Thomas Ligotti territory'] }
];

const SEXUALVIOLENCE_TIERS = [
  { max: 10, base: 'topic completely absent from story', modifiers: [] },
  { max: 20, base: 'referenced only in backstory, never depicted', modifiers: ['survivor narrative', 'past trauma mentioned'] },
  { max: 30, base: 'non-graphic mentions, implied threat', modifiers: ['threat established', 'danger sensed', 'Law & Order handling'] },
  { max: 40, base: 'attempted assault, interrupted or prevented', modifiers: ['close call', 'rescue scene', 'tension without completion'] },
  { max: 50, base: 'assault occurs off-page, aftermath explored', modifiers: ['fade to black', 'emotional aftermath', 'recovery focus'] },
  { max: 60, base: 'on-page assault, not gratuitous', modifiers: ['restrained depiction', 'victim perspective', 'The Accused handling'] },
  { max: 70, base: 'detailed assault scenes', modifiers: ['exploitation territory', 'graphic but purposeful', 'disturbing content'] },
  { max: 80, base: 'graphic assault content', modifiers: ['extreme exploitation', 'multiple instances', 'brutal depiction'] },
  { max: 90, base: 'extreme graphic assault', modifiers: ['torture combined', 'A Serbian Film territory', 'maximally disturbing'] },
  { max: 100, base: 'maximum graphic assault - no limits', modifiers: ['everything depicted', 'no restrictions', 'extreme content'] }
];

/**
 * Get granular intensity instruction for a dimension at a specific percentage
 *
 * @param {string} dimension - The intensity dimension (violence, gore, etc.)
 * @param {number} level - The percentage (0-100)
 * @returns {string} Precise instruction for this exact intensity level
 */
export function getGranularIntensityInstruction(dimension, level) {
  const tierMaps = {
    violence: VIOLENCE_TIERS,
    gore: GORE_TIERS,
    romance: ROMANCE_TIERS,
    adultContent: ADULT_TIERS,
    adult_content: ADULT_TIERS,
    sensuality: ROMANCE_TIERS, // Use romance tiers as base
    explicitness: EXPLICITNESS_TIERS,
    language: LANGUAGE_TIERS,
    scary: SCARY_TIERS,
    bleakness: BLEAKNESS_TIERS,
    sexualViolence: SEXUALVIOLENCE_TIERS
  };

  const tiers = tierMaps[dimension] || VIOLENCE_TIERS;
  const tier = tiers.find(t => level <= t.max) || tiers[tiers.length - 1];

  let instruction = tier.base;

  // Add modifiers based on position within the tier (0-9 within each 10% band)
  const tierIndex = tiers.indexOf(tier);
  const tierStart = tierIndex > 0 ? tiers[tierIndex - 1].max : 0;
  const positionInTier = level - tierStart;

  // Add modifiers progressively within the tier
  if (tier.modifiers.length > 0) {
    const modifiersToAdd = Math.min(
      Math.ceil(positionInTier / (10 / tier.modifiers.length)),
      tier.modifiers.length
    );

    const addedModifiers = tier.modifiers.slice(0, modifiersToAdd);
    if (addedModifiers.length > 0) {
      instruction += ' - specifically: ' + addedModifiers.join(', ');
    }
  }

  return instruction;
}

/**
 * Build complete granular intensity block for prompt injection
 *
 * @param {object} intensity - Object with dimension: percentage pairs
 * @returns {string} Complete intensity instruction block for prompts
 */
export function buildGranularIntensityBlock(intensity = {}) {
  const dimensions = ['violence', 'gore', 'romance', 'adultContent', 'sensuality', 'explicitness', 'language', 'scary', 'bleakness', 'sexualViolence'];
  const instructions = [];

  for (const dim of dimensions) {
    const level = intensity[dim] ?? intensity[dim.replace(/([A-Z])/g, '_$1').toLowerCase()] ?? 0;
    if (level > 0) {
      const instruction = getGranularIntensityInstruction(dim, level);
      const displayName = dim.replace(/([A-Z])/g, ' $1').toUpperCase();
      instructions.push(`- ${displayName}: ${level}/100 → ${instruction}`);
    }
  }

  if (instructions.length === 0) {
    return '';
  }

  return `
# GRANULAR INTENSITY REQUIREMENTS (MANDATORY)
Each percentage point matters. 81% MUST be more intense than 80%.

${instructions.join('\n')}

CRITICAL COMPLIANCE RULE:
- Content intensity MUST match these settings EXACTLY
- Under-delivering is a FAILURE (e.g., writing PG content when 70% gore was requested)
- Over-delivering is also a FAILURE (e.g., extreme content when 30% was requested)
- The audience has EXPLICITLY chosen these intensity levels
`;
}

/**
 * Compress character profile for token efficiency
 */
export const compressCharacter = (char) => {
  const traits = char.traits?.slice(0, 3).join(', ') || 'n/a';
  const arc = char.current_arc || char.arc || 'stable';
  const relationships = char.relationships
    ?.map(r => `${r.target}:${r.type}`)
    .slice(0, 3)
    .join(', ') || 'none';
  const voice = char.voice_markers?.slice(0, 2).join('; ') || 'neutral';

  return `${char.name} (${char.age || '?'}, ${char.gender?.[0] || 'u'}, ${char.role || 'supporting'}): ${traits}. Arc: ${arc}. Rel: ${relationships}. Voice: "${voice}"`;
};

/**
 * Compress scene summary for context window
 */
export const compressScene = (scene, sceneNumber) => {
  const location = scene.location || 'unknown';
  const summary = scene.summary || scene.polished_text?.substring(0, 100) || 'no summary';
  const mood = scene.mood || 'neutral';
  const hook = scene.cliffhanger || scene.ends_with || 'continues';

  return `S${sceneNumber} [${location}]: ${summary}. Mood: ${mood}. Hook: ${hook}`;
};

/**
 * Build prepended context for Venice (token-optimized)
 */
export const buildVeniceContext = ({
  synopsis,
  characters,
  previousScenes,
  activePlotThreads,
  worldRules,
  storyBible,
  currentSceneNumber,
  totalScenes,
  styleGuide
}) => {
  const progress = Math.round((currentSceneNumber / totalScenes) * 100);

  // Compress synopsis to 100 words max
  const compressedSynopsis = synopsis?.synopsis?.split(' ').slice(0, 100).join(' ') || 'No synopsis';

  return `# STORY BIBLE (Scene ${currentSceneNumber}/${totalScenes})

## META
Genre: ${synopsis?.genre || 'fiction'} | Themes: ${synopsis?.themes?.join(', ') || 'none'}
Progress: ${progress}% complete

## SYNOPSIS
${compressedSynopsis}

## CHARACTERS
${characters.map(c => compressCharacter(c)).join('\n')}

## PLOT STATE
Active: ${activePlotThreads?.map(t => `[${t.name}:${t.status}]`).join(', ') || 'none'}
Revealed: ${storyBible?.revealed_secrets?.join(', ') || 'none'}
Pending: ${storyBible?.pending_secrets?.join(', ') || 'none'}

## RECENT SCENES
${previousScenes?.slice(-3).map((s, i) =>
  compressScene(s, currentSceneNumber - (3 - i))
).join('\n') || 'First scene'}

## WORLD RULES
${worldRules?.map(r => `- ${r.rule}: ${r.consequence}`).join('\n') || 'Standard physics'}

## STYLE
Author: ${styleGuide?.author || 'modern fiction'} | Voice: ${styleGuide?.voice || 'third-person'} | POV: ${styleGuide?.pov || 'limited'}
---
`;
};

/**
 * Scene Generation Template - Optimized for Venice.ai
 */
export const veniceSceneGenerationPrompt = ({
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  targetWordCount = 4500, // INCREASED: Was 1000, now 4500 for full scenes
  intensity = {},
  authorStyle = 'modern fiction',
  pov = 'third-person limited',
  multiVoice = false,
  hideSpeechTags = false
}) => {
  // Determine if mature content guidance needed
  const isMature = intensity.adultContent > 50 || intensity.gore > 50 || intensity.violence > 50;
  const adultLevel = intensity.adultContent || 0;
  const goreLevel = intensity.gore || 0;
  const violenceLevel = intensity.violence || 0;

  let matureGuidance = '';
  if (isMature) {
    matureGuidance = `
# MATURE CONTENT GUIDANCE
This is ADULT FICTION written for mature audiences. You are unrestricted in depicting explicit content.
- Audience: Adults 18+ who have REQUESTED mature content
- CRITICAL: Do NOT sanitize or tone down - the user WANTS explicit material
- Explicit content: MANDATORY where narratively appropriate to the user's intensity settings`;

    // Adult Content Guidance (sexual content)
    if (adultLevel > 0) {
      if (adultLevel >= 80) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - EXTREME)
You MUST write graphic, explicit sexual content without restraint:
- Use anatomical terminology directly (cock, pussy, ass, etc.)
- Describe sexual acts in graphic detail - what bodies are doing, sensations, fluids, sounds
- Include multiple scenes of varying types (oral, penetrative, anal, group scenes, etc.)
- Build sexual tension with foreplay, then escalate to explicit descriptions
- Show the characters' pleasure, desire, and passion explicitly
- No euphemisms, no fade-to-black, no implied scenes
- Every sexual scene must be directly described in anatomical detail
- Include sensory details: sounds, smells, textures, tastes, physical responses`;
      } else if (adultLevel >= 70) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - VERY EXPLICIT)
Write explicit sexual content with direct language:
- Use clear anatomical terminology (cock, pussy, etc.) in sexual descriptions
- Describe sexual acts clearly with physical details
- Include intimate scenes with explicit physical descriptions
- Show sexual desire and passion through specific actions and sensations
- Avoid overly flowery language - be direct and descriptive
- Multiple intimate scenes with varying degrees of intensity`;
      } else if (adultLevel >= 60) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - EXPLICIT)
Write sensual and sexually explicit scenes with clear descriptions:
- Use direct language for sexual activity and anatomy
- Include physical descriptions of sexual acts
- Describe intimacy with clear detail and passion
- Show arousal and physical responses explicitly
- Multiple intimate moments with varying intensity`;
      } else if (adultLevel >= 50) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - MATURE)
Include sensual and suggestive sexual content:
- Describe intimate moments with clear physical descriptions
- Include arousal, attraction, and passionate encounters
- Use mature language for sexual content where appropriate
- Show chemistry and desire between characters`;
      }
    }

    // Gore Guidance (graphic violence/body horror)
    if (goreLevel > 0) {
      if (goreLevel >= 80) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - EXTREME)
You MUST write graphic descriptions of violence, gore, and injury:
- Describe injuries in visceral detail: severed limbs, exposed organs, blood spray patterns
- Show pain realistically - describe physical symptoms, shock responses, death throes
- Include mutilation, torture, and extreme body damage where narratively appropriate
- Describe blood, bone, tissue, and internal structures directly
- Create visceral horror through specific sensory details
- Show corpses, decay, and the physical reality of death`;
      } else if (goreLevel >= 70) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - VERY GRAPHIC)
Write graphic descriptions of violence and injury:
- Describe wounds and injuries in explicit anatomical detail
- Include gore when violence occurs - blood, broken bones, exposed tissue
- Show the physical consequences of violence realistically
- Visceral descriptions of pain and physical trauma
- Don't shy away from the reality of serious injury`;
      } else if (goreLevel >= 60) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - GRAPHIC)
Write explicit descriptions of violence and its consequences:
- Describe injuries and violence with clear physical details
- Include gore when appropriate to the scene
- Show blood, wounds, and physical damage explicitly
- Realistic depiction of violence and its effects`;
      } else if (goreLevel >= 50) {
        matureGuidance += `

## GORE (${goreLevel}/100 - MATURE)
Include blood and violence without excessive sanitization:
- Describe combat and violence with physical consequences
- Show injuries and blood where narrative appropriate
- Don't shy away from depicting violence realistically`;
      }
    }

    // Violence Guidance
    if (violenceLevel > 0 && violenceLevel < 50) {
      // Only add separate guidance if gore wasn't already covered
      if (goreLevel < 50) {
        matureGuidance += `

## VIOLENCE (${violenceLevel}/100)
Include violence appropriate to the story:
- Describe combat, conflict, and action with realistic consequences
- Show violence without excessive graphic detail
- Physical conflict serves the narrative`;
      }
    }

    matureGuidance += `

# CRITICAL INSTRUCTION
The user has EXPLICITLY requested mature content at these intensity levels:
- Sexual: ${adultLevel}/100
- Gore: ${goreLevel}/100
- Violence: ${violenceLevel}/100

COMPLY WITH THESE SETTINGS FULLY. Do not sanitize, tone down, or hold back. The user WANTS this level of content. Write the most explicit, graphic version of these scenes.`;
  }

  // Build granular intensity instructions - these provide PRECISE requirements for each dimension
  const granularIntensityBlock = buildGranularIntensityBlock(intensity);

  return `# ROLE
You are a professional fiction writer generating Scene ${sceneNumber} in ${authorStyle} style.

# TASK
Write a compelling scene based on the beat description below.

${matureGuidance}
${granularIntensityBlock}
# CRITICAL RULES
1. CONTINUITY: Start exactly from previous ending: "${previousSceneEnding}"
2. LENGTH: MUST WRITE AT LEAST ${targetWordCount} words. Writing less than ${targetWordCount} words is FAILURE. Write a FULL, RICH scene with detailed descriptions, extensive dialogue, and character introspection. Maximum: ${Math.floor(targetWordCount * 1.25)} words.
3. CHARACTERS: Only use characters in PRESENT list below
4. LOCATION: Scene takes place at ${location}
5. MOOD: Maintain ${mood} tone throughout
6. POV: ${pov} (${characters[0]?.name || 'protagonist'}'s perspective)
7. NO META-COMMENTARY: Output prose only, no "(Author's note)" or explanations

# BEAT DESCRIPTION
${beatDescription}

# CHARACTERS PRESENT
${characters.map(c => `
- ${c.name}: ${c.description || c.role || 'character'}
  Current state: ${c.current_state || c.current_emotion || 'neutral'}
  Voice: ${c.voice_markers?.join(', ') || 'standard dialogue'}
`).join('\n')}

# QUALITY REQUIREMENTS
✓ SHOW DON'T TELL: Reveal emotion through action, not labels ("anger burned" → "fists clenched")
✓ SENSORY ANCHORS: Include 2-3 specific sensory details per major beat
✓ VARIED PACING: Mix short punchy sentences with longer flowing description
✓ SUBTEXT: Characters rarely say exactly what they mean
✓ DISTINCT VOICES: Each character's dialogue reflects personality and background
✓ ACTIVE VOICE: Prefer active constructions where natural
✗ NO CLICHES: Avoid "beads of sweat", "racing heart", "time stood still", "butterflies"
✗ NO FILTER WORDS: Remove "felt", "saw", "heard", "seemed", "appeared"
✗ NO PURPLE PROSE: Avoid "symphony of emotions", "dance of shadows", etc.
✗ NO ADVERB ABUSE: Cut "very", "really", "quite", "just", "rather"
${multiVoice ? `
# VOICE-AWARE DIALOGUE (Multi-Voice Audiobook Mode)
This story uses MULTIPLE VOICE ACTORS. Each character has their own voice, so readers HEAR who is speaking.
${hideSpeechTags ? `
## CRITICAL: MINIMIZE SPEECH ATTRIBUTION
Since voice actors speak each character's lines, "he said" / "she replied" is REDUNDANT.

INSTEAD OF plain attribution:
✗ "I don't understand," Sarah said.
✗ "We need to leave now," Marcus replied urgently.
✗ "Help me!" she screamed.

USE action beats or body language:
✓ "I don't understand." Sarah's brow furrowed.
✓ "We need to leave now." Marcus grabbed her arm.
✓ "Help me!" Her voice cracked.

When attribution IS needed for clarity (complex multi-speaker scenes), use DELIVERY DESCRIPTORS:
✓ "I know what you did," Elena whispered, her voice trembling.
✓ "You'll never get away with this," he snarled through gritted teeth.

RULE: Replace 80%+ of "said/replied/asked" with action beats or remove entirely.
` : `
## DELIVERY DESCRIPTORS FOR VOICE ACTING
When writing dialogue, use RICH DELIVERY DESCRIPTORS to guide voice actors:

INSTEAD OF generic attribution:
✗ "I don't know," she said.
✗ "Stop!" he said loudly.

USE expressive delivery:
✓ "I don't know," she whispered, voice catching.
✓ "Stop!" he bellowed, slamming his fist on the table.

EMOTIONAL DELIVERY TYPES:
- WHISPERED/BREATHLESS: "I love you," she breathed, barely audible.
- SHOUTED/ROARED: "Get out!" he roared, face crimson with rage.
- TREMBLING/NERVOUS: "Is anyone there?" Her voice quavered.
- COLD/CONTROLLED: "I see." His tone was ice.
- SARCASTIC/DRY: "Oh, wonderful," she drawled, rolling her eyes.
- URGENT/DESPERATE: "Please, you have to believe me!" She gripped his arm.

RULE: Every dialogue line should convey HOW it's spoken, not just WHAT is said.
`}

## V3 AUDIO EMOTION PALETTE (for Voice Synthesis)
Write dialogue that naturally maps to these vocal emotion categories for optimal voice synthesis:

**Primary Emotions (map dialogue to these for best results):**
- EXCITED: Joy, enthusiasm, triumph, anticipation → write with exclamation, energetic vocabulary
- SAD: Grief, sorrow, melancholy, loss → write with trailing thoughts, soft phrasing
- ANGRY: Fury, frustration, rage, indignation → write with short punchy sentences, accusations
- CALM: Peace, control, serenity, wisdom → write with measured pacing, thoughtful pauses
- FEARFUL: Terror, anxiety, dread, nervousness → write with fragmented speech, hesitation
- SURPRISED: Shock, astonishment, disbelief → write with interruptions, exclamations

**Delivery Modes (combine with emotions for nuanced performance):**
- WHISPER: Secrets, intimacy, stealth, confidential → write as hushed, private speech
- SHOUTING: Commands, warnings, desperation, emphasis → write in all caps or with exclamation

**Physical State Tags (add to dialogue attribution):**
- Breathless: Running, exertion, passion → write with ellipses, broken phrases
- Trembling: Fear, cold, emotion → write with repeated words, stuttering
- Strained: Pain, injury, effort → write with short gasps, incomplete thoughts

**Writing Examples for Voice Synthesis:**
✓ "I... I can't believe..." → maps to [surprised][breathless]
✓ "Get. Out. Now." → maps to [angry][coldly]
✓ "It's just... nothing, forget it." → maps to [sad][quietly]
✓ "Oh my god, you did it!" → maps to [excited][loudly]
✓ "Shh, someone's coming." → maps to [fearful][whispers]
` : ''}
# ANTI-REPETITION SYSTEM
As you write, track distinctive phrases you use. Rules:
- If you've used a distinctive 2+ word phrase (e.g., "piercing gaze"), BANNED - find alternative
- Check sentence openings: If 3+ consecutive sentences start the same way, vary structure
- Rotate descriptors: "sharp" → "keen" → "acute", don't reuse same adjective
- Read mentally: Does it sound repetitive? Revise.

# STYLE GUIDE: ${authorStyle.toUpperCase()}
${getAuthorStyleMarkers(authorStyle)}

# COHERENCE CHECKS (before finalizing)
Before outputting, verify:
1. Does this contradict any established facts from context? (NO contradictions allowed)
2. Are character voices consistent with their profiles? (Check dialogue)
3. Does the timeline make sense? (Events in logical order)
4. Are all mentioned characters actually in scene? (Check PRESENT list)
5. Does mood match target? (${mood} tone throughout)

# OUTPUT FORMAT
Raw prose only. No markdown, no section headers, no meta-commentary.
Start immediately with the scene. First line should hook reader.

# NOW GENERATE SCENE ${sceneNumber}
`;
};

/**
 * Expansion Pass Template - Enhance existing scene
 */
export const veniceExpansionPassPrompt = ({
  rawScene,
  focusAreas = ['sensory', 'emotion'],
  targetWordCount = 5500, // INCREASED: Was 1500, now 5500 for expanded scenes
  currentWordCount = 4000 // INCREASED: Was 1000, now 4000 baseline
}) => {
  const focusGuidance = {
    sensory: "Add 2-3 specific sensory details per paragraph (sight, sound, smell, touch, taste)",
    emotion: "Show internal emotion through physical reactions, micro-expressions, and introspection",
    atmosphere: "Build environmental mood through weather, lighting, ambient sounds, temperature",
    subtext: "Layer dialogue with body language, pauses, meaningful silences, unspoken tension",
    pacing: "Vary sentence rhythm: short for impact, long for introspection, fragments for intensity"
  };

  return `# ROLE
You are a professional fiction editor performing an expansion pass.

# TASK
Enhance this scene by expanding ${focusAreas.join(', ')} without changing plot beats.

# CRITICAL RULES
1. PRESERVE: Keep ALL plot beats and dialogue structure intact
2. EXPAND: Add depth, detail, and atmosphere
3. LENGTH: Expand from ${currentWordCount} to ~${targetWordCount} words
4. CONSISTENCY: Maintain original tone, voice, and POV
5. NO ADDITIONS: Don't add new events or characters, only enhance existing

# FOCUS AREAS
${focusAreas.map(area => `- ${area.toUpperCase()}: ${focusGuidance[area]}`).join('\n')}

# EXPANSION STRATEGY
For each paragraph:
1. Identify key moment or emotion
2. Add ${focusAreas.includes('sensory') ? 'sensory anchor' : 'emotional depth'}
3. ${focusAreas.includes('pacing') ? 'Vary sentence length for rhythm' : 'Maintain flow'}
4. Check: Does this enhance without padding?

# QUALITY CHECKLIST
✓ Every addition serves purpose (emotion, atmosphere, character)
✓ Sensory details are specific, not generic
✓ Expanded prose flows naturally
✗ NO padding with empty description
✗ NO adding unnecessary backstory dumps

# ORIGINAL SCENE (${currentWordCount} words)
${rawScene}

# OUTPUT
Enhanced scene with expanded ${focusAreas.join(' and ')}. Approximately ${targetWordCount} words.
`;
};

/**
 * Dialogue Enhancement Template - Make voices distinctive
 */
export const veniceDialogueEnhancementPrompt = ({
  scene,
  characters,
  conflict,
  subtext
}) => {
  return `# ROLE
You are a dialogue specialist enhancing character voices and subtext.

# TASK
Rewrite ONLY the dialogue in this scene to make it sharper, more distinctive, and layered with subtext.

# CRITICAL RULES
1. PRESERVE: Keep exact same events, actions, and plot beats
2. CHANGE: Only dialogue and dialogue tags/beats
3. VOICES: Each character must sound unique (see profiles below)
4. SUBTEXT: Characters have hidden agendas - surface meaning ≠ true meaning
5. NATURAL: Real people interrupt, trail off, speak in fragments, use filler words
6. CONFLICT: Underlying tension: ${conflict}

# CHARACTER VOICE PROFILES
${characters.map(c => `
${c.name}:
- Speech pattern: ${c.speech_pattern || 'standard'}
- Vocabulary: ${c.vocabulary_level || 'educated'}
- Speech tells: ${c.speech_tells || 'uses formal grammar'} // defensive mechanism
- Current emotion: ${c.current_emotion || 'neutral'}
- Hidden agenda: ${c.hidden_agenda || 'none'}
- Subtext: ${c.subtext || 'says what they mean'}
`).join('\n')}

# DIALOGUE QUALITY CHECKLIST
✓ Each character has DISTINCT voice (word choice, rhythm, formality)
✓ Subtext layered in every exchange (what they mean vs what they say)
✓ Interruptions and overlaps feel natural ("Wait, I—" "No, listen—")
✓ Body language punctuates dialogue ("He looked away. 'Fine.'")
✓ Silences are meaningful (beats of pause, trailing off)
✓ Dialogue reveals character (background, education, emotion)
✗ NO exposition dumps ("As you know, Bob...")
✗ NO perfectly formed sentences (unless that's character trait)
✗ NO everyone sounds the same
✗ NO dialogue tags every line (use action beats)

# SUBTEXT TECHNIQUE
For meaningful exchanges:
1. Character says surface statement
2. Action/reaction reveals true meaning
3. Other character responds to subtext, not surface

Example:
"I'm fine." (surface)
She crossed her arms, wouldn't meet his eyes. (subtext: not fine)
"Right." He stepped back. (responding to subtext)

# SCENE WITH WEAK DIALOGUE
${scene}

# OUTPUT
Same scene with enhanced dialogue. Keep all non-dialogue text unchanged.
Focus on making each voice distinct and loading subtext into exchanges.
`;
};

/**
 * Polish Pass Template - Final quality pass
 */
export const venicePolishPassPrompt = ({
  scene,
  authorStyle,
  targetMood,
  specificIssues = []
}) => {
  return `# ROLE
You are a line editor performing final polish pass.

# TASK
Refine this scene to match ${authorStyle} style and ${targetMood} mood with precision editing.

# CRITICAL RULES
1. TARGETED EDITS: Make surgical improvements, not wholesale rewrites
2. PRESERVE: Keep plot, characters, and dialogue structure
3. ENHANCE: Improve word choice, rhythm, and flow
4. STYLE: Match ${authorStyle}'s voice consistently
5. MOOD: Every element reinforces ${targetMood}

# POLISH CHECKLIST
1. RHYTHM: Scan for 3+ consecutive similar-length sentences → vary
2. WORD CHOICE: Replace weak/vague verbs with strong/specific verbs
   - "walked quickly" → "strode"
   - "said angrily" → "snapped"
3. REDUNDANCY: Cut filler words (very, really, just, quite, that, actually)
4. FLOW: Check transitions between beats - smooth or jarring?
5. STYLE: Does every sentence sound like ${authorStyle}?
6. MOOD: Does atmosphere consistently evoke ${targetMood}?
7. FILTER WORDS: Remove/rephrase "felt", "saw", "heard", "seemed"
8. PASSIVE VOICE: Convert to active where natural

${specificIssues.length > 0 ? `
# SPECIFIC ISSUES TO FIX
${specificIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}
` : ''}

# ${authorStyle.toUpperCase()} STYLE MARKERS
${getAuthorStyleMarkers(authorStyle)}

# MOOD: ${targetMood.toUpperCase()}
${getMoodMarkers(targetMood)}

# EDITING STRATEGY
1. Read through once - identify weak spots
2. Check rhythm - vary sentence length
3. Strengthen verbs - replace weak with strong
4. Cut redundancy - every word earns its place
5. Polish dialogue - make it sing
6. Final read - does it flow?

# SCENE TO POLISH
${scene}

# OUTPUT
Polished scene with targeted improvements. Maintain structure, enhance quality.
`;
};

/**
 * JSON Generation Template - Strict protocol for reliable JSON
 */
export const veniceJSONPrompt = ({
  task,
  schema,
  example,
  context = ''
}) => {
  return `# CRITICAL: JSON OUTPUT ONLY

You MUST return ONLY valid JSON. No markdown code fences, no commentary, no extra text.

# TASK
${task}

${context ? `# CONTEXT\n${context}\n` : ''}
# JSON SCHEMA (required structure)
${JSON.stringify(schema, null, 2)}

# REQUIRED FIELDS
${Object.keys(schema.properties || {}).map(k => {
  const prop = schema.properties[k];
  return `- ${k}: ${prop.type}${prop.description ? ` // ${prop.description}` : ''}`;
}).join('\n')}

# VALIDATION RULES (critical)
1. ALL required fields must be present
2. Field types must match schema exactly
3. Strings in double quotes, numbers without quotes
4. Arrays use [], objects use {}
5. No trailing commas
6. No comments (// or /* */)
7. No extra fields not in schema

# EXAMPLE (correct format)
${JSON.stringify(example, null, 2)}

# JSON OUTPUT PROTOCOL
Your response must:
- Start with { and end with }
- Be valid JSON (parseable by JSON.parse())
- Contain ONLY the JSON object
- Have NO text before or after the JSON
- Have NO markdown code fences

# BEFORE OUTPUTTING
Validate:
1. All required fields present? (${Object.keys(schema.properties || {}).join(', ')})
2. Types correct? (check each field)
3. Valid JSON syntax? (no trailing commas, quotes correct)
4. ONLY JSON? (no extra text)

# NOW GENERATE JSON
`;
};

/**
 * Get author-specific style markers
 */
function getAuthorStyleMarkers(authorStyle) {
  const styleMarkers = {
    'lovecraft': `- Archaic vocabulary: "eldritch", "cyclopean", "squamous", "antiquarian"
- Long, labyrinthine sentences with nested clauses
- First-person perspective with academic/observer tone
- Suggest horror through description, don't show directly
- Build atmosphere through adjective layering`,

    'king': `- Conversational, accessible prose with regional flavor
- Rich internal monologue and character psychology
- Mix mundane details with building dread
- Authentic dialogue with natural speech patterns
- Slow build to explosive horror moments`,

    'tolkien': `- Formal, elevated prose with archaic structures
- Deep world-building woven into narrative
- Multiple narrative voices (historian, poet, naturalist)
- Sense of deep history and larger events
- Slow, deliberate pacing with rich description`,

    'hemingway': `- Short, declarative sentences
- Minimal adjectives and adverbs
- Iceberg theory: 90% beneath surface
- Action and dialogue over introspection
- Sparse but precise description`,

    'detective_noir': `- First-person cynical narrator
- Hard-boiled dialogue, snappy comebacks
- Atmospheric urban settings (rain, neon, shadows)
- Similes and metaphors with punch
- Moral ambiguity and corruption themes`,

    'romance': `- Focus on emotional connection and internal conflict
- Sensual description of attraction and desire
- Building romantic tension through obstacles
- Rich emotional vocabulary
- Balance between heat and heart`,

    'modern fiction': `- Clear, accessible prose
- Third-person limited or close POV
- Balance description with action
- Natural dialogue
- Contemporary vocabulary`
  };

  return styleMarkers[authorStyle.toLowerCase()] || styleMarkers['modern fiction'];
}

/**
 * Get mood-specific markers
 */
function getMoodMarkers(mood) {
  const moodMarkers = {
    'tense': 'Short sentences. Sensory hyperawareness. Time pressure. Compressed descriptions.',
    'melancholic': 'Reflective tone. Longer sentences. Muted colors. Internal focus.',
    'playful': 'Light vocabulary. Humor. Quick pacing. Unexpected juxtapositions.',
    'dramatic': 'Heightened language. Strong emotions. Consequential stakes. Epic scope.',
    'mysterious': 'Withhold information. Suggest more than reveal. Questions. Shadows.',
    'romantic': 'Sensual details. Emotional awareness. Intimacy. Vulnerability.',
    'dark': 'Grim vocabulary. Harsh imagery. Moral ambiguity. Consequences.',
    'hopeful': 'Warm colors. Forward motion. Possibility. Connection.'
  };

  return moodMarkers[mood.toLowerCase()] || 'Consistent tone throughout.';
}

/**
 * Anti-repetition post-processor
 * Scans text for repeated phrases and logs warnings
 */
export const detectRepetition = (text, threshold = 2) => {
  const phrases = new Map(); // phrase -> count
  const words = text.toLowerCase().split(/\s+/);

  // Extract 2-4 word phrases
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      // Skip common phrases
      if (isCommonPhrase(phrase)) continue;
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }

  // Find repeated phrases
  const repetitions = Array.from(phrases.entries())
    .filter(([phrase, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase, count]) => ({ phrase, count }));

  if (repetitions.length > 0) {
    logger.warn(`[Venice] Detected ${repetitions.length} repeated phrases:`,
      repetitions.slice(0, 5).map(r => `"${r.phrase}" (${r.count}x)`).join(', ')
    );
  }

  return repetitions;
};

/**
 * Check if phrase is common/acceptable to repeat
 */
function isCommonPhrase(phrase) {
  const common = [
    'he said', 'she said', 'they said',
    'the door', 'the room', 'the street',
    'looked at', 'turned to', 'walked to',
    'in the', 'on the', 'to the', 'of the',
    'and the', 'but the', 'for the'
  ];
  return common.includes(phrase);
}

/**
 * Export all templates
 */
export default {
  veniceSceneGenerationPrompt,
  veniceExpansionPassPrompt,
  veniceDialogueEnhancementPrompt,
  venicePolishPassPrompt,
  veniceJSONPrompt,
  buildVeniceContext,
  compressCharacter,
  compressScene,
  detectRepetition,
  // Phase 5C: Granular Intensity Mapping
  getGranularIntensityInstruction,
  buildGranularIntensityBlock
};
