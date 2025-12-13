import { useState, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, BookOpen, List, X, Disc } from 'lucide-react';
import ReadAlongPlayer from './ReadAlongPlayer';
import SFXPlayer from './SFXPlayer';

/**
 * Recording Player Component
 * Full playback experience for recorded stories with karaoke and SFX
 */
function RecordingPlayer({
  recording,
  segments,
  onClose,
  onDiverge,
  showChoiceTree = true,
  autoPlay = true
}) {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [showReadAlong, setShowReadAlong] = useState(true);
  const [showSegmentList, setShowSegmentList] = useState(false);
  const [playbackComplete, setPlaybackComplete] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const currentSegment = useMemo(() => {
    return segments?.[currentSegmentIndex] || null;
  }, [segments, currentSegmentIndex]);

  const totalDuration = useMemo(() => {
    return segments?.reduce((sum, seg) => sum + (seg.duration_seconds || 0), 0) || 0;
  }, [segments]);

  const currentOverallTime = useMemo(() => {
    let time = 0;
    for (let i = 0; i < currentSegmentIndex; i++) {
      time += segments[i]?.duration_seconds || 0;
    }
    return time + currentTime;
  }, [segments, currentSegmentIndex, currentTime]);

  // Parse word timings from segment
  const wordTimings = useMemo(() => {
    if (!currentSegment?.word_timings) return null;
    try {
      return typeof currentSegment.word_timings === 'string'
        ? JSON.parse(currentSegment.word_timings)
        : currentSegment.word_timings;
    } catch {
      return null;
    }
  }, [currentSegment]);

  // Parse SFX data from segment
  const sfxData = useMemo(() => {
    if (!currentSegment?.sfx_data) return [];
    try {
      const data = typeof currentSegment.sfx_data === 'string'
        ? JSON.parse(currentSegment.sfx_data)
        : currentSegment.sfx_data;
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, [currentSegment]);

  // Parse choices at end of segment
  const choicesAtEnd = useMemo(() => {
    if (!currentSegment?.choices_at_end) return null;
    try {
      return typeof currentSegment.choices_at_end === 'string'
        ? JSON.parse(currentSegment.choices_at_end)
        : currentSegment.choices_at_end;
    } catch {
      return null;
    }
  }, [currentSegment]);

  // Handle segment completion
  const handleSegmentEnded = useCallback(() => {
    if (currentSegmentIndex < segments.length - 1) {
      // Move to next segment
      setCurrentSegmentIndex(prev => prev + 1);
      setCurrentTime(0);
    } else {
      // Recording complete
      setIsPlaying(false);
      setPlaybackComplete(true);
    }
  }, [currentSegmentIndex, segments.length]);

  // Navigate to specific segment
  const goToSegment = useCallback((index) => {
    if (index >= 0 && index < segments.length) {
      setCurrentSegmentIndex(index);
      setCurrentTime(0);
      setPlaybackComplete(false);
    }
  }, [segments.length]);

  // Previous segment
  const previousSegment = useCallback(() => {
    goToSegment(currentSegmentIndex - 1);
  }, [currentSegmentIndex, goToSegment]);

  // Next segment
  const nextSegment = useCallback(() => {
    goToSegment(currentSegmentIndex + 1);
  }, [currentSegmentIndex, goToSegment]);

  // Handle choice selection (divergence point)
  const handleChoiceSelect = useCallback((choiceKey) => {
    const hasRecording = currentSegment?.has_recording_for_choice?.[choiceKey];

    if (hasRecording) {
      // Continue with recorded path
      // This would need integration with path switching logic
      console.log(`Continuing with recorded path for choice ${choiceKey}`);
    } else {
      // Diverge to live generation
      onDiverge?.(choiceKey, currentSegmentIndex);
    }
  }, [currentSegment, currentSegmentIndex, onDiverge]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'ArrowLeft':
          previousSegment();
          break;
        case 'ArrowRight':
          nextSegment();
          break;
        case 'r':
          setShowReadAlong(prev => !prev);
          break;
        case 'Escape':
          onClose?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previousSegment, nextSegment, onClose]);

  if (!recording || !segments?.length) {
    return (
      <div className="flex items-center justify-center h-64 text-night-400">
        No recording available
      </div>
    );
  }

  return (
    <div className="recording-player bg-night-900 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-night-800 border-b border-night-700">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <Disc className="w-5 h-5 text-amber-400 animate-spin-slow" />
          </div>
          <div>
            <h3 className="text-night-100 font-medium">
              {recording.title || 'Recorded Story'}
            </h3>
            <p className="text-night-400 text-sm">
              Playing recorded audio
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Read Along toggle */}
          <button
            onClick={() => setShowReadAlong(!showReadAlong)}
            className={`p-2 rounded-lg transition-colors ${
              showReadAlong ? 'bg-amber-500/20 text-amber-400' : 'bg-night-700 text-night-400'
            }`}
            title="Toggle Read Along"
          >
            <BookOpen className="w-5 h-5" />
          </button>

          {/* Segment list toggle */}
          <button
            onClick={() => setShowSegmentList(!showSegmentList)}
            className={`p-2 rounded-lg transition-colors ${
              showSegmentList ? 'bg-amber-500/20 text-amber-400' : 'bg-night-700 text-night-400'
            }`}
            title="Show chapters"
          >
            <List className="w-5 h-5" />
          </button>

          {/* Close */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-night-700 text-night-400 hover:text-night-200"
              title="Close player"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex">
        {/* Segment list sidebar */}
        {showSegmentList && (
          <div className="w-64 border-r border-night-700 bg-night-800/50 max-h-[500px] overflow-y-auto">
            <div className="p-3 border-b border-night-700">
              <h4 className="text-night-300 text-sm font-medium">Chapters</h4>
            </div>
            <div className="p-2 space-y-1">
              {segments.map((seg, idx) => (
                <button
                  key={seg.id || idx}
                  onClick={() => goToSegment(idx)}
                  className={`w-full text-left p-2 rounded-lg transition-colors ${
                    idx === currentSegmentIndex
                      ? 'bg-golden-500/20 text-golden-400'
                      : 'hover:bg-night-700 text-night-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {seg.chapter_title || `Chapter ${idx + 1}`}
                    </span>
                    <span className="text-xs text-night-500">
                      {Math.floor(seg.duration_seconds / 60)}:{String(Math.floor(seg.duration_seconds % 60)).padStart(2, '0')}
                    </span>
                  </div>
                  {seg.scene_summary && (
                    <p className="text-xs text-night-500 mt-1 line-clamp-2">
                      {seg.scene_summary}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main player area */}
        <div className="flex-1">
          {showReadAlong ? (
            <ReadAlongPlayer
              segment={currentSegment}
              audioUrl={currentSegment?.audio_url}
              wordTimings={wordTimings}
              coverImageUrl={currentSegment?.image_url || recording?.cover_image_url}
              isPlaying={isPlaying}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleSegmentEnded}
              onTimeUpdate={setCurrentTime}
              className="min-h-[400px]"
              // Book-style props
              title={recording?.title || ''}
              synopsis={recording?.synopsis || currentSegment?.scene_summary || ''}
              sceneNumber={currentSegmentIndex + 1}
              totalScenes={segments?.length || 0}
            />
          ) : (
            /* Simple audio player without read-along */
            <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
              {currentSegment?.image_url && (
                <img
                  src={currentSegment.image_url}
                  alt="Scene"
                  className="max-h-64 rounded-xl shadow-lg mb-6"
                />
              )}

              <audio
                src={currentSegment?.audio_url}
                autoPlay={isPlaying}
                onEnded={handleSegmentEnded}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                controls
                className="w-full max-w-md"
              />

              {currentSegment?.scene_summary && (
                <p className="text-night-400 text-center mt-4 max-w-md">
                  {currentSegment.scene_summary}
                </p>
              )}
            </div>
          )}

          {/* SFX Player */}
          <div className="px-4 py-2 border-t border-night-700 bg-night-800/50">
            <SFXPlayer
              sfxData={sfxData}
              currentTime={currentTime}
              isPlaying={isPlaying}
              masterVolume={0.3}
              enabled={true}
            />
          </div>

          {/* Playback controls */}
          <div className="p-4 border-t border-night-700 bg-night-800">
            <div className="flex items-center justify-center gap-4">
              {/* Previous */}
              <button
                onClick={previousSegment}
                disabled={currentSegmentIndex === 0}
                className="p-2 rounded-lg bg-night-700 text-night-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-4 rounded-full bg-golden-500 text-night-900 hover:bg-golden-400 transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6" />
                ) : (
                  <Play className="w-6 h-6 ml-0.5" />
                )}
              </button>

              {/* Next */}
              <button
                onClick={nextSegment}
                disabled={currentSegmentIndex === segments.length - 1}
                className="p-2 rounded-lg bg-night-700 text-night-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Progress info */}
            <div className="flex items-center justify-between mt-4 text-sm text-night-400">
              <span>Chapter {currentSegmentIndex + 1} of {segments.length}</span>
              <span>
                {Math.floor(currentOverallTime / 60)}:{String(Math.floor(currentOverallTime % 60)).padStart(2, '0')}
                {' / '}
                {Math.floor(totalDuration / 60)}:{String(Math.floor(totalDuration % 60)).padStart(2, '0')}
              </span>
            </div>

            {/* Overall progress bar */}
            <div className="mt-2 h-1 bg-night-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-golden-500 transition-all duration-300"
                style={{ width: `${(currentOverallTime / totalDuration) * 100}%` }}
              />
            </div>
          </div>

          {/* CYOA Choices at end of segment */}
          {choicesAtEnd && choicesAtEnd.length > 0 && !isPlaying && (
            <div className="p-4 border-t border-night-700 bg-night-800/50">
              <h4 className="text-night-300 text-sm mb-3">Continue the story:</h4>
              <div className="space-y-2">
                {choicesAtEnd.map((choice) => {
                  const hasRecording = currentSegment?.has_recording_for_choice?.[choice.key];
                  return (
                    <button
                      key={choice.key}
                      onClick={() => handleChoiceSelect(choice.key)}
                      className="w-full p-3 rounded-lg bg-night-700 hover:bg-night-600 text-left flex items-center gap-3 transition-colors"
                    >
                      <span className="w-8 h-8 rounded-full bg-night-600 flex items-center justify-center text-night-200 font-bold">
                        {choice.key}
                      </span>
                      <div className="flex-1">
                        <span className="text-night-200">{choice.text}</span>
                        {!hasRecording && (
                          <span className="text-amber-400 text-xs ml-2">(new path)</span>
                        )}
                      </div>
                      {hasRecording && (
                        <Disc className="w-4 h-4 text-green-400" title="Recorded" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Playback complete message */}
          {playbackComplete && (
            <div className="p-6 text-center bg-gradient-to-t from-night-800 to-transparent">
              <h3 className="text-golden-400 text-xl font-medium mb-2">
                The End
              </h3>
              <p className="text-night-400 mb-4">
                Story playback complete
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => goToSegment(0)}
                  className="px-4 py-2 rounded-lg bg-night-700 text-night-200 hover:bg-night-600"
                >
                  Play Again
                </button>
                {onClose && (
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-golden-500 text-night-900 hover:bg-golden-400"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="px-4 py-2 bg-night-800/50 border-t border-night-700 text-center">
        <span className="text-night-500 text-xs">
          Space: Play/Pause | Arrow keys: Navigate | R: Toggle Read Along | Esc: Close
        </span>
      </div>
    </div>
  );
}

export default RecordingPlayer;
