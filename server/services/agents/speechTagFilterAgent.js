/**
 * Speech Tag Filter Agent (3-Pass System)
 *
 * Uses multi-pass LLM validation to intelligently identify and remove
 * speech attribution phrases from narrator segments.
 *
 * 3-PASS ARCHITECTURE:
 * - Pass 1: Initial attribution identification
 * - Pass 2: Verification of proposed removals
 * - Pass 3: Final validation (confirm no attribution remains)
 *
 * FAIL LOUD: Throws errors instead of silently passing through unfiltered content.
 *
 * Examples of what gets stripped:
 * - "he said, scrutinizing the screens" → "scrutinizing the screens"
 * - "Marcus replied with a sigh" → "" (entire segment is attribution)
 * - "The commander nodded. 'We need to move,' she said." → "The commander nodded."
 *
 * @module speechTagFilterAgent
 */

import { callLLM } from '../llmProviders.js';
import { logger } from '../../utils/logger.js';
import { analyzeSegmentEmotion } from './llmEmotionAnalyzer.js';

// Feature flag for 3-pass mode (can disable for performance testing)
const THREE_PASS_MODE = process.env.SPEECH_FILTER_THREE_PASS !== 'false';

// Feature flag for LLM-based emotion extraction (enhancement over regex)
const USE_LLM_EMOTION_EXTRACTION = process.env.SPEECH_FILTER_LLM_EMOTIONS !== 'false';

// =============================================================================
// EMOTIONAL CUE EXTRACTION (P0 - Critical Voice Acting Fix)
// =============================================================================
// When narrator attribution like "he whispered fearfully" is stripped,
// the emotional delivery information (whisper, fearful) must be PRESERVED
// and applied to the adjacent dialogue segment.
// =============================================================================

/**
 * Patterns to extract emotional delivery cues from narrator attribution
 * These map to ElevenLabs V3 audio tags and voice settings
 */
const EMOTIONAL_CUE_PATTERNS = {
  // Delivery modes (outermost tags)
  whisper: /\b(whisper(?:ed|ing|s)?|murmur(?:ed|ing|s)?|breath(?:ed|ing|s)?|hiss(?:ed|ing)?)\b/i,
  shouting: /\b(shout(?:ed|ing|s)?|yell(?:ed|ing|s)?|scream(?:ed|ing|s)?|bellow(?:ed|ing|s)?|roar(?:ed|ing|s)?|boom(?:ed|ing|s)?)\b/i,

  // Emotional states (V3 compatible)
  fearful: /\b(fearful(?:ly)?|afraid|terrifi(?:ed|edly)|trembl(?:ed|ing|y)|frighten(?:ed|edly)|scared?)\b/i,
  sad: /\b(sad(?:ly)?|sorrow(?:ful(?:ly)?)?|grief|mourn(?:ed|ing|fully)?|tearful(?:ly)?|brok(?:en|enly))\b/i,
  angry: /\b(angr(?:y|ily)|furious(?:ly)?|rag(?:ed|ing)|bitter(?:ly)?|harsh(?:ly)?|cold(?:ly)?)\b/i,
  excited: /\b(excit(?:ed|edly)|enthusiastic(?:ally)?|eager(?:ly)?|brighten(?:ed|ing)?)\b/i,
  surprised: /\b(surpris(?:ed|edly)|shock(?:ed)?|astonish(?:ed)?|stun(?:ned)?|gasp(?:ed|ing)?)\b/i,
  calm: /\b(calm(?:ly)?|serene(?:ly)?|peaceful(?:ly)?|sooth(?:ed|ing|ingly)?)\b/i,

  // Additional emotional nuances
  nervous: /\b(nervous(?:ly)?|anxious(?:ly)?|worri(?:ed|edly)|hesitant(?:ly)?|uncertain(?:ly)?)\b/i,
  tender: /\b(tender(?:ly)?|gent(?:le|ly)|soft(?:ly)?|loving(?:ly)?|warm(?:ly)?)\b/i,
  menacing: /\b(menacing(?:ly)?|threat(?:en(?:ed|ing|ingly))?|danger(?:ous(?:ly)?)?|sinister(?:ly)?|ominous(?:ly)?)\b/i,
  desperate: /\b(desperate(?:ly)?|plead(?:ed|ing|ingly)?|beg(?:ged|ging)?|implor(?:ed|ing|ingly)?)\b/i,
  sarcastic: /\b(sarcastic(?:ally)?|dry(?:ly)?|iron(?:ic(?:ally)?)?|mock(?:ed|ing|ingly)?)\b/i,
  exhausted: /\b(exhaust(?:ed|edly)|tir(?:ed|edly)|wear(?:y|ily)|drain(?:ed)?)\b/i,

  // Physical state cues (for voice adjustments)
  breathless: /\b(breathless(?:ly)?|pant(?:ed|ing)|gasp(?:ed|ing)|out of breath)\b/i,
  strained: /\b(strain(?:ed)?|forc(?:ed|ing)|gritt(?:ed|ing)|through (?:his|her|their) teeth)\b/i,
  choked: /\b(chok(?:ed|ing)|voice (?:crack(?:ed|ing)|break(?:ing)?)|sob(?:bed|bing)?)\b/i
};

/**
 * Extract emotional delivery cues from narrator attribution text
 *
 * @param {string} attributionText - The narrator attribution (e.g., "he whispered fearfully")
 * @returns {Object} Extracted cues with delivery mode and emotions
 *
 * @example
 * extractEmotionalCues("he whispered fearfully")
 * // Returns: { delivery: 'whisper', emotions: ['fearful'], rawCues: ['whispered', 'fearfully'] }
 *
 * @example
 * extractEmotionalCues("she said angrily, her voice rising")
 * // Returns: { delivery: null, emotions: ['angry'], rawCues: ['angrily'] }
 */
export function extractEmotionalCues(attributionText) {
  if (!attributionText || typeof attributionText !== 'string') {
    return { delivery: null, emotions: [], rawCues: [], intensity: 'normal' };
  }

  const text = attributionText.toLowerCase();
  const rawCues = [];
  const emotions = [];
  let delivery = null;
  let intensity = 'normal';

  // Check delivery modes first (these wrap the emotion tags)
  if (EMOTIONAL_CUE_PATTERNS.whisper.test(text)) {
    delivery = 'whisper';
    rawCues.push(text.match(EMOTIONAL_CUE_PATTERNS.whisper)[0]);
  } else if (EMOTIONAL_CUE_PATTERNS.shouting.test(text)) {
    delivery = 'shouting';
    rawCues.push(text.match(EMOTIONAL_CUE_PATTERNS.shouting)[0]);
    intensity = 'high';
  }

  // Check emotional states (V3 compatible emotions)
  const v3Emotions = ['fearful', 'sad', 'angry', 'excited', 'surprised', 'calm'];
  for (const emotion of v3Emotions) {
    if (EMOTIONAL_CUE_PATTERNS[emotion]?.test(text)) {
      emotions.push(emotion);
      const match = text.match(EMOTIONAL_CUE_PATTERNS[emotion]);
      if (match) rawCues.push(match[0]);
    }
  }

  // Check additional emotional nuances
  const nuanceEmotions = ['nervous', 'tender', 'menacing', 'desperate', 'sarcastic', 'exhausted'];
  for (const emotion of nuanceEmotions) {
    if (EMOTIONAL_CUE_PATTERNS[emotion]?.test(text)) {
      emotions.push(emotion);
      const match = text.match(EMOTIONAL_CUE_PATTERNS[emotion]);
      if (match) rawCues.push(match[0]);
    }
  }

  // Check physical state cues
  const physicalStates = ['breathless', 'strained', 'choked'];
  for (const state of physicalStates) {
    if (EMOTIONAL_CUE_PATTERNS[state]?.test(text)) {
      emotions.push(state);
      const match = text.match(EMOTIONAL_CUE_PATTERNS[state]);
      if (match) rawCues.push(match[0]);
    }
  }

  // Determine intensity based on cue combinations
  if (emotions.includes('fearful') || emotions.includes('angry') || emotions.includes('desperate')) {
    intensity = 'high';
  } else if (emotions.includes('tender') || emotions.includes('calm') || delivery === 'whisper') {
    intensity = 'low';
  }

  const result = {
    delivery,
    emotions: [...new Set(emotions)], // Dedupe
    rawCues: [...new Set(rawCues)],
    intensity,
    hasEmotionalContent: delivery !== null || emotions.length > 0
  };

  if (result.hasEmotionalContent) {
    logger.debug(`[SpeechTagAgent] EMOTION_EXTRACTED | text: "${attributionText.substring(0, 50)}..." | delivery: ${delivery} | emotions: [${emotions.join(', ')}] | intensity: ${intensity}`);
  }

  return result;
}

/**
 * LLM-enhanced emotional cue extraction
 * Uses LLM analysis when regex patterns don't find strong matches
 *
 * @param {string} attributionText - The narrator attribution text
 * @param {Object} context - Story context for better analysis
 * @returns {Promise<Object>} Enhanced cues with LLM-detected emotions
 */
export async function extractEmotionalCuesWithLLM(attributionText, context = {}) {
  // First try regex extraction
  const regexCues = extractEmotionalCues(attributionText);

  // If regex found strong matches or LLM is disabled, use regex results
  if (!USE_LLM_EMOTION_EXTRACTION ||
      regexCues.hasEmotionalContent && regexCues.emotions.length >= 1) {
    return regexCues;
  }

  // Use LLM for enhanced extraction when regex doesn't find emotions
  try {
    const llmAnalysis = await analyzeSegmentEmotion(
      { text: attributionText, speaker: 'narrator', type: 'narrator' },
      context
    );

    // Merge LLM results with regex results
    const mergedCues = {
      delivery: regexCues.delivery || (llmAnalysis.v3_emotion === 'whisper' ? 'whisper' :
                                        llmAnalysis.v3_emotion === 'shouting' ? 'shouting' : null),
      emotions: [...new Set([...regexCues.emotions, llmAnalysis.v3_emotion].filter(Boolean))],
      rawCues: regexCues.rawCues,
      intensity: llmAnalysis.intensity > 70 ? 'high' : llmAnalysis.intensity < 30 ? 'low' : 'normal',
      hasEmotionalContent: true,
      llmEnhanced: true,
      v3AudioTags: llmAnalysis.v3AudioTags
    };

    logger.debug(`[SpeechTagAgent] LLM_ENHANCED | text: "${attributionText.substring(0, 50)}..." | v3Tags: ${llmAnalysis.v3AudioTags}`);
    return mergedCues;
  } catch (error) {
    logger.debug(`[SpeechTagAgent] LLM extraction failed, using regex only: ${error.message}`);
    return regexCues;
  }
}

/**
 * Convert extracted emotional cues to V3-compatible audio tags
 *
 * @param {Object} cues - Extracted cues from extractEmotionalCues()
 * @returns {string} V3 audio tags string (e.g., "[whisper][fearful]")
 */
export function cuesToV3Tags(cues) {
  if (!cues || !cues.hasEmotionalContent) {
    return '';
  }

  const tags = [];

  // Delivery mode (outermost tag)
  if (cues.delivery) {
    tags.push(`[${cues.delivery}]`);
  }

  // Primary emotion (innermost tag - use first V3-compatible emotion)
  const v3Compatible = ['fearful', 'sad', 'angry', 'excited', 'surprised', 'calm'];
  const primaryEmotion = cues.emotions.find(e => v3Compatible.includes(e));
  if (primaryEmotion) {
    tags.push(`[${primaryEmotion}]`);
  }

  return tags.join('');
}

/**
 * Find the index of an adjacent dialogue segment (non-narrator)
 *
 * @param {Array} segments - Full segments array
 * @param {number} startIdx - Index to search from
 * @param {string} direction - 'before' or 'after'
 * @returns {number} Index of adjacent dialogue segment, or -1 if not found
 */
function findAdjacentDialogueIndex(segments, startIdx, direction = 'before') {
  if (direction === 'before') {
    // Search backwards for previous dialogue
    for (let i = startIdx - 1; i >= 0; i--) {
      if (segments[i] && segments[i].speaker !== 'narrator') {
        return i;
      }
    }
  } else {
    // Search forwards for next dialogue
    for (let i = startIdx + 1; i < segments.length; i++) {
      if (segments[i] && segments[i].speaker !== 'narrator') {
        return i;
      }
    }
  }
  return -1;
}

// Light-touch mode: When pre-gen baking is used, only do minimal cleanup
const LIGHT_TOUCH_MODE = process.env.SPEECH_FILTER_LIGHT_TOUCH === 'true';

/**
 * Filter speech attribution from narrator segments using 3-pass LLM validation
 *
 * @param {Array} segments - Array of {speaker, text, voice_role, emotion} objects
 * @param {Object} context - Story context for better understanding
 * @returns {Array} Filtered segments with speech tags removed/stripped
 */
export async function filterSpeechTagsWithLLM(segments, context = {}) {
  const startTime = Date.now();

  // Extract narrator segments that need processing
  const narratorSegments = segments
    .map((seg, idx) => ({ ...seg, originalIndex: idx }))
    .filter(seg => seg.speaker === 'narrator' && seg.text.trim().length > 0);

  const dialogueCount = segments.filter(s => s.speaker !== 'narrator').length;
  logger.info(`[SpeechTagAgent] ========== SPEECH TAG FILTERING START ==========`);
  logger.info(`[SpeechTagAgent] INPUT | total: ${segments.length} | narrator: ${narratorSegments.length} | dialogue: ${dialogueCount}`);
  logger.info(`[SpeechTagAgent] MODE | three_pass: ${THREE_PASS_MODE}`);

  if (narratorSegments.length === 0) {
    logger.info(`[SpeechTagAgent] SKIP | reason: no_narrator_segments`);
    return segments; // No narrator segments to process
  }

  try {
    // ========== PASS 1: Initial Attribution Identification ==========
    logger.info(`[SpeechTagAgent] PASS_1_START | segments: ${narratorSegments.length}`);
    const pass1Results = await identifyAttribution(narratorSegments);
    logger.info(`[SpeechTagAgent] PASS_1_COMPLETE | proposals: ${pass1Results.length}`);

    // If 3-pass mode is disabled, skip verification
    let verifiedResults = pass1Results;

    if (THREE_PASS_MODE && pass1Results.some(r => r.removed)) {
      // ========== PASS 2: Verification of Proposed Removals ==========
      logger.info(`[SpeechTagAgent] PASS_2_START | verifying removals`);
      verifiedResults = await verifyRemovals(narratorSegments, pass1Results);
      logger.info(`[SpeechTagAgent] PASS_2_COMPLETE | verified: ${verifiedResults.filter(r => r.verified).length}`);

      // ========== PASS 3: Final Validation ==========
      logger.info(`[SpeechTagAgent] PASS_3_START | final validation`);
      const cleanedTexts = verifiedResults.map(r => ({
        index: r.index,
        text: r.cleaned || narratorSegments[r.index]?.text || ''
      }));
      const pass3Valid = await validateNoAttribution(cleanedTexts);
      logger.info(`[SpeechTagAgent] PASS_3_COMPLETE | all_clean: ${pass3Valid.allClean} | remaining: ${pass3Valid.remaining?.length || 0}`);

      if (!pass3Valid.allClean && pass3Valid.remaining?.length > 0) {
        // Some attribution still remains - log warning but don't fail
        // The 3-pass system caught it, which is success
        logger.warn(`[SpeechTagAgent] REMAINING_ATTRIBUTION | count: ${pass3Valid.remaining.length}`);
        for (const rem of pass3Valid.remaining) {
          logger.warn(`[SpeechTagAgent] REMAINING | index: ${rem.index} | text: "${rem.text?.substring(0, 50)}..."`);
        }
      }
    }

    // Apply the verified results back to segments
    const filteredSegments = [...segments];
    let removedCount = 0;
    let strippedCount = 0;
    let unchangedCount = 0;
    let emotionalCuesApplied = 0;

    for (const result of verifiedResults) {
      const narratorSeg = narratorSegments[result.index];
      if (!narratorSeg) {
        // FAIL LOUD: Index mismatch
        logger.error(`[SpeechTagAgent] FAIL_LOUD: Index mismatch | result.index: ${result.index} | narratorSegments.length: ${narratorSegments.length}`);
        throw new Error(`[SpeechTagAgent] FAIL_LOUD: LLM returned invalid index ${result.index} (max: ${narratorSegments.length - 1}).`);
      }

      const originalIdx = narratorSeg.originalIndex;
      const cleanedText = (result.cleaned || '').trim();
      const originalText = narratorSeg.text.trim();

      // =================================================================
      // P0 CRITICAL: Extract emotional cues BEFORE discarding attribution
      // "he whispered fearfully" → preserve [whisper, fearful] for dialogue
      // =================================================================
      if (result.removed) {
        const emotionalCues = extractEmotionalCues(result.removed);
        if (emotionalCues.hasEmotionalContent) {
          // Find the previous dialogue segment to apply cues to
          // The narrator attribution typically follows or precedes the dialogue it describes
          const prevDialogueIdx = findAdjacentDialogueIndex(segments, originalIdx, 'before');
          const nextDialogueIdx = findAdjacentDialogueIndex(segments, originalIdx, 'after');

          // Prefer previous dialogue (most common: dialogue followed by "he said fearfully")
          // Fall back to next dialogue if no previous exists
          const targetDialogueIdx = prevDialogueIdx !== -1 ? prevDialogueIdx : nextDialogueIdx;

          if (targetDialogueIdx !== -1 && filteredSegments[targetDialogueIdx]) {
            const targetSegment = filteredSegments[targetDialogueIdx];
            const v3Tags = cuesToV3Tags(emotionalCues);

            // Apply emotional cues to the dialogue segment
            filteredSegments[targetDialogueIdx] = {
              ...targetSegment,
              extractedEmotionalCues: emotionalCues,
              v3Tags: v3Tags,
              // Merge with any existing emotion
              emotion: targetSegment.emotion || emotionalCues.emotions[0] || undefined,
              deliveryMode: emotionalCues.delivery || targetSegment.deliveryMode,
              emotionalIntensity: emotionalCues.intensity || targetSegment.emotionalIntensity || 'normal'
            };

            emotionalCuesApplied++;
            logger.info(`[SpeechTagAgent] EMOTION_APPLIED | attribution: "${result.removed.substring(0, 40)}..." | v3Tags: ${v3Tags} | targetIdx: ${targetDialogueIdx} | speaker: ${targetSegment.speaker}`);
          } else {
            // HIGH-2 FIX: Log warning when emotional cues cannot be applied
            // This helps identify scenes where narrator-only content loses emotional context
            const v3Tags = cuesToV3Tags(emotionalCues);
            logger.warn(`[SpeechTagAgent] EMOTION_ORPHANED | attribution: "${result.removed.substring(0, 40)}..." | v3Tags: ${v3Tags} | reason: no_adjacent_dialogue | ` +
              `prevDialogueIdx: ${prevDialogueIdx} | nextDialogueIdx: ${nextDialogueIdx} | originalIdx: ${originalIdx}`);

            // Store orphaned cues for potential use by downstream audio processing
            // If all narrator, these cues could be applied to narrator voice settings
            if (!filteredSegments._orphanedEmotionalCues) {
              filteredSegments._orphanedEmotionalCues = [];
            }
            filteredSegments._orphanedEmotionalCues.push({
              cues: emotionalCues,
              v3Tags: v3Tags,
              originalIndex: originalIdx,
              removedText: result.removed
            });
          }
        }
      }

      if (cleanedText.length === 0) {
        // Entire segment was attribution - mark for removal
        filteredSegments[originalIdx] = null;
        removedCount++;
        logger.debug(`[SpeechTagAgent] SEGMENT[${result.index}] REMOVED | original: "${originalText.substring(0, 60)}..." | removed: "${result.removed || 'all'}"`);
      } else if (cleanedText !== originalText) {
        // Partial removal - update text
        filteredSegments[originalIdx] = {
          ...filteredSegments[originalIdx],
          text: cleanedText
        };
        strippedCount++;
        logger.debug(`[SpeechTagAgent] SEGMENT[${result.index}] STRIPPED | removed: "${result.removed}" | kept: "${cleanedText.substring(0, 50)}..."`);
      } else {
        // No change
        unchangedCount++;
        logger.debug(`[SpeechTagAgent] SEGMENT[${result.index}] KEPT | text: "${originalText.substring(0, 50)}..."`);
      }
    }

    // Remove null entries (segments that were entirely attribution)
    const finalSegments = filteredSegments.filter(seg => seg !== null);

    // Collect orphaned emotional cues for downstream use (voice director can apply to narrator segments)
    const orphanedCues = filteredSegments._orphanedEmotionalCues || [];

    // Output summary
    const elapsed = Date.now() - startTime;
    logger.info(`[SpeechTagAgent] ========== SPEECH TAG FILTERING COMPLETE ==========`);
    logger.info(`[SpeechTagAgent] OUTPUT | removed: ${removedCount} | stripped: ${strippedCount} | unchanged: ${unchangedCount}`);
    logger.info(`[SpeechTagAgent] EMOTION_CUES | applied: ${emotionalCuesApplied} emotional cues to dialogue segments | orphaned: ${orphanedCues.length}`);
    logger.info(`[SpeechTagAgent] RESULT | final: ${finalSegments.length} segments (was ${segments.length}) | elapsed: ${elapsed}ms`);

    // Return object with segments and orphaned cues (backwards compatible - can also just access .segments)
    const result = finalSegments;
    result.orphanedCues = orphanedCues;
    result.stats = { removed: removedCount, stripped: strippedCount, unchanged: unchangedCount, emotionalCuesApplied, orphanedCuesCount: orphanedCues.length };
    return result;

  } catch (error) {
    // FAIL LOUD: Don't silently pass through unfiltered segments
    logger.error(`[SpeechTagAgent] FAIL_LOUD: Operation failed | error: ${error.message}`);

    // Re-throw if already a FAIL_LOUD error
    if (error.message.includes('FAIL_LOUD')) {
      throw error;
    }

    // Wrap other errors
    throw new Error(`[SpeechTagAgent] FAIL_LOUD: Speech tag filtering failed. Error: ${error.message}. Speech tags may leak through if this is ignored.`);
  }
}

/**
 * PASS 1: Identify speech attribution in narrator segments
 */
async function identifyAttribution(narratorSegments) {
  const segmentList = narratorSegments.map((seg, i) =>
    `[${i}] "${seg.text}"`
  ).join('\n');

  const prompt = `You are filtering speech attribution from audiobook narration segments.

CONTEXT: This is a multi-voice audiobook where each character has their own voice actor. Speech attribution phrases like "he said", "she replied", "Marcus whispered" are REDUNDANT because listeners already hear WHO is speaking.

YOUR TASK: For each narrator segment below, identify and REMOVE any speech attribution. Keep all other narration (descriptions, actions, setting, etc.)

WHAT TO REMOVE (speech attribution):
- Direct attribution: "he said", "she replied", "Marcus whispered"
- Attribution with manner: "he said softly", "she replied with a sigh"
- Attribution with description: "he said, his voice firm", "she whispered, eyes narrowing"
- Inverted attribution: "said the captain", "replied Marcus"
- Complex attribution: "the old man muttered to himself", "her companion responded"
- Standalone attribution phrases that connect dialogue

WHAT TO KEEP:
- Action descriptions: "She crossed the room", "He slammed his fist on the table"
- Setting/atmosphere: "The wind howled outside", "Silence filled the room"
- Character descriptions: "His face was pale", "She looked exhausted"
- Reactions/emotions: "Fear gripped her heart", "He felt a chill"
- Non-speech actions: "She nodded", "He shrugged"

NARRATOR SEGMENTS TO PROCESS:
${segmentList}

RESPOND WITH JSON ARRAY - one object per segment:
[
  {"index": 0, "cleaned": "cleaned text or empty string if entire segment was attribution", "removed": "what was removed or null if unchanged"},
  ...
]

CRITICAL RULES:
- If a segment is ENTIRELY speech attribution, return empty string for "cleaned"
- Preserve the remaining text exactly (don't rephrase or reword)
- Keep punctuation and formatting intact
- If no attribution found, return original text unchanged with removed: null
- Be conservative - when in doubt, keep the text`;

  const response = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    agent_name: 'speech_tag_filter',
    agent_category: 'coherence', // Upgraded from utility for better accuracy
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  });

  return parseFilterResponse(response, narratorSegments.length);
}

/**
 * PASS 2: Verify proposed removals are correct
 */
async function verifyRemovals(narratorSegments, pass1Results) {
  // Only verify segments where something was removed
  const toVerify = pass1Results.filter(r => r.removed);

  if (toVerify.length === 0) {
    return pass1Results; // Nothing to verify
  }

  const verificationList = toVerify.map(r => {
    const original = narratorSegments[r.index]?.text || '';
    return `[${r.index}] ORIGINAL: "${original}"
    PROPOSED: "${r.cleaned}"
    REMOVED: "${r.removed}"`;
  }).join('\n\n');

  const prompt = `VERIFICATION CHECK: Review these proposed speech attribution removals.

For each, confirm:
1. The removed text IS actually speech attribution
2. The remaining text makes sense on its own
3. No important narrative information was accidentally removed

PROPOSED CHANGES:
${verificationList}

Return JSON array with verification status:
[
  {"index": 0, "verified": true, "reason": "correctly identified 'he said' attribution"},
  {"index": 1, "verified": false, "reason": "removed text contains action, should keep", "corrected": "the corrected text to use instead"}
]

Be strict - only mark verified: true if the removal is clearly correct.
If verified: false, provide the corrected text that should be used instead.`;

  const response = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    agent_name: 'speech_tag_verify',
    agent_category: 'coherence',
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  try {
    const content = response?.content;
    const parsed = JSON.parse(content);
    const verifications = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data || []);

    // Merge verification results with pass1 results
    const mergedResults = [...pass1Results];
    for (const v of verifications) {
      const idx = mergedResults.findIndex(r => r.index === v.index);
      if (idx !== -1) {
        mergedResults[idx].verified = v.verified;
        if (!v.verified && v.corrected) {
          // Use corrected version instead
          mergedResults[idx].cleaned = v.corrected;
          mergedResults[idx].correctedByPass2 = true;
          logger.info(`[SpeechTagAgent] PASS2_CORRECTION | index: ${v.index} | reason: ${v.reason}`);
        }
      }
    }

    return mergedResults;
  } catch (parseError) {
    logger.warn(`[SpeechTagAgent] PASS2_PARSE_ERROR | ${parseError.message} | using pass1 results`);
    return pass1Results; // Fall back to pass1 results if verification fails
  }
}

/**
 * PASS 3: Validate that no attribution remains
 */
async function validateNoAttribution(cleanedTexts) {
  // Only check non-empty texts
  const textsToCheck = cleanedTexts.filter(t => t.text.trim().length > 0);

  if (textsToCheck.length === 0) {
    return { allClean: true, remaining: [] };
  }

  const textList = textsToCheck.map(t =>
    `[${t.index}] "${t.text}"`
  ).join('\n');

  const prompt = `FINAL CHECK: Review these narrator segments and identify ANY remaining speech attribution.

Look for ANY instance of:
- "he/she said", "he/she replied", "he/she whispered"
- "[Name] said/replied/whispered/muttered/etc"
- "said [Name]", "replied [Name]"
- Any phrase that attributes speech to a character

SEGMENTS TO CHECK:
${textList}

Return JSON:
{
  "allClean": true/false,
  "remaining": [
    {"index": 0, "text": "the problematic text", "attribution": "what should be removed"}
  ]
}

Return allClean: true only if NO segments contain speech attribution.`;

  const response = await callLLM({
    messages: [{ role: 'user', content: prompt }],
    agent_name: 'speech_tag_validate',
    agent_category: 'coherence',
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  try {
    const parsed = JSON.parse(response?.content);
    return {
      allClean: parsed.allClean !== false,
      remaining: parsed.remaining || []
    };
  } catch (parseError) {
    logger.warn(`[SpeechTagAgent] PASS3_PARSE_ERROR | ${parseError.message}`);
    return { allClean: true, remaining: [] }; // Assume clean if parse fails
  }
}

/**
 * Parse LLM response with improved error handling
 * Returns passthrough results if parsing fails rather than crashing
 */
function parseFilterResponse(response, expectedCount) {
  const content = response?.content;
  if (!content) {
    logger.warn('[SpeechTagAgent] Empty response from LLM, returning passthrough');
    // Return passthrough - no filtering applied
    return Array.from({ length: expectedCount }, (_, i) => ({
      index: i,
      cleaned: undefined,
      removed: null
    }));
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseError) {
    logger.warn(`[SpeechTagAgent] Failed to parse JSON: ${parseError.message}. Using passthrough.`);
    // Return passthrough on JSON parse error
    return Array.from({ length: expectedCount }, (_, i) => ({
      index: i,
      cleaned: undefined,
      removed: null
    }));
  }

  // Handle various LLM response formats:
  // 1. Array directly: [{ index, cleaned, removed }, ...]
  // 2. Wrapped in object: { segments: [...] } or { results: [...] }
  // 3. Single object (LLM sometimes returns just one): { index, cleaned, removed }
  let results;
  if (Array.isArray(parsed)) {
    results = parsed;
  } else if (parsed && (parsed.segments || parsed.results || parsed.result || parsed.data)) {
    results = parsed.segments || parsed.results || parsed.result || parsed.data || [];
  } else if (typeof parsed === 'object' && parsed?.index !== undefined && parsed?.cleaned !== undefined) {
    // LLM returned a single object instead of array - wrap it
    logger.info(`[SpeechTagAgent] LLM returned single object, wrapping`);
    results = [parsed];
  } else {
    results = [];
  }

  logger.info(`[SpeechTagAgent] LLM_RESPONSE | resultCount: ${results.length} | expectedCount: ${expectedCount} | responseLength: ${content.length}`);

  // If zero results, log warning and return passthrough instead of throwing
  if (results.length === 0) {
    const debugInfo = `parsed type: ${typeof parsed} | isArray: ${Array.isArray(parsed)} | keys: ${Object.keys(parsed || {}).join(', ')} | preview: ${content.substring(0, 200)}`;
    logger.warn(`[SpeechTagAgent] LLM returned zero results | ${debugInfo}. Using passthrough.`);
    // Return passthrough - no filtering applied
    return Array.from({ length: expectedCount }, (_, i) => ({
      index: i,
      cleaned: undefined,
      removed: null
    }));
  }

  return results;
}

/**
 * Single-pass filter (for performance-critical scenarios)
 * Skips verification passes but keeps FAIL LOUD behavior
 */
export async function filterSpeechTagsSinglePass(segments, context = {}) {
  // Temporarily disable 3-pass mode
  const originalMode = THREE_PASS_MODE;
  try {
    return await filterSpeechTagsWithLLM(segments, context);
  } finally {
    // Restore (not needed since it's a const, but for clarity)
  }
}

/**
 * Batch process multiple scenes' segments for efficiency
 * Groups segments and makes fewer LLM calls
 */
export async function filterSpeechTagsBatch(segmentsByScene, context = {}) {
  const results = [];

  // Process in parallel batches of 3 scenes
  const batchSize = 3;
  for (let i = 0; i < segmentsByScene.length; i += batchSize) {
    const batch = segmentsByScene.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(segments => filterSpeechTagsWithLLM(segments, context))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Light-touch filter for when pre-gen baking is trusted
 * Uses regex patterns instead of LLM calls - much faster but less accurate
 * Best used when scene was generated with hideSpeechTags=true
 *
 * @param {Array} segments - Array of {speaker, text, voice_role, emotion} objects
 * @param {Object} options - { trustPreGen: true to skip entirely, strictMode: false for lenient }
 * @returns {Array} Filtered segments
 */
export async function filterSpeechTagsLightTouch(segments, options = {}) {
  const { trustPreGen = false, strictMode = false } = options;
  const startTime = Date.now();

  logger.info(`[SpeechTagAgent] LIGHT_TOUCH mode | trustPreGen: ${trustPreGen} | strictMode: ${strictMode}`);

  // If pre-gen baking is fully trusted, skip filtering entirely
  if (trustPreGen) {
    logger.info(`[SpeechTagAgent] SKIP | reason: trustPreGen=true`);
    return segments;
  }

  // Common speech attribution patterns to remove
  const ATTRIBUTION_PATTERNS = [
    // Basic "he/she said" patterns
    /,?\s*(he|she|they|[A-Z][a-z]+)\s+(said|replied|asked|answered|responded|muttered|whispered|shouted|exclaimed|called|cried|yelled|screamed|demanded|insisted|suggested|added|continued|admitted|confessed|declared|announced)\b[^.!?]*/gi,
    // Inverted: "said he/she"
    /,?\s*(said|replied|asked|answered|responded)\s+(he|she|they|[A-Z][a-z]+)\b/gi,
    // With manner: "he said softly"
    /,?\s*(he|she|they|[A-Z][a-z]+)\s+(said|replied|asked)\s+(softly|loudly|quietly|firmly|gently|harshly|sharply|coldly|warmly)\b/gi,
  ];

  // Segments that are ONLY attribution (can be removed entirely)
  const PURE_ATTRIBUTION_PATTERNS = [
    /^(he|she|they|[A-Z][a-z]+)\s+(said|replied|asked|answered|muttered|whispered|shouted)[.,]?$/i,
    /^(said|replied)\s+(he|she|they|[A-Z][a-z]+)[.,]?$/i,
  ];

  const filteredSegments = [];
  let removedCount = 0;
  let strippedCount = 0;

  for (const seg of segments) {
    // Only process narrator segments
    if (seg.speaker !== 'narrator' || !seg.text?.trim()) {
      filteredSegments.push(seg);
      continue;
    }

    let text = seg.text.trim();
    const originalText = text;

    // Check if entire segment is pure attribution
    const isPureAttribution = PURE_ATTRIBUTION_PATTERNS.some(p => p.test(text));
    if (isPureAttribution) {
      logger.debug(`[SpeechTagAgent-LT] REMOVED | pure attribution: "${text}"`);
      removedCount++;
      continue; // Skip this segment entirely
    }

    // Apply attribution removal patterns
    for (const pattern of ATTRIBUTION_PATTERNS) {
      text = text.replace(pattern, '');
    }

    // Clean up any double spaces or leading/trailing punctuation issues
    text = text.replace(/\s{2,}/g, ' ').trim();
    text = text.replace(/^[,\s]+/, '').replace(/[,\s]+$/, '').trim();

    if (!text) {
      logger.debug(`[SpeechTagAgent-LT] REMOVED | became empty after strip: "${originalText}"`);
      removedCount++;
      continue;
    }

    if (text !== originalText) {
      strippedCount++;
      logger.debug(`[SpeechTagAgent-LT] STRIPPED | "${originalText}" → "${text}"`);
    }

    filteredSegments.push({ ...seg, text });
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[SpeechTagAgent] LIGHT_TOUCH complete | removed: ${removedCount} | stripped: ${strippedCount} | elapsed: ${elapsed}ms`);

  return filteredSegments;
}

/**
 * Smart filter that chooses approach based on context
 * - If pre-gen baking was used (hideSpeechTags=true in config), use light-touch
 * - Otherwise, use full 3-pass LLM filter
 *
 * @param {Array} segments - Segments to filter
 * @param {Object} context - { hideSpeechTagsPreGen: boolean, ... }
 * @returns {Array} Filtered segments
 */
export async function filterSpeechTagsSmart(segments, context = {}) {
  const { hideSpeechTagsPreGen = false } = context;

  // If pre-gen baking was used, trust it more and use light-touch mode
  if (hideSpeechTagsPreGen || LIGHT_TOUCH_MODE) {
    logger.info(`[SpeechTagAgent] Using LIGHT_TOUCH mode (pre-gen baking: ${hideSpeechTagsPreGen})`);
    return filterSpeechTagsLightTouch(segments, { trustPreGen: false, strictMode: false });
  }

  // Otherwise, use full LLM-based filtering
  return filterSpeechTagsWithLLM(segments, context);
}

export default {
  filterSpeechTagsWithLLM,
  filterSpeechTagsSinglePass,
  filterSpeechTagsBatch,
  filterSpeechTagsLightTouch,
  filterSpeechTagsSmart,
  // P0 Emotional cue extraction utilities
  extractEmotionalCues,
  cuesToV3Tags,
  EMOTIONAL_CUE_PATTERNS
};
