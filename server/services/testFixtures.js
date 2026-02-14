/**
 * Test Story Fixtures
 *
 * Pre-written scenes with dialogue_maps for testing the voice pipeline
 * without expensive LLM story generation calls.
 *
 * Each fixture provides:
 * - config: Story session configuration
 * - outline: Minimal story outline
 * - characters: Pre-defined characters with gender, role, age
 * - scene: polished_text + dialogue_map with pre-calculated positions
 *
 * POSITION VALIDATION: Every fixture includes a self-check function
 * that verifies dialogue_map positions match the polished_text.
 */

/**
 * Fixture 1: Basic Multi-Voice
 * Tests: voice assignment, narrator/character switching, basic emotion, speech tag hiding
 */
const basic_multivoice = {
  name: 'Basic Multi-Voice',
  description: 'Tests voice assignment, narrator switching, basic emotion, speech tag filtering',
  config: {
    genre: 'thriller',
    mood: 'tense',
    audience: 'general',
    hide_speech_tags: true,
    multi_voice: true,
    story_format: 'short_story'
  },
  outline: {
    title: 'Test: The Meeting',
    synopsis: 'Two people meet in a tense room.',
    setting: 'A dimly lit office',
    themes: ['tension', 'mystery']
  },
  characters: [
    { name: 'Sam', gender: 'male', role: 'protagonist', age_group: 'adult', description: 'A calm British man with a steady voice' },
    { name: 'Elena', gender: 'female', role: 'supporting', age_group: 'adult', description: 'A fiery Spanish woman with a sharp tongue' }
  ],
  scene: {
    polished_text: 'The room fell silent as the door creaked open. "I\'ve been expecting you," said Sam, his voice steady despite the tension. Elena stepped forward, her eyes blazing. "You have no idea what you\'ve done," she hissed through gritted teeth. Sam raised a hand. "Let me explain before you do something we both regret." The clock on the wall ticked loudly in the silence that followed.',
    dialogue_map: [
      { speaker: 'Sam', quote: "I've been expecting you", emotion: 'calm', delivery: null, start_char: 47, end_char: 73, index: 0, confidence: 1.0 },
      { speaker: 'Elena', quote: "You have no idea what you've done", emotion: 'angry', delivery: 'hissed', start_char: 163, end_char: 199, index: 1, confidence: 1.0 },
      { speaker: 'Sam', quote: 'Let me explain before you do something we both regret', emotion: 'calm', delivery: null, start_char: 253, end_char: 309, index: 2, confidence: 1.0 }
    ],
    summary: 'Sam and Elena have a tense confrontation in a dim office.',
    mood: 'tense'
  }
};

/**
 * Fixture 2: Tricky Character Names
 * Tests: parenthetical names, abbreviations, apostrophes, title prefixes
 */
const tricky_names = {
  name: 'Tricky Character Names',
  description: 'Tests edge cases: parentheticals, abbreviations, special characters in names',
  config: {
    genre: 'sci-fi',
    mood: 'tense',
    audience: 'general',
    hide_speech_tags: true,
    multi_voice: true,
    story_format: 'short_story'
  },
  outline: {
    title: 'Test: Odds of Survival',
    synopsis: 'A robot, a scientist, and a mercenary face impossible odds.',
    setting: 'A battered spacecraft bridge',
    themes: ['survival', 'teamwork']
  },
  characters: [
    { name: 'A.R.G.U.S. (Automated Ration Governance Utility System)', gender: 'male', role: 'supporting', age_group: 'adult', description: 'A monotone ship AI with a flat robotic voice' },
    { name: 'Dr. Chen', gender: 'female', role: 'protagonist', age_group: 'adult', description: 'A nervous but brilliant scientist' },
    { name: "O'Brien", gender: 'male', role: 'supporting', age_group: 'adult', description: 'A gruff Irish mercenary who laughs at danger' }
  ],
  scene: {
    polished_text: 'A.R.G.U.S. computed the probability silently. "The odds of survival are precisely twelve point three percent," it announced in a flat monotone. Dr. Chen adjusted her glasses. "That\'s not very reassuring," she muttered. O\'Brien cracked his knuckles. "Twelve percent is all I need," he said with a grin.',
    dialogue_map: [
      { speaker: 'A.R.G.U.S.', quote: 'The odds of survival are precisely twelve point three percent', emotion: 'neutral', delivery: 'announced', start_char: 46, end_char: 110, index: 0, confidence: 1.0 },
      { speaker: 'Dr. Chen', quote: "That's not very reassuring", emotion: 'nervous', delivery: 'muttered', start_char: 175, end_char: 204, index: 1, confidence: 1.0 },
      { speaker: "O'Brien", quote: 'Twelve percent is all I need', emotion: 'confident', delivery: null, start_char: 249, end_char: 280, index: 2, confidence: 1.0 }
    ],
    summary: 'The crew faces impossible odds but stays determined.',
    mood: 'tense'
  }
};

/**
 * Fixture 3: Emotion Transitions
 * Tests: whisper/shout delivery, emotion changes within one character, V3 audio tags
 */
const emotion_transitions = {
  name: 'Emotion Transitions',
  description: 'Tests whisper/shout, emotion transitions, V3 audio tag generation',
  config: {
    genre: 'drama',
    mood: 'intense',
    audience: 'general',
    hide_speech_tags: true,
    multi_voice: true,
    story_format: 'short_story'
  },
  outline: {
    title: 'Test: The Confession',
    synopsis: 'A man reveals a terrible secret through rising panic.',
    setting: 'A dark alleyway at night',
    themes: ['fear', 'regret', 'urgency']
  },
  characters: [
    { name: 'Marcus', gender: 'male', role: 'protagonist', age_group: 'adult', description: 'A haunted man whose voice ranges from whisper to scream' }
  ],
  scene: {
    polished_text: 'Marcus leaned close. "I know the secret," he whispered, barely audible. Then his eyes widened. "They\'re coming! Run! NOW!" he screamed at the top of his lungs. His voice dropped again, broken. "I\'m sorry. I should have told you sooner." A single tear traced down his cheek.',
    dialogue_map: [
      { speaker: 'Marcus', quote: 'I know the secret', emotion: 'calm', delivery: 'whispered', start_char: 21, end_char: 41, index: 0, confidence: 1.0 },
      { speaker: 'Marcus', quote: "They're coming! Run! NOW!", emotion: 'fearful', delivery: 'screamed', start_char: 95, end_char: 122, index: 1, confidence: 1.0 },
      { speaker: 'Marcus', quote: "I'm sorry. I should have told you sooner.", emotion: 'sad', delivery: null, start_char: 193, end_char: 236, index: 2, confidence: 1.0 }
    ],
    summary: 'Marcus reveals a terrible secret through escalating panic.',
    mood: 'intense'
  }
};

/**
 * Fixture 4: Many Speakers (stress test)
 * Tests: voice pool with 6 characters, ensuring unique voice assignment
 */
const many_speakers = {
  name: 'Many Speakers Stress Test',
  description: 'Tests voice pool exhaustion with 6 distinct characters (3M, 3F)',
  config: {
    genre: 'fantasy',
    mood: 'adventurous',
    audience: 'general',
    hide_speech_tags: true,
    multi_voice: true,
    story_format: 'short_story'
  },
  outline: {
    title: 'Test: The Council',
    synopsis: 'Six adventurers debate their next move around a campfire.',
    setting: 'A forest clearing with a crackling campfire',
    themes: ['adventure', 'teamwork']
  },
  characters: [
    { name: 'Aldric', gender: 'male', role: 'protagonist', age_group: 'adult', description: 'A grizzled warrior with a deep commanding voice' },
    { name: 'Lira', gender: 'female', role: 'supporting', age_group: 'young_adult', description: 'A quick-witted young rogue' },
    { name: 'Brom', gender: 'male', role: 'supporting', age_group: 'middle_aged', description: 'A jovial dwarven blacksmith' },
    { name: 'Sera', gender: 'female', role: 'supporting', age_group: 'adult', description: 'A calm elven healer with a soothing voice' },
    { name: 'Thane', gender: 'male', role: 'supporting', age_group: 'young_adult', description: 'An anxious young mage' },
    { name: 'Mira', gender: 'female', role: 'supporting', age_group: 'middle_aged', description: 'A stern dwarven shieldmaiden' }
  ],
  scene: {
    polished_text: 'The fire crackled as the group gathered close. "We march at dawn," Aldric announced. Lira rolled her eyes. "Brilliant plan. Walk into a dragon\'s lair at sunrise." Brom laughed heartily. "Better than sneaking in at night like cowards!" Sera placed a calming hand on Brom\'s arm. "Perhaps we should consider all options first." Thane clutched his staff nervously. "I-I could scout ahead with a scrying spell." Mira slammed her fist on the log. "Enough talk. We fight or we flee. Choose now."',
    dialogue_map: [
      { speaker: 'Aldric', quote: 'We march at dawn', emotion: 'determined', delivery: 'announced', start_char: 47, end_char: 66, index: 0, confidence: 1.0 },
      { speaker: 'Lira', quote: "Brilliant plan. Walk into a dragon's lair at sunrise.", emotion: 'sarcastic', delivery: null, start_char: 107, end_char: 162, index: 1, confidence: 1.0 },
      { speaker: 'Brom', quote: 'Better than sneaking in at night like cowards!', emotion: 'amused', delivery: 'laughed', start_char: 186, end_char: 234, index: 2, confidence: 1.0 },
      { speaker: 'Sera', quote: 'Perhaps we should consider all options first.', emotion: 'calm', delivery: null, start_char: 277, end_char: 324, index: 3, confidence: 1.0 },
      { speaker: 'Thane', quote: 'I-I could scout ahead with a scrying spell.', emotion: 'nervous', delivery: null, start_char: 361, end_char: 406, index: 4, confidence: 1.0 },
      { speaker: 'Mira', quote: 'Enough talk. We fight or we flee. Choose now.', emotion: 'angry', delivery: 'slammed', start_char: 441, end_char: 488, index: 5, confidence: 1.0 }
    ],
    summary: 'Six adventurers debate strategy around a campfire.',
    mood: 'adventurous'
  }
};

/**
 * Fixture 5: Speech Tag Edge Cases
 * Tests: dense attribution, varied speech tags, proper filtering
 */
const speech_tag_edge_cases = {
  name: 'Speech Tag Edge Cases',
  description: 'Tests dense speech attribution filtering: said, replied, muttered, bellowed, etc.',
  config: {
    genre: 'adventure',
    mood: 'exciting',
    audience: 'general',
    hide_speech_tags: true,
    multi_voice: true,
    story_format: 'short_story'
  },
  outline: {
    title: 'Test: Storm Warning',
    synopsis: 'Sailors prepare for a storm with heavily attributed dialogue.',
    setting: 'The deck of a wooden sailing ship',
    themes: ['danger', 'duty']
  },
  characters: [
    { name: 'Captain Voss', gender: 'male', role: 'protagonist', age_group: 'middle_aged', description: 'A weathered sea captain with a booming voice' },
    { name: 'Finch', gender: 'male', role: 'supporting', age_group: 'young_adult', description: 'A nervous first mate' },
    { name: 'Old Meg', gender: 'female', role: 'supporting', age_group: 'elderly', description: 'An old sailor who speaks through a pipe' }
  ],
  scene: {
    polished_text: '"Hello there," said the captain, adjusting his hat. "Welcome aboard," replied Finch with a nervous nod. The wind howled across the deck. "Storm\'s coming," muttered Old Meg through her pipe. Captain Voss nodded grimly. "All hands on deck!" he bellowed, his voice carrying over the wind. "Should we reef the sails?" asked Finch, gripping the rail. Old Meg spat over the side. "Too late for that, boy," she said with a raspy laugh.',
    dialogue_map: [
      { speaker: 'Captain Voss', quote: 'Hello there', emotion: 'neutral', delivery: null, start_char: 0, end_char: 14, index: 0, confidence: 1.0 },
      { speaker: 'Finch', quote: 'Welcome aboard', emotion: 'nervous', delivery: null, start_char: 52, end_char: 69, index: 1, confidence: 1.0 },
      { speaker: 'Old Meg', quote: "Storm's coming", emotion: 'calm', delivery: 'muttered', start_char: 137, end_char: 154, index: 2, confidence: 1.0 },
      { speaker: 'Captain Voss', quote: 'All hands on deck!', emotion: 'urgent', delivery: 'bellowed', start_char: 218, end_char: 238, index: 3, confidence: 1.0 },
      { speaker: 'Finch', quote: 'Should we reef the sails?', emotion: 'nervous', delivery: 'asked', start_char: 286, end_char: 313, index: 4, confidence: 1.0 },
      { speaker: 'Old Meg', quote: 'Too late for that, boy', emotion: 'amused', delivery: null, start_char: 374, end_char: 399, index: 5, confidence: 1.0 }
    ],
    summary: 'Sailors exchange heavily-attributed dialogue before a storm.',
    mood: 'exciting'
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

export const TEST_FIXTURES = {
  basic_multivoice,
  tricky_names,
  emotion_transitions,
  many_speakers,
  speech_tag_edge_cases
};

/**
 * Validate that all dialogue_map positions match the polished_text.
 * Call this to verify fixture integrity.
 */
export function validateFixture(fixtureName) {
  const fixture = TEST_FIXTURES[fixtureName];
  if (!fixture) return { valid: false, errors: [`Unknown fixture: ${fixtureName}`] };

  const errors = [];
  const text = fixture.scene.polished_text;

  for (const d of fixture.scene.dialogue_map) {
    const extracted = text.slice(d.start_char, d.end_char);
    // Remove surrounding quotes for comparison
    const cleaned = extracted.replace(/^[""\u201C\u201D'"]+/, '').replace(/[""\u201C\u201D'"]+$/, '').trim();
    const quoteClean = d.quote.replace(/^[""\u201C\u201D'"]+/, '').replace(/[""\u201C\u201D'"]+$/, '').trim();

    if (!cleaned.includes(quoteClean) && !quoteClean.includes(cleaned)) {
      errors.push({
        index: d.index,
        speaker: d.speaker,
        expected: d.quote,
        found: extracted,
        start_char: d.start_char,
        end_char: d.end_char
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all fixtures and return results.
 */
export function validateAllFixtures() {
  const results = {};
  for (const name of Object.keys(TEST_FIXTURES)) {
    results[name] = validateFixture(name);
  }
  return results;
}

/**
 * Hardcoded voice mappings for zero-LLM-cost test runs.
 * Maps character names (lowercase) to known ElevenLabs voice IDs.
 */
export const HARDCODED_VOICE_MAP = {
  // Basic Multi-Voice
  'sam': 'TxGEqnHWrfWFTfGW9XjX',           // Josh - deep American male
  'elena': 'MF3mGyEYCl7XYWbV9V6O',          // Elli - emotional female

  // Tricky Names
  'a.r.g.u.s.': 'GBv7mTt0atIp3Br8iCZE',    // Thomas - calm male (robotic feel)
  'a.r.g.u.s. (automated ration governance utility system)': 'GBv7mTt0atIp3Br8iCZE',
  'dr. chen': 'pFZP5JQG7iQjIQuC4Bku',       // Lily - British warm female
  "o'brien": 'IKne3meq5aSn9XLyUdCD',         // Charlie - Australian male (Irish-ish)

  // Emotion Transitions
  'marcus': 'N2lVS1w4EtoT3dr4eOWO',         // Callum - gravelly male

  // Many Speakers
  'aldric': 'onwK4e9ZLuTAKqWW03F9',         // Daniel - authoritative male
  'lira': 'jBpfuIE2acCO8z3wKNLl',           // Gigi - young female
  'brom': 'CYw3kZ02Hs0563khs1Fj',           // Dave - conversational male
  'sera': 'EXAVITQu4vr4xnSDxMaL',           // Bella - soft female
  'thane': 'SOYHLrjzK2X1ezoPC6cr',          // Harry - anxious young male
  'mira': 'ThT5KcBeYPX3keUQqHPh',           // Dorothy - pleasant British female

  // Speech Tag Edge Cases
  'captain voss': 'pNInz6obpgDQGcFmaJgB',   // Adam - deep middle-aged male
  'finch': 'g5CIjZEefAph4nQFvHAz',          // Ethan - young male
  'old meg': 'oWAxZDx7w5VEj9dCyTzz',        // Grace - gentle Southern female
};

export default {
  TEST_FIXTURES,
  HARDCODED_VOICE_MAP,
  validateFixture,
  validateAllFixtures
};
