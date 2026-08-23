import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { PublicAiSettings, PublicAiSettingsUpdate } from "../shared/types.js";

const SETTINGS_FILE = "settings.json";
const API_KEY_FILE = "ai-key.enc";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface PersistedSettings {
  schemaVersion: 1;
  baseUrl: string;
  model: string;
}

const DEFAULT_SETTINGS: PersistedSettings = {
  schemaVersion: 1,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini"
};

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Base URL 必须是无凭据的 HTTPS 地址");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.href.replace(/\/$/, "");
}

export class SettingsStore {
  constructor(
    private readonly directory: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  async getPublicSettings(): Promise<PublicAiSettings> {
    const settings = await this.#readSettings();
    return { ...settings, hasApiKey: await this.#hasApiKey() };
  }

  async updatePublicSettings(
    update: PublicAiSettingsUpdate,
    confirmBaseUrlChange: boolean
  ): Promise<PublicAiSettings> {
    const current = await this.#readSettings();
    const baseUrl = update.baseUrl === undefined ? current.baseUrl : normalizeBaseUrl(update.baseUrl);
    if (baseUrl !== current.baseUrl && await this.#hasApiKey() && !confirmBaseUrlChange) {
      throw new Error("更改 Base URL 前需要明确确认");
    }
    const model = update.model === undefined ? current.model : update.model.trim();
    if (!model || model.length > 120) throw new Error("模型名称不能为空且不能超过 120 个字符");
    await this.#writeSettings({ schemaVersion: 1, baseUrl, model });
    return this.getPublicSettings();
  }

  async setApiKey(apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    if (!normalized) throw new Error("API 密钥不能为空");
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统加密服务不可用，API 密钥未保存");
    }
    const encrypted = this.safeStorage.encryptString(normalized);
    await mkdir(this.directory, { recursive: true });
    await writeFileAtomic(join(this.directory, API_KEY_FILE), encrypted, { mode: 0o600 });
  }

  async getApiKey(): Promise<string | null> {
    try {
      const encrypted = await readFile(join(this.directory, API_KEY_FILE));
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable");
      return this.safeStorage.decryptString(encrypted);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("API 密钥无法解密，请重新输入");
    }
  }

  async clearApiKey(): Promise<void> {
    try {
      await unlink(join(this.directory, API_KEY_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async #hasApiKey(): Promise<boolean> {
    try {
      await stat(join(this.directory, API_KEY_FILE));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async #readSettings(): Promise<PersistedSettings> {
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, SETTINGS_FILE), "utf8")) as Partial<PersistedSettings>;
      return {
        schemaVersion: 1,
        baseUrl: typeof parsed.baseUrl === "string" ? normalizeBaseUrl(parsed.baseUrl) : DEFAULT_SETTINGS.baseUrl,
        model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : DEFAULT_SETTINGS.model
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { ...DEFAULT_SETTINGS };
      throw error;
    }
  }

  async #writeSettings(settings: PersistedSettings): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFileAtomic(join(this.directory, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  }
}
