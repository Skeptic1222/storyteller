/**
 * Quality Validation Utilities
 * LOW priority story quality analysis functions.
 *
 * These utilities analyze story content for quality metrics:
 * - Dialogue rhythm analysis
 * - Emotion sequence validation
 * - Proper noun spelling consistency
 * - Pacing analysis
 * - Dialogue proportion validation
 *
 * Part of Storyteller LLM Logic improvements.
 */

import { logger } from './logger.js';

// ============================================================================
// LOW-1: DIALOGUE RHYTHM ANALYSIS
// Analyzes the flow and pacing of dialogue exchanges
// ============================================================================

/**
 * Dialogue rhythm patterns
 */
const RHYTHM_PATTERNS = {
  RAPID_FIRE: 'rapid_fire',      // Short, quick exchanges (<10 words each)
  CONVERSATIONAL: 'conversational', // Normal back-and-forth (10-30 words)
  MONOLOGUE: 'monologue',        // One speaker dominates (>50 words uninterrupted)
  BALANCED: 'balanced',          // Varied rhythm throughout
  STACCATO: 'staccato'           // Very short, punchy exchanges (<5 words)
};

/**
 * Analyze dialogue rhythm in a scene
 * @param {Array} dialogueSegments - Array of { speaker, text } objects
 * @returns {object} Rhythm analysis result
 */
export function analyzeDialogueRhythm(dialogueSegments) {
  if (!dialogueSegments || dialogueSegments.length < 2) {
    return {
      pattern: null,
      metrics: { averageLength: 0, variance: 0, exchangeCount: 0 },
      issues: [],
      score: 100
    };
  }

  const lengths = dialogueSegments.map(seg => countWords(seg.text));
  const averageLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = calculateVariance(lengths, averageLength);

  // Detect consecutive same-speaker segments (potential monologue)
  const monologueSegments = detectMonologues(dialogueSegments);

  // Detect rapid-fire exchanges
  const rapidFireRuns = detectRapidFire(lengths);

  // Determine overall pattern
  let pattern = RHYTHM_PATTERNS.BALANCED;
  if (averageLength < 5) {
    pattern = RHYTHM_PATTERNS.STACCATO;
  } else if (averageLength < 10 && variance < 20) {
    pattern = RHYTHM_PATTERNS.RAPID_FIRE;
  } else if (monologueSegments.length > 0) {
    pattern = RHYTHM_PATTERNS.MONOLOGUE;
  } else if (averageLength >= 10 && averageLength <= 30) {
    pattern = RHYTHM_PATTERNS.CONVERSATIONAL;
  }

  // Calculate quality issues
  const issues = [];
  let score = 100;

  // Issue: Too many monologues
  if (monologueSegments.length > 2) {
    issues.push({
      type: 'excessive_monologue',
      message: `${monologueSegments.length} monologue segments detected`,
      severity: 'medium'
    });
    score -= 10 * (monologueSegments.length - 2);
  }

  // Issue: Monotonous rhythm (low variance)
  if (variance < 10 && lengths.length > 5) {
    issues.push({
      type: 'monotonous_rhythm',
      message: `Low dialogue length variance (${variance.toFixed(1)}) - consider varying pacing`,
      severity: 'low'
    });
    score -= 5;
  }

  // Issue: Excessive rapid-fire
  if (rapidFireRuns > lengths.length * 0.7) {
    issues.push({
      type: 'excessive_rapid_fire',
      message: 'Too many short exchanges in a row',
      severity: 'low'
    });
    score -= 5;
  }

  logger.debug(`[QualityValidation] Dialogue rhythm: pattern=${pattern}, avgLen=${averageLength.toFixed(1)}, score=${score}`);

  return {
    pattern,
    metrics: {
      averageLength: Math.round(averageLength * 10) / 10,
      variance: Math.round(variance * 10) / 10,
      exchangeCount: dialogueSegments.length,
      monologueCount: monologueSegments.length,
      rapidFirePercentage: Math.round((rapidFireRuns / lengths.length) * 100)
    },
    issues,
    score: Math.max(0, score)
  };
}

// ============================================================================
// LOW-2: EMOTION SEQUENCE VALIDATION
// Validates psychological realism of emotional progressions
// ============================================================================

/**
 * Emotion transition probabilities (psychological realism)
 * Based on Plutchik's wheel of emotions - opposite emotions require transitions
 */
const EMOTION_TRANSITIONS = {
  // Valid direct transitions (no intermediate required)
  DIRECT: {
    joy: ['surprise', 'trust', 'anticipation', 'neutral'],
    sadness: ['fear', 'disgust', 'neutral', 'anger'],
    anger: ['disgust', 'anticipation', 'sadness', 'neutral'],
    fear: ['surprise', 'sadness', 'neutral'],
    surprise: ['joy', 'fear', 'neutral'],
    disgust: ['anger', 'sadness', 'neutral'],
    trust: ['joy', 'anticipation', 'neutral'],
    anticipation: ['joy', 'anger', 'trust', 'neutral']
  },

  // Transitions that require intermediate emotions
  REQUIRES_TRANSITION: [
    { from: 'joy', to: 'sadness', via: ['neutral', 'surprise'] },
    { from: 'sadness', to: 'joy', via: ['neutral', 'anticipation'] },
    { from: 'anger', to: 'fear', via: ['neutral', 'surprise'] },
    { from: 'fear', to: 'anger', via: ['neutral', 'anticipation'] },
    { from: 'trust', to: 'disgust', via: ['neutral', 'surprise'] },
    { from: 'disgust', to: 'trust', via: ['neutral', 'anticipation'] }
  ]
};

/**
 * Validate emotion sequence for psychological realism
 * @param {Array} emotionSequence - Array of { timestamp, emotion, intensity } objects
 * @returns {object} Validation result
 */
export function validateEmotionSequence(emotionSequence) {
  if (!emotionSequence || emotionSequence.length < 2) {
    return {
      valid: true,
      issues: [],
      transitions: [],
      score: 100
    };
  }

  const issues = [];
  const transitions = [];
  let score = 100;

  for (let i = 1; i < emotionSequence.length; i++) {
    const prev = emotionSequence[i - 1];
    const curr = emotionSequence[i];

    const fromEmotion = normalizeEmotion(prev.emotion);
    const toEmotion = normalizeEmotion(curr.emotion);

    // Skip if same emotion
    if (fromEmotion === toEmotion) {
      transitions.push({ from: fromEmotion, to: toEmotion, valid: true, type: 'same' });
      continue;
    }

    // Check if direct transition is valid
    const validDirect = EMOTION_TRANSITIONS.DIRECT[fromEmotion]?.includes(toEmotion);

    // Check if transition requires intermediate
    const requiresIntermediate = EMOTION_TRANSITIONS.REQUIRES_TRANSITION.find(
      t => t.from === fromEmotion && t.to === toEmotion
    );

    if (validDirect) {
      transitions.push({ from: fromEmotion, to: toEmotion, valid: true, type: 'direct' });
    } else if (requiresIntermediate) {
      // Check intensity change - large jumps are more jarring
      const intensityDelta = Math.abs((curr.intensity || 50) - (prev.intensity || 50));

      if (intensityDelta > 30) {
        issues.push({
          type: 'abrupt_emotion_shift',
          message: `Abrupt shift from ${fromEmotion} to ${toEmotion} (intensity change: ${intensityDelta})`,
          position: i,
          severity: 'medium',
          suggestion: `Consider transitioning via ${requiresIntermediate.via.join(' or ')}`
        });
        score -= 15;
      } else {
        // Minor jarring but acceptable
        transitions.push({ from: fromEmotion, to: toEmotion, valid: true, type: 'acceptable_jump' });
        score -= 5;
      }
    } else if (fromEmotion !== 'neutral' && toEmotion !== 'neutral') {
      // Unknown transition - flag for review
      transitions.push({ from: fromEmotion, to: toEmotion, valid: false, type: 'unknown' });
      issues.push({
        type: 'unusual_transition',
        message: `Unusual emotion transition: ${fromEmotion} to ${toEmotion}`,
        position: i,
        severity: 'low'
      });
      score -= 3;
    }
  }

  logger.debug(`[QualityValidation] Emotion sequence: ${transitions.length} transitions, ${issues.length} issues, score=${score}`);

  return {
    valid: issues.filter(i => i.severity !== 'low').length === 0,
    issues,
    transitions,
    score: Math.max(0, score)
  };
}

// ============================================================================
// LOW-3: PROPER NOUN SPELLING CONSISTENCY
// Tracks and validates consistent spelling of names/places
// ============================================================================

/**
 * Extract and validate proper noun consistency
 * @param {string} fullText - Complete story text
 * @param {Array} characterNames - Known character names from DB
 * @param {Array} locationNames - Known location names from DB
 * @returns {object} Consistency analysis
 */
export function validateProperNounConsistency(fullText, characterNames = [], locationNames = []) {
  if (!fullText || fullText.length < 100) {
    return {
      consistent: true,
      issues: [],
      detectedNouns: {},
      score: 100
    };
  }

  const issues = [];
  let score = 100;

  // Build known noun map with lowercase keys for comparison
  const knownNouns = {};
  [...characterNames, ...locationNames].forEach(name => {
    if (name && name.length > 2) {
      knownNouns[name.toLowerCase()] = { canonical: name, count: 0, variants: new Set() };
    }
  });

  // Extract capitalized words (potential proper nouns)
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const foundNouns = {};
  let match;

  while ((match = properNounPattern.exec(fullText)) !== null) {
    const noun = match[1];
    const lowerNoun = noun.toLowerCase();

    // Skip common words that are capitalized (sentence starts, etc.)
    if (isCommonWord(noun)) continue;

    if (!foundNouns[lowerNoun]) {
      foundNouns[lowerNoun] = { variants: new Set(), count: 0 };
    }
    foundNouns[lowerNoun].variants.add(noun);
    foundNouns[lowerNoun].count++;
  }

  // Check for inconsistent spellings
  for (const [lowerNoun, data] of Object.entries(foundNouns)) {
    // Skip single occurrences
    if (data.count < 2) continue;

    const variants = Array.from(data.variants);

    // Check against known nouns
    if (knownNouns[lowerNoun]) {
      const canonical = knownNouns[lowerNoun].canonical;
      const wrongVariants = variants.filter(v => v !== canonical);

      if (wrongVariants.length > 0) {
        issues.push({
          type: 'known_noun_misspelling',
          noun: canonical,
          variants: wrongVariants,
          message: `"${canonical}" also appears as: ${wrongVariants.join(', ')}`,
          severity: 'high'
        });
        score -= 10 * wrongVariants.length;
      }
    } else if (variants.length > 1) {
      // Unknown noun with inconsistent spelling
      issues.push({
        type: 'inconsistent_spelling',
        noun: variants[0],
        variants: variants.slice(1),
        message: `Inconsistent spelling: ${variants.join(', ')}`,
        severity: 'medium'
      });
      score -= 5;
    }
  }

  logger.debug(`[QualityValidation] Proper noun consistency: ${Object.keys(foundNouns).length} nouns, ${issues.length} issues`);

  return {
    consistent: issues.filter(i => i.severity === 'high').length === 0,
    issues,
    detectedNouns: foundNouns,
    score: Math.max(0, score)
  };
}

// ============================================================================
// LOW-4: PACING ANALYSIS
// Analyzes scene length relative to chapter/story
// ============================================================================

/**
 * Pacing thresholds (in words)
 */
const PACING_THRESHOLDS = {
  MIN_SCENE_LENGTH: 200,
  MAX_SCENE_LENGTH: 3000,
  IDEAL_SCENE_RANGE: [500, 1500],
  VARIANCE_THRESHOLD: 0.5  // 50% variance from average is concerning
};

/**
 * Analyze scene pacing within a chapter/story
 * @param {Array} scenes - Array of { text, sequenceIndex } objects
 * @param {object} options - Analysis options
 * @returns {object} Pacing analysis
 */
export function analyzePacing(scenes, options = {}) {
  if (!scenes || scenes.length < 2) {
    return {
      balanced: true,
      issues: [],
      metrics: {},
      score: 100
    };
  }

  const issues = [];
  let score = 100;

  // Calculate word counts
  const wordCounts = scenes.map((scene, idx) => ({
    index: scene.sequenceIndex ?? idx,
    words: countWords(scene.text || scene.polished_text || '')
  }));

  const totalWords = wordCounts.reduce((sum, s) => sum + s.words, 0);
  const averageWords = totalWords / wordCounts.length;
  const variance = calculateVariance(wordCounts.map(s => s.words), averageWords);
  const stdDev = Math.sqrt(variance);

  // Check for scenes that are too short or too long
  const tooShort = wordCounts.filter(s => s.words < PACING_THRESHOLDS.MIN_SCENE_LENGTH);
  const tooLong = wordCounts.filter(s => s.words > PACING_THRESHOLDS.MAX_SCENE_LENGTH);

  if (tooShort.length > 0) {
    issues.push({
      type: 'scenes_too_short',
      scenes: tooShort.map(s => s.index),
      message: `${tooShort.length} scene(s) below ${PACING_THRESHOLDS.MIN_SCENE_LENGTH} words`,
      severity: 'medium'
    });
    score -= 5 * tooShort.length;
  }

  if (tooLong.length > 0) {
    issues.push({
      type: 'scenes_too_long',
      scenes: tooLong.map(s => s.index),
      message: `${tooLong.length} scene(s) exceed ${PACING_THRESHOLDS.MAX_SCENE_LENGTH} words`,
      severity: 'medium'
    });
    score -= 5 * tooLong.length;
  }

  // Check for high variance (inconsistent pacing)
  const coefficientOfVariation = stdDev / averageWords;
  if (coefficientOfVariation > PACING_THRESHOLDS.VARIANCE_THRESHOLD) {
    issues.push({
      type: 'inconsistent_pacing',
      message: `High scene length variance (CV: ${(coefficientOfVariation * 100).toFixed(1)}%)`,
      severity: 'low'
    });
    score -= 10;
  }

  // Check for dramatic length changes between consecutive scenes
  for (let i = 1; i < wordCounts.length; i++) {
    const prevLength = wordCounts[i - 1].words;
    const currLength = wordCounts[i].words;
    const ratio = Math.max(prevLength, currLength) / Math.max(Math.min(prevLength, currLength), 1);

    if (ratio > 3) {
      issues.push({
        type: 'abrupt_length_change',
        fromScene: wordCounts[i - 1].index,
        toScene: wordCounts[i].index,
        ratio: Math.round(ratio * 10) / 10,
        message: `Scene ${wordCounts[i].index} is ${ratio.toFixed(1)}x different from previous`,
        severity: 'low'
      });
      score -= 3;
    }
  }

  logger.debug(`[QualityValidation] Pacing: avg=${averageWords.toFixed(0)} words, CV=${(coefficientOfVariation * 100).toFixed(1)}%`);

  return {
    balanced: issues.filter(i => i.severity !== 'low').length === 0,
    issues,
    metrics: {
      totalWords,
      averageWords: Math.round(averageWords),
      sceneCount: scenes.length,
      minWords: Math.min(...wordCounts.map(s => s.words)),
      maxWords: Math.max(...wordCounts.map(s => s.words)),
      standardDeviation: Math.round(stdDev),
      coefficientOfVariation: Math.round(coefficientOfVariation * 100)
    },
    score: Math.max(0, score)
  };
}

// ============================================================================
// LOW-5: DIALOGUE PROPORTION VALIDATION
// Validates balance between dialogue and narration
// ============================================================================

/**
 * Dialogue proportion thresholds by genre
 */
const DIALOGUE_PROPORTION_THRESHOLDS = {
  // Genre-specific ideal ranges [min%, max%]
  action: [25, 45],
  romance: [35, 55],
  mystery: [30, 50],
  fantasy: [25, 45],
  horror: [20, 40],
  literary: [30, 50],
  thriller: [30, 50],
  scifi: [25, 45],
  default: [25, 50]
};

/**
 * Validate dialogue vs narration proportion
 * @param {string} text - Scene or chapter text
 * @param {string} genre - Story genre (optional)
 * @returns {object} Proportion analysis
 */
export function validateDialogueProportion(text, genre = 'default') {
  if (!text || text.length < 100) {
    return {
      balanced: true,
      issues: [],
      metrics: {},
      score: 100
    };
  }

  const issues = [];
  let score = 100;

  // Extract dialogue (text within quotes)
  const dialoguePattern = /"[^"]+"|"[^"]+"|'[^']+'/g;
  const dialogueMatches = text.match(dialoguePattern) || [];
  const dialogueText = dialogueMatches.join(' ');

  const totalWords = countWords(text);
  const dialogueWords = countWords(dialogueText);
  const narrationWords = totalWords - dialogueWords;

  const dialoguePercent = (dialogueWords / totalWords) * 100;
  const narrationPercent = 100 - dialoguePercent;

  // Get thresholds for genre
  const thresholds = DIALOGUE_PROPORTION_THRESHOLDS[genre.toLowerCase()] ||
    DIALOGUE_PROPORTION_THRESHOLDS.default;
  const [minDialogue, maxDialogue] = thresholds;

  // Check if dialogue proportion is within acceptable range
  if (dialoguePercent < minDialogue) {
    issues.push({
      type: 'too_little_dialogue',
      percent: Math.round(dialoguePercent),
      expected: `${minDialogue}-${maxDialogue}%`,
      message: `Only ${dialoguePercent.toFixed(1)}% dialogue (expected ${minDialogue}-${maxDialogue}% for ${genre})`,
      severity: dialoguePercent < minDialogue - 10 ? 'medium' : 'low'
    });
    score -= dialoguePercent < minDialogue - 10 ? 15 : 5;
  } else if (dialoguePercent > maxDialogue) {
    issues.push({
      type: 'too_much_dialogue',
      percent: Math.round(dialoguePercent),
      expected: `${minDialogue}-${maxDialogue}%`,
      message: `${dialoguePercent.toFixed(1)}% dialogue (expected ${minDialogue}-${maxDialogue}% for ${genre})`,
      severity: dialoguePercent > maxDialogue + 10 ? 'medium' : 'low'
    });
    score -= dialoguePercent > maxDialogue + 10 ? 15 : 5;
  }

  // Check for dialogue-heavy sections followed by narration-heavy sections
  const sections = splitIntoSections(text, 500);
  let lastSectionType = null;
  let consecutiveShifts = 0;

  for (const section of sections) {
    const sectionDialogue = countDialogueWords(section) / Math.max(countWords(section), 1);
    const sectionType = sectionDialogue > 0.5 ? 'dialogue' : 'narration';

    if (lastSectionType && sectionType !== lastSectionType) {
      consecutiveShifts++;
    }
    lastSectionType = sectionType;
  }

  // Flag excessive shifting (indicates poor flow)
  if (consecutiveShifts > sections.length * 0.6 && sections.length > 3) {
    issues.push({
      type: 'choppy_flow',
      message: 'Frequent shifts between dialogue-heavy and narration-heavy sections',
      severity: 'low'
    });
    score -= 5;
  }

  logger.debug(`[QualityValidation] Dialogue proportion: ${dialoguePercent.toFixed(1)}% dialogue, ${issues.length} issues`);

  return {
    balanced: issues.filter(i => i.severity !== 'low').length === 0,
    issues,
    metrics: {
      totalWords,
      dialogueWords,
      narrationWords,
      dialoguePercent: Math.round(dialoguePercent * 10) / 10,
      narrationPercent: Math.round(narrationPercent * 10) / 10,
      genre,
      idealRange: thresholds
    },
    score: Math.max(0, score)
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Count words in text
 */
function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Calculate variance of an array
 */
function calculateVariance(values, mean) {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Detect monologue segments (same speaker for 3+ consecutive segments or >50 words)
 */
function detectMonologues(segments) {
  const monologues = [];
  let currentSpeaker = null;
  let consecutiveCount = 0;
  let wordCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker === currentSpeaker) {
      consecutiveCount++;
      wordCount += countWords(seg.text);
    } else {
      if (consecutiveCount >= 3 || wordCount > 50) {
        monologues.push({ speaker: currentSpeaker, segments: consecutiveCount, words: wordCount });
      }
      currentSpeaker = seg.speaker;
      consecutiveCount = 1;
      wordCount = countWords(seg.text);
    }
  }

  // Check final segment
  if (consecutiveCount >= 3 || wordCount > 50) {
    monologues.push({ speaker: currentSpeaker, segments: consecutiveCount, words: wordCount });
  }

  return monologues;
}

/**
 * Detect rapid-fire exchanges (short dialogue)
 */
function detectRapidFire(lengths, threshold = 10) {
  return lengths.filter(len => len < threshold).length;
}

/**
 * Normalize emotion name
 */
function normalizeEmotion(emotion) {
  if (!emotion) return 'neutral';

  const normalized = emotion.toLowerCase().trim();

  // Map common variants to base emotions
  const emotionMap = {
    happy: 'joy', happiness: 'joy', excited: 'joy', elated: 'joy',
    sad: 'sadness', unhappy: 'sadness', depressed: 'sadness', melancholy: 'sadness',
    angry: 'anger', mad: 'anger', furious: 'anger', irritated: 'anger',
    afraid: 'fear', scared: 'fear', terrified: 'fear', anxious: 'fear',
    surprised: 'surprise', shocked: 'surprise', astonished: 'surprise',
    disgusted: 'disgust', revolted: 'disgust', appalled: 'disgust',
    trusting: 'trust', confident: 'trust', secure: 'trust',
    eager: 'anticipation', hopeful: 'anticipation', expectant: 'anticipation',
    calm: 'neutral', neutral: 'neutral', peaceful: 'neutral'
  };

  return emotionMap[normalized] || normalized;
}

/**
 * Check if word is common (not a proper noun)
 */
function isCommonWord(word) {
  const commonWords = new Set([
    'The', 'A', 'An', 'This', 'That', 'These', 'Those',
    'I', 'You', 'He', 'She', 'It', 'We', 'They',
    'But', 'And', 'Or', 'So', 'Yet', 'For', 'Nor',
    'If', 'Then', 'When', 'While', 'After', 'Before',
    'Yes', 'No', 'Maybe', 'Perhaps', 'Well', 'Now',
    'What', 'Why', 'How', 'Where', 'Who', 'Which'
  ]);
  return commonWords.has(word);
}

/**
 * Split text into sections of approximately N words
 */
function splitIntoSections(text, wordsPerSection) {
  const words = text.split(/\s+/);
  const sections = [];

  for (let i = 0; i < words.length; i += wordsPerSection) {
    sections.push(words.slice(i, i + wordsPerSection).join(' '));
  }

  return sections;
}

/**
 * Count dialogue words in text
 */
function countDialogueWords(text) {
  const dialoguePattern = /"[^"]+"|"[^"]+"|'[^']+'/g;
  const matches = text.match(dialoguePattern) || [];
  return countWords(matches.join(' '));
}

// ============================================================================
// COMBINED QUALITY ANALYSIS
// ============================================================================

/**
 * Run full quality analysis on a scene/chapter
 * @param {object} options - Analysis options
 * @param {string} options.text - Scene text
 * @param {Array} options.dialogueSegments - Parsed dialogue segments (optional)
 * @param {Array} options.emotionSequence - Emotion sequence (optional)
 * @param {Array} options.characterNames - Known character names
 * @param {Array} options.locationNames - Known location names
 * @param {string} options.genre - Story genre
 * @returns {object} Combined quality analysis
 */
export function runFullQualityAnalysis(options) {
  const {
    text = '',
    dialogueSegments = [],
    emotionSequence = [],
    characterNames = [],
    locationNames = [],
    genre = 'default'
  } = options;

  const results = {
    dialogueRhythm: analyzeDialogueRhythm(dialogueSegments),
    emotionSequence: validateEmotionSequence(emotionSequence),
    properNouns: validateProperNounConsistency(text, characterNames, locationNames),
    dialogueProportion: validateDialogueProportion(text, genre)
  };

  // Calculate overall score (weighted average)
  const weights = {
    dialogueRhythm: 0.2,
    emotionSequence: 0.25,
    properNouns: 0.3,
    dialogueProportion: 0.25
  };

  let overallScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    overallScore += (results[key]?.score || 100) * weight;
  }

  // Collect all issues
  const allIssues = [
    ...results.dialogueRhythm.issues.map(i => ({ ...i, category: 'dialogueRhythm' })),
    ...results.emotionSequence.issues.map(i => ({ ...i, category: 'emotionSequence' })),
    ...results.properNouns.issues.map(i => ({ ...i, category: 'properNouns' })),
    ...results.dialogueProportion.issues.map(i => ({ ...i, category: 'dialogueProportion' }))
  ];

  logger.info(`[QualityValidation] Full analysis: score=${Math.round(overallScore)}, issues=${allIssues.length}`);

  return {
    overallScore: Math.round(overallScore),
    passesQuality: overallScore >= 70,
    results,
    allIssues,
    issueCount: {
      high: allIssues.filter(i => i.severity === 'high').length,
      medium: allIssues.filter(i => i.severity === 'medium').length,
      low: allIssues.filter(i => i.severity === 'low').length
    }
  };
}

export default {
  // Individual validators
  analyzeDialogueRhythm,
  validateEmotionSequence,
  validateProperNounConsistency,
  analyzePacing,
  validateDialogueProportion,

  // Combined analysis
  runFullQualityAnalysis,

  // Constants
  RHYTHM_PATTERNS,
  PACING_THRESHOLDS,
  DIALOGUE_PROPORTION_THRESHOLDS
};
