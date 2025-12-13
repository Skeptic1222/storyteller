/**
 * Database Seed Script
 * Seeds initial data for the storyteller application
 */

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

// Sample ElevenLabs voices (these should be synced from API in production)
const sampleVoices = [
  {
    voice_id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    category: 'premade',
    description: 'Calm, warm female voice perfect for storytelling',
    gender: 'female',
    age_group: 'adult',
    style: 'warm'
  },
  {
    voice_id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi',
    category: 'premade',
    description: 'Strong, confident female voice',
    gender: 'female',
    age_group: 'young_adult',
    style: 'confident'
  },
  {
    voice_id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    category: 'premade',
    description: 'Soft, gentle female voice ideal for bedtime stories',
    gender: 'female',
    age_group: 'adult',
    style: 'gentle'
  },
  {
    voice_id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    category: 'premade',
    description: 'Warm, friendly male voice like a kind grandfather',
    gender: 'male',
    age_group: 'elderly',
    style: 'warm'
  },
  {
    voice_id: 'MF3mGyEYCl7XYWbV9V6O',
    name: 'Elli',
    category: 'premade',
    description: 'Young, energetic female voice',
    gender: 'female',
    age_group: 'young_adult',
    style: 'energetic'
  },
  {
    voice_id: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh',
    category: 'premade',
    description: 'Deep, soothing male voice',
    gender: 'male',
    age_group: 'adult',
    style: 'soothing'
  },
  {
    voice_id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold',
    category: 'premade',
    description: 'Authoritative male voice for epic tales',
    gender: 'male',
    age_group: 'adult',
    style: 'authoritative'
  },
  {
    voice_id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    category: 'premade',
    description: 'Deep, resonant male voice',
    gender: 'male',
    age_group: 'adult',
    style: 'deep'
  },
  {
    voice_id: 'yoZ06aMxZJJ28mfd3POQ',
    name: 'Sam',
    category: 'premade',
    description: 'Neutral, clear voice for any story type',
    gender: 'neutral',
    age_group: 'adult',
    style: 'clear'
  }
];

// Sample story templates
const storyTemplates = [
  {
    title: 'The Enchanted Forest',
    themes: ['magic', 'friendship', 'courage'],
    setting: 'A mystical forest where animals can talk and trees whisper secrets',
    suggested_characters: ['brave child', 'wise owl', 'mischievous fox']
  },
  {
    title: 'Journey to the Stars',
    themes: ['adventure', 'discovery', 'wonder'],
    setting: 'A cozy spaceship traveling through a galaxy of friendly planets',
    suggested_characters: ['curious astronaut', 'helpful robot', 'alien friend']
  },
  {
    title: 'The Sleepy Kingdom',
    themes: ['dreams', 'peace', 'bedtime'],
    setting: 'A magical kingdom where everyone prepares for the best sleep ever',
    suggested_characters: ['young prince/princess', 'dream weaver', 'moon guardian']
  }
];

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Seeding database...');

    // Seed ElevenLabs voices
    console.log('Seeding voice data...');
    for (const voice of sampleVoices) {
      await pool.query(`
        INSERT INTO elevenlabs_voices (voice_id, name, category, description, gender, age_group, style)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (voice_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          gender = EXCLUDED.gender,
          age_group = EXCLUDED.age_group,
          style = EXCLUDED.style,
          last_synced_at = NOW()
      `, [voice.voice_id, voice.name, voice.category, voice.description, voice.gender, voice.age_group, voice.style]);
    }
    console.log(`  Seeded ${sampleVoices.length} voices`);

    // Create default voice preferences for guest user
    console.log('Creating default voice preferences...');
    await pool.query(`
      INSERT INTO voice_preferences (user_id, preference_label, elevenlabs_voice_id, voice_name, is_default)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'Gentle Storyteller', 'EXAVITQu4vr4xnSDxMaL', 'Bella', true),
        ('00000000-0000-0000-0000-000000000001', 'Wise Grandfather', 'ErXwobaYiN019PkySvjV', 'Antoni', false),
        ('00000000-0000-0000-0000-000000000001', 'Warm Narrator', '21m00Tcm4TlvDq8ikWAM', 'Rachel', false)
      ON CONFLICT DO NOTHING
    `);

    console.log('Database seeding completed successfully!');

    // Show summary
    const voiceCount = await pool.query('SELECT COUNT(*) FROM elevenlabs_voices');
    const promptCount = await pool.query('SELECT COUNT(*) FROM agent_prompts');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');

    console.log('\nDatabase summary:');
    console.log(`  Voices: ${voiceCount.rows[0].count}`);
    console.log(`  Agent prompts: ${promptCount.rows[0].count}`);
    console.log(`  Users: ${userCount.rows[0].count}`);

  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
