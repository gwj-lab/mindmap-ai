import { app, dialog, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { S3SettingsStore } from './s3-settings-store.js';
import { S3Sync } from './s3-sync.js';
import type { WorkspaceStore } from './workspace-store.js';
import type { WorkspaceOpenResult } from '../shared/types.js';
import { s3SettingsInputSchema } from '../shared/sync.js';

export function registerS3Ipc(getWorkspace: () => WorkspaceStore, assertSender: (event: Electron.IpcMainInvokeEvent) => void, openDownloaded: (root: string) => Promise<WorkspaceOpenResult>): void {
  const directory = path.join(app.getPath('userData'), 'secure-settings');
  const settings = new S3SettingsStore(directory, safeStorage); let busy = false;
  const idle = (): void => { if (busy) throw new Error('S3 操作正在进行，请稍候'); };
  const run = async <T>(operation: (sync: S3Sync) => Promise<T>): Promise<T> => {
    idle(); busy = true; let sync: S3Sync | undefined;
    try { sync = new S3Sync(await settings.require(), directory); return await operation(sync); }
    finally { sync?.close(); busy = false; }
  };
  ipcMain.handle('sync:get-settings', (event) => { assertSender(event); return settings.getPublic(); });
  ipcMain.handle('sync:save-settings', (event, input: unknown) => { assertSender(event); idle(); return settings.save(s3SettingsInputSchema.parse(input)); });
  ipcMain.handle('sync:clear-settings', (event) => { assertSender(event); idle(); return settings.clear(); });
  ipcMain.handle('sync:test', (event) => { assertSender(event); return run((sync) => sync.testConnection()); });
  ipcMain.handle('sync:upload', (event) => { assertSender(event); const root = getWorkspace().getWorkspaceDirectory(); return run((sync) => sync.upload(root)); });
  ipcMain.handle('sync:download', async (event) => {
    assertSender(event); idle();
    const selected = await dialog.showOpenDialog({ title: '选择空文件夹接收云端工作区', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const root = selected.filePaths[0];
    return run(async (sync) => { await sync.download(root); return openDownloaded(root); });
  });
}
