# DeepSeek Diagnostics and Workspace Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix DeepSeek first-time setup, expose safe API diagnostics, restore the last workspace, and support in-app switching among recent workspaces.

**Architecture:** Keep credentials and filesystem paths authoritative in the Electron main process. Add focused stores/services behind typed IPC, then expose startup and switching state through the existing Zustand store and small React components.

**Tech Stack:** TypeScript 6, Electron 43, React 19, Zustand 5, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- API keys remain encrypted with Electron `safeStorage` and are never returned to the renderer.
- All model connections require credential-free HTTPS URLs with normal certificate verification.
- Recent workspace selection crosses IPC as an opaque UUID, never as a renderer-supplied path.
- Recent workspace history contains at most 10 entries and never deletes workspace content.
- Every behavior change follows a witnessed red-green test cycle.

---

### Task 1: DeepSeek configuration and diagnostics

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/app.ts`
- Modify: `src/main/settings-store.ts`
- Modify: `src/main/title-service.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/AiSettingsPage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/main/settings-store.test.ts`
- Test: `tests/main/title-service.test.ts`
- Test: `tests/main/capture-service.test.ts`
- Test: `tests/renderer/AiSettingsPage.test.tsx`

**Interfaces:**
- Produces: `AiConnectionTestResult`, `settings.testConnection(input)`, and optional `CaptureAcknowledgement.apiWarning`.
- Consumes: existing encrypted settings storage and `TitleService` fetch injection.

- [ ] Write failing tests proving an initial Base URL change without a key succeeds, the DeepSeek preset populates official values, connection errors are classified without leaking provider bodies or keys, and capture fallback includes a visible warning.
- [ ] Run the focused tests and confirm failures are caused by the missing behavior.
- [ ] Implement the minimal shared types, IPC handler, request classification, settings UI, and capture warning needed to pass.
- [ ] Run focused tests and refactor only while they remain green.

### Task 2: Recent workspace persistence

**Files:**
- Create: `src/main/recent-workspace-store.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/recent-workspace-store.test.ts`

**Interfaces:**
- Produces: `RecentWorkspaceStore.list()`, `record(path, name)`, `resolve(id)`, `forget(id)`, and `mostRecent()`.
- Consumes: an application-owned directory and atomic JSON writes.

- [ ] Write failing tests for MRU order, deduplication, ten-entry limit, opaque IDs, forgetting without filesystem deletion, and corrupt-file recovery.
- [ ] Run the focused test and confirm the module is missing.
- [ ] Implement validated atomic persistence with all path resolution kept in the main process.
- [ ] Run the focused test and keep it green after cleanup.

### Task 3: Startup restore and workspace switching IPC

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/app.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/main/ipc-contract.test.ts`

**Interfaces:**
- Produces: `workspace.restoreLast()`, `workspace.listRecent()`, `workspace.switchRecent(id)`, and `workspace.forgetRecent(id)`.
- Consumes: `RecentWorkspaceStore` and `WorkspaceStore.loadOrMigrate()`.

- [ ] Write failing contract tests for the four typed channels and opaque-ID request validation.
- [ ] Run the contract tests and confirm the new channels are absent.
- [ ] Register handlers that fully load candidates before replacing active state, record successful opens, and forget a missing/invalid last entry after failed automatic restore.
- [ ] Run the main-process tests and confirm all pass.

### Task 4: Renderer startup and in-app switcher

**Files:**
- Modify: `src/renderer/src/state/use-project.ts`
- Create: `src/renderer/src/components/WorkspaceSwitcher.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `tests/renderer/use-project.test.ts`
- Create: `tests/renderer/WorkspaceSwitcher.test.tsx`
- Modify: `tests/renderer/App.test.tsx`

**Interfaces:**
- Produces: `initializeWorkspace()`, `switchWorkspace(id)`, `recentWorkspaces`, `workspaceInitialized`, and an accessible dialog.
- Consumes: the workspace IPC methods from Task 3 and the existing serialized save queue.

- [ ] Write failing tests for startup restore, invalid-last warning, dirty-save-before-switch, canceled switch after save failure, dialog actions, and top-bar access.
- [ ] Run focused renderer tests and confirm failures reflect missing state/actions/components.
- [ ] Implement the minimal Zustand and React behavior, including a loading state that prevents a welcome-page flash.
- [ ] Run renderer tests and refactor with tests green.

### Task 5: Integration and documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: all previous task behavior.
- Produces: isolated E2E user-data runs and documented DeepSeek/workspace workflows.

- [ ] Add an E2E flow proving restart restoration and in-app switching while isolating test `userData` from the developer profile.
- [ ] Run the E2E test and confirm it fails before completing any missing integration wiring.
- [ ] Complete only the wiring required by the E2E failure and update the user-facing documentation.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e`; inspect every exit code and failure count.
