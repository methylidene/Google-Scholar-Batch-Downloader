import { matchesAuthor } from './model.js';
import {
  detectScholarBlock,
  getScholarPageType,
  parseScholarPage,
  parseScholarProfile,
} from './parser.js';

const RESULTS_ROW_SELECTOR = '.gs_r.gs_or.gs_scl';
const PROFILE_ROW_SELECTOR = '.gsc_a_tr';
const REPORT_STATUS = {
  success: { label: '下载成功', countLabel: '成功下载' },
  no_pdf: { label: '未找到 PDF', countLabel: '未找到 PDF' },
  failed: { label: '下载失败', countLabel: '下载失败' },
  timeout: { label: '下载超时', countLabel: '下载超时' },
};
const FALLBACK_STATUS = {
  success: '下载成功',
  not_found: '未找到严格匹配',
  lookup_failed: '检索失败',
  missing_doi: '缺少 DOI',
  not_configured: '未配置联系邮箱',
  failed: '下载失败',
  timeout: '下载超时',
  not_needed: '未触发',
};

function appendReportField(document, parent, label, value) {
  const line = document.createElement('p');
  const name = document.createElement('strong');
  const text = document.createElement('span');
  name.textContent = `${label}：`;
  text.textContent = String(value ?? '');
  line.append(name, text);
  parent.append(line);
}

export function renderBatchReport(document, response = {}) {
  document.querySelector('.gsbd-report')?.remove();
  const results = Array.isArray(response.results) ? response.results : [];
  const exportErrors = Array.isArray(response.exportErrors) ? response.exportErrors : [];
  const counts = Object.fromEntries(Object.keys(REPORT_STATUS).map(status => [
    status,
    results.filter(result => result.status === status).length,
  ]));
  const panel = document.createElement('aside');
  panel.className = 'gsbd-report';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', '下载汇报');

  const header = document.createElement('div');
  header.className = 'gsbd-report-header';
  const heading = document.createElement('h2');
  heading.textContent = '下载汇报';
  const close = document.createElement('button');
  close.className = 'gsbd-report-close';
  close.type = 'button';
  close.textContent = '关闭汇报';
  close.addEventListener('click', () => panel.remove());
  header.append(heading, close);
  panel.append(header);

  const summary = document.createElement('div');
  summary.className = 'gsbd-report-summary';
  const total = document.createElement('span');
  total.className = 'gsbd-report-total';
  total.textContent = `总数 ${results.length}`;
  summary.append(total);
  for (const [status, metadata] of Object.entries(REPORT_STATUS)) {
    const item = document.createElement('span');
    item.className = `gsbd-report-${status}`;
    item.textContent = `${metadata.countLabel} ${counts[status]}`;
    summary.append(item);
  }
  const exportCount = document.createElement('span');
  exportCount.className = 'gsbd-report-export-count';
  exportCount.textContent = `导出错误 ${exportErrors.length}`;
  summary.append(exportCount);
  const arxivSuccess = document.createElement('span');
  arxivSuccess.className = 'gsbd-report-arxiv-success';
  arxivSuccess.textContent = `arXiv 成功 ${results.filter(result => result.source === 'arxiv' && result.status === 'success').length}`;
  summary.append(arxivSuccess);
  const unpaywallSuccess = document.createElement('span');
  unpaywallSuccess.className = 'gsbd-report-unpaywall-success';
  unpaywallSuccess.textContent = `Unpaywall 成功 ${results.filter(result => result.source === 'unpaywall' && result.status === 'success').length}`;
  summary.append(unpaywallSuccess);
  panel.append(summary);

  if (exportErrors.length) {
    const errors = document.createElement('div');
    errors.className = 'gsbd-report-export-errors';
    const label = document.createElement('strong');
    label.textContent = '导出/报告文件错误';
    errors.append(label);
    for (const error of exportErrors) {
      const line = document.createElement('p');
      line.textContent = `${error.extension || '文件'}：${error.error || '未知错误'}`;
      errors.append(line);
    }
    panel.append(errors);
  }

  const details = document.createElement('details');
  const detailsLabel = document.createElement('summary');
  detailsLabel.textContent = '逐篇明细';
  const items = document.createElement('div');
  items.className = 'gsbd-report-items';
  for (const result of results) {
    const item = document.createElement('article');
    item.className = 'gsbd-report-item';
    item.dataset.status = result.status || '';
    const title = document.createElement('h3');
    title.textContent = result.title || '未命名论文';
    item.append(title);
    appendReportField(document, item, '状态', REPORT_STATUS[result.status]?.label || result.status || '未知');
    appendReportField(document, item, '文件名', result.filename || '—');
    appendReportField(document, item, '来源', result.source || 'scholar');
    if (result.scholarStatus) {
      appendReportField(document, item, 'Scholar 结果', REPORT_STATUS[result.scholarStatus]?.label || result.scholarStatus);
    }
    if (result.fallbackStatus && result.fallbackStatus !== 'not_needed') {
      appendReportField(document, item, 'arXiv 结果', FALLBACK_STATUS[result.fallbackStatus] || result.fallbackStatus);
    }
    if (result.arxivId) appendReportField(document, item, 'arXiv ID', result.arxivId);
    if (result.pdfUrl) appendReportField(document, item, 'PDF URL', result.pdfUrl);
    if (result.error) appendReportField(document, item, '原因', result.error);
    if (result.fallbackError && result.fallbackError !== result.error) {
      appendReportField(document, item, 'arXiv 原因', result.fallbackError);
    }
    if (result.unpaywallStatus && result.unpaywallStatus !== 'not_needed') {
      appendReportField(document, item, 'Unpaywall 结果', FALLBACK_STATUS[result.unpaywallStatus] || result.unpaywallStatus);
    }
    if (result.unpaywallDoi) appendReportField(document, item, 'Unpaywall DOI', result.unpaywallDoi);
    if (result.unpaywallHostType) appendReportField(document, item, 'OA 来源类型', result.unpaywallHostType);
    if (result.unpaywallRepository) appendReportField(document, item, 'OA 仓储机构', result.unpaywallRepository);
    if (result.unpaywallLicense) appendReportField(document, item, 'OA 许可', result.unpaywallLicense);
    if (result.unpaywallVersion) appendReportField(document, item, 'OA 版本', result.unpaywallVersion);
    if (result.unpaywallOaStatus) appendReportField(document, item, 'OA 状态', result.unpaywallOaStatus);
    if (result.unpaywallError && result.unpaywallError !== result.error) {
      appendReportField(document, item, 'Unpaywall 原因', result.unpaywallError);
    }
    items.append(item);
  }
  details.append(detailsLabel, items);
  panel.append(details);
  document.body.append(panel);
  return panel;
}

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
  toolbar.querySelector('.gsbd-select-pdf').hidden = pageType === 'profile';
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
      const baseLabel = REPORT_STATUS[result.status]?.label || (result.ok ? '处理完成' : '处理失败');
      const sourceLabel = result.source === 'arxiv' ? 'arXiv' : result.source === 'unpaywall' ? 'Unpaywall' : '';
      const label = sourceLabel ? `${baseLabel}（${sourceLabel}）` : baseLabel;
      status.textContent = result.error && (result.status === 'failed' || result.status === 'timeout')
        ? `${label}：${result.error}`
        : label;
      row.classList.toggle('gsbd-success', result.status === 'success');
      row.classList.toggle('gsbd-failure', result.status === 'failed' || result.status === 'timeout');
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
      document.querySelector('.gsbd-report')?.remove();
      for (const paper of selected) {
        rowForPaper(paper).querySelector('.gsbd-row-status').textContent = adapter.pendingStatus;
      }
    }
    try {
      const response = await chromeApi.runtime.sendMessage({ type, papers: selected });
      renderResults(response);
      if (type === 'RUN_BATCH') renderBatchReport(document, response);
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
