import { buildPdfFilename } from './model.js';
import { toBibTeX, toDataUrl, toResultJson, toRis } from './exporters.js';
import { buildZoteroRequest } from './zotero.js';
import { enrichPapersSequentially } from './enrichment.js';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function runWithRetry(task, maxRetries) {
  let retries = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      if (retries >= maxRetries) throw error;
      retries += 1;
    }
  }
}

export function makeBatchFiles(papers, results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `scholar-export-${timestamp}`;
  return [
    { extension: 'ris', filename: `${base}.ris`, url: toDataUrl(toRis(papers), 'application/x-research-info-systems') },
    { extension: 'bib', filename: `${base}.bib`, url: toDataUrl(toBibTeX(papers), 'application/x-bibtex') },
    { extension: 'json', filename: `${base}.json`, url: toDataUrl(toResultJson(papers, results), 'application/json') },
  ];
}

async function download(options, chromeApi = chrome) {
  return chromeApi.downloads.download({ conflictAction: 'uniquify', saveAs: false, ...options });
}

export function normalizeDownloadDelay(value) {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 300 && delay <= 5000 ? delay : 800;
}

function isProfileDetailCandidate(paper) {
  if (!String(paper.id || '').startsWith('gsbd-profile-') || !paper.detailUrl || paper.pdfUrl) return false;
  try {
    const url = new URL(paper.detailUrl);
    return url.protocol === 'https:' && url.hostname === 'scholar.google.com';
  } catch {
    return false;
  }
}

export async function runBatch(papers, chromeApi = chrome, dependencies = {}) {
  const { downloadDelayMs = 800 } = await chromeApi.storage.local.get({ downloadDelayMs: 800 });
  const delay = normalizeDownloadDelay(downloadDelayMs);
  const profileIndexes = papers.flatMap((paper, index) => isProfileDetailCandidate(paper) ? [index] : []);
  const enrichment = await enrichPapersSequentially(profileIndexes.map(index => papers[index]), {
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    delayMs: delay,
    sleep: dependencies.sleep || sleep,
  });
  const batchPapers = [...papers];
  profileIndexes.forEach((paperIndex, enrichmentIndex) => {
    batchPapers[paperIndex] = enrichment.papers[enrichmentIndex];
  });
  const results = [];
  const pdfPapers = batchPapers.filter(paper => paper.pdfUrl);
  let pdfIndex = 0;

  for (const paper of batchPapers) {
    if (!paper.pdfUrl) {
      results.push({ id: paper.id, ok: true, status: 'metadata' });
      continue;
    }

    try {
      const downloadId = await runWithRetry(() => download({
        url: paper.pdfUrl,
        filename: buildPdfFilename(paper),
      }, chromeApi), 1);
      results.push({ id: paper.id, ok: true, status: 'success', downloadId });
    } catch (error) {
      results.push({ id: paper.id, ok: false, status: 'failed', error: error?.message || String(error) });
    }

    pdfIndex += 1;
    if (pdfIndex < pdfPapers.length) await sleep(delay);
  }

  const exportErrors = [];
  for (const file of makeBatchFiles(batchPapers, results)) {
    try {
      await download({ url: file.url, filename: file.filename }, chromeApi);
    } catch (error) {
      exportErrors.push({ extension: file.extension, error: error?.message || String(error) });
    }
  }
  if (exportErrors.length) {
    return {
      ok: false,
      error: `部分导出失败：${exportErrors.map(item => `${item.extension}: ${item.error}`).join('；')}`,
      results,
      exportErrors,
      enrichmentResults: enrichment.results,
      blocked: enrichment.blocked,
      notice: enrichment.blocked ? `Scholar detail lookup stopped because of ${enrichment.blocked === 'captcha' ? 'CAPTCHA' : 'abnormal traffic'}.` : '',
    };
  }
  return {
    ok: true,
    results,
    enrichmentResults: enrichment.results,
    blocked: enrichment.blocked,
    notice: enrichment.blocked ? `Scholar detail lookup stopped because of ${enrichment.blocked === 'captcha' ? 'CAPTCHA' : 'abnormal traffic'}.` : '',
  };
}

export async function sendZotero(papers, fetchImpl = fetch) {
  const { url, options } = buildZoteroRequest(papers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, results: papers.map(paper => ({ id: paper.id, ok: true, status: 'success' })) };
  } catch (error) {
    return {
      ok: false,
      error: '无法连接 Zotero。请确认 Zotero 已启动，或改用已导出的 RIS/BibTeX 文件手动导入。',
      results: papers.map(paper => ({ id: paper.id, ok: false, status: 'failed', error: error?.message || String(error) })),
    };
  } finally {
    clearTimeout(timeout);
  }
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const task = message?.type === 'RUN_BATCH'
      ? runBatch(message.papers || [])
      : message?.type === 'SEND_ZOTERO'
        ? sendZotero(message.papers || [])
        : null;
    if (!task) return false;
    task.then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
}
