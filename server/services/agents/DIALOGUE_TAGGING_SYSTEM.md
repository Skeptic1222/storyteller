# Dialogue Tagging System Documentation

**Version:** 2.1.0
**Date:** 2025-12-11
**Status:** PRODUCTION - C+E ARCHITECTURE FOR BULLETPROOF VOICE CASTING

## Overview

The Dialogue Tagging System is a **PREMIUM** feature that ensures accurate speaker attribution for multi-voice audiobook narration. **Version 2.0** introduces the C+E Architecture for **100% guaranteed voice casting success**.

## C+E Architecture (Version 2.0)

### What is C+E?

- **Option C**: Scene writer outputs dialogue metadata **alongside prose** (speakers named at creation time)
- **Option E**: Speaker Validation Teacher ensures **all speakers have voices** before audio generation

### Why C+E?

The previous architecture (v1.0) had a critical flaw:
- Dialogue tagging ran **after** scene generation
- The LLM could create speakers NOT in the character database
- This caused voice assignment failures and fallback to narrator voice

**C+E solves this by:**
1. Making the scene writer responsible for naming ALL speakers upfront
2. Creating minor characters (guards, waitresses, etc.) in the database automatically
3. Assigning voices to all speakers BEFORE audio generation
4. **FAILING LOUD** if any speaker lacks a voice (no fallbacks)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     C+E ARCHITECTURE FLOW (v2.0)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. ★ OPTION C: generateSceneWithDialogue() ★                              │
│     ├── Generates prose with dialogue                                       │
│     ├── Returns dialogue_map alongside prose (all speakers named!)         │
│     ├── Returns new_characters[] for minor/unnamed speakers                │
│     └── Uses same LLM call for both (efficient)                            │
│                    ↓                                                        │
│  2. Scene saved to database (story_scenes table)                           │
│                    ↓                                                        │
│  3. ★ OPTION E: validateAndReconcileSpeakers() ★                          │
│     ├── Validates every speaker exists in character DB                     │
│     ├── Creates minor characters from new_characters[]                     │
│     ├── Assigns voices to new characters (LLM voice casting)              │
│     └── FAILS LOUD if any speaker cannot get a voice                       │
│                    ↓                                                        │
│  4. dialogue_map saved to story_scenes.dialogue_map                        │
│                    ↓                                                        │
│  5. Audio Generation                                                        │
│     ├── Reads pre-computed dialogue_map from DB                            │
│     ├── All speakers GUARANTEED to have voices                             │
│     └── Multi-voice audio generation succeeds 100%                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### C+E Implementation (v2.0)
| File | Purpose |
|------|---------|
| `server/services/openai.js:generateSceneWithDialogue()` | **OPTION C** - Scene writer with embedded dialogue metadata |
| `server/services/agents/speakerValidationAgent.js` | **OPTION E** - Teacher that validates and creates speakers |
| `server/services/orchestrator.js` | Integration of C+E flow |
| `server/services/elevenlabs.js:prepareSegmentsWithVoices()` | Strict validation (no fallbacks) |

### Utilities
| File | Purpose |
|------|---------|
| `server/services/agents/dialogueSegmentUtils.js` | Converts dialogue_map to audio segments |

### Archived (v2.1.0 - No longer used, FAIL LOUD instead of fallback)
| File | Status |
|------|--------|
| `server/services/agents/_archived/dialogueTaggingAgent.js` | **ARCHIVED** - Was primary in v1.0 |
| `server/services/agents/_archived/dialogueAttributionAgent.js` | **ARCHIVED** - Was fallback in v1.0/v2.0 |
| `server/services/openai.js:parseDialogueSegments()` | **DEPRECATED** - Regex-based, DO NOT USE |

## Database Schema

```sql
-- story_scenes table
dialogue_map JSONB DEFAULT NULL
dialogue_tagging_status VARCHAR(20) DEFAULT NULL  -- completed/failed/skipped
dialogue_tagging_error TEXT DEFAULT NULL

-- characters table (for new minor characters)
-- Minor characters created by speakerValidationAgent have:
-- traits_json: {"created_by": "speaker_validation_agent", "scene_introduced": true}
```

### dialogue_map Format (v2.0)
```json
[
  {
    "quote": "exact text inside the quotes",
    "speaker": "Character Full Name",
    "speaker_gender": "male|female|unknown",
    "emotion": "neutral|angry|sad|happy|scared|whispered|shouted|etc",
    "is_new_character": false
  }
]
```

### new_characters Format (v2.0)
```json
[
  {
    "name": "Zamoran Guard #1",
    "gender": "male",
    "role": "minor",
    "description": "A guard at the city gate"
  }
]
```

## API Functions

### generateSceneWithDialogue() - Option C
```javascript
// In server/services/openai.js
const result = await generateSceneWithDialogue({
  outline, sceneIndex, previousScene, characters, preferences,
  lorebookContext, storyBible, contextSummary, complexity, sessionId
});

// Returns:
{
  content: "The prose text...",
  dialogue_map: [...],
  new_characters: [...]
}
```

### validateAndReconcileSpeakers() - Option E
```javascript
// In server/services/agents/speakerValidationAgent.js
const result = await validateAndReconcileSpeakers(
  sessionId,
  dialogueMap,
  newCharacters,      // From scene generation
  existingCharacters, // From database
  storyContext,
  narratorVoiceId
);

// Returns:
{
  validatedDialogueMap: [...],
  createdCharacters: [...],   // New characters added to DB
  voiceAssignments: {...}     // All speaker-to-voice mappings
}
```

### quickValidateSpeakers() - Pre-flight Check
```javascript
// Quick check before audio generation
const { valid, missingSpeakers } = await quickValidateSpeakers(sessionId, dialogueMap);
if (!valid) {
  throw new Error(`Speakers without voices: ${missingSpeakers.join(', ')}`);
}
```

## Integration in Orchestrator

### Scene Generation (C+E Flow)
```javascript
// ★ OPTION C: Generate scene with embedded dialogue metadata
const sceneResult = await generateSceneWithDialogue({...});
const sceneDialogueMap = sceneResult.dialogue_map;
const sceneNewCharacters = sceneResult.new_characters;

// ★ OPTION E: Validate and reconcile speakers
const speakerValidationResult = await validateAndReconcileSpeakers(
  this.sessionId,
  sceneDialogueMap,
  sceneNewCharacters,
  this.characters,
  storyContext,
  narratorVoiceId
);

// Update character list with new minor characters
if (speakerValidationResult.createdCharacters.length > 0) {
  this.characters = [...this.characters, ...speakerValidationResult.createdCharacters];
}
```

## Error Handling Philosophy (FAIL LOUD)

This is a **PREMIUM SERVICE**. The system:
1. **NEVER** falls back to narrator voice for character dialogue
2. **FAILS LOUD** if any speaker cannot get a voice
3. **STOPS** story generation rather than produce bad audio
4. **LOGS** detailed diagnostics for debugging

### Error in prepareSegmentsWithVoices()
```javascript
// If a speaker is not found in character voice map:
const errorMsg = `[MultiVoice] CRITICAL: Speaker "${segment.speaker}" not found!`;
throw new Error(errorMsg);  // NO FALLBACK
```

### Error in speakerValidationAgent
```javascript
// If speakers exist without being in ANY character list:
throw new Error(`SPEAKER VALIDATION FAILED: Speakers not in character list: [${stillUnknown.join(', ')}]`);
```

## CRITICAL: What NOT to Do

### DO NOT:
1. ❌ Use `tagDialogue()` from dialogueTaggingAgent.js (deprecated)
2. ❌ Re-enable narrator fallback in elevenlabs.js
3. ❌ Allow speakers not in character database
4. ❌ Skip speaker validation after scene generation
5. ❌ Use regex-based `parseDialogueSegments()`

### DO:
1. ✅ Use `generateSceneWithDialogue()` for scene generation
2. ✅ Run `validateAndReconcileSpeakers()` after every scene
3. ✅ Create minor characters in database for unnamed speakers
4. ✅ Assign voices to ALL characters before audio generation
5. ✅ FAIL LOUD if any speaker lacks a voice

## Testing Checklist

When testing multi-voice narration with C+E architecture:
- [ ] Check logs for `[Scene+Dialogue]` messages
- [ ] Verify `dialogue_map` includes all speakers
- [ ] Confirm `new_characters` are created in database
- [ ] Check `[SpeakerValidation]` logs for voice assignments
- [ ] Verify NO fallback to narrator for character dialogue
- [ ] Test with scenes that have unnamed speakers (guards, servants, etc.)
- [ ] Verify gender consistency (female speaker → female voice)

## Troubleshooting

### "Speaker not found in character voice map"
This error means C+E failed somewhere:
1. Check if `generateSceneWithDialogue()` returned the speaker in `new_characters[]`
2. Check if `validateAndReconcileSpeakers()` created the character in DB
3. Check if voice was assigned to the character

### "Voice pool exhausted"
Too many characters for available voices:
1. Check how many male vs female voices are available
2. Consider reducing minor characters in the story
3. Check for duplicate character creation

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-11 | 2.1.0 | Archived deprecated agents, FAIL LOUD (no fallbacks) |
| 2025-12-10 | 2.0.0 | C+E Architecture: bulletproof voice casting |
| 2025-12-09 | 1.0.0 | Initial Dialogue Tagging Agent |

## Migration from v1.0

If upgrading from v1.0:
1. The orchestrator now uses `generateSceneWithDialogue()` instead of `generateScene()`
2. `tagDialogue()` is no longer called - dialogue is embedded in scene generation
3. `speakerValidationAgent.js` is a new required component
4. Narrator fallback in `elevenlabs.js` has been removed (will throw errors)

## Contact

For issues with this system, check:
1. This documentation
2. `CLAUDE.md` in project root
3. Logs at `logs/service.log` and `logs/error.log`
4. Database tables: `characters`, `character_voice_assignments`, `story_scenes.dialogue_map`
