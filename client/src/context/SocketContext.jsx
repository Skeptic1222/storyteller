import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_PATH } from '../config';
import { useAuth } from './AuthContext';
import { getStoredToken } from '../utils/authToken';
import { log, error as logError } from '../utils/logger';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const { user, loading: authLoading } = useAuth();

  // Track connection state to prevent premature disconnection
  const isConnectingRef = useRef(false);
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const hasInitializedRef = useRef(false); // Track if socket was ever initialized this mount
  const maxReconnectAttempts = 50; // Increased from 15 for better resilience

  // Primary socket initialization effect - runs once when auth is ready
  // FIX: Use empty dependency array to prevent double-initialization
  // The user?.id dependency was causing socket to reinit when auth completes
  useEffect(() => {
    mountedRef.current = true;

    // Wait for auth to finish loading before initializing
    // This prevents the double-init issue where socket connects with undefined user,
    // then effect re-runs when user becomes available
    if (authLoading) {
      log('[Socket] SKIP_INIT | auth still loading');
      return;
    }

    // Already initialized this mount cycle - skip
    if (hasInitializedRef.current) {
      log('[Socket] SKIP_INIT | already initialized this mount');
      return;
    }

    // Prevent duplicate connections
    if (socketRef.current?.connected) {
      log('[Socket] SKIP_INIT | already connected');
      return;
    }

    // If we have a socket that's connecting or disconnecting, wait for it
    if (socketRef.current && !socketRef.current.disconnected) {
      log('[Socket] SKIP_INIT | socket exists and not disconnected');
      return;
    }

    // Clean up any existing socket before creating new one
    if (socketRef.current) {
      log('[Socket] Cleaning up existing socket before reconnect');
      try {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      } catch (e) {
        // Ignore cleanup errors
      }
      socketRef.current = null;
    }

    const token = getStoredToken();

    // No token = not authenticated, don't connect yet
    if (!token) {
      log('[Socket] SKIP_INIT | no auth token available');
      return;
    }

    // Mark as initialized to prevent re-running
    hasInitializedRef.current = true;

    // Create socket with autoConnect: false, then connect manually
    // This gives us more control over the connection lifecycle
    const socketInstance = io(window.location.origin, {
      path: SOCKET_PATH,
      // Use polling only - more reliable through IIS reverse proxy
      transports: ['polling'],
      upgrade: false,             // Don't upgrade to websocket (avoids premature close errors)
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000, // Increased max delay for stability
      randomizationFactor: 0.5,    // Add jitter to prevent thundering herd
      reconnectionAttempts: maxReconnectAttempts,
      timeout: 30000,
      ackTimeout: 120000,
      forceNew: true,
      withCredentials: true,
      autoConnect: false,         // Don't connect automatically
      auth: { token }
    });

    socketRef.current = socketInstance;
    isConnectingRef.current = true;
    log('[Socket] Initializing connection to:', window.location.origin, 'path:', SOCKET_PATH, 'hasToken:', !!token);

    socketInstance.on('connect', () => {
      if (!mountedRef.current) return;
      log('[Socket] CONNECTED | id:', socketInstance.id, '| authenticated:', !!token);
      isConnectingRef.current = false;
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      setConnected(true);
    });

    socketInstance.on('disconnect', (reason) => {
      if (!mountedRef.current) return;
      log('[Socket] DISCONNECTED | reason:', reason);
      setConnected(false);

      // Handle specific disconnect reasons
      if (reason === 'io server disconnect' && mountedRef.current) {
        // Server disconnected us - try to reconnect
        log('[Socket] Server initiated disconnect, attempting reconnect...');
        setReconnecting(true);
        socketInstance.connect();
      } else if (reason === 'transport close' || reason === 'ping timeout') {
        // Network issue - show reconnecting status
        log('[Socket] Network issue, will auto-reconnect...');
        setReconnecting(true);
      }
      // 'io client disconnect' means we called disconnect() - don't auto-reconnect
    });

    socketInstance.on('connect_error', (error) => {
      if (!mountedRef.current) return;
      logError('[Socket] CONNECTION_ERROR | error:', error?.message || error, '| attempt:', reconnectAttemptsRef.current);
      isConnectingRef.current = false;
      setConnected(false);
      setReconnecting(true);
      reconnectAttemptsRef.current++;

      // If we've exceeded max attempts, try a fresh connection after delay
      if (reconnectAttemptsRef.current >= maxReconnectAttempts && mountedRef.current) {
        log('[Socket] Max reconnect attempts reached, will retry with fresh connection in 10s');
        setTimeout(() => {
          if (mountedRef.current) {
            reconnectAttemptsRef.current = 0;
            socketInstance.connect();
          }
        }, 10000);
      }
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      if (!mountedRef.current) return;
      log('[Socket] RECONNECTED | attempt:', attemptNumber);
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      setConnected(true);
    });

    socketInstance.on('reconnect_attempt', (attemptNumber) => {
      log('[Socket] RECONNECT_ATTEMPT | attempt:', attemptNumber);
      setReconnecting(true);
    });

    socketInstance.on('reconnect_failed', () => {
      logError('[Socket] RECONNECT_FAILED | all attempts exhausted');
      setReconnecting(false);
    });

    setSocket(socketInstance);

    // Connect manually after all listeners are set up
    socketInstance.connect();

    return () => {
      // Mark as unmounted first to prevent state updates
      mountedRef.current = false;

      // Clean up socket on unmount
      if (socketRef.current) {
        log('[Socket] Cleanup - removing listeners and disconnecting');
        try {
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
        } catch (e) {
          // Ignore cleanup errors silently
        }
        socketRef.current = null;
      }
      isConnectingRef.current = false;
      hasInitializedRef.current = false; // Reset for potential remount
    };
  }, [authLoading]); // Only depend on authLoading - runs once when auth completes

  // Separate effect for handling logout - disconnect socket when user logs out
  useEffect(() => {
    // If user becomes null/undefined (logout) and we have a socket, disconnect
    if (!user && !authLoading && socketRef.current) {
      log('[Socket] User logged out - disconnecting socket');
      socketRef.current.disconnect();
      socketRef.current = null;
      hasInitializedRef.current = false; // Allow reinitialization on next login
      setSocket(null);
      setConnected(false);
      setSessionId(null);
    }
  }, [user, authLoading]);

  const joinSession = useCallback((id) => {
    if (socket && id) {
      log('[Socket:Emit] EVENT: join-session | session_id:', id);
      socket.emit('join-session', { session_id: id });
      setSessionId(id);
    }
  }, [socket]);

  const leaveSession = useCallback(() => {
    if (socket && sessionId) {
      log('[Socket:Emit] EVENT: leave-session | session_id:', sessionId);
      socket.emit('leave-session');
      setSessionId(null);
    }
  }, [socket, sessionId]);

  const value = useMemo(() => ({
    socket,
    connected,
    reconnecting,
    sessionId,
    joinSession,
    leaveSession
  }), [socket, connected, reconnecting, sessionId, joinSession, leaveSession]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
