import { doiCandidateFromText, doiCandidateFromUrl, pdfCandidateUrl } from './parser.js';

const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ''));
}

function anchorsFromHtml(html) {
  const anchors = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (href) anchors.push({ href: decodeHtml(href[1] ?? href[2] ?? href[3]), text: stripTags(match[2]) });
  }
  return anchors;
}

export function parseCitationDetail(html, baseUrl) {
  const source = String(html || '');
  if (/id\s*=\s*["']gs_captcha_f["']/i.test(source)) return { pdfUrl: '', doi: '', blocked: 'captcha' };
  if (/(?:unusual|abnormal) traffic|automated queries|\u5f02\u5e38\u6d41\u91cf/i.test(stripTags(source))) {
    return { pdfUrl: '', doi: '', blocked: 'traffic' };
  }

  const anchors = anchorsFromHtml(source);
  let pdfUrl = '';
  let doi = '';
  for (const anchor of anchors) {
    pdfUrl ||= pdfCandidateUrl(anchor.href, anchor.text, baseUrl);
    doi ||= doiCandidateFromUrl(anchor.href, baseUrl);
  }
  doi ||= doiCandidateFromText(stripTags(source));
  return { pdfUrl, doi, blocked: null };
}

export async function enrichPapersSequentially(papers, {
  fetchImpl = fetch,
  delayMs = 800,
  sleep = defaultSleep,
} = {}) {
  const enriched = [...papers];
  const results = [];
  let blocked = null;

  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index];
    if (!paper.detailUrl || paper.pdfUrl) continue;

    if (results.length) await sleep(delayMs);
    try {
      const response = await fetchImpl(paper.detailUrl);
      if (!response.ok) throw new Error(`HTTP response was not successful`);
      const contentType = response.headers?.get?.('content-type') || '';
      if (!/^text\/html\b/i.test(contentType)) throw new Error(`Expected HTML response, received ${contentType || 'unknown content type'}`);
      const detail = parseCitationDetail(await response.text(), paper.detailUrl);
      if (detail.blocked) {
        blocked = detail.blocked;
        results.push({ id: paper.id, ok: false, status: 'blocked', blocked });
        break;
      }
      enriched[index] = {
        ...paper,
        pdfUrl: paper.pdfUrl || detail.pdfUrl,
        doi: paper.doi || detail.doi,
        status: paper.pdfUrl || detail.pdfUrl ? 'pdf' : paper.status,
      };
      results.push({ id: paper.id, ok: true, status: 'enriched', pdfUrl: detail.pdfUrl, doi: detail.doi });
    } catch (error) {
      results.push({ id: paper.id, ok: false, status: 'failed', error: error?.message || String(error) });
    }
  }

  return { papers: enriched, results, blocked };
}
