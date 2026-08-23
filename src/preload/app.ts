import { contextBridge, ipcRenderer } from "electron";
import type { AnswerDocument, DesktopApi, PanelBounds, ProjectSnapshot } from "../shared/types.js";

const IPC = {
  workspaceCreate: "workspace:create",
  workspaceOpen: "workspace:open",
  workspaceGetSummary: "workspace:get-summary",
  workspaceRestoreLast: "workspace:restore-last",
  workspaceListRecent: "workspace:list-recent",
  workspaceSwitchRecent: "workspace:switch-recent",
  workspaceForgetRecent: "workspace:forget-recent",
  settingsGetPublic: "settings:get-public",
  settingsUpdatePublic: "settings:update-public",
  settingsTestConnection: "settings:test-connection",
  settingsSetApiKey: "settings:set-api-key",
  settingsClearApiKey: "settings:clear-api-key",
  workspaceProjectCreate: "workspace-project:create",
  workspaceProjectSwitch: "workspace-project:switch",
  workspaceProjectRename: "workspace-project:rename",
  workspaceProjectSave: "workspace-project:save",
  workspaceProjectOpenInExplorer: "workspace-project:open-in-explorer",
  workspaceProjectMoveToTrash: "workspace-project:move-to-trash",
  workspaceProjectRestore: "workspace-project:restore",
  workspaceProjectPermanentlyDelete: "workspace-project:permanently-delete",
  workspaceProjectExport: "workspace-project:export",
  projectCreate: "project:create",
  projectOpen: "project:open",
  projectSave: "project:save",
  projectReadAnswer: "project:read-answer",
  projectWriteAnswer: "project:write-answer",
  aiSetPanelBounds: "ai:set-panel-bounds",
  aiSetPanelVisible: "ai:set-panel-visible",
  aiCaptureLatest: "ai:capture-latest",
  aiPickAnswer: "ai:pick-answer",
  aiSetHoverCapture: "ai:set-hover-capture",
  aiBeginLocalDrag: "ai:begin-local-drag",
  aiEndLocalDrag: "ai:end-local-drag",
  aiAnswerCaptured: "ai:answer-captured",
  aiAdapterError: "ai:adapter-error"
} as const;

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: DesktopApi = {
  settings: {
    getPublicSettings: () => ipcRenderer.invoke(IPC.settingsGetPublic),
    updatePublicSettings: (update, confirmBaseUrlChange) => ipcRenderer.invoke(
      IPC.settingsUpdatePublic,
      { update, confirmBaseUrlChange }
    ),
    testConnection: (input) => ipcRenderer.invoke(IPC.settingsTestConnection, input),
    setApiKey: (apiKey) => ipcRenderer.invoke(IPC.settingsSetApiKey, { apiKey }),
    clearApiKey: () => ipcRenderer.invoke(IPC.settingsClearApiKey)
  },
  workspace: {
    create: () => ipcRenderer.invoke(IPC.workspaceCreate),
    open: () => ipcRenderer.invoke(IPC.workspaceOpen),
    getSummary: () => ipcRenderer.invoke(IPC.workspaceGetSummary),
    restoreLast: () => ipcRenderer.invoke(IPC.workspaceRestoreLast),
    listRecent: () => ipcRenderer.invoke(IPC.workspaceListRecent),
    switchRecent: (id) => ipcRenderer.invoke(IPC.workspaceSwitchRecent, { id }),
    forgetRecent: (id) => ipcRenderer.invoke(IPC.workspaceForgetRecent, { id })
  },
  project: {
    create: () => ipcRenderer.invoke(IPC.projectCreate),
    open: () => ipcRenderer.invoke(IPC.projectOpen),
    save: (snapshot: ProjectSnapshot) => ipcRenderer.invoke(IPC.projectSave, snapshot),
    readAnswer: (answerId: string) => ipcRenderer.invoke(IPC.projectReadAnswer, answerId),
    writeAnswer: (answer: AnswerDocument) => ipcRenderer.invoke(IPC.projectWriteAnswer, answer),
    createNested: (name, parentProjectId) => ipcRenderer.invoke(
      IPC.workspaceProjectCreate,
      { name, parentProjectId }
    ),
    switch: (projectId) => ipcRenderer.invoke(IPC.workspaceProjectSwitch, { projectId }),
    rename: (projectId, name) => ipcRenderer.invoke(IPC.workspaceProjectRename, { projectId, name }),
    saveActive: (snapshot) => ipcRenderer.invoke(IPC.workspaceProjectSave, snapshot),
    openInExplorer: (projectId) => ipcRenderer.invoke(IPC.workspaceProjectOpenInExplorer, { projectId }),
    moveToTrash: (projectId) => ipcRenderer.invoke(IPC.workspaceProjectMoveToTrash, { projectId }),
    restore: (projectId) => ipcRenderer.invoke(IPC.workspaceProjectRestore, { projectId }),
    permanentlyDelete: (projectId, cleanupOrphans) => ipcRenderer.invoke(
      IPC.workspaceProjectPermanentlyDelete,
      { projectId, cleanupOrphans }
    ),
    export: (projectId) => ipcRenderer.invoke(IPC.workspaceProjectExport, { projectId })
  },
  ai: {
    setPanelBounds: (bounds: PanelBounds) => ipcRenderer.send(IPC.aiSetPanelBounds, bounds),
    setPanelVisible: (visible: boolean) => ipcRenderer.send(IPC.aiSetPanelVisible, visible),
    captureLatest: () => ipcRenderer.send(IPC.aiCaptureLatest),
    pickAnswer: () => ipcRenderer.send(IPC.aiPickAnswer),
    setHoverCapture: (enabled: boolean) => ipcRenderer.send(IPC.aiSetHoverCapture, enabled),
    beginLocalDrag: () => ipcRenderer.send(IPC.aiBeginLocalDrag),
    endLocalDrag: () => ipcRenderer.send(IPC.aiEndLocalDrag),
    onAnswerCaptured: (listener) => subscribe(IPC.aiAnswerCaptured, listener),
    onAdapterError: (listener) => subscribe(IPC.aiAdapterError, listener)
  }
};

contextBridge.exposeInMainWorld("mindmapAI", api);
