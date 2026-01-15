/**
 * ElevenLabs TTS Service
 * Handles voice listing, text-to-speech generation, and audio caching
 */

import axios from 'axios';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/apiRetry.js';
import * as usageTracker from './usageTracker.js';
import * as ttsGating from './ttsGating.js';
import { detectEmotionsForSegments } from './agents/emotionValidatorAgent.js';
import { getNarratorDeliveryDirectives } from './agents/narratorDeliveryAgent.js';
import { assembleMultiVoiceAudio, ASSEMBLY_PRESETS, checkFFmpegAvailable } from './audioAssembler.js';
import { DEFAULT_NARRATOR_VOICE_ID } from '../constants/voices.js';
import { cache } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || join(__dirname, '..', '..', 'public', 'audio');

// Curated list of recommended storytelling voices (ElevenLabs free + premium defaults)
// These are organized by style and gender for the UI
export const RECOMMENDED_VOICES = {
  male_narrators: [
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', style: 'warm', gender: 'male', description: 'Warm British narrator, perfect for classic tales' },
    { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', style: 'authoritative', gender: 'male', description: 'Deep authoritative British accent' },
    { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', style: 'gravelly', gender: 'male', description: 'Gravelly Transatlantic, great for D&D' },
    { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', style: 'deep', gender: 'male', description: 'Deep American male' },
    { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', style: 'crisp', gender: 'male', description: 'Crisp American narrator' },
    { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', style: 'middle', gender: 'male', description: 'Deep middle-aged American' },
    { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', style: 'raspy', gender: 'male', description: 'Raspy American, great for mystery' }
  ],
  female_narrators: [
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'soft', gender: 'female', description: 'Soft American female, ideal for calm stories' },
    { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', style: 'seductive', gender: 'female', description: 'Swedish seductive voice' },
    { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', style: 'British', gender: 'female', description: 'British warm narrator' },
    { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', style: 'young', gender: 'female', description: 'Young American female, great for YA' },
    { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', style: 'pleasant', gender: 'female', description: 'Pleasant British storyteller' },
    { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', style: 'emotional', gender: 'female', description: 'Emotional American female' },
    { voice_id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace', style: 'gentle', gender: 'female', description: 'Gentle Southern American' }
  ],
  character_voices: [
    { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', style: 'Australian', gender: 'male', description: 'Friendly Australian male' },
    { voice_id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', style: 'young', gender: 'male', description: 'Young American male' },
    { voice_id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', style: 'friendly', gender: 'male', description: 'Friendly middle-aged American' },
    { voice_id: 'ODq5zmih8GrVes37Dizd', name: 'Patrick', style: 'shouty', gender: 'male', description: 'Shouty American, great for action' },
    { voice_id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', style: 'anxious', gender: 'male', description: 'Anxious young British male' },
    { voice_id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas', style: 'calm', gender: 'male', description: 'Calm American male' }
  ],
  expressive_voices: [
    { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', style: 'warm', gender: 'female', description: 'Warm American, great for children\'s stories' },
    { voice_id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', style: 'conversational', gender: 'male', description: 'Conversational British-Essex' },
    { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', style: 'upbeat', gender: 'female', description: 'Upbeat American female' },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', style: 'articulate', gender: 'male', description: 'Articulate American male' }
  ]
};

// Voice settings presets for different story moods
// =============================================================================
// VOICE_PRESETS - Emotion to Voice Settings Mapping
// =============================================================================
//
// These presets map detected emotions to ElevenLabs voice_settings parameters:
// - stability: 0.0-1.0 (lower = more expressive/variable, higher = more consistent)
// - similarity_boost: 0.0-1.0 (higher = closer to original voice)
// - style: 0.0-1.0 (style exaggeration, higher = more dramatic)
// - speed: 0.5-1.5 (speech rate, 1.0 = normal)
//
// SPEED RANGE EXPANDED (2025-12-09): Previously 0.85-1.15, now 0.7-1.3
// This allows for more dramatic variation in delivery.
//
// See VOICE_PROSODY_SYSTEM.md for full documentation on voice delivery system.
// =============================================================================
export const VOICE_PRESETS = {
  // === STORY MOOD PRESETS (for overall narration style) ===
  calm_bedtime: { stability: 0.75, similarity_boost: 0.75, style: 0.2, speed: 0.85 },  // Slower for bedtime
  dramatic: { stability: 0.4, similarity_boost: 0.85, style: 0.7, speed: 1.0 },
  playful: { stability: 0.5, similarity_boost: 0.7, style: 0.5, speed: 1.15 },         // Slightly faster
  mysterious: { stability: 0.65, similarity_boost: 0.8, style: 0.4, speed: 0.9 },      // Slower, deliberate
  action: { stability: 0.35, similarity_boost: 0.9, style: 0.8, speed: 1.2 },          // Faster for action
  horror: { stability: 0.6, similarity_boost: 0.85, style: 0.6, speed: 0.8 },          // Slower, dread

  // === NARRATOR STYLE PRESETS ===
  warm_gentle: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.9 },
  dramatic_theatrical: { stability: 0.5, similarity_boost: 0.75, style: 0.8, speed: 1.0 },
  playful_energetic: { stability: 0.6, similarity_boost: 0.7, style: 0.6, speed: 1.15 },
  mysterious_dark: { stability: 0.8, similarity_boost: 0.85, style: 0.4, speed: 0.85 },

  // === PER-LINE EMOTION PRESETS ===
  // These are applied based on dialogue content and attribution

  // Anger/Intensity
  angry: { stability: 0.3, similarity_boost: 0.9, style: 0.9, speed: 1.15 },           // More intense
  furious: { stability: 0.25, similarity_boost: 0.9, style: 0.95, speed: 1.2 },        // Maximum intensity

  // Fear/Anxiety
  fearful: { stability: 0.55, similarity_boost: 0.85, style: 0.5, speed: 1.1 },        // Slightly rushed
  terrified: { stability: 0.4, similarity_boost: 0.85, style: 0.7, speed: 1.25 },      // Panicked, fast
  nervous: { stability: 0.5, similarity_boost: 0.8, style: 0.45, speed: 1.05 },        // Slightly unsteady

  // Sadness/Grief
  sad: { stability: 0.7, similarity_boost: 0.8, style: 0.4, speed: 0.8 },              // Slower, heavy
  grieving: { stability: 0.75, similarity_boost: 0.85, style: 0.35, speed: 0.75 },     // Very slow, broken
  melancholy: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.85 },      // Wistful

  // Joy/Excitement
  excited: { stability: 0.35, similarity_boost: 0.8, style: 0.75, speed: 1.2 },        // Fast, energetic
  joyful: { stability: 0.45, similarity_boost: 0.8, style: 0.65, speed: 1.15 },        // Bright
  triumphant: { stability: 0.4, similarity_boost: 0.85, style: 0.8, speed: 1.1 },      // Bold, victorious

  // Tenderness/Love
  tender: { stability: 0.75, similarity_boost: 0.85, style: 0.25, speed: 0.85 },       // Soft, intimate
  loving: { stability: 0.8, similarity_boost: 0.85, style: 0.2, speed: 0.9 },          // Warm, gentle
  comforting: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.9 },       // Reassuring

  // Menace/Threat
  threatening: { stability: 0.5, similarity_boost: 0.9, style: 0.7, speed: 0.85 },     // Slow, dangerous
  menacing: { stability: 0.55, similarity_boost: 0.9, style: 0.75, speed: 0.8 },       // Very deliberate
  sinister: { stability: 0.6, similarity_boost: 0.9, style: 0.65, speed: 0.85 },       // Cold, calculated

  // Humor/Sarcasm
  sarcastic: { stability: 0.55, similarity_boost: 0.75, style: 0.6, speed: 1.0 },
  mocking: { stability: 0.5, similarity_boost: 0.75, style: 0.65, speed: 1.05 },       // Slightly faster
  dry: { stability: 0.65, similarity_boost: 0.75, style: 0.5, speed: 0.95 },           // Deadpan

  // === NEW PRESETS (2025-12-09) - Previously unmapped emotions ===
  // These emotions were detected by DialogueTaggingAgent but had no preset mapping

  // Whispered/Quiet delivery
  whispered: { stability: 0.8, similarity_boost: 0.85, style: 0.15, speed: 0.85 },     // Soft, intimate
  hushed: { stability: 0.75, similarity_boost: 0.85, style: 0.2, speed: 0.9 },         // Quiet but urgent
  murmured: { stability: 0.75, similarity_boost: 0.8, style: 0.25, speed: 0.9 },       // Low, soft

  // Shouted/Loud delivery
  shouted: { stability: 0.25, similarity_boost: 0.9, style: 0.95, speed: 1.15 },       // Loud, intense
  yelled: { stability: 0.2, similarity_boost: 0.9, style: 1.0, speed: 1.2 },           // Maximum volume
  bellowed: { stability: 0.3, similarity_boost: 0.9, style: 0.9, speed: 1.0 },         // Deep, loud

  // Questioning/Uncertain
  questioning: { stability: 0.6, similarity_boost: 0.75, style: 0.45, speed: 1.0 },    // Inquisitive
  uncertain: { stability: 0.55, similarity_boost: 0.75, style: 0.4, speed: 0.95 },     // Hesitant
  confused: { stability: 0.5, similarity_boost: 0.75, style: 0.5, speed: 0.95 },       // Bewildered

  // Additional nuanced emotions
  desperate: { stability: 0.3, similarity_boost: 0.85, style: 0.8, speed: 1.2 },       // Urgent, pleading
  resigned: { stability: 0.7, similarity_boost: 0.8, style: 0.3, speed: 0.8 },         // Defeated, accepting
  exhausted: { stability: 0.75, similarity_boost: 0.8, style: 0.2, speed: 0.75 },      // Tired, drained
  relieved: { stability: 0.65, similarity_boost: 0.8, style: 0.4, speed: 0.95 },       // Weight lifted
  bitter: { stability: 0.55, similarity_boost: 0.85, style: 0.6, speed: 0.9 },         // Resentful
  wistful: { stability: 0.7, similarity_boost: 0.8, style: 0.35, speed: 0.85 },        // Nostalgic longing
  awestruck: { stability: 0.6, similarity_boost: 0.8, style: 0.5, speed: 0.9 },        // Wonder, amazement
  defiant: { stability: 0.4, similarity_boost: 0.9, style: 0.75, speed: 1.0 },         // Standing ground
  pleading: { stability: 0.5, similarity_boost: 0.85, style: 0.6, speed: 1.05 },       // Begging
  commanding: { stability: 0.5, similarity_boost: 0.9, style: 0.8, speed: 0.95 },      // Authoritative
  seductive: { stability: 0.7, similarity_boost: 0.9, style: 0.5, speed: 0.85 },       // Alluring
  reverent: { stability: 0.8, similarity_boost: 0.85, style: 0.25, speed: 0.8 },       // Solemn respect

  // Default fallback
  neutral: { stability: 0.6, similarity_boost: 0.75, style: 0.4, speed: 1.0 }
};

// =============================================================================
// AUDIO TAGS MAPPING - For eleven_v3 model (2025-12-09)
// =============================================================================
// Maps emotions to v3 Audio Tags. These produce 300% better quality than
// using v2 voice_settings parameters.
// See VOICE_PROSODY_SYSTEM.md for full documentation.
// =============================================================================
export const EMOTION_TO_AUDIO_TAGS = {
  // Volume/Delivery
  whispered: '[whispers]',
  hushed: '[whispers][urgently]',
  murmured: '[softly][quietly]',
  shouted: '[shouts]',
  yelled: '[shouts][intensely]',
  bellowed: '[shouts][deeply]',

  // Fear spectrum
  fearful: '[fearfully]',
  terrified: '[terrified][panicking]',
  nervous: '[nervously]',

  // Anger spectrum
  angry: '[angrily]',
  furious: '[angrily][with barely contained rage]',

  // Sadness spectrum
  sad: '[sadly]',
  grieving: '[grief-stricken][voice breaking]',
  melancholy: '[sadly][wistfully]',

  // Joy spectrum
  excited: '[excitedly]',
  joyful: '[joyfully][laughing]',
  triumphant: '[triumphantly]',

  // Tenderness spectrum
  tender: '[tenderly]',
  loving: '[lovingly][softly]',
  comforting: '[gently][reassuringly]',

  // Menace spectrum
  threatening: '[menacingly]',
  menacing: '[coldly][with quiet menace]',
  sinister: '[darkly][ominously]',

  // Complex emotions
  sarcastic: '[sarcastically]',
  mocking: '[mockingly][laughs]',
  dry: '[dryly]',
  questioning: '[curiously]',
  uncertain: '[uncertainly][hesitantly]',
  confused: '[confusedly]',
  desperate: '[desperately][pleading]',
  resigned: '[resignedly][sighs]',
  exhausted: '[wearily][tiredly]',
  relieved: '[with relief][sighs]',
  bitter: '[bitterly]',
  wistful: '[wistfully][nostalgically]',
  awestruck: '[in awe][breathlessly]',
  defiant: '[defiantly]',
  pleading: '[pleadingly][desperately]',
  commanding: '[authoritatively][firmly]',
  seductive: '[seductively][softly]',
  reverent: '[reverently][solemnly]',

  // Story mood presets
  calm_bedtime: '[softly][gently]',
  dramatic: '[dramatically]',
  playful: '[playfully]',
  mysterious: '[mysteriously]',
  action: '[urgently][intensely]',
  horror: '[ominously][darkly]',

  // Narrator styles
  warm_gentle: '[warmly][gently]',
  dramatic_theatrical: '[dramatically][theatrically]',
  playful_energetic: '[playfully][energetically]',
  mysterious_dark: '[mysteriously][darkly]',

  // Default
  neutral: ''  // No tags for neutral delivery
};

/**
 * Wrap text with v3 Audio Tags based on emotion
 *
 * @param {string} text - The text to wrap
 * @param {string} emotion - The detected emotion (e.g., 'angry', 'whispered')
 * @param {string} [delivery] - Optional additional delivery notes
 * @returns {string} Text with Audio Tags prepended
 *
 * @example
 * wrapWithAudioTags("I will never forgive you", "angry")
 * // Returns: "[angrily]I will never forgive you"
 *
 * wrapWithAudioTags("Did you hear that?", "whispered", "nervously")
 * // Returns: "[whispers][nervously]Did you hear that?"
 */
export function wrapWithAudioTags(text, emotion, delivery = null) {
  if (!text) return text;

  const baseEmotion = (emotion || 'neutral').toString().toLowerCase().trim();

  // Get base tags from emotion mapping
  const baseTags = EMOTION_TO_AUDIO_TAGS[baseEmotion] || '';

  const extractTags = (value) => {
    if (!value) return [];
    const str = String(value).trim();
    if (!str) return [];

    // If already bracket tags (supports multiple tags in one string), keep them.
    const matches = str.match(/\[[^\]]+\]/g);
    if (matches && matches.length > 0) return matches;

    // Otherwise treat as a single delivery direction and wrap it.
    return [`[${str.toLowerCase()}]`];
  };

  // Merge tags (de-dupe case-insensitive) so we don't double-apply directions.
  const merged = [...extractTags(baseTags), ...extractTags(delivery)];
  const seen = new Set();
  const tags = merged.filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('');

  // Log Audio Tag wrapping for debugging
  if (tags) {
    logger.debug(`[AudioTags] WRAP | emotion: ${baseEmotion} | delivery: ${delivery || 'none'} | tags: "${tags}" | text: "${text.substring(0, 40)}..."`);
  }

  // Return text with tags prepended
  return tags ? `${tags}${text}` : text;
}

/**
 * Convert a dialogue segment to v3 format with Audio Tags
 *
 * @param {object} segment - Segment with text, emotion, delivery properties
 * @returns {object} Segment with text wrapped in Audio Tags
 */
export function convertSegmentToV3(segment) {
  if (!segment || !segment.text) return segment;

  return {
    ...segment,
    text: wrapWithAudioTags(segment.text, segment.emotion, segment.delivery),
    v3_converted: true
  };
}

/**
 * Check if a model supports Audio Tags
 * @param {string} modelId - ElevenLabs model ID
 * @returns {boolean}
 */
export function modelSupportsAudioTags(modelId) {
  const config = ELEVENLABS_MODELS[modelId];
  return config?.supports_audio_tags === true;
}

/**
 * Emotion detection keywords and their mappings
 * Used for per-line voice styling based on dialogue content
 */
const EMOTION_KEYWORDS = {
  // Warm/Playful emotions - friendly greetings, happiness
  warm: {
    keywords: ['hello', 'hi there', 'good morning', 'good evening', 'welcome', 'pleased to meet',
               'nice to see', 'glad', 'happy', 'delighted', 'wonderful', 'lovely'],
    verbs: ['greeted', 'smiled', 'beamed', 'grinned', 'chuckled', 'laughed warmly', 'welcomed']
  },
  playful: {
    keywords: ['haha', 'hehe', 'teased', 'joked', 'kidding', 'funny', 'silly', 'giggled'],
    verbs: ['teased', 'joked', 'quipped', 'bantered', 'giggled', 'snickered', 'smirked playfully']
  },

  // Dramatic/Intense emotions - accusations, revelations
  dramatic: {
    keywords: ['what have you done', 'how could you', 'i trusted you', 'betrayed', 'never forgive',
               'impossible', 'it cannot be', 'my god', 'dear god', 'revelation', 'truth'],
    verbs: ['accused', 'denounced', 'proclaimed', 'declared', 'revealed', 'confronted', 'challenged']
  },
  angry: {
    keywords: ['damn', 'hell', 'bastard', 'idiot', 'fool', 'enough', 'stop', 'get out',
               'how dare', 'unacceptable', 'outrageous', 'furious', 'livid'],
    verbs: ['shouted', 'yelled', 'screamed', 'roared', 'bellowed', 'snapped', 'snarled',
            'spat', 'barked', 'raged', 'thundered', 'exploded']
  },

  // Horror/Fear emotions - terror, dread
  horror: {
    keywords: ['help me', 'save me', 'oh god', 'no no no', 'monster', 'creature', 'blood',
               'dead', 'kill', 'murder', 'death', 'corpse', 'scream', 'terror', 'nightmare'],
    verbs: ['shrieked', 'wailed', 'howled', 'sobbed', 'cried out', 'screamed in terror']
  },
  fearful: {
    keywords: ['please', 'dont hurt', 'spare me', 'afraid', 'scared', 'terrified', 'horror',
               'behind you', 'run', 'hide', 'danger', 'threat', 'watch out', 'careful'],
    verbs: ['trembled', 'whimpered', 'stammered', 'stuttered', 'gasped', 'breathed shakily',
            'whispered fearfully', 'quavered', 'pleaded']
  },

  // Mysterious/Suspenseful emotions
  mysterious: {
    keywords: ['secret', 'hidden', 'truth', 'mystery', 'riddle', 'puzzle', 'ancient',
               'forgotten', 'prophecy', 'destiny', 'fate', 'omen', 'warning'],
    verbs: ['murmured', 'intoned', 'whispered mysteriously', 'spoke cryptically', 'hinted']
  },
  threatening: {
    keywords: ['warning', 'last chance', 'regret', 'pay for', 'suffer', 'destroy', 'end you',
               'consequences', 'mistake', 'punishment', 'vengeance', 'revenge'],
    verbs: ['warned', 'threatened', 'growled', 'hissed', 'menaced', 'promised darkly', 'vowed']
  },

  // Sad/Tender emotions
  sad: {
    keywords: ['goodbye', 'farewell', 'miss you', 'sorry', 'forgive me', 'lost', 'gone',
               'never again', 'remember', 'tears', 'cry', 'weep', 'grief', 'mourn'],
    verbs: ['sobbed', 'wept', 'mourned', 'lamented', 'grieved', 'cried', 'sighed sadly',
            'said brokenly', 'choked out']
  },
  tender: {
    keywords: ['love', 'darling', 'sweetheart', 'my dear', 'beloved', 'precious', 'care for',
               'heart', 'always', 'forever', 'together', 'hold me', 'miss you'],
    verbs: ['whispered tenderly', 'murmured softly', 'said gently', 'breathed', 'cooed',
            'spoke lovingly', 'said warmly']
  },

  // Action/Excitement emotions
  excited: {
    keywords: ['amazing', 'incredible', 'fantastic', 'look at this', 'found it', 'we did it',
               'yes', 'victory', 'success', 'brilliant', 'genius', 'perfect'],
    verbs: ['exclaimed', 'cheered', 'shouted excitedly', 'cried triumphantly', 'whooped']
  },

  // Sarcastic/Dry emotions
  sarcastic: {
    keywords: ['oh really', 'how nice', 'wonderful', 'great job', 'obviously', 'clearly',
               'of course', 'sure', 'right', 'brilliant idea', 'genius'],
    verbs: ['drawled', 'said dryly', 'remarked sarcastically', 'said flatly', 'deadpanned',
            'said with a roll of', 'muttered']
  }
};

/**
 * Detect the emotional tone of a dialogue line based on text content and speech verb
 * @param {string} text - The dialogue text
 * @param {string} attribution - The attribution/speech tag (e.g., "she shouted accusingly")
 * @returns {{emotion: string, confidence: number, preset: object}} Detected emotion and voice preset
 */
export function detectLineEmotion(text, attribution = '') {
  const lowerText = text.toLowerCase();
  const lowerAttr = attribution.toLowerCase();
  const combined = `${lowerText} ${lowerAttr}`;

  // Check for exclamation marks and question marks
  const hasExclamation = text.includes('!');
  const hasQuestion = text.includes('?');
  const hasMultipleExclamation = (text.match(/!/g) || []).length > 1;
  const isAllCaps = text === text.toUpperCase() && text.length > 3;

  let scores = {};

  // Score each emotion based on keyword/verb matches
  for (const [emotion, patterns] of Object.entries(EMOTION_KEYWORDS)) {
    let score = 0;

    // Check keywords in text
    for (const keyword of patterns.keywords) {
      if (lowerText.includes(keyword)) {
        score += 2;
      }
    }

    // Check verbs in attribution (higher weight)
    for (const verb of patterns.verbs) {
      if (lowerAttr.includes(verb)) {
        score += 3;
      }
    }

    scores[emotion] = score;
  }

  // Boost angry/dramatic for multiple exclamations or ALL CAPS
  if (hasMultipleExclamation || isAllCaps) {
    scores.angry = (scores.angry || 0) + 2;
    scores.dramatic = (scores.dramatic || 0) + 1;
  }

  // Boost fearful/mysterious for questions with certain contexts
  if (hasQuestion && (lowerText.includes('what') || lowerText.includes('who'))) {
    scores.mysterious = (scores.mysterious || 0) + 1;
  }

  // Find highest scoring emotion
  let maxEmotion = 'neutral';
  let maxScore = 0;

  for (const [emotion, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxEmotion = emotion;
    }
  }

  // Map emotion to preset
  const emotionToPreset = {
    warm: 'warm_gentle',
    playful: 'playful',
    dramatic: 'dramatic',
    angry: 'angry',
    horror: 'horror',
    fearful: 'fearful',
    mysterious: 'mysterious',
    threatening: 'threatening',
    sad: 'sad',
    tender: 'tender',
    excited: 'excited',
    sarcastic: 'sarcastic',
    neutral: 'neutral'
  };

  const presetName = emotionToPreset[maxEmotion] || 'neutral';
  const preset = VOICE_PRESETS[presetName] || VOICE_PRESETS.neutral;

  // Calculate confidence (0-1)
  const confidence = Math.min(maxScore / 5, 1);

  logger.debug(`[EmotionDetect] Text: "${text.substring(0, 50)}..." | Attribution: "${attribution}" | Emotion: ${maxEmotion} (confidence: ${confidence.toFixed(2)})`);

  return {
    emotion: maxEmotion,
    confidence,
    presetName,
    preset
  };
}

// ElevenLabs model configurations
// See: https://elevenlabs.io/docs/api-reference/text-to-speech
export const ELEVENLABS_MODELS = {
  // =============================================================================
  // eleven_v3 - NEW DEFAULT (2025-12-09)
  // =============================================================================
  // Supports Audio Tags for natural language voice direction.
  // Testing showed 300% better quality than v2 for emotional delivery.
  // Use [whispers], [angrily], [laughs] etc. inline with text.
  // See VOICE_PROSODY_SYSTEM.md for full Audio Tag reference.
  // =============================================================================
  eleven_v3: {
    id: 'eleven_v3',
    name: 'Eleven v3 (Audio Tags)',
    tier: 'premium',
    supports_style: true,
    supports_speed: false,
    supports_timestamps: true,
    supports_audio_tags: true,  // NEW: Natural language voice direction
    languages: 32,
    latency: 'medium',  // ~58% slower than v2, but quality is 300% better
    cost_multiplier: 1.0,
    description: 'Best quality with Audio Tags for emotional delivery - USE THIS'
  },
  // Legacy premium model - kept as fallback
  eleven_multilingual_v2: {
    id: 'eleven_multilingual_v2',
    name: 'Multilingual v2 (Legacy)',
    tier: 'premium',
    supports_style: true,
    supports_speed: false,
    supports_timestamps: true,
    supports_audio_tags: false,
    languages: 29,
    latency: 'medium',
    cost_multiplier: 1.0,
    description: 'Legacy model - use eleven_v3 instead for better quality'
  },
  // Standard quality - good balance of quality and speed
  eleven_turbo_v2_5: {
    id: 'eleven_turbo_v2_5',
    name: 'Turbo v2.5',
    tier: 'standard',
    supports_style: true,
    supports_speed: true,
    supports_timestamps: true,
    languages: 32,
    latency: 'low',
    cost_multiplier: 0.5,
    description: 'Fast generation with good quality, supports speed control'
  },
  // Economy/Fast - lowest latency, good for previews
  eleven_flash_v2_5: {
    id: 'eleven_flash_v2_5',
    name: 'Flash v2.5',
    tier: 'fast',
    supports_style: false,
    supports_speed: true,
    supports_timestamps: true,
    languages: 32,
    latency: 'very_low',
    cost_multiplier: 0.25,
    description: 'Ultra-fast generation for previews and drafts'
  },
  // Legacy monolingual (English only)
  eleven_monolingual_v1: {
    id: 'eleven_monolingual_v1',
    name: 'Monolingual v1',
    tier: 'economy',
    supports_style: false,
    supports_speed: false,
    supports_timestamps: false,
    languages: 1,
    latency: 'low',
    cost_multiplier: 0.5,
    description: 'Legacy English-only model'
  }
};

// Quality tier to model mapping
// NOTE: Premium tier now uses eleven_v3 (Audio Tags) as of 2025-12-09
export const QUALITY_TIER_MODELS = {
  premium: 'eleven_v3',           // NEW: v3 with Audio Tags (300% better quality)
  premium_legacy: 'eleven_multilingual_v2',  // Fallback if v3 fails
  standard: 'eleven_turbo_v2_5',
  economy: 'eleven_turbo_v2_5',
  fast: 'eleven_flash_v2_5'
};

// Default voice settings per quality tier
export const TIER_DEFAULT_SETTINGS = {
  premium: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    use_speaker_boost: true
  },
  standard: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.2,
    use_speaker_boost: true
  },
  economy: {
    stability: 0.6,
    similarity_boost: 0.7,
    style: 0.1,
    use_speaker_boost: false
  },
  fast: {
    stability: 0.7,
    similarity_boost: 0.65,
    style: 0,
    use_speaker_boost: false
  }
};

/**
 * Get the appropriate ElevenLabs model for a quality tier
 * @param {string} tier - Quality tier (premium, standard, economy, fast)
 * @returns {string} Model ID
 */
export function getModelForTier(tier) {
  return QUALITY_TIER_MODELS[tier] || QUALITY_TIER_MODELS.standard;
}

/**
 * Get model configuration
 * @param {string} modelId - ElevenLabs model ID
 * @returns {Object} Model configuration
 */
export function getModelConfig(modelId) {
  return ELEVENLABS_MODELS[modelId] || ELEVENLABS_MODELS.eleven_multilingual_v2;
}

// Voice name cache for logging (voice_id -> name mapping)
// This is a CACHE (not a session tracker) so we use LRU eviction instead of FAIL LOUD
const voiceNameCache = new Map();
const VOICE_CACHE_MAX_SIZE = 500; // Max cached voice lookups

/**
 * Add to voice cache with LRU eviction
 * Since this is a cache (not sessions), we evict oldest entries instead of rejecting
 */
function cacheVoiceName(voiceId, name) {
  // If at capacity, evict oldest entries (first 20% of cache)
  if (voiceNameCache.size >= VOICE_CACHE_MAX_SIZE) {
    const evictCount = Math.floor(VOICE_CACHE_MAX_SIZE * 0.2);
    const keysToDelete = Array.from(voiceNameCache.keys()).slice(0, evictCount);
    for (const key of keysToDelete) {
      voiceNameCache.delete(key);
    }
    logger.info(`[VoiceCache] Evicted ${evictCount} entries (cache was at capacity)`);
  }
  voiceNameCache.set(voiceId, name);
}

/**
 * Look up voice name by voice ID
 * Uses RECOMMENDED_VOICES first, then database, then ElevenLabs API
 * Results are cached for performance
 * @param {string} voiceId - ElevenLabs voice ID
 * @returns {Promise<string>} Voice name or 'Unknown Voice'
 */
export async function getVoiceNameById(voiceId) {
  if (!voiceId) return 'No Voice';

  // Check cache first
  if (voiceNameCache.has(voiceId)) {
    return voiceNameCache.get(voiceId);
  }

  // Check RECOMMENDED_VOICES constant
  for (const category of Object.values(RECOMMENDED_VOICES)) {
    const found = category.find(v => v.voice_id === voiceId);
    if (found) {
      cacheVoiceName(voiceId, found.name);
      return found.name;
    }
  }

  // Try database lookup
  try {
    const result = await pool.query(
      'SELECT name FROM elevenlabs_voices WHERE voice_id = $1',
      [voiceId]
    );
    if (result.rows[0]?.name) {
      cacheVoiceName(voiceId, result.rows[0].name);
      return result.rows[0].name;
    }
  } catch (err) {
    logger.warn(`[ElevenLabs] DB voice lookup failed for ${voiceId}: ${err.message}`);
  }

  // Fallback: mark as unknown but include ID for debugging
  const unknownName = `Voice(${voiceId.substring(0, 8)}...)`;
  cacheVoiceName(voiceId, unknownName);
  return unknownName;
}

/**
 * Log detailed voice playback information
 * This is the key logging function for tracking which voice actually played
 * @param {string} context - Context label (e.g., 'Narrator', 'Character:John')
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {string} textPreview - Preview of text being spoken
 * @param {object} metadata - Additional metadata
 */
export async function logVoicePlayback(context, voiceId, textPreview, metadata = {}) {
  const voiceName = await getVoiceNameById(voiceId);
  const preview = textPreview?.substring(0, 60) || '';

  logger.info(`[VOICE_PLAYED] ${context} → "${voiceName}" (${voiceId})`);
  logger.info(`[VOICE_PLAYED] Text: "${preview}${preview.length >= 60 ? '...' : ''}"`);

  if (metadata.sessionId) {
    logger.info(`[VOICE_PLAYED] Session: ${metadata.sessionId}, Speaker: ${metadata.speaker || 'narrator'}`);
  }
}

/**
 * Estimate TTS cost in credits
 * @param {string} text - Text to synthesize
 * @param {string} tier - Quality tier
 * @returns {Object} { characters, credits, costUsd }
 */
export function estimateTTSCost(text, tier = 'standard') {
  const characters = text.length;
  const modelId = getModelForTier(tier);
  const modelConfig = getModelConfig(modelId);

  // ElevenLabs pricing: ~$0.30 per 1000 characters for standard
  // Adjust by model cost multiplier
  const baseCreditsPerChar = 1; // 1 credit per character
  const baseCostPer1000Chars = 0.30;

  const credits = Math.ceil(characters * baseCreditsPerChar * modelConfig.cost_multiplier);
  const costUsd = (characters / 1000) * baseCostPer1000Chars * modelConfig.cost_multiplier;

  return {
    characters,
    credits,
    costUsd: Math.round(costUsd * 1000) / 1000,
    model: modelId,
    tier
  };
}

// Ensure audio cache directory exists
if (!existsSync(AUDIO_CACHE_DIR)) {
  mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
}

export class ElevenLabsService {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    // Default to George (deep British narrator) - imported from constants/voices.js
    this.defaultVoiceId = process.env.DEFAULT_VOICE_ID || DEFAULT_NARRATOR_VOICE_ID;

    if (!this.apiKey) {
      logger.warn('ELEVENLABS_API_KEY not configured - TTS will not work');
    }
  }

  /**
   * Get list of available voices from ElevenLabs API
   * Results are cached for 24 hours to reduce API calls
   */
  async getVoices() {
    try {
      // Check cache first (24 hour TTL)
      const cached = await cache.getVoicesList();
      if (cached) {
        logger.debug('[ElevenLabs] Returning cached voice list');
        return cached;
      }

      // Fetch from API
      logger.info('[ElevenLabs] Fetching voice list from API');
      const response = await axios.get(`${ELEVENLABS_API_URL}/voices`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      const voices = response.data.voices.map(voice => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category,
        description: voice.description,
        labels: voice.labels,
        preview_url: voice.preview_url,
        fine_tuning: voice.fine_tuning
      }));

      // Cache the result
      await cache.setVoicesList(voices);
      logger.info(`[ElevenLabs] Cached ${voices.length} voices`);

      return voices;

    } catch (error) {
      logger.error('Error fetching ElevenLabs voices:', error.response?.data || error.message);
      throw new Error('Failed to fetch voices from ElevenLabs');
    }
  }

  /**
   * Get details for a specific voice by ID
   * @param {string} voiceId - ElevenLabs voice ID
   * @returns {Object} Voice details including name, category, description
   */
  async getVoiceDetails(voiceId) {
    if (!voiceId) return null;

    try {
      const response = await axios.get(`${ELEVENLABS_API_URL}/voices/${voiceId}`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      const voice = response.data;
      return {
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category,
        description: voice.description || voice.labels?.description || '',
        labels: voice.labels,
        preview_url: voice.preview_url
      };

    } catch (error) {
      logger.warn(`Error fetching voice details for ${voiceId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Generate speech from text
   * @param {string} text - Text to convert to speech
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {object} options - Voice settings (includes sessionId for usage tracking)
   * @param {string} options.quality_tier - Quality tier (premium, standard, economy, fast)
   * @param {string} options.model_id - Explicit model ID (overrides quality_tier)
   * @param {string} options.preset - Voice preset name
   * @param {number} options.stability - Voice stability (0-1)
   * @param {number} options.similarity_boost - Voice similarity boost (0-1)
   * @param {number} options.style - Voice style (0-1)
   * @param {number} options.speed - Speech speed (for supported models)
   * @param {boolean} options.use_speaker_boost - Enable speaker boost
   * @param {string} options.output_format - Audio format (mp3_44100_128, mp3_22050_32, etc.)
   * @returns {Buffer} Audio buffer (MP3)
   */
  async textToSpeech(text, voiceId = null, options = {}) {
    const voice = voiceId || this.defaultVoiceId;
    const { sessionId, quality_tier = 'standard', speaker = 'narrator' } = options;

    // Get voice name for enhanced logging
    const voiceName = await getVoiceNameById(voice);

    // Log voice selection with NAME for debugging
    logger.info(`[ElevenLabs] ========== TTS GENERATION ==========`);
    logger.info(`[ElevenLabs] Voice: "${voiceName}" (ID: ${voice})`);
    logger.info(`[ElevenLabs] Speaker Type: ${speaker}`);
    logger.info(`[ElevenLabs] Text Preview: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
    logger.info(`[ElevenLabs] Tier: ${quality_tier}`);

    // TTS GATING CHECK (Section 3 of Storyteller Gospel)
    // Enforces TTS_ENABLED and TTS_MAX_CHARS_PER_STORY limits
    if (sessionId) {
      const gatingCheck = ttsGating.canRequestTTS(sessionId, text.length);
      if (!gatingCheck.allowed) {
        // Debug mode: return simulated TTS
        if (gatingCheck.debugMode) {
          logger.info(`[ElevenLabs] TTS DEBUG MODE - simulating response`);
          const simulated = ttsGating.simulateTTS(text, voice);
          // Return a minimal valid MP3 header for debug mode
          return Buffer.from([0xFF, 0xFB, 0x90, 0x00]); // Minimal MP3 frame
        }
        // Limit exceeded: emit error and throw
        ttsGating.emitTTSLimitExceeded(sessionId);
        throw new Error(gatingCheck.reason);
      }
    } else if (!ttsGating.isTTSEnabled()) {
      // No session but TTS disabled globally
      logger.info(`[ElevenLabs] TTS DEBUG MODE (no session) - simulating response`);
      return Buffer.from([0xFF, 0xFB, 0x90, 0x00]);
    }

    // Check cache first
    const cached = await this.checkCache(text, voice);
    if (cached) {
      logger.info(`[ElevenLabs] ✓ Cache HIT for voice "${voiceName}" (${voice})`);
      logger.info(`[VOICE_PLAYED] ${speaker} → "${voiceName}" (${voice}) [CACHED]`);
      return cached;
    }

    try {
      // Determine model based on quality tier or explicit model_id
      const modelId = options.model_id || getModelForTier(quality_tier);
      const modelConfig = getModelConfig(modelId);

      // Get tier-specific default settings
      const tierDefaults = TIER_DEFAULT_SETTINGS[quality_tier] || TIER_DEFAULT_SETTINGS.standard;

      // Apply voice preset if specified
      const preset = options.preset ? VOICE_PRESETS[options.preset] : null;

      // Build voice settings with priority: options > preset > tier defaults
      const stability = options.stability ?? preset?.stability ?? tierDefaults.stability;
      const similarityBoost = options.similarity_boost ?? preset?.similarity_boost ?? tierDefaults.similarity_boost;

      // Style only applies to models that support it
      let style = options.style ?? preset?.style ?? tierDefaults.style;
      if (!modelConfig.supports_style) {
        style = 0; // Model doesn't support style
      }

      // Speed only applies to turbo and flash models
      const speed = options.speed ?? preset?.speed ?? 1.0;
      const useSpeakerBoost = options.use_speaker_boost ?? tierDefaults.use_speaker_boost;

      // Build voice settings object
      const voiceSettings = {
        stability,
        similarity_boost: similarityBoost,
        use_speaker_boost: useSpeakerBoost
      };

      // Only add style if model supports it
      if (modelConfig.supports_style) {
        voiceSettings.style = style;
      }

      logger.info(`[ElevenLabs] Generating TTS: model=${modelId}, tier=${quality_tier}, stability=${stability}, style=${style}`);

      // Build request body
      const requestBody = {
        text,
        model_id: modelId,
        voice_settings: voiceSettings
      };

      // Add output format if specified
      if (options.output_format) {
        requestBody.output_format = options.output_format;
      }

      // Use retry logic for transient failures (rate limits, server errors)
      const response = await withRetry('ElevenLabs', async () => {
        return axios.post(
          `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
          requestBody,
          {
            headers: {
              'xi-api-key': this.apiKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg'
            },
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
          }
        );
      }, { maxRetries: 3, baseDelay: 1000 });

      const audioBuffer = Buffer.from(response.data);

      // Track usage if sessionId provided (only for API calls, not cache hits)
      if (sessionId) {
        usageTracker.trackElevenLabsUsage(sessionId, text, audioBuffer.length);
        // Record TTS usage for per-story limits (Section 3 of Storyteller Gospel)
        ttsGating.recordTTSUsage(sessionId, text.length, audioBuffer.length);
      }

      // Cache the audio
      await this.cacheAudio(text, voice, audioBuffer);

      // Log successful generation with voice name
      logger.info(`[ElevenLabs] ✓ Generated TTS: ${audioBuffer.length} bytes, model=${modelId}`);
      logger.info(`[VOICE_PLAYED] ${speaker} → "${voiceName}" (${voice}) [GENERATED]`);
      logger.info(`[ElevenLabs] ========================================`);

      return audioBuffer;

    } catch (error) {
      logger.error('ElevenLabs TTS error:', error.response?.data || error.message);

      // Check for quota exceeded in response data
      const errorData = error.response?.data;
      if (errorData?.detail?.status === 'quota_exceeded' ||
          (typeof errorData?.detail?.message === 'string' && errorData.detail.message.includes('quota'))) {
        const remaining = errorData?.detail?.message?.match(/(\d+) credits remaining/)?.[1] || '0';
        logger.error(`ElevenLabs quota exceeded: ${remaining} credits remaining`);
        throw new Error(`ElevenLabs quota exceeded - only ${remaining} credits remaining. Please add credits at elevenlabs.io`);
      }

      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      }
      if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded');
      }
      if (error.response?.status === 422) {
        throw new Error('ElevenLabs validation error: ' + (errorData?.detail?.message || 'Unknown error'));
      }

      throw new Error('Failed to generate speech: ' + (error.message || 'Unknown error'));
    }
  }

  /**
   * Generate TTS with tier-based quality control
   * Wrapper for textToSpeech with explicit tier handling
   * @param {string} text - Text to synthesize
   * @param {string} voiceId - Voice ID
   * @param {string} tier - Quality tier (premium, standard, economy, fast)
   * @param {object} voiceSettings - Additional voice settings
   * @returns {Buffer} Audio buffer
   */
  async generateWithTier(text, voiceId, tier = 'standard', voiceSettings = {}) {
    return this.textToSpeech(text, voiceId, {
      ...voiceSettings,
      quality_tier: tier
    });
  }

  /**
   * Generate voice preview sample
   * Uses fast tier for quick preview generation
   * @param {string} voiceId - Voice ID to preview
   * @param {string} sampleText - Optional custom sample text
   * @returns {Buffer} Audio buffer
   */
  async generatePreview(voiceId, sampleText = null) {
    const text = sampleText || "The ancient forest whispered secrets to those brave enough to listen.";

    return this.textToSpeech(text, voiceId, {
      quality_tier: 'fast',
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3
    });
  }

  /**
   * Generate hash for text + voice combination
   */
  generateHash(text, voiceId) {
    return crypto
      .createHash('sha256')
      .update(`${text}:${voiceId}`)
      .digest('hex');
  }

  /**
   * Check if audio is cached
   */
  async checkCache(text, voiceId) {
    const hash = this.generateHash(text, voiceId);

    try {
      // Check database
      const result = await pool.query(
        'SELECT file_path FROM audio_cache WHERE text_hash = $1 AND voice_id = $2',
        [hash, voiceId]
      );

      if (result.rows.length > 0) {
        const filePath = result.rows[0].file_path;
        if (existsSync(filePath)) {
          // Update access stats
          await pool.query(
            'UPDATE audio_cache SET access_count = access_count + 1, last_accessed_at = NOW() WHERE text_hash = $1',
            [hash]
          );

          return await readFile(filePath);
        }
      }

      return null;

    } catch (error) {
      logger.error('Cache check error:', error);
      return null;
    }
  }

  /**
   * Cache generated audio
   */
  async cacheAudio(text, voiceId, audioBuffer) {
    const hash = this.generateHash(text, voiceId);
    const filename = `${hash}.mp3`;
    const filePath = join(AUDIO_CACHE_DIR, filename);

    try {
      // Save file (async to avoid blocking event loop)
      await writeFile(filePath, audioBuffer);

      // Estimate duration (rough: ~150 words per minute, ~5 chars per word)
      const estimatedWords = text.length / 5;
      const estimatedDuration = (estimatedWords / 150) * 60;

      // Save to database
      await pool.query(`
        INSERT INTO audio_cache (text_hash, voice_id, text_preview, file_path, file_size_bytes, duration_seconds)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (text_hash, voice_id) DO UPDATE SET
          access_count = audio_cache.access_count + 1,
          last_accessed_at = NOW()
      `, [
        hash,
        voiceId,
        text.substring(0, 200),
        filePath,
        audioBuffer.length,
        estimatedDuration
      ]);

    } catch (error) {
      logger.error('Cache save error:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Get voice info by ID
   */
  async getVoiceInfo(voiceId) {
    try {
      const response = await axios.get(`${ELEVENLABS_API_URL}/voices/${voiceId}`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      return response.data;

    } catch (error) {
      logger.error('Error fetching voice info:', error.response?.data || error.message);
      throw new Error('Failed to fetch voice info');
    }
  }

  /**
   * Get user subscription info (for quota tracking)
   */
  async getSubscriptionInfo() {
    try {
      const response = await axios.get(`${ELEVENLABS_API_URL}/user/subscription`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });

      return {
        character_count: response.data.character_count,
        character_limit: response.data.character_limit,
        remaining: response.data.character_limit - response.data.character_count,
        tier: response.data.tier
      };

    } catch (error) {
      logger.error('Error fetching subscription info:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Generate multi-voice audio from dialogue segments with word timings for karaoke
   * @param {Array} segments - Array of {speaker, text, voice_id}
   * @param {object} voiceSettings - Global voice settings (includes sessionId for usage tracking)
   * @param {object} storyContext - Story context for LLM emotion detection
   * @param {string} storyContext.genre - Story genre
   * @param {string} storyContext.mood - Overall mood
   * @param {string} storyContext.audience - Target audience
   * @param {string} storyContext.sceneDescription - Current scene description
   * @param {Array} storyContext.characters - Character information
   * @returns {object} { audio: Buffer, wordTimings: object } - Combined audio buffer and word timings
   */
  async generateMultiVoiceAudio(segments, voiceSettings = {}, storyContext = null) {
    if (!segments || segments.length === 0) {
      throw new Error('No segments provided');
    }

    const { sessionId } = voiceSettings; // Extract sessionId for usage tracking
    const onProgress = typeof voiceSettings.onProgress === 'function' ? voiceSettings.onProgress : null;

    // If only one segment, use TTS with timestamps for karaoke
    if (segments.length === 1) {
      const segment = segments[0];
      // Merge segment's emotion/delivery with voiceSettings for Audio Tags (v3)
      const singleSegmentSettings = {
        ...voiceSettings,
        detectedEmotion: segment.emotion || voiceSettings.detectedEmotion,
        delivery: segment.delivery || voiceSettings.delivery,
        speaker: segment.speaker
      };
      const result = await this.textToSpeechWithTimestamps(
        segment.text,
        segment.voice_id || this.defaultVoiceId,
        singleSegmentSettings
      );
      return {
        audio: result.audio,
        wordTimings: result.wordTimings,
        audioUrl: result.audioUrl
      };
    }

    if (onProgress) {
      try {
        onProgress({
          phase: 'start',
          message: 'Directing full-cast performances...',
          current: 0,
          total: segments.length
        });
      } catch (err) {
        logger.debug(`[MultiVoice] Progress callback failed (start): ${err.message}`);
      }
    }

    // Count segment types for INPUT summary
    const narratorCount = segments.filter(s => s.speaker === 'narrator').length;
    const dialogueCount = segments.filter(s => s.speaker !== 'narrator').length;
    const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))].filter(s => s !== 'narrator');
    const totalCharsInput = segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);

    logger.info(`[MultiVoice] INPUT | segments: ${segments.length} | narrator: ${narratorCount} | dialogue: ${dialogueCount} | speakers: ${uniqueSpeakers.length} | chars: ${totalCharsInput}`);
    logger.info(`[MultiVoice] ========== MULTI-VOICE GENERATION WITH TIMESTAMPS ==========`);

    // Run LLM-based emotion detection on all segments BEFORE processing
    let emotionEnhancedSegments = segments;
    if (storyContext) {
      try {
        if (onProgress) {
          try {
            onProgress({
              phase: 'emotion',
              message: 'Analyzing dialogue emotion and delivery...',
              current: 0,
              total: segments.length
            });
          } catch (err) {
            logger.debug(`[MultiVoice] Progress callback failed (emotion): ${err.message}`);
          }
        }

        logger.info(`[MultiVoice] Running LLM emotion detection with story context...`);
        logger.info(`[MultiVoice]   Genre: ${storyContext.genre || 'unknown'}, Mood: ${storyContext.mood || 'unknown'}`);
        emotionEnhancedSegments = await detectEmotionsForSegments(segments, storyContext, sessionId);
        const emotionSummary = emotionEnhancedSegments
          .filter(s => s.speaker !== 'narrator' && s.llmValidated)
          .map(s => `${s.speaker}:${s.emotion}`)
          .join(', ');
        logger.info(`[MultiVoice] LLM emotion detection complete: ${emotionSummary || 'no dialogue segments'}`);
      } catch (error) {
        logger.warn(`[MultiVoice] LLM emotion detection failed, using fallback: ${error.message}`);
        // Continue with original segments - fallback will be used per-segment
      }
    } else {
      logger.info(`[MultiVoice] No story context provided, using regex fallback for emotion detection`);
    }

    // Narrator delivery (v3 Audio Tags) - one LLM call per scene, cached.
    // Improves pacing/intent/prosody without brittle keyword heuristics.
    let narratorDirectives = null;
    const tagsModelId = voiceSettings.model_id || QUALITY_TIER_MODELS.premium; // eleven_v3
    if (storyContext && sessionId && modelSupportsAudioTags(tagsModelId)) {
      if (onProgress) {
        try {
          onProgress({
            phase: 'narrator_direction',
            message: 'Directing narrator delivery...',
            current: 0,
            total: segments.length
          });
        } catch (err) {
          logger.debug(`[MultiVoice] Progress callback failed (narrator): ${err.message}`);
        }
      }

      const narratorSample = emotionEnhancedSegments
        .filter(s => s.speaker === 'narrator')
        .map(s => s.text)
        .join('\n\n')
        .trim();

      if (narratorSample) {
        narratorDirectives = await getNarratorDeliveryDirectives({
          sessionId,
          sceneText: narratorSample,
          context: storyContext
        });
        logger.info(`[NarratorDelivery] scene | emotion=${narratorDirectives.emotion} | delivery="${narratorDirectives.delivery || 'none'}"`);
      }
    }

    // Pre-log all voice assignments for this multi-voice generation
    // ENHANCED LOGGING: Show full text for debugging overlaps/repetitions
    logger.info(`[MultiVoice] ========== VOICE ASSIGNMENTS ==========`);
    logger.info(`[MultiVoice] Total segments: ${emotionEnhancedSegments.length}`);
    let totalChars = 0;
    for (let i = 0; i < emotionEnhancedSegments.length; i++) {
      const seg = emotionEnhancedSegments[i];
      const vId = seg.voice_id || this.defaultVoiceId;
      const vName = await getVoiceNameById(vId);
      const emotionTag = seg.emotion && seg.emotion !== 'neutral' ? ` [Emotion: ${seg.emotion}]` : '';
      totalChars += seg.text.length;
      // Log truncated version for console
      logger.info(`[MultiVoice]   [${i + 1}/${emotionEnhancedSegments.length}] ${seg.speaker} → "${vName}" (${vId})${emotionTag}: "${seg.text.substring(0, 40)}..."`);
      // Log FULL TEXT for debugging overlaps - this is critical for diagnosing repeated/cut-off speech
      logger.debug(`[MultiVoice] FULL_TEXT[${i + 1}]: "${seg.text}"`);
    }
    logger.info(`[MultiVoice] Total characters across all segments: ${totalChars}`);

    // Generate audio for each segment WITH timestamps for karaoke
    const audioBuffers = [];
    const allWordTimings = [];
    let cumulativeTimeMs = 0;

    // Track successful and failed segments for debugging
    const segmentResults = [];

    for (let segIdx = 0; segIdx < emotionEnhancedSegments.length; segIdx++) {
      const segment = emotionEnhancedSegments[segIdx];
      const segmentInfo = {
        index: segIdx,
        speaker: segment.speaker,
        textPreview: segment.text.substring(0, 50),
        textLength: segment.text.length,
        success: false,
        error: null
      };

      try {
        if (onProgress) {
          try {
            const total = emotionEnhancedSegments.length;
            const current = segIdx + 1;
            const speakerLabel = segment.speaker === 'narrator' ? 'Narrator' : segment.speaker;
            onProgress({
              phase: 'tts_segment',
              message: `Synthesizing ${speakerLabel} (${current}/${total})...`,
              current,
              total
            });
          } catch (err) {
            logger.debug(`[MultiVoice] Progress callback failed (segment ${segIdx + 1}): ${err.message}`);
          }
        }

        const voiceId = segment.voice_id || this.defaultVoiceId;
        const voiceName = await getVoiceNameById(voiceId);
        segmentInfo.voiceId = voiceId;
        segmentInfo.voiceName = voiceName;

        // Get emotion - prefer LLM-validated, fallback to regex
        let emotion = segment.emotion || 'neutral';
        let emotionSource = segment.llmValidated ? 'LLM' : 'fallback';

        // If no LLM emotion, use regex fallback for explicit attributions only
        if (!segment.llmValidated && segment.speaker !== 'narrator') {
          const regexEmotion = detectLineEmotion(segment.text, segment.attribution || '');
          if (regexEmotion.confidence > 0.5) { // Only use regex if very explicit
            emotion = regexEmotion.emotion;
            emotionSource = 'regex';
          }
        }

        // Get the preset for this emotion
        const emotionPreset = VOICE_PRESETS[emotion] || VOICE_PRESETS.neutral;

        let segmentSettings;
        if (segment.speaker === 'narrator') {
          // Narrator: apply scene-level delivery direction for v3 Audio Tags (if available).
          const narratorOverride = narratorDirectives?.voiceSettingsOverride || {};
          segmentSettings = {
            ...voiceSettings,
            stability: narratorOverride.stability ?? voiceSettings.stability ?? 0.65,
            style: narratorOverride.style ?? voiceSettings.style ?? 0.25,
            sessionId,
            speaker: segment.speaker,
            detectedEmotion: narratorDirectives?.emotion || voiceSettings.detectedEmotion,
            delivery: narratorDirectives?.delivery || voiceSettings.delivery
          };
        } else {
          // Character dialogue - apply emotion preset + Audio Tags (v3)
          segmentSettings = {
            ...voiceSettings,
            stability: emotionPreset.stability,
            similarity_boost: emotionPreset.similarity_boost,
            style: emotionPreset.style,
            sessionId,
            speaker: segment.speaker,
            detectedEmotion: emotion,  // For v3 Audio Tags
            delivery: segment.delivery  // Additional delivery direction from dialogue_map
          };
        }

        // Log emotion detection for character dialogue
        const emotionLog = segment.speaker !== 'narrator'
          ? ` [Emotion: ${emotion} (${emotionSource})]`
          : '';
        logger.info(`[MultiVoice] Generating segment [${segIdx + 1}/${emotionEnhancedSegments.length}] with timestamps: ${segment.speaker} → "${voiceName}"${emotionLog}`);
        logger.info(`[MultiVoice]   Full text: "${segment.text}"`);
        if (segment.speaker !== 'narrator' && emotion !== 'neutral') {
          logger.info(`[MultiVoice]   Voice settings: stability=${segmentSettings.stability}, style=${segmentSettings.style}`);
          if (segment.emotionReasoning) {
            logger.info(`[MultiVoice]   LLM reasoning: ${segment.emotionReasoning}`);
          }
        }

        // Use textToSpeechWithTimestamps instead of textToSpeech for karaoke support
        const result = await this.textToSpeechWithTimestamps(
          segment.text,
          voiceId,
          segmentSettings
        );

        audioBuffers.push(result.audio);
        segmentInfo.success = true;
        segmentInfo.audioSize = result.audio?.length || 0;

        // Combine word timings with cumulative time offset
        if (result.wordTimings?.words) {
          const adjustedWords = result.wordTimings.words.map(word => ({
            ...word,
            start_ms: word.start_ms + cumulativeTimeMs,
            end_ms: word.end_ms + cumulativeTimeMs,
            speaker: segment.speaker,
            segment_index: segIdx
          }));
          allWordTimings.push(...adjustedWords);

          // Update cumulative time for next segment
          const segmentDuration = result.wordTimings.total_duration_ms ||
            (result.durationSeconds ? result.durationSeconds * 1000 : 0) ||
            (adjustedWords.length > 0 ? adjustedWords[adjustedWords.length - 1].end_ms - cumulativeTimeMs : 0);
          cumulativeTimeMs += segmentDuration;

          segmentInfo.wordCount = result.wordTimings.words.length;
          segmentInfo.durationMs = segmentDuration;
          logger.info(`[MultiVoice] Segment ${segIdx + 1} SUCCESS: ${result.wordTimings.words.length} words, duration=${segmentDuration}ms, cumulative=${cumulativeTimeMs}ms`);
        } else {
          logger.warn(`[MultiVoice] Segment ${segIdx + 1} has no word timings - karaoke may be incomplete`);
          segmentInfo.wordCount = 0;
        }

        // Small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        segmentInfo.success = false;
        segmentInfo.error = error.message;
        logger.error(`[MultiVoice] SEGMENT ${segIdx + 1} FAILED!`);
        logger.error(`[MultiVoice]   Speaker: ${segment.speaker}`);
        logger.error(`[MultiVoice]   Text: "${segment.text}"`);
        logger.error(`[MultiVoice]   Error: ${error.message}`);
        // Continue with other segments but track the failure
      }

      segmentResults.push(segmentInfo);
    }

    // Log comprehensive summary of all segments
    logger.info(`[MultiVoice] ========== SEGMENT PROCESSING SUMMARY ==========`);
    const successCount = segmentResults.filter(s => s.success).length;
    const failedCount = segmentResults.filter(s => !s.success).length;
    logger.info(`[MultiVoice] Total: ${segments.length}, Success: ${successCount}, Failed: ${failedCount}`);

    if (failedCount > 0) {
      logger.error(`[MultiVoice] FAILED SEGMENTS:`);
      segmentResults.filter(s => !s.success).forEach(s => {
        logger.error(`[MultiVoice]   [${s.index}] ${s.speaker}: "${s.textPreview}..." - Error: ${s.error}`);
      });
    }

    segmentResults.forEach(s => {
      const status = s.success ? 'OK' : 'FAILED';
      logger.info(`[MultiVoice]   [${s.index}] ${status} ${s.speaker} → ${s.voiceName || 'N/A'}: "${s.textPreview}..." (${s.textLength} chars)`);
    });
    logger.info(`[MultiVoice] =================================================`);

    if (audioBuffers.length === 0) {
      throw new Error('Failed to generate any audio segments');
    }

    // Combine audio buffers using audioAssembler with FFmpeg crossfade
    // This eliminates clicking/popping at segment boundaries
    let combinedBuffer;
    const hasFFmpeg = await checkFFmpegAvailable();

    if (onProgress) {
      try {
        onProgress({
          phase: 'assemble',
          message: 'Assembling audio...',
          current: audioBuffers.length,
          total: audioBuffers.length
        });
      } catch (err) {
        logger.debug(`[MultiVoice] Progress callback failed (assemble): ${err.message}`);
      }
    }

    if (hasFFmpeg && audioBuffers.length > 1) {
      // Build segment metadata for professional assembly with crossfade
      const assemblySegments = audioBuffers.map((audio, idx) => ({
        audio,
        speaker: emotionEnhancedSegments[idx]?.speaker || 'narrator',
        type: emotionEnhancedSegments[idx]?.speaker === 'narrator' ? 'narrator' : 'character',
        duration: segmentResults[idx]?.durationMs || 0
      }));

      logger.info(`[MultiVoice] Using FFmpeg crossfade assembly for ${assemblySegments.length} segments`);

      try {
        const assemblyResult = await assembleMultiVoiceAudio(assemblySegments, {
          ...ASSEMBLY_PRESETS.natural,
          outputFormat: 'mp3'
        });
        combinedBuffer = assemblyResult.audio;
        logger.info(`[MultiVoice] FFmpeg assembly complete: ${combinedBuffer.length} bytes`);
      } catch (assemblyError) {
        logger.warn(`[MultiVoice] FFmpeg assembly failed, falling back to simple concat: ${assemblyError.message}`);
        combinedBuffer = Buffer.concat(audioBuffers);
      }
    } else {
      // Fallback to simple concatenation (single segment or no FFmpeg)
      logger.info(`[MultiVoice] Using simple buffer concatenation (segments: ${audioBuffers.length}, ffmpeg: ${hasFFmpeg})`);
      combinedBuffer = Buffer.concat(audioBuffers);
    }

    // Build combined word timings object
    const combinedWordTimings = {
      words: allWordTimings,
      total_duration_ms: cumulativeTimeMs,
      segment_count: audioBuffers.length
    };

    logger.info(`[MultiVoice] OUTPUT | bytes: ${combinedBuffer.length} | segments: ${audioBuffers.length} | words: ${allWordTimings.length} | duration: ${cumulativeTimeMs}ms`);
    logger.info(`[MultiVoice] ================================================`);

    return {
      audio: combinedBuffer,
      wordTimings: combinedWordTimings,
      audioUrl: null // Will be set when cached
    };
  }

  /**
   * Cache combined multi-voice audio to disk
   * This is called separately from generateMultiVoiceAudio because the hash needs
   * to be generated by the orchestrator with the full text and -multi suffix
   * @param {string} hash - Pre-generated hash for the combined audio
   * @param {Buffer} audioBuffer - Combined audio buffer
   * @returns {string} The audio URL path
   */
  async cacheMultiVoiceAudio(hash, audioBuffer) {
    const filename = `${hash}.mp3`;
    const filePath = join(AUDIO_CACHE_DIR, filename);

    // Write the combined audio file (async to avoid blocking event loop)
    // FAIL LOUD: If we can't write the file, the audio is useless
    await writeFile(filePath, audioBuffer);

    logger.info(`[MultiVoice] Cached combined audio: ${filename} (${audioBuffer.length} bytes)`);

    return `/audio/${filename}`;
  }

  /**
   * Prepare segments with voice IDs based on character voice assignments
   * @param {Array} segments - Parsed dialogue segments
   * @param {object} characterVoices - {characterName: voiceId} - values are voice ID strings directly
   * @param {string} narratorVoiceId - Voice ID for narrator
   */
  prepareSegmentsWithVoices(segments, characterVoices, narratorVoiceId) {
    // CRITICAL: Ensure narrator voice is never null - breaks character voice comparison logic
    // Voice ID imported from constants/voices.js
    const safeNarratorVoiceId = narratorVoiceId || DEFAULT_NARRATOR_VOICE_ID;

    if (!narratorVoiceId) {
      logger.warn(`[MultiVoice] WARNING: narratorVoiceId was null/undefined! Using default: ${DEFAULT_NARRATOR_VOICE_ID}`);
    }

    // Log character voices for debugging multi-narrator issues
    logger.info(`[MultiVoice] prepareSegmentsWithVoices: ${Object.keys(characterVoices).length} character voices, narrator=${safeNarratorVoiceId}`);
    logger.info(`[MultiVoice] Character voice map keys: ${Object.keys(characterVoices).join(', ')}`);

    // CRITICAL: Log all unique speakers in segments
    const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))];
    logger.info(`[MultiVoice] Unique speakers in segments: ${uniqueSpeakers.join(', ')}`);

    return segments.map((segment, idx) => {
      // For narrator segments, use the narrator voice
      if (segment.speaker === 'narrator') {
        return { ...segment, voice_id: safeNarratorVoiceId };
      }

      // For character dialogue, look up voice by name (case-insensitive)
      // characterVoices is {name: voiceId} where voiceId is a string, NOT an object
      const speakerLower = segment.speaker.toLowerCase().trim();

      // PREMIUM: FAIL LOUDLY for "Unknown" or ambiguous speaker names
      // The dialogue parser should NEVER produce these - if it does, that's a bug
      const isUnknownSpeaker = speakerLower === 'unknown' ||
                               speakerLower === 'unknown speaker' ||
                               speakerLower === 'voice' ||
                               speakerLower === 'character' ||
                               speakerLower.includes('unknown') ||
                               speakerLower.startsWith('speaker ');

      if (isUnknownSpeaker) {
        logger.error(`[MultiVoice] CRITICAL: Dialogue parser produced ambiguous speaker "${segment.speaker}"`);
        logger.error(`[MultiVoice] This should NOT happen - dialogue parsing must identify all speakers correctly`);
        throw new Error(`DIALOGUE PARSING FAILED: Ambiguous speaker name "${segment.speaker}" detected. ` +
          `The dialogue parser must identify speakers by their character names. ` +
          `Available characters: [${Object.keys(characterVoices).join(', ')}]`);
      }

      // 1. Try exact match first
      let characterVoice = characterVoices[speakerLower];
      let matchType = 'exact';

      // Helper: Common titles to strip from names for matching
      const TITLES = ['dr.', 'dr', 'lt.', 'lt', 'captain', 'commander', 'professor', 'prof.', 'prof',
                      'mr.', 'mr', 'mrs.', 'mrs', 'ms.', 'ms', 'miss', 'sir', 'lord', 'lady',
                      'sgt.', 'sgt', 'cpl.', 'cpl', 'pvt.', 'pvt', 'gen.', 'gen', 'col.', 'col',
                      'maj.', 'maj', 'admiral', 'adm.', 'adm', 'rev.', 'rev', 'fr.', 'fr'];

      // Helper: Strip titles from name and return array of remaining words
      const normalizeNameForMatching = (name) => {
        const words = name.toLowerCase().trim().split(/\s+/);
        return words.filter(w => !TITLES.includes(w));
      };

      // 2. If not found, try partial matching (first name, last name, or any word match)
      if (!characterVoice) {
        const characterNames = Object.keys(characterVoices);
        for (const charName of characterNames) {
          // Get name words with titles stripped
          const charNameWords = normalizeNameForMatching(charName);

          // Check if speaker matches ANY word in the character name (handles "Raj" -> "Dr. Raj Patel")
          if (charNameWords.includes(speakerLower)) {
            characterVoice = characterVoices[charName];
            matchType = `word-match (${charName})`;
            break;
          }

          // Also normalize the speaker name in case it has a title (e.g., "Dr. Raj" -> matches "Raj")
          const speakerWords = normalizeNameForMatching(segment.speaker);
          if (speakerWords.length > 0 && charNameWords.some(w => speakerWords.includes(w))) {
            characterVoice = characterVoices[charName];
            matchType = `normalized-match (${charName})`;
            break;
          }

          // Legacy: Check if character name starts with speaker (handles "Dr. Keats" -> "Dr. Keats Johnson")
          if (charName.startsWith(speakerLower)) {
            characterVoice = characterVoices[charName];
            matchType = `prefix (${charName})`;
            break;
          }
        }
      }

      if (characterVoice) {
        // Check if the matched voice is different from narrator
        if (characterVoice === safeNarratorVoiceId) {
          logger.warn(`[MultiVoice] Speaker "${segment.speaker}" matched to character voice, but it's the SAME as narrator! Will use alternate voice.`);
          // DON'T use narrator for character dialogue - find an alternate
          characterVoice = null; // Force fallback to alternate voice selection below
        } else {
          logger.info(`[MultiVoice] Matched speaker "${segment.speaker}" -> voice ${characterVoice} (${matchType}, different from narrator)`);
          return { ...segment, voice_id: characterVoice };
        }
      }

      // ============================================================================
      // ★ C+E ARCHITECTURE: FAIL LOUD - NO FALLBACKS ★
      // ============================================================================
      // With the C+E architecture (Option C: scene writer outputs dialogue_map,
      // Option E: speaker validation ensures all speakers have voices), this code
      // path should NEVER be reached in normal operation.
      //
      // If we get here, it means:
      // 1. A speaker exists in dialogue that wasn't validated
      // 2. The speaker validation agent failed to catch this
      // 3. There's a bug in the C+E flow
      //
      // FAIL LOUD so we can fix the bug rather than silently produce bad audio.
      // ============================================================================
      const errorMsg = `[MultiVoice] CRITICAL: Speaker "${segment.speaker}" not found in character voice map! ` +
        `Known characters: [${Object.keys(characterVoices).join(', ')}]. ` +
        `This should not happen with C+E architecture - check generateSceneWithDialogue and speakerValidationAgent.`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    });
  }

  /**
   * Generate TTS with character-level timestamps for karaoke/Read Along feature
   * Uses ElevenLabs with-timestamps endpoint
   *
   * As of 2025-12-09, defaults to eleven_v3 with Audio Tags for 300% better quality.
   *
   * @param {string} text - Text to convert to speech
   * @param {string} voiceId - ElevenLabs voice ID
   * @param {object} options - Voice settings (includes sessionId for usage tracking)
   * @param {string} options.detectedEmotion - Emotion for Audio Tags (e.g., 'angry', 'whispered')
   * @param {string} options.delivery - Additional delivery notes
   * @returns {object} { audio, audioUrl, audioHash, checksum, wordTimings, durationSeconds }
   */
  async textToSpeechWithTimestamps(text, voiceId = null, options = {}) {
    const voice = voiceId || this.defaultVoiceId;
    const { sessionId, detectedEmotion, delivery } = options;

    // Determine model - v3 is new default for premium quality
    const modelId = options.model_id || QUALITY_TIER_MODELS.premium; // eleven_v3

    // Apply Audio Tags if using v3 and emotion/delivery is provided
    let processedText = text;
    const hasDelivery = typeof delivery === 'string' ? delivery.trim().length > 0 : !!delivery;
    if (modelSupportsAudioTags(modelId) && (hasDelivery || (detectedEmotion && detectedEmotion !== 'neutral'))) {
      processedText = wrapWithAudioTags(text, detectedEmotion || 'neutral', delivery);
      logger.info(`[ElevenLabs] Applied Audio Tags: "${processedText.substring(0, 60)}..."`);
    }

    logger.info(`[ElevenLabs] Generating TTS with timestamps (model=${modelId}): "${text.substring(0, 50)}..."`);

    // Check cache first (with timestamps) - use original text for cache key
    const cached = await this.checkCacheWithTimestamps(text, voice);
    if (cached) {
      logger.info(`Cache hit for TTS with timestamps: ${text.substring(0, 50)}...`);
      return cached;
    }

    try {
      const preset = options.preset ? VOICE_PRESETS[options.preset] : null;

      // ElevenLabs TTD (timestamps) API only accepts stability: 0.0, 0.5, or 1.0
      // Quantize to nearest valid value
      const rawStability = options.stability ?? preset?.stability ?? 0.5;
      const ttdStability = rawStability <= 0.25 ? 0.0 : rawStability >= 0.75 ? 1.0 : 0.5;

      const response = await axios.post(
        `${ELEVENLABS_API_URL}/text-to-speech/${voice}/with-timestamps`,
        {
          text: processedText,  // Use processed text with Audio Tags
          model_id: modelId,
          voice_settings: {
            stability: ttdStability, // Must be 0.0, 0.5, or 1.0 for TTD endpoint
            similarity_boost: options.similarity_boost ?? preset?.similarity_boost ?? 0.75,
            style: options.style ?? preset?.style ?? 0.3,
            use_speaker_boost: options.use_speaker_boost !== false
          },
          output_format: 'mp3_44100_128' // CD quality
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          timeout: 60000
        }
      );

      // Convert base64 audio to buffer
      const audioBuffer = Buffer.from(response.data.audio_base64, 'base64');

      // Track usage if sessionId provided (only for API calls, not cache hits)
      if (sessionId) {
        usageTracker.trackElevenLabsUsage(sessionId, text, audioBuffer.length);
      }

      // Process character alignment into word-level timings
      const wordTimings = this.processCharacterAlignment(
        response.data.alignment || response.data.normalized_alignment,
        text
      );

      // Calculate checksum for integrity
      const checksum = crypto.createHash('sha256').update(audioBuffer).digest('hex');
      const audioHash = this.generateHash(text, voice);

      // Cache both audio and alignment
      const cacheResult = await this.cacheAudioWithTimestamps(
        text, voice, audioBuffer, wordTimings, checksum
      );

      logger.info(`Generated TTS with timestamps: ${audioBuffer.length} bytes, ${wordTimings?.words?.length || 0} words`);

      return {
        audio: audioBuffer,
        audioUrl: cacheResult.audioUrl,
        audioHash: cacheResult.hash,
        checksum,
        wordTimings,
        durationSeconds: wordTimings?.total_duration_ms ? wordTimings.total_duration_ms / 1000 : null
      };

    } catch (error) {
      logger.error('ElevenLabs TTS with timestamps error:', error.response?.data || error.message);

      // Handle specific errors
      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      }
      if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded');
      }

      // Fallback to regular TTS without timestamps
      logger.warn('Falling back to TTS without timestamps');
      const audio = await this.textToSpeech(text, voice, options);
      return {
        audio,
        audioUrl: null,
        audioHash: this.generateHash(text, voice),
        checksum: crypto.createHash('sha256').update(audio).digest('hex'),
        wordTimings: null,
        durationSeconds: null
      };
    }
  }

  /**
   * Process character-level alignment from ElevenLabs into word-level timings
   * @param {object} alignment - ElevenLabs alignment data
   * @param {string} originalText - Original text for reference
   * @returns {object} Word-level timing data
   */
  processCharacterAlignment(alignment, originalText) {
    if (!alignment?.characters || !alignment?.character_start_times_seconds) {
      logger.warn('No alignment data available for word timing');
      return null;
    }

    const chars = alignment.characters;
    const charStartTimes = alignment.character_start_times_seconds.map(t => Math.round(t * 1000));
    const charEndTimes = alignment.character_end_times_seconds.map(t => Math.round(t * 1000));

    // Prosody tag pattern - matches [word] or [multiple words] patterns
    // These are ElevenLabs Audio Tags like [excitedly], [whispers], [angrily], etc.
    const prosodyTagPattern = /^\[[a-zA-Z][a-zA-Z\s\-']*\]$/;
    const embeddedTagPattern = /\[[a-zA-Z][a-zA-Z\s\-']*\]/g;

    const words = [];
    let currentWord = '';
    let wordStartTime = 0;
    let wordStartCharIndex = 0;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const charStart = charStartTimes[i];
      const charEnd = charEndTimes[i];

      // Track word start
      if (currentWord === '' && char.trim() !== '') {
        wordStartTime = charStart;
        wordStartCharIndex = i;
      }

      currentWord += char;

      // Word boundary detection (space, newline, or end of text)
      const isWordBoundary = char === ' ' || char === '\n' || char === '\t' || i === chars.length - 1;

      if (isWordBoundary) {
        let trimmedWord = currentWord.trim();

        // Skip if the entire word is a prosody tag like [excitedly]
        if (prosodyTagPattern.test(trimmedWord)) {
          currentWord = '';
          continue;
        }

        // Remove any embedded prosody tags from the word (e.g., "[excitedly]What" → "What")
        trimmedWord = trimmedWord.replace(embeddedTagPattern, '').trim();

        if (trimmedWord) {
          // Clean punctuation but keep the word
          const cleanWord = trimmedWord.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '') || trimmedWord;

          words.push({
            text: trimmedWord,
            clean_text: cleanWord,
            start_ms: wordStartTime,
            end_ms: charEnd,
            duration_ms: charEnd - wordStartTime,
            char_start_index: wordStartCharIndex,
            char_end_index: i
          });
        }

        currentWord = '';
      }
    }

    const totalDuration = charEndTimes[charEndTimes.length - 1] || 0;

    return {
      words,
      total_duration_ms: totalDuration,
      word_count: words.length,
      character_count: chars.length
    };
  }

  /**
   * Check cache for audio with timestamps
   */
  async checkCacheWithTimestamps(text, voiceId) {
    const hash = this.generateHash(text, voiceId);

    try {
      const result = await pool.query(`
        SELECT ac.file_path, ac.has_timestamps, wa.words, wa.total_duration_ms
        FROM audio_cache ac
        LEFT JOIN word_alignments wa ON ac.word_alignment_id = wa.id
        WHERE ac.text_hash = $1 AND ac.voice_id = $2
      `, [hash, voiceId]);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (existsSync(row.file_path)) {
          // Update access stats
          await pool.query(
            'UPDATE audio_cache SET access_count = access_count + 1, last_accessed_at = NOW() WHERE text_hash = $1',
            [hash]
          );

          const audioBuffer = await readFile(row.file_path);
          return {
            audio: audioBuffer,
            audioUrl: `/audio/${hash}.mp3`,
            audioHash: hash,
            checksum: crypto.createHash('sha256').update(audioBuffer).digest('hex'),
            wordTimings: row.words ? {
              words: row.words,
              total_duration_ms: row.total_duration_ms,
              word_count: row.words.length
            } : null,
            durationSeconds: row.total_duration_ms ? row.total_duration_ms / 1000 : null
          };
        }
      }

      return null;

    } catch (error) {
      logger.error('Cache check with timestamps error:', error);
      return null;
    }
  }

  /**
   * Cache audio with word timing data
   */
  async cacheAudioWithTimestamps(text, voiceId, audioBuffer, wordTimings, checksum) {
    const hash = this.generateHash(text, voiceId);
    const filename = `${hash}.mp3`;
    const filePath = join(AUDIO_CACHE_DIR, filename);

    try {
      // Save audio file (async to avoid blocking event loop)
      await writeFile(filePath, audioBuffer);

      let wordAlignmentId = null;

      // Save word alignment if available
      if (wordTimings?.words) {
        const waResult = await pool.query(`
          INSERT INTO word_alignments (audio_hash, voice_id, original_text, text_length, words, total_duration_ms, word_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (audio_hash, voice_id) DO UPDATE SET
            words = EXCLUDED.words,
            total_duration_ms = EXCLUDED.total_duration_ms,
            word_count = EXCLUDED.word_count
          RETURNING id
        `, [
          hash,
          voiceId,
          text.substring(0, 5000),
          text.length,
          JSON.stringify(wordTimings.words),
          wordTimings.total_duration_ms,
          wordTimings.word_count
        ]);

        wordAlignmentId = waResult.rows[0]?.id;
      }

      // Save to audio cache
      await pool.query(`
        INSERT INTO audio_cache (text_hash, voice_id, text_preview, file_path, file_size_bytes, duration_seconds, has_timestamps, word_alignment_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (text_hash, voice_id) DO UPDATE SET
          access_count = audio_cache.access_count + 1,
          last_accessed_at = NOW(),
          has_timestamps = EXCLUDED.has_timestamps,
          word_alignment_id = EXCLUDED.word_alignment_id
      `, [
        hash,
        voiceId,
        text.substring(0, 200),
        filePath,
        audioBuffer.length,
        wordTimings?.total_duration_ms ? wordTimings.total_duration_ms / 1000 : null,
        !!wordTimings,
        wordAlignmentId
      ]);

      return {
        audioUrl: `/audio/${filename}`,
        hash
      };

    } catch (error) {
      logger.error('Cache save with timestamps error:', error);
      return { audioUrl: null, hash };
    }
  }

  /**
   * Clean old cached audio files
   * @param {number} maxAgeDays - Maximum age in days
   */
  async cleanCache(maxAgeDays = 30) {
    try {
      const result = await pool.query(`
        DELETE FROM audio_cache
        WHERE last_accessed_at < NOW() - INTERVAL '${maxAgeDays} days'
        RETURNING file_path
      `);

      let cleaned = 0;
      const { unlink } = await import('fs/promises');
      for (const row of result.rows) {
        try {
          if (existsSync(row.file_path)) {
            await unlink(row.file_path);
            cleaned++;
          }
        } catch (e) {
          // Log but don't fail - cleanup is best-effort
          logger.warn(`Failed to delete cached file ${row.file_path}: ${e.message}`);
        }
      }

      logger.info(`Cleaned ${cleaned} cached audio files`);
      return cleaned;

    } catch (error) {
      logger.error('Cache cleanup error:', error);
      return 0;
    }
  }
}

export default ElevenLabsService;
