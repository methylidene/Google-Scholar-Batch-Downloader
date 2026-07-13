import { normalizePaper } from './model.js';

const ROW_SELECTOR = '.gs_r.gs_or.gs_scl';

function resolveUrl(href, document) {
  return href ? new URL(href, document.baseURI).href : '';
}

function findPdfUrl(row, document) {
  for (const anchor of row.querySelectorAll('a[href]')) {
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), document.baseURI);
    } catch {
      continue;
    }
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
    const isExplicitPdf = anchor.textContent.trim().toUpperCase() === '[PDF]';
    const hasPdfPath = /\.pdf$/i.test(url.pathname);
    if (isHttp && (isExplicitPdf || hasPdfPath)) return url.href;
  }
  return '';
}

function findDoi(row, document) {
  for (const anchor of row.querySelectorAll('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href'), document.baseURI);
      if ((url.hostname === 'doi.org' || url.hostname === 'www.doi.org') && /^\/10\.\d{4,9}\//i.test(url.pathname)) {
        return decodeURIComponent(url.pathname.slice(1));
      }
    } catch {
      // Ignore malformed links and continue with explicit text detection.
    }
  }
  const match = row.textContent.match(/doi\s*:\s*(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i);
  return match ? match[1].replace(/[.,;:]+$/, '') : '';
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
