import { useState, useEffect, useRef } from 'react';
import { Volume2, Check, Play, Loader, Sparkles, User, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { apiCall, API_BASE } from '../config';

// All 8 narrator styles with their settings
const NARRATOR_STYLES = {
  warm: { name: 'Warm', stability: 0.7, similarity: 0.8, style: 0.2, icon: '🌅', color: 'bg-orange-500/20 text-orange-400' },
  dramatic: { name: 'Dramatic', stability: 0.3, similarity: 0.85, style: 0.8, icon: '🎭', color: 'bg-red-500/20 text-red-400' },
  playful: { name: 'Playful', stability: 0.5, similarity: 0.75, style: 0.6, icon: '🎪', color: 'bg-green-500/20 text-green-400' },
  mysterious: { name: 'Mysterious', stability: 0.8, similarity: 0.9, style: 0.3, icon: '🌙', color: 'bg-purple-500/20 text-purple-400' },
  horror: { name: 'Horror', stability: 0.85, similarity: 0.9, style: 0.25, icon: '👻', color: 'bg-gray-500/20 text-gray-400' },
  epic: { name: 'Epic', stability: 0.4, similarity: 0.85, style: 0.7, icon: '⚔️', color: 'bg-yellow-500/20 text-yellow-400' },
  whimsical: { name: 'Whimsical', stability: 0.45, similarity: 0.7, style: 0.55, icon: '✨', color: 'bg-pink-500/20 text-pink-400' },
  noir: { name: 'Noir', stability: 0.75, similarity: 0.85, style: 0.35, icon: '🎬', color: 'bg-slate-500/20 text-slate-400' }
};

// 4 primary mood buttons shown directly on each voice card
const PRIMARY_MOODS = ['warm', 'dramatic', 'playful', 'horror'];

function VoiceSelector({ selectedVoice, onSelect, narratorStyle = 'warm', skipAutoSelect = false }) {
  const [voices, setVoices] = useState({ male: [], female: [], all: [] });
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState(null);
  const [styledPreviewingId, setStyledPreviewingId] = useState(null);
  const [previewingStyle, setPreviewingStyle] = useState(null); // Which style is being previewed
  const [expandedVoice, setExpandedVoice] = useState(null); // Which voice has expanded style selector
  const [genderFilter, setGenderFilter] = useState('all'); // 'all', 'male', 'female'
  const audioRef = useRef(null);

  useEffect(() => {
    fetchVoices();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Auto-select a default voice if none selected (critical fix for voice selection bug)
  // Skip auto-select if smart config will set the voice (skipAutoSelect=true)
  useEffect(() => {
    if (!selectedVoice && !loading && voices.male.length > 0 && !skipAutoSelect) {
      // Default voice mapping based on narrator style
      const styleVoiceMap = {
        warm: 'JBFqnCBsd6RMkjVDRZzb',      // George - warm storyteller
        dramatic: 'nPczCjzI2devNBz1zQrb',   // Brian - dramatic
        mysterious: 'N2lVS1w4EtoT3dr4eOWO', // Callum - mysterious
        playful: 'nPczCjzI2devNBz1zQrb'     // Brian - expressive
      };

      const defaultVoiceId = styleVoiceMap[narratorStyle] || styleVoiceMap.warm;

      // Find the voice in our list
      const defaultVoice = voices.all.find(v => v.voice_id === defaultVoiceId) ||
                          voices.male[0] ||
                          voices.all[0];

      if (defaultVoice) {
        console.log('[VoiceSelector] Auto-selecting default voice:', defaultVoice.name, defaultVoice.voice_id);
        onSelect(defaultVoice);
      }
    } else if (skipAutoSelect && !selectedVoice && !loading) {
      console.log('[VoiceSelector] Skipping auto-select - smart config will set voice');
    }
  }, [loading, voices, selectedVoice, narratorStyle, onSelect, skipAutoSelect]);

  const fetchVoices = async () => {
    try {
      // Use the recommended voices endpoint which has organized categories
      const response = await apiCall('/voices/recommended');
      const data = await response.json();

      if (data.voices) {
        // Collect all voices from all categories
        const maleNarrators = data.voices.male_narrators || [];
        const femaleNarrators = data.voices.female_narrators || [];
        const characterVoices = data.voices.character_voices || [];
        const expressiveVoices = data.voices.expressive_voices || [];

        // Combine all voices into one array
        const allVoices = [
          ...maleNarrators.map(v => ({ ...v, category: 'narrator' })),
          ...femaleNarrators.map(v => ({ ...v, category: 'narrator' })),
          ...characterVoices.map(v => ({ ...v, category: 'character' })),
          ...expressiveVoices.map(v => ({ ...v, category: 'expressive' }))
        ];

        // Properly categorize ALL voices by their gender field
        const maleVoices = allVoices.filter(v => v.gender === 'male');
        const femaleVoices = allVoices.filter(v => v.gender === 'female');

        setVoices({
          male: maleVoices,
          female: femaleVoices,
          all: allVoices
        });
      }
    } catch (error) {
      console.error('Failed to fetch recommended voices:', error);
      // Fallback to basic voices endpoint
      try {
        const fallback = await apiCall('/voices');
        const data = await fallback.json();
        const allVoices = data.recommended || data.voices || [];
        setVoices({
          male: allVoices.filter(v => v.gender === 'male'),
          female: allVoices.filter(v => v.gender === 'female'),
          all: allVoices
        });
      } catch (e) {
        console.error('Fallback also failed:', e);
      }
    } finally {
      setLoading(false);
    }
  };

  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewingId(null);
    setStyledPreviewingId(null);
    setPreviewingStyle(null);
  };

  // Preview voice using our backend
  const previewVoice = async (voice) => {
    stopCurrentAudio();

    const voiceId = voice.voice_id;
    setPreviewingId(voiceId);

    try {
      const response = await apiCall('/voices/preview', {
        method: 'POST',
        body: JSON.stringify({
          voice_id: voiceId,
          text: 'Once upon a time, in a land of wonder and mystery, there lived a brave adventurer.'
        })
      });

      if (!response.ok) throw new Error('Failed to generate preview');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setPreviewingId(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.onerror = () => {
        console.error('Failed to play preview audio');
        setPreviewingId(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      await audio.play();
    } catch (error) {
      console.error('Failed to preview voice:', error);
      setPreviewingId(null);
    }
  };

  // Preview voice with a specific narrator style
  const previewVoiceWithSpecificStyle = async (voice, styleKey) => {
    stopCurrentAudio();

    const voiceId = voice.voice_id;
    const styleConfig = NARRATOR_STYLES[styleKey] || NARRATOR_STYLES.warm;

    setStyledPreviewingId(voiceId);
    setPreviewingStyle(styleKey);

    // Different sample texts for different styles
    const sampleTexts = {
      warm: 'Once upon a time, in a cozy cottage by the sea, a little mouse dreamed of adventure.',
      dramatic: 'The kingdom stood on the brink of war. Only one hero could turn the tide of battle.',
      playful: 'Whoosh! The silly wizard tripped over his own beard again, sending sparkles everywhere!',
      mysterious: 'The shadows grew longer as night approached. Something ancient stirred in the darkness.',
      horror: 'The floorboards creaked behind her. She was certain she was alone in the house...',
      epic: 'Dragons soared across the crimson sky as the final battle for Middle Earth began.',
      whimsical: 'The teacup giggled as it hopped across the table, followed by a very confused butterfly.',
      noir: 'Rain hammered the city streets. She walked in, trouble written all over her face.'
    };

    try {
      const response = await apiCall('/voices/preview', {
        method: 'POST',
        body: JSON.stringify({
          voice_id: voiceId,
          text: sampleTexts[styleKey] || sampleTexts.warm,
          voice_settings: {
            stability: styleConfig.stability,
            similarity_boost: styleConfig.similarity,
            style: styleConfig.style,
            model_id: 'eleven_v3' // V3 supports audio emotion tags
          }
        })
      });

      if (!response.ok) throw new Error('Failed to generate styled preview');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setStyledPreviewingId(null);
        setPreviewingStyle(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.onerror = () => {
        console.error('Failed to play styled preview');
        setStyledPreviewingId(null);
        setPreviewingStyle(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      await audio.play();
    } catch (error) {
      console.error('Failed to preview voice with style:', error);
      setStyledPreviewingId(null);
      setPreviewingStyle(null);
    }
  };

  // Legacy function for compatibility - uses current narrator style
  const previewVoiceWithStyle = async (voice) => {
    await previewVoiceWithSpecificStyle(voice, narratorStyle);
  };

  // Normalize voice selection to consistent format
  const handleSelect = (voice) => {
    onSelect({
      voice_id: voice.voice_id,
      name: voice.name,
      description: voice.description,
      style: voice.style
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  const displayVoices = genderFilter === 'male' ? voices.male :
                        genderFilter === 'female' ? voices.female :
                        voices.all;

  if (displayVoices.length === 0) {
    return (
      <div className="p-4 bg-slate-800/50 rounded-xl text-center text-slate-400">
        No voices available. Using default narrator.
      </div>
    );
  }

  const styleLabels = {
    warm: 'Warm',
    dramatic: 'Dramatic',
    playful: 'Playful',
    mysterious: 'Mysterious',
    horror: 'Horror',
    epic: 'Epic',
    whimsical: 'Whimsical',
    noir: 'Noir'
  };

  return (
    <div className="space-y-3">
      {/* Gender filter buttons */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setGenderFilter('all')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1 ${
            genderFilter === 'all'
              ? 'bg-golden-400 text-slate-900'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          <Users className="w-4 h-4" />
          All ({voices.all.length})
        </button>
        <button
          onClick={() => setGenderFilter('male')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
            genderFilter === 'male'
              ? 'bg-blue-500 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Male ({voices.male.length})
        </button>
        <button
          onClick={() => setGenderFilter('female')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
            genderFilter === 'female'
              ? 'bg-pink-500 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Female ({voices.female.length})
        </button>
      </div>

      {/* Style indicator */}
      <div className="text-slate-400 text-xs flex items-center gap-2">
        <Sparkles className="w-3 h-3" />
        Style preview will use: <span className="text-golden-400">{styleLabels[narratorStyle] || narratorStyle}</span>
      </div>

      {/* Voice list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {displayVoices.map((voice) => {
          const voiceId = voice.voice_id;
          const isSelected = selectedVoice?.voice_id === voiceId;
          const isExpanded = expandedVoice === voiceId;
          const isThisVoicePreviewing = styledPreviewingId === voiceId;

          return (
            <div
              key={voiceId}
              className={`w-full p-3 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-golden-400 bg-slate-800'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              {/* Top row: Voice info and selection */}
              <div className="flex items-center gap-2 mb-2">
                {/* Voice info - tap to select */}
                <button
                  onClick={() => handleSelect(voice)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-100 font-medium truncate">{voice.name}</span>
                    {voice.gender && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        voice.gender === 'female' ? 'bg-pink-500/20 text-pink-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {voice.gender === 'female' ? '♀' : '♂'}
                      </span>
                    )}
                    {voice.category && voice.category !== 'narrator' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        voice.category === 'character' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {voice.category === 'character' ? 'char' : 'expr'}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-4 h-4 text-golden-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-slate-400 text-xs truncate">
                    {voice.description || voice.style || ''}
                  </div>
                </button>
              </div>

              {/* Bottom row: 4 mood sample buttons + more button */}
              <div className="flex items-center gap-1.5">
                {/* 4 Primary mood buttons */}
                {PRIMARY_MOODS.map((moodKey) => {
                  const moodConfig = NARRATOR_STYLES[moodKey];
                  const isPreviewingThisMood = isThisVoicePreviewing && previewingStyle === moodKey;
                  return (
                    <button
                      key={moodKey}
                      onClick={(e) => {
                        e.stopPropagation();
                        previewVoiceWithSpecificStyle(voice, moodKey);
                      }}
                      disabled={isPreviewingThisMood}
                      title={`Preview ${moodConfig.name} style`}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all ${
                        isPreviewingThisMood
                          ? 'bg-golden-400/30 ring-1 ring-golden-400'
                          : `${moodConfig.color} hover:opacity-80`
                      }`}
                    >
                      {isPreviewingThisMood ? (
                        <Loader className="w-3 h-3 animate-spin" />
                      ) : (
                        <span>{moodConfig.icon}</span>
                      )}
                      <span className="hidden sm:inline">{moodConfig.name}</span>
                    </button>
                  );
                })}

                {/* More styles button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedVoice(isExpanded ? null : voiceId);
                  }}
                  title={isExpanded ? 'Hide more styles' : 'Show all 8 styles'}
                  className={`px-2 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1 ${
                    isExpanded ? 'bg-golden-400/30 text-golden-400' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <>
                      <span>+4</span>
                      <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </button>
              </div>

              {/* Expanded: Additional 4 styles */}
              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-slate-700">
                  <div className="text-slate-500 text-[10px] mb-1.5">More styles:</div>
                  <div className="flex items-center gap-1.5">
                    {Object.entries(NARRATOR_STYLES)
                      .filter(([styleKey]) => !PRIMARY_MOODS.includes(styleKey))
                      .map(([styleKey, styleConfig]) => {
                        const isPreviewingThisStyle = isThisVoicePreviewing && previewingStyle === styleKey;
                        return (
                          <button
                            key={styleKey}
                            onClick={(e) => {
                              e.stopPropagation();
                              previewVoiceWithSpecificStyle(voice, styleKey);
                            }}
                            disabled={isPreviewingThisStyle}
                            title={`Preview ${styleConfig.name} style`}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all ${
                              isPreviewingThisStyle
                                ? 'bg-golden-400/30 ring-1 ring-golden-400'
                                : `${styleConfig.color} hover:opacity-80`
                            }`}
                          >
                            {isPreviewingThisStyle ? (
                              <Loader className="w-3 h-3 animate-spin" />
                            ) : (
                              <span>{styleConfig.icon}</span>
                            )}
                            <span className="hidden sm:inline">{styleConfig.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Voice count */}
      <div className="text-slate-500 text-xs text-center">
        {displayVoices.length} voices available
      </div>
    </div>
  );
}

export default VoiceSelector;
