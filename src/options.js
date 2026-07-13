import { isValidUnpaywallEmail } from './unpaywall.js';

const DEFAULTS = { downloadDelayMs: 800, enableArxivFallback: true, enableUnpaywallFallback: true, unpaywallEmail: '' };

export function normalizeDelay(value) {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 300 && delay <= 5000 ? delay : DEFAULTS.downloadDelayMs;
}

export async function initializeOptionsPage(document, chromeApi = chrome) {
  const delayInput = document.querySelector('#download-delay');
  const arxivInput = document.querySelector('#enable-arxiv');
  const unpaywallInput = document.querySelector('#enable-unpaywall');
  const emailInput = document.querySelector('#unpaywall-email');
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
  unpaywallInput.checked = settings.enableUnpaywallFallback !== false;
  emailInput.value = String(settings.unpaywallEmail || '');

  saveButton.addEventListener('click', async () => {
    const delay = Number(delayInput.value);
    if (!Number.isInteger(delay) || delay < 300 || delay > 5000) {
      status.textContent = '下载间隔必须是 300 到 5000 之间的整数。';
      return;
    }
    const email = emailInput.value.trim();
    if (unpaywallInput.checked && !isValidUnpaywallEmail(email)) {
      status.textContent = '启用 Unpaywall 时必须填写有效的联系邮箱。';
      return;
    }

    try {
      await chromeApi.storage.local.set({
        downloadDelayMs: delay,
        enableArxivFallback: arxivInput.checked,
        enableUnpaywallFallback: unpaywallInput.checked,
        unpaywallEmail: email,
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
