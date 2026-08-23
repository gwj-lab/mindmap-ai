# Portable Workspace and Answer Capture Expansion Design

## Purpose

This increment turns Mindmap AI from a single-project MVP into a portable multi-project workspace. It also adds XMind-style node operations, answer-level hover clipping, optional AI-assisted title extraction, expandable candidate subtrees, reversible history, and trash.

The design keeps the application local-first. ChatGPT remains a sandboxed remote page, the Electron main process exclusively owns disk and network access, and exported projects remain readable without Mindmap AI.

## Scope and decisions

- Windows 10/11, one active project at a time, and one ChatGPT web panel remain the first-release boundaries.
- A workspace contains a tree of projects and one shared answer library.
- Projects save a portable Markdown representation and a lossless application representation.
- Standard Markdown links are used instead of Obsidian-only wiki links.
- Hover capture is scoped to exactly one assistant answer and defaults to a 600 ms dwell.
- Users choose either a single candidate node or an expanded candidate subtree.
- OpenAI-compatible HTTPS APIs are optional. Local extraction is always available as a fallback.
- Dragging a map subtree back to the tray means history; explicit deletion means trash.
- Project deletion is reversible and uses the workspace trash.

## Reuse strategy

The existing dependencies remain the implementation foundation:

- `simple-mind-map` supplies map rendering, selection, drag, command history, keyboard navigation, and the native `node_contextmenu` event. The application adds React menus and portable state synchronization rather than replacing the canvas engine.
- `FlexLayout` continues to own dockable local panels. The project navigator is outside the dock tree so users cannot close the only project switcher.
- Electron `WebContentsView`, isolated preload scripts, `safeStorage`, and the main-process network stack provide the remote-page and secret-storage boundaries.
- Mermaid mindmap syntax is generated for broad rendering support, but is not the sole source of truth because its mindmap syntax is still experimental.
- CodeMirror, `react-markdown`, GFM, KaTeX, and the current sanitizer continue to support answer editing and preview.

No new canvas, docking, Markdown editor, or credential-encryption subsystem will be built from scratch.

## Workspace storage model

The user selects or creates a workspace folder. Paths beneath it are derived from validated IDs, never arbitrary renderer input.

```text
MindmapWorkspace/
  workspace.json
  answers/
    <answer-id>.md
  projects/
    <project-id>/
      project.json
      map.md
      mindmap.json
      inbox.md
      history.md
      trash.md
  .trash/
    projects/
      <project-id>/
```

Project directories use immutable UUIDs. A project rename changes the human-readable name in `project.json` and the navigator, but not its directory. This keeps cross-file links and parent-child identity stable.

`workspace.json` stores the workspace identity, the project tree, the last active project, and workspace-level UI preferences. Each project manifest stores `projectId`, `parentProjectId`, name, timestamps, schema version, and read-only migration state. API credentials are not workspace data.

The shared `answers/` directory avoids duplicate Markdown when several projects reference the same captured answer. References are determined by scanning active maps, candidates, history, and trash rather than trusting a mutable reference counter.

### Portable project files

`map.md` is the portable representation. It contains:

1. Front matter with the project title and format version.
2. A standard Markdown nested outline with relative links to answer files.
3. A generated Mermaid mindmap block for compatible viewers.
4. Small HTML comments for stable node UIDs and answer IDs. Viewers ignore these comments, while Mindmap AI uses them for loss-minimized recovery.

`mindmap.json` is the lossless application state for node styles, shape, folding, ordering, viewport, and other `simple-mind-map` properties. If it is missing or invalid, the application reconstructs hierarchy and answer links from `map.md`, applies defaults for unavailable presentation details, and rewrites a repaired JSON file only after user confirmation or a normal save.

`inbox.md`, `history.md`, and `trash.md` are human-readable indexes for candidates, historical subtrees, and deleted project items. Their structured JSON counterparts live in the project state portion of `project.json` or an implementation-selected versioned JSON file; Markdown remains the portable inspection and recovery layer.

Relative links in a live project point to `../../answers/<answer-id>.md`. Exporting one project creates a self-contained folder, copies only answers reachable from its map, candidates, and history, and rewrites links to `answers/<answer-id>.md`.

The repository will add an MIT license and third-party notices. Existing dependency licenses must be verified before that change is committed.

## Project navigator

A collapsible navigator sits at the far left of the application, outside the dock layout. It displays main projects and nested subprojects and supports:

- create main project;
- create child project;
- switch active project;
- rename;
- move to project trash;
- restore or permanently delete;
- open the project folder in Windows Explorer;
- export a self-contained project folder.

Switching first flushes the current project's save queue, then loads the target snapshot. Only one project is active. Breadcrumbs show the active project's ancestry.

Deleting a project moves its directory atomically to `.trash/projects/<project-id>` and records its previous parent and order. Permanent deletion re-scans references across all remaining active and trashed projects. Orphaned answers are reported separately and removed only when the user selects the explicit cleanup option.

## Map node interaction

The map subscribes to `simple-mind-map` context-menu and selection events. Right-clicking a node opens a local React menu with:

- rename node title;
- create child node;
- create sibling node;
- move subtree to history;
- delete subtree;
- open linked answer, when applicable.

The root node cannot be moved or deleted. Moving to history preserves the entire subtree, styles, ordering, UIDs, and answer references. Explicit deletion sends the subtree to trash. Renaming an answer-linked node changes only the node title, not the answer metadata or Markdown body.

Double-click opens the answer reader for an answer-linked node and renames an ordinary node. Answer-node renaming remains available with Space, F2, and the context menu.

The intended XMind-aligned bindings are:

| Action | Binding |
| --- | --- |
| Rename | Space or F2 |
| Add sibling | Enter |
| Add child | Tab |
| Delete branch | Delete |
| Copy, cut, paste | Ctrl+C, Ctrl+X, Ctrl+V |
| Undo, redo | Ctrl+Z, Ctrl+Y |
| Reorder among siblings | Alt+Up, Alt+Down |
| Navigate selection | Arrow keys |
| Toggle fold | Ctrl+Enter |
| Save | Ctrl+S |

Bindings already implemented correctly by the map library are reused. Application handlers cover semantic differences and must not fire while a text editor, answer editor, or menu field owns keyboard focus.

## Answer-level hover clipping

The ChatGPT preload identifies assistant message containers without modifying their content. When the pointer enters one container, it immediately applies a reversible highlight. After approximately 600 ms on the same answer:

1. wait until streaming indicators disappear and normalized content is stable;
2. convert only that assistant answer to Markdown;
3. compute its content hash and check persistent deduplication;
4. save a new answer atomically;
5. create a candidate using the currently selected extraction mode;
6. acknowledge success, duplicate, or failure beside the highlighted answer.

Moving to another answer or leaving before the dwell completes cancels that capture. User prompts, adjacent assistant answers, conversation chrome, and feedback controls are excluded. A duplicate is rejected before an API title request, preventing repeated charges.

The toolbar keeps three controls:

- automatic hover capture on/off;
- capture latest answer;
- point-and-click capture fallback.

With automatic capture off, hover highlighting remains available but no answer is saved. Capture failures never write partial Markdown and never disable the ChatGPT page or local workspace.

The captured-answer acknowledgement is transactional from the page's perspective: the page receives success only after the answer is stored and a candidate exists. If the application crashes after storing the answer but before adding the candidate, startup reconciliation restores the unreferenced answer to the inbox.

## Single and expanded candidates

The AI panel offers two direct modes:

- **Single node** extracts one main title and creates one candidate.
- **Generate child nodes** extracts a main title and up to 12 ordered subtitles, producing a previewable candidate subtree.

The title source is configurable as local, API, or automatic. Automatic prefers the configured API and falls back to the local extractor on missing configuration, timeout, network error, invalid JSON, empty output, or schema violation. The default is single node plus automatic extraction.

The local extractor prefers Markdown headings, then meaningful first sentences and list items. Expanded local extraction uses headings and top-level list items, removes duplicates, applies display-width limits, and falls back to paragraph sentences.

Expanded candidates can be edited before insertion: rename the root or children, remove children, and reorder them. Dropping the candidate on a map node creates its full subtree in one undoable command and consumes the inbox item.

## OpenAI-compatible API and secrets

Settings contain an HTTPS Base URL, model name, request timeout, extraction source, and API key. The main process validates and performs all requests. The renderer receives only non-secret settings and `hasApiKey`.

The API key is encrypted through Electron `safeStorage`, backed by Windows DPAPI, and stored beneath Electron's per-user application data. It is never written to workspace files, exports, renderer state, logs, crash reports, or remote-page IPC. Changing the Base URL requires confirmation before the existing key can be sent to the new origin.

Requests use a strict system prompt and expect:

```json
{
  "title": "Main title",
  "subtitles": ["Child one", "Child two"]
}
```

Responses are validated with Zod, capped in bytes, limited to one title and at most 12 subtitles, trimmed, deduplicated, and display-width limited. Timeouts abort the request. API failure affects title quality only; it never rolls back the already saved answer or prevents candidate creation.

## Inbox, history, and trash

The local tray has three tabs:

- **Candidates** contains newly captured, unused answers or subtrees.
- **History** contains map subtrees deliberately dragged or moved out of the active map.
- **Trash** contains explicitly deleted candidates, historical subtrees, map subtrees, and project-local records.

Candidate drops create a child or child subtree and remove the candidate. Historical subtree drops restore the exact hierarchy, UIDs, styles, and answer references beneath the chosen parent. Invalid drops do not mutate either side.

Dragging a non-root map node or subtree onto History removes it from the map and records its prior parent and ordering for restoration. A context-menu action provides the same operation as an accessible fallback. During cross-panel drag, the native AI view is temporarily covered by the existing local placeholder so it cannot intercept pointer or drop events.

Candidate and history cards expose delete buttons that move them to Trash. Trash supports restore and permanent deletion. Permanent deletion of a record removes its answer Markdown only if a fresh workspace-wide reference scan finds no active, historical, candidate, trashed, or other-project references. Otherwise only the trash record is removed.

## Save, reconciliation, and migration

Workspace and active-project changes use serialized queues with approximately 600 ms debounce, temporary files, and atomic replacement. Ctrl+S flushes both queues. UI status reports saving, saved, and failed states. Project switching flushes before loading the next project.

Every committed map mutation regenerates `mindmap.json` and `map.md`; tray mutations regenerate their portable indexes. Generation is deterministic so unchanged content does not create noisy file diffs.

Startup reconciliation repairs safe inconsistencies:

- answers used by map nodes cannot remain in the candidate inbox;
- stored answers with no active map, candidate, history, trash, or other-project reference are restored as candidates in the last owning project when ownership metadata is available;
- missing answer files keep their nodes and display `Content missing`;
- invalid lossless JSON falls back to the portable Markdown outline;
- schema migrations back up affected JSON before conversion;
- unsafe migrations open read-only and generate an error report.

## Security boundaries

- ChatGPT keeps sandboxing enabled, context isolation enabled, and Node integration disabled.
- The remote preload can send only schema-validated answer payloads and adapter status. It cannot read projects, settings, credentials, or arbitrary files.
- IPC handlers validate the sender frame and every payload.
- Workspace paths are chosen through system dialogs; children are resolved from validated UUIDs and verified to remain below the selected root.
- Markdown preview sanitizes scripts, inline handlers, dangerous protocols, and unsafe HTML. Remote images remain HTTPS links and are not downloaded.
- External navigation uses the existing allowlist and system-browser confirmation flow.
- A changed ChatGPT DOM degrades capture features without preventing map and saved-answer work.

## Verification strategy

Implementation follows failing test, minimal implementation, passing test for each behavior.

Unit and contract coverage includes:

- workspace/project schemas, stable project identity, safe path resolution, atomic moves, and migrations;
- portable Markdown generation and recovery, deterministic Mermaid, relative-link rewriting, and export reachability;
- project switching, trash restore, orphan answer scans, and cross-project reference safety;
- context-menu commands and map/history subtree round trips;
- local single/expanded extraction, API response validation, fallbacks, and encrypted secret boundaries;
- hover dwell cancellation, one-answer scoping, streaming stability, persistent deduplication, and capture acknowledgements;
- candidate/history/trash deletion and restoration.

Renderer and end-to-end coverage includes:

- project tree creation, nested projects, switching, rename, trash, restore, and persisted selection;
- context menus and XMind-style shortcuts without conflicts in text editors;
- automatic hover capture in a multi-turn fixture, plus latest and point-select fallback;
- single and expanded candidate editing and drop;
- map subtree drag to History and lossless restoration;
- API success and all local fallback paths;
- deletion of `mindmap.json` followed by recovery from `map.md`;
- self-contained export opened as Markdown with valid answer links;
- offline editing, switching, saving, and recovery.

Windows manual acceptance additionally verifies real ChatGPT login persistence and hover capture, Windows DPAPI-backed API key storage, Explorer integration, Obsidian rendering, and restart recovery. Real credentials and ChatGPT login remain outside CI.

## Delivery sequence

The implementation will be staged so each checkpoint remains usable:

1. versioned workspace/project schemas and portable serializers;
2. workspace store, project navigator, switching, and export;
3. node menu, keyboard semantics, history, and trash;
4. hover capture protocol and adapter fixtures;
5. local single/expanded extraction and candidate subtree UI;
6. encrypted OpenAI-compatible settings and API fallback;
7. reconciliation, migrations, security regression tests, documentation, and licenses.

No installer, signing, auto-update, additional providers, or automatic prompt submission is added in this increment.
