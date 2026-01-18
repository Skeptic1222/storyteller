/**
 * scaffoldPromptTemplates.js
 *
 * Placeholder instruction templates for the OpenAI-first scaffolding pipeline.
 * OpenAI generates story structure with these placeholders, Venice expands them.
 *
 * Part of the Venice Scaffolding Architecture for explicit content quality.
 */

/**
 * Placeholder type definitions with usage instructions for OpenAI
 */
export const PLACEHOLDER_TYPES = {
  // Scene-level placeholders (multi-paragraph expansions)
  INTIMATE_SCENE: 'INTIMATE_SCENE',
  VIOLENT_CONFRONTATION: 'VIOLENT_CONFRONTATION',
  HORROR_MOMENT: 'HORROR_MOMENT',

  // Inline placeholders (1-3 sentence expansions)
  EXPLICIT_DESCRIPTION: 'EXPLICIT_DESCRIPTION',
  PROFANE_DIALOGUE: 'PROFANE_DIALOGUE',
  SENSUAL_DETAIL: 'SENSUAL_DETAIL',
  GORE_DETAIL: 'GORE_DETAIL',
  CRUDE_LANGUAGE: 'CRUDE_LANGUAGE'
};

/**
 * Scene-level placeholder instructions - these create multi-paragraph expansions
 */
export const SCENE_PLACEHOLDER_INSTRUCTIONS = {
  INTIMATE_SCENE: (intensity) => `
[INTIMATE_SCENE: intensity=${intensity}, characters="CharacterA,CharacterB", mood="passionate|tender|desperate|playful", ~1800w]

USE WHEN: Romantic/sexual scenes requiring intensity above ${Math.max(50, intensity - 10)}%
YOU WRITE: The emotional lead-in, character thoughts, atmosphere, and aftermath
PLACEHOLDER HANDLES: The intimate physical acts and explicit sensory details (MUST be 1500-1800 words)
EXAMPLE:
  "Their eyes met across the dimly lit room. Marcus felt his heart racing as Elena stepped closer.
  [INTIMATE_SCENE: intensity=${intensity}, characters="Marcus,Elena", mood="passionate", ~1500w]
  Afterward, they lay together in comfortable silence, the weight of what had happened settling between them."
`,

  VIOLENT_CONFRONTATION: (intensity) => `
[VIOLENT_CONFRONTATION: intensity=${intensity}, type="sword_fight|brawl|gunfight|monster_attack|torture", stakes="life_death|honor|survival", ~1500w]

USE WHEN: Combat or violence requiring intensity above ${Math.max(50, intensity - 10)}%
YOU WRITE: The setup, character motivations, tactical decisions, and consequences
PLACEHOLDER HANDLES: Graphic violence, injury descriptions, visceral combat details (MUST be 1200-1500 words)
EXAMPLE:
  "Marcus knew he had only seconds before the assassin struck again. He raised his blade, muscles screaming.
  [VIOLENT_CONFRONTATION: intensity=${intensity}, type="sword_fight", stakes="life_death", ~1200w]
  He stood over his fallen enemy, his sword dripping crimson, the reality of what he'd done crashing over him."
`,

  HORROR_MOMENT: (intensity) => `
[HORROR_MOMENT: intensity=${intensity}, type="body_horror|psychological|creature|supernatural|gore", ~1000w]

USE WHEN: Horror/disturbing content requiring intensity above ${Math.max(50, intensity - 10)}%
YOU WRITE: The building dread, character reactions, atmospheric tension
PLACEHOLDER HANDLES: Graphic horror descriptions, visceral body horror, disturbing imagery (MUST be 800-1000 words)
EXAMPLE:
  "The door creaked open, and the smell hit her first - copper and rot and something else, something wrong.
  [HORROR_MOMENT: intensity=${intensity}, type="body_horror", ~800w]
  Sarah stumbled backward, her mind refusing to process what she'd witnessed."
`
};

/**
 * Inline placeholder instructions - these create 1-3 sentence expansions
 */
export const INLINE_PLACEHOLDER_INSTRUCTIONS = {
  EXPLICIT_DESCRIPTION: (intensity) => `
[EXPLICIT_DESCRIPTION: target="wound|body|scene|object", intensity=${intensity}]

USE WHEN: A single description needs explicit physical detail
YOU WRITE: The context and narrative flow around the description
PLACEHOLDER HANDLES: 1-3 sentences of vivid, explicit descriptive detail
EXAMPLE:
  "Marcus pulled back his cloak to reveal [EXPLICIT_DESCRIPTION: target="wound", intensity=${intensity}]
  Elena gasped, reaching for her medical supplies."
`,

  PROFANE_DIALOGUE: (intensity) => `
[PROFANE_DIALOGUE: speaker="CharacterName", emotion="rage|frustration|shock|contempt", intensity=${intensity}]

USE WHEN: Character dialogue requires profanity or crude language
YOU WRITE: The dialogue tags, speaker reactions, conversation context
PLACEHOLDER HANDLES: The actual profane/crude dialogue line
EXAMPLE:
  Marcus slammed his fist on the table. [PROFANE_DIALOGUE: speaker="Marcus", emotion="rage", intensity=${intensity}]
  The room fell silent at his outburst.
`,

  SENSUAL_DETAIL: (intensity) => `
[SENSUAL_DETAIL: focus="touch|taste|smell|sight|sound", intensity=${intensity}]

USE WHEN: Sensual/romantic description needs explicit physical detail
YOU WRITE: The emotional context and character responses
PLACEHOLDER HANDLES: 1-2 sentences of sensual physical description
EXAMPLE:
  "She leaned closer, and [SENSUAL_DETAIL: focus="touch", intensity=${intensity}]
  His breath caught in his throat."
`,

  GORE_DETAIL: (intensity) => `
[GORE_DETAIL: type="injury|death|decay|medical", intensity=${intensity}]

USE WHEN: Gore or body horror description needed
YOU WRITE: The situation, character reactions, narrative significance
PLACEHOLDER HANDLES: 1-3 sentences of visceral gore description
EXAMPLE:
  "The battlefield revealed the true cost of war. [GORE_DETAIL: type="death", intensity=${intensity}]
  Marcus forced himself to keep walking, to not look back."
`,

  CRUDE_LANGUAGE: (intensity) => `
[CRUDE_LANGUAGE: context="insult|exclamation|description|humor", intensity=${intensity}]

USE WHEN: Narrative needs crude/vulgar language (non-dialogue)
YOU WRITE: The narrative context
PLACEHOLDER HANDLES: The crude phrase or description
EXAMPLE:
  "The graffiti on the wall proclaimed [CRUDE_LANGUAGE: context="insult", intensity=${intensity}]
  Someone had really hated the former mayor."
`
};

/**
 * Build complete placeholder instruction block for OpenAI scaffold generation
 * @param {Object} intensitySettings - The current intensity settings
 * @returns {string} Complete instruction block for the scaffold prompt
 */
export function buildPlaceholderInstructions(intensitySettings) {
  const { violence = 50, gore = 50, romance = 50, adultContent = 0, language = 50 } = intensitySettings;

  const instructions = [];

  instructions.push(`
=== PLACEHOLDER SYSTEM FOR MATURE CONTENT ===

CRITICAL INSTRUCTION: You are generating a SCAFFOLD with placeholders.
DO NOT write explicit content directly. Instead, insert PLACEHOLDERS that will be expanded by a specialized system.

The narrative AROUND placeholders must be rich, complete, and maintain the author's voice.
Placeholders will be seamlessly replaced with content matching the specified intensity.

AVAILABLE PLACEHOLDERS:
`);

  // Add scene-level placeholders based on active intensities
  if (romance >= 61 || adultContent >= 50) {
    instructions.push(SCENE_PLACEHOLDER_INSTRUCTIONS.INTIMATE_SCENE(Math.max(romance, adultContent)));
  }

  if (violence >= 61) {
    instructions.push(SCENE_PLACEHOLDER_INSTRUCTIONS.VIOLENT_CONFRONTATION(violence));
  }

  if (gore >= 61) {
    instructions.push(SCENE_PLACEHOLDER_INSTRUCTIONS.HORROR_MOMENT(gore));
  }

  // Add inline placeholders based on active intensities
  if (violence >= 51 || gore >= 51) {
    instructions.push(INLINE_PLACEHOLDER_INSTRUCTIONS.EXPLICIT_DESCRIPTION(Math.max(violence, gore)));
    instructions.push(INLINE_PLACEHOLDER_INSTRUCTIONS.GORE_DETAIL(gore));
  }

  if (language >= 51) {
    instructions.push(INLINE_PLACEHOLDER_INSTRUCTIONS.PROFANE_DIALOGUE(language));
    instructions.push(INLINE_PLACEHOLDER_INSTRUCTIONS.CRUDE_LANGUAGE(language));
  }

  if (romance >= 51 || adultContent >= 30) {
    instructions.push(INLINE_PLACEHOLDER_INSTRUCTIONS.SENSUAL_DETAIL(Math.max(romance, adultContent)));
  }

  instructions.push(`
=== PLACEHOLDER RULES ===

1. ALWAYS include the intensity parameter matching the story's settings
2. ALWAYS specify characters involved for scene-level placeholders
3. Use INLINE placeholders for single descriptions within paragraphs
4. Use SCENE-LEVEL placeholders for extended sequences (fights, intimate scenes)
5. Write complete narrative before and after placeholders
6. Target word counts (~Nw) are approximate guides
7. Multiple placeholders can appear in the same scene if narratively appropriate

=== WHAT YOU MUST WRITE ===

- Rich atmospheric descriptions
- Character emotions and internal thoughts
- Dialogue (except profane lines - use placeholder)
- Story progression and plot advancement
- Sensory details that aren't explicitly mature
- Transitions and pacing
- Author's distinctive voice and style throughout
`);

  return instructions.join('\n');
}

/**
 * Build Venice expansion prompt for a specific placeholder
 * @param {Object} placeholder - Parsed placeholder object
 * @param {Object} storyContext - Story context and style info
 * @param {Object} authorStyle - Author style configuration
 * @returns {string} Prompt for Venice to expand this placeholder
 */
export function buildExpansionPrompt(placeholder, storyContext, authorStyle) {
  const { type, params, surroundingContext } = placeholder;

  // Get intensity-specific instructions based on type
  const intensityInstructions = getIntensityInstructions(type, params.intensity);

  return `You are enhancing a story written in ${authorStyle?.name || 'a skilled author'}'s style.

=== AUTHOR STYLE ===
${authorStyle?.algorithm || 'Write with vivid sensory detail and emotional depth.'}
Tone: ${authorStyle?.style?.tone || 'engaging and immersive'}
Language: ${authorStyle?.style?.language || 'literary but accessible'}

=== SURROUNDING CONTEXT ===

BEFORE:
"""
${surroundingContext?.before || '[Beginning of scene]'}
"""

AFTER:
"""
${surroundingContext?.after || '[End of scene]'}
"""

=== PLACEHOLDER TO EXPAND ===
Type: ${type}
Intensity: ${params.intensity}/100
${params.characters ? `Characters: ${params.characters}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.type ? `Subtype: ${params.type}` : ''}
${params.target ? `Target: ${params.target}` : ''}
${params.focus ? `Focus: ${params.focus}` : ''}
${params.context ? `Context: ${params.context}` : ''}
${params.emotion ? `Emotion: ${params.emotion}` : ''}
${params.speaker ? `Speaker: ${params.speaker}` : ''}

=== INTENSITY GUIDANCE ===
${intensityInstructions}

=== TARGET LENGTH ===
${params.targetWords ? `Approximately ${params.targetWords} words` : getDefaultWordCount(type)}

=== YOUR TASK ===
Write the expanded content that:
1. Matches the author's distinctive voice and style
2. Flows seamlessly with the surrounding text (no jarring transitions)
3. Honors the intensity level PRECISELY (${params.intensity}% means exactly that level)
4. Maintains character consistency and established traits
5. Uses vivid sensory language appropriate to the content type

OUTPUT: Write ONLY the expanded content. No markers, no explanations, no brackets.
The text should be ready to drop directly into the narrative.
`;
}

/**
 * Get intensity-specific instructions based on placeholder type and level
 */
function getIntensityInstructions(type, intensity) {
  // Intensity tiers - each percentage point matters
  const tier = intensity >= 90 ? 'extreme' :
               intensity >= 80 ? 'very_high' :
               intensity >= 70 ? 'high' :
               intensity >= 60 ? 'moderate_high' :
               intensity >= 50 ? 'moderate' : 'mild';

  const typeInstructions = {
    INTIMATE_SCENE: {
      extreme: 'Explicit, graphic sexual content. No euphemisms. Raw, visceral physical description. All acts shown directly.',
      very_high: 'Very explicit content with graphic physical descriptions. Minimal euphemism. Direct portrayal of sexual acts.',
      high: 'Explicit sexual content with clear physical descriptions. Some poetic language balanced with directness.',
      moderate_high: 'Sensual with explicit moments. Physical intimacy clearly described but with some artistic restraint.',
      moderate: 'Romantic and sensual. Physical intimacy implied more than shown. Emotional connection emphasized.',
      mild: 'Romantic tension and suggestion. Physical intimacy implied, fade-to-black approach.'
    },
    VIOLENT_CONFRONTATION: {
      extreme: 'Brutal, unflinching violence. Graphic injury detail. Visceral combat with realistic consequences.',
      very_high: 'Very graphic violence. Detailed wounds and combat. Bloody and intense with lasting impact.',
      high: 'Graphic violence with clear injury descriptions. Impactful combat that shows real danger.',
      moderate_high: 'Intense action with visible consequences. Violence has weight without gratuitous detail.',
      moderate: 'Action-focused combat. Violence present but not lingered upon. Injuries acknowledged.',
      mild: 'Choreographed action. Violence implied more than shown. Focus on tension over gore.'
    },
    HORROR_MOMENT: {
      extreme: 'Nightmarish, deeply disturbing imagery. No restraint on body horror or psychological terror.',
      very_high: 'Very disturbing content. Graphic body horror, visceral wrongness. Lingering on the terrible.',
      high: 'Genuinely horrifying. Clear disturbing imagery that creates lasting unease.',
      moderate_high: 'Creepy and unsettling with moments of genuine horror. Builds effective dread.',
      moderate: 'Atmospheric horror. Creepy and tense with suggested rather than shown horror.',
      mild: 'Spooky atmosphere. Horror implied, focus on suspense over shock.'
    },
    EXPLICIT_DESCRIPTION: {
      extreme: 'Unflinchingly graphic physical description. Every visceral detail.',
      very_high: 'Very graphic detail. Clear, vivid, unsparing description.',
      high: 'Graphic description with vivid imagery.',
      moderate_high: 'Clear, detailed description with some visceral elements.',
      moderate: 'Descriptive but not gratuitous. Clear imagery without lingering.',
      mild: 'Suggestive description. Implication over explicit detail.'
    },
    PROFANE_DIALOGUE: {
      extreme: 'Extreme profanity. Most vulgar language possible. No restraint.',
      very_high: 'Very strong profanity. Heavy cursing with harsh language.',
      high: 'Strong profanity. Clear curse words used freely.',
      moderate_high: 'Moderate profanity. Some strong language.',
      moderate: 'Mild profanity. Common curse words.',
      mild: 'Very mild language. Substitutes or softened cursing.'
    },
    SENSUAL_DETAIL: {
      extreme: 'Explicitly erotic sensory detail. Graphic physical sensation.',
      very_high: 'Very sensual with erotic undertones. Vivid physical awareness.',
      high: 'Sensual and suggestive. Clear physical desire in the description.',
      moderate_high: 'Romantic sensuality. Heightened physical awareness.',
      moderate: 'Gentle sensuality. Romantic undertones in physical description.',
      mild: 'Subtle romantic tension. Light sensory suggestion.'
    },
    GORE_DETAIL: {
      extreme: 'Extremely graphic gore. Medical-level visceral detail. Unflinching.',
      very_high: 'Very graphic bodily harm or death. Detailed, disturbing.',
      high: 'Graphic gore. Clear injury/death detail that disturbs.',
      moderate_high: 'Visible gore with some graphic elements.',
      moderate: 'Blood and injury present but not lingered upon.',
      mild: 'Injuries acknowledged without graphic detail.'
    },
    CRUDE_LANGUAGE: {
      extreme: 'Extremely vulgar and crude. Most offensive language.',
      very_high: 'Very crude. Harsh vulgar language.',
      high: 'Crude language. Clear vulgarity.',
      moderate_high: 'Some crude elements. Noticeable vulgarity.',
      moderate: 'Mildly crude. Light vulgarity.',
      mild: 'Very mild. Barely crude.'
    }
  };

  return typeInstructions[type]?.[tier] || 'Write content appropriate to the specified intensity level.';
}

/**
 * Get default word count for placeholder type
 */
function getDefaultWordCount(type) {
  // INCREASED: All word counts doubled/tripled for richer content
  const defaults = {
    INTIMATE_SCENE: 'MINIMUM 1500-1800 words - write a FULL scene',
    VIOLENT_CONFRONTATION: 'MINIMUM 1200-1500 words - write COMPLETE combat',
    HORROR_MOMENT: 'MINIMUM 800-1000 words - build FULL atmosphere',
    EXPLICIT_DESCRIPTION: '3-5 detailed sentences',
    PROFANE_DIALOGUE: '1-2 dialogue lines with context',
    SENSUAL_DETAIL: '3-5 evocative sentences',
    GORE_DETAIL: '3-5 visceral sentences',
    CRUDE_LANGUAGE: '1-2 phrases with impact'
  };

  return defaults[type] || 'Write substantial content - do not abbreviate';
}

/**
 * Check if scaffolding pipeline should be used based on intensity settings
 * @param {string} audienceSetting - 'general', 'teen', or 'mature'
 * @param {Object} intensitySettings - The intensity slider values
 * @returns {boolean} Whether to use the scaffolding pipeline
 */
export function shouldUseScaffoldingPipeline(audienceSetting, intensitySettings) {
  if (audienceSetting !== 'mature') {
    return false;
  }

  const { violence = 50, gore = 50, romance = 50, adultContent = 0, language = 50 } = intensitySettings;

  return (
    violence >= 61 ||
    gore >= 61 ||
    adultContent >= 50 ||
    romance >= 71 ||
    language >= 51
  );
}

export default {
  PLACEHOLDER_TYPES,
  SCENE_PLACEHOLDER_INSTRUCTIONS,
  INLINE_PLACEHOLDER_INSTRUCTIONS,
  buildPlaceholderInstructions,
  buildExpansionPrompt,
  shouldUseScaffoldingPipeline
};
