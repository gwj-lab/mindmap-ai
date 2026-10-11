// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActiveProjectSnapshot, WorkspaceManifest } from "../../src/shared/types.js";

const harness = vi.hoisted(() => ({
  state: null as unknown,
  createNestedProject: vi.fn(),
  initializeWorkspace: vi.fn(),
  switchWorkspace: vi.fn(),
  forgetRecentWorkspace: vi.fn(),
  setSnapshot: vi.fn(),
  setMessage: vi.fn()
}));

vi.mock("flexlayout-react", () => ({
  Model: { fromJson: vi.fn(() => ({ toJson: () => ({}), visitNodes: () => {} })) },
  Layout: ({ factory }: { factory(node: { getComponent(): string; getId(): string; getConfig(): object; isVisible(): boolean }): React.ReactNode }) => (
    <div data-testid="dock-layout">{["ai", "mindmap"].map((component) => <div key={component}>{factory({ getComponent: () => component, getId: () => component, getConfig: () => ({}), isVisible: () => true })}</div>)}</div>
  )
}));
vi.mock("../../src/renderer/src/components/MindMapPanel.js", () => ({ MindMapPanel: ({ onOpenAnswer }: { onOpenAnswer(answerId: string, nodeUid: string): void }) => <div><button onClick={() => onOpenAnswer("answer-one", "node-one")}>阅读节点一</button><button onClick={() => onOpenAnswer("answer-two", "node-two")}>阅读节点二</button></div> }));
vi.mock("../../src/renderer/src/components/NodeTray.js", () => ({ NodeTray: () => null }));
vi.mock("../../src/renderer/src/components/StylePanel.js", () => ({ StylePanel: () => null }));
vi.mock("../../src/renderer/src/components/AnswerDialog.js", () => ({ AnswerDialog: ({ answerId, hidden, onClose }: { answerId: string; hidden?: boolean; onClose(): void }) => <aside aria-label="回答阅读器" hidden={hidden}>{answerId}<button onClick={onClose}>关闭 {answerId}</button></aside> }));
vi.mock("../../src/renderer/src/state/use-project.js", () => ({
  useProject: Object.assign((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(harness.state as Record<string, unknown>) : harness.state, { getState: () => harness.state })
}));

import { App } from "../../src/renderer/src/App.js";

const now = "2026-08-22T00:00:00.000Z";
const snapshot: ActiveProjectSnapshot = {
  manifest: { schemaVersion: 2, projectId: "project-1", parentProjectId: null, name: "主项目", createdAt: now, updatedAt: now },
  mindmap: { uid: "root", text: "中心主题", children: [] },
  state: {
    schemaVersion: 2,
    dockLayout: {},
    candidates: [],
    history: [],
    trash: [],
    uiPreferences: { theme: "system", autoHoverCapture: true, captureMode: "single", titleSource: "automatic" }
  },
  missingAnswerIds: []
};
const workspace: WorkspaceManifest = {
  schemaVersion: 2,
  workspaceId: "workspace-1",
  name: "研究",
  activeProjectId: "project-1",
  projects: [{ projectId: "project-1", parentProjectId: null, name: "主项目", order: 0, createdAt: now, updatedAt: now }],
  projectTrash: [],
  createdAt: now,
  updatedAt: now
};

describe("App workspace flows", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
    vi.stubGlobal("IntersectionObserver", class { observe(): void {} disconnect(): void {} });
    harness.createNestedProject.mockReset().mockResolvedValue(undefined);
    harness.initializeWorkspace.mockReset().mockResolvedValue(undefined);
    harness.switchWorkspace.mockReset().mockResolvedValue(undefined);
    harness.forgetRecentWorkspace.mockReset().mockResolvedValue(undefined);
    harness.setSnapshot.mockReset();
    harness.setMessage.mockReset();
    harness.state = {
      workspace,
      snapshot,
      recentWorkspaces: [{
        id: "7ca134b0-2c87-46e6-92c8-6bdde8a69c37",
        name: "研究",
        path: "C:\\研究",
        lastOpenedAt: now
      }],
      workspaceInitialized: true,
      workspaceInitializing: false,
      saveStatus: "saved",
      message: "",
      setSnapshot: harness.setSnapshot,
      setMessage: harness.setMessage,
      initializeWorkspace: harness.initializeWorkspace,
      switchWorkspace: harness.switchWorkspace,
      forgetRecentWorkspace: harness.forgetRecentWorkspace,
      createWorkspace: vi.fn(),
      openWorkspace: vi.fn(),
      createNestedProject: harness.createNestedProject,
      switchProject: vi.fn(),
      renameProject: vi.fn(),
      openProjectInExplorer: vi.fn(),
      moveProjectToTrash: vi.fn(),
      restoreProject: vi.fn(),
      permanentlyDeleteProject: vi.fn(),
      exportProject: vi.fn(),
      saveProject: vi.fn().mockResolvedValue({ savedAt: now })
    };
    Object.assign(window, {
      mindmapAI: {
        settings: {
          getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example.com/v1", model: "model", hasApiKey: false }),
          updatePublicSettings: vi.fn(),
          testConnection: vi.fn(),
          setApiKey: vi.fn(),
          clearApiKey: vi.fn()
        },
        ai: {
          syncTabs: vi.fn(),
          setPanelBounds: vi.fn(),
          setPanelVisible: vi.fn(),
          captureLatest: vi.fn(),
          pickAnswer: vi.fn(),
          setHoverCapture: vi.fn(),
          setExpansionPrompt: vi.fn(),
          beginLocalDrag: vi.fn(),
          endLocalDrag: vi.fn(),
          onAnswerCaptured: vi.fn(() => () => undefined),
          onAdapterError: vi.fn(() => () => undefined)
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
    await waitFor(() => expect(harness.createNestedProject).toHaveBeenCalledWith("第二项目", null));
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

  test("initializes startup state and opens the recent workspace switcher", async () => {
    render(<App />);
    await waitFor(() => expect(harness.initializeWorkspace).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "切换工作区" }));
    expect(screen.getByRole("dialog", { name: "切换工作区" })).toBeInTheDocument();
    expect(screen.getByText("C:\\研究")).toBeInTheDocument();
  });

  test("opens multiple readers, reuses existing windows and hides them without closing", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "阅读节点一" }));
    await screen.findByText("answer-one");
    fireEvent.click(screen.getByRole("button", { name: "阅读节点二" }));
    await waitFor(() => expect(screen.getAllByLabelText("回答阅读器")).toHaveLength(2));
    const readerOrder = screen.getAllByLabelText("回答阅读器");
    fireEvent.click(screen.getByRole("button", { name: "阅读节点一" }));
    expect(screen.getAllByLabelText("回答阅读器")).toHaveLength(2);
    expect(screen.getAllByLabelText("回答阅读器")).toEqual(readerOrder);
    fireEvent.click(screen.getByRole("button", { name: "返回工作区", exact: true }));
    expect(screen.getAllByLabelText("回答阅读器").every((reader) => reader.hasAttribute("hidden"))).toBe(true);
    expect(window.mindmapAI.ai.setPanelVisible).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "显示阅读窗口" }));
    expect(screen.getAllByLabelText("回答阅读器").every((reader) => !reader.hasAttribute("hidden"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭 answer-two" }));
    expect(screen.getAllByLabelText("回答阅读器")).toHaveLength(1);
  });
});
