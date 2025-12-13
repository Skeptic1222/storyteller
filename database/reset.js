/**
 * Database Reset Script
 * WARNING: This will delete all data!
 */

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

async function confirmReset() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('WARNING: This will delete ALL data. Type "RESET" to confirm: ', (answer) => {
      rl.close();
      resolve(answer === 'RESET');
    });
  });
}

async function reset() {
  // Skip confirmation in CI/test environments
  if (process.env.NODE_ENV !== 'test' && process.env.FORCE_RESET !== 'true') {
    const confirmed = await confirmReset();
    if (!confirmed) {
      console.log('Reset cancelled.');
      process.exit(0);
    }
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Resetting database...');

    // Drop all tables in reverse dependency order
    await pool.query(`
      DROP TABLE IF EXISTS audio_cache CASCADE;
      DROP TABLE IF EXISTS conversation_turns CASCADE;
      DROP TABLE IF EXISTS story_choices CASCADE;
      DROP TABLE IF EXISTS story_scenes CASCADE;
      DROP TABLE IF EXISTS story_outlines CASCADE;
      DROP TABLE IF EXISTS lore_entries CASCADE;
      DROP TABLE IF EXISTS characters CASCADE;
      DROP TABLE IF EXISTS story_sessions CASCADE;
      DROP TABLE IF EXISTS voice_preferences CASCADE;
      DROP TABLE IF EXISTS elevenlabs_voices CASCADE;
      DROP TABLE IF EXISTS agent_prompts CASCADE;
      DROP TABLE IF EXISTS users CASCADE;

      DROP TYPE IF EXISTS story_mode CASCADE;
      DROP TYPE IF EXISTS session_status CASCADE;
      DROP TYPE IF EXISTS turn_role CASCADE;
      DROP TYPE IF EXISTS turn_modality CASCADE;
    `);

    console.log('All tables dropped.');
    console.log('Run "npm run db:migrate" to recreate tables.');
    console.log('Run "npm run db:seed" to seed initial data.');

  } catch (error) {
    console.error('Reset failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
