import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initializeOptionsPage, normalizeDelay } from '../src/options.js';

const markup = `
  <input id="download-delay" type="number" min="300" max="5000">
  <input id="enable-arxiv" type="checkbox">
  <input id="enable-unpaywall" type="checkbox">
  <input id="unpaywall-email" type="email">
  <button id="save" type="button">保存</button>
  <p id="status" role="status"></p>`;

test('loads stored settings using documented defaults', async () => {
  const dom = new JSDOM(markup);
  let defaults;
  const chromeApi = { storage: { local: { get: async value => { defaults = value; return value; } } } };

  await initializeOptionsPage(dom.window.document, chromeApi);

  assert.deepEqual(defaults, { downloadDelayMs: 800, enableArxivFallback: true, enableUnpaywallFallback: true, unpaywallEmail: '' });
  assert.equal(dom.window.document.querySelector('#download-delay').value, '800');
  assert.equal(dom.window.document.querySelector('#enable-arxiv').checked, true);
  assert.equal(dom.window.document.querySelector('#enable-unpaywall').checked, true);
});

test('validates delay boundaries and saves both settings', async () => {
  const dom = new JSDOM(markup);
  const saved = [];
  const chromeApi = { storage: { local: {
    get: async () => ({ downloadDelayMs: 800, enableArxivFallback: true, enableUnpaywallFallback: true, unpaywallEmail: 'old@example.org' }),
    set: async value => saved.push(value),
  } } };
  await initializeOptionsPage(dom.window.document, chromeApi);
  const delay = dom.window.document.querySelector('#download-delay');
  const arxiv = dom.window.document.querySelector('#enable-arxiv');
  const unpaywall = dom.window.document.querySelector('#enable-unpaywall');
  const email = dom.window.document.querySelector('#unpaywall-email');

  delay.value = '299';
  dom.window.document.querySelector('#save').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(saved.length, 0);
  assert.match(dom.window.document.querySelector('#status').textContent, /300.*5000/);

  delay.value = '1200';
  arxiv.checked = false;
  unpaywall.checked = true;
  email.value = 'researcher@example.org';
  dom.window.document.querySelector('#save').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.deepEqual(saved, [{ downloadDelayMs: 1200, enableArxivFallback: false, enableUnpaywallFallback: true, unpaywallEmail: 'researcher@example.org' }]);
  assert.match(dom.window.document.querySelector('#status').textContent, /已保存/);
});

test('normalizes invalid stored delay to the default', () => {
  assert.equal(normalizeDelay('invalid'), 800);
  assert.equal(normalizeDelay(299), 800);
  assert.equal(normalizeDelay(5001), 800);
  assert.equal(normalizeDelay(300), 300);
  assert.equal(normalizeDelay(5000), 5000);
});

test('requires a valid contact email only when Unpaywall is enabled', async () => {
  const dom = new JSDOM(markup);
  const saved = [];
  const chromeApi = { storage: { local: {
    get: async () => ({ downloadDelayMs: 800, enableArxivFallback: true, enableUnpaywallFallback: true, unpaywallEmail: '' }),
    set: async value => saved.push(value),
  } } };
  await initializeOptionsPage(dom.window.document, chromeApi);
  dom.window.document.querySelector('#save').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(saved.length, 0);
  assert.match(dom.window.document.querySelector('#status').textContent, /Unpaywall.*邮箱/);
  dom.window.document.querySelector('#enable-unpaywall').checked = false;
  dom.window.document.querySelector('#save').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(saved.length, 1);
});

test('shows a Chinese error when loading settings fails', async () => {
  const dom = new JSDOM(markup);
  const chromeApi = { storage: { local: { get: async () => { throw new Error('storage offline'); } } } };

  await assert.rejects(initializeOptionsPage(dom.window.document, chromeApi), /storage offline/);
  assert.match(dom.window.document.querySelector('#status').textContent, /读取设置失败/);
});

test('shows a Chinese error when saving settings fails', async () => {
  const dom = new JSDOM(markup);
  const chromeApi = { storage: { local: {
    get: async () => ({ downloadDelayMs: 800, enableArxivFallback: true, enableUnpaywallFallback: false, unpaywallEmail: '' }),
    set: async () => { throw new Error('disk full'); },
  } } };
  await initializeOptionsPage(dom.window.document, chromeApi);

  dom.window.document.querySelector('#save').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.match(dom.window.document.querySelector('#status').textContent, /保存失败.*disk full/);
});
