import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseScholarPage, detectScholarBlock } from '../src/parser.js';

const resultsHtml = readFileSync(new URL('./fixtures/scholar-results.html', import.meta.url), 'utf8');
const captchaHtml = readFileSync(new URL('./fixtures/scholar-captcha.html', import.meta.url), 'utf8');

test('parses current-page rows', () => {
  const dom = new JSDOM(resultsHtml, { url: 'https://scholar.google.com/scholar?q=test' });
  const papers = parseScholarPage(dom.window.document);
  assert.equal(papers.length, 2);
  assert.deepEqual(papers[0].authors, ['Alice Wang', 'Bob Li']);
  assert.equal(papers[0].title, 'First Paper');
  assert.equal(papers[0].year, '2025');
  assert.equal(papers[0].detailUrl, 'https://scholar.google.com/scholar?cluster=first');
  assert.match(papers[0].pdfUrl, /\.pdf$/);
  assert.equal(papers[1].status, 'metadata');
  assert.equal(papers[1].title, 'Second Paper');
  assert.equal(dom.window.document.querySelectorAll('[data-gsbd-id]').length, 2);
});

test('detects CAPTCHA', () => {
  const dom = new JSDOM(captchaHtml);
  assert.equal(detectScholarBlock(dom.window.document), 'captcha');
});

test('detects an unexpected page structure', () => {
  const dom = new JSDOM('<main>No Scholar rows</main>');
  assert.equal(detectScholarBlock(dom.window.document), 'structure');
});

test('does not report a block when result rows exist', () => {
  const dom = new JSDOM(resultsHtml);
  assert.equal(detectScholarBlock(dom.window.document), null);
});
