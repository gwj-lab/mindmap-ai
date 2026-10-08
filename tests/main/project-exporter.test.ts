import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { exportStandaloneProject } from "../../src/main/project-exporter.js";
import { WorkspaceStore } from "../../src/main/workspace-store.js";
import type { AnswerDocument } from "../../src/shared/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function answer(id: string): AnswerDocument {
  return {
    metadata: {
      id, provider: "chatgpt", title: id, sourceUrl: "https://chatgpt.com/c/export",
      sourceMessageId: id, contentHash: (id === "used" ? "a" : "b").repeat(64),
      capturedAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z"
    },
    body: `Body ${id}`
  };
}

describe("standalone project export", () => {
  test("copies only reachable answers and rewrites links", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mindmap-export-source-"));
    const destination = await mkdtemp(path.join(tmpdir(), "mindmap-export-destination-"));
    roots.push(root, destination);
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Export", "Portable");
    await store.answers.write(answer("used"));
    await store.answers.write(answer("unused"));
    await store.answers.write({ ...answer("used"), body: "[概念](concept-example.md)" });
    await store.answers.write({ ...answer("concept-example"), body: "[来源](source-example.md)" });
    await store.answers.write({ ...answer("source-example"), body: "[概念](concept-example.md)" });
    const project = structuredClone(opened.project);
    project.mindmap.children.push({ uid: "linked", text: "Used", answerId: "used", children: [] });
    await store.saveActive(project);

    await exportStandaloneProject(root, store.getSummary(), project.manifest.projectId, destination);

    const map = await readFile(path.join(destination, "map.md"), "utf8");
    expect(map).toContain("(answers/used.md)");
    expect(map).not.toContain("../../answers/");
    await expect(access(path.join(destination, "answers", "used.md"))).resolves.toBeUndefined();
    await expect(access(path.join(destination, "answers", "concept-example.md"))).resolves.toBeUndefined();
    await expect(access(path.join(destination, "answers", "source-example.md"))).resolves.toBeUndefined();
    await expect(access(path.join(destination, "answers", "unused.md"))).rejects.toThrow();
    expect(await readdir(destination)).not.toContain(".mindmap-ai-recovery");
    expect(await readdir(destination)).not.toContain("settings.json");
  });
});
