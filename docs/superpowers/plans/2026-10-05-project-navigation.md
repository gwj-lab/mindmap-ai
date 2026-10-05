# Project Navigation Implementation Plan

**Goal:** Link mind-map nodes to child-project centers and reparent projects by dragging the sidebar.

**Architecture:** Extend the existing workspace store, validated Electron IPC bridge and React tree. Use native HTML drag/drop; keep UUID project directories unchanged. Store an optional `linkedProjectId` on map nodes, retaining existing answer links and branches.

**Tech Stack:** Existing TypeScript, React, Zustand, Zod, simple-mind-map, Vitest and Playwright.

## Tasks

- [x] Add `project.reparent(projectId, parentProjectId)` returning `WorkspaceOpenResult`. Validate active IDs, reject self/descendant parenting, persist both project and workspace manifests, and protect canonical ancestry from stale saves. Test reload, active edits and invalid operations in `tests/main/workspace-store.test.ts`.
- [x] Add `project.linkNode(nodeUid, {kind:'create', name} | {kind:'existing', projectId})`. New projects copy the selected node/subtree as their center; existing projects retain their map and become children of the source project. The source node becomes an entrance displaying the target center title. Keep source branches/answers. Validate read-only projects and all IDs before writes. Persist node links through `portable-map.ts` and test recovery from Markdown.
- [x] Add node context-menu actions and a small selection dialog. Double-click linked nodes switches project before answer-reader behavior; the original answer stays available through the context menu. Add sidebar drag targets and a workspace-level target for detaching back to the top level; expand the destination after a successful drop. Save pending edits before either operation.
- [x] Run store/renderer regressions, typecheck/lint/build and a real Electron interaction test for node creation, double-click navigation, existing-project links and sidebar reparenting. Use isolated test workspaces; preserve user data.

## Verification

- pnpm test: 32 files, 162 tests passed.
- pnpm typecheck, pnpm lint, pnpm build: passed.
- Targeted Electron/preview regressions: 3 passed, including native sidebar drag/drop, new/existing project links, double-click navigation, answer capture and formula rendering.
- All project-navigation checks used isolated temporary workspaces.
