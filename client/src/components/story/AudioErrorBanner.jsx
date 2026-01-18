/**
 * AudioErrorBanner Component
 * Displays audio generation errors with dismiss button.
 */

import { VolumeX, X } from 'lucide-react';

function AudioErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="bg-amber-500/20 border-b border-amber-500/50 px-4 py-2 flex items-center justify-between">
      <p className="text-amber-300 text-sm flex items-center gap-2">
        <VolumeX className="w-4 h-4" />
        {error}
      </p>
      <button
        onClick={onDismiss}
        className="text-amber-400 hover:text-amber-300 p-1"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default AudioErrorBanner;
