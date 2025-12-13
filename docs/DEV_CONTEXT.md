# Developer Context - Storyteller

**Last Updated:** 2025-12-11
**Purpose:** Quick context restoration for Claude Code sessions

---

## Start Here

1. Read `CLAUDE.md` in project root for architecture overview
2. Check this file for current work state
3. See `docs/CHANGELOG.md` for recent session history

---

## Current Work State (2025-12-11)

### Just Completed
- Component refactoring (~450 lines extracted)
- Deprecated agents archived (`_archived/` folder)
- FAIL LOUD policy implemented (no fallbacks for missing dialogue_map)
- Documentation updated
- **Three-tier cover art prompts** - LLM generates 3 prompts with increasing abstraction
- **Cover art layout** - Float left, minimize icon, fullscreen view, text wrap
- **SFX timing guards** - Sound effects only during story narration
- **Progress bar UI** - Responsive badges, wider bar, activity feed truncation

### All UI Work Complete (2025-12-11)

**Progress Bar (LaunchScreen.jsx):** ✅
- "Crafting Story" milestone at 0% - Already implemented
- Wider progress bar - Reduced margins (`mx-4 sm:mx-8 md:mx-12 lg:mx-16`)
- Activity feed truncation - Added `line-clamp-2`

**Cover Art Layout (BookPageLayout.jsx):** ✅
- Text box top aligns with cover art - `margin-top: 0` on cover
- `_` minimize icon on cover hover (top-right)
- Regenerate icon on cover hover (bottom-left)
- Click cover anywhere → fullscreen view
- Text wraps around cover like old-school book indent

---

## Key Architecture Decisions

### C+E Voice Casting (v2.1)
```
generateSceneWithDialogue() → speakerValidationAgent → Audio
      (Option C)                  (Option E)
```
- **FAIL LOUD**: Throws error if dialogue_map missing
- **No fallbacks**: Silent degradation removed
- **Archived**: dialogueTaggingAgent.js, dialogueAttributionAgent.js

### File Organization
```
client/src/
├── constants/           # Extracted constants
│   ├── authorStyles.js  # Author style data
│   └── launchStages.js  # Stage constants
├── components/
│   ├── launch/          # Launch screen sub-components
│   │   ├── StageIndicator.jsx
│   │   ├── CountdownDisplay.jsx
│   │   └── index.js
│   └── configure/       # Configure page sub-components
│       ├── AuthorStylePicker.jsx
│       └── index.js
└── pages/
    ├── Configure.jsx    # ~1860 lines (was 2138)
    └── Story.jsx        # Main playback

server/services/
├── orchestrator.js      # Main coordinator
├── openai.js            # generateSceneWithDialogue()
├── agents/
│   ├── speakerValidationAgent.js  # Option E
│   ├── dialogueSegmentUtils.js    # Segment conversion
│   └── _archived/                 # Deprecated agents
└── elevenlabs.js        # TTS, multi-voice
```

---

## Quick Commands

```powershell
# Development
cd C:\inetpub\wwwroot\storyteller
npm run dev

# Build
npm run build

# Service management
Get-Service StorytellerService
Restart-Service StorytellerService

# Logs
Get-Content logs/service.log -Tail 50
Get-Content logs/error.log -Tail 20
```

---

## Testing Checklist

Before marking work complete:
- [ ] Mobile viewport (< 640px)
- [ ] Tablet viewport (640-1024px)
- [ ] Desktop viewport (> 1024px)
- [ ] `npm run build` passes
- [ ] No console errors in browser

---

## Files to Watch

| File | Lines | Notes |
|------|-------|-------|
| `client/src/pages/Configure.jsx` | ~1860 | Still large, more extraction possible |
| `client/src/components/LaunchScreen.jsx` | ~1560 | Progress bar complete |
| `client/src/components/BookPageLayout.jsx` | ~520 | Cover art layout complete |
| `server/services/orchestrator.js` | ~1800 | Core logic, be careful |
| `server/routes/stories.js` | ~1100 | Three-tier cover prompts (lines 848-939) |

---

## Do NOT Do

1. **Don't restore archived agents** - They're intentionally removed
2. **Don't add fallbacks** - FAIL LOUD is intentional
3. **Don't use parseDialogueSegments()** - It's deprecated regex-based
4. **Don't skip speaker validation** - Option E is required

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `CLAUDE.md` | Quick reference, architecture |
| `docs/CHANGELOG.md` | Session history, bug fixes |
| `docs/ROADMAP.md` | Product roadmap (long-term) |
| `docs/API_REFERENCE.md` | REST + Socket.IO endpoints |
| `server/services/agents/DIALOGUE_TAGGING_SYSTEM.md` | C+E architecture details |
