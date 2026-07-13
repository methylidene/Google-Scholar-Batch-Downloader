# Scholar Author Profile Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select currently loaded papers on a Google Scholar author profile, enrich selected records from Scholar citation details, and reuse existing PDF download, export, and Zotero flows.

**Architecture:** Add profile parsing behind the existing Paper model, make the content UI page-adaptive, and perform sequential citation-detail enrichment in the service worker before the existing batch downloader.

**Tech Stack:** Chrome Manifest V3, JavaScript ES modules, `node:test`, `jsdom`, Chrome runtime/download/storage APIs.

## Global Constraints

- Only process profile rows already loaded in the DOM; never click “Show more” automatically.
- Observe user-loaded rows and add controls exactly once.
- Fetch citation details sequentially with integer delay 300–5000 ms, default 800 ms.
- Stop remaining detail requests on CAPTCHA/abnormal traffic while retaining completed and metadata-only records.
- Accept only explicit `[PDF]` or HTTP(S) URLs whose pathname ends in `.pdf`.
- Do not add `tabs`, auto-pagination, paywall/CAPTCHA bypass, or remote executable code.

---

### Task 1: Author profile parser

**Files:** Create `tests/fixtures/scholar-profile.html`, `tests/profile-parser.test.js`; modify `src/parser.js`.

**Interfaces:** Produce `isScholarProfile(document)`, `parseScholarProfile(document)`, and `getScholarPageType(document)` returning `results|profile|unknown`.

- [ ] Write failing fixture tests using `.gsc_a_tr`, `.gsc_a_at`, `.gs_gray`, `.gsc_a_y span`, and `#gsc_prf_in`. Assert title, authors, owner fallback, year, venue, absolute detail URL, and unique row ids.
- [ ] Run `npm.cmd test -- tests/profile-parser.test.js`; expect missing exports failure.
- [ ] Implement profile selectors without changing result-page behavior. Resolve links against `document.baseURI` and normalize through `normalizePaper`.
- [ ] Run focused parser tests and full `npm.cmd test`; expect all pass.
- [ ] Commit with `git commit -m "feat: parse Scholar author profiles"`.

### Task 2: Citation detail enrichment

**Files:** Create `src/enrichment.js`, `tests/enrichment.test.js`; modify `src/background.js`, `src/parser.js`, `tests/background.test.js`.

**Interfaces:** Produce `parseCitationDetail(html,baseUrl)` returning `{pdfUrl,doi,blocked}` and `enrichPapersSequentially(papers,{fetchImpl,delayMs,sleep})` returning `{papers,results,blocked}`.

- [ ] Write failing tests for explicit PDF, `.pdf?download=1`, HTML rejection, DOI, CAPTCHA/abnormal traffic, request order, delay, ordinary failure continuation, and blocked response stopping later fetches.
- [ ] Run `npm.cmd test -- tests/enrichment.test.js`; expect missing module failure.
- [ ] Export and reuse PDF/DOI candidate helpers from `parser.js`; do not duplicate rules.
- [ ] Implement sequential enrichment. Require successful HTML responses. Ordinary failures retain metadata and continue; CAPTCHA/abnormal traffic stops.
- [ ] Integrate enrichment before existing `RUN_BATCH` downloads only for profile records with Scholar detail URL and no PDF. Preserve enrichment failures/blocked notice in response. Do not force enrichment for `SEND_ZOTERO`.
- [ ] Run focused enrichment/background tests and the full suite; expect all pass.
- [ ] Commit with `git commit -m "feat: enrich profile papers from citation details"`.

### Task 3: Adaptive profile UI and newly loaded rows

**Files:** Modify `src/content.js`, `src/content.css`, `manifest.json`; create `tests/profile-content.test.js`.

**Interfaces:** `initializeScholarUi(document,chromeApi,observerFactory?)` supports both page types. MutationObserver processes new `.gsc_a_tr` rows exactly once.

- [ ] Write failing tests for profile toolbar, one checkbox per loaded row, title filter, select all/none, `RUN_BATCH` payload, `查询详情` state, newly appended row, and duplicate prevention.
- [ ] Run `npm.cmd test -- tests/profile-content.test.js`; expect current search-only UI failure.
- [ ] Refactor around a page adapter containing row selector, parser, filter field, and pre-download status. Reuse the existing toolbar/message flow.
- [ ] Register MutationObserver only on profiles; attach controls only to rows without `.gsbd-row-control`.
- [ ] Add `https://scholar.google.com/citations*` to content-script matches. Keep existing WAR scope and permissions; do not add `tabs`.
- [ ] Run profile/content tests, full suite, JS syntax checks, and Manifest JSON parse; expect all pass.
- [ ] Commit with `git commit -m "feat: add author profile selection UI"`.

### Task 4: Documentation and regression verification

**Files:** Modify `README.md`, `manifest.json`.

- [ ] Document author-profile URLs, current-loaded-only behavior, manual “Show more”, automatic controls on new rows, sequential detail lookup, CAPTCHA stop, metadata fallback, and extension/page reload steps.
- [ ] Bump Manifest version from `1.0.0` to `1.1.0` without adding permissions.
- [ ] Run `npm.cmd test`, `node --check` for all `src/*.js`, Manifest JSON parse, and `git diff --check`; expect zero failures.
- [ ] Manually verify search results, author profile selection, user-triggered “Show more”, small PDF/metadata batch, blocked fixture, and Zotero running/stopped paths.
- [ ] Commit with `git commit -m "docs: document Scholar profile workflow"`.

## Final Verification

- [ ] Existing 27 tests and all new profile tests pass together.
- [ ] Manifest is `1.1.0` and contains no `tabs` permission.
- [ ] Search-result and author-profile fixtures both pass.
- [ ] Git status contains no unintended files.
