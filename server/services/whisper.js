/**
 * Whisper Voice Integration Service
 * Connects to the Whisper service for voice transcription
 */

import { io as ioClient } from 'socket.io-client';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

const WHISPER_URL = process.env.WHISPER_SERVICE_URL || 'http://localhost:3003';

export class WhisperService extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.listeners = new Map();
    this.connectionTimeout = null;
  }

  /**
   * Connect to Whisper service
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = ioClient(WHISPER_URL, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: this.maxReconnectAttempts
        });

        this.socket.on('connect', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          // Clear connection timeout since we connected successfully
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          logger.info(`Connected to Whisper service at ${WHISPER_URL}`);
          resolve(true);
        });

        this.socket.on('disconnect', (reason) => {
          this.connected = false;
          logger.warn(`Disconnected from Whisper service: ${reason}`);
        });

        this.socket.on('connect_error', (error) => {
          this.reconnectAttempts++;
          logger.error(`Whisper connection error (attempt ${this.reconnectAttempts}):`, error.message);

          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            // Clear connection timeout since we're rejecting
            if (this.connectionTimeout) {
              clearTimeout(this.connectionTimeout);
              this.connectionTimeout = null;
            }
            reject(new Error('Failed to connect to Whisper service'));
          }
        });

        // Handle transcription results
        this.socket.on('transcription', (data) => {
          this.handleTranscription(data);
        });

        this.socket.on('transcription_error', (error) => {
          logger.error('Whisper transcription error:', error);
          this.emit('error', error);
        });

        // Timeout for initial connection (with cleanup)
        this.connectionTimeout = setTimeout(() => {
          if (!this.connected) {
            this.connectionTimeout = null;
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from Whisper service
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      logger.info('Disconnected from Whisper service');
    }
  }

  /**
   * Start listening for a session
   */
  startListening(sessionId, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to Whisper service');
    }

    this.socket.emit('start_listening', {
      session_id: sessionId,
      language: options.language || 'en',
      model: options.model || 'base'
    });

    logger.info(`Started listening for session ${sessionId}`);
  }

  /**
   * Stop listening for a session
   */
  stopListening(sessionId) {
    if (!this.connected) return;

    this.socket.emit('stop_listening', {
      session_id: sessionId
    });

    logger.info(`Stopped listening for session ${sessionId}`);
  }

  /**
   * Send audio chunk for transcription
   */
  sendAudioChunk(sessionId, audioData, format = 'webm') {
    if (!this.connected) {
      throw new Error('Not connected to Whisper service');
    }

    this.socket.emit('audio_chunk', {
      session_id: sessionId,
      audio: audioData,
      format
    });
  }

  /**
   * Handle incoming transcription
   */
  handleTranscription(data) {
    const { session_id, transcript, confidence, is_final } = data;

    logger.info(`Transcription received: "${transcript}" (confidence: ${confidence})`);

    // Emit to all registered listeners for this session
    const sessionListeners = this.listeners.get(session_id) || [];
    for (const listener of sessionListeners) {
      try {
        listener({
          transcript,
          confidence,
          is_final,
          timestamp: Date.now()
        });
      } catch (e) {
        logger.error('Listener error:', e);
      }
    }
  }

  /**
   * Register a listener for transcriptions
   */
  onTranscription(sessionId, callback) {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, []);
    }
    this.listeners.get(sessionId).push(callback);
  }

  /**
   * Remove listeners for a session
   */
  removeListeners(sessionId) {
    this.listeners.delete(sessionId);
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      url: WHISPER_URL,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Singleton instance
let whisperInstance = null;

export function getWhisperService() {
  if (!whisperInstance) {
    whisperInstance = new WhisperService();
  }
  return whisperInstance;
}

export default WhisperService;
