import { useRef, useEffect, useCallback, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

/**
 * SFX Player Component
 * Manages multiple sound effects with timing, fades, and volume control
 * Used during recording playback to sync ambient sounds with narration
 */
function SFXPlayer({
  sfxData = [],
  currentTime = 0,
  isPlaying = false,
  masterVolume = 0.3,
  enabled = true,
  onSFXStart,
  onSFXEnd
}) {
  const sfxRefs = useRef(new Map());
  const animationFrameRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const [activeSFX, setActiveSFX] = useState([]);
  const [isMuted, setIsMuted] = useState(false);

  // Initialize audio elements for each SFX
  useEffect(() => {
    if (!enabled || !sfxData.length) return;

    // Create audio elements for new SFX
    sfxData.forEach(sfx => {
      if (!sfxRefs.current.has(sfx.sfx_id)) {
        const audio = new Audio();
        audio.src = sfx.audio_url;
        audio.loop = sfx.loop || false;
        audio.volume = 0; // Start silent, fade in handled by animation
        audio.preload = 'auto';

        // Prevent audio from affecting page performance
        audio.crossOrigin = 'anonymous';

        sfxRefs.current.set(sfx.sfx_id, {
          audio,
          config: sfx,
          isPlaying: false
        });
      }
    });

    // Cleanup old SFX that are no longer in the list
    const currentIds = new Set(sfxData.map(s => s.sfx_id));
    for (const [id, { audio }] of sfxRefs.current) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = '';
        sfxRefs.current.delete(id);
      }
    }

    return () => {
      // Full cleanup on unmount
      sfxRefs.current.forEach(({ audio }) => {
        audio.pause();
        audio.src = '';
      });
      sfxRefs.current.clear();
    };
  }, [sfxData, enabled]);

  /**
   * Calculate volume with fade envelope
   */
  const calculateVolume = useCallback((sfx, time) => {
    const sfxStart = sfx.trigger_at_seconds || 0;
    const sfxEnd = sfxStart + (sfx.duration_seconds || 30);
    const fadeInSec = (sfx.fade_in_ms || 2000) / 1000;
    const fadeOutSec = (sfx.fade_out_ms || 2000) / 1000;
    const baseVolume = sfx.volume ?? 0.3;

    // Check if SFX should be playing
    if (time < sfxStart || time >= sfxEnd) {
      return 0;
    }

    let volume = baseVolume;

    // Fade in
    const fadeInEnd = sfxStart + fadeInSec;
    if (time < fadeInEnd) {
      const fadeProgress = (time - sfxStart) / fadeInSec;
      volume *= Math.min(1, fadeProgress);
    }

    // Fade out
    const fadeOutStart = sfxEnd - fadeOutSec;
    if (time >= fadeOutStart) {
      const fadeProgress = (sfxEnd - time) / fadeOutSec;
      volume *= Math.min(1, fadeProgress);
    }

    // Apply master volume and mute
    return isMuted ? 0 : Math.max(0, Math.min(1, volume * masterVolume));
  }, [masterVolume, isMuted]);

  /**
   * Update SFX playback based on current time
   */
  const updateSFX = useCallback(() => {
    if (!enabled || !isPlaying) return;

    const time = currentTime;
    const newActiveSFX = [];

    sfxData.forEach(sfx => {
      const sfxRef = sfxRefs.current.get(sfx.sfx_id);
      if (!sfxRef) return;

      const { audio, config } = sfxRef;
      const sfxStart = config.trigger_at_seconds || 0;
      const sfxEnd = sfxStart + (config.duration_seconds || 30);
      const shouldPlay = time >= sfxStart && time < sfxEnd;

      const calculatedVolume = calculateVolume(config, time);

      if (shouldPlay) {
        // Set volume
        audio.volume = calculatedVolume;

        // Start playing if not already
        if (audio.paused) {
          const localTime = time - sfxStart;

          // For looping sounds, wrap the time
          if (config.loop && audio.duration) {
            audio.currentTime = localTime % audio.duration;
          } else {
            audio.currentTime = Math.min(localTime, audio.duration || localTime);
          }

          audio.play().catch(err => {
            // Autoplay blocked - common on mobile
            console.warn(`SFX play blocked for ${config.sfx_key}:`, err.message);
          });

          if (!sfxRef.isPlaying) {
            sfxRef.isPlaying = true;
            onSFXStart?.(config);
          }
        }

        newActiveSFX.push({
          id: sfx.sfx_id,
          key: config.sfx_key,
          volume: calculatedVolume
        });

      } else {
        // Stop playing if it was playing
        if (!audio.paused) {
          audio.pause();

          if (sfxRef.isPlaying) {
            sfxRef.isPlaying = false;
            onSFXEnd?.(config);
          }
        }
      }
    });

    setActiveSFX(newActiveSFX);
  }, [sfxData, currentTime, isPlaying, enabled, calculateVolume, onSFXStart, onSFXEnd]);

  // Run update on each frame when playing
  useEffect(() => {
    if (!isPlaying || !enabled) {
      // Pause all SFX when not playing
      sfxRefs.current.forEach(({ audio }) => audio.pause());
      cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    const animate = () => {
      updateSFX();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, enabled, updateSFX]);

  // Update immediately when currentTime changes significantly
  useEffect(() => {
    if (Math.abs(currentTime - lastUpdateTimeRef.current) > 0.5) {
      updateSFX();
      lastUpdateTimeRef.current = currentTime;
    }
  }, [currentTime, updateSFX]);

  // Handle mute changes
  useEffect(() => {
    sfxRefs.current.forEach(({ audio }) => {
      audio.muted = isMuted;
    });
  }, [isMuted]);

  if (!enabled || sfxData.length === 0) {
    return null;
  }

  return (
    <div className="sfx-player flex items-center gap-2 text-night-400">
      {/* Mute toggle */}
      <button
        onClick={() => setIsMuted(!isMuted)}
        className={`p-1.5 rounded-lg transition-colors ${
          isMuted ? 'bg-red-500/20 text-red-400' : 'hover:bg-night-700'
        }`}
        title={isMuted ? 'Unmute SFX' : 'Mute SFX'}
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      {/* Active SFX indicators */}
      {activeSFX.length > 0 && (
        <div className="flex items-center gap-1.5">
          {activeSFX.map(sfx => (
            <div
              key={sfx.id}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-night-700/50 text-xs"
              title={sfx.key}
            >
              {/* Volume indicator */}
              <div
                className="w-1.5 h-3 rounded-full bg-amber-400 transition-all"
                style={{
                  opacity: 0.3 + sfx.volume * 0.7,
                  transform: `scaleY(${0.3 + sfx.volume * 0.7})`
                }}
              />
              <span className="text-night-400 truncate max-w-[60px]">
                {sfx.key.split('.').pop()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* SFX count when none active */}
      {activeSFX.length === 0 && (
        <span className="text-xs text-night-500">
          {sfxData.length} SFX queued
        </span>
      )}
    </div>
  );
}

export default SFXPlayer;
