# 节点阅读工作区实现计划

**目标：** 多个节点独立阅读、最大化、右侧概念折叠标签与完整阅读回退；消除文字标记移动延迟，统一 Obsidian 风格。

**方式：** 在现有 Electron / React 阅读器上局部实现，复用 CodeMirror、MarkdownPreview、Lucide 和既有测试设施。保留当前未提交工作，不引入额外窗口框架或依赖。

- [x] `src/shared/concept-selection.ts`：将固定屏幕浮层改为正文内定位的标记层；支持原生文字高亮，每个阅读器独立清理。用既有 preload 单测及 Electron 滚动、拖动检查验证。
- [x] `src/renderer/src/components/AnswerDialog.tsx`、`ConceptSidebar.tsx`：拆分独立文档面板和窗口外壳，增加最大化/还原、右侧概念标题标签、单击预览、空白双击/按钮完整打开、回退。保留节点滚动和未保存编辑状态。
- [x] `src/renderer/src/App.tsx`：将单窗口状态改成有顺序的窗口列表；已有回答再次打开时置前；提供窗口切换、返回工作区，隐藏窗口时保留内容。固定 DOM 顺序，仅修改窗口层级，避免置前时中断点击。
- [x] `src/renderer/src/styles.css`：浅灰工作区、白色正文、紫色选中态、细分隔线；统一工具栏、树、标签、阅读器与字号，窄窗口和最大化布局可用。
- [x] 增加针对性的阅读器组件测试，更新概念端到端用例并验证多个窗口、回退、最大化及即时标记跟随；运行单测、类型检查、lint、build 和相关 Electron 用例，检查截图。
- [x] 更新 `docs/concept-nodes.md`，记录实际交互和必要的限制。
