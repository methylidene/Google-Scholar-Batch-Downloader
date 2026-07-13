import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeScholarUi } from '../src/content.js';

const fixture = name => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

async function makeProfile(sendMessage = async () => ({ ok: true, results: [] }), observerFactory) {
  const dom = new JSDOM(await fixture('scholar-profile.html'), {
    url: 'https://scholar.google.com/citations?user=ada',
  });
  const initialized = initializeScholarUi(
    dom.window.document,
    { runtime: { sendMessage } },
    observerFactory,
  );
  return { dom, document: dom.window.document, initialized };
}

test('renders profile controls and filters rows by publication title', async () => {
  const { dom, document, initialized } = await makeProfile();

  assert.equal(initialized, true);
  assert.equal(document.querySelectorAll('.gsbd-toolbar').length, 1);
  assert.equal(document.querySelectorAll('.gsc_a_tr .gsbd-row-control').length, 2);
  assert.equal(document.querySelectorAll('.gsc_a_tr .gsbd-checkbox').length, 2);
  assert.equal(document.querySelectorAll('.gsc_a_tr .gsc_a_t > .gsbd-row-control').length, 2);
  assert.match(document.querySelector('.gsbd-filter-label').textContent, /题目筛选/);

  const input = document.querySelector('.gsbd-author-input');
  input.value = 'notes';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const rows = [...document.querySelectorAll('.gsc_a_tr')];
  assert.equal(rows[0].classList.contains('gsbd-filtered-out'), true);
  assert.equal(rows[1].classList.contains('gsbd-filtered-out'), false);
});

test('ignores non-profile Scholar citations routes without showing a structure error', () => {
  const dom = new JSDOM('<main>Scholar author search</main>', {
    url: 'https://scholar.google.com/citations?view_op=search_authors',
  });

  const initialized = initializeScholarUi(dom.window.document, {
    runtime: { sendMessage: async () => ({ ok: true, results: [] }) },
  });

  assert.equal(initialized, false);
  assert.equal(dom.window.document.querySelector('.gsbd-stop'), null);
  assert.equal(dom.window.document.querySelector('.gsbd-toolbar'), null);
});

test('shows a stop message for CAPTCHA on an otherwise unknown citations route', () => {
  const dom = new JSDOM('<form id="gs_captcha_f"></form>', {
    url: 'https://scholar.google.com/citations?view_op=search_authors',
  });

  const initialized = initializeScholarUi(dom.window.document, {
    runtime: { sendMessage: async () => ({ ok: true, results: [] }) },
  });

  assert.equal(initialized, false);
  assert.match(dom.window.document.querySelector('.gsbd-stop')?.textContent || '', /验证码/);
  assert.equal(dom.window.document.querySelector('.gsbd-toolbar'), null);
});

test('select all and none operate on profile rows', async () => {
  const { document } = await makeProfile();

  document.querySelector('.gsbd-select-all').click();
  assert.deepEqual(
    [...document.querySelectorAll('.gsbd-checkbox')].map(checkbox => checkbox.checked),
    [true, true],
  );
  assert.match(document.querySelector('.gsbd-count').textContent, /2/);

  document.querySelector('.gsbd-select-none').click();
  assert.deepEqual(
    [...document.querySelectorAll('.gsbd-checkbox')].map(checkbox => checkbox.checked),
    [false, false],
  );
  assert.match(document.querySelector('.gsbd-count').textContent, /0/);
});

test('hides the PDF-only action on profiles while keeping it on result pages', async () => {
  const { document: profileDocument } = await makeProfile();
  assert.equal(profileDocument.querySelector('.gsbd-select-pdf').hidden, true);

  const resultsDom = new JSDOM(await fixture('scholar-results.html'), {
    url: 'https://scholar.google.com/scholar?q=test',
  });
  initializeScholarUi(resultsDom.window.document, {
    runtime: { sendMessage: async () => ({ ok: true, results: [] }) },
  });

  assert.equal(resultsDom.window.document.querySelector('.gsbd-select-pdf').hidden, false);
});

test('sends selected profile papers and marks them as looking up details', async () => {
  let message;
  let resolveMessage;
  const response = new Promise(resolve => { resolveMessage = resolve; });
  const { document } = await makeProfile(value => {
    message = value;
    return response;
  });
  const checkbox = document.querySelector('.gsbd-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

  document.querySelector('.gsbd-run').click();
  await Promise.resolve();

  assert.equal(message.type, 'RUN_BATCH');
  assert.equal(message.papers.length, 1);
  assert.equal(message.papers[0].title, 'Analytical Engines');
  assert.equal(checkbox.closest('.gsc_a_tr').querySelector('.gsbd-row-status').textContent, '查询详情');

  resolveMessage({ ok: true, results: [{ id: message.papers[0].id, ok: true, status: 'no_pdf' }] });
  await response;
});

test('shows a blocked detail lookup notice instead of a completed message', async () => {
  const { document } = await makeProfile(async () => ({
    ok: true,
    blocked: 'captcha',
    notice: 'Scholar detail lookup stopped because of CAPTCHA.',
    results: [],
  }));
  const checkbox = document.querySelector('.gsbd-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

  document.querySelector('.gsbd-run').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(
    document.querySelector('.gsbd-progress').textContent,
    'Scholar detail lookup stopped because of CAPTCHA.',
  );
  assert.notEqual(document.querySelector('.gsbd-progress').textContent, '处理完成');
});

test('observes profile publication list and initializes each appended row once', async () => {
  let callback;
  let observedTarget;
  let observedOptions;
  const observerFactory = handler => ({
    observe(target, options) {
      callback = handler;
      observedTarget = target;
      observedOptions = options;
    },
  });
  const { document } = await makeProfile(undefined, observerFactory);
  const tbody = document.querySelector('.gsc_a_tr').parentElement;

  assert.equal(observedTarget, tbody);
  assert.deepEqual(observedOptions, { childList: true, subtree: true });

  const row = document.createElement('tr');
  row.className = 'gsc_a_tr';
  row.innerHTML = `
    <td class="gsc_a_t">
      <a class="gsc_a_at" href="/citations?view_op=view_citation&citation_for_view=ada:three">New Paper</a>
      <div class="gs_gray">Ada Lovelace</div><div class="gs_gray">New Journal</div>
    </td>
    <td class="gsc_a_y"><span>1844</span></td>`;
  tbody.append(row);
  callback([{ addedNodes: [row] }]);
  callback([{ addedNodes: [row] }]);

  assert.equal(row.querySelectorAll('.gsbd-row-control').length, 1);
  assert.equal(document.querySelectorAll('.gsc_a_tr .gsbd-row-control').length, 3);
  document.querySelector('.gsbd-select-all').click();
  assert.equal(row.querySelector('.gsbd-checkbox').checked, true);
});

test('applies the active title filter to newly appended profile rows', async () => {
  let callback;
  const { dom, document } = await makeProfile(undefined, handler => ({
    observe() { callback = handler; },
  }));
  const input = document.querySelector('.gsbd-author-input');
  input.value = 'notes';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const row = document.createElement('tr');
  row.className = 'gsc_a_tr';
  row.innerHTML = `
    <td class="gsc_a_t">
      <a class="gsc_a_at" href="/citations?view_op=view_citation&citation_for_view=ada:new">Unmatched Paper</a>
      <div class="gs_gray">Ada Lovelace</div><div class="gs_gray">New Journal</div>
    </td>
    <td class="gsc_a_y"><span>1844</span></td>`;
  document.querySelector('.gsc_a_tr').parentElement.append(row);
  callback([{ addedNodes: [row] }]);

  assert.equal(row.classList.contains('gsbd-filtered-out'), true);
});

test('manifest enables profile pages without adding tabs permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.version, '1.4.0');
  assert.equal(manifest.content_scripts[0].matches.includes('https://scholar.google.com/citations*'), true);
  assert.equal(manifest.host_permissions.includes('https://export.arxiv.org/*'), true);
  assert.equal(manifest.host_permissions.includes('https://arxiv.org/*'), true);
  assert.equal(manifest.host_permissions.includes('https://api.unpaywall.org/*'), true);
  assert.equal(manifest.permissions.includes('tabs'), false);
});

test('profile rows have dedicated control layout styles', async () => {
  const css = await readFile(new URL('../src/content.css', import.meta.url), 'utf8');

  assert.match(css, /\.gsc_a_tr\s+\.gsbd-row-control/);
});
