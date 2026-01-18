/**
 * Gap Analyzer Agent (Pass 4)
 * Identifies missing information and infers details from context
 * Fills in gaps like gender from names, ages from descriptions, etc.
 */

import { logger } from '../../../utils/logger.js';

export async function analyzeGaps(extractedData, relationships, originalText, openai) {
  logger.info('[GapAnalyzer] Starting gap analysis');

  const { characters, world, locations, lore } = extractedData;

  // Identify characters with missing key fields
  const charactersWithGaps = characters.filter(c =>
    c.gender === 'unknown' ||
    c.age_group === 'unknown' ||
    !c.voice_description ||
    !c.appearance ||
    c.role === 'mentioned'
  );

  const locationsWithGaps = locations.filter(l =>
    !l.atmosphere ||
    !l.description ||
    l.confidence === 'low'
  );

  const systemPrompt = `You are a detail inference specialist. Given characters and locations with missing information, infer the most likely values based on:
1. Names (cultural associations, gender patterns)
2. Context from relationships and the story
3. Common tropes for the genre
4. Any clues from descriptions

IMPORTANT: Mark inferred values with confidence levels.

For each character needing details, provide:
- gender inference (from name patterns, pronouns in relationships, cultural context)
- age_group inference (from role, relationships - "mother of X" implies adult, etc.)
- voice_description (based on personality, age, gender, role)
- appearance inference (if any clues exist)
- role upgrade (if "mentioned" character seems more important)

For locations:
- atmosphere (based on description, events there, name connotations)
- type clarification

Return JSON:
{
  "character_inferences": [
    {
      "name": "character name",
      "inferred_fields": {
        "gender": { "value": "male|female|non-binary", "confidence": "high|medium|low", "reasoning": "why" },
        "age_group": { "value": "...", "confidence": "...", "reasoning": "..." },
        "voice_description": { "value": "...", "confidence": "...", "reasoning": "..." },
        "appearance": { "value": "...", "confidence": "...", "reasoning": "..." },
        "role": { "value": "...", "confidence": "...", "reasoning": "..." }
      }
    }
  ],
  "location_inferences": [
    {
      "name": "location name",
      "inferred_fields": {
        "atmosphere": { "value": "...", "confidence": "...", "reasoning": "..." },
        "location_type": { "value": "...", "confidence": "...", "reasoning": "..." }
      }
    }
  ],
  "world_enhancements": {
    "additional_themes": ["themes implied but not explicit"],
    "tone_clarification": "more specific tone description",
    "genre_additions": ["sub-genres detected"]
  },
  "synopsis_suggestion": {
    "title": "suggested story title based on content (REQUIRED)",
    "logline": "one compelling sentence that captures the story hook (REQUIRED)",
    "synopsis": "2-3 paragraph comprehensive summary of the story/content - include main characters, central conflict, setting, and key plot points (REQUIRED - do not skip this)"
  },
  "quality_assessment": {
    "completeness_score": number (0-100),
    "areas_lacking_detail": ["what's missing"],
    "high_confidence_items": number,
    "medium_confidence_items": number,
    "low_confidence_items": number
  }
}`;

  const userPrompt = `Analyze these extracted entities and fill in missing details:

WORLD:
${JSON.stringify(world, null, 2)}

CHARACTERS NEEDING DETAIL (${charactersWithGaps.length}):
${JSON.stringify(charactersWithGaps, null, 2)}

LOCATIONS NEEDING DETAIL (${locationsWithGaps.length}):
${JSON.stringify(locationsWithGaps, null, 2)}

KNOWN RELATIONSHIPS:
${JSON.stringify(relationships.character_relationships?.slice(0, 20) || [], null, 2)}

ORIGINAL TEXT SAMPLE (for context):
${originalText.substring(0, 15000)}

IMPORTANT: You MUST generate a complete synopsis_suggestion with title, logline, and a detailed 2-3 paragraph synopsis summarizing the story. This is required for the story bible.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14', // Most capable model for thorough extraction
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');

    logger.info(`[GapAnalyzer] Analysis complete - ${result.character_inferences?.length || 0} character inferences, ${result.location_inferences?.length || 0} location inferences`);

    return {
      success: true,
      inferences: {
        character_inferences: result.character_inferences || [],
        location_inferences: result.location_inferences || [],
        world_enhancements: result.world_enhancements || {},
        synopsis_suggestion: result.synopsis_suggestion || {}
      },
      quality_assessment: result.quality_assessment || {},
      tokens_used: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[GapAnalyzer] Analysis failed:', error);
    return {
      success: false,
      error: error.message,
      inferences: {
        character_inferences: [],
        location_inferences: [],
        world_enhancements: {},
        synopsis_suggestion: {}
      },
      quality_assessment: {}
    };
  }
}
