/**
 * CoverFullscreenOverlay Component
 * Displays cover art in fullscreen mode with story title and synopsis overlay.
 */

import { Minimize2 } from 'lucide-react';

function CoverFullscreenOverlay({
  coverUrl,
  title,
  authorStyleName,
  synopsis,
  onClose
}) {
  if (!coverUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center cursor-pointer"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 z-10"
      >
        <Minimize2 className="w-6 h-6" />
      </button>
      <img
        src={coverUrl}
        alt="Story Cover"
        className="max-h-full max-w-full object-contain"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-8 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">{title || 'Your Story'}</h1>
        {authorStyleName && (
          <p className="text-xl text-golden-400">In the style of {authorStyleName}</p>
        )}
        {synopsis && (
          <p className="text-slate-300 mt-4 max-w-2xl mx-auto">{synopsis}</p>
        )}
      </div>
    </div>
  );
}

export default CoverFullscreenOverlay;
