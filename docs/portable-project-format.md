# Portable workspace and project format

## Workspace layout

```text
workspace-root/
├─ workspace.json
├─ answers/
│  └─ <answer-id>.md
├─ projects/
│  └─ <project-uuid>/
│     ├─ project.json
│     ├─ mindmap.json
│     ├─ map.md
│     ├─ inbox.md
│     ├─ history.md
│     └─ trash.md
└─ .trash/projects/<project-uuid>/
```

`workspace.json` 保存稳定项目 UUID、父子关系、顺序、活动项目和项目垃圾箱。回答放在工作区共享的 `answers/`，因此多个项目引用同一回答时不会复制正文。项目重命名不改变目录 UUID。

## Project files

- `map.md`：可移植主入口。包含 YAML 标识、普通 Markdown 嵌套列表、回答相对链接、可忽略的 UID 注释，以及 Mermaid `mindmap` 代码块。
- `mindmap.json`：应用的无损导图数据，用于保留节点扩展属性。丢失时应用会从 `map.md` 大纲恢复并重新生成。
- `project.json`：项目清单、停靠布局、候选/历史/垃圾箱和 UI 偏好。
- `inbox.md`、`history.md`、`trash.md`：托盘的可读索引，不取代 `project.json` 的无损状态。
- `answers/<id>.md`：YAML 元数据加标准 Markdown/GFM/LaTeX 正文。

## Obsidian and generic Markdown tools

可把整个工作区设为 Obsidian vault，或直接打开任一 `projects/<uuid>/map.md`。工作区内回答链接是 `../../answers/<id>.md`，Obsidian 和大多数 Markdown 编辑器可跟随。独立导出会把所需回答复制到项目内的 `answers/`，并把链接改写为 `answers/<id>.md`。

Mermaid 区块用于跨工具预览层级，但只表达节点标题和树结构；节点坐标、颜色、边框、停靠布局、折叠状态等以 JSON 为准。若目标 Markdown 工具不支持 Mermaid，仍可读取上方的普通嵌套列表。

## Recovery and migration

- 打开工作区时扫描所有项目引用。真正未被任何项目引用的回答只恢复到当前活动项目候选区，不会复制到每个子项目。
- 已挂入导图的回答不会同时留在候选区；缺失回答文件记录为“内容丢失”，不阻止项目打开。
- 旧格式迁移和不安全版本会写入 `.mindmap-ai-recovery/` 的备份或错误报告。
- 项目垃圾箱是可恢复目录移动；只有在项目垃圾箱中选择“彻底删除”才递归移除项目目录。回答孤立清理由用户明确选择，不随项目删除自动发生。

所有格式都带 `schemaVersion`。外部编辑 `map.md` 前建议保留 Git 或文件备份；应用优先读取存在的 `mindmap.json`，只有它缺失时才从 Markdown 恢复。
