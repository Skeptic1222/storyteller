/**
 * Chapter Structure Agent (Pass 0)
 * Extracts EXPLICIT chapter/section structure from source documents
 *
 * RUNS FIRST - Before any other extraction agents
 *
 * PURPOSE:
 * - Detect if document has explicit chapter structure
 * - Preserve EXACT chapter titles and numbering
 * - Capture chapter summaries if provided
 * - This structure is then used during outline generation to maintain source organization
 */

import { logger } from '../../../utils/logger.js';

/**
 * Main entry point - extracts chapter structure from document
 */
export async function extractChapterStructure(text, openai, emit) {
  logger.info('[ChapterStructureAgent] Starting chapter structure extraction (Pass 0)');

  if (emit) {
    emit('extraction:agent-detail', {
      agent: 'chapter_structure',
      detail: 'Analyzing document structure...'
    });
  }

  const systemPrompt = `You are a document structure analyzer. Your ONLY job is to extract the EXACT chapter/section structure that is EXPLICITLY present in this document.

## WHAT TO LOOK FOR

1. **Numbered Chapters**:
   - "Chapter 1", "Chapter 1:", "CHAPTER ONE", "Ch. 1"
   - "## CHAPTER 1 — Title"
   - Simple "1.", "2.", "3." with titles

2. **Named Sections**:
   - "Act 1:", "Part 1:", "Section 1"
   - "Book One:", "Volume 1"

3. **Outline Headers**:
   - Markdown headers like "## Chapter Title"
   - Numbered outline items with descriptive titles

4. **Structure Patterns**:
   - "Prologue", "Epilogue" sections
   - "Introduction", "Conclusion"

## CRITICAL RULES

1. Extract ONLY structure that is EXPLICITLY written in the document
2. Preserve the EXACT titles as written (do not paraphrase)
3. Preserve EXACT numbering (if it says "Chapter 1", record number as 1)
4. If the document has NO chapter structure, return has_explicit_structure: false
5. Do NOT invent chapters - only extract what exists
6. If you find chapter summaries in the source, capture them

## OUTPUT FORMAT

Return valid JSON:
{
  "has_explicit_structure": true/false,
  "structure_type": "chapters" | "acts" | "parts" | "sections" | "outline" | "none",
  "chapters": [
    {
      "number": 1,
      "title": "EXACT title from document",
      "subtitle": "Subtitle if present",
      "summary": "Summary if provided in source (not generated)",
      "source_line": "The exact line/header from document that defines this chapter"
    }
  ],
  "total_chapters": number,
  "notes": "Any observations about the structure"
}

If no explicit structure found, return:
{
  "has_explicit_structure": false,
  "structure_type": "none",
  "chapters": [],
  "total_chapters": 0,
  "notes": "Document does not have explicit chapter/section structure"
}`;

  // Use first 50k chars for structure detection (chapters are usually defined early)
  const textSample = text.length > 50000
    ? text.substring(0, 50000)
    : text;

  const userPrompt = `Extract the EXACT chapter structure from this document. Only extract chapters/sections that are EXPLICITLY defined - do not invent or guess at structure.

DOCUMENT TEXT:
${textSample}`;

  try {
    // UPGRADED: Using gpt-4.1-2025-04-14 for better chapter structure detection
    // gpt-4o-mini was failing to detect explicit 15-chapter structure
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,  // Very low temperature for accuracy
      response_format: { type: 'json_object' },
      max_tokens: 8000  // Increased for larger chapter structures
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');

    const chapterCount = result.chapters?.length || 0;
    const hasStructure = result.has_explicit_structure || false;

    logger.info(`[ChapterStructureAgent] Extraction complete - Found ${hasStructure ? chapterCount : 0} chapters (has_structure: ${hasStructure})`);

    if (emit) {
      emit('extraction:agent-detail', {
        agent: 'chapter_structure',
        detail: hasStructure
          ? `Found ${chapterCount} explicit chapters`
          : 'No explicit chapter structure found'
      });
    }

    return {
      ...result,
      tokens_used: response.usage?.total_tokens || 0
    };

  } catch (error) {
    logger.error('[ChapterStructureAgent] Extraction failed:', error);

    return {
      has_explicit_structure: false,
      structure_type: 'none',
      chapters: [],
      total_chapters: 0,
      notes: `Extraction failed: ${error.message}`,
      tokens_used: 0
    };
  }
}

/**
 * Utility to merge chapter structure into synopsis data
 */
export function mergeChapterStructureIntoSynopsis(synopsisData, chapterStructure) {
  if (!chapterStructure?.has_explicit_structure) {
    return synopsisData;
  }

  return {
    ...synopsisData,
    source_chapters: chapterStructure,
    chapter_count: chapterStructure.total_chapters || synopsisData.chapter_count
  };
}
