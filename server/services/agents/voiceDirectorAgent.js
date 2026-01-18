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

import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';
import { parseCharacterTraits } from '../../utils/agentHelpers.js';
import { getGenreVoiceProfile, getCharacterTypeProfile } from '../genreVoiceProfiles.js';
import { getCharacterEmotion, getLineLevelAdjustments } from './characterVoiceProfileAgent.js';

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

### Pacing Tags
[short pause], [long pause], [beat], [hesitates]
[trails off...], [interrupted-]

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
 * Convert natural language audio tags to V3-compliant format
 * Maps common emotional descriptors to official V3 tags
 *
 * @param {string} audioTags - Natural language audio tags from LLM
 * @returns {string} V3-compliant audio tags
 */
function convertToV3Tags(audioTags) {
  if (!audioTags) return '';

  // Mapping from descriptive tags to V3-compliant emotions
  const tagMapping = {
    // Excited variants
    'happy': 'excited', 'joyful': 'excited', 'elated': 'excited', 'thrilled': 'excited',
    'enthusiastic': 'excited', 'eager': 'excited', 'delighted': 'excited',
    // Sad variants
    'melancholy': 'sad', 'sorrowful': 'sad', 'grief': 'sad', 'mournful': 'sad',
    'dejected': 'sad', 'heartbroken': 'sad', 'wistful': 'sad',
    // Angry variants
    'furious': 'angry', 'enraged': 'angry', 'irritated': 'angry', 'frustrated': 'angry',
    'seething': 'angry', 'bitter': 'angry', 'hostile': 'angry',
    // Calm variants
    'peaceful': 'calm', 'serene': 'calm', 'relaxed': 'calm', 'gentle': 'calm',
    'soothing': 'calm', 'tender': 'calm', 'warm': 'calm',
    // Fearful variants
    'terrified': 'fearful', 'scared': 'fearful', 'anxious': 'fearful', 'nervous': 'fearful',
    'frightened': 'fearful', 'panicked': 'fearful', 'worried': 'fearful',
    // Surprised variants
    'shocked': 'surprised', 'astonished': 'surprised', 'amazed': 'surprised',
    'startled': 'surprised', 'stunned': 'surprised',
    // Whisper variants
    'softly': 'whisper', 'quietly': 'whisper', 'murmurs': 'whisper', 'hushed': 'whisper',
    'secretive': 'whisper', 'intimate': 'whisper',
    // Shouting variants
    'yells': 'shouting', 'screams': 'shouting', 'bellows': 'shouting', 'roars': 'shouting',
    'shouts': 'shouting', 'exclaims': 'shouting'
  };

  let v3Tags = [];
  const tagsLower = audioTags.toLowerCase();

  // First, check for official V3 tags already present
  ELEVENLABS_V3_OFFICIAL_TAGS.emotions.forEach(emotion => {
    if (tagsLower.includes(emotion)) {
      v3Tags.push(`[${emotion}]`);
    }
  });

  // Then map natural language to V3 tags (only if we don't have that emotion yet)
  for (const [keyword, v3Emotion] of Object.entries(tagMapping)) {
    if (tagsLower.includes(keyword) && !v3Tags.includes(`[${v3Emotion}]`)) {
      v3Tags.push(`[${v3Emotion}]`);
    }
  }

  // Extract any pause tags
  const pauseMatch = tagsLower.match(/\[pause:(\d+\.?\d*)s\]/g);
  if (pauseMatch) {
    pauseMatch.forEach(p => {
      if (!v3Tags.includes(p)) {
        v3Tags.push(p);
      }
    });
  }

  // Limit to 3 tags max (V3 recommendation)
  return v3Tags.slice(0, 3).join('');
}

/**
 * Build the system prompt for voice direction
 */
function buildSystemPrompt() {
  return `You are an expert audiobook voice director with deep knowledge of vocal performance, emotional delivery, and the ElevenLabs v3 text-to-speech system.

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

${ELEVENLABS_V3_REFERENCE}

CRITICAL RULES:
1. NEVER use generic single-word emotions - always be specific and combinable
2. Audio tags should paint a picture of HOW to deliver the line
3. Vary stability/style across segments - not everything should be the same
4. Include pacing cues where appropriate
5. Non-verbal sounds should be used deliberately, not randomly
6. Consider the CONTRAST between adjacent segments
7. Match intensity to story genre - children's stories stay lighter, thrillers go darker

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

  // Build character reference with detailed traits
  let characterInfo = '';
  if (characters && characters.length > 0) {
    characterInfo = '\n\n## CHARACTER PROFILES\n';
    characters.forEach(char => {
      const traits = parseCharacterTraits(char);
      const traitList = traits.personality || traits.traits || [];
      characterInfo += `\n### ${char.name}`;
      if (char.role) characterInfo += ` (${char.role})`;
      characterInfo += '\n';
      if (traitList.length > 0) {
        characterInfo += `- Personality: ${Array.isArray(traitList) ? traitList.join(', ') : traitList}\n`;
      }
      if (char.description) {
        characterInfo += `- Description: ${char.description.substring(0, 200)}\n`;
      }
      if (char.voice_description) {
        characterInfo += `- Voice: ${char.voice_description}\n`;
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
 * Parse and validate LLM response
 */
function parseDirections(content, segments) {
  try {
    // Strip markdown code fences if present
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);
    const directions = result.directions || [];

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

    return directionMap;
  } catch (error) {
    logger.error(`[VoiceDirector] Failed to parse LLM response: ${error.message}`);
    logger.debug(`[VoiceDirector] Raw content (first 500 chars): ${content?.substring(0, 500)}`);
    return new Map();
  }
}

/**
 * Apply voice direction to segments with V3 tag conversion
 *
 * @param {Array} segments - Dialogue segments
 * @param {Map} directionMap - LLM direction map
 * @param {Object} context - Story context with genre and character profiles
 */
function applyDirections(segments, directionMap, context = {}) {
  const { genre, characterProfiles } = context;

  const totalSegments = segments.length;
  let directionsApplied = 0;
  let fallbacksUsed = 0;

  const result = segments.map((seg, idx) => {
    const direction = directionMap.get(idx);

    // ENHANCED LOGGING: Progress every 50 segments for visibility
    if (idx > 0 && idx % 50 === 0) {
      logger.info(`[VoiceDirector] Progress: ${idx}/${totalSegments} segments directed (${Math.round((idx / totalSegments) * 100)}%)`);
    }

    // Get character profile if available
    const characterProfile = characterProfiles?.get?.(seg.speaker) || null;

    if (direction) {
      directionsApplied++;
      // Convert natural language tags to V3-compliant format
      const v3Tags = convertToV3Tags(direction.audio_tags);

      // Apply genre defaults to voice settings
      const speakerType = seg.speaker === 'narrator' ? 'narrator' : seg.characterRole || 'supporting';
      const genreDefaults = applyGenreDefaults(genre, speakerType, {
        stability: direction.stability,
        style: direction.style
      });

      // ENHANCED LOGGING: INFO level for tag conversion visibility
      logger.info(`[VoiceDirector] Segment[${idx}] ${seg.speaker}: "${direction.audio_tags}" → V3: "${v3Tags}" | stability=${genreDefaults.stability?.toFixed(2)} style=${genreDefaults.style?.toFixed(2)}`);

      return {
        ...seg,
        // Voice direction outputs
        delivery: direction.audio_tags,           // Keep natural language for logging/debugging
        v3AudioTags: v3Tags,                      // V3-compliant tags for ElevenLabs
        voiceStability: genreDefaults.stability,
        voiceStyle: genreDefaults.style,
        voiceSpeedModifier: genreDefaults.speedModifier || 1.0,
        voiceReasoning: direction.reasoning,
        voiceDirected: true,
        // Map audio_tags to emotion for preset lookup (extract primary emotion)
        emotion: extractPrimaryEmotion(direction.audio_tags) || seg.emotion || 'neutral',
        // Character profile reference
        characterVoiceProfile: characterProfile
      };
    }

    // Fallback for segments not in response - apply genre defaults
    fallbacksUsed++;
    const speakerType = seg.speaker === 'narrator' ? 'narrator' : seg.characterRole || 'supporting';
    const genreDefaults = applyGenreDefaults(genre, speakerType);

    // ENHANCED LOGGING: Warn when using fallback (no LLM direction for this segment)
    logger.warn(`[VoiceDirector] Segment[${idx}] ${seg.speaker}: NO DIRECTION - using fallback defaults`);

    return {
      ...seg,
      delivery: '',
      v3AudioTags: '',
      voiceStability: genreDefaults.stability ?? (seg.speaker === 'narrator' ? 0.65 : 0.5),
      voiceStyle: genreDefaults.style ?? (seg.speaker === 'narrator' ? 0.25 : 0.35),
      voiceSpeedModifier: genreDefaults.speedModifier || 1.0,
      voiceDirected: false,
      emotion: seg.emotion || 'neutral',
      characterVoiceProfile: characterProfile
    };
  });

  // ENHANCED LOGGING: Summary statistics
  logger.info(`[VoiceDirector] COMPLETE: ${totalSegments} segments | ${directionsApplied} directed | ${fallbacksUsed} fallbacks (${Math.round((directionsApplied / totalSegments) * 100)}% coverage)`);

  return result;
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

/**
 * Direct voice acting for all segments in a scene
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

  logger.info(`[VoiceDirector] Directing ${segments.length} segments for session ${sessionId}`);
  logger.info(`[VoiceDirector] Context: genre=${context.genre}, mood=${context.mood}, audience=${context.audience}`);

  try {
    const systemPrompt = buildSystemPrompt();
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
      max_tokens: 3000, // Increased for large segment batches
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
    const directedSegments = applyDirections(segments, directionMap, {
      genre: context.genre,
      characterProfiles: context.characterProfiles
    });

    // Log summary with V3 tags
    const directedCount = directedSegments.filter(s => s.voiceDirected).length;
    const sampleDirections = directedSegments
      .filter(s => s.voiceDirected)
      .slice(0, 3)
      .map(s => `${s.speaker}: ${s.v3AudioTags || s.delivery}`)
      .join(' | ');

    logger.info(`[VoiceDirector] Directed ${directedCount}/${segments.length} segments`);
    logger.info(`[VoiceDirector] Sample V3 tags: ${sampleDirections}`);

    return directedSegments;

  } catch (error) {
    logger.error(`[VoiceDirector] Voice direction failed: ${error.message}`);

    // Fallback: return segments with genre-based default voice settings
    return segments.map(seg => {
      const speakerType = seg.speaker === 'narrator' ? 'narrator' : seg.characterRole || 'supporting';
      const genreDefaults = applyGenreDefaults(context.genre, speakerType);

      return {
        ...seg,
        delivery: '',
        v3AudioTags: '',
        voiceStability: genreDefaults.stability ?? (seg.speaker === 'narrator' ? 0.65 : 0.5),
        voiceStyle: genreDefaults.style ?? (seg.speaker === 'narrator' ? 0.25 : 0.35),
        voiceSpeedModifier: genreDefaults.speedModifier || 1.0,
        voiceDirected: false,
        emotion: seg.emotion || 'neutral'
      };
    });
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
  ELEVENLABS_V3_OFFICIAL_TAGS
};

export default {
  directVoiceActing,
  directSingleSegment,
  convertToV3Tags,
  injectV3AudioTags,
  applyGenreDefaults,
  ELEVENLABS_V3_OFFICIAL_TAGS
};
