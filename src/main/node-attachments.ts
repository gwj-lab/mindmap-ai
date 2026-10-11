import { open } from 'node:fs/promises';
import path from 'node:path';
import { contentHash } from '../shared/content.js';
import type { AnswerDocument } from '../shared/types.js';
import type { AnswerRepository } from './answer-repository.js';

export async function createNodeAttachment(repository: AnswerRepository, title: string, file?: string): Promise<AnswerDocument> {
  let body = '';
  if (file) {
    if (!['.md', '.markdown'].includes(path.extname(file).toLowerCase())) throw new Error('只支持 Markdown 文件（.md / .markdown）');
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 5_000_000) throw new Error('Markdown 文件不能超过 5 MB');
      const buffer = Buffer.alloc(5_000_001); let total = 0;
      while (total < buffer.length) { const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total); if (!bytesRead) break; total += bytesRead; }
      if (total > 5_000_000) throw new Error('Markdown 文件不能超过 5 MB');
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)); }
      catch { throw new Error('请导入 UTF-8 编码的 Markdown 文件'); }
      if (body.includes('\0')) throw new Error('Markdown 文件不能包含二进制内容');
    } finally { await handle.close(); }
  }
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const answer: AnswerDocument = { metadata: { id, origin: 'local', provider: 'chatgpt', title: title.trim().slice(0, 160) || '空白文档', sourceUrl: `https://local.mindmap-ai.invalid/documents/${id}`, sourceMessageId: id, contentHash: await contentHash(body), capturedAt: now, updatedAt: now }, body };
  await repository.write(answer);
  return answer;
}
