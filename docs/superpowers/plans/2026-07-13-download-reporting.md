# Download Reporting Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with test-first changes. Keep each task in its own commit and do not implement backup-source lookup in this version.

**Goal:** Report the actual final outcome of every selected paper after Chrome finishes or interrupts its PDF download, show an in-page batch summary, and automatically export a UTF-8 CSV report.

**Architecture:** Extend the existing exporter with deterministic CSV serialization, add an event-driven PDF outcome tracker around `chrome.downloads.onChanged` in the service worker, return normalized terminal results to the content script, and render those results in a safe DOM-only report panel shared by Scholar result and author-profile pages.

**Tech Stack:** Chrome Manifest V3, JavaScript ES modules, `chrome.downloads`, `node:test`, `jsdom`.

## Global Constraints

- A returned `downloadId` means started, not successful; only `state.current === 'complete'` produces `success`.
- Use exactly four paper statuses: `success`, `no_pdf`, `failed`, and `timeout`.
- Wait at most 240,000 ms for started PDF downloads, with clock/timer dependencies injectable in tests.
- Track only PDF download IDs; ignore export-file download events.
- Keep export/report errors separate from paper outcomes.
- Keep `source: 'scholar'` as a reserved field; do not query or configure backup sites.
- Preserve existing enrichment, CAPTCHA stop, export, Zotero, search-page, and author-profile behavior.
- Use `textContent`/DOM methods for dynamic report data; never interpolate titles, URLs, filenames, or errors into `innerHTML`.
- Do not add permissions, tabs, auto-pagination, paywall/CAPTCHA bypass, or remote executable code.

---

### Task 1: CSV report serialization

**Files:** Modify `src/exporters.js`, `tests/exporters.test.js`.

**Interfaces:** Add `toCsv(results)` returning BOM-prefixed RFC 4180-compatible text. Keep `toDataUrl` as the shared download encoding helper.

- [ ] Add failing tests asserting the exact column order: title, authors, year, status, source, pdfUrl, filename, downloadId, error, startedAt, finishedAt.
- [ ] Add fixtures covering Chinese text, commas, double quotes, CR/LF, empty/null values, multiple authors, numeric download IDs, and UTF-8 BOM (`\uFEFF`).
- [ ] Run `npm.cmd test -- tests/exporters.test.js`; expect the missing `toCsv` export failure.
- [ ] Implement a small CSV cell escaper: stringify nullish values as empty strings, double internal quotes, and quote fields containing comma, quote, CR, or LF.
- [ ] Serialize authors in one cell with a stable separator and terminate rows consistently without mutating the input results.
- [ ] Run the focused exporter tests and `npm.cmd test`; expect all tests to pass.
- [ ] Commit with `git commit -m "feat: export batch results as csv"`.

### Task 2: Track actual Chrome download outcomes

**Files:** Modify `src/background.js`, `tests/background.test.js`.

**Interfaces:** Add an exported outcome-tracking helper with injected timer/clock dependencies, and make `runBatch` return fully populated terminal result records. Extend `makeBatchFiles` to include CSV after JSON.

- [ ] Build a reusable fake `chrome.downloads.onChanged` event in background tests with `addListener`, `removeListener`, and manual `emit` support.
- [ ] Add failing tests proving that a resolved `downloads.download()` call remains pending until its matching `complete` event and that unrelated/export download IDs are ignored.
- [ ] Add tests for `interrupted` plus `error.current`, 240-second timeout, multiple PDFs completing out of order, listener/timer cleanup, and an empty/no-PDF batch that does not wait.
- [ ] Add tests for a PDF start failure followed by one retry, a double start failure that does not stop later papers, and download-delay behavior between PDF starts.
- [ ] Define every result with `id`, `title`, `authors`, `year`, `status`, `source`, `pdfUrl`, `filename`, `downloadId`, `error`, `startedAt`, and `finishedAt`. Keep `ok` for compatibility (`true` for `success`/`no_pdf`, `false` for `failed`/`timeout`), but never use it to calculate report counts.
- [ ] Register the `onChanged` listener before starting PDF downloads. After each successful start, map the returned `downloadId` to its result record; update only matching nonterminal records.
- [ ] Mark missing PDF URLs immediately as `no_pdf`. Mark start failures/interruption as `failed`, unresolved started downloads at the shared deadline as `timeout`, and actual completed downloads as `success`.
- [ ] Record ISO timestamps through an injected/default clock. Set `finishedAt` only on terminal transition and retain the Chrome interruption reason or thrown start error in `error`.
- [ ] Remove the listener and clear the deadline on every completion/error path. Do not allow a late event to mutate a returned result.
- [ ] Generate RIS, BibTeX, JSON, then CSV only after all paper results are terminal. Include `{ extension: 'csv' }` in export error handling and retain `results` in the response if any export fails.
- [ ] Update existing expectations from `metadata` to `no_pdf`, and update test fakes to emit completion for PDF IDs without treating export IDs as paper outcomes.
- [ ] Run `npm.cmd test -- tests/background.test.js tests/exporters.test.js`, then the full suite; expect all tests to pass without real four-minute waits.
- [ ] Commit with `git commit -m "feat: track final pdf download outcomes"`.

### Task 3: In-page summary and detailed report

**Files:** Modify `src/content.js`, `src/content.css`, `tests/content.test.js`, `tests/profile-content.test.js`; create `tests/report-content.test.js` if isolating report rendering keeps fixtures smaller.

**Interfaces:** Add/export a report renderer if useful for focused tests. Render one `.gsbd-report` panel from the terminal `response.results` and `response.exportErrors` returned by `RUN_BATCH`.

- [ ] Add failing jsdom tests for total, success, no-PDF, failed, and timeout counts plus export/report error text.
- [ ] Add a mixed-result detail test asserting title, translated status, filename, source, and failure reason for each selected paper.
- [ ] Add security tests using markup-like title/URL/error strings and assert they appear as text without creating injected elements.
- [ ] Add tests that the close button removes the panel and that starting a new `RUN_BATCH` removes the previous panel before awaiting the response.
- [ ] Add shared tests on both search and profile fixtures so the same report behavior is available on both Scholar page types.
- [ ] Refactor row result rendering to branch on `status`: `success` → “下载成功”, `no_pdf` → “未找到 PDF”, `failed` → reasoned failure, and `timeout` → “下载超时”. Use status rather than `ok` for row classes.
- [ ] Build the report with `createElement`, `textContent`, a summary region, an expandable `<details>` section, one detail row per result, and a “关闭汇报” button.
- [ ] Show export errors separately from paper counts. Preserve enrichment/CAPTCHA notices in the toolbar while still rendering all terminal paper results.
- [ ] Add responsive fixed-panel CSS with bounded height/scrolling, readable status colors, and selectors that do not disturb existing toolbar/profile controls.
- [ ] Run `npm.cmd test -- tests/content.test.js tests/profile-content.test.js tests/report-content.test.js` (omit the last path if tests remain in existing files), then the full suite.
- [ ] Commit with `git commit -m "feat: show batch download report"`.

### Task 4: Documentation, version, and regression verification

**Files:** Modify `README.md`, `manifest.json`; update tests only if they assert the version or documented export list.

- [ ] Update the usage flow to explain that the extension waits for actual Chrome completion, shows a page report, and downloads `.csv` alongside `.ris`, `.bib`, and `.json`.
- [ ] Document the four statuses, four-minute timeout, CSV columns/Excel-compatible UTF-8 encoding, close/new-batch behavior, and the lack of report persistence after refresh.
- [ ] State clearly that configurable backup-source search is deferred and no other site is contacted after a failure in this release.
- [ ] Update troubleshooting for interrupted downloads, timeouts, and CSV/report-file download errors.
- [ ] Bump the Manifest version from `1.1.0` to `1.2.0` without changing permissions or host permissions.
- [ ] Run `npm.cmd test`; expect all tests to pass.
- [ ] Run `Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName }`; expect no syntax errors.
- [ ] Parse `manifest.json` with Node, run `git diff --check`, and confirm `tabs` remains absent.
- [ ] Manually reload the unpacked extension and verify one small mixed batch on a Scholar result page and one on an author profile: actual complete, no PDF, interrupted/failed if safely reproducible, CSV content, panel details, close button, and replacement by a new batch.
- [ ] Commit with `git commit -m "docs: document download reporting"`.

## Final Verification

- [ ] Every selected paper appears exactly once in both `response.results` and CSV.
- [ ] No paper becomes `success` before Chrome emits its matching `complete` event.
- [ ] `interrupted`, start failure, missing PDF, and deadline expiry map to the correct distinct status.
- [ ] Out-of-order and unrelated download events cannot corrupt another result.
- [ ] Event listeners and timers are cleaned up on all paths.
- [ ] Page and CSV counts match for mixed batches; export errors do not alter paper counts.
- [ ] Search-result, author-profile, enrichment, export, and Zotero regression tests all pass.
- [ ] Manifest is `1.2.0`, contains no new permissions, and the repository has no unintended changes.
