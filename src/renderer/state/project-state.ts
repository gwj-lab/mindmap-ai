import type {
  ActiveProjectSnapshot,
  AnswerDocument,
  CandidateNode,
  MindMapNodeData,
  ProjectSnapshot
} from "../../shared/types.js";

function appendChild(
  node: MindMapNodeData,
  targetUid: string,
  child: MindMapNodeData
): { node: MindMapNodeData; found: boolean } {
  if (node.uid === targetUid) return { node: { ...node, children: [...node.children, child] }, found: true };
  for (let index = 0; index < node.children.length; index += 1) {
    const result = appendChild(node.children[index]!, targetUid, child);
    if (result.found) {
      const children = [...node.children];
      children[index] = result.node;
      return { node: { ...node, children }, found: true };
    }
  }
  return { node, found: false };
}

function containsUid(node: MindMapNodeData, uid: string): boolean {
  return node.uid === uid || node.children.some((child) => containsUid(child, uid));
}

interface DetachedSubtree {
  node: MindMapNodeData;
  subtree: MindMapNodeData;
  parentUid: string;
  index: number;
}

function detachSubtree(node: MindMapNodeData, targetUid: string): DetachedSubtree | null {
  const directIndex = node.children.findIndex((child) => child.uid === targetUid);
  if (directIndex >= 0) {
    const subtree = node.children[directIndex]!;
    return {
      node: { ...node, children: node.children.filter((_, index) => index !== directIndex) },
      subtree,
      parentUid: node.uid,
      index: directIndex
    };
  }
  for (let index = 0; index < node.children.length; index += 1) {
    const result = detachSubtree(node.children[index]!, targetUid);
    if (result) {
      const children = [...node.children];
      children[index] = result.node;
      return { ...result, node: { ...node, children } };
    }
  }
  return null;
}

function insertChildAt(
  node: MindMapNodeData,
  parentUid: string,
  child: MindMapNodeData,
  index: number
): { node: MindMapNodeData; found: boolean } {
  if (node.uid === parentUid) {
    const children = [...node.children];
    children.splice(Math.min(Math.max(index, 0), children.length), 0, child);
    return { node: { ...node, children }, found: true };
  }
  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const result = insertChildAt(node.children[childIndex]!, parentUid, child, index);
    if (result.found) {
      const children = [...node.children];
      children[childIndex] = result.node;
      return { node: { ...node, children }, found: true };
    }
  }
  return { node, found: false };
}

export function attachCandidate(
  snapshot: ProjectSnapshot,
  candidateId: string,
  targetUid: string,
  nodeUid: string = crypto.randomUUID()
): ProjectSnapshot {
  const candidate = snapshot.workspace.candidates.find((item) => item.id === candidateId);
  if (!candidate) return snapshot;
  const child: MindMapNodeData = {
    uid: nodeUid,
    text: candidate.title,
    answerId: candidate.answerId,
    children: []
  };
  const result = appendChild(snapshot.mindmap, targetUid, child);
  if (!result.found) return snapshot;
  return {
    ...snapshot,
    mindmap: result.node,
    workspace: {
      ...snapshot.workspace,
      candidates: snapshot.workspace.candidates.filter((item) => item.id !== candidateId)
    }
  };
}

export function addCapturedAnswer(snapshot: ProjectSnapshot, answer: AnswerDocument): ProjectSnapshot {
  if (snapshot.workspace.candidates.some((item) => item.answerId === answer.metadata.id)) return snapshot;
  const candidate: CandidateNode = {
    id: `candidate-${answer.metadata.id}`,
    answerId: answer.metadata.id,
    title: answer.metadata.title,
    createdAt: answer.metadata.capturedAt
  };
  return {
    ...snapshot,
    workspace: {
      ...snapshot.workspace,
      candidates: [...snapshot.workspace.candidates, candidate]
    }
  };
}

function renameNode(node: MindMapNodeData, nodeUid: string, title: string): MindMapNodeData {
  if (node.uid === nodeUid) return { ...node, text: title };
  return { ...node, children: node.children.map((child) => renameNode(child, nodeUid, title)) };
}

export function updateLinkedNodeTitle(
  snapshot: ProjectSnapshot,
  nodeUid: string,
  title: string
): ProjectSnapshot {
  return { ...snapshot, mindmap: renameNode(snapshot.mindmap, nodeUid, title) };
}

export function attachPortableCandidate(
  snapshot: ActiveProjectSnapshot,
  candidateId: string,
  targetUid: string,
  nodeUid: string = crypto.randomUUID()
): ActiveProjectSnapshot {
  const candidate = snapshot.state.candidates.find((item) => item.id === candidateId);
  if (!candidate || containsUid(snapshot.mindmap, nodeUid)) return snapshot;
  const child: MindMapNodeData = {
    uid: nodeUid,
    text: candidate.title,
    answerId: candidate.answerId,
    children: (candidate.children ?? []).map((item) => ({
      uid: crypto.randomUUID(),
      text: item.title,
      children: []
    }))
  };
  const result = appendChild(snapshot.mindmap, targetUid, child);
  if (!result.found) return snapshot;
  return {
    ...snapshot,
    mindmap: result.node,
    state: {
      ...snapshot.state,
      candidates: snapshot.state.candidates.filter((item) => item.id !== candidateId)
    }
  };
}

export function addCapturedAnswerToPortableProject(
  snapshot: ActiveProjectSnapshot,
  answer: AnswerDocument
): ActiveProjectSnapshot {
  if (snapshot.state.candidates.some((item) => item.answerId === answer.metadata.id)) return snapshot;
  const candidate: CandidateNode = {
    id: `candidate-${answer.metadata.id}`,
    answerId: answer.metadata.id,
    title: answer.metadata.title,
    extractionMode: "single",
    children: [],
    createdAt: answer.metadata.capturedAt
  };
  return {
    ...snapshot,
    state: { ...snapshot.state, candidates: [...snapshot.state.candidates, candidate] }
  };
}

export function applyPersistedCandidate(
  snapshot: ActiveProjectSnapshot,
  candidate: CandidateNode
): ActiveProjectSnapshot {
  if (snapshot.state.candidates.some((item) => item.id === candidate.id || item.answerId === candidate.answerId)) {
    return snapshot;
  }
  return {
    ...snapshot,
    state: { ...snapshot.state, candidates: [...snapshot.state.candidates, candidate] }
  };
}

export function updatePortableLinkedNodeTitle(
  snapshot: ActiveProjectSnapshot,
  nodeUid: string,
  title: string
): ActiveProjectSnapshot {
  return { ...snapshot, mindmap: renameNode(snapshot.mindmap, nodeUid, title) };
}

export function renamePortableNode(
  snapshot: ActiveProjectSnapshot,
  nodeUid: string,
  title: string
): ActiveProjectSnapshot {
  const normalized = title.trim();
  if (!normalized || !containsUid(snapshot.mindmap, nodeUid)) return snapshot;
  return { ...snapshot, mindmap: renameNode(snapshot.mindmap, nodeUid, normalized) };
}

export function createPortableChild(
  snapshot: ActiveProjectSnapshot,
  targetUid: string,
  title: string,
  nodeUid: string = crypto.randomUUID()
): ActiveProjectSnapshot {
  const normalized = title.trim();
  if (!normalized || containsUid(snapshot.mindmap, nodeUid)) return snapshot;
  const result = appendChild(snapshot.mindmap, targetUid, { uid: nodeUid, text: normalized, children: [] });
  return result.found ? { ...snapshot, mindmap: result.node } : snapshot;
}

export function createPortableSibling(
  snapshot: ActiveProjectSnapshot,
  targetUid: string,
  title: string,
  nodeUid: string = crypto.randomUUID()
): ActiveProjectSnapshot {
  const normalized = title.trim();
  if (!normalized || targetUid === snapshot.mindmap.uid || containsUid(snapshot.mindmap, nodeUid)) return snapshot;
  const detached = detachSubtree(snapshot.mindmap, targetUid);
  if (!detached) return snapshot;
  const restoredTarget = insertChildAt(detached.node, detached.parentUid, detached.subtree, detached.index);
  const withSibling = insertChildAt(
    restoredTarget.node,
    detached.parentUid,
    { uid: nodeUid, text: normalized, children: [] },
    detached.index + 1
  );
  return withSibling.found ? { ...snapshot, mindmap: withSibling.node } : snapshot;
}

export function movePortableSubtreeToHistory(
  snapshot: ActiveProjectSnapshot,
  nodeUid: string,
  historyId: string = crypto.randomUUID(),
  movedAt: string = new Date().toISOString()
): ActiveProjectSnapshot {
  if (nodeUid === snapshot.mindmap.uid || snapshot.state.history.some((entry) => entry.id === historyId)) return snapshot;
  const detached = detachSubtree(snapshot.mindmap, nodeUid);
  if (!detached) return snapshot;
  return {
    ...snapshot,
    mindmap: detached.node,
    state: {
      ...snapshot.state,
      history: [...snapshot.state.history, {
        id: historyId,
        subtree: detached.subtree,
        originalParentUid: detached.parentUid,
        originalIndex: detached.index,
        movedAt
      }]
    }
  };
}

export function restorePortableHistory(
  snapshot: ActiveProjectSnapshot,
  historyId: string,
  targetUid: string
): ActiveProjectSnapshot {
  const history = snapshot.state.history.find((entry) => entry.id === historyId);
  if (!history || containsUid(snapshot.mindmap, history.subtree.uid)) return snapshot;
  const result = appendChild(snapshot.mindmap, targetUid, history.subtree);
  if (!result.found) return snapshot;
  return {
    ...snapshot,
    mindmap: result.node,
    state: {
      ...snapshot.state,
      history: snapshot.state.history.filter((entry) => entry.id !== historyId)
    }
  };
}

export function trashPortableSubtree(
  snapshot: ActiveProjectSnapshot,
  nodeUid: string,
  trashId: string = crypto.randomUUID(),
  deletedAt: string = new Date().toISOString()
): ActiveProjectSnapshot {
  if (nodeUid === snapshot.mindmap.uid || snapshot.state.trash.some((entry) => entry.id === trashId)) return snapshot;
  const detached = detachSubtree(snapshot.mindmap, nodeUid);
  if (!detached) return snapshot;
  return {
    ...snapshot,
    mindmap: detached.node,
    state: {
      ...snapshot.state,
      trash: [...snapshot.state.trash, {
        kind: "subtree",
        id: trashId,
        deletedAt,
        subtree: detached.subtree,
        originalParentUid: detached.parentUid,
        originalIndex: detached.index
      }]
    }
  };
}

interface BatchTrashOptions {
  trashIds?: readonly string[];
  deletedAt?: string;
}

function topLevelSelectedUids(
  root: MindMapNodeData,
  selectedUids: ReadonlySet<string>
): string[] {
  const result: string[] = [];
  const visit = (node: MindMapNodeData, selectedAncestor: boolean): void => {
    const selected = node.uid !== root.uid && selectedUids.has(node.uid);
    if (selected && !selectedAncestor) result.push(node.uid);
    for (const child of node.children) visit(child, selectedAncestor || selected);
  };
  visit(root, false);
  return result;
}

export function trashPortableSubtrees(
  snapshot: ActiveProjectSnapshot,
  nodeUids: readonly string[],
  options: BatchTrashOptions = {}
): ActiveProjectSnapshot {
  const selected = topLevelSelectedUids(snapshot.mindmap, new Set(nodeUids));
  if (selected.length === 0) return snapshot;
  const deletedAt = options.deletedAt ?? new Date().toISOString();
  let current = snapshot;
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    current = trashPortableSubtree(
      current,
      selected[index]!,
      options.trashIds?.[index] ?? crypto.randomUUID(),
      deletedAt
    );
  }
  const previousTrash = snapshot.state.trash;
  const addedTrash = current.state.trash.slice(previousTrash.length).reverse();
  return {
    ...current,
    state: { ...current.state, trash: [...previousTrash, ...addedTrash] }
  };
}

export function trashPortableCandidate(
  snapshot: ActiveProjectSnapshot,
  candidateId: string,
  trashId: string = crypto.randomUUID(),
  deletedAt: string = new Date().toISOString()
): ActiveProjectSnapshot {
  const candidate = snapshot.state.candidates.find((entry) => entry.id === candidateId);
  if (!candidate || snapshot.state.trash.some((entry) => entry.id === trashId)) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      candidates: snapshot.state.candidates.filter((entry) => entry.id !== candidateId),
      trash: [...snapshot.state.trash, { kind: "candidate", id: trashId, deletedAt, candidate }]
    }
  };
}

export function trashPortableHistory(
  snapshot: ActiveProjectSnapshot,
  historyId: string,
  trashId: string = crypto.randomUUID(),
  deletedAt: string = new Date().toISOString()
): ActiveProjectSnapshot {
  const history = snapshot.state.history.find((entry) => entry.id === historyId);
  if (!history || snapshot.state.trash.some((entry) => entry.id === trashId)) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      history: snapshot.state.history.filter((entry) => entry.id !== historyId),
      trash: [...snapshot.state.trash, { kind: "history", id: trashId, deletedAt, history }]
    }
  };
}

export function restorePortableTrash(
  snapshot: ActiveProjectSnapshot,
  trashId: string
): ActiveProjectSnapshot {
  const entry = snapshot.state.trash.find((item) => item.id === trashId);
  if (!entry) return snapshot;
  const remainingTrash = snapshot.state.trash.filter((item) => item.id !== trashId);
  if (entry.kind === "candidate") {
    if (snapshot.state.candidates.some((candidate) => candidate.id === entry.candidate.id)) return snapshot;
    return {
      ...snapshot,
      state: { ...snapshot.state, candidates: [...snapshot.state.candidates, entry.candidate], trash: remainingTrash }
    };
  }
  if (entry.kind === "history") {
    if (snapshot.state.history.some((history) => history.id === entry.history.id)) return snapshot;
    return {
      ...snapshot,
      state: { ...snapshot.state, history: [...snapshot.state.history, entry.history], trash: remainingTrash }
    };
  }
  if (containsUid(snapshot.mindmap, entry.subtree.uid)) return snapshot;
  const result = insertChildAt(snapshot.mindmap, entry.originalParentUid, entry.subtree, entry.originalIndex);
  if (!result.found) return snapshot;
  return { ...snapshot, mindmap: result.node, state: { ...snapshot.state, trash: remainingTrash } };
}

export function permanentlyRemovePortableTrash(
  snapshot: ActiveProjectSnapshot,
  trashId: string
): ActiveProjectSnapshot {
  if (!snapshot.state.trash.some((entry) => entry.id === trashId)) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      trash: snapshot.state.trash.filter((entry) => entry.id !== trashId)
    }
  };
}
