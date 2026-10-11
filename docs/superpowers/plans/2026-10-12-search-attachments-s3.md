# 节点搜索、Markdown 附件及 S3 同步 Implementation Plan

> **For agentic workers:** 在当前会话逐项实现与验证，遵循用户的最小充分复杂度要求。

**Goal:** 快速定位工作区节点，为节点创建或导入一篇 Markdown 附件，手动上传/下载完整工作区，验证后提交并推送现有 GitHub 分支。

**Architecture:** 搜索由主进程按需读入节点和文档并缓存，渲染层合并当前未保存节点并定位导图。附件由本机文件选择器导入，复用 AnswerRepository。S3 使用 AWS SDK v3，凭据由系统 safeStorage 加密，上传快照采用条件更新，下载只写入空文件夹。

**Tech Stack:** Electron、React、SimpleMindMap、Zod、@aws-sdk/client-s3、现有 Vitest/Playwright。

## Global Constraints

- 每个节点最多一篇附件；已有附件需明确替换，旧文件不删除。
- 导入只接受 .md/.markdown UTF-8 文本，限制 5 MB，不执行内容。
- 搜索按需加载、150 ms 防抖、最多 50 个结果、正文缓存有容量上限。
- S3 手动上传/下载整个工作区；下载选择空文件夹，不覆盖现有笔记；密钥不进入工作区或 Git。
- 保留当前会话已有改动，一并提交到当前 codex/concept-nodes 分支。

## Task 1: 搜索

**Files:** src/main/workspace-search.ts、src/shared/search.ts、src/renderer/src/components/NodeSearch.tsx、App.tsx、MindMapPanel.tsx、preload/app.ts。

**Interfaces:** search.query(query, includeContent) -> Promise<NodeSearchResult[]>；MindMapController.focusNode(uid)。结果包含 projectId、nodeUid、title、answerId、snippet。

- [x] 实现按需节点列表、正文缓存、标题优先结果与过期请求丢弃。
- [x] 搜索栏支持工作区所有项目，点击结果切换项目并展开/定位节点；当前未保存标题参与搜索。
- [x] 验证跨项目、内容命中、缓存更新、结果限制和响应时间。200 篇正文缓存后无命中查询 30.9 ms。

## Task 2: 附件

**Files:** src/main/node-attachments.ts、NodeContextMenu.tsx、MindMapPanel.tsx、App.tsx、types.ts、preload/app.ts。

**Interfaces:** project.createAttachment(nodeUid, kind: 'blank' | 'import') -> Promise<AnswerDocument | null>；App 将 answerId 写入指定节点并打开阅读器。

- [x] 本机选择 Markdown 文件并校验后复制为独立文档，或创建空白正文；标记 origin 为 local。
- [x] 右键菜单提供新建空白文档、导入 Markdown；已有附件替换前确认，旧文件保留。
- [x] 验证非 Markdown、超大文件、UTF-8、已有附件、保存及下载恢复；取消和只读沿用现有选择器与状态检查。

## Task 3: S3

**Files:** src/shared/sync.ts、src/main/s3-settings-store.ts、src/main/workspace-snapshot.ts、src/main/s3-sync.ts、src/main/s3-ipc.ts、src/renderer/src/components/S3SyncDialog.tsx、TopBar.tsx、App.tsx。

**Interfaces:** sync.getSettings/saveSettings/testConnection/upload/download；download 返回 WorkspaceOpenResult 或 null，并记录最近工作区。

- [x] 添加 endpoint、region、bucket、prefix、pathStyle 与加密凭据配置，修改 endpoint 必须重新输入凭据。
- [x] 仅快照工作区数据文件；校验路径、schema、大小、链接与所有项目/文档完整性。
- [x] 上传不可变快照并使用 IfMatch/IfNoneMatch 发布 latest 指针；检测云端变化，报冲突不覆盖。
- [x] 下载校验后写入空文件夹，失败不切换；排除 API/S3 密钥、本机配置和外部文件。
- [x] 使用本机模拟 S3 服务验证真实 SDK 签名请求、上传、下载和版本冲突。

## Task 4: 验证和发布 Git

- [x] 260 项单元测试、typecheck、lint、build、10 项 Electron 窗口验收通过。
- [x] 更新 README 与第三方许可说明；检查提交清单与敏感信息。
- Git 发布：提交所有已验证改动，推送 origin/codex/concept-nodes；远端提交一致性以发布后的核对结果为准。
