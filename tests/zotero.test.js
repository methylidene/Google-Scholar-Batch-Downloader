import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaper } from '../src/model.js';
import { toZoteroItems, buildZoteroRequest } from '../src/zotero.js';

test('maps papers to Zotero saveItems payload', () => {
  const [item] = toZoteroItems([normalizePaper({ title: 'Study', authors: ['Alice Wang'], year: '2025', venue: 'Journal', detailUrl: 'https://example.test', pdfUrl: 'https://example.test/a.pdf' })]);
  assert.equal(item.itemType, 'journalArticle');
  assert.deepEqual(item.creators[0], { creatorType: 'author', firstName: 'Alice', lastName: 'Wang' });
  assert.equal(item.attachments[0].mimeType, 'application/pdf');
});

test('maps metadata and preserves single-field creator names', () => {
  const [item] = toZoteroItems([normalizePaper({ title: 'Study', authors: ['Plato'], year: '2025', venue: 'Journal', doi: '10.1/test', detailUrl: 'https://example.test', snippet: 'Summary' })]);
  assert.deepEqual(item, { itemType: 'journalArticle', title: 'Study', creators: [{ creatorType: 'author', name: 'Plato' }], date: '2025', publicationTitle: 'Journal', DOI: '10.1/test', url: 'https://example.test', abstractNote: 'Summary', attachments: [] });
});

test('builds a Zotero connector saveItems POST request', () => {
  const papers = [normalizePaper({ title: 'Study' })];
  const request = buildZoteroRequest(papers);
  assert.equal(request.url, 'http://127.0.0.1:23119/connector/saveItems');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.headers, { 'Content-Type': 'application/json', 'X-Zotero-Connector-API-Version': '3' });
  assert.deepEqual(JSON.parse(request.options.body), { items: toZoteroItems(papers) });
});
