# Portable Workspace and Capture Expansion Implementation Plan

> **For Codex:** Execute this plan task by task with test-driven development. For every behavior, observe the named test fail before editing production code, then run the narrow test, the relevant suite, and commit the checkpoint. Do not batch unrelated tasks into one commit.

**Goal:** Add portable multi-project workspaces, XMind-style node operations, answer-scoped hover capture, optional AI title/subtitle extraction, candidate subtrees, history, and reversible trash without weakening the existing Electron security boundary.

**Architecture:** Replace the single-folder global store with a `WorkspaceStore` that owns a workspace index, shared answer repository, and one active `ProjectStore`. Keep lossless JSON per project while deterministically generating portable Markdown and Mermaid. Remote ChatGPT code only extracts one answer and receives a typed acknowledgement; candidate creation, API calls, disk writes, reference checks, and credentials stay in the main process. Renderer state uses pure tree/tray transitions so every drag, restore, and delete is independently testable.

**Tech stack:** Electron 43, React 19, TypeScript 6, Vite 7, Zustand, Zod, simple-mind-map, FlexLayout, Vitest, Testing Library, Playwright, Markdown/GFM, Mermaid text generation, Electron `safeStorage` and `net.fetch`.

**Design reference:** `docs/superpowers/specs/2026-08-18-portable-workspace-and-capture-design.md`

---

## Task 1: Freeze version-2 domain types and schemas

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/shared/project.ts`
- Modify: `src/shared/ipc.ts`
- Create: `src/shared/workspace.ts`
- Create: `tests/shared/workspace.test.ts`
- Modify: `tests/shared/project.test.ts`

**Step 1: Write failing schema tests**

Cover:

- `WorkspaceManifest` version 2 with workspace ID, name, active project ID, ordered project records, and project trash records;
- project records with immutable UUID, optional `parentProjectId`, display name, timestamps, and order;
- `ProjectState` version 2 with dock layout, candidates, history, trash, and preferences;
- single and expanded candidates with at most 12 child titles;
- historical subtree and discriminated trash entries;
- recursive node validation and root invariants;
- rejection of path fragments, malformed IDs, duplicate project IDs, circular parents, and overlong titles.

Run `pnpm vitest run tests/shared/workspace.test.ts tests/shared/project.test.ts` and confirm failure.

**Step 2: Add the minimal types and Zod schemas**

Introduce explicit models instead of extending the old `WorkspaceState` ambiguously:

```ts
interface WorkspaceManifest {
  schemaVersion: 2;
  workspaceId: string;
  name: string;
  activeProjectId: string | null;
  projects: WorkspaceProjectRecord[];
  projectTrash: TrashedProjectRecord[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectState {
  schemaVersion: 2;
  dockLayout: unknown;
  candidates: CandidateNode[];
  history: HistoryEntry[];
  trash: ProjectTrashEntry[];
  uiPreferences: UiPreferences;
}
```

Give candidates an ordered `children` array and `extractionMode: "single" | "expanded"`. Store complete `MindMapNodeData` in history/trash subtree entries. Keep `ProjectSnapshot` renderer-friendly but add workspace summary and active project state explicitly.

Add typed IPC request/response schemas, including a capture acknowledgement union:

```ts
type CaptureAcknowledgement =
  | { status: "captured"; answer: AnswerDocument; candidate: CandidateNode }
  | { status: "duplicate"; answerId: string }
  | { status: "failed"; message: string };
```

**Step 3: Run tests and typecheck**

Run:

```powershell
pnpm vitest run tests/shared/workspace.test.ts tests/shared/project.test.ts
pnpm typecheck
```

Update existing fixtures only where the intentional version-2 shape requires it.

**Step 4: Commit**

```powershell
git add src/shared/types.ts src/shared/project.ts src/shared/ipc.ts src/shared/workspace.ts tests/shared/workspace.test.ts tests/shared/project.test.ts
git commit -m "feat: define portable workspace domain model"
```

## Task 2: Build deterministic portable map serializers

**Files:**

- Create: `src/shared/portable-map.ts`
- Create: `tests/shared/portable-map.test.ts`
- Create: `tests/fixtures/portable-map/linked-tree.md`
- Create: `tests/fixtures/portable-map/special-characters.md`

**Step 1: Write failing round-trip tests**

Test:

- nested outline generation with `../../answers/<id>.md` links;
- HTML metadata comments for UID and answer ID;
- deterministic Mermaid indentation and escaping;
- Chinese, punctuation, quotes, brackets, and multiline titles;
- parse generated `map.md` back into hierarchy and answer references;
- tolerate a viewer removing the Mermaid block;
- reject duplicate UIDs and unsafe answer paths;
- byte-identical output for identical input.

Run `pnpm vitest run tests/shared/portable-map.test.ts` and confirm failure.

**Step 2: Implement pure serialization and recovery**

Export focused functions:

```ts
serializePortableMap(project, root): string
parsePortableMap(markdown): MindMapNodeData
serializeTrayIndex(kind, entries): string
rewriteProjectLinksForExport(markdown): string
```

Generate Markdown outline and Mermaid from the same normalized tree. Never parse Mermaid as the recovery source. Escape link labels without altering visible node text.

**Step 3: Run narrow and shared suites**

```powershell
pnpm vitest run tests/shared/portable-map.test.ts
pnpm vitest run tests/shared
pnpm typecheck
```

**Step 4: Commit**

```powershell
git add src/shared/portable-map.ts tests/shared/portable-map.test.ts tests/fixtures/portable-map
git commit -m "feat: serialize portable mind map markdown"
```

## Task 3: Split storage into workspace, project, and shared-answer repositories

**Files:**

- Create: `src/main/answer-repository.ts`
- Create: `src/main/workspace-store.ts`
- Modify: `src/main/project-store.ts`
- Create: `tests/main/workspace-store.test.ts`
- Modify: `tests/main/project-store.test.ts`

**Step 1: Write failing filesystem tests**

Use temporary directories to verify:

- workspace initialization creates `workspace.json`, `answers/`, `projects/<uuid>/`, and all six project files;
- project directories are UUID-derived and cannot escape the workspace;
- rename changes metadata, not directory name;
- shared answers are visible to two projects;
- project save writes `project.json`, `mindmap.json`, `map.md`, `inbox.md`, `history.md`, and `trash.md` through one serial queue;
- concurrent saves resolve in call order;
- missing `mindmap.json` loads from `map.md`;
- malformed portable recovery opens read-only with an error report.

Run `pnpm vitest run tests/main/workspace-store.test.ts tests/main/project-store.test.ts` and confirm failure.

**Step 2: Extract `AnswerRepository`**

Move answer parsing, front matter validation, atomic writes, list/read operations, and ID-safe path resolution out of `ProjectStore`. Point it at the workspace `answers/` directory.

**Step 3: Refactor `ProjectStore`**

Make it accept a validated project directory and shared `AnswerRepository`. Save lossless and portable files deterministically. Preserve the existing serialized write-tail behavior.

**Step 4: Implement `WorkspaceStore`**

Own project indexing, active-project selection, parent validation, create child/sibling, rename, and snapshot assembly. Flush the active project before switching.

**Step 5: Run tests**

```powershell
pnpm vitest run tests/main/workspace-store.test.ts tests/main/project-store.test.ts
pnpm vitest run tests/main/capture-service.test.ts
pnpm typecheck
```

**Step 6: Commit**

```powershell
git add src/main/answer-repository.ts src/main/workspace-store.ts src/main/project-store.ts tests/main/workspace-store.test.ts tests/main/project-store.test.ts tests/main/capture-service.test.ts
git commit -m "feat: add multi-project workspace storage"
```

## Task 4: Migrate legacy single-project folders safely

**Files:**

- Create: `src/main/workspace-migration.ts`
- Create: `tests/main/workspace-migration.test.ts`
- Modify: `src/main/workspace-store.ts`

**Step 1: Write failing migration tests**

Create a fixture matching the current version-1 layout and assert:

- migration first creates a timestamped backup;
- the old answer files move or copy into shared `answers/` without content changes;
- the legacy map, candidates, dock layout, and preferences appear in one generated project;
- interruption leaves the original loadable;
- unsupported or ambiguous input opens read-only and writes an error report;
- a second migration call is idempotent.

Run `pnpm vitest run tests/main/workspace-migration.test.ts` and confirm failure.

**Step 2: Implement staged migration**

Write into a temporary version-2 workspace subtree, validate it by loading, then atomically install the new index. Do not delete the legacy source files.

**Step 3: Run tests and commit**

```powershell
pnpm vitest run tests/main/workspace-migration.test.ts tests/main/workspace-store.test.ts
git add src/main/workspace-migration.ts src/main/workspace-store.ts tests/main/workspace-migration.test.ts
git commit -m "feat: migrate legacy projects to workspaces"
```

## Task 5: Expose narrow workspace and project IPC

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload/app.ts`
- Modify: `src/main/index.ts`
- Create: `tests/main/ipc-contract.test.ts`

**Step 1: Write failing IPC contract tests**

Cover the `DesktopApi` methods:

```ts
workspace.create()
workspace.open()
workspace.getSummary()
project.create(parentProjectId?)
project.switch(projectId)
project.rename(projectId, name)
project.moveToTrash(projectId)
project.restore(projectId)
project.permanentlyDelete(projectId, cleanupOrphans)
project.export(projectId)
project.openInExplorer(projectId)
```

Assert sender validation, UUID-only identifiers, payload size limits, and that renderer input never supplies a filesystem child path.

Run `pnpm vitest run tests/main/ipc-contract.test.ts` and confirm failure.

**Step 2: Implement the IPC bridge**

Keep root selection behind Electron folder dialogs. Register handlers once, delegate to `WorkspaceStore`, and return schemas parsed at the boundary. Use Electron `shell.showItemInFolder` only with a store-resolved path.

**Step 3: Run security and type tests**

```powershell
pnpm vitest run tests/main/ipc-contract.test.ts tests/shared/security.test.ts
pnpm typecheck
```

**Step 4: Commit**

```powershell
git add src/shared/ipc.ts src/shared/types.ts src/preload/app.ts src/main/index.ts tests/main/ipc-contract.test.ts
git commit -m "feat: expose secure workspace project API"
```

## Task 6: Add the persistent project navigator

**Files:**

- Create: `src/renderer/src/components/ProjectNavigator.tsx`
- Create: `tests/renderer/ProjectNavigator.test.tsx`
- Modify: `src/renderer/src/state/use-project.ts`
- Modify: `tests/renderer/use-project.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Step 1: Write failing renderer tests**

Test nested rendering, active-project indication, collapse state, breadcrumbs, create main/child, rename, switch after save flush, project trash confirmation, restore, Explorer, and export actions. Verify switching resets open answer state and loads the target dock layout.

Run `pnpm vitest run tests/renderer/ProjectNavigator.test.tsx tests/renderer/use-project.test.ts` and confirm failure.

**Step 2: Extend the Zustand store**

Separate workspace summary from active project snapshot. Add serialized `switchProject` so a second click cannot interleave with the first save/load. Keep dirty/save/error status scoped to the active project.

**Step 3: Implement the navigator UI**

Use a compact resizable/collapsible rail outside `.dock-workspace`. Provide keyboard-accessible tree semantics and a small context menu. Do not overload the map canvas with project navigation.

**Step 4: Run tests and commit**

```powershell
pnpm vitest run tests/renderer/ProjectNavigator.test.tsx tests/renderer/use-project.test.ts
pnpm typecheck
git add src/renderer/src/components/ProjectNavigator.tsx src/renderer/src/state/use-project.ts src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/ProjectNavigator.test.tsx tests/renderer/use-project.test.ts
git commit -m "feat: add nested project navigator"
```

## Task 7: Implement project trash, reference scanning, and standalone export

**Files:**

- Create: `src/main/reference-scanner.ts`
- Create: `src/main/project-exporter.ts`
- Modify: `src/main/workspace-store.ts`
- Create: `tests/main/reference-scanner.test.ts`
- Create: `tests/main/project-exporter.test.ts`

**Step 1: Write failing storage tests**

Verify:

- moving a project to `.trash/projects/<id>` and restoring its old parent/order;
- permanent deletion refuses accidental broad paths;
- an answer shared by active, historical, candidate, trashed, or another project is never classified orphaned;
- standalone export copies only reachable answers;
- exported links resolve inside the export folder;
- export does not include API settings, recovery backups, or unrelated answers.

Run the two new tests and confirm failure.

**Step 2: Implement scanner and exporter**

Resolve every target from validated workspace/project IDs. Before recursive move or deletion on Windows, compare resolved absolute paths with the intended `projects` or `.trash/projects` parent. Use one native Node filesystem flow end to end.

**Step 3: Run tests and commit**

```powershell
pnpm vitest run tests/main/reference-scanner.test.ts tests/main/project-exporter.test.ts tests/main/workspace-store.test.ts
git add src/main/reference-scanner.ts src/main/project-exporter.ts src/main/workspace-store.ts tests/main/reference-scanner.test.ts tests/main/project-exporter.test.ts
git commit -m "feat: add safe project trash and portable export"
```

## Task 8: Add pure subtree, history, and trash transitions

**Files:**

- Modify: `src/renderer/state/project-state.ts`
- Modify: `tests/renderer/project-state.test.ts`

**Step 1: Write failing state-transition tests**

Test pure functions for:

- rename by UID;
- create child and sibling;
- remove a non-root subtree;
- move subtree to history with original parent and order;
- restore history below a chosen parent without losing style or `answerId`;
- send map, candidate, or history items to trash;
- restore trash to the correct collection;
- expanded candidate insertion as one subtree;
- invalid target, root move, UID collision, and stale item are no-ops;
- every transition leaves the input immutable.

Run `pnpm vitest run tests/renderer/project-state.test.ts` and confirm failure.

**Step 2: Implement minimal pure operations**

Use shared recursive helpers such as `detachSubtree`, `appendSubtree`, `findNode`, `containsUid`, and `replaceNode`. Generate new UIDs only for a newly inserted candidate; preserve UIDs for history restoration.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/renderer/project-state.test.ts
pnpm typecheck
git add src/renderer/state/project-state.ts tests/renderer/project-state.test.ts
git commit -m "feat: add reversible map subtree transitions"
```

## Task 9: Add node context menu and XMind-style shortcuts

**Files:**

- Create: `src/renderer/src/components/NodeContextMenu.tsx`
- Create: `tests/renderer/NodeContextMenu.test.tsx`
- Modify: `src/renderer/src/components/MindMapPanel.tsx`
- Modify: `src/renderer/simple-mind-map.d.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Step 1: Write failing UI/command tests**

Test menu position clamping, root-disabled actions, answer-only open command, rename focus, Escape dismissal, outside-click dismissal, and callbacks for history/trash. Add keyboard tests for Space/F2, Enter, Tab, Delete, Alt+Up/Down, arrows, Ctrl+Enter, and editor-focus suppression.

Run the renderer test and confirm failure.

**Step 2: Subscribe to map events**

Use the library's `node_contextmenu`, selection, and data events. Route destructive semantic operations through pure state functions rather than directly issuing `REMOVE_NODE`, so history/trash are persisted. Reuse library commands for undo/redo, copy/paste, navigation, zoom, and supported inserts.

**Step 3: Implement menu and shortcut guard**

Create one `isEditableTarget` guard shared by app-level and map-level shortcuts. Answer-node double-click continues opening the reader; ordinary-node double-click continues editing.

**Step 4: Run tests and commit**

```powershell
pnpm vitest run tests/renderer/NodeContextMenu.test.tsx tests/renderer/project-state.test.ts
pnpm typecheck
git add src/renderer/src/components/NodeContextMenu.tsx src/renderer/src/components/MindMapPanel.tsx src/renderer/simple-mind-map.d.ts src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/NodeContextMenu.test.tsx
git commit -m "feat: add XMind-style node actions"
```

## Task 10: Turn the candidate panel into Candidates, History, and Trash

**Files:**

- Rename: `src/renderer/src/components/CandidateTray.tsx` to `src/renderer/src/components/NodeTray.tsx`
- Create: `tests/renderer/NodeTray.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/MindMapPanel.tsx`
- Modify: `src/renderer/src/styles.css`

**Step 1: Write failing tray tests**

Cover tab counts, candidate rename/delete, expanded preview, child reorder/remove, history subtree preview, restore drag payloads, trash restore/permanent-delete confirmation, and read-only disabling.

Add a drag integration test proving a map subtree dropped on History invokes exactly one state transition and an invalid drop invokes none.

Run `pnpm vitest run tests/renderer/NodeTray.test.tsx` and confirm failure.

**Step 2: Implement typed drag payloads**

Use separate MIME types for candidate, history, and map subtree. Continue calling `beginLocalDrag`/`endLocalDrag` for every path so `WebContentsView` stays covered.

**Step 3: Implement tray UI**

Keep titles readable, actions discoverable, and trash visually distinct. Provide “移到历史” in the node context menu as the keyboard/accessibility fallback for drag.

**Step 4: Run tests and commit**

```powershell
pnpm vitest run tests/renderer/NodeTray.test.tsx tests/renderer/project-state.test.ts
pnpm typecheck
git add src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/NodeTray.test.tsx
git commit -m "feat: add candidate history and trash tray"
```

## Task 11: Define answer-scoped hover capture behavior in pure adapter code

**Files:**

- Modify: `src/preload/chatgpt-adapter.ts`
- Modify: `tests/preload/chatgpt-adapter.test.ts`
- Create: `tests/fixtures/chatgpt/multi-turn.html`
- Create: `tests/fixtures/chatgpt/streaming-turn.html`

**Step 1: Write failing adapter contract tests**

Test:

- `findAssistantMessage(target)` returns only the containing assistant turn;
- a user turn and conversation wrapper return null;
- extraction excludes adjacent turns and controls;
- streaming state blocks capture;
- stable normalized content becomes capturable;
- identity uses URL, message ID, and hash;
- acknowledgement states are retained only after confirmed delivery;
- duplicate delivery returns `duplicate` without retrying work;
- rejected or failed delivery can be retried.

Run `pnpm vitest run tests/preload/chatgpt-adapter.test.ts` and confirm failure.

**Step 2: Implement DOM helpers and delivery state machine**

Keep selectors centralized and ordered from most specific to conservative fallbacks. Never treat `article` alone as an assistant answer without verifying its author role. Return the main-process acknowledgement to the caller.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/preload/chatgpt-adapter.test.ts tests/shared/content.test.ts
pnpm typecheck
git add src/preload/chatgpt-adapter.ts tests/preload/chatgpt-adapter.test.ts tests/fixtures/chatgpt
git commit -m "test: define answer-scoped ChatGPT capture"
```

## Task 12: Implement the 600 ms hover clipper and page acknowledgement UI

**Files:**

- Modify: `src/preload/chatgpt.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ai-view-manager.ts`
- Create: `tests/preload/hover-capture.test.ts`

**Step 1: Write failing fake-timer tests**

Verify immediate highlight, 600 ms dwell, cancellation on leave or new target, waiting for stream completion, one target at a time, auto-capture disabled behavior, and status badges for captured/duplicate/failed. Confirm DOM classes and badges are removed without deleting ChatGPT content.

Run `pnpm vitest run tests/preload/hover-capture.test.ts` and confirm failure.

**Step 2: Implement hover controller**

Replace the global mutation-driven “latest” automatic capture with pointer-scoped scheduling. Mutation observation may re-check stability for the currently hovered answer only. Keep manual latest and picker fallbacks.

Add a one-way IPC command for enabling/disabling hover capture. Keep user preference local to the active project but do not expose project state to the remote preload.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/preload/hover-capture.test.ts tests/preload/chatgpt-adapter.test.ts
pnpm typecheck
git add src/preload/chatgpt.ts src/shared/ipc.ts src/main/ai-view-manager.ts tests/preload/hover-capture.test.ts
git commit -m "feat: capture the hovered ChatGPT answer"
```

## Task 13: Implement local single and expanded title extraction

**Files:**

- Create: `src/shared/title-extraction.ts`
- Create: `tests/shared/title-extraction.test.ts`
- Modify: `src/shared/content.ts`

**Step 1: Write failing extraction tests**

Cover headings, first meaningful sentence, Chinese punctuation, code-first answers, tables, top-level lists, duplicate headings, empty input, display-width truncation, stable ordering, and the 12-child maximum.

Run `pnpm vitest run tests/shared/title-extraction.test.ts` and confirm failure.

**Step 2: Implement deterministic extractors**

Export:

```ts
extractSingleTitle(markdown): string
extractExpandedTitles(markdown): { title: string; subtitles: string[] }
```

Do not require a Markdown parser dependency for this narrow task unless tests demonstrate the existing content utilities cannot handle it safely.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/shared/title-extraction.test.ts tests/shared/content.test.ts
git add src/shared/title-extraction.ts src/shared/content.ts tests/shared/title-extraction.test.ts
git commit -m "feat: extract local candidate titles"
```

## Task 14: Store API credentials securely and call compatible APIs in main

**Files:**

- Create: `src/main/settings-store.ts`
- Create: `src/main/title-service.ts`
- Create: `tests/main/settings-store.test.ts`
- Create: `tests/main/title-service.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/app.ts`
- Modify: `src/main/index.ts`

**Step 1: Write failing secret-storage tests**

Inject a fake `safeStorage` adapter and verify:

- plaintext keys never appear in persisted settings or returned renderer data;
- unavailable encryption produces an actionable error and does not save plaintext;
- decrypt failure requires re-entry;
- clearing the key removes encrypted bytes;
- changing Base URL requires explicit confirmation.

**Step 2: Write failing title-service tests**

Inject a fake fetch function and test HTTPS-only URL validation, request timeout/abort, model and JSON body, maximum response size, Zod parsing, 12-child cap, malformed response fallback, empty response fallback, and no retry that could double-charge.

Run both tests and confirm failure.

**Step 3: Implement secure settings**

Persist non-secret settings in Electron user data and encrypted key bytes separately. Renderer APIs expose `getPublicSettings`, `updatePublicSettings`, `setApiKey`, and `clearApiKey`.

**Step 4: Implement `TitleService`**

Use Electron main-process `net.fetch` or an injected compatible fetch. Resolve the OpenAI-compatible endpoint from a normalized HTTPS Base URL. Send only the captured answer needed for extraction, with a documented size cap. Parse the strict response and fall back to Task 13 extractors for every failure.

**Step 5: Run security tests and commit**

```powershell
pnpm vitest run tests/main/settings-store.test.ts tests/main/title-service.test.ts tests/shared/security.test.ts
pnpm typecheck
git add src/main/settings-store.ts src/main/title-service.ts src/shared/types.ts src/shared/ipc.ts src/preload/app.ts src/main/index.ts tests/main/settings-store.test.ts tests/main/title-service.test.ts
git commit -m "feat: add secure AI title extraction"
```

## Task 15: Make capture persistence and candidate creation one acknowledged operation

**Files:**

- Modify: `src/main/capture-service.ts`
- Modify: `tests/main/capture-service.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/state/project-state.ts`

**Step 1: Write the regression tests first**

Reproduce the reported failure explicitly:

- after a new answer capture acknowledgement, the active project's persisted candidates contain exactly one matching entry;
- renderer notification does not need to reconstruct the candidate;
- API extraction failure still persists a locally titled candidate;
- expanded mode persists ordered child titles;
- duplicate hash returns `duplicate`, performs no API call, and creates no second candidate;
- failure before answer write leaves neither answer nor candidate;
- interruption after answer write is repaired on reload.

Run `pnpm vitest run tests/main/capture-service.test.ts` and confirm failure.

**Step 2: Refactor capture transaction ordering**

Perform: convert/hash validation, persistent dedupe, atomic answer write, title extraction, project candidate write, then acknowledgement. If candidate persistence fails after the answer write, return failure and rely on reconciliation; never return a false success.

Emit the typed acknowledgement and refresh or patch renderer state from the persisted candidate supplied by main. Remove the current renderer-only `addCapturedAnswer` responsibility.

**Step 3: Run regression suites and commit**

```powershell
pnpm vitest run tests/main/capture-service.test.ts tests/renderer/project-state.test.ts tests/renderer/use-project.test.ts
pnpm typecheck
git add src/main/capture-service.ts src/main/index.ts src/shared/ipc.ts src/renderer/src/App.tsx src/renderer/state/project-state.ts tests/main/capture-service.test.ts
git commit -m "fix: persist every captured candidate transactionally"
```

## Task 16: Add capture-mode controls, expanded candidate editing, and API settings UI

**Files:**

- Modify: `src/renderer/src/components/AiPanel.tsx`
- Create: `src/renderer/src/components/AiSettingsDialog.tsx`
- Create: `tests/renderer/AiPanel.test.tsx`
- Create: `tests/renderer/AiSettingsDialog.test.tsx`
- Modify: `src/renderer/src/components/NodeTray.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Step 1: Write failing component tests**

Test:

- single/expanded buttons update the active project capture mode;
- auto-hover toggle sends its state to the page;
- settings show only masked key status;
- save validates HTTPS Base URL and model;
- Base URL change confirmation is required when a key exists;
- API failure message explains local fallback without blocking capture;
- expanded candidate root/child edits, reorder, remove, and final subtree drop.

Run the three renderer tests and confirm failure.

**Step 2: Implement focused controls**

Keep the AI toolbar compact: auto-capture toggle, Single node, Generate child nodes, latest capture, point-select, and settings. Put endpoint details in the dialog, not the toolbar. Candidate cards disclose child previews progressively.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/renderer/AiPanel.test.tsx tests/renderer/AiSettingsDialog.test.tsx tests/renderer/NodeTray.test.tsx
pnpm typecheck
git add src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/AiPanel.test.tsx tests/renderer/AiSettingsDialog.test.tsx tests/renderer/NodeTray.test.tsx
git commit -m "feat: add capture modes and API settings UI"
```

## Task 17: Reconciliation, autosave, and crash-recovery hardening

**Files:**

- Create: `src/main/workspace-reconciler.ts`
- Create: `tests/main/workspace-reconciler.test.ts`
- Modify: `src/main/workspace-store.ts`
- Modify: `src/main/project-store.ts`
- Modify: `src/renderer/src/state/use-project.ts`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Write failing recovery tests**

Cover linked answers lingering in inbox, orphan answers missing from all trays, missing answer files, cross-project ownership, interrupted project switch, simultaneous workspace/project dirty state, Ctrl+S flush, and failed-save status.

Run `pnpm vitest run tests/main/workspace-reconciler.test.ts tests/renderer/use-project.test.ts` and confirm failure.

**Step 2: Implement reconciliation and queue flushing**

Run reconciliation on workspace open and after an unclean capture. Never infer deletion from a missing reference alone. Choose the last owning project from answer metadata or capture journal; otherwise place the orphan in the active project's inbox and report the repair.

Use one debounced coordinator in renderer state so active project and workspace index save in order. Ctrl+S and project switching await the same flush method.

**Step 3: Run and commit**

```powershell
pnpm vitest run tests/main/workspace-reconciler.test.ts tests/main/workspace-store.test.ts tests/renderer/use-project.test.ts
pnpm typecheck
git add src/main/workspace-reconciler.ts src/main/workspace-store.ts src/main/project-store.ts src/renderer/src/state/use-project.ts src/renderer/src/App.tsx tests/main/workspace-reconciler.test.ts tests/renderer/use-project.test.ts
git commit -m "feat: reconcile and recover workspace state"
```

## Task 18: Add end-to-end fixtures and portable-workspace acceptance coverage

**Files:**

- Modify: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/portable-workspace.spec.ts`
- Create: `tests/e2e/hover-capture.spec.ts`
- Modify: `playwright.config.ts` if isolated fixture startup requires it

**Step 1: Write failing E2E tests**

Automate local deterministic scenarios:

- create workspace, main project, and subproject; switch and restore layout;
- invoke node context menu and shortcuts;
- capture exactly the hovered assistant answer in a multi-turn fixture;
- see a candidate immediately after acknowledgement;
- insert single and expanded candidates;
- move a subtree to history and restore it;
- trash and restore candidate/project records;
- reopen and confirm persisted map, tray, project tree, and active selection;
- remove `mindmap.json`, reopen, and confirm Markdown recovery;
- export and verify every relative answer link exists.

Run the new specs and confirm failure before filling any missing integration glue.

**Step 2: Add only the minimal integration fixes**

Do not add test-only production branches. Use fixture pages through the same adapter and IPC contracts where possible; real ChatGPT login remains manual-only.

**Step 3: Run full verification**

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Record test counts and any environment-specific skip with a reason.

**Step 4: Commit**

```powershell
git add tests/e2e playwright.config.ts src
git commit -m "test: cover portable workspace capture workflow"
```

## Task 19: Add licenses, portability documentation, and manual Windows checklist

**Files:**

- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`
- Create: `docs/portable-project-format.md`
- Create: `docs/windows-acceptance-checklist.md`
- Modify: `package.json`

**Step 1: Verify licenses before writing notices**

Use installed package metadata and upstream license files to verify every production dependency used in distribution. Stop and document any incompatible or unclear license instead of guessing.

**Step 2: Document the user workflow and format**

Explain:

- development startup and test commands;
- workspace versus project folders;
- shared-answer behavior and standalone export;
- how Obsidian and generic Markdown viewers open `map.md` and answers;
- Mermaid limitations and JSON fallback;
- API configuration, DPAPI scope, local fallback, and key removal;
- project/tray trash and orphan cleanup semantics;
- migration and recovery directories.

**Step 3: Add MIT license and notices**

Change `package.json` from private-only metadata as appropriate for source release, but do not publish a package or build an installer.

**Step 4: Perform final verification-before-completion**

Run:

```powershell
git diff --check
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
git status --short
```

Then execute the manual checklist on Windows with a real ChatGPT session and, if the user configures one, a disposable API key. Verify API key plaintext is absent from the workspace and exported folder.

**Step 5: Commit**

```powershell
git add LICENSE THIRD_PARTY_NOTICES.md README.md docs/portable-project-format.md docs/windows-acceptance-checklist.md package.json
git commit -m "docs: publish portable workspace format"
```

## Completion gate

The increment is complete only when:

- all unit, contract, renderer, build, lint, and E2E commands pass;
- the reported “capture succeeded but candidate is missing” regression has a passing persistence test;
- no renderer or remote page can read an API key or submit arbitrary paths;
- an exported project opens with working Markdown answer links outside the source workspace;
- history/trash/project restoration preserves hierarchy and answer references;
- real Windows ChatGPT hover capture is manually confirmed;
- the worktree contains no unintended files or unrelated user changes.
