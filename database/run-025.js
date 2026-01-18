/**
 * Run migration 025 for DM Map Grid System
 */

import { pool } from '../server/database/pool.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const migrationFile = join(__dirname, 'migrations', '025_dm_map_grid_system.sql');

  console.log('Reading migration file:', migrationFile);
  const sql = readFileSync(migrationFile, 'utf8');

  console.log('Running migration 025 as single transaction...');

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
    AND table_name IN ('campaign_maps', 'map_rooms', 'map_entities', 'entity_library', 'map_templates')
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
