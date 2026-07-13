# Author profile final review fixes

## Scope

This change addresses the three findings from the final author-profile review without changing the extension's permission model or automatic-loading policy.

## Root causes and fixes

1. `enrichPapersSequentially` checked `response.ok` before reading an HTML response body. Scholar block pages returned with HTTP 429/503 were therefore treated as ordinary failures and processing continued. HTML bodies are now parsed for CAPTCHA/abnormal-traffic markers first; blocked responses stop the sequence immediately, while non-blocked non-2xx responses remain ordinary per-paper failures.
2. `pdfCandidateUrl` required anchor text to equal `[PDF]`. Scholar may append publisher/domain text, including text adjacent after nested markup. The explicit marker check now trims, normalizes case, and accepts text beginning with the complete `[PDF]` token. Existing HTTP(S), `.pdf` path, `[HTML]`, and malformed/non-HTTP rejection tests remain in place.
3. The author profile reused the search-results `PDF only` action before detail enrichment, making it a dead action. It is now hidden on profile pages and remains available on search-result pages. The README describes the profile workflow accurately.

## TDD evidence

- HTTP 429 CAPTCHA and HTTP 503 abnormal-traffic tests were added first and failed because two detail URLs were fetched instead of one. After the response-order fix, the enrichment focused suite passed 10/10.
- Search-result and citation-detail `[PDF]` prefix tests were added first and both failed with empty PDF URLs. After the marker fix, the combined parser/enrichment focused suite passed 18/18.
- The profile/results UI test was added first and failed because the profile button had `hidden === false`. After the UI fix, the combined profile/results focused suite passed 13/13.

## Final verification

- `npm test`: 56 tests passed, 0 failed.
- `node --check` for every `src/*.js`: passed.
- Manifest JSON and constraints: citations match present; `tabs` permission absent.
- `git diff --check`: passed.
- Diff self-review: changes are limited to the reviewed behavior, regression tests, README, and this report. The pre-existing `package-lock.json` working-tree state is intentionally excluded from the commit.
