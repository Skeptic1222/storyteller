# Known Issues

## Active Issues

### Audio Clicking Between Speakers (Minor)
**Status**: Open
**Severity**: Low (cosmetic)
**First Reported**: 2025-12-13

**Description**:
Slight clicking sound (~fraction of second) audible at the end of voice-acted dialogue lines, just before the narrator or next speaker begins. The click occurs at segment boundaries during multi-voice playback.

**Symptoms**:
- Brief "click" or "pop" sound at end of character dialogue
- More noticeable when switching between different voices
- Does not affect functionality - audio plays correctly otherwise

**Probable Cause**:
Audio segment concatenation in `server/services/audioAssembler.js`. When multiple audio segments are joined, there may be:
1. Sample rate mismatches at boundaries
2. Missing crossfade/overlap between segments
3. Abrupt waveform discontinuities (DC offset issues)

**Files to Investigate**:
- `server/services/audioAssembler.js` - Main audio concatenation logic
- `server/services/elevenlabs.js` - Individual segment generation

**Potential Fixes**:
1. Add short crossfade (10-20ms) between audio segments
2. Normalize audio levels at segment boundaries
3. Apply fade-out/fade-in at segment edges
4. Check for sample rate consistency

**Workaround**: None needed - issue is minor and does not affect story experience significantly.

---

## Resolved Issues

### [CHAR] Tags Visible in Display Text
**Status**: RESOLVED (2025-12-13)
**Resolution**: Fixed `orchestrator.js:1568` to call `stripTags()` in return statement

See `docs/CHANGELOG.md` entry for 2025-12-13 for full details.

### `io is not defined` Error in Socket Handlers
**Status**: RESOLVED (2025-12-13)
**Resolution**: Added `getRoomSocketCount()` helper function in `handlers.js`

### Scene Audio Not Playing (Only Title/Synopsis)
**Status**: RESOLVED (2025-12-13)
**Resolution**: Fixed function parameter issues in `handlers.js` - removed incorrect `io` parameter from `streamCachedAudio()` and `streamChoiceAudio()` calls.
