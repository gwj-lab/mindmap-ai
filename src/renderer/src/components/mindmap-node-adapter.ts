import type { MindMapNodeData } from "../../../shared/types.js";

export const CONTENT_INDICATOR_NOTE = "该节点包含截取内容";
export const PROJECT_INDICATOR_NOTE = "双击进入关联子项目";

export interface MindMapLibraryNode {
  data: Record<string, unknown>;
  children: MindMapLibraryNode[];
}

export function toMindMapLibraryNode(node: MindMapNodeData): MindMapLibraryNode {
  const { children, ...data } = node;
  return {
    data: {
      ...data,
      ...(node.conceptId ? { tag: ["概念"] } : {}),
      ...(node.linkedProjectId ? { note: PROJECT_INDICATOR_NOTE } : node.answerId ? { note: CONTENT_INDICATOR_NOTE } : {})
    },
    children: children.map(toMindMapLibraryNode)
  };
}

export function fromMindMapLibraryNode(node: MindMapLibraryNode): MindMapNodeData {
  const raw = node.data;
  const { note, ...withoutNote } = raw;
  const data = note === CONTENT_INDICATOR_NOTE || note === PROJECT_INDICATOR_NOTE ? withoutNote : raw;
  return {
    ...data,
    uid: String(data.uid ?? crypto.randomUUID()),
    text: String(data.text ?? ""),
    answerId: typeof data.answerId === "string" ? data.answerId : undefined,
    children: (node.children ?? []).map(fromMindMapLibraryNode)
  };
}
