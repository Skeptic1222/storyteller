# Storyteller Database Migration Order

## Important Notes

Due to historical numbering issues, some migrations share the same number prefix.
This document specifies the correct application order.

## Migration Sequence

| Order | File | Description | Dependencies |
|-------|------|-------------|--------------|
| 1 | 001_initial_schema.sql | Base tables, schema_migrations | None |
| 2 | 002_ereader_features.sql | E-reader UI features | 001 |
| 3 | 003_research_insights.sql | Research/insights system | 001 |
| 4 | 004_sound_effects.sql | SFX support | 001 |
| 5 | 005_story_recordings.sql | Recording/playback system | 001 |
| 6 | 006_auth_subscriptions.sql | Auth & subscription tables | 001 |
| 7 | 007_performance_indexes.sql | Performance indexes | 001-006 |
| 8 | 008_character_gender.sql | Character gender field | 001 |
| 9 | 009_scene_word_timings.sql | Word-level timing data | 005 |
| 10 | 010_story_bible.sql | Story Bible v1 | 001 |
| 11 | 011_story_bible_v2.sql | Locations, connections, beats | 010 |
| 12 | 011_fix_view.sql | Fix location_hierarchy view | 011_story_bible_v2 |
| 13 | 012_deceased_characters.sql | Character death tracking | 010 |
| 14 | 013_story_bible_v3.sql | Story Bible v3 features | 011 |
| 15 | 014_story_bible_events.sql | Story events system | 010 |
| 16 | 015_event_ordering.sql | Event ordering | 014 |
| 17 | 016_story_bible_sessions.sql | Bible session management | 010 |
| 18 | 017_source_chapters.sql | Source chapter extraction | 011 |
| 19 | 017_event_timeline_fields.sql | Event timeline fields | 014 |
| 20 | 021_picture_book_images.sql | Picture book images | 001 |
| 21 | 022_additional_performance_indexes.sql | More indexes | 001-020 |
| 22 | 023_critical_performance_indexes.sql | Critical indexes | 001-021 |
| 23 | 024_generation_state.sql | Generation state persistence | 001-023 |
| 24 | 025_phonetic_mappings.sql | Character phonetic mappings | 001-024 |
| 25 | 026_sharing_and_index_fixes.sql | Sharing columns + index fixes | 001-025 |
| 26 | 027_composited_images.sql | Picture-book compositing support | 001-026 |
| 27 | 028_narrator_archetype.sql | Narrator archetype JSON indexes | 001-027 |
| 28 | 029_character_age.sql | Character age-group metadata | 001-028 |

## Duplicate Number Handling

### 011 Duplicates
- `011_story_bible_v2.sql` - Run FIRST (creates tables and views)
- `011_fix_view.sql` - Run SECOND (fixes type mismatch in view)

### 017 Duplicates
- `017_source_chapters.sql` - Independent, run first
- `017_event_timeline_fields.sql` - Independent, run second

## Missing Numbers

Numbers 018, 019, 020 were skipped during development. This is intentional.

## How to Apply Migrations

1. Check current state:
```sql
SELECT * FROM schema_migrations ORDER BY version;
```

2. Apply pending migrations in order above

3. Record each migration:
```sql
INSERT INTO schema_migrations (version, name)
VALUES ('011a', 'fix_view')
ON CONFLICT (version) DO NOTHING;
```

## Recommended: Use Version Suffixes

When tracking duplicates, use version suffixes:
- 011 = 011_story_bible_v2.sql
- 011a = 011_fix_view.sql
- 017 = 017_source_chapters.sql
- 017a = 017_event_timeline_fields.sql
