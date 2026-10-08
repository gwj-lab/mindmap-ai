import path from "node:path";
import { z } from "zod";
import type { AnswerDocument, AnswerMetadata, CandidateNode, MindMapNodeData, ProjectManifest } from "./types.js";

const isoDateSchema = z.string().datetime();

export const projectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const answerMetadataSchema = z.object({
  conceptId: z.string().uuid().optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  provider: z.enum(["chatgpt", "yuanbao", "doubao"]),
  title: z.string().trim().min(1).max(160),
  sourceUrl: z.string().url().startsWith("https://"),
  sourceMessageId: z.string().min(1).max(256),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: isoDateSchema,
  updatedAt: isoDateSchema
}) satisfies z.ZodType<AnswerMetadata>;

export const answerDocumentSchema = z.object({
  metadata: answerMetadataSchema,
  body: z.string().max(5_000_000)
}) satisfies z.ZodType<AnswerDocument>;

const recursiveMindMapNodeSchema: z.ZodType<MindMapNodeData> = z.lazy(() => z.object({
  uid: z.string().min(1).max(128),
  text: z.string().max(500),
  answerId: z.string().max(128).optional(),
  linkedProjectId: z.string().uuid().optional(),
  children: z.array(recursiveMindMapNodeSchema)
}).passthrough()) as z.ZodType<MindMapNodeData>;

export const mindMapNodeSchema = recursiveMindMapNodeSchema.superRefine((root, context) => {
  const seen = new Set<string>();
  const visit = (node: MindMapNodeData): void => {
    if (seen.has(node.uid)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate node uid: ${node.uid}`
      });
      return;
    }
    seen.add(node.uid);
    node.children.forEach(visit);
  };
  visit(root);
});

export const candidateNodeSchema = z.object({
  id: z.string().min(1).max(128),
  answerId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(160),
  createdAt: isoDateSchema
});

export const workspaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  dockLayout: z.unknown(),
  candidates: z.array(candidateNodeSchema),
  uiPreferences: z.object({
    theme: z.enum(["light", "dark", "system"]),
    mindMapTheme: z.enum(["paper", "night", "ink"]).optional()
  })
});

export function createDefaultProject(name: string, now = new Date()): ProjectManifest {
  const timestamp = now.toISOString();
  return projectManifestSchema.parse({
    schemaVersion: 1,
    projectId: crypto.randomUUID(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function resolveAnswerPath(projectDir: string, answerId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(answerId)) {
    throw new Error("Invalid answer id");
  }
  const answersDir = path.win32.resolve(projectDir, "answers");
  const resolved = path.win32.resolve(answersDir, `${answerId}.md`);
  if (!resolved.startsWith(`${answersDir}${path.win32.sep}`)) {
    throw new Error("Answer path escapes project");
  }
  return resolved;
}

interface RepairCandidatesInput {
  candidates: CandidateNode[];
  linkedAnswerIds: ReadonlySet<string>;
  answers: Array<{ id: string; title: string; capturedAt: string }>;
}

export function repairCandidates(input: RepairCandidatesInput): CandidateNode[] {
  const existing = new Map(
    input.candidates
      .filter((candidate) => !input.linkedAnswerIds.has(candidate.answerId))
      .map((candidate) => [candidate.answerId, candidate])
  );
  for (const answer of input.answers) {
    if (!input.linkedAnswerIds.has(answer.id) && !existing.has(answer.id)) {
      existing.set(answer.id, {
        id: `candidate-${answer.id}`,
        answerId: answer.id,
        title: answer.title,
        createdAt: answer.capturedAt
      });
    }
  }
  return [...existing.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
