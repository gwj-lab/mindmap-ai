import type { ActiveProjectSnapshot, MindMapNodeData } from '../../shared/types.js';

export function nodesForMerge(root: MindMapNodeData, uids: string[]): MindMapNodeData[] {
  const selected = new Set(uids);
  const nodes: MindMapNodeData[] = [];
  const visit = (node: MindMapNodeData, selectedAncestor: boolean): void => {
    const chosen = selected.has(node.uid);
    if (chosen && selectedAncestor) throw new Error('父子节点不能同时合并，请选择彼此独立的节点');
    if (chosen) nodes.push(node);
    node.children.forEach((child) => visit(child, selectedAncestor || chosen));
  };
  visit(root, false);
  if (nodes.length !== selected.size || nodes.length < 2) throw new Error('请先选中至少两个节点');
  return nodes;
}

export function mergePortableNodes(snapshot: ActiveProjectSnapshot, uids: string[], targetUid: string, title: string, answerId?: string): ActiveProjectSnapshot {
  if (snapshot.readOnly) throw new Error('当前项目只读');
  const nodes = nodesForMerge(snapshot.mindmap, uids);
  const target = nodes.find((node) => node.uid === targetUid);
  if (!target || !title.trim() || title.trim().length > 500) throw new Error('合并标题或保留节点无效');
  const documentNode = answerId ? nodes.find((node) => node.answerId === answerId) : undefined;
  if (answerId && !documentNode) throw new Error('只能保留所选节点中的一篇文档');
  const children = [...target.children, ...nodes.filter((node) => node.uid !== targetUid).flatMap((node) => node.children)];
  const merged: MindMapNodeData = { ...target, text: title.trim(), children };
  delete merged.answerId; delete merged.conceptId; delete merged.tags;
  if (documentNode) {
    merged.answerId = answerId;
    if (documentNode.conceptId) merged.conceptId = documentNode.conceptId;
    if (documentNode.tags) merged.tags = documentNode.tags;
  }
  const removed = new Set(nodes.filter((node) => node.uid !== targetUid).map((node) => node.uid));
  const replace = (node: MindMapNodeData): MindMapNodeData => node.uid === targetUid ? merged : { ...node, children: node.children.filter((child) => !removed.has(child.uid)).map(replace) };
  return { ...snapshot, mindmap: replace(snapshot.mindmap) };
}
