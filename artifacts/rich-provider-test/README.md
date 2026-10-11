# 回答格式截取验收

验收日期：2026-10-11。支持平台扩展为 ChatGPT、腾讯元宝、豆包、DeepSeek、Kimi。

## 格式调查和实现

新版 ChatGPT 使用原生流式组件；[OpenAI 官方说明](https://openai.com/index/gpt-6-for-everyone/)介绍了组件与编译器。实际回答 DOM 使用 `data-d-component`、`data-w-component` 和 `data-dil-message-id`；柱状图为 SVG，精确数据另有无障碍列表。截图保留当前卡片、图表、表单状态，正文另存可阅读的 Markdown。传统 ChatGPT 样本的输出逐字保持原基线。

研究了 MIT 项目 [ai-chat-downloader](https://github.com/mueedx/ai-chat-downloader) 的平台适配思路；直接复用项目已有 Turndown/GFM、KaTeX 和隔离标签页，没有增加依赖。

DeepSeek 代码块使用高亮 span，公式含原始 TeX annotation；Mermaid 代码标签提供源码，只有 SVG 的预览则保存静态画面。Kimi 表头与表身属于两张 DOM 表格，截取时合并；思考内容排除。其公式没有 TeX annotation，优先使用网站复制功能提供的公式源码，无法获取时保存原始 KaTeX HTML 及相对排版样式，使用应用自带字体显示。

所有平台保留标题、强调、删除线、嵌套/任务列表、引用、分隔线、代码语言和空白、表格对齐/竖线/换行、链接、网站实际提供的图片地址、脚注与价格。没有提供图片 URL 的真实样本保留网站显示的链接，不补造图片；单独的格式矩阵覆盖图片和链接图片。

## 样本来源

- ChatGPT：[原回答](https://chatgpt.com/c/6acb9454-e684-83e8-bbf9-af6d22665c62)，真实组件 DOM 与计算样式保存在 `tests/fixtures/chatgpt/intelligent-ui-answer*.html`。
- DeepSeek：[登录后生成的样本](https://chat.deepseek.com/a/chat/s/febbb339-d661-4396-ab36-83d457960b32)，`tests/fixtures/deepseek/format-answer*.html` 包括图表预览和代码标签两种状态。
- Kimi：[登录后生成的样本](https://www.kimi.com/chat/1a12b50a-eff2-831b-8000-096d55cc161c?chat_enter_method=home)，`tests/fixtures/kimi/format-answer*.html`。样式样本保留公式原生内联相对偏移，公式外框尺寸、字号来自原页面，避免用计算像素尺寸覆盖 KaTeX 的布局。

两个新平台的加载/停止控件也在真实生成过程中观察并加入回归，等待生成和流式输出期间不捕获最新回答，已完成的较早回答仍可单独截取。

## 完整流程验证

真实 DOM 在生产隔离的 Electron 标签页、原网站域名下回放，使用正式 preload 和 IPC 完成捕获→候选节点→拖入导图→阅读器→磁盘重新读取。此测试不依赖账号，亦不等同于在 Electron 中再次登录真实网站；真实网站的生成和 DOM 调查是在用户登录的浏览器中完成。

| 真实样本 | 保留代码块 | 原始 TeX 公式 | 静态公式 | 网页快照 |
| --- | ---: | ---: | ---: | ---: |
| 新 ChatGPT | 0 | 0 | 0 | 1，包含 8 根柱状图 |
| DeepSeek | 4 | 12 | 0 | 0，另有 SVG 预览单元验证 |
| Kimi | 4 | 0 | 14 | 14 个公式画面 |

代码保留 JavaScript、Python、Mermaid、纯文本及空行、反引号、美元。表格换行与对齐、任务勾选、脚注跳转/返回、复杂公式和图表经过阅读器截图检查。Kimi 的 14 个公式在字体加载后逐一检查字形上下边界，均未裁切。独立格式矩阵覆盖五个平台，原有 ChatGPT、豆包、元宝的三个端到端回归也通过。

- [ChatGPT 图表效果](chatgpt-web-snapshot.png)
- [DeepSeek 公式效果](deepseek-math.png)
- [Kimi 公式效果](kimi-math.png)
- [Kimi 表格效果](kimi-table.png)

同目录 `*-saved-note.md` 为实际落盘笔记，`*-report.json` 为阅读器格式统计。快照保存在 Markdown 的 `mindmap-ui` 围栏 JSON 内，内置阅读器显示静态画面；其他 Markdown 阅读器显示该段源码。脚本、事件处理器、嵌套 iframe 和远程 CSS 被移除，表单禁用，阅读时再次净化。按用户要求保留当前画面与内容，不继续运行原网站交互逻辑。

## 验证命令

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright test tests/e2e/rich-providers.spec.ts tests/e2e/provider-format.spec.ts
```

230 项单元测试、类型检查、lint、构建及上述 6 项 Electron 格式端到端检查均通过；最终公式边距修改后另有 23 项针对性单测和全部 6 项端到端检查通过。平台网页结构仍可能变化；未在本轮验收 Electron 登录续存、真实网站概念生成或所有未来组件。
