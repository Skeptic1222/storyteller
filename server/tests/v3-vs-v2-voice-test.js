/**
 * ElevenLabs v3 vs v2 Voice Comparison Test
 *
 * This script generates side-by-side audio samples using:
 * - eleven_multilingual_v2 (current production model) with VOICE_PRESETS
 * - eleven_v3 (new model with Audio Tags)
 *
 * Output: Audio files in public/audio/v3-test/ for manual comparison
 *
 * Usage: node server/tests/v3-vs-v2-voice-test.js
 *
 * @created 2025-12-09
 */

import axios from 'axios';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const API_KEY = process.env.ELEVENLABS_API_KEY;

// Output directory for test files
const OUTPUT_DIR = join(__dirname, '..', '..', 'public', 'audio', 'v3-test');

// Test voices - using a mix of male/female narrator and character voices
const TEST_VOICES = {
  george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', style: 'warm British narrator' },
  charlotte: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', style: 'Swedish seductive' },
  callum: { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', style: 'gravelly Transatlantic' }
};

// VOICE_PRESETS from elevenlabs.js (subset for testing)
const VOICE_PRESETS = {
  whispered: { stability: 0.8, similarity_boost: 0.85, style: 0.15, speed: 0.85 },
  shouted: { stability: 0.25, similarity_boost: 0.9, style: 0.95, speed: 1.15 },
  fearful: { stability: 0.55, similarity_boost: 0.85, style: 0.5, speed: 1.1 },
  angry: { stability: 0.3, similarity_boost: 0.9, style: 0.9, speed: 1.15 },
  sad: { stability: 0.7, similarity_boost: 0.8, style: 0.4, speed: 0.8 },
  excited: { stability: 0.35, similarity_boost: 0.8, style: 0.75, speed: 1.2 },
  tender: { stability: 0.75, similarity_boost: 0.85, style: 0.25, speed: 0.85 },
  sarcastic: { stability: 0.55, similarity_boost: 0.75, style: 0.6, speed: 1.0 },
  commanding: { stability: 0.5, similarity_boost: 0.9, style: 0.8, speed: 0.95 },
  desperate: { stability: 0.3, similarity_boost: 0.85, style: 0.8, speed: 1.2 },
  neutral: { stability: 0.6, similarity_boost: 0.75, style: 0.4, speed: 1.0 }
};

// Test sentences with emotions and their v3 Audio Tag equivalents
const TEST_CASES = [
  // Volume variations
  {
    id: '01_whispered',
    text: "I think someone is watching us.",
    emotion: 'whispered',
    v3_tags: '[whispers][nervously]',
    category: 'volume'
  },
  {
    id: '02_shouted',
    text: "Get out of my house right now!",
    emotion: 'shouted',
    v3_tags: '[shouts][angrily]',
    category: 'volume'
  },

  // Fear and tension
  {
    id: '03_fearful',
    text: "Did you hear that? There's something in the basement.",
    emotion: 'fearful',
    v3_tags: '[fearfully][with trembling voice]',
    category: 'fear'
  },
  {
    id: '04_terrified',
    text: "Oh god, it's coming this way. We have to run!",
    emotion: 'fearful',
    v3_tags: '[terrified][panicking]',
    category: 'fear'
  },

  // Anger spectrum
  {
    id: '05_angry',
    text: "How could you betray me after everything I've done for you?",
    emotion: 'angry',
    v3_tags: '[angrily][with barely contained rage]',
    category: 'anger'
  },
  {
    id: '06_cold_fury',
    text: "You will regret this. I promise you that.",
    emotion: 'angry',
    v3_tags: '[coldly][with quiet menace]',
    category: 'anger'
  },

  // Sadness
  {
    id: '07_sad',
    text: "She's gone. After all these years, she's really gone.",
    emotion: 'sad',
    v3_tags: '[sadly][voice breaking]',
    category: 'sadness'
  },
  {
    id: '08_grieving',
    text: "I never got to say goodbye.",
    emotion: 'sad',
    v3_tags: '[grief-stricken][barely able to speak]',
    category: 'sadness'
  },

  // Joy and excitement
  {
    id: '09_excited',
    text: "We did it! We actually did it! I can't believe it worked!",
    emotion: 'excited',
    v3_tags: '[excitedly][laughing with joy]',
    category: 'joy'
  },
  {
    id: '10_tender',
    text: "I've loved you since the moment I first saw you.",
    emotion: 'tender',
    v3_tags: '[tenderly][with deep affection]',
    category: 'love'
  },

  // Complex emotions
  {
    id: '11_sarcastic',
    text: "Oh wonderful. Another brilliant plan from our fearless leader.",
    emotion: 'sarcastic',
    v3_tags: '[sarcastically][rolling eyes]',
    category: 'complex'
  },
  {
    id: '12_commanding',
    text: "Listen to me carefully. Your life depends on following these instructions exactly.",
    emotion: 'commanding',
    v3_tags: '[authoritatively][with grave seriousness]',
    category: 'complex'
  },
  {
    id: '13_desperate',
    text: "Please, I'm begging you. There has to be another way!",
    emotion: 'desperate',
    v3_tags: '[desperately][pleading]',
    category: 'complex'
  },

  // Reactions (v3 special capability)
  {
    id: '14_laugh_reaction',
    text: "You actually thought that would work?",
    emotion: 'sarcastic',
    v3_tags: '[laughs][mockingly]',
    category: 'reactions'
  },
  {
    id: '15_sigh_reaction',
    text: "I suppose we have no choice then.",
    emotion: 'neutral',
    v3_tags: '[sighs][resignedly]',
    category: 'reactions'
  }
];

// Results storage
const results = {
  timestamp: new Date().toISOString(),
  api_key_present: !!API_KEY,
  voices_tested: [],
  test_cases: [],
  summary: {
    v2_successes: 0,
    v2_failures: 0,
    v3_successes: 0,
    v3_failures: 0,
    avg_v2_latency_ms: 0,
    avg_v3_latency_ms: 0
  }
};

/**
 * Generate audio using v2 model with VOICE_PRESETS
 */
async function generateV2Audio(voiceId, text, preset) {
  const settings = VOICE_PRESETS[preset] || VOICE_PRESETS.neutral;

  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarity_boost,
          style: settings.style,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );

    const latency = Date.now() - startTime;
    return {
      success: true,
      audio: Buffer.from(response.data),
      latency_ms: latency,
      model: 'eleven_multilingual_v2',
      settings_used: settings
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      error: error.response?.data?.detail?.message || error.message,
      latency_ms: latency,
      model: 'eleven_multilingual_v2'
    };
  }
}

/**
 * Generate audio using v3 model with Audio Tags
 */
async function generateV3Audio(voiceId, text, audioTags) {
  // v3 uses audio tags inline in the text
  const taggedText = `${audioTags}${text}`;

  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        text: taggedText,
        model_id: 'eleven_v3',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );

    const latency = Date.now() - startTime;
    return {
      success: true,
      audio: Buffer.from(response.data),
      latency_ms: latency,
      model: 'eleven_v3',
      tagged_text: taggedText
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      error: error.response?.data?.detail?.message || error.message,
      status: error.response?.status,
      latency_ms: latency,
      model: 'eleven_v3',
      tagged_text: taggedText
    };
  }
}

/**
 * Run a single test case for a specific voice
 */
async function runTestCase(testCase, voice) {
  console.log(`\n  Testing: ${testCase.id} with ${voice.name}...`);

  const caseResult = {
    test_id: testCase.id,
    voice: voice.name,
    voice_id: voice.id,
    text: testCase.text,
    emotion: testCase.emotion,
    v3_tags: testCase.v3_tags,
    category: testCase.category,
    v2_result: null,
    v3_result: null
  };

  // Generate v2 audio
  console.log(`    → v2 (${testCase.emotion} preset)...`);
  const v2Result = await generateV2Audio(voice.id, testCase.text, testCase.emotion);
  caseResult.v2_result = {
    success: v2Result.success,
    latency_ms: v2Result.latency_ms,
    file_size: v2Result.audio?.length || 0,
    error: v2Result.error
  };

  if (v2Result.success) {
    const v2Filename = `${testCase.id}_${voice.name.toLowerCase()}_v2.mp3`;
    const v2Path = join(OUTPUT_DIR, v2Filename);
    writeFileSync(v2Path, v2Result.audio);
    caseResult.v2_result.filename = v2Filename;
    console.log(`    ✓ v2: ${v2Result.latency_ms}ms, ${v2Result.audio.length} bytes`);
    results.summary.v2_successes++;
  } else {
    console.log(`    ✗ v2 FAILED: ${v2Result.error}`);
    results.summary.v2_failures++;
  }

  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 500));

  // Generate v3 audio
  console.log(`    → v3 (${testCase.v3_tags})...`);
  const v3Result = await generateV3Audio(voice.id, testCase.text, testCase.v3_tags);
  caseResult.v3_result = {
    success: v3Result.success,
    latency_ms: v3Result.latency_ms,
    file_size: v3Result.audio?.length || 0,
    error: v3Result.error,
    tagged_text: v3Result.tagged_text
  };

  if (v3Result.success) {
    const v3Filename = `${testCase.id}_${voice.name.toLowerCase()}_v3.mp3`;
    const v3Path = join(OUTPUT_DIR, v3Filename);
    writeFileSync(v3Path, v3Result.audio);
    caseResult.v3_result.filename = v3Filename;
    console.log(`    ✓ v3: ${v3Result.latency_ms}ms, ${v3Result.audio.length} bytes`);
    results.summary.v3_successes++;
  } else {
    console.log(`    ✗ v3 FAILED: ${v3Result.error} (status: ${v3Result.status})`);
    results.summary.v3_failures++;
  }

  return caseResult;
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       ElevenLabs v3 vs v2 Voice Comparison Test                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\nTimestamp: ${results.timestamp}`);

  // Check API key
  if (!API_KEY) {
    console.error('\n❌ ERROR: ELEVENLABS_API_KEY not found in environment');
    console.error('Please set ELEVENLABS_API_KEY in your .env file');
    process.exit(1);
  }
  console.log('✓ API Key found');

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`✓ Created output directory: ${OUTPUT_DIR}`);
  } else {
    console.log(`✓ Output directory exists: ${OUTPUT_DIR}`);
  }

  // Test with selected voice (George - warm British narrator)
  // Using just one voice to minimize API costs for initial test
  const testVoice = TEST_VOICES.george;
  results.voices_tested.push(testVoice.name);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Testing with: ${testVoice.name} (${testVoice.style})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let v2Latencies = [];
  let v3Latencies = [];

  for (const testCase of TEST_CASES) {
    try {
      const result = await runTestCase(testCase, testVoice);
      results.test_cases.push(result);

      if (result.v2_result?.latency_ms) v2Latencies.push(result.v2_result.latency_ms);
      if (result.v3_result?.latency_ms) v3Latencies.push(result.v3_result.latency_ms);

      // Delay between test cases
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error(`\n❌ Error in test case ${testCase.id}:`, error.message);
    }
  }

  // Calculate averages
  if (v2Latencies.length > 0) {
    results.summary.avg_v2_latency_ms = Math.round(v2Latencies.reduce((a, b) => a + b, 0) / v2Latencies.length);
  }
  if (v3Latencies.length > 0) {
    results.summary.avg_v3_latency_ms = Math.round(v3Latencies.reduce((a, b) => a + b, 0) / v3Latencies.length);
  }

  // Save results JSON
  const resultsPath = join(OUTPUT_DIR, 'test_results.json');
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\nv2 (eleven_multilingual_v2):`);
  console.log(`  ✓ Successes: ${results.summary.v2_successes}`);
  console.log(`  ✗ Failures:  ${results.summary.v2_failures}`);
  console.log(`  ⏱ Avg Latency: ${results.summary.avg_v2_latency_ms}ms`);

  console.log(`\nv3 (eleven_v3 with Audio Tags):`);
  console.log(`  ✓ Successes: ${results.summary.v3_successes}`);
  console.log(`  ✗ Failures:  ${results.summary.v3_failures}`);
  console.log(`  ⏱ Avg Latency: ${results.summary.avg_v3_latency_ms}ms`);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Output files saved to: ${OUTPUT_DIR}`);
  console.log(`Results JSON: ${resultsPath}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Generate evaluation guide
  generateEvaluationGuide();
}

/**
 * Generate a markdown evaluation guide
 */
function generateEvaluationGuide() {
  const guide = `# v3 vs v2 Audio Evaluation Guide

## How to Listen

Audio files are located in: \`public/audio/v3-test/\`

Each test case has two files:
- \`{test_id}_{voice}_v2.mp3\` - Generated with v2 + VOICE_PRESETS
- \`{test_id}_{voice}_v3.mp3\` - Generated with v3 + Audio Tags

## What to Evaluate

For each pair of audio files, consider:

### 1. Emotion Accuracy (1-5)
Does the voice actually sound like the intended emotion?
- 1 = Wrong emotion entirely
- 3 = Vaguely correct but flat
- 5 = Perfect emotional delivery

### 2. Naturalness (1-5)
Does it sound like a human speaking naturally?
- 1 = Robotic/artificial
- 3 = Acceptable TTS
- 5 = Indistinguishable from human

### 3. Clarity (1-5)
Is every word clear and understandable?
- 1 = Garbled/unintelligible
- 3 = Some words unclear
- 5 = Crystal clear

### 4. Expressiveness (1-5)
Does the delivery have appropriate variation and dynamics?
- 1 = Monotone
- 3 = Some variation
- 5 = Rich, dynamic delivery

### 5. Artifacts (Yes/No)
Any clicks, pops, glitches, or unnatural sounds?

## Test Cases by Category

### Volume (Whispered/Shouted)
- 01_whispered: "I think someone is watching us."
- 02_shouted: "Get out of my house right now!"

### Fear/Tension
- 03_fearful: "Did you hear that?"
- 04_terrified: "Oh god, it's coming this way."

### Anger
- 05_angry: "How could you betray me?"
- 06_cold_fury: "You will regret this."

### Sadness
- 07_sad: "She's gone."
- 08_grieving: "I never got to say goodbye."

### Joy/Love
- 09_excited: "We did it!"
- 10_tender: "I've loved you..."

### Complex Emotions
- 11_sarcastic: "Oh wonderful."
- 12_commanding: "Listen to me carefully."
- 13_desperate: "Please, I'm begging you."

### Reactions (v3 Special Feature)
- 14_laugh_reaction: Can v3 actually laugh?
- 15_sigh_reaction: Can v3 actually sigh?

## Scoring Sheet

| Test | v2 Emotion | v2 Natural | v3 Emotion | v3 Natural | Winner |
|------|------------|------------|------------|------------|--------|
| 01   |            |            |            |            |        |
| 02   |            |            |            |            |        |
| 03   |            |            |            |            |        |
| 04   |            |            |            |            |        |
| 05   |            |            |            |            |        |
| 06   |            |            |            |            |        |
| 07   |            |            |            |            |        |
| 08   |            |            |            |            |        |
| 09   |            |            |            |            |        |
| 10   |            |            |            |            |        |
| 11   |            |            |            |            |        |
| 12   |            |            |            |            |        |
| 13   |            |            |            |            |        |
| 14   |            |            |            |            |        |
| 15   |            |            |            |            |        |

## Key Questions to Answer

1. **Is v3 production-ready?** Can we use it reliably?
2. **Which emotions benefit most from Audio Tags?**
3. **Are reactions ([laughs], [sighs]) actually generated?**
4. **Is the quality improvement worth switching?**
5. **Any concerning latency differences?**

## Technical Notes

- v2 uses \`eleven_multilingual_v2\` with stability/similarity/style parameters
- v3 uses \`eleven_v3\` with inline Audio Tags like \`[whispers][nervously]\`
- v3 is currently in "alpha" status at ElevenLabs

Check \`test_results.json\` for latency data and any error messages.
`;

  const guidePath = join(OUTPUT_DIR, 'EVALUATION_GUIDE.md');
  writeFileSync(guidePath, guide);
  console.log(`\n📋 Evaluation guide saved to: ${guidePath}`);
}

// Run the tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
