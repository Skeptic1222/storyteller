/**
 * Image Compositor Service
 *
 * Composites character images (with transparent backgrounds) onto scene backgrounds
 * using the Sharp library for high-quality image processing.
 *
 * Workflow:
 * 1. Generate character portrait (DALL-E or FalAI)
 * 2. Remove background (FalAI Bria RMBG)
 * 3. Generate scene background (DALL-E)
 * 4. Composite character onto background (Sharp)
 *
 * Features:
 * - Position presets for common character placements
 * - Multi-character compositing
 * - Automatic scaling based on position
 * - Shadow/glow effects for depth
 */

import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import * as dns from 'node:dns/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory for composited images
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'portraits');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB safety cap
const REMOTE_FETCH_TIMEOUT_MS = 10000;
const MAX_REMOTE_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_REMOTE_HOSTS = new Set(
  (process.env.IMAGE_COMPOSITOR_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
);
const DEFAULT_NETWORK_DEPS = {
  fetch: (...args) => fetch(...args),
  dnsLookup: (hostname, options) => dns.lookup(hostname, options)
};
let networkDeps = { ...DEFAULT_NETWORK_DEPS };

/**
 * Position presets for character placement
 * Each position includes x/y offsets (as percentage of background) and scale
 */
const POSITION_PRESETS = {
  center: { x: 0.5, y: 0.5, scale: 0.6, anchor: 'center' },
  left: { x: 0.25, y: 0.55, scale: 0.55, anchor: 'center' },
  right: { x: 0.75, y: 0.55, scale: 0.55, anchor: 'center' },
  bottomCenter: { x: 0.5, y: 0.85, scale: 0.7, anchor: 'bottom' },
  bottomLeft: { x: 0.2, y: 0.85, scale: 0.6, anchor: 'bottom' },
  bottomRight: { x: 0.8, y: 0.85, scale: 0.6, anchor: 'bottom' },
  farLeft: { x: 0.1, y: 0.6, scale: 0.45, anchor: 'center' },
  farRight: { x: 0.9, y: 0.6, scale: 0.45, anchor: 'center' },
  foreground: { x: 0.5, y: 0.9, scale: 0.85, anchor: 'bottom' },
  background: { x: 0.5, y: 0.4, scale: 0.35, anchor: 'center' }
};

/**
 * Ensure output directory exists
 */
async function ensureOutputDir() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.error('[ImageCompositor] Failed to create output directory:', error);
    }
  }
}

/**
 * Load image from URL or local path
 * @param {string} imageSource - URL (https://) or local path
 * @returns {Promise<Buffer>} Image buffer
 */
function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;

  return isPrivateIpAddress(host);
}

function normalizeIpAddress(address) {
  const lower = address.toLowerCase().split('%')[0];
  if (lower.startsWith('::ffff:')) {
    return lower.slice(7);
  }
  return lower;
}

function isPrivateIpAddress(address) {
  const host = normalizeIpAddress(address);
  const ipVersion = net.isIP(host);
  if (ipVersion === 0) return false;

  if (ipVersion === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }

  if (ipVersion === 6) {
    if (host === '::') return true;
    if (host === '::1') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // ULA
    if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
      return true; // fe80::/10 link-local
    }
  }

  return false;
}

async function resolveHostAddresses(hostname) {
  try {
    const records = await networkDeps.dnsLookup(hostname, { all: true, verbatim: true });
    return records.map(record => normalizeIpAddress(record.address));
  } catch (error) {
    throw new Error(`Failed to resolve remote host "${hostname}": ${error.message}`);
  }
}

async function validateRemoteUrl(url) {
  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS image URLs are allowed');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Private/internal image hosts are not allowed');
  }
  if (ALLOWED_REMOTE_HOSTS.size > 0 && !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Remote host not allowed: ${url.hostname}`);
  }

  if (net.isIP(url.hostname) !== 0) {
    return;
  }

  const resolvedAddresses = await resolveHostAddresses(url.hostname);
  if (resolvedAddresses.length === 0) {
    throw new Error(`Failed to resolve remote host "${url.hostname}"`);
  }

  const blockedAddress = resolvedAddresses.find(isPrivateIpAddress);
  if (blockedAddress) {
    throw new Error(`Remote host resolves to private/internal address: ${blockedAddress}`);
  }
}

async function fetchWithTimeout(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    return await networkDeps.fetch(url.toString(), {
      signal: abort.signal,
      redirect: 'manual'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteImage(sourceUrl) {
  let currentUrl = sourceUrl;

  for (let redirectDepth = 0; redirectDepth <= MAX_REMOTE_REDIRECTS; redirectDepth++) {
    await validateRemoteUrl(currentUrl);

    const response = await fetchWithTimeout(currentUrl);
    if (REDIRECT_STATUS_CODES.has(response.status)) {
      if (redirectDepth === MAX_REMOTE_REDIRECTS) {
        throw new Error(`Too many redirects fetching image (${MAX_REMOTE_REDIRECTS})`);
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response missing Location header (${response.status})`);
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`Remote image too large (${contentLength} bytes)`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`Remote image too large (${buffer.length} bytes)`);
    }
    return buffer;
  }

  throw new Error('Too many redirects fetching image');
}

async function loadImage(imageSource) {
  if (typeof imageSource !== 'string' || imageSource.trim() === '') {
    throw new Error('imageSource must be a non-empty string');
  }

  const source = imageSource.trim();
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const url = new URL(source);
    return fetchRemoteImage(url);
  } else {
    // SECURITY: Local paths must resolve inside public/
    let localPath = source;
    if (source.startsWith('/storyteller/')) {
      localPath = path.join(PUBLIC_DIR, source.replace('/storyteller/', ''));
    } else if (source.startsWith('/')) {
      localPath = path.join(PUBLIC_DIR, source.slice(1));
    } else {
      localPath = path.join(PUBLIC_DIR, source);
    }

    const resolvedPath = path.resolve(localPath);
    const resolvedPublicDir = path.resolve(PUBLIC_DIR);
    if (resolvedPath !== resolvedPublicDir && !resolvedPath.startsWith(`${resolvedPublicDir}${path.sep}`)) {
      throw new Error('Local image path must be within public directory');
    }

    return fs.readFile(resolvedPath);
  }
}

/**
 * Calculate pixel position from percentage-based position
 */
function calculatePosition(bgWidth, bgHeight, charWidth, charHeight, position, anchor = 'center') {
  let x = Math.round(bgWidth * position.x);
  let y = Math.round(bgHeight * position.y);

  // Adjust for anchor point
  switch (anchor) {
    case 'center':
      x -= Math.round(charWidth / 2);
      y -= Math.round(charHeight / 2);
      break;
    case 'bottom':
      x -= Math.round(charWidth / 2);
      y -= charHeight;
      break;
    case 'top':
      x -= Math.round(charWidth / 2);
      break;
    // 'topLeft' is default - no adjustment needed
  }

  // Clamp to background bounds
  x = Math.max(0, Math.min(x, bgWidth - charWidth));
  y = Math.max(0, Math.min(y, bgHeight - charHeight));

  return { x, y };
}

/**
 * Add subtle drop shadow to character for depth
 */
async function addDropShadow(characterBuffer, blur = 10, opacity = 0.3) {
  const metadata = await sharp(characterBuffer).metadata();

  // Create shadow by blurring and tinting the alpha channel
  const shadow = await sharp(characterBuffer)
    .ensureAlpha()
    .modulate({ brightness: 0 }) // Make it black
    .blur(blur)
    .composite([{
      input: Buffer.from([0, 0, 0, Math.round(opacity * 255)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in'
    }])
    .toBuffer();

  return shadow;
}

/**
 * Composite a single character onto a background
 *
 * @param {Object} params
 * @param {string} params.backgroundUrl - URL or path to background image
 * @param {string} params.characterUrl - URL or path to character image (with transparency)
 * @param {string|Object} params.position - Position preset name or custom {x, y, scale}
 * @param {boolean} params.addShadow - Whether to add drop shadow (default: true)
 * @param {string} params.outputPath - Custom output path (optional)
 * @returns {Promise<Object>} Result with composited image URL
 */
async function compositeCharacterOnBackground(params) {
  const {
    backgroundUrl,
    characterUrl,
    position = 'center',
    addShadow = true,
    outputPath = null
  } = params;

  await ensureOutputDir();

  const startTime = Date.now();
  logger.info(`[ImageCompositor] Compositing character onto background`);
  logger.debug(`[ImageCompositor] Background: ${backgroundUrl}`);
  logger.debug(`[ImageCompositor] Character: ${characterUrl}`);

  try {
    // Load both images
    const [bgBuffer, charBuffer] = await Promise.all([
      loadImage(backgroundUrl),
      loadImage(characterUrl)
    ]);

    // Get metadata for both images
    const bgMeta = await sharp(bgBuffer).metadata();
    const charMeta = await sharp(charBuffer).metadata();

    // Get position config
    const posConfig = typeof position === 'string'
      ? POSITION_PRESETS[position] || POSITION_PRESETS.center
      : { ...POSITION_PRESETS.center, ...position };

    // Calculate character size after scaling
    const scaledWidth = Math.round(charMeta.width * posConfig.scale);
    const scaledHeight = Math.round(charMeta.height * posConfig.scale);

    // Resize character
    const resizedChar = await sharp(charBuffer)
      .resize(scaledWidth, scaledHeight, { fit: 'inside' })
      .toBuffer();

    // Calculate position
    const pos = calculatePosition(
      bgMeta.width,
      bgMeta.height,
      scaledWidth,
      scaledHeight,
      posConfig,
      posConfig.anchor
    );

    // Build composite layers
    const composites = [];

    // Add shadow layer if requested
    if (addShadow) {
      const shadowBuffer = await addDropShadow(resizedChar, 15, 0.25);
      composites.push({
        input: shadowBuffer,
        left: pos.x + 5, // Offset shadow slightly
        top: pos.y + 8
      });
    }

    // Add character layer
    composites.push({
      input: resizedChar,
      left: pos.x,
      top: pos.y
    });

    // Composite onto background
    const result = await sharp(bgBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    // Save to file
    const filename = outputPath || `composed_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const fullPath = outputPath || path.join(OUTPUT_DIR, filename);
    await fs.writeFile(fullPath, result);

    const publicPath = `/storyteller/portraits/${path.basename(fullPath)}`;
    const duration = Date.now() - startTime;

    logger.info(`[ImageCompositor] Composited image saved: ${publicPath} (${duration}ms)`);

    return {
      success: true,
      imageUrl: publicPath,
      width: bgMeta.width,
      height: bgMeta.height,
      duration,
      position: typeof position === 'string' ? position : 'custom'
    };

  } catch (error) {
    logger.error('[ImageCompositor] Compositing failed:', error);
    throw error;
  }
}

/**
 * Composite multiple characters onto a background
 *
 * @param {Object} params
 * @param {string} params.backgroundUrl - URL or path to background image
 * @param {Array} params.characters - Array of {url, position, scale?}
 * @param {boolean} params.addShadows - Whether to add drop shadows (default: true)
 * @returns {Promise<Object>} Result with composited image URL
 */
async function compositeMultipleCharacters(params) {
  const {
    backgroundUrl,
    characters = [],
    addShadows = true
  } = params;

  if (characters.length === 0) {
    throw new Error('At least one character required for compositing');
  }

  await ensureOutputDir();

  const startTime = Date.now();
  logger.info(`[ImageCompositor] Compositing ${characters.length} characters onto background`);

  try {
    // Load background
    const bgBuffer = await loadImage(backgroundUrl);
    const bgMeta = await sharp(bgBuffer).metadata();

    // Load all character images in parallel
    const charBuffers = await Promise.all(
      characters.map(char => loadImage(char.url))
    );

    // Build composite layers
    const composites = [];

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      const charBuffer = charBuffers[i];
      const charMeta = await sharp(charBuffer).metadata();

      // Get position config
      const posConfig = typeof char.position === 'string'
        ? POSITION_PRESETS[char.position] || POSITION_PRESETS.center
        : { ...POSITION_PRESETS.center, ...char.position };

      // Apply custom scale if provided
      const scale = char.scale || posConfig.scale;

      // Calculate character size after scaling
      const scaledWidth = Math.round(charMeta.width * scale);
      const scaledHeight = Math.round(charMeta.height * scale);

      // Resize character
      const resizedChar = await sharp(charBuffer)
        .resize(scaledWidth, scaledHeight, { fit: 'inside' })
        .toBuffer();

      // Calculate position
      const pos = calculatePosition(
        bgMeta.width,
        bgMeta.height,
        scaledWidth,
        scaledHeight,
        posConfig,
        posConfig.anchor
      );

      // Add shadow layer if requested
      if (addShadows) {
        const shadowBuffer = await addDropShadow(resizedChar, 15, 0.2);
        composites.push({
          input: shadowBuffer,
          left: pos.x + 5,
          top: pos.y + 8
        });
      }

      // Add character layer
      composites.push({
        input: resizedChar,
        left: pos.x,
        top: pos.y
      });
    }

    // Composite all layers onto background
    const result = await sharp(bgBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    // Save to file
    const filename = `composed_multi_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const fullPath = path.join(OUTPUT_DIR, filename);
    await fs.writeFile(fullPath, result);

    const publicPath = `/storyteller/portraits/${filename}`;
    const duration = Date.now() - startTime;

    logger.info(`[ImageCompositor] Multi-character image saved: ${publicPath} (${duration}ms)`);

    return {
      success: true,
      imageUrl: publicPath,
      width: bgMeta.width,
      height: bgMeta.height,
      characterCount: characters.length,
      duration
    };

  } catch (error) {
    logger.error('[ImageCompositor] Multi-character compositing failed:', error);
    throw error;
  }
}

/**
 * High-level function to compose a complete Picture Book scene
 *
 * @param {Object} params
 * @param {string} params.backgroundUrl - Scene background image URL
 * @param {Array} params.characters - Array of {url, position, name}
 * @param {string} params.sceneId - Scene identifier for caching
 * @param {string} params.kenBurnsEffect - Suggested Ken Burns effect for this scene
 * @returns {Promise<Object>} Complete scene composition result
 */
async function composeScene(params) {
  const {
    backgroundUrl,
    characters = [],
    sceneId = null,
    kenBurnsEffect = 'zoomIn'
  } = params;

  logger.info(`[ImageCompositor] Composing scene with ${characters.length} characters`);

  try {
    let result;

    if (characters.length === 0) {
      // Just return the background as-is
      result = {
        success: true,
        imageUrl: backgroundUrl,
        characterCount: 0,
        isBackgroundOnly: true
      };
    } else if (characters.length === 1) {
      result = await compositeCharacterOnBackground({
        backgroundUrl,
        characterUrl: characters[0].url,
        position: characters[0].position || 'center',
        addShadow: true
      });
    } else {
      result = await compositeMultipleCharacters({
        backgroundUrl,
        characters: characters.map(c => ({
          url: c.url,
          position: c.position || 'center',
          scale: c.scale
        })),
        addShadows: true
      });
    }

    return {
      ...result,
      sceneId,
      kenBurnsEffect,
      isComposited: characters.length > 0
    };

  } catch (error) {
    logger.error('[ImageCompositor] Scene composition failed:', error);
    throw error;
  }
}

/**
 * Get available position presets
 */
function getPositionPresets() {
  return Object.entries(POSITION_PRESETS).map(([name, config]) => ({
    name,
    description: getPositionDescription(name),
    ...config
  }));
}

function getPositionDescription(name) {
  const descriptions = {
    center: 'Centered in frame',
    left: 'Left side of frame',
    right: 'Right side of frame',
    bottomCenter: 'Bottom center, closer to viewer',
    bottomLeft: 'Bottom left corner',
    bottomRight: 'Bottom right corner',
    farLeft: 'Far left, smaller (background)',
    farRight: 'Far right, smaller (background)',
    foreground: 'Large, very close to viewer',
    background: 'Small, far in the background'
  };
  return descriptions[name] || name;
}

function setTestNetworkDeps(overrides = {}) {
  networkDeps = {
    fetch: typeof overrides.fetch === 'function' ? overrides.fetch : DEFAULT_NETWORK_DEPS.fetch,
    dnsLookup: typeof overrides.dnsLookup === 'function' ? overrides.dnsLookup : DEFAULT_NETWORK_DEPS.dnsLookup
  };
}

function resetTestNetworkDeps() {
  networkDeps = { ...DEFAULT_NETWORK_DEPS };
}

const __testInternals = {
  loadImage,
  validateRemoteUrl,
  isPrivateIpAddress,
  setTestNetworkDeps,
  resetTestNetworkDeps
};

export {
  compositeCharacterOnBackground,
  compositeMultipleCharacters,
  composeScene,
  getPositionPresets,
  POSITION_PRESETS,
  __testInternals
};

export default {
  compositeCharacterOnBackground,
  compositeMultipleCharacters,
  composeScene,
  getPositionPresets,
  POSITION_PRESETS
};
