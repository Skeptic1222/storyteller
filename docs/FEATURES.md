# Storyteller Features Documentation

**Last Updated:** 2025-12-11

This document provides detailed technical documentation for key Storyteller features.

---

## Table of Contents

1. [Three-Tier Cover Art Prompts](#three-tier-cover-art-prompts)
2. [Cover Art Layout (Book Page Style)](#cover-art-layout)
3. [SFX Timing Guards](#sfx-timing-guards)

---

## Three-Tier Cover Art Prompts

### Overview

When generating cover art, the system uses an LLM to create **three image prompts** with increasing levels of abstraction. This ensures that even if DALL-E rejects explicit or sensitive content, a fallback prompt will succeed.

### How It Works

```
User requests cover → LLM generates 3 prompts → Try Level 1 → Try Level 2 → Try Level 3
                                                    ↓              ↓              ↓
                                               (direct)      (abstract)     (symbolic)
```

**Abstraction Levels:**

| Level | Type | Description | Example |
|-------|------|-------------|---------|
| 1 | Direct | Specific scene from story with setting, atmosphere, character silhouettes | "A knight standing at castle gates under stormy skies" |
| 2 | Abstract | Emotions and themes, symbolic imagery, mood-focused | "Swirling mist and golden light suggesting courage and destiny" |
| 3 | Symbolic | Pure metaphor, guaranteed safe (nature, colors, shapes) | "A single rose on silk sheets with morning light" |

### Implementation

**Files:**
- `server/routes/stories.js:generateCoverPrompts()` (lines 848-939)
- `server/services/portraitGenerator.js:generateThreeTierCoverPrompts()`

**Key Code (stories.js):**

```javascript
// LLM system prompt excerpt
const systemPrompt = `Generate THREE image prompts for a paperback book cover,
with increasing levels of abstraction.

Output JSON:
{
  "prompts": [
    { "level": 1, "description": "Direct", "prompt": "..." },
    { "level": 2, "description": "Abstract", "prompt": "..." },
    { "level": 3, "description": "Symbolic", "prompt": "..." }
  ]
}`;

// Fallback through levels
for (const promptData of coverPrompts) {
  try {
    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: promptData.prompt,
      size: '1024x1792' // Portrait for book cover
    });
    if (imageResponse.data[0]?.url) break; // Success!
  } catch (error) {
    logger.warn(`Level ${promptData.level} failed, trying next...`);
  }
}
```

### Why This Design

- **Content Safety**: Mature stories (romance, horror) may have themes DALL-E rejects
- **Guaranteed Success**: Level 3 uses only safe imagery (nature, abstract art)
- **Quality Preservation**: Always tries the most descriptive prompt first
- **LLM Intelligence**: The LLM understands the story and crafts appropriate abstractions

---

## Cover Art Layout

### Overview

The cover art displays in a **classic book page style** where text wraps around a floating cover image, similar to old-school magazine or book layouts with drop caps and indented images.

### Visual Layout

```
┌─────────────────────────────────────────┐
│ ┌──────────┐  Title of the Story        │
│ │          │                            │
│ │  Cover   │  [Story Details Badge ▼]   │
│ │  Image   │                            │
│ │          │  Synopsis text wraps       │
│ │          │  around the cover image    │
│ └──────────┘  continuing here...        │
│                                         │
│ Story text continues at full width      │
│ once it flows below the cover image.    │
│ This creates the classic "indent"       │
│ effect seen in printed books.           │
└─────────────────────────────────────────┘
```

### Interactive Features

| Action | Behavior |
|--------|----------|
| **Hover cover** | Shows `_` minimize icon (top-right) and regenerate icon (bottom-left) |
| **Click cover** | Opens fullscreen modal view |
| **Click `_` icon** | Minimizes cover to tiny 40x40px thumbnail |
| **Click minimized cover** | Restores to full size |
| **Click regenerate** | Generates new cover art |

### Implementation

**File:** `client/src/components/BookPageLayout.jsx`

**CSS Float Layout:**

```css
.book-cover-float {
  float: left;
  margin-right: 1.25rem;
  margin-bottom: 0.75rem;
  margin-top: 0;           /* Aligns top with title */
  shape-outside: margin-box; /* Text wraps around margin */
}

/* Text naturally flows around - NO clear:both */
.story-text-section {
  /* Do NOT clear - let it wrap like old-school indent */
}
```

**Minimize Icon (underscore symbol):**

```jsx
{coverHovered && (
  <button
    onClick={() => setCoverState('minimized')}
    className="absolute -top-2 -right-2 z-20 w-6 h-6 ..."
    title="Minimize cover (_)"
  >
    <span className="text-night-300 font-bold text-sm pb-1">_</span>
  </button>
)}
```

**Content Order in Text Box:**
1. Title (h1)
2. Story Details Badge (expandable)
3. Synopsis
4. Story text

---

## SFX Timing Guards

### Overview

Sound effects (SFX) must **only play during story narration**, never during the title or synopsis reading. This prevents jarring sound effects during the introduction.

### The Problem

Without guards, SFX would trigger based on word timing from the audio. But the audio includes:
1. **Title narration** - "The Midnight Garden"
2. **Synopsis narration** - "A tale of mystery and wonder..."
3. **Story narration** - "Chapter one. The wind howled..." ← SFX should only play here

### Implementation

**File:** `client/src/pages/Story.jsx`

**State Variables:**

```javascript
const [introAudioQueued, setIntroAudioQueued] = useState(false);
const [sceneAudioStarted, setSceneAudioStarted] = useState(false);
const sceneAudioStartedRef = useRef(false); // For callback access
```

**Guard Logic in playSfx():**

```javascript
const playSfx = useCallback(async (sfxList) => {
  if (!sfxList || sfxList.length === 0 || !sfxEnabled) return;

  // CRITICAL GUARD: Don't play SFX during title/synopsis
  // Only play once actual story scene audio has started
  if (introAudioQueued && !sceneAudioStartedRef.current) {
    console.log('[SFX] Blocked - intro audio still playing');
    return;
  }

  // Play the SFX...
}, [sfxEnabled, introAudioQueued]);
```

**Audio Flow:**

```
1. story:intro_audio → setIntroAudioQueued(true), sceneAudioStarted=false
2. Title/synopsis plays → SFX blocked by guard
3. story:scene_audio → setSceneAudioStarted(true) when scene starts
4. Scene plays → SFX now allowed
```

**Secondary Guard (useEffect):**

```javascript
// Double-check: Only trigger SFX after scene audio actually starts
if (introAudioQueued && !sceneAudioQueued) {
  console.log('[SFX] Waiting for scene audio to start...');
  return; // Don't trigger yet
}
```

### Why useRef + useState?

- `useState` for React re-renders and UI updates
- `useRef` for callback access (avoids stale closure problem)
- Both are kept in sync via useEffect

---

## Related Documentation

| Document | Content |
|----------|---------|
| `CLAUDE.md` | Quick reference, architecture overview |
| `docs/DEV_CONTEXT.md` | Current work state, quick commands |
| `docs/CHANGELOG.md` | Session history, bug fixes |
| `docs/API_REFERENCE.md` | REST + Socket.IO endpoints |
