/**
 * Recovery Prompt Component
 * Shown when an interrupted recording session is detected
 * Lets user resume from where they left off or start fresh
 */

import { memo } from 'react';
import { RefreshCw, Play, Trash2, Clock, BookOpen, X } from 'lucide-react';

const RecoveryPrompt = memo(function RecoveryPrompt({
  isOpen,
  recoveryInfo,
  onResume,
  onStartFresh,
  onDiscard,
  onClose,
  isLoading = false
}) {
  if (!isOpen || !recoveryInfo) return null;

  const { recording, lastValidSegment, segmentCount, validation } = recoveryInfo;

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const resumeProgress = lastValidSegment && segmentCount
    ? Math.round((lastValidSegment / segmentCount) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-night-800 border border-night-600 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-night-700 text-night-400 hover:text-night-200 z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 p-6 border-b border-night-700">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-amber-500/20">
              <RefreshCw className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-night-100">
                Resume Story?
              </h3>
              <p className="text-night-400 text-sm">
                We found an unfinished listening session
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Recording info card */}
          <div className="p-4 bg-night-900/50 rounded-xl border border-night-700">
            <h4 className="text-night-200 font-medium mb-3 line-clamp-2">
              {recording?.title || 'Your Story'}
            </h4>

            <div className="flex flex-wrap gap-3 text-sm mb-3">
              <div className="flex items-center gap-1.5 text-night-400">
                <BookOpen className="w-4 h-4" />
                <span>Chapter {lastValidSegment + 1} of {segmentCount}</span>
              </div>

              {recording?.total_duration_seconds && (
                <div className="flex items-center gap-1.5 text-night-400">
                  <Clock className="w-4 h-4" />
                  <span>{formatDuration(recording.total_duration_seconds)} total</span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-night-500">Progress</span>
                <span className="text-amber-400">{resumeProgress}%</span>
              </div>
              <div className="h-2 bg-night-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
                  style={{ width: `${resumeProgress}%` }}
                />
              </div>
            </div>

            {recoveryInfo.recording?.updated_at && (
              <p className="text-night-500 text-xs mt-3">
                Last listened {formatDate(recoveryInfo.recording.updated_at)}
              </p>
            )}
          </div>

          {/* Validation warning if applicable */}
          {validation && !validation.isValid && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-red-400 text-sm">
                Some audio segments may be missing. Resume may skip to the next available chapter.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-3 pt-4">
            <button
              onClick={onResume}
              disabled={isLoading}
              className="w-full px-4 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-night-900 font-medium hover:from-amber-400 hover:to-orange-400 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-amber-500/20"
            >
              <Play className="w-5 h-5" />
              Resume from Chapter {lastValidSegment + 1}
            </button>

            <div className="flex gap-3">
              <button
                onClick={onStartFresh}
                disabled={isLoading}
                className="flex-1 px-4 py-3 rounded-xl bg-night-700 text-night-300 hover:bg-night-600 hover:text-night-100 transition-colors disabled:opacity-50"
              >
                Start Over
              </button>

              <button
                onClick={onDiscard}
                disabled={isLoading}
                className="px-4 py-3 rounded-xl bg-night-700 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
                title="Discard this recording"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 bg-night-900/50 border-t border-night-700">
          <p className="text-center text-night-500 text-xs">
            Resuming will continue from where you left off
          </p>
        </div>
      </div>
    </div>
  );
});

export default RecoveryPrompt;
