/**
 * LLM Emotion Analyzer
 *
 * Replaces hardcoded keyword/regex detection with LLM-based emotion analysis.
 * This provides context-aware emotion detection that understands:
 * - Subtext and nuance
 * - Character psychology
 * - Genre conventions (dark comedy vs horror vs romance)
 * - Scene pacing needs
 *
 * Part of the ElevenLabs V3 Audio Quality Initiative (2025-01-27)
 */

import { callLLM } from '../llmProviders.js';
import { logger } from '../../utils/logger.js';
import { parseJsonResponse } from '../../utils/jsonUtils.js';
import { V3_OFFICIAL_TAGS } from '../elevenlabs.js';

// Cache for emotion analysis to avoid redundant LLM calls
const emotionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Analyze emotional content of a segment using LLM
 *
 * @param {Object} segment - The segment to analyze
 * @param {string} segment.text - The text content
 * @param {string} segment.speaker - Speaker name or 'narrator'
 * @param {string} segment.type - 'narrator' or 'dialogue'
 * @param {Object} context - Story context for better analysis
 * @param {string} context.genre - Story genre (e.g., 'dark_comedy', 'horror', 'romance')
 * @param {string} context.mood - Current scene mood
 * @param {string} context.sceneDescription - Brief scene context
 * @param {string} context.narratorStyle - Narrator style preference
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Emotion analysis result
 */
export async function analyzeSegmentEmotion(segment, context = {}, options = {}) {
  const { text, speaker = 'narrator', type = 'dialogue' } = segment;
  const {
    genre = 'general',
    mood = 'neutral',
    sceneDescription = '',
    narratorStyle = 'auto'
  } = context;
  const { skipCache = false } = options;

  if (!text || text.trim().length === 0) {
    return getDefaultAnalysis();
  }

  // Check cache first
  const cacheKey = `${text.substring(0, 100)}|${speaker}|${genre}|${mood}`;
  if (!skipCache) {
    const cached = emotionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.debug(`[LLMEmotionAnalyzer] Cache hit for: "${text.substring(0, 40)}..."`);
      return cached.result;
    }
  }

  const isNarrator = speaker === 'narrator' || type === 'narrator';

  try {
    const prompt = buildAnalysisPrompt(text, {
      speaker,
      isNarrator,
      genre,
      mood,
      sceneDescription,
      narratorStyle
    });

    const response = await callLLM({
      messages: [
        {
          role: 'system',
          content: getSystemPrompt()
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'gpt-4o-mini', // Fast utility model for emotion analysis
      temperature: 0.3, // Low temperature for consistent analysis
      max_tokens: 300,
      response_format: { type: 'json_object' },
      agent_name: 'llm_emotion_analyzer',
      agent_category: 'utility'
    });

    const content = response?.content || response?.choices?.[0]?.message?.content;
    const analysis = parseJsonResponse(content);

    if (!analysis) {
      logger.warn(`[LLMEmotionAnalyzer] Failed to parse response for: "${text.substring(0, 40)}..."`);
      return getDefaultAnalysis();
    }

    // Validate and normalize the result
    const result = normalizeAnalysis(analysis);

    // Cache the result
    emotionCache.set(cacheKey, { result, timestamp: Date.now() });

    logger.debug(`[LLMEmotionAnalyzer] Analyzed: "${text.substring(0, 40)}..." => ${result.v3_emotion} (${result.intensity}%)`);

    return result;

  } catch (error) {
    logger.error(`[LLMEmotionAnalyzer] Error analyzing segment:`, error.message);
    return getDefaultAnalysis();
  }
}

/**
 * Build the analysis prompt
 */
function buildAnalysisPrompt(text, context) {
  const {
    speaker,
    isNarrator,
    genre,
    mood,
    sceneDescription,
    narratorStyle
  } = context;

  return `Analyze the emotional content of this ${isNarrator ? 'narration' : 'dialogue'} segment.

TEXT: "${text}"

CONTEXT:
- Speaker: ${isNarrator ? `Narrator (style: ${narratorStyle})` : speaker}
- Genre: ${genre}
- Scene mood: ${mood}
${sceneDescription ? `- Scene: ${sceneDescription}` : ''}

GENRE-SPECIFIC GUIDANCE:
${getGenreGuidance(genre)}

Return JSON with:
- v3_emotion: One of: excited, sad, angry, calm, fearful, surprised, whisper, shouting
- v3_combination: Optional second tag for nuanced delivery (e.g., "[whisper][fearful]")
- intensity: 0-100 scale
- delivery_notes: Brief direction for voice actor
- speed_modifier: 0.8-1.2 (slower or faster delivery)`;
}

/**
 * Get system prompt for the emotion analyzer
 */
function getSystemPrompt() {
  return `You are an expert voice director for audiobook narration.

Your job is to analyze text segments and determine optimal voice delivery using ElevenLabs V3 audio tags.

AVAILABLE V3 TAGS (only these 8 are valid):
- excited: Joy, enthusiasm, triumph
- sad: Grief, melancholy, resignation
- angry: Rage, frustration, defiance
- calm: Peace, warmth, tenderness, dry wit
- fearful: Terror, anxiety, nervousness
- surprised: Shock, confusion, wonder
- whisper: Secrets, intimacy, menace
- shouting: Commands, panic, emphasis

COMBINATION EXAMPLES:
- Menacing threat: [whisper][angry]
- Desperate plea: [sad][fearful]
- Dark humor: [calm] (understated delivery)
- Terror: [fearful][shouting]
- Intimate moment: [calm][whisper]

OUTPUT ONLY VALID JSON. No explanations.`;
}

/**
 * Get genre-specific guidance
 */
function getGenreGuidance(genre) {
  const guidance = {
    dark_comedy: `For dark comedy: Use [calm] for dry wit and deadpan delivery. Understatement is key.
The more absurd the content, the more measured the delivery should be.`,

    horror: `For horror: Build tension with [fearful] and [whisper].
Use [shouting] sparingly for maximum impact. Dread > jump scares.`,

    romance: `For romance: [calm] for tender moments, [excited] for joy.
Intimacy uses [calm][whisper]. Passion uses [excited].`,

    thriller: `For thriller: [fearful] for tension, [angry] for confrontation.
Pacing matters - use speed_modifier to control urgency.`,

    comedy: `For comedy: [excited] for enthusiasm, [surprised] for reactions.
Timing is everything - slight pauses enhance jokes.`,

    drama: `For drama: Full emotional range. Match intensity to the moment.
Don't oversell - let the text carry the weight.`,

    fantasy: `For fantasy: [excited] for wonder, [fearful] for danger.
Narrator should sound engaged but not campy.`,

    scifi: `For sci-fi: [calm] for technical exposition, [surprised] for discoveries.
Balance wonder with groundedness.`
  };

  return guidance[genre?.toLowerCase()] ||
    `General guidance: Match emotion to content naturally. Don't overact.`;
}

/**
 * Normalize and validate analysis result
 */
function normalizeAnalysis(analysis) {
  // Extract primary emotion
  let v3Emotion = (analysis.v3_emotion || analysis.emotion || 'calm').toLowerCase();

  // Validate it's a V3 tag
  if (!V3_OFFICIAL_TAGS.includes(v3Emotion)) {
    // Try to map to closest V3 tag
    v3Emotion = mapToV3Tag(v3Emotion);
  }

  // Build v3 tags string
  let v3AudioTags = `[${v3Emotion}]`;

  // Handle combination tags
  if (analysis.v3_combination) {
    // Validate combination contains only V3 tags
    const combinationTags = analysis.v3_combination.match(/\[([^\]]+)\]/g) || [];
    const validCombination = combinationTags
      .map(t => t.replace(/[\[\]]/g, '').toLowerCase())
      .filter(t => V3_OFFICIAL_TAGS.includes(t))
      .map(t => `[${t}]`)
      .join('');

    if (validCombination) {
      v3AudioTags = validCombination;
    }
  }

  // Normalize intensity
  let intensity = parseInt(analysis.intensity, 10);
  if (isNaN(intensity) || intensity < 0 || intensity > 100) {
    intensity = 50;
  }

  // Normalize speed modifier
  let speedModifier = parseFloat(analysis.speed_modifier);
  if (isNaN(speedModifier) || speedModifier < 0.5 || speedModifier > 2.0) {
    speedModifier = 1.0;
  }
  // Clamp to reasonable range
  speedModifier = Math.max(0.8, Math.min(1.2, speedModifier));

  return {
    v3_emotion: v3Emotion,
    v3AudioTags,
    intensity,
    delivery_notes: analysis.delivery_notes || '',
    speed_modifier: speedModifier
  };
}

/**
 * Map non-V3 emotion to closest V3 tag
 */
function mapToV3Tag(emotion) {
  const mappings = {
    // Joy spectrum
    happy: 'excited', joyful: 'excited', triumphant: 'excited',
    elated: 'excited', ecstatic: 'excited',

    // Sadness spectrum
    melancholy: 'sad', grieving: 'sad', mournful: 'sad',
    depressed: 'sad', devastated: 'sad',

    // Anger spectrum
    furious: 'angry', enraged: 'angry', irritated: 'angry',
    frustrated: 'angry',

    // Fear spectrum
    terrified: 'fearful', anxious: 'fearful', nervous: 'fearful',
    panicked: 'fearful', scared: 'fearful',

    // Calm spectrum
    peaceful: 'calm', tender: 'calm', gentle: 'calm',
    warm: 'calm', soothing: 'calm', neutral: 'calm',

    // Surprise spectrum
    shocked: 'surprised', confused: 'surprised', amazed: 'surprised',

    // Delivery modes
    whispered: 'whisper', hushed: 'whisper', murmured: 'whisper',
    shouted: 'shouting', yelled: 'shouting', screamed: 'shouting'
  };

  return mappings[emotion.toLowerCase()] || 'calm';
}

/**
 * Get default analysis for fallback
 */
function getDefaultAnalysis() {
  return {
    v3_emotion: 'calm',
    v3AudioTags: '[calm]',
    intensity: 50,
    delivery_notes: '',
    speed_modifier: 1.0
  };
}

/**
 * Batch analyze multiple segments (more efficient for large passages)
 *
 * @param {Array<Object>} segments - Array of segments to analyze
 * @param {Object} context - Shared story context
 * @returns {Promise<Array<Object>>} Array of analysis results
 */
export async function batchAnalyzeSegments(segments, context = {}) {
  if (!segments || segments.length === 0) {
    return [];
  }

  // For small batches, analyze individually (allows caching)
  if (segments.length <= 3) {
    return Promise.all(segments.map(s => analyzeSegmentEmotion(s, context)));
  }

  // For larger batches, use a single LLM call
  try {
    const segmentList = segments.map((s, i) =>
      `[${i + 1}] ${s.speaker || 'narrator'}: "${s.text}"`
    ).join('\n');

    const response = await callLLM({
      messages: [
        {
          role: 'system',
          content: getSystemPrompt() + `

You will receive multiple segments. Analyze each and return a JSON array.
Each element should have: v3_emotion, v3_combination (optional), intensity, delivery_notes, speed_modifier`
        },
        {
          role: 'user',
          content: `Analyze these ${segments.length} segments:

${segmentList}

CONTEXT:
- Genre: ${context.genre || 'general'}
- Mood: ${context.mood || 'neutral'}
${context.sceneDescription ? `- Scene: ${context.sceneDescription}` : ''}

Return JSON array with ${segments.length} analysis objects.`
        }
      ],
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 150 * segments.length,
      response_format: { type: 'json_object' },
      agent_name: 'llm_emotion_analyzer_batch',
      agent_category: 'utility'
    });

    const content = response?.content || response?.choices?.[0]?.message?.content;
    const parsed = parseJsonResponse(content);

    // Handle both array and object-with-array responses
    const analyses = Array.isArray(parsed) ? parsed : (parsed?.analyses || parsed?.segments || []);

    // Normalize each result
    return analyses.map((a, i) => {
      const result = normalizeAnalysis(a || {});
      // Cache individual results
      if (segments[i]?.text) {
        const cacheKey = `${segments[i].text.substring(0, 100)}|${segments[i].speaker || 'narrator'}|${context.genre || 'general'}|${context.mood || 'neutral'}`;
        emotionCache.set(cacheKey, { result, timestamp: Date.now() });
      }
      return result;
    });

  } catch (error) {
    logger.error(`[LLMEmotionAnalyzer] Batch analysis error:`, error.message);
    // Fall back to individual analysis
    return Promise.all(segments.map(s => analyzeSegmentEmotion(s, context)));
  }
}

/**
 * Clear the emotion cache
 */
export function clearEmotionCache() {
  emotionCache.clear();
  logger.info('[LLMEmotionAnalyzer] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: emotionCache.size,
    ttlMs: CACHE_TTL_MS
  };
}

export default {
  analyzeSegmentEmotion,
  batchAnalyzeSegments,
  clearEmotionCache,
  getCacheStats
};
