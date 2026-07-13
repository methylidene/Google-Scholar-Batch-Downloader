import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBatchFiles, normalizeDownloadDelay, runBatch, runWithRetry } from '../src/background.js';

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

test('continues remaining exports and preserves paper results when one export fails', async () => {
  const attempts = [];
  const chromeApi = {
    storage: { local: { get: async () => ({ downloadDelayMs: 0 }) } },
    downloads: {
      download: async options => {
        attempts.push(options.filename);
        if (options.filename.endsWith('.bib')) throw new Error('bib blocked');
        return attempts.length;
      },
    },
  };

  const response = await runBatch([{ id: 'metadata-1', title: 'Paper', authors: [], pdfUrl: '' }], chromeApi);

  assert.deepEqual(attempts.map(name => name.slice(name.lastIndexOf('.'))), ['.ris', '.bib', '.json']);
  assert.deepEqual(response.results, [{ id: 'metadata-1', ok: true, status: 'metadata' }]);
  assert.equal(response.ok, false);
  assert.match(response.error, /bib blocked/);
  assert.deepEqual(response.exportErrors.map(item => item.extension), ['bib']);
});

test('normalizes download delay to the options integer range', () => {
  assert.equal(normalizeDownloadDelay(undefined), 800);
  assert.equal(normalizeDownloadDelay('invalid'), 800);
  assert.equal(normalizeDownloadDelay(-1), 800);
  assert.equal(normalizeDownloadDelay(0), 800);
  assert.equal(normalizeDownloadDelay(300.5), 800);
  assert.equal(normalizeDownloadDelay(299), 800);
  assert.equal(normalizeDownloadDelay(5001), 800);
  assert.equal(normalizeDownloadDelay(300), 300);
  assert.equal(normalizeDownloadDelay(5000), 5000);
});
