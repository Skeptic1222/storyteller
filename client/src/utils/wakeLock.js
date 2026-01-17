/**
 * Wake Lock utility to prevent screen from sleeping
 * Uses multiple strategies for cross-browser compatibility
 *
 * iOS Safari requires special handling - the Wake Lock API is not supported,
 * so we use a combination of video playback and periodic user interaction simulation.
 */

class WakeLockManager {
  constructor() {
    this.wakeLock = null;
    this.noSleepVideo = null;
    this.noSleepAudio = null;
    this.keepAliveInterval = null;
    this.isActive = false;
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /**
   * Request wake lock - prevents screen from sleeping
   * MUST be called from a user interaction (click/touch) on iOS
   */
  async enable() {
    if (this.isActive) return true;

    console.log('Enabling wake lock, iOS:', this.isIOS);

    // Try native Wake Lock API first (Chrome, Edge, Safari 16.4+)
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          console.log('Wake Lock released');
          this.isActive = false;
        });
        this.isActive = true;
        console.log('Wake Lock acquired (native API)');
        return true;
      } catch (err) {
        console.log('Native Wake Lock failed:', err.message);
      }
    }

    // iOS Safari fallback - use video + audio + keep-alive
    if (this.isIOS) {
      try {
        await this.enableIOSWakeLock();
        this.isActive = true;
        console.log('Wake Lock acquired (iOS fallback)');
        return true;
      } catch (err) {
        console.error('iOS Wake Lock fallback failed:', err);
      }
    }

    // Generic fallback: Use video element trick
    try {
      this.enableVideoWakeLock();
      this.isActive = true;
      console.log('Wake Lock acquired (video fallback)');
      return true;
    } catch (err) {
      console.error('Wake Lock fallback failed:', err);
      return false;
    }
  }

  /**
   * iOS-specific wake lock using multiple techniques
   */
  async enableIOSWakeLock() {
    // 1. Create and play silent audio on loop
    this.enableSilentAudio();

    // 2. Create video element as backup
    this.enableVideoWakeLock();

    // 3. Periodic "activity" to prevent iOS from sleeping
    // iOS checks for activity every ~30 seconds
    this.keepAliveInterval = setInterval(() => {
      if (this.noSleepVideo && this.noSleepVideo.paused) {
        this.noSleepVideo.play().catch(() => {});
      }
      if (this.noSleepAudio && this.noSleepAudio.paused) {
        this.noSleepAudio.play().catch(() => {});
      }
      // Touch the page to simulate activity
      window.dispatchEvent(new Event('touchstart', { bubbles: true }));
    }, 15000); // Every 15 seconds
  }

  /**
   * Play silent audio - helps keep iOS awake
   */
  enableSilentAudio() {
    if (this.noSleepAudio) return;

    // Create audio context for silent playback
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();

      // Create silent oscillator
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 0.001; // Nearly silent
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();

      this.noSleepAudio = { audioCtx, oscillator, gainNode };
      console.log('Silent audio started for iOS wake lock');
    } catch (err) {
      console.log('Silent audio failed:', err);
    }
  }

  /**
   * iOS Safari workaround - plays a tiny looping video
   */
  enableVideoWakeLock() {
    if (this.noSleepVideo) return;

    // Create a small video element that plays silently
    this.noSleepVideo = document.createElement('video');
    this.noSleepVideo.setAttribute('playsinline', ''); // Critical for iOS
    this.noSleepVideo.setAttribute('webkit-playsinline', ''); // Older iOS
    this.noSleepVideo.setAttribute('muted', '');
    this.noSleepVideo.setAttribute('loop', '');
    this.noSleepVideo.muted = true; // Also set property
    this.noSleepVideo.style.position = 'fixed';
    this.noSleepVideo.style.left = '-100px';
    this.noSleepVideo.style.top = '-100px';
    this.noSleepVideo.style.width = '10px';
    this.noSleepVideo.style.height = '10px';
    this.noSleepVideo.style.opacity = '0.01';
    this.noSleepVideo.style.pointerEvents = 'none';

    // Use a proper webm that iOS Safari can handle
    // This is a 1-second silent video encoded as base64
    const webmBase64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFh2EB';

    // Fallback MP4 for broader compatibility
    const mp4Base64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0MiByMjQ3OSBkZDc5YTYxIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAFPZYiEABP//';

    // Try MP4 first (better iOS support)
    this.noSleepVideo.src = 'data:video/mp4;base64,' + mp4Base64;

    document.body.appendChild(this.noSleepVideo);

    // Play immediately - this MUST be called from user interaction context
    const playVideo = () => {
      const playPromise = this.noSleepVideo.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => console.log('Wake lock video playing'))
          .catch((e) => console.log('Video autoplay prevented:', e.message));
      }
    };

    playVideo();

    // Also try on any user interaction
    const retryPlay = () => {
      if (this.noSleepVideo && this.noSleepVideo.paused) {
        playVideo();
      }
    };
    document.addEventListener('touchstart', retryPlay, { once: true });
    document.addEventListener('click', retryPlay, { once: true });
  }

  /**
   * Release wake lock
   */
  async disable() {
    if (!this.isActive) return;

    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
      } catch (err) {
        console.error('Wake Lock release error:', err);
      }
    }

    if (this.noSleepVideo) {
      this.noSleepVideo.pause();
      this.noSleepVideo.remove();
      this.noSleepVideo = null;
    }

    if (this.noSleepAudio) {
      try {
        this.noSleepAudio.oscillator.stop();
        this.noSleepAudio.audioCtx.close();
      } catch (err) {
        // Audio context cleanup errors are expected during page unload
        // Only log if it's an unexpected error type
        if (err.name !== 'InvalidStateError') {
          console.warn('Wake Lock audio cleanup error:', err.message);
        }
      }
      this.noSleepAudio = null;
    }

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.isActive = false;
    console.log('Wake Lock disabled');
  }

  /**
   * Re-acquire wake lock (e.g., after tab becomes visible again)
   */
  async reacquire() {
    if (!this.isActive) return;

    if (this.wakeLock && document.visibilityState === 'visible') {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock reacquired');
      } catch (err) {
        console.log('Wake Lock reacquire failed:', err.message);
      }
    }

    // Restart video if needed
    if (this.noSleepVideo && this.noSleepVideo.paused) {
      this.noSleepVideo.play().catch(() => {});
    }
  }
}

// Singleton instance
export const wakeLock = new WakeLockManager();

// Re-acquire wake lock when page becomes visible
// MEMORY LEAK FIX: Track listener to prevent duplicates during HMR/hot reload
let visibilityListenerAdded = false;
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    wakeLock.reacquire();
  }
};

if (typeof document !== 'undefined' && !visibilityListenerAdded) {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  visibilityListenerAdded = true;
}

// Cleanup function for testing/hot-reload scenarios
export function cleanupWakeLockListeners() {
  if (typeof document !== 'undefined' && visibilityListenerAdded) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityListenerAdded = false;
  }
}

export default wakeLock;
