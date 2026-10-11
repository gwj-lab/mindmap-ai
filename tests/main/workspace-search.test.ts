import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../../src/main/workspace-store.js';
import { WorkspaceSearch } from '../../src/main/workspace-search.js';
import { createNodeAttachment } from '../../src/main/node-attachments.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'mindmap-search-')); roots.push(root); const store = new WorkspaceStore(root); const opened = await store.initialize('工作区', '项目一'); return { store, opened }; }

test('searches all projects, searches content only on demand, and refreshes changed cached documents', async () => {
  const { store, opened } = await setup();
  const answer = await createNodeAttachment(store.answers, '正文笔记');
  await store.answers.write({ ...answer, body: '关键词只在正文中：特征向量。' });
  await store.saveActive({ ...opened.project, mindmap: { uid: 'root', text: '标题根节点', children: [{ uid: 'note', text: '正文笔记', answerId: answer.metadata.id, children: [] }] } });
  const other = await store.createProject('项目二', null);
  await store.saveActive({ ...other, mindmap: { uid: 'other', text: '另一项目中的向量', children: [] } });
  const index = new WorkspaceSearch(store); const read = vi.spyOn(store.answers, 'read');
  expect(await index.query('向量', false)).toMatchObject([{ projectId: other.manifest.projectId }]); expect(read).not.toHaveBeenCalled();
  expect(await index.query('特征向量', true)).toMatchObject([{ nodeUid: 'note', snippet: expect.stringContaining('特征向量') }]);
  await index.query('特征向量', true); expect(read).toHaveBeenCalledTimes(1);
  await store.answers.write({ ...answer, body: '更新后的正文：梯度。' });
  expect(await index.query('特征向量', true)).toEqual([]);
  expect(await index.query('梯度', true)).toHaveLength(1);
  expect(await index.query('  ', true)).toEqual([]);
});

test('caps results and keeps warm content searches responsive for 200 attached documents', async () => {
  const { store, opened } = await setup();
  const children = [];
  for (let index = 0; index < 200; index++) { const answer = await createNodeAttachment(store.answers, `文档${index}`); await store.answers.write({ ...answer, body: '性能验收正文。'.repeat(200) }); children.push({ uid: `node-${index}`, text: `文档${index}`, answerId: answer.metadata.id, children: [] }); }
  await store.saveActive({ ...opened.project, mindmap: { ...opened.project.mindmap, children } });
  const search = new WorkspaceSearch(store);
  expect(await search.query('文档', false)).toHaveLength(50);
  await search.query('未找到的内容', true);
  const start = performance.now(); await search.query('另一个未命中的词', true); const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(500);
  console.info(`Warm content search: 200 documents, ${elapsed.toFixed(1)} ms`);
}, 20000);

test('evicts document bodies when the cache capacity is reached', async () => {
  const { store, opened } = await setup();
  const children = [];
  for (let count = 0; count < 4; count++) {
    const answer = await createNodeAttachment(store.answers, `大文档${count}`);
    await store.answers.write({ ...answer, body: `${'x'.repeat(4_500_000)}needle` });
    children.push({ uid: `large-${count}`, text: '大文档', answerId: answer.metadata.id, children: [] });
  }
  await store.saveActive({ ...opened.project, mindmap: { ...opened.project.mindmap, children } });
  const index = new WorkspaceSearch(store); const read = vi.spyOn(store.answers, 'read');
  expect(await index.query('needle', true)).toHaveLength(4);
  expect(await index.query('needle', true)).toHaveLength(4);
  expect(read).toHaveBeenCalledTimes(8);
});
