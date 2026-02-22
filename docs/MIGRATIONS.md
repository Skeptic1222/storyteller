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
- Migration `023_critical_performance_indexes.sql` runs outside a transaction because it uses `CREATE INDEX CONCURRENTLY`.
- Incremental runner now includes `026` through `029`.
- Migration `022_additional_performance_indexes.sql` was hardened to be schema-drift safe by checking table/column existence before creating indexes.
- Migration `028_narrator_archetype.sql` now indexes narrator archetype fields stored in `story_sessions.config_json`.

