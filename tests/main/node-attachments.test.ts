import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNodeAttachment } from '../../src/main/node-attachments.js';
import { AnswerRepository } from '../../src/main/answer-repository.js';

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'mindmap-attachments-')); roots.push(root); return { root, repository: new AnswerRepository(path.join(root, 'answers')) }; }
test('creates blank notes and imports Markdown verbatim into independent local attachments', async () => {
  const { root, repository } = await setup();
  const blank = await createNodeAttachment(repository, '空白节点'); expect(blank.body).toBe(''); expect(blank.metadata.origin).toBe('local');
  const file = path.join(root, 'existing.MD'); const text = '# 标题\r\n\r\n正文 $x^2$。'; await writeFile(file, text);
  const imported = await createNodeAttachment(repository, '本机附件', file);
  expect((await repository.read(imported.metadata.id))?.body).toBe(text);
  expect(imported.metadata.id).not.toBe(blank.metadata.id); expect(await readFile(file, 'utf8')).toBe(text);
});
test('rejects non-Markdown, oversized and invalid text files without saving attachments', async () => {
  const { root, repository } = await setup();
  await expect(createNodeAttachment(repository, '标题', path.join(root, 'wrong.txt'))).rejects.toThrow('只支持');
  const file = path.join(root, 'bad.md'); await writeFile(file, Buffer.from([0xff, 0xfe]));
  await expect(createNodeAttachment(repository, '标题', file)).rejects.toThrow('UTF-8');
  await writeFile(file, 'a\0b'); await expect(createNodeAttachment(repository, '标题', file)).rejects.toThrow('二进制');
  await writeFile(file, Buffer.alloc(5_000_001)); await expect(createNodeAttachment(repository, '标题', file)).rejects.toThrow('5 MB');
  expect(await repository.listDocuments()).toEqual([]);
});
