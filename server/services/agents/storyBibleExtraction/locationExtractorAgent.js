/**
 * Location Extractor Agent (Pass 2c)
 * Extracts all locations with hierarchical relationships
 */

import { logger } from '../../../utils/logger.js';

export async function extractLocations(text, documentAnalysis, openai) {
  logger.info('[LocationExtractor] Starting location extraction');

  const hints = documentAnalysis?.extraction_hints || {};

  const systemPrompt = `You are an expert location analyst. Extract EVERY location mentioned in the text, from planets to individual rooms.

For each location, identify:
- name: The location's name
- location_type: planet/continent/country/region/city/town/village/district/neighborhood/building/floor/room/wilderness/landmark/vehicle/other
- description: What it looks/feels like
- atmosphere: The mood or feeling of this place
- parent_name: Name of the containing location (if any) - e.g., "Hogwarts" is parent of "Great Hall"
- significance: Why this place matters to the story
- features: Notable features or characteristics
- associated_characters: Characters who live/work/frequent here
- events_here: Important events that happen at this location

${hints.location_format === 'hierarchical' ? 'Note: Locations appear to be organized hierarchically - pay attention to containment relationships.' : ''}

Extract EVERY location mentioned, including:
- Named places (cities, countries, buildings)
- Unnamed but described places ("the dark forest", "a small cottage")
- Abstract locations ("the spirit realm", "cyberspace")
- Vehicles or mobile locations ("the ship", "the caravan")

Return JSON:
{
  "locations": [
    {
      "name": "string (required)",
      "location_type": "planet|continent|country|region|city|town|village|district|neighborhood|building|floor|room|wilderness|landmark|vehicle|other",
      "description": "string",
      "atmosphere": "string describing the feel/mood",
      "parent_name": "string or null - name of containing location",
      "significance": "string or null",
      "features": ["notable features"],
      "associated_characters": ["character names who are connected to this place"],
      "events_here": ["important events"],
      "is_real_world": boolean,
      "coordinates_mentioned": "any specific location details",
      "confidence": "high|medium|low"
    }
  ],
  "location_hierarchy_notes": "observations about how locations relate to each other",
  "unmapped_references": ["location references that couldn't be clearly identified"]
}`;

  const userPrompt = `Extract ALL locations from this text:\n\n${text.substring(0, 40000)}`;

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

    const result = JSON.parse(response.choices[0]?.message?.content || '{"locations":[]}');

    logger.info(`[LocationExtractor] Extraction complete - Found ${result.locations?.length || 0} locations`);

    return {
      success: true,
      locations: result.locations || [],
      tokens_used: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[LocationExtractor] Extraction failed:', error);
    return {
      success: false,
      error: error.message,
      locations: []
    };
  }
}
