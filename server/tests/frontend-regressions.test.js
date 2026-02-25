import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

describe('frontend regression guards', () => {
  test('shared story password is not sent through query params', async () => {
    const sharedStoryPage = await readFile('client/src/pages/SharedStory.jsx', 'utf8');
    assert.equal(
      /\?password=/.test(sharedStoryPage),
      false,
      'SharedStory should avoid password query params'
    );
    assert.equal(
      /\/sharing\/story\/\$\{shareCode\}\/access/.test(sharedStoryPage),
      true,
      'SharedStory should use POST /access for protected stories'
    );
  });

  test('storytime sends updated conversation history', async () => {
    const storytimePage = await readFile('client/src/pages/Storytime.jsx', 'utf8');
    assert.equal(
      /conversation_history:\s*nextHistory/.test(storytimePage),
      true,
      'Storytime should send the latest user turn in conversation_history'
    );
  });

  test('library does not navigate to removed campaign route', async () => {
    const libraryPage = await readFile('client/src/pages/Library.jsx', 'utf8');
    assert.equal(
      /\/campaign\//.test(libraryPage),
      false,
      'Library should not navigate to removed /campaign routes'
    );
  });
});

