/**
 * Narrimo Server
 * Main Express server for the narrated storytelling application
 */

import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

import { pool, testConnection } from './database/pool.js';
import { logger } from './utils/logger.js';
import { runStartupChecks } from './utils/startupCheck.js';
import { setupSocketHandlers } from './socket/handlers.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { cache } from './services/cache.js';
import { authenticateSocketToken } from './middleware/auth.js';

// Routes
import healthRoutes from './routes/health.js';
import storiesRoutes from './routes/stories.js';
import voicesRoutes from './routes/voices.js';
import configRoutes from './routes/config.js';
import libraryRoutes from './routes/library.js';
import multiplayerRoutes from './routes/multiplayer.js';
import lorebookRoutes from './routes/lorebook.js';
import sfxRoutes from './routes/sfx.js';
import recordingsRoutes from './routes/recordings.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import paypalRoutes from './routes/paypal.js';
import templatesRoutes from './routes/templates.js';
import portraitsRoutes from './routes/portraits.js';
import sharingRoutes from './routes/sharing.js';
import streamingRoutes from './routes/streaming.js';
import continuationRoutes from './routes/continuation.js';
import analyticsRoutes from './routes/analytics.js';
import storyBibleRoutes from './routes/story-bible.js';
import testStoriesRoutes from './routes/testStories.js';
import scriptEditorRoutes from './routes/scriptEditor.js';
// DnD routes removed - migrated to GameMaster project (2026-01-08)

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 5100;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create Express app
const app = express();
const server = http.createServer(app);

// Trust proxy (required for rate limiting behind IIS)
app.set('trust proxy', 1);

// Socket.IO setup - listen on both /socket.io and /storyteller/socket.io for IIS compatibility
// SECURITY: Never use wildcard '*' for CORS - always use explicit allowed origins
const SOCKET_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost', 'http://localhost:5100'];
const socketOptions = {
  cors: {
    origin: SOCKET_ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true  // Required for withCredentials: true on client
  },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for audio
  pingTimeout: 60000,
  pingInterval: 25000,
  // Enable WebSocket compression for bandwidth savings
  perMessageDeflate: {
    threshold: 1024, // Only compress messages larger than 1KB
    zlibDeflateOptions: {
      chunkSize: 16 * 1024 // 16KB chunks
    },
    zlibInflateOptions: {
      chunkSize: 16 * 1024
    },
    clientNoContextTakeover: true, // Reduce memory usage
    serverNoContextTakeover: true
  }
};

// Primary socket path (direct access)
const io = new SocketIO(server, {
  path: '/socket.io',
  ...socketOptions
});

// Expose io globally for routes that need to emit events (e.g., story-bible.js)
global.io = io;

// Secondary socket path (IIS reverse proxy access)
const ioPrefixed = new SocketIO(server, {
  path: '/storyteller/socket.io',
  ...socketOptions
});

// Debug: Log all connection attempts
io.engine.on('connection', (rawSocket) => {
  logger.info(`[Socket:Primary] Raw connection from ${rawSocket.remoteAddress}`);
});
ioPrefixed.engine.on('connection', (rawSocket) => {
  logger.info(`[Socket:Prefixed] Raw connection from ${rawSocket.remoteAddress}`);
});
io.on('connection', (socket) => {
  logger.info(`[Socket:Primary] Connected: ${socket.id} from ${socket.handshake.address}`);
});
ioPrefixed.on('connection', (socket) => {
  logger.info(`[Socket:Prefixed] Connected: ${socket.id} from ${socket.handshake.address}`);
});

// =============================================================================
// SOCKET.IO CONNECTION RATE LIMITING
// =============================================================================

// Track connection attempts per IP
const connectionAttempts = new Map();
const CONNECTION_RATE_LIMIT = {
  maxConnections: 10,      // Max connections per IP per window
  windowMs: 60000,         // 1 minute window
  blockDurationMs: 300000  // 5 minute block after exceeding limit
};

function normalizeIp(rawIp) {
  if (!rawIp) return 'unknown';
  let ip = String(rawIp).trim();
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  // Normalize IPv4-mapped IPv6 format
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip || 'unknown';
}

/**
 * Socket.IO connection rate limiting middleware
 * Prevents DoS attacks by limiting connection attempts per IP
 */
function connectionRateLimiter(socket, next) {
  // SECURITY: prefer normalized handshake address; do not trust raw X-Forwarded-For headers here
  const clientIp = normalizeIp(socket.handshake.address || socket.conn?.remoteAddress || 'unknown');

  const now = Date.now();
  let record = connectionAttempts.get(clientIp);

  if (!record) {
    record = { attempts: [], blockedUntil: 0 };
    connectionAttempts.set(clientIp, record);
  }

  // Check if IP is currently blocked
  if (record.blockedUntil > now) {
    const remainingMs = record.blockedUntil - now;
    logger.warn(`[SocketRateLimit] Blocked connection from ${clientIp} (${Math.ceil(remainingMs / 1000)}s remaining)`);
    return next(new Error('Too many connections. Please try again later.'));
  }

  // Remove old attempts outside window
  record.attempts = record.attempts.filter(t => now - t < CONNECTION_RATE_LIMIT.windowMs);

  // Check rate limit
  if (record.attempts.length >= CONNECTION_RATE_LIMIT.maxConnections) {
    record.blockedUntil = now + CONNECTION_RATE_LIMIT.blockDurationMs;
    logger.warn(`[SocketRateLimit] Blocking ${clientIp} for ${CONNECTION_RATE_LIMIT.blockDurationMs / 1000}s (exceeded ${CONNECTION_RATE_LIMIT.maxConnections} connections)`);
    return next(new Error('Too many connections. Please try again later.'));
  }

  // Record this attempt
  record.attempts.push(now);
  next();
}

// Apply rate limiting to both socket instances
io.use(connectionRateLimiter);
ioPrefixed.use(connectionRateLimiter);

async function socketAuthMiddleware(socket, next) {
  try {
    const authHeader = socket.handshake.headers?.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const allowQueryToken = NODE_ENV === 'development' && process.env.ALLOW_SOCKET_QUERY_TOKEN === 'true';
    const token =
      headerToken ||
      socket.handshake.auth?.token ||
      (allowQueryToken ? socket.handshake.query?.token : null) ||
      null;

    socket.data.user = await authenticateSocketToken(token);
    return next();
  } catch (error) {
    logger.error('[SocketAuth] Error:', error);
    socket.data.user = null;
    return next();
  }
}

io.use(socketAuthMiddleware);
ioPrefixed.use(socketAuthMiddleware);

// Cleanup old connection records every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = CONNECTION_RATE_LIMIT.windowMs + CONNECTION_RATE_LIMIT.blockDurationMs;

  for (const [ip, record] of connectionAttempts) {
    // Remove if no recent attempts and not blocked
    if (record.attempts.length === 0 && record.blockedUntil < now) {
      connectionAttempts.delete(ip);
    } else {
      // Clean old attempts
      record.attempts = record.attempts.filter(t => now - t < maxAge);
    }
  }

  if (connectionAttempts.size > 0) {
    logger.debug(`[SocketRateLimit] Tracking ${connectionAttempts.size} IPs`);
  }
}, 5 * 60 * 1000);

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers - SECURITY: Enable proper protection
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://accounts.google.com", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http://localhost"],
      connectSrc: ["'self'", "https://api.openai.com", "https://api.elevenlabs.io", "https://api.venice.ai", "https://accounts.google.com", "wss:", "ws:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Required for Google OAuth popup
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  noSniff: true,
  xssFilter: true
}));

// CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Rate limiting with custom key generator for IIS proxy
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  // Use Express-trusted req.ip instead of raw proxy headers
  keyGenerator: (req) => {
    return normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
  },
  // Keep limiter validation aligned with express trust-proxy config
  validate: { xForwardedForHeader: true, trustProxy: true }
});
app.use('/api/', limiter);
app.use('/storyteller/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/') || req.path.startsWith('/storyteller/api/')) {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Cache control - prevent stale content issues
// HTML files: no-cache (always revalidate to get fresh asset hashes)
// Assets with hashes: long cache (Vite adds content hashes)
app.use((req, res, next) => {
  const path = req.path.toLowerCase();

  // No cache for HTML files - ensures fresh builds are served
  if (path === '/' || path.endsWith('.html') || path === '/storyteller' || path === '/storyteller/') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  // Long cache for hashed assets (Vite adds content hashes like main-abc123.js)
  // Fixed regex to match Vite's hash format with uppercase letters, underscores: index-B_Qu0yvC.js
  else if (path.match(/\.(js|css)$/) && path.match(/-[A-Za-z0-9_-]{8,}\./)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // Short cache for other static assets
  else if (path.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
    res.set('Cache-Control', 'public, max-age=86400'); // 1 day
  }

  next();
});

// Serve static files (mount at /storyteller to match vite base path)
app.use('/storyteller', express.static(join(__dirname, '..', 'public')));
// Also serve at root for direct access
app.use(express.static(join(__dirname, '..', 'public')));

// =============================================================================
// API ROUTES
// =============================================================================

// Mount routes at both /api/ and /storyteller/api/ for IIS reverse proxy compatibility
const apiRoutes = [
  ['health', healthRoutes],
  ['auth', authRoutes],
  ['admin', adminRoutes],
  ['paypal', paypalRoutes],
  ['stories', storiesRoutes],
  ['voices', voicesRoutes],
  ['config', configRoutes],
  ['library', libraryRoutes],
  ['multiplayer', multiplayerRoutes],
  ['lorebook', lorebookRoutes],
  ['sfx', sfxRoutes],
  ['recordings', recordingsRoutes],
  ['templates', templatesRoutes],
  ['portraits', portraitsRoutes],
  ['sharing', sharingRoutes],
  ['streaming', streamingRoutes],
  ['continuation', continuationRoutes],
  ['analytics', analyticsRoutes],
  ['story-bible', storyBibleRoutes],
  ['test-stories', testStoriesRoutes],
  ['script', scriptEditorRoutes]
  // DnD campaign/maps routes removed - migrated to GameMaster (2026-01-08)
];

// Mount at /api/ (direct access via localhost:5100)
apiRoutes.forEach(([path, router]) => app.use(`/api/${path}`, router));

// Mount at /storyteller/api/ (access via IIS reverse proxy)
apiRoutes.forEach(([path, router]) => app.use(`/storyteller/api/${path}`, router));

// =============================================================================
// SOCKET.IO HANDLERS
// =============================================================================

setupSocketHandlers(io, app);
setupSocketHandlers(ioPrefixed, app);  // Also handle prefixed socket path

// =============================================================================
// SPA FALLBACK
// =============================================================================

app.get('*', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/storyteller/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler for unmatched API routes
app.use('/api/', notFoundHandler);
app.use('/storyteller/api/', notFoundHandler);

// Centralized error handler
app.use(errorHandler);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer() {
  try {
    // ==========================================================================
    // PHASE 1: Startup Health Checks
    // ==========================================================================
    // Run comprehensive checks BEFORE starting the server.
    // This catches import errors, missing modules, and config issues early
    // so NSSM can detect failures and retry appropriately.
    // ==========================================================================

    logger.info('Running startup health checks...');

    const checkResult = await runStartupChecks({
      skipDatabase: false,  // We need database to be working
      verbose: NODE_ENV === 'development'
    });

    if (!checkResult.passed) {
      // Log all errors to both console and file
      logger.error('=================================================');
      logger.error('STARTUP HEALTH CHECK FAILED');
      logger.error('=================================================');

      for (const error of checkResult.errors) {
        logger.error(`[${error.category}] ${error.message}`);
      }

      logger.error('=================================================');
      logger.error('Server cannot start due to critical errors above.');
      logger.error('Fix the issues and restart the service.');
      logger.error('=================================================');

      // Exit with code 1 so NSSM knows to retry
      process.exit(1);
    }

    // Log warnings even if checks passed
    if (checkResult.warnings.length > 0) {
      logger.warn('Startup checks passed with warnings:');
      for (const warning of checkResult.warnings) {
        logger.warn(`  [${warning.category}] ${warning.message}`);
      }
    }

    logger.info(`Startup checks passed in ${checkResult.getDuration()}ms`);

    // ==========================================================================
    // PHASE 2: Start Express Server
    // ==========================================================================

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`=================================================`);
      logger.info(`Narrimo Server v1.0.0`);
      logger.info(`=================================================`);
      logger.info(`Environment: ${NODE_ENV}`);
      logger.info(`Port: ${PORT}`);
      logger.info(`URL: http://localhost:${PORT}`);
      logger.info(`API: http://localhost:${PORT}/api/health`);
      logger.info(`Startup checks: ${checkResult.details.modules.passed} modules, ${checkResult.details.agents.passed} agents`);
      logger.info(`=================================================`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await cache.close();
  await pool.end();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await cache.close();
  await pool.end();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();

export { app, io };
