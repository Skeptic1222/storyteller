/**
 * Recording Prompt Component
 * Shown when a pre-recorded version of a story is available
 * Lets user choose between instant playback or fresh generation
 */

import { memo } from 'react';
import { Disc, Play, Sparkles, Clock, Volume2, BookOpen, X } from 'lucide-react';

const RecordingPrompt = memo(function RecordingPrompt({
  isOpen,
  recording,
  onPlayRecording,
  onGenerateFresh,
  onClose,
  isLoading = false
}) {
  if (!isOpen || !recording) return null;

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-800 border border-slate-600 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-green-500/20 animate-pulse">
              <Disc className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-100">
                Recording Available
              </h3>
              <p className="text-slate-400 text-sm">
                Listen instantly or create a new version
              </p>
            </div>
          </div>
        </div>

        {/* Recording info */}
        <div className="p-6 space-y-4">
          {/* Recording details card */}
          <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700">
            <h4 className="text-slate-200 font-medium mb-3 line-clamp-2">
              {recording.title || 'Recorded Story'}
            </h4>

            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock className="w-4 h-4" />
                <span>{formatDuration(recording.total_duration_seconds)}</span>
              </div>

              <div className="flex items-center gap-1.5 text-slate-400">
                <BookOpen className="w-4 h-4" />
                <span>{recording.segment_count || '?'} chapters</span>
              </div>

              {recording.play_count > 0 && (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Play className="w-4 h-4" />
                  <span>{recording.play_count} plays</span>
                </div>
              )}
            </div>

            {recording.created_at && (
              <p className="text-slate-500 text-xs mt-3">
                Recorded {formatDate(recording.created_at)}
              </p>
            )}
          </div>

          {/* Benefits list */}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <Volume2 className="w-5 h-5 text-green-400 flex-shrink-0" />
              <div>
                <p className="text-green-400 font-medium">Instant Playback</p>
                <p className="text-slate-400">
                  No wait time - audio is ready to play immediately
                </p>
              </div>
            </div>

            {recording.has_word_timings && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <BookOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-amber-400 font-medium">Read Along</p>
                  <p className="text-slate-400">
                    Follow the story with karaoke-style word highlighting
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-3 pt-4">
            <button
              onClick={onPlayRecording}
              disabled={isLoading}
              className="w-full px-4 py-4 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium hover:from-green-400 hover:to-emerald-400 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-green-500/20"
            >
              <Play className="w-5 h-5" />
              Play Recording
            </button>

            <button
              onClick={onGenerateFresh}
              disabled={isLoading}
              className="w-full px-4 py-3 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-slate-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate New Version
            </button>
          </div>
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 bg-slate-900/50 border-t border-slate-700">
          <p className="text-center text-slate-500 text-xs">
            Generating a new version will create a fresh story with different narration
          </p>
        </div>
      </div>
    </div>
  );
});

export default RecordingPrompt;
