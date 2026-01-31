/**
 * Audio Assembler Service
 *
 * Handles professional audio assembly for multi-voice narration:
 * - Crossfade transitions between speakers
 * - Gap insertion between segments
 * - SFX mixing and overlay
 * - Audio normalization
 *
 * Uses FFmpeg for audio processing when available,
 * falls back to simple concatenation otherwise.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';  // Keep sync for startup-only dir creation
import { writeFile, readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Secure spawn wrapper - prevents command injection by using argument arrays
 * @param {string} command - The command to run (e.g., 'ffmpeg', 'ffprobe')
 * @param {string[]} args - Array of arguments (NOT shell-interpolated)
 * @param {Object} options - spawn options (timeout, maxBuffer simulation via stdout collection)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 120000 } = options;

    const proc = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms: ${command}`));
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (killed) return;

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}\n${stderr}`);
        err.code = code;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const TEMP_DIR = process.env.AUDIO_TEMP_DIR || join(__dirname, '..', '..', 'temp', 'audio');
const OUTPUT_DIR = process.env.AUDIO_OUTPUT_DIR || join(__dirname, '..', '..', 'public', 'audio');

// Default crossfade settings
const DEFAULT_CROSSFADE_MS = 100; // 100ms crossfade between speakers
const DEFAULT_GAP_MS = 250; // 250ms gap between all speaker transitions (symmetric)
const DEFAULT_NARRATOR_GAP_MS = 250; // Same as character gap for natural rhythm

// Same-speaker settings
const SAME_SPEAKER_CROSSFADE_MS = 50; // 50ms mini-crossfade prevents clicks
const SAME_SPEAKER_GAP_MS = 150; // 150ms for natural speech rhythm

// Pre-crossfade buffer: add silence at end of each segment before crossfading
// Prevents dialog cutoff where crossfade "eats into" the last word
const PRE_CROSSFADE_BUFFER_MS = 50; // 50ms silence buffer before crossfade
const PRE_CROSSFADE_BUFFER_SEC = PRE_CROSSFADE_BUFFER_MS / 1000; // Seconds for FFmpeg

// DC offset removal filter - prevents clicks from waveform DC component mismatch between segments
const DC_REMOVAL_FILTER = 'highpass=f=30:poles=2';

// P1 FIX: Batch size for crossfade preservation (keep under 30 threshold)
const CROSSFADE_BATCH_SIZE = 25;
const BATCH_CROSSFADE_MS = 100; // Match intra-batch crossfade to prevent seams

// FFmpeg availability cache
let ffmpegAvailable = null;

// Ensure directories exist
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

/**
 * Escape file path for FFmpeg concat demuxer
 * Converts backslashes to forward slashes and properly escapes single quotes
 * @param {string} filePath - The file path to escape
 * @returns {string} Escaped path suitable for FFmpeg concat file
 */
function escapeFFmpegPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

/**
 * Create concat file content from array of file paths
 * @param {string[]} files - Array of file paths
 * @returns {string} Concat file content
 */
function buildConcatFileContent(files) {
  return files.map(f => `file '${escapeFFmpegPath(f)}'`).join('\n');
}

/**
 * Check if FFmpeg is available
 * @returns {Promise<boolean>}
 */
export async function checkFFmpegAvailable() {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }

  try {
    await spawnAsync('ffmpeg', ['-version'], { timeout: 5000 });
    ffmpegAvailable = true;
    logger.info('[AudioAssembler] FFmpeg is available');
    return true;
  } catch (error) {
    ffmpegAvailable = false;
    logger.warn('[AudioAssembler] FFmpeg not available, using simple concatenation');
    return false;
  }
}

/**
 * Apply speed modifier to audio file using FFmpeg atempo filter
 *
 * Since ElevenLabs V3 doesn't support speed parameter, we apply speed
 * modification post-generation using FFmpeg's atempo filter.
 *
 * @param {string} inputPath - Path to input audio file
 * @param {number} speedModifier - Speed multiplier (0.5 to 2.0, 1.0 = no change)
 * @param {string} outputFormat - Output format (mp3, wav)
 * @returns {Promise<string>} Path to speed-modified audio file
 */
export async function applySpeedModifier(inputPath, speedModifier, outputFormat = 'mp3') {
  // Skip if speed is effectively unchanged (within 5% of 1.0)
  if (Math.abs(speedModifier - 1.0) < 0.05) {
    return inputPath;
  }

  const hasFFmpeg = await checkFFmpegAvailable();
  if (!hasFFmpeg) {
    logger.warn('[AudioAssembler] FFmpeg not available, cannot apply speed modifier');
    return inputPath;
  }

  // Clamp speed to valid FFmpeg atempo range (0.5 to 2.0)
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speedModifier));

  // For speeds outside single-atempo range, chain multiple atempo filters
  // atempo only accepts 0.5 to 2.0 range, so we chain for extreme values
  let atempoFilters = [];
  let remainingSpeed = clampedSpeed;

  while (remainingSpeed > 2.0) {
    atempoFilters.push('atempo=2.0');
    remainingSpeed /= 2.0;
  }
  while (remainingSpeed < 0.5) {
    atempoFilters.push('atempo=0.5');
    remainingSpeed /= 0.5;
  }
  atempoFilters.push(`atempo=${remainingSpeed.toFixed(3)}`);

  const filterString = atempoFilters.join(',');
  const sessionId = crypto.randomBytes(4).toString('hex');
  const outputPath = inputPath.replace(`.${outputFormat}`, `_speed_${sessionId}.${outputFormat}`);

  try {
    await spawnAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-af', filterString,
      '-c:a', outputFormat === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
      '-q:a', '2',
      outputPath
    ], { timeout: 30000 });

    logger.info(`[AudioAssembler] Speed modifier applied: ${speedModifier}x → ${clampedSpeed}x (filter: ${filterString})`);
    return outputPath;

  } catch (error) {
    logger.error(`[AudioAssembler] Speed modifier failed: ${error.message}`);
    return inputPath;
  }
}

/**
 * Apply speed modifiers to all segments that have voiceSpeedModifier set
 * This is called after audio generation but before assembly
 *
 * @param {Array} segments - Array of segments with audio and optional voiceSpeedModifier
 * @param {string} outputFormat - Output format
 * @returns {Promise<Array>} Segments with speed-modified audio paths
 */
export async function applySegmentSpeedModifiers(segments, outputFormat = 'mp3') {
  const modifiedSegments = [];

  for (const segment of segments) {
    if (segment.voiceSpeedModifier && segment.audio && typeof segment.audio === 'string') {
      // Only apply if speed differs from 1.0
      if (Math.abs(segment.voiceSpeedModifier - 1.0) >= 0.05) {
        const modifiedPath = await applySpeedModifier(
          segment.audio,
          segment.voiceSpeedModifier,
          outputFormat
        );
        modifiedSegments.push({ ...segment, audio: modifiedPath });
        continue;
      }
    }
    modifiedSegments.push(segment);
  }

  const modified = modifiedSegments.filter(s => s.voiceSpeedModifier && Math.abs(s.voiceSpeedModifier - 1.0) >= 0.05).length;
  if (modified > 0) {
    logger.info(`[AudioAssembler] Applied speed modifiers to ${modified} segments`);
  }

  return modifiedSegments;
}

/**
 * Assemble multi-voice audio segments with transitions
 *
 * @param {Array} segments - Array of audio segments
 * @param {Buffer|string} segments[].audio - Audio buffer or file path
 * @param {string} segments[].speaker - Speaker identifier
 * @param {string} segments[].type - Segment type ('narrator', 'character', 'sfx')
 * @param {number} segments[].duration - Optional duration in ms
 * @param {Object} options - Assembly options
 * @param {number} options.crossfadeMs - Crossfade duration in ms
 * @param {number} options.gapMs - Gap between different speakers
 * @param {boolean} options.normalize - Normalize audio levels
 * @param {string} options.outputFormat - Output format (mp3, wav)
 * @returns {Promise<Object>} { audio: Buffer, duration: number, outputPath: string }
 */
export async function assembleMultiVoiceAudio(segments, options = {}) {
  if (!segments || segments.length === 0) {
    throw new Error('No audio segments provided');
  }

  const {
    crossfadeMs = DEFAULT_CROSSFADE_MS,
    gapMs = DEFAULT_GAP_MS,
    narratorGapMs = DEFAULT_NARRATOR_GAP_MS,
    normalize = false,
    outputFormat = 'mp3'
  } = options;

  const hasFFmpeg = await checkFFmpegAvailable();

  if (hasFFmpeg && segments.length > 1) {
    return assembleWithFFmpeg(segments, {
      crossfadeMs,
      gapMs,
      narratorGapMs,
      normalize,
      outputFormat
    });
  }

  // Fallback to simple concatenation
  return assembleSimple(segments, outputFormat);
}

/**
 * Assemble audio using FFmpeg with crossfades
 *
 * For large numbers of segments (>30), uses a batch approach:
 * 1. Process segments in batches of 20
 * 2. Use concat demuxer (file list) for each batch
 * 3. Combine batches into final output
 *
 * This avoids Windows command line length limits (ENAMETOOLONG error).
 */
async function assembleWithFFmpeg(segments, options) {
  const {
    crossfadeMs,
    gapMs,
    narratorGapMs,
    normalize,
    outputFormat
  } = options;

  const sessionId = crypto.randomBytes(8).toString('hex');
  const tempFiles = [];
  const BATCH_SIZE = 20; // Process in batches to avoid command line length limits

  try {
    // Write audio segments to temp files, applying speed modifiers if present
    let speedModifiedCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      let tempPath = join(TEMP_DIR, `${sessionId}_segment_${i}.mp3`);

      if (Buffer.isBuffer(segment.audio)) {
        await writeFile(tempPath, segment.audio);
      } else if (typeof segment.audio === 'string' && existsSync(segment.audio)) {
        // Copy file reference
        const audioData = await readFile(segment.audio);
        await writeFile(tempPath, audioData);
      } else {
        throw new Error(`Invalid audio data for segment ${i}`);
      }

      // Apply speed modifier if present (from voiceDirectorAgent)
      if (segment.voiceSpeedModifier && Math.abs(segment.voiceSpeedModifier - 1.0) >= 0.05) {
        logger.debug(`[AudioAssembler] Segment ${i}: Applying speed modifier ${segment.voiceSpeedModifier.toFixed(2)}x`);
        tempPath = await applySpeedModifier(tempPath, segment.voiceSpeedModifier, 'mp3');
        speedModifiedCount++;
      }

      tempFiles.push(tempPath);
    }

    if (speedModifiedCount > 0) {
      logger.info(`[AudioAssembler] Applied speed modifiers to ${speedModifiedCount}/${segments.length} segments`);
    }

    const outputPath = join(OUTPUT_DIR, `${sessionId}_assembled.${outputFormat}`);

    // For many segments (>30), use batch processing with crossfade preservation
    // P1 FIX: Use assembleBatchWithCrossfades instead of simple concat
    // This prevents jarring audio transitions in long stories
    if (segments.length > 30) {
      logger.info(`[AudioAssembler] Using batch crossfade assembly for ${segments.length} segments`);
      return await assembleBatchWithCrossfades(tempFiles, segments, outputPath, sessionId, options);
    }

    // Build FFmpeg filter complex for crossfades (small segment count)
    const filterComplex = buildCrossfadeFilter(segments, tempFiles, {
      crossfadeMs,
      gapMs,
      narratorGapMs
    });

    // Build FFmpeg args array (secure - no shell interpolation)
    let ffmpegArgs;
    if (segments.length === 1) {
      // Single segment - apply subtle fade-in/fade-out to prevent clicks
      ffmpegArgs = [
        '-y', '-i', tempFiles[0],
        '-af', 'afade=t=in:d=0.015,areverse,afade=t=in:d=0.03,areverse',
        '-c:a', 'libmp3lame', '-q:a', '2', outputPath
      ];
    } else if (filterComplex) {
      // Multiple segments with crossfade - build input args array
      ffmpegArgs = ['-y'];
      for (const f of tempFiles) {
        ffmpegArgs.push('-i', f);
      }

      // FIX: Integrate loudnorm INTO filter_complex chain
      // -af (simple filter) cannot be used with -filter_complex (complex filter)
      let finalFilter = filterComplex;
      if (normalize) {
        // Change [out] to [pre_norm], then add loudnorm -> [out]
        finalFilter = filterComplex.replace(/\[out\]$/, '[pre_norm];[pre_norm]loudnorm=I=-16:TP=-1.5:LRA=11[out]');
        logger.info(`[AudioAssembler] Integrated loudnorm into filter_complex for ${segments.length} segments`);
      }

      ffmpegArgs.push(
        '-filter_complex', finalFilter,
        '-map', '[out]',
        '-c:a', 'libmp3lame', '-q:a', '2', outputPath
      );
    } else {
      // Simple concatenation using concat demuxer
      const concatList = join(TEMP_DIR, `${sessionId}_concat.txt`);
      await writeFile(concatList, buildConcatFileContent(tempFiles));
      tempFiles.push(concatList);

      ffmpegArgs = [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', concatList,
        '-c:a', 'libmp3lame', '-q:a', '2', outputPath
      ];
    }

    // Add normalization if requested (for non-filter-complex commands)
    if (normalize && !filterComplex) {
      // Insert -af before -c:a
      const codecIndex = ffmpegArgs.indexOf('-c:a');
      if (codecIndex !== -1) {
        ffmpegArgs.splice(codecIndex, 0, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
      }
    }

    logger.info(`[AudioAssembler] Running FFmpeg with ${ffmpegArgs.length} args for ${segments.length} segments`);

    await spawnAsync('ffmpeg', ffmpegArgs, { timeout: 60000 });

    // Read assembled audio
    const assembledAudio = await readFile(outputPath);

    // Get duration using ffprobe (secure spawn)
    let duration = 0;
    try {
      const { stdout } = await spawnAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        outputPath
      ], { timeout: 10000 });
      duration = parseFloat(stdout.trim()) * 1000; // Convert to ms
    } catch (e) {
      // Estimate duration from file size
      duration = estimateDuration(assembledAudio.length);
    }

    logger.info(`[AudioAssembler] Assembled ${segments.length} segments: ${assembledAudio.length} bytes, ${duration}ms`);

    return {
      audio: assembledAudio,
      duration,
      outputPath,
      method: 'ffmpeg_crossfade'
    };

  } finally {
    // Cleanup temp files (fire-and-forget, non-blocking)
    for (const tempFile of tempFiles) {
      if (existsSync(tempFile)) {
        unlink(tempFile).catch(e =>
          logger.debug('[AudioAssembler] Cleanup error (non-critical):', e.message)
        );
      }
    }
  }
}

/**
 * P1 FIX: Assemble many segments in batches while PRESERVING crossfades
 *
 * Process segments in smaller batches (25 each) with full crossfades,
 * then join the batch outputs with brief crossfades.
 * This prevents jarring transitions that occur with simple concat.
 *
 * @param {string[]} tempFiles - Array of temp file paths
 * @param {Object[]} segments - Original segment data (for speaker info)
 * @param {string} outputPath - Final output path
 * @param {string} sessionId - Session ID for temp file naming
 * @param {Object} options - Assembly options
 * @returns {Promise<Object>} Assembly result
 */
async function assembleBatchWithCrossfades(tempFiles, segments, outputPath, sessionId, options) {
  const { normalize, crossfadeMs = DEFAULT_CROSSFADE_MS, gapMs = DEFAULT_GAP_MS, narratorGapMs = DEFAULT_NARRATOR_GAP_MS } = options;
  const batchOutputs = [];
  const totalBatches = Math.ceil(segments.length / CROSSFADE_BATCH_SIZE);

  logger.info(`[AudioAssembler] BATCH_CROSSFADE | segments: ${segments.length} | batches: ${totalBatches} | batchSize: ${CROSSFADE_BATCH_SIZE}`);

  try {
    // Step 1: Process each batch with crossfades
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const startIdx = batchIdx * CROSSFADE_BATCH_SIZE;
      const endIdx = Math.min(startIdx + CROSSFADE_BATCH_SIZE, segments.length);
      const batchSegments = segments.slice(startIdx, endIdx);
      const batchTempFiles = tempFiles.slice(startIdx, endIdx);
      const batchOutputPath = join(TEMP_DIR, `${sessionId}_batch_${batchIdx}.mp3`);

      logger.info(`[AudioAssembler] BATCH_CROSSFADE | batch ${batchIdx + 1}/${totalBatches} | segments ${startIdx}-${endIdx - 1} (${batchSegments.length})`);

      // Build crossfade filter for this batch
      const filterComplex = buildCrossfadeFilter(batchSegments, batchTempFiles, {
        crossfadeMs, gapMs, narratorGapMs
      });

      // Build FFmpeg args for this batch
      let ffmpegArgs = ['-y'];
      for (const f of batchTempFiles) {
        ffmpegArgs.push('-i', f);
      }

      if (filterComplex && batchSegments.length > 1) {
        ffmpegArgs.push(
          '-filter_complex', filterComplex,
          '-map', '[out]',
          '-c:a', 'libmp3lame', '-q:a', '2', batchOutputPath
        );
      } else {
        // Single segment batch - just copy with subtle fade
        ffmpegArgs = [
          '-y', '-i', batchTempFiles[0],
          '-af', 'afade=t=in:d=0.015,areverse,afade=t=in:d=0.03,areverse',
          '-c:a', 'libmp3lame', '-q:a', '2', batchOutputPath
        ];
      }

      // Process batch
      const batchTimeout = 30000 + (batchSegments.length * 500);
      await spawnAsync('ffmpeg', ffmpegArgs, { timeout: batchTimeout });

      batchOutputs.push(batchOutputPath);
      logger.info(`[AudioAssembler] BATCH_CROSSFADE | batch ${batchIdx + 1} complete: ${batchOutputPath}`);
    }

    // Step 2: If only one batch, use it directly
    if (batchOutputs.length === 1) {
      const singleBatch = await readFile(batchOutputs[0]);
      await writeFile(outputPath, singleBatch);

      const duration = await getAudioDuration(outputPath);
      return {
        audio: singleBatch,
        duration,
        outputPath,
        method: 'batch_crossfade_single'
      };
    }

    // Step 3: Join batches with brief crossfades using acrossfade filter
    // This prevents jarring transitions between batches
    logger.info(`[AudioAssembler] BATCH_CROSSFADE | joining ${batchOutputs.length} batches with ${BATCH_CROSSFADE_MS}ms crossfades`);

    // Build join filter: chain acrossfade filters for each pair
    let joinArgs = ['-y'];
    for (const batchFile of batchOutputs) {
      joinArgs.push('-i', batchFile);
    }

    // Build acrossfade chain: [0][1]acrossfade -> [2]acrossfade -> ... -> [out]
    // FIX: If normalize is requested, integrate loudnorm INTO the filter_complex chain
    // because -af (simple filter) cannot be used with -filter_complex (complex filter)
    const normalizeSuffix = normalize ? ';[pre_norm]loudnorm=I=-16:TP=-1.5:LRA=11[out]' : '';
    const finalLabel = normalize ? 'pre_norm' : 'out';

    // FIX: Add pre-buffer to batch inputs before crossfade to prevent clicks at batch boundaries
    // Also apply DC removal at batch boundaries for consistency

    if (batchOutputs.length === 2) {
      // Simple case: two batches - add DC removal + buffers before crossfade
      const filterComplex = `[0]${DC_REMOVAL_FILTER},apad=pad_dur=${PRE_CROSSFADE_BUFFER_SEC}[b0];[1]${DC_REMOVAL_FILTER},apad=pad_dur=${PRE_CROSSFADE_BUFFER_SEC}[b1];` +
                           `[b0][b1]acrossfade=d=${BATCH_CROSSFADE_MS / 1000}:c1=tri:c2=tri[${finalLabel}]${normalizeSuffix}`;
      joinArgs.push(
        '-filter_complex', filterComplex,
        '-map', '[out]'
      );
    } else {
      // Multiple batches: add DC removal + buffers then chain acrossfades
      let filterChain = '';

      // First, add DC removal and buffer to all batch inputs
      for (let i = 0; i < batchOutputs.length; i++) {
        filterChain += `[${i}]${DC_REMOVAL_FILTER},apad=pad_dur=${PRE_CROSSFADE_BUFFER_SEC}[b${i}];`;
      }

      // Then chain acrossfades using buffered inputs
      let lastLabel = 'b0';

      for (let i = 1; i < batchOutputs.length; i++) {
        // Last acrossfade outputs to finalLabel (either 'out' or 'pre_norm' for normalization)
        const outputLabel = i === batchOutputs.length - 1 ? finalLabel : `v${i}`;
        filterChain += `[${lastLabel}][b${i}]acrossfade=d=${BATCH_CROSSFADE_MS / 1000}:c1=tri:c2=tri[${outputLabel}]`;
        if (i < batchOutputs.length - 1) filterChain += ';';
        lastLabel = outputLabel;
      }

      // Append normalization to filter chain if requested
      filterChain += normalizeSuffix;

      joinArgs.push(
        '-filter_complex', filterChain,
        '-map', '[out]'
      );
    }

    joinArgs.push('-c:a', 'libmp3lame', '-q:a', '2', outputPath);

    const joinTimeout = 60000 + (batchOutputs.length * 10000);
    await spawnAsync('ffmpeg', joinArgs, { timeout: joinTimeout });

    // Read final result
    const assembledAudio = await readFile(outputPath);
    const duration = await getAudioDuration(outputPath);

    logger.info(`[AudioAssembler] BATCH_CROSSFADE complete: ${assembledAudio.length} bytes, ${Math.round(duration / 1000)}s, ${segments.length} segments via ${batchOutputs.length} batches`);

    return {
      audio: assembledAudio,
      duration,
      outputPath,
      method: 'batch_crossfade'
    };

  } finally {
    // Cleanup batch temp files (fire-and-forget, non-blocking)
    for (const batchFile of batchOutputs) {
      if (existsSync(batchFile)) {
        unlink(batchFile).catch(e =>
          logger.debug('[AudioAssembler] Batch cleanup error:', e.message)
        );
      }
    }
  }
}

// getAudioDuration is defined later with full Buffer/path support (line ~945)

/**
 * Build FFmpeg filter complex string for crossfades
 * Includes pre-crossfade buffer to prevent dialog cutoff
 */
function buildCrossfadeFilter(segments, tempFiles, options) {
  const { crossfadeMs, gapMs, narratorGapMs } = options;

  if (segments.length <= 1) {
    return null;
  }

  // For simplicity with many segments, use concat with gaps
  // Full crossfade filter is complex and can fail with many inputs
  if (segments.length > 5) {
    return buildSimpleConcatFilter(segments, tempFiles, options);
  }

  // Build crossfade filter for up to 5 segments
  const crossfadeDuration = crossfadeMs / 1000;
  const preCrossfadeBuffer = PRE_CROSSFADE_BUFFER_MS / 1000;
  const filters = [];

  // Step 1: Add DC offset removal + pre-crossfade silence buffer to ALL segments
  // DC offset removal (highpass at 30Hz) prevents clicks from DC component mismatch
  // Pre-crossfade buffer prevents dialog cutoff where crossfade "eats into" the last word
  // FIX: Apply symmetric buffer to last segment too for clean ending
  for (let i = 0; i < segments.length; i++) {
    // Chain: DC offset removal -> silence buffer
    // This removes sub-bass DC component that causes clicks, then adds buffer for crossfade
    filters.push(`[${i}:a]${DC_REMOVAL_FILTER},apad=pad_dur=${preCrossfadeBuffer}[p${i}]`);
  }

  // Step 2: Chain crossfades using padded segments
  let lastOutput = '[p0]';

  for (let i = 1; i < segments.length; i++) {
    const prevSegment = segments[i - 1];
    const currentSegment = segments[i];

    // Determine transition type
    const isSameSpeaker = prevSegment.speaker === currentSegment.speaker;
    const isNarratorTransition = prevSegment.type === 'narrator' || currentSegment.type === 'narrator';

    const outputLabel = i === segments.length - 1 ? 'out' : `a${i}`;

    // P1 FIX: Always use crossfade to prevent click artifacts
    // - Different speakers: full crossfade (100ms)
    // - Same speaker: mini-crossfade (50ms) to prevent clicks without losing words
    const effectiveCrossfade = isSameSpeaker
      ? SAME_SPEAKER_CROSSFADE_MS / 1000
      : crossfadeDuration;

    if (effectiveCrossfade > 0) {
      // Apply crossfade to padded segments (crossfade happens in buffer, not speech)
      filters.push(`${lastOutput}[p${i}]acrossfade=d=${effectiveCrossfade}:c1=tri:c2=tri[${outputLabel}]`);
    } else {
      // Fallback to concat only if crossfade is explicitly disabled
      filters.push(`${lastOutput}[p${i}]concat=n=2:v=0:a=1[${outputLabel}]`);
    }

    lastOutput = `[${outputLabel}]`;
  }

  // Return filter without -map (it's added separately in command construction)
  if (filters.length > 0) {
    return filters.join(';');
  }

  return null;
}

/**
 * Build simple concat filter for many segments with proper gap insertion
 * Uses apad filter to add silence after each segment for smooth transitions
 */
function buildSimpleConcatFilter(segments, tempFiles, options) {
  // Use symmetric gap timing from constants (250ms for both)
  const { gapMs = DEFAULT_GAP_MS, narratorGapMs = DEFAULT_NARRATOR_GAP_MS } = options;

  if (tempFiles.length === 1) {
    // Single segment: apply DC offset removal + minimal trailing silence for clean output
    return `[0:a]${DC_REMOVAL_FILTER},apad=pad_dur=${PRE_CROSSFADE_BUFFER_SEC}[out]`;
  }

  const filters = [];
  const outputLabels = [];

  // For each segment, apply appropriate gap padding
  // Use apad to add silence at the end of each segment (except the last)
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    const outputLabel = `a${i}`;

    if (isLast) {
      // FIX: Last segment gets DC removal + minimal trailing silence for clean ending
      // DC removal prevents clicks, 50ms buffer prevents abrupt cutoff
      filters.push(`[${i}:a]${DC_REMOVAL_FILTER},apad=pad_dur=${PRE_CROSSFADE_BUFFER_SEC}[${outputLabel}]`);
    } else {
      // Determine gap duration based on segment type and next segment
      const nextSegment = segments[i + 1];
      const isNarratorTransition = segment.type === 'narrator' || nextSegment?.type === 'narrator';
      const isSameSpeaker = segment.speaker && segment.speaker === nextSegment?.speaker;

      // Gap logic:
      // - Same speaker: 150ms for natural speech rhythm (prevents words running together)
      // - Narrator transition: same as other transitions for symmetric rhythm
      // - Different character speakers: standard gap (gapMs)
      let gapDuration;
      if (isSameSpeaker) {
        gapDuration = SAME_SPEAKER_GAP_MS / 1000; // 150ms for same speaker continuity
      } else if (isNarratorTransition) {
        gapDuration = narratorGapMs / 1000;
      } else {
        gapDuration = gapMs / 1000;
      }

      // Chain: DC offset removal -> gap padding
      // DC removal prevents clicks from waveform discontinuities between segments
      filters.push(`[${i}:a]${DC_REMOVAL_FILTER},apad=pad_dur=${gapDuration}[${outputLabel}]`);
    }

    outputLabels.push(`[${outputLabel}]`);
  }

  // Concat all padded segments
  const concatFilter = `${outputLabels.join('')}concat=n=${tempFiles.length}:v=0:a=1[out]`;
  filters.push(concatFilter);

  const filterComplex = filters.join(';');
  logger.debug(`[AudioAssembler] Built gap-aware filter for ${segments.length} segments with gapMs=${gapMs}, narratorGapMs=${narratorGapMs}`);

  return filterComplex;
}

/**
 * Simple concatenation fallback - tries FFmpeg fade when available
 */
async function assembleSimple(segments, outputFormat) {
  logger.info(`[AudioAssembler] Using simple concatenation for ${segments.length} segments`);

  const audioBuffers = [];

  for (const segment of segments) {
    if (Buffer.isBuffer(segment.audio)) {
      audioBuffers.push(segment.audio);
    } else if (typeof segment.audio === 'string' && existsSync(segment.audio)) {
      audioBuffers.push(await readFile(segment.audio));
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('No valid audio data found');
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const outputPath = join(OUTPUT_DIR, `${sessionId}_assembled.${outputFormat}`);

  // Try to use FFmpeg for fade to prevent clicking
  const hasFFmpeg = await checkFFmpegAvailable();

  if (hasFFmpeg) {
    const tempFiles = [];
    try {
      // Write buffers to temp files
      for (let i = 0; i < audioBuffers.length; i++) {
        const tempPath = join(TEMP_DIR, `${sessionId}_simple_${i}.mp3`);
        await writeFile(tempPath, audioBuffers[i]);
        tempFiles.push(tempPath);
      }

      // Create concat list with proper path escaping
      const concatList = join(TEMP_DIR, `${sessionId}_simple_concat.txt`);
      await writeFile(concatList, buildConcatFileContent(tempFiles));
      tempFiles.push(concatList);

      // Concatenate with fade-in/fade-out to prevent clicks (secure spawn)
      await spawnAsync('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', concatList,
        '-af', 'afade=t=in:d=0.015,areverse,afade=t=in:d=0.03,areverse',
        '-c:a', 'libmp3lame', '-q:a', '2', outputPath
      ], { timeout: 60000 });

      const assembledAudio = await readFile(outputPath);

      // Cleanup temp files (fire-and-forget, non-blocking)
      for (const tempFile of tempFiles) {
        if (existsSync(tempFile)) {
          unlink(tempFile).catch(() => { /* ignore */ });
        }
      }

      logger.info(`[AudioAssembler] Simple concat with fade: ${assembledAudio.length} bytes`);

      return {
        audio: assembledAudio,
        duration: estimateDuration(assembledAudio.length),
        outputPath,
        method: 'simple_concat_faded'
      };
    } catch (err) {
      // Cleanup temp files on error (fire-and-forget, non-blocking)
      for (const tempFile of tempFiles) {
        if (existsSync(tempFile)) {
          unlink(tempFile).catch(() => { /* ignore */ });
        }
      }
      // FAIL-LOUD: FFmpeg failures should not silently degrade to clicking audio
      logger.error(`[AudioAssembler] FFmpeg fade failed: ${err.message}`);
      throw new Error(`Audio assembly failed - FFmpeg required: ${err.message}`);
    }
  }

  // FAIL-LOUD: Don't use raw buffer concat - it causes audio artifacts
  logger.error('[AudioAssembler] FFmpeg not available and audio assembly required');
  throw new Error('Audio assembly requires FFmpeg - raw concatenation causes audio artifacts');
}

/**
 * Estimate audio duration from file size
 * Assumes MP3 at ~128kbps
 */
function estimateDuration(bytes) {
  const bitrate = 128000; // 128 kbps
  const bytesPerSecond = bitrate / 8;
  return (bytes / bytesPerSecond) * 1000; // ms
}

/**
 * Add silence/gap between audio segments
 *
 * @param {Buffer} audio - Audio buffer
 * @param {number} gapMs - Gap duration in milliseconds
 * @returns {Promise<Buffer>} Audio with trailing silence
 */
export async function addSilence(audio, gapMs) {
  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg || gapMs <= 0) {
    return audio;
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const inputPath = join(TEMP_DIR, `${sessionId}_input.mp3`);
  const outputPath = join(TEMP_DIR, `${sessionId}_output.mp3`);

  try {
    await writeFile(inputPath, audio);

    // Use FFmpeg to add silence (secure spawn)
    const silenceDuration = gapMs / 1000;
    await spawnAsync('ffmpeg', [
      '-y', '-i', inputPath,
      '-af', `apad=pad_dur=${silenceDuration}`,
      '-c:a', 'libmp3lame', '-q:a', '2', outputPath
    ], { timeout: 30000 });

    return await readFile(outputPath);

  } finally {
    // Cleanup (fire-and-forget, non-blocking)
    [inputPath, outputPath].forEach(f => {
      if (existsSync(f)) {
        unlink(f).catch(e =>
          logger.debug('[AudioAssembler] addSilence cleanup error:', e.message)
        );
      }
    });
  }
}

/**
 * Mix SFX with narration audio
 *
 * @param {Buffer} narrationAudio - Main narration audio
 * @param {Array} sfxTracks - Array of SFX to mix
 * @param {Buffer} sfxTracks[].audio - SFX audio buffer
 * @param {number} sfxTracks[].startMs - Start time in ms
 * @param {number} sfxTracks[].volume - Volume (0-1)
 * @param {boolean} sfxTracks[].loop - Whether to loop
 * @returns {Promise<Buffer>} Mixed audio
 */
export async function mixWithSFX(narrationAudio, sfxTracks) {
  if (!sfxTracks || sfxTracks.length === 0) {
    return narrationAudio;
  }

  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg) {
    logger.warn('[AudioAssembler] FFmpeg not available, skipping SFX mixing');
    return narrationAudio;
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const mainPath = join(TEMP_DIR, `${sessionId}_main.mp3`);
  const outputPath = join(TEMP_DIR, `${sessionId}_mixed.mp3`);
  const sfxPaths = [];

  try {
    await writeFile(mainPath, narrationAudio);

    // Write SFX files
    for (let i = 0; i < sfxTracks.length; i++) {
      const sfxPath = join(TEMP_DIR, `${sessionId}_sfx_${i}.mp3`);
      await writeFile(sfxPath, sfxTracks[i].audio);
      sfxPaths.push(sfxPath);
    }

    // Build FFmpeg args array (secure - no shell interpolation)
    const ffmpegArgs = ['-y', '-i', mainPath];
    for (const sfxPath of sfxPaths) {
      ffmpegArgs.push('-i', sfxPath);
    }

    // Build amix filter with delays
    const filterParts = ['[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[main]'];

    for (let i = 0; i < sfxTracks.length; i++) {
      const sfx = sfxTracks[i];
      const delay = sfx.startMs || 0;
      const volume = sfx.volume || 0.5;

      filterParts.push(`[${i + 1}:a]adelay=${delay}|${delay},volume=${volume}[sfx${i}]`);
    }

    // Mix all tracks
    const mixInputs = ['[main]', ...sfxTracks.map((_, i) => `[sfx${i}]`)].join('');
    filterParts.push(`${mixInputs}amix=inputs=${sfxTracks.length + 1}:duration=first:dropout_transition=2[out]`);

    const filter = filterParts.join(';');

    ffmpegArgs.push(
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'libmp3lame', '-q:a', '2', outputPath
    );

    await spawnAsync('ffmpeg', ffmpegArgs, { timeout: 120000 });

    return await readFile(outputPath);

  } finally {
    // Cleanup (fire-and-forget, non-blocking)
    [mainPath, outputPath, ...sfxPaths].forEach(f => {
      if (existsSync(f)) {
        unlink(f).catch(e =>
          logger.debug('[AudioAssembler] mixWithSFX cleanup error:', e.message)
        );
      }
    });
  }
}

/**
 * Normalize audio levels
 *
 * @param {Buffer} audio - Audio buffer
 * @param {number} targetLoudness - Target loudness in LUFS (default -16)
 * @returns {Promise<Buffer>} Normalized audio
 */
export async function normalizeAudio(audio, targetLoudness = -16) {
  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg) {
    return audio;
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const inputPath = join(TEMP_DIR, `${sessionId}_input.mp3`);
  const outputPath = join(TEMP_DIR, `${sessionId}_normalized.mp3`);

  try {
    await writeFile(inputPath, audio);

    // Secure spawn - no shell interpolation
    await spawnAsync('ffmpeg', [
      '-y', '-i', inputPath,
      '-af', `loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11`,
      '-c:a', 'libmp3lame', '-q:a', '2', outputPath
    ], { timeout: 60000 });

    return await readFile(outputPath);

  } finally {
    // Cleanup (fire-and-forget, non-blocking)
    [inputPath, outputPath].forEach(f => {
      if (existsSync(f)) {
        unlink(f).catch(e =>
          logger.debug('[AudioAssembler] normalizeAudio cleanup error:', e.message)
        );
      }
    });
  }
}

/**
 * Get audio duration using FFprobe
 *
 * @param {Buffer|string} audio - Audio buffer or file path
 * @returns {Promise<number>} Duration in milliseconds
 */
export async function getAudioDuration(audio) {
  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg) {
    if (Buffer.isBuffer(audio)) {
      return estimateDuration(audio.length);
    }
    return 0;
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  let tempPath = null;

  try {
    if (Buffer.isBuffer(audio)) {
      tempPath = join(TEMP_DIR, `${sessionId}_probe.mp3`);
      await writeFile(tempPath, audio);
    } else {
      tempPath = audio;
    }

    // Secure spawn - no shell interpolation
    const { stdout } = await spawnAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      tempPath
    ], { timeout: 10000 });

    return parseFloat(stdout.trim()) * 1000; // Convert to ms

  } catch (error) {
    logger.warn('[AudioAssembler] Failed to get duration:', error.message);
    if (Buffer.isBuffer(audio)) {
      return estimateDuration(audio.length);
    }
    return 0;

  } finally {
    // Cleanup (fire-and-forget, non-blocking)
    if (tempPath && Buffer.isBuffer(audio) && existsSync(tempPath)) {
      unlink(tempPath).catch(e =>
        logger.debug('[AudioAssembler] getAudioDuration cleanup error:', e.message)
      );
    }
  }
}

/**
 * Split audio at specific timestamps
 *
 * @param {Buffer} audio - Audio buffer
 * @param {Array<number>} splitPoints - Array of split points in ms
 * @returns {Promise<Array<Buffer>>} Array of audio segments
 */
export async function splitAudio(audio, splitPoints) {
  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg || splitPoints.length === 0) {
    return [audio];
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const inputPath = join(TEMP_DIR, `${sessionId}_split_input.mp3`);
  const segments = [];

  try {
    await writeFile(inputPath, audio);

    // Sort split points
    const points = [0, ...splitPoints.sort((a, b) => a - b)];

    for (let i = 0; i < points.length; i++) {
      const start = points[i] / 1000; // Convert to seconds
      const end = points[i + 1] ? points[i + 1] / 1000 : null;

      const outputPath = join(TEMP_DIR, `${sessionId}_split_${i}.mp3`);

      // Build FFmpeg args array (secure - no shell interpolation)
      const ffmpegArgs = ['-y', '-i', inputPath, '-ss', String(start)];
      if (end) {
        ffmpegArgs.push('-to', String(end));
      }
      ffmpegArgs.push('-c:a', 'libmp3lame', '-q:a', '2', outputPath);

      await spawnAsync('ffmpeg', ffmpegArgs, { timeout: 30000 });
      segments.push(await readFile(outputPath));

      // Cleanup segment output (fire-and-forget)
      unlink(outputPath).catch(e =>
        logger.debug('[AudioAssembler] splitAudio segment cleanup error:', e.message)
      );
    }

    return segments;

  } finally {
    // Cleanup input (fire-and-forget, non-blocking)
    if (existsSync(inputPath)) {
      unlink(inputPath).catch(e =>
        logger.debug('[AudioAssembler] splitAudio input cleanup error:', e.message)
      );
    }
  }
}

/**
 * Apply fade-in/fade-out to audio buffers to prevent clicking
 * @param {Array<Buffer>} audioBuffers - Array of audio buffers
 * @param {Object} options - { fadeInMs: 15, fadeOutMs: 30 }
 * @returns {Promise<Buffer>} Combined buffer with fades applied
 */
export async function applyFadeToBuffers(audioBuffers, options = {}) {
  const { fadeInMs = 15, fadeOutMs = 30 } = options;

  if (!audioBuffers || audioBuffers.length === 0) {
    throw new Error('No audio buffers provided');
  }

  const hasFFmpeg = await checkFFmpegAvailable();

  if (!hasFFmpeg) {
    logger.warn('[AudioAssembler] applyFadeToBuffers: No FFmpeg, returning raw concat');
    return Buffer.concat(audioBuffers);
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const tempFiles = [];

  try {
    // Write buffers to temp files
    for (let i = 0; i < audioBuffers.length; i++) {
      const tempPath = join(TEMP_DIR, `${sessionId}_fade_${i}.mp3`);
      await writeFile(tempPath, audioBuffers[i]);
      tempFiles.push(tempPath);
    }

    const outputPath = join(TEMP_DIR, `${sessionId}_faded_output.mp3`);

    // Create concat list with proper path escaping
    const concatList = join(TEMP_DIR, `${sessionId}_fade_concat.txt`);
    await writeFile(concatList, buildConcatFileContent(tempFiles));
    tempFiles.push(concatList);

    // Apply fade using areverse trick (secure spawn - no shell interpolation)
    const fadeInSec = fadeInMs / 1000;
    const fadeOutSec = fadeOutMs / 1000;
    await spawnAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', concatList,
      '-af', `afade=t=in:d=${fadeInSec},areverse,afade=t=in:d=${fadeOutSec},areverse`,
      '-c:a', 'libmp3lame', '-q:a', '2', outputPath
    ], { timeout: 60000 });

    const fadedAudio = await readFile(outputPath);
    tempFiles.push(outputPath);

    logger.info(`[AudioAssembler] Applied fade to ${audioBuffers.length} buffers: ${fadedAudio.length} bytes`);

    return fadedAudio;

  } finally {
    // Cleanup temp files (fire-and-forget, non-blocking)
    for (const tempFile of tempFiles) {
      if (existsSync(tempFile)) {
        unlink(tempFile).catch(() => { /* ignore */ });
      }
    }
  }
}

/**
 * Assembly configuration presets
 */
export const ASSEMBLY_PRESETS = {
  // Smooth transitions for bedtime stories
  bedtime: {
    crossfadeMs: 200,
    gapMs: 400,
    narratorGapMs: 500,
    normalize: true
  },

  // Quick cuts for action/drama
  dramatic: {
    crossfadeMs: 50,
    gapMs: 150,
    narratorGapMs: 200,
    normalize: true
  },

  // Natural pacing for general narration
  natural: {
    crossfadeMs: 100,
    gapMs: 250,
    narratorGapMs: 350,
    normalize: true
  },

  // No transitions (testing/debug)
  raw: {
    crossfadeMs: 0,
    gapMs: 0,
    narratorGapMs: 0,
    normalize: false
  }
};

export default {
  assembleMultiVoiceAudio,
  applyFadeToBuffers,
  addSilence,
  mixWithSFX,
  normalizeAudio,
  getAudioDuration,
  splitAudio,
  checkFFmpegAvailable,
  ASSEMBLY_PRESETS
};
