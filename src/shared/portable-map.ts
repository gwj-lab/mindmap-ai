import { z } from "zod";
import { mindMapNodeSchema } from "./project.js";
import type { CandidateNode, MindMapNodeData } from "./types.js";

const localIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface PortableProjectDescriptor {
  projectId: string;
  name: string;
}

interface NodeMetadata {
  conceptId?: string;
  tags?: string[];
  uid: string;
  text: string;
  answerId?: string;
  linkedProjectId?: string;
}

const nodeMetadataSchema = z.object({
  conceptId: z.string().uuid().optional(),
  tags: z.array(z.string().max(40)).optional(),
  uid: z.string().min(1).max(128),
  text: z.string().min(1).max(4_000),
  answerId: z.string().regex(localIdPattern).optional(),
  linkedProjectId: z.string().uuid().optional()
});

function displayText(text: string): string {
  return text.replace(/\s+/g, " ").trim() || "Untitled";
}

function escapeMarkdownLabel(text: string): string {
  return displayText(text)
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeMermaidLabel(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function metadataFor(node: MindMapNodeData): NodeMetadata {
  return {
    uid: node.uid,
    text: encodeURIComponent(node.text),
    ...(node.answerId ? { answerId: node.answerId } : {}),
    ...(typeof node.conceptId === "string" ? { conceptId: node.conceptId, tags: ["概念"] } : {}),
    ...(node.linkedProjectId ? { linkedProjectId: node.linkedProjectId } : {})
  };
}

function serializeOutlineNode(node: MindMapNodeData, depth: number, lines: string[]): void {
  if (node.answerId && !localIdPattern.test(node.answerId)) throw new Error("Invalid answer id");
  const label = escapeMarkdownLabel(node.text);
  const visible = node.answerId ? `[${label}](../../answers/${node.answerId}.md)` : label;
  lines.push(`${"  ".repeat(depth)}- ${visible} <!-- mindmap-ai:node ${JSON.stringify(metadataFor(node))} -->`);
  node.children.forEach((child) => serializeOutlineNode(child, depth + 1, lines));
}

function serializeMermaidNode(
  node: MindMapNodeData,
  depth: number,
  lines: string[],
  sequence: { value: number }
): void {
  const id = sequence.value;
  sequence.value += 1;
  lines.push(`${"  ".repeat(depth + 1)}n${id}["${escapeMermaidLabel(node.text)}"]`);
  node.children.forEach((child) => serializeMermaidNode(child, depth + 1, lines, sequence));
}

export function serializePortableMap(
  project: PortableProjectDescriptor,
  root: MindMapNodeData
): string {
  if (!z.string().uuid().safeParse(project.projectId).success) throw new Error("Invalid project id");
  const projectName = displayText(project.name);
  const outline: string[] = [];
  serializeOutlineNode(root, 0, outline);
  const mermaid = ["mindmap"];
  serializeMermaidNode(root, 0, mermaid, { value: 0 });
  return [
    "---",
    "schemaVersion: 1",
    `projectId: ${project.projectId}`,
    `title: ${projectName}`,
    "---",
    "",
    `# ${projectName}`,
    "",
    "<!-- mindmap-ai:outline:start -->",
    ...outline,
    "<!-- mindmap-ai:outline:end -->",
    "",
    "## Mermaid",
    "",
    "```mermaid",
    ...mermaid,
    "```",
    ""
  ].join("\n");
}

function assertAnswerLink(visible: string, answerId: string | undefined): void {
  const linkMatch = visible.match(/\]\(([^)]+)\)$/);
  if (!answerId) {
    if (linkMatch) throw new Error("Unexpected answer link");
    return;
  }
  const expected = `../../answers/${answerId}.md`;
  if (!linkMatch || linkMatch[1] !== expected) throw new Error("Unsafe answer link");
}

export function parsePortableMap(markdown: string): MindMapNodeData {
  const startMarker = "<!-- mindmap-ai:outline:start -->";
  const endMarker = "<!-- mindmap-ai:outline:end -->";
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error("Portable outline is missing");
  const outline = markdown.slice(start + startMarker.length, end).trim();
  if (!outline) throw new Error("Portable outline is empty");

  let root: MindMapNodeData | undefined;
  const stack: MindMapNodeData[] = [];
  for (const line of outline.split(/\r?\n/)) {
    const match = line.match(/^( *)-\s+(.+?)\s+<!-- mindmap-ai:node (\{.*\}) -->$/);
    if (!match) throw new Error(`Invalid outline line: ${line}`);
    const indentation = match[1]?.length ?? 0;
    if (indentation % 2 !== 0) throw new Error("Invalid outline indentation");
    const depth = indentation / 2;
    const metadata = nodeMetadataSchema.parse(JSON.parse(match[3] ?? ""));
    assertAnswerLink(match[2] ?? "", metadata.answerId);
    let text: string;
    try {
      text = decodeURIComponent(metadata.text);
    } catch {
      throw new Error("Invalid encoded node title");
    }
    const node: MindMapNodeData = {
      uid: metadata.uid,
      text,
      ...(metadata.answerId ? { answerId: metadata.answerId } : {}),
      ...(metadata.conceptId ? { conceptId: metadata.conceptId, tags: metadata.tags ?? ["概念"] } : {}),
      ...(metadata.linkedProjectId ? { linkedProjectId: metadata.linkedProjectId } : {}),
      children: []
    };
    if (depth === 0) {
      if (root) throw new Error("Portable outline has multiple roots");
      root = node;
    } else {
      const parent = stack[depth - 1];
      if (!parent) throw new Error("Portable outline skips a hierarchy level");
      parent.children.push(node);
    }
    stack[depth] = node;
    stack.length = depth + 1;
  }
  if (!root) throw new Error("Portable outline has no root");
  return mindMapNodeSchema.parse(root);
}

export function serializeTrayIndex(kind: string, entries: CandidateNode[]): string {
  const lines = [`# ${displayText(kind)}`, ""];
  for (const entry of entries) {
    if (!localIdPattern.test(entry.answerId)) throw new Error("Invalid answer id");
    lines.push(`- [${escapeMarkdownLabel(entry.title)}](../../answers/${entry.answerId}.md)`);
    for (const child of entry.children ?? []) lines.push(`  - ${escapeMarkdownLabel(child.title)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function rewriteProjectLinksForExport(markdown: string): string {
  return markdown.replace(
    /\(\.\.\/\.\.\/answers\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.md\)/g,
    "(answers/$1.md)"
  );
}
