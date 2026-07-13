# Google Scholar Batch Downloader

一个本地运行的 Chrome Manifest V3 扩展，用于在**当前 Google Scholar 搜索结果页或作者主页**选择论文、批量下载可用的公开 PDF，并导出 RIS、BibTeX 和 JSON 元数据。

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目根目录（其中应直接包含 `manifest.json`）。
4. 更新源码后，在扩展卡片上点击“重新加载”，再刷新已经打开的 Scholar 页面；只重新加载扩展而不刷新页面，不会更新页面中的工具栏。

## 搜索结果页

1. 打开一个 Google Scholar 搜索结果页。扩展只处理当前页，不会自动翻页。
2. 使用工具栏逐项勾选，或使用“全选”“取消”“仅 PDF”。“仅 PDF”只选择页面上已有 PDF 链接的记录。
3. 在作者框输入姓名片段可过滤可见结果；过滤不改变已经勾选的项目。
4. 点击“下载并导出”。公开 PDF 会依次启动下载；没有 PDF 的论文仍作为 metadata-only 记录写入导出文件。
5. 每次批处理默认都会生成 `.ris`、`.bib` 和 `.json` 三个文件。PDF 文件名格式为 `第一作者 - 年份 - 标题.pdf`；Windows 不允许的字符会被清理，重名由 Chrome 自动编号。

下载间隔可在扩展详情的“扩展程序选项”中设置为 300–5000 毫秒（默认 800）。开放获取查询开关是默认关闭的实验性预留功能，当前版本不会因此发起额外查询。

## 作者主页

1. 打开 `https://scholar.google.com/citations?user=...` 形式的作者主页。扩展只处理页面中**当前已经加载**的论文，不会自动展开完整列表。
2. 如果需要更多论文，请手动点击 Scholar 的“显示更多”（Show more）。新加载的论文行会自动出现复选框和状态，无需再次刷新页面。
3. 使用“题目筛选”查找当前已加载的论文，并通过逐项勾选、“全选”或“取消”管理选择。作者主页不会显示搜索结果页专用的“仅 PDF”按钮，因为论文详情尚未读取；这些条目会显示“待查询详情”。
4. 点击“下载并导出”后，扩展会按照设置的下载间隔，逐篇、顺序读取所选论文的 Scholar 详情页，并只接受其中明确提供的公开 PDF。该过程不会并发打开标签页；找到 PDF 后会在本批次中下载，找不到时仍导出元数据。
5. 如果某篇论文没有公开 PDF 或详情读取失败，它仍会作为 metadata-only（仅元数据）记录写入 RIS、BibTeX 和 JSON；单篇失败不会丢失整批导出。
6. 如果某个详情页出现 CAPTCHA 或异常流量提示，扩展会立即停止剩余详情查询，但仍会下载此前已经找到或条目原本已有的公开 PDF，并继续生成包含全部所选条目的元数据导出；请完成验证或稍后再试，不要尝试绕过限制。

作者主页上的“发送到 Zotero”与搜索结果页相同，会发送当前页面解析到的所选条目。由“下载并导出”执行的详情补全只用于该批次的 PDF 下载与 RIS/BibTeX/JSON 导出，不会回写页面数据，也不会改变随后“发送到 Zotero”的内容；如果需要把本批补全后的书目信息导入 Zotero，请导入该批生成的 RIS（推荐）或 BibTeX 文件。

## Zotero

“发送到 Zotero”要求本机 Zotero Desktop 正在运行，并提供 Zotero Connector 的本地接口。此功能是尽力而为的本地导入，不替代常规备份。如果 Zotero 未运行、Connector 接口不可用或导入失败，请使用批处理生成的 RIS（推荐）或 BibTeX 文件，在 Zotero 中选择“文件 → 导入”手工导入。

## 权限说明

- `downloads`：启动 PDF 和 RIS/BibTeX/JSON 文件下载。
- `storage`：在本机保存下载间隔与实验性开关。
- `https://scholar.google.com/*`：解析当前 Scholar 搜索结果页、作者主页及所选论文的详情页。
- `https://scholar.googleusercontent.com/*`：下载 Scholar 页面提供的公开文件。
- `http://127.0.0.1:23119/*`：与本机 Zotero Connector 通信，不访问远程主机。

## 限制与合规

- 不自动翻页，也不自动点击作者主页的“显示更多”；仅处理用户当前已加载并选择的条目。
- 不绕过 CAPTCHA、付费墙、订阅或机构认证，不尝试获得页面未公开提供的 PDF。
- 如果入口搜索结果页或作者主页已经显示 CAPTCHA，扩展不会启动批处理，也不会发起下载请求。
- 如果顺序读取论文详情时才遇到 CAPTCHA 或异常流量，扩展会停止剩余详情查询，但保留此前已找到或条目原有的 PDF 下载，并继续导出全部所选条目的元数据。
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

- 工具栏未出现：确认网址是 `https://scholar.google.com/scholar...` 或带 `user` 参数的 `https://scholar.google.com/citations...`；在 `chrome://extensions` 重新加载扩展，然后刷新 Scholar 页面。
- 作者主页新增论文没有控件：确认是手动点击“显示更多”后加载的论文；若控件仍未出现，请重新加载扩展并刷新作者主页，再次手动点击“显示更多”。
- 作者主页批处理提前停止：检查页面提示是否为 CAPTCHA 或异常流量。入口页出现 CAPTCHA 时不会启动批处理；详情查询途中出现时不会继续查询剩余详情，但此前已找到或条目原有的 PDF 仍会下载，全部所选条目仍会导出。请完成验证或稍后缩小批次重试。
- 提示页面结构可能已变化：Scholar 标记可能更新。停止批量操作，保留能复现问题的页面结构（注意清除个人信息），运行测试后检查 `src/parser.js` 中的选择器；不要通过放宽 CAPTCHA 检测来规避问题。
- PDF 下载失败：确认结果行确有公开 PDF 链接，并检查 Chrome 下载权限、网络及站点访问权限。单个 PDF 失败不会阻止后续项目和元数据导出。
- Zotero 连接失败：启动 Zotero Desktop，确认 Connector 可用；仍失败时使用已导出的 RIS/BibTeX 手工导入。
