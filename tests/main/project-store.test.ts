import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ProjectStore } from "../../src/main/project-store.js";
import type { AnswerDocument, ProjectSnapshot } from "../../src/shared/types.js";

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-ai-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectStore", () => {
  test("refuses to initialize over an existing project", async () => {
    const root = await makeRoot();
    const store = new ProjectStore(root);
    await store.initialize("Original");

    await expect(store.initialize("Replacement")).rejects.toThrow(/already exists/i);
    await expect(store.load()).resolves.toMatchObject({ manifest: { name: "Original" } });
  });

  test("opens a structurally compatible future schema read-only and writes a recovery report", async () => {
    const root = await makeRoot();
    const store = new ProjectStore(root);
    await store.initialize("Future project");
    const manifestPath = path.join(root, "project.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, schemaVersion: 2 }, null, 2)}\n`, "utf8");

    const futureStore = new ProjectStore(root);
    const loaded = await futureStore.load();
    expect(loaded.readOnly).toBe(true);
    await expect(new ProjectStore(root).load()).resolves.toMatchObject({ readOnly: true });
    const recoveryFiles = await readdir(path.join(root, ".mindmap-ai-recovery"), { recursive: true });
    expect(recoveryFiles.some((file) => file.endsWith("error-report.txt"))).toBe(true);
    expect(recoveryFiles.some((file) => file.endsWith("project.json"))).toBe(true);
    await expect(futureStore.save(loaded)).rejects.toThrow(/read-only/i);
  });

  test("initializes and reloads a readable project folder", async () => {
    const root = await makeRoot();
    const store = new ProjectStore(root);
    const created = await store.initialize("Research map");

    expect(created.manifest.name).toBe("Research map");
    await expect(readFile(path.join(root, "project.json"), "utf8")).resolves.toContain('"schemaVersion": 1');
    await expect(readFile(path.join(root, "mindmap.json"), "utf8")).resolves.toContain("中心主题");
    await expect(readFile(path.join(root, "workspace.json"), "utf8")).resolves.toContain('"candidates": []');

    const loaded = await new ProjectStore(root).load();
    expect(loaded).toEqual(created);
  });

  test("round-trips answer metadata without exposing YAML in the editable body", async () => {
    const root = await makeRoot();
    const store = new ProjectStore(root);
    await store.initialize("Answers");
    const answer: AnswerDocument = {
      metadata: {
        id: "answer-1",
        provider: "chatgpt",
        title: "Integral",
        sourceUrl: "https://chatgpt.com/c/1",
        sourceMessageId: "message-1",
        contentHash: "a".repeat(64),
        capturedAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z"
      },
      body: "The result is $$x^2$$.\n"
    };

    await store.writeAnswer(answer);
    await expect(store.readAnswer("answer-1")).resolves.toEqual(answer);
    const raw = await readFile(path.join(root, "answers", "answer-1.md"), "utf8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("provider: chatgpt");
    expect(raw).toContain("The result is $$x^2$$.");
  });

  test("repairs stale candidates and reports linked answers missing on disk", async () => {
    const root = await makeRoot();
    const store = new ProjectStore(root);
    const snapshot = await store.initialize("Recovery");
    const answer: AnswerDocument = {
      metadata: {
        id: "orphan",
        provider: "chatgpt",
        title: "Recovered answer",
        sourceUrl: "https://chatgpt.com/c/2",
        sourceMessageId: "message-2",
        contentHash: "b".repeat(64),
        capturedAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z"
      },
      body: "Recovered"
    };
    await store.writeAnswer(answer);

    const stale: ProjectSnapshot = {
      ...snapshot,
      mindmap: {
        ...snapshot.mindmap,
        children: [
          { uid: "linked", text: "Linked", answerId: "missing", children: [] }
        ]
      },
      workspace: {
        ...snapshot.workspace,
        candidates: [
          { id: "stale", answerId: "missing", title: "Stale", createdAt: "2026-08-17T00:00:00.000Z" }
        ]
      }
    };
    await store.save(stale);

    const recovered = await store.load();
    expect(recovered.workspace.candidates.map((item) => item.answerId)).toEqual(["orphan"]);
    expect(recovered.missingAnswerIds).toEqual(["missing"]);
  });
});
