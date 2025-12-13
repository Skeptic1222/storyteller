# Component Refactoring Guide

This document outlines the recommended approach for refactoring oversized React components in the Storyteller application.

## Current Large Components

| Component | Location | Size | Priority |
|-----------|----------|------|----------|
| Configure.jsx | client/src/pages/ | ~96KB | Medium |
| LaunchScreen.jsx | client/src/components/ | ~85KB | Medium |
| Story.jsx | client/src/pages/ | ~80KB+ | Low (already optimized) |

## Recommended Approach

### 1. Configure.jsx Decomposition

The Configure page handles story configuration with multiple sections. Suggested extraction:

```
src/components/configure/
├── GenreSelector.jsx       # Genre selection UI
├── AudienceSelector.jsx    # Audience/rating selection
├── AuthorStylePicker.jsx   # Author style dropdown
├── VoiceSettings.jsx       # Voice configuration
├── ContentSliders.jsx      # Gore/romance/adult sliders
├── CYOASettings.jsx        # CYOA configuration
├── SmartConfigPanel.jsx    # AI auto-config
└── ConfigSummary.jsx       # Summary/preview
```

### 2. LaunchScreen.jsx Decomposition

The launch screen shows story generation progress. Suggested extraction:

```
src/components/launch/
├── ProgressIndicator.jsx   # Overall progress bar
├── StageCard.jsx           # Individual stage display
├── VoicePreview.jsx        # Voice assignment preview
├── CoverArtPreview.jsx     # Cover art display
├── QAChecksDisplay.jsx     # QA validation results
├── CountdownOverlay.jsx    # Countdown animation
└── LaunchControls.jsx      # Start/cancel buttons
```

### 3. Extraction Checklist

When extracting a component:

1. **Identify state dependencies** - What state does the section need?
2. **Define props interface** - Create TypeScript-style prop definitions
3. **Extract callbacks** - Move event handlers with the component
4. **Use context sparingly** - Prefer props over context for clarity
5. **Add memoization** - Use React.memo for pure components
6. **Write tests** - Add unit tests for extracted components

### 4. State Management Pattern

For shared state across extracted components:

```jsx
// Option 1: Props drilling (simplest, for 2-3 levels)
<ParentComponent>
  <ChildComponent value={value} onChange={onChange} />
</ParentComponent>

// Option 2: Context (for deep nesting)
const ConfigContext = createContext();
<ConfigContext.Provider value={{ genre, setGenre, ... }}>
  <ChildComponents />
</ConfigContext.Provider>

// Option 3: Custom hook (for complex logic)
const useConfigState = () => {
  const [genre, setGenre] = useState('fantasy');
  // ... complex logic
  return { genre, setGenre, ... };
};
```

### 5. Performance Considerations

- Use `React.memo()` for extracted components that receive stable props
- Use `useCallback()` for handlers passed to child components
- Use `useMemo()` for derived values
- Avoid inline object/array creation in JSX

### 6. Migration Strategy

1. **Don't refactor all at once** - Extract one component at a time
2. **Test after each extraction** - Ensure functionality preserved
3. **Keep old code temporarily** - Comment out rather than delete initially
4. **Update imports gradually** - Don't break the build

## Code Quality Standards

### Naming Conventions
- Components: PascalCase (e.g., `GenreSelector`)
- Hooks: camelCase with `use` prefix (e.g., `useGenreState`)
- Event handlers: `handle` prefix (e.g., `handleGenreChange`)

### File Organization
```
ComponentName/
├── index.jsx         # Main component
├── styles.css        # Component styles (if needed)
└── ComponentName.test.jsx  # Tests
```

### Props Documentation
```jsx
/**
 * GenreSelector - Allows users to select story genre
 * @param {string} value - Current selected genre
 * @param {function} onChange - Called with new genre when selection changes
 * @param {boolean} disabled - Disables selection
 */
function GenreSelector({ value, onChange, disabled = false }) {
  // ...
}
```

## Timeline Recommendation

1. **Week 1-2**: Extract Configure.jsx sections
2. **Week 3-4**: Extract LaunchScreen.jsx sections
3. **Ongoing**: Apply patterns to new components

## Related Files

- `client/src/utils/logger.js` - Use for debugging during refactoring
- `server/utils/agentHelpers.js` - Example of consolidated utilities
