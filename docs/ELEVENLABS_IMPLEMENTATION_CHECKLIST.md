# ElevenLabs V3 Implementation Checklist for Storyteller

**Priority Tasks Based on Best Practices Research**

---

## 🔴 High Priority (Immediate Action)

### 1. Fix Speaker Boost for V3 Model
**Issue:** Speaker boost parameter is not available on eleven_v3 but your code still tries to use it.

**File:** `C:\inetpub\wwwroot\storyteller\server\services\elevenlabs.js`

**Line:** ~936

**Current Code:**
```javascript
const useSpeakerBoost = options.use_speaker_boost ?? tierDefaults.use_speaker_boost;
```

**Fixed Code:**
```javascript
// Speaker boost not available on V3
const useSpeakerBoost = modelId === 'eleven_v3'
  ? false
  : (options.use_speaker_boost ?? tierDefaults.use_speaker_boost);

// Only add to voice settings if model supports it
const voiceSettings = {
  stability,
  similarity_boost: similarityBoost
};

if (modelId !== 'eleven_v3') {
  voiceSettings.use_speaker_boost = useSpeakerBoost;
}
```

**Impact:** Prevents API warnings/errors, ensures proper V3 compatibility.

---

### 2. Add Seed Parameter for Voice Consistency
**Benefit:** Improves character voice consistency across sessions (soft anchor).

**File:** `C:\inetpub\wwwroot\storyteller\server\services\elevenlabs.js`

**Add Helper Method:**
```javascript
/**
 * Generate deterministic seed from session/character info
 * Provides soft consistency anchor (not guaranteed identical)
 */
generateDeterministicSeed(sessionId, speaker, segmentIndex = 0) {
  const combined = `${sessionId}-${speaker}-${segmentIndex}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return parseInt(hash.slice(0, 8), 16); // 0 to 4,294,967,295
}
```

**Update textToSpeech Method:**
```javascript
async textToSpeech(text, voiceId, options = {}) {
  // ... existing code ...

  // Auto-generate seed if session info available
  const seed = options.seed || (options.sessionId && options.speaker
    ? this.generateDeterministicSeed(options.sessionId, options.speaker, options.segmentIndex || 0)
    : undefined);

  const requestBody = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings
  };

  // Add seed if available (improves consistency)
  if (seed !== undefined) {
    requestBody.seed = seed;
  }

  // ... rest of method
}
```

**Impact:** Better character voice consistency, especially in multi-chapter stories.

---

### 3. Add TTS Caching System
**Benefit:** Perfect consistency + cost savings + performance improvement.

**Database Migration:**
```sql
-- C:\inetpub\wwwroot\storyteller\database\migrations\024_tts_cache.sql

CREATE TABLE IF NOT EXISTS tts_cache (
  id SERIAL PRIMARY KEY,
  cache_key VARCHAR(64) UNIQUE NOT NULL,
  audio_url VARCHAR(500) NOT NULL,
  text_preview VARCHAR(200),
  model_id VARCHAR(50),
  voice_id VARCHAR(50),
  character_count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1
);

CREATE INDEX idx_tts_cache_key ON tts_cache(cache_key);
CREATE INDEX idx_tts_cache_created ON tts_cache(created_at);
```

**Implementation:**
```javascript
// In server/services/elevenlabs.js

getCacheKey(text, voiceConfig) {
  const normalized = text.trim().toLowerCase();
  const configStr = JSON.stringify({
    voice_id: voiceConfig.voice_id,
    model_id: voiceConfig.model_id,
    stability: voiceConfig.stability?.toFixed(2),
    similarity_boost: voiceConfig.similarity_boost?.toFixed(2)
  });

  return crypto.createHash('sha256')
    .update(normalized + configStr)
    .digest('hex');
}

async getOrGenerateCached(text, voiceId, options = {}) {
  const voiceConfig = {
    voice_id: voiceId,
    model_id: options.model_id || 'eleven_v3',
    stability: options.stability || 0.5,
    similarity_boost: options.similarity_boost || 0.75
  };

  const cacheKey = this.getCacheKey(text, voiceConfig);

  // Check cache
  const cached = await db.query(
    'SELECT audio_url, created_at FROM tts_cache WHERE cache_key = $1',
    [cacheKey]
  );

  if (cached.rows.length > 0) {
    const cacheAge = Date.now() - new Date(cached.rows[0].created_at).getTime();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (cacheAge < maxAge) {
      logger.info('[TTS] Cache HIT');

      // Update access stats
      await db.query(
        'UPDATE tts_cache SET last_accessed = NOW(), access_count = access_count + 1 WHERE cache_key = $1',
        [cacheKey]
      );

      return {
        audioUrl: cached.rows[0].audio_url,
        cached: true
      };
    }
  }

  // Generate new
  logger.info('[TTS] Cache MISS - generating');
  const audioBuffer = await this.textToSpeech(text, voiceId, options);

  // Save to filesystem
  const filename = `${cacheKey}.mp3`;
  const filepath = path.join(__dirname, '../../public/tts_cache', filename);

  // Create directory if needed
  await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
  await fs.promises.writeFile(filepath, audioBuffer);

  const audioUrl = `/tts_cache/${filename}`;

  // Save to database
  await db.query(
    `INSERT INTO tts_cache (cache_key, audio_url, text_preview, model_id, voice_id, character_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET audio_url = $2, created_at = NOW()`,
    [cacheKey, audioUrl, text.slice(0, 200), voiceConfig.model_id, voiceConfig.voice_id, text.length]
  );

  return { audioUrl, cached: false };
}
```

**Impact:**
- Perfect consistency for repeated text
- Significant cost savings (no regeneration)
- Faster response times (no API call)

---

## 🟡 Medium Priority (Next Sprint)

### 4. Character Voice Profile System
**Benefit:** Maintain consistent voice characteristics per character across story.

**Database Migration:**
```sql
-- C:\inetpub\wwwroot\storyteller\database\migrations\025_character_voice_profiles.sql

CREATE TABLE IF NOT EXISTS character_voice_profiles (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  character_name VARCHAR(255) NOT NULL,
  voice_id VARCHAR(50) NOT NULL,
  stability DECIMAL(3,2) DEFAULT 0.5,
  similarity_boost DECIMAL(3,2) DEFAULT 0.75,
  style DECIMAL(3,2) DEFAULT 0.3,
  speed DECIMAL(3,2) DEFAULT 1.0,
  seed INTEGER,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(story_id, character_name)
);

CREATE INDEX idx_character_voices_story ON character_voice_profiles(story_id);
```

**API Endpoints:**
```javascript
// server/routes/voices.js (new file)

// GET /api/voices/characters/:storyId
router.get('/characters/:storyId', async (req, res) => {
  const profiles = await db.query(
    'SELECT * FROM character_voice_profiles WHERE story_id = $1',
    [req.params.storyId]
  );
  res.json({ characters: profiles.rows });
});

// POST /api/voices/characters/:storyId/:characterName
router.post('/characters/:storyId/:characterName', async (req, res) => {
  const { voice_id, stability, similarity_boost, style, speed, description } = req.body;

  await db.query(
    `INSERT INTO character_voice_profiles
     (story_id, character_name, voice_id, stability, similarity_boost, style, speed, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (story_id, character_name)
     DO UPDATE SET
       voice_id = $3, stability = $4, similarity_boost = $5,
       style = $6, speed = $7, description = $8, updated_at = NOW()`,
    [req.params.storyId, req.params.characterName, voice_id, stability, similarity_boost, style, speed, description]
  );

  res.json({ success: true });
});
```

---

### 5. Voice Library Browser
**Benefit:** Let users discover and preview voices for their characters.

**API Route:**
```javascript
// server/routes/voices.js

const elevenlabsService = require('../services/elevenlabs');

// GET /api/voices/library
router.get('/library', async (req, res) => {
  try {
    const { category, gender, age, accent } = req.query;

    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    });

    let voices = response.data.voices;

    // Filter
    if (category) voices = voices.filter(v => v.category === category);
    if (gender) voices = voices.filter(v => v.labels?.gender === gender);
    // ... more filters

    res.json({ voices });
  } catch (error) {
    logger.error('[Voices] Library fetch failed:', error);
    res.status(500).json({ error: 'Failed to fetch voice library' });
  }
});

// GET /api/voices/:voiceId/preview
router.get('/:voiceId/preview', async (req, res) => {
  try {
    const previewText = req.query.text || "The ancient forest whispered secrets to those brave enough to listen.";

    const audio = await elevenlabsService.textToSpeech(
      previewText,
      req.params.voiceId,
      { quality_tier: 'fast' }  // Fast preview
    );

    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (error) {
    logger.error('[Voices] Preview failed:', error);
    res.status(500).json({ error: 'Preview generation failed' });
  }
});

module.exports = router;
```

**Register Route:**
```javascript
// In server/index.js
const voicesRouter = require('./routes/voices');
app.use('/api/voices', voicesRouter);
```

---

### 6. Cost Tracking & Usage Analytics
**Benefit:** Monitor TTS costs, optimize spending.

**Database Migration:**
```sql
-- C:\inetpub\wwwroot\storyteller\database\migrations\026_tts_usage_tracking.sql

CREATE TABLE IF NOT EXISTS tts_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  story_id INTEGER REFERENCES stories(id),
  session_id VARCHAR(50),
  character_count INTEGER NOT NULL,
  model_id VARCHAR(50) NOT NULL,
  estimated_cost DECIMAL(10,4),
  cached BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tts_usage_user ON tts_usage(user_id);
CREATE INDEX idx_tts_usage_story ON tts_usage(story_id);
CREATE INDEX idx_tts_usage_date ON tts_usage(created_at);
```

**Implementation:**
```javascript
// In server/services/elevenlabs.js

async trackUsage(userId, storyId, sessionId, characterCount, modelId, cached = false) {
  // Calculate cost
  const costPerChar = modelId.includes('flash') || modelId.includes('turbo')
    ? 0.0000495  // 0.5 credits
    : 0.000099;  // 1 credit

  const estimatedCost = cached ? 0 : characterCount * costPerChar;

  await db.query(
    `INSERT INTO tts_usage
     (user_id, story_id, session_id, character_count, model_id, estimated_cost, cached, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [userId, storyId, sessionId, characterCount, modelId, estimatedCost, cached]
  );

  logger.info('[TTS Usage]', {
    user: userId,
    chars: characterCount,
    model: modelId,
    cost: estimatedCost.toFixed(4),
    cached
  });
}

// Call in textToSpeech after successful generation
await this.trackUsage(
  options.userId,
  options.storyId,
  options.sessionId,
  text.length,
  modelId,
  false
);
```

**Admin Dashboard Query:**
```sql
-- Daily usage summary
SELECT
  DATE(created_at) as date,
  model_id,
  COUNT(*) as generations,
  SUM(character_count) as total_chars,
  SUM(estimated_cost) as total_cost,
  SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cache_hits,
  ROUND(100.0 * SUM(CASE WHEN cached THEN 1 ELSE 0 END) / COUNT(*), 2) as cache_hit_rate
FROM tts_usage
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), model_id
ORDER BY date DESC, model_id;
```

---

## 🟢 Low Priority (Future Enhancements)

### 7. Voice Preview Widget
**Frontend component for voice selection**

```jsx
// client/src/components/VoicePicker.jsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function VoicePicker({ characterName, storyId, onSelect }) {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [previewAudio, setPreviewAudio] = useState(null);

  useEffect(() => {
    // Load voice library
    axios.get('/api/voices/library')
      .then(res => setVoices(res.data.voices))
      .catch(err => console.error(err));
  }, []);

  const handlePreview = async (voiceId) => {
    try {
      const response = await axios.get(`/api/voices/${voiceId}/preview`, {
        responseType: 'blob'
      });

      const audioUrl = URL.createObjectURL(response.data);
      setPreviewAudio(audioUrl);

      const audio = new Audio(audioUrl);
      audio.play();
    } catch (error) {
      console.error('Preview failed:', error);
    }
  };

  const handleSelect = async (voice) => {
    setSelectedVoice(voice);

    // Save character voice profile
    await axios.post(`/api/voices/characters/${storyId}/${characterName}`, {
      voice_id: voice.voice_id,
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      speed: 1.0,
      description: voice.description
    });

    onSelect(voice);
  };

  return (
    <div className="voice-picker">
      <h3>Select Voice for {characterName}</h3>
      <div className="voice-grid">
        {voices.map(voice => (
          <div key={voice.voice_id} className="voice-card">
            <h4>{voice.name}</h4>
            <p>{voice.description}</p>
            <div className="voice-labels">
              <span>{voice.labels?.gender}</span>
              <span>{voice.labels?.age}</span>
              <span>{voice.labels?.accent}</span>
            </div>
            <button onClick={() => handlePreview(voice.voice_id)}>
              Preview
            </button>
            <button onClick={() => handleSelect(voice)}>
              Select
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### 8. Audio Quality Validation
**Ensure generated audio meets quality standards**

```javascript
// In server/services/elevenlabs.js

validateGeneratedAudio(audioBuffer, expectedText) {
  // 1. Check minimum size
  if (audioBuffer.length < 1000) {
    throw new Error('Generated audio is too small (likely failed)');
  }

  // 2. Estimate expected duration
  const words = expectedText.split(/\s+/).length;
  const expectedDuration = (words / 150) * 60; // ~150 words/min

  // Note: Actual duration check requires audio processing library
  // For now, just size checks

  // 3. Check maximum size (detect potential errors)
  const maxSize = expectedText.length * 500; // ~500 bytes per character max
  if (audioBuffer.length > maxSize) {
    logger.warn('[TTS Validation] Audio larger than expected', {
      size: audioBuffer.length,
      maxExpected: maxSize
    });
  }

  logger.info('[TTS Validation] Passed', {
    size: audioBuffer.length,
    expectedDuration: expectedDuration.toFixed(1) + 's'
  });

  return true;
}

// Use in textToSpeech
const audioBuffer = await response.data;
this.validateGeneratedAudio(audioBuffer, text);
return audioBuffer;
```

---

### 9. Retry Logic for Failed Generations
**Handle transient failures gracefully**

```javascript
// In server/services/elevenlabs.js

async textToSpeechWithRetry(text, voiceId, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const audio = await this.textToSpeech(text, voiceId, options);

      // Validate
      this.validateGeneratedAudio(audio, text);

      return audio;
    } catch (error) {
      logger.error(`[TTS] Attempt ${attempt}/${maxRetries} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`TTS generation failed after ${maxRetries} attempts: ${error.message}`);
      }

      // Exponential backoff
      const delay = 1000 * Math.pow(2, attempt - 1);
      logger.info(`[TTS] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

### 10. Genre-Specific Voice Recommendations
**Suggest appropriate voices based on story genre**

```javascript
// In server/services/elevenlabs.js

const GENRE_VOICE_RECOMMENDATIONS = {
  horror: {
    narrator: ['pNInz6obpgDQGcFmaJgB', 'Clyde'],  // Adam, Clyde (deep, ominous)
    victim: ['EXAVITQu4vr4xnSDxMaL', 'Elli'],     // Bella, Elli (vulnerable)
    threat: ['Fin', 'Dorothy']                     // Sinister voices
  },
  romance: {
    narrator: ['21m00Tcm4TlvDq8ikWAM', 'Charlotte'], // Rachel, Charlotte (warm)
    female_lead: ['EXAVITQu4vr4xnSDxMaL', 'Freya'],  // Bella, Freya
    male_lead: ['Antoni', 'Callum']
  },
  fantasy: {
    narrator: ['pNInz6obpgDQGcFmaJgB', 'Antoni'],   // Adam, Antoni (epic)
    wizard: ['Arnold', 'Patrick'],
    young_hero: ['Josh', 'Bella'],
    villain: ['Clyde', 'Fin']
  },
  // ... more genres
};

getVoiceRecommendations(genre, characterType) {
  return GENRE_VOICE_RECOMMENDATIONS[genre]?.[characterType] || [];
}
```

---

## Testing Checklist

### After Implementing Changes:

- [ ] Test seed parameter generates consistent (similar) audio
- [ ] Verify speaker_boost not sent to V3 model
- [ ] Test cache hit/miss scenarios
- [ ] Verify cache saves correctly to database and filesystem
- [ ] Test character voice profile CRUD operations
- [ ] Verify voice library API returns filtered results
- [ ] Test voice preview generation
- [ ] Check cost tracking records usage correctly
- [ ] Verify retry logic handles failures gracefully
- [ ] Test validation rejects invalid audio

---

## Performance Monitoring

### Metrics to Track:

```javascript
// Add to logger output
logger.info('[TTS Metrics]', {
  cache_hit_rate: '45%',
  avg_generation_time: '1.2s',
  total_cost_today: '$2.45',
  characters_generated: 12450,
  most_used_model: 'eleven_v3'
});
```

### SQL Queries for Monitoring:

```sql
-- Cache hit rate
SELECT
  COUNT(*) FILTER (WHERE cached = true) * 100.0 / COUNT(*) as cache_hit_rate_pct
FROM tts_usage
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- Cost by model
SELECT
  model_id,
  SUM(estimated_cost) as total_cost,
  SUM(character_count) as total_chars
FROM tts_usage
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY model_id;

-- Most expensive stories
SELECT
  s.title,
  SUM(tu.estimated_cost) as total_cost,
  SUM(tu.character_count) as total_chars,
  COUNT(*) as generations
FROM tts_usage tu
JOIN stories s ON s.id = tu.story_id
WHERE tu.created_at >= NOW() - INTERVAL '30 days'
GROUP BY s.id, s.title
ORDER BY total_cost DESC
LIMIT 10;
```

---

## Estimated Implementation Time

| Task | Priority | Time Estimate | Impact |
|------|----------|---------------|--------|
| Fix speaker boost for V3 | High | 30 min | Bug fix |
| Add seed parameter | High | 1 hour | Voice consistency |
| TTS caching system | High | 3 hours | Cost savings, consistency |
| Character voice profiles | Medium | 4 hours | User feature |
| Voice library browser | Medium | 3 hours | User feature |
| Cost tracking | Medium | 2 hours | Analytics |
| Voice preview widget | Low | 4 hours | UX enhancement |
| Quality validation | Low | 1 hour | Reliability |
| Retry logic | Low | 1 hour | Reliability |
| Genre recommendations | Low | 2 hours | UX enhancement |

**Total High Priority:** ~4.5 hours
**Total Medium Priority:** ~9 hours
**Total Low Priority:** ~8 hours

---

## Notes

- **Seed parameter** provides soft consistency, NOT perfect reproducibility
- **Caching** is the only way to guarantee identical audio
- **Speaker boost** must be disabled for V3 model
- **V3 audio tags** are already implemented well in your code
- Your current **VOICE_PRESETS** are excellent and align with best practices
- Consider migrating common phrases to cache to save costs

---

## References

- Full guide: `docs/ELEVENLABS_V3_COMPLETE_GUIDE.md`
- Official docs: https://elevenlabs.io/docs
- Current implementation: `server/services/elevenlabs.js`
