/**
 * ScriptEditor Page
 * Route: /script/:sessionId
 *
 * Full voice-direction editor for a generated story script.
 * Allows per-segment emotion / stability / style overrides,
 * single-segment preview, and bulk render-all.
 *
 * Design: mobile-first (390 x 844), dark theme, Tailwind only.
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useScriptEditor from '../hooks/useScriptEditor';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const EMOTIONS = [
  { value: 'excited',   label: 'Excited',   color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { value: 'sad',       label: 'Sad',       color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  { value: 'angry',     label: 'Angry',     color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  { value: 'calm',      label: 'Calm',      color: 'bg-teal-500/20 text-teal-300 border-teal-500/40' },
  { value: 'fearful',   label: 'Fearful',   color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { value: 'surprised', label: 'Surprised', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  { value: 'whisper',   label: 'Whisper',   color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  { value: 'shouting',  label: 'Shouting',  color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
];

const STABILITY_OPTIONS = [
  { label: 'Creative', value: 0.3 },
  { label: 'Natural',  value: 0.5 },
  { label: 'Robust',   value: 0.8 }
];

const STATUS_RENDER_LABELS = {
  pending:   'Pending',
  rendering: 'Rendering...',
  rendered:  'Rendered',
  stale:     'Stale',
  error:     'Error'
};

// ------------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------------

/**
 * Generate a deterministic hue from a character name string.
 * Narrator always returns a neutral gray.
 */
function charHue(name = '') {
  if (!name || /narrator/i.test(name)) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * Tailwind-compatible inline color style for a speaker label.
 * Returns an object with color and borderColor CSS properties.
 */
function speakerStyle(name = '') {
  const hue = charHue(name);
  if (hue === null) return { color: '#94a3b8', borderColor: '#475569' };
  return {
    color: `hsl(${hue}, 70%, 72%)`,
    borderColor: `hsl(${hue}, 50%, 40%)`
  };
}

/** Return css color string for a speaker dot */
function speakerDotColor(name = '') {
  const hue = charHue(name);
  if (hue === null) return '#64748b';
  return `hsl(${hue}, 65%, 60%)`;
}

/** Get emotion config by value */
function getEmotion(value) {
  return EMOTIONS.find(e => e.value === value) || EMOTIONS[3]; // default: calm
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

/** Pulsing skeleton bar for loading state */
function SkeletonBar({ className = '' }) {
  return (
    <div
      className={`animate-pulse bg-slate-700/60 rounded ${className}`}
    />
  );
}

/** Skeleton for the full loading state */
function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <SkeletonBar className="h-8 w-2/3" />
      <SkeletonBar className="h-4 w-1/3" />
      <div className="mt-4 flex flex-col gap-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-slate-800 rounded-lg p-3 flex flex-col gap-2">
            <SkeletonBar className="h-3 w-1/4" />
            <SkeletonBar className="h-4 w-full" />
            <SkeletonBar className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Spinning loader icon (SVG, no external deps) */
function SpinnerIcon({ className = 'w-4 h-4' }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

/** Audio status dot indicator */
function StatusDot({ status, isRendering }) {
  if (isRendering) {
    return <SpinnerIcon className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
  }
  const dotMap = {
    rendered:  'bg-green-400',
    stale:     'bg-yellow-400',
    error:     'bg-red-400',
    pending:   'bg-slate-500',
    rendering: 'bg-blue-400 animate-pulse'
  };
  const cls = dotMap[status] || 'bg-slate-500';
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`}
      title={STATUS_RENDER_LABELS[status] || 'Unknown'}
    />
  );
}

/** Emotion badge chip */
function EmotionBadge({ emotion, small = false }) {
  const cfg = getEmotion(emotion);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${cfg.color} ${small ? 'text-[10px]' : 'text-xs'}`}
    >
      {cfg.label}
    </span>
  );
}

/** Error toast that auto-dismisses */
function ErrorToast({ message, onClose }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red-900/90 border border-red-500/60 text-red-200 text-sm px-4 py-2.5 rounded-xl shadow-xl max-w-xs text-center">
      <span>{message}</span>
      <button onClick={onClose} className="text-red-400 hover:text-red-200 ml-1">
        <CloseIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Inline SVG icons (no external lib) */
function ChevronDownIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronRightIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CloseIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ArrowLeftIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function PlayIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function RefreshIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.46-4.46M20 15a9 9 0 01-15.46 4.46" />
    </svg>
  );
}

function MicIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}

function UsersIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-5.657-3.657M9 20H4v-2a4 4 0 015.657-3.657M15 7a4 4 0 11-8 0 4 4 0 018 0zm6 3a3 3 0 11-6 0 3 3 0 016 0zM3 10a3 3 0 116 0 3 3 0 01-6 0z" />
    </svg>
  );
}

function DownloadIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

// ------------------------------------------------------------------
// Voice Cast Panel (collapsible accordion)
// ------------------------------------------------------------------

function VoiceCastPanel({ characters = [] }) {
  const [expanded, setExpanded] = useState(false);

  if (characters.length === 0) return null;

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden mx-4 mb-4">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-3 bg-slate-800/80 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-slate-200 font-medium text-sm">
          <UsersIcon className="w-4 h-4 text-slate-400" />
          Voice Cast
          <span className="text-slate-500 text-xs font-normal">({characters.length})</span>
        </div>
        <ChevronDownIcon
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="bg-slate-900/60 divide-y divide-slate-700/50">
          {characters.map(char => {
            const hue = charHue(char.name);
            const dotColor = speakerDotColor(char.name);
            return (
              <div key={char.id} className="flex items-center gap-3 px-3 py-2.5">
                {/* Character color dot */}
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: dotColor }}
                />

                {/* Name */}
                <span
                  className="text-sm font-medium flex-1 truncate"
                  style={{ color: hue === null ? '#94a3b8' : `hsl(${hue}, 70%, 72%)` }}
                >
                  {char.name}
                </span>

                {/* Voice name */}
                <span className="text-xs text-slate-500 truncate max-w-[120px]">
                  {char.voice_name || char.voice_id || 'No voice'}
                </span>

                {/* Coming soon tooltip area */}
                <div className="relative group">
                  <button
                    className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5 hover:border-slate-600 cursor-not-allowed opacity-60"
                    disabled
                    aria-label="Voice change coming soon"
                  >
                    Change
                  </button>
                  <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 bg-slate-700 text-slate-300 text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Coming soon
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Segment Row
// ------------------------------------------------------------------

function SegmentRow({ segment, isSelected, isRendering, onSelect }) {
  const emotion = segment.overrides?.emotion || segment.ai_emotion || segment.emotion;
  const truncated = (segment.text || '').slice(0, 100);
  const hasMore = (segment.text || '').length > 100;
  const sStyle = speakerStyle(segment.speaker);
  const dotColor = speakerDotColor(segment.speaker);

  return (
    <button
      onClick={() => onSelect(segment.id)}
      disabled={isRendering}
      className={`
        w-full text-left p-3 rounded-lg border transition-all duration-150
        ${isSelected
          ? 'bg-slate-700/70 border-slate-500 ring-1 ring-slate-400/30'
          : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'
        }
        ${isRendering ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <div className="flex items-start gap-2">
        {/* Speaker dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
          style={{ backgroundColor: dotColor }}
        />

        <div className="flex-1 min-w-0">
          {/* Speaker label + status + emotion */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-xs font-semibold uppercase tracking-wide border-b"
              style={sStyle}
            >
              {segment.speaker || 'Narrator'}
            </span>
            <StatusDot status={segment.render_status} isRendering={isRendering} />
            {emotion && <EmotionBadge emotion={emotion} small />}
          </div>

          {/* Truncated text */}
          <p className="text-slate-300 text-sm leading-relaxed line-clamp-2">
            {truncated}{hasMore && <span className="text-slate-500">…</span>}
          </p>
        </div>

        {/* Expand chevron */}
        {isSelected
          ? <ChevronDownIcon className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
          : <ChevronRightIcon className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
        }
      </div>
    </button>
  );
}

// ------------------------------------------------------------------
// Scene Block
// ------------------------------------------------------------------

function SceneBlock({ scene, sceneIndex, selectedSegmentId, renderingSegments, onSelectSegment }) {
  return (
    <div className="mb-6">
      {/* Scene header */}
      <div className="flex items-center gap-2 px-4 mb-2">
        <div className="h-px flex-1 bg-slate-700/60" />
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 px-2">
          Scene {sceneIndex + 1}
          {scene.title ? ` — ${scene.title}` : ''}
        </span>
        <div className="h-px flex-1 bg-slate-700/60" />
      </div>

      {/* Segment list */}
      <div className="flex flex-col gap-1.5 px-4">
        {(scene.segments || []).map(seg => (
          <SegmentRow
            key={seg.id}
            segment={seg}
            isSelected={selectedSegmentId === seg.id}
            isRendering={renderingSegments.has(seg.id)}
            onSelect={onSelectSegment}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Segment Voice Controls (bottom sheet)
// ------------------------------------------------------------------

function SegmentVoiceControls({
  segment,
  isRendering,
  onClose,
  onUpdate,
  onPreview,
  onRender,
  onResetToAI
}) {
  const sheetRef = useRef(null);
  const audioRef = useRef(null);

  // Local form state - initialized from segment's current overrides / AI defaults
  const [emotion, setEmotion] = useState(
    segment.overrides?.emotion || segment.ai_emotion || segment.emotion || 'calm'
  );
  const [stability, setStability] = useState(
    segment.overrides?.stability ?? segment.ai_stability ?? 0.5
  );
  const [style, setStyle] = useState(
    segment.overrides?.style ?? segment.ai_style ?? 0.5
  );

  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Sync form if segment changes (e.g. after server update)
  useEffect(() => {
    setEmotion(segment.overrides?.emotion || segment.ai_emotion || segment.emotion || 'calm');
    setStability(segment.overrides?.stability ?? segment.ai_stability ?? 0.5);
    setStyle(segment.overrides?.style ?? segment.ai_style ?? 0.5);
    setIsDirty(false);
  }, [segment.id]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Tap outside to close
  useEffect(() => {
    function handleOutside(e) {
      if (sheetRef.current && !sheetRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [onClose]);

  const handleEmotionChange = (val) => { setEmotion(val); setIsDirty(true); };
  const handleStabilityChange = (val) => { setStability(val); setIsDirty(true); };
  const handleStyleChange = (val) => { setStyle(val); setIsDirty(true); };

  const saveOverrides = useCallback(async () => {
    setSaving(true);
    try {
      await onUpdate(segment.id, { emotion, stability, style });
      setIsDirty(false);
    } catch (err) {
      console.error('[SegmentVoiceControls] save error:', err);
    } finally {
      setSaving(false);
    }
  }, [segment.id, emotion, stability, style, onUpdate]);

  const handlePreview = useCallback(async () => {
    // Save pending changes first
    if (isDirty) await saveOverrides();

    setPreviewing(true);
    setPreviewError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      const url = await onPreview(segment.id);
      setPreviewUrl(url);
      // Auto-play
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      setPreviewError(err.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }, [segment.id, isDirty, previewUrl, saveOverrides, onPreview]);

  const handleRender = useCallback(async () => {
    if (isDirty) await saveOverrides();
    try {
      await onRender(segment.id);
    } catch (err) {
      console.error('[SegmentVoiceControls] render error:', err);
    }
  }, [segment.id, isDirty, saveOverrides, onRender]);

  const handleResetToAI = useCallback(async () => {
    const aiEmotion = segment.ai_emotion || segment.emotion || 'calm';
    const aiStability = segment.ai_stability ?? 0.5;
    const aiStyle = segment.ai_style ?? 0.5;
    setEmotion(aiEmotion);
    setStability(aiStability);
    setStyle(aiStyle);
    setIsDirty(false);
    try {
      await onResetToAI(segment.id);
    } catch (err) {
      console.error('[SegmentVoiceControls] resetToAI error:', err);
    }
  }, [segment, onResetToAI]);

  const aiReasoning = segment.ai_reasoning || segment.direction_reasoning || null;
  const sStyle = speakerStyle(segment.speaker);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>

        {/* Close button */}
        <div className="flex items-center justify-between px-4 pb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-semibold uppercase tracking-wide border-b"
              style={sStyle}
            >
              {segment.speaker || 'Narrator'}
            </span>
            {segment.render_status && (
              <span className="text-[10px] text-slate-500">
                {STATUS_RENDER_LABELS[segment.render_status]}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pb-6 flex flex-col gap-4">
          {/* Full segment text */}
          <div className="bg-slate-800/60 rounded-xl p-3">
            <p className="text-slate-200 text-sm leading-relaxed">{segment.text}</p>
          </div>

          {/* AI reasoning */}
          {aiReasoning && (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                AI Suggestion
              </p>
              <p className="text-slate-400 text-xs leading-relaxed">{aiReasoning}</p>
            </div>
          )}

          {/* Emotion selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Emotion
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {EMOTIONS.map(e => (
                <button
                  key={e.value}
                  onClick={() => handleEmotionChange(e.value)}
                  className={`
                    py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-all
                    ${emotion === e.value
                      ? `${e.color} ring-1 ring-current`
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                    }
                  `}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stability selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Stability
            </label>
            <div className="flex gap-2">
              {STABILITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleStabilityChange(opt.value)}
                  className={`
                    flex-1 py-2 rounded-lg border text-xs font-medium transition-all
                    ${stability === opt.value
                      ? 'bg-indigo-500/20 border-indigo-500/60 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                    }
                  `}
                >
                  <span className="block font-semibold">{opt.label}</span>
                  <span className="block text-[10px] opacity-60">{opt.value}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Style slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Style
              </label>
              <span className="text-xs text-slate-400 font-mono">{style.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={style}
              onChange={e => handleStyleChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-indigo-400"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-1">
              <span>Neutral</span>
              <span>Expressive</span>
            </div>
          </div>

          {/* Preview audio element */}
          {previewUrl && (
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 mb-1.5">Preview audio</p>
              <audio
                ref={audioRef}
                src={previewUrl}
                controls
                className="w-full h-8"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          )}
          {previewError && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
              Preview failed: {previewError}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            {/* Save (if dirty) */}
            {isDirty && (
              <button
                onClick={saveOverrides}
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-slate-700 border border-slate-600 text-slate-200 text-sm font-medium hover:bg-slate-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <SpinnerIcon className="w-4 h-4" /> : null}
                Save Changes
              </button>
            )}

            <div className="flex gap-2">
              {/* Preview */}
              <button
                onClick={handlePreview}
                disabled={previewing || isRendering}
                className="flex-1 py-2.5 rounded-xl bg-slate-700/80 border border-slate-600 text-slate-200 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {previewing
                  ? <SpinnerIcon className="w-4 h-4" />
                  : <PlayIcon className="w-4 h-4" />
                }
                Preview
              </button>

              {/* Render */}
              <button
                onClick={handleRender}
                disabled={isRendering}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isRendering
                  ? <SpinnerIcon className="w-4 h-4" />
                  : <MicIcon className="w-4 h-4" />
                }
                Render
              </button>
            </div>

            {/* Reset to AI */}
            <button
              onClick={handleResetToAI}
              disabled={isRendering}
              className="w-full py-2 rounded-xl text-slate-500 text-xs hover:text-slate-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <RefreshIcon className="w-3.5 h-3.5" />
              Reset to AI Default
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------
// Usage Bar
// ------------------------------------------------------------------

function UsageBar({ used = 0, max = 100000 }) {
  const pct = Math.min(100, (used / max) * 100);
  const barColor = pct > 90
    ? 'bg-red-500'
    : pct > 70
      ? 'bg-yellow-500'
      : 'bg-green-500';

  const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 whitespace-nowrap flex-shrink-0">
        {fmt(used)} / {fmt(max)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// Render All Progress Bar
// ------------------------------------------------------------------

function RenderAllProgress({ rendered, total }) {
  if (total === 0) return null;
  const pct = Math.round((rendered / total) * 100);
  return (
    <div className="px-4 py-2 bg-slate-800/80 border-b border-slate-700">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
        <span>Rendering all...</span>
        <span>{rendered} / {total}</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main ScriptEditor Component
// ------------------------------------------------------------------

export default function ScriptEditor() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const {
    script,
    selectedSegment,
    loading,
    error,
    renderingSegments,
    stats,
    updateSegmentOverrides,
    renderSegment,
    previewSegment,
    renderAll,
    changeCharacterVoice,
    generateDirections,
    rerunDirections,
    getUsageEstimate,
    selectSegment,
    refresh
  } = useScriptEditor(sessionId);

  // Local UI state
  const [toastError, setToastError] = useState(null);
  const [usageEstimate, setUsageEstimate] = useState(null);
  const [isRenderingAll, setIsRenderingAll] = useState(false);
  const [renderAllRendered, setRenderAllRendered] = useState(0);
  const [renderAllTotal, setRenderAllTotal] = useState(0);

  // Fetch usage estimate once script loads
  useEffect(() => {
    if (!script || !sessionId) return;
    getUsageEstimate()
      .then(data => setUsageEstimate(data))
      .catch(() => { /* silent - non-critical */ });
  }, [script, sessionId, getUsageEstimate]);

  // Count rendered / total in real-time from renderingSegments changes
  useEffect(() => {
    if (!isRenderingAll || !stats) return;
    setRenderAllRendered(stats.rendered);
    setRenderAllTotal(stats.total);
  }, [isRenderingAll, stats]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleSegmentSelect = useCallback((segmentId) => {
    if (selectedSegment?.id === segmentId) {
      selectSegment(null);
    } else {
      selectSegment(segmentId);
    }
  }, [selectedSegment, selectSegment]);

  const handleCloseSheet = useCallback(() => {
    selectSegment(null);
  }, [selectSegment]);

  const handleRenderSegment = useCallback(async (segmentId) => {
    try {
      await renderSegment(segmentId);
    } catch (err) {
      setToastError(err.message || 'Render failed');
    }
  }, [renderSegment]);

  const handlePreviewSegment = useCallback(async (segmentId) => {
    return previewSegment(segmentId);
  }, [previewSegment]);

  const handleUpdateOverrides = useCallback(async (segmentId, overrides) => {
    return updateSegmentOverrides(segmentId, overrides);
  }, [updateSegmentOverrides]);

  const handleResetToAI = useCallback(async (segmentId) => {
    try {
      await updateSegmentOverrides(segmentId, { reset: true });
    } catch (err) {
      setToastError(err.message || 'Reset failed');
    }
  }, [updateSegmentOverrides]);

  const handleRenderAll = useCallback(async () => {
    setIsRenderingAll(true);
    setRenderAllRendered(stats?.rendered || 0);
    setRenderAllTotal(stats?.total || 0);
    try {
      await renderAll();
    } catch (err) {
      setToastError(err.message || 'Render all failed');
    } finally {
      setIsRenderingAll(false);
    }
  }, [renderAll, stats]);

  // ------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e) {
      // Escape: close bottom sheet
      if (e.key === 'Escape' && selectedSegment) {
        handleCloseSheet();
        return;
      }

      // Don't intercept if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Arrow Up/Down: navigate segments
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && script) {
        e.preventDefault();
        const allSegments = [];
        (script.scenes || []).forEach(scene => {
          (scene.segments || []).forEach(seg => allSegments.push(seg));
        });
        if (allSegments.length === 0) return;

        const currentIdx = selectedSegment
          ? allSegments.findIndex(s => s.id === selectedSegment.id)
          : -1;

        const nextIdx = e.key === 'ArrowDown'
          ? Math.min(currentIdx + 1, allSegments.length - 1)
          : Math.max(currentIdx - 1, 0);

        selectSegment(allSegments[nextIdx]?.id || null);
      }

      // Space: toggle play on selected segment
      if (e.key === ' ' && selectedSegment) {
        e.preventDefault();
        // Play preview handled by bottom sheet
      }

      // Enter: open/close segment controls
      if (e.key === 'Enter' && !selectedSegment && script) {
        const allSegments = [];
        (script.scenes || []).forEach(scene => {
          (scene.segments || []).forEach(seg => allSegments.push(seg));
        });
        if (allSegments.length > 0) selectSegment(allSegments[0].id);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSegment, script, selectSegment, handleCloseSheet]);

  // ------------------------------------------------------------------
  // Export script as text
  // ------------------------------------------------------------------
  const handleExportScript = useCallback(() => {
    if (!script) return;
    let text = `# ${script.session?.title || 'Untitled Story'}\n\n`;

    (script.scenes || []).forEach((scene, i) => {
      text += `## Scene ${i + 1}\n\n`;
      (scene.segments || []).forEach(seg => {
        const speaker = seg.speaker || 'Narrator';
        const emotion = seg.user_emotion || seg.ai_emotion || '';
        const emotionTag = emotion ? ` [${emotion}]` : '';
        text += `**${speaker}**${emotionTag}: ${seg.segment_text || seg.text || ''}\n\n`;
      });
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.session?.title || 'script'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [script]);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------

  const pendingCount = useMemo(() => {
    if (!script) return 0;
    let count = 0;
    (script.scenes || []).forEach(scene => {
      (scene.segments || []).forEach(seg => {
        if (seg.render_status !== 'rendered') count++;
      });
    });
    return count;
  }, [script]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // Error state with retry
  if (!loading && error) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-1">Failed to load script</p>
          <p className="text-slate-500 text-xs mb-4">{error}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-xl"
          >
            Retry
          </button>
        </div>
        <Link to={`/story/${sessionId}`} className="text-slate-500 text-xs hover:text-slate-300">
          Back to story
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-slate-100">
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/60">
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Back button */}
          <Link
            to={`/story/${sessionId}`}
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Back to story"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-100 truncate">
              {loading
                ? 'Loading script...'
                : (script?.title || script?.story_title || 'Script Editor')
              }
            </h1>
            {!loading && script && (
              <p className="text-[10px] text-slate-500 truncate">
                {stats?.total || 0} segments
                {stats ? ` · ${stats.rendered} rendered` : ''}
              </p>
            )}
          </div>

          {/* Usage counter (chars) */}
          {usageEstimate && (
            <div className="flex-shrink-0 text-right">
              <p className="text-[10px] text-slate-500">Est. chars</p>
              <p className="text-xs text-slate-300 font-mono">
                {usageEstimate.estimatedChars?.toLocaleString() || 0}
              </p>
            </div>
          )}

          {/* Export Script button */}
          {!loading && script && (
            <button
              onClick={handleExportScript}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-xl transition-colors"
              title="Export script as text file"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}

          {/* Render All button */}
          {!loading && script && (
            <button
              onClick={handleRenderAll}
              disabled={isRenderingAll || pendingCount === 0}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-xl transition-colors"
            >
              {isRenderingAll
                ? <SpinnerIcon className="w-3.5 h-3.5" />
                : <MicIcon className="w-3.5 h-3.5" />
              }
              <span className="hidden xs:inline">Render All</span>
              {pendingCount > 0 && (
                <span className="bg-indigo-400/30 px-1.5 py-0.5 rounded-full text-[10px]">
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Render all progress bar */}
        {isRenderingAll && (
          <RenderAllProgress
            rendered={renderAllRendered}
            total={renderAllTotal}
          />
        )}
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Main content                                                     */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex-1 overflow-y-auto pb-28">
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Voice cast panel */}
            <div className="pt-4">
              <VoiceCastPanel characters={script?.characters || []} />
            </div>

            {/* Scene script view */}
            {(script?.scenes || []).map((scene, idx) => (
              <SceneBlock
                key={scene.id || idx}
                scene={scene}
                sceneIndex={idx}
                selectedSegmentId={selectedSegment?.id}
                renderingSegments={renderingSegments}
                onSelectSegment={handleSegmentSelect}
              />
            ))}

            {(!script?.scenes || script.scenes.length === 0) && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <p className="text-slate-500 text-sm mb-2">No script data found</p>
                <p className="text-slate-600 text-xs mb-4">
                  Generate voice directions first to populate the script editor.
                </p>
                <button
                  onClick={generateDirections}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-xl"
                >
                  Generate Voice Directions
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ---------------------------------------------------------------- */}
      {/* Footer                                                           */}
      {/* ---------------------------------------------------------------- */}
      {!loading && script && (
        <footer className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700/60 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Render All */}
            <button
              onClick={handleRenderAll}
              disabled={isRenderingAll || pendingCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0"
            >
              {isRenderingAll
                ? <SpinnerIcon className="w-4 h-4" />
                : <MicIcon className="w-4 h-4" />
              }
              Render All
              {pendingCount > 0 && (
                <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-xs">
                  {pendingCount}
                </span>
              )}
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-slate-700 flex-shrink-0" />

            {/* Total chars + usage bar */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">
                  {stats?.totalChars?.toLocaleString() || 0} chars
                </span>
                {usageEstimate?.maxChars && (
                  <span className="text-[10px] text-slate-600">
                    quota
                  </span>
                )}
              </div>
              {usageEstimate?.maxChars && (
                <UsageBar
                  used={usageEstimate.usedChars || 0}
                  max={usageEstimate.maxChars}
                />
              )}
            </div>
          </div>
        </footer>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Segment voice controls bottom sheet                              */}
      {/* ---------------------------------------------------------------- */}
      {selectedSegment && (
        <SegmentVoiceControls
          segment={selectedSegment}
          isRendering={renderingSegments.has(selectedSegment.id)}
          onClose={handleCloseSheet}
          onUpdate={handleUpdateOverrides}
          onPreview={handlePreviewSegment}
          onRender={handleRenderSegment}
          onResetToAI={handleResetToAI}
        />
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Error toast                                                      */}
      {/* ---------------------------------------------------------------- */}
      <ErrorToast
        message={toastError}
        onClose={() => setToastError(null)}
      />
    </div>
  );
}
