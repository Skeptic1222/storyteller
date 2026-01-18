/**
 * Event Extractor Agent (Pass 2g)
 * Extracts PLANNED STORY EVENTS - scenes, confrontations, revelations that SHOULD happen
 *
 * CRITICAL DISTINCTION:
 * - EVENTS = Things that SHOULD/WILL happen (future/planned moments in the story)
 * - LORE = Things that HAVE happened (past/history/backstory)
 *
 * Examples:
 * - "A fight breaks out in the park" → EVENT (planned scene)
 * - "The Battle of 1042" → LORE (historical)
 * - "Shannon escapes via gyrocopter" → EVENT (planned action)
 * - "Shannon was born in Texas" → LORE (backstory)
 */

import { logger } from '../../../utils/logger.js';

/**
 * Attempts to recover valid JSON from a truncated response
 */
function tryRecoverJSON(rawContent, entityKey = 'events') {
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    // Continue to recovery attempts
  }

  let content = rawContent.trim();

  const entitiesStart = content.indexOf(`"${entityKey}"`);
  if (entitiesStart === -1) {
    logger.warn(`[EventExtractor] No ${entityKey} array found in response`);
    return { [entityKey]: [] };
  }

  const arrayStart = content.indexOf('[', entitiesStart);
  if (arrayStart === -1) {
    return { [entityKey]: [] };
  }

  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteObjectEnd = arrayStart;

  for (let i = arrayStart; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '[' || char === '{') {
      bracketCount++;
    } else if (char === ']' || char === '}') {
      bracketCount--;
      if (char === '}' && bracketCount === 1) {
        lastCompleteObjectEnd = i;
      }
    }
  }

  if (bracketCount === 0) {
    try {
      return JSON.parse(content);
    } catch (e) {
      // Continue to truncation fix
    }
  }

  if (lastCompleteObjectEnd > arrayStart) {
    const truncatedContent = content.substring(0, lastCompleteObjectEnd + 1) + ']}';
    try {
      const result = JSON.parse(truncatedContent);
      logger.info(`[EventExtractor] Recovered ${result[entityKey]?.length || 0} events from truncated JSON`);
      return result;
    } catch (e) {
      // Continue
    }
  }

  const events = [];
  const eventPattern = /\{(?:[^{}]|\{[^{}]*\})*"name"\s*:\s*"[^"]+(?:[^{}]|\{[^{}]*\})*\}/g;
  const eventMatches = content.match(eventPattern) || [];

  for (const match of eventMatches) {
    try {
      const event = JSON.parse(match);
      if (event.name) {
        events.push(event);
      }
    } catch (e) {
      // Skip unparseable event
    }
  }

  if (events.length > 0) {
    logger.info(`[EventExtractor] Recovered ${events.length} events via pattern extraction`);
    return { events };
  }

  logger.error('[EventExtractor] Could not recover any events from malformed JSON');
  return { events: [] };
}

export async function extractEvents(text, documentAnalysis, openai) {
  logger.info('[EventExtractor] Starting event extraction');

  const hints = documentAnalysis?.extraction_hints || {};
  const documentType = documentAnalysis?.document_type || 'unknown';

  const systemPrompt = `You are an EXHAUSTIVELY THOROUGH event extraction specialist. Your mission is to extract EVERY PLANNED STORY MOMENT, SCENE, CONFRONTATION, and ACTION that should occur during the story.

## CRITICAL DISTINCTION - READ CAREFULLY

**EVENTS are PLANNED MOMENTS** - things that SHOULD or WILL happen during the story:
- "A fight breaks out in the park" → EVENT
- "Shannon escapes via gyrocopter" → EVENT
- "The villain reveals their true identity" → EVENT
- "A tense chase through the warehouse district" → EVENT
- "The hero confronts their mentor" → EVENT

**LORE is HISTORY** - things that HAVE ALREADY happened before the story:
- "The Great War of 1042" → LORE (not an event)
- "Shannon was born in Texas" → LORE (not an event)
- "The kingdom fell 100 years ago" → LORE (not an event)

Only extract EVENTS - planned future scenes, confrontations, revelations, battles, escapes, discoveries.

## WHAT TO EXTRACT

Look for:
1. **Planned Scenes** - "There should be a scene where..."
2. **Confrontations** - Any meeting, argument, fight between characters
3. **Revelations** - Secrets revealed, truth discovered, identity exposed
4. **Action Sequences** - Chases, battles, escapes, heists
5. **Emotional Moments** - Reunions, betrayals, sacrifices, confessions
6. **Plot Turns** - Major changes in direction, surprising developments
7. **Discovery Events** - Finding something, learning something
8. **Transformation Events** - Character changes, power awakening

## REQUIRED FIELDS FOR EACH EVENT

**CORE IDENTITY:**
- name: Short, descriptive name for the event (e.g., "Park Confrontation", "Gyrocopter Escape", "Identity Reveal")
- description: Detailed description of what should happen in this event (2-4 sentences minimum)

**CLASSIFICATION:**
- event_type: One of: action, confrontation, revelation, emotional, transition, discovery, chase, escape, battle, reunion, betrayal, sacrifice, transformation
- importance:
  - "major" = MUST happen in the story, critical to plot
  - "supporting" = SHOULD happen, enhances story significantly
  - "minor" = Nice to have, adds flavor

**PARTICIPANTS:**
- characters_involved: Array of character names who participate
- factions_involved: Array of faction/group names involved (if any)

**LOCATION:**
- location_name: Where this event takes place (if specified)
- location_notes: Additional location details or requirements ("somewhere isolated", "in a public place")

**TIMING:**
- suggested_timing: When this should occur - "early", "middle", "climax", "resolution", "any"
- event_year: If a specific year is mentioned or implied (e.g., 2024, 2028), extract it as a number. CRITICAL for timeline accuracy.
- event_date: If a more specific date is mentioned (e.g., "October 14, 2028"), extract as "YYYY-MM-DD" format
- chronological_position: If the event's order in the timeline is clear, indicate: "first", "second", "third", etc. or "before_X", "after_X"
- explicit_sequence: If the document provides a numbered sequence (e.g., "Chapter 3", "Event #5"), extract the number
- prerequisites: Array of things that must happen before this event
- consequences: Array of things this event leads to or enables

**STORY IMPACT:**
- emotional_tone: The feeling of the scene - tense, triumphant, tragic, hopeful, terrifying, bittersweet, etc.
- stakes: What's at risk during this event
- conflict_type: physical, verbal, internal, supernatural, political, social

**DETAILS:**
- key_elements: Array of specific things that MUST be part of this event
- dialogue_hints: Any specific lines, exchanges, or conversation topics
- visual_details: Important imagery, settings details, atmosphere

**METADATA:**
- confidence: How confident you are this is meant to be a story event - high/medium/low
- extraction_notes: Any notes about how/where you found this event
- tags: Array of relevant tags for categorization

## EXTRACTION GUIDELINES

1. **Be thorough** - Extract EVERY potential event, even if not fully described
2. **Infer when reasonable** - If the text implies an event should happen, extract it
3. **Don't duplicate** - If the same event is mentioned multiple times, combine into one entry
4. **Note uncertainty** - Use confidence level and extraction_notes to flag uncertain extractions
5. **Rich descriptions** - Write detailed descriptions that capture the essence of the event

## OUTPUT FORMAT

Return valid JSON:
{
  "events": [
    {
      "name": "Event name",
      "description": "Detailed description",
      "event_type": "confrontation",
      "importance": "major",
      "characters_involved": ["Character A", "Character B"],
      "factions_involved": [],
      "location_name": "The Park",
      "location_notes": "At night, isolated area",
      "suggested_timing": "middle",
      "event_year": 2028,
      "event_date": "2028-10-14",
      "chronological_position": "after_discovery",
      "explicit_sequence": 5,
      "prerequisites": ["Character A learns the truth"],
      "consequences": ["Character B flees the city"],
      "emotional_tone": "tense",
      "stakes": "Character A's trust",
      "conflict_type": "physical",
      "key_elements": ["The hidden weapon", "The revelation"],
      "dialogue_hints": "Accusation of betrayal",
      "visual_details": "Dark park, streetlights flickering",
      "confidence": "high",
      "extraction_notes": "Explicitly described as a planned scene",
      "tags": ["action", "confrontation", "betrayal"]
    }
  ]
}

Remember: Extract FUTURE/PLANNED events, NOT historical events or backstory.`;

  const userPrompt = `Analyze this document and extract ALL PLANNED STORY EVENTS. Look for scenes, confrontations, revelations, action sequences, and key moments that SHOULD happen during the story. Do NOT extract historical events or backstory - only future/planned moments.

Document Type: ${documentType}

${text.substring(0, 100000)}`;

  try {
    // UPGRADED: Using gpt-4.1-2025-04-14 for thorough event extraction
    // gpt-4o-mini was missing critical events like Park Assault, Keedy's, etc.
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 16000,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      logger.warn('[EventExtractor] Empty response from OpenAI');
      return { events: [], tokens_used: response.usage?.total_tokens || 0 };
    }

    const result = tryRecoverJSON(content);
    const events = result.events || [];

    // Post-process events
    const processedEvents = events.map(event => ({
      name: event.name || 'Unnamed Event',
      description: event.description || '',
      event_type: event.event_type || 'action',
      importance: event.importance || 'supporting',
      characters_involved: Array.isArray(event.characters_involved) ? event.characters_involved : [],
      factions_involved: Array.isArray(event.factions_involved) ? event.factions_involved : [],
      location_name: event.location_name || null,
      location_notes: event.location_notes || null,
      suggested_timing: event.suggested_timing || 'any',
      // Timeline fields for chronological ordering (CRITICAL for accurate story sequencing)
      event_year: event.event_year ? parseInt(event.event_year) : null,
      event_date: event.event_date || null,
      chronological_position: event.chronological_position || null,
      explicit_sequence: event.explicit_sequence ? parseInt(event.explicit_sequence) : null,
      prerequisites: Array.isArray(event.prerequisites) ? event.prerequisites : [],
      consequences: Array.isArray(event.consequences) ? event.consequences : [],
      emotional_tone: event.emotional_tone || null,
      stakes: event.stakes || null,
      conflict_type: event.conflict_type || null,
      key_elements: Array.isArray(event.key_elements) ? event.key_elements : [],
      dialogue_hints: event.dialogue_hints || null,
      visual_details: event.visual_details || null,
      confidence: event.confidence || 'medium',
      extraction_notes: event.extraction_notes || null,
      tags: Array.isArray(event.tags) ? event.tags : []
    }));

    logger.info(`[EventExtractor] Extracted ${processedEvents.length} events`);

    // Log breakdown by importance
    const major = processedEvents.filter(e => e.importance === 'major').length;
    const supporting = processedEvents.filter(e => e.importance === 'supporting').length;
    const minor = processedEvents.filter(e => e.importance === 'minor').length;
    logger.info(`[EventExtractor] Breakdown: ${major} major, ${supporting} supporting, ${minor} minor`);

    return {
      events: processedEvents,
      tokens_used: response.usage?.total_tokens || 0
    };

  } catch (error) {
    logger.error('[EventExtractor] Error extracting events:', error);
    return { events: [], tokens_used: 0 };
  }
}
