import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { SettingsStore, type SafeStorageAdapter } from "../../src/main/settings-store.js";

class FakeSafeStorage implements SafeStorageAdapter {
  available = true;
  failDecrypt = false;
  isEncryptionAvailable(): boolean { return this.available; }
  encryptString(value: string): Buffer { return Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`); }
  decryptString(value: Buffer): string {
    if (this.failDecrypt) throw new Error("cannot decrypt");
    return Buffer.from(value.toString().replace(/^encrypted:/, ""), "base64").toString();
  }
}

describe("secure settings store", () => {
  let directory: string;
  let safeStorage: FakeSafeStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mindmap-settings-"));
    safeStorage = new FakeSafeStorage();
  });

  test("never persists or returns a plaintext API key", async () => {
    const store = new SettingsStore(directory, safeStorage);
    await store.setApiKey("sk-plain-secret");
    const publicSettings = await store.getPublicSettings();
    const files = await readdir(directory);
    const persisted = (await Promise.all(files.map((file) => readFile(join(directory, file))))).map(String).join("\n");

    expect(publicSettings).toMatchObject({ hasApiKey: true });
    expect(publicSettings).not.toHaveProperty("apiKey");
    expect(persisted).not.toContain("sk-plain-secret");
    await expect(store.getApiKey()).resolves.toBe("sk-plain-secret");
  });

  test("refuses to save plaintext when OS encryption is unavailable", async () => {
    safeStorage.available = false;
    const store = new SettingsStore(directory, safeStorage);
    await expect(store.setApiKey("secret")).rejects.toThrow("系统加密");
    expect(await readdir(directory)).not.toContain("ai-key.enc");
  });

  test("requires re-entry after decrypt failure and clears encrypted bytes", async () => {
    const store = new SettingsStore(directory, safeStorage);
    await store.setApiKey("secret");
    safeStorage.failDecrypt = true;
    await expect(store.getApiKey()).rejects.toThrow("重新输入");
    safeStorage.failDecrypt = false;
    await store.clearApiKey();
    expect(await store.getPublicSettings()).toMatchObject({ hasApiKey: false });
    expect(await readdir(directory)).not.toContain("ai-key.enc");
  });

  test("allows a first-time Base URL change before a key exists", async () => {
    const store = new SettingsStore(directory, safeStorage);
    await expect(store.updatePublicSettings({ baseUrl: "https://api.deepseek.com" }, false))
      .resolves.toMatchObject({ baseUrl: "https://api.deepseek.com", hasApiKey: false });
  });

  test("requires explicit confirmation before reusing a saved key at a changed Base URL", async () => {
    const store = new SettingsStore(directory, safeStorage);
    await store.setApiKey("secret");
    await expect(store.updatePublicSettings({ baseUrl: "https://example.com/v1" }, false))
      .rejects.toThrow("确认");
    await expect(store.updatePublicSettings({ baseUrl: "https://example.com/v1" }, true))
      .resolves.toMatchObject({ baseUrl: "https://example.com/v1" });
  });
});
