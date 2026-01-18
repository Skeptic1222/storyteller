/**
 * Consolidator Agent (Pass 5)
 * Final pass: deduplicates, merges, validates, and produces clean output
 * Applies inferences from gap analysis
 */

import { logger } from '../../../utils/logger.js';

export async function consolidateExtraction(extractedData, relationships, inferences, openai) {
  logger.info('[Consolidator] Starting consolidation');

  const { characters, world, locations, items, factions, lore, events } = extractedData;

  // Apply character inferences
  const enhancedCharacters = characters.map(char => {
    const inference = inferences.character_inferences?.find(
      i => i.name?.toLowerCase() === char.name?.toLowerCase()
    );

    if (!inference) return char;

    const enhanced = { ...char };

    // Apply inferred values for unknown/missing fields
    for (const [field, data] of Object.entries(inference.inferred_fields || {})) {
      if (data?.value && data.confidence !== 'low') {
        // Only apply if current value is unknown/missing and confidence is not low
        if (!enhanced[field] || enhanced[field] === 'unknown' || enhanced[field] === '') {
          enhanced[field] = data.value;
          enhanced[`${field}_inferred`] = true;
          enhanced[`${field}_confidence`] = data.confidence;
        }
      }
    }

    return enhanced;
  });

  // Apply location inferences
  const enhancedLocations = locations.map(loc => {
    const inference = inferences.location_inferences?.find(
      i => i.name?.toLowerCase() === loc.name?.toLowerCase()
    );

    if (!inference) return loc;

    const enhanced = { ...loc };

    for (const [field, data] of Object.entries(inference.inferred_fields || {})) {
      if (data?.value && data.confidence !== 'low') {
        if (!enhanced[field] || enhanced[field] === '') {
          enhanced[field] = data.value;
          enhanced[`${field}_inferred`] = true;
        }
      }
    }

    return enhanced;
  });

  // Enhance world with additional details
  const enhancedWorld = {
    ...world,
    ...(inferences.world_enhancements || {})
  };

  // Deduplicate characters by name similarity
  const deduplicatedCharacters = deduplicateByName(enhancedCharacters);
  const deduplicatedLocations = deduplicateByName(enhancedLocations);
  const deduplicatedItems = deduplicateByName(items || []);
  const deduplicatedFactions = deduplicateByName(factions || []);
  const deduplicatedLore = deduplicateByTitle(lore);

  // Build final character connections from relationships
  const characterConnections = buildCharacterConnections(
    deduplicatedCharacters,
    relationships.character_relationships || []
  );

  // Build location hierarchy
  const locationHierarchy = buildLocationHierarchy(
    deduplicatedLocations,
    relationships.location_hierarchy || []
  );

  // Create synopsis if suggested
  const synopsis = inferences.synopsis_suggestion || null;
  logger.info(`[Consolidator] Synopsis from inferences: ${synopsis ? `title="${synopsis.title}", synopsis=${synopsis.synopsis?.length || 0} chars` : 'none'}`);
  if (synopsis && !synopsis.synopsis) {
    logger.warn('[Consolidator] Synopsis has title but no synopsis text - gap analyzer may not have generated it');
  }

  // Deduplicate and normalize events
  const deduplicatedEvents = deduplicateByName(events || []);

  const result = {
    characters: deduplicatedCharacters.map(normalizeCharacter),
    world: normalizeWorld(enhancedWorld),
    locations: deduplicatedLocations.map(normalizeLocation),
    items: deduplicatedItems.map(normalizeItem),
    factions: deduplicatedFactions.map(normalizeFaction),
    lore: deduplicatedLore.map(normalizeLore),
    events: deduplicatedEvents.map(normalizeEvent),  // PHASE 3 FIX: Include events
    relationships: characterConnections,
    synopsis: synopsis,
    metadata: {
      extraction_complete: true,
      total_characters: deduplicatedCharacters.length,
      total_locations: deduplicatedLocations.length,
      total_items: deduplicatedItems.length,
      total_factions: deduplicatedFactions.length,
      total_lore: deduplicatedLore.length,
      total_events: deduplicatedEvents.length,  // PHASE 3 FIX: Track event count
      total_relationships: characterConnections.length,
      quality_assessment: inferences.quality_assessment || {},
      has_world: !!world?.name,
      has_synopsis: !!synopsis?.synopsis
    }
  };

  logger.info(`[Consolidator] Consolidation complete - ${result.metadata.total_characters} characters, ${result.metadata.total_locations} locations, ${result.metadata.total_items} items, ${result.metadata.total_factions} factions, ${result.metadata.total_lore} lore entries, ${result.metadata.total_events} events`);

  return {
    success: true,
    data: result
  };
}

// Deduplicate characters by similar names
function deduplicateByName(items) {
  const seen = new Map();

  for (const item of items) {
    const key = normalizeNameKey(item.name);
    if (!key) continue;

    if (seen.has(key)) {
      // Merge with existing
      const existing = seen.get(key);
      seen.set(key, mergeItems(existing, item));
    } else {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

function deduplicateByTitle(items) {
  const seen = new Map();

  for (const item of items) {
    const key = item.title?.toLowerCase().trim();
    if (!key) continue;

    if (seen.has(key)) {
      const existing = seen.get(key);
      // Keep the one with more content
      if ((item.content?.length || 0) > (existing.content?.length || 0)) {
        seen.set(key, { ...existing, ...item });
      }
    } else {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

function normalizeNameKey(name) {
  if (!name) return null;
  // Remove titles, normalize spacing, lowercase
  return name.toLowerCase()
    .replace(/^(mr|mrs|ms|dr|prof|sir|lady|lord|king|queen|prince|princess)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeItems(a, b) {
  const result = { ...a };

  for (const [key, value] of Object.entries(b)) {
    if (value && (!result[key] || result[key] === 'unknown' || result[key] === '')) {
      result[key] = value;
    } else if (Array.isArray(value) && Array.isArray(result[key])) {
      result[key] = [...new Set([...result[key], ...value])];
    }
  }

  return result;
}

function buildCharacterConnections(characters, relationships) {
  const nameToId = new Map();
  characters.forEach((c, idx) => {
    nameToId.set(c.name?.toLowerCase(), `char_${idx}`);
  });

  // PHASE 2 FIX: Preserve ALL relationship fields from extraction
  return relationships.map(rel => ({
    character_a: rel.character_a,
    character_b: rel.character_b,
    relationship_type: rel.relationship_type,
    relationship_category: rel.relationship_category,
    relationship_label: rel.relationship_label || `${rel.relationship_type} relationship`,
    is_directional: !rel.is_bidirectional && (rel.is_directional !== false),
    reverse_relationship_type: rel.reverse_type || rel.reverse_relationship_type,
    description: rel.description || '',
    evidence: rel.evidence,
    strength: rel.strength || 'moderate',
    current_status: rel.status || 'active',
    dynamics: rel.dynamics || '',
    key_events: rel.key_events || []
  })).filter(rel =>
    // Only include if both characters exist
    characters.some(c => c.name?.toLowerCase() === rel.character_a?.toLowerCase()) &&
    characters.some(c => c.name?.toLowerCase() === rel.character_b?.toLowerCase())
  );
}

function buildLocationHierarchy(locations, hierarchy) {
  // Add parent references to locations
  return locations.map(loc => {
    const parentRef = hierarchy.find(h => h.child?.toLowerCase() === loc.name?.toLowerCase());
    if (parentRef) {
      return { ...loc, parent_name: parentRef.parent };
    }
    return loc;
  });
}

// Generate a clear vital status summary for LLM consumption
function generateVitalStatusSummary(char) {
  if (char.vital_status_summary) return char.vital_status_summary;

  const isDeceased = char.is_deceased || false;

  if (isDeceased) {
    const cause = char.death_details?.cause || char.death_context || 'unknown circumstances';
    const timing = char.death_details?.timing || '';
    const killer = char.death_details?.killer ? ` by ${char.death_details.killer}` : '';

    if (typeof cause === 'string' && cause.length > 5) {
      return `DECEASED - ${cause}${killer}${timing ? ` (${timing})` : ''}`;
    }
    return 'DECEASED - Details unknown';
  }

  // Alive character
  const role = char.role || 'character';
  const occupation = char.occupation ? ` - ${char.occupation}` : '';
  return `ALIVE - ${role.charAt(0).toUpperCase() + role.slice(1)}${occupation}`;
}

// Normalize to match database schema - include ALL extracted fields
function normalizeCharacter(char) {
  const isDeceased = char.is_deceased || false;

  return {
    // Identity
    name: char.name || 'Unknown',
    display_name: char.display_name || null,
    aliases: char.aliases || [],
    gender: char.gender || 'unknown',
    age_group: char.age_group || 'unknown',
    age_specific: char.age_specific || null,
    species: char.species || 'human',

    // Animal companion fields (PHASE 1 FIX)
    is_animal_companion: char.is_animal_companion || false,
    companion_to: char.companion_to || null,

    // ========== VITAL STATUS (CRITICAL FOR STORY GENERATION) ==========
    // These fields determine if character can appear alive in generated content
    is_alive: char.is_alive !== undefined ? char.is_alive : !isDeceased,
    is_deceased: isDeceased,
    vital_status_summary: generateVitalStatusSummary(char),
    death_details: char.death_details || null,
    death_context: char.death_context || null, // Legacy field for backward compatibility
    // ==================================================================

    // Role & Story
    role: char.role || 'minor',
    is_historical: char.is_historical || false,
    faction_allegiance: char.faction_allegiance || null,

    // Physical
    description: char.description || '',
    appearance: char.appearance || null,
    clothing_style: char.clothing_style || null,
    physical_condition: char.physical_condition || null,

    // Personality (comprehensive)
    personality: char.personality || '',
    traits: char.traits || [],
    values: char.values || null,
    fears: char.fears || null,
    flaws: char.flaws || null,
    strengths: char.strengths || null,

    // Background (detailed)
    backstory: char.backstory || null,
    occupation: char.occupation || null,
    former_occupations: char.former_occupations || [],
    social_status: char.social_status || null,
    education: char.education || null,
    origin: char.origin || null,

    // Abilities & Skills
    abilities: char.abilities || [],
    skills: char.skills || [],
    weaknesses: char.weaknesses || [],
    signature_moves: char.signature_moves || [],

    // Psychology & Motivation
    motivations: char.motivations || null,
    secrets: char.secrets || null,
    internal_conflicts: char.internal_conflicts || null,
    external_conflicts: char.external_conflicts || null,

    // Social connections
    enemies: char.enemies || [],
    allies: char.allies || [],
    romantic_interests: char.romantic_interests || [],
    family: char.family || [],

    // Voice & Narrative
    voice_description: char.voice_description || null,
    dialogue_style: char.dialogue_style || null,
    first_appearance_context: char.first_appearance_context || null,
    character_arc: char.character_arc || null,
    symbolic_role: char.symbolic_role || null,

    // Metadata
    _inferred: {
      gender: char.gender_inferred || false,
      age_group: char.age_group_inferred || false,
      voice_description: char.voice_description_inferred || false,
      appearance: char.appearance_inferred || false
    },
    _confidence: char.confidence || 'medium',
    _extraction_notes: char.extraction_notes || null
  };
}

function normalizeWorld(world) {
  return {
    name: world.name || 'Unnamed World',
    description: world.description || '',
    genre: world.genre || 'other',
    time_period: world.time_period || '',
    technology_level: world.technology_level || null,
    magic_system: world.magic_system || null,
    society_structure: world.society_structure || null,
    tone: world.tone || 'mixed',
    themes: world.themes || [],
    visual_style: world.visual_style || ''
  };
}

function normalizeLocation(loc) {
  return {
    name: loc.name || 'Unknown Location',
    location_type: loc.location_type || 'other',
    description: loc.description || '',
    atmosphere: loc.atmosphere || '',
    parent_name: loc.parent_name || null,
    features: loc.features || [],
    _confidence: loc.confidence || 'medium'
  };
}

function normalizeLore(lore) {
  return {
    entry_type: lore.entry_type || 'custom',
    title: lore.title || 'Untitled',
    content: lore.content || '',
    importance: lore.importance || 50,
    tags: lore.tags || []
  };
}

function normalizeItem(item) {
  return {
    name: item.name || 'Unknown Item',
    item_type: item.item_type || 'misc',
    subtype: item.subtype || null,
    description: item.description || '',
    appearance: item.appearance || null,
    size: item.size || 'medium',
    material: item.material || null,
    condition: item.condition || 'good',
    magical_properties: item.magical_properties || null,
    mundane_properties: item.mundane_properties || null,
    abilities: item.abilities || [],
    limitations: item.limitations || [],
    rarity: item.rarity || 'common',
    value_description: item.value_description || null,
    current_owner: item.current_owner || null,
    current_location: item.current_location || null,
    origin: item.origin || null,
    creator: item.creator || null,
    history: item.history || null,
    stats_json: item.stats_json || null,
    attunement_required: item.attunement_required || false,
    importance: item.importance || 50,
    _confidence: item.confidence || 'medium'
  };
}

function normalizeFaction(faction) {
  return {
    name: faction.name || 'Unknown Faction',
    faction_type: faction.faction_type || 'organization',
    description: faction.description || '',
    motto: faction.motto || null,
    goals: faction.goals || [],
    values: faction.values || [],
    methods: faction.methods || null,
    headquarters: faction.headquarters || null,
    territory: faction.territory || null,
    symbol: faction.symbol || null,
    colors: faction.colors || null,
    leadership_structure: faction.leadership_structure || null,
    leader_name: faction.leader_name || null,
    founding_date: faction.founding_date || null,
    founding_story: faction.founding_story || null,
    public_perception: faction.public_perception || null,
    secret_nature: faction.secret_nature || null,
    resources: faction.resources || [],
    allies: faction.allies || [],
    enemies: faction.enemies || [],
    alignment: faction.alignment || 'neutral',
    member_count: faction.member_count || null,
    recruitment: faction.recruitment || null,
    ranks: faction.ranks || [],
    rituals: faction.rituals || null,
    importance: faction.importance || 50,
    _confidence: faction.confidence || 'medium'
  };
}

// PHASE 3 FIX: Normalize events to match database schema
function normalizeEvent(event) {
  return {
    name: event.name || 'Unnamed Event',
    description: event.description || '',
    event_type: event.event_type || 'action',
    importance: event.importance || 'major',
    suggested_timing: event.suggested_timing || 'any',
    characters_involved: event.characters_involved || [],
    factions_involved: event.factions_involved || [],
    location_name: event.location_name || null,
    location_notes: event.location_notes || null,
    prerequisites: event.prerequisites || [],
    consequences: event.consequences || [],
    emotional_tone: event.emotional_tone || null,
    stakes: event.stakes || null,
    conflict_type: event.conflict_type || null,
    key_elements: event.key_elements || [],
    dialogue_hints: event.dialogue_hints || null,
    visual_details: event.visual_details || null,
    tags: event.tags || [],
    confidence: event.confidence || 'medium',
    extraction_notes: event.extraction_notes || null
  };
}
