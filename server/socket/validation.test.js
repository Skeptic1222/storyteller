import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSocketEvent } from './validation.js';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SCENE_ID = '223e4567-e89b-42d3-a456-426614174000';
const CHOICE_ID = '323e4567-e89b-42d3-a456-426614174000';

describe('Socket validation', () => {
  test('continue-story preserves voice_id and autoplay', () => {
    const result = validateSocketEvent('continue-story', {
      session_id: SESSION_ID,
      voice_id: 'voice_abc',
      autoplay: true,
      direction: 'Continue with suspense'
    });

    assert.equal(result.valid, true);
    assert.equal(result.sanitized.session_id, SESSION_ID);
    assert.equal(result.sanitized.voice_id, 'voice_abc');
    assert.equal(result.sanitized.autoplay, true);
    assert.equal(result.sanitized.direction, 'Continue with suspense');
  });

  test('voice-input preserves confidence and clamps range', () => {
    const result = validateSocketEvent('voice-input', {
      session_id: SESSION_ID,
      transcript: 'hello there',
      confidence: 1.5
    });

    assert.equal(result.valid, true);
    assert.equal(result.sanitized.session_id, SESSION_ID);
    assert.equal(result.sanitized.confidence, 1);
  });

  test('submit-choice preserves recording metadata', () => {
    const result = validateSocketEvent('submit-choice', {
      session_id: SESSION_ID,
      choice_id: CHOICE_ID,
      from_recording: true,
      diverge_at_segment: 7
    });

    assert.equal(result.valid, true);
    assert.equal(result.sanitized.choice_id, CHOICE_ID);
    assert.equal(result.sanitized.from_recording, true);
    assert.equal(result.sanitized.diverge_at_segment, 7);
  });

  test('request-picture-book-images requires valid session and scene IDs', () => {
    const ok = validateSocketEvent('request-picture-book-images', {
      session_id: SESSION_ID,
      scene_id: SCENE_ID
    });
    const bad = validateSocketEvent('request-picture-book-images', {
      session_id: SESSION_ID,
      scene_id: 'not-a-uuid'
    });

    assert.equal(ok.valid, true);
    assert.equal(ok.sanitized.scene_id, SCENE_ID);
    assert.equal(bad.valid, false);
  });

  test('check-ready validates session payload', () => {
    const result = validateSocketEvent('check-ready', { session_id: SESSION_ID });
    assert.equal(result.valid, true);
    assert.equal(result.sanitized.session_id, SESSION_ID);
  });
});

