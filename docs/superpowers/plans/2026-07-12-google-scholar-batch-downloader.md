# Google Scholar Batch Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unpacked Chrome Manifest V3 extension that selects current-page Google Scholar results, filters them by author, downloads visible open PDFs, exports RIS/BibTeX/JSON, and sends selected metadata to local Zotero with a reliable export fallback.

**Architecture:** A pure local extension uses a content script for Scholar parsing and UI, focused shared modules for normalization/export/Zotero payloads, and a service worker for downloads and local HTTP calls. Node's built-in test runner verifies all pure modules and DOM fixtures through `jsdom`; Chrome manual checks cover browser-only APIs.

**Tech Stack:** Chrome Manifest V3, JavaScript ES modules, HTML/CSS, Node.js 20+, `node:test`, `jsdom`, Chrome `downloads`, `runtime`, and `storage` APIs, Zotero Connector HTTP server at `http://127.0.0.1:23119`.

## Global Constraints

- Process only the current Google Scholar results page; never auto-paginate.
- Never bypass CAPTCHA, paywalls, subscriptions, or institutional authentication.
- Default output includes RIS, BibTeX, and JSON; missing PDFs remain metadata-only records.
- PDF naming is `First author - Year - Title.pdf`, sanitized for Windows and uniquely renamed by Chrome.
- Optional open-access API enrichment remains disabled by default and is not required for v1 acceptance.
- All production JavaScript ships inside the extension; Manifest V3 forbids remotely hosted executable code.

---

## File Structure

- `manifest.json`: Manifest V3 permissions, content script, service worker, and options page.
- `src/model.js`: paper normalization, author matching, and file-name sanitization.
- `src/parser.js`: Google Scholar DOM parsing and CAPTCHA/structure detection.
- `src/exporters.js`: RIS, BibTeX, JSON, and downloadable data-URL generation.
- `src/zotero.js`: Zotero item mapping and local connector request construction.
- `src/content.js`: injected toolbar, row selection, filtering, progress, and messaging.
- `src/content.css`: isolated Scholar toolbar and row-state styling.
- `src/background.js`: batch orchestration, downloads, retry, and Zotero HTTP request.
- `src/options.html`, `src/options.js`: local settings for delay and optional OA lookup flag.
- `tests/*.test.js`, `tests/fixtures/*.html`: pure-unit and fixed-DOM tests.
- `README.md`: installation, usage, permissions, limitations, and Zotero fallback.

### Task 1: Extension shell and paper model

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `src/model.js`
- Create: `tests/model.test.js`

**Interfaces:**
- Produces: `normalizePaper(raw): Paper`, `matchesAuthor(paper, query): boolean`, `buildPdfFilename(paper): string`.
- `Paper` is `{id,title,authors,year,venue,snippet,detailUrl,pdfUrl,doi,status}` with string fields, `authors: string[]`, and status `pdf|metadata`.

- [ ] **Step 1: Add a failing model test**

```js
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
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- tests/model.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/model.js`.

- [ ] **Step 3: Add package, manifest, and minimal model implementation**

```json
{"name":"google-scholar-batch-downloader","private":true,"type":"module","scripts":{"test":"node --test"},"devDependencies":{"jsdom":"^26.1.0"}}
```

Manifest requirements: version `1.0.0`, permissions `downloads` and `storage`, host permissions for `https://scholar.google.com/*`, `https://scholar.googleusercontent.com/*`, and `http://127.0.0.1:23119/*`; register `src/background.js` as the module service worker, `src/content.js` plus `src/content.css` for `https://scholar.google.com/scholar*`, and `src/options.html` as options UI.

```js
export function normalizePaper(raw = {}) {
  const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const authors = Array.isArray(raw.authors) ? raw.authors.map(clean).filter(Boolean) : [];
  const pdfUrl = clean(raw.pdfUrl);
  return { id: clean(raw.id), title: clean(raw.title), authors, year: clean(raw.year), venue: clean(raw.venue), snippet: clean(raw.snippet), detailUrl: clean(raw.detailUrl), pdfUrl, doi: clean(raw.doi), status: pdfUrl ? 'pdf' : 'metadata' };
}
export function matchesAuthor(paper, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  return !needle || paper.authors.some(a => a.toLocaleLowerCase().includes(needle));
}
export function buildPdfFilename(paper) {
  const clean = value => String(value || 'Unknown').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  const stem = `${clean(paper.authors[0])} - ${clean(paper.year)} - ${clean(paper.title)}`.slice(0, 180).trim();
  return `${stem || 'paper'}.pdf`;
}
```

- [ ] **Step 4: Run model tests**

Run: `npm install` then `npm test -- tests/model.test.js`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

Run: `git add manifest.json package.json package-lock.json src/model.js tests/model.test.js && git commit -m "feat: add extension shell and paper model"`.

### Task 2: Scholar DOM parser

**Files:**
- Create: `src/parser.js`
- Create: `tests/parser.test.js`
- Create: `tests/fixtures/scholar-results.html`
- Create: `tests/fixtures/scholar-captcha.html`

**Interfaces:**
- Consumes: `normalizePaper(raw)`.
- Produces: `parseScholarPage(document): Paper[]`, `detectScholarBlock(document): 'captcha'|'structure'|null`.

- [ ] **Step 1: Add fixed HTML and failing parser tests**

The results fixture must contain two `.gs_r.gs_or.gs_scl` rows: one with `.gs_rt a`, `.gs_a`, `.gs_rs`, and `.gs_or_ggsm a[href$=".pdf"]`; one without PDF. The CAPTCHA fixture contains `form#gs_captcha_f`.

```js
test('parses current-page rows', () => {
  const dom = new JSDOM(resultsHtml, { url: 'https://scholar.google.com/scholar?q=test' });
  const papers = parseScholarPage(dom.window.document);
  assert.equal(papers.length, 2);
  assert.deepEqual(papers[0].authors, ['Alice Wang', 'Bob Li']);
  assert.equal(papers[0].year, '2025');
  assert.match(papers[0].pdfUrl, /\.pdf$/);
  assert.equal(papers[1].status, 'metadata');
});
test('detects CAPTCHA', () => {
  const dom = new JSDOM(captchaHtml);
  assert.equal(detectScholarBlock(dom.window.document), 'captcha');
});
```

- [ ] **Step 2: Confirm parser tests fail**

Run: `npm test -- tests/parser.test.js`
Expected: FAIL because `src/parser.js` does not exist.

- [ ] **Step 3: Implement parser with explicit selectors**

Use `.gs_r.gs_or.gs_scl` as the row boundary; strip `[PDF]`/`[HTML]` prefixes from `.gs_rt`; split `.gs_a` metadata at ` - ` and authors at commas; extract the first four-digit year matching `19xx|20xx`; resolve relative links with `new URL(href, document.baseURI)`; recognize PDF from `.gs_or_ggsm a` or anchors whose text equals `[PDF]`; assign `row.dataset.gsbdId`; return `structure` when neither rows nor CAPTCHA are present.

- [ ] **Step 4: Run parser and model tests**

Run: `npm test -- tests/model.test.js tests/parser.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/parser.js tests/parser.test.js tests/fixtures && git commit -m "feat: parse Scholar result pages"`.

### Task 3: RIS, BibTeX, and JSON exporters

**Files:**
- Create: `src/exporters.js`
- Create: `tests/exporters.test.js`

**Interfaces:**
- Produces: `toRis(papers): string`, `toBibTeX(papers): string`, `toResultJson(papers, results): string`, `toDataUrl(text,mime): string`.

- [ ] **Step 1: Write failing export tests**

```js
test('exports every selected paper including metadata-only records', () => {
  const papers = [normalizePaper({id:'p1',title:'Study',authors:['Alice Wang','Bob Li'],year:'2025',venue:'Journal',detailUrl:'https://example.test'})];
  assert.match(toRis(papers), /TY  - JOUR[\s\S]*AU  - Alice Wang[\s\S]*ER  -/);
  assert.match(toBibTeX(papers), /@article\{wang2025study,[\s\S]*author = \{Alice Wang and Bob Li\}/);
  assert.deepEqual(JSON.parse(toResultJson(papers, [{id:'p1',status:'metadata'}])).results[0].status, 'metadata');
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/exporters.test.js`
Expected: FAIL because exporter functions are missing.

- [ ] **Step 3: Implement deterministic exporters**

RIS emits `TY - JOUR`, one `AU` per author, `TI`, optional `PY`, `JO`, `DO`, `UR`, and `ER`. BibTeX creates a lowercase ASCII-safe key from first-author surname, year, and first title word, escapes `{}`, and suffixes duplicate keys with `-2`, `-3`. JSON contains `generatedAt`, `papers`, and `results`. `toDataUrl` returns `data:<mime>;charset=utf-8,${encodeURIComponent(text)}`.

- [ ] **Step 4: Run all unit tests**

Run: `npm test`
Expected: model, parser, and exporter tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/exporters.js tests/exporters.test.js && git commit -m "feat: export RIS BibTeX and result JSON"`.

### Task 4: Zotero local import adapter

**Files:**
- Create: `src/zotero.js`
- Create: `tests/zotero.test.js`

**Interfaces:**
- Produces: `toZoteroItems(papers): ZoteroItem[]`, `buildZoteroRequest(papers): {url,options}`.

- [ ] **Step 1: Write failing Zotero mapping test**

```js
test('maps papers to Zotero saveItems payload', () => {
  const [item] = toZoteroItems([normalizePaper({title:'Study',authors:['Alice Wang'],year:'2025',venue:'Journal',detailUrl:'https://example.test',pdfUrl:'https://example.test/a.pdf'})]);
  assert.equal(item.itemType, 'journalArticle');
  assert.deepEqual(item.creators[0], {creatorType:'author',firstName:'Alice',lastName:'Wang'});
  assert.equal(item.attachments[0].mimeType, 'application/pdf');
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/zotero.test.js`
Expected: FAIL because `src/zotero.js` does not exist.

- [ ] **Step 3: Implement local connector request**

Map normalized papers to Zotero `journalArticle` objects with title, creators, date, publicationTitle, DOI, url, abstractNote, and a PDF attachment only when `pdfUrl` exists. Split creator names at the last space, falling back to single-field `name`. Build a POST to `http://127.0.0.1:23119/connector/saveItems` with JSON body `{items}` and headers `Content-Type: application/json` and `X-Zotero-Connector-API-Version: 3`. Treat local endpoint behavior as best-effort and retain RIS/BibTeX fallback.

- [ ] **Step 4: Run Zotero and full tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/zotero.js tests/zotero.test.js && git commit -m "feat: add Zotero local import adapter"`.

### Task 5: Scholar toolbar and background orchestration

**Files:**
- Create: `src/content.js`
- Create: `src/content.css`
- Create: `src/background.js`
- Create: `tests/background.test.js`

**Interfaces:**
- Content sends `{type:'RUN_BATCH',papers}` and `{type:'SEND_ZOTERO',papers}`.
- Background returns `{ok:true,results}` or `{ok:false,error,results?}`.
- Produces pure `makeBatchFiles(papers,results)` and `runWithRetry(task,maxRetries)` for tests.

- [ ] **Step 1: Add failing background helper tests**

```js
test('retries one failed task once', async () => {
  let calls = 0;
  const value = await runWithRetry(async () => { if (++calls === 1) throw new Error('network'); return 7; }, 1);
  assert.equal(value, 7);
  assert.equal(calls, 2);
});
test('batch files always include ris bib and json', () => {
  assert.deepEqual(makeBatchFiles([], []).map(x => x.extension), ['ris','bib','json']);
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/background.test.js`
Expected: FAIL because background helpers are missing.

- [ ] **Step 3: Implement service worker orchestration**

For `RUN_BATCH`, load `downloadDelayMs` defaulting to `800`; sequentially call `chrome.downloads.download({url:paper.pdfUrl,filename:buildPdfFilename(paper),conflictAction:'uniquify',saveAs:false})`; retry one rejected start; wait the configured delay between PDF starts; record metadata-only items without calling downloads; then download three data URLs named `scholar-export-<ISO-safe timestamp>.ris|bib|json`. For `SEND_ZOTERO`, fetch the request from `buildZoteroRequest`, use a 10-second `AbortController`, and return a Chinese fallback error when Zotero is absent or responds outside 200–299.

- [ ] **Step 4: Implement content UI**

On load: call `detectScholarBlock`; show a Chinese stop message for CAPTCHA/structure; parse rows; add one checkbox per row and a fixed toolbar with author input, 全选, 取消, 仅PDF, 下载并导出, 发送到Zotero, selected count, and progress text. Author input hides nonmatching rows without altering their selection. Buttons send the exact messages above, disable while pending, and render per-row success/failure from returned results. Prefix every CSS class with `gsbd-` and set a high but bounded `z-index`.

- [ ] **Step 5: Run tests and syntax checks**

Run: `npm test` and `node --check src/content.js` and `node --check src/background.js`.
Expected: all tests pass; syntax checks print nothing and exit 0.

- [ ] **Step 6: Commit**

Run: `git add src/content.js src/content.css src/background.js tests/background.test.js && git commit -m "feat: add Scholar batch toolbar and downloads"`.

### Task 6: Settings, documentation, and Chrome acceptance

**Files:**
- Create: `src/options.html`
- Create: `src/options.js`
- Create: `README.md`
- Modify: `manifest.json`

**Interfaces:**
- Storage keys: `downloadDelayMs: number` default `800`; `enableOpenAccessLookup: boolean` default `false`.

- [ ] **Step 1: Implement options page**

Create a Chinese page with a numeric delay input constrained to `300..5000`, an unchecked optional OA lookup checkbox labeled as reserved/experimental, 保存 button, and status region. Load with `chrome.storage.local.get({downloadDelayMs:800,enableOpenAccessLookup:false})`; validate and save with `chrome.storage.local.set`.

- [ ] **Step 2: Write README**

Document: `chrome://extensions` → developer mode → load unpacked; current-page workflow; author filter; default RIS/BibTeX behavior; PDF naming; Zotero desktop/Connector expectation and manual RIS fallback; permissions; no pagination/paywall/CAPTCHA bypass; test commands; troubleshooting when Scholar markup changes.

- [ ] **Step 3: Run automated verification**

Run: `npm test`, `node --check src/options.js`, `node --check src/content.js`, `node --check src/background.js`, and parse `manifest.json` with `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`.
Expected: every test passes, syntax checks exit 0, final command prints `manifest ok`.

- [ ] **Step 4: Perform manual Chrome acceptance**

Load unpacked extension; open a Scholar results page; verify toolbar, author filtering, select-all, PDF-only selection, download naming, three export files, metadata-only records, and one failed PDF not stopping later items. With Zotero running, verify `SEND_ZOTERO`; with Zotero stopped, verify the Chinese RIS/BibTeX fallback error. Open a CAPTCHA fixture/page and verify no requests start.

- [ ] **Step 5: Final commit**

Run: `git add manifest.json src/options.html src/options.js README.md && git commit -m "docs: add settings and installation guide"`.

## Final Verification

- [ ] Run `npm test` and confirm zero failures.
- [ ] Run `git status --short` and confirm no unintended files.
- [ ] Compare every completion criterion in the design spec with Tasks 1–6.
- [ ] Package the project directory as an unpacked extension; do not include `node_modules` in any distributable archive.
