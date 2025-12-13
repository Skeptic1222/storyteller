/**
 * Run SFX migration
 */

import { pool } from '../server/database/pool.js';

async function runMigration() {
  console.log('Running SFX migration...');

  try {
    // Create sfx_cache table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sfx_cache (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        prompt_hash VARCHAR(64) NOT NULL UNIQUE,
        prompt_preview VARCHAR(200),
        file_path VARCHAR(500) NOT NULL,
        file_size_bytes INTEGER,
        duration_seconds FLOAT,
        is_looping BOOLEAN DEFAULT FALSE,
        access_count INTEGER DEFAULT 1,
        last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('Created sfx_cache table');

    // Create indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sfx_cache_hash ON sfx_cache(prompt_hash)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sfx_cache_accessed ON sfx_cache(last_accessed_at)');
    console.log('Created indexes');

    // Create scene_sfx table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scene_sfx (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        scene_id UUID REFERENCES story_scenes(id) ON DELETE CASCADE,
        sfx_key VARCHAR(100) NOT NULL,
        sfx_cache_id UUID REFERENCES sfx_cache(id) ON DELETE SET NULL,
        volume FLOAT DEFAULT 0.3,
        start_offset_seconds FLOAT DEFAULT 0,
        fade_in_seconds FLOAT DEFAULT 2,
        fade_out_seconds FLOAT DEFAULT 2,
        detected_keyword VARCHAR(100),
        detection_reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('Created scene_sfx table');

    await pool.query('CREATE INDEX IF NOT EXISTS idx_scene_sfx_scene ON scene_sfx(scene_id)');
    console.log('Created scene_sfx index');

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
  }

  await pool.end();
  process.exit(0);
}

runMigration();
