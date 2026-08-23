import { describe, expect, test } from "vitest";
import {
  candidateNodeV2Schema,
  projectStateSchema,
  workspaceManifestSchema
} from "../../src/shared/workspace.js";

const NOW = "2026-08-18T00:00:00.000Z";
const WORKSPACE_ID = "9dfd4da9-f0c8-4fbe-bf3c-cb199b576ddd";
const ROOT_ID = "2cb66115-270c-4107-89e0-f61508c14d2b";
const CHILD_ID = "f93a5f49-b715-4765-baf9-124dd2fe7436";

function workspaceInput(): unknown {
  return {
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    name: "Research workspace",
    activeProjectId: CHILD_ID,
    projects: [
      {
        projectId: ROOT_ID,
        parentProjectId: null,
        name: "Root",
        order: 0,
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        projectId: CHILD_ID,
        parentProjectId: ROOT_ID,
        name: "Child",
        order: 0,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    projectTrash: [],
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("version 2 workspace contracts", () => {
  test("accepts an ordered nested workspace", () => {
    const result = workspaceManifestSchema.parse(workspaceInput());
    expect(result.activeProjectId).toBe(CHILD_ID);
    expect(result.projects[1]?.parentProjectId).toBe(ROOT_ID);
  });

  test("rejects duplicate projects, missing active projects, and circular parents", () => {
    const duplicate = workspaceInput() as Record<string, unknown>;
    duplicate.projects = [
      (duplicate.projects as unknown[])[0],
      { ...(duplicate.projects as Record<string, unknown>[])[0], name: "Duplicate" }
    ];
    expect(() => workspaceManifestSchema.parse(duplicate)).toThrow();

    const missingActive = workspaceInput() as Record<string, unknown>;
    missingActive.activeProjectId = "529d612e-98ce-422a-84d0-131fe6c2ad65";
    expect(() => workspaceManifestSchema.parse(missingActive)).toThrow();

    const circular = workspaceInput() as Record<string, unknown>;
    circular.projects = [
      {
        ...(circular.projects as Record<string, unknown>[])[0],
        parentProjectId: CHILD_ID
      },
      (circular.projects as unknown[])[1]
    ];
    expect(() => workspaceManifestSchema.parse(circular)).toThrow();
  });

  test("rejects path-shaped identifiers and overlong names", () => {
    const malformed = workspaceInput() as Record<string, unknown>;
    malformed.workspaceId = "..\\outside";
    expect(() => workspaceManifestSchema.parse(malformed)).toThrow();

    const overlong = workspaceInput() as Record<string, unknown>;
    overlong.name = "x".repeat(121);
    expect(() => workspaceManifestSchema.parse(overlong)).toThrow();
  });

  test("accepts single and expanded candidates but limits child titles", () => {
    const single = candidateNodeV2Schema.parse({
      id: "candidate-1",
      answerId: "answer-1",
      title: "Single",
      extractionMode: "single",
      children: [],
      createdAt: NOW
    });
    expect(single.children).toEqual([]);

    const expanded = {
      ...single,
      extractionMode: "expanded",
      children: Array.from({ length: 12 }, (_, index) => ({
        id: `child-${index}`,
        title: `Child ${index}`
      }))
    };
    expect(candidateNodeV2Schema.parse(expanded).children).toHaveLength(12);
    expect(() => candidateNodeV2Schema.parse({
      ...expanded,
      children: [...expanded.children, { id: "child-12", title: "Too many" }]
    })).toThrow();
  });

  test("validates recursive history and discriminated trash entries", () => {
    const state = projectStateSchema.parse({
      schemaVersion: 2,
      dockLayout: {},
      candidates: [],
      history: [{
        id: "history-1",
        subtree: {
          uid: "node-a",
          text: "A",
          answerId: "answer-1",
          children: [{ uid: "node-b", text: "B", children: [] }]
        },
        originalParentUid: "root",
        originalIndex: 0,
        movedAt: NOW
      }],
      trash: [{
        kind: "candidate",
        id: "trash-1",
        deletedAt: NOW,
        candidate: {
          id: "candidate-1",
          answerId: "answer-1",
          title: "Candidate",
          extractionMode: "single",
          children: [],
          createdAt: NOW
        }
      }],
      uiPreferences: {
        theme: "system",
        mindMapTheme: "paper",
        autoHoverCapture: true,
        captureMode: "single",
        titleSource: "automatic"
      }
    });
    expect(state.history[0]?.subtree.children[0]?.uid).toBe("node-b");
    expect(state.trash[0]?.kind).toBe("candidate");
  });
});
