import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { scanWorkspaceAnswerReferences } from "../../src/main/reference-scanner.js";
import { WorkspaceStore } from "../../src/main/workspace-store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("workspace answer reference scanner", () => {
  test("includes map, candidates, history, trash, and other projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mindmap-refs-"));
    roots.push(root);
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("References", "One");
    const first = structuredClone(opened.project);
    first.mindmap.children.push({ uid: "map", text: "Map", answerId: "map-answer", children: [] });
    first.state.candidates.push({
      id: "candidate", answerId: "candidate-answer", title: "Candidate",
      extractionMode: "single", children: [], createdAt: "2026-08-18T00:00:00.000Z"
    });
    first.state.history.push({
      id: "history", subtree: { uid: "history-node", text: "History", answerId: "history-answer", children: [] },
      originalParentUid: "root", originalIndex: 0, movedAt: "2026-08-18T00:00:00.000Z"
    });
    first.state.trash.push({
      kind: "subtree", id: "trash", deletedAt: "2026-08-18T00:00:00.000Z",
      subtree: { uid: "trash-node", text: "Trash", answerId: "trash-answer", children: [] },
      originalParentUid: "root", originalIndex: 1
    });
    await store.saveActive(first);
    const second = await store.createProject("Two", null);
    second.mindmap.children.push({ uid: "shared", text: "Shared", answerId: "map-answer", children: [] });
    second.mindmap.children.push({ uid: "other", text: "Other", answerId: "other-answer", children: [] });
    await store.saveActive(second);

    const references = await scanWorkspaceAnswerReferences(root, store.getSummary());
    expect([...references.keys()].sort()).toEqual([
      "candidate-answer", "history-answer", "map-answer", "other-answer", "trash-answer"
    ]);
    expect(references.get("map-answer")).toEqual(new Set([
      opened.project.manifest.projectId,
      second.manifest.projectId
    ]));
  });
});
