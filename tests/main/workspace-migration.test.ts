import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectStore } from "../../src/main/project-store.js";
import { migrateLegacyWorkspace } from "../../src/main/workspace-migration.js";
import { WorkspaceStore } from "../../src/main/workspace-store.js";
import type { AnswerDocument } from "../../src/shared/types.js";

const roots: string[] = [];

async function makeLegacyProject(): Promise<{ root: string; store: ProjectStore }> {
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-legacy-"));
  roots.push(root);
  const store = new ProjectStore(root);
  const snapshot = await store.initialize("Legacy research");
  snapshot.mindmap.children.push({ uid: "legacy-child", text: "Legacy child", children: [] });
  await store.save(snapshot);
  return { root, store };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy workspace migration", () => {
  test("backs up and migrates legacy map, candidates, layout, and answers", async () => {
    const { root, store } = await makeLegacyProject();
    const answer: AnswerDocument = {
      metadata: {
        id: "legacy-answer",
        provider: "chatgpt",
        title: "Legacy answer",
        sourceUrl: "https://chatgpt.com/c/legacy",
        sourceMessageId: "legacy-message",
        contentHash: "b".repeat(64),
        capturedAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z"
      },
      body: "Legacy body"
    };
    await store.writeAnswer(answer);
    const repaired = await store.load();
    await store.save(repaired);
    const answerBefore = await readFile(path.join(root, "answers", "legacy-answer.md"), "utf8");

    const migrated = await migrateLegacyWorkspace(root);

    expect(migrated.workspace.schemaVersion).toBe(2);
    expect(migrated.project.mindmap.children[0]?.text).toBe("Legacy child");
    expect(migrated.project.state.candidates[0]?.answerId).toBe("legacy-answer");
    expect(migrated.project.state.dockLayout).toEqual(repaired.workspace.dockLayout);
    expect(await readFile(path.join(root, "answers", "legacy-answer.md"), "utf8")).toBe(answerBefore);
    const backups = await readdir(path.join(root, ".mindmap-ai-migration-backup"), { recursive: true });
    expect(backups.filter((file) => file.endsWith("project.json"))).toHaveLength(1);
    expect(backups.filter((file) => file.endsWith("mindmap.json"))).toHaveLength(1);
    expect(backups.filter((file) => file.endsWith("workspace.json"))).toHaveLength(1);
  });

  test("leaves the legacy project loadable when interrupted before install", async () => {
    const { root } = await makeLegacyProject();
    const before = await readFile(path.join(root, "workspace.json"), "utf8");
    await expect(migrateLegacyWorkspace(root, {
      beforeInstall: vi.fn(async () => { throw new Error("simulated interruption"); })
    })).rejects.toThrow("simulated interruption");
    expect(await readFile(path.join(root, "workspace.json"), "utf8")).toBe(before);
    await expect(new ProjectStore(root).load()).resolves.toMatchObject({ manifest: { name: "Legacy research" } });
  });

  test("refuses unsafe future legacy schemas without replacing source files", async () => {
    const { root } = await makeLegacyProject();
    const manifestPath = path.join(root, "project.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, schemaVersion: 99 }, null, 2)}\n`, "utf8");
    const beforeWorkspace = await readFile(path.join(root, "workspace.json"), "utf8");

    await expect(migrateLegacyWorkspace(root)).rejects.toThrow(/read-only|migrate/i);
    expect(await readFile(path.join(root, "workspace.json"), "utf8")).toBe(beforeWorkspace);
  });

  test("is idempotent after a successful migration", async () => {
    const { root } = await makeLegacyProject();
    const first = await migrateLegacyWorkspace(root);
    const second = await migrateLegacyWorkspace(root);
    const loaded = await new WorkspaceStore(root).loadOrMigrate();
    expect(second.workspace.workspaceId).toBe(first.workspace.workspaceId);
    expect(second.project.manifest.projectId).toBe(first.project.manifest.projectId);
    expect(loaded.workspace.workspaceId).toBe(first.workspace.workspaceId);
  });
});
