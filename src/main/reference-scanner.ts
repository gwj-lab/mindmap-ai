import { readFile } from "node:fs/promises";
import path from "node:path";
import { mindMapNodeSchema } from "../shared/project.js";
import { projectStateSchema } from "../shared/workspace.js";
import { parsePortableMap } from "../shared/portable-map.js";
import type { MindMapNodeData, ProjectState, WorkspaceManifest } from "../shared/types.js";

function collectTreeAnswerIds(node: MindMapNodeData, result: Set<string>): void {
  if (node.answerId) result.add(node.answerId);
  node.children.forEach((child) => collectTreeAnswerIds(child, result));
}

function collectStateAnswerIds(state: ProjectState, result: Set<string>): void {
  state.candidates.forEach((candidate) => result.add(candidate.answerId));
  state.history.forEach((entry) => collectTreeAnswerIds(entry.subtree, result));
  state.trash.forEach((entry) => {
    if (entry.kind === "candidate") result.add(entry.candidate.answerId);
    else if (entry.kind === "history") collectTreeAnswerIds(entry.history.subtree, result);
    else collectTreeAnswerIds(entry.subtree, result);
  });
}

function safeProjectDirectory(root: string, area: "projects" | ".trash/projects", projectId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Invalid project id");
  const parent = path.resolve(root, area);
  const directory = path.resolve(parent, projectId);
  if (!directory.startsWith(`${parent}${path.sep}`)) throw new Error("Project path escapes workspace");
  return directory;
}

export async function readProjectAnswerIds(projectDirectory: string): Promise<Set<string>> {
  const stored = JSON.parse(await readFile(path.join(projectDirectory, "project.json"), "utf8")) as {
    state?: unknown;
  };
  const state = projectStateSchema.parse(stored.state);
  let mindmap: MindMapNodeData;
  try {
    mindmap = mindMapNodeSchema.parse(
      JSON.parse(await readFile(path.join(projectDirectory, "mindmap.json"), "utf8"))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mindmap = parsePortableMap(await readFile(path.join(projectDirectory, "map.md"), "utf8"));
  }
  const result = new Set<string>();
  collectTreeAnswerIds(mindmap, result);
  collectStateAnswerIds(state, result);
  return result;
}

export async function scanWorkspaceAnswerReferences(
  rootInput: string,
  workspace: WorkspaceManifest
): Promise<Map<string, Set<string>>> {
  const root = path.resolve(rootInput);
  const references = new Map<string, Set<string>>();
  const records = [
    ...workspace.projects.map((project) => ({ projectId: project.projectId, area: "projects" as const })),
    ...workspace.projectTrash.map((project) => ({ projectId: project.projectId, area: ".trash/projects" as const }))
  ];
  for (const record of records) {
    const answerIds = await readProjectAnswerIds(safeProjectDirectory(root, record.area, record.projectId));
    for (const answerId of answerIds) {
      const projects = references.get(answerId) ?? new Set<string>();
      projects.add(record.projectId);
      references.set(answerId, projects);
    }
  }
  return references;
}
