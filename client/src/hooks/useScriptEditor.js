/**
 * useScriptEditor Hook
 * Manages state and API calls for the Script Editor page.
 * Provides full script data, segment selection, rendering state,
 * and all actions needed to edit and render voice-acted segments.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../config';

/**
 * Hook for managing script editor state and operations.
 * @param {string} sessionId - Story session ID
 * @returns {Object} Script state and action callbacks
 */
export function useScriptEditor(sessionId) {
  // Core data state
  const [script, setScript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI interaction state
  const [selectedSegment, setSelectedSegment] = useState(null);

  // Tracks which segment IDs are currently being rendered
  const [renderingSegments, setRenderingSegments] = useState(new Set());

  // Ref to avoid triggering effects on aborted fetches
  const abortControllerRef = useRef(null);

  // ------------------------------------------------------------------
  // Core fetch
  // ------------------------------------------------------------------

  const fetchScript = useCallback(async () => {
    if (!sessionId) return;

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await apiCall(`/script/${sessionId}`, {
        signal: controller.signal
      });

      if (!response.ok) {
        let message = `Failed to load script (${response.status})`;
        try {
          const data = await response.json();
          message = data.error || message;
        } catch { /* ignore parse errors */ }
        throw new Error(message);
      }

      const data = await response.json();
      setScript(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[useScriptEditor] fetchScript error:', err);
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [sessionId]);

  // Fetch on mount / sessionId change
  useEffect(() => {
    fetchScript();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchScript]);

  // ------------------------------------------------------------------
  // Segment helpers
  // ------------------------------------------------------------------

  /** Mark a segment as rendering (adds to Set) */
  const markRendering = useCallback((segmentId) => {
    setRenderingSegments(prev => {
      const next = new Set(prev);
      next.add(segmentId);
      return next;
    });
  }, []);

  /** Remove a segment from the rendering Set */
  const unmarkRendering = useCallback((segmentId) => {
    setRenderingSegments(prev => {
      const next = new Set(prev);
      next.delete(segmentId);
      return next;
    });
  }, []);

  /**
   * Optimistically update a segment within script state.
   * Accepts a partial segment object merged over the existing one.
   */
  const patchSegmentInState = useCallback((segmentId, patch) => {
    setScript(prev => {
      if (!prev) return prev;
      const scenes = (prev.scenes || []).map(scene => ({
        ...scene,
        segments: (scene.segments || []).map(seg =>
          seg.id === segmentId ? { ...seg, ...patch } : seg
        )
      }));
      return { ...prev, scenes };
    });
  }, []);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * PATCH segment with user overrides (emotion, stability, style, etc.)
   * @param {string} segmentId
   * @param {Object} overrides - partial voice direction overrides
   */
  const updateSegmentOverrides = useCallback(async (segmentId, overrides) => {
    try {
      const response = await apiCall(`/script/${sessionId}/segments/${segmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ overrides })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Update failed (${response.status})`);
      }

      const updated = await response.json();
      patchSegmentInState(segmentId, updated.segment || overrides);
      return updated;
    } catch (err) {
      console.error('[useScriptEditor] updateSegmentOverrides error:', err);
      throw err;
    }
  }, [sessionId, patchSegmentInState]);

  /**
   * POST render a single segment to audio via ElevenLabs.
   * Updates segment status to 'rendering' optimistically, then 'rendered' on success.
   * @param {string} segmentId
   */
  const renderSegment = useCallback(async (segmentId) => {
    markRendering(segmentId);
    patchSegmentInState(segmentId, { render_status: 'rendering' });

    try {
      const response = await apiCall(`/script/${sessionId}/segments/${segmentId}/render`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        patchSegmentInState(segmentId, { render_status: 'error', render_error: data.error });
        throw new Error(data.error || `Render failed (${response.status})`);
      }

      const data = await response.json();
      patchSegmentInState(segmentId, {
        render_status: 'rendered',
        audio_url: data.audioUrl || data.audio_url,
        render_error: null,
        ...( data.segment || {} )
      });
      return data;
    } catch (err) {
      console.error('[useScriptEditor] renderSegment error:', err);
      throw err;
    } finally {
      unmarkRendering(segmentId);
    }
  }, [sessionId, markRendering, unmarkRendering, patchSegmentInState]);

  /**
   * POST preview a segment - returns a temporary audio blob URL for in-browser playback.
   * The caller is responsible for revoking the blob URL when done.
   * @param {string} segmentId
   * @returns {Promise<string>} blob URL
   */
  const previewSegment = useCallback(async (segmentId) => {
    markRendering(segmentId);
    try {
      const response = await apiCall(`/script/${sessionId}/segments/${segmentId}/preview`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Preview failed (${response.status})`);
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error('[useScriptEditor] previewSegment error:', err);
      throw err;
    } finally {
      unmarkRendering(segmentId);
    }
  }, [sessionId, markRendering, unmarkRendering]);

  /**
   * POST render all pending segments in one call.
   * The server handles batching. Optimistically marks all pending segments.
   */
  const renderAll = useCallback(async () => {
    // Collect all pending segment IDs from script state
    const pendingIds = [];
    (script?.scenes || []).forEach(scene => {
      (scene.segments || []).forEach(seg => {
        if (seg.render_status === 'pending' || seg.render_status === 'stale' || !seg.render_status) {
          pendingIds.push(seg.id);
        }
      });
    });

    // Optimistically mark all as rendering
    pendingIds.forEach(id => {
      markRendering(id);
      patchSegmentInState(id, { render_status: 'rendering' });
    });

    try {
      const response = await apiCall(`/script/${sessionId}/render-all`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // Revert optimistic updates on error
        pendingIds.forEach(id => {
          patchSegmentInState(id, { render_status: 'pending' });
          unmarkRendering(id);
        });
        throw new Error(data.error || `Render all failed (${response.status})`);
      }

      const data = await response.json();

      // Update individual segments from server response
      if (data.segments) {
        data.segments.forEach(seg => {
          patchSegmentInState(seg.id, seg);
        });
      }

      // Unmark all (server handles actual progress)
      pendingIds.forEach(id => unmarkRendering(id));

      return data;
    } catch (err) {
      console.error('[useScriptEditor] renderAll error:', err);
      throw err;
    }
  }, [sessionId, script, markRendering, unmarkRendering, patchSegmentInState]);

  /**
   * PATCH character voice assignment.
   * @param {string} charId - character ID
   * @param {string} newVoiceId - ElevenLabs voice ID
   */
  const changeCharacterVoice = useCallback(async (charId, newVoiceId) => {
    try {
      const response = await apiCall(`/script/${sessionId}/characters/${charId}/voice`, {
        method: 'PATCH',
        body: JSON.stringify({ voiceId: newVoiceId })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Voice change failed (${response.status})`);
      }

      const data = await response.json();

      // Update character in script state
      setScript(prev => {
        if (!prev) return prev;
        const characters = (prev.characters || []).map(c =>
          c.id === charId ? { ...c, voice_id: newVoiceId, ...( data.character || {} ) } : c
        );
        return { ...prev, characters };
      });

      return data;
    } catch (err) {
      console.error('[useScriptEditor] changeCharacterVoice error:', err);
      throw err;
    }
  }, [sessionId]);

  /**
   * POST generate AI voice directions for all segments.
   * Refreshes script data after completion.
   */
  const generateDirections = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiCall(`/script/${sessionId}/directions`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Generate directions failed (${response.status})`);
      }

      // Reload full script with new directions
      await fetchScript();
    } catch (err) {
      console.error('[useScriptEditor] generateDirections error:', err);
      setLoading(false);
      throw err;
    }
  }, [sessionId, fetchScript]);

  /**
   * POST rerun AI voice directions (override existing ones).
   * Refreshes script data after completion.
   */
  const rerunDirections = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiCall(`/script/${sessionId}/directions/rerun`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Rerun directions failed (${response.status})`);
      }

      await fetchScript();
    } catch (err) {
      console.error('[useScriptEditor] rerunDirections error:', err);
      setLoading(false);
      throw err;
    }
  }, [sessionId, fetchScript]);

  /**
   * GET usage estimate for rendering all pending segments.
   * Returns estimated character count, cost, etc.
   */
  const getUsageEstimate = useCallback(async () => {
    try {
      const response = await apiCall(`/script/${sessionId}/usage-estimate`);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Usage estimate failed (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      console.error('[useScriptEditor] getUsageEstimate error:', err);
      throw err;
    }
  }, [sessionId]);

  /**
   * Set the currently selected segment by ID.
   * Pass null to deselect.
   * @param {string|null} segmentId
   */
  const selectSegment = useCallback((segmentId) => {
    if (!segmentId) {
      setSelectedSegment(null);
      return;
    }

    // Find the segment object across all scenes
    let found = null;
    for (const scene of (script?.scenes || [])) {
      for (const seg of (scene.segments || [])) {
        if (seg.id === segmentId) {
          found = seg;
          break;
        }
      }
      if (found) break;
    }

    setSelectedSegment(found);
  }, [script]);

  /**
   * Keep selectedSegment reference in sync when script data updates.
   * Ensures controls reflect latest server state after patches.
   */
  useEffect(() => {
    if (!selectedSegment || !script) return;

    let fresh = null;
    for (const scene of (script.scenes || [])) {
      for (const seg of (scene.segments || [])) {
        if (seg.id === selectedSegment.id) {
          fresh = seg;
          break;
        }
      }
      if (fresh) break;
    }

    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedSegment)) {
      setSelectedSegment(fresh);
    }
  }, [script]);  // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Reload full script data from the server.
   */
  const refresh = useCallback(() => {
    return fetchScript();
  }, [fetchScript]);

  // ------------------------------------------------------------------
  // Derived stats exposed for convenience
  // ------------------------------------------------------------------
  const stats = (() => {
    if (!script) return null;

    let total = 0;
    let rendered = 0;
    let pending = 0;
    let totalChars = 0;

    (script.scenes || []).forEach(scene => {
      (scene.segments || []).forEach(seg => {
        total++;
        totalChars += (seg.text || '').length;
        if (seg.render_status === 'rendered') rendered++;
        else pending++;
      });
    });

    return { total, rendered, pending, totalChars };
  })();

  return {
    // State
    script,
    selectedSegment,
    loading,
    error,
    renderingSegments,
    stats,

    // Actions
    updateSegmentOverrides,
    renderSegment,
    previewSegment,
    renderAll,
    changeCharacterVoice,
    generateDirections,
    rerunDirections,
    getUsageEstimate,
    selectSegment,
    refresh
  };
}

export default useScriptEditor;
