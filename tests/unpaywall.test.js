import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnpaywallApiUrl,
  findUnpaywallMatchesSequentially,
  normalizeDoi,
  selectUnpaywallPdf,
} from '../src/unpaywall.js';

test('normalizes DOI forms and builds the official API URL with contact email', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/ABC.1.'), '10.1000/abc.1');
  const url = new URL(buildUnpaywallApiUrl('10.1000/ABC.1', 'researcher@example.org'));
  assert.equal(url.origin, 'https://api.unpaywall.org');
  assert.equal(decodeURIComponent(url.pathname), '/v2/10.1000/abc.1');
  assert.equal(url.searchParams.get('email'), 'researcher@example.org');
});

test('selects the best OA PDF and falls back to another HTTPS PDF location', () => {
  const base = { doi: '10.1000/example', is_oa: true, oa_status: 'green' };
  assert.deepEqual(selectUnpaywallPdf('10.1000/example', {
    ...base,
    best_oa_location: {
      url_for_pdf: 'https://publisher.test/paper.pdf',
      url: 'https://publisher.test/article', host_type: 'publisher', license: 'cc-by', version: 'publishedVersion',
    },
  }), {
    doi: '10.1000/example', pdfUrl: 'https://publisher.test/paper.pdf', landingUrl: 'https://publisher.test/article',
    hostType: 'publisher', license: 'cc-by', version: 'publishedVersion', repositoryInstitution: '', oaStatus: 'green',
  });

  const fallback = selectUnpaywallPdf('10.1000/example', {
    ...base,
    best_oa_location: { url_for_pdf: 'http://unsafe.test/paper.pdf' },
    oa_locations: [{ url_for_pdf: 'https://repository.test/paper.pdf', host_type: 'repository', repository_institution: 'Example University' }],
  });
  assert.equal(fallback.pdfUrl, 'https://repository.test/paper.pdf');
  assert.equal(fallback.repositoryInstitution, 'Example University');
});

test('rejects mismatched DOI, closed records, and records without an HTTPS PDF', () => {
  assert.equal(selectUnpaywallPdf('10.1000/wanted', { doi: '10.1000/other', is_oa: true, best_oa_location: { url_for_pdf: 'https://x.test/a.pdf' } }), null);
  assert.equal(selectUnpaywallPdf('10.1000/wanted', { doi: '10.1000/wanted', is_oa: false, best_oa_location: { url_for_pdf: 'https://x.test/a.pdf' } }), null);
  assert.equal(selectUnpaywallPdf('10.1000/wanted', { doi: '10.1000/wanted', is_oa: true, best_oa_location: { url_for_pdf: 'http://x.test/a.pdf' } }), null);
});

test('looks up DOI papers sequentially and classifies missing DOI, 404, and failures', async () => {
  const urls = [];
  const responses = [
    { ok: true, status: 200, json: async () => ({ doi: '10.1000/one', is_oa: true, best_oa_location: { url_for_pdf: 'https://repo.test/one.pdf' } }) },
    { ok: false, status: 404, json: async () => ({}) },
    new Error('offline'),
  ];
  const results = await findUnpaywallMatchesSequentially([
    { id: 'one', doi: '10.1000/one' },
    { id: 'missing', doi: '' },
    { id: 'two', doi: '10.1000/two' },
    { id: 'three', doi: '10.1000/three' },
  ], {
    email: 'researcher@example.org',
    fetchImpl: async url => {
      urls.push(url);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });

  assert.equal(urls.length, 3);
  assert.deepEqual(results.map(result => result.status), ['matched', 'missing_doi', 'not_found', 'lookup_failed']);
  assert.match(results[3].error, /offline/);
});

test('does not call the API without a valid contact email', async () => {
  let calls = 0;
  const results = await findUnpaywallMatchesSequentially([{ id: 'one', doi: '10.1000/one' }], {
    email: '',
    fetchImpl: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(results[0].status, 'not_configured');
});
