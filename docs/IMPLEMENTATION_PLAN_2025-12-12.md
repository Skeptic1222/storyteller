# Multi-Voice Bulletproof Implementation Plan
## Context Continuity Document

**Started**: 2025-12-12
**Status**: IMPLEMENTED - READY FOR TESTING
**Goal**: Replace fragile position-based dialogue extraction with bulletproof tag-based markup

---

## Quick Context Restore

If you're continuing this work after context loss, read these files in order:
1. `docs/BULLETPROOF_MULTIVOICE_REDESIGN.md` - Full analysis and architecture
2. `docs/MULTI_VOICE_ISSUES_2025-12-12_v2.md` - Bug inventory (40+ bugs)
3. This file - Implementation status and next steps

---

## Implementation Phases

### Phase 1: FAIL LOUD Guards [STATUS: COMPLETED]
**Files modified:**
- [x] `server/services/agents/speechTagFilterAgent.js` - Throw on empty LLM results
- [x] `server/services/orchestrator.js` - Throw on missing dialogue_map
- [x] `server/services/agents/dialogueSegmentUtils.js` - Throw on position overlaps

### Phase 2: Create Tag Parser [STATUS: COMPLETED]
**Files created:**
- [x] `server/services/agents/tagParser.js` - Deterministic [CHAR] tag parsing
  - `parseTaggedProse()` - Extract segments from tagged prose
  - `validateTagBalance()` - Check tag balance
  - `extractSpeakers()` - Get unique speaker names
  - `stripTags()` - Remove tags for display
  - `hasCharacterTags()` - Check if prose has tags

### Phase 3: Modify Scene Writer Prompt [STATUS: COMPLETED]
**Files modified:**
- [x] `server/services/openai.js` - Added TAG_BASED_MULTIVOICE feature flag
  - New system prompt for [CHAR:Name]dialogue[/CHAR] format
  - Outputs `prose_format: 'tag_based'` and pre-parsed `segments`
  - Backwards compatible with position-based mode

### Phase 4: Create Tag Validation Agent [STATUS: COMPLETED]
**Files created:**
- [x] `server/services/agents/tagValidationAgent.js` - 3-pass validation
  - Pass 1: Tag balance (deterministic)
  - Pass 2: Speaker verification (LLM-assisted)
  - Pass 3: Untagged dialogue detection (LLM-assisted)
  - `applyRepairs()` - Fix speaker name mismatches

### Phase 5: Create Multi-Pass Speech Filter [STATUS: COMPLETED]
**Files modified:**
- [x] `server/services/agents/speechTagFilterAgent.js` - Complete rewrite with 3-pass
  - Pass 1: Initial attribution identification
  - Pass 2: Verification of proposed removals
  - Pass 3: Final validation (no attribution remains)
  - THREE_PASS_MODE feature flag (enabled by default)

### Phase 6: Database Migration [STATUS: COMPLETED]
**Files created:**
- [x] `server/database/migrations/014_tag_based_prose.sql`
  - `prose_format` column (position_based | tag_based)
  - `tag_validation_status` column (pending | validated | failed | legacy)
  - `tag_validation_errors` JSONB column
  - `speakers_extracted` TEXT[] column

### Phase 7: Update Orchestrator Pipeline [STATUS: COMPLETED]
**Files modified:**
- [x] `server/services/orchestrator.js`
  - Imports tag parser and validation agent
  - Handles tag-based segment creation
  - Strips tags for display text
  - Saves prose_format to database

### Phase 8: Testing & Verification [STATUS: IN PROGRESS]
- [ ] Run database migration
- [ ] Restart service
- [ ] Test story generation with multi-voice
- [ ] Verify segments are created correctly
- [ ] Verify speech tags are filtered
- [ ] Check for any remaining narrator repetition issues

---

## Detailed Implementation Notes

### Phase 1: FAIL LOUD Guards

#### speechTagFilterAgent.js Changes
```javascript
// Line ~98-104: Replace silent empty check with throw
// BEFORE:
results = Array.isArray(parsed) ? parsed : (parsed.segments || []);
// If results empty, loop never executes, segments pass unfiltered

// AFTER:
results = Array.isArray(parsed) ? parsed : (parsed.segments || []);
if (results.length === 0) {
  throw new Error('[SpeechTagAgent] FAIL_LOUD: LLM returned zero results');
}
```

#### orchestrator.js Changes
```javascript
// Around line 1151: Add strict check for dialogue_map
// BEFORE: Only logs warning

// AFTER:
if (willUseMultiVoice && (!dialogueMap || dialogueMap.length === 0)) {
  throw new Error('[MultiVoice] FAIL_LOUD: dialogue_map is missing or empty');
}
```

#### dialogueSegmentUtils.js Changes
```javascript
// Line ~47-51: Replace skip with throw on overlap
// BEFORE:
if (dialogue.start_char < lastIndex) {
  logger.error(`OVERLAP_ERROR...`);
  continue;  // Silently skips
}

// AFTER:
if (dialogue.start_char < lastIndex) {
  throw new Error(`[SegmentBuilder] FAIL_LOUD: Position overlap at ${dialogue.start_char}`);
}
```

### Phase 2: Tag Parser

Create `server/services/agents/tagParser.js`:

```javascript
/**
 * Deterministic Tag Parser
 * Parses [CHAR:Name]dialogue[/CHAR] tags without LLM
 *
 * Input: "The knight said, [CHAR:Roland]Hello there![/CHAR] and smiled."
 * Output: [
 *   { type: 'narrator', text: 'The knight said, ' },
 *   { type: 'dialogue', speaker: 'Roland', text: 'Hello there!' },
 *   { type: 'narrator', text: ' and smiled.' }
 * ]
 */

const TAG_REGEX = /\[CHAR:([^\]]+)\]([\s\S]*?)\[\/CHAR\]/g;

export function parseTaggedProse(prose) {
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = TAG_REGEX.exec(prose)) !== null) {
    // Add narrator segment before this dialogue
    if (match.index > lastIndex) {
      const narratorText = prose.slice(lastIndex, match.index).trim();
      if (narratorText) {
        segments.push({
          type: 'narrator',
          speaker: 'narrator',
          text: narratorText
        });
      }
    }

    // Add dialogue segment
    segments.push({
      type: 'dialogue',
      speaker: match[1].trim(),
      text: match[2].trim()
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining narrator text
  if (lastIndex < prose.length) {
    const remainingText = prose.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({
        type: 'narrator',
        speaker: 'narrator',
        text: remainingText
      });
    }
  }

  return segments;
}

export function validateTagBalance(prose) {
  const openTags = (prose.match(/\[CHAR:[^\]]+\]/g) || []).length;
  const closeTags = (prose.match(/\[\/CHAR\]/g) || []).length;

  if (openTags !== closeTags) {
    throw new Error(`TAG_IMBALANCE: ${openTags} open vs ${closeTags} close tags`);
  }

  return true;
}

export function extractSpeakers(prose) {
  const speakers = new Set();
  const matches = prose.matchAll(/\[CHAR:([^\]]+)\]/g);
  for (const match of matches) {
    speakers.add(match[1].trim());
  }
  return Array.from(speakers);
}
```

### Phase 3: Scene Writer Prompt Update

In `openai.js`, update the generateSceneWithDialogue system prompt:

```javascript
const TAGGED_DIALOGUE_SYSTEM_PROMPT = `You are a master storyteller writing a scene.

CRITICAL FORMATTING RULE:
All character dialogue MUST be wrapped in tags: [CHAR:CharacterName]dialogue here[/CHAR]

Example:
WRONG: "Hello," said the knight.
RIGHT: [CHAR:Knight]Hello,[/CHAR] said the knight.

WRONG: The wizard replied, "Indeed it is."
RIGHT: The wizard replied, [CHAR:Wizard]Indeed it is.[/CHAR]

Rules:
1. Every piece of dialogue must have [CHAR:Name]...[/CHAR] tags
2. Character names must match exactly as provided in the cast
3. Tags must be balanced (every open has a close)
4. No nested tags
5. Narration stays outside tags

Return JSON:
{
  "content": "The tagged prose here...",
  "speakers_used": ["Name1", "Name2"],
  "dialogue_count": 5
}`;
```

### Phase 4: Tag Validation Agent

Create `server/services/agents/tagValidationAgent.js`:

```javascript
/**
 * Tag Validation Agent
 * 3-pass validation for tagged prose
 *
 * Pass 1: Verify tag balance (deterministic)
 * Pass 2: Verify all speakers exist in cast (LLM-assisted)
 * Pass 3: Verify no untagged dialogue (LLM-assisted)
 */

import { callLLM } from '../llmProviders.js';
import { getModelForAgent } from '../modelSelection.js';
import { validateTagBalance, extractSpeakers } from './tagParser.js';
import { logger } from '../../utils/logger.js';

export async function validateTaggedProse(prose, characterCast, sessionId) {
  const startTime = Date.now();

  // PASS 1: Tag Balance (Deterministic - no LLM)
  logger.info(`[TagValidation] PASS_1_START | checking tag balance`);
  try {
    validateTagBalance(prose);
    logger.info(`[TagValidation] PASS_1_COMPLETE | tags balanced`);
  } catch (error) {
    logger.error(`[TagValidation] PASS_1_FAILED | ${error.message}`);
    throw error;
  }

  // PASS 2: Speaker Verification (LLM-assisted)
  logger.info(`[TagValidation] PASS_2_START | verifying speakers`);
  const speakers = extractSpeakers(prose);
  const castNames = characterCast.map(c => c.name.toLowerCase());
  const unknownSpeakers = speakers.filter(s =>
    !castNames.includes(s.toLowerCase())
  );

  if (unknownSpeakers.length > 0) {
    const model = getModelForAgent('speaker_validation');
    const result = await callLLM({
      messages: [{
        role: 'user',
        content: `Unknown speakers found: ${unknownSpeakers.join(', ')}
Known cast: ${characterCast.map(c => c.name).join(', ')}

For each unknown, determine:
1. Is this a nickname/alias for a known character? (map it)
2. Is this a new minor character? (add to cast)
3. Is this an error? (flag it)

Return JSON:
{
  "mappings": { "unknown": "known_character" },
  "newCharacters": [{ "name": "...", "role": "minor" }],
  "errors": ["truly unknown speaker names"]
}`
      }],
      model,
      agent_name: 'speaker_validation',
      sessionId
    });

    const parsed = JSON.parse(result.content);
    if (parsed.errors?.length > 0) {
      throw new Error(`[TagValidation] PASS_2_FAILED: Unknown speakers: ${parsed.errors.join(', ')}`);
    }
    logger.info(`[TagValidation] PASS_2_COMPLETE | mappings: ${Object.keys(parsed.mappings || {}).length} | new: ${(parsed.newCharacters || []).length}`);
  } else {
    logger.info(`[TagValidation] PASS_2_COMPLETE | all speakers known`);
  }

  // PASS 3: Check for Untagged Dialogue (LLM-assisted)
  logger.info(`[TagValidation] PASS_3_START | checking for untagged dialogue`);
  const model = getModelForAgent('dialogue_segment');
  const pass3Result = await callLLM({
    messages: [{
      role: 'user',
      content: `Analyze this prose for any dialogue that is NOT inside [CHAR:...][/CHAR] tags.

Prose:
${prose}

Look for:
- Quoted speech without tags
- Dialogue after closing tags
- Missing opening or closing tags

Return JSON:
{
  "untaggedDialogue": [
    { "quote": "the untagged text", "context": "surrounding text" }
  ],
  "allDialogueTagged": true/false
}`
    }],
    model,
    agent_name: 'dialogue_segment',
    sessionId
  });

  const pass3Parsed = JSON.parse(pass3Result.content);
  if (!pass3Parsed.allDialogueTagged) {
    throw new Error(`[TagValidation] PASS_3_FAILED: ${pass3Parsed.untaggedDialogue.length} untagged dialogue instances`);
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[TagValidation] ALL_PASSES_COMPLETE | elapsed: ${elapsed}ms`);

  return { valid: true, speakers, elapsed };
}
```

### Phase 5: Multi-Pass Speech Filter

Rewrite `speechTagFilterAgent.js` with 3-pass approach - see full code in Phase 5 section below.

### Phase 6: Database Migration

Create `server/database/migrations/014_tag_based_prose.sql`:

```sql
-- Migration: Add tag-based prose support
-- Date: 2025-12-12

-- Add prose format indicator
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS prose_format VARCHAR(20) DEFAULT 'position_based'
CHECK (prose_format IN ('position_based', 'tag_based'));

-- Add tagged prose column (keeps original for reference)
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS tagged_prose TEXT;

-- Add validation status
ALTER TABLE story_scenes
ADD COLUMN IF NOT EXISTS tag_validation_status VARCHAR(20) DEFAULT 'pending'
CHECK (tag_validation_status IN ('pending', 'validated', 'failed', 'legacy'));

-- Mark all existing scenes as legacy
UPDATE story_scenes SET prose_format = 'position_based', tag_validation_status = 'legacy'
WHERE prose_format IS NULL OR tag_validation_status IS NULL;

-- Add index for format queries
CREATE INDEX IF NOT EXISTS idx_story_scenes_prose_format ON story_scenes(prose_format);

-- Add JSON schema validation function for dialogue_map
CREATE OR REPLACE FUNCTION validate_dialogue_map_json(data JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  -- For tag_based format, dialogue_map should be empty or null
  -- For position_based format, validate structure
  RETURN TRUE; -- Placeholder - implement full validation
END;
$$ LANGUAGE plpgsql;
```

### Phase 7: Orchestrator Pipeline Update

Key changes to `orchestrator.js`:

1. Check for `TAG_BASED_MULTIVOICE` feature flag
2. If enabled, use new pipeline:
   - Call scene writer with tagged prompt
   - Validate tags
   - Parse with deterministic parser
   - Apply speech tag filter
   - Generate audio
3. If disabled, use legacy position-based pipeline

---

## Progress Tracking

### Completed
- [x] GPT-5.2 model configuration added
- [x] Architecture design document created
- [x] Implementation plan created (this document)

### In Progress
- [ ] Phase 1: FAIL LOUD Guards

### Not Started
- [ ] Phase 2: Tag Parser
- [ ] Phase 3: Scene Writer Prompt
- [ ] Phase 4: Tag Validation Agent
- [ ] Phase 5: Multi-Pass Speech Filter
- [ ] Phase 6: Database Migration
- [ ] Phase 7: Orchestrator Pipeline
- [ ] Phase 8: Testing

---

## Commands for Context Restore

```powershell
# Check current implementation status
Get-ChildItem C:\inetpub\wwwroot\storyteller\server\services\agents\*.js | Select-Object Name

# View recent changes
cd C:\inetpub\wwwroot\storyteller
git status
git diff --stat

# Check logs for errors
Get-Content C:\inetpub\wwwroot\storyteller\logs\combined.log -Tail 100

# Restart service after changes
Restart-Service StorytellerService
```

---

## Key Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `modelSelection.js` | GPT-5.2 config | UPDATED |
| `speechTagFilterAgent.js` | Speech tag removal | NEEDS UPDATE |
| `dialogueSegmentUtils.js` | Segment building | NEEDS UPDATE |
| `orchestrator.js` | Main pipeline | NEEDS UPDATE |
| `openai.js` | Scene generation | NEEDS UPDATE |
| `tagParser.js` | New tag parser | TO CREATE |
| `tagValidationAgent.js` | New validation | TO CREATE |

---

*Last updated: 2025-12-12*
