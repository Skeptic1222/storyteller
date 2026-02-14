/**
 * CoverThumbnail Component
 * Displays a small cover image thumbnail with click-to-expand functionality.
 * Shows in the story player header for quick cover access.
 */

import { useState } from 'react';
import { Image, Maximize2 } from 'lucide-react';

const SIZES = {
  small: { width: 48, height: 72 },
  medium: { width: 64, height: 96 },
  large: { width: 80, height: 120 }
};

function CoverThumbnail({
  coverUrl,
  title = 'Story Cover',
  size = 'medium',
  onExpand,
  className = ''
}) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const dimensions = SIZES[size] || SIZES.medium;

  // Handle cases where no cover is available
  if (!coverUrl || imageError) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-700/50 border border-slate-600 rounded-lg ${className}`}
        style={{ width: dimensions.width, height: dimensions.height }}
        title={title}
      >
        <Image className="w-6 h-6 text-slate-500" />
      </div>
    );
  }

  return (
    <div
      className={`relative cursor-pointer group ${className}`}
      style={{ width: dimensions.width, height: dimensions.height }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onExpand}
      title={`Click to view ${title}`}
    >
      <img
        src={coverUrl}
        alt={title}
        className="w-full h-full object-cover rounded-lg shadow-lg border border-slate-600/50 transition-all duration-200 group-hover:border-golden-400/50 group-hover:shadow-golden-400/20"
        style={{ width: dimensions.width, height: dimensions.height }}
        onError={() => setImageError(true)}
      />

      {/* Expand indicator on hover */}
      {isHovered && (
        <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center transition-opacity duration-150">
          <Maximize2 className="w-5 h-5 text-white" />
        </div>
      )}

      {/* Subtle glow effect */}
      <div className="absolute inset-0 rounded-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{
          boxShadow: '0 0 15px rgba(251, 191, 36, 0.2)'
        }}
      />
    </div>
  );
}

export default CoverThumbnail;
