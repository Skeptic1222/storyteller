/**
 * Audio Socket Handlers
 * Handles audio streaming, playback control, and TTS generation
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { ElevenLabsService } from '../services/elevenlabs.js';
import { Orchestrator } from '../services/orchestrator.js';
import { recordingService } from '../services/recording.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  pendingAudio,
  broadcastToRoom
} from './state.js';
import { requireSessionOwner } from './socketAuth.js';
import { buildTrailerIntro } from '../utils/trailerIntro.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || join(__dirname, '..', '..', 'public', 'audio');

const elevenlabs = new ElevenLabsService();

/**
 * Setup playback-related socket handlers
 */
export function setupPlaybackHandlers(socket, io) {

  // Client signals it's ready to start playback (after countdown)
  socket.on('start-playback', async (data) => {
    const { session_id } = data;
    logger.info(`[Socket:Recv] EVENT: start-playback | socketId: ${socket.id} | session_id: ${session_id}`);

    if (!session_id) {
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    const pending = pendingAudio.get(session_id);
    if (!pending) {
      socket.emit('error', { message: 'No pending audio for this session' });
      return;
    }

    const { scene, voice_id, stats, audioDetails } = pending;
    const isFirstScene = scene.sequence_index === 0;

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      logger.info(`[StartPlayback] Starting playback for session ${session_id} | hasPreloadedAudio: ${!!audioDetails}`);

      // UNIFIED PROGRESS BAR FIX: Use pre-synthesized audio from launch sequence
      // This eliminates the second "Preparing Narration" progress bar
      if (audioDetails && (audioDetails.intro || audioDetails.scene)) {
        logger.info(`[StartPlayback] Using preloaded audio | intro: ${!!audioDetails.intro} | scene: ${!!audioDetails.scene}`);

        broadcastToRoom(session_id, 'playback-starting', {
          message: 'Preparing preloaded audio...',
          hasAudio: true,
          isDeferred: false
        });

        // Emit intro audio if available
        if (audioDetails.intro?.base64) {
          broadcastToRoom(session_id, 'intro-audio-ready', {
            audio: audioDetails.intro.base64,
            format: 'mp3',
            size: audioDetails.intro.size || audioDetails.intro.base64.length,
            title: audioDetails.intro.title || stats.title,
            synopsis: audioDetails.intro.synopsis || stats.synopsis
          });
        }

        // Emit scene audio if available
        if (audioDetails.scene?.base64) {
          broadcastToRoom(session_id, 'audio-ready', {
            audio: audioDetails.scene.base64,
            format: 'mp3',
            size: audioDetails.scene.size || audioDetails.scene.base64.length,
            wordTimings: audioDetails.scene.wordTimings || null,
            preloaded: true
          });
        }

        pendingAudio.delete(session_id);
        return;
      }

      // FALLBACK: No preloaded audio, generate on-demand (legacy flow)
      logger.info(`[StartPlayback] No preloaded audio, generating on-demand for session ${session_id}`);

      broadcastToRoom(session_id, 'playback-starting', {
        message: 'Generating narration audio...',
        hasAudio: !!scene.audio_url,
        isDeferred: !scene.audio_url
      });

      await streamSceneAudio(
        session_id,
        scene,
        voice_id,
        stats.title,
        stats.synopsis,
        isFirstScene
      );

      pendingAudio.delete(session_id);

    } catch (error) {
      logger.error('Start playback error:', error);
      socket.emit('error', { message: 'Failed to start playback' });
    }
  });

  // Cancel pending playback
  socket.on('cancel-playback', async (data) => {
    const { session_id } = data;
    logger.info(`[Socket:Recv] EVENT: cancel-playback | socketId: ${socket.id} | session_id: ${session_id}`);
    if (session_id && pendingAudio.has(session_id)) {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      pendingAudio.delete(session_id);
      logger.info(`[Socket] PLAYBACK_CANCELLED | session_id: ${session_id}`);
      socket.emit('playback-cancelled', { session_id });
    }
  });

  // Pause story
  socket.on('pause-story', async (data) => {
    const { session_id } = data;
    logger.info(`[Socket:Recv] EVENT: pause-story | socketId: ${socket.id} | session_id: ${session_id}`);

    if (!session_id) return;

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      await pool.query(
        "UPDATE story_sessions SET current_status = 'paused' WHERE id = $1",
        [session_id]
      );
      broadcastToRoom(session_id, 'story-paused', { message: 'Story paused' });
    } catch (error) {
      logger.error(`[Socket] PAUSE_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
    }
  });

  // Resume story
  socket.on('resume-story', async (data) => {
    const { session_id } = data;
    logger.info(`[Socket:Recv] EVENT: resume-story | socketId: ${socket.id} | session_id: ${session_id}`);

    if (!session_id) return;

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      await pool.query(
        "UPDATE story_sessions SET current_status = 'narrating' WHERE id = $1",
        [session_id]
      );
      broadcastToRoom(session_id, 'story-resumed', { message: 'Story resumed' });
    } catch (error) {
      logger.error(`[Socket] RESUME_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
    }
  });

  /**
   * Request audio generation for an existing scene (existing stories)
   * Used when user loads an existing story and clicks Play
   */
  socket.on('request-scene-audio', async (data) => {
    const { session_id, scene_id } = data;
    logger.info(`[Socket:Recv] EVENT: request-scene-audio | socketId: ${socket.id} | session_id: ${session_id} | scene_id: ${scene_id || 'latest'}`);

    if (!session_id) {
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      // Load session config and determine voice
      const sessionResult = await pool.query(
        'SELECT config_json, title, synopsis FROM story_sessions WHERE id = $1',
        [session_id]
      );

      if (!sessionResult.rows[0]) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      const sessionConfig = sessionResult.rows[0].config_json;
      const voiceId = sessionConfig?.voice_id || sessionConfig?.narratorVoice;
      const title = sessionResult.rows[0].title;
      const synopsis = sessionResult.rows[0].synopsis;

      // Load the target scene (latest if not specified)
      let sceneQuery;
      let sceneParams;
      if (scene_id) {
        sceneQuery = `
          SELECT id, sequence_index, polished_text, audio_url, word_timings
          FROM story_scenes
          WHERE id = $1 AND story_session_id = $2
        `;
        sceneParams = [scene_id, session_id];
      } else {
        sceneQuery = `
          SELECT id, sequence_index, polished_text, audio_url, word_timings
          FROM story_scenes
          WHERE story_session_id = $1
          ORDER BY sequence_index DESC
          LIMIT 1
        `;
        sceneParams = [session_id];
      }

      const sceneResult = await pool.query(sceneQuery, sceneParams);

      if (!sceneResult.rows[0]) {
        socket.emit('error', { message: 'No scenes found for this session' });
        return;
      }

      const scene = sceneResult.rows[0];
      const isFirstScene = scene.sequence_index === 0;

      logger.info(`[RequestSceneAudio] Starting audio for scene ${scene.id} (index ${scene.sequence_index})`);

      broadcastToRoom(session_id, 'playback-starting', {
        message: 'Generating narration audio...',
        hasAudio: !!scene.audio_url,
        isDeferred: !scene.audio_url
      });

      await streamSceneAudio(
        session_id,
        scene,
        voiceId,
        title,
        synopsis,
        isFirstScene
      );

    } catch (error) {
      logger.error(`[RequestSceneAudio] Error: ${error.message}`);
      socket.emit('error', { message: 'Failed to generate scene audio' });
    }
  });
}

/**
 * Stream audio response to clients
 */
export async function streamAudioResponse(sessionId, text, voiceId) {
  try {
    const audioBuffer = await elevenlabs.textToSpeech(text, voiceId);
    const audioBase64 = audioBuffer.toString('base64');

    broadcastToRoom(sessionId, 'audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: audioBuffer.length
    });

  } catch (error) {
    logger.error('[AudioStream] Error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to generate audio' });
  }
}

/**
 * Stream cached audio file
 */
export async function streamCachedAudio(sessionId, audioUrl, options = {}) {
  try {
    // Handle both relative and absolute paths
    let audioPath = audioUrl;
    if (audioUrl.startsWith('/')) {
      audioPath = join(process.cwd(), 'public', audioUrl);
    } else if (!audioUrl.includes(':')) {
      audioPath = join(AUDIO_CACHE_DIR, audioUrl);
    }

    if (!existsSync(audioPath)) {
      logger.warn(`[CachedAudio] File not found: ${audioPath}`);
      broadcastToRoom(sessionId, 'audio-error', { message: 'Cached audio not found' });
      return;
    }

    const audioBuffer = await readFile(audioPath);
    const audioBase64 = audioBuffer.toString('base64');

    logger.info(`[StreamCachedAudio] Broadcasting CACHED audio: wordTimings type=${typeof options?.wordTimings}, hasWords=${!!options?.wordTimings?.words}, count=${options?.wordTimings?.words?.length || 0}`);
    broadcastToRoom(sessionId, 'audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: audioBuffer.length,
      cached: true,
      wordTimings: options?.wordTimings || undefined
    });

  } catch (error) {
    logger.error('[CachedAudio] Error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to load cached audio' });
  }
}

/**
 * Stream scene audio with optional title/synopsis narration
 */
export async function streamSceneAudio(sessionId, scene, voiceId, title, synopsis, isFirstScene) {
  try {
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Preparing audio...' });

    // Load voice from session config if not provided
    let effectiveVoiceId = voiceId;
    let sessionConfig = null;

    if (!effectiveVoiceId && sessionId) {
      try {
        const result = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        if (result.rows[0]?.config_json) {
          sessionConfig = result.rows[0].config_json;
          effectiveVoiceId = sessionConfig.voice_id || sessionConfig.narratorVoice;
        }
      } catch (err) {
        logger.warn(`[SceneAudio] Failed to load session config: ${err.message}`);
      }
    }

    // Load config if needed (used for effectiveVoiceId + narration quality settings in orchestrator)
    let configJson = sessionConfig;
    if (!configJson) {
      try {
        const sessionResult = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        configJson = sessionResult.rows[0]?.config_json;
        if (!effectiveVoiceId && configJson) {
          effectiveVoiceId = configJson.voice_id || configJson.narratorVoice;
        }
      } catch (err) {
        logger.warn(`[SceneAudio] Failed to load config: ${err.message}`);
      }
    }

    // Build cinematic trailer-style intro for first scene
    // Uses ElevenLabs V3 audio tags for dramatic pauses and emotion
    let introText = null;
    if (isFirstScene && (title || synopsis)) {
      introText = buildTrailerIntro(title, synopsis, configJson || {});
      logger.debug(`[SceneAudio] Built trailer intro | length: ${introText.length}`);
    }

    // Parallel generation
    broadcastToRoom(sessionId, 'audio-generating', { message: 'Generating narration...' });

    const introPromise = introText
      ? elevenlabs.textToSpeech(introText, effectiveVoiceId).catch(err => {
          logger.error(`[SceneAudio] Intro audio failed: ${err.message}`);
          return null;
        })
      : Promise.resolve(null);

    const scenePromise = (async () => {
      if (!scene?.id) return null;

      try {
        const orchestrator = new Orchestrator(sessionId);
        let lastProgressSent = -1;

        const result = await orchestrator.generateSceneAudio(scene.id, effectiveVoiceId, {
          onProgress: (progress) => {
            try {
              const total = Number(progress?.total) || 0;
              const current = Number(progress?.current) || 0;
              let percent = total > 0 ? Math.round((current / total) * 100) : null;

              // If this is a "currently synthesizing" update, keep progress slightly behind so we
              // don't show 100% while the last segment is still generating.
              if (Number.isFinite(percent) && progress?.phase === 'tts_segment' && total > 0) {
                percent = Math.round((Math.max(0, current - 1) / total) * 100);
              }

              // Assembly happens after synthesis; keep it "near done" until audio-ready arrives.
              if (Number.isFinite(percent) && progress?.phase === 'assemble') {
                percent = Math.min(99, Math.max(95, percent));
              }

              // Throttle: only send percent updates when the value changes.
              if (Number.isFinite(percent) && percent === lastProgressSent) return;
              if (Number.isFinite(percent)) lastProgressSent = percent;

              broadcastToRoom(sessionId, 'audio-generating', {
                message: progress?.message || 'Generating narration...',
                progress: Number.isFinite(percent) ? percent : undefined,
                phase: progress?.phase,
                current: total > 0 ? current : undefined,
                total: total > 0 ? total : undefined
              });
            } catch (err) {
              logger.debug(`[SceneAudio] Progress broadcast failed: ${err.message}`);
            }
          }
        });

        return { type: result.cached ? 'cached' : 'generated', ...result };
      } catch (err) {
        logger.error(`[SceneAudio] Orchestrator scene audio failed: ${err.message}`);
        return scene?.polished_text ? { type: 'fallback', text: scene.polished_text } : null;
      }
    })();

    // Bug 3 Fix: Await BOTH intro and scene audio before emitting anything
    // This prevents synopsis from playing while scene is still generating
    // User sees single unified progress bar until ALL audio is ready
    const [introBuffer, sceneResult] = await Promise.all([introPromise, scenePromise]);

    logger.info(`[SceneAudio] Both audio streams ready | intro: ${!!introBuffer} | scene: ${sceneResult?.type || 'none'}`);

    // Prepare intro data (if available)
    let introData = null;
    if (introBuffer) {
      introData = {
        audio: introBuffer.toString('base64'),
        format: 'mp3',
        size: introBuffer.length,
        title,
        synopsis
      };

      // Record intro if active recording
      const activeRecordingId = recordingService.getActiveRecording(sessionId);
      if (activeRecordingId) {
        try {
          await recordingService.addIntroSegment(activeRecordingId, {
            audioBuffer: introBuffer,
            title,
            synopsis
          });
        } catch (err) {
          logger.error(`[Recording] Failed to save intro: ${err.message}`);
        }
      }
    }

    // Prepare scene audio data
    let sceneData = null;
    if (sceneResult) {
      if (sceneResult.type === 'cached') {
        let cachedPath = sceneResult.audioUrl;
        if (cachedPath) {
          if (cachedPath.startsWith('/')) {
            cachedPath = join(process.cwd(), 'public', cachedPath);
          } else if (!cachedPath.includes(':')) {
            cachedPath = join(AUDIO_CACHE_DIR, cachedPath);
          }
        }

        const cacheMissing = !cachedPath || !existsSync(cachedPath);
        if (cacheMissing) {
          logger.warn(`[SceneAudio] Cached audio missing for ${scene.id}, regenerating...`);
          const regenOrchestrator = new Orchestrator(sessionId);
          const regen = await regenOrchestrator.generateSceneAudio(scene.id, effectiveVoiceId, {
            onProgress,
            forceRegenerate: true
          });
          if (regen?.audioBuffer) {
            sceneData = {
              audio: regen.audioBuffer.toString('base64'),
              format: 'mp3',
              size: regen.audioBuffer.length,
              wordTimings: regen.wordTimings
            };
          } else if (scene.polished_text) {
            // Fall back to simple TTS
            await streamAudioResponse(sessionId, scene.polished_text, effectiveVoiceId);
            return; // streamAudioResponse handles its own event emission
          }
        } else {
          // Cached audio exists - stream it (handles its own event emission)
          // But first emit intro if available
          if (introData) {
            broadcastToRoom(sessionId, 'intro-audio-ready', introData);
          }
          await streamCachedAudio(sessionId, sceneResult.audioUrl, { wordTimings: sceneResult.wordTimings || null });
          return;
        }
      } else if (sceneResult.type === 'generated' && sceneResult.audioBuffer) {
        logger.info(`[StreamSceneAudio] Broadcasting GENERATED audio: wordTimings type=${typeof sceneResult.wordTimings}, hasWords=${!!sceneResult.wordTimings?.words}, count=${sceneResult.wordTimings?.words?.length || 0}`);
        sceneData = {
          audio: sceneResult.audioBuffer.toString('base64'),
          format: 'mp3',
          size: sceneResult.audioBuffer.length,
          wordTimings: sceneResult.wordTimings
        };
      } else if (sceneResult.type === 'fallback') {
        // Fall back to simple TTS - emit intro first if available
        if (introData) {
          broadcastToRoom(sessionId, 'intro-audio-ready', introData);
        }
        await streamAudioResponse(sessionId, sceneResult.text, effectiveVoiceId);
        return;
      }
    } else if (scene.polished_text) {
      // No scene result, fall back to simple TTS
      if (introData) {
        broadcastToRoom(sessionId, 'intro-audio-ready', introData);
      }
      await streamAudioResponse(sessionId, scene.polished_text, effectiveVoiceId);
      return;
    }

    // Bug 3 Fix: Emit single unified event with ALL audio ready
    // Client can now show single progress bar and start playback with everything prepared
    if (introData || sceneData) {
      broadcastToRoom(sessionId, 'all-audio-ready', {
        intro: introData,
        scene: sceneData,
        title,
        synopsis
      });
      logger.info(`[SceneAudio] Emitted all-audio-ready | intro: ${!!introData} | scene: ${!!sceneData}`);
    }

  } catch (error) {
    logger.error('[SceneAudio] Error:', error);
    broadcastToRoom(sessionId, 'audio-error', { message: 'Failed to generate scene audio' });
  }
}

/**
 * Generate choice narration text
 */
export function generateChoiceNarration(choices) {
  if (!choices || choices.length === 0) return '';

  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
  let narration = 'What will you do? ';

  choices.forEach((choice, index) => {
    const ordinal = ordinals[index] || `Option ${index + 1}`;
    const choiceText = choice.choice_text || choice.text || choice;
    narration += `${ordinal}, ${choiceText}. `;
  });

  narration += 'Speak your choice, or tap to select.';
  return narration;
}

/**
 * Stream choice narration audio
 */
export async function streamChoiceAudio(sessionId, text, voiceId) {
  try {
    let effectiveVoiceId = voiceId;
    if (!effectiveVoiceId && sessionId) {
      try {
        const result = await pool.query(
          'SELECT config_json FROM story_sessions WHERE id = $1',
          [sessionId]
        );
        if (result.rows[0]?.config_json) {
          effectiveVoiceId = result.rows[0].config_json.voice_id || result.rows[0].config_json.narratorVoice;
        }
      } catch (err) {
        logger.warn(`[ChoiceAudio] Failed to load voice: ${err.message}`);
      }
    }

    const audioBuffer = await elevenlabs.textToSpeech(text, effectiveVoiceId);
    const audioBase64 = audioBuffer.toString('base64');

    broadcastToRoom(sessionId, 'choice-audio-ready', {
      audio: audioBase64,
      format: 'mp3',
      size: audioBuffer.length,
      text
    });

  } catch (error) {
    logger.error('[ChoiceAudio] Error:', error);
    broadcastToRoom(sessionId, 'choice-audio-error', { message: 'Failed to generate choice audio' });
  }
}
