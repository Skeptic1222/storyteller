/**
 * Item Extractor Agent
 * Extracts physical objects: weapons, armor, vehicles, artifacts, books, equipment
 *
 * KEY DISTINCTION:
 * - Items are PHYSICAL OBJECTS that can be owned, carried, or used
 * - Sentient beings (even robots/AI) go to Characters
 * - Buildings/permanent structures go to Locations
 * - Abstract powers/spells go to Abilities
 */

import { logger } from '../../../utils/logger.js';

const ITEM_TYPES = {
  weapon: 'Swords, guns, bows, staffs, wands, etc.',
  armor: 'Shields, helmets, chainmail, robes, etc.',
  vehicle: 'Cars, ships, aircraft, spaceships, wagons, horses (mounts), etc.',
  tool: 'Lockpicks, rope, compass, medical equipment, etc.',
  artifact: 'Magical/legendary items with special properties',
  book: 'Tomes, scrolls, spellbooks, documents, letters',
  clothing: 'Non-protective garments, jewelry, accessories',
  consumable: 'Potions, food, ammunition, fuel',
  container: 'Bags, chests, boxes (small enough to carry)',
  key: 'Keys, keycards, access tokens',
  currency: 'Coins, gems, valuable trade goods',
  document: 'Maps, contracts, deeds, certificates',
  misc: 'Anything else physical that can be owned'
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
  const itemsStart = content.indexOf('"items"');
  if (itemsStart === -1) {
    logger.warn('[ItemExtractor] No items array found in response');
    return { items: [] };
  }

  // Find the array start
  const arrayStart = content.indexOf('[', itemsStart);
  if (arrayStart === -1) {
    return { items: [] };
  }

  // Count brackets to find where to close
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
      // Track valid object endings
      if (char === '}' && depth === 1) {
        lastValidEnd = i;
      }
    }
  }

  if (lastValidEnd > arrayStart) {
    const itemsArray = content.slice(arrayStart, lastValidEnd + 1);
    try {
      // Close the array if needed
      let fixedArray = itemsArray;
      const openBrackets = (fixedArray.match(/\[/g) || []).length;
      const closeBrackets = (fixedArray.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        fixedArray += ']'.repeat(openBrackets - closeBrackets);
      }

      const items = JSON.parse(fixedArray);
      logger.info(`[ItemExtractor] Recovered ${items.length} items from truncated response`);
      return { items };
    } catch (e2) {
      logger.warn('[ItemExtractor] JSON recovery failed');
    }
  }

  return { items: [] };
}

/**
 * Extract items from text
 * @param {string} text - Source document text
 * @param {Object} documentAnalysis - Analysis from Pass 1
 * @param {Object} openai - OpenAI client
 * @returns {Object} Extracted items
 */
export async function extractItems(text, documentAnalysis, openai) {
  logger.info('[ItemExtractor] Starting item extraction');

  const systemPrompt = `You are an expert Item Extractor for story bibles and world-building documents.
Your task is to identify and extract ALL physical objects, vehicles, weapons, artifacts, and equipment mentioned.

## WHAT TO EXTRACT AS ITEMS:

### Physical Objects (EXTRACT):
- **Weapons**: swords, guns, bows, staffs, wands, daggers, axes, any combat tool
- **Armor**: shields, helmets, chainmail, leather armor, protective gear
- **Vehicles**: cars, ships, boats, aircraft, spacecraft, wagons, carriages, motorcycles
  - EXCEPTION: Named horses/mounts that show personality → extract as CHARACTER instead
- **Tools**: lockpicks, rope, compass, medical kits, crafting tools
- **Artifacts**: magical items, legendary objects, items with special powers
- **Books/Documents**: tomes, spellbooks, scrolls, maps, letters, contracts
- **Clothing/Accessories**: rings, necklaces, cloaks, boots (especially if magical/significant)
- **Consumables**: potions, food items, ammunition, fuel
- **Keys/Access**: keys, keycards, passwords (physical tokens)
- **Currency**: coins, gems, treasure, trade goods

### Item Details to Extract:
- name: Exact name as used in text
- item_type: ${Object.keys(ITEM_TYPES).join(', ')}
- subtype: More specific type (e.g., "longsword", "starship", "healing potion")
- description: What it is and what it does
- appearance: Physical description
- size: tiny, small, medium, large, huge, colossal
- material: What it's made of
- condition: pristine, good, worn, damaged, broken, ancient
- magical_properties: Any magical effects or enchantments
- mundane_properties: Non-magical special features
- abilities: What it can do (array)
- limitations: Restrictions or requirements (array)
- rarity: common, uncommon, rare, very_rare, legendary, unique, artifact
- value_description: How valuable it is
- current_owner: Who owns it currently
- current_location: Where it is
- origin: Where it came from
- creator: Who made it
- history: Notable events in its past
- stats_json: D&D stats if applicable {damage, armor_class, weight, etc.}
- attunement_required: true/false for D&D items
- importance: 0-100 based on story significance

## WHAT NOT TO EXTRACT (Goes elsewhere):

- **Sentient beings** → library_characters (even if mechanical like robots/AI)
- **Named animals with personality** → library_characters (named horses, pets, familiars)
- **Buildings/permanent structures** → library_locations
- **Abstract powers/spells** → library_abilities
- **Organizations** → library_factions
- **Historical events** → library_lore

## OUTPUT FORMAT:

Return valid JSON:
{
  "items": [
    {
      "name": "Excalibur",
      "item_type": "weapon",
      "subtype": "longsword",
      "description": "The legendary sword of King Arthur, granting rightful rule of Britain",
      "appearance": "A gleaming silver blade with gold inlay on the hilt",
      "size": "medium",
      "material": "enchanted steel",
      "condition": "pristine",
      "magical_properties": "Indestructible, grants legitimacy to the wielder, shines with holy light",
      "abilities": ["Cannot be broken", "Cuts through any armor", "Illuminates darkness"],
      "limitations": ["Only the true king can wield it"],
      "rarity": "artifact",
      "value_description": "Priceless - symbol of kingship",
      "current_owner": "King Arthur",
      "origin": "Given by the Lady of the Lake",
      "creator": "The Lady of the Lake",
      "history": "Drawn from the stone, used to unite Britain",
      "importance": 100
    }
  ],
  "extraction_notes": "Found 5 weapons, 2 vehicles, 1 artifact"
}`;

  const userPrompt = `Extract ALL items from this document. Be thorough - include every named object, weapon, vehicle, and artifact mentioned.

Document type: ${documentAnalysis?.document_type || 'narrative'}
Genre: ${documentAnalysis?.genre || 'unknown'}
Time period: ${documentAnalysis?.time_period || 'unknown'}

DOCUMENT TEXT:
${text.slice(0, 80000)}`;

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[ItemExtractor] Attempt ${attempt}/${maxRetries}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 12000,
        response_format: { type: 'json_object' }
      });

      const rawContent = response.choices[0]?.message?.content;
      if (!rawContent) {
        throw new Error('Empty response from OpenAI');
      }

      const result = tryRecoverJSON(rawContent);
      const items = result.items || [];

      logger.info(`[ItemExtractor] Extracted ${items.length} items`);

      // Validate and enhance items
      const validatedItems = items.map(item => ({
        name: item.name || 'Unnamed Item',
        item_type: validateItemType(item.item_type),
        subtype: item.subtype || null,
        description: item.description || '',
        appearance: item.appearance || null,
        size: item.size || 'medium',
        material: item.material || null,
        condition: item.condition || 'good',
        magical_properties: item.magical_properties || null,
        mundane_properties: item.mundane_properties || null,
        abilities: Array.isArray(item.abilities) ? item.abilities : [],
        limitations: Array.isArray(item.limitations) ? item.limitations : [],
        rarity: item.rarity || 'common',
        value_description: item.value_description || null,
        current_owner: item.current_owner || null,
        current_location: item.current_location || null,
        origin: item.origin || null,
        creator: item.creator || null,
        history: item.history || null,
        stats_json: item.stats_json || null,
        attunement_required: item.attunement_required || false,
        importance: typeof item.importance === 'number' ? item.importance : 50,
        confidence: 'high'
      }));

      return {
        items: validatedItems,
        tokens_used: response.usage?.total_tokens || 0,
        extraction_notes: result.extraction_notes || null
      };

    } catch (error) {
      lastError = error;
      logger.warn(`[ItemExtractor] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.info(`[ItemExtractor] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`[ItemExtractor] All ${maxRetries} attempts failed: ${lastError?.message}`);
  return {
    items: [],
    tokens_used: 0,
    error: lastError?.message
  };
}

function validateItemType(type) {
  const validTypes = Object.keys(ITEM_TYPES);
  if (type && validTypes.includes(type.toLowerCase())) {
    return type.toLowerCase();
  }
  return 'misc';
}
