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

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const TEMP_DIR = process.env.AUDIO_TEMP_DIR || join(__dirname, '..', '..', 'temp', 'audio');
const OUTPUT_DIR = process.env.AUDIO_OUTPUT_DIR || join(__dirname, '..', '..', 'public', 'audio');

// Default crossfade settings
const DEFAULT_CROSSFADE_MS = 100; // 100ms crossfade between speakers
const DEFAULT_GAP_MS = 200; // 200ms gap between segments (no crossfade)
const DEFAULT_NARRATOR_GAP_MS = 300; // Longer gap after narrator segments

// FFmpeg availability cache
let ffmpegAvailable = null;

// Ensure directories exist
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

/**
 * Check if FFmpeg is available
 * @returns {Promise<boolean>}
 */
export async function checkFFmpegAvailable() {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }

  try {
    await execAsync('ffmpeg -version');
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

  try {
    // Write audio segments to temp files
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const tempPath = join(TEMP_DIR, `${sessionId}_segment_${i}.mp3`);

      if (Buffer.isBuffer(segment.audio)) {
        writeFileSync(tempPath, segment.audio);
      } else if (typeof segment.audio === 'string' && existsSync(segment.audio)) {
        // Copy file reference
        const audioData = readFileSync(segment.audio);
        writeFileSync(tempPath, audioData);
      } else {
        throw new Error(`Invalid audio data for segment ${i}`);
      }

      tempFiles.push(tempPath);
    }

    // Build FFmpeg filter complex for crossfades
    const outputPath = join(OUTPUT_DIR, `${sessionId}_assembled.${outputFormat}`);
    const filterComplex = buildCrossfadeFilter(segments, tempFiles, {
      crossfadeMs,
      gapMs,
      narratorGapMs
    });

    // Build FFmpeg command
    const inputArgs = tempFiles.map(f => `-i "${f}"`).join(' ');

    let ffmpegCmd;
    if (segments.length === 1) {
      // Single segment - just copy
      ffmpegCmd = `ffmpeg -y -i "${tempFiles[0]}" -c:a libmp3lame -q:a 2 "${outputPath}"`;
    } else if (filterComplex) {
      // Multiple segments with crossfade
      ffmpegCmd = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}" -c:a libmp3lame -q:a 2 "${outputPath}"`;
    } else {
      // Simple concatenation
      const concatList = join(TEMP_DIR, `${sessionId}_concat.txt`);
      const concatContent = tempFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      writeFileSync(concatList, concatContent);
      tempFiles.push(concatList);

      ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c:a libmp3lame -q:a 2 "${outputPath}"`;
    }

    // Add normalization if requested
    if (normalize && !filterComplex) {
      ffmpegCmd = ffmpegCmd.replace('-c:a libmp3lame', '-af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a libmp3lame');
    }

    logger.info(`[AudioAssembler] Running FFmpeg: ${ffmpegCmd.substring(0, 200)}...`);

    await execAsync(ffmpegCmd, { timeout: 60000 });

    // Read assembled audio
    const assembledAudio = readFileSync(outputPath);

    // Get duration using ffprobe
    let duration = 0;
    try {
      const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`);
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
    // Cleanup temp files
    for (const tempFile of tempFiles) {
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch (e) {
        logger.debug('[AudioAssembler] Cleanup error (non-critical):', e.message);
      }
    }
  }
}

/**
 * Build FFmpeg filter complex string for crossfades
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
  const filters = [];
  let lastOutput = '[0:a]';

  for (let i = 1; i < segments.length; i++) {
    const prevSegment = segments[i - 1];
    const currentSegment = segments[i];

    // Determine transition type
    const useCrossfade = prevSegment.speaker !== currentSegment.speaker;
    const isNarratorTransition = prevSegment.type === 'narrator' || currentSegment.type === 'narrator';

    const outputLabel = i === segments.length - 1 ? 'out' : `a${i}`;

    if (useCrossfade && crossfadeDuration > 0) {
      // Apply crossfade between different speakers
      filters.push(`${lastOutput}[${i}:a]acrossfade=d=${crossfadeDuration}:c1=tri:c2=tri[${outputLabel}]`);
    } else {
      // Simple concatenation
      filters.push(`${lastOutput}[${i}:a]concat=n=2:v=0:a=1[${outputLabel}]`);
    }

    lastOutput = `[${outputLabel}]`;
  }

  // Add output mapping
  if (filters.length > 0) {
    return filters.join(';') + ` -map "[out]"`;
  }

  return null;
}

/**
 * Build simple concat filter for many segments
 */
function buildSimpleConcatFilter(segments, tempFiles, options) {
  const inputLabels = tempFiles.map((_, i) => `[${i}:a]`).join('');
  return `${inputLabels}concat=n=${tempFiles.length}:v=0:a=1[out]" -map "[out]`;
}

/**
 * Simple concatenation fallback (no FFmpeg)
 */
async function assembleSimple(segments, outputFormat) {
  logger.info(`[AudioAssembler] Using simple concatenation for ${segments.length} segments`);

  const audioBuffers = [];

  for (const segment of segments) {
    if (Buffer.isBuffer(segment.audio)) {
      audioBuffers.push(segment.audio);
    } else if (typeof segment.audio === 'string' && existsSync(segment.audio)) {
      audioBuffers.push(readFileSync(segment.audio));
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('No valid audio data found');
  }

  // Simple buffer concatenation
  // Note: This may cause audio artifacts at segment boundaries
  const combinedBuffer = Buffer.concat(audioBuffers);

  // Save to output file
  const sessionId = crypto.randomBytes(8).toString('hex');
  const outputPath = join(OUTPUT_DIR, `${sessionId}_assembled.${outputFormat}`);
  writeFileSync(outputPath, combinedBuffer);

  return {
    audio: combinedBuffer,
    duration: estimateDuration(combinedBuffer.length),
    outputPath,
    method: 'simple_concat'
  };
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
    writeFileSync(inputPath, audio);

    // Use FFmpeg to add silence
    const silenceDuration = gapMs / 1000;
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -af "apad=pad_dur=${silenceDuration}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { timeout: 30000 }
    );

    return readFileSync(outputPath);

  } finally {
    [inputPath, outputPath].forEach(f => {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch (e) {
        logger.debug('[AudioAssembler] addSilence cleanup error:', e.message);
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
    writeFileSync(mainPath, narrationAudio);

    // Write SFX files
    for (let i = 0; i < sfxTracks.length; i++) {
      const sfxPath = join(TEMP_DIR, `${sessionId}_sfx_${i}.mp3`);
      writeFileSync(sfxPath, sfxTracks[i].audio);
      sfxPaths.push(sfxPath);
    }

    // Build FFmpeg filter for mixing
    const inputs = [`-i "${mainPath}"`, ...sfxPaths.map(p => `-i "${p}"`)].join(' ');

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

    await execAsync(
      `ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[out]" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { timeout: 120000 }
    );

    return readFileSync(outputPath);

  } finally {
    [mainPath, outputPath, ...sfxPaths].forEach(f => {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch (e) {
        logger.debug('[AudioAssembler] mixWithSFX cleanup error:', e.message);
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
    writeFileSync(inputPath, audio);

    await execAsync(
      `ffmpeg -y -i "${inputPath}" -af "loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { timeout: 60000 }
    );

    return readFileSync(outputPath);

  } finally {
    [inputPath, outputPath].forEach(f => {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch (e) {
        logger.debug('[AudioAssembler] normalizeAudio cleanup error:', e.message);
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
      writeFileSync(tempPath, audio);
    } else {
      tempPath = audio;
    }

    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempPath}"`,
      { timeout: 10000 }
    );

    return parseFloat(stdout.trim()) * 1000; // Convert to ms

  } catch (error) {
    logger.warn('[AudioAssembler] Failed to get duration:', error.message);
    if (Buffer.isBuffer(audio)) {
      return estimateDuration(audio.length);
    }
    return 0;

  } finally {
    if (tempPath && Buffer.isBuffer(audio)) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch (e) {
        logger.debug('[AudioAssembler] getAudioDuration cleanup error:', e.message);
      }
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
    writeFileSync(inputPath, audio);

    // Sort split points
    const points = [0, ...splitPoints.sort((a, b) => a - b)];

    for (let i = 0; i < points.length; i++) {
      const start = points[i] / 1000; // Convert to seconds
      const end = points[i + 1] ? points[i + 1] / 1000 : null;

      const outputPath = join(TEMP_DIR, `${sessionId}_split_${i}.mp3`);

      let cmd = `ffmpeg -y -i "${inputPath}" -ss ${start}`;
      if (end) {
        cmd += ` -to ${end}`;
      }
      cmd += ` -c:a libmp3lame -q:a 2 "${outputPath}"`;

      await execAsync(cmd, { timeout: 30000 });
      segments.push(readFileSync(outputPath));

      try {
        unlinkSync(outputPath);
      } catch (e) {
        logger.debug('[AudioAssembler] splitAudio segment cleanup error:', e.message);
      }
    }

    return segments;

  } finally {
    try {
      if (existsSync(inputPath)) unlinkSync(inputPath);
    } catch (e) {
      logger.debug('[AudioAssembler] splitAudio input cleanup error:', e.message);
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
  addSilence,
  mixWithSFX,
  normalizeAudio,
  getAudioDuration,
  splitAudio,
  checkFFmpegAvailable,
  ASSEMBLY_PRESETS
};
