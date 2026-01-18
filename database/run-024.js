/**
 * Run migration 024 for Quest Tracking System
 */

import { pool } from '../server/database/pool.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const migrationFile = join(__dirname, 'migrations', '024_quest_tracking_system.sql');

  console.log('Reading migration file:', migrationFile);
  const sql = readFileSync(migrationFile, 'utf8');

  console.log('Running migration 024 (Quest Tracking System)...');

  try {
    await pool.query(sql);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    if (error.position) {
      console.error('Error at position:', error.position);
    }
    process.exit(1);
  }

  // Verify tables
  const result = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name LIKE 'campaign_quest%'
    ORDER BY table_name
  `);

  console.log('\nCreated tables:');
  result.rows.forEach(row => console.log(`  - ${row.table_name}`));

  await pool.end();
  process.exit(0);
}

runMigration().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
