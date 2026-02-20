/**
 * DirectorStylePicker Component
 *
 * Cinematic director selection for VAD (Voice Acted Dialog) stories.
 * Controls production vision: scene pacing, SFX philosophy, and voice direction.
 * Only rendered when multi_voice (VAD) mode is enabled.
 *
 * Props:
 *   selectedDirector  - Currently selected director key (string or null for auto)
 *   onDirectorChange  - Callback when director changes: (key | null) => void
 *   disabled          - Whether the picker is non-interactive
 *   genres            - Object of genre keys to numeric values (0-100) for relevance hints
 */
import { memo, useState, useMemo } from 'react';
import { Clapperboard, Sparkles, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Director data (self-contained — no external import)
// ---------------------------------------------------------------------------
const DIRECTORS = [
  {
    key: 'hitchcock',
    name: 'Alfred Hitchcock',
    bestFor: ['thriller', 'mystery', 'horror'],
    description: 'Surgical tension, restrained performances, strategic silence'
  },
  {
    key: 'bay',
    name: 'Michael Bay',
    bestFor: ['action', 'adventure', 'scifi'],
    description: 'Explosive energy, relentless pacing, wall-to-wall action'
  },
  {
    key: 'anderson',
    name: 'Wes Anderson',
    bestFor: ['humor', 'literary', 'drama'],
    description: 'Whimsical precision, deadpan delivery, visual symmetry'
  },
  {
    key: 'tarantino',
    name: 'Quentin Tarantino',
    bestFor: ['thriller', 'humor', 'crime'],
    description: 'Naturalistic dialogue, sudden violence, pop culture rhythm'
  },
  {
    key: 'ghibli',
    name: 'Studio Ghibli',
    bestFor: ['fantasy', 'fairytale', 'ya'],
    description: 'Nature-infused wonder, gentle pacing, emotional simplicity'
  },
  {
    key: 'nolan',
    name: 'Christopher Nolan',
    bestFor: ['scifi', 'thriller', 'drama'],
    description: 'Cerebral intensity, layered atmospherics, temporal complexity'
  },
  {
    key: 'spielberg',
    name: 'Steven Spielberg',
    bestFor: ['adventure', 'scifi', 'fantasy'],
    description: 'Sweeping emotion, heroic sincerity, orchestral grandeur'
  },
  {
    key: 'lynch',
    name: 'David Lynch',
    bestFor: ['horror', 'mystery', 'surreal'],
    description: 'Dreamlike unease, uncanny calm, industrial ambience'
  }
];

// Human-readable genre labels for the bestFor chips
const GENRE_LABELS = {
  thriller: 'Thriller',
  mystery: 'Mystery',
  horror: 'Horror',
  action: 'Action',
  adventure: 'Adventure',
  scifi: 'Sci-Fi',
  humor: 'Humor',
  comedy: 'Comedy',
  literary: 'Literary',
  drama: 'Drama',
  fairytale: 'Fairytale',
  fantasy: 'Fantasy',
  ya: 'YA',
  crime: 'Crime',
  surreal: 'Surreal'
};

// Threshold above which a genre is considered "active" for relevance scoring
const GENRE_ACTIVE_THRESHOLD = 30;

// ---------------------------------------------------------------------------
// Helper: compute a relevance score (0–N) for a director given active genres
// ---------------------------------------------------------------------------
function relevanceScore(director, genres) {
  if (!genres || typeof genres !== 'object') return 0;
  return director.bestFor.reduce((score, g) => {
    const val = genres[g] ?? 0;
    return val >= GENRE_ACTIVE_THRESHOLD ? score + val : score;
  }, 0);
}

// ---------------------------------------------------------------------------
// GenreChip — small pill showing a genre label with optional highlight
// ---------------------------------------------------------------------------
function GenreChip({ genre, active }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-none transition-colors ${
        active
          ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
          : 'bg-slate-700/60 text-slate-400 border border-slate-700'
      }`}
    >
      {GENRE_LABELS[genre] ?? genre}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DirectorCard — individual selectable card
// ---------------------------------------------------------------------------
function DirectorCard({ director, isSelected, isRelevant, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick(director.key)}
      disabled={disabled}
      aria-pressed={isSelected}
      className={[
        'w-full text-left p-3 rounded-xl border transition-all duration-200',
        isSelected
          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30 shadow-md'
          : isRelevant
          ? 'border-amber-500/30 bg-slate-800/70 hover:border-amber-500/50 hover:bg-slate-800/90'
          : 'border-slate-700 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/70',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      ].join(' ')}
    >
      {/* Director name */}
      <div className={`font-semibold text-sm leading-tight ${isSelected ? 'text-amber-300' : 'text-slate-100'}`}>
        {director.name}
        {isRelevant && !isSelected && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-amber-400/70 font-normal uppercase tracking-wide">
            <Sparkles className="w-2.5 h-2.5" />
            Match
          </span>
        )}
      </div>

      {/* Genre chips */}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {director.bestFor.map(g => (
          <GenreChip
            key={g}
            genre={g}
            active={isSelected || (isRelevant && (director.bestFor.includes(g)))}
          />
        ))}
      </div>

      {/* Description */}
      <p className={`text-xs mt-2 leading-snug ${isSelected ? 'text-amber-200/80' : 'text-slate-400'}`}>
        {director.description}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Auto-detect card — top-level option that clears the manual selection
// ---------------------------------------------------------------------------
function AutoDetectCard({ isSelected, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick(null)}
      disabled={disabled}
      aria-pressed={isSelected}
      className={[
        'w-full text-left p-3 rounded-xl border-2 transition-all duration-200 flex items-center gap-3',
        isSelected
          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30 shadow-md'
          : 'border-slate-600 bg-slate-800/40 hover:border-amber-500/40 hover:bg-slate-800/70',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      ].join(' ')}
    >
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
        isSelected ? 'bg-amber-500/20' : 'bg-slate-700/60'
      }`}>
        <Wand2 className={`w-5 h-5 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
      </div>
      <div className="min-w-0">
        <div className={`font-semibold text-sm ${isSelected ? 'text-amber-300' : 'text-slate-100'}`}>
          Auto-detect
          {isSelected && (
            <span className="ml-2 text-[10px] text-amber-400/70 font-normal uppercase tracking-wide">Default</span>
          )}
        </div>
        <p className={`text-xs mt-0.5 leading-snug ${isSelected ? 'text-amber-200/70' : 'text-slate-400'}`}>
          AI picks the best director based on your genre mix
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const DirectorStylePicker = memo(function DirectorStylePicker({
  selectedDirector = null,
  onDirectorChange,
  disabled = false,
  genres = {}
}) {
  const [expanded, setExpanded] = useState(false);

  // Sort directors by relevance to current genres so the best matches surface first
  const sortedDirectors = useMemo(() => {
    return [...DIRECTORS].sort((a, b) => relevanceScore(b, genres) - relevanceScore(a, genres));
  }, [genres]);

  // Which directors have at least one active genre match
  const relevantKeys = useMemo(() => {
    return new Set(
      DIRECTORS
        .filter(d => relevanceScore(d, genres) > 0)
        .map(d => d.key)
    );
  }, [genres]);

  const handleSelect = (key) => {
    if (disabled) return;
    // Selecting the already-selected director clears back to auto
    onDirectorChange(key === selectedDirector ? null : key);
  };

  const selectedDirectorData = DIRECTORS.find(d => d.key === selectedDirector) ?? null;
  const isAuto = selectedDirector === null || selectedDirector === undefined;

  // In collapsed mode show the 4 most relevant directors (or first 4 if none relevant)
  const COLLAPSED_COUNT = 4;
  const collapsedDirectors = sortedDirectors.slice(0, COLLAPSED_COUNT);
  const hasMore = sortedDirectors.length > COLLAPSED_COUNT;

  return (
    <section
      className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-2xl border border-slate-700 overflow-hidden"
      aria-label="Director Style Picker"
    >
      {/* ----------------------------------------------------------------- */}
      {/* Header row                                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-amber-400 flex-shrink-0" />
          Director Style
        </h2>
        {!isAuto && selectedDirectorData && (
          <span className="flex items-center gap-1 text-[11px] text-amber-400/80 font-medium bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
            <Clapperboard className="w-3 h-3" />
            {selectedDirectorData.name.split(' ').slice(-1)[0]}
          </span>
        )}
      </div>

      <p className="text-slate-400 text-sm px-4 pb-3">
        Shape the production: scene pacing, SFX philosophy, and voice direction.
      </p>

      {/* ----------------------------------------------------------------- */}
      {/* Current selection summary banner (when a specific director is set) */}
      {/* ----------------------------------------------------------------- */}
      {!isAuto && selectedDirectorData && (
        <div className="mx-4 mb-3 p-3 bg-amber-500/10 rounded-xl border border-amber-500/30">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-amber-400 font-semibold text-sm">{selectedDirectorData.name}</div>
              <p className="text-slate-300/80 text-xs mt-0.5 leading-snug">
                {selectedDirectorData.description}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selectedDirectorData.bestFor.map(g => (
                  <GenreChip key={g} genre={g} active />
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => !disabled && onDirectorChange(null)}
              disabled={disabled}
              className="flex-shrink-0 text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 bg-slate-700/80 hover:bg-slate-600/80 rounded-lg border border-slate-600 transition-colors disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Director list                                                      */}
      {/* ----------------------------------------------------------------- */}
      <div className="px-4 pb-2 space-y-2">
        {/* Auto-detect is always first */}
        <AutoDetectCard
          isSelected={isAuto}
          onClick={handleSelect}
          disabled={disabled}
        />

        {/* Divider */}
        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 h-px bg-slate-700/60" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Or choose a director</span>
          <div className="flex-1 h-px bg-slate-700/60" />
        </div>

        {/* Director cards — collapsed shows top 4, expanded shows all 8 */}
        <div className="grid grid-cols-1 gap-2">
          {(expanded ? sortedDirectors : collapsedDirectors).map(director => (
            <DirectorCard
              key={director.key}
              director={director}
              isSelected={selectedDirector === director.key}
              isRelevant={relevantKeys.has(director.key)}
              onClick={handleSelect}
              disabled={disabled}
            />
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Expand / collapse toggle                                           */}
      {/* ----------------------------------------------------------------- */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="w-full px-4 py-3 text-amber-400 hover:text-amber-300 text-sm flex items-center justify-center gap-1.5 transition-colors bg-slate-800/40 hover:bg-slate-800/60 border-t border-slate-700/60"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              Show fewer directors
              <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Browse all {DIRECTORS.length} directors
              <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </section>
  );
});

export default DirectorStylePicker;
