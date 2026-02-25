# Database Migrations

## Commands

```bash
# Bootstrap schema for fresh environments (database/schema.sql)
npm run db:migrate

# Apply incremental SQL migrations in database/migrations
npm run db:migrate:incremental

# Show incremental migration status
npm run db:migrate:status
```

## Notes

- Incremental migration order is maintained in `database/run-migrations.js`.
- Human-readable sequence documentation is in `database/migrations/MIGRATION_ORDER.md`.
- Migration `023_critical_performance_indexes.sql` runs outside a transaction because it uses `CREATE INDEX CONCURRENTLY`.
- Migration `031_missing_indexes_and_agent_prompts.sql` and `032_missing_query_indexes.sql` run outside a transaction because they use `CREATE INDEX CONCURRENTLY`.
- Incremental runner currently includes `026` through `033`.
- Migration `030_style_score_and_voice_directions.sql` now creates `agent_prompts` if needed before prompt upserts (legacy compatibility).
- Migration `033_story_choices_uniqueness.sql` deduplicates and enforces unique `(scene_id, choice_key)` and `(scene_id, choice_index)` pairs.
- Migration `022_additional_performance_indexes.sql` was hardened to be schema-drift safe by checking table/column existence before creating indexes.
- Migration `028_narrator_archetype.sql` now indexes narrator archetype fields stored in `story_sessions.config_json`.
