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
import { getCreativeModel, getUtilityModel } from '../modelSelection.js';

// QUALITY FIX (2026-01-31): Use tier-based model selection instead of hardcoded models.
// Previously hardcoded to GPT-4o which is 2 generations behind GPT-5.2.
// Beat generation is a CREATIVE task that directly impacts story quality.
const getReasoningModel = () => getCreativeModel();  // GPT-5.2 for premium tier
const getFastModel = () => getUtilityModel();         // GPT-5-mini for utility tasks

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
    preferences,  // Added for mature content support
    previousChapterState  // MEDIUM-11: Previous chapter's final state for cross-chapter validation
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

    // Phase 4: Validate continuity (within-chapter)
    const validationResult = await validateContinuity({
      beats: locationValidatedBeats,
      chapter,
      chapterNumber,
      context,
      timeline,
      outline,
      openai
    });

    // Phase 4.5: MEDIUM-11 - Cross-chapter continuity validation
    const crossChapterIssues = validateCrossChapterContinuity({
      previousChapterState,
      beats: locationValidatedBeats,
      context,
      chapterNumber
    });

    // Merge cross-chapter issues into validation result
    if (crossChapterIssues.length > 0) {
      validationResult.issues = [...(validationResult.issues || []), ...crossChapterIssues];
      validationResult.cross_chapter_validation = {
        issues_found: crossChapterIssues.length,
        issues: crossChapterIssues
      };
      // Mark as invalid if there are critical cross-chapter issues
      const hasCriticalCrossChapter = crossChapterIssues.some(i => i.severity === 'critical');
      if (hasCriticalCrossChapter) {
        validationResult.is_valid = false;
      }
      logger.warn(`[BeatPipeline] Cross-chapter validation found ${crossChapterIssues.length} issues (${crossChapterIssues.filter(i => i.severity === 'critical').length} critical)`);
    }

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

    // MEDIUM-11: Extract final state for cross-chapter validation of subsequent chapters
    const chapterFinalState = extractChapterFinalState(linkedBeats, context, chapterNumber);

    return {
      beats: linkedBeats,
      timeline,
      validation: validationResult,
      chapterFinalState  // MEDIUM-11: Include for cross-chapter continuity
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
      model: getReasoningModel(),
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
      model: getReasoningModel(),
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
 * HIGH-3 FIX: Character Introduction Validator
 * Validates that characters are properly introduced before performing actions
 * @param {Array} beats - The story beats to validate
 * @param {Object} context - Context including characters and previous chapters
 * @param {number} chapterNumber - Current chapter number
 * @returns {Array} Array of introduction issues found
 */
function validateCharacterIntroductions(beats, context, chapterNumber) {
  const issues = [];
  const { characters, previousChapters } = context;

  // Build set of characters already introduced in previous chapters
  const introducedCharacters = new Set();

  // Characters mentioned in previous chapter summaries/events are considered introduced
  for (const prevChapter of previousChapters) {
    const chapterText = `${prevChapter.summary || ''} ${(prevChapter.key_events || []).join(' ')}`.toLowerCase();
    for (const char of characters) {
      if (chapterText.includes(char.name.toLowerCase())) {
        introducedCharacters.add(char.name.toLowerCase());
      }
    }
  }

  // For Chapter 1, only main/protagonist characters are pre-introduced
  if (chapterNumber === 1) {
    for (const char of characters) {
      const role = (char.role || '').toLowerCase();
      if (role.includes('protagonist') || role.includes('main') || role.includes('narrator')) {
        introducedCharacters.add(char.name.toLowerCase());
      }
    }
  }

  logger.info(`[BeatPipeline:CharacterValidator] Pre-introduced characters: ${[...introducedCharacters].join(', ') || 'none'}`);

  // Track introduction beats within this chapter
  const introductionBeats = new Map(); // character -> beat number where introduced

  // Analyze each beat
  for (const beat of beats) {
    const beatChars = (beat.characters || []).map(c => c.toLowerCase());
    const beatText = `${beat.summary || ''} ${beat.dialogue_hint || ''}`.toLowerCase();
    const beatType = (beat.type || '').toLowerCase();

    // Check if this beat introduces new characters
    const isIntroductionBeat = beatType === 'opening' ||
      beatText.includes('introduc') ||
      beatText.includes('first meet') ||
      beatText.includes('first see') ||
      beatText.includes('encounter') ||
      beatText.includes('arrives') ||
      beatText.includes('enters') ||
      beatText.includes('appears for the first time');

    for (const charName of beatChars) {
      // Skip if already introduced
      if (introducedCharacters.has(charName)) continue;

      // Check if this beat could serve as introduction
      if (isIntroductionBeat || beatText.includes(charName)) {
        // This beat introduces the character
        introducedCharacters.add(charName);
        introductionBeats.set(charName, beat.beat_number);
        logger.debug(`[BeatPipeline:CharacterValidator] Character "${charName}" introduced in beat ${beat.beat_number}`);
      } else {
        // Character appears but wasn't introduced - this is an issue
        issues.push({
          beat_number: beat.beat_number,
          severity: 'warning',
          type: 'character_introduction_missing',
          description: `Character "${charName}" appears in beat ${beat.beat_number} but hasn't been introduced yet. First appearance should include an introduction.`,
          fix_suggestion: `Either add an introduction for "${charName}" in an earlier beat, or modify beat ${beat.beat_number} to include their introduction.`,
          character: charName
        });

        // Still mark as introduced to avoid duplicate warnings
        introducedCharacters.add(charName);
        introductionBeats.set(charName, beat.beat_number);
      }
    }

    // Check for characters mentioned in summary/dialogue but not in characters list
    for (const char of characters) {
      const charNameLower = char.name.toLowerCase();
      if (beatText.includes(charNameLower) && !beatChars.includes(charNameLower)) {
        // Character mentioned but not in characters array - might be issue
        if (!introducedCharacters.has(charNameLower)) {
          issues.push({
            beat_number: beat.beat_number,
            severity: 'suggestion',
            type: 'character_mention_without_presence',
            description: `Character "${char.name}" is mentioned in beat ${beat.beat_number} summary but not listed in beat's characters array.`,
            fix_suggestion: `Add "${char.name}" to the characters array if they are present in the scene.`,
            character: char.name
          });
        }
      }
    }
  }

  logger.info(`[BeatPipeline:CharacterValidator] Found ${issues.length} character introduction issues`);
  return issues;
}

/**
 * MEDIUM-12: Scene Transition Validator
 * Detects abrupt transitions between consecutive beats (location, time, character jumps)
 * and suggests transitional elements where needed.
 *
 * @param {Array} beats - The story beats to validate
 * @param {Object} context - Context including locations and characters
 * @returns {Array} Array of transition issues found
 */
function validateSceneTransitions(beats, context) {
  const issues = [];

  if (!beats || beats.length < 2) return issues;

  const { locations = [] } = context;

  // Build location map for proximity/relationship analysis
  const locationMap = new Map();
  for (const loc of locations) {
    if (loc.name) {
      locationMap.set(loc.name.toLowerCase(), {
        name: loc.name,
        type: loc.type || loc.location_type || 'unknown',
        parentLocation: loc.parent_location || loc.parentLocation || null,
        region: loc.region || null,
        description: loc.description || ''
      });
    }
  }

  // Beat types that represent intentional narrative jumps (don't flag these)
  const INTENTIONAL_JUMP_TYPES = [
    'flashback', 'flash_forward', 'interlude', 'parallel',
    'dream', 'vision', 'memory', 'cutaway', 'montage'
  ];

  // Transition markers in text that indicate intentional jumps
  const INTENTIONAL_MARKERS = [
    'meanwhile', 'elsewhere', 'at the same time', 'back at',
    'hours later', 'days later', 'the next day', 'that night',
    'earlier that', 'later that', 'some time later', 'years ago',
    'in a flashback', 'remembers when', 'dreams of', 'envisions'
  ];

  logger.info(`[BeatPipeline:TransitionValidator] Checking ${beats.length} beats for transition issues`);

  for (let i = 0; i < beats.length - 1; i++) {
    const currentBeat = beats[i];
    const nextBeat = beats[i + 1];

    // Skip validation if next beat is an intentional narrative jump
    const nextType = (nextBeat.type || '').toLowerCase();
    const currentType = (currentBeat.type || '').toLowerCase();

    if (INTENTIONAL_JUMP_TYPES.some(t => nextType.includes(t) || currentType.includes(t))) {
      logger.debug(`[BeatPipeline:TransitionValidator] Skipping beat ${nextBeat.beat_number} - intentional jump type: ${nextType}`);
      continue;
    }

    // Check summary text for intentional transition markers
    const nextSummary = (nextBeat.summary || '').toLowerCase();
    const hasIntentionalMarker = INTENTIONAL_MARKERS.some(marker => nextSummary.includes(marker));
    if (hasIntentionalMarker) {
      logger.debug(`[BeatPipeline:TransitionValidator] Skipping beat ${nextBeat.beat_number} - has transition marker in summary`);
      continue;
    }

    // Check for abrupt location transitions
    const locationIssue = checkLocationTransition(currentBeat, nextBeat, locationMap);
    if (locationIssue) {
      issues.push({
        beat_number: nextBeat.beat_number,
        previous_beat: currentBeat.beat_number,
        severity: locationIssue.severity,
        type: 'scene_transition_location',
        description: locationIssue.description,
        fix_suggestion: locationIssue.suggestion
      });
    }

    // Check for abrupt character presence changes
    const characterIssue = checkCharacterPresenceTransition(currentBeat, nextBeat);
    if (characterIssue) {
      issues.push({
        beat_number: nextBeat.beat_number,
        previous_beat: currentBeat.beat_number,
        severity: characterIssue.severity,
        type: 'scene_transition_characters',
        description: characterIssue.description,
        fix_suggestion: characterIssue.suggestion
      });
    }

    // Check for abrupt mood/tone shifts
    const moodIssue = checkMoodTransition(currentBeat, nextBeat);
    if (moodIssue) {
      issues.push({
        beat_number: nextBeat.beat_number,
        previous_beat: currentBeat.beat_number,
        severity: moodIssue.severity,
        type: 'scene_transition_mood',
        description: moodIssue.description,
        fix_suggestion: moodIssue.suggestion
      });
    }
  }

  if (issues.length > 0) {
    logger.warn(`[BeatPipeline:TransitionValidator] Found ${issues.length} scene transition issues`);
  } else {
    logger.info(`[BeatPipeline:TransitionValidator] No abrupt scene transitions detected`);
  }

  return issues;
}

/**
 * Check for abrupt location changes between beats
 * @private
 */
function checkLocationTransition(currentBeat, nextBeat, locationMap) {
  const currentLoc = (currentBeat.location || '').toLowerCase().trim();
  const nextLoc = (nextBeat.location || '').toLowerCase().trim();

  // No issue if locations are the same or not specified
  if (!currentLoc || !nextLoc || currentLoc === nextLoc) {
    return null;
  }

  // Check if locations are related (same parent, same region, etc.)
  const currentLocInfo = locationMap.get(currentLoc);
  const nextLocInfo = locationMap.get(nextLoc);

  // If we have location metadata, check for relationships
  if (currentLocInfo && nextLocInfo) {
    // Same parent location = nearby, no issue
    if (currentLocInfo.parentLocation && nextLocInfo.parentLocation &&
        currentLocInfo.parentLocation.toLowerCase() === nextLocInfo.parentLocation.toLowerCase()) {
      return null;
    }

    // Same region = relatively close, minor issue at most
    if (currentLocInfo.region && nextLocInfo.region &&
        currentLocInfo.region.toLowerCase() === nextLocInfo.region.toLowerCase()) {
      return null; // Same region is acceptable
    }

    // One is parent of the other = movement within same area
    if (currentLoc.includes(nextLoc) || nextLoc.includes(currentLoc)) {
      return null;
    }
  }

  // Check summary for travel/movement indicators
  const nextSummary = (nextBeat.summary || '').toLowerCase();
  const travelIndicators = [
    'arrives at', 'reaches', 'travels to', 'journeys to', 'walks to',
    'rides to', 'flies to', 'sails to', 'drives to', 'heads to',
    'makes their way', 'returns to', 'enters', 'steps into',
    'after the journey', 'upon arriving', 'having traveled'
  ];

  const hasTravel = travelIndicators.some(indicator => nextSummary.includes(indicator));
  if (hasTravel) {
    return null; // Travel is mentioned, no issue
  }

  // Check if current beat ends with departure
  const currentSummary = (currentBeat.summary || '').toLowerCase();
  const departureIndicators = [
    'leaves', 'departs', 'sets off', 'heads out', 'begins the journey',
    'starts traveling', 'mounts', 'boards', 'exits'
  ];
  const hasDeparture = departureIndicators.some(indicator => currentSummary.includes(indicator));
  if (hasDeparture) {
    return null; // Departure mentioned, transition is acceptable
  }

  // Calculate how different the locations are
  const currentWords = new Set(currentLoc.split(/\s+/).filter(w => w.length > 2));
  const nextWords = new Set(nextLoc.split(/\s+/).filter(w => w.length > 2));
  const commonWords = [...currentWords].filter(w => nextWords.has(w));

  // If locations share significant words, they might be related
  if (commonWords.length > 0) {
    return null; // Likely related locations
  }

  // This is an abrupt location change
  return {
    severity: 'warning',
    description: `Abrupt location change from "${currentBeat.location}" (beat ${currentBeat.beat_number}) to "${nextBeat.location}" (beat ${nextBeat.beat_number}) with no travel or transition indicated.`,
    suggestion: `Add a transition beat showing travel from "${currentBeat.location}" to "${nextBeat.location}", or add travel description to beat ${nextBeat.beat_number}'s summary (e.g., "After traveling to ${nextBeat.location}...").`
  };
}

/**
 * Check for abrupt character presence changes between beats
 * @private
 */
function checkCharacterPresenceTransition(currentBeat, nextBeat) {
  const currentChars = new Set((currentBeat.characters || []).map(c => c.toLowerCase().trim()));
  const nextChars = new Set((nextBeat.characters || []).map(c => c.toLowerCase().trim()));

  // Skip if either beat has no characters listed
  if (currentChars.size === 0 || nextChars.size === 0) {
    return null;
  }

  // Find characters who appear in next but not current (new arrivals)
  const newArrivals = [...nextChars].filter(c => !currentChars.has(c));

  // Find characters who were in current but not next (departures)
  const departures = [...currentChars].filter(c => !nextChars.has(c));

  // Check summaries for arrival/departure explanations
  const nextSummary = (nextBeat.summary || '').toLowerCase();
  const currentSummary = (currentBeat.summary || '').toLowerCase();

  const arrivalIndicators = [
    'arrives', 'joins', 'enters', 'appears', 'shows up', 'comes in',
    'approaches', 'meets', 'encounters', 'finds', 'discovers',
    'interrupted by', 'is joined by', 'welcomes'
  ];

  const departureIndicators = [
    'leaves', 'departs', 'exits', 'goes', 'walks away', 'storms off',
    'slips away', 'disappears', 'sends away', 'dismisses', 'alone'
  ];

  // Check for unexplained new arrivals
  const unexplainedArrivals = newArrivals.filter(char => {
    // Check if arrival is explained in next beat's summary
    const charMentioned = nextSummary.includes(char);
    const hasArrivalIndicator = arrivalIndicators.some(ind => nextSummary.includes(ind));
    return !(charMentioned && hasArrivalIndicator);
  });

  // Check for unexplained departures (character was present, suddenly gone)
  const unexplainedDepartures = departures.filter(char => {
    // If location changed, characters naturally don't follow
    if (currentBeat.location !== nextBeat.location) {
      return false;
    }
    // Check if departure is explained in current beat
    const charMentioned = currentSummary.includes(char);
    const hasDepartureIndicator = departureIndicators.some(ind => currentSummary.includes(ind));
    return !(charMentioned && hasDepartureIndicator);
  });

  // Only flag if there are multiple unexplained changes or significant main character issues
  const totalUnexplained = unexplainedArrivals.length + unexplainedDepartures.length;

  // Single character change is often acceptable in storytelling
  if (totalUnexplained <= 1) {
    return null;
  }

  // Complete cast change is suspicious (unless location changed)
  const isCompleteCastChange = currentChars.size > 1 && nextChars.size > 1 &&
    [...currentChars].every(c => !nextChars.has(c));

  if (isCompleteCastChange && currentBeat.location === nextBeat.location) {
    return {
      severity: 'warning',
      description: `Complete character cast change between beat ${currentBeat.beat_number} and ${nextBeat.beat_number} at the same location ("${currentBeat.location}"). Previous: [${[...currentChars].join(', ')}], Next: [${[...nextChars].join(', ')}].`,
      suggestion: `Add a transition showing why characters [${[...currentChars].join(', ')}] left and how [${[...nextChars].join(', ')}] arrived, or mark beat ${nextBeat.beat_number} as a parallel/cutaway scene.`
    };
  }

  if (unexplainedArrivals.length > 1) {
    return {
      severity: 'suggestion',
      description: `Multiple characters suddenly appear in beat ${nextBeat.beat_number} without explanation: [${unexplainedArrivals.join(', ')}].`,
      suggestion: `Add arrival context to beat ${nextBeat.beat_number}'s summary explaining how these characters joined the scene.`
    };
  }

  return null;
}

/**
 * Check for jarring mood/tone shifts between beats
 * @private
 */
function checkMoodTransition(currentBeat, nextBeat) {
  const currentMood = (currentBeat.mood || '').toLowerCase().trim();
  const nextMood = (nextBeat.mood || '').toLowerCase().trim();

  // Skip if moods aren't specified
  if (!currentMood || !nextMood) {
    return null;
  }

  // Define mood categories for contrast detection
  const moodCategories = {
    positive: ['joyful', 'happy', 'hopeful', 'triumphant', 'romantic', 'peaceful', 'serene', 'warm', 'lighthearted', 'comedic', 'celebratory'],
    negative: ['dark', 'grim', 'tragic', 'mournful', 'desperate', 'horrific', 'terrifying', 'bleak', 'devastating'],
    tense: ['tense', 'suspenseful', 'anxious', 'urgent', 'dramatic', 'ominous', 'foreboding', 'dangerous'],
    calm: ['calm', 'quiet', 'contemplative', 'reflective', 'melancholic', 'nostalgic', 'bittersweet'],
    action: ['intense', 'chaotic', 'violent', 'frantic', 'explosive', 'climactic', 'confrontational']
  };

  // Find category for each mood
  const findCategory = (mood) => {
    for (const [category, keywords] of Object.entries(moodCategories)) {
      if (keywords.some(k => mood.includes(k))) {
        return category;
      }
    }
    return 'neutral';
  };

  const currentCategory = findCategory(currentMood);
  const nextCategory = findCategory(nextMood);

  // Define jarring transitions (categories that clash)
  const jarringTransitions = {
    positive: ['negative', 'action'], // joy to tragedy/violence is jarring
    negative: ['positive'],           // grief to joy without transition is jarring
    calm: ['action'],                 // peace to chaos needs buildup
    action: ['calm']                  // battle to quiet needs wind-down
  };

  const isJarring = jarringTransitions[currentCategory]?.includes(nextCategory);

  if (!isJarring) {
    return null;
  }

  // Check if the beat type explains the shift
  const nextType = (nextBeat.type || '').toLowerCase();
  const transitionTypes = ['transition', 'resolution', 'climax', 'revelation'];
  if (transitionTypes.some(t => nextType.includes(t))) {
    return null; // Beat type accounts for the shift
  }

  // Check summary for transitional language
  const nextSummary = (nextBeat.summary || '').toLowerCase();
  const transitionPhrases = [
    'suddenly', 'without warning', 'the mood shifts', 'everything changes',
    'interrupted by', 'shattered by', 'broken by', 'in stark contrast'
  ];

  if (transitionPhrases.some(p => nextSummary.includes(p))) {
    return null; // Abrupt shift is intentional and noted
  }

  return {
    severity: 'suggestion',
    description: `Potentially jarring mood shift from "${currentMood}" (beat ${currentBeat.beat_number}) to "${nextMood}" (beat ${nextBeat.beat_number}) without transitional elements.`,
    suggestion: `Consider adding a transition beat between ${currentBeat.beat_number} and ${nextBeat.beat_number} to smooth the emotional shift, or add transitional language to beat ${nextBeat.beat_number}'s summary.`
  };
}

/**
 * Phase 4: Continuity Validator Agent
 * Checks for timeline violations and logic errors
 */
async function validateContinuity({ beats, chapter, chapterNumber, context, timeline, outline, openai }) {
  logger.info('[BeatPipeline:Validator] Validating continuity...');

  // HIGH-3: Run character introduction validation first
  const characterIssues = validateCharacterIntroductions(beats, context, chapterNumber);
  if (characterIssues.length > 0) {
    logger.warn(`[BeatPipeline:Validator] Character introduction issues: ${characterIssues.length}`);
  }

  // MEDIUM-12: Run scene transition validation
  const transitionIssues = validateSceneTransitions(beats, context);
  if (transitionIssues.length > 0) {
    logger.warn(`[BeatPipeline:Validator] Scene transition issues: ${transitionIssues.length}`);
  }

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
      model: getReasoningModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 4000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"issues":[],"is_valid":true}');

    // HIGH-3 + MEDIUM-12: Merge character introduction, transition, and LLM validation issues
    const allIssues = [...characterIssues, ...transitionIssues, ...(result.issues || [])];
    const hasCharacterWarnings = characterIssues.some(i => i.severity === 'warning' || i.severity === 'critical');
    const hasTransitionWarnings = transitionIssues.some(i => i.severity === 'warning' || i.severity === 'critical');

    logger.info(`[BeatPipeline:Validator] Found ${result.issues?.length || 0} LLM issues + ${characterIssues.length} character issues + ${transitionIssues.length} transition issues, valid: ${result.is_valid && !hasCharacterWarnings}`);

    return {
      ...result,
      issues: allIssues,
      is_valid: result.is_valid && !hasCharacterWarnings,
      character_validation: {
        issues_found: characterIssues.length,
        issues: characterIssues
      },
      transition_validation: {
        issues_found: transitionIssues.length,
        issues: transitionIssues
      }
    };

  } catch (error) {
    logger.error('[BeatPipeline:Validator] Error validating:', error);
    // Still return character and transition issues even if LLM validation fails
    const fallbackIssues = [...characterIssues, ...transitionIssues];
    return {
      issues: fallbackIssues,
      is_valid: fallbackIssues.length === 0,
      error: error.message,
      character_validation: {
        issues_found: characterIssues.length,
        issues: characterIssues
      },
      transition_validation: {
        issues_found: transitionIssues.length,
        issues: transitionIssues
      }
    };
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
      model: getReasoningModel(),
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
 * MEDIUM-11: Cross-Chapter Continuity Validator
 * Validates continuity between chapters to catch major contradictions
 *
 * @param {Object} params - Validation parameters
 * @param {Object} params.previousChapterState - Final state from previous chapter
 * @param {Array} params.beats - Current chapter's beats to validate
 * @param {Object} params.context - Full context including characters, items, locations
 * @param {number} params.chapterNumber - Current chapter number
 * @returns {Array} Array of continuity issues found
 */
export function validateCrossChapterContinuity({ previousChapterState, beats, context, chapterNumber }) {
  const issues = [];

  // Skip for first chapter - no previous state to validate against
  if (chapterNumber <= 1 || !previousChapterState) {
    logger.info('[BeatPipeline:CrossChapterValidator] Chapter 1 or no previous state - skipping cross-chapter validation');
    return issues;
  }

  logger.info(`[BeatPipeline:CrossChapterValidator] Validating continuity from Chapter ${chapterNumber - 1} to Chapter ${chapterNumber}`);

  const {
    deadCharacters = [],
    characterLocations = {},
    lostItems = [],
    destroyedItems = [],
    characterInventory = {},
    finalLocation = null
  } = previousChapterState;

  // Build text content from all beats for analysis
  const allBeatsText = beats.map(b =>
    `${b.summary || ''} ${b.dialogue_hint || ''} ${b.sensory_details || ''}`
  ).join(' ').toLowerCase();

  // ========================================
  // CHECK 1: Character Death/Resurrection
  // ========================================
  for (const deadChar of deadCharacters) {
    const charNameLower = deadChar.name?.toLowerCase() || deadChar.toLowerCase();

    // Check if dead character appears in any beat
    for (const beat of beats) {
      const beatChars = (beat.characters || []).map(c => c.toLowerCase());
      const beatText = `${beat.summary || ''} ${beat.dialogue_hint || ''}`.toLowerCase();

      const appearsInBeat = beatChars.includes(charNameLower) ||
                           beatText.includes(charNameLower);

      if (appearsInBeat) {
        // Check if the beat explicitly handles resurrection/flashback/memory
        const isFlashbackOrMemory =
          (beat.type || '').toLowerCase() === 'flashback' ||
          beatText.includes('remember') ||
          beatText.includes('memory') ||
          beatText.includes('ghost') ||
          beatText.includes('spirit') ||
          beatText.includes('vision') ||
          beatText.includes('dream') ||
          beatText.includes('resurrect') ||
          beatText.includes('brought back') ||
          beatText.includes('revive');

        if (!isFlashbackOrMemory) {
          issues.push({
            beat_number: beat.beat_number,
            severity: 'critical',
            type: 'character_resurrection_contradiction',
            description: `Character "${deadChar.name || deadChar}" died in a previous chapter but appears alive in beat ${beat.beat_number} without explanation (flashback, resurrection, etc.)`,
            fix_suggestion: `Either remove "${deadChar.name || deadChar}" from this beat, mark the beat as a flashback/memory, or add a resurrection/revival explanation earlier in the chapter.`,
            character: deadChar.name || deadChar,
            previous_chapter_event: deadChar.deathChapter ? `Died in Chapter ${deadChar.deathChapter}` : 'Died in previous chapter'
          });
        }
      }
    }
  }

  // ========================================
  // CHECK 2: Equipment/Resource Contradictions
  // ========================================
  const unavailableItems = [...lostItems, ...destroyedItems];

  for (const item of unavailableItems) {
    const itemNameLower = item.name?.toLowerCase() || item.toLowerCase();

    for (const beat of beats) {
      const beatText = `${beat.summary || ''} ${beat.dialogue_hint || ''} ${beat.sensory_details || ''}`.toLowerCase();

      // Check if item is used/referenced as if available
      const itemUsagePatterns = [
        `uses ${itemNameLower}`,
        `using ${itemNameLower}`,
        `wields ${itemNameLower}`,
        `wielding ${itemNameLower}`,
        `draws ${itemNameLower}`,
        `holds ${itemNameLower}`,
        `holding ${itemNameLower}`,
        `with ${itemNameLower}`,
        `grabs ${itemNameLower}`,
        `takes ${itemNameLower}`,
        `${itemNameLower} in hand`,
        `raises ${itemNameLower}`,
        `swings ${itemNameLower}`
      ];

      const isItemUsed = itemUsagePatterns.some(pattern => beatText.includes(pattern));

      // Also check if item appears without context suggesting it's missing
      const itemMentioned = beatText.includes(itemNameLower);
      const contextSuggestsMissing =
        beatText.includes('lost') ||
        beatText.includes('destroyed') ||
        beatText.includes('broken') ||
        beatText.includes('missing') ||
        beatText.includes('search for') ||
        beatText.includes('find') ||
        beatText.includes('recover') ||
        beatText.includes('replacement');

      if (isItemUsed || (itemMentioned && !contextSuggestsMissing)) {
        const wasLost = lostItems.some(i => (i.name?.toLowerCase() || i.toLowerCase()) === itemNameLower);
        const wasDestroyed = destroyedItems.some(i => (i.name?.toLowerCase() || i.toLowerCase()) === itemNameLower);

        issues.push({
          beat_number: beat.beat_number,
          severity: 'critical',
          type: 'item_availability_contradiction',
          description: `Item "${item.name || item}" was ${wasDestroyed ? 'destroyed' : 'lost'} in a previous chapter but appears to be available/used in beat ${beat.beat_number}`,
          fix_suggestion: wasDestroyed
            ? `Remove "${item.name || item}" from this beat or establish how it was replaced/recreated.`
            : `Add a scene showing recovery of "${item.name || item}" before this beat, or use a different item.`,
          item: item.name || item,
          previous_state: wasDestroyed ? 'destroyed' : 'lost',
          previous_chapter: item.lostChapter || item.destroyedChapter || 'previous chapter'
        });
      }
    }
  }

  // ========================================
  // CHECK 3: Location Teleportation
  // ========================================
  if (Object.keys(characterLocations).length > 0) {
    // Get the first beat's location and characters
    const firstBeat = beats[0];
    if (firstBeat) {
      const firstBeatLocation = (firstBeat.location || '').toLowerCase();
      const firstBeatChars = (firstBeat.characters || []).map(c => c.toLowerCase());

      for (const [charName, lastLocation] of Object.entries(characterLocations)) {
        const charNameLower = charName.toLowerCase();
        const lastLocationLower = (lastLocation.name || lastLocation || '').toLowerCase();

        // Only check if character is in the first beat
        if (firstBeatChars.includes(charNameLower)) {
          // Check if locations are meaningfully different
          const locationsDiffer =
            firstBeatLocation &&
            lastLocationLower &&
            !firstBeatLocation.includes(lastLocationLower) &&
            !lastLocationLower.includes(firstBeatLocation);

          if (locationsDiffer) {
            // Check if there's any travel mention in early beats
            const earlyBeats = beats.slice(0, 3);
            const hasTransitionExplanation = earlyBeats.some(beat => {
              const text = `${beat.summary || ''} ${beat.type || ''}`.toLowerCase();
              return text.includes('travel') ||
                     text.includes('journey') ||
                     text.includes('arrive') ||
                     text.includes('reach') ||
                     text.includes('return') ||
                     text.includes('transition') ||
                     text.includes('meanwhile') ||
                     text.includes('later') ||
                     text.includes('next day') ||
                     text.includes('hours later') ||
                     text.includes('days later') ||
                     beat.type === 'transition';
            });

            if (!hasTransitionExplanation) {
              issues.push({
                beat_number: 1,
                severity: 'warning',
                type: 'location_teleportation',
                description: `Character "${charName}" was at "${lastLocation.name || lastLocation}" at the end of Chapter ${chapterNumber - 1} but appears at "${firstBeat.location}" at the start of Chapter ${chapterNumber} with no travel/transition explanation`,
                fix_suggestion: `Add a transition beat showing "${charName}" traveling from "${lastLocation.name || lastLocation}" to "${firstBeat.location}", or add time-skip language like "The next morning..." or "After the long journey..."`,
                character: charName,
                previous_location: lastLocation.name || lastLocation,
                current_location: firstBeat.location
              });
            }
          }
        }
      }
    }
  }

  // ========================================
  // CHECK 4: Character Inventory Consistency
  // ========================================
  for (const [charName, inventory] of Object.entries(characterInventory)) {
    const charNameLower = charName.toLowerCase();

    for (const item of inventory) {
      const itemNameLower = item.name?.toLowerCase() || item.toLowerCase();

      // Check if another character uses this item
      for (const beat of beats) {
        const beatText = `${beat.summary || ''} ${beat.dialogue_hint || ''}`.toLowerCase();
        const beatChars = (beat.characters || []).map(c => c.toLowerCase());

        // Check if item is used by a different character
        const itemUsed = beatText.includes(itemNameLower);
        const originalOwnerPresent = beatChars.includes(charNameLower);

        if (itemUsed && !originalOwnerPresent) {
          // Another character might be using the item - check for transfer context
          const hasTransferContext =
            beatText.includes('borrow') ||
            beatText.includes('lend') ||
            beatText.includes('give') ||
            beatText.includes('hand over') ||
            beatText.includes('pass') ||
            beatText.includes('take from') ||
            beatText.includes('stole') ||
            beatText.includes('left behind');

          if (!hasTransferContext) {
            issues.push({
              beat_number: beat.beat_number,
              severity: 'suggestion',
              type: 'inventory_ownership_unclear',
              description: `Item "${item.name || item}" belonged to "${charName}" at end of previous chapter, but appears to be used in beat ${beat.beat_number} without "${charName}" present`,
              fix_suggestion: `Either add "${charName}" to this scene, show the item being transferred/borrowed, or establish how the new character obtained it.`,
              item: item.name || item,
              original_owner: charName
            });
          }
        }
      }
    }
  }

  // Log summary
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const suggestionCount = issues.filter(i => i.severity === 'suggestion').length;

  logger.info(`[BeatPipeline:CrossChapterValidator] Found ${issues.length} cross-chapter issues (${criticalCount} critical, ${warningCount} warnings, ${suggestionCount} suggestions)`);

  return issues;
}

/**
 * Extract chapter state from beats and context for cross-chapter validation
 * This should be called after generating beats to capture the final state
 *
 * @param {Array} beats - The generated beats for this chapter
 * @param {Object} context - The full context including characters, items, etc.
 * @param {number} chapterNumber - Current chapter number
 * @returns {Object} State object for cross-chapter validation
 */
export function extractChapterFinalState(beats, context, chapterNumber) {
  logger.info(`[BeatPipeline:StateExtractor] Extracting final state for Chapter ${chapterNumber}`);

  const state = {
    chapterNumber,
    deadCharacters: [],
    characterLocations: {},
    lostItems: [],
    destroyedItems: [],
    characterInventory: {},
    finalLocation: null
  };

  if (!beats || beats.length === 0) {
    return state;
  }

  // Combine all beat text for analysis
  const allBeatsText = beats.map(b =>
    `${b.summary || ''} ${b.dialogue_hint || ''} ${b.sensory_details || ''}`
  ).join(' ').toLowerCase();

  // Extract death events
  const deathPatterns = [
    /(\w+)\s+(?:dies|is killed|was killed|perishes|falls dead|is slain)/gi,
    /(?:death of|kills?|murdered?|slays?)\s+(\w+)/gi,
    /(\w+)'s?\s+(?:death|demise|final breath|last moment)/gi
  ];

  for (const pattern of deathPatterns) {
    let match;
    while ((match = pattern.exec(allBeatsText)) !== null) {
      const charName = match[1];
      // Verify it's a known character
      const knownChar = context.characters?.find(c =>
        c.name.toLowerCase() === charName.toLowerCase()
      );
      if (knownChar && !state.deadCharacters.some(d => d.name === knownChar.name)) {
        state.deadCharacters.push({
          name: knownChar.name,
          id: knownChar.id,
          deathChapter: chapterNumber
        });
        logger.debug(`[BeatPipeline:StateExtractor] Detected death: ${knownChar.name}`);
      }
    }
  }

  // Extract lost/destroyed items
  const lostPatterns = [
    /(\w+(?:\s+\w+)?)\s+(?:is lost|was lost|falls into|dropped into|lost forever)/gi,
    /(?:loses?|lost)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/gi
  ];

  const destroyedPatterns = [
    /(\w+(?:\s+\w+)?)\s+(?:is destroyed|was destroyed|shatters|breaks|crumbles)/gi,
    /(?:destroys?|destroyed|shattered|broke)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/gi
  ];

  for (const pattern of lostPatterns) {
    let match;
    while ((match = pattern.exec(allBeatsText)) !== null) {
      const itemName = match[1];
      const knownItem = context.items?.find(i =>
        i.name.toLowerCase().includes(itemName.toLowerCase()) ||
        itemName.toLowerCase().includes(i.name.toLowerCase())
      );
      if (knownItem && !state.lostItems.some(i => i.name === knownItem.name)) {
        state.lostItems.push({
          name: knownItem.name,
          id: knownItem.id,
          lostChapter: chapterNumber
        });
        logger.debug(`[BeatPipeline:StateExtractor] Detected lost item: ${knownItem.name}`);
      }
    }
  }

  for (const pattern of destroyedPatterns) {
    let match;
    while ((match = pattern.exec(allBeatsText)) !== null) {
      const itemName = match[1];
      const knownItem = context.items?.find(i =>
        i.name.toLowerCase().includes(itemName.toLowerCase()) ||
        itemName.toLowerCase().includes(i.name.toLowerCase())
      );
      if (knownItem && !state.destroyedItems.some(i => i.name === knownItem.name)) {
        state.destroyedItems.push({
          name: knownItem.name,
          id: knownItem.id,
          destroyedChapter: chapterNumber
        });
        logger.debug(`[BeatPipeline:StateExtractor] Detected destroyed item: ${knownItem.name}`);
      }
    }
  }

  // Get final beat for location tracking
  const finalBeat = beats[beats.length - 1];
  if (finalBeat) {
    state.finalLocation = finalBeat.location;

    // Track character locations at end of chapter
    const finalChars = finalBeat.characters || [];
    for (const charName of finalChars) {
      state.characterLocations[charName] = {
        name: finalBeat.location,
        beat: finalBeat.beat_number
      };
    }
  }

  logger.info(`[BeatPipeline:StateExtractor] Extracted state: ${state.deadCharacters.length} deaths, ${state.lostItems.length} lost items, ${state.destroyedItems.length} destroyed items, ${Object.keys(state.characterLocations).length} character locations tracked`);

  return state;
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

export default {
  generateBeatsWithPipeline,
  extractChapterFinalState,
  validateCrossChapterContinuity,  // MEDIUM-11: Export for external use if needed
  validateSceneTransitions         // MEDIUM-12: Export for external use if needed
};
