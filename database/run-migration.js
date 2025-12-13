/**
 * Run database migration script
 * Usage: node run-migration.js
 */

import { pool } from '../server/database/pool.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const migrationFile = join(__dirname, 'migrations', '002_ereader_features.sql');

  console.log('Reading migration file:', migrationFile);
  const sql = readFileSync(migrationFile, 'utf8');

  console.log('Running migration...');

  try {
    await pool.query(sql);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    // Try running statements individually
    const statements = sql.split(';').filter(s => s.trim());
    let succeeded = 0;
    let failed = 0;

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await pool.query(statement);
          succeeded++;
        } catch (e) {
          if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
            console.error('Statement failed:', e.message);
            failed++;
          } else {
            succeeded++;
          }
        }
      }
    }
    console.log(`Completed: ${succeeded} succeeded, ${failed} failed`);
  }

  await pool.end();
  process.exit(0);
}

runMigration().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
