import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

describe('migration configuration regressions', () => {
  test('030 migration is transaction-safe for runner wrapping', async () => {
    const migration030 = await readFile('database/migrations/030_style_score_and_voice_directions.sql', 'utf8');

    assert.equal(/\bBEGIN\s*;/i.test(migration030), false, '030 should not open its own transaction');
    assert.equal(/\bCOMMIT\s*;/i.test(migration030), false, '030 should not commit its own transaction');
    assert.equal(
      /CREATE TABLE IF NOT EXISTS agent_prompts/i.test(migration030),
      true,
      '030 should self-create agent_prompts for compatibility'
    );
  });

  test('incremental runner includes uniqueness migration 033', async () => {
    const runner = await readFile('database/run-migrations.js', 'utf8');
    assert.equal(
      /version:\s*'033'\s*,\s*file:\s*'033_story_choices_uniqueness\.sql'/i.test(runner),
      true,
      'run-migrations.js should include migration 033'
    );
  });

  test('non-transactional migrations are split into individual statements', async () => {
    const runner = await readFile('database/run-migrations.js', 'utf8');
    assert.equal(
      /function\s+splitSqlStatements\s*\(/.test(runner),
      true,
      'runner should define splitSqlStatements for non-transactional migrations'
    );
    assert.equal(
      /for\s*\(\s*const\s+statement\s+of\s+statements\s*\)\s*\{\s*await\s+client\.query\(statement\)/s.test(runner),
      true,
      'runner should execute non-transactional SQL one statement at a time'
    );
  });

  test('001 migration enables pgcrypto before gen_random_uuid usage', async () => {
    const migration001 = await readFile('database/migrations/001_initial_schema.sql', 'utf8');
    assert.equal(
      /CREATE EXTENSION IF NOT EXISTS pgcrypto;/i.test(migration001),
      true,
      '001 should enable pgcrypto for gen_random_uuid() defaults'
    );
  });

  test('005 migration records canonical zero-padded version', async () => {
    const migration005 = await readFile('database/migrations/005_story_recordings.sql', 'utf8');
    assert.equal(
      /VALUES\s*\('005',\s*'005_story_recordings'/i.test(migration005),
      true,
      '005 should write zero-padded schema_migrations version'
    );
  });
});
