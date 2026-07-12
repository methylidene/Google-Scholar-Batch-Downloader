# Google Scholar Batch Downloader

一个本地运行的 Chrome Manifest V3 扩展，用于在**当前 Google Scholar 结果页**筛选论文、批量下载页面直接提供的公开 PDF，并导出 RIS、BibTeX 和 JSON 元数据。

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目根目录（其中应直接包含 `manifest.json`）。
4. 更新源码后，在扩展卡片上点击“重新加载”，再刷新 Scholar 页面。

## 使用

1. 打开一个 Google Scholar 搜索结果页。扩展只处理当前页，不会自动翻页。
2. 使用工具栏逐项勾选，或使用“全选”“取消”“仅 PDF”。“仅 PDF”只选择页面上已有 PDF 链接的记录。
3. 在作者框输入姓名片段可过滤可见结果；过滤不改变已经勾选的项目。
4. 点击“下载并导出”。公开 PDF 会依次启动下载；没有 PDF 的论文仍作为 metadata-only 记录写入导出文件。
5. 每次批处理默认都会生成 `.ris`、`.bib` 和 `.json` 三个文件。PDF 文件名格式为 `第一作者 - 年份 - 标题.pdf`；Windows 不允许的字符会被清理，重名由 Chrome 自动编号。

下载间隔可在扩展详情的“扩展程序选项”中设置为 300–5000 毫秒（默认 800）。开放获取查询开关是默认关闭的实验性预留功能，当前版本不会因此发起额外查询。

## Zotero

“发送到 Zotero”要求本机 Zotero Desktop 正在运行，并提供 Zotero Connector 的本地接口。此功能是尽力而为的本地导入，不替代常规备份。如果 Zotero 未运行、Connector 接口不可用或导入失败，请使用批处理生成的 RIS（推荐）或 BibTeX 文件，在 Zotero 中选择“文件 → 导入”手工导入。

## 权限说明

- `downloads`：启动 PDF 和 RIS/BibTeX/JSON 文件下载。
- `storage`：在本机保存下载间隔与实验性开关。
- `https://scholar.google.com/*`：解析当前 Scholar 结果页。
- `https://scholar.googleusercontent.com/*`：下载 Scholar 页面提供的公开文件。
- `http://127.0.0.1:23119/*`：与本机 Zotero Connector 通信，不访问远程主机。

## 限制与合规

- 不自动翻页，也不抓取当前页面之外的结果。
- 不绕过 CAPTCHA、付费墙、订阅或机构认证，不尝试获得页面未公开提供的 PDF。
- 遇到 CAPTCHA 或无法识别的 Scholar 页面结构时会停止，不应发起下载请求。
- Google Scholar 的 HTML 结构可能随时改变；批量操作前请检查选择结果，并遵守网站条款及适用法律。

## 开发与测试

需要 Node.js 20+。首次运行执行 `npm install`，自动化检查命令为：

```powershell
npm test
node --check src/options.js
node --check src/content.js
node --check src/background.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

## 故障排查

- 工具栏未出现：确认网址是 `https://scholar.google.com/scholar...`，在 `chrome://extensions` 重新加载扩展并刷新页面。
- 提示页面结构可能已变化：Scholar 标记可能更新。停止批量操作，保留能复现问题的页面结构（注意清除个人信息），运行测试后检查 `src/parser.js` 中的选择器；不要通过放宽 CAPTCHA 检测来规避问题。
- PDF 下载失败：确认结果行确有公开 PDF 链接，并检查 Chrome 下载权限、网络及站点访问权限。单个 PDF 失败不会阻止后续项目和元数据导出。
- Zotero 连接失败：启动 Zotero Desktop，确认 Connector 可用；仍失败时使用已导出的 RIS/BibTeX 手工导入。
