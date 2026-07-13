# 最终审查修复报告

## 范围

- 收紧 Scholar PDF URL 识别规则并补 DOI 提取。
- 为 content ESM loader 增加可测试的失败诊断。
- 为 options storage 读写拒绝补回归测试，并修复读取失败的页面提示。
- 将后台 delay 归一化统一为 options 的 300..5000 整数范围。
- `.gitignore` 新增 `.superpowers/`，未删除任何已有文件。

## RED 证据

所有测试均在生产代码修改前添加，并使用中文路径的绝对 `npm.cmd --prefix` 执行。

1. `tests/parser.test.js`
   - PDF 规则失败：HTML 侧栏链接被错误识别为 `pdfUrl`。
   - DOI 规则失败：明确 `DOI: 10.1000/xyz-123` 实际得到空字符串。
2. `tests/background.test.js`
   - delay 范围失败：输入 0 实际返回 0，期望与 options 一致回退 800。
3. `tests/content-loader.test.js`
   - loader 直接访问未定义的 `chrome`，没有可测试的 rejection 处理与页面诊断。
4. `tests/options.test.js`
   - `storage.get` rejection 后页面状态仍为空，未显示中文读取失败。
   - `storage.set` rejection 的既有逻辑已通过新增回归测试，因此未改动该行为。

## GREEN 证据

- `tests/parser.test.js tests/background.test.js`：10/10 通过。
- `tests/options.test.js tests/content-loader.test.js`：6/6 通过。
- DOI 首次最小实现后仍失败 1 项；定位到 jsdom 将相邻节点文本拼接为 `OneDOI:`，将匹配条件保持为明确 `DOI:` 前缀但取消前置单词边界后，parser/background 10/10 通过。

## 实现说明

- PDF 候选必须是 HTTP(S)，且链接文字明确为 `[PDF]` 或 URL pathname 以 `.pdf` 结尾；相对 URL 通过页面 base URI 解析，非 HTTP(S)、HTML 和其他链接拒绝。
- DOI 只从明确 `DOI:` 文本或 `doi.org` / `www.doi.org` 链接提取；普通 DOI 形似文本不会猜测提取。
- loader 暴露 `globalThis.gsbdCreateContentLoader` 工厂以注入 importer/Chrome/document/console；生产环境仍自动加载。导入失败会 `console.error`，并插入 `gsbd-loader-error` 中文诊断。
- options 读取失败在 `#status` 写入“读取设置失败”及原始原因后继续 reject；保存失败维持既有中文提示。
- 后台 delay 仅接受 300..5000 的整数，否则统一回退 800。

## 最终验证

- 全量 `npm test`：27/27 通过，0 失败。
- 对 `src/*.js` 全部生产 JavaScript 逐一执行 `node --check`：全部退出 0。
- `manifest.json` 解析：输出 `manifest ok`。
- `git diff --check`：退出 0；仅有 Git 的 LF→CRLF 工作副本提示，无空白错误。
