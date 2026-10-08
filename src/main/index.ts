import { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CaptureService } from "./capture-service.js";
import { AiViewManager } from "./ai-view-manager.js";
import { ProjectStore } from "./project-store.js";
import { WorkspaceStore } from "./workspace-store.js";
import { RecentWorkspaceStore } from "./recent-workspace-store.js";
import { exportStandaloneProject } from "./project-exporter.js";
import { isTrustedIpcSender } from "./ipc-guards.js";
import { SettingsStore } from "./settings-store.js";
import { TitleService } from "./title-service.js";
import { registerConceptIpc } from "./concept-ipc.js";
import {
  IPC,
  aiTabIdSchema,
  aiTabsSchema,
  apiKeyRequestSchema,
  connectionTestRequestSchema,
  capturedAnswerPayloadSchema,
  projectCreateRequestSchema,
  projectIdRequestSchema,
  projectPermanentDeleteRequestSchema,
  projectRenameRequestSchema,
  projectReparentRequestSchema,
  projectLinkNodeRequestSchema,
  recentWorkspaceIdRequestSchema,
  publicSettingsUpdateRequestSchema
} from "../shared/ipc.js";
import { validatePanelBounds } from "../shared/security.js";
import type { ActiveProjectSnapshot, AnswerDocument, ProjectSnapshot, WorkspaceOpenResult } from "../shared/types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let aiManager: AiViewManager | null = null;
let activeStore: ProjectStore | null = null;
let activeWorkspaceStore: WorkspaceStore | null = null;
let settingsStore: SettingsStore | null = null;
let titleService: TitleService | null = null;
let recentWorkspaceStore: RecentWorkspaceStore | null = null;

function assertLocalSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (!mainWindow || !isTrustedIpcSender(event.sender, mainWindow.webContents)) throw new Error("Untrusted IPC sender");
}

function requireStore(): ProjectStore {
  const store = activeStore ?? activeWorkspaceStore?.getActiveProjectStore();
  if (!store) throw new Error("请先新建或打开项目");
  return store;
}

function requireWorkspaceStore(): WorkspaceStore {
  if (!activeWorkspaceStore) throw new Error("请先新建或打开工作区");
  return activeWorkspaceStore;
}

function requireSettingsStore(): SettingsStore {
  if (!settingsStore) throw new Error("设置存储尚未初始化");
  return settingsStore;
}

function requireRecentWorkspaceStore(): RecentWorkspaceStore {
  if (!recentWorkspaceStore) throw new Error("最近工作区存储尚未初始化");
  return recentWorkspaceStore;
}

async function activateWorkspace(root: string): Promise<WorkspaceOpenResult> {
  const candidate = new WorkspaceStore(root);
  const opened = await candidate.loadOrMigrate();
  activeWorkspaceStore = candidate;
  activeStore = null;
  await requireRecentWorkspaceStore().record(root, opened.workspace.name);
  return opened;
}

async function selectProjectDirectory(title: string): Promise<string | null> {
  if (!mainWindow) return null;
  const selection = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ["openDirectory", "createDirectory"]
  });
  return selection.canceled ? null : selection.filePaths[0] ?? null;
}

function registerIpc(): void {
  const writeConceptAnswer = registerConceptIpc(() => mainWindow, () => aiManager, () => activeWorkspaceStore);
  ipcMain.handle(IPC.settingsGetPublic, (event) => {
    assertLocalSender(event);
    return requireSettingsStore().getPublicSettings();
  });
  ipcMain.handle(IPC.settingsUpdatePublic, (event, rawRequest) => {
    assertLocalSender(event);
    const request = publicSettingsUpdateRequestSchema.parse(rawRequest);
    return requireSettingsStore().updatePublicSettings(request.update, request.confirmBaseUrlChange);
  });
  ipcMain.handle(IPC.settingsSetApiKey, (event, rawRequest) => {
    assertLocalSender(event);
    return requireSettingsStore().setApiKey(apiKeyRequestSchema.parse(rawRequest).apiKey);
  });
  ipcMain.handle(IPC.settingsTestConnection, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = connectionTestRequestSchema.parse(rawRequest);
    const apiKey = request.apiKey ?? await requireSettingsStore().getApiKey();
    if (!apiKey) return { ok: false, message: "请先输入或保存 API 密钥" };
    if (!titleService) return { ok: false, message: "API 服务尚未初始化" };
    return titleService.testConnection({ baseUrl: request.baseUrl, model: request.model, apiKey });
  });
  ipcMain.handle(IPC.settingsClearApiKey, (event) => {
    assertLocalSender(event);
    return requireSettingsStore().clearApiKey();
  });
  ipcMain.handle(IPC.workspaceCreate, async (event) => {
    assertLocalSender(event);
    const root = await selectProjectDirectory("选择新工作区文件夹");
    if (!root) return null;
    const candidate = new WorkspaceStore(root);
    const opened = await candidate.initialize(path.basename(root), "主项目");
    activeWorkspaceStore = candidate;
    activeStore = null;
    await requireRecentWorkspaceStore().record(root, opened.workspace.name);
    return opened;
  });
  ipcMain.handle(IPC.workspaceOpen, async (event) => {
    assertLocalSender(event);
    const root = await selectProjectDirectory("打开 Mindmap AI 工作区或旧项目");
    if (!root) return null;
    return activateWorkspace(root);
  });
  ipcMain.handle(IPC.workspaceGetSummary, (event) => {
    assertLocalSender(event);
    return activeWorkspaceStore?.getSummary() ?? null;
  });
  ipcMain.handle(IPC.workspaceListRecent, (event) => {
    assertLocalSender(event);
    return requireRecentWorkspaceStore().list();
  });
  ipcMain.handle(IPC.workspaceRestoreLast, async (event) => {
    assertLocalSender(event);
    const recents = requireRecentWorkspaceStore();
    const entry = await recents.mostRecent();
    if (!entry) return { result: null };
    try {
      return { result: await activateWorkspace(entry.path) };
    } catch {
      await recents.forget(entry.id);
      return { result: null, warning: `无法恢复工作区“${entry.name}”，请重新选择其位置` };
    }
  });
  ipcMain.handle(IPC.workspaceSwitchRecent, async (event, rawRequest) => {
    assertLocalSender(event);
    const { id } = recentWorkspaceIdRequestSchema.parse(rawRequest);
    const recents = requireRecentWorkspaceStore();
    const root = await recents.resolve(id);
    if (!root) throw new Error("最近工作区记录不存在");
    try {
      return await activateWorkspace(root);
    } catch {
      await recents.forget(id);
      throw new Error("工作区已移动、删除或格式无效，请重新选择");
    }
  });
  ipcMain.handle(IPC.workspaceForgetRecent, async (event, rawRequest) => {
    assertLocalSender(event);
    const { id } = recentWorkspaceIdRequestSchema.parse(rawRequest);
    const recents = requireRecentWorkspaceStore();
    await recents.forget(id);
    return recents.list();
  });
  ipcMain.handle(IPC.workspaceProjectCreate, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectCreateRequestSchema.parse(rawRequest);
    return requireWorkspaceStore().createProject(request.name, request.parentProjectId);
  });
  ipcMain.handle(IPC.workspaceProjectSwitch, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectIdRequestSchema.parse(rawRequest);
    return requireWorkspaceStore().switchProject(request.projectId);
  });
  ipcMain.handle(IPC.workspaceProjectRename, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectRenameRequestSchema.parse(rawRequest);
    const store = requireWorkspaceStore();
    await store.renameProject(request.projectId, request.name);
    return store.getSummary();
  });
  ipcMain.handle(IPC.workspaceProjectSave, async (event, snapshot: ActiveProjectSnapshot) => {
    assertLocalSender(event);
    return requireWorkspaceStore().saveActive(snapshot);
  });
  ipcMain.handle(IPC.workspaceProjectReparent, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectReparentRequestSchema.parse(rawRequest);
    const store = requireWorkspaceStore();
    await store.reparentProject(request.projectId, request.parentProjectId);
    return store.getOpenResult();
  });
  ipcMain.handle(IPC.workspaceProjectLinkNode, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectLinkNodeRequestSchema.parse(rawRequest);
    return requireWorkspaceStore().linkNode(request.nodeUid, request.target);
  });
  ipcMain.handle(IPC.workspaceProjectOpenInExplorer, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectIdRequestSchema.parse(rawRequest);
    shell.showItemInFolder(path.join(requireWorkspaceStore().getProjectDirectory(request.projectId), "project.json"));
  });
  ipcMain.handle(IPC.workspaceProjectMoveToTrash, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectIdRequestSchema.parse(rawRequest);
    const store = requireWorkspaceStore();
    await store.moveProjectToTrash(request.projectId);
    return store.getOpenResult();
  });
  ipcMain.handle(IPC.workspaceProjectRestore, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectIdRequestSchema.parse(rawRequest);
    const store = requireWorkspaceStore();
    await store.restoreProject(request.projectId);
    return store.getSummary();
  });
  ipcMain.handle(IPC.workspaceProjectPermanentlyDelete, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectPermanentDeleteRequestSchema.parse(rawRequest);
    const store = requireWorkspaceStore();
    await store.permanentlyDeleteProject(request.projectId, request.cleanupOrphans);
    return store.getSummary();
  });
  ipcMain.handle(IPC.workspaceProjectExport, async (event, rawRequest) => {
    assertLocalSender(event);
    const request = projectIdRequestSchema.parse(rawRequest);
    const destination = await selectProjectDirectory("选择独立项目导出文件夹");
    if (!destination) return false;
    const store = requireWorkspaceStore();
    await exportStandaloneProject(
      store.getWorkspaceDirectory(),
      store.getSummary(),
      request.projectId,
      destination
    );
    return true;
  });
  ipcMain.handle(IPC.projectCreate, async (event) => {
    assertLocalSender(event);
    const root = await selectProjectDirectory("选择新项目文件夹");
    if (!root) return null;
    const candidate = new ProjectStore(root);
    const snapshot = await candidate.initialize(path.basename(root));
    activeStore = candidate;
    activeWorkspaceStore = null;
    return snapshot;
  });
  ipcMain.handle(IPC.projectOpen, async (event) => {
    assertLocalSender(event);
    const root = await selectProjectDirectory("打开 Mindmap AI 项目");
    if (!root) return null;
    const candidate = new ProjectStore(root);
    const snapshot = await candidate.load();
    activeStore = candidate;
    activeWorkspaceStore = null;
    return snapshot;
  });
  ipcMain.handle(IPC.projectSave, async (event, snapshot: ProjectSnapshot) => {
    assertLocalSender(event);
    return requireStore().save(snapshot);
  });
  ipcMain.handle(IPC.projectReadAnswer, async (event, answerId: string) => {
    assertLocalSender(event);
    return requireStore().readAnswer(answerId);
  });
  ipcMain.handle(IPC.projectWriteAnswer, async (event, answer: AnswerDocument) => {
    assertLocalSender(event);
    const store = requireStore();
    return activeWorkspaceStore ? writeConceptAnswer(answer, (next) => store.writeAnswer(next)) : store.writeAnswer(answer);
  });

  ipcMain.on(IPC.aiSetPanelBounds, (event, bounds, tabId) => {
    assertLocalSender(event);
    aiManager?.setBounds(validatePanelBounds(bounds), aiTabIdSchema.parse(tabId ?? "ai"));
  });
  ipcMain.on(IPC.aiSetPanelVisible, (event, visible: unknown, tabId) => {
    assertLocalSender(event);
    if (typeof visible !== "boolean") throw new Error("Invalid visibility value");
    aiManager?.setVisible(visible, tabId === undefined ? undefined : aiTabIdSchema.parse(tabId));
  });
  ipcMain.on(IPC.aiSyncTabs, (event, tabs: unknown) => {
    assertLocalSender(event);
    aiManager?.syncTabs(aiTabsSchema.parse(tabs));
  });
  ipcMain.on(IPC.aiCaptureLatest, (event, tabId) => {
    assertLocalSender(event);
    aiManager?.requestCapture(aiTabIdSchema.parse(tabId ?? "ai"));
  });
  ipcMain.on(IPC.aiPickAnswer, (event, tabId) => {
    assertLocalSender(event);
    aiManager?.requestPicker(aiTabIdSchema.parse(tabId ?? "ai"));
  });
  ipcMain.on(IPC.aiSetHoverCapture, (event, enabled: unknown, tabId) => {
    assertLocalSender(event);
    if (typeof enabled !== "boolean") throw new Error("Invalid hover capture state");
    aiManager?.setHoverCapture(enabled, aiTabIdSchema.parse(tabId ?? "ai"));
  });
  ipcMain.on(IPC.aiSetExpansionPrompt, (event, prompt: unknown, tabId) => {
    assertLocalSender(event);
    if (typeof prompt !== "string" || prompt.length > 4000) throw new Error("Invalid expansion prompt");
    aiManager?.setExpansionPrompt(prompt.trim(), aiTabIdSchema.parse(tabId ?? "ai"));
  });
  ipcMain.on(IPC.aiBeginLocalDrag, (event) => {
    assertLocalSender(event);
    aiManager?.setDragging(true);
  });
  ipcMain.on(IPC.aiEndLocalDrag, (event) => {
    assertLocalSender(event);
    aiManager?.setDragging(false);
  });
  ipcMain.handle(IPC.aiCapturedFromPage, async (event, rawPayload) => {
    const context = aiManager?.getCaptureContext(event.sender);
    if (!context) throw new Error("Untrusted capture sender");
    const payload = capturedAnswerPayloadSchema.parse(rawPayload);
    if (payload.provider !== context.provider) throw new Error("Capture provider does not match tab");
    if (new URL(payload.sourceUrl).hostname !== new URL(event.sender.getURL()).hostname) throw new Error("Capture source does not match page");
    const acknowledgement = await new CaptureService(requireStore(), {
      expansionPrompt: context.expansionPrompt,
      portable: activeWorkspaceStore !== null,
      ...(settingsStore ? { settingsStore } : {}),
      ...(titleService ? { titleService } : {})
    }).capture(payload);
    if (acknowledgement.status === "captured") {
      mainWindow?.webContents.send(IPC.aiAnswerCaptured, acknowledgement);
    }
    return acknowledgement;
  });
  ipcMain.on(IPC.aiAdapterErrorFromPage, (event, message: unknown) => {
    if (!aiManager?.getCaptureContext(event.sender)) return;
    mainWindow?.webContents.send(IPC.aiAdapterError, typeof message === "string" ? message.slice(0, 500) : "回答提取失败");
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#e9eef0",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDir, "../preload/app.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  aiManager = new AiViewManager(mainWindow, path.join(currentDir, "../preload/chatgpt.cjs"), (message) => {
    mainWindow?.webContents.send(IPC.aiAdapterError, message);
  });
  mainWindow.on("close", () => {
    aiManager?.destroy();
    aiManager = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(currentDir, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId("local.mindmap-ai");
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "secure-settings"), safeStorage);
  recentWorkspaceStore = new RecentWorkspaceStore(path.join(app.getPath("userData"), "workspace-history"));
  titleService = new TitleService((input, init) => net.fetch(input, init));
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
