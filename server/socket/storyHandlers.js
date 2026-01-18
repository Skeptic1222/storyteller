/**
 * Story Socket Handlers
 * Handles story progression: continue-story, voice-input, submit-choice
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { Orchestrator } from '../services/orchestrator.js';
import { LaunchSequenceManager } from '../services/launchSequenceManager.js';
import {
  activeSessions,
  activeLaunchSequences,
  pendingAudio,
  generationProgress,
  canAddToMap,
  broadcastToRoom,
  getBroadcastIO
} from './state.js';
import { streamAudioResponse } from './audioHandlers.js';
import { requireSessionOwner } from './socketAuth.js';

/**
 * Setup story-related socket handlers
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function setupStoryHandlers(socket, io) {

  // Voice input from Whisper
  socket.on('voice-input', async (data) => {
    const { session_id, transcript, confidence } = data;
    logger.info(`[Socket:Recv] EVENT: voice-input | socketId: ${socket.id} | session_id: ${session_id} | confidence: ${confidence}`);

    if (!session_id || !transcript) {
      socket.emit('error', { message: 'session_id and transcript required' });
      return;
    }

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      // Log the voice input
      await pool.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'user', 'voice', $2)
      `, [session_id, transcript]);

      // Emit acknowledgment
      socket.emit('voice-received', { transcript, confidence });

      // Process with orchestrator
      const orchestrator = new Orchestrator(session_id);
      const response = await orchestrator.processVoiceInput(transcript);

      // Emit text response
      broadcastToRoom(session_id, 'story-response', {
        type: response.type,
        text: response.text,
        message: response.message
      });

      // Generate and stream audio if text response
      if (response.text && response.generateAudio !== false) {
        await streamAudioResponse(session_id, response.text, response.voice_id);
      }

    } catch (error) {
      logger.error('Voice input processing error:', error);
      socket.emit('error', { message: 'Failed to process voice input' });
    }
  });

  // Request next scene - uses LaunchSequenceManager for sequential validation
  socket.on('continue-story', async (data) => {
    const { session_id, voice_id, autoplay = false } = data;
    logger.info(`[Socket:Recv] EVENT: continue-story | socketId: ${socket.id} | session_id: ${session_id} | autoplay: ${autoplay}`);

    if (!session_id) {
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    // Declare cleanup variables outside try block for access in catch
    let progressHeartbeat = null;
    let cleanupOnDisconnect = null;

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      // Cancel any existing launch sequence for this session (atomic get+cancel+delete)
      const existingManager = activeLaunchSequences.get(session_id);
      if (existingManager) {
        existingManager.cancel();
        activeLaunchSequences.delete(session_id);
      }

      // Initialize generation progress tracking for state persistence
      const generationStartTime = Date.now();
      canAddToMap('generationProgress');
      generationProgress.set(session_id, {
        startTime: generationStartTime,
        step: 1,
        percent: 0,
        message: 'Initializing...',
        isGenerating: true,
        lastUpdate: generationStartTime
      });

      // Emit progress with phases for scene generation
      let lastEmittedPercent = 0;
      let lastEmittedPhase = '';
      let microProgressAccumulator = 0; // Reset on real progress updates
      const emitProgress = (step, percent, message, stats = null, phaseName = '') => {
        lastEmittedPercent = percent;
        lastEmittedPhase = phaseName || lastEmittedPhase;
        microProgressAccumulator = 0; // Reset micro-progress on real updates

        // Persist progress for reconnection recovery
        const progressData = generationProgress.get(session_id);
        if (progressData) {
          progressData.step = step;
          progressData.percent = percent;
          progressData.message = message;
          progressData.lastUpdate = Date.now();
        }

        // CRITICAL FIX: Use broadcastToRoom so all clients in session receive progress
        // FIX Bug 1: Include startTime so client can calculate elapsed time on refresh
        broadcastToRoom(session_id, 'generating', {
          step,
          percent,
          message,
          stats,
          startTime: generationStartTime // Server timestamp - survives page refresh
        });
      };

      emitProgress(1, 5, 'Loading story context...');

      const orchestrator = new Orchestrator(session_id);

      // Engaging messages to rotate through during long operations
      const heartbeatMessages = [
        'Crafting your narrative...',
        'Weaving character dialogue...',
        'Building scene atmosphere...',
        'Developing story elements...',
        'Adding dramatic details...',
        'Polishing prose...',
        'Creating tension and pacing...',
        'Balancing story beats...',
        'Refining character voices...',
        'Shaping the narrative arc...'
      ];

      // Progress heartbeat: Enhanced with elapsed time, rotating messages, and micro-progress
      const heartbeatStartTime = Date.now();
      let heartbeatMessageIndex = 0;

      progressHeartbeat = setInterval(() => {
        // Calculate elapsed time
        const elapsedMs = Date.now() - heartbeatStartTime;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        const elapsedMin = Math.floor(elapsedSec / 60);
        const elapsedDisplay = elapsedMin > 0
          ? `${elapsedMin}m ${elapsedSec % 60}s`
          : `${elapsedSec}s`;

        // Bug 2 Fix: Phase-aware micro-progress to prevent "stuck at 30%" perception
        // During long-running phases like 'generating' (30-55%), allow more micro-progress
        // so users see gradual movement instead of being stuck for several minutes
        microProgressAccumulator += 0.4;

        // Determine max micro-progress based on current phase
        // generating: 30% -> 55% takes 2-5 minutes, allow up to 22% micro-progress
        // Other phases are shorter, keep 5% cap
        const isLongRunningPhase = lastEmittedPhase === 'generating' ||
                                    lastEmittedPhase === 'hybrid_generating' ||
                                    lastEmittedPhase === 'scaffold_generating' ||
                                    lastEmittedPhase === 'scaffold_expanding';
        const maxMicroProgressCap = isLongRunningPhase ? 18 : 5; // 18% covers 24->42%, just under scene_generated
        const maxMicroProgress = Math.min(microProgressAccumulator, maxMicroProgressCap);
        const displayPercent = Math.min(lastEmittedPercent + maxMicroProgress, 54); // Don't exceed pre-launch phase (55%)

        // Rotate through engaging messages
        const message = heartbeatMessages[heartbeatMessageIndex % heartbeatMessages.length];
        heartbeatMessageIndex++;

        // CRITICAL FIX: Use broadcastToRoom so all clients in session receive heartbeat
        // FIX Bug 1: Include startTime so client can calculate elapsed time on refresh
        broadcastToRoom(session_id, 'generating', {
          step: Math.ceil(lastEmittedPercent / 10),
          percent: Math.round(displayPercent * 10) / 10, // Round to 1 decimal
          message,
          elapsed: elapsedDisplay,
          isHeartbeat: true,
          startTime: generationStartTime // Server timestamp - survives page refresh
        });
      }, 10000);

      // RACE CONDITION FIX: Clear interval if socket disconnects during async operations
      // Without this, the interval continues firing indefinitely after disconnect
      cleanupOnDisconnect = () => {
        clearInterval(progressHeartbeat);
        logger.debug(`[Socket] Cleaned up progressHeartbeat on disconnect | session_id: ${session_id}`);
      };
      socket.once('disconnect', cleanupOnDisconnect);

      // Progress callback for orchestrator (scene generation phase)
      // Story generation completes at 55%, then launch sequence handles 55-100%
      // Launch sequence includes: voices, sfx, cover, qa, and AUDIO synthesis
      orchestrator.onProgress = (phase, detail) => {
        const phases = {
          // Phase 1: Context Loading (0-12%)
          loading: { step: 1, percent: 8, message: 'Loading story context...' },
          context_loaded: { step: 1, percent: 12, message: 'Context loaded successfully' },

          // Phase 2: Intent Analysis (12-18%)
          analyzing_intent: { step: 2, percent: 16, message: 'Analyzing story intent...' },

          // Phase 3: Scene Generation (18-42%) - LONGEST PHASE
          planning: { step: 3, percent: 20, message: 'Planning next scene...' },
          generating: { step: 4, percent: 24, message: 'Writing story content...' },
          hybrid_generating: { step: 5, percent: 28, message: 'Generating with hybrid pipeline...' },
          // Scaffolding pipeline phases (mature content)
          scaffold_generating: { step: 4, percent: 26, message: 'Generating story structure...' },
          scaffold_expanding: { step: 5, percent: 32, message: 'Enhancing narrative content...' },
          scaffold_coherence: { step: 5, percent: 38, message: 'Polishing transitions...' },
          regenerating: { step: 5, percent: 35, message: 'Regenerating chapter...' },
          scene_generated: { step: 5, percent: 42, message: 'Scene text generated' },

          // Phase 4: Validation Agents (42-48%)
          validating: { step: 6, percent: 44, message: 'Running validation agents...' },
          validation_complete: { step: 6, percent: 48, message: 'Validation complete' },

          // Phase 5: Post-Processing (48-55%)
          polishing: { step: 7, percent: 50, message: 'Processing validation results...' },
          choices: { step: 8, percent: 52, message: 'Creating story choices...' },
          saving: { step: 9, percent: 54, message: 'Saving scene to database...' },

          // Phase 6: Ready for launch sequence (55% - handoff)
          validating_speakers: { step: 10, percent: 55, message: 'Preparing launch sequence...' }
        };

        // Use detail as custom message if phase not found
        const p = phases[phase] || { step: 5, percent: 45, message: detail || 'Processing...' };

        // Include detail in message if provided and different from default
        const message = detail && !p.message.includes(detail) ? `${p.message} - ${detail}` : p.message;
        // Bug 2 Fix: Pass phase name for phase-aware micro-progress
        emitProgress(p.step, p.percent, message, null, phase);
      };

      // Generate the scene content WITHOUT audio (deferAudio=true saves TTS tokens)
      const scene = await orchestrator.generateNextScene(voice_id, { deferAudio: true });

      emitProgress(11, 55, 'Preparing launch sequence...');

      // Create and run the launch sequence for sequential validation
      const launchManager = new LaunchSequenceManager(session_id, getBroadcastIO());

      // Check capacity before adding
      canAddToMap('activeLaunchSequences');
      activeLaunchSequences.set(session_id, launchManager);

      // Run sequential validation: voices -> sfx -> cover -> qa
      const launchResult = await launchManager.run(scene, voice_id);

      // Remove from active sequences
      activeLaunchSequences.delete(session_id);

      if (!launchResult || !launchResult.success) {
        clearInterval(progressHeartbeat);
        socket.off('disconnect', cleanupOnDisconnect);
        logger.warn(`[ContinueStory] Launch sequence failed or cancelled for session ${session_id}`);
        return;
      }

      clearInterval(progressHeartbeat);
      socket.off('disconnect', cleanupOnDisconnect);
      logger.info(`[Socket] CONTINUE_STORY_COMPLETE | session_id: ${session_id} | valid: ${launchResult.stats.isValid}`);

      // Mark generation as complete (keep for a bit for state queries)
      const progressData = generationProgress.get(session_id);
      if (progressData) {
        progressData.isGenerating = false;
        progressData.percent = 100;
        progressData.message = 'Complete';
        progressData.lastUpdate = Date.now();
      }

      // Store pending audio info - including pre-synthesized audio from launch sequence
      // This enables immediate playback without a second progress bar
      canAddToMap('pendingAudio');
      pendingAudio.set(session_id, {
        scene,
        voice_id,
        stats: launchResult.stats,
        timestamp: Date.now(),
        // Pre-synthesized audio from launch sequence (unified progress bar fix)
        audioDetails: launchResult.stageResults?.audio || null
      });

    } catch (error) {
      // Safely cleanup - variables may be null if error occurred before assignment
      if (progressHeartbeat) clearInterval(progressHeartbeat);
      if (cleanupOnDisconnect) socket.off('disconnect', cleanupOnDisconnect);
      logger.error(`[Socket] CONTINUE_STORY_ERROR | session_id: ${session_id} | error: ${error.message}`);
      activeLaunchSequences.delete(session_id);

      // Mark generation as failed
      const progressData = generationProgress.get(session_id);
      if (progressData) {
        progressData.isGenerating = false;
        progressData.message = 'Error: ' + (error.message || 'Unknown error');
        progressData.lastUpdate = Date.now();
      }

      if (error.message?.includes('CAPACITY EXCEEDED')) {
        socket.emit('error', { message: 'Server at capacity. Please try again later.' });
      } else {
        socket.emit('error', { message: 'Failed to generate next scene' });
      }
    }
  });

  // Submit CYOA choice
  socket.on('submit-choice', async (data) => {
    const { session_id, choice_id, choice_key } = data;
    logger.info(`[Socket:Recv] EVENT: submit-choice | socketId: ${socket.id} | session_id: ${session_id} | choice: ${choice_key || choice_id}`);

    if (!session_id) {
      socket.emit('error', { message: 'session_id is required' });
      return;
    }

    if (!choice_id && !choice_key) {
      socket.emit('error', { message: 'choice_id or choice_key is required' });
      return;
    }

    try {
      const user = await requireSessionOwner(socket, session_id);
      if (!user) return;

      const orchestrator = new Orchestrator(session_id);
      const result = await orchestrator.submitChoice(choice_id || choice_key);

      broadcastToRoom(session_id, 'choice-submitted', {
        session_id,
        choice: result.choice,
        next_scene_number: result.nextSceneNumber
      });

      logger.info(`[Socket] CHOICE_SUBMITTED | session_id: ${session_id} | choice: ${result.choice?.choice_key}`);

    } catch (error) {
      logger.error('Submit choice error:', error);
      socket.emit('error', { message: 'Failed to submit choice' });
    }
  });
}
