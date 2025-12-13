/**
 * Recording Service
 * Client-side API for story recording management
 */

import { apiCall, API_BASE } from '../config';

/**
 * Check if a recording exists for a session
 * @param {string} sessionId - Story session ID
 * @returns {Promise<Object>} Recording info or null
 */
export async function getSessionRecordings(sessionId) {
  try {
    const response = await apiCall(`/recordings/session/${sessionId}`);
    if (!response.ok) return { recordings: [], count: 0, hasComplete: false };
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to get session recordings:', error);
    return { recordings: [], count: 0, hasComplete: false };
  }
}

/**
 * Get a specific recording with its segments
 * @param {string} recordingId - Recording ID
 * @returns {Promise<Object>} Recording with segments
 */
export async function getRecording(recordingId) {
  try {
    const response = await apiCall(`/recordings/${recordingId}`);
    if (!response.ok) throw new Error('Recording not found');
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to get recording:', error);
    return null;
  }
}

/**
 * Get segments for a recording
 * @param {string} recordingId - Recording ID
 * @returns {Promise<Array>} List of segments
 */
export async function getRecordingSegments(recordingId) {
  try {
    const response = await apiCall(`/recordings/${recordingId}/segments`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.segments || [];
  } catch (error) {
    console.error('[RecordingService] Failed to get segments:', error);
    return [];
  }
}

/**
 * Check if a CYOA path has a recording
 * @param {string} sessionId - Session ID
 * @param {Array<string>} choices - Array of choice keys
 * @returns {Promise<Object>} Path match info
 */
export async function checkPath(sessionId, choices = []) {
  try {
    const response = await apiCall('/recordings/check-path', {
      method: 'POST',
      body: JSON.stringify({ sessionId, choices })
    });
    if (!response.ok) return { hasRecording: false };
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to check path:', error);
    return { hasRecording: false };
  }
}

/**
 * Check if a specific choice has a recording
 * @param {string} sessionId - Session ID
 * @param {string|null} currentPath - Current path signature
 * @param {string} choiceKey - Choice key to check
 * @returns {Promise<boolean>}
 */
export async function checkChoice(sessionId, currentPath, choiceKey) {
  try {
    const response = await apiCall('/recordings/check-choice', {
      method: 'POST',
      body: JSON.stringify({ sessionId, currentPath, choiceKey })
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.hasRecording;
  } catch (error) {
    console.error('[RecordingService] Failed to check choice:', error);
    return false;
  }
}

/**
 * Get available recorded paths from current position
 * @param {string} sessionId - Session ID
 * @param {string|null} currentPath - Current path signature
 * @returns {Promise<Object>} Map of choice keys to recording IDs
 */
export async function getAvailablePaths(sessionId, currentPath = null) {
  try {
    const url = `/recordings/session/${sessionId}/available-paths${currentPath ? `?currentPath=${encodeURIComponent(currentPath)}` : ''}`;
    const response = await apiCall(url);
    if (!response.ok) return {};
    const data = await response.json();
    return data.recordedChoices || {};
  } catch (error) {
    console.error('[RecordingService] Failed to get available paths:', error);
    return {};
  }
}

/**
 * Record a play event
 * @param {string} recordingId - Recording ID
 * @param {string} userId - Optional user ID
 * @returns {Promise<Object>} Playback session info
 */
export async function startPlayback(recordingId, userId = null) {
  try {
    const response = await apiCall(`/recordings/${recordingId}/play`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    if (!response.ok) throw new Error('Failed to start playback');
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to start playback:', error);
    return null;
  }
}

/**
 * Update playback position
 * @param {string} playbackId - Playback session ID
 * @param {number} segmentIndex - Current segment
 * @param {number} positionSeconds - Position within segment
 */
export async function updatePlaybackPosition(playbackId, segmentIndex, positionSeconds) {
  try {
    await apiCall(`/recordings/playback/${playbackId}/position`, {
      method: 'POST',
      body: JSON.stringify({ segmentIndex, positionSeconds })
    });
  } catch (error) {
    // Non-critical, log but don't throw
    console.warn('[RecordingService] Failed to update playback position:', error);
  }
}

/**
 * Mark playback as complete
 * @param {string} playbackId - Playback session ID
 */
export async function completePlayback(playbackId) {
  try {
    await apiCall(`/recordings/playback/${playbackId}/complete`, {
      method: 'POST'
    });
  } catch (error) {
    console.warn('[RecordingService] Failed to complete playback:', error);
  }
}

/**
 * Mark a recording as interrupted (for recovery)
 * Called via sendBeacon on page unload
 * @param {string} recordingId - Recording ID
 * @param {number} lastSegmentIndex - Last successfully played segment
 */
export function markInterrupted(recordingId, lastSegmentIndex) {
  // Use sendBeacon for reliable delivery on page close
  const data = JSON.stringify({
    lastSegmentIndex,
    interruptedAt: new Date().toISOString()
  });

  navigator.sendBeacon(
    `${API_BASE}/recordings/${recordingId}/interrupt`,
    new Blob([data], { type: 'application/json' })
  );
}

/**
 * Check for interrupted recordings that can be recovered
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Recovery info
 */
export async function checkRecovery(sessionId) {
  try {
    const response = await apiCall(`/recordings/session/${sessionId}/recover`);
    if (!response.ok) return { hasInterrupted: false };
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to check recovery:', error);
    return { hasInterrupted: false };
  }
}

/**
 * Resume an interrupted recording
 * @param {string} recordingId - Recording ID
 * @returns {Promise<Object>} Resumed recording info
 */
export async function resumeRecording(recordingId) {
  try {
    const response = await apiCall(`/recordings/${recordingId}/resume`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Failed to resume recording');
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to resume recording:', error);
    return null;
  }
}

/**
 * Validate a recording's integrity
 * @param {string} recordingId - Recording ID
 * @returns {Promise<Object>} Validation results
 */
export async function validateRecording(recordingId) {
  try {
    const response = await apiCall(`/recordings/${recordingId}/validate`, {
      method: 'POST'
    });
    if (!response.ok) return { isValid: false };
    return await response.json();
  } catch (error) {
    console.error('[RecordingService] Failed to validate recording:', error);
    return { isValid: false };
  }
}

/**
 * Delete a recording
 * @param {string} recordingId - Recording ID
 * @returns {Promise<boolean>}
 */
export async function deleteRecording(recordingId) {
  try {
    const response = await apiCall(`/recordings/${recordingId}`, {
      method: 'DELETE'
    });
    return response.ok;
  } catch (error) {
    console.error('[RecordingService] Failed to delete recording:', error);
    return false;
  }
}

export default {
  getSessionRecordings,
  getRecording,
  getRecordingSegments,
  checkPath,
  checkChoice,
  getAvailablePaths,
  startPlayback,
  updatePlaybackPosition,
  completePlayback,
  markInterrupted,
  checkRecovery,
  resumeRecording,
  validateRecording,
  deleteRecording
};
