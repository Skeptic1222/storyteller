/**
 * One-time cleanup script to strip [CHAR] tags from existing polished_text in database
 * Run with: node server/scripts/cleanupTags.js
 */

import { pool } from '../database/pool.js';

async function cleanupTags() {
  console.log('Starting tag cleanup...');

  try {
    // First, count affected rows
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM story_scenes
      WHERE polished_text LIKE '%[CHAR:%' OR polished_text LIKE '%[/CHAR]%'
    `);

    const affectedCount = parseInt(countResult.rows[0].count, 10);
    console.log(`Found ${affectedCount} scenes with [CHAR] tags`);

    if (affectedCount === 0) {
      console.log('No cleanup needed.');
      await pool.end();
      return;
    }

    // Update all affected rows - strip [CHAR:Name] and [/CHAR] tags
    const updateResult = await pool.query(`
      UPDATE story_scenes
      SET polished_text = TRIM(
        REGEXP_REPLACE(
          REGEXP_REPLACE(polished_text, '\\[CHAR:[^\\]]+\\]', '', 'g'),
          '\\[/CHAR\\]', '', 'g'
        )
      )
      WHERE polished_text LIKE '%[CHAR:%' OR polished_text LIKE '%[/CHAR]%'
    `);

    console.log(`Updated ${updateResult.rowCount} rows`);

    // Verify cleanup
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as count FROM story_scenes
      WHERE polished_text LIKE '%[CHAR:%' OR polished_text LIKE '%[/CHAR]%'
    `);

    const remaining = parseInt(verifyResult.rows[0].count, 10);
    if (remaining === 0) {
      console.log('Cleanup complete! All [CHAR] tags removed from polished_text.');
    } else {
      console.log(`Warning: ${remaining} scenes still have tags (check complex patterns)`);
    }

  } catch (error) {
    console.error('Cleanup error:', error);
  } finally {
    await pool.end();
  }
}

cleanupTags();
