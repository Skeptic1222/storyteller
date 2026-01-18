/**
 * Faction Extractor Agent
 * Extracts organizations, groups, guilds, kingdoms, cults, companies, etc.
 *
 * KEY DISTINCTION:
 * - Factions are GROUPS/ORGANIZATIONS with multiple members
 * - Individual characters who lead factions go to Characters
 * - Locations where factions operate go to Locations
 */

import { logger } from '../../../utils/logger.js';

const FACTION_TYPES = {
  guild: 'Professional organizations (thieves guild, merchant guild)',
  kingdom: 'Monarchies, empires, nations',
  cult: 'Religious extremists, secret worshippers',
  company: 'Businesses, corporations, trading companies',
  military: 'Armies, navies, mercenary companies',
  tribe: 'Nomadic groups, clans, native peoples',
  gang: 'Criminal organizations, street gangs',
  religion: 'Churches, temples, religious orders',
  school: 'Academies, wizard colleges, martial arts schools',
  family: 'Noble houses, crime families, dynasties',
  alliance: 'Coalitions, treaties, temporary unions',
  government: 'Councils, senates, democracies',
  order: 'Knights, paladins, monastic orders',
  resistance: 'Rebel groups, freedom fighters',
  secret_society: 'Hidden organizations, conspiracies'
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
  const factionsStart = content.indexOf('"factions"');
  if (factionsStart === -1) {
    logger.warn('[FactionExtractor] No factions array found');
    return { factions: [] };
  }

  const arrayStart = content.indexOf('[', factionsStart);
  if (arrayStart === -1) {
    return { factions: [] };
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
    const factionsArray = content.slice(arrayStart, lastValidEnd + 1);
    try {
      let fixedArray = factionsArray;
      const openBrackets = (fixedArray.match(/\[/g) || []).length;
      const closeBrackets = (fixedArray.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        fixedArray += ']'.repeat(openBrackets - closeBrackets);
      }

      const factions = JSON.parse(fixedArray);
      logger.info(`[FactionExtractor] Recovered ${factions.length} factions from truncated response`);
      return { factions };
    } catch (e2) {
      logger.warn('[FactionExtractor] JSON recovery failed');
    }
  }

  return { factions: [] };
}

/**
 * Extract factions from text
 * @param {string} text - Source document text
 * @param {Object} documentAnalysis - Analysis from Pass 1
 * @param {Object} openai - OpenAI client
 * @returns {Object} Extracted factions
 */
export async function extractFactions(text, documentAnalysis, openai) {
  logger.info('[FactionExtractor] Starting faction extraction');

  const systemPrompt = `You are an expert Faction Extractor for story bibles and world-building documents.
Your task is to identify and extract ALL organizations, groups, guilds, kingdoms, and collective entities.

## WHAT TO EXTRACT AS FACTIONS:

### Organizations (EXTRACT):
- **Guilds**: Thieves guilds, merchant guilds, assassin guilds, craft guilds
- **Kingdoms/Nations**: Empires, republics, city-states, nations
- **Religions**: Churches, temples, cults, religious orders
- **Military**: Armies, navies, mercenary companies, knightly orders
- **Criminal**: Gangs, crime syndicates, smuggling rings
- **Schools**: Magic academies, martial arts schools, universities
- **Companies**: Corporations, trading companies, businesses
- **Families**: Noble houses, crime families, dynasties
- **Tribes/Clans**: Nomadic groups, native peoples
- **Secret Societies**: Hidden orders, conspiracies
- **Alliances**: Coalitions, treaties (if they act as a unit)

### Faction Details to Extract:
- name: Official name of the organization
- faction_type: ${Object.keys(FACTION_TYPES).join(', ')}
- alignment: Moral alignment or general disposition
- description: What the organization is and does
- motto: Official motto or creed (if any)
- symbol_description: Their symbol/sigil/flag
- leadership_type: How they're governed
- leader_name: Current leader's name
- hierarchy: Rank structure
- member_count: Approximate size
- goals: What they want to achieve (array)
- methods: How they operate (array)
- values: What they believe in (array)
- secrets: Hidden agendas or unknown truths
- allies: Other factions they work with (array)
- enemies: Factions they oppose (array)
- headquarters: Where they're based
- territories: Areas they control (array)
- resources: What they have access to (array)
- founding: When/how they were founded
- history: Major events in their past
- current_state: What's happening with them now
- importance: 0-100 based on story significance

## WHAT NOT TO EXTRACT (Goes elsewhere):

- **Individual characters** → library_characters (even faction leaders)
- **Buildings/locations** → library_locations (even faction headquarters)
- **Items/artifacts** → library_items (even faction relics)
- **Abilities/spells** → library_abilities
- **Species/races** → library_lore (unless they have organized structure)

## DISTINGUISH FROM:

- A "kingdom" location (the place) vs "kingdom" faction (the political entity)
- Extract the ORGANIZATION, not just the place name
- "The Kingdom of Eldoria" as faction = the government, military, political body
- "Eldoria" as location = the physical land, cities, terrain

## OUTPUT FORMAT:

Return valid JSON:
{
  "factions": [
    {
      "name": "The Night's Watch",
      "faction_type": "military",
      "alignment": "lawful neutral",
      "description": "An ancient order sworn to guard the realm against threats from beyond the Wall",
      "motto": "Night gathers, and now my watch begins",
      "symbol_description": "A black crow on a white field",
      "leadership_type": "elected commander",
      "leader_name": "Lord Commander Jeor Mormont",
      "hierarchy": "Lord Commander → First Ranger/Builder/Steward → Rangers/Builders/Stewards → Recruits",
      "member_count": "Less than a thousand",
      "goals": ["Guard the Wall", "Protect the realm from wildlings and White Walkers"],
      "methods": ["Patrol the Wall", "Man the castles", "Range beyond the Wall"],
      "values": ["Duty", "Honor", "Sacrifice", "Brotherhood"],
      "secrets": "The true purpose of the Wall may be to keep out something worse than wildlings",
      "allies": ["House Stark", "Some northern lords"],
      "enemies": ["Wildlings", "White Walkers"],
      "headquarters": "Castle Black",
      "territories": ["The Wall", "The Gift"],
      "resources": ["19 castles along the Wall", "Limited food and weapons"],
      "founding": "Founded 8,000 years ago after the Long Night",
      "history": "Once 10,000 strong with all 19 castles manned, now a shadow of its former glory",
      "current_state": "Undermanned and underfunded, facing growing threats",
      "importance": 95
    }
  ],
  "extraction_notes": "Found 3 major factions, 2 minor groups"
}`;

  const userPrompt = `Extract ALL factions, organizations, and groups from this document. Be thorough - include every guild, kingdom, cult, company, and collective entity mentioned.

Document type: ${documentAnalysis?.document_type || 'narrative'}
Genre: ${documentAnalysis?.genre || 'unknown'}

DOCUMENT TEXT:
${text.slice(0, 80000)}`;

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[FactionExtractor] Attempt ${attempt}/${maxRetries}`);

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
      const factions = result.factions || [];

      logger.info(`[FactionExtractor] Extracted ${factions.length} factions`);

      const validatedFactions = factions.map(faction => ({
        name: faction.name || 'Unnamed Faction',
        faction_type: validateFactionType(faction.faction_type),
        alignment: faction.alignment || null,
        description: faction.description || '',
        motto: faction.motto || null,
        symbol_description: faction.symbol_description || null,
        leadership_type: faction.leadership_type || null,
        leader_name: faction.leader_name || null,
        hierarchy: faction.hierarchy || null,
        member_count: faction.member_count || null,
        goals: Array.isArray(faction.goals) ? faction.goals : [],
        methods: Array.isArray(faction.methods) ? faction.methods : [],
        values: Array.isArray(faction.values) ? faction.values : [],
        secrets: faction.secrets || null,
        allies: Array.isArray(faction.allies) ? faction.allies : [],
        enemies: Array.isArray(faction.enemies) ? faction.enemies : [],
        headquarters: faction.headquarters || null,
        territories: Array.isArray(faction.territories) ? faction.territories : [],
        resources: Array.isArray(faction.resources) ? faction.resources : [],
        founding: faction.founding || null,
        history: faction.history || null,
        current_state: faction.current_state || null,
        importance: typeof faction.importance === 'number' ? faction.importance : 50,
        confidence: 'high'
      }));

      return {
        factions: validatedFactions,
        tokens_used: response.usage?.total_tokens || 0,
        extraction_notes: result.extraction_notes || null
      };

    } catch (error) {
      lastError = error;
      logger.warn(`[FactionExtractor] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.info(`[FactionExtractor] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`[FactionExtractor] All ${maxRetries} attempts failed: ${lastError?.message}`);
  return {
    factions: [],
    tokens_used: 0,
    error: lastError?.message
  };
}

function validateFactionType(type) {
  const validTypes = Object.keys(FACTION_TYPES);
  if (type && validTypes.includes(type.toLowerCase())) {
    return type.toLowerCase();
  }
  return 'guild';
}
