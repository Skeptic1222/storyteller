import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sparkles,
  BookOpen,
  Library,
  Wand2,
  Mic,
  Headphones,
  Play,
  ChevronRight,
  MessageCircle,
  Radio,
  ShieldCheck,
  PenTool,
  Layers
} from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { apiCall } from '../config';
import { wakeLock } from '../utils/wakeLock';
import NavBar from '../components/NavBar';

const BASE_URL = import.meta.env.BASE_URL || '/storyteller/';

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

const GENRES = ['Fantasy', 'Sci-Fi', 'Thriller', 'Mystery', 'Romance', 'Horror', 'Adventure'];
const MOODS = ['Cinematic', 'Cozy', 'Dark', 'Playful', 'Epic', 'Surreal'];
const DURATIONS = ['5-10 min', '15-25 min', '30-45 min', '60+ min'];
const VOICES = ['Studio Narrator', 'Neo Noir', 'Soft Spoken', 'Mythic Guide'];
const AUTHOR_STYLES = ['Classic Epic', 'Modern Minimal', 'Lyrical', 'Gritty Realism'];

const STORY_BIBLE_TILES = [
  'Characters', 'Locations', 'Factions', 'Timeline', 'Rules', 'Themes',
  'Boundaries', 'Artifacts', 'Magic Systems', 'Cultures', 'Languages', 'Technology',
  'Politics', 'Economy', 'Mythology', 'Religion', 'Creatures', 'Geography',
  'History', 'Prophecies', 'Conflicts', 'Symbols', 'Maps', 'Vehicles',
  'Organizations', 'Holidays', 'Laws', 'Secrets', 'Reputation', 'Relationships',
  'Wardrobe', 'Soundscape', 'Weather', 'Architecture', 'Story Beats', 'Canon Lock'
];

const LIBRARY_PREVIEW = [
  {
    title: 'The Glass Meridian',
    genre: ['Sci-Fi', 'Mystery'],
    length: '28 min'
  },
  {
    title: 'Wolves of Emberfall',
    genre: ['Fantasy', 'Adventure'],
    length: '42 min'
  },
  {
    title: 'Velvet Signal',
    genre: ['Thriller', 'Noir'],
    length: '18 min'
  }
];

const LIBRARY_TABS = ['Free', 'My Stories', 'Favorites', 'Downloaded'];
const LIBRARY_GENRE_FILTERS = ['All genres', ...GENRES];
const LIBRARY_LENGTH_FILTERS = ['Any length', 'Under 15 min', '15–30 min', '30–60 min', '60+ min'];
const LIBRARY_RATING_FILTERS = ['All ratings', 'General', 'Teen', 'Mature'];

const WHY_NARRIMO = [
  {
    title: 'Cinematic audio-first narration',
    description: 'Studio-grade voices and layered sound design put listeners inside the world.'
  },
  {
    title: 'Multi-genre and mature themes',
    description: 'From lighthearted quests to darker epics, tuned to your settings.'
  },
  {
    title: 'Interactive branching paths',
    description: 'Dynamic choices and checkpoints keep stories reactive and replayable.'
  },
  {
    title: 'Author-style inspiration',
    description: 'Dial in tone, rhythm, and pacing without copying exact text.'
  },
  {
    title: 'Story Bible canon control',
    description: 'Lock continuity across series, seasons, and worlds.'
  },
  {
    title: 'Real-time co-writing concierge',
    description: 'Iterate scenes live with a voice-first assistant.'
  }
];

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { socket, connected } = useSocket();

  const [state, setState] = useState(STATE.IDLE);
  const [sessionId, setSessionId] = useState(null);
  const [aiTranscript, setAiTranscript] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState(GENRES[0]);
  const [mood, setMood] = useState(MOODS[0]);
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [voice, setVoice] = useState(VOICES[0]);
  const [authorStyle, setAuthorStyle] = useState(AUTHOR_STYLES[0]);
  const [cyoaEnabled, setCyoaEnabled] = useState(false);

  const [libraryTab, setLibraryTab] = useState(LIBRARY_TABS[0]);
  const [libraryGenre, setLibraryGenre] = useState(LIBRARY_GENRE_FILTERS[0]);
  const [libraryLength, setLibraryLength] = useState(LIBRARY_LENGTH_FILTERS[0]);
  const [libraryRating, setLibraryRating] = useState(LIBRARY_RATING_FILTERS[0]);

  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    if (!location.hash) return;
    const targetId = location.hash.replace('#', '');
    const section = document.getElementById(targetId);
    if (!section) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  }, [location.hash]);

  useEffect(() => {
    return () => {
      stopAudio();
      wakeLock.disable();
      if (socket && sessionId) {
        socket.emit('rtc-stop');
      }
    };
  }, [socket, sessionId]);

  useEffect(() => {
    if (!socket) return;

    const handleRTC = (msg) => {
      switch (msg.type) {
        case 'rtc_connecting':
          setState(STATE.CONNECTING_RTC);
          setStatusMessage('Connecting to your concierge...');
          break;
        case 'rtc_ready':
          setState(STATE.READY);
          setStatusMessage('Listening... speak naturally');
          startMicrophone();
          break;
        case 'user_speaking':
          setState(STATE.LISTENING);
          setUserTranscript('');
          stopPlayback();
          break;
        case 'user_transcript':
          setUserTranscript(msg.text);
          break;
        case 'assistant_transcript_delta':
          setAiTranscript((prev) => prev + msg.delta);
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
          setTimeout(() => {
            if (state !== STATE.PREPARING_STORY) {
              setState(STATE.READY);
              setStatusMessage('Listening...');
            }
          }, 500);
          break;
        case 'story_ready':
          handleStoryReady();
          break;
        case 'error':
          setError(msg.message);
          setState(STATE.ERROR);
          break;
        default:
          break;
      }
    };

    socket.on('rtc', handleRTC);
    return () => socket.off('rtc', handleRTC);
  }, [socket, state, isMuted]);

  const startConversation = async () => {
    setState(STATE.CREATING_SESSION);
    setStatusMessage('Preparing your session...');
    setError(null);
    setAiTranscript('');
    setUserTranscript('');

    wakeLock.enable().then(() => {});

    try {
      const response = await apiCall('/stories/start', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'storytime',
          story_mode: 'general'
        })
      });

      if (!response.ok) throw new Error('Failed to create session');
      const data = await response.json();
      setSessionId(data.session_id);

      if (socket && connected) {
        socket.emit('rtc-start', { session_id: data.session_id });
      } else {
        throw new Error('Not connected to server');
      }
    } catch (err) {
      setError(err.message);
      setState(STATE.ERROR);
    }
  };

  const handleStoryReady = async () => {
    setState(STATE.PREPARING_STORY);
    setStatusMessage('Preparing your story...');

    if (socket) {
      socket.emit('rtc-stop');
    }
    stopAudio();

    await new Promise((r) => setTimeout(r, 1200));

    setState(STATE.GENERATING_OUTLINE);
    setStatusMessage('Creating story outline...');

    try {
      const response = await apiCall(`/stories/${sessionId}/generate-outline`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to generate story');

      await new Promise((r) => setTimeout(r, 800));
      navigate(`/story/${sessionId}`);
    } catch (err) {
      setError('Failed to create story. Please try again.');
      setState(STATE.ERROR);
    }
  };

  const startMicrophone = async () => {
    try {
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

      processor.onaudioprocess = (event) => {
        if (socket?.connected && state !== STATE.PREPARING_STORY) {
          const inputData = event.inputBuffer.getChannelData(0);
          const pcm16 = float32ToPCM16(inputData);
          const base64 = arrayBufferToBase64(pcm16.buffer);
          socket.emit('rtc-audio', { audio: base64 });
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      audioProcessorRef.current = { source, processor };
    } catch (err) {
      setError('Microphone access failed. Please allow microphone access.');
      setState(STATE.ERROR);
    }
  };

  const float32ToPCM16 = (float32Array) => {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcm16;
  };

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const queueAudioChunk = (base64Audio) => {
    playbackQueueRef.current.push(base64Audio);
    if (!isPlayingRef.current) {
      playNextChunk();
    }
  };

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
      playNextChunk();
    }
  };

  const stopPlayback = () => {
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const stopAudio = () => {
    stopPlayback();
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.source.disconnect();
        audioProcessorRef.current.processor.disconnect();
      } catch (err) {
        if (err.name !== 'InvalidStateError') {
          console.warn('Audio cleanup error:', err.message);
        }
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
  };

  const endConversation = () => {
    if (socket) {
      socket.emit('rtc-stop');
    }
    stopAudio();
    wakeLock.disable();
    setState(STATE.IDLE);
    setAiTranscript('');
    setUserTranscript('');
    setSessionId(null);
  };

  const handleGenerateStory = (event) => {
    event.preventDefault();
    navigate('/configure');
  };

  const handleAdvancedOptions = () => {
    navigate('/configure');
  };

  const isRtcActive = state !== STATE.IDLE && state !== STATE.ERROR;

  return (
    <div className="min-h-screen bg-narrimo-midnight text-narrimo-cream">
      <NavBar transparent />
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 narrimo-starfield opacity-60" />
        <div className="absolute inset-x-0 top-28 h-24 narrimo-wave opacity-70" />
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-[#FF6F61]/20 blur-[120px]" />
        <div className="absolute top-1/3 -left-16 w-72 h-72 rounded-full bg-[#6A8A82]/20 blur-[120px]" />

        <main className="relative z-10">
          <section className="pt-28 pb-16 px-6">
            <div className="max-w-6xl mx-auto grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
              <div>
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-[#C0C0C0]">
                  <span className="w-2 h-2 rounded-full bg-[#FF6F61] motion-safe:animate-pulse" />
                  Narrimo Audio Studio
                </span>
                <h1 className="mt-4 text-4xl md:text-5xl font-heading font-semibold leading-tight">
                  Narrimo - narrated stories, infinitely customizable.
                </h1>
                <p className="mt-4 text-lg text-slate-200 leading-relaxed">
                  Create cinematic audio stories across any genre. Blend author-inspired style, interactive choices,
                  and story worlds that evolve with every session.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate('/configure')}
                    className="px-6 py-3 rounded-full bg-narrimo-coral text-white font-semibold shadow-lg shadow-[#FF6F61]/30
                               hover:bg-[#ff867a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    Create a Story
                  </button>
                  <button
                    onClick={() => navigate('/discover')}
                    className="px-6 py-3 rounded-full border border-white/20 text-white/90 font-semibold
                               hover:border-white/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    Browse Free Stories
                  </button>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-[#6A8A82]" />
                    Audio-first narration
                  </div>
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#6A8A82]" />
                    Branching choices
                  </div>
                  <div className="flex items-center gap-2">
                    <PenTool className="w-4 h-4 text-[#6A8A82]" />
                    Author-style tuning
                  </div>
                </div>
              </div>

              <div className="narrimo-glass narrimo-glow rounded-3xl p-6">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span className="uppercase tracking-[0.3em]">Live Demo</span>
                  <span className="text-[#FF6F61] font-semibold">Preview</span>
                </div>
                <div className="mt-6 space-y-4">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <p className="text-base text-slate-100">
                      "The city remembers every secret. Tonight, it whispers yours back."
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                      <button className="w-10 h-10 rounded-full bg-[#FF6F61] text-white flex items-center justify-center">
                        <Play className="w-4 h-4" />
                      </button>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full w-2/3 bg-gradient-to-r from-[#FF6F61] via-[#6A8A82] to-transparent" />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                          <span>01:12</span>
                          <span>03:42</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">Voice: Neo Noir</div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">Mood: Cinematic</div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">CYOA: Enabled</div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">Length: 25 min</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="launchpad" className="px-6 pb-20">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-heading">Launchpad</h2>
                <button
                  onClick={() => navigate('/configure')}
                  className="inline-flex items-center gap-2 text-sm text-[#FF6F61] hover:text-white"
                >
                  Start a Story <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="narrimo-glass rounded-3xl p-6 border border-white/10 hover:border-white/20 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#FF6F61]/20 flex items-center justify-center">
                      <Wand2 className="w-6 h-6 text-[#FF6F61]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-heading">Create Story</h3>
                      <p className="text-sm text-slate-300">Launch a fresh narration with precise controls.</p>
                    </div>
                  </div>

                  <form className="mt-6 space-y-4" onSubmit={handleGenerateStory}>
                    <label className="block text-sm text-slate-200">
                      Story prompt
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="A drifting city above the ocean, its pilots living by a forgotten oath..."
                        rows={3}
                        className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 p-3 text-sm text-slate-100
                                   focus:border-[#FF6F61] focus:outline-none"
                        aria-label="Story prompt"
                      />
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-xs text-slate-300">
                        Genre
                        <select
                          value={genre}
                          onChange={(event) => setGenre(event.target.value)}
                          className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 p-2 text-sm text-slate-100"
                          aria-label="Genre"
                        >
                          {GENRES.map((item) => (
                            <option key={item} value={item} className="text-slate-900">
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-300">
                        Mood
                        <select
                          value={mood}
                          onChange={(event) => setMood(event.target.value)}
                          className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 p-2 text-sm text-slate-100"
                          aria-label="Mood"
                        >
                          {MOODS.map((item) => (
                            <option key={item} value={item} className="text-slate-900">
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-300">
                        Duration
                        <select
                          value={duration}
                          onChange={(event) => setDuration(event.target.value)}
                          className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 p-2 text-sm text-slate-100"
                          aria-label="Duration"
                        >
                          {DURATIONS.map((item) => (
                            <option key={item} value={item} className="text-slate-900">
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-300">
                        Voice
                        <select
                          value={voice}
                          onChange={(event) => setVoice(event.target.value)}
                          className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 p-2 text-sm text-slate-100"
                          aria-label="Voice selection"
                        >
                          {VOICES.map((item) => (
                            <option key={item} value={item} className="text-slate-900">
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-slate-300 md:col-span-2">
                        Author style inspiration
                        <select
                          value={authorStyle}
                          onChange={(event) => setAuthorStyle(event.target.value)}
                          className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 p-2 text-sm text-slate-100"
                          aria-label="Author style"
                        >
                          {AUTHOR_STYLES.map((item) => (
                            <option key={item} value={item} className="text-slate-900">
                              {item}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Style inspiration respects policy boundaries and avoids verbatim imitation.
                        </p>
                      </label>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={cyoaEnabled}
                          onChange={(event) => setCyoaEnabled(event.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/10"
                          aria-label="Enable choose your own adventure"
                        />
                        Choose-your-own-adventure
                      </label>
                      <span className="text-xs text-slate-400">Est. credits: 0.6</span>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        className="px-5 py-2 rounded-full bg-narrimo-coral text-white text-sm font-semibold"
                      >
                        Generate Story
                      </button>
                      <button
                        type="button"
                        onClick={handleAdvancedOptions}
                        className="px-5 py-2 rounded-full border border-white/20 text-sm text-white/90"
                      >
                        Advanced Options
                      </button>
                    </div>
                  </form>
                </div>

                <div className="narrimo-glass rounded-3xl p-6 border border-white/10 hover:border-white/20 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#6A8A82]/20 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-[#6A8A82]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-heading">Story Bible</h3>
                      <p className="text-sm text-slate-300">Build and guard canon across worlds.</p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {STORY_BIBLE_TILES.map((tile) => (
                        <div
                          key={tile}
                          className="rounded-xl bg-white/5 border border-white/10 px-2 py-2 text-[11px] text-slate-200 text-center"
                        >
                          {tile}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <ShieldCheck className="w-4 h-4 text-[#6A8A82]" />
                        Canon Lock ready (visual toggle)
                      </div>
                      <div className="w-10 h-6 rounded-full bg-white/10 flex items-center px-1">
                        <div className="w-4 h-4 rounded-full bg-[#6A8A82]" />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        onClick={() => navigate('/story-bible')}
                        className="px-5 py-2 rounded-full bg-[#6A8A82] text-white text-sm font-semibold"
                      >
                        Open Story Bible
                      </button>
                      <button
                        onClick={() => navigate('/story-bible')}
                        className="px-5 py-2 rounded-full border border-white/20 text-sm text-white/90"
                      >
                        Create New Universe
                      </button>
                    </div>
                  </div>
                </div>

                <div className="narrimo-glass rounded-3xl p-6 border border-white/10 hover:border-white/20 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
                      <Library className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-heading">Library</h3>
                      <p className="text-sm text-slate-300">Return to your worlds and saved narrations.</p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2 text-xs">
                    {LIBRARY_TABS.map((tab) => {
                      const isSelected = libraryTab === tab;
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setLibraryTab(tab)}
                          className={`px-3 py-1 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                            isSelected
                              ? 'bg-white/10 border-white/25 text-white'
                              : 'border-white/10 text-slate-300 hover:text-white hover:border-white/25'
                          }`}
                          aria-pressed={isSelected}
                          aria-label={`Show ${tab} stories`}
                        >
                          {tab}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="block text-xs text-slate-300">
                      Genre
                      <select
                        value={libraryGenre}
                        onChange={(event) => setLibraryGenre(event.target.value)}
                        className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-200
                                   focus:border-white/30 focus:outline-none"
                        aria-label="Filter library by genre"
                      >
                        {LIBRARY_GENRE_FILTERS.map((option) => (
                          <option key={option} value={option} className="text-slate-900">
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs text-slate-300">
                      Length
                      <select
                        value={libraryLength}
                        onChange={(event) => setLibraryLength(event.target.value)}
                        className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-200
                                   focus:border-white/30 focus:outline-none"
                        aria-label="Filter library by length"
                      >
                        {LIBRARY_LENGTH_FILTERS.map((option) => (
                          <option key={option} value={option} className="text-slate-900">
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs text-slate-300">
                      Rating
                      <select
                        value={libraryRating}
                        onChange={(event) => setLibraryRating(event.target.value)}
                        className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-200
                                   focus:border-white/30 focus:outline-none"
                        aria-label="Filter library by rating"
                      >
                        {LIBRARY_RATING_FILTERS.map((option) => (
                          <option key={option} value={option} className="text-slate-900">
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {LIBRARY_PREVIEW.map((story) => (
                      <div key={story.title} className="flex items-center gap-4 rounded-2xl bg-white/5 p-3">
                        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                          <Play className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{story.title}</p>
                          <p className="text-xs text-slate-400">{story.genre.join(' | ')} | {story.length}</p>
                        </div>
                        <button className="text-xs text-[#FF6F61]">Play</button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-slate-300">
                    <span className="text-slate-400 truncate">
                      {libraryTab} • {libraryGenre} • {libraryLength} • {libraryRating}
                    </span>
                    <button
                      onClick={() => navigate('/library')}
                      className="text-[#FF6F61]"
                    >
                      Browse Library
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </section>

          <section className="px-6 pb-20">
            <div className="max-w-6xl mx-auto">
              <h2 className="text-2xl font-heading mb-6">Why Narrimo</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {WHY_NARRIMO.map((item) => (
                  <div key={item.title} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                    <p className="font-semibold text-white mb-2">{item.title}</p>
                    <p className="text-sm text-slate-300">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="px-6 pb-24">
            <div className="max-w-6xl mx-auto narrimo-glass rounded-3xl p-8 border border-white/10">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div>
                  <h3 className="text-2xl font-heading">Listen free, upgrade when ready</h3>
                  <p className="text-sm text-slate-300 mt-2">
                    Explore free stories without a subscription. Unlock advanced voices, longer sessions,
                    and premium Story Bible features when you need them.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate('/discover')}
                    className="px-6 py-3 rounded-full border border-white/20 text-white/90 font-semibold"
                  >
                    Browse Free Stories
                  </button>
                  <button
                    onClick={() => navigate('/subscription')}
                    className="px-6 py-3 rounded-full bg-white text-[#0A2342] font-semibold"
                  >
                    See Plans
                  </button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      <footer className="px-6 pb-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <img src={`${BASE_URL}assets/images/newlogo.png`} alt="Narrimo logo" className="h-12 md:h-14 w-auto object-contain" />
            <span className="text-slate-300">Narrimo</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <button className="hover:text-white">Support</button>
            <button className="hover:text-white">Terms</button>
            <button className="hover:text-white">Privacy</button>
            <button className="hover:text-white">Contact</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Home;
