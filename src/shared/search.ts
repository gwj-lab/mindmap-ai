import type { MindMapNodeData } from './types.js';

export interface NodeSearchResult {
  projectId: string;
  projectName: string;
  nodeUid: string;
  title: string;
  answerId?: string;
  snippet?: string;
}

export function collectSearchNodes(root: MindMapNodeData, projectId: string, projectName: string): NodeSearchResult[] {
  const nodes: NodeSearchResult[] = [];
  const visit = (node: MindMapNodeData): void => {
    nodes.push({ projectId, projectName, nodeUid: node.uid, title: node.text, answerId: node.answerId });
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

export function searchTerms(query: string): string[] { return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean); }
export function matchesSearch(text: string, terms: string[]): boolean { const normalized = text.toLocaleLowerCase(); return terms.length > 0 && terms.every((term) => normalized.includes(term)); }
export function searchSnippet(text: string, terms: string[]): string {
  const offset = Math.max(0, text.toLocaleLowerCase().indexOf(terms[0]!) - 35);
  return `${offset ? '…' : ''}${text.slice(offset, offset + 150).replace(/\s+/gu, ' ')}${offset + 150 < text.length ? '…' : ''}`;
}
