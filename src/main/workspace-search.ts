import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { mindMapNodeSchema } from '../shared/project.js';
import { collectSearchNodes, matchesSearch, searchSnippet, searchTerms, type NodeSearchResult } from '../shared/search.js';
import type { WorkspaceStore } from './workspace-store.js';

const CACHE_LIMIT = 32 * 1024 * 1024;

// Built only when the search bar is used; repeated searches do not reread documents.
export class WorkspaceSearch {
  private maps = new Map<string, { stamp: string; nodes: NodeSearchResult[] }>();
  private bodies = new Map<string, { stamp: string; text: string }>();
  private bytes = 0;
  private revision = 0;
  constructor(private readonly workspace: WorkspaceStore) {}

  async query(query: string, includeContent: boolean): Promise<NodeSearchResult[]> {
    const revision = ++this.revision;
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const nodes: NodeSearchResult[] = [];
    for (const project of this.workspace.getSummary().projects) {
      const file = path.join(this.workspace.getProjectDirectory(project.projectId), 'mindmap.json');
      const info = await stat(file);
      if (revision !== this.revision) return [];
      const stamp = `${info.mtimeMs}:${info.size}:${project.name}`;
      let cached = this.maps.get(project.projectId);
      if (cached?.stamp !== stamp) {
        const root = mindMapNodeSchema.parse(JSON.parse(await readFile(file, 'utf8')));
        cached = { stamp, nodes: collectSearchNodes(root, project.projectId, project.name) };
        this.maps.set(project.projectId, cached);
      }
      nodes.push(...cached.nodes);
    }
    const titleMatches = nodes.filter((node) => matchesSearch(node.title, terms));
    if (!includeContent || titleMatches.length >= 50) return titleMatches.slice(0, 50);
    const result = [...titleMatches];
    const documents = new Map<string, NodeSearchResult[]>();
    for (const node of nodes) {
      if (!node.answerId || matchesSearch(node.title, terms) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(node.answerId)) continue;
      const group = documents.get(node.answerId) ?? []; group.push(node); documents.set(node.answerId, group);
    }
    for (const [id, linked] of documents) {
      if (revision !== this.revision) return [];
      if (result.length >= 50) break;
      const text = await this.body(id);
      if (text && matchesSearch(text, terms)) result.push(...linked.map((node) => ({ ...node, snippet: searchSnippet(text, terms) })));
    }
    return result.slice(0, 50);
  }

  private async body(id: string): Promise<string | null> {
    try {
      const info = await stat(path.join(this.workspace.getWorkspaceDirectory(), 'answers', `${id}.md`));
      if (info.size > 20_000_000) return null;
      const stamp = `${info.mtimeMs}:${info.size}`;
      const cached = this.bodies.get(id);
      if (cached?.stamp === stamp) { this.bodies.delete(id); this.bodies.set(id, cached); return cached.text; }
      if (cached) { this.bytes -= cached.text.length * 2; this.bodies.delete(id); }
      const text = (await this.workspace.answers.read(id))?.body;
      if (text === undefined) return null;
      const concurrent = this.bodies.get(id);
      if (concurrent) { this.bytes -= concurrent.text.length * 2; this.bodies.delete(id); }
      if (text.length * 2 > CACHE_LIMIT) return text;
      while (this.bytes + text.length * 2 > CACHE_LIMIT && this.bodies.size) {
        const [key, oldest] = this.bodies.entries().next().value!;
        this.bytes -= oldest.text.length * 2; this.bodies.delete(key);
      }
      this.bodies.set(id, { stamp, text }); this.bytes += text.length * 2;
      return text;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
}
