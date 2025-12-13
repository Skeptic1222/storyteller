import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_PATH } from '../config';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    const socketInstance = io({
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      // Increase timeouts to handle long-running AI operations (scene generation can take 60-90s)
      timeout: 120000,           // 120 second connection timeout
      ackTimeout: 120000         // 120 second acknowledgement timeout
    });

    socketInstance.on('connect', () => {
      console.log('[Socket] CONNECTED | id:', socketInstance.id);
      setConnected(true);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket] DISCONNECTED | reason:', reason);
      setConnected(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] CONNECTION_ERROR | error:', error?.message || error);
      setConnected(false);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

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
