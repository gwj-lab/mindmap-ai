# Concept Nodes Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan in this session, task by task.

**Goal:** 在阅读器和三个 AI 原页面划词，原位确认后用完整句子生成概念节点，并保存来源双链。

**Architecture:** 工作区概念库复用回答 Markdown 与候选节点类型，另存生成状态和来源标注。共同划词控制器只画原位浮层；三个网站独立提交适配器复用原格式提取入口。主进程限制 IPC 来源和平台，生成任务绑定原工作区和来源项目。

**Tech Stack:** Electron、React、TypeScript、Zod、现有 Markdown/Turndown、Vitest、Playwright；不新增依赖。

## Global Constraints

- ChatGPT、元宝、豆包的现有格式转换规则保持独立。
- 左键划词后原位圆角标签，无 ×；再次点击生成，点击其他位置取消。
- 提示词包含完整原句和当前主题；设置网站、模板及是否后台生成。
- 概念节点具有概念标签，可阅读、编辑、拖入导图、删除和恢复。
- 不把网页文字或文件名作为可执行代码；文件以稳定 ID 保存；普通外链继续原安全流程。

### Task 1: Concept data and storage

Files: `src/shared/concepts.ts`, `src/shared/types.ts`, `src/shared/project.ts`, `src/shared/workspace.ts`, `src/main/concept-service.ts`.

- [x] 实现 `ConceptSelection`（完整句子、选词、前后文）和 `ConceptSettings`，构造模板提示词。
- [x] 添加 `conceptId` 和概念标签；工作区 `concepts.json` 记录概念、来源和失败/生成/完成/垃圾箱状态，已有项目兼容默认值。
- [x] 保存概念回答与标准 Markdown 文件链接；按概念和完整语境复用，确保同名不同义独立。
- [x] 测试完整句子、语境复用、保存/重开、失败重试和来源链接。

### Task 2: Selection and platform generation

Files: `src/shared/concept-selection.ts`, `src/preload/concept-generation.ts`, `src/preload/chatgpt.ts`, `src/main/ai-view-manager.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/app.ts`.

- [x] 实现共享原位 Range 浮层、外部取消和持久标注恢复，不改写网页文本节点。
- [x] 网站只允许助手回答划词；读取原句、完整回答并经受信任 IPC 发送请求。
- [x] 三个平台分别查找输入框与发送按钮；等待新回答完整且稳定后保存，超时/登录错误保留任务可重试。
- [x] 任务绑定标签页和原工作区，关闭页面/切工作区不写错项目。
- [x] 测试选区取消、再点击、平台发送、流式等待和来源校验。

### Task 3: Library, reader links and settings

Files: `src/renderer/src/components/NodeTray.tsx`, `AnswerDialog.tsx`, `MarkdownPreview.tsx`, `ConceptSettings.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/renderer/state/project-state.ts`.

- [x] 节点托盘增加概念区域、概念标签、重试/查看生成页面、删除/恢复与拖入导图。
- [x] 阅读器启用划词，点击概念链接打开笔记；来源列表支持返回原句并聚焦。
- [x] 设置提供网站、提示词模板和后台生成；默认模板保留完整语境。
- [x] 测试导图拖入、链接/反向跳转、编辑、概念标签保存及设置重开。

### Task 4: Verification and documentation

- [x] 用沙箱 Electron 真实流程测试三个平台生成，保存、阅读器、来源回跳和重开。
- [x] 执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和格式/概念端到端回归。
- [x] 记录网站自动发送的适配边界，保存交互截图与使用说明。
