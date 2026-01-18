/**
 * Relationship Mapper Agent (Pass 3) - ENHANCED VERSION
 * Cross-references all extracted entities and maps relationships
 * Uses multi-pass approach for thorough relationship discovery:
 *   Pass A: Character-Character relationships (family, romantic, professional, social)
 *   Pass B: Entity-Location connections (where characters live/work/were born)
 *   Pass C: Entity-Lore connections and cross-references
 * Takes output from Pass 2 agents and builds comprehensive connection graph
 */

import { logger } from '../../../utils/logger.js';

/**
 * Safely parse JSON with fallback for truncated responses
 */
function safeParseJSON(rawContent, defaultValue = {}) {
  if (!rawContent) return defaultValue;

  try {
    return JSON.parse(rawContent);
  } catch (e) {
    logger.warn('[RelationshipMapper] JSON parse failed, attempting recovery...');

    // Try to fix truncated JSON by finding last complete structure
    let content = rawContent.trim();

    // Count brackets to detect truncation
    let openBrackets = 0;
    let openBraces = 0;
    let inString = false;
    let escapeNext = false;

    for (const char of content) {
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;

      if (char === '[') openBrackets++;
      if (char === ']') openBrackets--;
      if (char === '{') openBraces++;
      if (char === '}') openBraces--;
    }

    // Try to close the JSON
    if (openBrackets > 0 || openBraces > 0) {
      content = content + ']'.repeat(openBrackets) + '}'.repeat(openBraces);
      try {
        const result = JSON.parse(content);
        logger.info('[RelationshipMapper] Recovered JSON by closing brackets');
        return result;
      } catch (e2) {
        // Continue to pattern extraction
      }
    }

    // Try extracting arrays by pattern
    try {
      const result = { ...defaultValue };
      const arrayPatterns = [
        { key: 'character_relationships', pattern: /"character_relationships"\s*:\s*\[([\s\S]*?)\]/ },
        { key: 'character_location_links', pattern: /"character_location_links"\s*:\s*\[([\s\S]*?)\]/ },
        { key: 'character_lore_links', pattern: /"character_lore_links"\s*:\s*\[([\s\S]*?)\]/ },
        { key: 'location_hierarchy', pattern: /"location_hierarchy"\s*:\s*\[([\s\S]*?)\]/ },
        { key: 'lore_connections', pattern: /"lore_connections"\s*:\s*\[([\s\S]*?)\]/ },
        { key: 'faction_memberships', pattern: /"faction_memberships"\s*:\s*\[([\s\S]*?)\]/ }
      ];

      for (const { key, pattern } of arrayPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          try {
            result[key] = JSON.parse('[' + match[1] + ']');
          } catch (e3) {
            result[key] = [];
          }
        }
      }

      return result;
    } catch (e3) {
      logger.error('[RelationshipMapper] Could not recover JSON');
      return defaultValue;
    }
  }
}

/**
 * Build detailed character summaries for relationship context
 */
function buildCharacterContext(characters) {
  return characters.map(c => ({
    name: c.name,
    aliases: c.aliases || [],
    role: c.role,
    occupation: c.occupation,
    age_group: c.age_group,
    age_specific: c.age_specific,
    gender: c.gender,
    family_mentioned: c.family_mentioned,
    affiliations: c.affiliations,
    faction_allegiance: c.faction_allegiance,
    backstory_hints: c.backstory_hints,
    goals: c.goals,
    fears: c.fears,
    secrets: c.secrets,
    is_deceased: c.is_deceased,
    death_context: c.death_context
  }));
}

/**
 * Pass A: Extract Character-Character relationships with deep analysis
 */
async function extractCharacterRelationships(characters, originalText, openai, emit) {
  logger.info('[RelationshipMapper] Pass A: Character-Character relationships');
  if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: 'Analyzing character-to-character relationships...' });

  const charContext = buildCharacterContext(characters);

  const systemPrompt = `You are an expert relationship analyst specializing in narrative fiction. Your task is to identify EVERY relationship between characters - both EXPLICIT (directly stated) and IMPLICIT (inferred from context, behavior, or circumstances).

BE EXHAUSTIVE. For a story with N characters, you should find relationships that create a dense web of connections. Missing relationships is a failure.

RELATIONSHIP CATEGORIES TO IDENTIFY:

FAMILY RELATIONSHIPS (be specific):
- Immediate: spouse, ex-spouse, parent, child, sibling, twin
- Extended: grandparent, grandchild, aunt, uncle, cousin, niece, nephew
- In-law: mother-in-law, father-in-law, brother-in-law, sister-in-law
- Step/adoptive: stepparent, stepchild, stepsibling, adoptive parent/child
- Complex: half-sibling, estranged family member

ROMANTIC RELATIONSHIPS:
- Current: married, engaged, dating, partners, lovers, affair
- Past: ex-spouse, ex-partner, former lover, jilted
- Potential: crush, admirer, romantic interest, unrequited love
- Complicated: love triangle, forbidden love, secret relationship

PROFESSIONAL RELATIONSHIPS:
- Hierarchy: boss, employee, supervisor, subordinate, manager
- Peers: colleague, coworker, business partner, rival
- Service: client, customer, patient, student, teacher, mentor
- Military/Organization: commander, subordinate, fellow member

SOCIAL RELATIONSHIPS:
- Positive: best friend, close friend, friend, ally, confidant, supporter
- Neutral: acquaintance, neighbor, classmate
- Negative: enemy, rival, antagonist, bully, victim
- Complex: frenemy, complicated history, former friend

SPECIAL RELATIONSHIPS:
- Supernatural: bound souls, reincarnations, prophesied connection
- Historical: childhood friends, grew up together, school rivals
- Secret: hidden connection, unknown relationship, disguised identity

INFERENCE RULES:
- If A is B's parent, B is A's child (create both relationships)
- If A and B share a parent, they are siblings
- If A works for the same organization as B, they are colleagues
- If A and B are in the same faction/group, they are allies
- Look for shared surnames, titles, or family names
- Look for shared locations or organizations
- Look for characters mentioned in each other's backstories

Return JSON:
{
  "character_relationships": [
    {
      "character_a": "full name",
      "character_b": "full name",
      "relationship_type": "specific type (e.g., 'mother', not just 'family')",
      "relationship_category": "family|romantic|professional|social|special",
      "is_bidirectional": true/false,
      "reverse_type": "child (if relationship is directional, what is B to A)",
      "description": "detailed context about this relationship from the text",
      "evidence": "quote or reference from text supporting this relationship",
      "strength": "strong|moderate|weak",
      "status": "active|former|deceased|estranged|secret|potential",
      "dynamics": "description of how they interact (loving, tense, complicated, etc.)",
      "key_events": ["any significant events in their relationship"]
    }
  ],
  "family_tree_notes": "observations about family structures and lineages",
  "relationship_density_score": "low|medium|high (how interconnected are the characters)",
  "missing_data_flags": ["any relationships you suspect but lack evidence for"]
}`;

  // Use full text for relationship analysis - relationships are often mentioned throughout
  const textForAnalysis = originalText.length > 50000
    ? originalText.substring(0, 25000) + '\n...[middle section]...\n' + originalText.substring(originalText.length - 25000)
    : originalText;

  const userPrompt = `TASK: Find EVERY relationship between these characters. Be thorough - check each character against every other character.

CHARACTERS TO ANALYZE (${characters.length} total):
${JSON.stringify(charContext, null, 2)}

FULL DOCUMENT TEXT:
${textForAnalysis}

REQUIREMENTS:
1. Check EVERY possible character pair for relationships
2. Include both explicit relationships (stated in text) and inferred ones
3. For family relationships, map the complete family structure
4. Look for aliases - characters may be referred to by different names
5. Include historical/past relationships, not just current ones
6. Flag any characters who seem isolated (no relationships found)`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 12000 // Reduced to avoid truncation
    });

    const result = safeParseJSON(response.choices[0]?.message?.content, { character_relationships: [] });
    const count = result.character_relationships?.length || 0;

    logger.info(`[RelationshipMapper] Pass A complete - Found ${count} character relationships`);
    if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: `Found ${count} character relationships` });

    return {
      character_relationships: result.character_relationships || [],
      family_tree_notes: result.family_tree_notes,
      relationship_density: result.relationship_density_score,
      missing_flags: result.missing_data_flags || [],
      tokens: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[RelationshipMapper] Pass A failed:', error);
    return { character_relationships: [], tokens: 0 };
  }
}

/**
 * Pass B: Extract Entity-Location connections
 */
async function extractLocationConnections(characters, locations, originalText, openai, emit) {
  logger.info('[RelationshipMapper] Pass B: Entity-Location connections');
  if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: 'Mapping character-location connections...' });

  if (!locations.length) {
    logger.info('[RelationshipMapper] Pass B skipped - no locations');
    return { character_location_links: [], location_hierarchy: [], tokens: 0 };
  }

  const systemPrompt = `You are a location analyst for narrative fiction. Map ALL connections between characters and locations.

CONNECTION TYPES TO IDENTIFY:

CHARACTER-LOCATION:
- Residence: lives_at, lived_at, grew_up_at, born_at, hometown
- Work: works_at, worked_at, owns, manages, runs
- Authority: rules, governs, commands, controls, protects
- Captivity: imprisoned_at, confined_to, exiled_to, trapped_at
- Travel: visits, frequents, travels_to, journeys_through
- Events: died_at, married_at, discovered_at, attacked_at
- Association: known_for, associated_with, famous_at
- Hidden: hiding_at, secret_base, refuge

LOCATION-LOCATION HIERARCHY:
- contains (city contains neighborhood)
- part_of (room part_of building)
- district_of (district part_of city)
- region_of (province part_of country)
- borders (shares boundary)
- connected_to (road, path, portal connects)
- opposite_of (north_district vs south_district)

Return JSON:
{
  "character_location_links": [
    {
      "character": "name",
      "location": "name",
      "link_type": "specific type",
      "time_period": "current|past|future|unknown",
      "description": "context from text",
      "significance": "why this connection matters to the story"
    }
  ],
  "location_hierarchy": [
    {
      "child_location": "name",
      "parent_location": "name",
      "relationship": "type",
      "description": "context"
    }
  ],
  "location_ownership": [
    {
      "location": "name",
      "owner": "character name or faction",
      "ownership_type": "owns|controls|governs|protects"
    }
  ]
}`;

  const charNames = characters.map(c => `${c.name}${c.aliases?.length ? ` (aliases: ${c.aliases.join(', ')})` : ''}`);
  const locDetails = locations.map(l => ({ name: l.name, type: l.type, description: l.description?.substring(0, 200) }));

  const userPrompt = `Map all connections between characters and locations.

CHARACTERS (${characters.length}):
${charNames.join('\n')}

LOCATIONS (${locations.length}):
${JSON.stringify(locDetails, null, 2)}

TEXT FOR REFERENCE:
${originalText.substring(0, 40000)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = safeParseJSON(response.choices[0]?.message?.content, {
      character_location_links: [],
      location_hierarchy: [],
      location_ownership: []
    });
    const linkCount = result.character_location_links?.length || 0;
    const hierCount = result.location_hierarchy?.length || 0;

    logger.info(`[RelationshipMapper] Pass B complete - Found ${linkCount} char-loc links, ${hierCount} location hierarchies`);
    if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: `Found ${linkCount} location connections` });

    return {
      character_location_links: result.character_location_links || [],
      location_hierarchy: result.location_hierarchy || [],
      location_ownership: result.location_ownership || [],
      tokens: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[RelationshipMapper] Pass B failed:', error);
    return { character_location_links: [], location_hierarchy: [], tokens: 0 };
  }
}

/**
 * Pass C: Extract Entity-Lore connections and cross-references
 */
async function extractLoreConnections(characters, locations, lore, originalText, openai, emit) {
  logger.info('[RelationshipMapper] Pass C: Entity-Lore connections');
  if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: 'Analyzing lore and item connections...' });

  if (!lore.length) {
    logger.info('[RelationshipMapper] Pass C skipped - no lore');
    return { character_lore_links: [], lore_connections: [], tokens: 0 };
  }

  const systemPrompt = `You are a lore analyst for narrative fiction. Map ALL connections between characters/locations and lore entries (items, artifacts, magic, history, organizations, creatures, etc.).

CHARACTER-LORE CONNECTIONS:
- Knowledge: knows_about, discovered, learned, researches, studies
- Creation: created, invented, wrote, crafted, forged
- Possession: owns, carries, wields, inherited, stole
- Quest: seeks, hunts_for, protects, guards, destroyed
- Binding: bound_to, cursed_by, blessed_by, marked_by
- Authority: leads (organization), member_of, founded, commands
- Opposition: opposes, fights_against, hunted_by, enemy_of

LOCATION-LORE CONNECTIONS:
- Contains: houses, stores, hidden_at, origin_of
- History: battle_site, founded_by, destroyed_by
- Magic: enchanted_by, source_of, corrupted_by

LORE-LORE CONNECTIONS:
- Hierarchy: part_of, subset_of, component_of
- Relationship: related_to, derived_from, opposes
- Dependency: requires, unlocks, activates
- History: preceded_by, evolved_into, replaced

Return JSON:
{
  "character_lore_links": [
    {
      "character": "name",
      "lore_entry": "title",
      "link_type": "specific type",
      "description": "context",
      "importance": "critical|major|minor"
    }
  ],
  "location_lore_links": [
    {
      "location": "name",
      "lore_entry": "title",
      "link_type": "type",
      "description": "context"
    }
  ],
  "lore_connections": [
    {
      "lore_a": "title",
      "lore_b": "title",
      "connection_type": "type",
      "description": "how they relate"
    }
  ],
  "faction_memberships": [
    {
      "character": "name",
      "faction": "organization/group name",
      "role": "leader|member|agent|enemy",
      "status": "active|former|secret"
    }
  ]
}`;

  const charNames = characters.map(c => c.name);
  const locNames = locations.map(l => l.name);
  const loreDetails = lore.map(l => ({ title: l.title, category: l.category, description: l.description?.substring(0, 300) }));

  const userPrompt = `Map all connections between entities and lore.

CHARACTERS: ${charNames.join(', ')}

LOCATIONS: ${locNames.join(', ')}

LORE ENTRIES (${lore.length}):
${JSON.stringify(loreDetails, null, 2)}

TEXT FOR REFERENCE:
${originalText.substring(0, 40000)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 8000
    });

    const result = safeParseJSON(response.choices[0]?.message?.content, {
      character_lore_links: [],
      location_lore_links: [],
      lore_connections: [],
      faction_memberships: []
    });
    const charLoreCount = result.character_lore_links?.length || 0;
    const loreConnCount = result.lore_connections?.length || 0;

    logger.info(`[RelationshipMapper] Pass C complete - Found ${charLoreCount} char-lore links, ${loreConnCount} lore connections`);
    if (emit) emit('extraction:agent-detail', { agent: 'relationships', detail: `Found ${charLoreCount + loreConnCount} lore connections` });

    return {
      character_lore_links: result.character_lore_links || [],
      location_lore_links: result.location_lore_links || [],
      lore_connections: result.lore_connections || [],
      faction_memberships: result.faction_memberships || [],
      tokens: response.usage?.total_tokens || 0
    };
  } catch (error) {
    logger.error('[RelationshipMapper] Pass C failed:', error);
    return { character_lore_links: [], lore_connections: [], tokens: 0 };
  }
}

/**
 * Main entry point - runs all three passes for comprehensive relationship mapping
 */
export async function mapRelationships(extractedData, originalText, openai, emit) {
  logger.info('[RelationshipMapper] Starting comprehensive relationship mapping (3 passes)');

  const { characters = [], world = {}, locations = [], lore = [] } = extractedData;

  // Run all three passes
  const passAResults = await extractCharacterRelationships(characters, originalText, openai, emit);
  const passBResults = await extractLocationConnections(characters, locations, originalText, openai, emit);
  const passCResults = await extractLoreConnections(characters, locations, lore, originalText, openai, emit);

  // Combine all results
  const totalRelationships =
    (passAResults.character_relationships?.length || 0) +
    (passBResults.character_location_links?.length || 0) +
    (passBResults.location_hierarchy?.length || 0) +
    (passCResults.character_lore_links?.length || 0) +
    (passCResults.lore_connections?.length || 0) +
    (passCResults.faction_memberships?.length || 0);

  const totalTokens =
    (passAResults.tokens || 0) +
    (passBResults.tokens || 0) +
    (passCResults.tokens || 0);

  logger.info(`[RelationshipMapper] All passes complete - Found ${totalRelationships} total relationships`);

  return {
    success: true,
    relationships: {
      character_relationships: passAResults.character_relationships || [],
      character_location_links: passBResults.character_location_links || [],
      character_lore_links: passCResults.character_lore_links || [],
      location_hierarchy: passBResults.location_hierarchy || [],
      location_ownership: passBResults.location_ownership || [],
      location_lore_links: passCResults.location_lore_links || [],
      lore_connections: passCResults.lore_connections || [],
      faction_memberships: passCResults.faction_memberships || []
    },
    metadata: {
      family_tree_notes: passAResults.family_tree_notes,
      relationship_density: passAResults.relationship_density,
      missing_flags: passAResults.missing_flags
    },
    tokens_used: totalTokens
  };
}
