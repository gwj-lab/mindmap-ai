import { ipcMain, type BrowserWindow } from "electron";
import { z } from "zod";
import { conceptRequestSchema, conceptSelectionSchema, conceptSettingsSchema } from "../shared/concepts.js";
import { capturedAnswerPayloadSchema } from "../shared/ipc.js";
import { isTrustedIpcSender } from "./ipc-guards.js";
import { ConceptService } from "./concept-service.js";
import type { AiViewManager } from "./ai-view-manager.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { AnswerDocument, SaveResult } from "../shared/types.js";

const idSchema = z.string().uuid();
export function registerConceptIpc(window: () => BrowserWindow | null, manager: () => AiViewManager | null, workspace: () => WorkspaceStore | null): (answer: AnswerDocument, write: (answer: AnswerDocument) => Promise<SaveResult>) => Promise<SaveResult> {
  const services = new Map<string, ConceptService>();
  const jobs = new Map<string, { id: string; service: ConceptService; timer: ReturnType<typeof setTimeout> }>();
  function local(event: Electron.IpcMainInvokeEvent): void { if (!window() || !isTrustedIpcSender(event.sender, window()!.webContents)) throw new Error("Untrusted concept sender"); }
  function current(): ConceptService {
    const store = workspace(); if (!store) throw new Error("请先打开工作区");
    const root = store.getWorkspaceDirectory();
    if (!services.has(root)) services.set(root, new ConceptService(root, () => {
      if (workspace()?.getWorkspaceDirectory() !== root) return;
      window()?.webContents.send("concepts:changed", store.getSummary().workspaceId);
      void services.get(root)!.get().then((library) => manager()?.broadcastConcepts(library.records));
    }));
    return services.get(root)!;
  }
  function remote(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): string {
    const tabId = manager()?.getTabId(event.sender); if (!tabId) throw new Error("Untrusted concept page"); return tabId;
  }
  ipcMain.handle("concepts:get", (event) => { local(event); return current().get(); });
  ipcMain.handle("concepts:settings", (event, input) => { local(event); return current().settings(conceptSettingsSchema.parse(input)); });
  ipcMain.handle("concepts:prepare", async (event, input) => {
    local(event); const service = current(); const store = workspace()!; const project = await store.getActiveProjectStore()!.loadPortable();
    if (project.readOnly) throw new Error("当前项目只读");
    return service.prepare(conceptRequestSchema.parse(input), project.manifest.projectId);
  });
  ipcMain.handle("concepts:retry", (event, input) => { local(event); return current().retry(idSchema.parse(input)); });
  ipcMain.handle("concepts:update", (event, input) => {
    local(event); const request = z.object({ id: idSchema, action: z.enum(["trash", "restore", "delete", "rename"]), title: z.string().trim().min(1).max(160).optional() }).strict().parse(input);
    return current().update(request.id, request.action, request.title);
  });
  ipcMain.handle("concepts:run", async (event, input) => {
    local(event); const id = idSchema.parse(input); const service = current();
    const record = (await service.get()).records.find((record) => record.id === id);
    if (!record || record.status !== "generating") throw new Error("没有待生成的概念");
    if (jobs.has(record.tabId)) return;
    const timer = setTimeout(() => { jobs.delete(record.tabId); void service.fail(id, "生成页面已关闭或生成超时，请重试"); }, 190000);
    jobs.set(record.tabId, { id, service, timer });
    try { manager()!.startConcept(record.tabId, id, record.prompt); }
    catch (error) { clearTimeout(timer); jobs.delete(record.tabId); await service.fail(id, error instanceof Error ? error.message : "生成页面不可用"); throw error; }
  });
  ipcMain.handle("concepts:select-page", async (event, input) => {
    remote(event);
    const { payload, selection } = z.object({ payload: capturedAnswerPayloadSchema, selection: conceptSelectionSchema }).strict().parse(input);
    if (payload.provider !== manager()!.getCaptureContext(event.sender)!.provider || new URL(payload.sourceUrl).hostname !== new URL(event.sender.getURL()).hostname) throw new Error("概念来源平台不匹配");
    const service = current();
    const project = await workspace()!.getActiveProjectStore()!.loadPortable();
    if (project.readOnly) throw new Error("当前项目只读");
    const source = await service.saveSource(payload);
    window()?.webContents.send("concepts:request", { sourceAnswerId: source.metadata.id, sourceTitle: source.metadata.title === "概念来源回答" ? project.mindmap.text : source.metadata.title, selection });
  });
  ipcMain.handle("concepts:page-marks", (event) => { remote(event); return workspace() ? current().get().then((library) => library.records) : []; });
  ipcMain.on("concepts:open-page", (event, input) => {
    remote(event);
    if (typeof input !== "string" || !/^concept-[a-f0-9-]{36}$/.test(input)) return;
    window()?.webContents.send("concepts:open", input);
  });
  ipcMain.handle("concepts:generated-page", async (event, input) => {
    const tabId = remote(event); const job = jobs.get(tabId);
    const request = z.object({ id: idSchema, payload: capturedAnswerPayloadSchema }).strict().parse(input);
    if (!job || job.id !== request.id || request.payload.provider !== manager()!.getCaptureContext(event.sender)!.provider || new URL(request.payload.sourceUrl).hostname !== new URL(event.sender.getURL()).hostname) throw new Error("概念任务来源不匹配");
    try { await job.service.complete(job.id, request.payload); }
    catch (error) { await job.service.fail(job.id, error instanceof Error ? error.message : "保存概念失败"); throw error; }
    finally { clearTimeout(job.timer); jobs.delete(tabId); }
  });
  ipcMain.handle("concepts:failed-page", async (event, input) => {
    const tabId = remote(event); const job = jobs.get(tabId);
    const request = z.object({ id: idSchema, error: z.string().max(500) }).strict().parse(input);
    if (!job || job.id !== request.id) throw new Error("概念任务来源不匹配");
    clearTimeout(job.timer); jobs.delete(tabId); await job.service.fail(job.id, request.error);
  });
  return (answer, write) => current().writeEdited(answer, write);
}
