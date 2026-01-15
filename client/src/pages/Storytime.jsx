import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookOpen, Home, Volume2, VolumeX } from 'lucide-react';
import { io } from 'socket.io-client';
import { apiCall } from '../config';

const WHISPER_URL = 'http://localhost:3003';

// Only attempt Whisper connection on actual localhost (Whisper binds to 127.0.0.1 only)
const isActualLocalhost = () => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
};

// Conversation states
const STATES = {
  INIT: 'init',
  GREETING: 'greeting',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  RESPONDING: 'responding',
  READY_TO_START: 'ready_to_start',
  STARTING: 'starting'
};

function Storytime() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  // Conversation state
  const [state, setState] = useState(STATES.INIT);
  const [messages, setMessages] = useState([]);
  const [currentAiMessage, setCurrentAiMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [config, setConfig] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);

  // Refs
  const audioRef = useRef(null);
  const whisperSocketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

  // Connect to Whisper on mount (only on actual localhost)
  useEffect(() => {
    // Don't attempt connection if not on localhost - Whisper binds to 127.0.0.1 only
    if (!isActualLocalhost()) {
      return;
    }

    const socket = io(WHISPER_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000
    });

    socket.on('connect', () => {
      console.log('[Storytime] Connected to Whisper');
      socket.emit('init-session', { sessionId: `storytime-${sessionId}` });
    });

    socket.on('transcription', (data) => {
      console.log('[Storytime] Transcription:', data.text);
      if (data.text) {
        setTranscript(data.text);
        handleUserInput(data.text);
      }
    });

    socket.on('error', (data) => {
      console.error('[Storytime] Whisper error:', data);
      setError('Voice recognition error');
      setState(STATES.LISTENING);
    });

    socket.on('connect_error', () => {
      // Silent - user will see mic is unavailable
    });

    whisperSocketRef.current = socket;

    return () => {
      socket.disconnect();
      stopListening();
    };
  }, [sessionId]);

  // Start greeting when component mounts
  useEffect(() => {
    if (state === STATES.INIT && sessionId) {
      startConversation();
    }
  }, [sessionId, state]);

  // Start the conversation with AI greeting
  const startConversation = async () => {
    setState(STATES.GREETING);

    const greeting = "Hey there! I'm Narrimo, your co-author. What kind of story do you want to build? Share characters, a setting, or just a mood - or say 'surprise me'.";

    setCurrentAiMessage(greeting);
    setMessages([{ role: 'assistant', content: greeting }]);

    await speakMessage(greeting);
    startListening();
  };

  // Speak a message using ElevenLabs TTS
  const speakMessage = async (text) => {
    if (isMuted) {
      // If muted, just wait a moment then continue
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }

    setState(STATES.RESPONDING);

    try {
      const response = await apiCall('/voices/preview', {
        method: 'POST',
        body: JSON.stringify({
          text,
          voice_id: config.voice_id || 'JBFqnCBsd6RMkjVDRZzb' // George - warm narrator
        })
      });

      if (!response.ok) {
        throw new Error('TTS failed');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      return new Promise((resolve) => {
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.onended = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audioRef.current.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audioRef.current.play().catch(() => resolve());
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error('TTS error:', err);
      // Continue even if TTS fails
    }
  };

  // Start listening for user input
  const startListening = useCallback(async () => {
    setState(STATES.LISTENING);
    setTranscript('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      streamRef.current = stream;

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

        if (audioBlob.size > 1000 && whisperSocketRef.current?.connected) {
          setState(STATES.PROCESSING);
          const arrayBuffer = await audioBlob.arrayBuffer();
          whisperSocketRef.current.emit('audio-data', {
            audioBuffer: arrayBuffer,
            turnId: Date.now()
          });
        } else {
          // Too short, restart listening
          startListening();
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);

      // Auto-stop after 10 seconds of listening
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopListening();
        }
      }, 10000);

    } catch (err) {
      console.error('Microphone error:', err);
      setError('Could not access microphone');
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Handle user input and get AI response
  const handleUserInput = async (userText) => {
    if (!userText.trim()) {
      startListening();
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setState(STATES.PROCESSING);

    try {
      const response = await apiCall(`/stories/${sessionId}/converse`, {
        method: 'POST',
        body: JSON.stringify({
          input: userText,
          current_config: config,
          conversation_history: messages
        })
      });

      if (!response.ok) {
        throw new Error('Conversation failed');
      }

      const data = await response.json();

      // Update config with any extracted preferences
      if (data.config_updates) {
        setConfig(prev => ({ ...prev, ...data.config_updates }));
      }

      // Add AI response to messages
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      setCurrentAiMessage(data.response);

      // Check if we should start the story
      if (data.ready_to_start) {
        setState(STATES.READY_TO_START);
        await speakMessage(data.response);

        // Give user a moment, then start
        setTimeout(() => {
          startStory();
        }, 2000);
      } else {
        // Speak response and continue conversation
        await speakMessage(data.response);
        startListening();
      }

    } catch (err) {
      console.error('Conversation error:', err);
      setError('Something went wrong. Let me try again.');
      await speakMessage("I didn't quite catch that. Could you tell me again?");
      startListening();
    }
  };

  // Start the actual story
  const startStory = async () => {
    setState(STATES.STARTING);
    stopListening();

    try {
      // Update session with config
      await apiCall(`/stories/${sessionId}/configure`, {
        method: 'POST',
        body: JSON.stringify({
          input: JSON.stringify(config),
          input_type: 'voice_config'
        })
      });

      // Navigate to story player
      navigate(`/story/${sessionId}`);
    } catch (err) {
      console.error('Failed to start story:', err);
      setError('Could not start story');
    }
  };

  // Manual tap to stop listening and submit
  const handleTapToSubmit = () => {
    if (state === STATES.LISTENING) {
      stopListening();
    }
  };

  // Skip conversation and go to manual config
  const goToConfigure = () => {
    stopListening();
    navigate(`/configure/${sessionId}`);
  };

  const goHome = () => {
    stopListening();
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} />

      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-slate-900/50">
        <button onClick={goHome} className="p-2 rounded-full hover:bg-slate-800">
          <Home className="w-6 h-6 text-slate-300" />
        </button>
        <h2 className="text-narrimo-coral font-medium">Voice Studio</h2>
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-2 rounded-full hover:bg-slate-800"
        >
          {isMuted ? (
            <VolumeX className="w-6 h-6 text-slate-300" />
          ) : (
            <Volume2 className="w-6 h-6 text-narrimo-coral" />
          )}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        {/* BookOpen with state indicator */}
        <div className="mb-8">
          <div className={`relative ${state === STATES.RESPONDING ? 'animate-pulse' : ''}`}>
            <BookOpen className={`w-24 h-24 ${
              state === STATES.LISTENING ? 'text-blue-400' :
              state === STATES.PROCESSING ? 'text-yellow-400' :
              state === STATES.RESPONDING ? 'text-narrimo-coral' :
              'text-narrimo-coral'
            }`} />

            {/* Listening indicator */}
            {state === STATES.LISTENING && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-4 bg-blue-400 rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* State message */}
        <div className="text-center mb-8 max-w-md">
          {state === STATES.LISTENING && (
            <p className="text-blue-400 text-lg animate-pulse">I'm listening...</p>
          )}
          {state === STATES.PROCESSING && (
            <p className="text-yellow-400 text-lg">Thinking...</p>
          )}
          {state === STATES.RESPONDING && (
            <p className="text-narrimo-coral text-lg">Speaking...</p>
          )}
          {state === STATES.STARTING && (
            <p className="text-narrimo-coral text-lg">Starting your story...</p>
          )}
        </div>

        {/* Current AI message */}
        {currentAiMessage && (
          <div className="max-w-md mx-auto mb-6 p-4 bg-slate-800/50 rounded-xl">
            <p className="text-slate-100 text-lg leading-relaxed text-center">
              "{currentAiMessage}"
            </p>
          </div>
        )}

        {/* User transcript */}
        {transcript && state === STATES.PROCESSING && (
          <div className="max-w-md mx-auto mb-6 p-3 bg-blue-900/30 rounded-xl">
            <p className="text-blue-200 text-sm text-center">
              You said: "{transcript}"
            </p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="max-w-md mx-auto mb-6 p-3 bg-red-900/30 rounded-xl">
            <p className="text-red-300 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Tap to submit hint when listening */}
        {state === STATES.LISTENING && (
          <button
            onClick={handleTapToSubmit}
            className="mt-4 px-6 py-3 bg-slate-800 rounded-full text-slate-300
                       hover:bg-slate-700 transition-all"
          >
            Tap when done speaking
          </button>
        )}
      </main>

      {/* Footer */}
      <footer className="p-6 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={goToConfigure}
            className="px-4 py-2 text-slate-400 text-sm hover:text-slate-200 transition-all"
          >
            Configure manually instead
          </button>
        </div>
      </footer>
    </div>
  );
}

export default Storytime;
