import { matchesAuthor } from './model.js';
import { detectScholarBlock, parseScholarPage } from './parser.js';

const ROW_SELECTOR = '.gs_r.gs_or.gs_scl';

function showStopMessage(document, reason) {
  const message = document.createElement('div');
  message.className = 'gsbd-stop';
  message.textContent = reason === 'captcha'
    ? '检测到 Google Scholar 验证码，批量操作已停止。请完成验证后刷新页面。'
    : '无法识别 Google Scholar 结果结构，批量操作已停止。页面结构可能已经变化。';
  document.body.prepend(message);
}

export function initializeScholarUi(document, chromeApi = globalThis.chrome) {
  const blocked = detectScholarBlock(document);
  if (blocked) {
    showStopMessage(document, blocked);
    return false;
  }

  const papers = parseScholarPage(document);
  const paperById = new Map(papers.map(paper => [paper.id, paper]));
  const toolbar = document.createElement('div');
  toolbar.className = 'gsbd-toolbar';
  toolbar.innerHTML = `
    <label class="gsbd-filter-label">作者筛选 <input class="gsbd-author-input" type="search" placeholder="输入作者名"></label>
    <button class="gsbd-select-all" type="button">全选</button>
    <button class="gsbd-select-none" type="button">取消</button>
    <button class="gsbd-select-pdf" type="button">仅 PDF</button>
    <button class="gsbd-run" type="button">下载并导出</button>
    <button class="gsbd-zotero" type="button">发送到 Zotero</button>
    <span class="gsbd-count">已选 0 篇</span>
    <span class="gsbd-progress" role="status"></span>`;
  document.body.append(toolbar);

  for (const paper of papers) {
    const row = document.querySelector(`[data-gsbd-id="${paper.id}"]`);
    const control = document.createElement('label');
    control.className = 'gsbd-row-control';
    control.innerHTML = `<input class="gsbd-checkbox" type="checkbox"> <span class="gsbd-row-status">${paper.pdfUrl ? 'PDF' : '仅元数据'}</span>`;
    row.prepend(control);
  }

  const checkboxes = () => [...document.querySelectorAll('.gsbd-checkbox')];
  const selectedPapers = () => checkboxes()
    .filter(checkbox => checkbox.checked)
    .map(checkbox => paperById.get(checkbox.closest(ROW_SELECTOR).dataset.gsbdId));
  const updateCount = () => {
    toolbar.querySelector('.gsbd-count').textContent = `已选 ${selectedPapers().length} 篇`;
  };
  const renderSelection = checkbox => {
    const paper = paperById.get(checkbox.closest(ROW_SELECTOR).dataset.gsbdId);
    checkbox.closest(ROW_SELECTOR).querySelector('.gsbd-row-status').textContent = checkbox.checked
      ? '已选择'
      : paper.pdfUrl ? 'PDF' : '仅元数据';
  };
  const updateSelections = () => {
    for (const checkbox of checkboxes()) renderSelection(checkbox);
    updateCount();
  };
  const setBusy = busy => {
    for (const button of toolbar.querySelectorAll('button')) button.disabled = busy;
    toolbar.querySelector('.gsbd-progress').textContent = busy ? '处理中…' : '';
  };
  const renderResults = response => {
    for (const result of response?.results || []) {
      const row = document.querySelector(`[data-gsbd-id="${result.id}"]`);
      const status = row?.querySelector('.gsbd-row-status');
      if (!status) continue;
      status.textContent = result.status === 'metadata' ? '仅元数据' : result.ok ? '成功' : `失败：${result.error || '未知错误'}`;
      row.classList.toggle('gsbd-success', Boolean(result.ok));
      row.classList.toggle('gsbd-failure', !result.ok);
    }
    toolbar.querySelector('.gsbd-progress').textContent = response?.ok ? '处理完成' : response?.error || '处理失败';
  };
  const send = async type => {
    const selected = selectedPapers();
    if (!selected.length) {
      toolbar.querySelector('.gsbd-progress').textContent = '请先选择论文';
      return;
    }
    setBusy(true);
    if (type === 'RUN_BATCH') {
      for (const paper of selected) {
        document.querySelector(`[data-gsbd-id="${paper.id}"] .gsbd-row-status`).textContent = '下载中';
      }
    }
    try {
      renderResults(await chromeApi.runtime.sendMessage({ type, papers: selected }));
    } catch (error) {
      toolbar.querySelector('.gsbd-progress').textContent = `处理失败：${error?.message || String(error)}`;
      for (const paper of selected) {
        const row = document.querySelector(`[data-gsbd-id="${paper.id}"]`);
        row.querySelector('.gsbd-row-status').textContent = `失败：${error?.message || String(error)}`;
        row.classList.add('gsbd-failure');
      }
    } finally {
      for (const button of toolbar.querySelectorAll('button')) button.disabled = false;
    }
  };

  toolbar.querySelector('.gsbd-author-input').addEventListener('input', event => {
    for (const paper of papers) {
      document.querySelector(`[data-gsbd-id="${paper.id}"]`).classList.toggle('gsbd-filtered-out', !matchesAuthor(paper, event.target.value));
    }
  });
  toolbar.querySelector('.gsbd-select-all').addEventListener('click', () => {
    for (const checkbox of checkboxes()) checkbox.checked = true;
    updateSelections();
  });
  toolbar.querySelector('.gsbd-select-none').addEventListener('click', () => {
    for (const checkbox of checkboxes()) checkbox.checked = false;
    updateSelections();
  });
  toolbar.querySelector('.gsbd-select-pdf').addEventListener('click', () => {
    for (const checkbox of checkboxes()) checkbox.checked = Boolean(paperById.get(checkbox.closest(ROW_SELECTOR).dataset.gsbdId).pdfUrl);
    updateSelections();
  });
  document.addEventListener('change', event => {
    if (event.target.classList.contains('gsbd-checkbox')) {
      renderSelection(event.target);
      updateCount();
    }
  });
  toolbar.querySelector('.gsbd-run').addEventListener('click', () => send('RUN_BATCH'));
  toolbar.querySelector('.gsbd-zotero').addEventListener('click', () => send('SEND_ZOTERO'));
  return true;
}

if (typeof document !== 'undefined') {
  const initialize = () => initializeScholarUi(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
