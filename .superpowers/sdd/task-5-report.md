# Task 5 实现报告

## 实现范围

- 新增 `src/background.js`：提供纯函数 `runWithRetry`、`makeBatchFiles`，以及 `RUN_BATCH` / `SEND_ZOTERO` 消息编排。
- 新增 `src/content.js`：Scholar 阻断检测、当前页解析、行级选择/状态、作者筛选、固定工具栏及后台消息交互。
- 新增 `src/content.css`：所有 CSS class 均使用 `gsbd-` 前缀，固定层级 `z-index: 10000`。
- 新增 `tests/background.test.js`：覆盖一次重试与固定三种导出文件。
- 未实施 Task 6 的设置页、README 或 Manifest 调整。

## TDD 证据

1. 先创建 `tests/background.test.js`。
2. 执行：
   `npm.cmd --prefix 'E:\B-CSTools\0-Projects\插件\google-scholar-batch-downloader\.worktrees\feature-extension' test -- tests/background.test.js`
3. RED：退出码 1，`ERR_MODULE_NOT_FOUND`，缺少 `src/background.js`，符合预期。
4. 最小实现 `src/background.js` 后重复同一命令。
5. GREEN：2 个测试全部通过，退出码 0。

## 后台行为核对

- PDF 逐篇顺序启动，下载参数包含 `conflictAction: 'uniquify'` 与 `saveAs: false`。
- 每篇 PDF 启动失败独立重试一次；最终失败只记录该篇结果，不中断后续论文。
- 无 PDF 论文不调用下载 API，结果记为 `metadata`，仍进入三种元数据导出。
- 从 `chrome.storage.local` 读取 `downloadDelayMs`，默认 800ms，只在相邻 PDF 启动之间等待。
- 批次始终生成 RIS、BibTeX、JSON 三个 UTF-8 data URL，文件名使用 ISO 安全时间戳。
- Zotero 请求复用 `buildZoteroRequest`，采用 10 秒 `AbortController`；网络异常及非 2xx 都返回中文 RIS/BibTeX 手工导入 fallback。

## 内容 UI 核对

- CAPTCHA 或结构异常时显示中文停止消息，不注册批次按钮。
- 每行一个复选框与状态；工具栏包括作者筛选、全选、取消、仅 PDF、下载并导出、发送到 Zotero、已选数量、进度。
- 作者筛选大小写不敏感，仅隐藏不匹配行，不改动选择状态。
- 消息体严格为 `{type:'RUN_BATCH',papers}` / `{type:'SEND_ZOTERO',papers}`。
- 请求期间按钮禁用；响应后逐行展示成功、失败或仅元数据状态。
- 内容脚本保持自包含，以适配当前 Manifest 中普通（非模块）content script 的加载方式；行为与现有 parser/model 接口一致。

## 自审结论与关注点

- 删除了一个因复选框位于工具栏外而无法触发的冗余 toolbar `change` 监听，保留 document 级监听。
- Chrome downloads API 的成功表示下载任务已被接受，不表示远端文件最终传输完成；这是当前接口与任务范围的既定语义。
- UI 自动化测试不在 Task 5 简报指定范围内；后台纯 helper 已按简报测试，最终还执行全量现有测试与语法检查。

## 审查修复（第二轮）

### RED

1. 先扩展 `tests/background.test.js`，覆盖单个导出失败仍尝试后续格式、保留逐篇结果，以及 delay 的 `undefined` / 非数字 / 负数 / 0 / 正数归一化。
2. 执行绝对路径命令：
   `npm.cmd --prefix 'E:\B-CSTools\0-Projects\插件\google-scholar-batch-downloader\.worktrees\feature-extension' test -- tests/background.test.js`
3. 结果：退出码 1；ESM 报告 `background.js` 不提供 `normalizeDownloadDelay`，确认新能力不存在。
4. 新增 `tests/content.test.js` 后执行同形式的 `test -- tests/content.test.js`。
5. 第一轮结果：退出码 1；`content.js` 不提供 `initializeScholarUi`，确认内容脚本不可集成测试。
6. 仅完成 ESM 可测试入口和本地 loader 架构后再次运行内容测试。
7. 第二轮行为 RED：2 个断言均失败；部分结构变化返回 `true` 而非停止，复选后状态仍为 `PDF` 而非“已选择”。

### GREEN

- 后台定向：4/4 通过。三种导出各自捕获错误，失败响应包含 `results`、汇总 `error` 与 `exportErrors`。
- 内容与解析定向：6/6 通过。覆盖无有效标题时停止，以及“已选择”→“下载中”→最终成功/失败状态。
- 全量：19/19 通过。
- `node --check src/content.js`、`node --check src/background.js`、额外的 `node --check src/content-loader.js` 均退出 0。
- Manifest JSON 解析输出 `manifest ok`；`git diff --check` 退出 0。

### 架构与行为修复

- `content.js` 现在直接 ESM 导入 `parser.js` 的 `detectScholarBlock` / `parseScholarPage` 和 `model.js` 的 `matchesAuthor`，不再复制 parser/model 实现。
- Manifest 加载普通 `content-loader.js`；loader 通过 `chrome.runtime.getURL` 动态导入本扩展的 `content.js`，并仅将本地 content/parser/model 声明为 Scholar 域可访问资源，无远程代码。
- `detectScholarBlock` 检查每个结果行的核心 `.gs_rt` 与去标签后的有效标题；任一无效即返回 `structure`。
- delay 使用 `Number.isFinite` 与非负校验；合法 0 保留，其余无效值回退 800。
- 每种导出独立尝试，某格式失败不阻断后续格式；逐篇结果不丢失。
