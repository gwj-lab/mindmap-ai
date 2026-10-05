import { access, mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { WorkspaceStore } from "../../src/main/workspace-store.js";
import type { AnswerDocument } from "../../src/shared/types.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-workspace-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceStore", () => {
  test("moves projects with their descendants and keeps canonical ancestry after stale saves", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Main");
    const second = await store.createProject("Second", null);
    const grandchild = await store.createProject("Nested", second.manifest.projectId);
    const stale = await store.switchProject(second.manifest.projectId);
    await store.reparentProject(second.manifest.projectId, opened.project.manifest.projectId);
    stale.mindmap.text = "Unsaved work retained";
    await store.saveActive(stale);
    const loaded = await new WorkspaceStore(root).load();
    expect(loaded.project.manifest.parentProjectId).toBe(opened.project.manifest.projectId);
    expect(loaded.project.mindmap.text).toBe("Unsaved work retained");
    expect(loaded.workspace.projects.find((p) => p.projectId === grandchild.manifest.projectId)?.parentProjectId).toBe(second.manifest.projectId);
    const before = await readFile(path.join(root, "workspace.json"), "utf8");
    await expect(store.reparentProject(opened.project.manifest.projectId, grandchild.manifest.projectId)).rejects.toThrow("后代");
    await expect(store.reparentProject(second.manifest.projectId, second.manifest.projectId)).rejects.toThrow("自身");
    expect(await readFile(path.join(root, "workspace.json"), "utf8")).toBe(before);
    await store.reparentProject(second.manifest.projectId, null);
    expect((await store.switchProject(second.manifest.projectId)).manifest.parentProjectId).toBeNull();
  });

  test("copies a node as a linked child center and recovers the entrance from Markdown", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Main");
    opened.project.mindmap.children.push({ uid: "topic", text: "Topic", answerId: "original-answer", children: [{ uid: "detail", text: "Detail", children: [] }] });
    await store.saveActive(opened.project);
    const linked = await store.linkNode("topic", { kind: "create", name: "Topic project" });
    const entrance = linked.project.mindmap.children[0]!;
    expect(linked.workspace.activeProjectId).toBe(opened.project.manifest.projectId);
    expect(entrance.answerId).toBe("original-answer");
    expect(entrance.children[0]?.text).toBe("Detail");
    const child = await store.switchProject(entrance.linkedProjectId!);
    expect(child.manifest.parentProjectId).toBe(opened.project.manifest.projectId);
    expect(child.mindmap.uid).toBe("topic");
    expect(child.mindmap.text).toBe("Topic");
    expect(child.mindmap.linkedProjectId).toBeUndefined();
    expect(child.mindmap.children[0]?.text).toBe("Detail");
    await store.switchProject(opened.project.manifest.projectId);
    await unlink(path.join(root, "projects", opened.project.manifest.projectId, "mindmap.json"));
    const recovered = await new WorkspaceStore(root).load();
    expect(recovered.project.mindmap.children[0]?.linkedProjectId).toBe(child.manifest.projectId);
  });

  test("links an existing project without replacing its center or branches", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Main");
    opened.project.mindmap.children.push({ uid: "entrance", text: "Entrance", children: [] });
    await store.saveActive(opened.project);
    const target = await store.createProject("Existing", null);
    target.mindmap.text = "Existing center";
    target.mindmap.children.push({ uid: "preserved", text: "Preserved branch", children: [] });
    await store.saveActive(target);
    await store.switchProject(opened.project.manifest.projectId);
    const linked = await store.linkNode("entrance", { kind: "existing", projectId: target.manifest.projectId });
    expect(linked.project.mindmap.children[0]?.text).toBe("Existing center");
    expect(linked.project.mindmap.children[0]?.linkedProjectId).toBe(target.manifest.projectId);
    const loaded = await store.switchProject(target.manifest.projectId);
    expect(loaded.mindmap).toEqual(target.mindmap);
    expect(loaded.manifest.parentProjectId).toBe(opened.project.manifest.projectId);
    await expect(store.linkNode(loaded.mindmap.uid, { kind: "existing", projectId: opened.project.manifest.projectId })).rejects.toThrow("后代");
  });
  test("initializes a workspace with one portable project", async () => {
    const root = await makeRoot();
    const opened = await new WorkspaceStore(root).initialize("Research", "主项目");
    const projectId = opened.workspace.activeProjectId;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(opened.project.manifest.name).toBe("主项目");

    const entries = await readdir(path.join(root, "projects", projectId!));
    expect(entries.sort()).toEqual([
      "history.md",
      "inbox.md",
      "map.md",
      "mindmap.json",
      "project.json",
      "trash.md"
    ]);
    await expect(readFile(path.join(root, "workspace.json"), "utf8")).resolves.toContain('"schemaVersion": 2');
    await expect(readFile(path.join(root, "projects", projectId!, "map.md"), "utf8")).resolves.toContain("```mermaid");
  });

  test("creates nested projects and renames metadata without renaming directories", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Root");
    const rootId = opened.project.manifest.projectId;
    const child = await store.createProject("Child", rootId);
    const childDir = path.join(root, "projects", child.manifest.projectId);
    await store.renameProject(child.manifest.projectId, "Renamed");
    const switched = await store.switchProject(rootId);

    expect(switched.manifest.name).toBe("Root");
    await expect(readdir(childDir)).resolves.toContain("project.json");
    const loaded = await new WorkspaceStore(root).load();
    expect(loaded.workspace.projects.find((item) => item.projectId === child.manifest.projectId)).toMatchObject({
      name: "Renamed",
      parentProjectId: rootId
    });
  });

  test("shares one answer repository across projects", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "One");
    const answer: AnswerDocument = {
      metadata: {
        id: "shared-answer",
        provider: "chatgpt",
        title: "Shared",
        sourceUrl: "https://chatgpt.com/c/1",
        sourceMessageId: "message-1",
        contentHash: "a".repeat(64),
        capturedAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z"
      },
      body: "Shared body"
    };
    await store.answers.write(answer);
    const other = await store.createProject("Two", null);
    expect(other.manifest.projectId).not.toBe(opened.project.manifest.projectId);
    await expect(store.answers.read("shared-answer")).resolves.toEqual(answer);
    await expect(readFile(path.join(root, "answers", "shared-answer.md"), "utf8")).resolves.toContain("Shared body");
  });

  test("serializes concurrent active-project saves and writes portable tray indexes", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Queue");
    const first = structuredClone(opened.project);
    first.state.candidates.push({
      id: "candidate-1",
      answerId: "answer-1",
      title: "First",
      extractionMode: "single",
      children: [],
      createdAt: "2026-08-18T00:00:00.000Z"
    });
    const second = structuredClone(first);
    second.state.candidates[0]!.title = "Second";

    await Promise.all([store.saveActive(first), store.saveActive(second)]);
    const reloaded = await new WorkspaceStore(root).load();
    expect(reloaded.project.state.candidates[0]?.title).toBe("Second");
    const projectDir = path.join(root, "projects", opened.project.manifest.projectId);
    await expect(readFile(path.join(projectDir, "inbox.md"), "utf8")).resolves.toContain("Second");
    await expect(readFile(path.join(projectDir, "history.md"), "utf8")).resolves.toBe("# History\n");
    await expect(readFile(path.join(projectDir, "trash.md"), "utf8")).resolves.toBe("# Trash\n");
  });

  test("recovers hierarchy from map.md when lossless JSON is missing", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Recovery");
    const changed = structuredClone(opened.project);
    changed.mindmap.children.push({ uid: "child", text: "Recovered", children: [] });
    await store.saveActive(changed);
    await unlink(path.join(root, "projects", changed.manifest.projectId, "mindmap.json"));

    const loaded = await new WorkspaceStore(root).load();
    expect(loaded.project.mindmap.children[0]?.text).toBe("Recovered");
  });

  test("opens read-only and reports malformed portable recovery", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Research", "Broken");
    const projectDir = path.join(root, "projects", opened.project.manifest.projectId);
    await unlink(path.join(projectDir, "mindmap.json"));
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(projectDir, "map.md"), "broken", "utf8"));

    const loaded = await new WorkspaceStore(root).load();
    expect(loaded.project.readOnly).toBe(true);
    await expect(readdir(path.join(projectDir, ".mindmap-ai-recovery"), { recursive: true })).resolves.toContain("error-report.txt");
  });

  test("moves a project to trash and restores its parent and order", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Trash", "Root");
    const child = await store.createProject("Child", opened.project.manifest.projectId);
    await store.moveProjectToTrash(child.manifest.projectId);
    expect(store.getSummary().projectTrash[0]).toMatchObject({
      projectId: child.manifest.projectId,
      previousParentProjectId: opened.project.manifest.projectId,
      previousOrder: 0
    });
    await expect(readdir(path.join(root, ".trash", "projects", child.manifest.projectId))).resolves.toContain("project.json");

    await store.restoreProject(child.manifest.projectId);
    expect(store.getSummary().projects.find((item) => item.projectId === child.manifest.projectId)).toMatchObject({
      parentProjectId: opened.project.manifest.projectId,
      order: 0
    });
  });

  test("permanently deletes only an exact trashed project directory", async () => {
    const root = await makeRoot();
    const store = new WorkspaceStore(root);
    const opened = await store.initialize("Trash", "Root");
    const child = await store.createProject("Child", opened.project.manifest.projectId);
    await store.moveProjectToTrash(child.manifest.projectId);
    await store.permanentlyDeleteProject(child.manifest.projectId, false);
    expect(store.getSummary().projectTrash).toEqual([]);
    await expect(access(path.join(root, ".trash", "projects", child.manifest.projectId))).rejects.toThrow();
    await expect(access(path.join(root, "workspace.json"))).resolves.toBeUndefined();
  });
});
