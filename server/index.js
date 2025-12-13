/**
 * Storyteller Server
 * Main Express server for the bedtime storytelling application
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
const socketOptions = {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for audio
  pingTimeout: 60000,
  pingInterval: 25000
};

// Primary socket path (direct access)
const io = new SocketIO(server, {
  path: '/socket.io',
  ...socketOptions
});

// Secondary socket path (IIS reverse proxy access)
const ioPrefixed = new SocketIO(server, {
  path: '/storyteller/socket.io',
  ...socketOptions
});

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
  crossOriginEmbedderPolicy: false
}));

// CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
};
app.use(cors(corsOptions));

// Rate limiting with custom key generator for IIS proxy
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  // Custom key generator to handle IIS proxy IP:port format
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip || req.socket?.remoteAddress || 'unknown';
    // Strip port if present (IIS sometimes sends IP:port)
    return ip.split(':')[0] || ip;
  },
  // Skip validation since we have custom key generator
  validate: { xForwardedForHeader: false, trustProxy: false }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
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
  ['analytics', analyticsRoutes]
];

// Mount at /api/ (direct access via localhost:5100)
apiRoutes.forEach(([path, router]) => app.use(`/api/${path}`, router));

// Mount at /storyteller/api/ (access via IIS reverse proxy)
apiRoutes.forEach(([path, router]) => app.use(`/storyteller/api/${path}`, router));

// =============================================================================
// SOCKET.IO HANDLERS
// =============================================================================

setupSocketHandlers(io);
setupSocketHandlers(ioPrefixed);  // Also handle prefixed socket path

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

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);

  // Don't leak stack traces in production
  const response = {
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : undefined
  };

  res.status(err.status || 500).json(response);
});

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
      logger.info(`Storyteller Server v1.0.0`);
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
  await pool.end();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
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
