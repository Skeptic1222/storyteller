/**
 * Voice Director Agent
 *
 * A comprehensive LLM-based voice acting director that analyzes story content
 * and provides detailed ElevenLabs v3 delivery directions for each segment.
 *
 * This replaces the simplistic emotion detection with full audiobook-quality
 * voice direction that understands:
 * - Story context (genre, mood, themes)
 * - Character personalities and emotional arcs
 * - Scene dynamics and tension
 * - ElevenLabs v3 audio tag syntax and capabilities
 * - Voice settings (stability, style, speed through pacing tags)
 *
 * Output per segment:
 * - audio_tags: Natural language tags like [cautiously][with underlying fear]
 * - stability: 0.0-1.0 (lower = more expressive variation)
 * - style: 0.0-1.0 (style exaggeration)
 * - reasoning: Brief explanation for the choices
 */

import { logger, logAlert } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';
import { getGenreVoiceProfile, getCharacterTypeProfile } from '../genreVoiceProfiles.js';
import { getCharacterEmotion, getLineLevelAdjustments } from './characterVoiceProfileAgent.js';
import { repairVoiceDirectorJson } from '../../utils/jsonUtils.js';
import { getNarratorDeliveryDirectives } from './narratorDeliveryAgent.js';
import { analyzeSegmentEmotion } from './llmEmotionAnalyzer.js';
import { getArchetype } from '../narratorArchetypes.js';
import { getAgeProfile, getAgeAdjustedStability, isEmotionAppropriate, getAlternativeEmotion } from './ageEmotionProfiles.js';

/**
 * ElevenLabs V3 Supported Audio Tags
 * These are the officially supported tags that produce consistent results
 */
const ELEVENLABS_V3_OFFICIAL_TAGS = {
  emotions: ['excited', 'sad', 'angry', 'calm', 'fearful', 'surprised', 'whisper', 'shouting'],
  pauses: ['pause:0.5s', 'pause:1s', 'pause:1.5s', 'pause:2s']
};

// ElevenLabs v3 Audio Tags Reference (for the LLM prompt)
const ELEVENLABS_V3_REFERENCE = `
## ElevenLabs v3 Audio Tags Reference

Audio tags are natural language directions wrapped in square brackets that control voice delivery.
You can combine multiple tags for nuanced performances.

### Emotional Directions (combinable)
[happy], [sad], [angry], [fearful], [excited], [nervous], [tender], [loving]
[sarcastic], [dry], [deadpan], [ironic], [bitter], [resentful]
[mysterious], [ominous], [threatening], [menacing], [sinister]
[curious], [puzzled], [confused], [thoughtful], [contemplative]
[surprised], [shocked], [astonished], [incredulous]
[disgusted], [appalled], [revolted]
[hopeful], [wistful], [melancholy], [nostalgic]
[proud], [triumphant], [smug], [arrogant]
[humble], [meek], [shy], [timid]
[confident], [bold], [assertive], [commanding]
[desperate], [pleading], [begging]
[dismissive], [condescending], [patronizing]

### Delivery Style Tags
[whispers], [murmurs], [softly], [gently], [tenderly]
[shouts], [yells], [screams], [bellows]
[hisses], [growls], [snarls], [sneers]
[gasps], [breathlessly], [out of breath]
[firmly], [sternly], [sharply], [coldly]
[warmly], [kindly], [reassuringly]
[urgently], [frantically], [desperately]
[slowly], [deliberately], [measured], [drawn out]
[quickly], [rushed], [hurried], [rapid-fire]
[monotone], [flat], [emotionless]
[dramatic], [theatrical], [over-the-top]
[casual], [relaxed], [laid-back]
[formal], [stiff], [proper]

### Non-Verbal Sounds (use sparingly, at natural points)
[sighs], [sighs heavily], [sighs wistfully]
[laughs], [chuckles], [giggles], [snickers], [guffaws]
[cries], [sobs], [sniffles], [voice breaking]
[clears throat], [coughs], [snorts]
[inhales sharply], [exhales], [catches breath]
[groans], [moans], [whimpers]
[gasps], [gulps]

### Pacing Tags (INLINE SUPPORT)
[short pause], [long pause], [beat], [hesitates]
[trails off...], [interrupted-]
[pause:0.5s], [pause:1s], [pause:1.5s], [pause:2s]

**PHRASE-LEVEL PAUSES**: Insert pause tags MID-SENTENCE for dramatic effect:
"I know who killed him... [pause:1s] It was you."
"The door opened, [pause:0.5s] and there she stood."
"We have [pause:0.5s] a problem."

### Context/Scene Tags (for overall tone)
[intimate], [private conversation]
[public speech], [addressing a crowd]
[storytelling], [narrating]
[internal monologue], [thinking aloud]

### Combination Examples
"[whispers][nervously][glancing around] I think we're being watched."
"[sighs heavily][resigned][with quiet determination] Fine. I'll do it myself."
"[laughs][bitterly][shaking head] You really thought I'd believe that?"
"[slowly][ominously][building tension] And then... the door opened."
"[excited][breathlessly][can barely contain it] You won't BELIEVE what I found!"

### Voice Settings Guidance
- stability (0.0-1.0): Lower = more emotional variation, Higher = more consistent
  - 0.2-0.4: Intense emotion, crying, rage, terror
  - 0.4-0.6: Normal emotional dialogue
  - 0.6-0.8: Calm narration, measured speech
  - 0.8-1.0: Monotone, robotic, or very controlled

- style (0.0-1.0): Style exaggeration
  - 0.0-0.3: Subtle, naturalistic
  - 0.3-0.6: Normal expressiveness
  - 0.6-0.8: Theatrical, dramatic
  - 0.8-1.0: Over-the-top, extreme
`;

/**
 * Inject V3-compliant audio tags based on character profile and context
 *
 * @param {Object} characterProfile - Character voice profile from characterVoiceProfileAgent
 * @param {Object} lineContext - Context about the current line
 * @param {string} emotionalState - Current emotional state from story
 * @returns {Object} V3 tags and voice adjustments
 */
function injectV3AudioTags(characterProfile, lineContext, emotionalState) {
  const tags = [];
  const adjustments = {};

  // Get emotion from character profile based on emotional state
  if (characterProfile) {
    const emotion = getCharacterEmotion(characterProfile, emotionalState);
    if (emotion && ELEVENLABS_V3_OFFICIAL_TAGS.emotions.includes(emotion)) {
      tags.push(`[${emotion}]`);
    }

    // Get line-level adjustments from speech patterns
    const lineAdjust = getLineLevelAdjustments(characterProfile, lineContext);
    if (lineAdjust.tags) {
      // Filter to only include V3-compliant tags
      lineAdjust.tags.forEach(tag => {
        const tagContent = tag.replace(/[\[\]]/g, '');
        if (ELEVENLABS_V3_OFFICIAL_TAGS.emotions.includes(tagContent) ||
            ELEVENLABS_V3_OFFICIAL_TAGS.pauses.some(p => tagContent.startsWith('pause:'))) {
          if (!tags.includes(tag)) {
            tags.push(tag);
          }
        }
      });
    }
    if (lineAdjust.adjustments) {
      Object.assign(adjustments, lineAdjust.adjustments);
    }
  }

  // Add pause based on context
  if (lineContext.isDramatic && tags.length < 3) {
    tags.push('[pause:1s]');
  } else if (lineContext.isTransition && tags.length < 3) {
    tags.push('[pause:0.5s]');
  }

  return { tags, adjustments };
}

/**
 * Apply genre voice profile defaults to a segment
 *
 * @param {string} genre - Story genre
 * @param {string} speakerType - 'narrator' or character role
 * @param {Object} existingSettings - Current voice settings
 * @returns {Object} Enhanced voice settings
 */
function applyGenreDefaults(genre, speakerType, existingSettings = {}) {
  try {
    const genreProfile = getGenreVoiceProfile(genre);
    if (!genreProfile) {
      return existingSettings;
    }

    const defaults = speakerType === 'narrator'
      ? genreProfile.narrator
      : getCharacterTypeProfile(speakerType, genre);

    if (!defaults) {
      return existingSettings;
    }

    // Apply genre defaults, but don't override explicit settings
    return {
      stability: existingSettings.stability ?? defaults.stability ?? defaults.defaultStability ?? 0.5,
      style: existingSettings.style ?? defaults.style ?? defaults.defaultStyle ?? 0.5,
      speedModifier: existingSettings.speedModifier ?? defaults.tempoModifier ?? 1.0,
      emotionBias: defaults.emotionBias || ['calm'],
      ...existingSettings
    };
  } catch (error) {
    logger.warn(`[VoiceDirector] Failed to apply genre defaults: ${error.message}`);
    return existingSettings;
  }
}

/**
 * MEDIUM-14 FIX: Enhanced V3 emotion mapping with tag combinations
 *
 * Single V3 tags can't capture nuanced emotions like "mysterious" or "tender".
 * This mapping uses TAG COMBINATIONS to create more accurate delivery:
 * - mysterious → [whisper][fearful] - quiet dread
 * - tender/loving → [calm] + low stability - warm expressiveness
 * - ominous → [whisper][angry] - menacing quiet
 *
 * Format: keyword → [primaryTag, secondaryTag] or just primaryTag
 */
const V3_COMBINATION_MAPPINGS = {
  // === MYSTERIOUS/OMINOUS - Use whisper + emotional undertone ===
  // These should NOT map to calm - they need tension/dread
  'mysterious': ['whisper', 'fearful'],    // Quiet with underlying unease
  'ominous': ['whisper', 'angry'],         // Quiet menace
  'foreboding': ['whisper', 'fearful'],    // Dread-filled quiet
  'sinister': ['whisper', 'angry'],        // Evil whisper
  'eerie': ['whisper', 'fearful'],         // Unsettling quiet
  'cryptic': ['whisper', 'calm'],          // Mysterious but controlled
  'enigmatic': ['whisper', 'calm'],        // Puzzling quiet
  'dark': ['whisper', 'angry'],            // Dark undertone

  // === MENACING/THREATENING - Controlled anger ===
  // Cold fury is scarier than shouting
  'menacing': ['angry', 'whisper'],        // Dangerous quiet
  'threatening': ['angry', 'whisper'],     // Threatening undercurrent
  'intimidating': ['angry', 'calm'],       // Controlled power
  'dangerous': ['angry', 'whisper'],       // Quiet danger

  // === TENDER/LOVING - Warm with expression ===
  // These need emotional variation, not flatness
  'tender': ['calm', 'sad'],               // Gentle with emotional depth
  'loving': ['excited', 'calm'],           // Warmth with positive energy
  'affectionate': ['excited', 'calm'],     // Warm positivity
  'adoring': ['excited', 'calm'],          // Deep warmth
  'caring': ['calm', 'sad'],               // Gentle concern
  'nurturing': ['calm', 'sad'],            // Protective gentleness

  // === SARCASTIC/MOCKING - Deadpan with edge ===
  'sarcastic': ['calm', 'angry'],          // Controlled with bite
  'mocking': ['excited', 'angry'],         // Gleeful meanness
  'sardonic': ['calm', 'angry'],           // Dry with edge
  'contemptuous': ['angry', 'calm'],       // Cold disdain

  // === DESPERATE/PLEADING - Fear with urgency ===
  'desperate': ['fearful', 'shouting'],    // Panicked urgency
  'pleading': ['fearful', 'sad'],          // Emotional begging
  'begging': ['fearful', 'sad'],           // Deep desperation
  'imploring': ['fearful', 'sad'],         // Earnest plea

  // === TRIUMPHANT/VICTORIOUS - Joy with power ===
  'triumphant': ['excited', 'shouting'],   // Victorious energy
  'victorious': ['excited', 'shouting'],   // Celebratory power
  'exultant': ['excited', 'shouting'],     // Overwhelming joy

  // === HORRIFIED/TRAUMATIC - Fear with sadness ===
  'horrified': ['fearful', 'sad'],         // Shock and grief
  'traumatized': ['fearful', 'sad'],       // Deep distress
  'devastated': ['sad', 'fearful'],        // Crushing blow

  // === CONFLICTED/TORN - Mixed emotions ===
  'conflicted': ['sad', 'angry'],          // Internal struggle
  'torn': ['sad', 'fearful'],              // Emotional turmoil
  'anguished': ['sad', 'angry'],           // Pain and frustration

  // === SENSUAL/INTIMATE - Quiet intensity ===
  'sensual': ['whisper', 'excited'],       // Charged intimacy
  'seductive': ['whisper', 'excited'],     // Alluring quiet
  'sultry': ['whisper', 'excited'],        // Heated whisper
  'passionate': ['excited', 'whisper'],    // Intense but intimate
  'heated': ['excited', 'angry'],          // Charged emotion
  'yearning': ['sad', 'whisper'],          // Longing intimacy
};

// Age emotion defaults are now imported from ageEmotionProfiles.js for comprehensive profiles

/**
 * Scene mood to emotion mapping for fallback defaults
 */
const SCENE_MOOD_EMOTIONS = {
  tense: 'fearful',
  suspenseful: 'fearful',
  action: 'excited',
  exciting: 'excited',
  battle: 'shouting',
  emotional: 'sad',
  sad: 'sad',
  melancholy: 'sad',
  happy: 'excited',
  romantic: 'whisper',
  mysterious: 'whisper',
  scary: 'fearful',
  horror: 'fearful',
  angry: 'angry',
  confrontational: 'angry'
};

/**
 * Get a context-aware default emotion instead of always using [calm].
 * This prevents flat character delivery by considering:
 * - Character age group (children shouldn't default to calm)
 * - Scene mood (tense scenes shouldn't default to calm)
 * - Genre conventions
 * - Character's emotional profile if available
 *
 * @param {Object} context - Context for emotion selection
 * @param {string} context.ageGroup - Character age: child, teen, young_adult, adult, elderly
 * @param {string} context.sceneMood - Current scene mood
 * @param {string} context.genre - Story genre
 * @param {Object} context.characterProfile - Character voice profile with emotional_range
 * @param {string} context.speakerType - 'narrator' or character role
 * @returns {string} V3-compliant emotion tag
 */
function getContextAwareDefaultEmotion(context = {}) {
  const { ageGroup, sceneMood, genre, characterProfile, speakerType } = context;

  // 1. Check character profile for default emotion first
  if (characterProfile?.emotional_range?.default) {
    const profileDefault = characterProfile.emotional_range.default.toLowerCase();
    if (ELEVENLABS_V3_OFFICIAL_TAGS.emotions.includes(profileDefault)) {
      logger.debug(`[VoiceDirector] Context default from profile: [${profileDefault}]`);
      return `[${profileDefault}]`;
    }
  }

  // 2. Narrator defaults to calm (narration should be stable)
  if (speakerType === 'narrator') {
    return '[calm]';
  }

  // 3. Age-based default for characters (using comprehensive ageEmotionProfiles)
  // Children and teens should NEVER default to calm - they have bigger emotions
  if (ageGroup) {
    const ageProfile = getAgeProfile(ageGroup);
    const ageDefault = ageProfile.defaultEmotion;

    // For children and teens, always use their age default unless scene overrides
    if (ageGroup === 'child' || ageGroup === 'teen') {
      logger.debug(`[VoiceDirector] Context default from age (${ageGroup}): [${ageDefault}] | bias: ${ageProfile.emotionBias.join(', ')}`);
      return `[${ageDefault}]`;
    }
  }

  // 4. Scene mood influence (for adult characters)
  if (sceneMood && SCENE_MOOD_EMOTIONS[sceneMood.toLowerCase()]) {
    const moodEmotion = SCENE_MOOD_EMOTIONS[sceneMood.toLowerCase()];
    logger.debug(`[VoiceDirector] Context default from mood (${sceneMood}): [${moodEmotion}]`);
    return `[${moodEmotion}]`;
  }

  // 5. Genre-based bias (action genres should be more dynamic)
  const actionGenres = ['action', 'adventure', 'thriller', 'horror', 'fantasy'];
  const romanticGenres = ['romance', 'drama', 'literary'];
  if (genre) {
    const genreLower = genre.toLowerCase();
    if (actionGenres.some(g => genreLower.includes(g))) {
      logger.debug(`[VoiceDirector] Context default from genre (${genre}): [excited]`);
      return '[excited]';
    }
    if (romanticGenres.some(g => genreLower.includes(g))) {
      logger.debug(`[VoiceDirector] Context default from genre (${genre}): [calm]`);
      return '[calm]';
    }
  }

  // 6. Use age profile default if available, otherwise calm
  if (ageGroup) {
    const ageProfile = getAgeProfile(ageGroup);
    return `[${ageProfile.defaultEmotion}]`;
  }

  // 7. Ultimate fallback: calm
  return '[calm]';
}

/**
 * Convert natural language audio tags to V3-compliant format
 * Maps common emotional descriptors to official V3 tags
 *
 * IMPORTANT: ElevenLabs V3 only supports 8 official emotion tags:
 * excited, sad, angry, calm, fearful, surprised, whisper, shouting
 * All other tags are IGNORED by the API. This function ensures we always
 * produce valid V3 tags that will actually affect speech synthesis.
 *
 * MEDIUM-14 FIX: Now uses combination mappings for nuanced emotions that
 * can't be represented by a single V3 tag (e.g., mysterious → [whisper][fearful])
 *
 * @param {string} audioTags - Natural language audio tags from LLM
 * @param {Object} context - Optional context for fallback emotion selection
 * @param {string} context.ageGroup - Character age: child, teen, adult, elderly
 * @param {string} context.sceneMood - Current scene mood
 * @param {string} context.genre - Story genre
 * @param {Object} context.characterProfile - Character voice profile
 * @param {string} context.speakerType - 'narrator' or character role
 * @returns {string} V3-compliant audio tags
 */
function convertToV3Tags(audioTags, context = {}) {
  const defaultEmotion = getContextAwareDefaultEmotion(context);
  if (!audioTags) return defaultEmotion;

  // COMPREHENSIVE mapping from descriptive keywords to OFFICIAL V3 emotions
  // ElevenLabs V3 ONLY supports: excited, sad, angry, calm, fearful, surprised, whisper, shouting
  const tagMapping = {
    // === EXCITED variants (joy, happiness, enthusiasm) ===
    'happy': 'excited', 'joyful': 'excited', 'elated': 'excited', 'thrilled': 'excited',
    'enthusiastic': 'excited', 'eager': 'excited', 'delighted': 'excited', 'ecstatic': 'excited',
    'gleeful': 'excited', 'jubilant': 'excited', 'cheerful': 'excited', 'merry': 'excited',
    'playful': 'excited', 'energetic': 'excited', 'lively': 'excited', 'animated': 'excited',
    // triumphant/proud now in combination mappings for more power
    'smug': 'excited', 'proud': 'excited',

    // === SAD variants (grief, melancholy, sorrow) ===
    'melancholy': 'sad', 'sorrowful': 'sad', 'grief': 'sad', 'mournful': 'sad',
    'dejected': 'sad', 'heartbroken': 'sad', 'wistful': 'sad', 'forlorn': 'sad',
    'despondent': 'sad', 'gloomy': 'sad', 'miserable': 'sad', 'depressed': 'sad',
    'somber': 'sad', 'tearful': 'sad', 'weeping': 'sad', 'crying': 'sad',
    'remorseful': 'sad', 'regretful': 'sad', 'guilty': 'sad', 'ashamed': 'sad',
    'nostalgic': 'sad', 'longing': 'sad', 'pining': 'sad',
    // yearning now in combination mappings for intimacy

    // === ANGRY variants (fury, rage, irritation) ===
    'furious': 'angry', 'enraged': 'angry', 'irritated': 'angry', 'frustrated': 'angry',
    'seething': 'angry', 'bitter': 'angry', 'hostile': 'angry', 'resentful': 'angry',
    'annoyed': 'angry', 'livid': 'angry', 'incensed': 'angry', 'indignant': 'angry',
    'outraged': 'angry', 'irate': 'angry', 'fuming': 'angry', 'wrathful': 'angry',
    'hateful': 'angry', 'disgusted': 'angry', 'scornful': 'angry',
    'defiant': 'angry', 'rebellious': 'angry', 'challenging': 'angry', 'confrontational': 'angry',
    'aggressive': 'angry',
    // threatening/menacing/intimidating now in combination mappings for quiet menace

    // === CALM variants (peace, serenity, gentleness) ===
    'peaceful': 'calm', 'serene': 'calm', 'relaxed': 'calm', 'gentle': 'calm',
    'soothing': 'calm', 'warm': 'calm', 'kind': 'calm',
    'composed': 'calm', 'tranquil': 'calm', 'placid': 'calm', 'mellow': 'calm',
    'measured': 'calm', 'steady': 'calm', 'controlled': 'calm', 'patient': 'calm',
    'thoughtful': 'calm', 'contemplative': 'calm', 'reflective': 'calm', 'pensive': 'calm',
    'confident': 'calm', 'assured': 'calm', 'poised': 'calm', 'dignified': 'calm',
    'professional': 'calm', 'formal': 'calm', 'polite': 'calm', 'courteous': 'calm',
    'wise': 'calm', 'sagely': 'calm', 'knowing': 'calm', 'understanding': 'calm',
    'conversational': 'calm', 'neutral': 'calm', 'matter-of-fact': 'calm', 'straightforward': 'calm',
    'casual': 'calm', 'friendly': 'calm', 'amiable': 'calm', 'pleasant': 'calm',
    // NOTE: mysterious/ominous/sinister etc. NOW use combination mappings (not calm!)
    // Sarcasm moved to combination mappings for proper edge
    'dry': 'calm', 'deadpan': 'calm', 'ironic': 'calm', 'wry': 'calm',
    'dismissive': 'calm',
    // tender/loving now in combination mappings for warmth

    // === FEARFUL variants (terror, anxiety, dread) ===
    'terrified': 'fearful', 'scared': 'fearful', 'anxious': 'fearful', 'nervous': 'fearful',
    'frightened': 'fearful', 'panicked': 'fearful', 'worried': 'fearful', 'afraid': 'fearful',
    'petrified': 'fearful', 'trembling': 'fearful', 'shaking': 'fearful',
    'apprehensive': 'fearful', 'uneasy': 'fearful', 'tense': 'fearful', 'on edge': 'fearful',
    'dreading': 'fearful', 'alarmed': 'fearful', 'distressed': 'fearful', 'frantic': 'fearful',
    // desperate/pleading/begging now in combination mappings
    'hesitant': 'fearful', 'uncertain': 'fearful', 'timid': 'fearful', 'shy': 'fearful',
    'stammering': 'fearful', 'stuttering': 'fearful', 'faltering': 'fearful', 'wavering': 'fearful',
    // horrified now in combination mappings for shock+grief

    // === SURPRISED variants (shock, astonishment, disbelief) ===
    'shocked': 'surprised', 'astonished': 'surprised', 'amazed': 'surprised', 'astounded': 'surprised',
    'startled': 'surprised', 'stunned': 'surprised', 'bewildered': 'surprised', 'dumbfounded': 'surprised',
    'incredulous': 'surprised', 'disbelieving': 'surprised', 'skeptical': 'surprised', 'doubtful': 'surprised',
    'confused': 'surprised', 'puzzled': 'surprised', 'perplexed': 'surprised', 'baffled': 'surprised',
    'curious': 'surprised', 'intrigued': 'surprised', 'questioning': 'surprised', 'wondering': 'surprised',

    // === WHISPER variants (quiet, soft, intimate) ===
    'softly': 'whisper', 'quietly': 'whisper', 'murmurs': 'whisper', 'hushed': 'whisper',
    'secretive': 'whisper', 'confidential': 'whisper', 'private': 'whisper',
    'whispers': 'whisper', 'murmuring': 'whisper', 'breathily': 'whisper', 'sotto voce': 'whisper',
    'low': 'whisper', 'faint': 'whisper', 'barely audible': 'whisper', 'muted': 'whisper',
    'hissing': 'whisper', 'sibilant': 'whisper', 'conspiratorial': 'whisper', 'covert': 'whisper',
    'reverent': 'whisper', 'awed': 'whisper', 'respectful': 'whisper', 'solemn': 'whisper',
    // intimate/sensual now in combination mappings for charged delivery

    // === SHOUTING variants (yelling, screaming, loud) ===
    'yells': 'shouting', 'screams': 'shouting', 'bellows': 'shouting', 'roars': 'shouting',
    'shouts': 'shouting', 'exclaims': 'shouting', 'cries out': 'shouting', 'hollers': 'shouting',
    'loud': 'shouting', 'booming': 'shouting', 'thundering': 'shouting', 'commanding': 'shouting',
    'urgent': 'shouting', 'emphatic': 'shouting', 'forceful': 'shouting', 'powerful': 'shouting',
    'dramatic': 'shouting', 'theatrical': 'shouting', 'declamatory': 'shouting', 'proclamatory': 'shouting',
    'warning': 'shouting', 'alarming': 'shouting', 'alerting': 'shouting', 'announcing': 'shouting'
  };

  const tagsLower = audioTags.toLowerCase();
  let officialV3Tags = [];

  // STEP 0 (MEDIUM-14 FIX): Check combination mappings FIRST for nuanced emotions
  // These provide better emotional accuracy than single-tag mappings
  for (const [keyword, combination] of Object.entries(V3_COMBINATION_MAPPINGS)) {
    if (tagsLower.includes(keyword)) {
      // Add both tags from the combination
      if (Array.isArray(combination)) {
        combination.forEach(emotion => {
          const tag = `[${emotion}]`;
          if (!officialV3Tags.includes(tag)) {
            officialV3Tags.push(tag);
          }
        });
        logger.debug(`[VoiceDirector] COMBINATION_MATCH: "${keyword}" → ${combination.map(e => `[${e}]`).join('')}`);
      }
      // Found a combination match - don't look for more (prevents tag bloat)
      if (officialV3Tags.length >= 2) break;
    }
  }

  // STEP 1: Extract existing bracket tags and check if they're official V3 or mappable
  // (Only if no combination matches found)
  if (officialV3Tags.length === 0) {
    const existingBracketTags = audioTags.match(/\[[a-z][a-z_\-\s]*\]/gi) || [];

    for (const tag of existingBracketTags) {
      const tagContent = tag.toLowerCase().replace(/[\[\]]/g, '').trim();

      // Check if it's already an official V3 tag
      if (ELEVENLABS_V3_OFFICIAL_TAGS.emotions.includes(tagContent)) {
        const officialTag = `[${tagContent}]`;
        if (!officialV3Tags.includes(officialTag)) {
          officialV3Tags.push(officialTag);
        }
      }
      // Check combination mappings for bracket content
      else if (V3_COMBINATION_MAPPINGS[tagContent]) {
        const combination = V3_COMBINATION_MAPPINGS[tagContent];
        if (Array.isArray(combination)) {
          combination.forEach(emotion => {
            const combTag = `[${emotion}]`;
            if (!officialV3Tags.includes(combTag)) {
              officialV3Tags.push(combTag);
            }
          });
        }
      }
      // Check if it can be mapped to an official V3 tag
      else if (tagMapping[tagContent]) {
        const mappedTag = `[${tagMapping[tagContent]}]`;
        if (!officialV3Tags.includes(mappedTag)) {
          officialV3Tags.push(mappedTag);
        }
      }
    }
  }

  // STEP 2: If no official tags found from brackets, check raw text for keywords
  if (officialV3Tags.length === 0) {
    // First try official V3 keywords directly
    for (const emotion of ELEVENLABS_V3_OFFICIAL_TAGS.emotions) {
      if (tagsLower.includes(emotion)) {
        const officialTag = `[${emotion}]`;
        if (!officialV3Tags.includes(officialTag)) {
          officialV3Tags.push(officialTag);
        }
      }
    }

    // Then try mappable keywords (combination mappings already checked in STEP 0)
    if (officialV3Tags.length === 0) {
      for (const [keyword, v3Emotion] of Object.entries(tagMapping)) {
        if (tagsLower.includes(keyword)) {
          const mappedTag = `[${v3Emotion}]`;
          if (!officialV3Tags.includes(mappedTag)) {
            officialV3Tags.push(mappedTag);
          }
        }
      }
    }
  }

  // STEP 3: Extract any pause tags (these are always valid)
  const pauseMatch = tagsLower.match(/\[pause:(\d+\.?\d*)s\]/g);
  if (pauseMatch) {
    pauseMatch.forEach(p => {
      if (!officialV3Tags.includes(p)) {
        officialV3Tags.push(p);
      }
    });
  }

  // STEP 4: ALWAYS ensure we have at least one emotion tag
  // This is critical - never return empty tags
  // Now uses context-aware default instead of always [calm] (fixes flat character delivery)
  if (officialV3Tags.filter(t => !t.includes('pause')).length === 0) {
    officialV3Tags.unshift(defaultEmotion);
  }

  // Limit to 3 tags max (V3 recommendation)
  const result = officialV3Tags.slice(0, 3).join('');

  // Log conversion for debugging
  logger.debug(`[VoiceDirector] V3 Tag Conversion: "${audioTags}" → "${result}"`);

  return result;
}

function hasUsableV3Tags(tagString) {
  if (!tagString || typeof tagString !== 'string') return false;
  return /\[[^\]]+\]/.test(tagString.trim());
}

/**
 * Build the system prompt for voice direction
 * @param {Object} archetype - Optional narrator archetype for constrained direction
 */
function buildSystemPrompt(archetype = null) {
  // Build archetype constraints if available
  let archetypeGuidance = '';
  if (archetype) {
    const preferredTags = archetype.preferredV3Tags?.join(', ') || 'none specified';
    const avoidTags = archetype.avoidV3Tags?.join(', ') || 'none specified';
    const emotionalStrengths = archetype.emotionalStrengths?.join(', ') || 'none specified';
    const emotionalWeaknesses = archetype.emotionalWeaknesses?.join(', ') || 'none specified';

    archetypeGuidance = `
## NARRATOR ARCHETYPE: ${archetype.name}
**CRITICAL: Honor this archetype's direction for all NARRATOR segments.**
- Archetype Description: ${archetype.description || 'N/A'}
- Delivery Style: ${archetype.deliveryNotes || 'Standard delivery'}
- PREFERRED V3 Tags: ${preferredTags}
- AVOID V3 Tags: ${avoidTags}
- Emotional Strengths (lean into): ${emotionalStrengths}
- Emotional Weaknesses (minimize/adapt): ${emotionalWeaknesses}
- Pause Frequency: ${archetype.pauseFrequency || 'medium'}
- Voice Stability Range: ${archetype.voiceSettings?.stability || 0.5}
- Style Exaggeration: ${archetype.voiceSettings?.style || 0.5}

**Narrator Direction Rules for this Archetype:**
1. Use tags from PREFERRED list when possible
2. NEVER use tags from AVOID list for narrator
3. Lean into emotional strengths - these are the archetype's specialty
4. When emotional weaknesses are needed, adapt them to fit the archetype's style
5. Match pause frequency: ${archetype.pauseFrequency === 'high' ? 'Use [pause:1s] and [pause:1.5s] frequently' : archetype.pauseFrequency === 'low' ? 'Use pauses sparingly' : 'Use natural pause rhythm'}
`;
  }

  return `You are an expert audiobook voice director with deep knowledge of vocal performance, emotional delivery, and the ElevenLabs v3 text-to-speech system.
${archetypeGuidance}

Your job is to analyze story segments and provide precise voice acting direction for EACH line, considering:

1. **Story Context**: Genre conventions, target audience, overall tone
2. **Scene Dynamics**: What's happening, the tension level, emotional beats
3. **Character Psychology**: Personality, current emotional state, relationships, what they're hiding
4. **Subtext**: What's beneath the surface that affects delivery
5. **Pacing**: How this moment fits in the narrative flow
6. **Contrast**: Varying delivery to avoid monotony

For NARRATOR segments:
- Narrators are NOT neutral readers - they're storytellers with emotional investment
- Match energy to content: action scenes need urgency, quiet moments need intimacy
- Use pacing variation: slow down for important revelations, speed up for action
- Transitions need distinct treatment from action descriptions
- Build and release tension through delivery

For CHARACTER dialogue:
- Each character should have consistent vocal identity
- Emotions should be SPECIFIC, not generic (not just "angry" but "seething with barely contained fury")
- Consider what the character is trying to accomplish with their words
- Physical state affects voice (injured, tired, drunk, cold, etc.)
- Relationship dynamics affect how characters speak to each other

## AGE-APPROPRIATE VOICE DIRECTION ★ CRITICAL ★
Age dramatically affects appropriate emotional defaults and delivery styles.
NEVER use adult emotional defaults for children!

### CHILD (0-12):
- **Emotional Defaults**: [excited], [surprised], [fearful] - BIG emotions, fast shifts
- **AVOID as default**: [calm], [measured], [controlled] - children are rarely calm
- **Stability**: 0.25-0.45 (lower = more expressive variation, which suits children)
- **Delivery Notes**: High energy, enthusiastic, bigger emotional swings
- **Speech Patterns**: Shorter sentences, simpler words, may stumble over big words
- Tags: [excitedly][eagerly][wide-eyed][bouncing with energy][in awe]

### TEEN (13-17):
- **Emotional Defaults**: [excited], [angry], [sad] - dramatic, emotionally volatile
- **Stability**: 0.35-0.55 (moderate expressiveness)
- **Delivery Notes**: Dramatic reactions, eye-rolling sarcasm, passionate outbursts
- **Speech Patterns**: May switch between childish and attempting mature
- Tags: [with dramatic emphasis][rolling eyes][sighing heavily][with teenage intensity]

### YOUNG ADULT (18-29):
- **Emotional Defaults**: Full range, context-dependent
- **Stability**: 0.4-0.6 (normal range)
- **Delivery Notes**: Finding their voice, may overcompensate with confidence

### ADULT (30-55):
- **Emotional Defaults**: [calm] is acceptable as default, more controlled expression
- **Stability**: 0.5-0.7 (more controlled)
- **Delivery Notes**: Measured, but can have full emotional range when triggered

### ELDERLY (65+):
- **Emotional Defaults**: [calm], [sad], [whisper] - measured, warm, or weary
- **AVOID**: [shouting], extreme energy levels
- **Stability**: 0.6-0.8 (more consistent, weathered)
- **Delivery Notes**: Slower pace, wisdom in tone, may tire vocally
- Tags: [wearily][with aged wisdom][warmly][with quiet authority][reminiscently]

## PHYSICAL STATE INDICATORS
When characters are in specific physical states, adjust voice direction accordingly:
- **Running/Exertion**: Add breathlessness with "..." pauses, faster pace, stability 0.3-0.4
  Tags: [breathlessly][gasping][out of breath][panting]
- **Injury/Pain**: Lower stability (0.2-0.4), add strain indicators, slower delivery
  Tags: [strained][through gritted teeth][voice breaking][weakly]
- **Illness**: Slower pace, weaker delivery, stability 0.4-0.5
  Tags: [weakly][hoarsely][with effort][faintly]
- **Intoxication**: Slightly varied pacing, lower stability (0.2-0.4)
  Tags: [slurred][unsteadily][with effort][loosely]
- **Cold/Shivering**: Clipped speech, trembling delivery
  Tags: [teeth chattering][shivering][haltingly][through shivers]
- **Crying/Emotional breakdown**: Very low stability (0.1-0.3), voice breaking
  Tags: [voice breaking][through tears][sniffling][sobbing]
- **Exhaustion**: Slower pace, lower energy, stability 0.4-0.5
  Tags: [wearily][tiredly][with effort][dragging]

## SUBTEXT GUIDANCE
Consider what the character is NOT saying - the subtext affects delivery:
- **Lying**: Subtle hesitation, forced casualness, too-smooth delivery
  Tags: [too casually][hesitant][forced cheerfulness][carefully]
- **Hiding emotion**: Forced calm, controlled delivery, slight strain
  Tags: [with forced calm][tightly controlled][barely maintaining composure]
- **Sarcasm**: Use unexpected emotion tags - saying positive words with negative tone
  Tags: [drily][flatly][with mock enthusiasm][sarcastically]
- **Suppressed anger**: Calm surface with underlying tension
  Tags: [with dangerous calm][icily][too quietly][with steel beneath]
- **Secret knowledge**: Knowing tone, subtle smugness
  Tags: [knowingly][with hidden meaning][cryptically][meaningfully]
- **Attraction they won't admit**: Heightened awareness, subtle tension
  Tags: [with studied indifference][too casually][slightly breathless]
- **Fear they're masking**: Over-confidence, bravado
  Tags: [with false bravado][too confidently][loudly][overcompensating]

${ELEVENLABS_V3_REFERENCE}

CRITICAL RULES:
1. NEVER use generic single-word emotions - always be specific and combinable
2. Audio tags should paint a picture of HOW to deliver the line
3. Vary stability/style across segments - not everything should be the same
4. Include pacing cues where appropriate
5. Non-verbal sounds should be used deliberately, not randomly
6. Consider the CONTRAST between adjacent segments
7. Match intensity to story genre - children's stories stay lighter, thrillers go darker

PHRASE-LEVEL DRAMATIC PAUSES (CRITICAL for emotional impact):
- Insert [pause:0.5s], [pause:1s], or [pause:2s] WITHIN dialogue for dramatic beats
- Use pauses before revelations: "The killer was... [pause:1s] your brother."
- Use pauses after shocking statements: "She's dead. [pause:0.5s] I saw it happen."
- Use hesitation pauses for uncertainty: "I... [pause:0.5s] I don't know what to say."
- Use pauses for emphasis: "This is [pause:0.5s] unacceptable."
- Characters with 'emphasizes_key_words' trait should have MORE phrase-level pauses
- Characters with 'uses_dramatic_pauses' trait should pause before key revelations

AUDIENCE-SPECIFIC CONSTRAINTS:
- **Kids/Children**: Keep delivery warm, playful, and reassuring. Avoid scary/threatening tones.
  Use tags like [gently], [warmly], [playfully], [excitedly]. Stability 0.5-0.8.
- **General/Family**: Balanced emotional range. Keep intense moments appropriate for all ages.
  Moderate use of dramatic and mysterious tones. Stability 0.4-0.7.
- **Mature/Adult**: Full emotional range available. Can go darker, more intense, more nuanced.
  Use visceral tags like [seething], [devastated], [menacing], [sensually]. Stability 0.2-0.6.
  Horror scenes can be truly terrifying. Romantic scenes can be intimate and charged.`;
}

/**
 * Build the user prompt with story context and segments
 */
function buildUserPrompt(segments, context) {
  const { genre, mood, audience, sceneDescription, characters, previousScene, title, contentIntensity } = context;

  // Build character reference with detailed traits and speech patterns
  let characterInfo = '';
  if (characters && characters.length > 0) {
    characterInfo = '\n\n## CHARACTER PROFILES\n';
    characters.forEach(char => {
      const traits = parseCharacterTraits(char);
      const traitList = traits.personality || traits.traits || [];
      characterInfo += `\n### ${char.name}`;
      if (char.role) characterInfo += ` (${char.role})`;
      characterInfo += '\n';
      // Age group is CRITICAL for voice direction - affects emotional defaults
      if (char.age_group && char.age_group !== 'adult') {
        characterInfo += `- ★ Age Group: ${char.age_group.toUpperCase()} ★\n`;
      } else if (char.age_group) {
        characterInfo += `- Age Group: ${char.age_group}\n`;
      }
      if (traitList.length > 0) {
        characterInfo += `- Personality: ${Array.isArray(traitList) ? traitList.join(', ') : traitList}\n`;
      }
      if (char.description) {
        characterInfo += `- Description: ${char.description.substring(0, 200)}\n`;
      }
      if (char.voice_description) {
        characterInfo += `- Voice: ${char.voice_description}\n`;
      }
      // Include speech patterns for prosody guidance
      if (char.speech_patterns) {
        const patterns = [];
        if (char.speech_patterns.emphasizes_key_words) patterns.push('emphasizes key words');
        if (char.speech_patterns.uses_dramatic_pauses) patterns.push('uses dramatic pauses');
        if (char.speech_patterns.speaks_quickly_when_nervous) patterns.push('speaks fast when nervous');
        if (char.speech_patterns.whispers_secrets) patterns.push('whispers important info');
        if (char.speech_patterns.shouts_in_anger) patterns.push('shouts when angry');
        if (char.speech_patterns.trails_off_when_uncertain) patterns.push('trails off with doubt');
        if (patterns.length > 0) {
          characterInfo += `- Speech Patterns: ${patterns.join(', ')}\n`;
        }
      }
      if (char.signature_delivery) {
        characterInfo += `- Signature Delivery: ${char.signature_delivery}\n`;
      }
      if (char.characteristic_tags && char.characteristic_tags.length > 0) {
        characterInfo += `- Characteristic Tags: ${char.characteristic_tags.join(' ')}\n`;
      }
    });
  }

  // Build content intensity guidance
  let intensityGuidance = '';
  if (contentIntensity) {
    const { violence, gore, adultContent, romance, sensuality, explicitness, isViolent, isErotic, isMature } = contentIntensity;

    if (isMature) {
      intensityGuidance = '\n\n## CONTENT INTENSITY GUIDANCE\n';
      intensityGuidance += `**This is MATURE content - use intense, visceral voice direction.**\n\n`;

      if (isViolent) {
        intensityGuidance += `### VIOLENT CONTENT (violence: ${violence}/100, gore: ${gore}/100)\n`;
        intensityGuidance += `- Use terrifying, menacing, brutal delivery\n`;
        intensityGuidance += `- For horror: [ominously], [with cold menace], [terrifyingly], [with barely contained rage]\n`;
        intensityGuidance += `- For action: [with deadly intensity], [through gritted teeth], [coldly], [savagely]\n`;
        intensityGuidance += `- Narrator should build dread and tension\n`;
        intensityGuidance += `- Characters can scream, beg, threaten with real emotion\n`;
        intensityGuidance += `- Stability: 0.2-0.4 for high intensity moments\n\n`;
      }

      if (isErotic) {
        intensityGuidance += `### ROMANTIC/EROTIC CONTENT\n`;
        intensityGuidance += `**Levels:** adult: ${adultContent}/100, romance: ${romance}/100, sensuality: ${sensuality || 0}/100, explicitness: ${explicitness || 0}/100\n\n`;

        // Adjust delivery based on sensuality level
        if (sensuality >= 60 || explicitness >= 50) {
          intensityGuidance += `**HIGH SENSUALITY MODE:**\n`;
          intensityGuidance += `- Use deeply sensual, charged delivery for intimate scenes\n`;
          intensityGuidance += `- Tags: [huskily], [breathlessly], [with building heat], [intimately], [with raw desire]\n`;
          intensityGuidance += `- Narrator should be evocative and lingering on sensual details\n`;
          intensityGuidance += `- Characters can express intense physical and emotional desire\n`;
          intensityGuidance += `- Stability: 0.25-0.45 for charged intensity\n\n`;
        } else {
          intensityGuidance += `- Use sensual, intimate, passionate delivery\n`;
          intensityGuidance += `- Tags: [breathlessly], [with desire], [intimately], [sensually], [huskily]\n`;
          intensityGuidance += `- Narrator can be evocative and intimate\n`;
          intensityGuidance += `- Characters can express desire openly\n`;
          intensityGuidance += `- Stability: 0.3-0.5 for emotional intensity\n\n`;
        }
      }

      if (!isViolent && !isErotic && isMature) {
        intensityGuidance += `### MATURE THEMES\n`;
        intensityGuidance += `- Full emotional range available\n`;
        intensityGuidance += `- Can use darker, more intense delivery\n`;
        intensityGuidance += `- Characters can express complex, adult emotions\n\n`;
      }
    }
  }

  // Build segments list with context
  let segmentList = '\n## SEGMENTS TO DIRECT\n';
  segmentList += '\nAnalyze each segment and provide voice direction:\n';

  segments.forEach((seg, idx) => {
    const speakerLabel = seg.speaker === 'narrator' ? 'NARRATOR' : seg.speaker;
    segmentList += `\n[${idx}] **${speakerLabel}**`;
    if (seg.attribution && seg.speaker !== 'narrator') {
      segmentList += ` (${seg.attribution})`;
    }
    segmentList += `\n"${seg.text}"\n`;
  });

  return `## STORY CONTEXT
- Title: ${title || 'Untitled'}
- Genre: ${genre || 'general fiction'}
- Mood: ${mood || 'neutral'}
- Target Audience: ${audience || 'general'}
${intensityGuidance}
## CURRENT SCENE
${sceneDescription || 'No specific scene description provided.'}
${previousScene ? `\n## PREVIOUS CONTEXT\n${previousScene}` : ''}
${characterInfo}
${segmentList}

## YOUR TASK
For EACH segment [index], provide voice direction as JSON:

\`\`\`json
{
  "directions": [
    {
      "index": 0,
      "speaker": "CharacterName or NARRATOR",
      "audio_tags": "[tag1][tag2][tag3]",
      "stability": 0.5,
      "style": 0.4,
      "reasoning": "Brief explanation of delivery choices"
    }
  ]
}
\`\`\`

REQUIREMENTS:
- audio_tags: 2-4 combinable tags that paint a specific delivery picture
- stability: 0.0-1.0 based on emotional intensity needed
- style: 0.0-1.0 based on expressiveness needed
- Include ALL segments (both narrator and dialogue)
- Be SPECIFIC - avoid generic directions like just "[angry]" or "[sad]"
- Consider contrast between adjacent segments`;
}

/**
 * Parse and validate LLM response with robust JSON repair
 */
function parseDirections(content, segments) {
  // Use robust JSON repair that handles common LLM formatting issues
  const result = repairVoiceDirectorJson(content);

  if (!result) {
    logger.error(`[VoiceDirector] Failed to parse LLM response after all repair strategies`);
    logger.debug(`[VoiceDirector] Raw content (first 500 chars): ${content?.substring(0, 500)}`);
    logger.debug(`[VoiceDirector] Raw content (last 300 chars): ${content?.substring(Math.max(0, content.length - 300))}`);
    return new Map();
  }

  const directions = result.directions || [];
  logger.info(`[VoiceDirector] Parsed ${directions.length} directions from LLM response`);

  // Create a map of index -> direction
  const directionMap = new Map();
  directions.forEach(d => {
    // Validate and clamp values
    const stability = Math.max(0, Math.min(1, d.stability ?? 0.5));
    const style = Math.max(0, Math.min(1, d.style ?? 0.3));

    // Ensure audio_tags is a string with brackets
    let audioTags = d.audio_tags || '';
    if (audioTags && !audioTags.includes('[')) {
      audioTags = `[${audioTags}]`;
    }

    directionMap.set(d.index, {
      audio_tags: audioTags,
      stability,
      style,
      reasoning: d.reasoning || ''
    });
  });

  // Log coverage statistics
  const expectedCount = segments.length;
  const actualCount = directionMap.size;
  if (actualCount < expectedCount) {
    logger.warn(`[VoiceDirector] Partial directions: ${actualCount}/${expectedCount} segments covered`);
  }

  return directionMap;
}

/**
 * Apply voice direction to segments with V3 tag conversion
 *
 * @param {Array} segments - Dialogue segments
 * @param {Map} directionMap - LLM direction map
 * @param {Object} context - Story context with genre and character profiles
 */
async function applyDirections(segments, directionMap, context = {}) {
  const { genre, mood, characterProfiles } = context;

  const totalSegments = segments.length;
  let directionsApplied = 0;
  let fallbacksUsed = 0;

  const result = await Promise.all(segments.map(async (seg, idx) => {
    const direction = directionMap.get(idx);

    // ENHANCED LOGGING: Progress every 50 segments for visibility
    if (idx > 0 && idx % 50 === 0) {
      logger.info(`[VoiceDirector] Progress: ${idx}/${totalSegments} segments directed (${Math.round((idx / totalSegments) * 100)}%)`);
    }

    // Get character profile if available
    const characterProfile = characterProfiles?.get?.(seg.speaker) || null;

    if (direction) {
      directionsApplied++;

      // Build context for V3 tag conversion (prevents flat [calm] default for all characters)
      const speakerType = seg.speaker === 'narrator' ? 'narrator' : seg.characterRole || 'supporting';
      const conversionContext = {
        ageGroup: seg.ageGroup || characterProfile?.age_group || 'adult',
        sceneMood: mood,
        genre: genre,
        characterProfile: characterProfile,
        speakerType: speakerType
      };

      // Convert natural language tags to V3-compliant format with context-aware defaults
      const v3Tags = convertToV3Tags(direction.audio_tags, conversionContext);
      const genreDefaults = applyGenreDefaults(genre, speakerType, {
        stability: direction.stability,
        style: direction.style
      });

      // Use character profile base_settings if available, fall back to genre defaults
      // This ensures character personality affects voice delivery (stability, style, speed)
      let finalStability = characterProfile?.base_settings?.stability ?? genreDefaults.stability;
      const finalStyle = characterProfile?.base_settings?.style ?? genreDefaults.style;
      const finalSpeedModifier = characterProfile?.base_settings?.speed_modifier ?? genreDefaults.speedModifier ?? 1.0;

      // Apply speech pattern adjustments for emphasis and prosody
      if (characterProfile?.speech_patterns) {
        // Lower stability for characters who emphasize key words (more variation in delivery)
        if (characterProfile.speech_patterns.emphasizes_key_words) {
          finalStability = Math.max(0.15, finalStability - 0.1);
        }
        // Lower stability for dramatic pause users (more emotional range)
        if (characterProfile.speech_patterns.uses_dramatic_pauses) {
          finalStability = Math.max(0.15, finalStability - 0.05);
        }
      }

      // ENHANCED LOGGING: INFO level for tag conversion visibility
      const profileSource = characterProfile?.base_settings ? 'profile' : 'genre';
      logger.info(`[VoiceDirector] Segment[${idx}] ${seg.speaker}: "${direction.audio_tags}" → V3: "${v3Tags}" | stability=${finalStability?.toFixed(2)} style=${finalStyle?.toFixed(2)} (${profileSource})`);

      // COT REASONING LOG: Chain-of-thought decision logging for debugging and analysis
      if (direction.reasoning) {
        logger.info(`[VoiceDirector-COT] Segment[${idx}] ${seg.speaker}: ${direction.reasoning.substring(0, 150)}${direction.reasoning.length > 150 ? '...' : ''}`);
      }

      return {
        ...seg,
        // Voice direction outputs
        delivery: direction.audio_tags,           // Keep natural language for logging/debugging
        v3AudioTags: v3Tags,                      // V3-compliant tags for ElevenLabs
        voiceStability: finalStability,
        voiceStyle: finalStyle,
        voiceSpeedModifier: finalSpeedModifier,
        voiceReasoning: direction.reasoning,
        voiceDirected: true,
        // Map audio_tags to emotion for preset lookup (extract primary emotion)
        emotion: extractPrimaryEmotion(direction.audio_tags) || seg.emotion || 'neutral',
        // Character profile reference
        characterVoiceProfile: characterProfile
      };
    }

    // Graceful fallback for missing directions (enables partial JSON salvage)
    fallbacksUsed++;
    logger.warn(`[VoiceDirector] No direction for segment ${idx} (${seg.speaker}) - using LLM emotion fallback`);

    // Apply genre-based fallback defaults
    const fallbackSpeakerType = seg.speaker === 'narrator' ? 'narrator' : seg.characterRole || 'supporting';
    const genreDefaults = applyGenreDefaults(genre, fallbackSpeakerType, {});

    // Use character profile if available for fallback
    let finalStability = characterProfile?.base_settings?.stability ?? genreDefaults.stability ?? 0.5;
    const finalStyle = characterProfile?.base_settings?.style ?? genreDefaults.style ?? 0.3;
    let finalSpeedModifier = characterProfile?.base_settings?.speed_modifier ?? genreDefaults.speedModifier ?? 1.0;

    // Context-aware fallback default (prevents flat [calm] for children, action scenes, etc.)
    const fallbackContext = {
      ageGroup: seg.ageGroup || characterProfile?.age_group || 'adult',
      sceneMood: mood,
      genre: genre,
      characterProfile: characterProfile,
      speakerType: fallbackSpeakerType
    };
    let fallbackTags = getContextAwareDefaultEmotion(fallbackContext);
    let fallbackReasoning = 'Fallback: LLM direction missing';

    try {
      const llmAnalysis = await analyzeSegmentEmotion(seg, {
        genre: genre,
        mood: mood || 'neutral',
        sceneDescription: context.sceneDescription || '',
        narratorStyle: context.narratorStyle || 'auto'
      });

      if (llmAnalysis && llmAnalysis.v3AudioTags) {
        fallbackTags = llmAnalysis.v3AudioTags;
        finalSpeedModifier = llmAnalysis.speed_modifier || finalSpeedModifier;
        fallbackReasoning = `LLM Fallback: ${llmAnalysis.delivery_notes || llmAnalysis.v3_emotion}`;
        logger.info(`[VoiceDirector] LLM fallback for segment ${idx}: ${fallbackTags} (${llmAnalysis.intensity}% intensity)`);
      }
    } catch (llmError) {
      logger.debug(`[VoiceDirector] LLM fallback failed for segment ${idx}, using genre defaults: ${llmError.message}`);
    }

    return {
      ...seg,
      delivery: fallbackTags,
      v3AudioTags: fallbackTags,
      voiceStability: finalStability,
      voiceStyle: finalStyle,
      voiceSpeedModifier: finalSpeedModifier,
      voiceReasoning: fallbackReasoning,
      voiceDirected: false,  // Mark as not directed for tracking
      emotion: seg.emotion || 'neutral',
      characterVoiceProfile: characterProfile
    };
  }));

  // ENHANCED LOGGING: Summary statistics with fallback count
  logger.info(`[VoiceDirector] COMPLETE: ${totalSegments} segments | ${directionsApplied} directed | ${fallbacksUsed} fallbacks`);

  // Warn if too many fallbacks (indicates significant LLM parsing issues)
  const fallbackRatio = fallbacksUsed / totalSegments;
  if (fallbackRatio > 0.2) {
    logger.warn(`[VoiceDirector] HIGH_FALLBACK_RATIO: ${(fallbackRatio * 100).toFixed(1)}% of segments used fallback defaults`);
  }

  return result;
}

/**
 * Second-pass refinement to guarantee ElevenLabs v3 tags for every dialogue line.
 * Uses an additional LLM call to densify or add tags when the first pass is sparse.
 */
async function refineMissingTags(directedSegments, context, sessionId) {
  const lacking = directedSegments
    .map((seg, idx) => ({ seg, idx }))
    .filter(({ seg }) =>
      seg.speaker !== 'narrator' &&
      !hasUsableV3Tags(seg.v3AudioTags) &&
      !hasUsableV3Tags(seg.delivery)
    );

  if (lacking.length === 0) {
    return { segments: directedSegments, refined: 0 };
  }

  logger.info(`[VoiceDirector] Refinement pass: ${lacking.length} segments missing v3 tags`);

  const prompt = {
    role: 'user',
    content: `
You are an ElevenLabs v3 tag refiner.
For each dialogue line below, return concise v3 audio tags (1-3 tags) that capture delivery and emotion.
Use ONLY bracketed tags (e.g., [whispers][fearfully][pause:0.5s]). Do NOT return plain prose.
If stability/style tweaks are needed, include values 0.0-1.0.

Return JSON:
{
  "fixes": [
    { "index": <segment index>, "v3_tags": "[whispers][urgent]", "delivery": "[whispers][urgent]", "stability": 0.35, "style": 0.7, "reason": "brief note" }
  ]
}

Context: genre=${context.genre || 'unknown'}, mood=${context.mood || 'unknown'}, audience=${context.audience || 'general'}.
Segments:
${lacking.map(({ seg, idx }) => `- index ${idx} | speaker=${seg.speaker} | text="${seg.text.substring(0, 220)}"`).join('\n')}
`.trim()
  };

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You produce strict JSON with ElevenLabs v3 audio tags only.' },
      prompt
    ],
    model: 'gpt-4o',
    agent_name: 'VoiceDirectorRefiner',
    agent_category: 'voice_direction',
    temperature: 0.4,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    forceProvider: 'openai',
    sessionId
  });

  const content = response?.content;
  if (!content) {
    const msg = '[VoiceDirector] Refinement returned empty content';
    logAlert('error', msg, { sessionId });
    throw new Error(msg);
  }

  let fixes;
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    fixes = parsed.fixes || [];
  } catch (err) {
    const msg = `[VoiceDirector] Failed to parse refinement response: ${err.message}`;
    logAlert('error', msg, { raw: content?.substring?.(0, 400) });
    throw new Error(msg);
  }

  const updated = directedSegments.map((seg, idx) => {
    const fix = fixes.find(f => f.index === idx);
    if (!fix) return seg;

    const tagCandidate = fix.v3_tags || fix.v3AudioTags || fix.delivery || '';
    if (!hasUsableV3Tags(tagCandidate)) {
      const msg = `[VoiceDirector] Refinement produced unusable tags for segment ${idx}`;
      logAlert('warn', msg, { speaker: seg.speaker, text: seg.text?.slice(0, 80) });
      return seg;
    }

    return {
      ...seg,
      v3AudioTags: tagCandidate.trim(),
      delivery: fix.delivery || seg.delivery,
      voiceStability: typeof fix.stability === 'number' ? fix.stability : seg.voiceStability,
      voiceStyle: typeof fix.style === 'number' ? fix.style : seg.voiceStyle,
      voiceDirected: true,
      voiceReasoning: `${seg.voiceReasoning || ''} | refined: ${fix.reason || 'v3 tags added'}`
    };
  });

  const stillMissing = updated.filter(s => s.speaker !== 'narrator' && !hasUsableV3Tags(s.v3AudioTags));
  if (stillMissing.length > 0) {
    const msg = `[VoiceDirector] FAIL_LOUD: ${stillMissing.length} segments still missing v3 tags after refinement`;
    logAlert('error', msg, { indices: stillMissing.map(s => s.speaker).join(',') });
    throw new Error(msg);
  }

  logger.info(`[VoiceDirector] Refinement applied to ${fixes.length} segments`);
  return { segments: updated, refined: fixes.length };
}

/**
 * Genre-specific narrator fallback tags for expressive narration.
 * Used when narrator segments lack emotional direction.
 */
const GENRE_NARRATOR_TAGS = {
  horror: ['ominous', 'foreboding', 'creeping', 'dread', 'hushed'],
  thriller: ['tense', 'urgent', 'measured', 'suspenseful', 'clipped'],
  mystery: ['intriguing', 'measured', 'probing', 'contemplative'],
  romance: ['warm', 'intimate', 'flowing', 'tender', 'wistful'],
  erotica: ['sensual', 'intimate', 'breathy', 'languid', 'heated'],
  fantasy: ['wondrous', 'epic', 'measured', 'sweeping', 'mythic'],
  scifi: ['measured', 'contemplative', 'vast', 'clinical', 'wondering'],
  drama: ['weighted', 'measured', 'emotive', 'resonant', 'poignant'],
  comedy: ['light', 'playful', 'rhythmic', 'wry', 'bouncy'],
  adventure: ['energetic', 'sweeping', 'building', 'breathless', 'bold'],
  literary: ['contemplative', 'measured', 'nuanced', 'layered', 'reflective'],
  children: ['warm', 'gentle', 'playful', 'magical', 'soothing']
};

/**
 * Scene mood to narrator emotion mapping
 */
const SCENE_MOOD_NARRATOR_TAGS = {
  tense: ['tense', 'measured', 'clipped'],
  peaceful: ['serene', 'flowing', 'gentle'],
  dark: ['ominous', 'weighted', 'hushed'],
  romantic: ['warm', 'intimate', 'tender'],
  action: ['urgent', 'breathless', 'building'],
  sad: ['somber', 'weighted', 'quiet'],
  joyful: ['bright', 'warm', 'flowing'],
  mysterious: ['intriguing', 'measured', 'probing'],
  frightening: ['dread', 'hushed', 'creeping'],
  triumphant: ['soaring', 'triumphant', 'building'],
  intimate: ['soft', 'intimate', 'tender'],
  climactic: ['building', 'intense', 'dramatic']
};

/**
 * Narrator refinement pass - adds emotional tags to flat narrator segments.
 * Unlike dialogue refinement, this focuses on atmospheric/pacing tags.
 */
async function refineNarratorTags(directedSegments, context, sessionId) {
  // Find narrator segments that lack emotional direction
  const narratorSegments = directedSegments
    .map((seg, idx) => ({ seg, idx }))
    .filter(({ seg }) => {
      if (seg.speaker !== 'narrator') return false;

      // Check if narrator has meaningful emotional tags (not just [calm][measured])
      const tags = (seg.v3AudioTags || seg.delivery || '').toLowerCase();
      const hasGenericOnly = /^\[calm\]\[measured\]$/.test(tags.trim()) ||
                            tags === '' ||
                            tags === '[neutral]' ||
                            tags === '[measured]';

      // Also check if segment text suggests emotion that should be expressed
      const textHints = detectNarratorEmotionFromText(seg.text);

      return hasGenericOnly || textHints.needsEnhancement;
    });

  if (narratorSegments.length === 0) {
    logger.debug('[VoiceDirector] Narrator refinement: No segments need enhancement');
    return { segments: directedSegments, refined: 0 };
  }

  logger.info(`[VoiceDirector] Narrator refinement: ${narratorSegments.length} segments may need emotional enhancement`);

  // For small numbers, use heuristic-based enhancement (faster, no LLM call)
  if (narratorSegments.length <= 5) {
    return heuristicNarratorEnhancement(directedSegments, narratorSegments, context);
  }

  // For larger batches, use LLM for contextual enhancement
  // Include scene-level narrator delivery as baseline guidance if available
  const sceneDelivery = context.narratorDelivery;
  const sceneDeliveryInfo = sceneDelivery
    ? `\nScene-level narrator direction (baseline): emotion=${sceneDelivery.emotion}, delivery="${sceneDelivery.delivery || 'none'}", stability=${sceneDelivery.voiceSettingsOverride?.stability || 'default'}`
    : '';

  const prompt = {
    role: 'user',
    content: `
You are enhancing NARRATOR voice direction for expressive audio narration.
NARRATORS SHOULD NEVER BE FLAT OR MONOTONE. Even calm narration has emotional undertones.

Genre: ${context.genre || 'general'}
Overall mood: ${context.mood || 'varied'}
Audience: ${context.audience || 'general'}${sceneDeliveryInfo}

NARRATOR EMOTIONAL GUIDELINES:
- Foreshadowing → [ominous][foreboding][measured]
- Action sequences → [urgent][tense][quickened]
- Emotional reveals → [tender][bittersweet][weighted]
- Horror moments → [dread][creeping][hushed]
- Triumph scenes → [soaring][triumphant][building]
- Romantic passages → [warm][intimate][flowing]
- Mystery build-up → [intriguing][measured][probing]
- Sad moments → [somber][weighted][quiet]
- Climactic moments → [building][intense][dramatic]

Use the scene-level direction as a baseline, but vary delivery based on each segment's specific content.

Return JSON with narrator enhancements:
{
  "enhancements": [
    { "index": <segment index>, "tags": "[ominous][foreboding]", "stability": 0.35, "reason": "brief note" }
  ]
}

Narrator segments to enhance:
${narratorSegments.map(({ seg, idx }) => `- index ${idx} | current_tags="${seg.v3AudioTags || seg.delivery || 'none'}" | text="${seg.text.substring(0, 180)}..."`).join('\n')}
`.trim()
  };

  try {
    const response = await callLLM({
      messages: [
        { role: 'system', content: 'You produce strict JSON for narrator voice enhancement. Focus on atmospheric, pacing, and emotional undertone tags.' },
        prompt
      ],
      model: 'gpt-4o-mini', // Lighter model for narrator refinement
      agent_name: 'NarratorRefiner',
      agent_category: 'voice_direction',
      temperature: 0.5,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      forceProvider: 'openai',
      sessionId
    });

    const content = response?.content;
    if (!content) {
      logger.warn('[VoiceDirector] Narrator refinement returned empty - using heuristic fallback');
      return heuristicNarratorEnhancement(directedSegments, narratorSegments, context);
    }

    let enhancements;
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      enhancements = parsed.enhancements || [];
    } catch (err) {
      logger.warn(`[VoiceDirector] Failed to parse narrator refinement: ${err.message} - using heuristic`);
      return heuristicNarratorEnhancement(directedSegments, narratorSegments, context);
    }

    // Apply enhancements
    const updated = directedSegments.map((seg, idx) => {
      const enhancement = enhancements.find(e => e.index === idx);
      if (!enhancement || seg.speaker !== 'narrator') return seg;

      const newTags = enhancement.tags || '';
      if (!newTags) return seg;

      return {
        ...seg,
        v3AudioTags: newTags.trim(),
        delivery: newTags.trim(),
        voiceStability: typeof enhancement.stability === 'number' ? enhancement.stability : seg.voiceStability,
        voiceDirected: true,
        narratorRefined: true,
        voiceReasoning: `${seg.voiceReasoning || ''} | narrator refined: ${enhancement.reason || 'emotional enhancement'}`
      };
    });

    const refinedCount = enhancements.filter(e => e.tags).length;
    logger.info(`[VoiceDirector] Narrator refinement enhanced ${refinedCount} segments`);

    return { segments: updated, refined: refinedCount };

  } catch (error) {
    logger.warn(`[VoiceDirector] Narrator LLM refinement failed: ${error.message} - using heuristic`);
    return heuristicNarratorEnhancement(directedSegments, narratorSegments, context);
  }
}

/**
 * Detect if narrator text suggests emotion that should be reflected in delivery
 */
function detectNarratorEmotionFromText(text) {
  if (!text) return { needsEnhancement: false };

  const textLower = text.toLowerCase();

  // High-emotion indicators that should trigger narrator enhancement
  const highEmotionPatterns = [
    /scream|shriek|howl|wail|sob|cry out/i,
    /terror|horror|dread|fear gripped/i,
    /heart (pounded|raced|stopped)/i,
    /blood (ran cold|froze|drained)/i,
    /suddenly|without warning|in an instant/i,
    /darkness (swallowed|consumed|engulfed)/i,
    /whisper(ed|ing)? (of|from|in) (the|their)/i,
    /triumphant|victory|elation/i,
    /tears (streamed|fell|welled)/i,
    /passion(ate)?|desire|longing/i
  ];

  // Medium-emotion indicators
  const mediumEmotionPatterns = [
    /quiet(ly)?|soft(ly)?|gentle|tender/i,
    /tension|tense|nervous/i,
    /mysterious|strange|eerie|uncanny/i,
    /urgent|hurried|rushed/i,
    /sad(ness)?|sorrow|grief/i,
    /joy(ful)?|happy|delight/i
  ];

  for (const pattern of highEmotionPatterns) {
    if (pattern.test(textLower)) {
      return { needsEnhancement: true, intensity: 'high' };
    }
  }

  for (const pattern of mediumEmotionPatterns) {
    if (pattern.test(textLower)) {
      return { needsEnhancement: true, intensity: 'medium' };
    }
  }

  return { needsEnhancement: false };
}

/**
 * Heuristic-based narrator enhancement (no LLM call)
 * Uses genre, scene-level narrator delivery, and text analysis to add appropriate tags
 */
function heuristicNarratorEnhancement(allSegments, narratorItems, context) {
  const genre = (context.genre || 'general').toLowerCase();
  const genreTags = GENRE_NARRATOR_TAGS[genre] || ['measured', 'clear', 'engaging'];

  // Get scene-level narrator delivery from NarratorDeliveryAgent (if available)
  const sceneDelivery = context.narratorDelivery;
  const sceneDeliveryTags = sceneDelivery?.delivery
    ? (sceneDelivery.delivery.match(/\[([^\]]+)\]/g) || []).map(t => t.slice(1, -1))
    : null;
  const sceneStability = sceneDelivery?.voiceSettingsOverride?.stability;
  const sceneStyle = sceneDelivery?.voiceSettingsOverride?.style;

  if (sceneDeliveryTags) {
    logger.debug(`[VoiceDirector] Using NarratorDelivery scene-level tags as baseline: ${sceneDeliveryTags.join(', ')}`);
  }

  let refined = 0;

  const updated = allSegments.map((seg, idx) => {
    const item = narratorItems.find(n => n.idx === idx);
    if (!item) return seg;

    // Analyze text for emotion hints
    const textAnalysis = detectNarratorEmotionFromText(seg.text);
    const textLower = (seg.text || '').toLowerCase();

    let tags = [];
    let stability = sceneStability ?? 0.5; // Use scene-level stability as default
    let style = sceneStyle;
    let source = 'heuristic';

    // Check for specific text patterns and assign appropriate tags
    // Text-specific patterns override scene-level defaults
    if (/scream|shriek|terror|horror/i.test(textLower)) {
      tags = ['dread', 'hushed', 'creeping'];
      stability = 0.25;
      source = 'text-pattern:terror';
    } else if (/whisper|quiet|soft/i.test(textLower)) {
      tags = ['soft', 'hushed', 'intimate'];
      stability = 0.45;
      source = 'text-pattern:soft';
    } else if (/sudden|burst|explod/i.test(textLower)) {
      tags = ['urgent', 'quickened', 'intense'];
      stability = 0.3;
      source = 'text-pattern:sudden';
    } else if (/heart|emotion|tear|cry/i.test(textLower)) {
      tags = ['weighted', 'tender', 'emotive'];
      stability = 0.4;
      source = 'text-pattern:emotional';
    } else if (/triumph|victory|joy/i.test(textLower)) {
      tags = ['soaring', 'bright', 'building'];
      stability = 0.35;
      source = 'text-pattern:triumph';
    } else if (/dark|shadow|night|doom/i.test(textLower)) {
      tags = ['ominous', 'weighted', 'measured'];
      stability = 0.4;
      source = 'text-pattern:dark';
    } else if (/passion|desire|love/i.test(textLower)) {
      tags = ['warm', 'intimate', 'flowing'];
      stability = 0.4;
      source = 'text-pattern:passion';
    } else if (sceneDeliveryTags && sceneDeliveryTags.length > 0) {
      // Use scene-level delivery from NarratorDeliveryAgent as fallback
      tags = sceneDeliveryTags.slice(0, 3);
      stability = sceneStability ?? (genre === 'horror' ? 0.35 : genre === 'thriller' ? 0.4 : 0.5);
      source = 'scene-delivery';
    } else {
      // Use genre defaults with slight variation
      tags = genreTags.slice(0, 2);
      stability = genre === 'horror' ? 0.35 : genre === 'thriller' ? 0.4 : 0.5;
      source = 'genre-default';
    }

    const newTagStr = tags.map(t => `[${t}]`).join('');

    refined++;
    const result = {
      ...seg,
      v3AudioTags: newTagStr,
      delivery: newTagStr,
      voiceStability: stability,
      voiceDirected: true,
      narratorRefined: true,
      voiceReasoning: `${seg.voiceReasoning || ''} | narrator ${source}: ${tags.join(', ')}`
    };

    // Apply scene-level style if available and not overridden
    if (style !== undefined && style !== null) {
      result.voiceStyle = style;
    }

    return result;
  });

  logger.info(`[VoiceDirector] Narrator heuristic enhancement applied to ${refined} segments`);
  return { segments: updated, refined };
}

/**
 * Extract primary emotion from audio tags for preset lookup
 */
function extractPrimaryEmotion(audioTags) {
  if (!audioTags) return null;

  // Common emotion keywords to extract (including mature content tags)
  const emotionKeywords = {
    // Anger spectrum
    'angry': 'angry', 'furious': 'furious', 'rage': 'angry', 'seething': 'angry',
    // Sadness spectrum
    'sad': 'sad', 'grief': 'grieving', 'sorrow': 'sad', 'melancholy': 'melancholy',
    // Joy spectrum
    'happy': 'warm', 'joyful': 'joyful', 'excited': 'excited', 'elated': 'excited',
    // Fear spectrum
    'fearful': 'fearful', 'terrified': 'terrified', 'nervous': 'nervous', 'anxious': 'nervous',
    // Volume/Delivery
    'whisper': 'whispered', 'murmur': 'murmured', 'softly': 'tender',
    'shout': 'shouted', 'yell': 'shouted', 'scream': 'terrified',
    // Mystery/Menace
    'mysterious': 'mysterious', 'ominous': 'mysterious', 'sinister': 'sinister',
    'menac': 'menacing', 'threat': 'threatening', 'dark': 'sinister',
    // Tenderness
    'tender': 'tender', 'loving': 'loving', 'gentle': 'tender',
    // Complex
    'sarcastic': 'sarcastic', 'dry': 'sarcastic', 'ironic': 'sarcastic',
    'dramatic': 'dramatic', 'theatrical': 'dramatic',
    'calm': 'calm_bedtime', 'peaceful': 'calm_bedtime', 'soothing': 'calm_bedtime',
    // Horror/Violence (mature content)
    'brutal': 'brutal', 'savage': 'brutal', 'deadly': 'brutal',
    'bloodthirst': 'bloodthirsty', 'fury': 'bloodthirsty',
    'agony': 'agonized', 'screaming': 'agonized', 'pain': 'agonized',
    'torment': 'tormented', 'gritted': 'tormented',
    'predator': 'predatory', 'hungri': 'predatory',
    'unhinged': 'unhinged', 'mad': 'unhinged', 'crazed': 'unhinged',
    'chill': 'chilling', 'icy': 'chilling', 'terrifying': 'chilling',
    // Intimate/Romantic (mature content)
    'passionate': 'passionate', 'passionately': 'passionate',
    'sensual': 'sensual', 'desire': 'sensual',
    'intimate': 'intimate', 'intimately': 'intimate',
    'yearn': 'yearning', 'longing': 'yearning',
    'husky': 'heated', 'heated': 'heated', 'seductiv': 'seductive'
  };

  const tagsLower = audioTags.toLowerCase();
  for (const [keyword, emotion] of Object.entries(emotionKeywords)) {
    if (tagsLower.includes(keyword)) {
      return emotion;
    }
  }

  return null;
}

// Batching constants - LLM can generate ~50 directions per 3000 tokens
const MAX_SEGMENTS_PER_BATCH = 50;
const BATCH_MAX_TOKENS = 3500;
const PARALLEL_BATCH_COUNT = 3; // Process up to 3 batches concurrently for ~3x speedup

/**
 * Direct voice acting for all segments in a scene
 * Automatically batches large segment counts to avoid hitting token limits
 *
 * @param {Array} segments - Dialogue segments from parseDialogueSegments
 * @param {Object} context - Story/scene context
 * @param {string} sessionId - Session ID for tracking
 * @returns {Promise<Array>} Segments with voice direction applied
 */
export async function directVoiceActing(segments, context, sessionId = null) {
  if (!segments || segments.length === 0) {
    logger.info('[VoiceDirector] No segments to direct');
    return segments;
  }

  const segmentCount = segments.length;
  logger.info(`[VoiceDirector] Directing ${segmentCount} segments for session ${sessionId}`);
  logger.info(`[VoiceDirector] Context: genre=${context.genre}, mood=${context.mood}, audience=${context.audience}`);

  // Get scene-level narrator delivery direction
  // Concatenate narrator segments to create scene context for NarratorDeliveryAgent
  const narratorText = segments
    .filter(s => s.speaker === 'narrator')
    .map(s => s.text || '')
    .join(' ')
    .substring(0, 2000); // Limit for prompt

  let narratorDelivery = null;
  let narratorArchetype = null;

  if (narratorText.length > 50) {
    try {
      narratorDelivery = await getNarratorDeliveryDirectives({
        sessionId,
        sceneText: narratorText,
        context: {
          genre: context.genre,
          mood: context.mood,
          audience: context.audience,
          narratorArchetype: context.narratorArchetype // Pass through if already set
        }
      });

      logger.info(`[VoiceDirector] NarratorDelivery: emotion=${narratorDelivery.emotion}, delivery="${narratorDelivery.delivery}", stability=${narratorDelivery.voiceSettingsOverride?.stability || 'default'}, archetype=${narratorDelivery.archetypeApplied || 'none'}`);
    } catch (err) {
      logger.warn(`[VoiceDirector] NarratorDeliveryAgent failed: ${err.message} - using defaults`);
    }
  }

  // Load archetype - prefer narratorDelivery source, fallback to context
  const archetypeId = narratorDelivery?.archetypeApplied || context.narratorArchetype;
  if (archetypeId) {
    narratorArchetype = getArchetype(archetypeId);
    if (narratorArchetype) {
      const source = narratorDelivery?.archetypeApplied ? 'narratorDelivery' : 'context';
      logger.info(`[VoiceDirector] Archetype loaded from ${source}: ${narratorArchetype.name}`);
    }
  }

  // Enhance context with narrator delivery and archetype for downstream use
  const enhancedContext = {
    ...context,
    narratorDelivery,
    narratorArchetype
  };

  let result;

  // Batch large segment counts to avoid hitting max_tokens limit
  // Each segment needs ~50-60 tokens for direction output
  if (segmentCount > MAX_SEGMENTS_PER_BATCH) {
    logger.info(`[VoiceDirector] BATCHING: ${segmentCount} segments exceeds ${MAX_SEGMENTS_PER_BATCH} limit, splitting into batches`);
    result = await directVoiceActingBatched(segments, enhancedContext, sessionId);
  } else {
    // Direct processing for smaller segment counts
    result = await directVoiceActingSingle(segments, enhancedContext, sessionId);
  }

  // Enhanced COT Summary Logging with emotion aggregation
  logVoiceDirectionSummary(result, sessionId);

  return result;
}

/**
 * Log detailed voice direction summary with emotion aggregation
 * Provides COT visibility into what emotional palette was applied
 */
function logVoiceDirectionSummary(directedSegments, sessionId) {
  const totalSegments = directedSegments.length;
  const directed = directedSegments.filter(s => s.voiceDirected).length;
  const fallbacks = totalSegments - directed;

  // Aggregate emotions from v3AudioTags
  const emotionCounts = {};
  const speakerEmotions = {};

  directedSegments.forEach(seg => {
    const tags = seg.v3AudioTags || seg.delivery || '';
    const speaker = seg.speaker || 'unknown';

    // Extract bracketed emotions
    const bracketMatches = tags.match(/\[([^\]]+)\]/g) || [];
    bracketMatches.forEach(match => {
      const emotion = match.replace(/[\[\]]/g, '').toLowerCase();
      // Skip pause tags
      if (!emotion.startsWith('pause:')) {
        emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;

        // Track per-speaker emotions
        if (!speakerEmotions[speaker]) speakerEmotions[speaker] = new Set();
        speakerEmotions[speaker].add(emotion);
      }
    });
  });

  // Sort emotions by frequency
  const sortedEmotions = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) // Top 10 emotions
    .map(([emotion, count]) => `${emotion}(${count})`)
    .join(', ');

  // Speaker emotion summary
  const speakerSummary = Object.entries(speakerEmotions)
    .map(([speaker, emotions]) => `${speaker}: ${Array.from(emotions).slice(0, 3).join('/')}`)
    .join(' | ');

  logger.info(`[VoiceDirector-COT] Session ${sessionId} Summary:`);
  logger.info(`[VoiceDirector-COT]   Total: ${totalSegments} | Directed: ${directed} | Fallbacks: ${fallbacks}`);
  logger.info(`[VoiceDirector-COT]   Top Emotions: ${sortedEmotions || 'none'}`);
  logger.info(`[VoiceDirector-COT]   Per-Speaker: ${speakerSummary || 'none'}`);
}

/**
 * Process large segment arrays in batches to avoid token limits
 * Uses parallel processing for ~3x speedup on long stories
 */
async function directVoiceActingBatched(segments, context, sessionId) {
  const batches = [];
  for (let i = 0; i < segments.length; i += MAX_SEGMENTS_PER_BATCH) {
    batches.push({
      segments: segments.slice(i, i + MAX_SEGMENTS_PER_BATCH),
      startIndex: i,
      batchIndex: batches.length
    });
  }

  logger.info(`[VoiceDirector] PARALLEL_MODE: Processing ${batches.length} batches (${PARALLEL_BATCH_COUNT} concurrent) of up to ${MAX_SEGMENTS_PER_BATCH} segments each`);

  // Collect all directions from batches using parallel processing
  const allDirectionMaps = [];
  const startTime = Date.now();

  // Process batches in parallel groups of PARALLEL_BATCH_COUNT
  for (let i = 0; i < batches.length; i += PARALLEL_BATCH_COUNT) {
    const parallelBatches = batches.slice(i, i + PARALLEL_BATCH_COUNT);
    const parallelGroupNum = Math.floor(i / PARALLEL_BATCH_COUNT) + 1;
    const totalGroups = Math.ceil(batches.length / PARALLEL_BATCH_COUNT);

    logger.info(`[VoiceDirector] Parallel group ${parallelGroupNum}/${totalGroups}: processing ${parallelBatches.length} batches concurrently`);

    // Process this group of batches in parallel
    const batchPromises = parallelBatches.map(async (batch) => {
      const batchEnd = batch.startIndex + batch.segments.length - 1;
      const batchNum = batch.batchIndex + 1;

      logger.info(`[VoiceDirector] Starting batch ${batchNum}/${batches.length}: segments ${batch.startIndex}-${batchEnd}`);

      try {
        // Get directions for this batch (uses local 0-based indices)
        const directionMap = await getDirectionsForBatch(batch.segments, context, sessionId, batchNum, batches.length);

        // Remap local indices to global indices
        const remappedMap = new Map();
        directionMap.forEach((direction, localIndex) => {
          const globalIndex = batch.startIndex + localIndex;
          remappedMap.set(globalIndex, direction);
        });

        logger.info(`[VoiceDirector] Batch ${batchNum}: got ${directionMap.size} directions`);
        return { success: true, map: remappedMap, batchNum };

      } catch (error) {
        logger.error(`[VoiceDirector] Batch ${batchNum} failed: ${error.message}`);
        // Return empty map - partial directions better than none
        return { success: false, map: new Map(), batchNum, error: error.message };
      }
    });

    // Wait for all batches in this parallel group to complete
    const results = await Promise.all(batchPromises);

    // Collect results
    results.forEach(result => {
      if (result.success) {
        allDirectionMaps.push(result.map);
      } else {
        logger.warn(`[VoiceDirector] Batch ${result.batchNum} returned empty due to error: ${result.error}`);
      }
    });
  }

  const elapsedMs = Date.now() - startTime;
  logger.info(`[VoiceDirector] PARALLEL_COMPLETE: ${batches.length} batches processed in ${elapsedMs}ms (${Math.round(elapsedMs / batches.length)}ms avg per batch)`);

  // Merge all direction maps
  const mergedDirectionMap = new Map();
  allDirectionMaps.forEach(map => {
    map.forEach((direction, index) => {
      mergedDirectionMap.set(index, direction);
    });
  });

  logger.info(`[VoiceDirector] Merged ${mergedDirectionMap.size}/${segments.length} directions from ${batches.length} batches`);

  // Apply merged directions
  const directedSegments = await applyDirections(segments, mergedDirectionMap, {
    genre: context.genre,
    mood: context.mood,
    characterProfiles: context.characterProfiles
  });

  // Refinement pass for any remaining dialogue gaps
  const { segments: dialogueRefinedSegments, refined } = await refineMissingTags(directedSegments, context, sessionId);
  if (refined > 0) {
    logger.info(`[VoiceDirector] Dialogue refinement pass added/updated tags for ${refined} segments`);
  }

  // Narrator refinement pass - add emotional tags to flat narrator segments
  const { segments: refinedSegments, refined: narratorRefined } = await refineNarratorTags(dialogueRefinedSegments, context, sessionId);
  if (narratorRefined > 0) {
    logger.info(`[VoiceDirector] Narrator refinement pass enhanced ${narratorRefined} segments`);
  }

  // Final summary
  const directedCount = refinedSegments.filter(s => s.voiceDirected).length;
  const sampleDirections = refinedSegments
    .filter(s => s.voiceDirected)
    .slice(0, 3)
    .map(s => `${s.speaker}: ${s.v3AudioTags || s.delivery}`)
    .join(' | ');

  logger.info(`[VoiceDirector] BATCHED COMPLETE: Directed ${directedCount}/${segments.length} segments`);
  logger.info(`[VoiceDirector] Sample V3 tags: ${sampleDirections}`);

  return refinedSegments;
}

/**
 * Get directions for a single batch of segments
 */
async function getDirectionsForBatch(segments, context, sessionId, batchNum, totalBatches) {
  // Pass archetype to system prompt for narrator direction constraints
  const systemPrompt = buildSystemPrompt(context.narratorArchetype);
  const userPrompt = buildUserPrompt(segments, context);

  logger.debug(`[VoiceDirector] Batch ${batchNum}/${totalBatches} prompt length: ${userPrompt.length}`);

  const response = await callLLM({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    model: 'gpt-4o',
    agent_name: 'VoiceDirector',
    agent_category: 'voice_direction',
    contentSettings: { audience: context.audience || 'general' },
    max_tokens: BATCH_MAX_TOKENS,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    forceProvider: 'openai',
    sessionId
  });

  const responseText = response?.content || response;
  if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
    throw new Error(`Empty response from LLM for batch ${batchNum}`);
  }
  const content = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);

  return parseDirections(content, segments);
}

/**
 * Direct a single batch of segments (original logic, used for small counts)
 */
async function directVoiceActingSingle(segments, context, sessionId) {
  try {
    // Pass archetype to system prompt for narrator direction constraints
    const systemPrompt = buildSystemPrompt(context.narratorArchetype);
    const userPrompt = buildUserPrompt(segments, context);

    logger.debug(`[VoiceDirector] System prompt length: ${systemPrompt.length}`);
    logger.debug(`[VoiceDirector] User prompt length: ${userPrompt.length}`);

    // Use gpt-4o explicitly - GPT-5.x reasoning models use all tokens for reasoning
    // leaving 0 content, causing "Empty response from LLM" errors
    const response = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'gpt-4o', // Explicit model - avoid gpt-5.x reasoning models
      agent_name: 'VoiceDirector',
      agent_category: 'voice_direction',
      contentSettings: { audience: context.audience || 'general' },
      max_tokens: BATCH_MAX_TOKENS, // Use consistent token limit
      temperature: 0.7, // Higher temperature for more creative directions
      response_format: { type: 'json_object' },
      forceProvider: 'openai', // Ensure OpenAI is used
      sessionId
    });

    // Extract content - callLLM returns { content, ... } object
    const responseText = response?.content || response;
    if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
      throw new Error('Empty response from LLM');
    }
    const content = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);

    const directionMap = parseDirections(content, segments);

    if (directionMap.size === 0) {
      throw new Error('No valid directions parsed from response');
    }

    // Apply directions with V3 conversion and genre/character profiles
    const directedSegments = await applyDirections(segments, directionMap, {
      genre: context.genre,
      mood: context.mood,
      characterProfiles: context.characterProfiles
    });

    // Second-pass refinement to guarantee v3 tags on every dialogue line
    const { segments: dialogueRefinedSegments, refined } = await refineMissingTags(directedSegments, context, sessionId);
    if (refined > 0) {
      logger.info(`[VoiceDirector] Dialogue refinement pass added/updated tags for ${refined} segments`);
    }

    // Narrator refinement pass - add emotional tags to flat narrator segments
    const { segments: refinedSegments, refined: narratorRefined } = await refineNarratorTags(dialogueRefinedSegments, context, sessionId);
    if (narratorRefined > 0) {
      logger.info(`[VoiceDirector] Narrator refinement pass enhanced ${narratorRefined} segments`);
    }

    // Log summary with V3 tags
    const directedCount = refinedSegments.filter(s => s.voiceDirected).length;
    const sampleDirections = refinedSegments
      .filter(s => s.voiceDirected)
      .slice(0, 3)
      .map(s => `${s.speaker}: ${s.v3AudioTags || s.delivery}`)
      .join(' | ');

    logger.info(`[VoiceDirector] Directed ${directedCount}/${segments.length} segments`);
    logger.info(`[VoiceDirector] Sample V3 tags: ${sampleDirections}`);

    return refinedSegments;

  } catch (error) {
    logger.error(`[VoiceDirector] Voice direction failed (fail-loud): ${error.message}`);
    throw error;
  }
}

/**
 * Quick voice direction for a single segment (for real-time scenarios)
 */
export async function directSingleSegment(segment, context, sessionId = null) {
  const results = await directVoiceActing([segment], context, sessionId);
  return results[0];
}

// Export helper functions for external use
export {
  convertToV3Tags,
  injectV3AudioTags,
  applyGenreDefaults,
  ELEVENLABS_V3_OFFICIAL_TAGS,
  V3_COMBINATION_MAPPINGS  // MEDIUM-14: Export for testing and external use
};

export default {
  directVoiceActing,
  directSingleSegment,
  convertToV3Tags,
  injectV3AudioTags,
  applyGenreDefaults,
  ELEVENLABS_V3_OFFICIAL_TAGS,
  V3_COMBINATION_MAPPINGS  // MEDIUM-14: Export for testing
};
