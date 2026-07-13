# Google Scholar Batch Downloader

一个本地运行的 Chrome Manifest V3 扩展，用于在**当前 Google Scholar 搜索结果页或作者主页**选择论文、批量下载可用的公开 PDF，并在 Scholar 未找到 PDF 或明确下载失败时从 arXiv 查找公开预印本。批次结束后会汇报每篇论文的最终状态，并导出 RIS、BibTeX、JSON 和 CSV。

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目根目录（其中应直接包含 `manifest.json`）。
4. 更新源码后，在扩展卡片上点击“重新加载”，再刷新已经打开的 Scholar 页面；只重新加载扩展而不刷新页面，不会更新页面中的工具栏。

## 搜索结果页

1. 打开一个 Google Scholar 搜索结果页。扩展只处理当前页，不会自动翻页。
2. 使用工具栏逐项勾选，或使用“全选”“取消”“仅 PDF”。“仅 PDF”只选择页面上已有 PDF 链接的记录。
3. 在作者框输入姓名片段可过滤可见结果；过滤不改变已经勾选的项目。
4. 点击“下载并导出”。公开 PDF 会依次启动下载；没有 PDF 的论文仍会保留在导出文件和最终汇报中。
5. 扩展会等待 Chrome 报告 PDF 实际下载完成或中断，而不是把“已创建下载任务”当作成功。全部论文进入最终状态后，页面会显示汇报面板。
6. 每次批处理默认都会生成 `.ris`、`.bib`、`.json` 和 `.csv` 四个文件。PDF 文件名格式为 `第一作者 - 年份 - 标题.pdf`；Windows 不允许的字符会被清理，重名由 Chrome 自动编号。

下载间隔可在扩展详情的“扩展程序选项”中设置为 300–5000 毫秒（默认 800）。arXiv 备用源默认开启，也可在选项页关闭。

## 作者主页

1. 打开 `https://scholar.google.com/citations?user=...` 形式的作者主页。扩展只处理页面中**当前已经加载**的论文，不会自动展开完整列表。
2. 如果需要更多论文，请手动点击 Scholar 的“显示更多”（Show more）。新加载的论文行会自动出现复选框和状态，无需再次刷新页面。
3. 使用“题目筛选”查找当前已加载的论文，并通过逐项勾选、“全选”或“取消”管理选择。作者主页不会显示搜索结果页专用的“仅 PDF”按钮，因为论文详情尚未读取；这些条目会显示“待查询详情”。
4. 点击“下载并导出”后，扩展会按照设置的下载间隔，逐篇、顺序读取所选论文的 Scholar 详情页，并只接受其中明确提供的公开 PDF。该过程不会并发打开标签页；找到 PDF 后会在本批次中下载，找不到时仍导出元数据。
5. 如果某篇论文没有公开 PDF 或详情读取失败，它仍会作为 `no_pdf`（未找到 PDF）记录写入 RIS、BibTeX、JSON 和 CSV；单篇失败不会丢失整批导出。
6. 如果某个详情页出现 CAPTCHA 或异常流量提示，扩展会立即停止剩余详情查询，但仍会下载此前已经找到或条目原本已有的公开 PDF，并继续生成包含全部所选条目的元数据导出；请完成验证或稍后再试，不要尝试绕过限制。

作者主页上的“发送到 Zotero”与搜索结果页相同，会发送当前页面解析到的所选条目。由“下载并导出”执行的详情补全只用于该批次的 PDF 下载与 RIS/BibTeX/JSON/CSV 导出，不会回写页面数据，也不会改变随后“发送到 Zotero”的内容；如果需要把本批补全后的书目信息导入 Zotero，请导入该批生成的 RIS（推荐）或 BibTeX 文件。

## arXiv 备用源

启用后，扩展在 Scholar 阶段结束后仅处理两类论文：没有公开 PDF 的 `no_pdf`，以及 Chrome 已明确报告失败的 `failed`。`success` 不会重复下载；`timeout` 可能仍在 Chrome 中继续，因此不会自动启动备用下载。

扩展使用[官方 arXiv Atom API](https://info.arxiv.org/help/api/user-manual.html)，按论文标题串行查询，每次最多读取 5 条结果，并依据[API 使用条款](https://info.arxiv.org/help/api/tou.html)在所有批次之间保持单连接、请求间隔至少 3 秒。候选结果优先要求 DOI 完全一致；没有可比较 DOI 时，只接受去除大小写、空白和标点后标题完全一致的结果。近似标题不会自动下载，以降低误匹配风险。

匹配成功后，扩展直接下载 Atom 结果中指向 `arxiv.org` 的官方 PDF，并继续监听 Chrome 的实际完成或中断状态。检索失败、没有严格匹配或 arXiv PDF 下载失败都只影响对应论文，不会阻止其余论文和书目导出。

## 下载汇报与 CSV

批次结束后，Scholar 页面右侧会显示总数、成功下载、arXiv 成功、未找到 PDF、下载失败、下载超时和导出错误数量。展开“逐篇明细”可查看标题、最终状态、最终来源、Scholar 原结果、arXiv 结果、arXiv ID、PDF URL 和失败原因；点击“关闭汇报”可移除面板，开始新批次时旧汇报也会自动移除。

论文最终状态只有四种：

- `success`：Chrome 已报告 PDF 下载完成。
- `no_pdf`：没有找到可下载的公开 PDF，元数据仍会导出。
- `failed`：下载任务启动失败，或 Chrome 报告下载中断。
- `timeout`：下载启动后四分钟内没有收到完成或中断状态。

自动下载的 CSV 使用 UTF-8 BOM，可在 Windows Excel 中正确显示中文。除原有的论文和最终下载字段外，还包含 `scholarStatus`、`scholarError`、`fallbackStatus`、`fallbackError` 和 `arxivId`，用于追踪两阶段尝试。刷新或关闭 Scholar 页面后不会恢复未完成的页面汇报。

最终 `source` 为 `scholar` 或 `arxiv`。当前只支持 arXiv；其他备用源和自定义站点尚未实现。

## Zotero

“发送到 Zotero”要求本机 Zotero Desktop 正在运行，并提供 Zotero Connector 的本地接口。此功能是尽力而为的本地导入，不替代常规备份。如果 Zotero 未运行、Connector 接口不可用或导入失败，请使用批处理生成的 RIS（推荐）或 BibTeX 文件，在 Zotero 中选择“文件 → 导入”手工导入。

## 权限说明

- `downloads`：启动 PDF 和 RIS/BibTeX/JSON/CSV 文件下载，并读取这些下载的完成或中断状态。
- `storage`：在本机保存下载间隔与 arXiv 备用源开关。
- `https://scholar.google.com/*`：解析当前 Scholar 搜索结果页、作者主页及所选论文的详情页。
- `https://scholar.googleusercontent.com/*`：下载 Scholar 页面提供的公开文件。
- `https://export.arxiv.org/*`：调用官方 Atom API 检索严格匹配的预印本。
- `https://arxiv.org/*`：下载匹配结果提供的官方 PDF。
- `http://127.0.0.1:23119/*`：与本机 Zotero Connector 通信，不访问远程主机。

## 限制与合规

- 不自动翻页，也不自动点击作者主页的“显示更多”；仅处理用户当前已加载并选择的条目。
- 不绕过 CAPTCHA、付费墙、订阅或机构认证，不尝试获得页面未公开提供的 PDF。
- 备用检索仅访问 arXiv 官方 API 和 PDF，不访问其他论文网站，不抓取近似匹配。
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
- PDF 下载失败或中断：在页面汇报的逐篇明细中查看 Chrome 返回的原因，再检查下载权限、网络及站点访问权限。单篇失败不会阻止后续项目和元数据导出。
- PDF 下载超时：扩展等待实际完成状态最多四分钟。可先在 Chrome 下载记录中检查任务，再缩小批次重试；超时项目不会自动改用其他网站。
- arXiv 未找到：确认论文是否确实有 arXiv 版本。为避免误下载，当前不会接受近似标题；可以关闭备用源后重新运行，或手动从 arXiv 检索。
- arXiv 检索失败：检查网络和页面汇报中的 API 错误。扩展会遵守至少 3 秒的请求间隔，不会通过并发绕过限制。
- CSV 或其他导出文件失败：论文状态计数不会因此改变；页面汇报会单独列出导出错误。检查 Chrome 下载设置后重新运行批次。
- Zotero 连接失败：启动 Zotero Desktop，确认 Connector 可用；仍失败时使用已导出的 RIS/BibTeX 手工导入。
