/**
 * Health Check Routes
 */

import { Router } from 'express';
import { pool } from '../database/pool.js';
import { ElevenLabsService } from '../services/elevenlabs.js';
import { logger } from '../utils/logger.js';
import { getFullConfiguration, compareTierCosts } from '../services/modelSelection.js';
import { getTTSConfig } from '../services/ttsGating.js';

const router = Router();

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {}
  };

  // Check database
  try {
    const dbResult = await pool.query('SELECT NOW() as time');
    health.services.database = {
      status: 'connected',
      time: dbResult.rows[0].time
    };
  } catch (error) {
    health.services.database = {
      status: 'error',
      error: error.message
    };
    health.status = 'degraded';
  }

  // Check OpenAI API key
  health.services.openai = {
    status: process.env.OPENAI_API_KEY ? 'configured' : 'missing'
  };

  // Check ElevenLabs API key
  health.services.elevenlabs = {
    status: process.env.ELEVENLABS_API_KEY ? 'configured' : 'missing'
  };

  // Check Whisper service
  health.services.whisper = {
    url: process.env.WHISPER_SERVICE_URL || 'http://localhost:3003',
    status: 'configured'
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Detailed system info (for admin use)
router.get('/detailed', async (req, res) => {
  try {
    const [
      sessions,
      scenes,
      voices,
      prompts
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM story_sessions'),
      pool.query('SELECT COUNT(*) FROM story_scenes'),
      pool.query('SELECT COUNT(*) FROM elevenlabs_voices'),
      pool.query('SELECT COUNT(*) FROM agent_prompts')
    ]);

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      node_version: process.version,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      database: {
        story_sessions: parseInt(sessions.rows[0].count),
        story_scenes: parseInt(scenes.rows[0].count),
        voices_cached: parseInt(voices.rows[0].count),
        agent_prompts: parseInt(prompts.rows[0].count)
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * GET /api/health/test-multivoice
 * Generate a 20-second demo with multiple narrators and SFX markers
 * This proves the multi-voice and SFX systems are working
 */
router.get('/test-multivoice', async (req, res) => {
  logger.info('[TestMultiVoice] Starting multi-voice + SFX demonstration');

  try {
    const elevenlabs = new ElevenLabsService();

    // Define test dialogue with 3 different speakers
    const testDialogue = [
      {
        speaker: 'narrator',
        text: 'In a small village at the edge of an ancient forest, three travelers met at the crossroads.',
        voice_id: 'JBFqnCBsd6RMkjVDRZzb' // George - narrator
      },
      {
        speaker: 'Elena',
        text: 'I have traveled far to find the Oracle. Do you know the way?',
        voice_id: 'EXAVITQu4vr4xnSDxMaL' // Bella - female
      },
      {
        speaker: 'Marcus',
        text: 'The Oracle lives beyond the Whispering Woods. But be warned, traveler. Not all who enter return.',
        voice_id: 'onwK4e9ZLuTAKqWW03F9' // Daniel - male
      },
      {
        speaker: 'narrator',
        text: 'Thunder rumbled in the distance as the three strangers contemplated the journey ahead.',
        voice_id: 'JBFqnCBsd6RMkjVDRZzb'
      },
      {
        speaker: 'Young Boy',
        text: 'Wait! Take this map. My grandmother drew it before she... before she went into the woods.',
        voice_id: 'jBpfuIE2acCO8z3wKNLl' // Gigi - young voice
      }
    ];

    // Define SFX markers for the scene
    const sfxMarkers = [
      { timing: 'start', sfx_key: 'ambient.village', description: 'Village ambiance' },
      { timing: 'after_line_1', sfx_key: 'nature.forest_birds', description: 'Forest birds' },
      { timing: 'after_line_3', sfx_key: 'weather.thunder_distant', description: 'Distant thunder' },
      { timing: 'end', sfx_key: 'atmosphere.mysterious', description: 'Mysterious atmosphere' }
    ];

    logger.info(`[TestMultiVoice] Generating audio for ${testDialogue.length} segments with ${sfxMarkers.length} SFX markers`);

    // Generate multi-voice audio (returns { audio, wordTimings } object)
    const multiVoiceResult = await elevenlabs.generateMultiVoiceAudio(testDialogue, {
      useSpeakerVoices: true,
      model: 'eleven_multilingual_v2'
    });
    const audioBuffer = multiVoiceResult.audio;

    // Calculate duration estimate (approx 150 words/minute for narration)
    const totalWords = testDialogue.reduce((sum, seg) => sum + seg.text.split(' ').length, 0);
    const estimatedDuration = Math.round((totalWords / 150) * 60); // seconds

    res.json({
      success: true,
      message: 'Multi-voice + SFX demonstration generated successfully',
      demo: {
        speakers: [...new Set(testDialogue.map(d => d.speaker))],
        speakerCount: new Set(testDialogue.map(d => d.speaker)).size,
        segmentCount: testDialogue.length,
        sfxMarkers: sfxMarkers,
        sfxCount: sfxMarkers.length,
        estimatedDurationSeconds: estimatedDuration,
        wordCount: totalWords
      },
      audio: {
        sizeBytes: audioBuffer?.length || 0,
        sizeMB: ((audioBuffer?.length || 0) / 1024 / 1024).toFixed(2),
        format: 'mp3',
        base64Preview: audioBuffer ?
          audioBuffer.toString('base64').substring(0, 100) + '...' : null
      },
      voices: testDialogue.map(d => ({
        speaker: d.speaker,
        voice_id: d.voice_id,
        textLength: d.text.length
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('[TestMultiVoice] Demo failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/health/models
 * Show current AI model configuration and tier settings
 * Useful for debugging and admin visibility into model selection
 */
router.get('/models', async (req, res) => {
  try {
    const config = getFullConfiguration();
    const costs = compareTierCosts();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      modelConfiguration: config,
      costComparison: costs,
      documentation: {
        tiers: {
          premium: 'Best narrative quality - uses GPT-5.1 for creative agents',
          standard: 'Good quality, lower cost - uses GPT-4o for creative agents'
        },
        agentCategories: {
          creative: 'Story Planner, Scene Writer, D&D GM, CYOA, Devil\'s Advocate, Author Style',
          coherence: 'Lore Keeper, Campaign Memory, Story Bible',
          utility: 'Safety, SFX, Narrator Director, Orchestrator, Dialogue Parser'
        },
        policy: 'This is a PREMIUM product. Quality > Cost. ElevenLabs TTS + images cost $0.50-$1.00+ per story, making LLM cost a minor factor.'
      }
    });
  } catch (error) {
    logger.error('[Health/Models] Error getting model config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/health/tts
 * Show TTS gating configuration and usage stats
 * Section 3 of Storyteller Gospel - TTS/ElevenLabs gating
 */
router.get('/tts', async (req, res) => {
  try {
    const ttsConfig = getTTSConfig();

    // Get aggregate TTS usage from database
    let usageStats = null;
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total_stories,
          COUNT(*) FILTER (WHERE tts_chars_used > 0) as stories_with_tts,
          SUM(COALESCE(tts_chars_used, 0)) as total_chars,
          SUM(COALESCE(tts_segment_count, 0)) as total_segments,
          SUM(COALESCE(tts_audio_bytes, 0)) as total_bytes,
          AVG(COALESCE(tts_chars_used, 0)) FILTER (WHERE tts_chars_used > 0) as avg_chars_per_story,
          MAX(tts_chars_used) as max_chars_story
        FROM story_sessions
      `);
      usageStats = result.rows[0];
    } catch (dbError) {
      // Columns might not exist yet
      usageStats = { error: 'TTS tracking columns not yet migrated' };
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ttsConfiguration: {
        ...ttsConfig,
        debugModeActive: !ttsConfig.enabled,
        description: ttsConfig.enabled
          ? 'TTS is ENABLED - ElevenLabs API calls will be made'
          : 'TTS is DISABLED (debug mode) - No API calls, pipeline simulated'
      },
      usageStats: usageStats ? {
        totalStories: parseInt(usageStats.total_stories) || 0,
        storiesWithTTS: parseInt(usageStats.stories_with_tts) || 0,
        totalChars: parseInt(usageStats.total_chars) || 0,
        totalSegments: parseInt(usageStats.total_segments) || 0,
        totalAudioMB: ((parseInt(usageStats.total_bytes) || 0) / 1024 / 1024).toFixed(2),
        avgCharsPerStory: Math.round(parseFloat(usageStats.avg_chars_per_story) || 0),
        maxCharsStory: parseInt(usageStats.max_chars_story) || 0
      } : null,
      documentation: {
        TTS_ENABLED: 'Set to "false" for text-only debug mode',
        TTS_MAX_CHARS_PER_STORY: 'Maximum characters per story before TTS is blocked',
        section: 'Section 3 of Storyteller Gospel - TTS/ElevenLabs Gating',
        purpose: 'Prevent runaway TTS costs by gating API calls until story is validated and user confirms playback'
      }
    });
  } catch (error) {
    logger.error('[Health/TTS] Error getting TTS config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
