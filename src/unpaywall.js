const UNPAYWALL_API = 'https://api.unpaywall.org/v2/';

export function normalizeDoi(value) {
  try {
    return decodeURIComponent(String(value ?? ''))
      .trim()
      .toLocaleLowerCase()
      .replace(/^doi:\s*/, '')
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
      .replace(/[\s.,;]+$/, '');
  } catch {
    return '';
  }
}

export function isValidUnpaywallEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

export function buildUnpaywallApiUrl(doi, email) {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) throw new Error('论文缺少 DOI');
  if (!isValidUnpaywallEmail(email)) throw new Error('Unpaywall 联系邮箱未配置或无效');
  const doiPath = normalizedDoi.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const url = new URL(doiPath, UNPAYWALL_API);
  url.searchParams.set('email', String(email).trim());
  return url.href;
}

const httpsUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
};

export function selectUnpaywallPdf(requestedDoi, record) {
  const doi = normalizeDoi(requestedDoi);
  if (!doi || normalizeDoi(record?.doi) !== doi || record?.is_oa !== true) return null;
  const locations = [record.best_oa_location, ...(Array.isArray(record.oa_locations) ? record.oa_locations : [])]
    .filter(Boolean);
  for (const location of locations) {
    const pdfUrl = httpsUrl(location.url_for_pdf);
    if (!pdfUrl) continue;
    return {
      doi,
      pdfUrl,
      landingUrl: httpsUrl(location.url),
      hostType: String(location.host_type || ''),
      license: String(location.license || ''),
      version: String(location.version || ''),
      repositoryInstitution: String(location.repository_institution || ''),
      oaStatus: String(record.oa_status || ''),
    };
  }
  return null;
}

export async function findUnpaywallMatchesSequentially(papers, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const email = String(options.email || '').trim();
  const results = [];
  for (const paper of papers) {
    const doi = normalizeDoi(paper?.doi);
    if (!doi) {
      results.push({ id: paper?.id, status: 'missing_doi' });
      continue;
    }
    if (!isValidUnpaywallEmail(email)) {
      results.push({ id: paper?.id, status: 'not_configured', error: '请在扩展设置中配置 Unpaywall 联系邮箱' });
      continue;
    }
    try {
      const response = await fetchImpl(buildUnpaywallApiUrl(doi, email), { headers: { Accept: 'application/json' } });
      if (response.status === 404) {
        results.push({ id: paper.id, status: 'not_found' });
        continue;
      }
      if (!response.ok) throw new Error(`Unpaywall API HTTP ${response.status}`);
      const match = selectUnpaywallPdf(doi, await response.json());
      results.push(match ? { id: paper.id, status: 'matched', match } : { id: paper.id, status: 'not_found' });
    } catch (error) {
      results.push({ id: paper?.id, status: 'lookup_failed', error: error?.message || String(error) });
    }
  }
  return results;
}
