/**
 * SfxIndicator Component
 * Shows animated wave bars and active SFX names when sound effects are playing.
 */

function SfxIndicator({ activeSfx }) {
  if (!activeSfx || activeSfx.length === 0) return null;
  const barHeights = [8, 12, 10, 14];

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-cyan-500/30 rounded-full">
      {/* SFX wave bars animation */}
      <div className="flex items-center gap-0.5">
        {barHeights.map((height, i) => (
          <div
            key={i}
            className="w-1 bg-cyan-400 rounded-full animate-pulse"
            style={{
              height: `${height}px`,
              animationDelay: `${i * 0.12}s`
            }}
          />
        ))}
      </div>
      {/* Active SFX pills */}
      {activeSfx.slice(0, 3).map((sfx, i) => (
        <span key={sfx.key || i} className="text-cyan-400 text-xs">
          {sfx.name}
        </span>
      ))}
      {activeSfx.length > 3 && (
        <span className="text-cyan-400/60 text-xs">+{activeSfx.length - 3}</span>
      )}
    </div>
  );
}

export default SfxIndicator;
