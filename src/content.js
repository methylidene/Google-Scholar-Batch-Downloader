(() => {
  const ROW_SELECTOR = '.gs_r.gs_or.gs_scl';

  function detectScholarBlock(document) {
    if (document.querySelector('form#gs_captcha_f')) return 'captcha';
    if (!document.querySelector(ROW_SELECTOR)) return 'structure';
    return null;
  }

  function parseScholarPage(document) {
    return [...document.querySelectorAll(ROW_SELECTOR)].map((row, index) => {
      const id = `gsbd-${index + 1}`;
      row.dataset.gsbdId = id;
      const metadata = row.querySelector('.gs_a')?.textContent || '';
      const parts = metadata.split(' - ').map(part => part.trim());
      const pdfAnchor = row.querySelector('.gs_or_ggsm a')
        || [...row.querySelectorAll('a')].find(anchor => anchor.textContent.trim().toUpperCase() === '[PDF]');
      const resolveUrl = anchor => anchor ? new URL(anchor.getAttribute('href'), document.baseURI).href : '';
      return {
        id,
        title: (row.querySelector('.gs_rt')?.textContent || '').replace(/^\s*\[(?:PDF|HTML)\]\s*/i, '').trim(),
        authors: (parts[0] || '').split(',').map(author => author.trim()).filter(Boolean),
        year: metadata.match(/\b(?:19|20)\d{2}\b/)?.[0] || '',
        venue: parts[1] || '',
        snippet: (row.querySelector('.gs_rs')?.textContent || '').trim(),
        detailUrl: resolveUrl(row.querySelector('.gs_rt a')),
        pdfUrl: resolveUrl(pdfAnchor),
        doi: '',
        status: pdfAnchor ? 'pdf' : 'metadata',
      };
    });
  }

  function showStopMessage(reason) {
    const message = document.createElement('div');
    message.className = 'gsbd-stop';
    message.textContent = reason === 'captcha'
      ? '检测到 Google Scholar 验证码，批量操作已停止。请完成验证后刷新页面。'
      : '无法识别 Google Scholar 结果结构，批量操作已停止。页面结构可能已经变化。';
    document.body.prepend(message);
  }

  function initialize() {
    const blocked = detectScholarBlock(document);
    if (blocked) {
      showStopMessage(blocked);
      return;
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
      try {
        renderResults(await chrome.runtime.sendMessage({ type, papers: selected }));
      } catch (error) {
        toolbar.querySelector('.gsbd-progress').textContent = `处理失败：${error?.message || String(error)}`;
      } finally {
        for (const button of toolbar.querySelectorAll('button')) button.disabled = false;
      }
    };

    toolbar.querySelector('.gsbd-author-input').addEventListener('input', event => {
      const query = event.target.value.trim().toLocaleLowerCase();
      for (const paper of papers) {
        const matches = !query || paper.authors.some(author => author.toLocaleLowerCase().includes(query));
        document.querySelector(`[data-gsbd-id="${paper.id}"]`).classList.toggle('gsbd-filtered-out', !matches);
      }
    });
    toolbar.querySelector('.gsbd-select-all').addEventListener('click', () => {
      for (const checkbox of checkboxes()) checkbox.checked = true;
      updateCount();
    });
    toolbar.querySelector('.gsbd-select-none').addEventListener('click', () => {
      for (const checkbox of checkboxes()) checkbox.checked = false;
      updateCount();
    });
    toolbar.querySelector('.gsbd-select-pdf').addEventListener('click', () => {
      for (const checkbox of checkboxes()) checkbox.checked = Boolean(paperById.get(checkbox.closest(ROW_SELECTOR).dataset.gsbdId).pdfUrl);
      updateCount();
    });
    document.addEventListener('change', event => {
      if (event.target.classList.contains('gsbd-checkbox')) updateCount();
    });
    toolbar.querySelector('.gsbd-run').addEventListener('click', () => send('RUN_BATCH'));
    toolbar.querySelector('.gsbd-zotero').addEventListener('click', () => send('SEND_ZOTERO'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
