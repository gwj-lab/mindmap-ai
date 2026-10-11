import { dialog, ipcMain } from 'electron';
import { z } from 'zod';
import type { MindMapNodeData } from '../shared/types.js';
import type { WorkspaceStore } from './workspace-store.js';
import { createNodeAttachment } from './node-attachments.js';
import { WorkspaceSearch } from './workspace-search.js';

export function registerNodeToolsIpc(getWorkspace: () => WorkspaceStore, assertSender: (event: Electron.IpcMainInvokeEvent) => void): void {
  const indexes = new WeakMap<WorkspaceStore, WorkspaceSearch>();
  ipcMain.handle('workspace:search', async (event, raw: unknown) => {
    assertSender(event);
    const { query, includeContent } = z.object({ query: z.string().max(200), includeContent: z.boolean() }).parse(raw);
    const store = getWorkspace(); let index = indexes.get(store);
    if (!index) { index = new WorkspaceSearch(store); indexes.set(store, index); }
    return index.query(query, includeContent);
  });
  ipcMain.handle('project:create-attachment', async (event, raw: unknown) => {
    assertSender(event);
    const { nodeUid, kind } = z.object({ nodeUid: z.string().min(1).max(128), kind: z.enum(['blank', 'import']) }).parse(raw);
    const store = getWorkspace(); const project = store.getActiveProjectStore();
    const snapshot = await project.loadPortable();
    if (snapshot.readOnly) throw new Error('当前项目只读');
    const find = (node: MindMapNodeData): MindMapNodeData | undefined => node.uid === nodeUid ? node : node.children.map(find).find(Boolean);
    const node = find(snapshot.mindmap);
    if (!node) throw new Error('节点已不存在');
    let file: string | undefined;
    if (kind === 'import') {
      const chosen = await dialog.showOpenDialog({ title: '导入 Markdown 附件', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return null;
      file = chosen.filePaths[0];
    }
    return createNodeAttachment(store.answers, node.text, file);
  });
}
