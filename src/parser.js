import { normalizePaper } from './model.js';

const ROW_SELECTOR = '.gs_r.gs_or.gs_scl';

function resolveUrl(href, document) {
  return href ? new URL(href, document.baseURI).href : '';
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

    const pdfAnchor = row.querySelector('.gs_or_ggsm a')
      || [...row.querySelectorAll('a')].find(anchor => anchor.textContent.trim().toUpperCase() === '[PDF]');

    return normalizePaper({
      id,
      title,
      authors,
      year,
      venue: parts[1] || '',
      snippet: row.querySelector('.gs_rs')?.textContent || '',
      detailUrl: resolveUrl(titleAnchor?.getAttribute('href'), document),
      pdfUrl: resolveUrl(pdfAnchor?.getAttribute('href'), document),
    });
  });
}

export function detectScholarBlock(document) {
  if (document.querySelector('form#gs_captcha_f')) return 'captcha';
  if (!document.querySelector(ROW_SELECTOR)) return 'structure';
  return null;
}
