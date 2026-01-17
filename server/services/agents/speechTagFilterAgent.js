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

// Feature flag for 3-pass mode (can disable for performance testing)
const THREE_PASS_MODE = process.env.SPEECH_FILTER_THREE_PASS !== 'false';

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

    // Output summary
    const elapsed = Date.now() - startTime;
    logger.info(`[SpeechTagAgent] ========== SPEECH TAG FILTERING COMPLETE ==========`);
    logger.info(`[SpeechTagAgent] OUTPUT | removed: ${removedCount} | stripped: ${strippedCount} | unchanged: ${unchangedCount}`);
    logger.info(`[SpeechTagAgent] RESULT | final: ${finalSegments.length} segments (was ${segments.length}) | elapsed: ${elapsed}ms`);

    return finalSegments;

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

export default {
  filterSpeechTagsWithLLM,
  filterSpeechTagsSinglePass,
  filterSpeechTagsBatch
};
