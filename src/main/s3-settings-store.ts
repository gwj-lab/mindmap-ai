import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { s3SettingsInputSchema, type PublicS3Settings, type S3SettingsInput } from '../shared/sync.js';
import type { SafeStorageAdapter } from './settings-store.js';

export class S3SettingsStore {
  constructor(private readonly directory: string, private readonly safeStorage: SafeStorageAdapter) {}
  async getPublic(): Promise<PublicS3Settings> {
    const stored = await this.read();
    return { ...(stored?.config ?? { endpoint: '', region: 'us-east-1', bucket: '', prefix: 'mindmap-ai', forcePathStyle: false }), hasCredentials: !!stored?.credentials };
  }
  async save(raw: S3SettingsInput): Promise<PublicS3Settings> {
    const input = s3SettingsInputSchema.parse(raw); const previous = await this.read();
    if (!input.credentials && previous?.config.endpoint !== input.config.endpoint) throw new Error('更换 S3 地址时请重新输入凭据');
    const credentials = input.credentials ?? previous?.credentials;
    if (!credentials) throw new Error('请填写 S3 Access Key 和 Secret Key');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密服务不可用，S3 凭据未保存');
    await mkdir(this.directory, { recursive: true });
    await writeFileAtomic(path.join(this.directory, 's3-settings.enc'), this.safeStorage.encryptString(JSON.stringify({ config: input.config, credentials })), { mode: 0o600 });
    return this.getPublic();
  }
  async require(): Promise<Required<S3SettingsInput>> {
    const input = await this.read();
    if (!input?.credentials) throw new Error('请先保存 S3 配置和凭据');
    return { config: input.config, credentials: input.credentials };
  }
  async clear(): Promise<void> {
    try { await unlink(path.join(this.directory, 's3-settings.enc')); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  private async read(): Promise<S3SettingsInput | null> {
    try {
      const encrypted = await readFile(path.join(this.directory, 's3-settings.enc'));
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用');
      return s3SettingsInputSchema.parse(JSON.parse(this.safeStorage.decryptString(encrypted)));
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('S3 凭据无法读取，请清除并重新配置'); }
  }
}
