/**
 * One-off script to add status column to campaign_sessions
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function addStatusColumn() {
  const client = await pool.connect();
  try {
    console.log('Adding status column to campaign_sessions...');

    // Add status column
    await client.query(`
      ALTER TABLE campaign_sessions
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'
    `);
    console.log('Added status column');

    // Add constraint separately (IF NOT EXISTS doesn't work for constraints)
    try {
      await client.query(`
        ALTER TABLE campaign_sessions
        ADD CONSTRAINT campaign_sessions_status_check
        CHECK (status IN ('pending', 'active', 'paused', 'completed', 'abandoned'))
      `);
      console.log('Added status constraint');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('Constraint already exists, skipping');
      } else {
        throw e;
      }
    }

    // Add name column if missing
    await client.query(`
      ALTER TABLE campaign_sessions
      ADD COLUMN IF NOT EXISTS name VARCHAR(200)
    `);
    console.log('Added name column');

    // Add premise column if missing
    await client.query(`
      ALTER TABLE campaign_sessions
      ADD COLUMN IF NOT EXISTS premise TEXT
    `);
    console.log('Added premise column');

    // Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_sessions_status ON campaign_sessions(status)
    `);
    console.log('Created status index');

    console.log('Migration complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

addStatusColumn().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
