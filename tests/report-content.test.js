import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeScholarUi, renderBatchReport } from '../src/content.js';

const fixture = name => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

const mixedResponse = {
  ok: false,
  results: [
    { id: 'p1', title: 'Downloaded', authors: ['Ada'], year: '1843', status: 'success', source: 'arxiv', filename: 'Ada - Downloaded.pdf', pdfUrl: 'https://arxiv.org/pdf/2401.1', downloadId: 1, error: '', scholarStatus: 'no_pdf', scholarError: '', fallbackStatus: 'success', fallbackError: '', arxivId: '2401.1' },
    { id: 'p2', title: 'Metadata', authors: ['Bob'], year: '2025', status: 'no_pdf', source: 'scholar', filename: '', pdfUrl: '', downloadId: null, error: '', scholarStatus: 'no_pdf', fallbackStatus: 'not_found', fallbackError: '' },
    { id: 'p3', title: 'Interrupted', authors: [], year: '', status: 'failed', source: 'scholar', filename: 'Interrupted.pdf', pdfUrl: 'https://files.test/three.pdf', downloadId: 3, error: 'NETWORK_FAILED', scholarStatus: 'failed', fallbackStatus: 'lookup_failed', fallbackError: 'arXiv API HTTP 503' },
    { id: 'p4', title: 'Slow', authors: [], year: '', status: 'timeout', source: 'scholar', filename: 'Slow.pdf', pdfUrl: 'https://files.test/four.pdf', downloadId: 4, error: '等待超过 240 秒' },
  ],
  exportErrors: [{ extension: 'csv', error: 'download blocked' }],
};

test('renders mixed batch counts, paper details, and separate export errors', () => {
  const dom = new JSDOM('<body></body>');

  const panel = renderBatchReport(dom.window.document, mixedResponse);

  assert.equal(panel.querySelector('.gsbd-report-total').textContent, '总数 4');
  assert.equal(panel.querySelector('.gsbd-report-success').textContent, '成功下载 1');
  assert.equal(panel.querySelector('.gsbd-report-no_pdf').textContent, '未找到 PDF 1');
  assert.equal(panel.querySelector('.gsbd-report-failed').textContent, '下载失败 1');
  assert.equal(panel.querySelector('.gsbd-report-timeout').textContent, '下载超时 1');
  assert.equal(panel.querySelector('.gsbd-report-arxiv-success').textContent, 'arXiv 成功 1');
  assert.equal(panel.querySelectorAll('.gsbd-report-item').length, 4);
  assert.match(panel.querySelector('[data-status="failed"]').textContent, /Interrupted/);
  assert.match(panel.querySelector('[data-status="failed"]').textContent, /NETWORK_FAILED/);
  assert.match(panel.querySelector('[data-status="success"]').textContent, /arxiv/);
  assert.match(panel.querySelector('[data-status="success"]').textContent, /2401\.1/);
  assert.match(panel.querySelector('[data-status="success"]').textContent, /Scholar 结果：未找到 PDF/);
  assert.match(panel.querySelector('[data-status="failed"]').textContent, /arXiv API HTTP 503/);
  assert.match(panel.querySelector('.gsbd-report-export-errors').textContent, /csv：download blocked/);
});

test('writes untrusted report values as text and closes the report', () => {
  const dom = new JSDOM('<body></body>');
  const title = '<img src=x onerror=alert(1)>';
  const error = '<script>bad()</script>';
  const panel = renderBatchReport(dom.window.document, {
    results: [{ ...mixedResponse.results[2], title, error, pdfUrl: '<b>url</b>' }],
    exportErrors: [],
  });

  assert.match(panel.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(panel.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(panel.querySelector('img'), null);
  assert.equal(panel.querySelector('script'), null);
  assert.equal(panel.querySelector('b'), null);

  panel.querySelector('.gsbd-report-close').click();
  assert.equal(dom.window.document.querySelector('.gsbd-report'), null);
});

test('a new result-page batch removes an old report before waiting for the response', async () => {
  const dom = new JSDOM(await fixture('scholar-results.html'), { url: 'https://scholar.google.com/scholar?q=test' });
  let resolveMessage;
  const response = new Promise(resolve => { resolveMessage = resolve; });
  initializeScholarUi(dom.window.document, { runtime: { sendMessage: () => response } });
  renderBatchReport(dom.window.document, mixedResponse);
  const checkbox = dom.window.document.querySelector('.gsbd-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  dom.window.document.querySelector('.gsbd-run').click();
  await Promise.resolve();
  assert.equal(dom.window.document.querySelector('.gsbd-report'), null);

  resolveMessage({ ok: true, results: [{ ...mixedResponse.results[0], id: checkbox.closest('.gs_r').dataset.gsbdId }] });
  await response;
  await Promise.resolve();
  assert.equal(dom.window.document.querySelectorAll('.gsbd-report').length, 1);
});

test('renders the same batch report on Scholar result and author-profile pages', async () => {
  for (const [name, url, rowSelector] of [
    ['scholar-results.html', 'https://scholar.google.com/scholar?q=test', '.gs_r'],
    ['scholar-profile.html', 'https://scholar.google.com/citations?user=ada', '.gsc_a_tr'],
  ]) {
    const dom = new JSDOM(await fixture(name), { url });
    let message;
    initializeScholarUi(dom.window.document, { runtime: { sendMessage: async value => {
      message = value;
      return { ok: true, results: [{ ...mixedResponse.results[1], id: value.papers[0].id }] };
    } } });
    const checkbox = dom.window.document.querySelector('.gsbd-checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    dom.window.document.querySelector('.gsbd-run').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(message.type, 'RUN_BATCH');
    assert.equal(dom.window.document.querySelector(`${rowSelector} .gsbd-row-status`).textContent, '未找到 PDF');
    assert.equal(dom.window.document.querySelector('.gsbd-report-no_pdf').textContent, '未找到 PDF 1');
  }
});

test('defines dedicated responsive report panel styles', async () => {
  const css = await readFile(new URL('../src/content.css', import.meta.url), 'utf8');

  assert.match(css, /\.gsbd-report\s*\{/);
  assert.match(css, /\.gsbd-report-items/);
  assert.match(css, /@media\s*\(max-width:/);
});
