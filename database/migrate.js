/**
 * Database Migration Script
 * Runs the schema.sql file to set up the storyteller database
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.log('Make sure you have a .env file with DATABASE_URL set');
    process.exit(1);
  }

  // First, try to create the database if it doesn't exist
  const urlParts = new URL(databaseUrl);
  const dbName = urlParts.pathname.slice(1); // Remove leading /
  const baseUrl = `${urlParts.protocol}//${urlParts.username}:${urlParts.password}@${urlParts.host}/postgres`;

  console.log(`Checking if database '${dbName}' exists...`);

  const adminPool = new Pool({ connectionString: baseUrl });

  try {
    const result = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (result.rows.length === 0) {
      console.log(`Creating database '${dbName}'...`);
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log('Database created successfully!');
    } else {
      console.log('Database already exists.');
    }
  } catch (error) {
    console.error('Error checking/creating database:', error.message);
  } finally {
    await adminPool.end();
  }

  // Now run the schema
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('Running schema migration...');

    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');

    await pool.query(schema);

    console.log('Schema migration completed successfully!');

    // Verify tables were created
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('\nCreated tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    // Check agent prompts
    const promptsResult = await pool.query('SELECT agent_name FROM agent_prompts');
    console.log(`\nAgent prompts loaded: ${promptsResult.rows.length}`);

  } catch (error) {
    console.error('Migration failed:', error.message);
    if (error.position) {
      console.error('Error at position:', error.position);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
