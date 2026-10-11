# Rich answers and additional providers

**Goal:** 更新 ChatGPT Intelligent UI 截取，增加 DeepSeek、Kimi，与现有平台共用捕获、保存、阅读流程。

**Architecture:** 复用现有 Electron 隔离标签页、Turndown/GFM、KaTeX 和平台路由。每个平台负责消息边界与 DOM 预处理。保留传统 ChatGPT 样本输出；新组件按语义转换，并保存当前可见图表与布局的安全静态快照。

**Tech Stack:** TypeScript、Electron、React、Vitest、Playwright；不增加依赖。

## Steps

- [x] 查看官方格式说明、真实 ChatGPT DOM 与开源适配参考，记录样本来源。
- [x] 扩展 ProviderId、配置、IPC/持久化校验、导航和概念功能至 DeepSeek、Kimi。
- [x] 新增平台适配器，覆盖消息边界、多段回答、生成中状态、代码/数学/表格/任务/链接/图片。
- [x] 适配 ChatGPT data-d-component/data-w-component；保留多段回答、强调、表格对齐、图表可访问数据与静态画面。
- [x] 使用现有 Vitest 与 Electron E2E 验证捕获→落盘→阅读器，保存截图、Markdown 与报告。
- [x] 运行类型检查、lint、单元测试、构建与相关端到端测试；记录未完成的真实网站验收，不把人工样例称为真实 DOM。

## Evidence and reuse

- 官方格式说明：https://openai.com/index/gpt-6-for-everyone/，原生流式组件及编译器，无公开稳定的导出 schema。
- 真实 ChatGPT 样本：`tests/fixtures/chatgpt/intelligent-ui-answer.html`，2026-10-11 浏览器中已打开回答；data-d-component 与 data-w-component=chart，图表为 SVG + 无障碍数据列表。
- MIT 开源参考：https://github.com/mueedx/ai-chat-downloader，研究平台 DOM 边界；继续复用已有 Turndown/GFM，不引入扩展框架。
- 不执行捕获页面的脚本，不读取凭据；快照隔离并再次净化。
