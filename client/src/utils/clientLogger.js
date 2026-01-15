/**
 * Client-to-Server Logger
 *
 * Sends client-side logs to the server for unified debugging.
 * Logs appear in the server log files with a [Client] prefix.
 */

let socketRef = null;
let pendingLogs = [];
let isConnected = false;

/**
 * Initialize the logger with a socket connection
 * @param {Socket} socket - Socket.IO socket instance
 */
export function initClientLogger(socket) {
  socketRef = socket;
  isConnected = socket?.connected || false;

  if (socket) {
    socket.on('connect', () => {
      isConnected = true;
      // Flush any pending logs
      if (pendingLogs.length > 0) {
        pendingLogs.forEach(log => sendLog(log));
        pendingLogs = [];
      }
    });

    socket.on('disconnect', () => {
      isConnected = false;
    });
  }
}

/**
 * Send a log entry to the server
 */
function sendLog({ level, prefix, message, data }) {
  if (socketRef && isConnected) {
    socketRef.emit('client-log', {
      level,
      prefix,
      message,
      data,
      timestamp: new Date().toISOString(),
      url: window.location.pathname
    });
  } else {
    // Queue for later if not connected
    pendingLogs.push({ level, prefix, message, data });
    // Keep queue bounded
    if (pendingLogs.length > 100) {
      pendingLogs.shift();
    }
  }
}

/**
 * Log levels that mirror server-side Winston
 */
export const clientLog = {
  /**
   * Info level - normal operations
   * @param {string} prefix - Log prefix like [SFX], [Audio], [Queue]
   * @param {string} message - Log message with key: value pairs
   * @param {object} data - Optional structured data
   */
  info(prefix, message, data = null) {
    const fullMessage = `${prefix} ${message}`;
    console.log(fullMessage, data || '');
    sendLog({ level: 'info', prefix, message, data });
  },

  /**
   * Warn level - potential issues
   */
  warn(prefix, message, data = null) {
    const fullMessage = `${prefix} ${message}`;
    console.warn(fullMessage, data || '');
    sendLog({ level: 'warn', prefix, message, data });
  },

  /**
   * Error level - errors
   */
  error(prefix, message, data = null) {
    const fullMessage = `${prefix} ${message}`;
    console.error(fullMessage, data || '');
    sendLog({ level: 'error', prefix, message, data });
  },

  /**
   * Debug level - verbose debugging
   */
  debug(prefix, message, data = null) {
    const fullMessage = `${prefix} ${message}`;
    console.debug(fullMessage, data || '');
    sendLog({ level: 'debug', prefix, message, data });
  }
};

/**
 * Convenience functions for common prefixes
 */
export const sfxLog = {
  info: (msg, data) => clientLog.info('[SFX]', msg, data),
  warn: (msg, data) => clientLog.warn('[SFX]', msg, data),
  error: (msg, data) => clientLog.error('[SFX]', msg, data),
};

export const audioLog = {
  info: (msg, data) => clientLog.info('[Audio]', msg, data),
  warn: (msg, data) => clientLog.warn('[Audio]', msg, data),
  error: (msg, data) => clientLog.error('[Audio]', msg, data),
};

export const queueLog = {
  info: (msg, data) => clientLog.info('[Queue]', msg, data),
  warn: (msg, data) => clientLog.warn('[Queue]', msg, data),
  error: (msg, data) => clientLog.error('[Queue]', msg, data),
};

export const configLog = {
  info: (msg, data) => clientLog.info('[Config]', msg, data),
  warn: (msg, data) => clientLog.warn('[Config]', msg, data),
  error: (msg, data) => clientLog.error('[Config]', msg, data),
};

export const socketLog = {
  info: (msg, data) => clientLog.info('[Socket:Client]', msg, data),
  warn: (msg, data) => clientLog.warn('[Socket:Client]', msg, data),
  error: (msg, data) => clientLog.error('[Socket:Client]', msg, data),
};

export default clientLog;
