import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../../src/main/workspace-store.js';
import { S3Sync } from '../../src/main/s3-sync.js';
import { S3SettingsStore } from '../../src/main/s3-settings-store.js';
import { s3ConfigSchema } from '../../src/shared/sync.js';
import { createNodeAttachment } from '../../src/main/node-attachments.js';
import { createWorkspaceSnapshot, restoreWorkspaceSnapshot } from '../../src/main/workspace-snapshot.js';
import { startS3Server } from '../support/s3-server.js';

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function temp() { const root = await mkdtemp(path.join(tmpdir(), 'mindmap-s3-')); roots.push(root); return root; }
test('signs actual S3 requests, uploads workspace data, restores to an empty folder and detects conflicts', async () => {
  const server = await startS3Server(); const root = await temp(); const destination = await temp(); const state = await temp();
  const sync = new S3Sync({ config: { endpoint: server.endpoint, region: 'us-east-1', bucket: 'test-bucket', prefix: 'workspace-one', forcePathStyle: true }, credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' } }, state);
  try {
    const store = new WorkspaceStore(root); const opened = await store.initialize('同步验收', '项目一');
    const note = await createNodeAttachment(store.answers, '同步附件'); await store.answers.write({ ...note, body: '# 同步正文' });
    await store.saveActive({ ...opened.project, mindmap: { ...opened.project.mindmap, children: [{ uid: 'note', text: '同步附件', answerId: note.metadata.id, children: [] }] } });
    const archived = await store.createProject('归档项目', null); await store.switchProject(opened.project.manifest.projectId); await store.moveProjectToTrash(archived.manifest.projectId);
    await writeFile(path.join(root, 's3-settings.enc'), 'not a workspace file');
    await expect(sync.testConnection()).resolves.toContain('成功');
    expect((await sync.upload(root)).fileCount).toBeGreaterThan(6);
    expect(server.requests.find((request) => request.key.endsWith('latest.json') && request.method === 'PUT')?.ifNoneMatch).toBe('*');
    expect(server.requests.every((request) => request.signed)).toBe(true);
    await sync.download(destination); const restored = await new WorkspaceStore(destination).load();
    expect(restored.workspace.workspaceId).toBe(opened.workspace.workspaceId);
    expect(restored.workspace.projectTrash[0]?.projectId).toBe(archived.manifest.projectId);
    expect((await new WorkspaceStore(destination).answers.read(note.metadata.id))?.body).toBe('# 同步正文');
    expect(await readdir(destination)).not.toContain('s3-settings.enc');
    await expect(sync.download(destination)).rejects.toThrow('空文件夹');
    await store.answers.write({ ...note, body: '# 本机新内容' });
    server.rejectNextPublish(); await expect(sync.upload(root)).rejects.toThrow('其他设备');
    await sync.upload(root);
    expect(server.requests.some((request) => request.ifMatch)).toBe(true);
    await expect(sync.upload(destination)).rejects.toThrow('云端版本');
  } finally { sync.close(); await server.close(); }
}, 20000);

test('snapshot restore rejects traversal, duplicate files, missing project data and nonempty destinations', async () => {
  const root = await temp(); const destination = await temp(); await new WorkspaceStore(root).initialize('快照', '项目');
  const snapshot = await createWorkspaceSnapshot(root);
  await expect(restoreWorkspaceSnapshot({ ...snapshot, files: [...snapshot.files, { path: '../escape.md', text: 'bad' }] }, destination)).rejects.toThrow();
  await expect(restoreWorkspaceSnapshot({ ...snapshot, files: [...snapshot.files, snapshot.files[0]] }, destination)).rejects.toThrow('重复');
  await expect(restoreWorkspaceSnapshot({ ...snapshot, files: snapshot.files.filter((file) => !file.path.endsWith('mindmap.json')) }, destination)).rejects.toThrow();
  expect(await readdir(destination)).toEqual([]);
  await writeFile(path.join(destination, 'existing.md'), '保留'); await expect(restoreWorkspaceSnapshot(snapshot, destination)).rejects.toThrow('空文件夹');
});

test('S3 config enforces safe endpoints and stores credentials only encrypted', async () => {
  const root = await temp(); const config = { endpoint: 'https://s3.example.com', region: 'auto', bucket: 'test-bucket', prefix: 'research/workspace', forcePathStyle: true };
  expect(() => s3ConfigSchema.parse({ ...config, endpoint: 'http://example.com' })).toThrow();
  expect(() => s3ConfigSchema.parse({ ...config, prefix: '../outside' })).toThrow();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(Buffer.from(text).map((value) => value ^ 71)), decryptString: (value: Buffer) => Buffer.from(value.map((byte) => byte ^ 71)).toString() };
  const settings = new S3SettingsStore(root, safeStorage);
  const publicSettings = await settings.save({ config, credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' } });
  expect(publicSettings.hasCredentials).toBe(true); expect(JSON.stringify(publicSettings)).not.toContain('test-secret');
  expect((await readFile(path.join(root, 's3-settings.enc'))).toString()).not.toContain('test-secret');
  await expect(settings.save({ config: { ...config, endpoint: 'https://new.example.com' } })).rejects.toThrow('重新输入');
  await settings.clear(); expect((await settings.getPublic()).hasCredentials).toBe(false);
});
