/**
 * Migration Runner for Storyteller
 * Applies database migrations in the correct order with tracking
 *
 * Usage:
 *   node database/run-migrations.js          # Apply all pending
 *   node database/run-migrations.js --status # Show migration status
 *   node database/run-migrations.js --force 011a # Force apply specific migration
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from parent .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Migration order (handles duplicate numbering)
const MIGRATION_ORDER = [
  { version: '001', file: '001_initial_schema.sql' },
  { version: '002', file: '002_ereader_features.sql' },
  { version: '003', file: '003_research_insights.sql' },
  { version: '004', file: '004_sound_effects.sql' },
  { version: '005', file: '005_story_recordings.sql' },
  { version: '006', file: '006_auth_subscriptions.sql' },
  { version: '007', file: '007_performance_indexes.sql' },
  { version: '008', file: '008_character_gender.sql' },
  { version: '009', file: '009_scene_word_timings.sql' },
  { version: '010', file: '010_story_bible.sql' },
  { version: '011', file: '011_story_bible_v2.sql' },
  { version: '011a', file: '011_fix_view.sql' },
  { version: '012', file: '012_deceased_characters.sql' },
  { version: '013', file: '013_story_bible_v3.sql' },
  { version: '014', file: '014_story_bible_events.sql' },
  { version: '015', file: '015_event_ordering.sql' },
  { version: '016', file: '016_story_bible_sessions.sql' },
  { version: '017', file: '017_source_chapters.sql' },
  { version: '017a', file: '017_event_timeline_fields.sql' },
  { version: '021', file: '021_picture_book_images.sql' },
  { version: '022', file: '022_additional_performance_indexes.sql' },
  // 023 uses CREATE INDEX CONCURRENTLY and must run outside a transaction
  { version: '023', file: '023_critical_performance_indexes.sql', transactional: false },
  { version: '024', file: '024_generation_state.sql' },
  { version: '025', file: '025_phonetic_mappings.sql' },
  { version: '026', file: '026_sharing_and_index_fixes.sql' },
  { version: '027', file: '027_composited_images.sql' },
  { version: '028', file: '028_narrator_archetype.sql' },
  { version: '029', file: '029_character_age.sql' },
  { version: '030', file: '030_style_score_and_voice_directions.sql' },
  // 031 uses CREATE INDEX CONCURRENTLY and must run outside a transaction
  { version: '031', file: '031_missing_indexes_and_agent_prompts.sql', transactional: false },
  // 032 uses CREATE INDEX CONCURRENTLY and must run outside a transaction
  { version: '032', file: '032_missing_query_indexes.sql', transactional: false },
];

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost/storyteller_db'
});

/**
 * Calculate MD5 checksum of file content
 */
function getChecksum(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Ensure schema_migrations table exists
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(10) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
    ON schema_migrations(version)
  `);
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
  );
  return new Map(result.rows.map(r => [r.version, r]));
}

/**
 * Apply a single migration
 */
async function applyMigration(client, migration) {
  const filePath = path.join(__dirname, 'migrations', migration.file);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️  File not found: ${migration.file}`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const checksum = getChecksum(content);
  const name = migration.file.replace('.sql', '').replace(/^\d+_/, '');
  const transactional = migration.transactional !== false;

  console.log(`  📄 Applying: ${migration.version} - ${name}`);

  try {
    if (transactional) {
      await client.query('BEGIN');
      await client.query(content);
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET checksum = $3`,
        [migration.version, name, checksum]
      );
      await client.query('COMMIT');
    } else {
      await client.query(content);
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET checksum = $3`,
        [migration.version, name, checksum]
      );
    }
    console.log(`  ✅ Applied: ${migration.version}`);
    return true;
  } catch (error) {
    if (transactional) {
      await client.query('ROLLBACK');
    }
    console.error(`  ❌ Failed: ${migration.version} - ${error.message}`);
    return false;
  }
}

/**
 * Show migration status
 */
async function showStatus() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    console.log('\n📊 Migration Status\n');
    console.log('Version | Status  | File');
    console.log('--------|---------|------------------------------');

    for (const migration of MIGRATION_ORDER) {
      const record = applied.get(migration.version);
      const status = record ? '✅ Applied' : '⏳ Pending';
      console.log(`${migration.version.padEnd(7)} | ${status} | ${migration.file}`);
    }

    console.log(`\nTotal: ${MIGRATION_ORDER.length} migrations, ${applied.size} applied\n`);
  } finally {
    client.release();
  }
}

/**
 * Apply all pending migrations
 */
async function applyPending() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const pending = MIGRATION_ORDER.filter(m => !applied.has(m.version));

    if (pending.length === 0) {
      console.log('\n✅ All migrations are up to date\n');
      return;
    }

    console.log(`\n📦 Applying ${pending.length} pending migrations...\n`);

    let success = 0;
    let failed = 0;

    for (const migration of pending) {
      const result = await applyMigration(client, migration);
      if (result) success++;
      else failed++;
    }

    console.log(`\n📊 Results: ${success} applied, ${failed} failed\n`);
  } finally {
    client.release();
  }
}

/**
 * Force apply a specific migration
 */
async function forceApply(version) {
  const migration = MIGRATION_ORDER.find(m => m.version === version);
  if (!migration) {
    console.error(`❌ Unknown migration version: ${version}`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    console.log(`\n⚠️  Force applying migration ${version}...\n`);
    await applyMigration(client, migration);
  } finally {
    client.release();
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--status')) {
      await showStatus();
    } else if (args.includes('--force') && args.length > 1) {
      const version = args[args.indexOf('--force') + 1];
      await forceApply(version);
    } else {
      await applyPending();
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
