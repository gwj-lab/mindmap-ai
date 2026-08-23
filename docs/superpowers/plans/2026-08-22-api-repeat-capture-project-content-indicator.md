# API, Repeat Capture, Project Creation, and Content Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair project creation, add a discoverable single-connection OpenAI-compatible settings page, make every deliberate capture create an independent copy, and mark answer-linked map nodes with a small content indicator.

**Architecture:** Keep the existing Electron main-process settings and capture services as the security boundary. Add focused renderer components for project naming and API configuration, route both settings entry points through `App`, remove storage-level capture deduplication, and isolate `simple-mind-map` display decoration in a pure adapter. Preserve current portable schemas and derive the content marker from `answerId` at render time.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Zustand, Vitest, Testing Library, Playwright, Zod, `simple-mind-map`, Electron `safeStorage` and `net.fetch`.

## Global Constraints

- Support Windows 10/11 and Node.js 24+.
- Store exactly one OpenAI-compatible connection: Base URL, model identifier, and encrypted API key.
- Add no runtime dependency.
- Keep API keys in the Electron main process; renderer code may observe only `hasApiKey`.
- Accept only credential-free HTTPS Base URLs and retain explicit confirmation before reusing a saved key with a changed Base URL.
- Single mode returns one title and no children; expanded mode returns one title and at most 12 ordered child plans.
- API failures must fall back locally without losing the answer or candidate.
- Every deliberate capture creates fresh answer, candidate, and child IDs even for identical content.
- Persist no redundant content-indicator flag; derive it from `answerId`.
- Follow red-green-refactor: run each new test before production edits and confirm the expected failure.

---

## File Structure

- `src/renderer/src/components/ProjectNameDialog.tsx`: application-owned root/child project naming interaction and local submission errors.
- `tests/renderer/ProjectNameDialog.test.tsx`: keyboard, validation, pending, success, and failure behavior.
- `src/renderer/src/state/use-project.ts`: serialized project creation with explicit rejection on save or IPC failure.
- `tests/renderer/use-project.test.ts`: save-before-create ordering and error propagation.
- `src/renderer/src/components/AiSettingsPage.tsx`: single OpenAI-compatible connection form and usage explanation.
- `tests/renderer/AiSettingsPage.test.tsx`: settings load, validation, save, key status, and clear behavior.
- `src/renderer/src/components/ProjectNavigator.tsx`: fixed API settings entry intent.
- `src/renderer/src/components/AiPanel.tsx`: settings shortcut intent; no independent modal state.
- `src/renderer/src/App.tsx`: central page routing, project naming request state, and shared settings-page state.
- `tests/renderer/App.test.tsx`: root/child creation and both API-page entry paths at the application boundary.
- `src/main/capture-service.ts`: fresh-copy capture semantics.
- `tests/main/capture-service.test.ts`: identical and post-removal recapture regression coverage.
- `src/renderer/src/components/mindmap-node-adapter.ts`: pure domain-to-library conversion and derived content marker.
- `tests/renderer/mindmap-node-adapter.test.ts`: marker derivation and round-trip persistence behavior.
- `src/renderer/src/components/MindMapPanel.tsx`: consume the pure adapter and configure the compact note icon.
- `README.md` and `docs/windows-acceptance-checklist.md`: user-visible workflow and manual Windows checks.

---

### Task 1: Reliable Application-owned Project Naming

**Files:**
- Create: `src/renderer/src/components/ProjectNameDialog.tsx`
- Create: `tests/renderer/ProjectNameDialog.test.tsx`
- Modify: `src/renderer/src/state/use-project.ts:11-89`
- Modify: `tests/renderer/use-project.test.ts`
- Modify: `src/renderer/src/App.tsx:43-260`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `useProject.createNestedProject(name: string, parentProjectId: string | null): Promise<void>` and the existing `project.createNested` preload method.
- Produces: `ProjectNameDialog({ parentProjectId, onSubmit, onClose })`, where `onSubmit(name: string, parentProjectId: string | null): Promise<void>` resolves only after the project is created and active.

- [ ] **Step 1: Write the failing dialog tests**

Create `tests/renderer/ProjectNameDialog.test.tsx` with focused behavior tests:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectNameDialog } from "../../src/renderer/src/components/ProjectNameDialog.js";

afterEach(() => document.body.replaceChildren());

describe("ProjectNameDialog", () => {
  test("submits a trimmed root-project name with Enter", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectNameDialog parentProjectId={null} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "主项目名称" });
    expect(input).toHaveValue("新项目");
    fireEvent.change(input, { target: { value: "  新研究  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("新研究", null));
  });

  test("rejects a blank name and closes with Escape", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<ProjectNameDialog parentProjectId="parent-1" onSubmit={onSubmit} onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: "子项目名称" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(screen.getByRole("alert")).toHaveTextContent("项目名称不能为空");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("keeps the dialog open and preserves input when creation fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("目录已存在"));
    const onClose = vi.fn();
    render(<ProjectNameDialog parentProjectId={null} onSubmit={onSubmit} onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: "主项目名称" });
    fireEvent.change(input, { target: { value: "冲突项目" } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录已存在");
    expect(input).toHaveValue("冲突项目");
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the dialog test and verify the missing-component failure**

Run: `pnpm vitest run tests/renderer/ProjectNameDialog.test.tsx`

Expected: FAIL because `ProjectNameDialog.js` does not exist.

- [ ] **Step 3: Implement the minimal naming dialog**

Create a controlled component that owns `name`, `error`, and `submitting`. Use a `<form>` so Enter submits without custom key parsing; listen for Escape on the input; call `event.currentTarget.select()` on focus; set `maxLength={120}`; disable buttons and input while awaiting `onSubmit`; close only after `onSubmit` resolves.

The public shape must be:

```tsx
interface ProjectNameDialogProps {
  parentProjectId: string | null;
  onSubmit(name: string, parentProjectId: string | null): Promise<void>;
  onClose(): void;
}

export function ProjectNameDialog(props: ProjectNameDialogProps): React.JSX.Element;
```

Use `role="dialog"`, `aria-modal="true"`, an accessible dialog name of `新建主项目` or `新建子项目`, an input label of `主项目名称` or `子项目名称`, an alert paragraph for local or submission errors, and buttons named `取消` and `创建项目`.

- [ ] **Step 4: Run the dialog tests and verify they pass**

Run: `pnpm vitest run tests/renderer/ProjectNameDialog.test.tsx`

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing store tests for save ordering and rejection**

Append to `tests/renderer/use-project.test.ts`:

```ts
test("flushes dirty state before creating a nested project", async () => {
  const created = snapshot("New", OTHER_ID);
  const saveActive = vi.fn().mockResolvedValue({ savedAt: "2026-08-17T00:00:01.000Z" });
  const createNested = vi.fn().mockResolvedValue(created);
  const getSummary = vi.fn().mockResolvedValue(workspace(OTHER_ID));
  window.mindmapAI = api({ saveActive, createNested });
  vi.mocked(window.mindmapAI.workspace.getSummary).mockImplementation(getSummary);
  useProject.setState({ workspace: workspace(), snapshot: snapshot("Before"), saveStatus: "dirty" });

  await useProject.getState().createNestedProject("New", null);

  expect(saveActive).toHaveBeenCalledBefore(createNested);
  expect(createNested).toHaveBeenCalledWith("New", null);
  expect(useProject.getState().snapshot?.manifest.projectId).toBe(OTHER_ID);
});

test("rejects project creation failures after updating global error state", async () => {
  window.mindmapAI = api({ createNested: vi.fn().mockRejectedValue(new Error("目录已存在")) });
  useProject.setState({ workspace: workspace(), snapshot: snapshot("Before"), saveStatus: "saved" });
  await expect(useProject.getState().createNestedProject("New", null)).rejects.toThrow("目录已存在");
  expect(useProject.getState()).toMatchObject({ saveStatus: "error", message: "目录已存在" });
});
```

- [ ] **Step 6: Run the focused store tests and verify the rejection test fails**

Run: `pnpm vitest run tests/renderer/use-project.test.ts`

Expected: the new failure-propagation test FAILS because `createNestedProject` currently catches without rethrowing.

- [ ] **Step 7: Make creation errors observable to the dialog**

In `use-project.ts`, preserve the serialized `switchTail` behavior. If a dirty save returns `null`, throw `new Error("保存当前项目失败，未创建新项目")`. In the IPC `catch`, normalize the error message, set `{ message, saveStatus: "error" }`, then rethrow the original `Error` or `new Error(message)`.

- [ ] **Step 8: Run the store tests and verify they pass**

Run: `pnpm vitest run tests/renderer/use-project.test.ts`

Expected: all tests PASS.

- [ ] **Step 9: Replace `window.prompt` in `App`**

Add:

```ts
const [projectCreationParentId, setProjectCreationParentId] = useState<string | null | undefined>(undefined);
```

Interpret `undefined` as closed and `null` as root creation. Pass `onCreate={setProjectCreationParentId}` to `ProjectNavigator`. Render `ProjectNameDialog` at the application root when the state is not `undefined`. After the dialog has validated a non-empty name, its App-owned submit handler clears `openAnswer`, awaits `createNestedProject`, and closes the naming dialog only when creation succeeds. Do not call `window.prompt` anywhere.

Add compact dialog styles using the existing backdrop, graphite header, teal primary action, and focus tokens:

```css
.project-name-dialog { width: min(410px, calc(100vw - 40px)); overflow: hidden; border: 1px solid #9db1b2; border-radius: 10px; color: #29464b; background: #f8faf9; box-shadow: 0 24px 70px #10282f4d; }
.project-name-dialog > header { padding: 14px 16px; color: white; background: var(--graphite); }
.project-name-dialog form { display: grid; gap: 12px; padding: 16px; }
.project-name-dialog label { display: grid; gap: 6px; font-size: 10px; font-weight: 600; }
.project-name-dialog input { height: 34px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: white; }
.project-name-dialog [role="alert"] { margin: 0; color: var(--danger); font-size: 10px; }
.project-name-actions { display: flex; justify-content: flex-end; gap: 7px; }
.project-name-actions button { height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: white; }
.project-name-actions .primary { color: white; border-color: var(--teal-dark); background: var(--teal-dark); }
```

- [ ] **Step 10: Run the focused renderer suite**

Run: `pnpm vitest run tests/renderer/ProjectNameDialog.test.tsx tests/renderer/ProjectNavigator.test.tsx tests/renderer/use-project.test.ts`

Expected: all tests PASS and output contains no React act warnings.

- [ ] **Step 11: Commit Task 1**

```powershell
git add src/renderer/src/components/ProjectNameDialog.tsx src/renderer/src/state/use-project.ts src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/ProjectNameDialog.test.tsx tests/renderer/use-project.test.ts
git commit -m "fix: replace unsupported project prompt"
```

---

### Task 2: Shared API Configuration Page and Entry Points

**Files:**
- Create: `src/renderer/src/components/AiSettingsPage.tsx`
- Create: `tests/renderer/AiSettingsPage.test.tsx`
- Delete: `src/renderer/src/components/AiSettingsDialog.tsx`
- Delete: `tests/renderer/AiSettingsDialog.test.tsx`
- Modify: `src/renderer/src/components/ProjectNavigator.tsx:19-29,165-190`
- Modify: `tests/renderer/ProjectNavigator.test.tsx`
- Modify: `src/renderer/src/components/AiPanel.tsx:7-27,78-95`
- Modify: `tests/renderer/AiPanel.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Create: `tests/renderer/App.test.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: existing `DesktopApi.settings`, `UiPreferences["titleSource"]`, and the Task 1 `App` state structure.
- Produces: `AiSettingsPage({ titleSource, onTitleSourceChange, onClose })`, `ProjectNavigator.onOpenApiSettings()`, and `AiPanel.onOpenSettings()`.

- [ ] **Step 1: Write failing API-page tests**

Create `tests/renderer/AiSettingsPage.test.tsx` by adapting the existing dialog tests and adding mode copy and close behavior:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AiSettingsPage } from "../../src/renderer/src/components/AiSettingsPage.js";

describe("AiSettingsPage", () => {
  const settings = {
    getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example.com/v1", model: "small-model", hasApiKey: true }),
    updatePublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://new.example.com/v1", model: "small-model", hasApiKey: true }),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    clearApiKey: vi.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    Object.assign(window, { mindmapAI: { settings } });
    Object.values(settings).forEach((mock) => mock.mockClear());
  });
  afterEach(() => document.body.replaceChildren());

  test("loads one compatible connection without exposing the saved key", async () => {
    render(<AiSettingsPage titleSource="automatic" onTitleSourceChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue("https://api.example.com/v1")).toBeTruthy();
    expect(screen.getByText("API 密钥已安全保存")).toBeTruthy();
    expect(screen.getByText(/单一节点.*生成标题/)).toBeTruthy();
    expect(screen.getByText(/生成子节点.*最多 12 个/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("sk-");
  });

  test("validates HTTPS and confirms reuse of a key at a changed endpoint", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AiSettingsPage titleSource="api" onTitleSourceChange={vi.fn()} onClose={vi.fn()} />);
    const baseUrl = await screen.findByLabelText("Base URL");
    fireEvent.change(baseUrl, { target: { value: "http://unsafe.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("必须使用 HTTPS");
    fireEvent.change(baseUrl, { target: { value: "https://new.example.com/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(settings.updatePublicSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(settings.updatePublicSettings).toHaveBeenCalledWith(expect.any(Object), true));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  test("changes title source and closes through the back action", async () => {
    const onTitleSourceChange = vi.fn();
    const onClose = vi.fn();
    render(<AiSettingsPage titleSource="local" onTitleSourceChange={onTitleSourceChange} onClose={onClose} />);
    await screen.findByLabelText("Base URL");
    fireEvent.click(screen.getByRole("radio", { name: "自动（有密钥用 API）" }));
    expect(onTitleSourceChange).toHaveBeenCalledWith("automatic");
    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the page tests and verify the missing-component failure**

Run: `pnpm vitest run tests/renderer/AiSettingsPage.test.tsx`

Expected: FAIL because `AiSettingsPage.js` does not exist.

- [ ] **Step 3: Implement `AiSettingsPage` from the existing secure form**

Move the state-loading and save logic from `AiSettingsDialog` into a normal page component. Keep renderer HTTPS validation and main-process validation. Use `role="main"`, a heading `API 配置`, an alert for failures, a status region for success, and a `返回工作区` button. The API-key input remains empty after load and uses `type="password"`.

The public interface is:

```tsx
interface AiSettingsPageProps {
  titleSource: UiPreferences["titleSource"];
  onTitleSourceChange(source: UiPreferences["titleSource"]): void;
  onClose(): void;
}
```

After the new page passes its tests, remove `AiSettingsDialog.tsx` and its test so there is only one settings UI.

- [ ] **Step 4: Run the API-page tests and verify they pass**

Run: `pnpm vitest run tests/renderer/AiSettingsPage.test.tsx tests/main/settings-store.test.ts tests/main/title-service.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Write failing entry-point tests**

Add to `ProjectNavigator.test.tsx`:

```tsx
test("opens the API configuration page from the fixed footer action", () => {
  const onOpenApiSettings = vi.fn();
  render(<ProjectNavigator workspace={workspace} onSwitch={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onOpenInExplorer={vi.fn()} onOpenApiSettings={onOpenApiSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "API 配置" }));
  expect(onOpenApiSettings).toHaveBeenCalledTimes(1);
});
```

Add to `AiPanel.test.tsx`:

```tsx
test("forwards the settings shortcut instead of owning another settings surface", () => {
  const onOpenSettings = vi.fn();
  render(<AiPanel autoHoverCapture captureMode="single" onCaptureModeChange={vi.fn()} onAutoHoverCaptureChange={vi.fn()} onOpenSettings={onOpenSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog", { name: "AI 提取设置" })).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Run the entry tests and verify prop/behavior failures**

Run: `pnpm vitest run tests/renderer/ProjectNavigator.test.tsx tests/renderer/AiPanel.test.tsx`

Expected: FAIL because the new callback props do not exist and `AiPanel` still opens its own dialog.

- [ ] **Step 7: Implement intent-only entry callbacks**

Add required `onOpenApiSettings(): void` to `ProjectNavigatorProps` and render a fixed footer button named `API 配置`. Add required `onOpenSettings(): void` to `AiPanelProps`, remove `settingsOpen`, remove the dialog import/rendering, and invoke the callback from the gear button. Remove now-unused `titleSource` and `onTitleSourceChange` from `AiPanelProps`.

Update every test renderer call with the new required callbacks.

- [ ] **Step 8: Run entry tests and verify they pass**

Run: `pnpm vitest run tests/renderer/ProjectNavigator.test.tsx tests/renderer/AiPanel.test.tsx`

Expected: all tests PASS.

- [ ] **Step 9: Write an App-level failing routing test**

Create `tests/renderer/App.test.tsx`. Keep `ProjectNavigator`, `AiPanel`, `AiSettingsPage`, and `ProjectNameDialog` real while replacing FlexLayout with a light harness that renders the AI factory branch:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActiveProjectSnapshot, WorkspaceManifest } from "../../src/shared/types.js";

interface AppHarnessState {
  workspace: WorkspaceManifest;
  snapshot: ActiveProjectSnapshot;
  saveStatus: "saved";
  message: string;
  createNestedProject: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

const harness = vi.hoisted(() => ({ state: null as AppHarnessState | null }));

vi.mock("flexlayout-react", () => ({
  Model: { fromJson: vi.fn(() => ({ toJson: () => ({}) })) },
  Layout: ({ factory }: { factory(node: { getComponent(): string }): React.ReactNode }) => (
    <div data-testid="dock-layout">{factory({ getComponent: () => "ai" })}</div>
  )
}));

vi.mock("../../src/renderer/src/components/MindMapPanel.js", () => ({ MindMapPanel: () => null }));
vi.mock("../../src/renderer/src/components/NodeTray.js", () => ({ NodeTray: () => null }));
vi.mock("../../src/renderer/src/components/StylePanel.js", () => ({ StylePanel: () => null }));
vi.mock("../../src/renderer/src/components/AnswerDialog.js", () => ({ AnswerDialog: () => null }));
vi.mock("../../src/renderer/src/state/use-project.js", () => ({
  useProject: Object.assign(() => harness.state, { getState: () => harness.state })
}));

import { App } from "../../src/renderer/src/App.js";

const now = "2026-08-22T00:00:00.000Z";
const snapshot: ActiveProjectSnapshot = {
  manifest: { schemaVersion: 2, projectId: "project-1", parentProjectId: null, name: "主项目", createdAt: now, updatedAt: now },
  mindmap: { uid: "root", text: "中心主题", children: [] },
  state: {
    schemaVersion: 2, dockLayout: {}, candidates: [], history: [], trash: [],
    uiPreferences: { theme: "system", autoHoverCapture: true, captureMode: "single", titleSource: "automatic" }
  },
  missingAnswerIds: []
};
const workspace: WorkspaceManifest = {
  schemaVersion: 2, workspaceId: "workspace-1", name: "研究", activeProjectId: "project-1",
  projects: [{ projectId: "project-1", parentProjectId: null, name: "主项目", order: 0, createdAt: now, updatedAt: now }],
  projectTrash: [], createdAt: now, updatedAt: now
};

describe("App workspace flows", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
    vi.stubGlobal("IntersectionObserver", class { observe(): void {} disconnect(): void {} });
    const createNestedProject = vi.fn().mockResolvedValue(undefined);
    harness.state = {
      workspace, snapshot, saveStatus: "saved", message: "",
      setSnapshot: vi.fn(), setMessage: vi.fn(), createWorkspace: vi.fn(), openWorkspace: vi.fn(),
      createNestedProject, switchProject: vi.fn(), renameProject: vi.fn(), openProjectInExplorer: vi.fn(),
      moveProjectToTrash: vi.fn(), restoreProject: vi.fn(), permanentlyDeleteProject: vi.fn(),
      exportProject: vi.fn(), saveProject: vi.fn().mockResolvedValue({ savedAt: now })
    };
    Object.assign(window, {
      mindmapAI: {
        settings: {
          getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example.com/v1", model: "model", hasApiKey: false }),
          updatePublicSettings: vi.fn(), setApiKey: vi.fn(), clearApiKey: vi.fn()
        },
        ai: {
          setPanelBounds: vi.fn(), setPanelVisible: vi.fn(), captureLatest: vi.fn(), pickAnswer: vi.fn(),
          setHoverCapture: vi.fn(), beginLocalDrag: vi.fn(), endLocalDrag: vi.fn(),
          onAnswerCaptured: vi.fn(() => () => undefined), onAdapterError: vi.fn(() => () => undefined)
        }
      }
    });
  });
  afterEach(() => document.body.replaceChildren());

  test("creates a root project through the application-owned dialog", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "新建主项目" }));
    const input = screen.getByRole("textbox", { name: "主项目名称" });
    fireEvent.change(input, { target: { value: "第二项目" } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    await waitFor(() => expect(harness.state?.createNestedProject).toHaveBeenCalledWith("第二项目", null));
    expect(screen.queryByRole("dialog", { name: "新建主项目" })).not.toBeInTheDocument();
  });

  test("opens one API page from the project rail and AI shortcut", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "API 配置" }));
    expect(await screen.findByRole("heading", { name: "API 配置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));
    expect(screen.getByTestId("dock-layout")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
    expect(await screen.findByRole("heading", { name: "API 配置" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the App test and verify routing is missing**

Run: `pnpm vitest run tests/renderer/App.test.tsx`

Expected: FAIL because `App` does not yet own an API-settings view.

- [ ] **Step 11: Add shared page routing to `App`**

Add `const [workspacePage, setWorkspacePage] = useState<"dock" | "api-settings">("dock")`. Pass `onOpenApiSettings={() => setWorkspacePage("api-settings")}` to the navigator and `onOpenSettings={() => setWorkspacePage("api-settings")}` to `AiPanel`. Within `.dock-workspace`, render `AiSettingsPage` instead of `Layout` when selected. Its close handler sets `workspacePage` to `dock`; it updates `snapshot.state.uiPreferences.titleSource` through the existing `updateSnapshot` helper.

Do not recreate or mutate the FlexLayout model while the API page is visible.

- [ ] **Step 12: Add focused page styles**

Add focused styles to `styles.css`. Reuse current color tokens, input, focus, and button language. Keep the page readable at 1100px width and do not hide security or fallback text:

```css
.api-settings-page { height: 100%; padding: 22px; overflow: auto; color: #29464b; background: var(--paper); }
.api-settings-page > header { display: flex; align-items: center; justify-content: space-between; max-width: 760px; margin: 0 auto 14px; }
.api-settings-page > header h1 { margin: 0; font-size: 20px; }
.api-settings-card { display: grid; max-width: 760px; margin: 0 auto; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: 10px; background: white; }
.api-settings-card > label { display: grid; gap: 6px; font-size: 10px; font-weight: 600; }
.api-settings-card > label input { height: 34px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; }
.api-settings-usage { display: grid; gap: 5px; padding: 12px; border-radius: 7px; background: var(--mist); font-size: 10px; line-height: 1.6; }
.api-settings-actions { display: flex; align-items: center; gap: 7px; }
.api-settings-actions > span { flex: 1; }
.api-settings-actions button { height: 31px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: white; }
.api-settings-actions .primary { color: white; border-color: var(--teal-dark); background: var(--teal-dark); }
.api-settings-page [role="alert"] { color: var(--danger); }
@media (max-width: 1100px) { .api-settings-page { padding: 14px; } .api-settings-card { padding: 15px; } }
```

- [ ] **Step 13: Run the complete renderer settings slice**

Run: `pnpm vitest run tests/renderer/App.test.tsx tests/renderer/AiSettingsPage.test.tsx tests/renderer/AiPanel.test.tsx tests/renderer/ProjectNavigator.test.tsx`

Expected: all tests PASS without console warnings.

- [ ] **Step 14: Commit Task 2**

```powershell
git add src/renderer/src/components/AiSettingsPage.tsx src/renderer/src/components/ProjectNavigator.tsx src/renderer/src/components/AiPanel.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/AiSettingsPage.test.tsx tests/renderer/AiPanel.test.tsx tests/renderer/ProjectNavigator.test.tsx tests/renderer/App.test.tsx
git rm src/renderer/src/components/AiSettingsDialog.tsx tests/renderer/AiSettingsDialog.test.tsx
git commit -m "feat: add shared API configuration page"
```

---

### Task 3: Unlimited Independent Recapture

**Files:**
- Modify: `tests/main/capture-service.test.ts:67-81`
- Modify: `src/main/capture-service.ts:48-58`

**Interfaces:**
- Consumes: existing `CaptureService.capture(payload): Promise<CaptureAcknowledgement>` and answer/candidate persistence methods.
- Produces: every completed call returns `status: "captured"` with fresh answer and candidate IDs; provenance metadata remains unchanged.

- [ ] **Step 1: Replace the duplicate test with a failing fresh-copy test**

Replace `returns duplicate before another API call and creates no second candidate` with:

```ts
test("captures identical source content repeatedly as independent copies", async () => {
  const api = { extract: vi.fn().mockResolvedValue({ title: "API", subtitles: [] }) };
  const settings = {
    getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example/v1", model: "model", hasApiKey: true }),
    getApiKey: vi.fn().mockResolvedValue("secret")
  };
  const { store } = await setup("single", "api");
  const service = new CaptureService(store, { portable: true, titleService: api, settingsStore: settings });

  const first = await service.capture(payload);
  const second = await service.capture(payload);

  expect(first.status).toBe("captured");
  expect(second.status).toBe("captured");
  if (first.status !== "captured" || second.status !== "captured") throw new Error("capture failed");
  expect(second.answer.metadata.id).not.toBe(first.answer.metadata.id);
  expect(second.candidate.id).not.toBe(first.candidate.id);
  expect(api.extract).toHaveBeenCalledTimes(2);
  expect(await store.listAnswerDocuments()).toHaveLength(2);
  expect((await store.loadPortable()).state.candidates).toHaveLength(2);
});
```

- [ ] **Step 2: Run the focused test and verify current deduplication fails it**

Run: `pnpm vitest run tests/main/capture-service.test.ts -t "captures identical source content repeatedly"`

Expected: FAIL because the second result is `duplicate` and only one answer/candidate exists.

- [ ] **Step 3: Remove storage-level uniqueness enforcement**

Delete the `listAnswerDocuments` scan and early `duplicate` return from `CaptureService.capture`. Keep `contentHash(payload.markdown)` and all provenance metadata writes. Do not change the preload controller's in-flight guard.

- [ ] **Step 4: Run the focused test and verify fresh-copy behavior passes**

Run: `pnpm vitest run tests/main/capture-service.test.ts -t "captures identical source content repeatedly"`

Expected: PASS with two answers, two candidates, and two API calls.

- [ ] **Step 5: Add a post-removal regression test**

Add:

```ts
test("recaptures after the previous candidate leaves the active tray", async () => {
  const { store } = await setup();
  const service = new CaptureService(store, { portable: true });
  const first = await service.capture(payload);
  if (first.status !== "captured") throw new Error("first capture failed");
  const current = await store.loadPortable();
  await store.savePortable({ ...current, state: { ...current.state, candidates: [] } });

  const next = await service.capture(payload);

  expect(next.status).toBe("captured");
  expect(await store.listAnswerDocuments()).toHaveLength(2);
  expect((await store.loadPortable()).state.candidates).toHaveLength(1);
});
```

- [ ] **Step 6: Run all capture and delivery tests**

Run: `pnpm vitest run tests/main/capture-service.test.ts tests/preload/chatgpt-adapter.test.ts tests/preload/hover-capture.test.ts`

Expected: all tests PASS. Legacy `duplicate` acknowledgement rendering may remain for backward compatibility, but the current capture service no longer emits it.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/main/capture-service.ts tests/main/capture-service.test.ts
git commit -m "fix: allow unlimited independent captures"
```

---

### Task 4: Derived Content Indicator for Answer-linked Nodes

**Files:**
- Create: `src/renderer/src/components/mindmap-node-adapter.ts`
- Create: `tests/renderer/mindmap-node-adapter.test.ts`
- Modify: `src/renderer/src/components/MindMapPanel.tsx:16-19,68-82,139-153,157-160,275-280`

**Interfaces:**
- Consumes: `MindMapNodeData.answerId` and `simple-mind-map`'s built-in `note` icon rendering.
- Produces: `toMindMapLibraryNode(node)` and `fromMindMapLibraryNode(node)` pure functions plus `CONTENT_INDICATOR_NOTE`.

- [ ] **Step 1: Write failing pure-adapter tests**

Create `tests/renderer/mindmap-node-adapter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  CONTENT_INDICATOR_NOTE,
  fromMindMapLibraryNode,
  toMindMapLibraryNode
} from "../../src/renderer/src/components/mindmap-node-adapter.js";

describe("mind-map node adapter", () => {
  test("adds a content indicator only to answer-linked nodes", () => {
    const linked = toMindMapLibraryNode({ uid: "linked", text: "回答", answerId: "answer-1", children: [] });
    const label = toMindMapLibraryNode({ uid: "label", text: "子方案", children: [] });
    expect(linked.data.note).toBe(CONTENT_INDICATOR_NOTE);
    expect(label.data.note).toBeUndefined();
  });

  test("keeps expanded children title-only", () => {
    const converted = toMindMapLibraryNode({
      uid: "root", text: "回答", answerId: "answer-1",
      children: [{ uid: "child", text: "子方案", children: [] }]
    });
    expect(converted.data.note).toBe(CONTENT_INDICATOR_NOTE);
    expect(converted.children[0]?.data.note).toBeUndefined();
  });

  test("removes the derived note during round-trip conversion", () => {
    const source = { uid: "linked", text: "回答", answerId: "answer-1", children: [] };
    const roundTrip = fromMindMapLibraryNode(toMindMapLibraryNode(source));
    expect(roundTrip).toEqual(source);
    expect(roundTrip).not.toHaveProperty("note");
  });
});
```

- [ ] **Step 2: Run the adapter test and verify the missing-module failure**

Run: `pnpm vitest run tests/renderer/mindmap-node-adapter.test.ts`

Expected: FAIL because `mindmap-node-adapter.js` does not exist.

- [ ] **Step 3: Implement the pure conversion boundary**

Create:

```ts
import type { MindMapNodeData } from "../../../shared/types.js";

export const CONTENT_INDICATOR_NOTE = "该节点包含截取内容";

export interface MindMapLibraryNode {
  data: Record<string, unknown>;
  children: MindMapLibraryNode[];
}

export function toMindMapLibraryNode(node: MindMapNodeData): MindMapLibraryNode {
  const { children, ...data } = node;
  return {
    data: {
      ...data,
      expand: data.expand ?? true,
      ...(node.answerId ? { note: CONTENT_INDICATOR_NOTE } : {})
    },
    children: children.map(toMindMapLibraryNode)
  };
}

export function fromMindMapLibraryNode(node: MindMapLibraryNode): MindMapNodeData {
  const raw = node.data;
  const { note, ...withoutNote } = raw;
  const data = note === CONTENT_INDICATOR_NOTE ? withoutNote : raw;
  return {
    ...data,
    uid: String(data.uid ?? crypto.randomUUID()),
    text: String(data.text ?? ""),
    answerId: typeof data.answerId === "string" ? data.answerId : undefined,
    children: (node.children ?? []).map(fromMindMapLibraryNode)
  };
}
```

The exact sentinel comparison preserves any unrelated pre-existing note instead of stripping user data.

- [ ] **Step 4: Run the adapter tests and verify they pass**

Run: `pnpm vitest run tests/renderer/mindmap-node-adapter.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Integrate the adapter into `MindMapPanel`**

Remove the local `LibraryData`, `toLibrary`, and `fromLibrary` definitions. Import `MindMapLibraryNode`, `toMindMapLibraryNode`, and `fromMindMapLibraryNode`. Replace the initial data, `data_change`, and external `setData` calls with these functions.

Configure a compact note icon in the `MindMap` constructor:

```ts
noteIcon: {
  icon: "",
  style: { size: 12, color: "#1b8f7f" }
}
```

Keep the built-in tooltip so hovering the marker shows `该节点包含截取内容`.

- [ ] **Step 6: Run map and project-state tests**

Run: `pnpm vitest run tests/renderer/mindmap-node-adapter.test.ts tests/renderer/project-state.test.ts tests/renderer/NodeContextMenu.test.tsx tests/shared/portable-map.test.ts`

Expected: all tests PASS, including answer IDs through history/trash/portable round trips.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/renderer/src/components/mindmap-node-adapter.ts src/renderer/src/components/MindMapPanel.tsx tests/renderer/mindmap-node-adapter.test.ts
git commit -m "feat: mark nodes with captured content"
```

---

### Task 5: Documentation, Full Verification, and Windows Acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/windows-acceptance-checklist.md`

**Interfaces:**
- Consumes: completed behavior from Tasks 1-4.
- Produces: accurate user workflow documentation and fresh completion evidence.

- [ ] **Step 1: Update user-visible documentation**

In `README.md`, state that API configuration is opened from the left rail or AI gear, one OpenAI-compatible connection is supported, repeated captures create independent Markdown copies, and answer-linked nodes display a content marker.

In `docs/windows-acceptance-checklist.md`, add exact manual checks:

```md
- [ ] “新建主项目”和“创建子项目”均打开应用内命名框；Enter 提交，Esc 取消，失败信息留在框内。
- [ ] 左侧“API 配置”和 AI 面板齿轮打开同一配置页，返回后原导图布局不变。
- [ ] 同一条 ChatGPT 回答连续捕获三次得到三个独立候选；删除其中一个后仍可再次捕获。
- [ ] 答案关联节点显示内容角标；多节点模式生成的纯标题子节点不显示角标。
- [ ] 保存、关闭并重新打开工作区后，内容角标仍按答案关联正确显示。
```

- [ ] **Step 2: Run the complete unit and component suite**

Run: `pnpm test`

Expected: exit code 0, no failed tests, no unhandled rejections, and no React act warnings.

- [ ] **Step 3: Run static verification**

Run: `pnpm typecheck`

Expected: exit code 0 with no TypeScript diagnostics.

Run: `pnpm lint`

Expected: exit code 0 with zero warnings and zero errors.

- [ ] **Step 4: Build the Electron application**

Run: `pnpm build`

Expected: exit code 0 and successful main, preload, and renderer builds.

- [ ] **Step 5: Run end-to-end tests**

Run: `pnpm test:e2e`

Expected: exit code 0. If an environment-owned browser or Electron launch failure occurs, record the exact failing test and output; do not report the product behavior as verified by that test.

- [ ] **Step 6: Inspect the final diff and requirements coverage**

Run:

```powershell
git diff --check HEAD~4..HEAD
git status --short
```

Confirm that no API key, generated workspace, `.codex-run` log, build output, or unrelated user file is staged. Check each of the ten acceptance criteria in the approved design against a test or manual checklist item.

- [ ] **Step 7: Commit documentation**

```powershell
git add README.md docs/windows-acceptance-checklist.md
git commit -m "docs: update API and capture workflows"
```

- [ ] **Step 8: Perform the Windows manual checks**

Launch with `pnpm dev` in a hidden helper process, open a disposable workspace, and execute only the new checklist items. Do not enter a real API key during automated UI checks. Record results in the handoff; leave any user workspace unchanged.
