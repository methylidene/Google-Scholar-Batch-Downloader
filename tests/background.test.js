import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBatchFiles, runWithRetry } from '../src/background.js';

test('retries one failed task once', async () => {
  let calls = 0;
  const value = await runWithRetry(async () => {
    if (++calls === 1) throw new Error('network');
    return 7;
  }, 1);

  assert.equal(value, 7);
  assert.equal(calls, 2);
});

test('batch files always include ris bib and json', () => {
  assert.deepEqual(makeBatchFiles([], []).map(file => file.extension), ['ris', 'bib', 'json']);
});
