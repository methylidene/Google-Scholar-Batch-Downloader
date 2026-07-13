import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('reports content module import failures on the page and console', async () => {
  const source = await readFile(new URL('../src/content-loader.js', import.meta.url), 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context);
  const dom = new JSDOM('<body></body>');
  const errors = [];
  const load = context.globalThis.gsbdCreateContentLoader({
    chromeApi: { runtime: { getURL: value => `chrome-extension://id/${value}` } },
    documentRef: dom.window.document,
    consoleApi: { error: (...args) => errors.push(args) },
    importModule: async () => { throw new Error('module blocked'); },
  });

  await load();

  const diagnostic = dom.window.document.querySelector('.gsbd-loader-error');
  assert.match(diagnostic?.textContent || '', /扩展加载失败/);
  assert.match(diagnostic?.textContent || '', /module blocked/);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][1]), /module blocked/);
});
