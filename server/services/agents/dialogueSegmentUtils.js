/**
 * Dialogue Segment Utilities
 *
 * Utility functions for converting dialogue_map to audio segments.
 * These are NOT deprecated - they're used by the C+E architecture.
 *
 * The deprecated parts (tagDialogue, attributeDialoguesWithLLM) have been
 * archived to _archived/ folder.
 */
import { logger } from '../../utils/logger.js';

/**
 * Helper to build segments from a sorted dialogue map
 * ENHANCED: Added detailed logging and deduplication to prevent narrator repeating dialogue
 *
 * v2.0 (2025-12-12): Fixed narrator repetition by:
 * 1. Tracking ALL dialogue quotes to detect ANY repetition in narrator segments
 * 2. Removing word fragments at start/end of narrator segments
 * 3. Skipping narrator segments that are exact or near-duplicates of dialogue
 */
function buildSegmentsFromMap(sceneText, sortedMap) {
  const segments = [];
  let lastIndex = 0;

  logger.info(`[SegmentBuilder] ========== SEGMENT BUILDING START ==========`);
  logger.info(`[SegmentBuilder] INPUT | dialogues: ${sortedMap.length} | proseLength: ${sceneText.length} chars`);

  // Log first 500 chars of scene text for debugging
  logger.info(`[SegmentBuilder] PROSE_PREVIEW | first500: "${sceneText.substring(0, 500).replace(/\n/g, '\\n')}..."`);

  // Log all dialogue entries with their positions
  sortedMap.forEach((d, idx) => {
    logger.info(`[SegmentBuilder] DIALOGUE_MAP[${idx}] | speaker: ${d.speaker} | pos: [${d.start_char}-${d.end_char}] | quote: "${d.quote?.substring(0, 50)}..."`);
  });

  // Collect ALL dialogue quotes for deduplication (case-insensitive)
  const allDialogueQuotes = sortedMap.map(d => d.quote?.toLowerCase().trim()).filter(Boolean);

  for (let i = 0; i < sortedMap.length; i++) {
    const dialogue = sortedMap[i];

    // CRITICAL VALIDATION: What text is ACTUALLY at this position in the prose?
    const actualTextAtPosition = sceneText.slice(dialogue.start_char, dialogue.end_char);
    logger.info(`[SegmentBuilder] POSITION_CHECK[${i}] | expected: "${dialogue.quote?.substring(0, 40)}..." | actual: "${actualTextAtPosition.substring(0, 40)}..." | match: ${actualTextAtPosition.includes(dialogue.quote?.substring(0, 20) || '')}`);

    // FAIL LOUD: Position overlap means dialogue_map positions are corrupted
    if (dialogue.start_char < lastIndex) {
      const errorMsg = `[SegmentBuilder] FAIL_LOUD: Position overlap detected! dialogue[${i}].start_char (${dialogue.start_char}) < lastIndex (${lastIndex}). Diff: ${lastIndex - dialogue.start_char} chars. Quote: "${dialogue.quote?.substring(0, 30)}..."`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Add narration before this dialogue
    if (dialogue.start_char > lastIndex) {
      let narration = sceneText.slice(lastIndex, dialogue.start_char).trim();
      logger.info(`[SegmentBuilder] NARRATOR_EXTRACT[${i}] | range: [${lastIndex}-${dialogue.start_char}] | text: "${narration.substring(0, 60)}..." | len: ${narration.length}`);

      if (narration) {
        // Check if narration contains any quoted text (likely an overlap bug)
        if (narration.includes('"') || narration.includes('"')) {
          logger.error(`[SegmentBuilder] NARRATOR_CONTAINS_QUOTES[${i}] | This is likely wrong! | text: "${narration.substring(0, 100)}..."`);
        }

        // ====================================================================
        // DEDUPLICATION v2.0: Check against ALL dialogue quotes, not just next
        // ====================================================================
        const narrationLower = narration.toLowerCase();

        // Check if entire narration matches ANY dialogue quote
        for (const quote of allDialogueQuotes) {
          if (quote && narrationLower === quote) {
            logger.warn(`[SegmentBuilder] EXACT DUPLICATE: Narration matches dialogue quote exactly, skipping`);
            narration = '';
            break;
          }
          // Check if narration contains a dialogue quote
          if (quote && quote.length > 10 && narrationLower.includes(quote)) {
            logger.warn(`[SegmentBuilder] CONTAINS_DUPLICATE: Narration contains dialogue quote "${quote.substring(0, 30)}..."`);
            // Remove the duplicate dialogue from narration
            const regex = new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            narration = narration.replace(regex, '').trim();
            // Clean up any leftover punctuation
            narration = narration.replace(/[""\u201C\u201D]\s*[""\u201C\u201D]/g, '').trim();
            narration = narration.replace(/[""\u201C\u201D]\s*$/g, '').trim();
            narration = narration.replace(/^\s*[""\u201C\u201D]/g, '').trim();
          }
        }

        // Also check for partial matches (start of dialogue in narration)
        const quoteToCheck = dialogue.quote;
        if (narration && quoteToCheck && quoteToCheck.length > 20) {
          const firstHalf = quoteToCheck.substring(0, Math.floor(quoteToCheck.length / 2));
          if (narration.toLowerCase().includes(firstHalf.toLowerCase())) {
            logger.warn(`[SegmentBuilder] PARTIAL_DUPLICATE: Narration contains start of dialogue "${firstHalf.substring(0, 20)}..."`);
            // Find and remove everything from the partial match onward
            const partialIdx = narration.toLowerCase().indexOf(firstHalf.toLowerCase());
            if (partialIdx !== -1) {
              narration = narration.substring(0, partialIdx).trim();
              // Clean trailing punctuation/quotes
              narration = narration.replace(/[,;:\s]*[""\u201C\u201D]?\s*$/, '').trim();
              logger.info(`[SegmentBuilder] Truncated narration at partial match: "${narration.substring(0, 50)}..."`);
            }
          }
        }

        // ====================================================================
        // FRAGMENT REMOVAL: Remove orphaned word fragments at boundaries
        // These happen when dialogue positions are slightly off
        // E.g., "ensen?" (end of "Jensen?"), "ing's not right here." (end of "Something's")
        // ====================================================================
        if (narration) {
          // Remove fragments that start with lowercase (continuation of previous word)
          // unless the whole narration is lowercase (e.g., a sentence starting with a quote)
          const firstChar = narration.charAt(0);
          if (firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase()) {
            // Starts with lowercase - check if it's a fragment (short word not starting a sentence)
            const firstWord = narration.split(/\s+/)[0];
            // If first "word" is short and has no vowels or looks like a suffix, remove it
            if (firstWord.length <= 6 && /^[^aeiouAEIOU]*['']?s?$/.test(firstWord)) {
              logger.warn(`[SegmentBuilder] FRAGMENT_START: Removing orphan fragment "${firstWord}" from start`);
              narration = narration.substring(firstWord.length).trim();
              // Remove leading punctuation
              narration = narration.replace(/^[.,;:!?'""\u201C\u201D]+\s*/, '').trim();
            }
          }

          // Check for very short narration that's likely just punctuation or fragments
          if (narration.length < 5 && /^[.,;:!?'""\u201C\u201D\s]+$/.test(narration)) {
            logger.warn(`[SegmentBuilder] FRAGMENT_ONLY: Narration "${narration}" is just punctuation, skipping`);
            narration = '';
          }
        }

        if (narration) {
          segments.push({
            speaker: 'narrator',
            text: narration,
            voice_role: 'narrator',
            emotion: 'neutral'
          });
          logger.debug(`[SegmentBuilder]   → Narrator segment: "${narration.substring(0, 50)}..." (${narration.length} chars)`);
        }
      }
    }

    // CRITICAL FIX (2025-12-12): Extract dialogue text DIRECTLY from prose at the calculated positions
    // Previously we used dialogue.quote which could be truncated or different from actual prose
    // This caused narrator segments to contain fragments of dialogue that weren't captured
    const proseAtPosition = sceneText.slice(dialogue.start_char, dialogue.end_char);
    logger.info(`[SegmentBuilder] PROSE_AT_POS[${i}] | raw: "${proseAtPosition}" | len: ${proseAtPosition.length}`);

    // Remove surrounding quote marks from the prose text
    let dialogueText = proseAtPosition
      .replace(/^[""\u201C\u201D'"]+/, '') // Remove leading quotes
      .replace(/[""\u201C\u201D'"]+$/, '') // Remove trailing quotes
      .trim();

    // If we couldn't extract valid text, fall back to dialogue.quote
    if (!dialogueText || dialogueText.length === 0) {
      dialogueText = dialogue.quote;
      logger.error(`[SegmentBuilder] DIALOGUE_FALLBACK[${i}] | prose extraction empty, using quote: "${dialogue.quote?.substring(0, 40)}..."`);
    } else if (dialogueText !== dialogue.quote) {
      // Log when extracted text differs from expected quote - THIS IS THE KEY DIAGNOSTIC
      logger.warn(`[SegmentBuilder] DIALOGUE_MISMATCH[${i}] | extracted: "${dialogueText}" | original: "${dialogue.quote}" | lenDiff: ${dialogueText.length - (dialogue.quote?.length || 0)}`);
    } else {
      logger.info(`[SegmentBuilder] DIALOGUE_MATCH[${i}] | text: "${dialogueText.substring(0, 40)}..." | len: ${dialogueText.length}`);
    }

    // Add the dialogue
    segments.push({
      speaker: dialogue.speaker,
      text: dialogueText,
      voice_role: 'dialogue',
      emotion: dialogue.emotion || 'neutral',
      delivery: dialogue.delivery
    });
    logger.info(`[SegmentBuilder] SEGMENT_ADDED[${i}] | type: dialogue | speaker: ${dialogue.speaker} | text: "${dialogueText?.substring(0, 50)}..." | len: ${dialogueText?.length || 0}`);

    lastIndex = dialogue.end_char;
    logger.info(`[SegmentBuilder] LASTINDEX_UPDATE[${i}] | newLastIndex: ${lastIndex}`);
  }

  // Add remaining narration
  if (lastIndex < sceneText.length) {
    let remaining = sceneText.slice(lastIndex).trim();

    // Check final narration against all dialogue quotes for duplicates
    if (remaining) {
      const remainingLower = remaining.toLowerCase();
      for (const quote of allDialogueQuotes) {
        if (quote && remainingLower === quote) {
          logger.warn(`[SegmentBuilder] FINAL_EXACT_DUPLICATE: Final narration matches dialogue, skipping`);
          remaining = '';
          break;
        }
        if (quote && quote.length > 10 && remainingLower.includes(quote)) {
          logger.warn(`[SegmentBuilder] FINAL_CONTAINS_DUPLICATE: Final narration contains dialogue "${quote.substring(0, 30)}..."`);
          const regex = new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          remaining = remaining.replace(regex, '').trim();
          remaining = remaining.replace(/[""\u201C\u201D]\s*[""\u201C\u201D]/g, '').trim();
          remaining = remaining.replace(/[""\u201C\u201D]\s*$/g, '').trim();
        }
      }
    }

    if (remaining) {
      segments.push({
        speaker: 'narrator',
        text: remaining,
        voice_role: 'narrator',
        emotion: 'neutral'
      });
      logger.debug(`[SegmentBuilder]   → Final narrator segment: "${remaining.substring(0, 50)}..." (${remaining.length} chars)`);
    }
  }

  // Summary
  const narratorSegments = segments.filter(s => s.speaker === 'narrator').length;
  const dialogueSegments = segments.filter(s => s.speaker !== 'narrator').length;
  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);

  logger.info(`[SegmentBuilder] Built ${segments.length} segments: ${narratorSegments} narrator, ${dialogueSegments} dialogue`);
  logger.info(`[SegmentBuilder] Total chars in segments: ${totalChars} (scene was ${sceneText.length})`);

  if (totalChars > sceneText.length * 1.05) {
    logger.error(`[SegmentBuilder] TEXT DUPLICATION DETECTED: Segments total ${totalChars} chars but scene is only ${sceneText.length}`);
  }

  return segments;
}

/**
 * Convert a dialogue_map (from C+E architecture) into audio segments
 *
 * The dialogue_map is created by generateSceneWithDialogue() (Option C)
 * and validated by speakerValidationAgent (Option E).
 *
 * CRITICAL FIX (2025-12-12): ALWAYS verify and re-locate positions!
 * The dialogue_map positions are calculated on the ORIGINAL prose from scene generation,
 * but the text may be MODIFIED by validation, polishing, or fixing before segment building.
 * This causes positions to be invalid, resulting in fragments and wrong speaker assignments.
 *
 * @param {string} sceneText - The full scene prose text (may differ from original!)
 * @param {Array} dialogueMap - Pre-computed dialogue_map from database
 * @returns {Array} Segments in format [{speaker, text, voice_role, emotion}]
 */
export function convertDialogueMapToSegments(sceneText, dialogueMap) {
  if (!dialogueMap || dialogueMap.length === 0) {
    // No dialogue - return entire text as narration
    return [{
      speaker: 'narrator',
      text: sceneText,
      voice_role: 'narrator',
      emotion: 'neutral'
    }];
  }

  logger.info(`[SegmentBuilder] ========== POSITION VERIFICATION START ==========`);
  logger.info(`[SegmentBuilder] Input: ${dialogueMap.length} dialogues, ${sceneText.length} chars of prose`);

  // ALWAYS verify and re-locate positions - text may have been modified since position calculation
  // This is the FIX for the fragmentation bug caused by polishing/validation changing the text
  let searchStart = 0;
  let verifiedCount = 0;
  let relocatedCount = 0;
  let failedCount = 0;

  const verifiedMap = dialogueMap.map((d, idx) => {
    if (!d.quote || d.quote.trim().length === 0) {
      logger.warn(`[SegmentBuilder] QUOTE[${idx}] SKIP | reason: empty_quote | speaker: ${d.speaker}`);
      return null;
    }

    // Normalize the quote for matching
    const normalizedQuote = d.quote
      .replace(/^[""\u201C\u201D'"]+/, '') // Remove leading quotes
      .replace(/[""\u201C\u201D'"]+$/, '') // Remove trailing quotes
      .trim();

    // Check if the CURRENT position is valid (quote exists at that position)
    const textAtPosition = sceneText.slice(d.start_char, d.end_char);
    const textAtPosNormalized = textAtPosition
      .replace(/^[""\u201C\u201D'"]+/, '')
      .replace(/[""\u201C\u201D'"]+$/, '')
      .trim();

    // Check if position is valid (quote matches what's at that position)
    const positionValid = textAtPosNormalized.toLowerCase().includes(normalizedQuote.substring(0, 20).toLowerCase()) ||
                          normalizedQuote.toLowerCase().includes(textAtPosNormalized.substring(0, 20).toLowerCase());

    if (positionValid && d.start_char >= searchStart) {
      // Position is valid - use it
      verifiedCount++;
      logger.debug(`[SegmentBuilder] QUOTE[${idx}] VERIFIED | speaker: ${d.speaker} | pos: [${d.start_char}-${d.end_char}]`);
      searchStart = d.end_char;
      return d;
    }

    // Position is INVALID - need to re-locate this quote in the text
    logger.warn(`[SegmentBuilder] QUOTE[${idx}] INVALID_POS | speaker: ${d.speaker} | expected: "${normalizedQuote.substring(0, 30)}..." | found: "${textAtPosNormalized.substring(0, 30)}..."`);

    // Try to find the quote in the scene text from current searchStart
    const quotePatterns = [
      `"${normalizedQuote}"`,  // Straight quotes
      `"${normalizedQuote}"`,  // Curly quotes
      `"${normalizedQuote}"`,  // Mixed quotes
      normalizedQuote          // Just the text
    ];

    for (const pattern of quotePatterns) {
      const idx = sceneText.indexOf(pattern, searchStart);
      if (idx !== -1) {
        const endPos = idx + pattern.length;
        relocatedCount++;
        logger.info(`[SegmentBuilder] QUOTE[${idx}] RELOCATED | speaker: ${d.speaker} | oldPos: [${d.start_char}-${d.end_char}] | newPos: [${idx}-${endPos}]`);
        searchStart = endPos;
        return {
          ...d,
          start_char: idx,
          end_char: endPos,
          position_relocated: true
        };
      }
    }

    // Try finding just the first 30 chars of the quote (handles truncated quotes)
    const shortQuote = normalizedQuote.substring(0, Math.min(30, normalizedQuote.length));
    for (const opener of ['"', '"', '"']) {
      const searchPattern = opener + shortQuote;
      const idx = sceneText.toLowerCase().indexOf(searchPattern.toLowerCase(), searchStart);
      if (idx !== -1) {
        // Found start - now find the closing quote
        let endIdx = idx + 1;
        let depth = 0;
        while (endIdx < sceneText.length) {
          const char = sceneText[endIdx];
          if (char === '"' || char === '"') {
            if (depth === 0) break;
            depth--;
          } else if (char === '"' || char === '"') {
            depth++;
          }
          endIdx++;
        }
        if (endIdx < sceneText.length) {
          const endPos = endIdx + 1;
          relocatedCount++;
          logger.info(`[SegmentBuilder] QUOTE[${idx}] RELOCATED_FUZZY | speaker: ${d.speaker} | newPos: [${idx}-${endPos}]`);
          searchStart = endPos;
          return {
            ...d,
            start_char: idx,
            end_char: endPos,
            position_relocated: true
          };
        }
      }
    }

    // FAIL LOUD: Quote not found means positions are severely corrupted
    failedCount++;
    const errorMsg = `[SegmentBuilder] FAIL_LOUD: Quote not found anywhere in prose! speaker: ${d.speaker} | quote: "${normalizedQuote.substring(0, 50)}..." | searchStart: ${searchStart}`;
    logger.error(errorMsg);
    // Don't throw here yet - continue to count all failures, then throw if too many
    return { ...d, _failed: true, _errorMsg: errorMsg };
  });

  // Filter out failed entries and check failure threshold
  const failedEntries = verifiedMap.filter(d => d?._failed);
  const validEntries = verifiedMap.filter(d => d && !d._failed);

  logger.info(`[SegmentBuilder] VERIFICATION_COMPLETE | verified: ${verifiedCount} | relocated: ${relocatedCount} | failed: ${failedCount}`);

  // FAIL LOUD: If more than 30% of quotes failed to locate, something is seriously wrong
  const failureRate = failedEntries.length / dialogueMap.length;
  if (failureRate > 0.3) {
    const errorMsg = `[SegmentBuilder] FAIL_LOUD: ${failedEntries.length}/${dialogueMap.length} quotes (${Math.round(failureRate * 100)}%) could not be located in prose. Position calculation is severely broken.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // FAIL LOUD: If ALL quotes failed, definitely throw
  if (validEntries.length === 0) {
    const errorMsg = `[SegmentBuilder] FAIL_LOUD: ALL ${dialogueMap.length} dialogue positions failed verification. Cannot build segments.`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Sort valid entries by position and build segments
  const sortedMap = [...validEntries].sort((a, b) => a.start_char - b.start_char);
  return buildSegmentsFromMap(sceneText, sortedMap);
}

/**
 * Validate a dialogue_map for consistency
 * Used to check stored maps before audio generation
 */
export function validateDialogueMap(dialogueMap, characters) {
  const errors = [];

  if (!dialogueMap || dialogueMap.length === 0) {
    return { valid: true, errors: [] }; // Empty map is valid (no dialogue)
  }

  const characterNames = new Set(characters.map(c => c.name.toLowerCase()));

  for (const d of dialogueMap) {
    // Check speaker exists in character list
    if (!d.speaker) {
      errors.push(`Dialogue "${d.quote?.substring(0, 30)}..." has no speaker`);
    } else if (!characterNames.has(d.speaker.toLowerCase())) {
      errors.push(`Speaker "${d.speaker}" not found in character list`);
    }

    // Check positions are valid
    if (d.start_char < 0 || d.end_char < d.start_char) {
      errors.push(`Invalid positions for dialogue "${d.quote?.substring(0, 30)}..."`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  convertDialogueMapToSegments,
  validateDialogueMap
};
