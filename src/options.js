const DEFAULTS = { downloadDelayMs: 800, enableArxivFallback: true };

export function normalizeDelay(value) {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 300 && delay <= 5000 ? delay : DEFAULTS.downloadDelayMs;
}

export async function initializeOptionsPage(document, chromeApi = chrome) {
  const delayInput = document.querySelector('#download-delay');
  const arxivInput = document.querySelector('#enable-arxiv');
  const saveButton = document.querySelector('#save');
  const status = document.querySelector('#status');
  let settings;
  try {
    settings = await chromeApi.storage.local.get(DEFAULTS);
  } catch (error) {
    status.textContent = `读取设置失败：${error?.message || String(error)}`;
    throw error;
  }

  delayInput.value = String(normalizeDelay(settings.downloadDelayMs));
  arxivInput.checked = settings.enableArxivFallback !== false;

  saveButton.addEventListener('click', async () => {
    const delay = Number(delayInput.value);
    if (!Number.isInteger(delay) || delay < 300 || delay > 5000) {
      status.textContent = '下载间隔必须是 300 到 5000 之间的整数。';
      return;
    }

    try {
      await chromeApi.storage.local.set({
        downloadDelayMs: delay,
        enableArxivFallback: arxivInput.checked,
      });
      status.textContent = '设置已保存。';
    } catch (error) {
      status.textContent = `保存失败：${error?.message || String(error)}`;
    }
  });
}

if (typeof document !== 'undefined' && globalThis.chrome?.storage?.local) {
  initializeOptionsPage(document).catch(error => {
    const status = document.querySelector('#status');
    if (status) status.textContent = `读取设置失败：${error?.message || String(error)}`;
  });
}
