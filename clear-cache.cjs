const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgres://postgres:olivebranch2025@localhost:5432/storyteller_db'
});

async function clearCache() {
  try {
    // Clear database cache
    const result = await pool.query('DELETE FROM audio_cache RETURNING *');
    console.log(`Deleted ${result.rowCount} cached audio entries from database`);
    
    // Clear filesystem cache
    const cacheDir = path.join(__dirname, 'public', 'audio');
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      let deleted = 0;
      for (const file of files) {
        if (file.endsWith('.mp3')) {
          fs.unlinkSync(path.join(cacheDir, file));
          deleted++;
        }
      }
      console.log(`Deleted ${deleted} cached audio files from filesystem`);
    }
    
    console.log('Cache cleared!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

clearCache();
