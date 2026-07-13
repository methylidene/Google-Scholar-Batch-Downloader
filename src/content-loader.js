globalThis.gsbdCreateContentLoader = ({
  chromeApi = globalThis.chrome,
  documentRef = globalThis.document,
  consoleApi = globalThis.console,
  importModule = url => import(url),
} = {}) => async function loadContentModule() {
  try {
    await importModule(chromeApi.runtime.getURL('src/content.js'));
  } catch (error) {
    consoleApi.error('GSBD 内容脚本加载失败', error);
    const diagnostic = documentRef.createElement('div');
    diagnostic.className = 'gsbd-loader-error';
    diagnostic.textContent = `扩展加载失败：${error?.message || String(error)}`;
    diagnostic.style.cssText = 'position:fixed;top:12px;left:50%;z-index:10000;transform:translateX(-50%);padding:12px 16px;color:#8a1c13;background:#fce8e6;border:1px solid #d93025;border-radius:8px';
    documentRef.body.prepend(diagnostic);
  }
};

if (globalThis.chrome?.runtime && globalThis.document) {
  globalThis.gsbdCreateContentLoader()();
}
