import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaper, matchesAuthor, buildPdfFilename } from '../src/model.js';

test('normalizes and filters a paper', () => {
  const paper = normalizePaper({ title: '  A/B: Study? ', authors: [' Alice Wang ', 'BOB LI'], year: '2025', pdfUrl: 'https://x/p.pdf' });
  assert.equal(paper.title, 'A/B: Study?');
  assert.equal(paper.status, 'pdf');
  assert.equal(matchesAuthor(paper, 'alice'), true);
  assert.equal(matchesAuthor(paper, 'carol'), false);
  assert.equal(buildPdfFilename(paper), 'Alice Wang - 2025 - A B Study.pdf');
});
