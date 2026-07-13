import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBatchFiles, normalizeDownloadDelay, runBatch, runWithRetry, sendZotero } from '../src/background.js';

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

test('RUN_BATCH enriches only profile records before downloading and preserves enrichment results', async () => {
  const fetched = [];
  const downloaded = [];
  const chromeApi = {
    storage: { local: { get: async () => ({ downloadDelayMs: 300 }) } },
    downloads: { download: async options => { downloaded.push(options); return downloaded.length; } },
  };
  const papers = [
    { id: 'gsbd-profile-1', title: 'Profile paper', authors: ['Ada'], year: '2025', detailUrl: 'https://scholar.google.com/citations?view_op=view_citation&citation_for_view=one', pdfUrl: '', doi: '' },
    { id: 'gsbd-1', title: 'Result paper', authors: ['Bob'], year: '2024', detailUrl: 'https://scholar.google.com/scholar?cluster=two', pdfUrl: '', doi: '' },
  ];

  const response = await runBatch(papers, chromeApi, {
    fetchImpl: async url => {
      fetched.push(url);
      return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<a href="https://files.test/profile.pdf?download=1">[HTML]</a><p>DOI: 10.1000/profile</p>' };
    },
    sleep: async () => {},
  });

  assert.deepEqual(fetched, [papers[0].detailUrl]);
  assert.equal(downloaded[0].url, 'https://files.test/profile.pdf?download=1');
  assert.equal(response.enrichmentResults[0].doi, '10.1000/profile');
  assert.equal(response.blocked, null);
  assert.deepEqual(response.results.map(item => item.status), ['success', 'metadata']);
});

test('RUN_BATCH reports a blocked enrichment and still exports retained metadata', async () => {
  const downloaded = [];
  const chromeApi = {
    storage: { local: { get: async () => ({ downloadDelayMs: 300 }) } },
    downloads: { download: async options => { downloaded.push(options); return downloaded.length; } },
  };
  const papers = [
    { id: 'gsbd-profile-1', title: 'One', authors: [], detailUrl: 'https://scholar.google.com/citations?one', pdfUrl: '' },
    { id: 'gsbd-profile-2', title: 'Two', authors: [], detailUrl: 'https://scholar.google.com/citations?two', pdfUrl: '' },
  ];
  let fetches = 0;

  const response = await runBatch(papers, chromeApi, {
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<form id="gs_captcha_f"></form>' };
    },
    sleep: async () => {},
  });

  assert.equal(fetches, 1);
  assert.equal(response.blocked, 'captcha');
  assert.match(response.notice, /CAPTCHA/);
  assert.deepEqual(response.enrichmentResults.map(item => item.status), ['blocked']);
  assert.deepEqual(response.results.map(item => item.status), ['metadata', 'metadata']);
  assert.deepEqual(downloaded.slice(-3).map(item => item.filename.slice(item.filename.lastIndexOf('.'))), ['.ris', '.bib', '.json']);
});

test('SEND_ZOTERO does not fetch Scholar citation details', async () => {
  const urls = [];
  const paper = { id: 'gsbd-profile-1', title: 'Profile paper', authors: [], detailUrl: 'https://scholar.google.com/citations?view_op=view_citation', pdfUrl: '' };

  const response = await sendZotero([paper], async url => {
    urls.push(url);
    return { ok: true };
  });

  assert.equal(response.ok, true);
  assert.deepEqual(urls, ['http://127.0.0.1:23119/connector/saveItems']);
});
