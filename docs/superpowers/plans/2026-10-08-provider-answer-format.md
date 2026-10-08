# Provider answer format implementation plan

**Goal:** 保存豆包、元宝回答的格式，并保持现有 ChatGPT 转换结果不变。

**Architecture:** ChatGPT 继续使用现有 `chatgpt-adapter.ts` 与 `shared/content.ts`。新增平台路由、豆包/元宝适配器和各自 DOM 预处理；两个新平台复用独立的 Turndown/GFM 序列化工具，不调用或改动 ChatGPT 的格式规则。

**Tech Stack:** Electron、TypeScript、Turndown/GFM、Vitest、Playwright。

## Constraints

- 不更改 ChatGPT 的转换函数、阅读器样式及已有笔记。
- 使用真实网页回答样本；额外格式用明确标注的离线样例覆盖，不把离线测试说成真实网站验收。
- 测试最新捕获、点选、悬停共用的路由，排除提问和工具栏，保留原始代码及 TeX。
- 不引入新依赖，不读取账号凭据，不执行捕获的 HTML，不根据公式可视文字猜测 TeX。

## Steps

- [x] 记录现有 ChatGPT 真实样本输出；检查豆包、元宝实际 DOM 并保存测试样本。
- [x] 在 `src/preload/answer-adapter.ts` 路由平台；`chatgpt.ts` 与 `hover-capture.ts` 统一使用平台入口；ChatGPT 原函数直接委托。
- [x] 新建 `src/preload/yuanbao-adapter.ts`、`doubao-adapter.ts`，分别处理消息范围、代码包装、公式源和平台工具栏。
- [x] 新建独立格式工具，处理 GFM 表格对齐/换行/竖线、代码空行/围栏、任务列表、链接/图片和数学；仅供两个新平台使用。
- [x] 增加真实 DOM 回归与格式矩阵；ChatGPT 使用原样本逐字比对。
- [x] 在 Electron 中从平台页面捕获，写入 Markdown，打开阅读器核对内容、公式、表格和代码；保存笔记与验收报告。
- [x] 执行类型检查、代码检查、单元测试、构建及相关端到端测试；记录真实页面限制。
