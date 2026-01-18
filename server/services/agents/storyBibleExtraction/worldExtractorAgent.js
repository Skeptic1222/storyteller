/**
 * World/Setting Extractor Agent (Pass 2b)
 * Extracts world-building details: genre, time period, magic systems, technology
 */

import { logger } from '../../../utils/logger.js';

export async function extractWorld(text, documentAnalysis, openai) {
  logger.info('[WorldExtractor] Starting world extraction');

  const systemPrompt = `You are an expert world-builder analyst. Extract ALL world and setting information from the text.

Focus on:
- Overall setting and atmosphere
- Time period (historical, modern, future, fantasy era)
- Technology level and notable technologies
- Magic or supernatural systems (if any)
- Society structure and governance
- Cultural elements
- Economic systems
- Religious or spiritual elements
- Physical laws or unique physics
- Climate and environmental factors
- Tone and mood of the world

Be comprehensive. Even small details matter for world-building.

Return JSON:
{
  "world": {
    "name": "world/setting name if mentioned, or descriptive name",
    "description": "comprehensive description of the setting",
    "genre": "fantasy|sci-fi|contemporary|historical|horror|romance|thriller|mystery|western|post-apocalyptic|steampunk|cyberpunk|other",
    "sub_genres": ["array of additional genre elements"],
    "time_period": "when the story takes place",
    "technology_level": "description of technology available",
    "technologies": ["specific technologies mentioned"],
    "magic_system": "description of magic if present, or null",
    "magic_rules": ["specific rules or limitations of magic"],
    "society_structure": "how society is organized",
    "governments": ["types of government or ruling bodies"],
    "cultures": ["distinct cultures or peoples mentioned"],
    "religions": ["religious or spiritual systems"],
    "economy": "economic system description",
    "tone": "dark|light|gritty|whimsical|serious|comedic|mixed",
    "mood": "overall emotional atmosphere",
    "themes": ["major themes present"],
    "visual_style": "how the world should look/feel visually",
    "unique_elements": ["things that make this world distinct"],
    "world_rules": ["any established rules or constants"],
    "conflicts": ["major world-level conflicts or tensions"]
  },
  "extraction_notes": "observations about the world-building"
}`;

  const userPrompt = `Extract all world-building and setting information from this text:\n\n${text.substring(0, 40000)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14', // Most capable model for thorough extraction
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');

    logger.info(`[WorldExtractor] Extraction complete - Genre: ${result.world?.genre || 'unknown'}`);

    return {
      success: true,
      world: result.world || {},
      tokens_used: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[WorldExtractor] Extraction failed:', error);
    return {
      success: false,
      error: error.message,
      world: {}
    };
  }
}
