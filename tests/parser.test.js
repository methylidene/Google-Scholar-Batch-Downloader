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

test('accepts only explicit PDF links or http PDF paths', () => {
  const dom = new JSDOM(`
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/one">One</a></h3><div class="gs_or_ggsm"><a href="/files/one.pdf?download=1">[HTML]</a></div></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/two">Two</a></h3><a href="https://files.example/two">[PDF]</a></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/three">Three</a></h3><div class="gs_or_ggsm"><a href="https://files.example/three.html">[HTML]</a></div></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/four">Four</a></h3><a href="javascript:alert(1)">[PDF]</a></div>`,
    { url: 'https://scholar.google.com/scholar?q=test' });

  const papers = parseScholarPage(dom.window.document);
  assert.equal(papers[0].pdfUrl, 'https://scholar.google.com/files/one.pdf?download=1');
  assert.equal(papers[1].pdfUrl, 'https://files.example/two');
  assert.equal(papers[2].pdfUrl, '');
  assert.equal(papers[3].pdfUrl, '');
});

test('accepts trimmed PDF marker prefixes in search results', () => {
  const dom = new JSDOM(`
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/one">One</a></h3><a href="/download?id=one">  [PDF] publisher.example</a></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="/paper/two">Two</a></h3><a href="/download?id=two"><span>[PDF]</span>files.example</a></div>`,
    { url: 'https://scholar.google.com/scholar?q=test' });

  const papers = parseScholarPage(dom.window.document);
  assert.equal(papers[0].pdfUrl, 'https://scholar.google.com/download?id=one');
  assert.equal(papers[1].pdfUrl, 'https://scholar.google.com/download?id=two');
});

test('extracts DOI only from explicit DOI text or doi.org links', () => {
  const dom = new JSDOM(`
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt">One</h3><div class="gs_rs">DOI: 10.1000/xyz-123.</div></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt">Two</h3><a href="https://doi.org/10.5555/ABC.9">record</a></div>
    <div class="gs_r gs_or gs_scl"><h3 class="gs_rt">Three</h3><div class="gs_rs">Possible identifier 10.9999/not-explicit</div></div>`,
    { url: 'https://scholar.google.com/scholar?q=test' });

  const papers = parseScholarPage(dom.window.document);
  assert.equal(papers[0].doi, '10.1000/xyz-123');
  assert.equal(papers[1].doi, '10.5555/ABC.9');
  assert.equal(papers[2].doi, '');
});
