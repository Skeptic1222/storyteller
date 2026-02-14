/**
 * ElevenLabs TTS Service
 * Handles voice listing, text-to-speech generation, and audio caching
 */

import axios from 'axios';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../database/pool.js';
import { logger, logAlert } from '../utils/logger.js';
import { withRetry } from '../utils/apiRetry.js';
import * as usageTracker from './usageTracker.js';
import * as ttsGating from './ttsGating.js';
import { detectEmotionsForSegments } from './agents/emotionValidatorAgent.js';
import { getNarratorDeliveryDirectives } from './agents/narratorDeliveryAgent.js';
import { directVoiceActing } from './agents/voiceDirectorAgent.js';
import { getArchetype } from './narratorArchetypes.js';
import { assembleMultiVoiceAudio, ASSEMBLY_PRESETS, checkFFmpegAvailable } from './audioAssembler.js';
import { DEFAULT_NARRATOR_VOICE_ID } from '../constants/voices.js';
import { cache } from './cache.js';
import {
  containsPotentiallyRefusedContent,
  applyPhoneticRespellings,
  storeWordAlignment
} from './phoneticRespelling.js';
import { stripTags } from './agents/tagParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || join(__dirname, '..', '..', 'public', 'audio');

// Curated list of recommended storytelling voices (ElevenLabs free + premium defaults)
// These are organized by style and gender for the UI
// VOICE AGE METADATA (2026-01-31):
//   - age_group: What age the voice sounds like (child, teen, young_adult, adult, middle_aged, elderly)
//   - can_be_child: Whether suitable for voicing child characters (under 13)
//   - suitable_ages: Array of character age groups this voice works well for
export const RECOMMENDED_VOICES = {
  male_narrators: [
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', style: 'warm', gender: 'male', description: 'Warm British narrator, perfect for classic tales', age_group: 'middle_aged', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] },
    { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', style: 'authoritative', gender: 'male', description: 'Deep authoritative British accent', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] },
    { voice_id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', style: 'gravelly', gender: 'male', description: 'Gravelly Transatlantic, great for D&D', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged'] },
    { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', style: 'deep', gender: 'male', description: 'Deep American male', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged'] },
    { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', style: 'crisp', gender: 'male', description: 'Crisp American narrator', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult', 'middle_aged'] },
    { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', style: 'middle', gender: 'male', description: 'Deep middle-aged American', age_group: 'middle_aged', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] },
    { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', style: 'raspy', gender: 'male', description: 'Raspy American, great for mystery', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] }
  ],
  female_narrators: [
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', style: 'soft', gender: 'female', description: 'Soft American female, ideal for calm stories', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult', 'middle_aged'] },
    { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', style: 'seductive', gender: 'female', description: 'Swedish seductive voice', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult'] },
    { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', style: 'British', gender: 'female', description: 'British warm narrator', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult', 'middle_aged'] },
    { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', style: 'young', gender: 'female', description: 'Young American female, great for YA', age_group: 'young', can_be_child: true, suitable_ages: ['child', 'teen', 'young_adult'] },
    { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', style: 'pleasant', gender: 'female', description: 'Pleasant British storyteller', age_group: 'middle_aged', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] },
    { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', style: 'emotional', gender: 'female', description: 'Emotional American female', age_group: 'young_adult', can_be_child: false, suitable_ages: ['teen', 'young_adult', 'adult'] },
    { voice_id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace', style: 'gentle', gender: 'female', description: 'Gentle Southern American', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged', 'elderly'] }
  ],
  character_voices: [
    { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', style: 'Australian', gender: 'male', description: 'Friendly Australian male', age_group: 'young_adult', can_be_child: false, suitable_ages: ['teen', 'young_adult', 'adult'] },
    { voice_id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', style: 'young', gender: 'male', description: 'Young American male', age_group: 'young', can_be_child: true, suitable_ages: ['child', 'teen', 'young_adult'] },
    { voice_id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', style: 'friendly', gender: 'male', description: 'Friendly middle-aged American', age_group: 'middle_aged', can_be_child: false, suitable_ages: ['adult', 'middle_aged'] },
    { voice_id: 'ODq5zmih8GrVes37Dizd', name: 'Patrick', style: 'shouty', gender: 'male', description: 'Shouty American, great for action', age_group: 'adult', can_be_child: false, suitable_ages: ['adult', 'middle_aged'] },
    { voice_id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', style: 'anxious', gender: 'male', description: 'Anxious young British male', age_group: 'young', can_be_child: true, suitable_ages: ['child', 'teen', 'young_adult'] },
    { voice_id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas', style: 'calm', gender: 'male', description: 'Calm American male', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult', 'middle_aged'] }
  ],
  expressive_voices: [
    { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', style: 'warm', gender: 'female', description: 'Warm American, great for children\'s stories', age_group: 'young', can_be_child: true, suitable_ages: ['child', 'teen', 'young_adult'] },
    { voice_id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', style: 'conversational', gender: 'male', description: 'Conversational British-Essex', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult'] },
    { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', style: 'upbeat', gender: 'female', description: 'Upbeat American female', age_group: 'young_adult', can_be_child: true, suitable_ages: ['child', 'teen', 'young_adult', 'adult'] },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', style: 'articulate', gender: 'male', description: 'Articulate American male', age_group: 'adult', can_be_child: false, suitable_ages: ['young_adult', 'adult', 'middle_aged'] }
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
// V3 AUDIO TAGS - OFFICIAL ElevenLabs V3 Tags (2025-01-27)
// =============================================================================
// CRITICAL: ElevenLabs V3 model ONLY supports these 8 official tags.
// Any other tags are SILENTLY IGNORED by the API.
// See: https://elevenlabs.io/docs/speech-synthesis/audio-tags
// =============================================================================
export const V3_OFFICIAL_TAGS = ['excited', 'sad', 'angry', 'calm', 'fearful', 'surprised', 'whisper', 'shouting'];

/**
 * V3-Compliant emotion mapping - maps emotions to ONLY official V3 tags
 * Non-official tags were being silently ignored by the API
 */
export const EMOTION_TO_V3_TAG = {
  // Direct V3 tags (1:1 mapping)
  excited: '[excited]',
  sad: '[sad]',
  angry: '[angry]',
  calm: '[calm]',
  fearful: '[fearful]',
  surprised: '[surprised]',
  whisper: '[whisper]',
  shouting: '[shouting]',

  // Volume/Delivery → V3 equivalents
  whispered: '[whisper]',
  hushed: '[whisper]',
  murmured: '[whisper]',
  shouted: '[shouting]',
  yelled: '[shouting]',
  bellowed: '[shouting]',

  // Fear spectrum → fearful
  terrified: '[fearful]',
  nervous: '[fearful]',
  anxious: '[fearful]',
  panicked: '[fearful]',

  // Anger spectrum → angry
  furious: '[angry]',
  enraged: '[angry]',
  irritated: '[angry]',

  // Sadness spectrum → sad
  grieving: '[sad]',
  melancholy: '[sad]',
  mournful: '[sad]',
  devastated: '[sad]',

  // Joy spectrum → excited
  joyful: '[excited]',
  triumphant: '[excited]',
  happy: '[excited]',
  elated: '[excited]',
  ecstatic: '[excited]',

  // Calm spectrum → calm
  tender: '[calm]',
  loving: '[calm]',
  comforting: '[calm]',
  peaceful: '[calm]',
  gentle: '[calm]',
  warm: '[calm]',
  soothing: '[calm]',

  // Menace spectrum → combinations
  threatening: '[angry][whisper]',
  menacing: '[angry][whisper]',
  sinister: '[fearful][whisper]',

  // Horror intensity → fearful combinations
  brutal: '[angry][shouting]',
  bloodthirsty: '[angry]',
  agonized: '[fearful][shouting]',
  tormented: '[sad][fearful]',
  predatory: '[angry][whisper]',
  unhinged: '[excited][angry]',
  chilling: '[fearful][whisper]',

  // Intimate → calm
  passionate: '[excited]',
  sensual: '[calm][whisper]',
  intimate: '[calm][whisper]',
  yearning: '[sad]',
  heated: '[excited]',

  // Complex emotions → best V3 match
  sarcastic: '[calm]',        // Dry delivery
  mocking: '[excited]',       // Amused tone
  dry: '[calm]',              // Understated
  questioning: '[surprised]',
  uncertain: '[fearful]',
  confused: '[surprised]',
  desperate: '[fearful][shouting]',
  resigned: '[sad]',
  exhausted: '[sad][whisper]',
  relieved: '[calm]',
  bitter: '[angry][whisper]',
  wistful: '[sad][calm]',
  awestruck: '[surprised]',
  defiant: '[angry]',
  pleading: '[sad][fearful]',
  commanding: '[shouting]',
  seductive: '[calm][whisper]',
  reverent: '[calm][whisper]',

  // Story mood presets
  calm_bedtime: '[calm]',
  dramatic: '[excited]',
  playful: '[excited]',
  mysterious: '[whisper][fearful]',
  action: '[excited][shouting]',
  horror: '[fearful][whisper]',

  // Narrator styles → V3 equivalents
  warm_gentle: '[calm]',
  dramatic_theatrical: '[excited]',
  playful_energetic: '[excited]',
  mysterious_dark: '[whisper][fearful]',

  // Default
  neutral: ''  // No tags for neutral delivery
};

// DEPRECATED: Legacy alias - use EMOTION_TO_V3_TAG directly instead
// Kept as simple alias for backwards compatibility (no Proxy overhead)
export const EMOTION_TO_AUDIO_TAGS = EMOTION_TO_V3_TAG;

const hasBracketTags = (value) => typeof value === 'string' && /\[[^\]]+\]/.test(value);

/**
 * Ensure audio tags are V3-compliant by filtering to only official tags
 * Non-V3 tags are silently removed to prevent API ignoring them
 *
 * @param {string} tags - Tag string like "[excited][happy][whisper]"
 * @returns {string} V3-compliant tags like "[excited][whisper]"
 */
export function ensureV3Compliant(tags) {
  if (!tags || typeof tags !== 'string') return '';

  const matches = tags.match(/\[([^\]]+)\]/g) || [];
  const v3Tags = matches.filter(tag => {
    const tagName = tag.replace(/[\[\]]/g, '').toLowerCase();
    return V3_OFFICIAL_TAGS.includes(tagName);
  });

  if (v3Tags.length !== matches.length) {
    const removed = matches.filter(t => !v3Tags.includes(t));
    logger.debug(`[ElevenLabs V3] Removed non-compliant tags: ${removed.join(', ')} | kept: ${v3Tags.join('')}`);
  }

  return v3Tags.join('');
}

// =============================================================================
// P0 CRITICAL: Role-Based Stability Assignment
// =============================================================================
// TTD endpoint ONLY accepts stability values: 0.0, 0.5, or 1.0
// Assign stability based on speaker role for optimal voice acting:
// - Narrator: 1.0 (Robust) - Consistent, professional delivery
// - Emotional characters: 0.0 (Creative) - Maximum expressiveness
// - Default characters: 0.5 (Natural) - Balanced delivery
// =============================================================================

/**
 * Quantize stability value to valid TTD values: 0.0, 0.5, or 1.0
 * TTD endpoint REJECTS any other values with HTTP 400
 *
 * DEFENSIVE: Handles undefined, NaN, and out-of-range values safely
 *
 * @param {number} value - Raw stability value (0.0 to 1.0)
 * @returns {number} Quantized value: 0.0, 0.5, or 1.0
 */
function quantizeTTDStability(value) {
  // DEFENSIVE: Handle invalid inputs
  if (value === undefined || value === null || typeof value !== 'number' || Number.isNaN(value)) {
    logger.warn(`[ElevenLabs TTD] Invalid stability input: ${value} (type: ${typeof value}), defaulting to 0.5`);
    return 0.5; // Natural - safe default
  }

  // Clamp to valid range first
  const clamped = Math.max(0.0, Math.min(1.0, value));

  // Quantize to valid TTD values
  if (clamped <= 0.25) return 0.0; // Creative
  if (clamped <= 0.75) return 0.5; // Natural
  return 1.0; // Robust
}

/**
 * High-intensity emotions that should trigger Creative stability (0.0)
 * These benefit from maximum expressiveness
 */
const HIGH_INTENSITY_EMOTIONS = [
  'fearful', 'terrified', 'angry', 'furious', 'excited', 'sad', 'grieving',
  'desperate', 'agonized', 'passionate', 'bloodthirsty', 'unhinged',
  'panicked', 'enraged', 'ecstatic', 'devastated'
];

/**
 * High-intensity emotion tags that should trigger Creative stability (0.0)
 * for BOTH narrator and dialogue characters
 */
const HIGH_EMOTION_TAGS = [
  'terrified', 'horrified', 'anguished', 'desperate', 'frantic',
  'ecstatic', 'furious', 'sobbing', 'screaming', 'panicked',
  'enraged', 'devastated', 'hysterical', 'bloodthirsty', 'unhinged'
];

/**
 * Medium-intensity emotion tags that should trigger Natural-Creative stability
 */
const MEDIUM_EMOTION_TAGS = [
  'fearful', 'anxious', 'excited', 'angry', 'sad', 'surprised',
  'tense', 'urgent', 'dramatic', 'ominous', 'foreboding',
  'menacing', 'threatening', 'passionate', 'intense', 'grieving'
];

/**
 * Low-intensity/neutral tags - more stable delivery
 */
const LOW_EMOTION_TAGS = [
  'calm', 'measured', 'gentle', 'warm', 'soft', 'reflective',
  'contemplative', 'peaceful', 'tender', 'soothing'
];

/**
 * Extract emotion tags from various segment/direction sources
 */
function extractEmotionTags(segment, voiceDirection) {
  const tags = new Set();

  // From voiceDirection tags array
  if (voiceDirection?.tags) {
    voiceDirection.tags.forEach(t => tags.add(t.toLowerCase().replace(/[\[\]]/g, '')));
  }

  // From segment's voiceDirection
  if (segment?.voiceDirection?.tags) {
    segment.voiceDirection.tags.forEach(t => tags.add(t.toLowerCase().replace(/[\[\]]/g, '')));
  }

  // From v3AudioTags string (e.g., "[fearful][urgent]")
  const v3Tags = segment?.v3AudioTags || segment?.v3Tags || voiceDirection?.v3AudioTags || '';
  if (v3Tags) {
    const matches = v3Tags.match(/\[([^\]]+)\]/g) || [];
    matches.forEach(m => tags.add(m.replace(/[\[\]]/g, '').toLowerCase()));
  }

  // From delivery string
  const delivery = segment?.delivery || voiceDirection?.delivery || '';
  if (delivery) {
    const matches = delivery.match(/\[([^\]]+)\]/g) || [];
    matches.forEach(m => tags.add(m.replace(/[\[\]]/g, '').toLowerCase()));
  }

  // From direct emotion fields
  if (segment?.emotion) tags.add(segment.emotion.toLowerCase());
  if (voiceDirection?.primaryEmotion) tags.add(voiceDirection.primaryEmotion.toLowerCase());
  if (voiceDirection?.emotions) {
    voiceDirection.emotions.forEach(e => tags.add(e.toLowerCase()));
  }

  return tags;
}

/**
 * Get role-based stability for TTD endpoint
 *
 * IMPORTANT: Narrator stability is now CONTEXT-AWARE, not hardcoded to 1.0.
 * This enables expressive narrator delivery for horror, thriller, drama, etc.
 *
 * @param {object} segment - The segment being processed
 * @param {object} voiceDirection - Voice direction data (v3Tags, emotions, intensity)
 * @param {object} options - Additional options (genre, genreProfile)
 * @returns {number} TTD stability: 0.0 (Creative), 0.5 (Natural), or 1.0 (Robust)
 */
export function getStabilityForRole(segment, voiceDirection = {}, options = {}) {
  const isNarrator = segment?.speaker === 'narrator' || options.isNarrator === true;
  const emotionTags = extractEmotionTags(segment, voiceDirection);

  // Log for debugging narrator expressiveness
  if (isNarrator && emotionTags.size > 0) {
    logger.debug(`[ElevenLabs] Narrator stability check | tags: ${[...emotionTags].join(', ')}`);
  }

  // Check for high-intensity emotions - Creative stability (0.0) for both narrator and dialogue
  if (HIGH_EMOTION_TAGS.some(t => emotionTags.has(t))) {
    const result = isNarrator ? 0.0 : 0.0; // Creative for maximum expressiveness
    logger.debug(`[ElevenLabs] HIGH_EMOTION stability=${result} | speaker=${segment?.speaker} | tags: ${[...emotionTags].join(', ')}`);
    return result;
  }

  // Check for medium-intensity emotions
  if (MEDIUM_EMOTION_TAGS.some(t => emotionTags.has(t))) {
    // Narrator gets slightly higher stability (0.35) to maintain some consistency
    // Dialogue characters get lower (0.3) for more variation
    const result = isNarrator ? 0.35 : 0.3;
    logger.debug(`[ElevenLabs] MEDIUM_EMOTION stability=${result} | speaker=${segment?.speaker} | tags: ${[...emotionTags].join(', ')}`);
    return result;
  }

  // Check for low-intensity/neutral emotions
  if (LOW_EMOTION_TAGS.some(t => emotionTags.has(t))) {
    const result = isNarrator ? 0.5 : 0.4;
    logger.debug(`[ElevenLabs] LOW_EMOTION stability=${result} | speaker=${segment?.speaker}`);
    return result;
  }

  // Check for high-intensity voice direction metadata
  if (voiceDirection?.intensity === 'high' || voiceDirection?.emotionalIntensity === 'high') {
    return isNarrator ? 0.2 : 0.0; // Creative
  }

  // Check for extracted emotional cues from speechTagFilterAgent
  if (segment?.extractedEmotionalCues?.intensity === 'high') {
    return isNarrator ? 0.2 : 0.0; // Creative
  }

  // Check for delivery modes that need expressiveness
  if (segment?.deliveryMode === 'whisper' || segment?.deliveryMode === 'shouting') {
    return 0.0; // Creative - whispers/shouts need natural variation
  }
  if (voiceDirection?.delivery === 'whisper' || voiceDirection?.delivery === 'shout') {
    return 0.0; // Creative
  }

  // Check for high-intensity emotions from direct fields
  const emotions = [
    segment?.emotion,
    segment?.extractedEmotionalCues?.emotions?.[0],
    voiceDirection?.primaryEmotion,
    ...(voiceDirection?.emotions || [])
  ].filter(Boolean).map(e => e.toLowerCase());

  if (emotions.some(e => HIGH_INTENSITY_EMOTIONS.includes(e))) {
    return isNarrator ? 0.2 : 0.0; // Creative - maximum expressiveness for intense emotions
  }

  // Check v3AudioTags for emotional content (fallback for legacy format)
  const v3Tags = segment?.v3AudioTags || segment?.v3Tags || voiceDirection?.v3AudioTags || '';
  if (v3Tags && (
    v3Tags.includes('[fearful') || v3Tags.includes('[angry') ||
    v3Tags.includes('[terrified') || v3Tags.includes('[desperate') ||
    v3Tags.includes('[shout') || v3Tags.includes('[whisper') ||
    v3Tags.includes('[scream') || v3Tags.includes('[panick')
  )) {
    return isNarrator ? 0.25 : 0.0; // Creative
  }

  // Use genre profile default if available
  if (isNarrator && options.genreProfile?.narrator?.defaultStability !== undefined) {
    const genreStability = options.genreProfile.narrator.defaultStability;
    logger.debug(`[ElevenLabs] Using genre narrator stability=${genreStability} for ${options.genre || 'unknown'}`);
    return genreStability;
  }

  // Default stability based on role
  if (isNarrator) {
    // Default narrator: Natural-Robust (0.6) - expressive but consistent
    // This is much lower than the old hardcoded 1.0
    return 0.6;
  }

  // Default for dialogue characters: Natural
  return 0.5; // Natural - balanced expressiveness
}

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
/**
 * Wrap text with V3 Audio Tags
 *
 * Priority order:
 * 1. v3AudioTags - Pre-converted V3-compliant tags from VoiceDirector
 * 2. delivery - Natural language tags (will be converted)
 * 3. emotion - Base emotion mapping
 *
 * P0 CRITICAL: Supports layering delivery mode + emotion for combined emotional states
 * Example: whispered + sad → "[whispers][sadly]I'm so sorry"
 *
 * @param {string} text - The text to wrap
 * @param {string} emotion - The detected emotion (e.g., 'angry', 'whispered')
 * @param {string} [delivery] - Natural language delivery notes
 * @param {string} [v3AudioTags] - Pre-converted V3-compliant audio tags
 * @param {object} [extractedCues] - Extracted emotional cues from speechTagFilterAgent
 * @returns {string} Text with Audio Tags prepended
 */
export function wrapWithAudioTags(text, emotion, delivery = null, v3AudioTags = null, extractedCues = null) {
  if (!text) return text;

  // If we have pre-converted V3 tags, use them directly
  if (v3AudioTags && v3AudioTags.trim()) {
    // P0: Layer with extracted cues if present and not already included
    if (extractedCues?.hasEmotionalContent) {
      let layeredTags = v3AudioTags;

      // Add delivery mode if not present (using V3-compliant tag names)
      if (extractedCues.delivery === 'whisper' && !layeredTags.toLowerCase().includes('[whisper')) {
        layeredTags = '[whisper]' + layeredTags;  // V3 FIX: [whisper] not [whispers]
      } else if (extractedCues.delivery === 'shouting' && !layeredTags.toLowerCase().includes('[shout')) {
        layeredTags = '[shouting]' + layeredTags;  // V3 FIX: [shouting] not [shouts]
      }

      logger.debug(`[AudioTags] LAYERED | v3Tags: "${v3AudioTags}" | extractedCues: ${JSON.stringify(extractedCues)} | final: "${layeredTags}"`);
      return `${layeredTags}${text}`;
    }

    logger.debug(`[AudioTags] WRAP | v3Tags: "${v3AudioTags}" | text: "${text.substring(0, 40)}..."`);
    return `${v3AudioTags}${text}`;
  }

  const baseEmotion = (emotion || 'neutral').toString().toLowerCase().trim();

  // Get base tags from emotion mapping (use V3 mapping directly)
  const baseTags = EMOTION_TO_V3_TAG[baseEmotion] || '';

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

  // P0: Build layered tags from extracted cues + emotion + delivery
  const allTags = [];

  // 1. Delivery mode first (outermost) from extracted cues (V3-compliant names)
  if (extractedCues?.delivery === 'whisper') {
    allTags.push('[whisper]');  // V3 FIX: [whisper] not [whispers]
  } else if (extractedCues?.delivery === 'shouting') {
    allTags.push('[shouting]');  // V3 FIX: [shouting] not [shouts]
  }

  // 2. Base emotion tags
  allTags.push(...extractTags(baseTags));

  // 3. Additional delivery tags
  allTags.push(...extractTags(delivery));

  // 4. Extracted emotion tags (if not already covered by baseEmotion)
  if (extractedCues?.emotions?.length > 0) {
    const coveredEmotions = baseEmotion.toLowerCase();
    for (const emo of extractedCues.emotions) {
      if (!coveredEmotions.includes(emo.toLowerCase())) {
        const emoTag = EMOTION_TO_V3_TAG[emo.toLowerCase()];
        if (emoTag) {
          allTags.push(...extractTags(emoTag));
        }
      }
    }
  }

  // De-dupe case-insensitive while preserving order
  const seen = new Set();
  const tags = allTags.filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('');

  // Log Audio Tag wrapping for debugging
  if (tags) {
    logger.debug(`[AudioTags] WRAP | emotion: ${baseEmotion} | delivery: ${delivery || 'none'} | extractedCues: ${extractedCues ? 'yes' : 'no'} | tags: "${tags}" | text: "${text.substring(0, 40)}..."`);
  }

  // Return text with tags prepended
  return tags ? `${tags}${text}` : text;
}

/**
 * Convert a dialogue segment to v3 format with Audio Tags
 *
 * Uses the priority:
 * 1. segment.v3AudioTags - Pre-converted V3 tags from VoiceDirector
 * 2. segment.delivery - Natural language tags
 * 3. segment.emotion - Base emotion mapping
 *
 * @param {object} segment - Segment with text, emotion, delivery, v3AudioTags properties
 * @returns {object} Segment with text wrapped in Audio Tags
 */
export function convertSegmentToV3(segment) {
  if (!segment || !segment.text) return segment;

  return {
    ...segment,
    text: wrapWithAudioTags(
      segment.text,
      segment.emotion,
      segment.delivery,
      segment.v3AudioTags,
      segment.extractedEmotionalCues // P0: Pass extracted emotional cues for layering
    ),
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
    supports_speaker_boost: false,  // P2.3: V3 does NOT support speaker_boost
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
    supports_speaker_boost: true,  // P2.3: V2 DOES support speaker_boost
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
    supports_speaker_boost: true,  // P2.3: Turbo DOES support speaker_boost
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
    supports_speaker_boost: true,  // P2.3: Flash DOES support speaker_boost
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
    supports_speaker_boost: false,  // P2.3: Legacy monolingual does NOT support speaker_boost
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

// Voice name cache for logging (voice_id -> { name, cachedAt } mapping)
// This is a CACHE (not a session tracker) so we use LRU eviction instead of FAIL LOUD
const voiceNameCache = new Map();
const VOICE_CACHE_MAX_SIZE = 500; // Max cached voice lookups
const VOICE_CACHE_TTL = 3600000; // 1 hour TTL for cached voice names

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
  voiceNameCache.set(voiceId, { name, cachedAt: Date.now() });
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

  // Check cache first (with TTL expiration)
  if (voiceNameCache.has(voiceId)) {
    const cached = voiceNameCache.get(voiceId);
    if (Date.now() - cached.cachedAt < VOICE_CACHE_TTL) {
      return cached.name;
    }
    // Expired - remove and fall through to lookup
    voiceNameCache.delete(voiceId);
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

// Periodic cleanup of old cached audio files
const AUDIO_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUDIO_CACHE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function cleanupAudioCache() {
  try {
    const files = await readdir(AUDIO_CACHE_DIR);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.mp3')) continue;
      try {
        const filePath = join(AUDIO_CACHE_DIR, file);
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > AUDIO_CACHE_MAX_AGE_MS) {
          await unlink(filePath);
          cleanedCount++;
        }
      } catch (err) {
        // Skip files that can't be stat'd or deleted
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[AudioCache] Cleanup removed ${cleanedCount} expired .mp3 files`);
    }
  } catch (err) {
    logger.warn(`[AudioCache] Cleanup failed (non-critical): ${err.message}`);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupAudioCache, AUDIO_CACHE_CLEANUP_INTERVAL_MS);
// Run once on startup after 60-second delay
setTimeout(cleanupAudioCache, 60000);

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

      // BUG FIX 7: Strip audio tags if model doesn't support them (prevents literal speaking)
      let processedText = text;
      if (!modelSupportsAudioTags(modelId)) {
        const originalLength = processedText.length;
        processedText = stripTags(processedText);
        if (processedText.length !== originalLength) {
          logger.info(`[ElevenLabs] Stripped audio tags from text for non-V3 model: removed ${originalLength - processedText.length} chars`);
        }
      }

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

      // P2.3: Only include speaker_boost if model supports it (V3 does NOT)
      const useSpeakerBoost = options.use_speaker_boost ?? tierDefaults.use_speaker_boost;

      // Build voice settings object
      const voiceSettings = {
        stability,
        similarity_boost: similarityBoost
      };

      // P2.3: Only add speaker_boost if model supports it (V2/Turbo/Flash yes, V3 no)
      if (modelConfig.supports_speaker_boost) {
        voiceSettings.use_speaker_boost = useSpeakerBoost;
      }

      // Only add style if model supports it
      if (modelConfig.supports_style) {
        voiceSettings.style = style;
      }

      // P2.3: Add seed parameter for voice consistency across sessions
      // Generate deterministic seed based on sessionId + voiceId + segment for reproducibility
      if (options.seed !== undefined) {
        voiceSettings.seed = options.seed;
      } else if (options.sessionId && voice) {
        // Create deterministic seed from session + voice (reproducible across calls)
        const seedData = `${options.sessionId}:${voice}:${quality_tier}`;
        const seedHash = crypto.createHash('sha256').update(seedData).digest();
        voiceSettings.seed = seedHash.readUInt32BE(0); // Use first 4 bytes as uint32 seed
      }

      logger.info(`[ElevenLabs] Generating TTS: model=${modelId}, tier=${quality_tier}, stability=${stability}, style=${style}`);

      // Build request body
      const requestBody = {
        text: processedText,
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
            timeout: Math.max(30000, text.length * 60) // Min 30s, scale ~60ms per char for V3
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

    // =============================================================================
    // VOICE DIRECTOR: Comprehensive LLM-based voice acting direction
    // =============================================================================
    // This replaces both emotion detection AND narrator delivery with a single
    // comprehensive pass that understands:
    // - Story context and genre conventions
    // - Character personalities and emotional arcs
    // - ElevenLabs v3 audio tag syntax and capabilities
    // - Voice settings (stability, style) per segment
    // =============================================================================
    let voiceDirectedSegments = segments;
    const tagsModelId = voiceSettings.model_id || QUALITY_TIER_MODELS.premium; // eleven_v3

    // BUG FIX: Check if segments are already voice-directed (from orchestrator.js)
    // If already directed, SKIP redundant voiceDirector call to preserve profile-based settings
    const alreadyDirected = segments.some(s => s.voiceDirected === true);

    if (storyContext && modelSupportsAudioTags(tagsModelId) && !alreadyDirected) {
      try {
        if (onProgress) {
          try {
            onProgress({
              phase: 'voice_direction',
              message: 'Voice Director analyzing scene...',
              current: 0,
              total: segments.length
            });
          } catch (err) {
            logger.debug(`[MultiVoice] Progress callback failed (voice_direction): ${err.message}`);
          }
        }

        logger.info(`[VoiceDirector] ========== VOICE DIRECTION PASS ==========`);
        logger.info(`[VoiceDirector] Analyzing ${segments.length} segments with full story context`);
        logger.info(`[VoiceDirector] Context: genre=${storyContext.genre || 'unknown'}, mood=${storyContext.mood || 'unknown'}, audience=${storyContext.audience || 'general'}`);

        // Run comprehensive voice direction
        voiceDirectedSegments = await directVoiceActing(segments, storyContext, sessionId);

        // Log summary of voice direction
        const directedCount = voiceDirectedSegments.filter(s => s.voiceDirected).length;
        const sampleNarrator = voiceDirectedSegments
          .filter(s => s.speaker === 'narrator' && s.voiceDirected)
          .slice(0, 2)
          .map(s => `"${s.delivery}" (stab=${s.voiceStability}, style=${s.voiceStyle})`)
          .join(' | ');
        const sampleDialogue = voiceDirectedSegments
          .filter(s => s.speaker !== 'narrator' && s.voiceDirected)
          .slice(0, 2)
          .map(s => `${s.speaker}: "${s.delivery}"`)
          .join(' | ');

        logger.info(`[VoiceDirector] Directed ${directedCount}/${segments.length} segments`);
        if (sampleNarrator) logger.info(`[VoiceDirector] Narrator samples: ${sampleNarrator}`);
        if (sampleDialogue) logger.info(`[VoiceDirector] Dialogue samples: ${sampleDialogue}`);
        logger.info(`[VoiceDirector] ========================================`);

      } catch (error) {
        logger.error(`[VoiceDirector] Voice direction failed: ${error.message}`);
        logAlert('error', '[VoiceDirector] direction failure (fail-loud)', { error: error.message, sessionId });
        throw error;
      }
    } else if (alreadyDirected) {
      // Segments already have voice direction from orchestrator.js - use them as-is
      const directedCount = segments.filter(s => s.voiceDirected).length;
      const sampleSettings = segments.filter(s => s.voiceDirected).slice(0, 2)
        .map(s => `${s.speaker}: stab=${s.voiceStability?.toFixed(2)} style=${s.voiceStyle?.toFixed(2)}`)
        .join(' | ');
      logger.info(`[MultiVoice] Segments PRE-DIRECTED: ${directedCount}/${segments.length} already have voice direction (preserving profile-based settings)`);
      logger.info(`[MultiVoice] Sample settings: ${sampleSettings}`);
    } else {
      logger.info(`[MultiVoice] No story context or model doesn't support audio tags, using legacy detection`);
      // Fallback for non-v3 models or missing context
      if (storyContext) {
        try {
          voiceDirectedSegments = await detectEmotionsForSegments(segments, storyContext, sessionId, { includeNarrator: true });
        } catch (error) {
          logger.warn(`[MultiVoice] Legacy emotion detection failed: ${error.message}`);
        }
      }
    }

    // Legacy narrator directives are no longer needed - Voice Director handles per-segment
    const narratorDirectives = null; // Kept for backward compatibility in segment processing

    // Use Voice Director output as the segments for TTS generation
    const emotionEnhancedSegments = voiceDirectedSegments;

    // =============================================================================
    // OPTIMIZATION: Pre-compute voice name map (batch lookup instead of N queries)
    // =============================================================================
    const uniqueVoiceIds = [...new Set(emotionEnhancedSegments.map(s => s.voice_id || this.defaultVoiceId))];
    const voiceNameMap = new Map();
    const voiceNameResults = await Promise.allSettled(uniqueVoiceIds.map(async (vId) => {
      const vName = await getVoiceNameById(vId);
      return { vId, vName };
    }));
    voiceNameResults.forEach(result => {
      if (result.status === 'fulfilled') {
        voiceNameMap.set(result.value.vId, result.value.vName);
      } else {
        logger.warn(`[MultiVoice] Failed to load voice name: ${result.reason?.message || result.reason}`);
      }
    });
    logger.info(`[MultiVoice] Pre-loaded ${voiceNameMap.size} voice names (was ${emotionEnhancedSegments.length} queries)`);

    // Pre-log all voice assignments for this multi-voice generation
    // ENHANCED LOGGING: Show full text for debugging overlaps/repetitions
    logger.info(`[MultiVoice] ========== VOICE ASSIGNMENTS ==========`);
    logger.info(`[MultiVoice] Total segments: ${emotionEnhancedSegments.length}`);
    let totalChars = 0;
    for (let i = 0; i < emotionEnhancedSegments.length; i++) {
      const seg = emotionEnhancedSegments[i];
      const vId = seg.voice_id || this.defaultVoiceId;
      const vName = voiceNameMap.get(vId) || vId; // Use pre-computed map
      const emotionTag = seg.emotion && seg.emotion !== 'neutral' ? ` [Emotion: ${seg.emotion}]` : '';
      totalChars += seg.text.length;
      // Log truncated version for console
      logger.info(`[MultiVoice]   [${i + 1}/${emotionEnhancedSegments.length}] ${seg.speaker} → "${vName}" (${vId})${emotionTag}: "${seg.text.substring(0, 40)}..."`);
      // Log FULL TEXT for debugging overlaps - this is critical for diagnosing repeated/cut-off speech
      logger.debug(`[MultiVoice] FULL_TEXT[${i + 1}]: "${seg.text}"`);
    }
    logger.info(`[MultiVoice] Total characters across all segments: ${totalChars}`);

    // Generate audio for each segment WITH timestamps for karaoke
    // =============================================================================
    // OPTIMIZATION: Parallel batch processing (5 concurrent TTS calls instead of sequential)
    // This reduces 385 segments from ~10-15 minutes to ~2-4 minutes (60-80% faster)
    // =============================================================================
    const TTS_BATCH_SIZE = 5; // ElevenLabs allows concurrent requests, 5 is safe
    const segmentResults = [];

    // Helper function to process a single segment (returns result with index for ordering)
    const processSegment = async (segment, segIdx) => {
      const segmentInfo = {
        index: segIdx,
        speaker: segment.speaker,
        textPreview: segment.text.substring(0, 50),
        textLength: segment.text.length,
        success: false,
        error: null,
        audio: null,
        wordTimings: null,
        durationMs: 0
      };

      try {
        const voiceId = segment.voice_id || this.defaultVoiceId;
        const voiceName = voiceNameMap.get(voiceId) || voiceId;
        segmentInfo.voiceId = voiceId;
        segmentInfo.voiceName = voiceName;

        const hasVoiceDirection = segment.voiceDirected === true;
        const hasUsableTags = hasBracketTags(segment.v3AudioTags);
        // Allow segments with either voice direction OR usable v3 tags (fallbacks have tags)
        if (!hasVoiceDirection && !hasUsableTags && segment.speaker !== 'narrator') {
          throw new Error(`[TTS] Missing voice direction for dialogue segment ${segIdx} (${segment.speaker})`);
        }

        const emotion = segment.emotion || 'neutral';
        const emotionPreset = VOICE_PRESETS[emotion] || VOICE_PRESETS.neutral;

        let segmentSettings;
        if (segment.speaker === 'narrator') {
          // ARCHETYPE BASELINE: Use narrator archetype settings as baseline before emotionPreset
          // Priority: 1) Voice direction 2) Archetype baseline 3) Emotion preset
          let archetypeBaseline = null;
          const archetypeId = segment.archetypeApplied || storyContext?.narratorArchetype;
          if (archetypeId && !hasVoiceDirection) {
            archetypeBaseline = getArchetype(archetypeId);
            if (archetypeBaseline) {
              logger.debug(`[TTS] Narrator segment ${segIdx}: Using archetype baseline "${archetypeBaseline.name}" for voice settings`);
            }
          }

          const stability = hasVoiceDirection && segment.voiceStability !== undefined
            ? segment.voiceStability
            : (archetypeBaseline?.voiceSettings?.stability ?? emotionPreset.stability);
          const style = hasVoiceDirection && segment.voiceStyle !== undefined
            ? segment.voiceStyle
            : (archetypeBaseline?.voiceSettings?.style ?? emotionPreset.style);

          segmentSettings = {
            ...voiceSettings,
            stability,
            style,
            sessionId,
            speaker: segment.speaker,
            detectedEmotion: segment.emotion || 'neutral',
            delivery: segment.delivery || '',
            v3AudioTags: segment.v3AudioTags || '',
            // P0: Include extracted emotional cues from speechTagFilterAgent
            extractedEmotionalCues: segment.extractedEmotionalCues,
            deliveryMode: segment.deliveryMode,
            emotionalIntensity: segment.emotionalIntensity,
            // Include archetype info for downstream use
            archetypeApplied: archetypeId || null
          };
        } else {
          const stability = hasVoiceDirection && segment.voiceStability !== undefined
            ? segment.voiceStability : emotionPreset.stability;
          const style = hasVoiceDirection && segment.voiceStyle !== undefined
            ? segment.voiceStyle : emotionPreset.style;

          // P0: Merge extracted emotional cues with existing v3AudioTags
          // If segment has extracted cues from speechTagFilterAgent, layer them with existing tags
          let effectiveV3Tags = segment.v3AudioTags || '';
          let effectiveDelivery = segment.delivery || '';

          if (segment.extractedEmotionalCues?.hasEmotionalContent) {
            const cues = segment.extractedEmotionalCues;
            // If we have a delivery mode from extracted cues and no existing delivery, use it
            if (cues.delivery && !effectiveDelivery) {
              effectiveDelivery = cues.delivery === 'whisper' ? '[whisper]' : (cues.delivery === 'shouting' ? '[shouting]' : '');  // V3 FIX: [whisper] not [whispers], [shouting] not [shouts]
            }
            // If we have an extracted v3Tags and no existing, use it
            if (segment.v3Tags && !effectiveV3Tags) {
              effectiveV3Tags = segment.v3Tags;
            }
            logger.debug(`[TTS] Segment ${segIdx}: Applied extracted emotional cues | delivery: ${cues.delivery} | emotions: ${cues.emotions?.join(',')} | v3Tags: ${effectiveV3Tags}`);
          }

          segmentSettings = {
            ...voiceSettings,
            stability,
            similarity_boost: emotionPreset.similarity_boost,
            style,
            sessionId,
            speaker: segment.speaker,
            detectedEmotion: emotion,
            delivery: effectiveDelivery,
            v3AudioTags: effectiveV3Tags,
            // P0: Include extracted emotional cues for role-based stability
            extractedEmotionalCues: segment.extractedEmotionalCues,
            deliveryMode: segment.deliveryMode || segment.extractedEmotionalCues?.delivery,
            emotionalIntensity: segment.emotionalIntensity || segment.extractedEmotionalCues?.intensity
          };
        }

        const effectiveModel = segmentSettings.model_id || voiceSettings.model_id || QUALITY_TIER_MODELS.premium;
        if (segment.speaker !== 'narrator' && modelSupportsAudioTags(effectiveModel) && !hasBracketTags(segmentSettings.v3AudioTags)) {
          throw new Error(`[TTS] Dialogue segment ${segIdx} missing v3 audio tags (fail-loud)`);
        }

        // ENHANCED LOGGING: Per-segment TTS settings for debugging voice quality issues
        const sourceTag = hasVoiceDirection ? 'VD' : (segment.llmValidated ? 'LLM' : 'preset');
        const v3TagsPreview = segmentSettings.v3AudioTags ? ` v3="${segmentSettings.v3AudioTags}"` : '';
        logger.info(`[TTS] Segment ${segIdx + 1}/${totalSegments}: ${segment.speaker} → "${voiceName}" | stab=${segmentSettings.stability?.toFixed(2)} style=${segmentSettings.style?.toFixed(2)} [${sourceTag}]${v3TagsPreview}`);
        logger.debug(`[TTS] Segment ${segIdx + 1} text: "${segment.text.substring(0, 80)}${segment.text.length > 80 ? '...' : ''}"`);

        // TTS call
        const result = await this.textToSpeechWithTimestamps(
          segment.text,
          voiceId,
          segmentSettings
        );

        segmentInfo.audio = result.audio;
        segmentInfo.success = true;
        segmentInfo.audioSize = result.audio?.length || 0;

        if (result.wordTimings?.words) {
          segmentInfo.wordTimings = result.wordTimings;
          segmentInfo.durationMs = result.wordTimings.total_duration_ms ||
            (result.durationSeconds ? result.durationSeconds * 1000 : 0) ||
            (result.wordTimings.words.length > 0
              ? result.wordTimings.words[result.wordTimings.words.length - 1].end_ms
              : 0);
          segmentInfo.wordCount = result.wordTimings.words.length;
        } else {
          segmentInfo.wordCount = 0;
        }

        // ENHANCED LOGGING: Per-segment success
        logger.info(`[TTS] Segment ${segIdx + 1} SUCCESS: ${segmentInfo.audioSize} bytes, ${segmentInfo.durationMs}ms, ${segmentInfo.wordCount} words`);

      } catch (error) {
        segmentInfo.success = false;
        segmentInfo.error = error.message;
        // ENHANCED LOGGING: Per-segment failure with details
        logger.error(`[TTS] Segment ${segIdx + 1}/${totalSegments} FAILED: ${segment.speaker} | error: ${error.message}`);
      }

      return segmentInfo;
    };

    // Process segments in parallel batches
    const totalSegments = emotionEnhancedSegments.length;
    const totalBatches = Math.ceil(totalSegments / TTS_BATCH_SIZE);
    let completedSegments = 0;

    logger.info(`[MultiVoice] ========== PARALLEL BATCH TTS (${TTS_BATCH_SIZE} concurrent) ==========`);
    logger.info(`[MultiVoice] Processing ${totalSegments} segments in ${totalBatches} batches`);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * TTS_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + TTS_BATCH_SIZE, totalSegments);
      const batchSegments = emotionEnhancedSegments.slice(batchStart, batchEnd);

      // Emit progress for batch
      if (onProgress) {
        try {
          onProgress({
            phase: 'tts_segment',
            message: `Synthesizing batch ${batchIdx + 1}/${totalBatches} (${completedSegments}/${totalSegments})...`,
            current: completedSegments,
            total: totalSegments
          });
        } catch (err) {
          logger.debug(`[MultiVoice] Progress callback failed: ${err.message}`);
        }
      }

      // Process batch in parallel
      const batchPromises = batchSegments.map((segment, localIdx) =>
        processSegment(segment, batchStart + localIdx)
      );

      const batchResults = await Promise.all(batchPromises);
      segmentResults.push(...batchResults);
      completedSegments += batchResults.length;

      const batchSuccess = batchResults.filter(r => r.success).length;
      logger.info(`[MultiVoice] Batch ${batchIdx + 1}/${totalBatches} complete: ${batchSuccess}/${batchResults.length} success (${completedSegments}/${totalSegments} total)`);

      // Small delay between batches only (not between each segment)
      if (batchIdx < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Sort results by original index (parallel processing may complete out of order)
    segmentResults.sort((a, b) => a.index - b.index);

    // Calculate cumulative timings AFTER all segments are processed (maintains correct order)
    const audioBuffers = [];
    const allWordTimings = [];
    let cumulativeTimeMs = 0;

    for (const result of segmentResults) {
      if (result.success && result.audio) {
        audioBuffers.push(result.audio);

        if (result.wordTimings?.words) {
          const adjustedWords = result.wordTimings.words.map(word => ({
            ...word,
            start_ms: word.start_ms + cumulativeTimeMs,
            end_ms: word.end_ms + cumulativeTimeMs,
            speaker: result.speaker,
            segment_index: result.index
          }));
          allWordTimings.push(...adjustedWords);
          cumulativeTimeMs += result.durationMs;
        }
      }
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

    if (audioBuffers.length === 1) {
      combinedBuffer = audioBuffers[0];
    } else {
      if (!hasFFmpeg) {
        throw new Error('[MultiVoice] FFmpeg unavailable for multi-segment assembly (fail-loud)');
      }

      // Build segment metadata for professional assembly with crossfade
      // NOTE: audioBuffers only contains successful segments, so use result.index to map back correctly
      const assemblySegments = [];
      let audioIdx = 0;
      for (const result of segmentResults) {
        if (result.success && result.audio) {
          const originalSegment = emotionEnhancedSegments[result.index];
          assemblySegments.push({
            audio: audioBuffers[audioIdx++],
            speaker: originalSegment?.speaker || 'narrator',
            type: originalSegment?.speaker === 'narrator' ? 'narrator' : 'character',
            duration: result.durationMs || 0,
            voiceSpeedModifier: originalSegment?.voiceSpeedModifier  // Pass through for audio assembly
          });
        }
      }

      logger.info(`[MultiVoice] Using FFmpeg crossfade assembly for ${assemblySegments.length} segments`);

      const assemblyResult = await assembleMultiVoiceAudio(assemblySegments, {
        ...ASSEMBLY_PRESETS.natural,
        outputFormat: 'mp3'
      });
      combinedBuffer = assemblyResult.audio;

      // FIXED: Scale word timings to match actual FFmpeg duration
      // FFmpeg adds gaps/crossfades that change the total duration
      const actualDuration = assemblyResult.duration;
      if (actualDuration && actualDuration > 0 && cumulativeTimeMs > 0) {
        const scaleFactor = actualDuration / cumulativeTimeMs;
        // Only scale if difference is significant (>1% drift)
        if (Math.abs(scaleFactor - 1.0) > 0.01) {
          logger.info(`[MultiVoice] Scaling word timings: raw=${cumulativeTimeMs}ms actual=${Math.round(actualDuration)}ms factor=${scaleFactor.toFixed(3)}`);
          allWordTimings.forEach(word => {
            word.start_ms = Math.round(word.start_ms * scaleFactor);
            word.end_ms = Math.round(word.end_ms * scaleFactor);
          });
          cumulativeTimeMs = actualDuration; // Update to actual duration
        }
      }

      logger.info(`[MultiVoice] FFmpeg assembly complete: ${combinedBuffer.length} bytes, ${Math.round(cumulativeTimeMs)}ms`);
    }

    // Build combined word timings object
    const combinedWordTimings = {
      words: allWordTimings,
      total_duration_ms: cumulativeTimeMs,
      segment_count: audioBuffers.length
    };

    logger.info(`[MultiVoice] OUTPUT | bytes: ${combinedBuffer.length} | segments: ${audioBuffers.length} | words: ${allWordTimings.length} | duration: ${Math.round(cumulativeTimeMs)}ms`);
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

    // Voice diversity guard: require a minimum spread of voices across characters
    const dialogueSpeakers = [...new Set(segments.filter(s => s.speaker !== 'narrator').map(s => s.speaker.toLowerCase().trim()))];
    const usedDialogueVoices = new Set(dialogueSpeakers.map(name => characterVoices[name]).filter(Boolean));
    const minVoicesRequired = Math.max(1, Math.ceil(dialogueSpeakers.length / 3));
    if (dialogueSpeakers.length > 0 && usedDialogueVoices.size < minVoicesRequired) {
      const err = `[MultiVoice] Voice diversity check failed: ${usedDialogueVoices.size}/${dialogueSpeakers.length} unique voices (min required: ${minVoicesRequired})`;
      logAlert('error', err, { usedVoices: [...usedDialogueVoices] });
      throw new Error(err);
    }

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
   * @param {string} options.delivery - Natural language delivery notes
   * @param {string} options.v3AudioTags - Pre-converted V3-compliant audio tags (e.g., '[excited][pause:0.5s]')
   * @param {number} options.stability - Voice stability 0.0-1.0
   * @param {number} options.style - Voice style 0.0-1.0
   * @returns {object} { audio, audioUrl, audioHash, checksum, wordTimings, durationSeconds }
   */
  async textToSpeechWithTimestamps(text, voiceId = null, options = {}) {
    const voice = voiceId || this.defaultVoiceId;
    const { sessionId, detectedEmotion, delivery, v3AudioTags, extractedEmotionalCues } = options;
    const modelId = options.model_id || QUALITY_TIER_MODELS.premium; // eleven_v3 default
    const hasDelivery = typeof delivery === 'string' ? delivery.trim().length > 0 : !!delivery;
    const hasV3Tags = hasBracketTags(v3AudioTags);
    const supportsAudioTags = modelSupportsAudioTags(modelId);
    const hasExtractedCues = extractedEmotionalCues?.hasEmotionalContent === true;

    // CRITICAL: Check text length BEFORE making API call
    // ElevenLabs with-timestamps endpoint has 5000 char limit
    // Use chunking for long text to preserve word timings for karaoke
    if (text.length > ElevenLabsService.MAX_CHUNK_LENGTH) {
      logger.info(`[ElevenLabs] Text length ${text.length} exceeds ${ElevenLabsService.MAX_CHUNK_LENGTH}, using chunked TTS with timestamps`);
      return this.textToSpeechWithChunking(text, voice, options);
    }

    // Validate presence of audio tags for dialogue-heavy content when using v3
    // P0: Allow extracted emotional cues as valid alternative to explicit tags
    const isDialogueHeavy = (text.match(/"[^"]+"/g) || []).length >= 5;
    if (supportsAudioTags && isDialogueHeavy && !hasV3Tags && !hasDelivery && !hasExtractedCues && (!detectedEmotion || detectedEmotion === 'neutral')) {
      const err = '[ElevenLabs] Dialogue-heavy text missing v3 audio tags/delivery directives (fail-loud)';
      logAlert('error', err, { sessionId });
      throw new Error(err);
    }

    // Apply or strip Audio Tags based on model support
    let processedText = text;

    if (supportsAudioTags && (hasV3Tags || hasDelivery || hasExtractedCues || (detectedEmotion && detectedEmotion !== 'neutral'))) {
      // Model supports audio tags - wrap with V3 emotion tags
      // P0: Pass extracted emotional cues for layered tag support
      processedText = wrapWithAudioTags(text, detectedEmotion || 'neutral', delivery, v3AudioTags, extractedEmotionalCues);
      const cueInfo = hasExtractedCues ? ` (extractedCues: ${extractedEmotionalCues.delivery || 'none'}, ${extractedEmotionalCues.emotions?.join(',') || 'none'})` : '';
      logger.info(`[ElevenLabs] Applied Audio Tags (v3): "${processedText.substring(0, 80)}..."${hasV3Tags ? ' (V3 converted)' : ''}${cueInfo}`);
    } else if (!supportsAudioTags) {
      // Strip tags for models that can't handle them
      const originalLength = processedText.length;
      processedText = stripTags(processedText);
      if (processedText.length !== originalLength) {
        logger.info(`[ElevenLabs] Stripped audio tags for non-v3 model: removed ${originalLength - processedText.length} chars`);
      }
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
      const modelConfig = getModelConfig(modelId);

      // =============================================================================
      // P0 CRITICAL: Role-Based Stability Assignment for TTD Endpoint
      // =============================================================================
      // TTD endpoint ONLY accepts stability values: 0.0, 0.5, or 1.0
      // - 0.0: Creative - Maximum expressiveness (for emotional dialogue)
      // - 0.5: Natural - Balanced delivery (default for regular dialogue)
      // - 1.0: Robust - Maximum consistency (for narrator)
      // =============================================================================

      // Build segment-like object from options for stability determination
      const segmentForStability = {
        speaker: options.speaker,
        emotion: options.detectedEmotion || options.emotion,
        extractedEmotionalCues: options.extractedEmotionalCues,
        deliveryMode: options.deliveryMode,
        v3AudioTags: options.v3AudioTags || options.delivery
      };

      // Build voice direction object from options
      const voiceDirectionForStability = {
        intensity: options.emotionalIntensity || options.intensity,
        primaryEmotion: options.detectedEmotion || options.emotion,
        delivery: options.deliveryMode,
        v3AudioTags: options.v3AudioTags
      };

      // Get role-based stability and quantize to valid TTD values (0.0, 0.5, or 1.0)
      // TTD endpoint REJECTS any other stability values with HTTP 400
      const rawStability = getStabilityForRole(
        segmentForStability,
        voiceDirectionForStability,
        { isNarrator: options.isNarrator }
      );
      const ttdStability = quantizeTTDStability(rawStability);

      // Log the stability decision with context
      const stabilityReason = ttdStability === 1.0 ? 'Robust (narrator/consistent)'
        : ttdStability === 0.0 ? 'Creative (emotional/expressive)'
        : 'Natural (balanced)';
      logger.info(`[ElevenLabs TTD] ROLE_STABILITY | raw=${rawStability} → quantized=${ttdStability} (${stabilityReason}) | speaker=${options.speaker || 'unknown'} | emotion=${options.detectedEmotion || options.emotion || 'none'} | delivery=${options.deliveryMode || 'none'}`);

      // P2.3: Build voice settings with conditional speaker_boost support
      // FINAL SAFEGUARD: Ensure stability is exactly one of the valid TTD values
      const VALID_TTD_STABILITIES = [0.0, 0.5, 1.0];
      const finalStability = VALID_TTD_STABILITIES.includes(ttdStability) ? ttdStability : 0.5;
      if (finalStability !== ttdStability) {
        logger.error(`[ElevenLabs TTD] CRITICAL: Invalid stability ${ttdStability} bypassed quantization! Forcing to ${finalStability}`);
      }

      const voiceSettings = {
        stability: finalStability, // GUARANTEED to be 0.0, 0.5, or 1.0 for TTD endpoint
        similarity_boost: options.similarity_boost ?? preset?.similarity_boost ?? 0.75,
        style: options.style ?? preset?.style ?? 0.3
      };

      // P2.3: Only add speaker_boost if model supports it (V3 does NOT)
      if (modelConfig.supports_speaker_boost) {
        voiceSettings.use_speaker_boost = options.use_speaker_boost !== false;
      }

      const response = await axios.post(
        `${ELEVENLABS_API_URL}/text-to-speech/${voice}/with-timestamps`,
        {
          text: processedText,  // Use processed text with Audio Tags
          model_id: modelId,
          voice_settings: voiceSettings,
          output_format: 'mp3_44100_128' // CD quality
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          timeout: 180000  // 3 minutes - v3 model needs extra time for timestamps
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

      this._validateWordTimings(wordTimings, text);

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

      // Premium fail-loud: do not fall back to TTS without timestamps
      throw error;
    }
  }

  /**
   * Process character-level alignment from ElevenLabs into word-level timings
   * @param {object} alignment - ElevenLabs alignment data
   * @param {string} originalText - Original text for reference
   * @returns {object} Word-level timing data
   */
  _validateWordTimings(wordTimings, contextText = '') {
    if (!wordTimings?.words || wordTimings.words.length === 0 || !wordTimings.total_duration_ms) {
      throw new Error('ElevenLabs returned no word timings (fail-loud)');
    }
    if (wordTimings.total_duration_ms <= 0 || wordTimings.total_duration_ms > 30 * 60 * 1000) {
      throw new Error(`ElevenLabs word timings duration invalid (${wordTimings.total_duration_ms} ms)`);
    }

    const first = wordTimings.words[0];
    const last = wordTimings.words[wordTimings.words.length - 1];
    // ElevenLabs v3 with audio tags may add lead-in time (up to 500ms is normal)
    // Only fail for extreme delays (>1000ms) that indicate a problem
    if (first.start_ms > 1000) {
      throw new Error(`[ElevenLabs] Word timings start too late (${first.start_ms}ms > 1000ms threshold)`);
    } else if (first.start_ms > 400) {
      logger.warn(`[ElevenLabs] Word timings start at ${first.start_ms}ms (moderate lead-in, may affect karaoke sync)`);
    }
    // Allow more drift for assembled audio (500ms instead of 250ms)
    if (Math.abs(wordTimings.total_duration_ms - last.end_ms) > 500) {
      throw new Error(`[ElevenLabs] Word timing duration drift: total=${wordTimings.total_duration_ms}ms, lastEnd=${last.end_ms}ms`);
    }

    for (let i = 1; i < wordTimings.words.length; i++) {
      if (wordTimings.words[i].start_ms < wordTimings.words[i - 1].end_ms) {
        throw new Error(`ElevenLabs word timings non-monotonic at index ${i} (fail-loud)`);
      }
    }
    logger.info(`[ElevenLabs] Word timings validated | words=${wordTimings.words.length} | durationMs=${wordTimings.total_duration_ms} | preview="${contextText.substring(0, 40)}..."`);
  }

  processCharacterAlignment(alignment, originalText) {
    if (!alignment?.characters || !alignment?.character_start_times_seconds) {
      logger.warn('No alignment data available for word timing');
      return null;
    }

    const chars = alignment.characters;
    const charStartTimes = alignment.character_start_times_seconds.map(t => Math.round(t * 1000));
    const charEndTimes = alignment.character_end_times_seconds.map(t => Math.round(t * 1000));

    // Pattern to strip any bracketed tags from text (covers all audio tag formats)
    // Matches [word], [multiple words], [with-hyphens], [with'apostrophes], etc.
    const allBracketedTagsPattern = /\[[^\]]+\]/g;

    const words = [];
    let currentWord = '';
    let wordStartTime = 0;
    let wordStartCharIndex = 0;
    let insideBracket = false; // Track if we're inside a [tag]
    let bracketDepth = 0;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const charStart = charStartTimes[i];
      const charEnd = charEndTimes[i];

      // Track bracket state to skip entire audio tags including multi-word ones
      if (char === '[') {
        bracketDepth++;
        insideBracket = true;
        // If we have accumulated a word before the bracket, save it
        if (currentWord.trim()) {
          const trimmedWord = currentWord.trim();
          const cleanWord = trimmedWord.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '') || trimmedWord;
          if (cleanWord) {
            words.push({
              text: trimmedWord,
              clean_text: cleanWord,
              start_ms: wordStartTime,
              end_ms: charStartTimes[i] || charEnd,
              duration_ms: (charStartTimes[i] || charEnd) - wordStartTime,
              char_start_index: wordStartCharIndex,
              char_end_index: i - 1
            });
          }
        }
        currentWord = '';
        continue;
      }

      if (char === ']') {
        bracketDepth--;
        if (bracketDepth <= 0) {
          insideBracket = false;
          bracketDepth = 0;
        }
        continue;
      }

      // Skip all characters inside brackets (audio tags)
      if (insideBracket) {
        continue;
      }

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

        // Final cleanup: remove any remaining bracketed content (safety net)
        trimmedWord = trimmedWord.replace(allBracketedTagsPattern, '').trim();

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

  // ============================================================================
  // PHASE 5.1: Content Refusal Detection and Phonetic Fallback
  // ============================================================================

  /**
   * Check if an error is a content policy refusal from ElevenLabs
   * @param {Error} error - The error from ElevenLabs API
   * @returns {boolean} True if this is a content refusal
   */
  _isContentRefusal(error) {
    if (error.response?.status !== 422) return false;

    const message = (
      error.response?.data?.detail?.message ||
      error.response?.data?.message ||
      error.message ||
      ''
    ).toLowerCase();

    // Check for content policy indicators
    const policyKeywords = [
      'policy', 'profan', 'explicit', 'violat', 'inappropriate',
      'offensive', 'harmful', 'forbidden', 'not allowed', 'blocked',
      'content', 'moderation'
    ];

    return policyKeywords.some(keyword => message.includes(keyword));
  }

  /**
   * Generate TTS with automatic phonetic fallback for content refusals
   * @param {string} text - Text to synthesize
   * @param {string} voiceId - Voice ID
   * @param {object} options - TTS options
   * @returns {object} Audio result with potential phonetic info
   */
  async textToSpeechWithPhoneticFallback(text, voiceId = null, options = {}) {
    // Premium fail-loud: no phonetic fallback. If the primary call fails, bubble the error.
    const result = await this.textToSpeechWithTimestamps(text, voiceId, options);
    return {
      ...result,
      usedPhonetic: false,
      originalText: text
    };
  }

  // ============================================================================
  // PHASE 5.2: Text Chunking for Long Content (>5000 chars)
  // ============================================================================

  /**
   * Maximum characters per chunk for ElevenLabs
   * Using 4800 to leave buffer for any text processing/wrapping
   */
  static MAX_CHUNK_LENGTH = 4800;

  /**
   * Split text at sentence boundaries for chunking
   * @param {string} text - Text to chunk
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array} Array of {text, index} chunks
   */
  chunkAtSentenceBoundaries(text, maxLength = ElevenLabsService.MAX_CHUNK_LENGTH) {
    if (text.length <= maxLength) {
      return [{ text, index: 0 }];
    }

    const chunks = [];
    let remaining = text;
    let chunkIndex = 0;

    // Sentence-ending patterns (in order of preference)
    const sentenceEnders = [
      /([.!?])\s+/g,     // Standard sentence endings
      /([,;:])\s+/g,     // Clause boundaries
      /\s+/g             // Any whitespace as last resort
    ];

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push({ text: remaining.trim(), index: chunkIndex });
        break;
      }

      let splitPoint = -1;

      // Try each pattern to find a good split point
      for (const pattern of sentenceEnders) {
        pattern.lastIndex = 0; // Reset regex state
        let lastMatch = null;

        // Find the last match before maxLength
        let match;
        while ((match = pattern.exec(remaining)) !== null) {
          if (match.index + match[0].length <= maxLength) {
            lastMatch = match;
          } else {
            break;
          }
        }

        if (lastMatch) {
          splitPoint = lastMatch.index + lastMatch[0].length;
          break;
        }
      }

      // Fallback: hard split at maxLength
      if (splitPoint === -1 || splitPoint === 0) {
        splitPoint = maxLength;
      }

      const chunk = remaining.substring(0, splitPoint).trim();
      if (chunk) {
        chunks.push({ text: chunk, index: chunkIndex++ });
      }
      remaining = remaining.substring(splitPoint).trim();
    }

    logger.info(`[Chunking] Split ${text.length} chars into ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * Generate TTS for long text with automatic chunking
   * Chunks are generated and assembled with seamless audio transitions
   * @param {string} text - Text to synthesize (any length)
   * @param {string} voiceId - Voice ID
   * @param {object} options - TTS options
   * @returns {object} Combined audio result
   */
  async textToSpeechWithChunking(text, voiceId = null, options = {}) {
    const voice = voiceId || this.defaultVoiceId;

    // Check if chunking is needed
    if (text.length <= ElevenLabsService.MAX_CHUNK_LENGTH) {
      // Use phonetic fallback wrapper for single chunk
      return this.textToSpeechWithPhoneticFallback(text, voice, options);
    }

    logger.info(`[Chunking] Text length ${text.length} exceeds ${ElevenLabsService.MAX_CHUNK_LENGTH}, chunking...`);

    const chunks = this.chunkAtSentenceBoundaries(text);
    const chunkResults = [];
    let cumulativeMs = 0;
    const allWordTimings = [];

    // Generate audio for each chunk
    for (const chunk of chunks) {
      logger.info(`[Chunking] Processing chunk ${chunk.index + 1}/${chunks.length}: ${chunk.text.length} chars`);

      try {
        const result = await this.textToSpeechWithPhoneticFallback(chunk.text, voice, options);
        chunkResults.push(result);

        // Merge word timings with cumulative offset
        if (result.wordTimings?.words) {
          const offsetWords = result.wordTimings.words.map(w => ({
            ...w,
            start_ms: w.start_ms + cumulativeMs,
            end_ms: w.end_ms + cumulativeMs,
            chunk_index: chunk.index
          }));
          allWordTimings.push(...offsetWords);
          cumulativeMs += result.wordTimings.total_duration_ms || 0;
        }
      } catch (error) {
        logger.error(`[Chunking] Chunk ${chunk.index + 1} failed: ${error.message}`);
        throw new Error(`Failed to generate chunk ${chunk.index + 1}: ${error.message}`);
      }
    }

    // Assemble all chunks with crossfade
    logger.info(`[Chunking] Assembling ${chunkResults.length} audio chunks...`);

    const assemblySegments = chunkResults.map((r, i) => ({
      audio: r.audio,
      index: i
    }));

    try {
      const assembled = await assembleMultiVoiceAudio(assemblySegments, {
        gapMs: 100,      // Small gap between chunks
        crossfadeMs: 50  // Subtle crossfade
      });

      const hash = this.generateHash(text, voice);
      const checksum = crypto.createHash('sha256').update(assembled.audio).digest('hex');

      // Cache the combined result
      const cacheResult = await this.cacheAudioWithTimestamps(
        text, voice, assembled.audio,
        { words: allWordTimings, total_duration_ms: cumulativeMs },
        checksum
      );

      logger.info(`[Chunking] Assembled ${assembled.audio.length} bytes from ${chunks.length} chunks`);

      return {
        audio: assembled.audio,
        audioUrl: cacheResult.audioUrl,
        audioHash: hash,
        checksum,
        wordTimings: {
          words: allWordTimings,
          total_duration_ms: cumulativeMs,
          word_count: allWordTimings.length,
          chunk_count: chunks.length
        },
        durationSeconds: cumulativeMs / 1000,
        chunked: true,
        chunkCount: chunks.length,
        usedPhonetic: chunkResults.some(r => r.usedPhonetic)
      };
    } catch (error) {
      logger.error(`[Chunking] Assembly failed: ${error.message}`);
      throw new Error(`Failed to assemble chunked audio: ${error.message}`);
    }
  }
}

export default ElevenLabsService;
