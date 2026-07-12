import { buildPdfFilename } from './model.js';
import { toBibTeX, toDataUrl, toResultJson, toRis } from './exporters.js';
import { buildZoteroRequest } from './zotero.js';

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

async function download(options) {
  return chrome.downloads.download({ conflictAction: 'uniquify', saveAs: false, ...options });
}

async function runBatch(papers) {
  const { downloadDelayMs = 800 } = await chrome.storage.local.get({ downloadDelayMs: 800 });
  const results = [];
  const pdfPapers = papers.filter(paper => paper.pdfUrl);
  let pdfIndex = 0;

  for (const paper of papers) {
    if (!paper.pdfUrl) {
      results.push({ id: paper.id, ok: true, status: 'metadata' });
      continue;
    }

    try {
      const downloadId = await runWithRetry(() => download({
        url: paper.pdfUrl,
        filename: buildPdfFilename(paper),
      }), 1);
      results.push({ id: paper.id, ok: true, status: 'success', downloadId });
    } catch (error) {
      results.push({ id: paper.id, ok: false, status: 'failed', error: error?.message || String(error) });
    }

    pdfIndex += 1;
    if (pdfIndex < pdfPapers.length) await sleep(Number(downloadDelayMs) || 800);
  }

  for (const file of makeBatchFiles(papers, results)) {
    await download({ url: file.url, filename: file.filename });
  }
  return { ok: true, results };
}

async function sendZotero(papers) {
  const { url, options } = buildZoteroRequest(papers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
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
