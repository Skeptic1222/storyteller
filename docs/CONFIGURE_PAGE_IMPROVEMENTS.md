# Configure Page Improvements Plan

**Created**: 2025-12-13
**Based on**: ChatGPT Agent Analysis Report + Claude Code Investigation
**Status**: Approved for Implementation

---

## Summary of Changes

This plan addresses usability, accessibility, and Auto-Detect accuracy issues identified through external testing. Changes are prioritized by impact and complexity.

---

## Phase 1: Critical Bug Fixes (P0-P2)

### P0: Negation Detection in SmartConfig
**File**: `server/services/smartConfig.js`
**Problem**: "no sound effects" enables SFX because keyword matching is purely affirmative.

**Solution**:
1. Add negation detection function before keyword matching
2. Create NEGATION_PREFIXES list: `['no ', 'not ', 'without ', 'don\'t ', 'doesn\'t ', 'never ', 'avoid ', 'skip ']`
3. When negation + keyword found, set feature to FALSE instead of TRUE
4. Update AI prompt to explicitly handle negations

**Code Changes**:
```javascript
// New function in smartConfig.js
detectNegatedFeature(text, keywords, featureName) {
  const NEGATION_PREFIXES = ['no ', 'not ', 'without ', "don't ", "doesn't ", 'never ', 'avoid ', 'skip '];

  for (const keyword of keywords) {
    // Check for negated form first
    for (const neg of NEGATION_PREFIXES) {
      if (text.includes(neg + keyword)) {
        this.logger.info(`[SmartConfig] Negation detected: "${neg}${keyword}" - disabling ${featureName}`);
        return { detected: true, negated: true };
      }
    }
    // Check for positive form
    if (text.includes(keyword)) {
      return { detected: true, negated: false };
    }
  }
  return { detected: false, negated: false };
}
```

**Updated analyzeKeywords() flow**:
```javascript
// Multi-narrator detection with negation
const multiNarratorResult = this.detectNegatedFeature(text, MULTI_NARRATOR_KEYWORDS, 'multi_narrator');
if (multiNarratorResult.detected) {
  analysis.multi_narrator = !multiNarratorResult.negated;
  if (multiNarratorResult.negated) {
    analysis.multi_narrator_explicitly_disabled = true;
  }
}

// SFX detection with negation
const sfxResult = this.detectNegatedFeature(text, SFX_KEYWORDS, 'sfx');
if (sfxResult.detected) {
  analysis.sfx_enabled = !sfxResult.negated;
  if (sfxResult.negated) {
    analysis.sfx_explicitly_disabled = true;
  }
}
```

**AI Prompt Addition** (line ~680):
```
CRITICAL: Handle negations properly!
- "no sound effects" or "without sfx" → sfxLevel: null, sfxEnabled: false
- "no multiple voices" or "single narrator only" → multiNarrator: false
- "minimal audio" or "text only" → sfxLevel: null, multiNarrator: false
When negation is detected, DO NOT infer the opposite.
```

---

### P1: Tune Multi-Voice/SFX Detection
**File**: `server/services/smartConfig.js`
**Problem**: AI "reads between the lines" too aggressively; overlapping keywords cause cascading triggers.

**Solution**:
1. Remove "read between the lines" instruction from AI prompt
2. De-overlap keywords (remove 'audio drama' from SFX_KEYWORDS)
3. Narrow SFX_LEVEL_KEYWORDS.high to explicit phrases only
4. Make 'atmospheric' and 'soundscape' NOT trigger SFX

**Keyword Changes**:
```javascript
// BEFORE - too broad
const SFX_KEYWORDS = [
  'sound effects', 'sfx', 'sound fx', 'audio effects', 'ambient sounds',
  'immersive audio', 'atmospheric', 'soundscape', 'audio drama'  // REMOVE these
];

// AFTER - explicit only
const SFX_KEYWORDS = [
  'sound effects', 'sfx', 'sound fx', 'audio effects', 'ambient sounds',
  'ambient audio', 'background sounds', 'environmental sounds'
];
```

**AI Prompt Change** (remove line 679):
```diff
- IMPORTANT: Read between the lines. If someone says "make it feel like a movie"
- or "fully immersive" or "professional quality", they likely want high sfx...

+ IMPORTANT: Only enable features when EXPLICITLY requested.
+ - multiNarrator: true ONLY if user says "multi-voice", "voice cast", "different voices for characters", "audio drama", or "each character has their own voice"
+ - sfxLevel: 'high' ONLY if user says "lots of sound effects", "heavy sound design", "continuous audio", or "immersive sound effects"
+ - Default to multiNarrator: false and sfxLevel: 'low' unless explicitly requested
```

---

### P2: Story Length Detection Fallback
**File**: `server/services/smartConfig.js`
**Problem**: Story length rarely detected due to strict keywords and AI threshold.

**Solution**:
1. Expand LENGTH_KEYWORDS with more patterns
2. Lower AI analysis threshold from 50 to 30 characters
3. Add fallback to 'medium' if neither detection method succeeds
4. Infer from story_format when available

**Code Changes**:
```javascript
// Expanded keywords
const LENGTH_KEYWORDS = {
  short: ['short', 'quick', 'brief', '5 minute', '10 minute', 'one scene', 'flash fiction',
          'micro story', 'quick tale', 'mini story', 'bite-sized'],
  medium: ['medium', 'normal', '15 minute', '20 minute', 'standard', 'regular length',
           'moderate length', 'typical story'],
  long: ['long', 'epic', 'extended', '30 minute', '45 minute', 'hour long', 'feature length',
         'full length', 'spanning', 'multi-volume', 'several books', 'saga', 'sprawling',
         'extensive', 'lengthy', 'marathon']
};

// In generateConfig(), add format-based inference:
if (!config.story_length) {
  // Infer from format
  const formatLengthMap = {
    'picture_book': 'short',
    'short_story': 'short',
    'novella': 'medium',
    'novel': 'long',
    'series': 'long'
  };
  config.story_length = formatLengthMap[config.story_format] || 'medium';
  this.logger.info(`[SmartConfig] Inferred story_length=${config.story_length} from format=${config.story_format}`);
}
```

---

## Phase 2: Accuracy Improvements (P3, P6)

### P3: Author Preference Extraction
**File**: `server/services/smartConfig.js`
**Problem**: User says "like Rick Riordan" but system ignores it, defaults to Tolkien.

**Solution**:
1. Add regex pattern to extract "like [Author]" or "[Author] style"
2. Add `authorPreference` field to AI prompt schema
3. Create author name normalization (Riordan → rowling for YA)

**Pattern Matching**:
```javascript
// In analyzeKeywords()
const authorPatterns = [
  /(?:like|similar to|in the style of|inspired by|channeling|evokes?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:style|vibes?|feeling|tone)/gi
];

for (const pattern of authorPatterns) {
  const matches = text.matchAll(pattern);
  for (const match of matches) {
    const authorName = match[1].toLowerCase();
    analysis.requestedAuthor = this.normalizeAuthorName(authorName);
    break;
  }
}

normalizeAuthorName(name) {
  const authorMap = {
    'rick riordan': 'rowling',  // YA fantasy → closest match
    'riordan': 'rowling',
    'percy jackson': 'rowling',
    'stephen king': 'king',
    'king': 'king',
    'tolkien': 'tolkien',
    'jrr tolkien': 'tolkien',
    // ... etc
  };
  return authorMap[name] || 'none';
}
```

**AI Prompt Addition**:
```
- authorPreference: If user mentions a specific author ("like Rick Riordan", "Tolkien style"),
  extract the author name. Return null if no author mentioned.
```

---

### P6: Add YA/Poetry/Literary Genre Detection
**File**: `server/services/smartConfig.js`
**Problem**: No detection for YA, poetry, literary, surreal, or experimental genres.

**Solution**:
```javascript
// Add to GENRE_KEYWORDS
const GENRE_KEYWORDS = {
  // ... existing genres ...
  literary: ['literary', 'literary fiction', 'character study', 'introspective',
             'stream of consciousness', 'experimental', 'avant-garde', 'postmodern'],
  poetry: ['poetic', 'poetry', 'lyrical', 'verse', 'prose poetry', 'metaphorical',
           'symbolic', 'abstract narrative'],
  ya: ['young adult', 'ya', 'teen', 'teenager', 'coming of age', 'high school',
       'middle grade', 'tween']
};

// Add to AUTHOR_STYLE_RECOMMENDATIONS
ya: ['rowling', 'riordan_style', 'gaiman', 'none'],  // Note: may need to add Riordan
literary: ['woolf', 'nabokov', 'kafka', 'hemingway', 'none'],
poetry: ['none']  // No specific author, use modern storytelling
```

---

## Phase 3: UX Improvements (P5, P7, P8, P9)

### P5: Genre Full-Reset on Auto-Detect
**File**: `client/src/pages/Configure.jsx`
**Problem**: Auto-Detect merges with existing values; user expects replacement.

**Solution**: Reset all configurable values to defaults before applying Auto-Detect results.

```javascript
// In analyzePremise(), before applying suggestedConfig:
const defaultGenres = {
  fantasy: 0, adventure: 0, mystery: 0, scifi: 0,
  romance: 0, horror: 0, humor: 0, fairytale: 0
};
const defaultIntensity = {
  violence: 0, gore: 0, scary: 0, romance: 0, language: 0, adultContent: 0
};

setConfig(prev => {
  // Start fresh with defaults, then apply suggestions
  const newConfig = {
    ...prev,
    genres: { ...defaultGenres },
    intensity: { ...defaultIntensity },
    mood: 'calm',
    narrator_style: 'warm',
    author_style: 'none',
    multi_voice: false,
    hide_speech_tags: false,
    sfx_enabled: false,
    sfx_level: 'low'
  };

  // Now apply Auto-Detect suggestions (replace, not merge)
  if (autoSelect.genres && data.suggestedConfig.genres) {
    newConfig.genres = { ...defaultGenres, ...data.suggestedConfig.genres };
  }
  // ... etc for other fields

  return newConfig;
});
```

---

### P7: Pre-Generation Confirmation Panel
**File**: `client/src/pages/Configure.jsx` (new component: `GenerationSummary.jsx`)
**Problem**: User needs to understand token/credit usage before generating.

**Design**: Inline expandable panel above "Generate Story" button.

**Wireframe**:
```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 Generation Summary                              [Collapse ▲] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Story: Short Story (~5-15 min) • Mature • Horror/Sci-Fi       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Feature              │ Status    │ Est. Credits         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 📝 Story Generation  │ ✓ On      │ ~2 credits           │   │
│  │ 🎙️ Narration (Audio) │ ✓ On      │ ~5 credits           │   │
│  │ 👥 Multi-Voice Cast  │ ✓ On      │ +3 credits           │   │
│  │ 🔊 Sound Effects     │ ✓ High    │ +2 credits           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Estimated Total: ~12 credits                                   │
│                                                                 │
│  💡 Tip: Disable audio features to reduce credit usage.        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

         ┌─────────────────────────────────────┐
         │  🚀 Generate Story                  │
         └─────────────────────────────────────┘
```

**Component**: `client/src/components/configure/GenerationSummary.jsx`

**Features**:
- Collapsed by default, expands on first click of Generate button
- Shows all token-consuming features with on/off status
- Estimates credits based on story length + features
- Quick toggles to disable expensive features inline
- "Text Only" preset button to disable all audio features
- Second click on Generate proceeds with generation

---

### P8: Rename "Start Story" Button
**Options**:
| Current | Alternatives | Recommendation |
|---------|--------------|----------------|
| Start Story | Generate Story | ✓ Best - implies creation |
| | Build Story | Good - implies construction |
| | Create Story | Good - implies authorship |
| | Begin Generation | Too technical |

**Recommendation**: "Generate Story" - clearly indicates something is being created, implies computation/tokens.

**With confirmation flow**:
1. First click → Expand GenerationSummary panel
2. Button changes to "Confirm & Generate"
3. Second click → Actually start generation

---

### P9: Auto-Sync Story Format and Length
**File**: `client/src/pages/Configure.jsx`
**Problem**: Story Format and Story Length are separate; format doesn't auto-set length.

**Solution**: When format changes, auto-set a sensible default length (user can still override).

```javascript
// In the story format button onClick:
onClick={() => setConfig(prev => ({
  ...prev,
  story_format: format.id,
  // Auto-sync length based on format (already partially exists at lines 982-984)
  story_length: format.id === 'picture_book' ? 'short' :
                format.id === 'short_story' ? 'short' :
                format.id === 'novella' ? 'medium' :
                format.id === 'novel' ? 'long' :
                format.id === 'series' ? 'long' : prev.story_length
}))}
```

Also update the Story Length section to show which format it's synced with:
```jsx
{config.story_format && (
  <p className="text-night-500 text-xs mt-2">
    Auto-set for {config.story_format.replace('_', ' ')} format
  </p>
)}
```

---

## Phase 4: Accessibility (P4)

### P4: Fix All 14 Toggle Accessibility Issues
**Files**: `client/src/pages/Configure.jsx`, new `client/src/components/ui/AccessibleToggle.jsx`

**Create Reusable Component**:
```jsx
// client/src/components/ui/AccessibleToggle.jsx
function AccessibleToggle({
  enabled,
  onChange,
  label,
  description,
  colorClass = 'bg-golden-400',
  disabledColorClass = 'bg-night-600'
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      aria-describedby={description ? `${label}-desc` : undefined}
      onClick={() => onChange(!enabled)}
      className={`relative w-14 h-8 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-golden-400 ${
        enabled ? colorClass : disabledColorClass
      }`}
    >
      <span className="sr-only">{enabled ? 'On' : 'Off'}</span>
      <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${
        enabled ? 'translate-x-7' : 'translate-x-1'
      }`} />
    </button>
  );
}
```

**Migration**: Replace all 14 inline toggle implementations with `<AccessibleToggle>`:
- Lines 1039-1047: Protect protagonist
- Lines 1056-1064: Recurring characters
- Lines 1073-1081: Open ending
- Lines 1090-1098: Character growth
- Lines 1176-1184: Show dice rolls
- Lines 1190-1198: Character death
- Lines 1302-1310: Ensure proper ending
- Lines 1320-1328: Allow cliffhangers
- Lines 1669-1688: Multi-Voice Narration
- Lines 1705-1714: Hide Speech Tags
- Lines 1729-1737: Ambient Sound Effects
- Lines 1841-1849: Auto-checkpoint
- Lines 1858-1866: Allow backtracking
- Lines 1875-1883: Show choice history
- Lines 1897-1906: Auto-Play

**Additional A11y Fixes**:
- Add `role="group"` and `aria-label` to button groups (Difficulty, Combat Style, etc.)
- Add visible "On/Off" text next to toggles for color-blind users
- Add `aria-live="polite"` region for Auto-Detect status messages

---

## Implementation Order

| Phase | Task | Est. Time | Dependencies |
|-------|------|-----------|--------------|
| 1.1 | P0: Negation detection | 2 hours | None |
| 1.2 | P1: Tune detection keywords | 1 hour | None |
| 1.3 | P2: Story length fallback | 1 hour | None |
| 2.1 | P3: Author preference | 2 hours | None |
| 2.2 | P6: YA/poetry genres | 1 hour | P3 |
| 3.1 | P5: Genre reset | 30 min | None |
| 3.2 | P7: Confirmation panel | 3 hours | None |
| 3.3 | P8: Rename button | 15 min | P7 |
| 3.4 | P9: Format/length sync | 30 min | None |
| 4.1 | P4: AccessibleToggle component | 1 hour | None |
| 4.2 | P4: Migrate all toggles | 2 hours | 4.1 |

**Total Estimated Time**: ~14 hours

---

## Testing Checklist

After implementation, test these scenarios:

### Negation Handling
- [ ] "A story with no sound effects" → SFX disabled
- [ ] "Single narrator, no voice cast" → Multi-voice disabled
- [ ] "Without ambient audio" → SFX disabled
- [ ] "Don't include multiple voices" → Multi-voice disabled

### Multi-Voice/SFX Detection
- [ ] "Audio drama with full voice cast" → Multi-voice ON, SFX high
- [ ] "Cinematic story" → Neither auto-enabled (no longer "reads between lines")
- [ ] "Immersive horror" → Neither auto-enabled
- [ ] "Multi-voice narration with sound effects" → Both ON

### Story Length
- [ ] "A short scary story" → Length: short
- [ ] "Epic saga spanning multiple books" → Length: long
- [ ] "Normal bedtime story" → Length: short (from format inference)
- [ ] Empty premise, select Novella format → Length: medium (from sync)

### Author Matching
- [ ] "Like Rick Riordan" → Rowling selected (closest YA match)
- [ ] "Stephen King style" → King selected
- [ ] "Tolkien vibes" → Tolkien selected
- [ ] "Surreal poetry" → Modern Storytelling (no author)

### Genre Reset
- [ ] Run Auto-Detect on horror premise → Horror high, others reset to 0
- [ ] Run Auto-Detect on romance premise → Romance high, horror reset to 0

### Confirmation Panel
- [ ] Click Generate → Panel expands
- [ ] Panel shows feature summary with credit estimates
- [ ] Click Generate again → Story starts
- [ ] Toggle feature off in panel → Credit estimate updates

### Accessibility
- [ ] All toggles announce state to screen reader
- [ ] Tab navigation works through all controls
- [ ] Color-blind simulation shows distinguishable states
