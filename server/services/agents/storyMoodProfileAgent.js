/**
 * Story Mood Profile Agent
 *
 * Analyzes a story's synopsis, genre, and themes to generate a comprehensive
 * voice direction profile for the entire narrative. This runs at "Craft Story"
 * time to establish baseline mood settings before any audio is generated.
 *
 * The profile includes:
 * - Overall story mood and pacing
 * - Narrator voice settings (stability, style, speed)
 * - Emotional arc phases
 * - Key emotional moments for special delivery
 */

import { callLLM } from '../llmProviders.js';
import { getBlendedVoiceProfile } from '../genreVoiceProfiles.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {Object} EmotionalArcPhase
 * @property {string} phase - Phase name (opening, rising_action, climax, resolution)
 * @property {string} mood - Primary mood for this phase
 * @property {number} intensity - Emotional intensity 0-100
 * @property {string[]} suggestedEmotions - ElevenLabs V3 emotions to use
 */

/**
 * @typedef {Object} KeyEmotionalMoment
 * @property {string} description - What happens in this moment
 * @property {string} suggestedDelivery - How to deliver (whisper, shout, dramatic_pause, etc.)
 * @property {string[]} audioTags - Specific V3 audio tags to apply
 */

/**
 * @typedef {Object} NarratorVoiceSettings
 * @property {number} stability - ElevenLabs stability 0.0-1.0
 * @property {number} style - ElevenLabs style 0.0-1.0
 * @property {string} baseEmotion - Default emotion preset
 * @property {number} speedModifier - Speed adjustment 0.85-1.15
 */

/**
 * @typedef {Object} StoryMoodProfile
 * @property {string} overallMood - Primary story mood
 * @property {string} pacing - Story pacing (slow, measured, brisk, rapid)
 * @property {NarratorVoiceSettings} narratorVoiceSettings - Narrator voice parameters
 * @property {EmotionalArcPhase[]} emotionalArc - Phases of the story
 * @property {KeyEmotionalMoment[]} keyEmotionalMoments - Special moments
 * @property {string[]} thematicEmotions - Emotions that recur throughout
 * @property {Object} sceneTypeGuidance - Guidance by scene type
 */

const STORY_MOOD_PROMPT = `You are a voice direction specialist analyzing a story to create a comprehensive audio production profile.

Analyze this story and create a detailed voice direction profile for the narrator.

STORY SYNOPSIS:
{synopsis}

GENRE: {genre}
THEMES: {themes}
TARGET AUDIENCE: {audience}
INTENSITY LEVEL: {intensity}

Based on this story, generate a JSON voice profile. Be specific and actionable.

AVAILABLE ELEVENLABS V3 EMOTIONS: excited, sad, angry, calm, fearful, surprised, whisper, shouting
AVAILABLE AUDIO TAGS: [excited], [sad], [angry], [calm], [fearful], [surprised], [whisper], [shouting], [pause:0.5s], [pause:1s], [pause:2s]

Return ONLY valid JSON with this exact structure:
{
  "overall_mood": "tense|whimsical|dramatic|intimate|epic|dark|lighthearted|melancholic|thrilling|romantic|mysterious|horrifying",
  "pacing": "slow|measured|brisk|rapid",
  "narrator_voice_settings": {
    "stability": 0.0-1.0,
    "style": 0.0-1.0,
    "base_emotion": "calm|excited|fearful|etc",
    "speed_modifier": 0.85-1.15
  },
  "emotional_arc": [
    {
      "phase": "opening",
      "mood": "establishing|tense|playful|mysterious|etc",
      "intensity": 0-100,
      "suggested_emotions": ["calm", "etc"]
    },
    {
      "phase": "rising_action",
      "mood": "building|escalating|deepening|etc",
      "intensity": 0-100,
      "suggested_emotions": ["excited", "etc"]
    },
    {
      "phase": "climax",
      "mood": "peak|confrontation|revelation|catharsis|etc",
      "intensity": 0-100,
      "suggested_emotions": ["shouting", "fearful", "etc"]
    },
    {
      "phase": "resolution",
      "mood": "settling|bittersweet|triumphant|etc",
      "intensity": 0-100,
      "suggested_emotions": ["calm", "sad", "etc"]
    }
  ],
  "key_emotional_moments": [
    {
      "description": "Brief description of the moment",
      "suggested_delivery": "whisper|shout|dramatic_pause|breathless|trembling|etc",
      "audio_tags": ["[whisper]", "[pause:1s]"]
    }
  ],
  "thematic_emotions": ["list", "of", "recurring", "emotions"],
  "scene_type_guidance": {
    "action": { "speed": 1.1, "stability": 0.4, "dominant_emotion": "excited" },
    "dialogue": { "speed": 1.0, "stability": 0.5, "dominant_emotion": "calm" },
    "introspection": { "speed": 0.9, "stability": 0.55, "dominant_emotion": "calm" },
    "romance": { "speed": 0.95, "stability": 0.45, "dominant_emotion": "calm" },
    "horror": { "speed": 0.85, "stability": 0.35, "dominant_emotion": "fearful" }
  }
}

Ensure all numeric values are within their specified ranges. Be creative but practical.`;

/**
 * Generate a story mood profile from synopsis and metadata
 * @param {Object} params
 * @param {string} params.synopsis - Story synopsis/description
 * @param {string|Object} params.genre - Genre name or genre weights object
 * @param {string[]} params.themes - Story themes
 * @param {string} params.targetAudience - Target audience (all_ages, mature, adult)
 * @param {number} params.intensityLevel - Content intensity 0-100
 * @returns {Promise<StoryMoodProfile>} Generated mood profile
 */
export async function generateStoryMoodProfile({
  synopsis,
  genre,
  themes = [],
  targetAudience = 'mature',
  intensityLevel = 50
}) {
  const startTime = Date.now();

  // Normalize genre to string
  let genreString = genre;
  let genreWeights = null;
  if (typeof genre === 'object') {
    genreWeights = genre;
    const entries = Object.entries(genre).sort((a, b) => b[1] - a[1]);
    genreString = entries.map(([g, w]) => `${g} (${w}%)`).join(', ');
  }

  // Get baseline from genre profiles
  const genreProfile = genreWeights
    ? getBlendedVoiceProfile(genreWeights)
    : null;

  // Build the prompt
  const prompt = STORY_MOOD_PROMPT
    .replace('{synopsis}', synopsis || 'No synopsis provided')
    .replace('{genre}', genreString || 'general fiction')
    .replace('{themes}', themes.length > 0 ? themes.join(', ') : 'not specified')
    .replace('{audience}', targetAudience)
    .replace('{intensity}', `${intensityLevel}%`);

  try {
    logger.info('[StoryMoodAgent] Generating story mood profile...', {
      genre: genreString,
      synopsisLength: synopsis?.length || 0,
      themes: themes.length
    });

    const response = await callLLM({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
      forceProvider: 'openai',
      agent_name: 'StoryMoodAgent',
      agent_category: 'voice_direction'
    });

    // Parse JSON response - callLLM returns { content, ... } object
    const responseText = response?.content || response;
    let profile;
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      profile = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('[StoryMoodAgent] Failed to parse LLM response, using defaults', {
        error: parseError.message
      });
      profile = getDefaultMoodProfile(genreProfile, intensityLevel);
    }

    // Validate and sanitize the profile
    const validatedProfile = validateMoodProfile(profile, genreProfile, intensityLevel);

    const elapsed = Date.now() - startTime;
    logger.info('[StoryMoodAgent] Story mood profile generated', {
      mood: validatedProfile.overall_mood,
      pacing: validatedProfile.pacing,
      stability: validatedProfile.narrator_voice_settings.stability,
      elapsed: `${elapsed}ms`
    });

    return validatedProfile;
  } catch (error) {
    logger.error('[StoryMoodAgent] Failed to generate mood profile', {
      error: error.message
    });

    // Return default profile on error
    return getDefaultMoodProfile(genreProfile, intensityLevel);
  }
}

/**
 * Validate and sanitize a mood profile
 * @param {Object} profile - Raw profile from LLM
 * @param {Object} genreProfile - Genre-based defaults
 * @param {number} intensityLevel - Story intensity
 * @returns {StoryMoodProfile} Validated profile
 */
function validateMoodProfile(profile, genreProfile, intensityLevel) {
  const validEmotions = ['excited', 'sad', 'angry', 'calm', 'fearful', 'surprised', 'whisper', 'shouting'];
  const validMoods = ['tense', 'whimsical', 'dramatic', 'intimate', 'epic', 'dark', 'lighthearted', 'melancholic', 'thrilling', 'romantic', 'mysterious', 'horrifying'];
  const validPacing = ['slow', 'measured', 'brisk', 'rapid'];

  // Clamp number to range
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val || (min + max) / 2));

  // Filter to valid emotions
  const filterEmotions = (arr) => (arr || []).filter(e => validEmotions.includes(e)).slice(0, 4);

  // Defaults from genre profile or hardcoded
  const defaults = genreProfile?.narrator || {
    defaultStability: 0.5,
    defaultStyle: 0.6,
    tempoModifier: 1.0,
    emotionBias: ['calm', 'excited']
  };

  return {
    overall_mood: validMoods.includes(profile.overall_mood) ? profile.overall_mood : 'dramatic',
    pacing: validPacing.includes(profile.pacing) ? profile.pacing : 'measured',
    narrator_voice_settings: {
      stability: clamp(profile.narrator_voice_settings?.stability, 0.2, 0.8) || defaults.defaultStability,
      style: clamp(profile.narrator_voice_settings?.style, 0.3, 0.9) || defaults.defaultStyle,
      base_emotion: validEmotions.includes(profile.narrator_voice_settings?.base_emotion)
        ? profile.narrator_voice_settings.base_emotion
        : 'calm',
      speed_modifier: clamp(profile.narrator_voice_settings?.speed_modifier, 0.85, 1.15) || defaults.tempoModifier
    },
    emotional_arc: (profile.emotional_arc || []).map(phase => ({
      phase: phase.phase || 'unknown',
      mood: phase.mood || 'neutral',
      intensity: clamp(phase.intensity, 0, 100),
      suggested_emotions: filterEmotions(phase.suggested_emotions)
    })),
    key_emotional_moments: (profile.key_emotional_moments || []).slice(0, 5).map(moment => ({
      description: (moment.description || '').substring(0, 200),
      suggested_delivery: moment.suggested_delivery || 'neutral',
      audio_tags: (moment.audio_tags || []).filter(tag =>
        tag.match(/^\[(excited|sad|angry|calm|fearful|surprised|whisper|shouting|pause:\d+\.?\d*s)\]$/)
      ).slice(0, 3)
    })),
    thematic_emotions: filterEmotions(profile.thematic_emotions),
    scene_type_guidance: sanitizeSceneTypeGuidance(profile.scene_type_guidance, intensityLevel)
  };
}

/**
 * Sanitize scene type guidance
 */
function sanitizeSceneTypeGuidance(guidance, intensityLevel) {
  const validEmotions = ['excited', 'sad', 'angry', 'calm', 'fearful', 'surprised', 'whisper', 'shouting'];
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const defaults = {
    action: { speed: 1.1, stability: 0.4, dominant_emotion: 'excited' },
    dialogue: { speed: 1.0, stability: 0.5, dominant_emotion: 'calm' },
    introspection: { speed: 0.9, stability: 0.55, dominant_emotion: 'calm' },
    romance: { speed: 0.95, stability: 0.45, dominant_emotion: 'calm' },
    horror: { speed: 0.85, stability: 0.35, dominant_emotion: 'fearful' },
    comedy: { speed: 1.05, stability: 0.45, dominant_emotion: 'excited' },
    tension: { speed: 0.9, stability: 0.35, dominant_emotion: 'fearful' }
  };

  if (!guidance || typeof guidance !== 'object') {
    return defaults;
  }

  const result = { ...defaults };

  for (const [sceneType, settings] of Object.entries(guidance)) {
    if (typeof settings === 'object' && settings !== null) {
      result[sceneType] = {
        speed: clamp(settings.speed || 1.0, 0.7, 1.3),
        stability: clamp(settings.stability || 0.5, 0.2, 0.8),
        dominant_emotion: validEmotions.includes(settings.dominant_emotion)
          ? settings.dominant_emotion
          : 'calm'
      };
    }
  }

  return result;
}

/**
 * Get default mood profile when LLM fails
 */
function getDefaultMoodProfile(genreProfile, intensityLevel) {
  const narrator = genreProfile?.narrator || {
    defaultStability: 0.5,
    defaultStyle: 0.6,
    tempoModifier: 1.0,
    emotionBias: ['calm', 'excited']
  };

  return {
    overall_mood: intensityLevel > 70 ? 'dramatic' : 'measured',
    pacing: 'measured',
    narrator_voice_settings: {
      stability: narrator.defaultStability,
      style: narrator.defaultStyle,
      base_emotion: narrator.emotionBias?.[0] || 'calm',
      speed_modifier: narrator.tempoModifier
    },
    emotional_arc: [
      { phase: 'opening', mood: 'establishing', intensity: 30, suggested_emotions: ['calm'] },
      { phase: 'rising_action', mood: 'building', intensity: 50, suggested_emotions: ['excited', 'calm'] },
      { phase: 'climax', mood: 'peak', intensity: 80, suggested_emotions: ['excited', 'fearful'] },
      { phase: 'resolution', mood: 'settling', intensity: 40, suggested_emotions: ['calm', 'sad'] }
    ],
    key_emotional_moments: [],
    thematic_emotions: narrator.emotionBias || ['calm', 'excited'],
    scene_type_guidance: {
      action: { speed: 1.1, stability: 0.4, dominant_emotion: 'excited' },
      dialogue: { speed: 1.0, stability: 0.5, dominant_emotion: 'calm' },
      introspection: { speed: 0.9, stability: 0.55, dominant_emotion: 'calm' }
    }
  };
}

/**
 * Get scene-specific voice adjustments based on mood profile
 * @param {StoryMoodProfile} moodProfile - The story's mood profile
 * @param {string} sceneType - Type of scene (action, dialogue, introspection, etc.)
 * @param {number} sceneIndex - Scene number for arc positioning
 * @param {number} totalScenes - Total scenes for arc calculation
 * @returns {Object} Voice adjustments for this scene
 */
export function getSceneVoiceAdjustments(moodProfile, sceneType, sceneIndex, totalScenes) {
  if (!moodProfile) {
    return { stability: 0.5, style: 0.6, speed: 1.0, emotion: 'calm' };
  }

  // Determine where we are in the emotional arc
  const progress = totalScenes > 1 ? sceneIndex / (totalScenes - 1) : 0.5;
  let arcPhase;

  if (progress < 0.2) {
    arcPhase = moodProfile.emotional_arc?.find(p => p.phase === 'opening');
  } else if (progress < 0.6) {
    arcPhase = moodProfile.emotional_arc?.find(p => p.phase === 'rising_action');
  } else if (progress < 0.85) {
    arcPhase = moodProfile.emotional_arc?.find(p => p.phase === 'climax');
  } else {
    arcPhase = moodProfile.emotional_arc?.find(p => p.phase === 'resolution');
  }

  // Get scene type guidance
  const sceneGuidance = moodProfile.scene_type_guidance?.[sceneType] || {
    speed: 1.0,
    stability: 0.5,
    dominant_emotion: 'calm'
  };

  // Blend arc intensity with scene type
  const arcIntensity = (arcPhase?.intensity || 50) / 100;
  const baseSettings = moodProfile.narrator_voice_settings || {};

  // Calculate blended values
  const stability = (baseSettings.stability || 0.5) * (1 - arcIntensity * 0.3) + sceneGuidance.stability * 0.3;
  const style = (baseSettings.style || 0.6) + arcIntensity * 0.2;
  const speed = (baseSettings.speed_modifier || 1.0) * sceneGuidance.speed;

  // Select emotion
  const emotion = arcPhase?.suggested_emotions?.[0] || sceneGuidance.dominant_emotion || 'calm';

  return {
    stability: Math.max(0.2, Math.min(0.8, stability)),
    style: Math.max(0.3, Math.min(0.9, style)),
    speed: Math.max(0.85, Math.min(1.15, speed)),
    emotion,
    arcPhase: arcPhase?.phase || 'unknown',
    arcMood: arcPhase?.mood || 'neutral',
    arcIntensity: arcPhase?.intensity || 50
  };
}

export default {
  generateStoryMoodProfile,
  getSceneVoiceAdjustments
};
