import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeScholarUi } from '../src/content.js';

const fixture = name => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

test('stops when result rows exist but a row has no valid title', async () => {
  const dom = new JSDOM('<div class="gs_r gs_or gs_scl"><div class="gs_a">Alice - Journal, 2025</div></div>', {
    url: 'https://scholar.google.com/scholar?q=test',
  });

  const result = initializeScholarUi(dom.window.document, { runtime: { sendMessage: async () => ({ ok: true, results: [] }) } });

  assert.equal(result, false);
  assert.match(dom.window.document.querySelector('.gsbd-stop')?.textContent || '', /页面结构可能已经变化/);
  assert.equal(dom.window.document.querySelector('.gsbd-toolbar'), null);
});

test('renders selected downloading and final row states', async () => {
  const dom = new JSDOM(await fixture('scholar-results.html'), { url: 'https://scholar.google.com/scholar?q=test' });
  let resolveMessage;
  const response = new Promise(resolve => { resolveMessage = resolve; });
  initializeScholarUi(dom.window.document, { runtime: { sendMessage: () => response } });
  const [checkbox, failedCheckbox] = dom.window.document.querySelectorAll('.gsbd-checkbox');
  const rowStatus = checkbox.closest('.gs_r').querySelector('.gsbd-row-status');
  const failedStatus = failedCheckbox.closest('.gs_r').querySelector('.gsbd-row-status');

  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  failedCheckbox.checked = true;
  failedCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(rowStatus.textContent, '已选择');
  assert.equal(failedStatus.textContent, '已选择');

  dom.window.document.querySelector('.gsbd-run').click();
  await Promise.resolve();
  assert.equal(rowStatus.textContent, '下载中');
  assert.equal(failedStatus.textContent, '下载中');

  resolveMessage({ ok: true, results: [
    { id: checkbox.closest('.gs_r').dataset.gsbdId, ok: true, status: 'success' },
    { id: failedCheckbox.closest('.gs_r').dataset.gsbdId, ok: false, status: 'failed', error: 'network' },
  ] });
  await response;
  await Promise.resolve();
  assert.equal(rowStatus.textContent, '下载成功');
  assert.equal(failedStatus.textContent, '下载失败：network');
});
