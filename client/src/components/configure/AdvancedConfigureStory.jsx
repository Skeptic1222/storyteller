/**
 * AdvancedConfigureStory - Configure story generation using full Story Bible context
 *
 * This component replaces the standard Configure page when coming from Story Bible.
 * It loads ALL Story Bible data and passes it to the orchestrator for bulletproof
 * story generation that respects character names, locations, events, and lore.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Sparkles, Volume2, Users, Waves, Settings,
  BookOpen, MapPin, Swords, ScrollText, Calendar, Crown, Package,
  ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, Wand2
} from 'lucide-react';
import VoiceSelector from '../VoiceSelector';
import UserProfile from '../UserProfile';
import AccessibleToggle from '../ui/AccessibleToggle';
import { apiCall } from '../../config';

export default function AdvancedConfigureStory({ outlineId, libraryId }) {
  const navigate = useNavigate();

  // Full context from Story Bible
  const [storyContext, setStoryContext] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // AI Detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);

  // Configuration state
  const [config, setConfig] = useState({
    audience: 'general',
    story_length: 'medium',
    mood: 'exciting',
    narrator_style: 'dramatic',
    voice_id: null,
    multi_voice: true,
    hide_speech_tags: true,
    sfx_enabled: true,
    sfx_level: 'medium',
    autoplay: false
  });

  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showAllSettings, setShowAllSettings] = useState(false);

  // Load full Story Bible context on mount
  useEffect(() => {
    loadFullContext();
  }, [libraryId, outlineId]);

  const loadFullContext = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const url = outlineId
        ? `/story-bible/full-context/${libraryId}?synopsis_id=${outlineId}`
        : `/story-bible/full-context/${libraryId}`;

      const response = await apiCall(url);
      if (!response.ok) {
        throw new Error('Failed to load Story Bible data');
      }

      const data = await response.json();
      setStoryContext(data);

      // Auto-detect settings based on context
      if (data.synopsis || data.characters?.length > 0) {
        // Enable multi-voice if there are multiple characters
        const hasMultipleCharacters = data.characters?.length > 1;
        setConfig(prev => ({
          ...prev,
          multi_voice: hasMultipleCharacters,
          hide_speech_tags: hasMultipleCharacters
        }));
      }

    } catch (error) {
      console.error('Failed to load Story Bible context:', error);
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // AI-Detect Settings - analyzes full context
  const runAIDetection = async () => {
    if (!storyContext) return;

    setIsDetecting(true);
    setDetectionResult(null);

    try {
      const response = await apiCall('/story-bible/ai-detect-settings', {
        method: 'POST',
        body: JSON.stringify({ storyContext })
      });

      if (!response.ok) {
        throw new Error('AI detection failed');
      }

      const result = await response.json();
      setDetectionResult(result);

      // Apply detected settings
      if (result.settings) {
        setConfig(prev => ({
          ...prev,
          ...result.settings,
          // Ensure multi-voice is respected
          hide_speech_tags: result.settings.multi_voice ?? prev.hide_speech_tags
        }));

        // Apply voice recommendation
        if (result.settings.recommended_voice) {
          setSelectedVoice(result.settings.recommended_voice);
        }
      }

    } catch (error) {
      console.error('AI detection error:', error);
      setDetectionResult({ error: error.message });
    } finally {
      setIsDetecting(false);
    }
  };

  // Start story with full context
  const startStory = async () => {
    if (!storyContext) return;

    setIsStarting(true);
    try {
      const fullConfig = {
        ...config,
        voice_id: selectedVoice?.voice_id || config.voice_id,
        // Include full Story Bible context
        story_bible_context: storyContext,
        // Mark as advanced mode
        advanced_mode: true,
        story_bible_library_id: libraryId,
        story_bible_outline_id: outlineId
      };

      const response = await apiCall('/stories/start', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'advanced',
          config: fullConfig,
          // Pass the full context explicitly
          storyBibleContext: storyContext
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start story');
      }

      const data = await response.json();
      navigate(`/story/${data.session_id}`);

    } catch (error) {
      console.error('Failed to start story:', error);
      setIsStarting(false);
    }
  };

  // Render loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-golden-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading Story Bible...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-red-300 mb-4">{loadError}</p>
          <button
            onClick={() => navigate('/story-bible')}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
          >
            Back to Story Bible
          </button>
        </div>
      </div>
    );
  }

  const synopsis = storyContext?.synopsis;
  const outline = storyContext?.outline;
  const counts = storyContext?.counts || {};

  return (
    <div className="min-h-screen pb-24 bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center p-4 bg-slate-900/90 backdrop-blur border-b border-slate-700">
        <button onClick={() => navigate('/story-bible')} className="p-2 rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-6 h-6 text-slate-300" />
        </button>
        <h1 className="flex-1 text-center text-xl font-semibold text-golden-400">
          Advanced Story Setup
        </h1>
        <UserProfile />
      </header>

      <main className="px-4 py-6 space-y-6 max-w-2xl mx-auto">
        {/* Story Bible Summary */}
        <section className="bg-gradient-to-br from-purple-500/20 to-slate-800 rounded-2xl p-5 border border-purple-500/30">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <BookOpen className="w-8 h-8 text-purple-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-white mb-1">
                {synopsis?.title || 'Untitled Story'}
              </h2>
              {synopsis?.logline && (
                <p className="text-slate-300 text-sm mb-3">{synopsis.logline}</p>
              )}

              {/* Data badges */}
              <div className="flex flex-wrap gap-2">
                {counts.chapters > 0 && (
                  <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs flex items-center gap-1">
                    <ScrollText className="w-3 h-3" />
                    {counts.chapters} Chapters
                  </span>
                )}
                {counts.characters > 0 && (
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {counts.characters} Characters
                  </span>
                )}
                {counts.locations > 0 && (
                  <span className="px-2 py-1 bg-green-500/20 text-green-300 rounded-full text-xs flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {counts.locations} Locations
                  </span>
                )}
                {counts.events > 0 && (
                  <span className="px-2 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {counts.events} Events
                  </span>
                )}
                {counts.items > 0 && (
                  <span className="px-2 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-xs flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    {counts.items} Items
                  </span>
                )}
                {counts.factions > 0 && (
                  <span className="px-2 py-1 bg-red-500/20 text-red-300 rounded-full text-xs flex items-center gap-1">
                    <Crown className="w-3 h-3" />
                    {counts.factions} Factions
                  </span>
                )}
                {counts.lore > 0 && (
                  <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-xs flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    {counts.lore} Lore
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Synopsis preview */}
          {synopsis?.synopsis && (
            <div className="mt-4 p-3 bg-slate-900/50 rounded-xl">
              <p className="text-slate-300 text-sm line-clamp-3">{synopsis.synopsis}</p>
            </div>
          )}
        </section>

        {/* AI-Detect Settings Button */}
        <section className="bg-gradient-to-br from-golden-400/20 to-slate-800 rounded-2xl p-5 border border-golden-400/30">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-medium text-golden-400 flex items-center gap-2">
                <Wand2 className="w-5 h-5" />
                AI-Detect Settings
              </h3>
              <p className="text-slate-400 text-sm">
                Analyzes your Story Bible to auto-configure optimal settings
              </p>
            </div>
            <button
              onClick={runAIDetection}
              disabled={isDetecting}
              className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
                isDetecting
                  ? 'bg-golden-400/50 text-slate-900 animate-pulse'
                  : 'bg-golden-400 hover:bg-golden-500 text-slate-900'
              }`}
            >
              {isDetecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Detect Settings
                </>
              )}
            </button>
          </div>

          {/* Detection result */}
          {detectionResult && (
            <div className={`mt-3 p-3 rounded-xl text-sm ${
              detectionResult.error
                ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                : 'bg-green-500/10 border border-green-500/30 text-green-300'
            }`}>
              {detectionResult.error ? (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {detectionResult.error}
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 font-medium mb-2">
                    <CheckCircle className="w-4 h-4" />
                    Settings auto-configured!
                  </div>
                  {detectionResult.reasoning && (
                    <ul className="text-xs space-y-1 text-slate-300">
                      {(Array.isArray(detectionResult.reasoning)
                        ? detectionResult.reasoning
                        : (detectionResult.reasoning || '').split('\n').filter(Boolean)
                      ).map((reason, i) => (
                        <li key={i}>• {reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Quick Settings */}
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-slate-100">Quick Settings</h3>

          {/* Audience */}
          <div>
            <label className="text-slate-300 text-sm mb-2 block">Audience</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'children', label: 'Children', icon: '👶' },
                { id: 'general', label: 'General', icon: '👨‍👩‍👧' },
                { id: 'mature', label: 'Mature', icon: '🔞' }
              ].map(aud => (
                <button
                  key={aud.id}
                  onClick={() => setConfig(prev => ({ ...prev, audience: aud.id }))}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    config.audience === aud.id
                      ? 'border-golden-400 bg-slate-800'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                  }`}
                >
                  <div className="text-xl mb-1">{aud.icon}</div>
                  <div className="text-slate-100 text-sm">{aud.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Voice Acted Dialog (VAD) */}
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-golden-400" />
                Voice Acted Dialog
              </div>
              <div className="text-slate-400 text-sm">
                Different voices for {counts.characters} characters
              </div>
            </div>
            <AccessibleToggle
              enabled={config.multi_voice}
              onChange={(value) => setConfig(prev => ({
                ...prev,
                multi_voice: value,
                hide_speech_tags: value
              }))}
              label="Voice Acted Dialog"
              description="Each character has their own voice actor"
              colorOn="bg-golden-400"
              size="large"
              showLabel={true}
            />
          </div>

          {/* Hide Speech Tags (sub-option when VAD is enabled) */}
          {config.multi_voice && (
            <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl ml-4 border-l-2 border-golden-400/30">
              <div>
                <div className="text-slate-100 font-medium text-sm">
                  Streamlined Attribution
                </div>
                <div className="text-slate-400 text-xs">
                  Remove "he said/she replied" - you'll hear who's speaking
                </div>
              </div>
              <AccessibleToggle
                enabled={config.hide_speech_tags}
                onChange={(value) => setConfig(prev => ({ ...prev, hide_speech_tags: value }))}
                label="Hide Speech Tags"
                description="Remove redundant speech attribution"
                colorOn="bg-golden-400/70"
                size="small"
                showLabel={false}
              />
            </div>
          )}

          {/* Sound Effects */}
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
            <div>
              <div className="text-slate-100 font-medium flex items-center gap-2">
                <Waves className="w-4 h-4 text-cyan-400" />
                Sound Effects
              </div>
              <div className="text-slate-400 text-sm">
                Atmospheric audio for {counts.locations} locations
              </div>
            </div>
            <AccessibleToggle
              enabled={config.sfx_enabled}
              onChange={(value) => setConfig(prev => ({ ...prev, sfx_enabled: value }))}
              label="Sound Effects"
              description="Add atmospheric sounds"
              colorOn="bg-cyan-400"
              size="large"
              showLabel={true}
            />
          </div>
        </section>

        {/* Show All Settings Toggle */}
        <button
          onClick={() => setShowAllSettings(!showAllSettings)}
          className="w-full flex items-center justify-center gap-2 py-3 text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showAllSettings ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Hide Advanced Settings
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Show All Settings
            </>
          )}
        </button>

        {/* Advanced Settings */}
        {showAllSettings && (
          <section className="space-y-4 border-t border-slate-700 pt-4">
            {/* Story Length */}
            <div>
              <label className="text-slate-300 text-sm mb-2 block">Story Length</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'short', label: 'Short', desc: '~5 min' },
                  { id: 'medium', label: 'Medium', desc: '~15 min' },
                  { id: 'long', label: 'Long', desc: '~30 min' }
                ].map(len => (
                  <button
                    key={len.id}
                    onClick={() => setConfig(prev => ({ ...prev, story_length: len.id }))}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      config.story_length === len.id
                        ? 'border-golden-400 bg-slate-800'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-slate-100 font-medium">{len.label}</div>
                    <div className="text-slate-400 text-xs">{len.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mood */}
            <div>
              <label className="text-slate-300 text-sm mb-2 block">Story Mood</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'calm', label: 'Calm', icon: '😌' },
                  { id: 'exciting', label: 'Exciting', icon: '⚡' },
                  { id: 'scary', label: 'Scary', icon: '😨' },
                  { id: 'funny', label: 'Funny', icon: '😄' },
                  { id: 'mysterious', label: 'Mysterious', icon: '🔮' },
                  { id: 'dramatic', label: 'Dramatic', icon: '🎭' }
                ].map(mood => (
                  <button
                    key={mood.id}
                    onClick={() => setConfig(prev => ({ ...prev, mood: mood.id }))}
                    className={`p-2 rounded-xl border-2 transition-all text-center ${
                      config.mood === mood.id
                        ? 'border-golden-400 bg-slate-800'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-lg">{mood.icon}</div>
                    <div className="text-slate-100 text-xs">{mood.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Selection */}
            <div>
              <h4 className="text-slate-300 text-sm mb-2 flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Narrator Voice
              </h4>
              <VoiceSelector
                selectedVoice={selectedVoice}
                onSelect={setSelectedVoice}
                narratorStyle={config.narrator_style}
              />
            </div>

            {/* SFX Level */}
            {config.sfx_enabled && (
              <div>
                <label className="text-slate-300 text-sm mb-2 block">Sound Effect Intensity</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'low', name: 'Subtle', desc: 'Key moments' },
                    { id: 'medium', name: 'Balanced', desc: 'Regular sounds' },
                    { id: 'high', name: 'Immersive', desc: 'Full atmosphere' }
                  ].map(level => (
                    <button
                      key={level.id}
                      onClick={() => setConfig(prev => ({ ...prev, sfx_level: level.id }))}
                      className={`py-2 px-3 rounded-lg text-xs transition-all ${
                        config.sfx_level === level.id
                          ? 'bg-cyan-500/30 border-2 border-cyan-400 text-cyan-300'
                          : 'bg-slate-700/50 border border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      <div className="font-medium">{level.name}</div>
                      <div className="text-[10px] opacity-70">{level.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-play */}
            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
              <div>
                <div className="text-slate-100 font-medium">Auto-Play</div>
                <div className="text-slate-400 text-sm">Continue automatically</div>
              </div>
              <AccessibleToggle
                enabled={config.autoplay}
                onChange={(value) => setConfig(prev => ({ ...prev, autoplay: value }))}
                label="Auto-Play"
                description="Automatically continue to the next scene"
                colorOn="bg-green-500"
                size="large"
                showLabel={true}
              />
            </div>
          </section>
        )}

        {/* Characters Preview */}
        {storyContext?.characters?.length > 0 && (
          <section className="bg-slate-800/30 rounded-xl p-4 border border-slate-700">
            <h4 className="text-slate-300 text-sm mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Characters ({storyContext.characters.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {storyContext.characters.slice(0, 8).map((char, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded-full text-xs ${
                    char.role === 'protagonist'
                      ? 'bg-golden-400/20 text-golden-300'
                      : char.role === 'antagonist'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {char.name}
                </span>
              ))}
              {storyContext.characters.length > 8 && (
                <span className="px-2 py-1 text-slate-500 text-xs">
                  +{storyContext.characters.length - 8} more
                </span>
              )}
            </div>
          </section>
        )}

        {/* Outline Preview */}
        {outline?.chapters?.length > 0 && (
          <section className="bg-slate-800/30 rounded-xl p-4 border border-slate-700">
            <h4 className="text-slate-300 text-sm mb-3 flex items-center gap-2">
              <ScrollText className="w-4 h-4" />
              Outline ({outline.chapters.length} Chapters)
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {outline.chapters.map((chapter, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="text-slate-500 font-mono w-6">{i + 1}.</span>
                  <span className="text-slate-200">{chapter.title}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Start Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent">
        <div className="max-w-md mx-auto">
          <button
            onClick={startStory}
            disabled={isStarting || !storyContext}
            className="w-full py-4 px-6 bg-golden-400 hover:bg-golden-500 rounded-xl
                       text-slate-900 font-semibold text-lg transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-3 shadow-lg shadow-golden-400/20"
          >
            {isStarting ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Generating Story...
              </>
            ) : (
              <>
                <Play className="w-6 h-6" />
                Generate Story
              </>
            )}
          </button>
          <p className="text-center text-slate-500 text-xs mt-2">
            Using full Story Bible context for accurate generation
          </p>
        </div>
      </div>
    </div>
  );
}
