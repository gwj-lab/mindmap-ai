import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { S3SettingsInput, S3TransferResult } from '../shared/sync.js';
import { createWorkspaceSnapshot, MAX_SNAPSHOT_BYTES, restoreWorkspaceSnapshot, snapshotHash, validateSnapshot, type WorkspaceSnapshot } from './workspace-snapshot.js';

const pointerSchema = z.object({ format: z.literal(1), workspaceId: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/u), updatedAt: z.string().datetime() });
type CloudPointer = z.infer<typeof pointerSchema>;
function isMissing(cause: unknown): boolean { return (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404; }
function publicFailure(cause: unknown): Error {
  const code = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (code === 412 || code === 409) return new Error('云端已被其他设备更新，本次未覆盖；请先下载云端工作区');
  if (code === 401 || code === 403) return new Error('S3 凭据无效或权限不足，请检查存储桶权限');
  return new Error(code ? `S3 请求失败（HTTP ${code}）` : 'S3 连接失败，请检查地址、区域和网络');
}

export class S3Sync {
  private readonly client: S3Client;
  private readonly prefix: string;
  constructor(private readonly settings: Required<S3SettingsInput>, private readonly stateDirectory: string) {
    this.prefix = settings.config.prefix;
    this.client = new S3Client({ region: settings.config.region, ...(settings.config.endpoint ? { endpoint: settings.config.endpoint } : {}), forcePathStyle: settings.config.forcePathStyle,
      credentials: settings.credentials, maxAttempts: 2, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', requestHandler: { connectionTimeout: 10000, requestTimeout: 60000 } });
  }
  close(): void { this.client.destroy(); }
  async testConnection(): Promise<string> {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.settings.config.bucket }), { abortSignal: AbortSignal.timeout(15000) }); return 'S3 存储桶连接成功'; }
    catch (cause) { throw publicFailure(cause); }
  }
  async upload(root: string): Promise<S3TransferResult> {
    const snapshot = await createWorkspaceSnapshot(root); const hash = snapshotHash(snapshot);
    const remote = await this.getPointer(); const known = await this.readBaseline(root);
    if (remote && (remote.pointer.workspaceId !== snapshot.workspaceId || remote.pointer.hash !== hash && remote.pointer.hash !== known)) throw new Error('云端版本与本机同步记录不同，本次未覆盖；请下载云端工作区或使用新的同步目录');
    const text = JSON.stringify(snapshot); const bytes = Buffer.byteLength(text);
    if (remote?.pointer.hash === hash) { await this.saveBaseline(root, hash); return { message: '云端已是当前版本', fileCount: snapshot.files.length, bytes }; }
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.settings.config.bucket, Key: `${this.prefix}/snapshots/${hash}.json`, Body: text, ContentType: 'application/json; charset=utf-8' }), { abortSignal: AbortSignal.timeout(120000) });
      const pointer: CloudPointer = { format: 1, workspaceId: snapshot.workspaceId, hash, updatedAt: new Date().toISOString() };
      if (remote && !remote.etag) throw new Error('missing etag');
      await this.client.send(new PutObjectCommand({ Bucket: this.settings.config.bucket, Key: `${this.prefix}/latest.json`, Body: JSON.stringify(pointer), ContentType: 'application/json; charset=utf-8', ...(remote ? { IfMatch: remote.etag } : { IfNoneMatch: '*' }) }), { abortSignal: AbortSignal.timeout(60000) });
    } catch (cause) { throw publicFailure(cause); }
    await this.saveBaseline(root, hash);
    return { message: `已上传 ${snapshot.files.length} 个文件`, fileCount: snapshot.files.length, bytes };
  }
  async download(destination: string): Promise<S3TransferResult> {
    const remote = await this.getPointer();
    if (!remote) throw new Error('云端还没有工作区，请先在另一台设备上传');
    let snapshot: WorkspaceSnapshot; let bytes: number;
    try {
      const text = await this.readObject(`${this.prefix}/snapshots/${remote.pointer.hash}.json`, MAX_SNAPSHOT_BYTES);
      bytes = Buffer.byteLength(text); snapshot = validateSnapshot(JSON.parse(text));
      if (snapshotHash(snapshot) !== remote.pointer.hash || snapshot.workspaceId !== remote.pointer.workspaceId) throw new Error('快照校验失败');
    } catch (cause) {
      if ((cause as { $metadata?: unknown }).$metadata) throw publicFailure(cause);
      throw new Error('云端快照无效、损坏或超出限制，下载未写入文件');
    }
    await restoreWorkspaceSnapshot(snapshot, destination);
    await this.saveBaseline(destination, remote.pointer.hash);
    return { message: `已下载 ${snapshot.files.length} 个文件`, fileCount: snapshot.files.length, bytes };
  }
  private async getPointer(): Promise<{ pointer: CloudPointer; etag?: string } | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.settings.config.bucket, Key: `${this.prefix}/latest.json` }), { abortSignal: AbortSignal.timeout(60000) });
      const text = await this.readBody(response.Body, response.ContentLength, 16384);
      return { pointer: pointerSchema.parse(JSON.parse(text)), etag: response.ETag };
    } catch (cause) { if (isMissing(cause)) return null; if ((cause as { $metadata?: unknown }).$metadata) throw publicFailure(cause); throw new Error('云端同步索引无效'); }
  }
  private async readObject(key: string, maxBytes: number): Promise<string> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.settings.config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(120000) });
    return this.readBody(response.Body, response.ContentLength, maxBytes);
  }
  private async readBody(body: unknown, length: number | undefined, maxBytes: number): Promise<string> {
    const stream = body as AsyncIterable<Uint8Array> & { destroy?(): void };
    if (!stream || (length ?? 0) > maxBytes) { stream?.destroy?.(); throw new Error('快照大小超过限制'); }
    const chunks: Buffer[] = []; let bytes = 0;
    try {
      for await (const chunk of stream) { bytes += chunk.length; if (bytes > maxBytes) throw new Error('快照大小超过限制'); chunks.push(Buffer.from(chunk)); }
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch (cause) { stream.destroy?.(); throw cause; }
  }
  private baselinePath(root: string): string {
    const key = createHash('sha256').update(JSON.stringify([path.resolve(root), this.settings.config])).digest('hex');
    return path.join(this.stateDirectory, `s3-baseline-${key}.json`);
  }
  private async readBaseline(root: string): Promise<string | null> {
    try { const stored: unknown = JSON.parse(await readFile(this.baselinePath(root), 'utf8')); return z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(stored).hash; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('本机同步记录无效，请使用新的同步目录'); }
  }
  private async saveBaseline(root: string, hash: string): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFileAtomic(this.baselinePath(root), JSON.stringify({ hash }), { encoding: 'utf8', mode: 0o600 });
  }
}
