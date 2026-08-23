import { create } from "zustand";
import type {
  ActiveProjectSnapshot,
  RecentWorkspaceEntry,
  SaveResult,
  WorkspaceManifest,
  WorkspaceOpenResult
} from "../../../shared/types.js";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface ProjectState {
  workspace: WorkspaceManifest | null;
  snapshot: ActiveProjectSnapshot | null;
  recentWorkspaces: RecentWorkspaceEntry[];
  workspaceInitialized: boolean;
  workspaceInitializing: boolean;
  saveStatus: SaveStatus;
  message: string;
  setSnapshot(snapshot: ActiveProjectSnapshot | null, markDirty?: boolean): void;
  setSaveStatus(status: SaveStatus): void;
  setMessage(message: string): void;
  initializeWorkspace(): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  forgetRecentWorkspace(id: string): Promise<void>;
  createWorkspace(): Promise<void>;
  openWorkspace(): Promise<void>;
  createProject(): Promise<void>;
  openProject(): Promise<void>;
  createNestedProject(name: string, parentProjectId: string | null): Promise<void>;
  switchProject(projectId: string): Promise<void>;
  renameProject(projectId: string, name: string): Promise<void>;
  openProjectInExplorer(projectId: string): Promise<void>;
  moveProjectToTrash(projectId: string): Promise<void>;
  restoreProject(projectId: string): Promise<void>;
  permanentlyDeleteProject(projectId: string, cleanupOrphans?: boolean): Promise<void>;
  exportProject(projectId: string): Promise<void>;
  saveProject(): Promise<SaveResult | null>;
}

let switchTail: Promise<void> = Promise.resolve();
let saveTail: Promise<SaveResult | null> = Promise.resolve(null);

function openedState(result: WorkspaceOpenResult, message: string): Partial<ProjectState> {
  return {
    workspace: result.workspace,
    snapshot: result.project,
    saveStatus: "saved",
    message
  };
}

export const useProject = create<ProjectState>((set, get) => ({
  workspace: null,
  snapshot: null,
  recentWorkspaces: [],
  workspaceInitialized: false,
  workspaceInitializing: false,
  saveStatus: "idle",
  message: "",
  setSnapshot: (snapshot, markDirty = true) => set({
    snapshot,
    saveStatus: snapshot && markDirty ? "dirty" : snapshot ? "saved" : "idle"
  }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setMessage: (message) => set({ message }),
  initializeWorkspace: async () => {
    if (get().workspaceInitialized || get().workspaceInitializing) return;
    set({ workspaceInitializing: true });
    try {
      const restored = await window.mindmapAI.workspace.restoreLast();
      const recentWorkspaces = await window.mindmapAI.workspace.listRecent();
      if (restored.result) {
        set({
          ...openedState(restored.result, ""),
          recentWorkspaces,
          workspaceInitialized: true
        });
      } else {
        set({
          recentWorkspaces,
          workspaceInitialized: true,
          message: restored.warning ?? "",
          saveStatus: restored.warning ? "error" : "idle"
        });
      }
    } catch (error) {
      set({
        workspaceInitialized: true,
        message: error instanceof Error ? error.message : "恢复最近工作区失败",
        saveStatus: "error"
      });
    } finally {
      set({ workspaceInitializing: false });
    }
  },
  switchWorkspace: async (id) => {
    const run = async (): Promise<void> => {
      if (get().saveStatus === "dirty" && !await get().saveProject()) return;
      try {
        const result = await window.mindmapAI.workspace.switchRecent(id);
        const recentWorkspaces = await window.mindmapAI.workspace.listRecent();
        set({ ...openedState(result, `已切换工作区：${result.workspace.name}`), recentWorkspaces });
      } catch (error) {
        set({ message: error instanceof Error ? error.message : "切换工作区失败", saveStatus: "error" });
      }
    };
    const result = switchTail.then(run, run);
    switchTail = result.then(() => undefined, () => undefined);
    await result;
  },
  forgetRecentWorkspace: async (id) => {
    try {
      set({ recentWorkspaces: await window.mindmapAI.workspace.forgetRecent(id) });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "移除最近工作区失败", saveStatus: "error" });
    }
  },
  createWorkspace: async () => {
    try {
      const result = await window.mindmapAI.workspace.create();
      if (result) set({ ...openedState(result, "工作区已创建"), recentWorkspaces: await window.mindmapAI.workspace.listRecent() });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "创建工作区失败", saveStatus: "error" });
    }
  },
  openWorkspace: async () => {
    try {
      const result = await window.mindmapAI.workspace.open();
      if (result) set({ ...openedState(result, "工作区已打开"), recentWorkspaces: await window.mindmapAI.workspace.listRecent() });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "打开工作区失败", saveStatus: "error" });
    }
  },
  createProject: async () => get().createWorkspace(),
  openProject: async () => get().openWorkspace(),
  createNestedProject: async (name, parentProjectId) => {
    const run = async (): Promise<void> => {
      if (get().saveStatus === "dirty" && !await get().saveProject()) {
        throw new Error("保存当前项目失败，未创建新项目");
      }
      try {
        const project = await window.mindmapAI.project.createNested(name, parentProjectId);
        const workspace = await window.mindmapAI.workspace.getSummary();
        set({ workspace, snapshot: project, saveStatus: "saved", message: `已创建：${name}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "创建项目失败";
        set({ message, saveStatus: "error" });
        throw error instanceof Error ? error : new Error(message);
      }
    };
    const result = switchTail.then(run, run);
    switchTail = result.then(() => undefined, () => undefined);
    await result;
  },
  switchProject: async (projectId) => {
    if (get().snapshot?.manifest.projectId === projectId) return;
    const run = async (): Promise<void> => {
      if (get().saveStatus === "dirty" && !await get().saveProject()) return;
      try {
        const project = await window.mindmapAI.project.switch(projectId);
        const workspace = get().workspace;
        set({
          workspace: workspace ? { ...workspace, activeProjectId: projectId } : workspace,
          snapshot: project,
          saveStatus: "saved",
          message: `已切换到：${project.manifest.name}`
        });
      } catch (error) {
        set({ message: error instanceof Error ? error.message : "切换项目失败", saveStatus: "error" });
      }
    };
    const result = switchTail.then(run, run);
    switchTail = result.then(() => undefined, () => undefined);
    await result;
  },
  renameProject: async (projectId, name) => {
    try {
      const workspace = await window.mindmapAI.project.rename(projectId, name);
      const snapshot = get().snapshot;
      set({
        workspace,
        snapshot: snapshot?.manifest.projectId === projectId
          ? { ...snapshot, manifest: { ...snapshot.manifest, name } }
          : snapshot,
        message: "项目已重命名"
      });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "项目重命名失败", saveStatus: "error" });
    }
  },
  openProjectInExplorer: async (projectId) => {
    try {
      await window.mindmapAI.project.openInExplorer(projectId);
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "无法打开项目文件夹", saveStatus: "error" });
    }
  },
  moveProjectToTrash: async (projectId) => {
    if (get().saveStatus === "dirty" && !await get().saveProject()) return;
    try {
      const result = await window.mindmapAI.project.moveToTrash(projectId);
      set(openedState(result, "项目已移到垃圾箱"));
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "项目删除失败", saveStatus: "error" });
    }
  },
  restoreProject: async (projectId) => {
    try {
      const workspace = await window.mindmapAI.project.restore(projectId);
      set({ workspace, message: "项目已恢复" });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "项目恢复失败", saveStatus: "error" });
    }
  },
  permanentlyDeleteProject: async (projectId, cleanupOrphans = false) => {
    try {
      const workspace = await window.mindmapAI.project.permanentlyDelete(projectId, cleanupOrphans);
      set({ workspace, message: "项目已彻底删除" });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "彻底删除失败", saveStatus: "error" });
    }
  },
  exportProject: async (projectId) => {
    try {
      const exported = await window.mindmapAI.project.export(projectId);
      if (exported) set({ message: "独立项目已导出" });
    } catch (error) {
      set({ message: error instanceof Error ? error.message : "项目导出失败", saveStatus: "error" });
    }
  },
  saveProject: async () => {
    const snapshot = get().snapshot;
    if (!snapshot) return null;
    const run = async (): Promise<SaveResult | null> => {
      set({ saveStatus: "saving" });
      try {
        const result = await window.mindmapAI.project.saveActive(snapshot);
        set({
          saveStatus: get().snapshot === snapshot ? "saved" : "dirty",
          message: get().snapshot === snapshot ? "所有更改已保存" : "检测到新的更改，正在继续保存"
        });
        return result;
      } catch (error) {
        set({
          saveStatus: get().snapshot === snapshot ? "error" : "dirty",
          message: error instanceof Error ? error.message : "保存失败"
        });
        return null;
      }
    };
    const result = saveTail.then(run, run);
    saveTail = result;
    return result;
  }
}));
