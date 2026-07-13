import { buildPdfFilename } from './model.js';
import { toBibTeX, toCsv, toDataUrl, toResultJson, toRis } from './exporters.js';
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
    { extension: 'csv', filename: `${base}.csv`, url: toDataUrl(toCsv(results), 'text/csv') },
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

const isoNow = now => now().toISOString();

const makeResult = (paper, now) => ({
  id: paper.id,
  title: paper.title || '',
  authors: Array.isArray(paper.authors) ? [...paper.authors] : [],
  year: paper.year || '',
  status: '',
  source: 'scholar',
  pdfUrl: paper.pdfUrl || '',
  filename: paper.pdfUrl ? buildPdfFilename(paper) : '',
  downloadId: null,
  error: '',
  startedAt: isoNow(now),
  finishedAt: '',
  ok: false,
});

export async function downloadPapers(papers, chromeApi = chrome, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const sleepImpl = dependencies.sleep || sleep;
  const timeoutMs = dependencies.timeoutMs ?? 240_000;
  const setTimer = dependencies.setTimeout || globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout || globalThis.clearTimeout;
  const delay = dependencies.downloadDelayMs ?? 800;
  const results = papers.map(paper => makeResult(paper, now));
  const pdfResults = results.filter(result => result.pdfUrl);

  for (const result of results.filter(item => !item.pdfUrl)) {
    result.status = 'no_pdf';
    result.ok = true;
    result.finishedAt = isoNow(now);
  }
  if (!pdfResults.length) return results;

  const downloadEvents = chromeApi.downloads.onChanged;
  if (!downloadEvents?.addListener || !downloadEvents?.removeListener) {
    throw new Error('Chrome downloads.onChanged API 不可用');
  }

  const pendingByDownloadId = new Map();
  let startsFinished = false;
  let timeoutId = null;
  let resolveCompletion;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  const finishIfReady = () => {
    if (startsFinished && pendingByDownloadId.size === 0) resolveCompletion();
  };
  const finishResult = (result, status, error = '') => {
    if (result.status) return;
    result.status = status;
    result.ok = status === 'success' || status === 'no_pdf';
    result.error = error;
    result.finishedAt = isoNow(now);
  };
  const onChanged = delta => {
    const result = pendingByDownloadId.get(delta?.id);
    if (!result) return;
    if (delta.error?.current) result.error = delta.error.current;
    if (delta.state?.current === 'complete') {
      finishResult(result, 'success');
    } else if (delta.state?.current === 'interrupted') {
      finishResult(result, 'failed', result.error || 'Chrome 下载已中断');
    } else {
      return;
    }
    pendingByDownloadId.delete(delta.id);
    finishIfReady();
  };

  downloadEvents.addListener(onChanged);
  try {
    let pdfIndex = 0;
    for (const result of results) {
      if (!result.pdfUrl) continue;
      try {
        result.downloadId = await runWithRetry(() => download({
          url: result.pdfUrl,
          filename: result.filename,
        }, chromeApi), 1);
        pendingByDownloadId.set(result.downloadId, result);
      } catch (error) {
        finishResult(result, 'failed', error?.message || String(error));
      }

      pdfIndex += 1;
      if (pdfIndex < pdfResults.length) await sleepImpl(delay);
    }

    startsFinished = true;
    if (pendingByDownloadId.size === 0) {
      finishIfReady();
    } else {
      timeoutId = setTimer(() => {
        for (const result of pendingByDownloadId.values()) {
          finishResult(result, 'timeout', `等待 Chrome 下载完成超过 ${Math.ceil(timeoutMs / 1000)} 秒`);
        }
        pendingByDownloadId.clear();
        finishIfReady();
      }, timeoutMs);
    }
    await completion;
    return results;
  } finally {
    downloadEvents.removeListener(onChanged);
    if (timeoutId !== null) clearTimer(timeoutId);
    pendingByDownloadId.clear();
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
  const results = await downloadPapers(batchPapers, chromeApi, {
    ...dependencies,
    downloadDelayMs: delay,
  });

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
