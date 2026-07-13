import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPapers, makeBatchFiles, normalizeDownloadDelay, runBatch, runWithRetry, sendZotero } from '../src/background.js';

function makeDownloadApi(downloadImpl = async (_options, id) => id) {
  const listeners = new Set();
  let nextId = 1;
  const api = {
    onChanged: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    },
    async download(options) {
      const id = nextId++;
      return downloadImpl(options, id, api.emit);
    },
    emit(delta) {
      for (const listener of [...listeners]) listener(delta);
    },
    listenerCount() { return listeners.size; },
  };
  return api;
}

function makeAutoCompletingDownloads(attempts = []) {
  return makeDownloadApi(async (options, id, emit) => {
    attempts.push(options);
    if (String(options.filename).endsWith('.pdf')) {
      setTimeout(() => emit({ id, state: { current: 'complete' } }), 0);
    }
    return id;
  });
}

test('retries one failed task once', async () => {
  let calls = 0;
  const value = await runWithRetry(async () => {
    if (++calls === 1) throw new Error('network');
    return 7;
  }, 1);

  assert.equal(value, 7);
  assert.equal(calls, 2);
});

test('batch files always include ris bib json and csv', () => {
  assert.deepEqual(makeBatchFiles([], []).map(file => file.extension), ['ris', 'bib', 'json', 'csv']);
});

test('a PDF download remains pending until Chrome reports complete', async () => {
  const downloads = makeDownloadApi();
  let settled = false;
  const task = downloadPapers([
    { id: 'p1', title: 'Paper', authors: ['Ada'], year: '1843', pdfUrl: 'https://files.test/paper.pdf' },
  ], { downloads }, { timeoutMs: 1000, now: () => new Date('2026-07-13T10:00:00.000Z') })
    .then(value => { settled = true; return value; });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.equal(downloads.listenerCount(), 1);

  downloads.emit({ id: 1, state: { current: 'complete' } });
  const [result] = await task;

  assert.equal(result.status, 'success');
  assert.equal(result.ok, true);
  assert.equal(result.downloadId, 1);
  assert.equal(result.source, 'scholar');
  assert.equal(result.filename.endsWith('.pdf'), true);
  assert.equal(result.finishedAt, '2026-07-13T10:00:00.000Z');
  assert.equal(downloads.listenerCount(), 0);
});

test('tracks out-of-order completion, interruption reasons, and ignores unrelated IDs', async () => {
  const downloads = makeDownloadApi();
  let tick = 0;
  const task = downloadPapers([
    { id: 'p1', title: 'One', authors: [], year: '', pdfUrl: 'https://files.test/one.pdf' },
    { id: 'p2', title: 'Two', authors: [], year: '', pdfUrl: 'https://files.test/two.pdf' },
  ], { downloads }, {
    sleep: async () => {},
    timeoutMs: 1000,
    now: () => new Date(1_000 * tick++),
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  downloads.emit({ id: 99, state: { current: 'complete' } });
  downloads.emit({ id: 2, error: { current: 'NETWORK_FAILED' }, state: { current: 'interrupted' } });
  downloads.emit({ id: 1, state: { current: 'complete' } });
  const results = await task;

  assert.deepEqual(results.map(result => result.status), ['success', 'failed']);
  assert.equal(results[1].error, 'NETWORK_FAILED');
  assert.equal(results[1].downloadId, 2);
  assert.equal(downloads.listenerCount(), 0);
});

test('marks unresolved downloads timeout and clears the injected deadline', async () => {
  const downloads = makeDownloadApi();
  let deadline;
  let cleared;
  const task = downloadPapers([
    { id: 'p1', title: 'Slow', authors: [], year: '', pdfUrl: 'https://files.test/slow.pdf' },
  ], { downloads }, {
    timeoutMs: 240_000,
    now: () => new Date('2026-07-13T10:00:00.000Z'),
    setTimeout: (handler, milliseconds) => { deadline = { handler, milliseconds }; return 77; },
    clearTimeout: id => { cleared = id; },
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(deadline.milliseconds, 240_000);
  deadline.handler();
  const [result] = await task;

  assert.equal(result.status, 'timeout');
  assert.equal(result.ok, false);
  assert.match(result.error, /240/);
  assert.equal(cleared, 77);
  assert.equal(downloads.listenerCount(), 0);
});

test('classifies missing PDFs immediately without installing a download listener', async () => {
  const downloads = makeDownloadApi();
  const [result] = await downloadPapers([
    { id: 'p1', title: 'Metadata', authors: ['Ada'], year: '1843', pdfUrl: '' },
  ], { downloads }, { now: () => new Date('2026-07-13T10:00:00.000Z') });

  assert.equal(result.status, 'no_pdf');
  assert.equal(result.ok, true);
  assert.equal(result.downloadId, null);
  assert.equal(downloads.listenerCount(), 0);
});

test('retries a start failure once and continues later PDF downloads', async () => {
  const attempts = [];
  const downloads = makeDownloadApi(async (options, id) => {
    attempts.push(options.url);
    if (options.url.endsWith('/broken.pdf')) throw new Error('start blocked');
    return id;
  });
  const task = downloadPapers([
    { id: 'broken', title: 'Broken', authors: [], year: '', pdfUrl: 'https://files.test/broken.pdf' },
    { id: 'working', title: 'Working', authors: [], year: '', pdfUrl: 'https://files.test/working.pdf' },
  ], { downloads }, { sleep: async () => {}, timeoutMs: 1000 });

  await new Promise(resolve => setTimeout(resolve, 0));
  downloads.emit({ id: 3, state: { current: 'complete' } });
  const results = await task;

  assert.deepEqual(attempts, [
    'https://files.test/broken.pdf',
    'https://files.test/broken.pdf',
    'https://files.test/working.pdf',
  ]);
  assert.deepEqual(results.map(result => result.status), ['failed', 'success']);
  assert.match(results[0].error, /start blocked/);
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

  assert.deepEqual(attempts.map(name => name.slice(name.lastIndexOf('.'))), ['.ris', '.bib', '.json', '.csv']);
  assert.deepEqual(response.results.map(result => ({ id: result.id, ok: result.ok, status: result.status })), [
    { id: 'metadata-1', ok: true, status: 'no_pdf' },
  ]);
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
    downloads: makeAutoCompletingDownloads(downloaded),
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
  assert.deepEqual(response.results.map(item => item.status), ['success', 'no_pdf']);
});

test('RUN_BATCH fetches only missing-PDF profile details on exact HTTPS Scholar host', async () => {
  const fetched = [];
  const chromeApi = {
    storage: { local: { get: async () => ({ downloadDelayMs: 300 }) } },
    downloads: makeAutoCompletingDownloads(),
  };
  const papers = [
    { id: 'gsbd-profile-valid', detailUrl: 'https://scholar.google.com/citations?valid', pdfUrl: '' },
    { id: 'gsbd-profile-evil', detailUrl: 'https://scholar.google.evil.example/citations?evil', pdfUrl: '' },
    { id: 'gsbd-profile-http', detailUrl: 'http://scholar.google.com/citations?http', pdfUrl: '' },
    { id: 'gsbd-profile-pdf', detailUrl: 'https://scholar.google.com/citations?pdf', pdfUrl: 'https://files.test/existing.pdf' },
    { id: 'gsbd-profile-no-detail', detailUrl: '', pdfUrl: '' },
  ].map(paper => ({ title: paper.id, authors: [], year: '', venue: '', snippet: '', doi: '', ...paper }));

  await runBatch(papers, chromeApi, {
    fetchImpl: async url => {
      fetched.push(url);
      return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<main>No PDF</main>' };
    },
    sleep: async () => {},
  });

  assert.deepEqual(fetched, ['https://scholar.google.com/citations?valid']);
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
  assert.deepEqual(response.results.map(item => item.status), ['no_pdf', 'no_pdf']);
  assert.deepEqual(downloaded.slice(-4).map(item => item.filename.slice(item.filename.lastIndexOf('.'))), ['.ris', '.bib', '.json', '.csv']);
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
