const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

const decodeXml = value => String(value ?? '').replace(
  /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
  (entity, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[code.toLowerCase()]) return named[code.toLowerCase()];
    const point = code.toLowerCase().startsWith('#x')
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  },
);

const textOf = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
};

const attributesOf = xml => Object.fromEntries(
  [...xml.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1], decodeXml(match[3])]),
);

const officialArxivUrl = (value, pathPrefix) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && url.hostname === 'arxiv.org'
      && url.pathname.startsWith(pathPrefix)
      ? url
      : null;
  } catch {
    return null;
  }
};

const arxivIdFromEntry = entry => {
  const idUrl = officialArxivUrl(textOf(entry, 'id'), '/abs/');
  const arxivId = idUrl?.pathname.slice('/abs/'.length) || '';
  return arxivId && !arxivId.includes('..') && /^[A-Za-z0-9._/-]+$/.test(arxivId) ? arxivId : '';
};

export function buildArxivQueryUrl(paper) {
  const title = String(paper?.title || '').replace(/["']/g, ' ').replace(/\s+/g, ' ').trim();
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set('search_query', `ti:"${title}"`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', '5');
  url.searchParams.set('sortBy', 'relevance');
  url.searchParams.set('sortOrder', 'descending');
  return url.href;
}

export function parseArxivFeed(xml) {
  const entries = String(xml ?? '').match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  return entries.flatMap(entry => {
    const arxivId = arxivIdFromEntry(entry);
    const links = [...entry.matchAll(/<link\b[^>]*\/?\s*>/gi)].map(match => attributesOf(match[0]));
    const pdfLink = links.find(link => link.title === 'pdf' && link.type === 'application/pdf');
    if (!arxivId || !officialArxivUrl(pdfLink?.href, '/pdf/')) return [];
    const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)]
      .map(match => textOf(match[1], 'name'))
      .filter(Boolean);
    return [{
      arxivId,
      title: textOf(entry, 'title'),
      authors,
      doi: textOf(entry, 'arxiv:doi'),
      abstractUrl: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    }];
  });
}

const normalizeDoi = value => decodeURIComponent(String(value ?? ''))
  .trim()
  .toLocaleLowerCase()
  .replace(/^doi:\s*/, '')
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
  .replace(/[\s.,;]+$/, '');

const normalizeTitle = value => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\p{P}\p{S}\s]+/gu, '');

export function selectArxivMatch(paper, candidates) {
  const doi = normalizeDoi(paper?.doi);
  if (doi) {
    const doiMatch = candidates.find(candidate => normalizeDoi(candidate.doi) === doi);
    if (doiMatch) return doiMatch;
  }
  const title = normalizeTitle(paper?.title);
  return title ? candidates.find(candidate => normalizeTitle(candidate.title) === title) || null : null;
}

export async function findArxivMatchesSequentially(papers, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const delayMs = Math.max(3000, Number(options.delayMs) || 3000);
  const results = [];

  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index];
    try {
      if (!String(paper?.title || '').trim()) throw new Error('论文标题为空');
      const response = await fetchImpl(buildArxivQueryUrl(paper), {
        headers: { Accept: 'application/atom+xml' },
      });
      if (!response.ok) throw new Error(`arXiv API HTTP ${response.status}`);
      const match = selectArxivMatch(paper, parseArxivFeed(await response.text()));
      results.push(match
        ? { id: paper.id, status: 'matched', match }
        : { id: paper.id, status: 'not_found' });
    } catch (error) {
      results.push({
        id: paper?.id,
        status: 'lookup_failed',
        error: error?.message || String(error),
      });
    }
    if (index < papers.length - 1) await sleep(delayMs);
  }
  return results;
}
