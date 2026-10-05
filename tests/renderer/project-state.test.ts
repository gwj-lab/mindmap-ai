import { describe, expect, test } from "vitest";
import {
  addCapturedAnswer,
  applyPersistedCandidate,
  attachCandidate,
  attachPortableCandidate,
  createPortableChild,
  createPortableSibling,
  movePortableSubtreeToHistory,
  renamePortableNode,
  restorePortableHistory,
  restorePortableTrash,
  trashPortableCandidate,
  trashPortableHistory,
  trashPortableSubtree,
  trashPortableSubtrees,
  updateLinkedNodeTitle
} from "../../src/renderer/state/project-state.js";
import type { ActiveProjectSnapshot, AnswerDocument, ProjectSnapshot } from "../../src/shared/types.js";

const snapshot: ProjectSnapshot = {
  manifest: {
    schemaVersion: 1,
    projectId: "318ed30c-4981-470b-b830-3c67f320d2f0",
    name: "Test",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z"
  },
  mindmap: { uid: "root", text: "Root", children: [{ uid: "target", text: "Target", children: [] }] },
  workspace: {
    schemaVersion: 1,
    dockLayout: {},
    candidates: [
      { id: "candidate-1", answerId: "answer-1", title: "Captured", createdAt: "2026-08-17T00:00:00.000Z" }
    ],
    uiPreferences: { theme: "system" }
  },
  missingAnswerIds: []
};

describe("candidate to map transaction", () => {
  test("creates an answer-linked child and consumes only the dropped candidate", () => {
    const next = attachCandidate(snapshot, "candidate-1", "target", "new-node");
    expect(next.workspace.candidates).toEqual([]);
    expect(next.mindmap.children[0]?.children).toEqual([
      { uid: "new-node", text: "Captured", answerId: "answer-1", children: [] }
    ]);
    expect(snapshot.workspace.candidates).toHaveLength(1);
  });

  test("does not mutate state when the drop target is invalid", () => {
    expect(attachCandidate(snapshot, "candidate-1", "missing", "new-node")).toBe(snapshot);
  });

  test("adds a captured answer to the in-memory candidate tray", () => {
    const answer: AnswerDocument = {
      metadata: {
        id: "answer-2",
        provider: "chatgpt",
        title: "New answer",
        sourceUrl: "https://chatgpt.com/c/1",
        sourceMessageId: "m2",
        contentHash: "c".repeat(64),
        capturedAt: "2026-08-17T01:00:00.000Z",
        updatedAt: "2026-08-17T01:00:00.000Z"
      },
      body: "Body"
    };
    const next = addCapturedAnswer(snapshot, answer);
    expect(next.workspace.candidates.at(-1)).toEqual({
      id: "candidate-answer-2",
      answerId: "answer-2",
      title: "New answer",
      createdAt: "2026-08-17T01:00:00.000Z"
    });
  });

  test("updates only the requested linked node title", () => {
    const linked = attachCandidate(snapshot, "candidate-1", "target", "new-node");
    const next = updateLinkedNodeTitle(linked, "new-node", "Re-extracted");
    expect(next.mindmap.children[0]?.children[0]?.text).toBe("Re-extracted");
    expect(next.mindmap.children[0]?.text).toBe("Target");
  });

  test("preserves unchanged branches when renaming a node", () => {
    const next = updateLinkedNodeTitle(snapshot, "missing-node", "No change");
    expect(next.mindmap).toBe(snapshot.mindmap);
    expect(next.mindmap.children[0]).toBe(snapshot.mindmap.children[0]);
  });
});

const portableSnapshot: ActiveProjectSnapshot = {
  manifest: {
    schemaVersion: 2,
    projectId: "2cb66115-270c-4107-89e0-f61508c14d2b",
    parentProjectId: null,
    name: "Portable",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z"
  },
  mindmap: {
    uid: "root",
    text: "Root",
    children: [{
      uid: "branch",
      text: "Branch",
      answerId: "answer-branch",
      color: "#123456",
      children: [{ uid: "leaf", text: "Leaf", answerId: "answer-leaf", children: [] }]
    }]
  },
  state: {
    schemaVersion: 2,
    dockLayout: {},
    candidates: [{
      id: "expanded",
      answerId: "answer-expanded",
      title: "Expanded",
      extractionMode: "expanded",
      children: [{ id: "subtitle-a", title: "A" }, { id: "subtitle-b", title: "B" }],
      createdAt: "2026-08-18T00:00:00.000Z"
    }],
    history: [],
    trash: [],
    uiPreferences: {
      theme: "system",
      autoHoverCapture: true,
      captureMode: "single",
      titleSource: "automatic"
    }
  },
  missingAnswerIds: []
};

describe("portable map subtree transitions", () => {
  test("renames and creates child or sibling nodes immutably", () => {
    const renamed = renamePortableNode(portableSnapshot, "branch", "Renamed");
    const child = createPortableChild(renamed, "branch", "Child", "new-child");
    const sibling = createPortableSibling(child, "branch", "Sibling", "new-sibling");
    expect(sibling.mindmap.children.map((node) => node.uid)).toEqual(["branch", "new-sibling"]);
    expect(sibling.mindmap.children[0]?.text).toBe("Renamed");
    expect(sibling.mindmap.children[0]?.children.at(-1)).toMatchObject({ uid: "new-child", text: "Child" });
    expect(portableSnapshot.mindmap.children[0]?.text).toBe("Branch");
  });

  test("moves a complete styled subtree to history and restores it below a target", () => {
    const historical = movePortableSubtreeToHistory(
      portableSnapshot,
      "branch",
      "history-1",
      "2026-08-18T01:00:00.000Z"
    );
    expect(historical.mindmap.children).toEqual([]);
    expect(historical.state.history[0]).toMatchObject({
      id: "history-1",
      originalParentUid: "root",
      originalIndex: 0,
      subtree: { uid: "branch", answerId: "answer-branch", color: "#123456" }
    });
    const restored = restorePortableHistory(historical, "history-1", "root");
    expect(restored.state.history).toEqual([]);
    expect(restored.mindmap.children[0]).toEqual(portableSnapshot.mindmap.children[0]);
  });

  test("moves map, candidate, and history records through trash and restores them", () => {
    const deletedMap = trashPortableSubtree(
      portableSnapshot,
      "branch",
      "trash-map",
      "2026-08-18T01:00:00.000Z"
    );
    expect(deletedMap.state.trash[0]?.kind).toBe("subtree");
    expect(restorePortableTrash(deletedMap, "trash-map").mindmap.children[0]?.uid).toBe("branch");

    const deletedCandidate = trashPortableCandidate(
      portableSnapshot,
      "expanded",
      "trash-candidate",
      "2026-08-18T01:00:00.000Z"
    );
    expect(deletedCandidate.state.candidates).toEqual([]);
    expect(restorePortableTrash(deletedCandidate, "trash-candidate").state.candidates[0]?.id).toBe("expanded");

    const historical = movePortableSubtreeToHistory(portableSnapshot, "branch", "history-1");
    const deletedHistory = trashPortableHistory(historical, "history-1", "trash-history");
    expect(deletedHistory.state.history).toEqual([]);
    expect(restorePortableTrash(deletedHistory, "trash-history").state.history[0]?.id).toBe("history-1");
  });

  test("trashes selected sibling subtrees in one state transition", () => {
    const withSibling: ActiveProjectSnapshot = {
      ...portableSnapshot,
      mindmap: {
        ...portableSnapshot.mindmap,
        children: [
          ...portableSnapshot.mindmap.children,
          { uid: "branch-2", text: "Branch 2", answerId: "answer-2", children: [] }
        ]
      }
    };
    const deleted = trashPortableSubtrees(withSibling, ["branch", "branch-2"], {
      trashIds: ["trash-branch", "trash-branch-2"],
      deletedAt: "2026-08-18T02:00:00.000Z"
    });

    expect(deleted.mindmap.children).toEqual([]);
    expect(deleted.state.trash.map((entry) => entry.id)).toEqual(["trash-branch", "trash-branch-2"]);
    expect(deleted.state.trash.map((entry) => entry.kind === "subtree" ? entry.subtree.answerId : null)).toEqual([
      "answer-branch",
      "answer-2"
    ]);
    const restoredFirst = restorePortableTrash(deleted, "trash-branch");
    const restoredBoth = restorePortableTrash(restoredFirst, "trash-branch-2");
    expect(restoredBoth.mindmap.children.map((node) => node.uid)).toEqual(["branch", "branch-2"]);
    expect(restoredBoth.state.trash).toEqual([]);
  });

  test("coalesces selected descendants and protects the root", () => {
    const deleted = trashPortableSubtrees(
      portableSnapshot,
      ["root", "leaf", "branch", "missing", "branch"],
      {
        trashIds: ["trash-branch"],
        deletedAt: "2026-08-18T02:00:00.000Z"
      }
    );

    expect(deleted.mindmap.uid).toBe("root");
    expect(deleted.mindmap.children).toEqual([]);
    expect(deleted.state.trash).toHaveLength(1);
    expect(deleted.state.trash[0]).toMatchObject({
      kind: "subtree",
      id: "trash-branch",
      subtree: { uid: "branch", children: [{ uid: "leaf", answerId: "answer-leaf" }] }
    });
  });

  test("inserts an expanded candidate as one answer-linked subtree", () => {
    const next = attachPortableCandidate(portableSnapshot, "expanded", "branch", "expanded-root");
    const inserted = next.mindmap.children[0]?.children.at(-1);
    expect(inserted).toMatchObject({
      uid: "expanded-root",
      text: "Expanded",
      answerId: "answer-expanded"
    });
    expect(inserted?.children.map((node) => node.text)).toEqual(["A", "B"]);
    expect(next.state.candidates).toEqual([]);
  });

  test("applies the exact candidate acknowledged by main without reconstructing it", () => {
    const acknowledged = {
      id: "persisted-candidate",
      answerId: "persisted-answer",
      title: "API title",
      extractionMode: "expanded" as const,
      children: [{ id: "child-from-main", title: "Ordered child" }],
      createdAt: "2026-08-18T02:00:00.000Z"
    };
    const next = applyPersistedCandidate(portableSnapshot, acknowledged);
    expect(next.state.candidates.at(-1)).toEqual(acknowledged);
    expect(applyPersistedCandidate(next, acknowledged)).toBe(next);
  });

  test("rejects root moves, invalid targets, stale entries, and UID collisions", () => {
    expect(movePortableSubtreeToHistory(portableSnapshot, "root", "history-root")).toBe(portableSnapshot);
    expect(movePortableSubtreeToHistory(portableSnapshot, "missing", "history-missing")).toBe(portableSnapshot);
    expect(createPortableChild(portableSnapshot, "branch", "Duplicate", "root")).toBe(portableSnapshot);
    expect(createPortableSibling(portableSnapshot, "root", "Sibling", "sibling")).toBe(portableSnapshot);
    expect(restorePortableHistory(portableSnapshot, "missing", "root")).toBe(portableSnapshot);
  });
});
