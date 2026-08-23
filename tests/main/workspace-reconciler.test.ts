import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AnswerDocument } from "../../src/shared/types.js";
import { WorkspaceStore } from "../../src/main/workspace-store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function answer(id: string): AnswerDocument {
  const now = "2026-08-18T00:00:00.000Z";
  return {
    metadata: {
      id, provider: "chatgpt", title: `Answer ${id}`, sourceUrl: "https://chatgpt.com/c/recovery",
      sourceMessageId: id, contentHash: "a".repeat(64), capturedAt: now, updatedAt: now
    },
    body: `# Answer ${id}`
  };
}

describe("workspace reconciliation", () => {
  test("places a shared orphan in only the active project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mindmap-reconcile-")); roots.push(root);
    const workspace = new WorkspaceStore(root);
    const opened = await workspace.initialize("Workspace", "First");
    const firstId = opened.project.manifest.projectId;
    const second = await workspace.createProject("Second", null);
    await workspace.answers.write(answer("orphan"));

    const reopened = await workspace.load();
    expect(reopened.project.manifest.projectId).toBe(second.manifest.projectId);
    expect(reopened.project.state.candidates.map((item) => item.answerId)).toEqual(["orphan"]);
    const first = await workspace.switchProject(firstId);
    expect(first.state.candidates).toEqual([]);
  });

  test("removes an inbox candidate already linked in that project's map", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mindmap-reconcile-")); roots.push(root);
    const workspace = new WorkspaceStore(root);
    const opened = await workspace.initialize("Workspace", "First");
    await workspace.answers.write(answer("linked"));
    await workspace.saveActive({
      ...opened.project,
      mindmap: { ...opened.project.mindmap, children: [{ uid: "linked-node", text: "Linked", answerId: "linked", children: [] }] },
      state: { ...opened.project.state, candidates: [{ id: "candidate-linked", answerId: "linked", title: "Linked", extractionMode: "single", children: [], createdAt: "2026-08-18T00:00:00.000Z" }] }
    });
    const reopened = await workspace.load();
    expect(reopened.project.state.candidates).toEqual([]);
  });

  test("reports missing linked answers without refusing to open", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mindmap-reconcile-")); roots.push(root);
    const workspace = new WorkspaceStore(root);
    const opened = await workspace.initialize("Workspace", "First");
    await workspace.saveActive({
      ...opened.project,
      mindmap: { ...opened.project.mindmap, children: [{ uid: "missing-node", text: "Missing", answerId: "missing", children: [] }] }
    });
    await expect(workspace.load()).resolves.toMatchObject({ project: { missingAnswerIds: ["missing"] } });
  });
});
