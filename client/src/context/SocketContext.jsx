import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_PATH } from '../config';
import { useAuth } from './AuthContext';
import { getStoredToken } from '../utils/authToken';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const { user } = useAuth();

  // Track connection state to prevent premature disconnection
  const isConnectingRef = useRef(false);
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const maxReconnectAttempts = 15;

  useEffect(() => {
    mountedRef.current = true;

    // Prevent duplicate connections
    if (socketRef.current?.connected) {
      console.log('[Socket] SKIP_INIT | already connected');
      return;
    }

    // If we have a socket that's connecting or disconnecting, wait for it
    if (socketRef.current && !socketRef.current.disconnected) {
      console.log('[Socket] SKIP_INIT | socket exists and not disconnected');
      return;
    }

    // Clean up any existing socket before creating new one
    if (socketRef.current) {
      console.log('[Socket] Cleaning up existing socket before reconnect');
      try {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      } catch (e) {
        // Ignore cleanup errors
      }
      socketRef.current = null;
    }

    const token = getStoredToken();

    // Create socket with autoConnect: false, then connect manually
    // This gives us more control over the connection lifecycle
    const socketInstance = io(window.location.origin, {
      path: SOCKET_PATH,
      // Use polling only - more reliable through IIS reverse proxy
      transports: ['polling'],
      upgrade: false,             // Don't upgrade to websocket (avoids premature close errors)
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
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
    console.log('[Socket] Initializing connection to:', window.location.origin, 'path:', SOCKET_PATH, 'hasToken:', !!token);

    socketInstance.on('connect', () => {
      if (!mountedRef.current) return;
      console.log('[Socket] CONNECTED | id:', socketInstance.id, '| authenticated:', !!token);
      isConnectingRef.current = false;
      reconnectAttemptsRef.current = 0;
      setConnected(true);
    });

    socketInstance.on('disconnect', (reason) => {
      if (!mountedRef.current) return;
      console.log('[Socket] DISCONNECTED | reason:', reason);
      setConnected(false);

      // Handle specific disconnect reasons
      if (reason === 'io server disconnect' && mountedRef.current) {
        // Server disconnected us - try to reconnect
        console.log('[Socket] Server initiated disconnect, attempting reconnect...');
        socketInstance.connect();
      }
      // 'io client disconnect' means we called disconnect() - don't auto-reconnect
    });

    socketInstance.on('connect_error', (error) => {
      if (!mountedRef.current) return;
      console.error('[Socket] CONNECTION_ERROR | error:', error?.message || error, '| attempt:', reconnectAttemptsRef.current);
      isConnectingRef.current = false;
      setConnected(false);
      reconnectAttemptsRef.current++;

      // If we've exceeded max attempts, try a fresh connection after delay
      if (reconnectAttemptsRef.current >= maxReconnectAttempts && mountedRef.current) {
        console.log('[Socket] Max reconnect attempts reached, will retry with fresh connection in 10s');
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
      console.log('[Socket] RECONNECTED | attempt:', attemptNumber);
      reconnectAttemptsRef.current = 0;
      setConnected(true);
    });

    socketInstance.on('reconnect_attempt', (attemptNumber) => {
      console.log('[Socket] RECONNECT_ATTEMPT | attempt:', attemptNumber);
    });

    socketInstance.on('reconnect_failed', () => {
      console.error('[Socket] RECONNECT_FAILED | all attempts exhausted');
    });

    setSocket(socketInstance);

    // Connect manually after all listeners are set up
    socketInstance.connect();

    return () => {
      // Mark as unmounted first to prevent state updates
      mountedRef.current = false;

      // Clean up socket on unmount
      if (socketRef.current) {
        console.log('[Socket] Cleanup - removing listeners and disconnecting');
        try {
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
        } catch (e) {
          // Ignore cleanup errors silently
        }
        socketRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, [user?.id]); // Only reconnect when user ID changes, not entire user object

  const joinSession = useCallback((id) => {
    if (socket && id) {
      console.log('[Socket:Emit] EVENT: join-session | session_id:', id);
      socket.emit('join-session', { session_id: id });
      setSessionId(id);
    }
  }, [socket]);

  const leaveSession = useCallback(() => {
    if (socket && sessionId) {
      console.log('[Socket:Emit] EVENT: leave-session | session_id:', sessionId);
      socket.emit('leave-session');
      setSessionId(null);
    }
  }, [socket, sessionId]);

  const value = useMemo(() => ({
    socket,
    connected,
    sessionId,
    joinSession,
    leaveSession
  }), [socket, connected, sessionId, joinSession, leaveSession]);

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
