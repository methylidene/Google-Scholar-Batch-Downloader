import { matchesAuthor } from './model.js';
import {
  detectScholarBlock,
  getScholarPageType,
  parseScholarPage,
  parseScholarProfile,
} from './parser.js';

const RESULTS_ROW_SELECTOR = '.gs_r.gs_or.gs_scl';
const PROFILE_ROW_SELECTOR = '.gsc_a_tr';

function showStopMessage(document, reason) {
  const message = document.createElement('div');
  message.className = 'gsbd-stop';
  message.textContent = reason === 'captcha'
    ? '检测到 Google Scholar 验证码，批量操作已停止。请完成验证后刷新页面。'
    : '无法识别 Google Scholar 结果结构，批量操作已停止。页面结构可能已经变化。';
  document.body.prepend(message);
}

function pageAdapter(document, pageType) {
  if (pageType === 'profile') {
    return {
      rowSelector: PROFILE_ROW_SELECTOR,
      parse: () => parseScholarProfile(document),
      filterLabel: '题目筛选',
      filterPlaceholder: '输入论文题目',
      matchesFilter: (paper, value) => paper.title.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
      initialStatus: paper => paper.pdfUrl ? 'PDF' : '待查询详情',
      pendingStatus: '查询详情',
    };
  }
  return {
    rowSelector: RESULTS_ROW_SELECTOR,
    parse: () => parseScholarPage(document),
    filterLabel: '作者筛选',
    filterPlaceholder: '输入作者名',
    matchesFilter: matchesAuthor,
    initialStatus: paper => paper.pdfUrl ? 'PDF' : '仅元数据',
    pendingStatus: '下载中',
  };
}

export function initializeScholarUi(document, chromeApi = globalThis.chrome, observerFactory) {
  const pageType = getScholarPageType(document);
  if (document.querySelector('form#gs_captcha_f')) {
    showStopMessage(document, 'captcha');
    return false;
  }
  if (pageType === 'unknown' && document.location?.pathname === '/citations') return false;
  const blocked = pageType === 'results'
    ? detectScholarBlock(document)
    : pageType === 'unknown'
      ? 'structure'
      : null;
  if (blocked) {
    showStopMessage(document, blocked);
    return false;
  }

  const adapter = pageAdapter(document, pageType);
  const paperById = new Map();
  const toolbar = document.createElement('div');
  toolbar.className = 'gsbd-toolbar';
  toolbar.innerHTML = `
    <label class="gsbd-filter-label">${adapter.filterLabel}<input class="gsbd-author-input" type="search" placeholder="${adapter.filterPlaceholder}"></label>
    <button class="gsbd-select-all" type="button">全选</button>
    <button class="gsbd-select-none" type="button">取消</button>
    <button class="gsbd-select-pdf" type="button">仅 PDF</button>
    <button class="gsbd-run" type="button">下载并导出</button>
    <button class="gsbd-zotero" type="button">发送到 Zotero</button>
    <span class="gsbd-count">已选 0 篇</span>
    <span class="gsbd-progress" role="status"></span>`;
  document.body.append(toolbar);

  const rowForPaper = paper => document.querySelector(`[data-gsbd-id="${paper.id}"]`);
  const applyCurrentFilter = paper => {
    const value = toolbar.querySelector('.gsbd-author-input').value;
    rowForPaper(paper)?.classList.toggle('gsbd-filtered-out', !adapter.matchesFilter(paper, value));
  };
  const attachControl = paper => {
    const row = rowForPaper(paper);
    if (!row || row.querySelector('.gsbd-row-control')) return;
    const control = document.createElement('label');
    control.className = 'gsbd-row-control';
    control.innerHTML = `<input class="gsbd-checkbox" type="checkbox"> <span class="gsbd-row-status">${adapter.initialStatus(paper)}</span>`;
    (pageType === 'profile' ? row.querySelector('.gsc_a_t') : row).prepend(control);
  };
  const syncPapers = () => {
    for (const paper of adapter.parse()) {
      paperById.set(paper.id, paper);
      attachControl(paper);
      applyCurrentFilter(paper);
    }
  };
  syncPapers();

  const checkboxes = () => [...document.querySelectorAll(`${adapter.rowSelector} .gsbd-checkbox`)];
  const paperForCheckbox = checkbox => paperById.get(checkbox.closest(adapter.rowSelector)?.dataset.gsbdId);
  const selectedPapers = () => checkboxes()
    .filter(checkbox => checkbox.checked)
    .map(paperForCheckbox)
    .filter(Boolean);
  const updateCount = () => {
    toolbar.querySelector('.gsbd-count').textContent = `已选 ${selectedPapers().length} 篇`;
  };
  const renderSelection = checkbox => {
    const paper = paperForCheckbox(checkbox);
    if (!paper) return;
    checkbox.closest(adapter.rowSelector).querySelector('.gsbd-row-status').textContent = checkbox.checked
      ? '已选择'
      : adapter.initialStatus(paper);
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
    toolbar.querySelector('.gsbd-progress').textContent = response?.notice
      || (response?.blocked ? `Scholar detail lookup stopped because of ${response.blocked}.` : '')
      || (response?.ok ? '处理完成' : response?.error || '处理失败');
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
        rowForPaper(paper).querySelector('.gsbd-row-status').textContent = adapter.pendingStatus;
      }
    }
    try {
      renderResults(await chromeApi.runtime.sendMessage({ type, papers: selected }));
    } catch (error) {
      toolbar.querySelector('.gsbd-progress').textContent = `处理失败：${error?.message || String(error)}`;
      for (const paper of selected) {
        const row = rowForPaper(paper);
        row.querySelector('.gsbd-row-status').textContent = `失败：${error?.message || String(error)}`;
        row.classList.add('gsbd-failure');
      }
    } finally {
      for (const button of toolbar.querySelectorAll('button')) button.disabled = false;
    }
  };

  toolbar.querySelector('.gsbd-author-input').addEventListener('input', event => {
    for (const paper of paperById.values()) {
      applyCurrentFilter(paper);
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
    for (const checkbox of checkboxes()) checkbox.checked = Boolean(paperForCheckbox(checkbox)?.pdfUrl);
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

  if (pageType === 'profile') {
    const makeObserver = observerFactory || (handler => new document.defaultView.MutationObserver(handler));
    const observer = makeObserver(mutations => {
      const hasNewProfileRow = mutations.some(mutation => [...mutation.addedNodes].some(node => {
        if (node.nodeType !== 1) return false;
        const rows = node.matches?.(PROFILE_ROW_SELECTOR)
          ? [node]
          : [...(node.querySelectorAll?.(PROFILE_ROW_SELECTOR) || [])];
        return rows.some(row => !row.querySelector('.gsbd-row-control'));
      }));
      if (hasNewProfileRow) syncPapers();
    });
    const publicationList = document.querySelector(PROFILE_ROW_SELECTOR)?.parentElement;
    if (publicationList) observer.observe(publicationList, { childList: true, subtree: true });
  }

  return true;
}

if (typeof document !== 'undefined') {
  const initialize = () => initializeScholarUi(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
