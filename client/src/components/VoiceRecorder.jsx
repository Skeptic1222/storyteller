import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader } from 'lucide-react';
import { io } from 'socket.io-client';

const WHISPER_URL = 'http://localhost:3003';

// Only attempt Whisper connection on actual localhost (Whisper binds to 127.0.0.1 only)
const isActualLocalhost = () => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
};

function VoiceRecorder({ onTranscript, disabled = false, size = 'normal' }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const whisperSocketRef = useRef(null);
  const turnIdRef = useRef(0);

  // Connect to Whisper service (only on actual localhost)
  useEffect(() => {
    // Don't attempt connection if not on localhost - Whisper binds to 127.0.0.1 only
    if (!isActualLocalhost()) {
      setError('Voice input requires localhost');
      return;
    }

    const socket = io(WHISPER_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000
    });

    socket.on('connect', () => {
      console.log('[VoiceRecorder] Connected to Whisper service');
      socket.emit('init-session', { sessionId: `storyteller-${Date.now()}` });
    });

    socket.on('session-ready', (data) => {
      console.log('[VoiceRecorder] Whisper session ready:', data.sessionId);
    });

    socket.on('transcription', (data) => {
      console.log('[VoiceRecorder] Transcription received:', data.text);
      setIsProcessing(false);
      if (data.text && onTranscript) {
        onTranscript(data.text);
      }
    });

    socket.on('error', (data) => {
      console.error('[VoiceRecorder] Whisper error:', data);
      setError(data.message || 'Voice recognition error');
      setIsProcessing(false);
    });

    socket.on('connect_error', () => {
      setError('Voice service unavailable');
    });

    whisperSocketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        if (audioBlob.size > 0 && whisperSocketRef.current?.connected) {
          setIsProcessing(true);
          turnIdRef.current++;

          // Convert blob to array buffer and send to Whisper
          const arrayBuffer = await audioBlob.arrayBuffer();
          whisperSocketRef.current.emit('audio-data', {
            audioBuffer: arrayBuffer,
            turnId: turnIdRef.current
          });
        }

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);

    } catch (err) {
      console.error('Error accessing microphone:', err);
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied');
      } else {
        setError('Could not access microphone');
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const sizeClasses = size === 'large'
    ? 'w-16 h-16'
    : size === 'small'
      ? 'w-10 h-10'
      : 'w-12 h-12';

  const iconSize = size === 'large' ? 'w-8 h-8' : size === 'small' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={toggleRecording}
        disabled={disabled || isProcessing}
        className={`${sizeClasses} rounded-full flex items-center justify-center transition-all
          ${isRecording
            ? 'bg-red-500 animate-pulse'
            : isProcessing
              ? 'bg-night-600'
              : 'bg-night-700 hover:bg-night-600'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {isProcessing ? (
          <Loader className={`${iconSize} text-golden-400 animate-spin`} />
        ) : isRecording ? (
          <MicOff className={`${iconSize} text-white`} />
        ) : (
          <Mic className={`${iconSize} text-golden-400`} />
        )}
      </button>

      {error && (
        <p className="text-red-400 text-xs text-center max-w-[150px]">{error}</p>
      )}

      {isRecording && (
        <p className="text-golden-400 text-xs animate-pulse">Listening...</p>
      )}

      {isProcessing && (
        <p className="text-night-400 text-xs">Processing...</p>
      )}
    </div>
  );
}

export default VoiceRecorder;
