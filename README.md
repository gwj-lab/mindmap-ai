# Mindmap AI — Turn AI Conversations into Mind Maps

AI conversations move in a line. Thinking rarely does. A useful answer often leads to a new question about one concept, then another. Mindmap AI helps you take those branches out of the chat and see how they connect.

Capture a ChatGPT, 腾讯元宝, or 豆包 answer, link it to a mind-map node, and grow the topic into a visual structure you can revisit and rearrange. Keep the full answer as Markdown alongside the ideas it supports.

> **Current scope:** Mindmap AI supports ChatGPT, 腾讯元宝, and 豆包 web conversations. The application interface is currently in Chinese.

## Why Mindmap AI

Long AI conversations make it hard to see where a line of inquiry began, which ideas belong together, and what to explore next. A mind map gives each follow-up question its own place while keeping it connected to the original topic.

Instead of searching back through a long chat, capture the answer that matters and connect it to the branch where it belongs. The conversation stays available in its chat tab; your map becomes a visual index of the ideas you want to keep exploring.

## What you can do

- **Capture a specific answer.** Hover over an assistant response, double-click to capture it, capture the latest response, or select an answer on the page.
- **Keep several chat tabs open.** Use the **＋** in the chat tab bar to open ChatGPT, 腾讯元宝, or 豆包. Each tab keeps its current page while you switch; tabs can be closed, reordered, or docked side by side. The workspace saves the tab list and layout.
- **Keep answers with the ideas they support.** Save each response as Markdown and associate it with a mind-map node. Capture the same response more than once as independent notes.
- **Branch into subtopics.** Create a single-node candidate or generate up to 12 child topics. Review the candidate, edit titles, reorder or remove children, then drag it into the map.
- **Explore and reshape the map.** Add child or sibling nodes, rename and move branches, undo or redo changes, and link a node to a child project.
- **Read and edit the source material.** The built-in reader supports Markdown, tables, code blocks, and LaTeX math.
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

1. Use **＋** in the chat tab bar to open ChatGPT, 腾讯元宝, or 豆包, sign in, and have a conversation.
2. Choose **Single Node** or **Generate Child Nodes**.
3. Capture an assistant answer using hover and double-click, **Capture Latest**, or page selection.
4. Review the candidate, adjust its title or child topics, and drag it onto the relevant map node.
5. Open an answer-linked node to read or edit its Markdown. Press `Ctrl+S` to save immediately.

The interface is currently in Chinese, so the labels above describe the corresponding features rather than exact on-screen text.

## Concept notes

Select a term with the left mouse button in a saved answer's preview or an assistant answer on ChatGPT, 腾讯元宝, or 豆包. A rounded marker stays over the original text. Click the marker again to generate a concept; click elsewhere to cancel.

The **概念节点** section in the candidate tray stores concept notes across the workspace. Its **设置** button selects the generation website, prompt template, and background mode. Prompts include the complete source sentence and current node title. Ready notes can be read, edited, renamed, dragged into a mind map with a **概念** tag, or moved to and restored from the trash. Click a concept marker to read its note; the source panel returns to the quoted sentence.

Notes use ordinary relative Markdown links compatible with Obsidian. No API key is required for concept generation; sign in to the selected website first. See [概念节点使用说明](docs/concept-nodes.md) for settings, storage, and website automation limits.

## Optional AI topic generation

### Answer format preservation

ChatGPT retains its existing converter. Doubao and Yuanbao have separate DOM adapters and use an independent Markdown serializer. The adapters preserve headings, emphasis, nested and task lists, quotes, code languages and whitespace, table alignment and cell breaks, links, images with available URLs, and original TeX formulas. Mermaid is saved as a code block.

Capture uses the answer body and skips toolbars and streaming replies. Formats missing from the website DOM cannot be reconstructed reliably: for example, Yuanbao may render an image as a plain URL or omit footnote identifiers. Load lazy images before capture. Automated checks replay real website DOM through the sandboxed Electron preload, saved Markdown, and reader, with an unchanged ChatGPT output baseline.

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
