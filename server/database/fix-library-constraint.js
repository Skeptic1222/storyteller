/**
 * Fix Library Constraint - Allow multiple libraries per user
 * Run: node server/database/fix-library-constraint.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function fixConstraint() {
  const client = await pool.connect();
  try {
    console.log('Checking for unique constraint on user_libraries...');

    // Check if the constraint exists
    const constraintCheck = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'user_libraries'
      AND indexname = 'idx_user_libraries_user'
    `);

    if (constraintCheck.rows.length > 0) {
      console.log('Found idx_user_libraries_user - dropping it...');
      await client.query('DROP INDEX IF EXISTS idx_user_libraries_user');
      console.log('Constraint dropped successfully!');
    } else {
      console.log('Constraint not found as index. Checking as table constraint...');

      // Check for unique constraint on user_id column
      const tableConstraint = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'user_libraries'::regclass
        AND contype = 'u'
      `);

      if (tableConstraint.rows.length > 0) {
        for (const row of tableConstraint.rows) {
          console.log(`Dropping constraint: ${row.conname}`);
          await client.query(`ALTER TABLE user_libraries DROP CONSTRAINT IF EXISTS ${row.conname}`);
        }
        console.log('Constraints dropped successfully!');
      } else {
        console.log('No unique constraints found on user_libraries.');
      }
    }

    // Verify current indexes
    const indexes = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'user_libraries'
    `);
    console.log('\nCurrent indexes on user_libraries:');
    if (indexes.rows.length === 0) {
      console.log('  (none)');
    } else {
      indexes.rows.forEach(row => console.log(`  ${row.indexname}: ${row.indexdef}`));
    }

    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

fixConstraint();
