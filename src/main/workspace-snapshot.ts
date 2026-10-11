import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { workspaceManifestSchema, activeProjectManifestSchema, projectStateSchema } from '../shared/workspace.js';
import { mindMapNodeSchema } from '../shared/project.js';
import { conceptLibrarySchema } from '../shared/concepts.js';
import { parseAnswer } from './answer-repository.js';

export const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const uuid = '[a-fA-F0-9-]{36}';
const allowed = new RegExp(`^(workspace\\.json|concepts\\.json|answers/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\.md|(?:projects|\\.trash/projects)/${uuid}/(?:project\\.json|mindmap\\.json|map\\.md|inbox\\.md|history\\.md|trash\\.md))$`, 'u');
export const workspaceSnapshotSchema = z.object({ format: z.literal(1), workspaceId: z.string().uuid(), files: z.array(z.object({ path: z.string().max(300).regex(allowed), text: z.string().max(20_000_000) })).min(1).max(10000) });
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export function snapshotHash(snapshot: WorkspaceSnapshot): string { return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'); }

export function validateSnapshot(raw: unknown): WorkspaceSnapshot {
  const snapshot = workspaceSnapshotSchema.parse(raw);
  const files = new Map<string, string>();
  for (const file of snapshot.files) {
    const folded = file.path.toLowerCase();
    if (files.has(folded)) throw new Error('云端快照包含重复路径');
    files.set(folded, file.text);
    if (file.path.startsWith('answers/')) {
      const answer = parseAnswer(file.text);
      if (file.path !== `answers/${answer.metadata.id}.md`) throw new Error('快照文档 ID 与路径不一致');
    }
  }
  const manifest = workspaceManifestSchema.parse(JSON.parse(files.get('workspace.json') ?? 'null'));
  if (manifest.workspaceId !== snapshot.workspaceId) throw new Error('云端工作区 ID 不一致');
  if (!manifest.activeProjectId || !manifest.projects.some((project) => project.projectId === manifest.activeProjectId)) throw new Error('云端工作区没有有效活动项目');
  if (files.has('concepts.json')) conceptLibrarySchema.parse(JSON.parse(files.get('concepts.json')!));
  for (const project of [...manifest.projects, ...manifest.projectTrash]) {
    const directory = `${manifest.projects.includes(project) ? 'projects' : '.trash/projects'}/${project.projectId}`;
    const record = JSON.parse(files.get(`${directory}/project.json`) ?? 'null');
    const metadata = activeProjectManifestSchema.parse(record?.manifest); projectStateSchema.parse(record?.state);
    if (metadata.projectId !== project.projectId) throw new Error('快照项目 ID 与路径不一致');
    mindMapNodeSchema.parse(JSON.parse(files.get(`${directory}/mindmap.json`) ?? 'null'));
  }
  return snapshot;
}

export async function createWorkspaceSnapshot(root: string): Promise<WorkspaceSnapshot> {
  root = path.resolve(root);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('同步不支持链接工作区');
  const files: WorkspaceSnapshot['files'] = []; let bytes = 0;
  const manifest = workspaceManifestSchema.parse(JSON.parse(await readFile(path.join(root, 'workspace.json'), 'utf8')));
  const names = ['workspace.json', 'concepts.json'];
  const answerDir = path.join(root, 'answers');
  const answerInfo = await lstat(answerDir);
  if (answerInfo.isSymbolicLink() || !answerInfo.isDirectory()) throw new Error('同步不支持链接目录');
  names.push(...(await readdir(answerDir)).filter((name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.md$/u.test(name)).map((name) => `answers/${name}`));
  for (const project of [...manifest.projects, ...manifest.projectTrash]) {
    const directory = `${manifest.projects.includes(project) ? 'projects' : '.trash/projects'}/${project.projectId}`;
    for (const name of ['project.json', 'mindmap.json', 'map.md', 'inbox.md', 'history.md', 'trash.md']) names.push(`${directory}/${name}`);
  }
  for (const name of names.sort()) {
    const location = path.join(root, ...name.split('/'));
    try {
      // Check every ancestor; an otherwise safe relative name can cross a symlink.
      let directory = path.dirname(location);
      while (directory !== path.resolve(root)) { if ((await lstat(directory)).isSymbolicLink()) throw new Error('同步不支持链接目录'); directory = path.dirname(directory); }
      const info = await lstat(location);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('同步不支持链接文件');
      bytes += info.size;
      if (info.size > 20_000_000 || bytes > MAX_SNAPSHOT_BYTES) throw new Error('工作区超过同步容量限制（单文件 20 MB，总计 128 MB）');
      files.push({ path: name, text: await readFile(location, 'utf8') });
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  const snapshot = validateSnapshot({ format: 1, workspaceId: manifest.workspaceId, files });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) throw new Error('工作区快照超过 128 MB');
  return snapshot;
}

export async function restoreWorkspaceSnapshot(raw: unknown, destination: string): Promise<WorkspaceSnapshot> {
  const snapshot = validateSnapshot(raw); const root = path.resolve(destination);
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory() || (await readdir(root)).length) throw new Error('请选择空文件夹，下载不会覆盖已有文件');
  for (const file of snapshot.files) {
    const location = path.resolve(root, ...file.path.split('/'));
    if (!location.startsWith(`${root}${path.sep}`)) throw new Error('快照路径越界');
    await mkdir(path.dirname(location), { recursive: true });
    await writeFile(location, file.text, { encoding: 'utf8', flag: 'wx' });
  }
  return snapshot;
}
