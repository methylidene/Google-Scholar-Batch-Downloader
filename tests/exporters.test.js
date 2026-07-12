import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaper } from '../src/model.js';
import { toRis, toBibTeX, toResultJson, toDataUrl } from '../src/exporters.js';

test('exports every selected paper including metadata-only records', () => {
  const papers = [normalizePaper({ id: 'p1', title: 'Study', authors: ['Alice Wang', 'Bob Li'], year: '2025', venue: 'Journal', detailUrl: 'https://example.test' })];

  assert.match(toRis(papers), /TY  - JOUR[\s\S]*AU  - Alice Wang[\s\S]*ER  -/);
  assert.match(toBibTeX(papers), /@article\{wang2025study,[\s\S]*author = \{Alice Wang and Bob Li\}/);
  assert.equal(JSON.parse(toResultJson(papers, [{ id: 'p1', status: 'metadata' }])).results[0].status, 'metadata');
});

test('emits optional RIS fields when metadata is available', () => {
  const paper = normalizePaper({ title: 'Study', authors: ['Alice Wang'], year: '2025', venue: 'Journal', doi: '10.1/test', detailUrl: 'https://example.test' });

  assert.equal(toRis([paper]), [
    'TY  - JOUR',
    'AU  - Alice Wang',
    'TI  - Study',
    'PY  - 2025',
    'JO  - Journal',
    'DO  - 10.1/test',
    'UR  - https://example.test',
    'ER  - ',
  ].join('\n'));
});

test('creates deterministic unique ASCII-safe BibTeX keys and escapes braces', () => {
  const papers = [
    normalizePaper({ title: 'Über {Study}', authors: ['Zoë García'], year: '2025' }),
    normalizePaper({ title: 'Über {Study}', authors: ['Zoë García'], year: '2025' }),
  ];
  const bibtex = toBibTeX(papers);

  assert.match(bibtex, /@article\{garcia2025uber,/);
  assert.match(bibtex, /title = \{Über \\{Study\\\}\}/);
  assert.match(bibtex, /@article\{garcia2025uber-2,/);
});

test('serializes papers and results with a generated timestamp', () => {
  const papers = [normalizePaper({ id: 'p1', title: 'Study' })];
  const parsed = JSON.parse(toResultJson(papers, [{ id: 'p1', status: 'metadata' }]));

  assert.equal(Number.isNaN(Date.parse(parsed.generatedAt)), false);
  assert.deepEqual(parsed.papers, papers);
  assert.deepEqual(parsed.results, [{ id: 'p1', status: 'metadata' }]);
});

test('creates a UTF-8 data URL', () => {
  assert.equal(toDataUrl('A & B', 'text/plain'), 'data:text/plain;charset=utf-8,A%20%26%20B');
});
