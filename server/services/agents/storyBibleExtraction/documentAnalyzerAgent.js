/**
 * Document Analyzer Agent (Pass 1)
 * Analyzes document structure and identifies content types
 * Provides guidance for specialized extraction agents
 */

import { logger } from '../../../utils/logger.js';

export async function analyzeDocument(text, openai) {
  logger.info('[DocumentAnalyzer] Starting document analysis');

  const systemPrompt = `You are a document structure analyst. Analyze the given text and identify:
1. Document type (novel excerpt, character sheet, D&D campaign, worldbuilding notes, outline, mixed)
2. Sections present and their approximate locations
3. Content density for each type (characters, locations, lore, plot)
4. Writing style and format clues
5. Potential extraction challenges

Return JSON:
{
  "document_type": "string",
  "estimated_word_count": number,
  "sections": [
    {
      "type": "characters|locations|lore|plot|dialogue|description|mixed",
      "start_hint": "first few words of section",
      "content_density": "high|medium|low",
      "notes": "any special considerations"
    }
  ],
  "content_estimates": {
    "characters": { "count": number, "detail_level": "detailed|moderate|sparse" },
    "locations": { "count": number, "detail_level": "detailed|moderate|sparse" },
    "lore_entries": { "count": number, "detail_level": "detailed|moderate|sparse" },
    "relationships": { "count": number, "explicit": boolean }
  },
  "extraction_hints": {
    "character_naming_style": "full_names|first_names|nicknames|titles|mixed",
    "location_format": "hierarchical|flat|embedded",
    "has_explicit_sections": boolean,
    "dialogue_heavy": boolean,
    "contains_stats": boolean
  },
  "warnings": ["any potential issues or ambiguities"]
}`;

  const userPrompt = `Analyze this document and provide extraction guidance:\n\n${text.substring(0, 15000)}${text.length > 15000 ? '\n\n[Document truncated for analysis - full text is ' + text.length + ' characters]' : ''}`;

  try {
    // UPGRADED: Using gpt-4.1-2025-04-14 for better document analysis
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 4000
    });

    const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');

    logger.info(`[DocumentAnalyzer] Analysis complete - Type: ${analysis.document_type}, Estimated characters: ${analysis.content_estimates?.characters?.count || 0}`);

    return {
      success: true,
      analysis,
      tokens_used: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[DocumentAnalyzer] Analysis failed:', error);
    return {
      success: false,
      error: error.message,
      analysis: {
        document_type: 'unknown',
        content_estimates: {
          characters: { count: 0, detail_level: 'sparse' },
          locations: { count: 0, detail_level: 'sparse' },
          lore_entries: { count: 0, detail_level: 'sparse' },
          relationships: { count: 0, explicit: false }
        },
        extraction_hints: {},
        warnings: ['Document analysis failed - using default extraction']
      }
    };
  }
}
