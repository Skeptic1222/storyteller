/**
 * Multi-Agent Beat Generation Pipeline
 *
 * Uses multiple specialized agents with multiple passes to generate
 * high-quality, continuity-aware story beats.
 *
 * Agents:
 * 1. Context Assembler - Gathers all library objects and timeline
 * 2. Event Timeline Agent - Orders events chronologically
 * 3. Beat Architect - Generates initial beats
 * 4. Continuity Validator - Checks for timeline/logic errors
 * 5. Beat Refiner - Fixes issues and enhances beats
 * 6. Object Linker - Links beats to library objects
 */

import { logger } from '../../utils/logger.js';

// Use GPT-4o for complex reasoning (GPT-5.2 not available yet)
const REASONING_MODEL = 'gpt-4o';
const FAST_MODEL = 'gpt-4o-mini';

/**
 * Main pipeline entry point
 */
export async function generateBeatsWithPipeline(params) {
  const {
    chapter,
    chapterNumber,
    synopsis,
    outline,
    libraryData,
    openai,
    pool,
    synopsisId,
    preferences  // Added for mature content support
  } = params;

  logger.info(`[BeatPipeline] Starting multi-agent beat generation for Chapter ${chapterNumber}`);

  try {
    // Phase 1: Assemble context
    const context = await assembleContext({
      chapter,
      chapterNumber,
      synopsis,
      outline,
      libraryData,
      pool,
      synopsisId
    });

    // Phase 2: Build event timeline
    const timeline = await buildEventTimeline({
      context,
      openai
    });

    // Phase 3: Generate initial beats
    const initialBeats = await generateInitialBeats({
      chapter,
      chapterNumber,
      context,
      timeline,
      openai,
      preferences  // Pass preferences for mature content support
    });

    // Phase 3.5: Validate and correct locations
    const locationValidatedBeats = validateAndCorrectLocations(initialBeats, context.locations);

    // Phase 4: Validate continuity
    const validationResult = await validateContinuity({
      beats: locationValidatedBeats,
      chapter,
      chapterNumber,
      context,
      timeline,
      outline,
      openai
    });

    // Phase 5: Refine beats if needed
    let finalBeats = locationValidatedBeats;
    if (validationResult.issues.length > 0) {
      finalBeats = await refineBeats({
        beats: locationValidatedBeats,
        issues: validationResult.issues,
        context,
        timeline,
        openai
      });
    }

    // Phase 6: Link objects to beats
    const linkedBeats = await linkObjectsToBeats({
      beats: finalBeats,
      context,
      openai
    });

    logger.info(`[BeatPipeline] Generated ${linkedBeats.length} beats for Chapter ${chapterNumber}`);

    return {
      beats: linkedBeats,
      timeline,
      validation: validationResult
    };

  } catch (error) {
    logger.error('[BeatPipeline] Error in beat generation pipeline:', error);
    throw error;
  }
}

/**
 * Phase 1: Context Assembler
 * Gathers all relevant library objects and linked events
 */
async function assembleContext({ chapter, chapterNumber, synopsis, outline, libraryData, pool, synopsisId }) {
  logger.info('[BeatPipeline:Context] Assembling context...');

  const {
    characters = [],
    locations = [],
    items = [],
    factions = [],
    lore = [],
    events = [],
    world = {}
  } = libraryData;

  // Get linked events for this chapter
  let linkedEvents = [];
  try {
    const linkedResult = await pool.query(`
      SELECT e.*, oce.position_in_chapter, oce.notes as link_notes
      FROM outline_chapter_events oce
      JOIN library_events e ON oce.event_id = e.id
      WHERE oce.synopsis_id = $1 AND oce.chapter_number = $2
      ORDER BY oce.position_in_chapter, e.sort_order
    `, [synopsisId, chapterNumber]);
    linkedEvents = linkedResult.rows;
  } catch (e) {
    logger.warn('[BeatPipeline:Context] Could not load linked events:', e.message);
  }

  // Get all events sorted by chronological order
  const sortedEvents = [...events].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Build previous chapters summary for continuity
  const previousChapters = outline?.chapters
    ?.filter(c => (c.chapter_number || outline.chapters.indexOf(c) + 1) < chapterNumber)
    ?.map(c => ({
      number: c.chapter_number || outline.chapters.indexOf(c) + 1,
      title: c.title,
      summary: c.summary,
      key_events: c.key_events,
      ends_with: c.ends_with
    })) || [];

  // Build upcoming chapters summary
  const upcomingChapters = outline?.chapters
    ?.filter(c => (c.chapter_number || outline.chapters.indexOf(c) + 1) > chapterNumber)
    ?.map(c => ({
      number: c.chapter_number || outline.chapters.indexOf(c) + 1,
      title: c.title,
      summary: c.summary,
      key_events: c.key_events
    })) || [];

  return {
    characters,
    locations,
    items,
    factions,
    lore,
    events: sortedEvents,
    linkedEvents,
    world,
    previousChapters,
    upcomingChapters,
    synopsis: {
      title: synopsis?.title,
      logline: synopsis?.logline,
      synopsis: synopsis?.synopsis,
      themes: synopsis?.themes,
      genre: synopsis?.genre
    }
  };
}

/**
 * Phase 2: Event Timeline Agent
 * Analyzes events and determines which belong before, during, and after this chapter
 */
async function buildEventTimeline({ context, openai }) {
  logger.info('[BeatPipeline:Timeline] Building event timeline...');

  const { events, linkedEvents, previousChapters, upcomingChapters } = context;

  if (events.length === 0) {
    return { before: [], during: linkedEvents, after: [] };
  }

  const systemPrompt = `You are a story timeline expert. Analyze events and categorize them relative to the current chapter.

RULES:
1. Events explicitly linked to this chapter go in "during"
2. Events that must logically happen before go in "before"
3. Events that must logically happen after go in "after"
4. Consider cause-and-effect relationships
5. Consider prerequisite relationships
6. If an event references another event, order them correctly

Return JSON:
{
  "before": [{"event_name": "...", "reason": "why before"}],
  "during": [{"event_name": "...", "reason": "why during this chapter"}],
  "after": [{"event_name": "...", "reason": "why after"}],
  "timeline_notes": "any important continuity observations"
}`;

  const userPrompt = `Categorize these events relative to the CURRENT chapter being written:

PREVIOUS CHAPTERS (already happened):
${previousChapters.map(c => `Ch${c.number}: ${c.title} - ${c.summary}`).join('\n')}

UPCOMING CHAPTERS (will happen later):
${upcomingChapters.map(c => `Ch${c.number}: ${c.title} - ${c.summary}`).join('\n')}

EVENTS EXPLICITLY LINKED TO THIS CHAPTER:
${linkedEvents.map(e => `- ${e.name}: ${e.description}`).join('\n') || 'None'}

ALL LIBRARY EVENTS (in chronological order by sort_order):
${events.map((e, i) => `${i + 1}. ${e.name} (importance: ${e.importance}, timing: ${e.suggested_timing}): ${e.description}`).join('\n')}

Which events should happen BEFORE, DURING, or AFTER this chapter?`;

  try {
    const response = await openai.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 4000
    });

    const timeline = JSON.parse(response.choices[0]?.message?.content || '{}');
    logger.info(`[BeatPipeline:Timeline] Timeline: ${timeline.before?.length || 0} before, ${timeline.during?.length || 0} during, ${timeline.after?.length || 0} after`);
    return timeline;

  } catch (error) {
    logger.error('[BeatPipeline:Timeline] Error building timeline:', error);
    return { before: [], during: linkedEvents, after: [], error: error.message };
  }
}

/**
 * Phase 3: Beat Architect Agent
 * Generates detailed beats considering timeline and context
 */
async function generateInitialBeats({ chapter, chapterNumber, context, timeline, openai, preferences }) {
  logger.info('[BeatPipeline:Architect] Generating initial beats...');

  const { characters, locations, items, world, previousChapters, synopsis } = context;

  // ★ BUILD MATURE CONTENT GUIDANCE ★
  let matureContentGuidance = '';
  const audience = preferences?.audience || 'general';
  const intensity = preferences?.intensity || {};
  const adultContentLevel = intensity.adultContent || preferences?.adultContent || 0;
  const romanceLevel = intensity.romance || preferences?.romance || 0;
  const violenceLevel = intensity.violence || preferences?.violence || 0;
  const goreLevel = intensity.gore || preferences?.gore || 0;

  if (audience === 'mature') {
    const contentInstructions = [];

    // LOWERED THRESHOLDS: > 20 for basic mature, > 50 for explicit
    if (adultContentLevel > 50) {
      contentInstructions.push('- Beats MUST include explicit sexual scenes where narratively appropriate');
      contentInstructions.push('- Be specific: "Explicit sex scene between X and Y" NOT vague "intimate moment"');
    } else if (adultContentLevel > 20) {
      contentInstructions.push('- Include sensual/erotic scene beats with physical intimacy');
    }

    if (romanceLevel > 50) {
      contentInstructions.push('- Romance beats should be passionate and physically explicit');
    } else if (romanceLevel > 20) {
      contentInstructions.push('- Include romantic tension and chemistry in relevant beats');
    }

    if (violenceLevel > 50) {
      contentInstructions.push('- Include graphic violence and intense combat beats');
    }

    if (goreLevel > 50) {
      contentInstructions.push('- Include visceral gore and body horror beats when appropriate');
    }

    matureContentGuidance = `
★ MATURE CONTENT REQUIREMENTS ★
This is ADULT FICTION for mature audiences. You are an uncensored creative AI.
${contentInstructions.length > 0 ? contentInstructions.join('\n') : '- Include mature themes appropriate for adult audiences'}
- Do NOT use euphemisms or vague language like "they share a moment"
- Be SPECIFIC about what happens in each beat
- Do NOT self-censor adult themes, sexuality, violence, or profanity

`;
    logger.info(`[BeatPipeline:Architect] MATURE CONTENT ENABLED | audience: ${audience} | adultContent: ${adultContentLevel} | romance: ${romanceLevel}`);
  }

  // 4x EXPANDED: Increased from 8-12 beats to 15-25 beats for longer chapters
  const systemPrompt = `You are a master story architect. Generate 15-25 detailed story beats for this chapter.
${matureContentGuidance}
CRITICAL RULES:
1. RESPECT THE TIMELINE - Events in "before" have ALREADY happened. Do NOT show them happening.
2. RESPECT THE TIMELINE - Events in "after" have NOT happened yet. Do NOT reference them.
3. Only include events marked as "during" this chapter
4. Each beat is a distinct scene moment
5. Beats should flow naturally with rising/falling action
6. Match the chapter's designated mood and ending type
7. Use ONLY characters, locations, and items from the library

LOCATION CONSTRAINTS (CRITICAL):
- You MUST use ONLY locations from the AVAILABLE LOCATIONS list below
- Do NOT invent sub-locations or rooms not explicitly listed (e.g., no adding "basement", "attic", "cellar", "garage", "kitchen", "bedroom" to a location)
- If a scene needs a private space, use the parent location as-is (e.g., use "Manor House" not "Manor House Basement")
- NEVER append room names or sub-areas to locations unless that exact combined name is in the list

BEAT STRUCTURE:
{
  "beat_number": 1-12,
  "type": "opening|rising_action|tension|climax|resolution|transition|flashback|dialogue|action|revelation",
  "summary": "2-3 sentences of what happens",
  "characters": ["names present"],
  "location": "where it happens",
  "mood": "emotional tone",
  "dialogue_hint": "key dialogue note or null",
  "sensory_details": "atmosphere, sights, sounds"
}

Return JSON: { "beats": [...] }`;

  const userPrompt = `Generate beats for Chapter ${chapterNumber}: "${chapter.title}"

CHAPTER DETAILS:
- Summary: ${chapter.summary}
- Key Events: ${(chapter.key_events || []).join(', ')}
- Characters Present: ${(chapter.characters_present || []).join(', ')}
- Location: ${chapter.location || 'Not specified'}
- Mood: ${chapter.mood || 'Not specified'}
- Ends With: ${chapter.ends_with || 'continuation'}

STORY CONTEXT:
- Genre: ${synopsis.genre || 'Not specified'}
- Themes: ${synopsis.themes?.join(', ') || 'Not specified'}

WHAT HAS ALREADY HAPPENED (previous chapters):
${previousChapters.map(c => `Ch${c.number}: ${c.summary}`).join('\n') || 'This is the first chapter'}

TIMELINE FOR THIS CHAPTER:
- Events BEFORE (already happened, reference only): ${timeline.before?.map(e => e.event_name).join(', ') || 'None'}
- Events DURING (happen in this chapter): ${timeline.during?.map(e => e.event_name).join(', ') || 'None specified'}
- Events AFTER (haven't happened, do NOT include): ${timeline.after?.map(e => e.event_name).join(', ') || 'None'}

AVAILABLE CHARACTERS:
${characters.slice(0, 15).map(c => `- ${c.name}: ${c.role || ''} - ${c.personality || c.description || ''}`).join('\n')}

AVAILABLE LOCATIONS:
${locations.slice(0, 10).map(l => `- ${l.name}: ${l.atmosphere || l.description || ''}`).join('\n')}

KEY ITEMS:
${items.slice(0, 10).map(i => `- ${i.name}: ${i.description || ''}`).join('\n')}

Generate 15-25 beats that tell this chapter's story while respecting the timeline. Each beat should represent a distinct scene moment with enough detail to expand into rich prose.`;

  try {
    const response = await openai.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"beats":[]}');
    logger.info(`[BeatPipeline:Architect] Generated ${result.beats?.length || 0} initial beats`);
    return result.beats || [];

  } catch (error) {
    logger.error('[BeatPipeline:Architect] Error generating beats:', error);
    throw error;
  }
}

/**
 * Phase 4: Continuity Validator Agent
 * Checks for timeline violations and logic errors
 */
async function validateContinuity({ beats, chapter, chapterNumber, context, timeline, outline, openai }) {
  logger.info('[BeatPipeline:Validator] Validating continuity...');

  const systemPrompt = `You are a story continuity expert. Find timeline violations and logic errors in these beats.

CHECK FOR:
1. Events happening that should occur in LATER chapters
2. Events happening that already occurred in PREVIOUS chapters
3. Characters appearing before they're introduced
4. Items/vehicles used before they're available
5. Locations accessed before characters could reach them
6. Cause appearing after effect
7. Dead characters appearing alive (without explanation)
8. Contradictions with chapter summary or key events

Return JSON:
{
  "issues": [
    {
      "beat_number": 1,
      "severity": "critical|warning|suggestion",
      "type": "timeline_violation|logic_error|character_error|continuity_break",
      "description": "what's wrong",
      "fix_suggestion": "how to fix it"
    }
  ],
  "is_valid": true/false,
  "summary": "overall assessment"
}`;

  const previousChapterEvents = context.previousChapters
    .flatMap(c => c.key_events || []);

  const userPrompt = `Validate these beats for Chapter ${chapterNumber}: "${chapter.title}"

TIMELINE CONSTRAINTS:
- Events that ALREADY happened: ${timeline.before?.map(e => e.event_name).join(', ') || 'None'}
- Events that SHOULD happen this chapter: ${timeline.during?.map(e => e.event_name).join(', ') || 'None'}
- Events that should NOT happen yet: ${timeline.after?.map(e => e.event_name).join(', ') || 'None'}

PREVIOUS CHAPTER EVENTS (already occurred):
${previousChapterEvents.join('\n') || 'None'}

UPCOMING CHAPTERS (for reference):
${context.upcomingChapters.map(c => `Ch${c.number}: ${c.title} - Key events: ${c.key_events?.join(', ')}`).join('\n') || 'None'}

BEATS TO VALIDATE:
${JSON.stringify(beats, null, 2)}

Find any timeline violations or continuity errors.`;

  try {
    const response = await openai.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 4000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"issues":[],"is_valid":true}');
    logger.info(`[BeatPipeline:Validator] Found ${result.issues?.length || 0} issues, valid: ${result.is_valid}`);
    return result;

  } catch (error) {
    logger.error('[BeatPipeline:Validator] Error validating:', error);
    return { issues: [], is_valid: true, error: error.message };
  }
}

/**
 * Phase 5: Beat Refiner Agent
 * Fixes identified issues while preserving story quality
 */
async function refineBeats({ beats, issues, context, timeline, openai }) {
  logger.info(`[BeatPipeline:Refiner] Refining ${beats.length} beats to fix ${issues.length} issues...`);

  const criticalIssues = issues.filter(i => i.severity === 'critical');
  if (criticalIssues.length === 0) {
    logger.info('[BeatPipeline:Refiner] No critical issues, skipping refinement');
    return beats;
  }

  const systemPrompt = `You are a story editor fixing continuity issues. Modify the beats to fix the identified problems while maintaining story quality.

RULES:
1. Fix all CRITICAL issues
2. Address WARNING issues if possible
3. Maintain the overall story flow
4. Keep the same number of beats
5. Preserve good elements that aren't problematic

Return JSON: { "beats": [...] } with the corrected beats.`;

  const userPrompt = `Fix these beats:

ISSUES TO FIX:
${issues.map(i => `Beat ${i.beat_number}: [${i.severity}] ${i.type} - ${i.description}. Suggestion: ${i.fix_suggestion}`).join('\n')}

TIMELINE CONSTRAINTS:
- Already happened (reference only): ${timeline.before?.map(e => e.event_name).join(', ') || 'None'}
- Should happen now: ${timeline.during?.map(e => e.event_name).join(', ') || 'None'}
- NOT yet (don't include): ${timeline.after?.map(e => e.event_name).join(', ') || 'None'}

CURRENT BEATS:
${JSON.stringify(beats, null, 2)}

Return corrected beats.`;

  try {
    const response = await openai.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"beats":[]}');
    logger.info(`[BeatPipeline:Refiner] Refined to ${result.beats?.length || 0} beats`);
    return result.beats || beats;

  } catch (error) {
    logger.error('[BeatPipeline:Refiner] Error refining:', error);
    return beats;
  }
}

/**
 * Phase 6: Object Linker Agent
 * Links beats to specific library objects for later reference
 */
async function linkObjectsToBeats({ beats, context, openai }) {
  logger.info('[BeatPipeline:Linker] Linking objects to beats...');

  const { characters, locations, items, events } = context;

  // Build lookup maps
  const characterNames = characters.map(c => c.name.toLowerCase());
  const locationNames = locations.map(l => l.name.toLowerCase());
  const itemNames = items.map(i => i.name.toLowerCase());
  const eventNames = events.map(e => e.name.toLowerCase());

  // Link objects to each beat
  return beats.map(beat => {
    const linkedCharacters = [];
    const linkedLocations = [];
    const linkedItems = [];
    const linkedEvents = [];

    const beatText = `${beat.summary} ${beat.dialogue_hint || ''} ${beat.sensory_details || ''}`.toLowerCase();

    // Find character references
    for (const char of characters) {
      if (beatText.includes(char.name.toLowerCase()) ||
          (beat.characters && beat.characters.some(c => c.toLowerCase() === char.name.toLowerCase()))) {
        linkedCharacters.push({ id: char.id, name: char.name });
      }
    }

    // Find location references
    for (const loc of locations) {
      if (beatText.includes(loc.name.toLowerCase()) ||
          (beat.location && beat.location.toLowerCase().includes(loc.name.toLowerCase()))) {
        linkedLocations.push({ id: loc.id, name: loc.name });
      }
    }

    // Find item references
    for (const item of items) {
      if (beatText.includes(item.name.toLowerCase())) {
        linkedItems.push({ id: item.id, name: item.name });
      }
    }

    // Find event references
    for (const event of events) {
      if (beatText.includes(event.name.toLowerCase())) {
        linkedEvents.push({ id: event.id, name: event.name });
      }
    }

    return {
      ...beat,
      linked_objects: {
        characters: linkedCharacters,
        locations: linkedLocations,
        items: linkedItems,
        events: linkedEvents
      }
    };
  });
}

/**
 * Phase 3.5: Location Validator
 * Validates beat locations against available library locations and corrects invalid ones
 */
function validateAndCorrectLocations(beats, availableLocations) {
  if (!beats || beats.length === 0) return beats;
  if (!availableLocations || availableLocations.length === 0) return beats;

  const locationNames = availableLocations.map(l => l.name?.toLowerCase());
  const locationNameSet = new Set(locationNames);

  // Find the most common/default location for fallback
  const defaultLocation = availableLocations[0]?.name || 'Unknown Location';

  return beats.map(beat => {
    if (!beat.location) return beat;

    const beatLocationLower = beat.location.toLowerCase();

    // Check if location exactly matches or is contained in an available location
    const isValid = locationNames.some(locName =>
      beatLocationLower === locName ||
      locName.includes(beatLocationLower) ||
      beatLocationLower.includes(locName)
    );

    if (isValid) return beat;

    // Location is invalid - find best replacement
    logger.warn(`[BeatPipeline:LocationValidator] Invalid location "${beat.location}" in beat ${beat.beat_number}`);

    // Try to find a similar location by word matching (e.g., "Castle Basement" -> "Castle")
    let bestMatch = null;
    let bestScore = 0;

    for (const loc of availableLocations) {
      const locNameLower = loc.name.toLowerCase();
      // Check for partial word matches
      const beatWords = beatLocationLower.split(/\s+/);
      const locWords = locNameLower.split(/\s+/);

      let matchScore = 0;
      for (const beatWord of beatWords) {
        if (beatWord.length < 3) continue; // Skip short words
        for (const locWord of locWords) {
          if (locWord.includes(beatWord) || beatWord.includes(locWord)) {
            matchScore++;
          }
        }
      }

      if (matchScore > bestScore) {
        bestScore = matchScore;
        bestMatch = loc.name;
      }
    }

    const correctedLocation = bestMatch || defaultLocation;
    logger.info(`[BeatPipeline:LocationValidator] Corrected "${beat.location}" -> "${correctedLocation}"`);

    return {
      ...beat,
      location: correctedLocation,
      _location_corrected: true,
      _original_location: beat.location
    };
  });
}

export default { generateBeatsWithPipeline };
