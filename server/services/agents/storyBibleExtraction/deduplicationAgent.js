/**
 * Deduplication Agent (Pass 4.5)
 * Runs after all entity extraction to identify and resolve cross-category duplicates
 *
 * Problems it solves:
 * 1. Same entity appears in multiple categories (e.g., Gyrocopter in both Items and Locations)
 * 2. Named animals extracted as both Characters and Lore "creatures"
 * 3. Organizations extracted as both Factions and Lore "factions"
 * 4. Similar names with slight variations (e.g., "Sir John" and "John")
 */

import { logger } from '../../../utils/logger.js';

/**
 * Main deduplication function
 * @param {Object} extractedData - All extracted entities
 * @param {Object} openai - OpenAI client
 * @returns {Object} Deduplicated data with corrections
 */
export async function deduplicateEntities(extractedData, openai) {
  logger.info('[Deduplication] Starting cross-category deduplication');

  const {
    characters = [],
    locations = [],
    items = [],
    factions = [],
    lore = [],
    events = [],
    world = {}
  } = extractedData;

  // Build entity index for duplicate detection
  const entityIndex = buildEntityIndex(characters, locations, items, factions, lore);

  // Find potential duplicates
  const duplicates = findDuplicates(entityIndex);

  if (duplicates.length === 0) {
    logger.info('[Deduplication] No duplicates found');
    return {
      ...extractedData,
      deduplication: {
        duplicates_found: 0,
        corrections: []
      }
    };
  }

  logger.info(`[Deduplication] Found ${duplicates.length} potential duplicates, consulting LLM for resolution`);

  // Use LLM to determine correct category for each duplicate
  const corrections = await resolveWithLLM(duplicates, openai);

  // Apply corrections
  const correctedData = applyCorrections(extractedData, corrections);

  logger.info(`[Deduplication] Applied ${corrections.length} corrections`);

  return {
    ...correctedData,
    deduplication: {
      duplicates_found: duplicates.length,
      corrections: corrections
    }
  };
}

/**
 * Build an index of all entity names for comparison
 */
function buildEntityIndex(characters, locations, items, factions, lore) {
  const index = [];

  // Add characters
  for (const char of characters) {
    index.push({
      name: char.name,
      normalizedName: normalizeName(char.name),
      category: 'character',
      data: char
    });
  }

  // Add locations
  for (const loc of locations) {
    index.push({
      name: loc.name,
      normalizedName: normalizeName(loc.name),
      category: 'location',
      data: loc
    });
  }

  // Add items
  for (const item of items) {
    index.push({
      name: item.name,
      normalizedName: normalizeName(item.name),
      category: 'item',
      data: item
    });
  }

  // Add factions
  for (const faction of factions) {
    index.push({
      name: faction.name,
      normalizedName: normalizeName(faction.name),
      category: 'faction',
      data: faction
    });
  }

  // Add lore
  for (const entry of lore) {
    index.push({
      name: entry.title,
      normalizedName: normalizeName(entry.title),
      category: 'lore',
      data: entry
    });
  }

  return index;
}

/**
 * Normalize name for comparison
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find potential duplicates across categories
 */
function findDuplicates(entityIndex) {
  const duplicates = [];
  const seen = new Map();

  for (const entity of entityIndex) {
    const key = entity.normalizedName;

    if (seen.has(key)) {
      const existing = seen.get(key);
      // Only flag as duplicate if in different categories
      if (existing.category !== entity.category) {
        // Check if this pair already exists
        const existingDup = duplicates.find(d =>
          d.entities.some(e => e.normalizedName === key) &&
          d.entities.some(e => e.category === entity.category)
        );

        if (existingDup) {
          existingDup.entities.push(entity);
        } else {
          duplicates.push({
            normalizedName: key,
            entities: [existing, entity]
          });
        }
      }
    } else {
      seen.set(key, entity);
    }
  }

  // Also check for partial matches (e.g., "Sir John" vs "John")
  const partialDuplicates = findPartialMatches(entityIndex);
  duplicates.push(...partialDuplicates);

  return duplicates;
}

/**
 * Find partial name matches that might be duplicates
 */
function findPartialMatches(entityIndex) {
  const duplicates = [];
  const checked = new Set();

  for (let i = 0; i < entityIndex.length; i++) {
    for (let j = i + 1; j < entityIndex.length; j++) {
      const a = entityIndex[i];
      const b = entityIndex[j];

      // Skip if same category
      if (a.category === b.category) continue;

      // Skip if already exact match (handled above)
      if (a.normalizedName === b.normalizedName) continue;

      // Skip already checked pairs
      const pairKey = [a.normalizedName, b.normalizedName].sort().join('|');
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      // Check for partial match
      if (isPartialMatch(a.normalizedName, b.normalizedName)) {
        duplicates.push({
          normalizedName: `${a.normalizedName} / ${b.normalizedName}`,
          entities: [a, b],
          isPartialMatch: true
        });
      }
    }
  }

  return duplicates;
}

/**
 * Check if two names are partial matches
 */
function isPartialMatch(name1, name2) {
  // One contains the other
  if (name1.includes(name2) || name2.includes(name1)) {
    // Avoid matching single common words
    if (name1.length < 4 || name2.length < 4) return false;
    return true;
  }

  // Check word overlap
  const words1 = new Set(name1.split(' '));
  const words2 = new Set(name2.split(' '));

  const intersection = [...words1].filter(w => words2.has(w) && w.length > 3);

  // If more than 60% of shorter name's words overlap, likely same entity
  const minWords = Math.min(words1.size, words2.size);
  if (minWords > 0 && intersection.length / minWords >= 0.6) {
    return true;
  }

  return false;
}

/**
 * Use LLM to determine correct category for duplicates
 */
async function resolveWithLLM(duplicates, openai) {
  if (duplicates.length === 0) return [];

  const systemPrompt = `You are an expert at categorizing story elements. For each duplicate entry, determine the CORRECT single category.

CATEGORY DEFINITIONS:
- character: Living beings (people, named animals, sentient creatures) that can take actions
- location: Physical places (buildings, cities, regions, planets)
- item: Physical objects that can be owned/used (weapons, vehicles, artifacts, tools)
- faction: Organizations/groups with multiple members (guilds, kingdoms, companies)
- lore: Abstract knowledge (history, rules, customs, prophecies) - NOT physical things

RULES:
1. Named vehicles (like "The Gyrocopter", "Millennium Falcon") → item (NOT location)
2. Named animals with personality/owners (like "Seamus the dog") → character (NOT lore creature)
3. Buildings with organizational function → location (the place), but the organization → faction
4. Specific named objects → item, general item types → lore
5. Specific named groups → faction, general social structures → lore

Return JSON array of decisions:
[
  {
    "name": "entity name",
    "correct_category": "character|location|item|faction|lore",
    "remove_from": ["categories to remove from"],
    "reasoning": "brief explanation"
  }
]`;

  const duplicateDescriptions = duplicates.map(dup => {
    const entities = dup.entities.map(e =>
      `- ${e.category.toUpperCase()}: "${e.name}" - ${e.data.description?.slice(0, 100) || 'no description'}`
    ).join('\n');
    return `\nDUPLICATE GROUP: "${dup.normalizedName}"\n${entities}`;
  }).join('\n---');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resolve these duplicates:\n${duplicateDescriptions}` }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 4000
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{"decisions":[]}');
    return result.decisions || result || [];

  } catch (error) {
    logger.error('[Deduplication] LLM resolution failed:', error);
    return [];
  }
}

/**
 * Apply corrections to the extracted data
 */
function applyCorrections(extractedData, corrections) {
  const corrected = {
    characters: [...extractedData.characters],
    locations: [...extractedData.locations],
    items: [...extractedData.items],
    factions: [...extractedData.factions],
    lore: [...extractedData.lore],
    events: [...(extractedData.events || [])],
    world: extractedData.world
  };

  for (const correction of corrections) {
    const normalizedName = normalizeName(correction.name);

    // Remove from incorrect categories
    for (const category of (correction.remove_from || [])) {
      switch (category) {
        case 'character':
          corrected.characters = corrected.characters.filter(
            c => normalizeName(c.name) !== normalizedName
          );
          break;
        case 'location':
          corrected.locations = corrected.locations.filter(
            l => normalizeName(l.name) !== normalizedName
          );
          break;
        case 'item':
          corrected.items = corrected.items.filter(
            i => normalizeName(i.name) !== normalizedName
          );
          break;
        case 'faction':
          corrected.factions = corrected.factions.filter(
            f => normalizeName(f.name) !== normalizedName
          );
          break;
        case 'lore':
          corrected.lore = corrected.lore.filter(
            l => normalizeName(l.title) !== normalizedName
          );
          break;
      }
    }

    logger.info(`[Deduplication] Resolved "${correction.name}" → ${correction.correct_category} (removed from: ${correction.remove_from?.join(', ') || 'none'})`);
  }

  return corrected;
}

/**
 * Within-category deduplication (merge similar entries)
 */
export function deduplicateWithinCategory(items, keyField = 'name') {
  const seen = new Map();

  for (const item of items) {
    const key = normalizeName(item[keyField]);
    if (!key) continue;

    if (seen.has(key)) {
      // Merge with existing
      const existing = seen.get(key);
      seen.set(key, mergeEntities(existing, item));
    } else {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

/**
 * Merge two entities, preferring more detailed information
 */
function mergeEntities(a, b) {
  const result = { ...a };

  for (const [key, value] of Object.entries(b)) {
    if (value === null || value === undefined) continue;
    if (result[key] === null || result[key] === undefined || result[key] === '') {
      result[key] = value;
    } else if (Array.isArray(value) && Array.isArray(result[key])) {
      result[key] = [...new Set([...result[key], ...value])];
    } else if (typeof value === 'string' && typeof result[key] === 'string') {
      // Keep longer string
      if (value.length > result[key].length) {
        result[key] = value;
      }
    }
  }

  return result;
}
