import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCitationDetail, enrichPapersSequentially } from '../src/enrichment.js';

const htmlResponse = (body, { ok = true, contentType = 'text/html; charset=utf-8' } = {}) => ({
  ok,
  headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
  text: async () => body,
});

test('citation details accept explicit PDF and PDF paths with query strings, but reject HTML links', () => {
  const explicit = parseCitationDetail('<a href="/download?id=1">[PDF]</a>', 'https://scholar.google.com/citations');
  const path = parseCitationDetail('<a href="https://files.test/paper.pdf?download=1">[HTML]</a>', 'https://scholar.google.com/citations');
  const html = parseCitationDetail('<a href="https://files.test/paper.html">[HTML]</a>', 'https://scholar.google.com/citations');

  assert.equal(explicit.pdfUrl, 'https://scholar.google.com/download?id=1');
  assert.equal(path.pdfUrl, 'https://files.test/paper.pdf?download=1');
  assert.equal(html.pdfUrl, '');
});

test('citation details accept trimmed PDF marker prefixes including adjacent tag text', () => {
  const publisher = parseCitationDetail(
    '<a href="/download?id=publisher">  [PDF] publisher.example</a>',
    'https://scholar.google.com/citations',
  );
  const adjacent = parseCitationDetail(
    '<a href="/download?id=adjacent"><span>[PDF]</span>files.example</a>',
    'https://scholar.google.com/citations',
  );

  assert.equal(publisher.pdfUrl, 'https://scholar.google.com/download?id=publisher');
  assert.equal(adjacent.pdfUrl, 'https://scholar.google.com/download?id=adjacent');
});

test('citation details read the actual href attribute rather than data-href suffixes', () => {
  const detail = parseCitationDetail(
    '<a data-href="https://attacker.test/file.pdf" href="/landing">Landing</a>',
    'https://scholar.google.com/citations',
  );

  assert.equal(detail.pdfUrl, '');
});

test('citation details extract only explicit DOI candidates', () => {
  assert.equal(parseCitationDetail('<p>DOI: 10.1000/example-7.</p>', 'https://scholar.google.com').doi, '10.1000/example-7');
  assert.equal(parseCitationDetail('<a href="https://doi.org/10.5555/ABC.9">record</a>', 'https://scholar.google.com').doi, '10.5555/ABC.9');
});

test('citation details detect CAPTCHA and abnormal traffic', () => {
  assert.equal(parseCitationDetail('<form id="gs_captcha_f"></form>', 'https://scholar.google.com').blocked, 'captcha');
  assert.equal(parseCitationDetail('<main>Our systems have detected unusual traffic from your computer network.</main>', 'https://scholar.google.com').blocked, 'traffic');
  assert.equal(parseCitationDetail('<main>Your computer or network may be sending automated queries.</main>', 'https://scholar.google.com').blocked, 'traffic');
});

test('enrichment requests details sequentially in order and delays between requests', async () => {
  const events = [];
  const papers = [1, 2, 3].map(id => ({ id: String(id), title: `Paper ${id}`, detailUrl: `https://scholar.google.com/detail/${id}`, pdfUrl: '', doi: '' }));
  const fetchImpl = async url => {
    events.push(`fetch:${url.at(-1)}`);
    return htmlResponse(`<a href="/files/${url.at(-1)}.pdf">[PDF]</a>`);
  };

  const result = await enrichPapersSequentially(papers, {
    fetchImpl,
    delayMs: 321,
    sleep: async ms => events.push(`sleep:${ms}`),
  });

  assert.deepEqual(events, ['fetch:1', 'sleep:321', 'fetch:2', 'sleep:321', 'fetch:3']);
  assert.deepEqual(result.papers.map(paper => paper.pdfUrl), [
    'https://scholar.google.com/files/1.pdf',
    'https://scholar.google.com/files/2.pdf',
    'https://scholar.google.com/files/3.pdf',
  ]);
  assert.equal(result.blocked, null);
});

test('ordinary failures retain metadata and continue, including non-HTML responses', async () => {
  const calls = [];
  const papers = [1, 2, 3].map(id => ({ id: String(id), title: `Paper ${id}`, detailUrl: `https://scholar.google.com/detail/${id}`, pdfUrl: '', doi: '' }));
  const responses = [
    () => { throw new Error('offline'); },
    () => htmlResponse('PDF bytes', { contentType: 'application/pdf' }),
    () => htmlResponse('<p>DOI: 10.1000/third</p>'),
  ];

  const result = await enrichPapersSequentially(papers, {
    fetchImpl: async url => { calls.push(url); return responses[calls.length - 1](); },
    delayMs: 0,
    sleep: async () => {},
  });

  assert.equal(calls.length, 3);
  assert.equal(result.papers[0], papers[0]);
  assert.equal(result.papers[1], papers[1]);
  assert.equal(result.papers[2].doi, '10.1000/third');
  assert.deepEqual(result.results.map(item => item.ok), [false, false, true]);
});

test('an unsuccessful HTTP response is an ordinary failure and later papers continue', async () => {
  const calls = [];
  const papers = [1, 2].map(id => ({ id: String(id), detailUrl: `https://scholar.google.com/detail/${id}`, pdfUrl: '', doi: '' }));
  const result = await enrichPapersSequentially(papers, {
    fetchImpl: async url => {
      calls.push(url);
      return calls.length === 1
        ? htmlResponse('server error', { ok: false })
        : htmlResponse('<a href="/two.pdf">[PDF]</a>');
    },
    delayMs: 0,
    sleep: async () => {},
  });

  assert.equal(calls.length, 2);
  assert.equal(result.papers[0], papers[0]);
  assert.equal(result.papers[1].pdfUrl, 'https://scholar.google.com/two.pdf');
  assert.deepEqual(result.results.map(item => item.ok), [false, true]);
});

for (const [status, body, expectedBlock] of [
  [429, '<form id="gs_captcha_f"></form>', 'captcha'],
  [503, '<main>Our systems have detected abnormal traffic from your computer network.</main>', 'traffic'],
]) {
  test(`a blocked HTML response with HTTP ${status} stops later fetches`, async () => {
    const calls = [];
    const papers = [1, 2].map(id => ({
      id: String(id),
      detailUrl: `https://scholar.google.com/detail/${id}`,
      pdfUrl: '',
      doi: '',
    }));

    const result = await enrichPapersSequentially(papers, {
      fetchImpl: async url => {
        calls.push(url);
        return calls.length === 1
          ? htmlResponse(body, { ok: false })
          : htmlResponse('<a href="/two.pdf">[PDF]</a>');
      },
      delayMs: 0,
      sleep: async () => {},
    });

    assert.equal(calls.length, 1);
    assert.equal(result.blocked, expectedBlock);
    assert.deepEqual(result.results.map(item => item.status), ['blocked']);
    assert.equal(result.papers[1], papers[1]);
  });
}

test('a blocked response stops later fetches and retains remaining papers', async () => {
  const calls = [];
  const papers = [1, 2, 3].map(id => ({ id: String(id), detailUrl: `https://scholar.google.com/detail/${id}`, pdfUrl: '', doi: '' }));
  const result = await enrichPapersSequentially(papers, {
    fetchImpl: async url => {
      calls.push(url);
      return calls.length === 2
        ? htmlResponse('<p>unusual traffic from your computer network</p>')
        : htmlResponse('<a href="/one.pdf">[PDF]</a>');
    },
    delayMs: 10,
    sleep: async () => {},
  });

  assert.equal(calls.length, 2);
  assert.equal(result.blocked, 'traffic');
  assert.equal(result.papers[2], papers[2]);
  assert.deepEqual(result.results.map(item => item.status), ['enriched', 'blocked']);
});
