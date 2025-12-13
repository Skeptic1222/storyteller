import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sparkles, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { apiCall } from '../config';
import { wakeLock } from '../utils/wakeLock';
import UserProfile from '../components/UserProfile';

// Conversation states
const STATE = {
  IDLE: 'idle',
  CREATING_SESSION: 'creating_session',
  CONNECTING_RTC: 'connecting_rtc',
  READY: 'ready',
  LISTENING: 'listening',
  AI_SPEAKING: 'ai_speaking',
  PREPARING_STORY: 'preparing_story',
  GENERATING_OUTLINE: 'generating_outline',
  ERROR: 'error'
};

function Home() {
  const navigate = useNavigate();
  const { socket, connected } = useSocket();
  const { isAuthenticated } = useAuth();

  // State
  const [state, setState] = useState(STATE.IDLE);
  const [sessionId, setSessionId] = useState(null);
  const [aiTranscript, setAiTranscript] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Refs for audio
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      wakeLock.disable(); // Release wake lock on unmount
      if (socket && sessionId) {
        socket.emit('rtc-stop');
      }
    };
  }, [socket, sessionId]);

  // Socket event listeners for RTC
  useEffect(() => {
    if (!socket) return;

    const handleRTC = (msg) => {
      console.log('RTC event:', msg.type, msg);

      switch (msg.type) {
        case 'rtc_connecting':
          setState(STATE.CONNECTING_RTC);
          setStatusMessage('Connecting to voice service...');
          break;

        case 'rtc_ready':
          setState(STATE.READY);
          setStatusMessage('Listening... just speak naturally');
          startMicrophone();
          break;

        case 'user_speaking':
          setState(STATE.LISTENING);
          setUserTranscript('');
          stopPlayback();
          break;

        case 'user_stopped':
          // User stopped speaking, waiting for AI
          break;

        case 'user_transcript':
          setUserTranscript(msg.text);
          break;

        case 'assistant_transcript_delta':
          setAiTranscript(prev => prev + msg.delta);
          break;

        case 'assistant_transcript':
          setAiTranscript(msg.text);
          setState(STATE.AI_SPEAKING);
          break;

        case 'audio':
          if (!isMuted) {
            queueAudioChunk(msg.audio);
          }
          break;

        case 'audio_done':
          // AI finished speaking, ready for next input
          setTimeout(() => {
            if (state !== STATE.PREPARING_STORY) {
              setState(STATE.READY);
              setStatusMessage('Listening...');
            }
          }, 500);
          break;

        case 'response_done':
          // Full response complete
          break;

        case 'story_ready':
          // AI indicated story is ready - transition!
          handleStoryReady(msg.config);
          break;

        case 'error':
          console.error('RTC error:', msg.message);
          setError(msg.message);
          setState(STATE.ERROR);
          break;
      }
    };

    socket.on('rtc', handleRTC);

    return () => {
      socket.off('rtc', handleRTC);
    };
  }, [socket, state, isMuted]);

  // Start the conversation
  const startConversation = async () => {
    console.log('Starting conversation...');
    setState(STATE.CREATING_SESSION);
    setStatusMessage('Setting up your session...');
    setError(null);
    setAiTranscript('');
    setUserTranscript('');

    // Enable wake lock to prevent screen sleep (especially iOS)
    wakeLock.enable().then(success => {
      console.log('Wake lock:', success ? 'enabled' : 'failed');
    });

    try {
      // Create story session
      const response = await apiCall('/stories/start', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'storytime',
          story_mode: 'general'
        })
      });

      if (!response.ok) throw new Error('Failed to create story session');
      const data = await response.json();
      setSessionId(data.session_id);
      console.log('Session created:', data.session_id);

      // Start RTC conversation
      if (socket && connected) {
        socket.emit('rtc-start', { session_id: data.session_id });
      } else {
        throw new Error('Not connected to server');
      }
    } catch (err) {
      console.error('Failed to start:', err);
      setError(err.message);
      setState(STATE.ERROR);
    }
  };

  // Handle when AI indicates story is ready
  const handleStoryReady = async (config) => {
    console.log('Story ready! Config:', config);
    setState(STATE.PREPARING_STORY);
    setStatusMessage('Preparing your story...');

    // Stop RTC and audio
    if (socket) {
      socket.emit('rtc-stop');
    }
    stopAudio();

    // Small delay for UX
    await new Promise(r => setTimeout(r, 1500));

    setState(STATE.GENERATING_OUTLINE);
    setStatusMessage('Creating story outline...');

    try {
      // Generate the story outline
      const response = await apiCall(`/stories/${sessionId}/generate-outline`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to generate story');

      setStatusMessage('Story ready! Starting narration...');
      await new Promise(r => setTimeout(r, 1000));

      // Navigate to story page
      navigate(`/story/${sessionId}`);
    } catch (err) {
      console.error('Story generation error:', err);
      setError('Failed to create story. Please try again.');
      setState(STATE.ERROR);
    }
  };

  // Start microphone
  const startMicrophone = async () => {
    try {
      console.log('Starting microphone...');

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (socket?.connected && state !== STATE.PREPARING_STORY) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = float32ToPCM16(inputData);
          const base64 = arrayBufferToBase64(pcm16.buffer);
          socket.emit('rtc-audio', { audio: base64 });
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      audioProcessorRef.current = { source, processor };

      console.log('Microphone streaming started');
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Could not access microphone. Please allow microphone access.');
      setState(STATE.ERROR);
    }
  };

  // Convert Float32 to PCM16
  const float32ToPCM16 = (float32Array) => {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  };

  // Convert ArrayBuffer to base64
  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Queue audio for playback
  const queueAudioChunk = (base64Audio) => {
    playbackQueueRef.current.push(base64Audio);
    if (!isPlayingRef.current) {
      playNextChunk();
    }
  };

  // Play next audio chunk
  const playNextChunk = async () => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const base64 = playbackQueueRef.current.shift();

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
        });
      }

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 0x8000;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => playNextChunk();
      source.start();
    } catch (err) {
      console.error('Playback error:', err);
      playNextChunk();
    }
  };

  // Stop playback
  const stopPlayback = () => {
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  };

  // Stop all audio
  const stopAudio = () => {
    stopPlayback();
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.source.disconnect();
        audioProcessorRef.current.processor.disconnect();
      } catch (e) {
        // Audio processor disconnect errors are expected during cleanup
        // (e.g., already disconnected or context closed)
        if (e.name !== 'InvalidStateError') {
          console.warn('Audio processor cleanup error:', e.message);
        }
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch((e) => {
        // AudioContext close errors are usually benign (already closed)
        console.debug('AudioContext close:', e.message);
      });
    }
  };

  // End conversation
  const endConversation = () => {
    if (socket) {
      socket.emit('rtc-stop');
    }
    stopAudio();
    wakeLock.disable(); // Release wake lock
    setState(STATE.IDLE);
    setAiTranscript('');
    setUserTranscript('');
    setSessionId(null);
  };

  // Render based on state
  const isActive = state !== STATE.IDLE && state !== STATE.ERROR;
  const isTransitioning = state === STATE.PREPARING_STORY || state === STATE.GENERATING_OUTLINE;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Stars background */}
      <div className="absolute inset-0 stars-bg opacity-50 pointer-events-none" />

      {/* Header with User Profile */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        {/* Mute button - only during active conversation */}
        {isActive && !isTransitioning && (
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-3 rounded-full bg-night-800/50 hover:bg-night-700/50 transition-all"
          >
            {isMuted ? (
              <VolumeX className="w-6 h-6 text-night-400" />
            ) : (
              <Volume2 className="w-6 h-6 text-golden-400" />
            )}
          </button>
        )}
        {/* User Profile dropdown */}
        <UserProfile />
      </div>

      {!isActive ? (
        // Initial state - tap to start
        <>
          <div className="mb-8 animate-float">
            <div className="relative">
              <Moon className="w-24 h-24 text-golden-400" />
              <Sparkles className="w-6 h-6 text-golden-400 absolute -top-2 -right-2 animate-twinkle" />
            </div>
          </div>

          <h1 className="text-4xl font-bold gradient-text mb-2 text-center">
            Storyteller
          </h1>
          <p className="text-night-300 text-lg mb-8 text-center">
            Interactive voice-powered stories
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-900/30 rounded-xl text-red-300 text-center max-w-sm">
              {error}
              <button
                onClick={() => { setError(null); setState(STATE.IDLE); }}
                className="block mx-auto mt-2 text-sm underline"
              >
                Try again
              </button>
            </div>
          )}

          <button
            onClick={startConversation}
            disabled={!connected}
            className="w-64 h-64 rounded-full bg-gradient-to-br from-night-700 to-night-800
                       border-4 border-golden-400 glow-button flex flex-col items-center justify-center
                       transition-all duration-300 hover:scale-105 active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Moon className="w-16 h-16 text-golden-400 mb-4" />
            <span className="text-golden-400 text-2xl font-semibold">Start</span>
            <span className="text-night-300 text-sm mt-2">
              {connected ? 'Tap to begin' : 'Connecting...'}
            </span>
          </button>

          <p className="text-night-400 text-sm mt-8 text-center max-w-xs">
            Just talk naturally - no buttons needed once we begin!
          </p>

          {/* Navigation links - more visible */}
          <div className="absolute bottom-8 flex gap-6 text-night-300 text-base">
            <button
              onClick={() => navigate('/library')}
              className="hover:text-golden-400 transition-colors underline underline-offset-2"
            >
              My Library
            </button>
            <span className="text-night-500">|</span>
            <button
              onClick={() => navigate('/configure')}
              className="hover:text-golden-400 transition-colors underline underline-offset-2"
            >
              Manual Setup
            </button>
          </div>
        </>
      ) : isTransitioning ? (
        // Transitioning to story
        <div className="text-center">
          <div className="mb-8">
            <Loader2 className="w-20 h-20 text-golden-400 animate-spin mx-auto" />
          </div>
          <h2 className="text-2xl text-golden-400 mb-4">
            {state === STATE.PREPARING_STORY ? 'Preparing Your Story' : 'Creating Your Adventure'}
          </h2>
          <p className="text-night-300 text-lg mb-2">{statusMessage}</p>
          <div className="flex gap-1 justify-center mt-6">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-2 bg-golden-400/50 rounded-full audio-bar"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      ) : (
        // Active conversation
        <div className="w-full max-w-md flex flex-col items-center">
          {/* Moon indicator */}
          <div className={`mb-6 transition-all duration-500 ${
            state === STATE.LISTENING ? 'scale-110' :
            state === STATE.AI_SPEAKING ? 'animate-pulse' : ''
          }`}>
            <Moon className={`w-24 h-24 transition-colors duration-300 ${
              state === STATE.CONNECTING_RTC || state === STATE.CREATING_SESSION ? 'text-yellow-400' :
              state === STATE.LISTENING ? 'text-blue-400' :
              state === STATE.AI_SPEAKING ? 'text-golden-400' :
              'text-golden-400'
            }`} />
          </div>

          {/* Status */}
          <div className="text-center mb-6">
            {(state === STATE.CONNECTING_RTC || state === STATE.CREATING_SESSION) && (
              <p className="text-yellow-400 animate-pulse">{statusMessage}</p>
            )}
            {state === STATE.READY && (
              <p className="text-night-300">{statusMessage || 'Listening...'}</p>
            )}
            {state === STATE.LISTENING && (
              <div className="flex items-center gap-2 text-blue-400">
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="w-2 h-4 bg-blue-400 rounded-full animate-pulse"
                         style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span>Hearing you...</span>
              </div>
            )}
            {state === STATE.AI_SPEAKING && (
              <p className="text-golden-400">Speaking...</p>
            )}
          </div>

          {/* AI transcript */}
          {aiTranscript && (
            <div className="w-full p-4 bg-night-800/70 rounded-2xl mb-4 backdrop-blur max-h-48 overflow-y-auto">
              <p className="text-night-100 text-lg leading-relaxed">
                "{aiTranscript}"
              </p>
            </div>
          )}

          {/* User transcript */}
          {userTranscript && (
            <div className="w-full p-3 bg-blue-900/30 rounded-xl mb-4">
              <p className="text-blue-200 text-sm">
                You: "{userTranscript}"
              </p>
            </div>
          )}

          {/* Audio bars when AI speaking */}
          {state === STATE.AI_SPEAKING && (
            <div className="flex items-center gap-1 my-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-golden-400 rounded-full audio-bar"
                  style={{ height: '12px', animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </div>
          )}

          {/* End button */}
          <button
            onClick={endConversation}
            className="mt-8 text-night-500 text-sm hover:text-night-300 transition-colors"
          >
            End conversation
          </button>
        </div>
      )}
    </div>
  );
}

export default Home;
