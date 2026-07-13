import { normalizePaper } from './model.js';

const ROW_SELECTOR = '.gs_r.gs_or.gs_scl';
const PROFILE_ROW_SELECTOR = '.gsc_a_tr';

function resolveUrl(href, document) {
  return href ? new URL(href, document.baseURI).href : '';
}

export function pdfCandidateUrl(href, text, baseUrl) {
  let url;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return '';
  }
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  const isExplicitPdf = String(text || '').trim().toUpperCase() === '[PDF]';
  const hasPdfPath = /\.pdf$/i.test(url.pathname);
  return isHttp && (isExplicitPdf || hasPdfPath) ? url.href : '';
}

export function doiCandidateFromUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    if ((url.hostname === 'doi.org' || url.hostname === 'www.doi.org') && /^\/10\.\d{4,9}\//i.test(url.pathname)) {
      return decodeURIComponent(url.pathname.slice(1));
    }
  } catch {
    // Ignore malformed DOI links.
  }
  return '';
}

export function doiCandidateFromText(text) {
  const match = String(text || '').match(/doi\s*:\s*(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i);
  return match ? match[1].replace(/[.,;:]+$/, '') : '';
}

function findPdfUrl(row, document) {
  for (const anchor of row.querySelectorAll('a[href]')) {
    const candidate = pdfCandidateUrl(anchor.getAttribute('href'), anchor.textContent, document.baseURI);
    if (candidate) return candidate;
  }
  return '';
}

function findDoi(row, document) {
  for (const anchor of row.querySelectorAll('a[href]')) {
    const candidate = doiCandidateFromUrl(anchor.getAttribute('href'), document.baseURI);
    if (candidate) return candidate;
  }
  return doiCandidateFromText(row.textContent);
}

export function parseScholarPage(document) {
  return [...document.querySelectorAll(ROW_SELECTOR)].map((row, index) => {
    const id = `gsbd-${index + 1}`;
    row.dataset.gsbdId = id;

    const titleAnchor = row.querySelector('.gs_rt a');
    const titleNode = row.querySelector('.gs_rt');
    const title = (titleNode?.textContent || '').replace(/^\s*\[(?:PDF|HTML)\]\s*/i, '');
    const metadata = row.querySelector('.gs_a')?.textContent || '';
    const parts = metadata.split(' - ').map(part => part.trim());
    const authors = (parts[0] || '').split(',').map(author => author.trim()).filter(Boolean);
    const year = metadata.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';

    return normalizePaper({
      id,
      title,
      authors,
      year,
      venue: parts[1] || '',
      snippet: row.querySelector('.gs_rs')?.textContent || '',
      detailUrl: resolveUrl(titleAnchor?.getAttribute('href'), document),
      pdfUrl: findPdfUrl(row, document),
      doi: findDoi(row, document),
    });
  });
}

export function isScholarProfile(document) {
  return Boolean(document.querySelector('#gsc_prf_in'));
}

export function parseScholarProfile(document) {
  const owner = document.querySelector('#gsc_prf_in')?.textContent || '';

  return [...document.querySelectorAll(PROFILE_ROW_SELECTOR)].map((row, index) => {
    const id = `gsbd-profile-${index + 1}`;
    row.dataset.gsbdId = id;

    const titleAnchor = row.querySelector('.gsc_a_at');
    const metadata = [...row.querySelectorAll('.gs_gray')];
    const authorText = metadata[0]?.textContent.trim() || owner;
    const authors = authorText.split(',').map(author => author.trim()).filter(Boolean);

    return normalizePaper({
      id,
      title: titleAnchor?.textContent || '',
      authors,
      year: row.querySelector('.gsc_a_y span')?.textContent || '',
      venue: metadata[1]?.textContent || '',
      detailUrl: resolveUrl(titleAnchor?.getAttribute('href'), document),
    });
  });
}

export function getScholarPageType(document) {
  if (document.querySelector(ROW_SELECTOR)) return 'results';
  if (isScholarProfile(document)) return 'profile';
  return 'unknown';
}

export function detectScholarBlock(document) {
  if (document.querySelector('form#gs_captcha_f')) return 'captcha';
  const rows = [...document.querySelectorAll(ROW_SELECTOR)];
  if (!rows.length) return 'structure';
  if (rows.some(row => {
    const title = (row.querySelector('.gs_rt')?.textContent || '').replace(/^\s*\[(?:PDF|HTML)\]\s*/i, '').trim();
    return !title;
  })) return 'structure';
  return null;
}
