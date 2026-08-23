import { describe, expect, test } from "vitest";
import {
  createDefaultProject,
  mindMapNodeSchema,
  projectManifestSchema,
  repairCandidates,
  resolveAnswerPath
} from "../../src/shared/project.js";

describe("project contracts", () => {
  test("rejects a project from an unsupported schema version", () => {
    const manifest = createDefaultProject("Research");
    expect(() => projectManifestSchema.parse({ ...manifest, schemaVersion: 2 })).toThrow();
  });

  test("keeps answer files inside the selected project", () => {
    expect(resolveAnswerPath("C:\\vault\\project", "answer-1")).toBe(
      "C:\\vault\\project\\answers\\answer-1.md"
    );
    expect(() => resolveAnswerPath("C:\\vault\\project", "..\\secrets")).toThrow(
      "Invalid answer id"
    );
  });

  test("removes candidates already linked by the map and recovers orphan answers", () => {
    const result = repairCandidates({
      candidates: [
        { id: "candidate-a", answerId: "a", title: "A", createdAt: "2026-08-17T00:00:00.000Z" },
        { id: "candidate-b", answerId: "b", title: "B", createdAt: "2026-08-17T00:00:00.000Z" }
      ],
      linkedAnswerIds: new Set(["a"]),
      answers: [
        { id: "a", title: "A", capturedAt: "2026-08-17T00:00:00.000Z" },
        { id: "b", title: "B", capturedAt: "2026-08-17T00:00:00.000Z" },
        { id: "c", title: "Recovered", capturedAt: "2026-08-17T00:00:00.000Z" }
      ]
    });

    expect(result.map((candidate) => candidate.answerId)).toEqual(["b", "c"]);
    expect(result[1]?.title).toBe("Recovered");
  });

  test("rejects duplicate node identifiers in a recursive map", () => {
    expect(() => mindMapNodeSchema.parse({
      uid: "root",
      text: "Root",
      children: [{ uid: "root", text: "Duplicate", children: [] }]
    })).toThrow();
  });
});
