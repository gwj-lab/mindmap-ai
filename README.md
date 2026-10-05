# Mindmap AI

Mindmap AI 是面向 Windows 10/11 的本地优先研究工作台：在隔离的 ChatGPT 网页中捕获回答，将正文保存为 Markdown，再把单节点或自动提取的节点树拖入思维导图。

## 当前能力

- 精确识别鼠标悬停的单条助手回答；支持双击捕获、捕获最新和页面点选。
- 回答保存为带 YAML 元数据的 Markdown，支持 GFM、代码块、表格和 LaTeX/KaTeX 公式。
- 单一节点或最多 12 个子节点；可用本地规则，也可配置一组 OpenAI 兼容 HTTPS API 生成标题和子方案。
- XMind 风格的节点快捷键、右键重命名/删除、拖动换父级、撤销重做、缩放和主题。
- 候选、历史和垃圾箱统一托盘；导图子树可移入历史后恢复，删除项可恢复或彻底删除。
- 一个工作区包含多个主项目和子项目，布局、导图、托盘和样式分别保存。
- 同一条网页回答可反复截取为相互独立的 Markdown 副本；答案关联节点显示内容角标。
- 每个项目生成可由 Obsidian 等 Markdown 工具打开的 `map.md`，内含可见大纲和 Mermaid 思维导图。

## 开发运行

需要 Windows 10/11、Node.js 24+ 和 pnpm 11。也可以从 GitHub Releases 下载 Windows x64 安装包。

```powershell
pnpm install
pnpm dev
```

在 Windows 上构建安装包：

```powershell
pnpm package:win
```

安装包生成在 `release/` 目录中。

首次启动选择一个空文件夹创建工作区。以后启动会自动恢复上次成功打开的工作区；顶部“切换工作区”可从最近列表切换，也可打开其他文件夹或新建工作区。ChatGPT 登录保存在 Electron 的 `persist:provider-chatgpt` 会话中，应用不读取账号密码。

## 基本流程

1. 在右侧登录 ChatGPT 并完成对话。
2. 选择“单一节点”或“生成子节点”，然后悬停回答、点选回答或点击“捕获最新”。
3. 在候选托盘中检查并编辑标题，把卡片拖到任意导图节点。
4. 双击回答节点阅读或编辑 Markdown；`Ctrl+S` 立即刷新保存队列。
5. 在项目菜单中创建子项目、移入项目垃圾箱或导出独立项目。

API 设置是可选项，可从左侧“API 配置”或 AI 面板齿轮进入同一配置页。密钥仅在 Electron 主进程中通过 Windows 系统加密能力保存；渲染器只能看到“已保存/未保存”。单一节点模式使用模型生成一个标题，生成子节点模式还会生成最多 12 个有序子方案。API 超时、格式错误或网络失败时自动回退本地提取，不影响回答和候选保存。

DeepSeek 可在 API 配置页点击“使用 DeepSeek 配置”，预设 `https://api.deepseek.com` 与 `deepseek-chat`，输入密钥后可先“测试连接”。连接失败会区分密钥、余额、模型/地址、限流和服务端问题；捕获时若发生回退，界面会明确提示已使用本地规则。

## 可移植性

工作区和独立项目格式详见 [docs/portable-project-format.md](docs/portable-project-format.md)。最便携的入口是项目的 `map.md` 和回答 Markdown；`mindmap.json` 用于无损恢复应用专属的节点属性。Mermaid 是通用预览，不承诺保存节点坐标、颜色等全部 UI 状态。

## 验证

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

真实 ChatGPT 登录、Cookie 持久化及外部 DOM 变化不进入 CI，按 [Windows 验收清单](docs/windows-acceptance-checklist.md)手工确认。

## 安全与许可

远程网页关闭 Node 集成，启用上下文隔离、沙箱和 Web 安全；默认拒绝摄像头、麦克风、通知和文件权限。磁盘路径只能来自系统选择器。源码采用 [MIT License](LICENSE)，第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
