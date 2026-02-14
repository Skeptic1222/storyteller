/**
 * Dialogue Segment Utilities
 *
 * Utility functions for converting dialogue_map to audio segments.
 * These are NOT deprecated - they're used by the C+E architecture.
 *
 * The deprecated parts (tagDialogue, attributeDialoguesWithLLM) have been
 * archived to _archived/ folder.
 *
 * v2.1 (2026-01-27): ElevenLabs V3 Audio Quality Initiative
 * - Made deduplication LESS aggressive to preserve narrator bridging text
 * - Exact duplicates still removed (real bugs)
 * - Partial matches now preserved unless they're clearly duplicated dialogue
 * - Added CONSERVATIVE_DEDUPLICATION flag for new behavior
 */
import { logger } from '../../utils/logger.js';

// Feature flag: Use conservative deduplication that preserves more narrator text
// Set to 'false' to use the old aggressive deduplication
const CONSERVATIVE_DEDUPLICATION = process.env.SEGMENT_CONSERVATIVE_DEDUP !== 'false';

/**
 * Check if narration text is a true duplicate vs intentional narrative repetition
 * True duplicates: Same text appears due to position calculation errors
 * Intentional repetition: Narrator echoes dialogue for literary effect ("It's time," she said. It's time.)
 *
 * @param {string} narration - The narrator text
 * @param {string} dialogueQuote - The dialogue quote being checked
 * @returns {Object} { isDuplicate: boolean, confidence: 'high'|'medium'|'low', reason: string }
 */
function checkIfTrueDuplicate(narration, dialogueQuote) {
  const narrationLower = narration.toLowerCase().trim();
  const quoteLower = dialogueQuote.toLowerCase().trim();

  // Exact match is DEFINITELY a duplicate (position error)
  if (narrationLower === quoteLower) {
    return { isDuplicate: true, confidence: 'high', reason: 'exact_match' };
  }

  // If narration is MOSTLY the dialogue (>80% overlap), it's likely a position error
  if (narrationLower.length > 10 && quoteLower.length > 10) {
    const narrationWords = new Set(narrationLower.split(/\s+/));
    const quoteWords = quoteLower.split(/\s+/);
    const matchingWords = quoteWords.filter(w => narrationWords.has(w)).length;
    const overlapRatio = matchingWords / Math.max(quoteWords.length, 1);

    if (overlapRatio > 0.8 && Math.abs(narrationLower.length - quoteLower.length) < 20) {
      return { isDuplicate: true, confidence: 'high', reason: `word_overlap_${Math.round(overlapRatio * 100)}%` };
    }
  }

  // Narration contains the quote as a substring - could be:
  // 1. Position error (dialogue text leaked into narrator segment)
  // 2. Intentional echo ("Come here," she said. Come here.)
  //
  // In CONSERVATIVE mode, we DON'T remove these - they might be intentional
  if (narrationLower.includes(quoteLower)) {
    // Only consider it a duplicate if the quote makes up most of the narration
    const quoteRatio = quoteLower.length / narrationLower.length;
    if (quoteRatio > 0.7) {
      return { isDuplicate: true, confidence: 'medium', reason: 'substring_dominant' };
    }
    // Quote is a small part of narration - likely intentional context
    return { isDuplicate: false, confidence: 'medium', reason: 'substring_minor' };
  }

  // No significant overlap
  return { isDuplicate: false, confidence: 'high', reason: 'no_overlap' };
}

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
        // DEDUPLICATION v2.1: Conservative mode preserves narrator bridging text
        // Only removes true duplicates (position errors), not intentional echoes
        // ====================================================================
        if (CONSERVATIVE_DEDUPLICATION) {
          // NEW: Conservative deduplication - only remove high-confidence duplicates
          for (const quote of allDialogueQuotes) {
            if (!quote) continue;

            const dupCheck = checkIfTrueDuplicate(narration, quote);

            if (dupCheck.isDuplicate && dupCheck.confidence === 'high') {
              logger.warn(`[SegmentBuilder] TRUE_DUPLICATE (${dupCheck.reason}): Removing narration that duplicates dialogue`);
              narration = '';
              break;
            } else if (dupCheck.isDuplicate && dupCheck.confidence === 'medium') {
              // Medium confidence - log but still remove (likely position error)
              logger.warn(`[SegmentBuilder] LIKELY_DUPLICATE (${dupCheck.reason}): Removing narration - probably position error`);
              narration = '';
              break;
            } else if (!dupCheck.isDuplicate && dupCheck.reason === 'substring_minor') {
              // Narration contains dialogue but it's a small part - KEEP the narration
              logger.info(`[SegmentBuilder] KEEPING_NARRATION: Contains dialogue substring but appears intentional (${dupCheck.reason})`);
            }
          }
        } else {
          // LEGACY: Aggressive deduplication (original v2.0 behavior)
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
    //
    // FIX (2026-01-23): Don't trust dialogue.end_char - it may be wrong!
    // Instead, find the actual closing quote from start_char position.
    let actualEndChar = dialogue.end_char;
    const startChar = sceneText[dialogue.start_char];

    // If the dialogue starts with a quote mark, find the matching closing quote
    if (startChar === '"' || startChar === '"' || startChar === '\u201C') {
      const closingQuotes = ['"', '"', '\u201D'];
      let foundClosing = -1;
      let depth = 0;

      for (let pos = dialogue.start_char + 1; pos < sceneText.length; pos++) {
        const char = sceneText[pos];
        // Handle nested quotes (rare but possible)
        if (char === '"' || char === '"' || char === '\u201C') {
          depth++;
        } else if (closingQuotes.includes(char)) {
          if (depth === 0) {
            foundClosing = pos + 1; // Include the closing quote
            break;
          }
          depth--;
        }
      }

      if (foundClosing !== -1 && foundClosing !== actualEndChar) {
        logger.warn(`[SegmentBuilder] END_CHAR_FIX[${i}] | stored: ${dialogue.end_char} | actual: ${foundClosing} | diff: ${foundClosing - dialogue.end_char} chars`);
        actualEndChar = foundClosing;
      }
    }

    const proseAtPosition = sceneText.slice(dialogue.start_char, actualEndChar);
    logger.info(`[SegmentBuilder] PROSE_AT_POS[${i}] | raw: "${proseAtPosition}" | len: ${proseAtPosition.length}`);

    // Remove surrounding quote marks from the prose text
    let dialogueText = proseAtPosition
      .replace(/^[""\u201C\u201D'"]+/, '') // Remove leading quotes
      .replace(/[""\u201C\u201D'"]+$/, '') // Remove trailing quotes
      .trim();

    // Fail loud if extraction fails or mismatches
    if (!dialogueText || dialogueText.length === 0) {
      const err = `[SegmentBuilder] FAIL_LOUD: prose extraction empty for dialogue[${i}] (speaker: ${dialogue.speaker})`;
      logger.error(err);
      throw new Error(err);
    }

    // BUG FIX: Normalize both sides before comparing (dialogue.quote may have surrounding quotes)
    const normalizedOriginal = dialogue.quote
      .replace(/^[""\u201C\u201D'"]+/, '')
      .replace(/[""\u201C\u201D'"]+$/, '')
      .trim();

    // Allow partial matches - sometimes the dialogue_map has extra context words
    // e.g., "You said debts and bad luck." in map but prose only has "debts and bad luck."
    const isExactMatch = dialogueText === normalizedOriginal;
    const isSubstringMatch = normalizedOriginal.includes(dialogueText) || dialogueText.includes(normalizedOriginal);

    // FUZZY MATCH (2026-01-23): LLM sometimes writes slightly different text in dialogue_map vs prose
    // e.g., "She said it sounded like a choir" in map vs "it sounded like a choir" in prose
    // If the start AND end match, the middle likely has minor wording differences - use extracted text
    const fuzzyMatchThreshold = 20; // Check first/last 20 chars
    const extractedStart = dialogueText.substring(0, fuzzyMatchThreshold).toLowerCase();
    const originalStart = normalizedOriginal.substring(0, fuzzyMatchThreshold).toLowerCase();
    const extractedEnd = dialogueText.slice(-fuzzyMatchThreshold).toLowerCase();
    const originalEnd = normalizedOriginal.slice(-fuzzyMatchThreshold).toLowerCase();
    const isFuzzyMatch = extractedStart === originalStart && extractedEnd === originalEnd;

    if (!isExactMatch && !isSubstringMatch && !isFuzzyMatch) {
      // Last resort: check if they share significant content (>60% overlap)
      const extractedWords = new Set(dialogueText.toLowerCase().split(/\s+/));
      const originalWords = normalizedOriginal.toLowerCase().split(/\s+/);
      const matchingWords = originalWords.filter(w => extractedWords.has(w)).length;
      const overlapRatio = matchingWords / Math.max(originalWords.length, 1);

      if (overlapRatio < 0.6) {
        const err = `[SegmentBuilder] FAIL_LOUD: DIALOGUE_MISMATCH[${i}] | extracted: "${dialogueText.substring(0, 50)}..." | original: "${normalizedOriginal.substring(0, 50)}..." | overlap: ${(overlapRatio * 100).toFixed(1)}%`;
        logger.error(err);
        throw new Error(err);
      }
      logger.warn(`[SegmentBuilder] DIALOGUE_WORD_OVERLAP[${i}] | overlap: ${(overlapRatio * 100).toFixed(1)}% | using extracted text from prose`);
    }

    if (!isExactMatch && (isSubstringMatch || isFuzzyMatch)) {
      logger.warn(`[SegmentBuilder] DIALOGUE_PARTIAL_MATCH[${i}] | extracted: "${dialogueText.substring(0, 40)}..." | original: "${normalizedOriginal.substring(0, 40)}..." | using extracted text`);
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

    lastIndex = actualEndChar;
    logger.info(`[SegmentBuilder] LASTINDEX_UPDATE[${i}] | newLastIndex: ${lastIndex}`);
  }

  // Add remaining narration
  if (lastIndex < sceneText.length) {
    let remaining = sceneText.slice(lastIndex).trim();

    // Check final narration against all dialogue quotes for duplicates
    if (remaining) {
      if (CONSERVATIVE_DEDUPLICATION) {
        // NEW: Conservative deduplication for final narration
        for (const quote of allDialogueQuotes) {
          if (!quote) continue;

          const dupCheck = checkIfTrueDuplicate(remaining, quote);

          if (dupCheck.isDuplicate && (dupCheck.confidence === 'high' || dupCheck.confidence === 'medium')) {
            logger.warn(`[SegmentBuilder] FINAL_TRUE_DUPLICATE (${dupCheck.reason}): Removing final narration`);
            remaining = '';
            break;
          }
        }
      } else {
        // LEGACY: Aggressive deduplication
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
  let lastProcessedEnd = 0; // Track last successfully processed position for fallback searches
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
      lastProcessedEnd = d.end_char;
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

    // AGGRESSIVE FALLBACK 1: Search from beginning of text (quote may have moved earlier)
    // This handles cases where text was inserted before the quote
    for (const pattern of quotePatterns) {
      const idx = sceneText.indexOf(pattern, 0);
      if (idx !== -1 && idx >= lastProcessedEnd) {
        const endPos = idx + pattern.length;
        relocatedCount++;
        logger.info(`[SegmentBuilder] QUOTE[${idx}] RELOCATED_FROM_START | speaker: ${d.speaker} | newPos: [${idx}-${endPos}]`);
        searchStart = endPos;
        return {
          ...d,
          start_char: idx,
          end_char: endPos,
          position_relocated: true
        };
      }
    }

    // AGGRESSIVE FALLBACK 2: Fuzzy content match - search for distinctive words from the quote
    // Extract 2-3 distinctive words and search for them together
    const words = normalizedQuote.split(/\s+/).filter(w => w.length > 4);
    if (words.length >= 2) {
      const searchWords = words.slice(0, 3).map(w => w.toLowerCase());
      // Look for any quoted text containing these words
      const quoteRegex = /[""\u201C]([^""\u201D]+)[""\u201D]/g;
      let match;
      while ((match = quoteRegex.exec(sceneText)) !== null) {
        if (match.index >= searchStart) {
          const quotedContent = match[1].toLowerCase();
          const matchCount = searchWords.filter(w => quotedContent.includes(w)).length;
          if (matchCount >= 2) {
            const startPos = match.index;
            const endPos = match.index + match[0].length;
            relocatedCount++;
            logger.info(`[SegmentBuilder] QUOTE[${idx}] RELOCATED_FUZZY_WORDS | speaker: ${d.speaker} | matchedWords: ${matchCount}/${searchWords.length} | newPos: [${startPos}-${endPos}]`);
            searchStart = endPos;
            return {
              ...d,
              start_char: startPos,
              end_char: endPos,
              position_relocated: true
            };
          }
        }
      }
    }

    // LAST RESORT: Include as synthetic segment if text is substantial
    // Instead of dropping dialogue completely, we'll mark it for special handling
    if (normalizedQuote.length > 10) {
      logger.warn(`[SegmentBuilder] QUOTE[${idx}] SYNTHETIC | speaker: ${d.speaker} | Cannot locate in prose - will include as standalone segment`);
      relocatedCount++;
      return {
        ...d,
        _synthetic: true,
        quote: normalizedQuote // Use original quote text
      };
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

  // Warn loudly if ANY quotes failed (user should know dialogue was skipped)
  if (failedEntries.length > 0) {
    logger.warn(`[SegmentBuilder] ⚠️ WARNING: ${failedEntries.length}/${dialogueMap.length} dialogue lines could not be located and will be SKIPPED`);
    for (const failed of failedEntries) {
      logger.warn(`[SegmentBuilder]   SKIPPED: ${failed.speaker} - "${failed.quote?.substring(0, 50)}..."`);
    }
  }

  // FAIL LOUD: If more than 15% of quotes failed to locate, something is seriously wrong
  // (Lowered from 30% to catch issues earlier)
  const failureRate = failedEntries.length / dialogueMap.length;
  if (failureRate > 0.15) {
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

  // Separate synthetic entries (no position) from position-based entries
  const syntheticEntries = validEntries.filter(d => d._synthetic);
  const positionBasedEntries = validEntries.filter(d => !d._synthetic);

  // Sort position-based entries and build segments
  const sortedMap = [...positionBasedEntries].sort((a, b) => a.start_char - b.start_char);
  const segments = buildSegmentsFromMap(sceneText, sortedMap);

  // Append synthetic segments at the end (dialogue we couldn't locate but shouldn't skip)
  // These represent dialogue that was definitely in the original text but got displaced
  if (syntheticEntries.length > 0) {
    logger.info(`[SegmentBuilder] Appending ${syntheticEntries.length} synthetic segments (couldn't locate in prose)`);
    for (const synthetic of syntheticEntries) {
      segments.push({
        speaker: synthetic.speaker,
        text: synthetic.quote,
        voice_role: 'dialogue',
        emotion: synthetic.emotion || 'neutral',
        delivery: synthetic.delivery,
        _synthetic: true
      });
      logger.info(`[SegmentBuilder] SYNTHETIC_APPENDED | speaker: ${synthetic.speaker} | text: "${synthetic.quote?.substring(0, 40)}..."`);
    }
  }

  return segments;
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
