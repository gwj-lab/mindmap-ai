# Mindmap AI — Turn AI Conversations into Mind Maps

AI conversations move in a line. Thinking rarely does. A useful answer often leads to a new question about one concept, then another. Mindmap AI helps you take those branches out of the chat and see how they connect.

Capture a ChatGPT, 腾讯元宝, 豆包, DeepSeek, or Kimi answer, link it to a mind-map node, and grow the topic into a visual structure you can revisit and rearrange. Keep the full answer as Markdown alongside the ideas it supports.

> **Current scope:** Mindmap AI supports ChatGPT, 腾讯元宝, 豆包, DeepSeek, and Kimi web conversations. The application interface is currently in Chinese.

## Why Mindmap AI

Long AI conversations make it hard to see where a line of inquiry began, which ideas belong together, and what to explore next. A mind map gives each follow-up question its own place while keeping it connected to the original topic.

Instead of searching back through a long chat, capture the answer that matters and connect it to the branch where it belongs. The conversation stays available in its chat tab; your map becomes a visual index of the ideas you want to keep exploring.

## What you can do

- **Capture a specific answer.** Hover over an assistant response, double-click to capture it, capture the latest response, or select an answer on the page.
- **Keep several chat tabs open.** Use the **＋** in the chat tab bar to open ChatGPT, 腾讯元宝, 豆包, DeepSeek, or Kimi. Each tab keeps its current page while you switch; tabs can be closed, reordered, or docked side by side. The workspace saves the tab list and layout.
- **Keep answers with the ideas they support.** Save each response as Markdown and associate it with a mind-map node. Capture the same response more than once as independent notes.
- **Branch into subtopics.** Every capture saves the original Markdown first. Only **生成子节点** mode adds child topics; **单一节点** mode keeps one candidate without children. Review the candidate, edit titles, reorder or remove children, then drag it into the map.
- **Explore and reshape the map.** Add child or sibling nodes, rename and move branches, undo or redo changes, and link a node to a child project.
- **Read and edit the source material.** The built-in reader supports Markdown, tables, code blocks, and LaTeX math. Use **复制** or Ctrl+C to copy selected text (the complete Markdown when nothing is selected), and **粘贴** or Ctrl+V to insert clipboard text into an editable draft. Save the draft to persist it.
- **Merge selected nodes.** Hold Ctrl and select two or more independent nodes, then choose **合并选中节点** in the toolbar or right-click menu. Choose the retained position, title, and at most one attached document. All child branches and original document files remain; undo restores the previous nodes. Parent and child nodes cannot be merged together.
- **Keep research organized locally.** Work across multiple projects and nested subprojects. Each project can export a `map.md` outline and Mermaid diagram, alongside `mindmap.json` for restoring application-specific map data.

## Download

Download the latest Windows x64 installer from [GitHub Releases](https://github.com/650865589/mindmap-ai/releases/latest).

Mindmap AI is designed for Windows 10/11. Each chat provider has an isolated Electron sign-in session; the app does not read or store your chat password. An optional OpenAI-compatible HTTPS API can generate titles and child topics. API keys are stored by the Electron main process using Windows secure storage.

## Run from source

Requirements: Windows 10/11, Node.js 24 or later, and pnpm 11.

```powershell
pnpm install
pnpm dev
```

On first launch, choose an empty folder for a workspace. Later launches reopen the last workspace; use **Switch Workspace** to open another one or create a new workspace.

To build a Windows x64 installer:

```powershell
pnpm package:win
```

The installer is written to `release/`.

## Typical workflow

1. Use **＋** in the chat tab bar to open ChatGPT, 腾讯元宝, 豆包, DeepSeek, or Kimi, sign in, and have a conversation.
2. Choose **Single Node** or **Generate Child Nodes**.
3. Capture an assistant answer using hover and double-click, **Capture Latest**, or page selection.
4. Review the candidate, adjust its title or child topics, and drag it onto the relevant map node.
5. Open an answer-linked node to read or edit its Markdown. Press `Ctrl+S` to save immediately.

The interface is currently in Chinese, so the labels above describe the corresponding features rather than exact on-screen text.

## Search and Markdown attachments

Use the top-bar **搜索节点** field (or `Ctrl+F`) to search titles across all projects. Click a result to switch projects, expand hidden ancestors, and center the node. Current unsaved node titles are included. Enable **同时搜索附加文档正文** to search saved Markdown content and show matching snippets. Searches are debounced, results are capped at 50, and document content is cached on demand with a 32 MB limit. Large documents over 20 MB are excluded from content search.

Right-click a node and choose **新增空白文档** or **导入 Markdown 文档**. Imports accept UTF-8 `.md` / `.markdown` files up to 5 MB and copy their contents into the workspace. Each node has at most one attachment. Replacing an attachment asks for confirmation and retains the previous Markdown file. Blank notes open directly in the editor; save edits with `Ctrl+S`.

## S3 synchronization

Open **S3 同步** in the top bar. Configure the bucket, region, and a unique prefix for this workspace. Leave the endpoint blank for AWS, or specify an HTTPS endpoint for an S3-compatible service. Enable path-style addressing when required by the service. HTTP is supported only for local `localhost` / loopback endpoints. Use the same destination on both devices. Access Key, Secret Key, and optional Session Token are encrypted by the operating system and stored in the application's local profile. Changing the endpoint requires entering the credentials again.

- **上传当前工作区** saves the project and uploads an immutable snapshot of all workspace projects, Markdown documents, concept/question records, and project trash. Save reader drafts and wait for pending generation to finish first. API keys, S3 credentials, browser sessions, and unrelated files are excluded. Each snapshot is limited to 128 MB (20 MB per data file).
- **下载云端工作区** requires an empty destination folder, verifies the snapshot, restores it, and opens the downloaded workspace. Existing local notes are not overwritten. This is manual transfer, without background or automatic synchronization.
- Upload checks the last cloud revision known on this device and publishes the latest pointer using S3 conditional writes. If another device changed the cloud version, upload stops. Download that version into a new folder, or select a different prefix for an independent workspace. Older immutable snapshots are retained; storage lifecycle policies can manage their retention.

The account needs `s3:GetObject` and `s3:PutObject` access to the selected prefix and permission to check the bucket (`s3:ListBucket`). The service must support conditional `PutObject` requests (`If-Match` / `If-None-Match`). **测试连接** checks bucket access; upload and download report their own permission errors. Remote transfers happen only when you click a transfer button.

## Concept notes

Select a term with the left mouse button in a saved answer's preview or an assistant answer on ChatGPT, 腾讯元宝, 豆包, DeepSeek, or Kimi. A rounded marker stays over the original text. Click the marker again to generate a concept; click elsewhere to cancel.

The **概念节点** section in the candidate tray stores concept notes across the workspace. Its **设置** button selects the generation website, prompt template, and background mode. Prompts include the complete source sentence and current node title. Ready notes can be read, edited, renamed, dragged into a mind map with a **概念** tag, or moved to and restored from the trash. Click a concept marker to read its note; the source panel returns to the quoted sentence.

Notes use ordinary relative Markdown links compatible with Obsidian. No API key is required for concept generation; sign in to the selected website first. See [概念节点使用说明](docs/concept-nodes.md) for settings, storage, and website automation limits.

Select text and click **答疑** to edit a prefilled question. The captured answer stays attached to the selected words as an annotation, marked with a teal underline. Click it to read the question and answer, or use the reader's annotation list. Questions do not become mind map or candidate nodes. Concept marks remain purple and follow scrolling, resizing, and document redraws.

Questions support selections of up to 12,000 characters across paragraphs. Expand **答疑设置** in the question dialog to choose its web provider and save an initial prompt template independently of concept settings. Use `{selection}` for the selected text, `{title}` for the topic, and `{sentence}` for context; **应用到本次问题** fills the current question from the template while keeping it editable.

The tray groups candidates under the current project and concepts under their referenced projects. Click a section or project heading to collapse it. In the Markdown editor, drag the separator between source and preview to adjust their widths; **关闭编辑** returns to the preview while retaining unsaved edits.

## Optional AI topic generation

### Answer format preservation

Traditional ChatGPT answers retain their existing converter. New ChatGPT Intelligent UI components, Doubao, Yuanbao, DeepSeek, and Kimi use platform DOM adapters and a shared Markdown serializer. The adapters preserve headings, emphasis, nested and task lists, quotes, code languages and whitespace, table alignment and cell breaks, links, images with available URLs, and original TeX formulas. Mermaid is saved as a code block when its source is available; an SVG-only preview is kept as a static snapshot.

ChatGPT Intelligent UI also preserves the current card layout, SVG charts, and form state in an inert, sandboxed snapshot. Kimi formulas use original TeX when native copy provides it; otherwise their KaTeX HTML is preserved with its native offsets and bundled fonts. Snapshots use `mindmap-ui` fenced JSON blocks in the saved Markdown and render in the built-in reader; external Markdown viewers show those blocks as source. Buttons and controls are static. See the [rich answer acceptance report](artifacts/rich-provider-test/README.md) for actual DOM samples, screenshots, and verification details.

Capture uses the answer body and skips reasoning, toolbars, and streaming replies. Formats missing from the website DOM cannot be reconstructed reliably: for example, Yuanbao may render an image as a plain URL or omit footnote identifiers. Load lazy images before capture. Automated checks replay real website DOM through the sandboxed Electron preload, saved Markdown, and reader, with an unchanged ChatGPT output baseline.

Without API settings, Mindmap AI uses local extraction rules. You can also configure an OpenAI-compatible HTTPS API in **API Settings**. Single-node mode generates one title; child-node mode generates an ordered set of up to 12 subtopics. If a request times out or returns an error, the app falls back to local extraction and keeps the captured answer.

DeepSeek is available as a preset. Enter an API key, then use **Test Connection** before capturing answers. The app reports connection and generation failures and indicates when it used local extraction instead.

## Data and portability

Workspace and standalone project formats are documented in [docs/portable-project-format.md](docs/portable-project-format.md). Each project's `map.md` provides a readable outline and Mermaid diagram. `mindmap.json` preserves application-specific node properties such as layout and styling that a Mermaid diagram cannot represent.

## Development checks

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Real provider sign-in, cookie persistence, and changes to each site's page structure require manual checks. See the [Windows acceptance checklist](docs/windows-acceptance-checklist.md).

## Security and license

Remote chat pages run without Node.js integration and with context isolation, sandboxing, and web security enabled. The app denies camera, microphone, notification, and file permissions by default. Filesystem paths come from native folder pickers.

Mindmap AI is released under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
