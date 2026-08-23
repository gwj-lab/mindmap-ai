import path from "node:path";
import type { ActiveProjectSnapshot, MindMapNodeData, WorkspaceManifest } from "../shared/types.js";
import { AnswerRepository } from "./answer-repository.js";
import { ProjectStore } from "./project-store.js";
import { scanWorkspaceAnswerReferences } from "./reference-scanner.js";

function collectTree(node: MindMapNodeData, result: Set<string>): void {
  if (node.answerId) result.add(node.answerId);
  node.children.forEach((child) => collectTree(child, result));
}

function collectNonInboxReferences(snapshot: ActiveProjectSnapshot): Set<string> {
  const result = new Set<string>();
  collectTree(snapshot.mindmap, result);
  snapshot.state.history.forEach((entry) => collectTree(entry.subtree, result));
  snapshot.state.trash.forEach((entry) => {
    if (entry.kind === "history") collectTree(entry.history.subtree, result);
    else if (entry.kind === "subtree") collectTree(entry.subtree, result);
  });
  return result;
}

export interface ReconciliationResult {
  project: ActiveProjectSnapshot;
  repairs: string[];
}

export class WorkspaceReconciler {
  constructor(
    private readonly workspaceRoot: string,
    private readonly answers: AnswerRepository
  ) {}

  async reconcile(manifest: WorkspaceManifest, activeStore: ProjectStore): Promise<ReconciliationResult> {
    const project = await activeStore.loadPortable();
    if (project.readOnly) return { project, repairs: [] };
    const references = await scanWorkspaceAnswerReferences(path.resolve(this.workspaceRoot), manifest);
    const availableAnswers = await this.answers.list();
    const nonInboxReferences = collectNonInboxReferences(project);
    const candidates = project.state.candidates.filter((candidate) => !nonInboxReferences.has(candidate.answerId));
    const repairs: string[] = [];

    if (candidates.length !== project.state.candidates.length) {
      repairs.push(`已移除 ${project.state.candidates.length - candidates.length} 个重复候选引用`);
    }
    for (const answer of availableAnswers) {
      if (references.has(answer.id) || candidates.some((candidate) => candidate.answerId === answer.id)) continue;
      candidates.push({
        id: `candidate-${answer.id}`,
        answerId: answer.id,
        title: answer.title,
        extractionMode: "single",
        children: [],
        createdAt: answer.capturedAt
      });
      repairs.push(`已恢复孤立回答：${answer.title}`);
    }

    if (repairs.length === 0) return { project, repairs };
    const repaired = { ...project, state: { ...project.state, candidates } };
    await activeStore.savePortable(repaired);
    return { project: repaired, repairs };
  }
}
