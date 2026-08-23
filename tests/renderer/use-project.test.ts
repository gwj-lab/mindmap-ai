// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { useProject } from "../../src/renderer/src/state/use-project.js";
import type {
  ActiveProjectSnapshot,
  DesktopApi,
  SaveResult,
  WorkspaceManifest,
  WorkspaceOpenResult
} from "../../src/shared/types.js";

const PROJECT_ID = "2cb66115-270c-4107-89e0-f61508c14d2b";
const OTHER_ID = "f93a5f49-b715-4765-baf9-124dd2fe7436";

function snapshot(name: string, projectId = PROJECT_ID): ActiveProjectSnapshot {
  return {
    manifest: {
      schemaVersion: 2,
      projectId,
      parentProjectId: null,
      name,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z"
    },
    mindmap: { uid: "root", text: "中心主题", children: [] },
    state: {
      schemaVersion: 2,
      dockLayout: {},
      candidates: [],
      history: [],
      trash: [],
      uiPreferences: {
        theme: "system",
        autoHoverCapture: true,
        captureMode: "single",
        titleSource: "automatic"
      }
    },
    missingAnswerIds: []
  };
}

function workspace(activeProjectId = PROJECT_ID): WorkspaceManifest {
  const now = "2026-08-17T00:00:00.000Z";
  return {
    schemaVersion: 2,
    workspaceId: "9dfd4da9-f0c8-4fbe-bf3c-cb199b576ddd",
    name: "Workspace",
    activeProjectId,
    projects: [
      { projectId: PROJECT_ID, parentProjectId: null, name: "Before", order: 0, createdAt: now, updatedAt: now },
      { projectId: OTHER_ID, parentProjectId: null, name: "Other", order: 1, createdAt: now, updatedAt: now }
    ],
    projectTrash: [],
    createdAt: now,
    updatedAt: now
  };
}

function api(overrides: Partial<DesktopApi["project"]> = {}): DesktopApi {
  return {
    settings: {
      getPublicSettings: vi.fn(), updatePublicSettings: vi.fn(), testConnection: vi.fn(), setApiKey: vi.fn(), clearApiKey: vi.fn()
    },
    workspace: {
      create: vi.fn(), open: vi.fn(), getSummary: vi.fn(), restoreLast: vi.fn(), listRecent: vi.fn(),
      switchRecent: vi.fn(), forgetRecent: vi.fn()
    },
    project: {
      create: vi.fn(), open: vi.fn(), save: vi.fn(), readAnswer: vi.fn(), writeAnswer: vi.fn(),
      createNested: vi.fn(), switch: vi.fn(), rename: vi.fn(), saveActive: vi.fn(), openInExplorer: vi.fn(),
      moveToTrash: vi.fn(), restore: vi.fn(), permanentlyDelete: vi.fn(), export: vi.fn(),
      ...overrides
    },
    ai: {
      setPanelBounds: vi.fn(), setPanelVisible: vi.fn(), captureLatest: vi.fn(), pickAnswer: vi.fn(), setHoverCapture: vi.fn(),
      beginLocalDrag: vi.fn(), endLocalDrag: vi.fn(),
      onAnswerCaptured: vi.fn(() => () => undefined), onAdapterError: vi.fn(() => () => undefined)
    }
  };
}

beforeEach(() => {
  useProject.setState({
    workspace: null,
    snapshot: null,
    recentWorkspaces: [],
    workspaceInitialized: false,
    workspaceInitializing: false,
    saveStatus: "idle",
    message: ""
  });
});

describe("project save state", () => {
  test("keeps a newer edit dirty when an older save finishes", async () => {
    let finishSave!: (value: SaveResult) => void;
    const saving = new Promise<SaveResult>((resolve) => { finishSave = resolve; });
    window.mindmapAI = api({ saveActive: vi.fn(() => saving) });

    useProject.getState().setSnapshot(snapshot("Before"));
    const pending = useProject.getState().saveProject();
    useProject.getState().setSnapshot(snapshot("After"));
    finishSave({ savedAt: "2026-08-17T00:00:01.000Z" });
    await pending;

    expect(useProject.getState().snapshot?.manifest.name).toBe("After");
    expect(useProject.getState().saveStatus).toBe("dirty");
  });

  test("serializes overlapping autosaves so newer state is written last", async () => {
    let finishFirst!: (value: SaveResult) => void;
    const firstSave = new Promise<SaveResult>((resolve) => { finishFirst = resolve; });
    const saveActive = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ savedAt: "2026-08-17T00:00:02.000Z" });
    window.mindmapAI = api({ saveActive });
    useProject.getState().setSnapshot(snapshot("First"));
    const first = useProject.getState().saveProject();
    useProject.getState().setSnapshot(snapshot("Second"));
    const second = useProject.getState().saveProject();
    await Promise.resolve();
    expect(saveActive).toHaveBeenCalledTimes(1);
    finishFirst({ savedAt: "2026-08-17T00:00:01.000Z" });
    await first;
    await second;
    expect(saveActive).toHaveBeenCalledTimes(2);
    expect(saveActive.mock.calls[1]?.[0].manifest.name).toBe("Second");
    expect(useProject.getState().saveStatus).toBe("saved");
  });

  test("flushes the dirty active project before switching", async () => {
    const next = snapshot("Other", OTHER_ID);
    const saveActive = vi.fn(async () => ({ savedAt: "2026-08-17T00:00:01.000Z" }));
    const switchProject = vi.fn(async () => next);
    window.mindmapAI = api({ saveActive, switch: switchProject });
    useProject.setState({ workspace: workspace(), snapshot: snapshot("Before"), saveStatus: "dirty" });

    await useProject.getState().switchProject(OTHER_ID);

    expect(saveActive).toHaveBeenCalledBefore(switchProject);
    expect(useProject.getState().snapshot?.manifest.projectId).toBe(OTHER_ID);
    expect(useProject.getState().workspace?.activeProjectId).toBe(OTHER_ID);
  });

  test("opens a workspace result as one state transition", async () => {
    const result: WorkspaceOpenResult = { workspace: workspace(), project: snapshot("Before") };
    window.mindmapAI = api();
    vi.mocked(window.mindmapAI.workspace.open).mockResolvedValue(result);
    await useProject.getState().openWorkspace();
    expect(useProject.getState()).toMatchObject({
      workspace: { workspaceId: result.workspace.workspaceId },
      snapshot: { manifest: { projectId: PROJECT_ID } },
      saveStatus: "saved"
    });
  });

  test("restores the last workspace during startup and loads recent entries", async () => {
    const result: WorkspaceOpenResult = { workspace: workspace(), project: snapshot("Before") };
    const desktop = api();
    vi.mocked(desktop.workspace.restoreLast).mockResolvedValue({ result });
    vi.mocked(desktop.workspace.listRecent).mockResolvedValue([{
      id: "7ca134b0-2c87-46e6-92c8-6bdde8a69c37",
      name: "Workspace",
      path: "C:\\Workspace",
      lastOpenedAt: "2026-08-23T00:00:00.000Z"
    }]);
    window.mindmapAI = desktop;

    await useProject.getState().initializeWorkspace();

    expect(useProject.getState()).toMatchObject({
      workspaceInitialized: true,
      workspace: { workspaceId: result.workspace.workspaceId },
      snapshot: { manifest: { projectId: PROJECT_ID } },
      recentWorkspaces: [{ name: "Workspace" }]
    });
  });

  test("coalesces duplicate startup initialization from React strict mode", async () => {
    const desktop = api();
    vi.mocked(desktop.workspace.restoreLast).mockResolvedValue({ result: null });
    vi.mocked(desktop.workspace.listRecent).mockResolvedValue([]);
    window.mindmapAI = desktop;

    await Promise.all([
      useProject.getState().initializeWorkspace(),
      useProject.getState().initializeWorkspace()
    ]);

    expect(desktop.workspace.restoreLast).toHaveBeenCalledTimes(1);
    expect(desktop.workspace.listRecent).toHaveBeenCalledTimes(1);
  });

  test("shows a warning and remains empty when automatic restore fails", async () => {
    const desktop = api();
    vi.mocked(desktop.workspace.restoreLast).mockResolvedValue({ result: null, warning: "无法恢复最近工作区" });
    vi.mocked(desktop.workspace.listRecent).mockResolvedValue([]);
    window.mindmapAI = desktop;

    await useProject.getState().initializeWorkspace();

    expect(useProject.getState()).toMatchObject({
      workspaceInitialized: true,
      workspace: null,
      snapshot: null,
      message: "无法恢复最近工作区",
      saveStatus: "error"
    });
  });

  test("flushes dirty state before switching workspaces and cancels after a failed save", async () => {
    const desktop = api();
    const next: WorkspaceOpenResult = { workspace: workspace(OTHER_ID), project: snapshot("Other", OTHER_ID) };
    vi.mocked(desktop.workspace.switchRecent).mockResolvedValue(next);
    vi.mocked(desktop.workspace.listRecent).mockResolvedValue([]);
    vi.mocked(desktop.project.saveActive).mockRejectedValueOnce(new Error("disk full"));
    window.mindmapAI = desktop;
    useProject.setState({ workspace: workspace(), snapshot: snapshot("Before"), saveStatus: "dirty", workspaceInitialized: true });

    await useProject.getState().switchWorkspace("7ca134b0-2c87-46e6-92c8-6bdde8a69c37");
    expect(desktop.workspace.switchRecent).not.toHaveBeenCalled();

    vi.mocked(desktop.project.saveActive).mockResolvedValueOnce({ savedAt: "2026-08-23T00:00:00.000Z" });
    useProject.setState({ saveStatus: "dirty" });
    await useProject.getState().switchWorkspace("7ca134b0-2c87-46e6-92c8-6bdde8a69c37");
    expect(desktop.project.saveActive).toHaveBeenCalledBefore(vi.mocked(desktop.workspace.switchRecent));
    expect(useProject.getState().snapshot?.manifest.projectId).toBe(OTHER_ID);
  });

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
});
