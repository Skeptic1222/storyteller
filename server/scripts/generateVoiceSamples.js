/**
 * Generate Voice Samples Script
 * Creates audio samples for each narrator voice with different styles
 *
 * Run: node server/scripts/generateVoiceSamples.js
 */

import { ElevenLabsService } from '../services/elevenlabs.js';
import { VOICE_PREVIEWS, NARRATOR_STYLES } from '../services/conversationEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const elevenlabs = new ElevenLabsService();

// Sample texts for each mood
const SAMPLE_TEXTS = {
  warm: "Once upon a time, in a land filled with wonder and magic, there lived a brave young adventurer who dreamed of exploring the world beyond the mountains.",
  dramatic: "The storm raged above the castle as thunder shook its ancient walls. Inside, the hero drew their sword, knowing that destiny had finally arrived.",
  playful: "Oh my goodness, you will never guess what happened next! The little dragon sneezed and accidentally set the birthday cake on fire!",
  mysterious: "In the shadows of the forgotten library, whispers echoed from centuries past. Some secrets were never meant to be discovered.",
  horror: "The door creaked open on its own. From the darkness came a sound... breathing... slow and deliberate... something was watching.",
  epic: "Across the burning plains they marched, ten thousand strong, their banners catching the crimson light of sunset. The final battle was at hand.",
  whimsical: "The teapot began to dance across the table, joined by a giggling spoon and a rather pompous sugar bowl named Reginald.",
  noir: "She walked into my office like trouble wearing heels. I knew then that this case would be the death of me. But what's life without a little risk?"
};

// Map narrator styles to sample types
const STYLE_MAPPING = {
  warm: 'warm',
  dramatic: 'dramatic',
  playful: 'playful',
  mysterious: 'mysterious',
  horror: 'horror',
  epic: 'epic',
  whimsical: 'whimsical',
  noir: 'noir'
};

async function generateSamples() {
  const outputDir = path.resolve(__dirname, '../../public/audio/samples');

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Starting voice sample generation...');
  console.log(`Output directory: ${outputDir}`);

  const voices = Object.entries(VOICE_PREVIEWS);
  const styles = Object.keys(NARRATOR_STYLES);

  let generated = 0;
  let failed = 0;

  for (const [voiceKey, voice] of voices) {
    console.log(`\nGenerating samples for ${voice.name}...`);

    for (const style of styles) {
      const sampleText = SAMPLE_TEXTS[style] || SAMPLE_TEXTS.warm;
      const styleSettings = NARRATOR_STYLES[style] || {};

      const filename = `${voiceKey}_${style}.mp3`;
      const filepath = path.join(outputDir, filename);

      // Skip if file already exists
      if (fs.existsSync(filepath)) {
        console.log(`  - ${style}: already exists, skipping`);
        continue;
      }

      try {
        console.log(`  - ${style}: generating...`);

        // Normalize style value from 0-100 to 0.0-1.0 if needed
        const styleValue = styleSettings.style !== undefined
          ? (styleSettings.style > 1 ? styleSettings.style / 100 : styleSettings.style)
          : 0;

        const audioBuffer = await elevenlabs.textToSpeech(
          sampleText,
          voice.id,
          {
            stability: styleSettings.stability || 0.5,
            similarity_boost: styleSettings.similarity_boost || 0.75,
            style: styleValue,
            model_id: 'eleven_multilingual_v2'
          }
        );

        fs.writeFileSync(filepath, audioBuffer);
        console.log(`  - ${style}: saved (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
        generated++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`  - ${style}: FAILED - ${error.message}`);
        failed++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Voice sample generation complete!`);
  console.log(`Generated: ${generated} samples`);
  console.log(`Failed: ${failed}`);
  console.log(`Output: ${outputDir}`);
}

// Run the generator
generateSamples().catch(console.error);
