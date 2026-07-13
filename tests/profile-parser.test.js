import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  getScholarPageType,
  isScholarProfile,
  parseScholarProfile,
} from '../src/parser.js';

const profileHtml = readFileSync(new URL('./fixtures/scholar-profile.html', import.meta.url), 'utf8');
const resultsHtml = readFileSync(new URL('./fixtures/scholar-results.html', import.meta.url), 'utf8');

test('detects Scholar author profiles and distinguishes page types', () => {
  const profile = new JSDOM(profileHtml).window.document;
  const results = new JSDOM(resultsHtml).window.document;
  const unknown = new JSDOM('<main>Not a Scholar paper page</main>').window.document;

  assert.equal(isScholarProfile(profile), true);
  assert.equal(isScholarProfile(results), false);
  assert.equal(getScholarPageType(profile), 'profile');
  assert.equal(getScholarPageType(results), 'results');
  assert.equal(getScholarPageType(unknown), 'unknown');
});

test('parses profile publication rows and normalizes their metadata', () => {
  const dom = new JSDOM(profileHtml, { url: 'https://scholar.google.com/citations?user=ada' });
  const papers = parseScholarProfile(dom.window.document);

  assert.equal(papers.length, 2);
  assert.equal(papers[0].title, 'Analytical Engines');
  assert.deepEqual(papers[0].authors, ['Ada Lovelace', 'Charles Babbage']);
  assert.equal(papers[0].year, '1843');
  assert.equal(papers[0].venue, 'Journal of Computing History');
  assert.equal(
    papers[0].detailUrl,
    'https://scholar.google.com/citations?view_op=view_citation&citation_for_view=ada:one',
  );
  assert.deepEqual(papers[1].authors, ['Ada Lovelace']);
  assert.equal(papers[1].venue, 'Scientific Memoirs');
  assert.notEqual(papers[0].id, papers[1].id);
  assert.equal(dom.window.document.querySelectorAll('.gsc_a_tr[data-gsbd-id]').length, 2);
});
