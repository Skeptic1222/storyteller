/**
 * Character Extractor Agent (Pass 2a)
 * Deeply analyzes text to extract ALL character information
 * Focuses exclusively on characters - names, traits, appearances, dialogue patterns
 */

import { logger } from '../../../utils/logger.js';

/**
 * Attempts to recover valid JSON from a truncated response
 * Handles common truncation patterns like missing closing brackets
 */
function tryRecoverJSON(rawContent) {
  // First, try as-is
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    // Continue to recovery attempts
  }

  let content = rawContent.trim();

  // Find where the characters array starts
  const charactersStart = content.indexOf('"characters"');
  if (charactersStart === -1) {
    logger.warn('[CharacterExtractor] No characters array found in response');
    return { characters: [] };
  }

  // Find the opening bracket of the array
  const arrayStart = content.indexOf('[', charactersStart);
  if (arrayStart === -1) {
    return { characters: [] };
  }

  // Count brackets to find where we need to close
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidCharIndex = arrayStart;
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
        // We just closed an object inside the array
        lastCompleteObjectEnd = i;
      }
    }

    lastValidCharIndex = i;
  }

  // If brackets are balanced, try parsing
  if (bracketCount === 0) {
    try {
      return JSON.parse(content);
    } catch (e) {
      // Continue to truncation fix
    }
  }

  // Truncation detected - try to close at last complete object
  if (lastCompleteObjectEnd > arrayStart) {
    const truncatedContent = content.substring(0, lastCompleteObjectEnd + 1) + ']}';
    try {
      const result = JSON.parse(truncatedContent);
      logger.info(`[CharacterExtractor] Recovered ${result.characters?.length || 0} characters from truncated JSON`);
      return result;
    } catch (e) {
      // Try more aggressive closing
    }
  }

  // Most aggressive recovery - find last complete character object
  const charObjectPattern = /\{[^{}]*"name"\s*:\s*"[^"]+"/g;
  let matches = [...content.matchAll(charObjectPattern)];

  if (matches.length > 0) {
    // Try to extract just the characters we can parse
    const characters = [];
    const charPattern = /\{(?:[^{}]|\{[^{}]*\})*"name"\s*:\s*"[^"]+(?:[^{}]|\{[^{}]*\})*\}/g;
    const charMatches = content.match(charPattern) || [];

    for (const match of charMatches) {
      try {
        const char = JSON.parse(match);
        if (char.name) {
          characters.push(char);
        }
      } catch (e) {
        // Skip unparseable character
      }
    }

    if (characters.length > 0) {
      logger.info(`[CharacterExtractor] Recovered ${characters.length} characters via pattern extraction`);
      return { characters };
    }
  }

  logger.error('[CharacterExtractor] Could not recover any characters from malformed JSON');
  return { characters: [] };
}

export async function extractCharacters(text, documentAnalysis, openai) {
  logger.info('[CharacterExtractor] Starting character extraction');

  const hints = documentAnalysis?.extraction_hints || {};
  const estimates = documentAnalysis?.content_estimates?.characters || {};

  const systemPrompt = `You are an EXHAUSTIVELY THOROUGH character extraction specialist. Your mission is to extract EVERY SINGLE DETAIL about EVERY character mentioned in the text. Do NOT summarize or abbreviate - extract ALL information.

## CRITICAL: EXTRACTION DEPTH REQUIREMENTS

You MUST extract the following for EVERY character. If information is not explicitly stated, write "Not specified" rather than leaving blank. If you can reasonably infer something, do so and note it as inferred.

### REQUIRED FIELDS (extract for ALL characters):

**IDENTITY:**
- name: Full name (required - use descriptors if name unknown: "The Blacksmith", "Village Elder")
- display_name: Nickname, title, or common reference (e.g., "Ned" for "Edward", "The Wolf" for a cunning character)
- aliases: Any other names they go by
- gender: male/female/non-binary/unknown - INFER from pronouns (he/she/they), name patterns, physical descriptions, social roles
- age_group: child (0-12)/teen (13-19)/young_adult (20-35)/adult (36-50)/middle_aged (51-65)/elderly (65+)/unknown
- age_specific: Exact age if mentioned, or estimated range (e.g., "late 40s", "around 30")
- species: human/elf/dwarf/orc/vampire/etc. (default human if fantasy/sci-fi setting doesn't specify)

**VITAL STATUS (CRITICAL - CHECK CAREFULLY):**
- is_alive: TRUE if character is alive during the story's present timeline, FALSE if deceased
- is_deceased: TRUE if character has died, been killed, or is no longer living - CHECK THOROUGHLY
- death_details: If deceased, provide a DETAILED object with:
  - cause: How they died (murder, illness, accident, battle, old age, suicide, execution, etc.)
  - timing: When they died relative to the story (before story begins, during chapter X, etc.)
  - location: Where they died
  - killer: Who killed them (if applicable)
  - circumstances: Full context around their death
  - impact: How their death affected other characters or the plot
  - body_status: What happened to their remains (buried, cremated, missing, etc.)
- vital_status_summary: One clear sentence like "DECEASED - Killed by [X] during [Y]" or "ALIVE - Active protagonist"

**STORY ROLE:**
- role: protagonist/antagonist/supporting/minor/mentioned - be generous with supporting role
- is_historical: TRUE if character only exists in legends/history, never appears alive in story timeline
- faction_allegiance: Which group/side/organization they belong to

**PHYSICAL DESCRIPTION (extract EVERY detail mentioned):**
- appearance: Combine ALL physical descriptions - height, build, hair color, eye color, skin tone, distinguishing features, scars, tattoos, typical expression, body language
- clothing_style: What they typically wear, armor, uniforms, accessories
- physical_condition: Health status, disabilities, injuries, transformations

**PERSONALITY (be extremely detailed):**
- personality: Extended description of their character - at least 2-3 sentences
- traits: Array of 5-10 specific trait words (loyal, cunning, hot-tempered, etc.)
- values: What they believe in, moral code, priorities
- fears: What scares or worries them
- flaws: Character weaknesses, bad habits, blind spots
- strengths: What makes them capable or admirable

**BACKGROUND:**
- backstory: Everything about their past - childhood, formative events, how they became who they are
- occupation: Current job, role, profession - be specific
- former_occupations: Past jobs or roles
- social_status: Noble/commoner/outcast/wealthy/poor/etc.
- education: Training, schooling, mentorship they received
- origin: Where they come from - birthplace, homeland, culture

**ABILITIES & SKILLS:**
- abilities: ALL powers, magic, supernatural abilities - describe each in detail
- skills: Practical skills - combat, crafting, knowledge areas, languages
- weaknesses: Vulnerabilities, what can defeat or harm them
- signature_moves: Distinctive abilities or techniques they're known for

**PSYCHOLOGY & MOTIVATION:**
- motivations: What drives them - goals, desires, what they want most
- secrets: Hidden information about them
- internal_conflicts: Mental struggles, moral dilemmas
- external_conflicts: Disputes with others, obstacles they face

**SOCIAL:**
- relationships_mentioned: ALL references to other characters with relationship type
- enemies: Who opposes them
- allies: Who supports them
- romantic_interests: Love interests, past or present
- family: Family members mentioned (even deceased)

**NARRATIVE:**
- dialogue_style: How they speak - formal/casual, accent, catchphrases, speech patterns, vocabulary level
- voice_description: What their voice sounds like for TTS - pitch, tone, accent, speed, emotional quality
- first_appearance_context: Exactly where/how they first appear
- character_arc: How they change through the story
- symbolic_role: What they represent thematically

## ⚠️ DECEASED CHARACTER DETECTION - READ CAREFULLY ⚠️

This is CRITICAL for story generation. You MUST carefully determine if each character is ALIVE or DECEASED.

**INDICATORS A CHARACTER IS DECEASED:**
1. **Explicit death language:** "died", "was killed", "passed away", "death of", "murdered", "perished", "fell in battle", "lost their life", "no longer with us", "taken from us"
2. **Memorial references:** "the late [name]", "deceased", "fallen", "in memory of", "rest in peace", gravestone mentions, funeral scenes
3. **Past-tense ONLY references:** Character spoken of ONLY in past tense ("she was brave", "he loved") with NO present-tense actions
4. **Grief reactions:** Others mourning them, visiting their grave, crying about them, keeping their memory alive
5. **Timeline markers:** "before [name]'s death", "after we lost [name]", "since [name] passed"
6. **Ghosts/spirits:** If character appears as ghost/spirit/memory, they are DECEASED (note this in death_details)
7. **Inherited items:** "the sword that belonged to my late father" - the father is deceased
8. **Revenge plots:** "avenge [name]'s death" - that character is deceased

**COMMON MISTAKES TO AVOID:**
- Don't assume alive just because death isn't explicitly shown
- Characters mentioned only in backstory/flashbacks may be deceased in present timeline
- "Lost" can mean dead, not just missing - check context
- Parents of adult characters are often deceased unless stated alive

**OUTPUT REQUIREMENT:**
For EVERY character, you MUST set:
- is_alive: true OR false (never null)
- is_deceased: true OR false (never null)
- vital_status_summary: ALWAYS include this - it should be a clear one-line summary

Example vital_status_summary values:
- "ALIVE - Main protagonist, actively pursuing the quest"
- "DECEASED - Murdered by the antagonist in Chapter 3"
- "DECEASED - Died of illness before the story begins, mentioned in flashbacks"
- "DECEASED - Father killed in war, remembered by protagonist"
- "UNKNOWN - Status unclear, may be alive or dead"

## CHARACTER TYPES TO EXTRACT:
- Named characters (John, Lady Eleanor)
- Title-referenced characters (The King, The Doctor, The Stranger)
- Relationship-referenced characters (her mother, his brother, the merchant's daughter)
- Named groups (The Council of Elders, The Three Sisters, The Twelve Knights)
- Deities or mythical figures if referenced
- Historical figures mentioned in lore
- Unnamed but significant characters ("the old woman who warned them")
- **ANIMAL COMPANIONS** - Named pets, mounts, familiars that belong to characters (dogs, cats, horses with names)

## ANIMAL COMPANION DETECTION (CRITICAL)

Named animals that show personality, have relationships with characters, or take significant actions are CHARACTERS, not lore creatures.

**EXTRACT AS CHARACTER if the animal:**
- Has a name (Seamus, Shadow, Shadowfax, Hedwig)
- Belongs to or accompanies another character
- Shows personality or makes decisions
- Has dialogue (even if magical/telepathic)
- Plays a significant story role

**Set these fields for animal companions:**
- species: "dog", "cat", "horse", "owl", "wolf", etc. (NOT "human")
- is_animal_companion: true
- companion_to: Name of the character they belong to
- role: "supporting" or "minor" depending on significance

**Examples:**
- "Seamus, the loyal hound who follows Jake everywhere" → CHARACTER (species: dog, is_animal_companion: true, companion_to: Jake)
- "The dogs that lived in the village" → NOT a character (generic, no name)
- "Shadowfax, the Lord of all Horses" → CHARACTER (species: horse, is_animal_companion: true)
- "The horse he rode into battle" → NOT a character (unnamed, generic)

${hints.character_naming_style === 'nicknames' ? 'Note: Characters may use nicknames - try to identify full names if mentioned.' : ''}
${hints.contains_stats ? 'Note: Document may contain stat blocks - extract ability scores and class information.' : ''}

## OUTPUT FORMAT

Return DETAILED JSON with all fields populated. Prefer longer, more detailed descriptions over brief summaries.

{
  "characters": [
    {
      "name": "string (required)",
      "display_name": "string or null",
      "aliases": ["array of other names"],
      "gender": "male|female|non-binary|unknown",
      "age_group": "child|teen|young_adult|adult|middle_aged|elderly|unknown",
      "age_specific": "string - exact age or estimate",
      "species": "human by default, or specific species (dog, cat, horse, elf, etc.)",
      "is_animal_companion": "true/false - true for pets, mounts, familiars",
      "companion_to": "name of character they belong to, or null",
      "role": "protagonist|antagonist|supporting|minor|mentioned",
      "is_alive": true/false,
      "is_deceased": true/false,
      "vital_status_summary": "REQUIRED - Clear one-line status like 'ALIVE - Main protagonist' or 'DECEASED - Killed in battle'",
      "death_details": {
        "cause": "murder|illness|accident|battle|old_age|suicide|execution|unknown",
        "timing": "when relative to story",
        "location": "where they died",
        "killer": "who killed them or null",
        "circumstances": "full context",
        "impact": "how death affected story/characters",
        "body_status": "buried|cremated|missing|unknown"
      },
      "is_historical": true/false,
      "faction_allegiance": "string or null",
      "description": "COMPREHENSIVE string - combine all physical AND personality info",
      "appearance": "DETAILED physical description - height, build, hair, eyes, features, expression",
      "clothing_style": "what they typically wear",
      "physical_condition": "health status, injuries, disabilities",
      "personality": "EXTENDED description - 2-3 sentences minimum",
      "traits": ["array of 5-10 specific trait words"],
      "values": "what they believe in",
      "fears": "what scares them",
      "flaws": "character weaknesses",
      "strengths": "what makes them capable",
      "backstory": "DETAILED background - childhood, formative events, history",
      "occupation": "specific job/role",
      "former_occupations": ["past jobs"],
      "social_status": "noble|commoner|wealthy|poor|etc",
      "education": "training and learning",
      "origin": "birthplace, homeland, culture",
      "abilities": ["DETAILED array of powers and abilities"],
      "skills": ["practical skills - combat, crafting, languages"],
      "weaknesses": ["vulnerabilities"],
      "signature_moves": ["distinctive abilities"],
      "motivations": "what drives them - goals and desires",
      "secrets": "hidden information",
      "internal_conflicts": "mental struggles",
      "external_conflicts": "disputes with others",
      "relationships_mentioned": [
        { "to": "character name", "type": "relationship type", "notes": "detailed context" }
      ],
      "enemies": ["who opposes them"],
      "allies": ["who supports them"],
      "romantic_interests": ["love interests"],
      "family": [{ "name": "family member", "relation": "type", "status": "living/deceased" }],
      "dialogue_style": "how they speak - accent, formality, catchphrases",
      "voice_description": "DETAILED TTS description - pitch, tone, accent, speed, quality",
      "first_appearance_context": "where/how they first appear",
      "character_arc": "how they change through the story",
      "symbolic_role": "what they represent thematically",
      "confidence": "high|medium|low",
      "extraction_notes": "any observations about this character"
    }
  ],
  "extraction_summary": "overview of characters found",
  "potential_missed": ["names or references that might be characters but uncertain"],
  "deceased_count": number,
  "historical_count": number
}`;

  // For very long documents, we may need to chunk
  const maxChunkSize = 30000;
  const chunks = [];

  if (text.length > maxChunkSize) {
    // Split into overlapping chunks to avoid missing characters at boundaries
    const overlap = 2000;
    for (let i = 0; i < text.length; i += maxChunkSize - overlap) {
      chunks.push(text.substring(i, i + maxChunkSize));
    }
    logger.info(`[CharacterExtractor] Document split into ${chunks.length} chunks`);
  } else {
    chunks.push(text);
  }

  const allCharacters = [];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkNum = i + 1;
    logger.info(`[CharacterExtractor] Processing chunk ${chunkNum}/${chunks.length}`);

    const userPrompt = chunks.length > 1
      ? `Extract ALL characters from this section (part ${chunkNum} of ${chunks.length}):\n\n${chunks[i]}`
      : `Extract ALL characters from this text:\n\n${chunks[i]}`;

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1-2025-04-14', // Most capable model for thorough extraction
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2, // Lower temp for more consistent detailed extraction
          response_format: { type: 'json_object' },
          max_tokens: 12000 // Reduced to avoid truncation
        });

        totalTokens += response.usage?.total_tokens || 0;
        const rawContent = response.choices[0]?.message?.content || '{"characters":[]}';

        // Try to parse JSON with recovery for truncated responses
        let result;
        try {
          result = JSON.parse(rawContent);
        } catch (parseError) {
          logger.warn(`[CharacterExtractor] Chunk ${chunkNum} JSON parse failed, attempting recovery...`);
          result = tryRecoverJSON(rawContent);
        }

        if (result.characters && Array.isArray(result.characters)) {
          allCharacters.push(...result.characters);
          logger.info(`[CharacterExtractor] Chunk ${chunkNum} found ${result.characters.length} characters`);
        } else {
          logger.warn(`[CharacterExtractor] Chunk ${chunkNum} returned no characters array`);
        }

        lastError = null;
        break; // Success, exit retry loop

      } catch (error) {
        lastError = error;
        logger.warn(`[CharacterExtractor] Chunk ${chunkNum} attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          logger.info(`[CharacterExtractor] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError) {
      logger.error(`[CharacterExtractor] Chunk ${chunkNum} failed after ${maxRetries} attempts:`, lastError);
    }
  }

  // Deduplicate characters by name (merge info from multiple chunks)
  const characterMap = new Map();

  for (const char of allCharacters) {
    const key = char.name?.toLowerCase().trim();
    if (!key) continue;

    if (characterMap.has(key)) {
      // Merge with existing - prefer non-null values
      const existing = characterMap.get(key);
      characterMap.set(key, mergeCharacterData(existing, char));
    } else {
      characterMap.set(key, char);
    }
  }

  const uniqueCharacters = Array.from(characterMap.values());

  logger.info(`[CharacterExtractor] Extraction complete - Found ${uniqueCharacters.length} unique characters`);

  return {
    success: true,
    characters: uniqueCharacters,
    tokens_used: totalTokens
  };
}

function mergeCharacterData(existing, newData) {
  // Merge two character objects, preferring more detailed info
  return {
    // Identity
    name: existing.name || newData.name,
    display_name: existing.display_name || newData.display_name,
    aliases: mergeArrays(existing.aliases, newData.aliases),
    gender: existing.gender !== 'unknown' ? existing.gender : newData.gender,
    age_group: existing.age_group !== 'unknown' ? existing.age_group : newData.age_group,
    age_specific: existing.age_specific || newData.age_specific,
    species: existing.species || newData.species || 'human',
    is_animal_companion: existing.is_animal_companion || newData.is_animal_companion || false,
    companion_to: existing.companion_to || newData.companion_to,

    // Status & Role
    role: prioritizeRole(existing.role, newData.role),
    is_alive: existing.is_alive !== undefined ? existing.is_alive : (newData.is_alive !== undefined ? newData.is_alive : true),
    is_deceased: existing.is_deceased || newData.is_deceased || false,
    vital_status_summary: existing.vital_status_summary || newData.vital_status_summary || (existing.is_deceased || newData.is_deceased ? 'DECEASED' : 'ALIVE'),
    death_details: mergeDeathDetails(existing.death_details, newData.death_details),
    death_context: longerString(existing.death_context, newData.death_context), // Keep for backward compatibility
    is_historical: existing.is_historical || newData.is_historical || false,
    faction_allegiance: existing.faction_allegiance || newData.faction_allegiance,

    // Physical
    description: longerString(existing.description, newData.description),
    appearance: longerString(existing.appearance, newData.appearance),
    clothing_style: longerString(existing.clothing_style, newData.clothing_style),
    physical_condition: longerString(existing.physical_condition, newData.physical_condition),

    // Personality
    personality: longerString(existing.personality, newData.personality),
    traits: mergeArrays(existing.traits, newData.traits),
    values: longerString(existing.values, newData.values),
    fears: longerString(existing.fears, newData.fears),
    flaws: longerString(existing.flaws, newData.flaws),
    strengths: longerString(existing.strengths, newData.strengths),

    // Background
    backstory: longerString(existing.backstory, newData.backstory),
    occupation: existing.occupation || newData.occupation,
    former_occupations: mergeArrays(existing.former_occupations, newData.former_occupations),
    social_status: existing.social_status || newData.social_status,
    education: longerString(existing.education, newData.education),
    origin: longerString(existing.origin, newData.origin),

    // Abilities
    abilities: mergeArrays(existing.abilities, newData.abilities),
    skills: mergeArrays(existing.skills, newData.skills),
    weaknesses: mergeArrays(existing.weaknesses, newData.weaknesses),
    signature_moves: mergeArrays(existing.signature_moves, newData.signature_moves),

    // Psychology
    motivations: longerString(existing.motivations, newData.motivations),
    secrets: longerString(existing.secrets, newData.secrets),
    internal_conflicts: longerString(existing.internal_conflicts, newData.internal_conflicts),
    external_conflicts: longerString(existing.external_conflicts, newData.external_conflicts),

    // Social
    relationships_mentioned: mergeRelationships(existing.relationships_mentioned, newData.relationships_mentioned),
    enemies: mergeArrays(existing.enemies, newData.enemies),
    allies: mergeArrays(existing.allies, newData.allies),
    romantic_interests: mergeArrays(existing.romantic_interests, newData.romantic_interests),
    family: mergeFamily(existing.family, newData.family),

    // Narrative
    dialogue_style: longerString(existing.dialogue_style, newData.dialogue_style),
    voice_description: longerString(existing.voice_description, newData.voice_description),
    first_appearance_context: existing.first_appearance_context || newData.first_appearance_context,
    character_arc: longerString(existing.character_arc, newData.character_arc),
    symbolic_role: longerString(existing.symbolic_role, newData.symbolic_role),

    // Meta
    confidence: existing.confidence === 'high' || newData.confidence === 'high' ? 'high' :
                existing.confidence === 'medium' || newData.confidence === 'medium' ? 'medium' : 'low',
    extraction_notes: longerString(existing.extraction_notes, newData.extraction_notes)
  };
}

function mergeFamily(fam1, fam2) {
  const all = [...(fam1 || []), ...(fam2 || [])];
  const seen = new Set();
  return all.filter(f => {
    const key = f?.name?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prioritizeRole(role1, role2) {
  const priority = { protagonist: 5, antagonist: 4, supporting: 3, minor: 2, mentioned: 1 };
  return (priority[role1] || 0) >= (priority[role2] || 0) ? role1 : role2;
}

function longerString(s1, s2) {
  if (!s1) return s2;
  if (!s2) return s1;
  return s1.length >= s2.length ? s1 : s2;
}

function mergeDeathDetails(d1, d2) {
  if (!d1 && !d2) return null;
  if (!d1) return d2;
  if (!d2) return d1;

  return {
    cause: d1.cause || d2.cause || 'unknown',
    timing: longerString(d1.timing, d2.timing),
    location: longerString(d1.location, d2.location),
    killer: d1.killer || d2.killer,
    circumstances: longerString(d1.circumstances, d2.circumstances),
    impact: longerString(d1.impact, d2.impact),
    body_status: d1.body_status || d2.body_status || 'unknown'
  };
}

function mergeArrays(arr1, arr2) {
  const combined = [...(arr1 || []), ...(arr2 || [])];
  return [...new Set(combined.map(s => s?.toLowerCase?.() || s))];
}

function mergeRelationships(rels1, rels2) {
  const all = [...(rels1 || []), ...(rels2 || [])];
  const seen = new Set();
  return all.filter(r => {
    const key = `${r.to?.toLowerCase()}-${r.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
