/**
 * Story State Tracker Service
 * ============================================================================
 *
 * Maintains character, plot, and world state across scenes to prevent
 * hallucinations and continuity errors during story generation.
 *
 * State is tracked per-session and persisted in story_sessions.config_json.story_state.
 * The orchestrator calls into this service at three points:
 *   1. After outline generation  -> initializeStoryState + saveStoryState
 *   2. Before each scene         -> loadStoryState + formatStateForPrompt
 *   3. After each scene          -> validateSceneConsistency + updateStoryState + saveStoryState
 *
 * All functions are defensive: missing or corrupt state never throws,
 * it falls back to an empty state and logs a warning.
 *
 * MODEL POLICY:
 * - Uses utility-tier model (gpt-5-mini via modelOverride) for all LLM calls.
 * - Prompts are kept concise to minimize token cost (~$0.005/scene).
 */

import { callAgent } from './openai.js';
import { parseJsonResponse } from '../utils/jsonUtils.js';
import { logger } from '../utils/logger.js';
import { getUtilityModel } from './modelSelection.js';
import { pool } from '../database/pool.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Number of scenes a plot thread can go unreferenced before we remind the LLM */
const FORGOTTEN_THREAD_THRESHOLD = 3;

/** Maximum token budget for the continuity prompt section */
const MAX_PROMPT_TOKENS_ESTIMATE = 500;

/** Approximate characters-per-token for budget estimation */
const CHARS_PER_TOKEN = 4;

/** Maximum character count for the formatted prompt (500 tokens * 4 chars) */
const MAX_PROMPT_CHARS = MAX_PROMPT_TOKENS_ESTIMATE * CHARS_PER_TOKEN;

// ============================================================================
// STATE INITIALIZATION
// ============================================================================

/**
 * Create an empty story state skeleton.
 * Used as the canonical fallback whenever state is missing or corrupt.
 */
function createEmptyState() {
  return {
    characters: {},
    plotThreads: [],
    worldFacts: [],
    timeline: [],
    lastUpdatedScene: 0
  };
}

/**
 * Create a default character state entry.
 * @param {string} name - Character name (for logging only)
 * @returns {object} Character state skeleton
 */
function createEmptyCharacterState(name) {
  return {
    location: 'unknown',
    knowledge: [],
    injuries: [],
    possessions: [],
    relationships: {},
    traits: [],
    physicalDescription: ''
  };
}

/**
 * Initialize story state from outline and character data.
 *
 * Parses the outline to extract plot threads from scene descriptions
 * and builds an initial character map from the provided character list.
 *
 * @param {object} outline - Story outline (outline_json from story_outlines)
 * @param {Array} characters - Array of character objects from story_characters
 * @param {string} sessionId - Session ID for logging
 * @returns {object} Initialized story state
 */
export function initializeStoryState(outline, characters, sessionId) {
  const startTime = Date.now();
  logger.info(`[StoryState] Initializing state for session ${sessionId}`);

  const state = createEmptyState();

  // --- Build character map ---
  try {
    const charList = Array.isArray(characters) ? characters : [];
    for (const char of charList) {
      const name = char.name || char.character_name;
      if (!name) continue;

      state.characters[name] = {
        location: char.location || char.setting || 'unknown',
        knowledge: [],
        injuries: [],
        possessions: Array.isArray(char.possessions) ? [...char.possessions] : [],
        relationships: char.relationships || {},
        traits: Array.isArray(char.traits)
          ? [...char.traits]
          : (char.personality ? [char.personality] : []),
        physicalDescription: char.physical_description || char.description || ''
      };
    }
    logger.info(`[StoryState] Loaded ${Object.keys(state.characters).length} characters`);
  } catch (err) {
    logger.warn(`[StoryState] Error parsing characters, continuing with empty map: ${err.message}`);
  }

  // --- Extract plot threads from outline scene descriptions ---
  try {
    const scenes = extractScenesFromOutline(outline);
    let threadId = 1;

    for (const scene of scenes) {
      const description = scene.description || scene.summary || scene.scene_description || '';
      if (!description) continue;

      state.plotThreads.push({
        id: `thread_${threadId++}`,
        description: description.length > 200
          ? description.substring(0, 197) + '...'
          : description,
        status: 'open',
        lastReferencedScene: 0
      });
    }
    logger.info(`[StoryState] Extracted ${state.plotThreads.length} plot threads from outline`);
  } catch (err) {
    logger.warn(`[StoryState] Error extracting plot threads: ${err.message}`);
  }

  // --- Set initial world facts from outline setting ---
  try {
    const setting = outline?.setting || outline?.world || outline?.outline_json?.setting;
    if (setting) {
      const settingStr = typeof setting === 'string' ? setting : JSON.stringify(setting);
      state.worldFacts.push(`Setting: ${settingStr.substring(0, 300)}`);
    }
  } catch (err) {
    logger.warn(`[StoryState] Error extracting world facts: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[StoryState] Initialization complete in ${elapsed}ms | ` +
    `${Object.keys(state.characters).length} characters, ` +
    `${state.plotThreads.length} threads, ` +
    `${state.worldFacts.length} world facts`);

  return state;
}

// ============================================================================
// STATE FORMATTING FOR PROMPTS
// ============================================================================

/**
 * Format the current story state as a concise prompt section for scene generation.
 *
 * Prioritizes information most relevant to continuity:
 *   1. Character locations and significant status (injuries, knowledge)
 *   2. Forgotten plot threads (unreferenced for 3+ scenes)
 *   3. Recent timeline events
 *
 * The output is kept under ~500 tokens to avoid bloating scene prompts.
 *
 * @param {object} state - Current story state
 * @param {number} sceneIndex - Current scene index (0-based)
 * @returns {string} Formatted continuity section for injection into prompts
 */
export function formatStateForPrompt(state, sceneIndex) {
  if (!state || typeof state !== 'object') {
    logger.warn('[StoryState] formatStateForPrompt called with invalid state, returning empty');
    return '';
  }

  const sections = [];

  // --- Character status ---
  const characters = state.characters || {};
  const charNames = Object.keys(characters);
  if (charNames.length > 0) {
    const charLines = [];
    for (const name of charNames) {
      const c = characters[name];
      const parts = [];

      if (c.location && c.location !== 'unknown') {
        parts.push(`at ${c.location}`);
      }
      if (c.injuries && c.injuries.length > 0) {
        parts.push(`injured: ${c.injuries.join(', ')}`);
      }
      if (c.possessions && c.possessions.length > 0) {
        // Only show recent/notable possessions (last 3)
        const notable = c.possessions.slice(-3);
        parts.push(`has: ${notable.join(', ')}`);
      }
      if (c.knowledge && c.knowledge.length > 0) {
        // Only show last 2 knowledge items to stay concise
        const recent = c.knowledge.slice(-2);
        parts.push(`knows: ${recent.join('; ')}`);
      }

      if (parts.length > 0) {
        charLines.push(`- ${name}: ${parts.join(' | ')}`);
      }
    }

    if (charLines.length > 0) {
      sections.push('CHARACTER STATUS:\n' + charLines.join('\n'));
    }
  }

  // --- Forgotten plot threads (unreferenced for FORGOTTEN_THREAD_THRESHOLD+ scenes) ---
  const openThreads = (state.plotThreads || []).filter(t => t.status === 'open');
  const forgottenThreads = openThreads.filter(
    t => (sceneIndex - (t.lastReferencedScene || 0)) >= FORGOTTEN_THREAD_THRESHOLD
  );

  if (forgottenThreads.length > 0) {
    const threadLines = forgottenThreads.map(
      t => `- [UNRESOLVED since scene ${t.lastReferencedScene}] ${t.description}`
    );
    sections.push('FORGOTTEN PLOT THREADS (address or reference these):\n' + threadLines.join('\n'));
  }

  // --- Recent timeline (last 3 events) ---
  const timeline = state.timeline || [];
  if (timeline.length > 0) {
    const recent = timeline.slice(-3);
    const timeLines = recent.map(
      e => `- Scene ${e.scene}: ${e.event}`
    );
    sections.push('RECENT EVENTS:\n' + timeLines.join('\n'));
  }

  // --- World facts (if any) ---
  const worldFacts = state.worldFacts || [];
  if (worldFacts.length > 0) {
    // Only include the most recent/relevant facts (last 3)
    const recentFacts = worldFacts.slice(-3);
    sections.push('ESTABLISHED WORLD FACTS:\n' + recentFacts.map(f => `- ${f}`).join('\n'));
  }

  if (sections.length === 0) {
    return '';
  }

  let result = 'CONTINUITY REQUIREMENTS:\n' + sections.join('\n\n');

  // Truncate if over budget
  if (result.length > MAX_PROMPT_CHARS) {
    result = result.substring(0, MAX_PROMPT_CHARS - 20) + '\n[...truncated]';
    logger.debug(`[StoryState] Prompt section truncated to ~${MAX_PROMPT_TOKENS_ESTIMATE} tokens`);
  }

  return result;
}

// ============================================================================
// SCENE CONSISTENCY VALIDATION
// ============================================================================

/**
 * Post-scene consistency check using a utility-tier LLM call.
 *
 * Compares the generated scene text against the current story state
 * to detect contradictions, impossible actions, or character errors.
 *
 * @param {string} sceneText - The generated scene prose
 * @param {object} state - Current story state (before this scene's update)
 * @param {number} sceneIndex - Scene index (0-based)
 * @param {string} sessionId - Session ID for usage tracking
 * @returns {object} { valid: boolean, issues: string[], severity: 'none'|'minor'|'major' }
 */
export async function validateSceneConsistency(sceneText, state, sceneIndex, sessionId) {
  const startTime = Date.now();

  // Defensive: if no state or no text, skip validation
  if (!state || !sceneText || typeof sceneText !== 'string') {
    logger.warn(`[StoryState] validateSceneConsistency skipped: missing state or sceneText`);
    return { valid: true, issues: [], severity: 'none' };
  }

  // Build a concise state summary for the validation prompt
  const stateSummary = buildStateSummaryForValidation(state);

  // Truncate scene text to avoid massive prompts (first 3000 chars is sufficient)
  const truncatedScene = sceneText.length > 3000
    ? sceneText.substring(0, 3000) + '\n[...scene continues]'
    : sceneText;

  const prompt = `You are a story continuity checker. Compare this scene against the established story state and identify any contradictions or inconsistencies.

ESTABLISHED STATE:
${stateSummary}

SCENE ${sceneIndex + 1} TEXT:
${truncatedScene}

Check for:
1. Characters appearing in locations they shouldn't be (based on last known location)
2. Characters using knowledge they don't have
3. Characters wielding items they don't possess
4. Physical impossibilities (injured character performing impossible feats)
5. Dead/absent characters appearing without explanation
6. Contradictions with established world facts

Return JSON:
{
  "valid": true/false,
  "issues": ["description of each issue found"],
  "severity": "none" | "minor" | "major"
}

Rules:
- "none": No issues found, set valid=true
- "minor": Small inconsistencies that don't break immersion (e.g., vague location shifts)
- "major": Clear contradictions that would confuse readers (e.g., dead character speaking)
- Be concise. Only flag real problems, not stylistic choices.
- If unsure, lean toward "valid" — don't flag minor creative liberties.`;

  try {
    const result = await callAgent('planner', prompt, {
      sessionId,
      response_format: { type: 'json_object' },
      maxTokens: 1000,
      modelOverride: getUtilityModel()
    });

    const parsed = parseJsonResponse(result.content);

    // Normalize the response
    const validation = {
      valid: parsed.valid !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      severity: ['none', 'minor', 'major'].includes(parsed.severity)
        ? parsed.severity
        : 'none'
    };

    const elapsed = Date.now() - startTime;

    if (validation.severity === 'major') {
      logger.warn(`[StoryState] MAJOR consistency issues in scene ${sceneIndex + 1} ` +
        `(session ${sessionId}, ${elapsed}ms):`);
      validation.issues.forEach(issue => logger.warn(`  - ${issue}`));
    } else if (validation.severity === 'minor') {
      logger.info(`[StoryState] Minor consistency notes for scene ${sceneIndex + 1} ` +
        `(${elapsed}ms): ${validation.issues.join('; ')}`);
    } else {
      logger.info(`[StoryState] Scene ${sceneIndex + 1} passed consistency check (${elapsed}ms)`);
    }

    return validation;

  } catch (err) {
    logger.error(`[StoryState] Consistency validation failed for scene ${sceneIndex + 1}: ${err.message}`);
    // Fail open: don't block story generation due to validation errors
    return { valid: true, issues: [], severity: 'none' };
  }
}

// ============================================================================
// STATE UPDATE AFTER SCENE
// ============================================================================

/**
 * Update the running story state based on a newly generated scene.
 *
 * Uses a utility-tier LLM call to extract state changes from the scene text:
 *   - Character location changes
 *   - New character knowledge
 *   - Injuries sustained or healed
 *   - Items gained or lost
 *   - New plot threads introduced
 *   - Existing plot threads resolved
 *   - New world facts established
 *
 * @param {string} sceneText - The generated scene prose
 * @param {object} state - Current story state (will be mutated)
 * @param {number} sceneIndex - Scene index (0-based)
 * @param {string} sessionId - Session ID for usage tracking
 * @returns {object} Updated story state
 */
export async function updateStoryState(sceneText, state, sceneIndex, sessionId) {
  const startTime = Date.now();

  // Defensive: always work with a valid state
  if (!state || typeof state !== 'object') {
    logger.warn(`[StoryState] updateStoryState called with invalid state, creating empty`);
    state = createEmptyState();
  }

  // If no scene text, just update the scene counter and return
  if (!sceneText || typeof sceneText !== 'string') {
    logger.warn(`[StoryState] updateStoryState called with no scene text, skipping extraction`);
    state.lastUpdatedScene = sceneIndex;
    return state;
  }

  // Build a concise list of known characters for the extraction prompt
  const knownCharacters = Object.keys(state.characters || {});

  // Truncate scene text for the prompt (first 3000 chars)
  const truncatedScene = sceneText.length > 3000
    ? sceneText.substring(0, 3000) + '\n[...scene continues]'
    : sceneText;

  const prompt = `You are a story state extractor. Read this scene and extract all state changes.

KNOWN CHARACTERS: ${knownCharacters.length > 0 ? knownCharacters.join(', ') : 'None established yet'}

SCENE ${sceneIndex + 1} TEXT:
${truncatedScene}

Extract ONLY changes that actually happened in this scene. Return JSON:
{
  "character_updates": {
    "CharacterName": {
      "location": "new location or null if unchanged",
      "new_knowledge": ["things this character learned"],
      "injuries_gained": ["new injuries"],
      "injuries_healed": ["healed injuries"],
      "items_gained": ["new possessions"],
      "items_lost": ["lost/used items"],
      "new_relationships": { "OtherChar": "relationship description" }
    }
  },
  "new_characters": {
    "NewCharName": {
      "location": "where they appeared",
      "traits": ["notable traits"],
      "physicalDescription": "brief appearance"
    }
  },
  "new_plot_threads": ["description of new plot threads introduced"],
  "resolved_threads": ["description of plot threads resolved or significantly advanced"],
  "new_world_facts": ["new facts about the world established in this scene"],
  "timeline_event": "One-sentence summary of the key event in this scene"
}

Rules:
- Only include fields with actual changes (omit nulls and empty arrays)
- Be concise: one-line descriptions, not paragraphs
- "new_characters" is for characters NOT in the known list who appear in this scene
- "resolved_threads" should match descriptions from the outline loosely`;

  try {
    const result = await callAgent('planner', prompt, {
      sessionId,
      response_format: { type: 'json_object' },
      maxTokens: 1500,
      modelOverride: getUtilityModel()
    });

    const changes = parseJsonResponse(result.content);

    // Apply character updates
    applyCharacterUpdates(state, changes.character_updates);

    // Add new characters
    applyNewCharacters(state, changes.new_characters);

    // Add new plot threads
    applyNewPlotThreads(state, changes.new_plot_threads, sceneIndex);

    // Resolve completed threads
    resolveCompletedThreads(state, changes.resolved_threads, sceneIndex);

    // Mark all open threads that were referenced in the scene
    markReferencedThreads(state, sceneText, sceneIndex);

    // Add world facts
    if (Array.isArray(changes.new_world_facts)) {
      for (const fact of changes.new_world_facts) {
        if (typeof fact === 'string' && fact.trim()) {
          state.worldFacts.push(fact.trim());
        }
      }
      // Cap world facts to prevent unbounded growth
      if (state.worldFacts.length > 20) {
        state.worldFacts = state.worldFacts.slice(-20);
      }
    }

    // Add timeline event
    if (changes.timeline_event && typeof changes.timeline_event === 'string') {
      state.timeline.push({
        scene: sceneIndex + 1,
        event: changes.timeline_event.substring(0, 200)
      });
    }

    state.lastUpdatedScene = sceneIndex;

    const elapsed = Date.now() - startTime;
    logger.info(`[StoryState] State updated for scene ${sceneIndex + 1} in ${elapsed}ms | ` +
      `${Object.keys(state.characters).length} characters tracked, ` +
      `${state.plotThreads.filter(t => t.status === 'open').length} open threads`);

    return state;

  } catch (err) {
    logger.error(`[StoryState] State extraction failed for scene ${sceneIndex + 1}: ${err.message}`);
    // Fail open: return state as-is with updated scene counter
    state.lastUpdatedScene = sceneIndex;
    return state;
  }
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Save story state to the database.
 *
 * Stores state in story_sessions.config_json.story_state using the JSONB
 * merge operator (||) so other config fields are preserved.
 *
 * @param {string} sessionId - Story session UUID
 * @param {object} state - Story state to persist
 */
export async function saveStoryState(sessionId, state) {
  if (!sessionId) {
    logger.warn('[StoryState] saveStoryState called without sessionId, skipping');
    return;
  }

  try {
    await pool.query(
      `UPDATE story_sessions
       SET config_json = COALESCE(config_json, '{}'::jsonb) || $1::jsonb,
           last_activity_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ story_state: state || createEmptyState() }), sessionId]
    );
    logger.debug(`[StoryState] State saved for session ${sessionId}`);
  } catch (err) {
    logger.error(`[StoryState] Failed to save state for session ${sessionId}: ${err.message}`);
    // Don't throw: persistence failure shouldn't crash story generation
  }
}

/**
 * Load story state from the database.
 *
 * @param {string} sessionId - Story session UUID
 * @returns {object} Story state, or empty state if not found
 */
export async function loadStoryState(sessionId) {
  if (!sessionId) {
    logger.warn('[StoryState] loadStoryState called without sessionId, returning empty');
    return createEmptyState();
  }

  try {
    const result = await pool.query(
      `SELECT config_json->'story_state' AS story_state
       FROM story_sessions
       WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0 || !result.rows[0].story_state) {
      logger.debug(`[StoryState] No stored state for session ${sessionId}, returning empty`);
      return createEmptyState();
    }

    const loaded = result.rows[0].story_state;

    // Validate structure: ensure all required keys exist
    const state = {
      ...createEmptyState(),
      ...loaded,
      characters: loaded.characters || {},
      plotThreads: Array.isArray(loaded.plotThreads) ? loaded.plotThreads : [],
      worldFacts: Array.isArray(loaded.worldFacts) ? loaded.worldFacts : [],
      timeline: Array.isArray(loaded.timeline) ? loaded.timeline : [],
      lastUpdatedScene: typeof loaded.lastUpdatedScene === 'number'
        ? loaded.lastUpdatedScene
        : 0
    };

    logger.debug(`[StoryState] Loaded state for session ${sessionId}: ` +
      `${Object.keys(state.characters).length} characters, ` +
      `${state.plotThreads.length} threads, ` +
      `last updated scene ${state.lastUpdatedScene}`);

    return state;

  } catch (err) {
    logger.error(`[StoryState] Failed to load state for session ${sessionId}: ${err.message}`);
    return createEmptyState();
  }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Extract scene descriptions from an outline object.
 * Handles multiple outline formats (acts/scenes, flat scenes array, etc.)
 */
function extractScenesFromOutline(outline) {
  if (!outline) return [];

  // Direct outline_json wrapper
  const data = outline.outline_json || outline;

  // Format: { acts: [{ scenes: [...] }] }
  if (Array.isArray(data.acts)) {
    const scenes = [];
    for (const act of data.acts) {
      if (Array.isArray(act.scenes)) {
        scenes.push(...act.scenes);
      }
    }
    if (scenes.length > 0) return scenes;
  }

  // Format: { scenes: [...] }
  if (Array.isArray(data.scenes)) {
    return data.scenes;
  }

  // Format: { scene_descriptions: [...] }
  if (Array.isArray(data.scene_descriptions)) {
    return data.scene_descriptions.map(desc => ({
      description: typeof desc === 'string' ? desc : desc.description || ''
    }));
  }

  // Format: flat array at top level
  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

/**
 * Build a concise state summary for use in validation prompts.
 */
function buildStateSummaryForValidation(state) {
  const parts = [];

  // Characters
  const characters = state.characters || {};
  for (const [name, c] of Object.entries(characters)) {
    const details = [];
    if (c.location && c.location !== 'unknown') details.push(`location: ${c.location}`);
    if (c.injuries?.length > 0) details.push(`injuries: ${c.injuries.join(', ')}`);
    if (c.possessions?.length > 0) details.push(`possessions: ${c.possessions.join(', ')}`);
    if (c.knowledge?.length > 0) details.push(`knows: ${c.knowledge.slice(-3).join('; ')}`);

    if (details.length > 0) {
      parts.push(`${name}: ${details.join(' | ')}`);
    }
  }

  // World facts
  if (state.worldFacts?.length > 0) {
    parts.push('World: ' + state.worldFacts.slice(-3).join('; '));
  }

  // Timeline
  if (state.timeline?.length > 0) {
    const recent = state.timeline.slice(-3);
    parts.push('Recent: ' + recent.map(e => `[S${e.scene}] ${e.event}`).join('; '));
  }

  return parts.length > 0 ? parts.join('\n') : 'No established state yet.';
}

/**
 * Apply character updates from LLM extraction to the state.
 */
function applyCharacterUpdates(state, updates) {
  if (!updates || typeof updates !== 'object') return;

  for (const [name, changes] of Object.entries(updates)) {
    // Create the character entry if it doesn't exist yet
    if (!state.characters[name]) {
      state.characters[name] = createEmptyCharacterState(name);
    }

    const char = state.characters[name];

    // Update location
    if (changes.location && typeof changes.location === 'string') {
      char.location = changes.location;
    }

    // Append new knowledge
    if (Array.isArray(changes.new_knowledge)) {
      for (const k of changes.new_knowledge) {
        if (typeof k === 'string' && k.trim()) {
          char.knowledge.push(k.trim());
        }
      }
      // Cap knowledge to prevent unbounded growth
      if (char.knowledge.length > 15) {
        char.knowledge = char.knowledge.slice(-15);
      }
    }

    // Add injuries
    if (Array.isArray(changes.injuries_gained)) {
      for (const injury of changes.injuries_gained) {
        if (typeof injury === 'string' && injury.trim()) {
          char.injuries.push(injury.trim());
        }
      }
    }

    // Remove healed injuries
    if (Array.isArray(changes.injuries_healed)) {
      const healedSet = new Set(changes.injuries_healed.map(i =>
        typeof i === 'string' ? i.toLowerCase().trim() : ''
      ));
      char.injuries = char.injuries.filter(
        i => !healedSet.has(i.toLowerCase().trim())
      );
    }

    // Add gained items
    if (Array.isArray(changes.items_gained)) {
      for (const item of changes.items_gained) {
        if (typeof item === 'string' && item.trim()) {
          char.possessions.push(item.trim());
        }
      }
    }

    // Remove lost items
    if (Array.isArray(changes.items_lost)) {
      const lostSet = new Set(changes.items_lost.map(i =>
        typeof i === 'string' ? i.toLowerCase().trim() : ''
      ));
      char.possessions = char.possessions.filter(
        p => !lostSet.has(p.toLowerCase().trim())
      );
    }

    // Merge relationships
    if (changes.new_relationships && typeof changes.new_relationships === 'object') {
      for (const [otherChar, desc] of Object.entries(changes.new_relationships)) {
        if (typeof desc === 'string') {
          char.relationships[otherChar] = desc;
        }
      }
    }
  }
}

/**
 * Add new characters discovered in a scene to the state.
 */
function applyNewCharacters(state, newChars) {
  if (!newChars || typeof newChars !== 'object') return;

  for (const [name, info] of Object.entries(newChars)) {
    // Don't overwrite existing characters
    if (state.characters[name]) continue;

    state.characters[name] = {
      location: info?.location || 'unknown',
      knowledge: [],
      injuries: [],
      possessions: [],
      relationships: {},
      traits: Array.isArray(info?.traits) ? info.traits : [],
      physicalDescription: info?.physicalDescription || ''
    };

    logger.debug(`[StoryState] New character discovered: ${name}`);
  }
}

/**
 * Add new plot threads from a scene.
 */
function applyNewPlotThreads(state, newThreads, sceneIndex) {
  if (!Array.isArray(newThreads)) return;

  const nextId = state.plotThreads.length + 1;

  for (let i = 0; i < newThreads.length; i++) {
    const desc = newThreads[i];
    if (typeof desc !== 'string' || !desc.trim()) continue;

    state.plotThreads.push({
      id: `thread_${nextId + i}`,
      description: desc.trim().substring(0, 200),
      status: 'open',
      lastReferencedScene: sceneIndex
    });
  }
}

/**
 * Mark plot threads as resolved based on LLM extraction.
 * Uses loose string matching since the LLM's description may differ from the stored one.
 */
function resolveCompletedThreads(state, resolvedDescriptions, sceneIndex) {
  if (!Array.isArray(resolvedDescriptions) || resolvedDescriptions.length === 0) return;

  const resolvedLower = resolvedDescriptions
    .filter(d => typeof d === 'string')
    .map(d => d.toLowerCase().trim());

  for (const thread of state.plotThreads) {
    if (thread.status !== 'open') continue;

    const threadLower = thread.description.toLowerCase();

    // Check for loose match: any resolved description shares significant words with the thread
    for (const resolved of resolvedLower) {
      const resolvedWords = resolved.split(/\s+/).filter(w => w.length > 4);
      const matchingWords = resolvedWords.filter(w => threadLower.includes(w));

      // If 40%+ of significant words match, consider it resolved
      if (resolvedWords.length > 0 && matchingWords.length / resolvedWords.length >= 0.4) {
        thread.status = 'resolved';
        thread.lastReferencedScene = sceneIndex;
        logger.debug(`[StoryState] Thread resolved: "${thread.description.substring(0, 60)}..."`);
        break;
      }
    }
  }
}

/**
 * Mark open threads as "referenced" if keywords from their description appear in the scene.
 * This prevents them from being flagged as "forgotten."
 */
function markReferencedThreads(state, sceneText, sceneIndex) {
  if (!sceneText || !state.plotThreads) return;

  const sceneLower = sceneText.toLowerCase();

  for (const thread of state.plotThreads) {
    if (thread.status !== 'open') continue;

    // Extract significant words from the thread description (5+ chars)
    const keywords = thread.description
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4);

    // If 30%+ of keywords appear in the scene, consider it referenced
    if (keywords.length > 0) {
      const matches = keywords.filter(w => sceneLower.includes(w));
      if (matches.length / keywords.length >= 0.3) {
        thread.lastReferencedScene = sceneIndex;
      }
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeStoryState,
  formatStateForPrompt,
  validateSceneConsistency,
  updateStoryState,
  saveStoryState,
  loadStoryState
};
