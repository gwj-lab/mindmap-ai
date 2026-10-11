import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../../src/main/workspace-store.js';
import { contentHash } from '../../src/shared/content.js';

test('reader clipboard shortcuts, merge attachment choice and undo, capture in both modes', async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(path.join(tmpdir(), 'mindmap-copy-merge-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'mindmap-copy-merge-profile-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let previousClipboard: string | undefined;
  try {
    const store = new WorkspaceStore(root);
    const initial = await store.initialize('复制与合并', '验收项目');
    const now = new Date().toISOString();
    for (const [id, title] of [['doc-a', '笔记甲'], ['doc-b', '笔记乙']]) {
      const body = `# ${title}\n\n这段原文用于复制验收。\n\n第二段文字。`;
      await store.answers.write({ metadata: { id, title, provider: 'chatgpt', sourceUrl: 'https://chatgpt.com/c/test', sourceMessageId: id, contentHash: await contentHash(body), capturedAt: now, updatedAt: now }, body });
    }
    await store.saveActive({ ...initial.project, mindmap: { uid: 'root', text: '验收项目', children: [
      { uid: 'a', text: '笔记甲', answerId: 'doc-a', children: [{ uid: 'a1', text: '甲的子节点', children: [] }] },
      { uid: 'b', text: '笔记乙', answerId: 'doc-b', children: [{ uid: 'b1', text: '乙的子节点', children: [] }] }
    ] } });
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] });
    previousClipboard = await app.evaluate(async ({ clipboard }) => clipboard.readText());
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '打开工作区', exact: true }).first().click();
    const map = page.locator('.mindmap-canvas');
    const nodeA = map.locator('.smm-node', { hasText: '笔记甲' });
    const nodeB = map.locator('.smm-node', { hasText: '笔记乙' });
    await nodeA.dblclick();
    const reader = page.getByLabel('回答阅读器');
    const paragraph = reader.locator('.markdown-preview p').first();
    await paragraph.click();
    await paragraph.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await page.keyboard.press('Control+c');
    await expect.poll(() => app!.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('这段原文用于复制验收。');
    await reader.getByRole('button', { name: '复制阅读内容' }).click();
    await expect.poll(() => app!.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('这段原文用于复制验收。');
    await paragraph.click();
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('快捷键粘贴内容。'); });
    await page.keyboard.press('Control+v');
    const editor = reader.locator('.cm-content');
    await expect(editor).toContainText('快捷键粘贴内容。');
    await editor.click(); await page.keyboard.press('Control+End');
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('\n按钮粘贴内容。'); });
    await reader.getByRole('button', { name: '粘贴到笔记' }).click();
    await expect(editor).toContainText('按钮粘贴内容。');
    await reader.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.project.readAnswer('doc-a')))?.body).toContain('按钮粘贴内容。');
    await reader.getByRole('button', { name: '关闭阅读窗口' }).click();
    await nodeA.click(); await nodeB.click({ modifiers: ['Control'] });
    await nodeB.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '合并选中节点' }).click();
    await page.getByRole('dialog', { name: '合并节点' }).getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '合并选中节点' }).click();
    const merge = page.getByRole('dialog', { name: '合并节点' });
    await merge.getByLabel('保留的附加文档').selectOption('doc-b');
    await merge.getByLabel('合并后的标题').fill('合并笔记');
    await merge.getByRole('button', { name: '合并节点', exact: true }).click();
    await expect(map.locator('.smm-node', { hasText: '合并笔记' })).toBeVisible();
    const mapPath = path.join(root, 'projects', initial.project.manifest.projectId, 'mindmap.json');
    await expect.poll(async () => JSON.parse(await readFile(mapPath, 'utf8')).children[0]?.text).toBe('合并笔记');
    const merged = JSON.parse(await readFile(mapPath, 'utf8'));
    expect(merged.children).toHaveLength(1); expect(merged.children[0].answerId).toBe('doc-b');
    expect(merged.children[0].children.map((node: { uid: string }) => node.uid)).toEqual(['a1', 'b1']);
    expect(await page.evaluate(() => window.mindmapAI.project.readAnswer('doc-a'))).not.toBeNull();
    await page.getByRole('button', { name: '撤销 Ctrl+Z' }).click();
    await expect(nodeA).toBeVisible(); await expect(nodeB).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(mapPath, 'utf8')).children.length).toBe(2);
    await app.evaluate(async ({ session, webContents }) => {
      const isolated = session.fromPartition('persist:provider-chatgpt');
      await isolated.protocol.handle('https', () => new Response('<!doctype html><meta charset=utf-8><article data-message-author-role="assistant" data-message-id="capture-one"><div class="markdown"><h1>捕获标题</h1><h2>分点甲</h2><p>捕获原文甲。</p><h2>分点乙</h2><p>捕获原文乙。</p></div></article>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      const contents = webContents.getAllWebContents().find((entry) => entry.session === isolated)!;
      contents.stop(); await new Promise((resolve) => setTimeout(resolve, 100));
      await contents.loadURL('https://chatgpt.com/c/capture-one');
    });
    await page.getByRole('button', { name: '单一节点', exact: true }).click();
    await page.getByRole('button', { name: '捕获最新回答' }).click();
    const projectPath = path.join(root, 'projects', initial.project.manifest.projectId, 'project.json');
    const candidates = async () => JSON.parse(await readFile(projectPath, 'utf8')).state.candidates;
    await expect.poll(async () => (await candidates()).length).toBe(1);
    expect((await candidates())[0].children).toEqual([]);
    await page.getByRole('button', { name: '生成子节点', exact: true }).click();
    await app.evaluate(async ({ session, webContents }) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition('persist:provider-chatgpt'))!;
      await contents.executeJavaScript(`document.querySelector('article').dataset.messageId='capture-two';document.querySelector('p').textContent='第二次捕获原文。'`);
    });
    await page.getByRole('button', { name: '捕获最新回答' }).click();
    await expect.poll(async () => (await candidates()).length).toBe(2);
    await expect.poll(async () => (await candidates())[1].children.length).toBe(2);
    const captured = (await candidates())[1];
    expect((await page.evaluate((id) => window.mindmapAI.project.readAnswer(id), captured.answerId))?.body).toContain('第二次捕获原文。');
    expect(errors).toEqual([]);
  } finally {
    if (app && previousClipboard !== undefined) await app.evaluate(async ({ clipboard }, text) => { await clipboard.writeText(text); }, previousClipboard);
    await app?.close(); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
