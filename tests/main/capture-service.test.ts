import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureService } from "../../src/main/capture-service.js";
import type { AnswerDocument, PublicAiSettings } from "../../src/shared/types.js";
import { WorkspaceStore } from "../../src/main/workspace-store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(mode: "single" | "expanded" = "single", titleSource: "local" | "api" | "automatic" = "local") {
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-capture-"));
  roots.push(root);
  const workspace = new WorkspaceStore(root);
  const opened = await workspace.initialize("Capture workspace", "Capture project");
  await workspace.saveActive({
    ...opened.project,
    state: {
      ...opened.project.state,
      uiPreferences: { ...opened.project.state.uiPreferences, captureMode: mode, titleSource }
    }
  });
  return { workspace, store: workspace.getActiveProjectStore() };
}

const payload = {
  provider: "chatgpt" as const,
  sourceUrl: "https://chatgpt.com/c/abc",
  sourceMessageId: "message-1",
  markdown: "## Stable title\n\n- First child\n- Second child"
};

describe("portable CaptureService", () => {
  test("acknowledges only after exactly one matching candidate is persisted", async () => {
    const { store } = await setup();
    const acknowledgement = await new CaptureService(store, { portable: true }).capture(payload);
    expect(acknowledgement).toMatchObject({
      status: "captured",
      answer: { metadata: { title: "Stable title" } },
      candidate: { title: "Stable title", extractionMode: "single" }
    });
    const persisted = await store.loadPortable();
    expect(persisted.state.candidates).toHaveLength(1);
    expect(persisted.state.candidates[0]).toEqual(acknowledgement.status === "captured" ? acknowledgement.candidate : null);
  });

  test("uses ordered expanded API titles but falls back locally when API extraction fails", async () => {
    const api = {
      extract: vi.fn()
        .mockResolvedValueOnce({ title: "API title", subtitles: ["API one", "API two"] })
        .mockRejectedValueOnce(new Error("offline"))
    };
    const settings = {
      getPublicSettings: vi.fn<() => Promise<PublicAiSettings>>().mockResolvedValue({ baseUrl: "https://api.example/v1", model: "model", hasApiKey: true }),
      getApiKey: vi.fn().mockResolvedValue("secret")
    };
    const { store } = await setup("expanded", "api");
    const service = new CaptureService(store, { portable: true, titleService: api, settingsStore: settings });
    const first = await service.capture(payload);
    const second = await service.capture({ ...payload, sourceMessageId: "message-2", markdown: "# Local fallback\n- Local child" });

    expect(first).toMatchObject({ status: "captured", candidate: { title: "API title", children: [{ title: "API one" }, { title: "API two" }] } });
    expect(second).toMatchObject({ status: "captured", candidate: { title: "Local fallback", children: [{ title: "Local child" }] } });
  });

  test("reports a safe warning when API extraction falls back locally", async () => {
    const api = {
      extract: vi.fn(),
      extractWithStatus: vi.fn().mockResolvedValue({
        title: "Stable title",
        subtitles: [],
        apiWarning: "API 密钥无效，已使用本地规则"
      })
    };
    const settings = {
      getPublicSettings: vi.fn<() => Promise<PublicAiSettings>>().mockResolvedValue({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", hasApiKey: true }),
      getApiKey: vi.fn().mockResolvedValue("secret")
    };
    const { store } = await setup("single", "api");
    const result = await new CaptureService(store, { portable: true, titleService: api, settingsStore: settings }).capture(payload);

    expect(result).toMatchObject({ status: "captured", apiWarning: "API 密钥无效，已使用本地规则" });
  });

  test("captures identical source content repeatedly as independent copies", async () => {
    const api = { extract: vi.fn().mockResolvedValue({ title: "API", subtitles: [] }) };
    const settings = {
      getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example/v1", model: "model", hasApiKey: true }),
      getApiKey: vi.fn().mockResolvedValue("secret")
    };
    const { store } = await setup("single", "api");
    const service = new CaptureService(store, { portable: true, titleService: api, settingsStore: settings });
    const first = await service.capture(payload);
    const second = await service.capture(payload);

    expect(first.status).toBe("captured");
    expect(second.status).toBe("captured");
    if (first.status !== "captured" || second.status !== "captured") throw new Error("capture failed");
    expect(second.answer.metadata.id).not.toBe(first.answer.metadata.id);
    expect(second.candidate.id).not.toBe(first.candidate.id);
    expect(api.extract).toHaveBeenCalledTimes(2);
    expect(await store.listAnswerDocuments()).toHaveLength(2);
    expect((await store.loadPortable()).state.candidates).toHaveLength(2);
  });

  test("recaptures after the previous candidate leaves the active tray", async () => {
    const { store } = await setup();
    const service = new CaptureService(store, { portable: true });
    const first = await service.capture(payload);
    if (first.status !== "captured") throw new Error("first capture failed");
    const current = await store.loadPortable();
    await store.savePortable({ ...current, state: { ...current.state, candidates: [] } });

    const next = await service.capture(payload);

    expect(next.status).toBe("captured");
    expect(await store.listAnswerDocuments()).toHaveLength(2);
    expect((await store.loadPortable()).state.candidates).toHaveLength(1);
  });

  test("leaves neither answer nor candidate when answer write fails", async () => {
    const { store } = await setup();
    vi.spyOn(store, "writeAnswer").mockRejectedValueOnce(new Error("disk full"));
    const acknowledgement = await new CaptureService(store, { portable: true }).capture(payload);
    expect(acknowledgement).toMatchObject({ status: "failed" });
    expect(await store.listAnswerDocuments()).toHaveLength(0);
    expect((await store.loadPortable()).state.candidates).toHaveLength(0);
  });

  test("repairs an answer written before candidate persistence on reload", async () => {
    const { workspace, store } = await setup();
    const now = "2026-08-18T00:00:00.000Z";
    const answer: AnswerDocument = {
      metadata: {
        id: crypto.randomUUID(), provider: "chatgpt", title: "Recovered", sourceUrl: payload.sourceUrl,
        sourceMessageId: "interrupted", contentHash: "a".repeat(64), capturedAt: now, updatedAt: now
      },
      body: "# Recovered"
    };
    await store.writeAnswer(answer);
    const recovered = (await workspace.load()).project;
    expect(recovered.state.candidates).toContainEqual(expect.objectContaining({ answerId: answer.metadata.id, title: "Recovered" }));
  });
});
