/**
 * Recording Service
 * Handles story audio recording capture, storage, and playback management
 * Enables replay of stories without repeated API calls
 */

import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

// PERFORMANCE: Use async file operations to avoid blocking event loop
// Only sync ops used at startup (existsSync, mkdirSync) for initialization
const { writeFile, readFile, unlink } = fsPromises;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || join(__dirname, '..', '..', 'public', 'audio', 'recordings');

// Ensure recordings directory exists
if (!existsSync(RECORDINGS_DIR)) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export class RecordingService {
  constructor() {
    this.activeRecordings = new Map(); // sessionId -> recordingId
  }

  // ==========================================================================
  // RECORDING LIFECYCLE
  // ==========================================================================

  /**
   * Start a new recording for a story session
   * @param {string} sessionId - Story session ID
   * @param {object} options - Recording options
   * @returns {object} Recording info
   */
  async startRecording(sessionId, options = {}) {
    const {
      pathSignature = null,  // CYOA path like "A-B-C"
      voiceSnapshot = null,  // Voice settings to preserve
      title = null
    } = options;

    const pathHash = pathSignature ? this.hashPath(pathSignature) : null;

    try {
      // Check if recording already exists for this path
      const existing = await this.getRecordingByPath(sessionId, pathHash);
      if (existing && existing.is_complete) {
        logger.info(`Recording already exists for session ${sessionId}, path ${pathSignature}`);
        return { recording: existing, isExisting: true };
      }

      // Create session-specific directory
      const sessionDir = join(RECORDINGS_DIR, sessionId);
      if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true });
      }

      // Create or update recording entry
      const result = await pool.query(`
        INSERT INTO story_recordings (
          story_session_id, path_hash, choice_sequence, title,
          voice_snapshot, recording_state
        ) VALUES ($1, $2, $3, $4, $5, 'active')
        ON CONFLICT (story_session_id, path_hash)
        DO UPDATE SET
          recording_state = 'active',
          recording_started_at = NOW(),
          is_complete = false,
          interrupted_at_segment = NULL,
          updated_at = NOW()
        RETURNING *
      `, [
        sessionId,
        pathHash,
        pathSignature,
        title,
        voiceSnapshot ? JSON.stringify(voiceSnapshot) : null
      ]);

      const recording = result.rows[0];
      this.activeRecordings.set(sessionId, recording.id);

      logger.info(`Started recording ${recording.id} for session ${sessionId}`);

      return { recording, isExisting: false };

    } catch (error) {
      logger.error('Failed to start recording:', error);
      throw error;
    }
  }

  /**
   * Add a segment to an active recording
   * @param {string} recordingId - Recording ID
   * @param {object} segmentData - Segment data
   * @returns {object} Created segment
   */
  async addSegment(recordingId, segmentData) {
    const {
      sceneId,
      sequenceIndex,
      audioBuffer,
      audioUrl,
      wordTimings,
      sceneText,
      sceneSummary,
      imageUrl,
      visualTimeline,
      sfxData = [],
      choicesAtEnd = null,
      selectedChoiceKey = null,
      mood = null,
      chapterNumber = null,
      chapterTitle = null
    } = segmentData;

    try {
      // Calculate segment timing
      const durationSeconds = wordTimings?.total_duration_ms
        ? wordTimings.total_duration_ms / 1000
        : this.estimateDuration(sceneText);

      // Get current total duration for start time
      const durationResult = await pool.query(
        'SELECT COALESCE(SUM(duration_seconds), 0) as total FROM recording_segments WHERE recording_id = $1',
        [recordingId]
      );
      const startTimeSeconds = parseFloat(durationResult.rows[0].total);

      // Save audio file if buffer provided
      let finalAudioUrl = audioUrl;
      let fileChecksum = null;
      let fileSizeBytes = null;

      if (audioBuffer) {
        const recording = await this.getRecording(recordingId);
        const sessionDir = join(RECORDINGS_DIR, recording.story_session_id);
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }

        const audioHash = crypto.createHash('md5').update(audioBuffer).digest('hex');
        const filename = `segment_${sequenceIndex}_${audioHash}.mp3`;
        const filePath = join(sessionDir, filename);

        await writeFile(filePath, audioBuffer);
        fileChecksum = crypto.createHash('sha256').update(audioBuffer).digest('hex');
        fileSizeBytes = audioBuffer.length;
        finalAudioUrl = `/audio/recordings/${recording.story_session_id}/${filename}`;
      }

      // Insert segment
      const result = await pool.query(`
        INSERT INTO recording_segments (
          recording_id, scene_id, sequence_index,
          audio_url, audio_hash, file_checksum, file_size_bytes,
          start_time_seconds, duration_seconds,
          word_timings, scene_text, scene_summary,
          image_url, visual_timeline, sfx_data,
          choices_at_end, selected_choice_key,
          mood, chapter_number, chapter_title
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (recording_id, sequence_index)
        DO UPDATE SET
          audio_url = EXCLUDED.audio_url,
          word_timings = EXCLUDED.word_timings,
          scene_text = EXCLUDED.scene_text,
          sfx_data = EXCLUDED.sfx_data,
          choices_at_end = EXCLUDED.choices_at_end,
          selected_choice_key = EXCLUDED.selected_choice_key
        RETURNING *
      `, [
        recordingId,
        sceneId,
        sequenceIndex,
        finalAudioUrl,
        audioBuffer ? crypto.createHash('md5').update(audioBuffer).digest('hex') : null,
        fileChecksum,
        fileSizeBytes,
        startTimeSeconds,
        durationSeconds,
        wordTimings ? JSON.stringify(wordTimings) : null,
        sceneText,
        sceneSummary,
        imageUrl,
        visualTimeline ? JSON.stringify(visualTimeline) : null,
        JSON.stringify(sfxData),
        choicesAtEnd ? JSON.stringify(choicesAtEnd) : null,
        selectedChoiceKey,
        mood,
        chapterNumber,
        chapterTitle
      ]);

      logger.info(`Added segment ${sequenceIndex} to recording ${recordingId}`);

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to add segment:', error);
      throw error;
    }
  }

  /**
   * Add intro segment (title + synopsis narration) to a recording
   * Uses sequence_index -1 to place before scene 0
   * @param {string} recordingId - Recording ID
   * @param {object} introData - Intro segment data
   * @returns {object} Created segment
   */
  async addIntroSegment(recordingId, introData) {
    const {
      audioBuffer,
      title,
      synopsis,
      durationSeconds
    } = introData;

    try {
      // Save audio file
      let audioUrl = null;
      let fileChecksum = null;
      let fileSizeBytes = null;

      if (audioBuffer) {
        const recording = await this.getRecording(recordingId);
        const sessionDir = join(RECORDINGS_DIR, recording.story_session_id);
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }

        const audioHash = crypto.createHash('md5').update(audioBuffer).digest('hex');
        const filename = `intro_${audioHash}.mp3`;
        const filePath = join(sessionDir, filename);

        await writeFile(filePath, audioBuffer);
        fileChecksum = crypto.createHash('sha256').update(audioBuffer).digest('hex');
        fileSizeBytes = audioBuffer.length;
        audioUrl = `/audio/recordings/${recording.story_session_id}/${filename}`;
      }

      // Calculate duration if not provided
      const finalDuration = durationSeconds || this.estimateDuration(`${title} ${synopsis}`);

      // Build intro text: "Title. Synopsis. And now, our story begins."
      const introText = `${title}. ${synopsis}. And now, our story begins.`;

      // Insert intro segment with sequence_index -1 (before scene 0)
      const result = await pool.query(`
        INSERT INTO recording_segments (
          recording_id, scene_id, sequence_index,
          audio_url, audio_hash, file_checksum, file_size_bytes,
          start_time_seconds, duration_seconds,
          word_timings, scene_text, scene_summary,
          image_url, visual_timeline, sfx_data,
          choices_at_end, selected_choice_key,
          mood, chapter_number, chapter_title
        ) VALUES ($1, NULL, -1, $2, $3, $4, $5, 0, $6, NULL, $7, $8, NULL, NULL, '[]', NULL, NULL, 'introduction', 0, 'Introduction')
        ON CONFLICT (recording_id, sequence_index)
        DO UPDATE SET
          audio_url = EXCLUDED.audio_url,
          file_checksum = EXCLUDED.file_checksum,
          duration_seconds = EXCLUDED.duration_seconds,
          scene_text = EXCLUDED.scene_text,
          scene_summary = EXCLUDED.scene_summary
        RETURNING *
      `, [
        recordingId,
        audioUrl,
        audioBuffer ? crypto.createHash('md5').update(audioBuffer).digest('hex') : null,
        fileChecksum,
        fileSizeBytes,
        finalDuration,
        introText,
        `Title: ${title}` // Store title in summary for easy retrieval
      ]);

      logger.info(`Added intro segment to recording ${recordingId} (${fileSizeBytes} bytes, ${finalDuration}s)`);

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to add intro segment:', error);
      throw error;
    }
  }

  /**
   * Mark a recording as complete
   */
  async completeRecording(recordingId) {
    try {
      // Calculate overall checksum from all segments
      const segments = await this.getSegments(recordingId);
      const checksumData = segments.map(s => s.file_checksum || s.audio_url).join(':');
      const overallChecksum = crypto.createHash('sha256').update(checksumData).digest('hex');

      const result = await pool.query(`
        UPDATE story_recordings
        SET is_complete = true,
            recording_state = 'complete',
            recording_completed_at = NOW(),
            checksum = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [recordingId, overallChecksum]);

      // Clean up active recording tracking
      for (const [sessionId, recId] of this.activeRecordings) {
        if (recId === recordingId) {
          this.activeRecordings.delete(sessionId);
          break;
        }
      }

      logger.info(`Completed recording ${recordingId}`);

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to complete recording:', error);
      throw error;
    }
  }

  /**
   * Mark a recording as interrupted (for recovery)
   */
  async interruptRecording(recordingId, lastSegmentIndex, reason = 'browser_close') {
    try {
      const result = await pool.query(`
        UPDATE story_recordings
        SET recording_state = 'interrupted',
            interrupted_at_segment = $2,
            interrupt_reason = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [recordingId, lastSegmentIndex, reason]);

      logger.warn(`Recording ${recordingId} interrupted at segment ${lastSegmentIndex}: ${reason}`);

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to mark recording interrupted:', error);
      throw error;
    }
  }

  // ==========================================================================
  // RECORDING RETRIEVAL
  // ==========================================================================

  /**
   * Get a recording by ID
   */
  async getRecording(recordingId) {
    const result = await pool.query(
      'SELECT * FROM story_recordings WHERE id = $1',
      [recordingId]
    );
    return result.rows[0];
  }

  /**
   * Get a recording by session and path
   */
  async getRecordingByPath(sessionId, pathHash) {
    const result = await pool.query(`
      SELECT * FROM story_recordings
      WHERE story_session_id = $1
        AND (path_hash = $2 OR ($2 IS NULL AND path_hash IS NULL))
    `, [sessionId, pathHash]);
    return result.rows[0];
  }

  /**
   * Get all recordings for a session
   */
  async getSessionRecordings(sessionId) {
    const result = await pool.query(`
      SELECT * FROM story_recordings
      WHERE story_session_id = $1
      ORDER BY recording_started_at DESC
    `, [sessionId]);
    return result.rows;
  }

  /**
   * Get segments for a recording
   */
  async getSegments(recordingId) {
    const result = await pool.query(`
      SELECT * FROM recording_segments
      WHERE recording_id = $1
      ORDER BY sequence_index ASC
    `, [recordingId]);
    return result.rows;
  }

  /**
   * Get a specific segment
   */
  async getSegment(recordingId, sequenceIndex) {
    const result = await pool.query(`
      SELECT * FROM recording_segments
      WHERE recording_id = $1 AND sequence_index = $2
    `, [recordingId, sequenceIndex]);
    return result.rows[0];
  }

  // ==========================================================================
  // CYOA PATH MATCHING
  // ==========================================================================

  /**
   * Hash a choice path signature
   */
  hashPath(pathSignature) {
    if (!pathSignature) return null;
    return crypto.createHash('sha256').update(pathSignature).digest('hex');
  }

  /**
   * Build a path signature from choices
   */
  buildPathSignature(choices) {
    if (!choices || choices.length === 0) return null;
    return choices.map(c => c.choiceKey || c.key || c).join('-');
  }

  /**
   * Find the longest matching recorded path prefix
   * Used for CYOA to determine where playback can continue vs where new generation is needed
   */
  async findLongestMatchingPath(sessionId, targetChoices) {
    const targetPath = this.buildPathSignature(targetChoices);

    if (!targetPath) {
      // Linear story - find any complete recording
      const result = await pool.query(`
        SELECT * FROM story_recordings
        WHERE story_session_id = $1
          AND path_hash IS NULL
          AND is_complete = true
        LIMIT 1
      `, [sessionId]);

      return result.rows.length > 0 ? {
        hasMatch: true,
        matchedPath: null,
        matchedRecording: result.rows[0],
        isExactMatch: true,
        remainingChoices: []
      } : { hasMatch: false };
    }

    // For CYOA, use the database helper function
    const result = await pool.query(
      'SELECT * FROM find_longest_path_match($1, $2)',
      [sessionId, targetPath]
    );

    if (result.rows.length === 0 || !result.rows[0].recording_id) {
      return {
        hasMatch: false,
        targetPath,
        remainingChoices: targetChoices
      };
    }

    const match = result.rows[0];
    const matchedDepth = match.matched_depth || 0;

    // Get the full recording data
    const recordingResult = await pool.query(
      'SELECT * FROM story_recordings WHERE id = $1',
      [match.recording_id]
    );

    return {
      hasMatch: true,
      matchedPath: match.path_signature,
      matchedRecording: recordingResult.rows[0],
      matchedDepth,
      isExactMatch: match.is_exact_match,
      remainingChoices: targetChoices.slice(matchedDepth),
      divergencePoint: matchedDepth
    };
  }

  /**
   * Check if a specific choice from current position has a recording
   */
  async hasRecordingForChoice(sessionId, currentPath, choiceKey) {
    const result = await pool.query(
      'SELECT has_recording_for_choice($1, $2, $3) as has_recording',
      [sessionId, currentPath, choiceKey]
    );
    return result.rows[0]?.has_recording || false;
  }

  /**
   * Get available recorded paths from a divergence point
   */
  async getRecordedChoicesAt(sessionId, currentPath) {
    const pathPrefix = currentPath ? `${currentPath}-` : '';

    const result = await pool.query(`
      SELECT DISTINCT
        SUBSTRING(choice_sequence FROM $2) as next_choice,
        choice_sequence
      FROM story_recordings
      WHERE story_session_id = $1
        AND is_complete = true
        AND (
          ($3 = '' AND choice_sequence IS NOT NULL)
          OR choice_sequence LIKE $3 || '%'
        )
    `, [sessionId, pathPrefix.length + 1, pathPrefix]);

    // Extract just the next choice key from each path
    const choices = new Map();
    for (const row of result.rows) {
      const nextChoice = row.next_choice?.split('-')[0];
      if (nextChoice && !choices.has(nextChoice)) {
        choices.set(nextChoice, row.choice_sequence);
      }
    }

    return Object.fromEntries(choices);
  }

  // ==========================================================================
  // RECORDING VALIDATION
  // ==========================================================================

  /**
   * Validate a recording's integrity
   */
  async validateRecording(recordingId) {
    const segments = await this.getSegments(recordingId);
    const issues = [];

    for (const segment of segments) {
      const validation = await this.validateSegmentAudio(segment);
      if (!validation.valid) {
        issues.push({
          segmentIndex: segment.sequence_index,
          error: validation.error,
          audioUrl: segment.audio_url
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      segmentCount: segments.length,
      needsRepair: issues.length > 0
    };
  }

  /**
   * Validate a single segment's audio file
   */
  async validateSegmentAudio(segment) {
    if (!segment.audio_url) {
      return { valid: false, error: 'MISSING_URL' };
    }

    // Convert URL to file path
    const filePath = join(__dirname, '..', '..', 'public', segment.audio_url);

    if (!existsSync(filePath)) {
      return { valid: false, error: 'FILE_MISSING' };
    }

    // Verify checksum if available
    if (segment.file_checksum) {
      try {
        const fileBuffer = await readFile(filePath);
        const actualChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        if (actualChecksum !== segment.file_checksum) {
          return { valid: false, error: 'CHECKSUM_MISMATCH' };
        }
      } catch (error) {
        return { valid: false, error: 'READ_ERROR' };
      }
    }

    return { valid: true };
  }

  /**
   * Recover an interrupted recording
   */
  async recoverInterruptedRecording(sessionId) {
    const result = await pool.query(`
      SELECT * FROM story_recordings
      WHERE story_session_id = $1
        AND recording_state = 'interrupted'
      ORDER BY recording_started_at DESC
      LIMIT 1
    `, [sessionId]);

    if (result.rows.length === 0) {
      return { hasInterrupted: false };
    }

    const recording = result.rows[0];
    const segments = await this.getSegments(recording.id);
    const validation = await this.validateRecording(recording.id);

    return {
      hasInterrupted: true,
      recording,
      lastValidSegment: segments.length - 1,
      segmentCount: segments.length,
      validation,
      options: {
        resume: () => this.resumeRecording(recording.id),
        restart: () => this.deleteRecording(recording.id),
        playPartial: () => this.getSegments(recording.id)
      }
    };
  }

  /**
   * Resume an interrupted recording
   */
  async resumeRecording(recordingId) {
    const result = await pool.query(`
      UPDATE story_recordings
      SET recording_state = 'active',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [recordingId]);

    return result.rows[0];
  }

  // ==========================================================================
  // PLAYBACK TRACKING
  // ==========================================================================

  /**
   * Start a playback session
   */
  async startPlayback(recordingId, userId = null) {
    const result = await pool.query(`
      INSERT INTO playback_sessions (recording_id, user_id)
      VALUES ($1, $2)
      RETURNING *
    `, [recordingId, userId]);

    return result.rows[0];
  }

  /**
   * Update playback position
   */
  async updatePlaybackPosition(playbackId, segmentIndex, positionSeconds) {
    const result = await pool.query(`
      UPDATE playback_sessions
      SET current_segment_index = $2,
          current_position_seconds = $3,
          last_activity_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [playbackId, segmentIndex, positionSeconds]);

    return result.rows[0];
  }

  /**
   * Complete a playback session
   */
  async completePlayback(playbackId) {
    const result = await pool.query(`
      UPDATE playback_sessions
      SET completed_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [playbackId]);

    return result.rows[0];
  }

  /**
   * Update play statistics for a recording
   */
  async recordPlay(recordingId) {
    await pool.query(`
      UPDATE story_recordings
      SET play_count = play_count + 1,
          last_played_at = NOW()
      WHERE id = $1
    `, [recordingId]);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Estimate audio duration from text
   */
  estimateDuration(text) {
    if (!text) return 0;
    // ~150 words per minute, ~5 chars per word
    const estimatedWords = text.length / 5;
    return (estimatedWords / 150) * 60;
  }

  /**
   * Delete a recording and its files
   */
  async deleteRecording(recordingId) {
    try {
      // Get recording info first
      const recording = await this.getRecording(recordingId);
      if (!recording) return;

      // Get all segments to delete files
      const segments = await this.getSegments(recordingId);

      // Delete from database (cascades to segments)
      await pool.query('DELETE FROM story_recordings WHERE id = $1', [recordingId]);

      // Delete audio files (async to avoid blocking)
      for (const segment of segments) {
        if (segment.audio_url) {
          const filePath = join(__dirname, '..', '..', 'public', segment.audio_url);
          if (existsSync(filePath)) {
            try {
              await unlink(filePath);
            } catch (e) {
              logger.warn(`Failed to delete file: ${filePath}`);
            }
          }
        }
      }

      // Try to remove session directory if empty
      const sessionDir = join(RECORDINGS_DIR, recording.story_session_id);
      try {
        const { readdir, rmdir } = fsPromises;
        if (existsSync(sessionDir)) {
          const files = await readdir(sessionDir);
          if (files.length === 0) {
            await rmdir(sessionDir);
          }
        }
      } catch (e) {
        // Ignore - directory not empty or other error
      }

      logger.info(`Deleted recording ${recordingId}`);

    } catch (error) {
      logger.error('Failed to delete recording:', error);
      throw error;
    }
  }

  /**
   * Get active recording for a session
   */
  getActiveRecording(sessionId) {
    return this.activeRecordings.get(sessionId);
  }

  /**
   * Check if session is being recorded
   */
  isRecording(sessionId) {
    return this.activeRecordings.has(sessionId);
  }

  /**
   * Mark choice as having a recording
   */
  async updateChoiceRecordingStatus(recordingId, segmentIndex, choiceKey, hasRecording) {
    const segment = await this.getSegment(recordingId, segmentIndex);
    if (!segment) return;

    const currentStatus = segment.has_recording_for_choice || {};
    currentStatus[choiceKey] = hasRecording;

    await pool.query(`
      UPDATE recording_segments
      SET has_recording_for_choice = $2
      WHERE id = $1
    `, [segment.id, JSON.stringify(currentStatus)]);
  }
}

// Export singleton instance
export const recordingService = new RecordingService();
export default RecordingService;
