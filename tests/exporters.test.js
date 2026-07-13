import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaper } from '../src/model.js';
import { toRis, toBibTeX, toResultJson, toDataUrl, toCsv } from '../src/exporters.js';

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

test('exports batch results as UTF-8 BOM CSV with stable columns', () => {
  const result = {
    title: '论文, "测试"',
    authors: ['张三', '李四'],
    year: '2026',
    status: 'failed',
    source: 'scholar',
    pdfUrl: 'https://example.test/paper.pdf?name=a,b',
    filename: '张三 - 2026 - 论文.pdf',
    downloadId: 42,
    error: '网络\r\n中断',
    startedAt: '2026-07-13T10:00:00.000Z',
    finishedAt: '2026-07-13T10:00:01.000Z',
    scholarStatus: 'failed',
    scholarError: 'ORIGINAL_FAILED',
    fallbackStatus: 'success',
    fallbackError: '',
    arxivId: '2401.12345v1',
  };

  const csv = toCsv([result]);

  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.slice(1).split('\r\n')[0], 'title,authors,year,status,source,pdfUrl,filename,downloadId,error,startedAt,finishedAt,scholarStatus,scholarError,fallbackStatus,fallbackError,arxivId');
  assert.match(csv, /"论文, ""测试"""/);
  assert.match(csv, /张三；李四/);
  assert.match(csv, /"https:\/\/example\.test\/paper\.pdf\?name=a,b"/);
  assert.match(csv, /"网络\r\n中断"/);
  assert.match(csv, /,42,/);
  assert.match(csv, /,failed,ORIGINAL_FAILED,success,,2401\.12345v1/);
});

test('escapes CSV cells and keeps nullish values empty without mutating results', () => {
  const results = [{
    title: 'line one\nline two',
    authors: null,
    year: undefined,
    status: 'no_pdf',
    source: 'scholar',
    pdfUrl: '',
    filename: '',
    downloadId: null,
    error: 'say "no"',
    startedAt: '',
    finishedAt: '',
  }];
  const snapshot = structuredClone(results);

  const csv = toCsv(results);

  assert.match(csv, /"line one\nline two",,,no_pdf,scholar,,,/);
  assert.match(csv, /"say ""no"""/);
  assert.deepEqual(results, snapshot);
  assert.equal(csv.endsWith('\r\n'), true);
});
