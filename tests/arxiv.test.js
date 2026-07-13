import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArxivQueryUrl,
  findArxivMatchesSequentially,
  parseArxivFeed,
  selectArxivMatch,
} from '../src/arxiv.js';

const feed = entries => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
${entries.join('\n')}
</feed>`;

const entry = ({ id = '2401.12345v2', title = 'A Study', authors = ['Ada Lovelace'], doi = '', pdf = `http://arxiv.org/pdf/${id}` } = {}) => `
<entry>
  <id>http://arxiv.org/abs/${id}</id>
  <title>${title}</title>
  ${authors.map(author => `<author><name>${author}</name></author>`).join('')}
  ${doi ? `<arxiv:doi>${doi}</arxiv:doi>` : ''}
  <link title="pdf" href="${pdf}" rel="related" type="application/pdf"/>
</entry>`;

test('builds a bounded HTTPS title query for the official arXiv API', () => {
  const url = new URL(buildArxivQueryUrl({ title: 'Graph "Quoted" Study' }));

  assert.equal(url.origin, 'https://export.arxiv.org');
  assert.equal(url.pathname, '/api/query');
  assert.equal(url.searchParams.get('search_query'), 'ti:"Graph Quoted Study"');
  assert.equal(url.searchParams.get('start'), '0');
  assert.equal(url.searchParams.get('max_results'), '5');
  assert.equal(url.searchParams.get('sortBy'), 'relevance');
});

test('parses Atom entries and normalizes only official arXiv PDF links to HTTPS', () => {
  const papers = parseArxivFeed(feed([
    entry({ title: 'Graph &amp; Learning', doi: '10.1000/ABC' }),
    entry({ id: '2401.99999', title: 'Unsafe', pdf: 'https://evil.example/paper.pdf' }),
  ]));

  assert.deepEqual(papers, [{
    arxivId: '2401.12345v2',
    title: 'Graph & Learning',
    authors: ['Ada Lovelace'],
    doi: '10.1000/ABC',
    abstractUrl: 'https://arxiv.org/abs/2401.12345v2',
    pdfUrl: 'https://arxiv.org/pdf/2401.12345v2',
  }]);
});

test('prefers an exact DOI match over title and otherwise requires an exact normalized title', () => {
  const candidates = parseArxivFeed(feed([
    entry({ id: 'one', title: 'Different preprint title', doi: '10.1000/match' }),
    entry({ id: 'two', title: 'Graph-Based Learning: A Study', doi: '' }),
    entry({ id: 'three', title: 'Graph Based Learning Extended', doi: '' }),
  ]));

  assert.equal(selectArxivMatch({ title: 'Published title', doi: 'https://doi.org/10.1000/MATCH' }, candidates).arxivId, 'one');
  assert.equal(selectArxivMatch({ title: 'Graph based learning — a study', doi: '' }, candidates).arxivId, 'two');
  assert.equal(selectArxivMatch({ title: 'Graph Based Learning', doi: '' }, candidates), null);
});

test('searches sequentially, waits three seconds between calls, and continues after errors', async () => {
  const requests = [];
  const delays = [];
  const papers = [
    { id: 'p1', title: 'First', authors: [], doi: '' },
    { id: 'p2', title: 'Second', authors: [], doi: '' },
    { id: 'p3', title: 'Third', authors: [], doi: '' },
  ];
  const results = await findArxivMatchesSequentially(papers, {
    fetchImpl: async url => {
      requests.push(url);
      if (url.includes('Second')) throw new Error('offline');
      const title = url.includes('First') ? 'First' : 'Unrelated';
      return { ok: true, text: async () => feed([entry({ id: title.toLowerCase(), title })]) };
    },
    sleep: async milliseconds => delays.push(milliseconds),
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(delays, [3000, 3000]);
  assert.deepEqual(results.map(result => result.status), ['matched', 'lookup_failed', 'not_found']);
  assert.equal(results[0].match.arxivId, 'first');
  assert.match(results[1].error, /offline/);
});

test('treats non-success API responses as per-paper lookup failures', async () => {
  const [result] = await findArxivMatchesSequentially([{ id: 'p1', title: 'Paper' }], {
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });

  assert.equal(result.status, 'lookup_failed');
  assert.match(result.error, /HTTP 503/);
});
