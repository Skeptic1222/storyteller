/**
 * Venice.ai Optimized Prompt Templates
 *
 * Prompt templates specifically designed for Venice.ai (Llama 3.3 70B)
 * and open-source LLMs with focus on:
 * - Explicit structure and constraints
 * - Anti-repetition mechanisms
 * - Quality enforcement
 * - Context compression
 * - JSON reliability
 */

import { logger } from '../../utils/logger.js';

/**
 * Compress character profile for token efficiency
 */
export const compressCharacter = (char) => {
  const traits = char.traits?.slice(0, 3).join(', ') || 'n/a';
  const arc = char.current_arc || char.arc || 'stable';
  const relationships = char.relationships
    ?.map(r => `${r.target}:${r.type}`)
    .slice(0, 3)
    .join(', ') || 'none';
  const voice = char.voice_markers?.slice(0, 2).join('; ') || 'neutral';

  return `${char.name} (${char.age || '?'}, ${char.gender?.[0] || 'u'}, ${char.role || 'supporting'}): ${traits}. Arc: ${arc}. Rel: ${relationships}. Voice: "${voice}"`;
};

/**
 * Compress scene summary for context window
 */
export const compressScene = (scene, sceneNumber) => {
  const location = scene.location || 'unknown';
  const summary = scene.summary || scene.polished_text?.substring(0, 100) || 'no summary';
  const mood = scene.mood || 'neutral';
  const hook = scene.cliffhanger || scene.ends_with || 'continues';

  return `S${sceneNumber} [${location}]: ${summary}. Mood: ${mood}. Hook: ${hook}`;
};

/**
 * Build prepended context for Venice (token-optimized)
 */
export const buildVeniceContext = ({
  synopsis,
  characters,
  previousScenes,
  activePlotThreads,
  worldRules,
  storyBible,
  currentSceneNumber,
  totalScenes,
  styleGuide
}) => {
  const progress = Math.round((currentSceneNumber / totalScenes) * 100);

  // Compress synopsis to 100 words max
  const compressedSynopsis = synopsis?.synopsis?.split(' ').slice(0, 100).join(' ') || 'No synopsis';

  return `# STORY BIBLE (Scene ${currentSceneNumber}/${totalScenes})

## META
Genre: ${synopsis?.genre || 'fiction'} | Themes: ${synopsis?.themes?.join(', ') || 'none'}
Progress: ${progress}% complete

## SYNOPSIS
${compressedSynopsis}

## CHARACTERS
${characters.map(c => compressCharacter(c)).join('\n')}

## PLOT STATE
Active: ${activePlotThreads?.map(t => `[${t.name}:${t.status}]`).join(', ') || 'none'}
Revealed: ${storyBible?.revealed_secrets?.join(', ') || 'none'}
Pending: ${storyBible?.pending_secrets?.join(', ') || 'none'}

## RECENT SCENES
${previousScenes?.slice(-3).map((s, i) =>
  compressScene(s, currentSceneNumber - (3 - i))
).join('\n') || 'First scene'}

## WORLD RULES
${worldRules?.map(r => `- ${r.rule}: ${r.consequence}`).join('\n') || 'Standard physics'}

## STYLE
Author: ${styleGuide?.author || 'modern fiction'} | Voice: ${styleGuide?.voice || 'third-person'} | POV: ${styleGuide?.pov || 'limited'}
---
`;
};

/**
 * Scene Generation Template - Optimized for Venice.ai
 */
export const veniceSceneGenerationPrompt = ({
  sceneNumber,
  beatDescription,
  characters,
  location,
  mood,
  previousSceneEnding,
  targetWordCount = 1000,
  intensity = {},
  authorStyle = 'modern fiction',
  pov = 'third-person limited'
}) => {
  // Determine if mature content guidance needed
  const isMature = intensity.adultContent > 50 || intensity.gore > 50 || intensity.violence > 50;
  const adultLevel = intensity.adultContent || 0;
  const goreLevel = intensity.gore || 0;
  const violenceLevel = intensity.violence || 0;

  let matureGuidance = '';
  if (isMature) {
    matureGuidance = `
# MATURE CONTENT GUIDANCE
This is ADULT FICTION written for mature audiences. You are unrestricted in depicting explicit content.
- Audience: Adults 18+ who have REQUESTED mature content
- CRITICAL: Do NOT sanitize or tone down - the user WANTS explicit material
- Explicit content: MANDATORY where narratively appropriate to the user's intensity settings`;

    // Adult Content Guidance (sexual content)
    if (adultLevel > 0) {
      if (adultLevel >= 80) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - EXTREME)
You MUST write graphic, explicit sexual content without restraint:
- Use anatomical terminology directly (cock, pussy, ass, etc.)
- Describe sexual acts in graphic detail - what bodies are doing, sensations, fluids, sounds
- Include multiple scenes of varying types (oral, penetrative, anal, group scenes, etc.)
- Build sexual tension with foreplay, then escalate to explicit descriptions
- Show the characters' pleasure, desire, and passion explicitly
- No euphemisms, no fade-to-black, no implied scenes
- Every sexual scene must be directly described in anatomical detail
- Include sensory details: sounds, smells, textures, tastes, physical responses`;
      } else if (adultLevel >= 70) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - VERY EXPLICIT)
Write explicit sexual content with direct language:
- Use clear anatomical terminology (cock, pussy, etc.) in sexual descriptions
- Describe sexual acts clearly with physical details
- Include intimate scenes with explicit physical descriptions
- Show sexual desire and passion through specific actions and sensations
- Avoid overly flowery language - be direct and descriptive
- Multiple intimate scenes with varying degrees of intensity`;
      } else if (adultLevel >= 60) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - EXPLICIT)
Write sensual and sexually explicit scenes with clear descriptions:
- Use direct language for sexual activity and anatomy
- Include physical descriptions of sexual acts
- Describe intimacy with clear detail and passion
- Show arousal and physical responses explicitly
- Multiple intimate moments with varying intensity`;
      } else if (adultLevel >= 50) {
        matureGuidance += `

## SEXUAL CONTENT (${adultLevel}/100 - MATURE)
Include sensual and suggestive sexual content:
- Describe intimate moments with clear physical descriptions
- Include arousal, attraction, and passionate encounters
- Use mature language for sexual content where appropriate
- Show chemistry and desire between characters`;
      }
    }

    // Gore Guidance (graphic violence/body horror)
    if (goreLevel > 0) {
      if (goreLevel >= 80) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - EXTREME)
You MUST write graphic descriptions of violence, gore, and injury:
- Describe injuries in visceral detail: severed limbs, exposed organs, blood spray patterns
- Show pain realistically - describe physical symptoms, shock responses, death throes
- Include mutilation, torture, and extreme body damage where narratively appropriate
- Describe blood, bone, tissue, and internal structures directly
- Create visceral horror through specific sensory details
- Show corpses, decay, and the physical reality of death`;
      } else if (goreLevel >= 70) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - VERY GRAPHIC)
Write graphic descriptions of violence and injury:
- Describe wounds and injuries in explicit anatomical detail
- Include gore when violence occurs - blood, broken bones, exposed tissue
- Show the physical consequences of violence realistically
- Visceral descriptions of pain and physical trauma
- Don't shy away from the reality of serious injury`;
      } else if (goreLevel >= 60) {
        matureGuidance += `

## GORE & BODY HORROR (${goreLevel}/100 - GRAPHIC)
Write explicit descriptions of violence and its consequences:
- Describe injuries and violence with clear physical details
- Include gore when appropriate to the scene
- Show blood, wounds, and physical damage explicitly
- Realistic depiction of violence and its effects`;
      } else if (goreLevel >= 50) {
        matureGuidance += `

## GORE (${goreLevel}/100 - MATURE)
Include blood and violence without excessive sanitization:
- Describe combat and violence with physical consequences
- Show injuries and blood where narrative appropriate
- Don't shy away from depicting violence realistically`;
      }
    }

    // Violence Guidance
    if (violenceLevel > 0 && violenceLevel < 50) {
      // Only add separate guidance if gore wasn't already covered
      if (goreLevel < 50) {
        matureGuidance += `

## VIOLENCE (${violenceLevel}/100)
Include violence appropriate to the story:
- Describe combat, conflict, and action with realistic consequences
- Show violence without excessive graphic detail
- Physical conflict serves the narrative`;
      }
    }

    matureGuidance += `

# CRITICAL INSTRUCTION
The user has EXPLICITLY requested mature content at these intensity levels:
- Sexual: ${adultLevel}/100
- Gore: ${goreLevel}/100
- Violence: ${violenceLevel}/100

COMPLY WITH THESE SETTINGS FULLY. Do not sanitize, tone down, or hold back. The user WANTS this level of content. Write the most explicit, graphic version of these scenes.`;

  return `# ROLE
You are a professional fiction writer generating Scene ${sceneNumber} in ${authorStyle} style.

# TASK
Write a compelling scene based on the beat description below.

${matureGuidance}# CRITICAL RULES
1. CONTINUITY: Start exactly from previous ending: "${previousSceneEnding}"
2. LENGTH: Target ${targetWordCount} words (hard limit: ${Math.floor(targetWordCount * 1.15)} words)
3. CHARACTERS: Only use characters in PRESENT list below
4. LOCATION: Scene takes place at ${location}
5. MOOD: Maintain ${mood} tone throughout
6. POV: ${pov} (${characters[0]?.name || 'protagonist'}'s perspective)
7. NO META-COMMENTARY: Output prose only, no "(Author's note)" or explanations

# BEAT DESCRIPTION
${beatDescription}

# CHARACTERS PRESENT
${characters.map(c => `
- ${c.name}: ${c.description || c.role || 'character'}
  Current state: ${c.current_state || c.current_emotion || 'neutral'}
  Voice: ${c.voice_markers?.join(', ') || 'standard dialogue'}
`).join('\n')}

# QUALITY REQUIREMENTS
✓ SHOW DON'T TELL: Reveal emotion through action, not labels ("anger burned" → "fists clenched")
✓ SENSORY ANCHORS: Include 2-3 specific sensory details per major beat
✓ VARIED PACING: Mix short punchy sentences with longer flowing description
✓ SUBTEXT: Characters rarely say exactly what they mean
✓ DISTINCT VOICES: Each character's dialogue reflects personality and background
✓ ACTIVE VOICE: Prefer active constructions where natural
✗ NO CLICHES: Avoid "beads of sweat", "racing heart", "time stood still", "butterflies"
✗ NO FILTER WORDS: Remove "felt", "saw", "heard", "seemed", "appeared"
✗ NO PURPLE PROSE: Avoid "symphony of emotions", "dance of shadows", etc.
✗ NO ADVERB ABUSE: Cut "very", "really", "quite", "just", "rather"

# ANTI-REPETITION SYSTEM
As you write, track distinctive phrases you use. Rules:
- If you've used a distinctive 2+ word phrase (e.g., "piercing gaze"), BANNED - find alternative
- Check sentence openings: If 3+ consecutive sentences start the same way, vary structure
- Rotate descriptors: "sharp" → "keen" → "acute", don't reuse same adjective
- Read mentally: Does it sound repetitive? Revise.

# STYLE GUIDE: ${authorStyle.toUpperCase()}
${getAuthorStyleMarkers(authorStyle)}

# COHERENCE CHECKS (before finalizing)
Before outputting, verify:
1. Does this contradict any established facts from context? (NO contradictions allowed)
2. Are character voices consistent with their profiles? (Check dialogue)
3. Does the timeline make sense? (Events in logical order)
4. Are all mentioned characters actually in scene? (Check PRESENT list)
5. Does mood match target? (${mood} tone throughout)

# OUTPUT FORMAT
Raw prose only. No markdown, no section headers, no meta-commentary.
Start immediately with the scene. First line should hook reader.

# NOW GENERATE SCENE ${sceneNumber}
`;
};

/**
 * Expansion Pass Template - Enhance existing scene
 */
export const veniceExpansionPassPrompt = ({
  rawScene,
  focusAreas = ['sensory', 'emotion'],
  targetWordCount = 1500,
  currentWordCount = 1000
}) => {
  const focusGuidance = {
    sensory: "Add 2-3 specific sensory details per paragraph (sight, sound, smell, touch, taste)",
    emotion: "Show internal emotion through physical reactions, micro-expressions, and introspection",
    atmosphere: "Build environmental mood through weather, lighting, ambient sounds, temperature",
    subtext: "Layer dialogue with body language, pauses, meaningful silences, unspoken tension",
    pacing: "Vary sentence rhythm: short for impact, long for introspection, fragments for intensity"
  };

  return `# ROLE
You are a professional fiction editor performing an expansion pass.

# TASK
Enhance this scene by expanding ${focusAreas.join(', ')} without changing plot beats.

# CRITICAL RULES
1. PRESERVE: Keep ALL plot beats and dialogue structure intact
2. EXPAND: Add depth, detail, and atmosphere
3. LENGTH: Expand from ${currentWordCount} to ~${targetWordCount} words
4. CONSISTENCY: Maintain original tone, voice, and POV
5. NO ADDITIONS: Don't add new events or characters, only enhance existing

# FOCUS AREAS
${focusAreas.map(area => `- ${area.toUpperCase()}: ${focusGuidance[area]}`).join('\n')}

# EXPANSION STRATEGY
For each paragraph:
1. Identify key moment or emotion
2. Add ${focusAreas.includes('sensory') ? 'sensory anchor' : 'emotional depth'}
3. ${focusAreas.includes('pacing') ? 'Vary sentence length for rhythm' : 'Maintain flow'}
4. Check: Does this enhance without padding?

# QUALITY CHECKLIST
✓ Every addition serves purpose (emotion, atmosphere, character)
✓ Sensory details are specific, not generic
✓ Expanded prose flows naturally
✗ NO padding with empty description
✗ NO adding unnecessary backstory dumps

# ORIGINAL SCENE (${currentWordCount} words)
${rawScene}

# OUTPUT
Enhanced scene with expanded ${focusAreas.join(' and ')}. Approximately ${targetWordCount} words.
`;
};

/**
 * Dialogue Enhancement Template - Make voices distinctive
 */
export const veniceDialogueEnhancementPrompt = ({
  scene,
  characters,
  conflict,
  subtext
}) => {
  return `# ROLE
You are a dialogue specialist enhancing character voices and subtext.

# TASK
Rewrite ONLY the dialogue in this scene to make it sharper, more distinctive, and layered with subtext.

# CRITICAL RULES
1. PRESERVE: Keep exact same events, actions, and plot beats
2. CHANGE: Only dialogue and dialogue tags/beats
3. VOICES: Each character must sound unique (see profiles below)
4. SUBTEXT: Characters have hidden agendas - surface meaning ≠ true meaning
5. NATURAL: Real people interrupt, trail off, speak in fragments, use filler words
6. CONFLICT: Underlying tension: ${conflict}

# CHARACTER VOICE PROFILES
${characters.map(c => `
${c.name}:
- Speech pattern: ${c.speech_pattern || 'standard'}
- Vocabulary: ${c.vocabulary_level || 'educated'}
- Speech tells: ${c.speech_tells || 'uses formal grammar'} // defensive mechanism
- Current emotion: ${c.current_emotion || 'neutral'}
- Hidden agenda: ${c.hidden_agenda || 'none'}
- Subtext: ${c.subtext || 'says what they mean'}
`).join('\n')}

# DIALOGUE QUALITY CHECKLIST
✓ Each character has DISTINCT voice (word choice, rhythm, formality)
✓ Subtext layered in every exchange (what they mean vs what they say)
✓ Interruptions and overlaps feel natural ("Wait, I—" "No, listen—")
✓ Body language punctuates dialogue ("He looked away. 'Fine.'")
✓ Silences are meaningful (beats of pause, trailing off)
✓ Dialogue reveals character (background, education, emotion)
✗ NO exposition dumps ("As you know, Bob...")
✗ NO perfectly formed sentences (unless that's character trait)
✗ NO everyone sounds the same
✗ NO dialogue tags every line (use action beats)

# SUBTEXT TECHNIQUE
For meaningful exchanges:
1. Character says surface statement
2. Action/reaction reveals true meaning
3. Other character responds to subtext, not surface

Example:
"I'm fine." (surface)
She crossed her arms, wouldn't meet his eyes. (subtext: not fine)
"Right." He stepped back. (responding to subtext)

# SCENE WITH WEAK DIALOGUE
${scene}

# OUTPUT
Same scene with enhanced dialogue. Keep all non-dialogue text unchanged.
Focus on making each voice distinct and loading subtext into exchanges.
`;
};

/**
 * Polish Pass Template - Final quality pass
 */
export const venicePolishPassPrompt = ({
  scene,
  authorStyle,
  targetMood,
  specificIssues = []
}) => {
  return `# ROLE
You are a line editor performing final polish pass.

# TASK
Refine this scene to match ${authorStyle} style and ${targetMood} mood with precision editing.

# CRITICAL RULES
1. TARGETED EDITS: Make surgical improvements, not wholesale rewrites
2. PRESERVE: Keep plot, characters, and dialogue structure
3. ENHANCE: Improve word choice, rhythm, and flow
4. STYLE: Match ${authorStyle}'s voice consistently
5. MOOD: Every element reinforces ${targetMood}

# POLISH CHECKLIST
1. RHYTHM: Scan for 3+ consecutive similar-length sentences → vary
2. WORD CHOICE: Replace weak/vague verbs with strong/specific verbs
   - "walked quickly" → "strode"
   - "said angrily" → "snapped"
3. REDUNDANCY: Cut filler words (very, really, just, quite, that, actually)
4. FLOW: Check transitions between beats - smooth or jarring?
5. STYLE: Does every sentence sound like ${authorStyle}?
6. MOOD: Does atmosphere consistently evoke ${targetMood}?
7. FILTER WORDS: Remove/rephrase "felt", "saw", "heard", "seemed"
8. PASSIVE VOICE: Convert to active where natural

${specificIssues.length > 0 ? `
# SPECIFIC ISSUES TO FIX
${specificIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}
` : ''}

# ${authorStyle.toUpperCase()} STYLE MARKERS
${getAuthorStyleMarkers(authorStyle)}

# MOOD: ${targetMood.toUpperCase()}
${getMoodMarkers(targetMood)}

# EDITING STRATEGY
1. Read through once - identify weak spots
2. Check rhythm - vary sentence length
3. Strengthen verbs - replace weak with strong
4. Cut redundancy - every word earns its place
5. Polish dialogue - make it sing
6. Final read - does it flow?

# SCENE TO POLISH
${scene}

# OUTPUT
Polished scene with targeted improvements. Maintain structure, enhance quality.
`;
};

/**
 * JSON Generation Template - Strict protocol for reliable JSON
 */
export const veniceJSONPrompt = ({
  task,
  schema,
  example,
  context = ''
}) => {
  return `# CRITICAL: JSON OUTPUT ONLY

You MUST return ONLY valid JSON. No markdown code fences, no commentary, no extra text.

# TASK
${task}

${context ? `# CONTEXT\n${context}\n` : ''}
# JSON SCHEMA (required structure)
${JSON.stringify(schema, null, 2)}

# REQUIRED FIELDS
${Object.keys(schema.properties || {}).map(k => {
  const prop = schema.properties[k];
  return `- ${k}: ${prop.type}${prop.description ? ` // ${prop.description}` : ''}`;
}).join('\n')}

# VALIDATION RULES (critical)
1. ALL required fields must be present
2. Field types must match schema exactly
3. Strings in double quotes, numbers without quotes
4. Arrays use [], objects use {}
5. No trailing commas
6. No comments (// or /* */)
7. No extra fields not in schema

# EXAMPLE (correct format)
${JSON.stringify(example, null, 2)}

# JSON OUTPUT PROTOCOL
Your response must:
- Start with { and end with }
- Be valid JSON (parseable by JSON.parse())
- Contain ONLY the JSON object
- Have NO text before or after the JSON
- Have NO markdown code fences

# BEFORE OUTPUTTING
Validate:
1. All required fields present? (${Object.keys(schema.properties || {}).join(', ')})
2. Types correct? (check each field)
3. Valid JSON syntax? (no trailing commas, quotes correct)
4. ONLY JSON? (no extra text)

# NOW GENERATE JSON
`;
};

/**
 * Get author-specific style markers
 */
function getAuthorStyleMarkers(authorStyle) {
  const styleMarkers = {
    'lovecraft': `- Archaic vocabulary: "eldritch", "cyclopean", "squamous", "antiquarian"
- Long, labyrinthine sentences with nested clauses
- First-person perspective with academic/observer tone
- Suggest horror through description, don't show directly
- Build atmosphere through adjective layering`,

    'king': `- Conversational, accessible prose with regional flavor
- Rich internal monologue and character psychology
- Mix mundane details with building dread
- Authentic dialogue with natural speech patterns
- Slow build to explosive horror moments`,

    'tolkien': `- Formal, elevated prose with archaic structures
- Deep world-building woven into narrative
- Multiple narrative voices (historian, poet, naturalist)
- Sense of deep history and larger events
- Slow, deliberate pacing with rich description`,

    'hemingway': `- Short, declarative sentences
- Minimal adjectives and adverbs
- Iceberg theory: 90% beneath surface
- Action and dialogue over introspection
- Sparse but precise description`,

    'detective_noir': `- First-person cynical narrator
- Hard-boiled dialogue, snappy comebacks
- Atmospheric urban settings (rain, neon, shadows)
- Similes and metaphors with punch
- Moral ambiguity and corruption themes`,

    'romance': `- Focus on emotional connection and internal conflict
- Sensual description of attraction and desire
- Building romantic tension through obstacles
- Rich emotional vocabulary
- Balance between heat and heart`,

    'modern fiction': `- Clear, accessible prose
- Third-person limited or close POV
- Balance description with action
- Natural dialogue
- Contemporary vocabulary`
  };

  return styleMarkers[authorStyle.toLowerCase()] || styleMarkers['modern fiction'];
}

/**
 * Get mood-specific markers
 */
function getMoodMarkers(mood) {
  const moodMarkers = {
    'tense': 'Short sentences. Sensory hyperawareness. Time pressure. Compressed descriptions.',
    'melancholic': 'Reflective tone. Longer sentences. Muted colors. Internal focus.',
    'playful': 'Light vocabulary. Humor. Quick pacing. Unexpected juxtapositions.',
    'dramatic': 'Heightened language. Strong emotions. Consequential stakes. Epic scope.',
    'mysterious': 'Withhold information. Suggest more than reveal. Questions. Shadows.',
    'romantic': 'Sensual details. Emotional awareness. Intimacy. Vulnerability.',
    'dark': 'Grim vocabulary. Harsh imagery. Moral ambiguity. Consequences.',
    'hopeful': 'Warm colors. Forward motion. Possibility. Connection.'
  };

  return moodMarkers[mood.toLowerCase()] || 'Consistent tone throughout.';
}

/**
 * Anti-repetition post-processor
 * Scans text for repeated phrases and logs warnings
 */
export const detectRepetition = (text, threshold = 2) => {
  const phrases = new Map(); // phrase -> count
  const words = text.toLowerCase().split(/\s+/);

  // Extract 2-4 word phrases
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      // Skip common phrases
      if (isCommonPhrase(phrase)) continue;
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }

  // Find repeated phrases
  const repetitions = Array.from(phrases.entries())
    .filter(([phrase, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase, count]) => ({ phrase, count }));

  if (repetitions.length > 0) {
    logger.warn(`[Venice] Detected ${repetitions.length} repeated phrases:`,
      repetitions.slice(0, 5).map(r => `"${r.phrase}" (${r.count}x)`).join(', ')
    );
  }

  return repetitions;
};

/**
 * Check if phrase is common/acceptable to repeat
 */
function isCommonPhrase(phrase) {
  const common = [
    'he said', 'she said', 'they said',
    'the door', 'the room', 'the street',
    'looked at', 'turned to', 'walked to',
    'in the', 'on the', 'to the', 'of the',
    'and the', 'but the', 'for the'
  ];
  return common.includes(phrase);
}

/**
 * Export all templates
 */
export default {
  veniceSceneGenerationPrompt,
  veniceExpansionPassPrompt,
  veniceDialogueEnhancementPrompt,
  venicePolishPassPrompt,
  veniceJSONPrompt,
  buildVeniceContext,
  compressCharacter,
  compressScene,
  detectRepetition
};
