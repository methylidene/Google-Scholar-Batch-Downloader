const DEFAULTS = { downloadDelayMs: 800, enableOpenAccessLookup: false };

export function normalizeDelay(value) {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 300 && delay <= 5000 ? delay : DEFAULTS.downloadDelayMs;
}

export async function initializeOptionsPage(document, chromeApi = chrome) {
  const delayInput = document.querySelector('#download-delay');
  const oaInput = document.querySelector('#enable-oa');
  const saveButton = document.querySelector('#save');
  const status = document.querySelector('#status');
  const settings = await chromeApi.storage.local.get(DEFAULTS);

  delayInput.value = String(normalizeDelay(settings.downloadDelayMs));
  oaInput.checked = settings.enableOpenAccessLookup === true;

  saveButton.addEventListener('click', async () => {
    const delay = Number(delayInput.value);
    if (!Number.isInteger(delay) || delay < 300 || delay > 5000) {
      status.textContent = '下载间隔必须是 300 到 5000 之间的整数。';
      return;
    }

    try {
      await chromeApi.storage.local.set({
        downloadDelayMs: delay,
        enableOpenAccessLookup: oaInput.checked,
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
