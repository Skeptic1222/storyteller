/**
 * Lore Extractor Agent (Pass 2d)
 * Extracts PURE lore entries: history, rules, events, legends, customs
 *
 * IMPORTANT: This agent extracts ONLY abstract knowledge, NOT physical things:
 * - Characters (people, named creatures) → characterExtractorAgent
 * - Items (objects, vehicles, weapons) → itemExtractorAgent
 * - Factions (organizations, groups) → factionExtractorAgent
 * - Locations (places) → locationExtractorAgent
 *
 * Lore is the "wikipedia" of the world - knowledge ABOUT things, not the things themselves.
 */

import { logger } from '../../../utils/logger.js';

const LORE_TYPES = {
  event: 'Historical or future events (wars, coronations, disasters)',
  rule: 'World rules, natural laws, magic system rules',
  history: 'Historical information, founding stories, past eras',
  legend: 'Myths, legends, prophecies, folklore',
  custom: 'Cultural customs, traditions, holidays, practices',
  species_info: 'General information about species/races (not individual creatures)',
  magic_theory: 'How magic works, magical laws, spell theory',
  religion_doctrine: 'Religious beliefs, doctrines, afterlife concepts',
  language: 'Languages, scripts, communication systems',
  economics: 'Trade, currency, economic systems',
  technology: 'How technology works, tech levels, scientific principles',
  cosmology: 'Universe structure, planes of existence, creation myths',
  timeline: 'Historical timelines, eras, ages'
};

/**
 * Attempts to recover valid JSON from a truncated response
 */
function tryRecoverJSON(rawContent) {
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    // Continue to recovery
  }

  let content = rawContent.trim();
  const loreStart = content.indexOf('"lore"');
  if (loreStart === -1) {
    logger.warn('[LoreExtractor] No lore array found');
    return { lore: [] };
  }

  const arrayStart = content.indexOf('[', loreStart);
  if (arrayStart === -1) {
    return { lore: [] };
  }

  let depth = 0;
  let lastValidEnd = -1;

  for (let i = arrayStart; i < content.length; i++) {
    const char = content[i];
    if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        lastValidEnd = i;
        break;
      }
      if (char === '}' && depth === 1) {
        lastValidEnd = i;
      }
    }
  }

  if (lastValidEnd > arrayStart) {
    const loreArray = content.slice(arrayStart, lastValidEnd + 1);
    try {
      let fixedArray = loreArray;
      const openBrackets = (fixedArray.match(/\[/g) || []).length;
      const closeBrackets = (fixedArray.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        fixedArray += ']'.repeat(openBrackets - closeBrackets);
      }

      const lore = JSON.parse(fixedArray);
      logger.info(`[LoreExtractor] Recovered ${lore.length} lore entries from truncated response`);
      return { lore };
    } catch (e2) {
      logger.warn('[LoreExtractor] JSON recovery failed');
    }
  }

  return { lore: [] };
}

export async function extractLore(text, documentAnalysis, openai) {
  logger.info('[LoreExtractor] Starting lore extraction');

  const systemPrompt = `You are an expert lore analyst extracting ABSTRACT KNOWLEDGE from story bibles and world-building documents.

## CRITICAL: WHAT IS "LORE"?

Lore is KNOWLEDGE ABOUT the world - not physical things IN the world.

### EXTRACT AS LORE (Knowledge/Information):
- **Historical Events**: Wars, treaties, coronations, disasters, founding of nations
- **World Rules**: Natural laws, magic system mechanics, how things work
- **Legends/Myths**: Folk tales, prophecies, origin myths, religious stories
- **Cultural Customs**: Traditions, holidays, ceremonies, etiquette
- **Species Information**: General traits of races/species (not named individuals)
- **Magic Theory**: How spells work, magical laws, casting requirements
- **Religious Doctrine**: Beliefs about gods, afterlife, morality
- **Economic Systems**: How trade works, currency, wealth distribution
- **Timeline/Eras**: Historical periods, ages, epochs
- **Languages**: Information about languages spoken
- **Cosmology**: Structure of the universe, planes of existence

### DO NOT EXTRACT AS LORE (Goes elsewhere):

| Wrong | Right Category |
|-------|---------------|
| "Excalibur, the legendary sword" | → library_items (it's a physical object) |
| "Gandalf the Grey" | → library_characters (it's a person) |
| "The Thieves Guild" | → library_factions (it's an organization) |
| "The City of Gondor" | → library_locations (it's a place) |
| "Seamus the dog" | → library_characters (named creature = character) |
| "The Gyrocopter" | → library_items (it's a vehicle) |

### LORE vs OTHER CATEGORIES - KEY EXAMPLES:

**Extract as LORE:**
- "The Great War of 1042 devastated the eastern kingdoms" (historical event)
- "Magic requires verbal components to function" (magic rule)
- "The prophecy speaks of a chosen one" (legend/prophecy)
- "Elves live for 1000 years and have keen eyesight" (species info - general)
- "The Festival of Lights occurs every autumn equinox" (custom)

**DO NOT extract as LORE:**
- "Legolas the elf" → CHARACTER (specific named elf)
- "The One Ring" → ITEM (specific object)
- "The Fellowship" → FACTION (specific group)
- "Rivendell" → LOCATION (specific place)

## OUTPUT FORMAT:

Return valid JSON:
{
  "lore": [
    {
      "entry_type": "${Object.keys(LORE_TYPES).join('|')}",
      "title": "Descriptive title for this lore entry",
      "content": "Detailed explanation of this knowledge",
      "importance": 0-100,
      "related_characters": ["names of characters connected to this lore"],
      "related_locations": ["names of locations connected to this lore"],
      "related_items": ["names of items connected to this lore"],
      "related_factions": ["names of factions connected to this lore"],
      "tags": ["searchable tags"],
      "time_relevance": "past|present|future|timeless",
      "is_secret": true/false,
      "source_context": "Where in the document this was mentioned"
    }
  ],
  "extraction_notes": "Observations about the lore system",
  "items_detected_for_other_agents": ["List any items, factions, or named creatures you noticed but did NOT extract"]
}

## IMPORTANCE SCALE:
- 100: Central to plot/world (creation myth, main prophecy)
- 75: Frequently referenced (major historical event)
- 50: Moderately important (significant custom, useful rule)
- 25: Background detail (minor tradition)
- 10: Flavor text (passing mention)`;

  const userPrompt = `Extract ALL pure lore (knowledge, history, rules, customs, legends) from this document.

REMEMBER: Do NOT extract individual characters, specific items, organizations, or locations. Those go to other agents.

Document type: ${documentAnalysis?.document_type || 'narrative'}
Genre: ${documentAnalysis?.genre || 'unknown'}

DOCUMENT TEXT:
${text.slice(0, 60000)}`;

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[LoreExtractor] Attempt ${attempt}/${maxRetries}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 10000
      });

      const rawContent = response.choices[0]?.message?.content;
      if (!rawContent) {
        throw new Error('Empty response from OpenAI');
      }

      const result = tryRecoverJSON(rawContent);
      const lore = result.lore || [];

      logger.info(`[LoreExtractor] Extracted ${lore.length} lore entries`);

      // Validate and filter out misplaced entries
      const validatedLore = [];
      const misplaced = [];

      for (const entry of lore) {
        // Check if this looks like it belongs elsewhere
        const lowerTitle = (entry.title || '').toLowerCase();
        const lowerContent = (entry.content || '').toLowerCase();

        // Detect misplaced items
        if (isLikelyItem(lowerTitle, lowerContent)) {
          misplaced.push({ type: 'item', title: entry.title });
          continue;
        }

        // Detect misplaced factions
        if (isLikelyFaction(lowerTitle, lowerContent)) {
          misplaced.push({ type: 'faction', title: entry.title });
          continue;
        }

        // Detect misplaced characters (named creatures)
        if (isLikelyCharacter(lowerTitle, lowerContent)) {
          misplaced.push({ type: 'character', title: entry.title });
          continue;
        }

        // Valid lore entry
        validatedLore.push({
          entry_type: validateLoreType(entry.entry_type),
          title: entry.title || 'Untitled Lore',
          content: entry.content || '',
          importance: typeof entry.importance === 'number' ? entry.importance : 50,
          related_characters: Array.isArray(entry.related_characters) ? entry.related_characters : [],
          related_locations: Array.isArray(entry.related_locations) ? entry.related_locations : [],
          related_items: Array.isArray(entry.related_items) ? entry.related_items : [],
          related_factions: Array.isArray(entry.related_factions) ? entry.related_factions : [],
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          time_relevance: entry.time_relevance || 'timeless',
          is_secret: entry.is_secret || false,
          confidence: 'high'
        });
      }

      if (misplaced.length > 0) {
        logger.info(`[LoreExtractor] Filtered out ${misplaced.length} entries that belong in other categories: ${JSON.stringify(misplaced)}`);
      }

      return {
        success: true,
        lore: validatedLore,
        misplaced_entries: misplaced,
        tokens_used: response.usage?.total_tokens || 0,
        extraction_notes: result.extraction_notes || null
      };

    } catch (error) {
      lastError = error;
      logger.warn(`[LoreExtractor] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.info(`[LoreExtractor] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`[LoreExtractor] All ${maxRetries} attempts failed: ${lastError?.message}`);
  return {
    success: false,
    lore: [],
    tokens_used: 0,
    error: lastError?.message
  };
}

function validateLoreType(type) {
  const validTypes = Object.keys(LORE_TYPES);
  if (type && validTypes.includes(type.toLowerCase())) {
    return type.toLowerCase();
  }
  return 'custom';
}

/**
 * Detect if entry is likely an item (should go to library_items)
 */
function isLikelyItem(title, content) {
  const itemPatterns = [
    /\b(sword|axe|bow|staff|wand|dagger|spear|shield)\b/,
    /\b(armor|helm|helmet|boots|gloves|ring|amulet|necklace)\b/,
    /\b(vehicle|car|ship|boat|aircraft|spaceship|wagon|carriage)\b/,
    /\b(potion|elixir|scroll|tome|book of)\b/,
    /\b(artifact|relic|treasure)\b/,
    /^the\s+[a-z]+\s+(sword|blade|staff|ring|crown|gem)/,
  ];

  for (const pattern of itemPatterns) {
    if (pattern.test(title) || pattern.test(content.slice(0, 200))) {
      // Check if it's describing a specific named item vs general info
      if (/^(the|a)\s+[A-Z]/.test(title)) {
        return true; // Likely a specific named item
      }
    }
  }
  return false;
}

/**
 * Detect if entry is likely a faction (should go to library_factions)
 */
function isLikelyFaction(title, content) {
  const factionPatterns = [
    /\b(guild|order|brotherhood|sisterhood|council|alliance)\b/,
    /\b(kingdom|empire|republic|nation|tribe|clan)\b/,
    /\b(gang|syndicate|cartel|mafia)\b/,
    /\b(church|temple|cult|religion|sect)\b/,
    /\b(company|corporation|merchant)\s+(guild|company)/,
    /\b(army|navy|military|knights|guard)\b/,
  ];

  for (const pattern of factionPatterns) {
    if (pattern.test(title)) {
      // Check if describing an organization vs general faction type
      if (/^the\s+[A-Z]/.test(title)) {
        return true; // Likely a specific named faction
      }
    }
  }
  return false;
}

/**
 * Detect if entry is likely a character (should go to library_characters)
 */
function isLikelyCharacter(title, content) {
  // If entry type was "creature" and has a proper name, it's probably a character
  const isProperName = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(title);
  const isCreature = content.includes('creature') || content.includes('monster') || content.includes('beast');
  const hasPersonalTraits = /\b(loyal|brave|cunning|wise|fierce)\b/.test(content.slice(0, 300));

  // Named creature with personality = character
  if (isProperName && (isCreature || hasPersonalTraits)) {
    return true;
  }

  // Animal with a name
  const animalPatterns = /\b(dog|cat|horse|wolf|dragon|eagle)\s+named\s+/i;
  if (animalPatterns.test(content)) {
    return true;
  }

  return false;
}
