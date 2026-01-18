# Advanced Story Bible → Configure Story Integration

## Problem Statement

When clicking "Start Story" from the Advanced Story Bible, the current Configure Story page:
1. Uses only a small "Story Premise" text box that doesn't capture the full Story Bible
2. Misinterprets names and entities (e.g., combining "Shannon Patterson" and "Keedy's Diner" into "Shannon Keedy")
3. Doesn't have access to the full context: Synopsis, Outline, Beats, Characters, Events, Locations, Items, Factions, Lore
4. Uses outdated GPT-4 models instead of GPT-5.2

## Requirements

### 1. New Configure Interface for Advanced Mode

When navigating from Story Bible with `?outline=...&library=...` parameters:
- **DO NOT** show the standard "Story Premise" text box
- **INSTEAD** show a dedicated Advanced Story interface that:
  - Displays the Synopsis title and logline
  - Shows a summary of available data (X characters, Y locations, Z events, etc.)
  - Has a prominent "AI-Detect Settings" button

### 2. AI-Detect Settings (Full Context Read)

The AI-Detect process must perform a **comprehensive read** of ALL Story Bible data:

```
FROM library_synopsis: synopsis, logline, genre, mood, themes, outline_json
FROM chapter_beats: all beats for all chapters
FROM library_characters: all characters with full profiles
FROM library_locations: all locations with descriptions
FROM library_items: all items with properties
FROM library_factions: all factions with relationships
FROM library_lore: all lore entries
FROM library_events: all planned events with timeline ordering
FROM library_worlds: world settings, magic system, technology level
```

The AI-Detect should analyze this data to auto-configure:
- **Audience**: Based on themes, content warnings, violence/romance levels
- **Voice Settings**: Based on character count and dialogue complexity
- **Sound Effects**: Based on action scenes, locations, atmosphere
- **Multi-Voice**: Auto-enable if multiple speaking characters
- **Violence/Romance/Adult Levels**: Based on synopsis and beat content

### 3. Story Generation Must Use Full Context

When generating story content, ALL agents must have access to:

```javascript
const storyContext = {
  synopsis: {
    title, logline, synopsis_text, genre, mood, themes
  },
  outline: {
    chapters: [{ title, summary, key_events, characters_present, location, mood, ends_with }]
  },
  beats: {
    // Per-chapter beats with summaries, types, dialogue hints
  },
  characters: [
    { name, role, description, personality, traits, backstory, voice_description, gender, age_group, appearance }
  ],
  locations: [
    { name, type, description, atmosphere, notable_features }
  ],
  events: [
    { title, description, event_type, importance, suggested_timing, characters_involved, is_incorporated }
  ],
  items: [
    { name, type, description, properties, history }
  ],
  factions: [
    { name, type, description, goals, relationships }
  ],
  lore: [
    { title, content, category, importance }
  ],
  world: {
    name, description, genre, time_period, magic_system, technology_level, society_structure, tone
  }
};
```

### 4. Model Requirements - GPT-5.2 Only

**CRITICAL**: All LLM calls must use GPT-5.2 (or latest available model).

Update `server/services/modelSelection.js` and all agent files:
- Remove all GPT-4, GPT-4o, GPT-4o-mini references
- Use `gpt-5.2` as the default model
- Set high reasoning/thinking parameters where available

Files to update:
- `server/services/modelSelection.js`
- `server/services/openai.js`
- `server/services/smartConfig.js`
- `server/services/agents/beatGenerationPipeline.js`
- `server/services/orchestrator.js`
- All agent files in `server/services/agents/`

### 5. UI Changes Required

#### Configure.jsx Changes

```jsx
// Detect if coming from Advanced Story Bible
const urlParams = new URLSearchParams(location.search);
const outlineId = urlParams.get('outline');
const libraryId = urlParams.get('library');
const isAdvancedMode = !!(outlineId && libraryId);

if (isAdvancedMode) {
  // Render AdvancedConfigureStory component
  return <AdvancedConfigureStory outlineId={outlineId} libraryId={libraryId} />;
} else {
  // Render standard configure with Story Premise text box
  return <StandardConfigureStory />;
}
```

#### New Component: AdvancedConfigureStory.jsx

```jsx
// Features:
// 1. Load full Story Bible data on mount
// 2. Display synopsis summary (title, logline, chapter count)
// 3. Show data availability badges (Characters: 12, Locations: 5, etc.)
// 4. "AI-Detect Settings" button that analyzes full context
// 5. Settings panels (same as current but pre-populated from AI analysis)
// 6. "Generate Story" button that passes full context to orchestrator
```

### 6. Backend API Changes

#### New Endpoint: `/api/story-bible/full-context/:libraryId`

Returns ALL Story Bible data for a library in a single call:

```javascript
router.get('/full-context/:libraryId', async (req, res) => {
  const { libraryId } = req.params;

  const [
    synopsis, characters, locations, items,
    factions, lore, events, world, beats
  ] = await Promise.all([
    pool.query('SELECT * FROM library_synopsis WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_characters WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_locations WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_items WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_factions WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_lore WHERE library_id = $1', [libraryId]),
    pool.query('SELECT * FROM library_events WHERE library_id = $1 ORDER BY sort_order', [libraryId]),
    pool.query('SELECT * FROM library_worlds WHERE library_id = $1', [libraryId]),
    // Beats require synopsis ID
  ]);

  // Get beats for the synopsis
  let allBeats = [];
  if (synopsis.rows[0]?.id) {
    const beatsResult = await pool.query(
      'SELECT * FROM chapter_beats WHERE synopsis_id = $1 ORDER BY chapter_number',
      [synopsis.rows[0].id]
    );
    allBeats = beatsResult.rows;
  }

  res.json({
    synopsis: synopsis.rows[0] || null,
    characters: characters.rows,
    locations: locations.rows,
    items: items.rows,
    factions: factions.rows,
    lore: lore.rows,
    events: events.rows,
    world: world.rows[0] || null,
    beats: allBeats
  });
});
```

#### New Endpoint: `/api/story-bible/ai-detect-settings`

Analyzes full Story Bible context and returns recommended settings:

```javascript
router.post('/ai-detect-settings', async (req, res) => {
  const { storyContext } = req.body;

  // Use GPT-5.2 to analyze the full context
  const analysis = await analyzeStoryContextWithGPT52(storyContext);

  res.json({
    audience: analysis.audience,
    genre: analysis.genre,
    violence_level: analysis.violence,
    romance_level: analysis.romance,
    adult_level: analysis.adult,
    multi_voice: analysis.hasMultipleCharacters,
    sound_effects: analysis.hasActionScenes,
    voice_settings: analysis.voiceRecommendations,
    estimated_length: analysis.estimatedWordCount
  });
});
```

### 7. Orchestrator Changes

The orchestrator must accept full Story Bible context when starting a story:

```javascript
// orchestrator.js - startStory function

async function startStory(config) {
  const { storyBibleContext, ...otherConfig } = config;

  if (storyBibleContext) {
    // Advanced mode - use full context
    this.synopsis = storyBibleContext.synopsis;
    this.outline = storyBibleContext.synopsis?.outline_json;
    this.beats = storyBibleContext.beats;
    this.characters = storyBibleContext.characters;
    this.locations = storyBibleContext.locations;
    this.events = storyBibleContext.events;
    this.items = storyBibleContext.items;
    this.factions = storyBibleContext.factions;
    this.lore = storyBibleContext.lore;
    this.world = storyBibleContext.world;

    // Scene generation should reference all this data
  } else {
    // Standard mode - generate from premise
  }
}
```

### 8. Scene Generation with Full Context

When generating scenes, the scene writer must have access to:

```javascript
const scenePrompt = `
You are writing Chapter ${chapterNum}, Beat ${beatNum} of "${synopsis.title}".

SYNOPSIS: ${synopsis.synopsis}

THIS CHAPTER: ${chapter.title}
${chapter.summary}

THIS BEAT: ${beat.summary}
Type: ${beat.type}
Mood: ${beat.mood}
Characters: ${beat.characters.join(', ')}
Location: ${beat.location}
Dialogue Hint: ${beat.dialogue_hint}

AVAILABLE CHARACTERS:
${characters.map(c => `- ${c.name} (${c.role}): ${c.description}`).join('\n')}

AVAILABLE LOCATIONS:
${locations.map(l => `- ${l.name}: ${l.description}`).join('\n')}

RELEVANT EVENTS:
${events.filter(e => beat.linked_event_ids?.includes(e.id)).map(e => `- ${e.title}: ${e.description}`).join('\n')}

WORLD CONTEXT:
${world.description}
Magic System: ${world.magic_system || 'None'}
Technology: ${world.technology_level}

IMPORTANT LORE:
${lore.slice(0, 5).map(l => `- ${l.title}: ${l.content}`).join('\n')}

Write this beat as a compelling scene...
`;
```

## Implementation Priority

1. **Phase 1**: Create `/full-context/:libraryId` endpoint
2. **Phase 2**: Create `AdvancedConfigureStory.jsx` component
3. **Phase 3**: Create `/ai-detect-settings` endpoint with GPT-5.2
4. **Phase 4**: Update Configure.jsx to detect and route to advanced mode
5. **Phase 5**: Update orchestrator to accept and use full Story Bible context
6. **Phase 6**: Update all scene generation to reference full context
7. **Phase 7**: Audit and update all model references to GPT-5.2

## Files to Modify

### Frontend
- `client/src/pages/Configure.jsx` - Add advanced mode detection and routing
- `client/src/components/configure/AdvancedConfigureStory.jsx` - NEW FILE
- `client/src/components/configure/StoryBibleSummary.jsx` - NEW FILE (shows loaded data)

### Backend
- `server/routes/story-bible.js` - Add full-context and ai-detect-settings endpoints
- `server/services/orchestrator.js` - Accept full Story Bible context
- `server/services/modelSelection.js` - Update to GPT-5.2
- `server/services/openai.js` - Update default model
- `server/services/smartConfig.js` - Update for full context analysis
- `server/services/agents/*.js` - Update all to GPT-5.2

## Testing Checklist

- [ ] Start Story from Story Bible loads full context
- [ ] AI-Detect analyzes all data types correctly
- [ ] Character names are preserved exactly (no merging)
- [ ] Locations are used correctly
- [ ] Events timeline is respected
- [ ] Lore is referenced where relevant
- [ ] All LLM calls use GPT-5.2
- [ ] Generated content matches Story Bible exactly

## Known Issues to Fix

1. **Name Merging Bug**: "Shannon Patterson" + "Keedy's Diner" → "Shannon Keedy"
   - Root cause: Insufficient context in story premise
   - Solution: Pass full character list with exact names

2. **Context Loss**: Only small premise text passed to orchestrator
   - Solution: Pass entire Story Bible context object

3. **Outdated Models**: GPT-4o/GPT-4o-mini still in use
   - Solution: Global search and replace, update modelSelection.js
