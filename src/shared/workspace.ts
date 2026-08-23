import { z } from "zod";
import { mindMapNodeSchema } from "./project.js";
import type {
  ActiveProjectManifest,
  CandidateNode,
  HistoryEntry,
  ProjectState,
  ProjectTrashEntry,
  TrashedProjectRecord,
  WorkspaceManifest,
  WorkspaceProjectRecord
} from "./types.js";

const isoDateSchema = z.string().datetime();
const uuidSchema = z.string().uuid();
const recordNameSchema = z.string().trim().min(1).max(120);
const localIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

export const workspaceProjectRecordSchema = z.object({
  projectId: uuidSchema,
  parentProjectId: uuidSchema.nullable(),
  name: recordNameSchema,
  order: z.number().int().min(0),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
}) satisfies z.ZodType<WorkspaceProjectRecord>;

export const activeProjectManifestSchema = z.object({
  schemaVersion: z.literal(2),
  projectId: uuidSchema,
  parentProjectId: uuidSchema.nullable(),
  name: recordNameSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
}) satisfies z.ZodType<ActiveProjectManifest>;

export const trashedProjectRecordSchema = workspaceProjectRecordSchema.extend({
  previousParentProjectId: uuidSchema.nullable(),
  previousOrder: z.number().int().min(0),
  deletedAt: isoDateSchema
}) satisfies z.ZodType<TrashedProjectRecord>;

export const workspaceManifestSchema: z.ZodType<WorkspaceManifest> = z.object({
  schemaVersion: z.literal(2),
  workspaceId: uuidSchema,
  name: recordNameSchema,
  activeProjectId: uuidSchema.nullable(),
  projects: z.array(workspaceProjectRecordSchema),
  projectTrash: z.array(trashedProjectRecordSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
}).superRefine((workspace, context) => {
  const projectsById = new Map<string, WorkspaceProjectRecord>();
  for (const project of workspace.projects) {
    if (projectsById.has(project.projectId)) {
      context.addIssue({ code: "custom", message: `Duplicate project id: ${project.projectId}` });
    }
    projectsById.set(project.projectId, project);
  }
  if (workspace.activeProjectId && !projectsById.has(workspace.activeProjectId)) {
    context.addIssue({ code: "custom", message: "Active project is missing" });
  }
  for (const project of workspace.projects) {
    if (project.parentProjectId && !projectsById.has(project.parentProjectId)) {
      context.addIssue({ code: "custom", message: `Missing parent for project: ${project.projectId}` });
      continue;
    }
    const ancestry = new Set([project.projectId]);
    let parentId = project.parentProjectId;
    while (parentId) {
      if (ancestry.has(parentId)) {
        context.addIssue({ code: "custom", message: `Circular project ancestry: ${project.projectId}` });
        break;
      }
      ancestry.add(parentId);
      parentId = projectsById.get(parentId)?.parentProjectId ?? null;
    }
  }
});

export const candidateChildSchema = z.object({
  id: localIdSchema,
  title: z.string().trim().min(1).max(160)
});

export const candidateNodeV2Schema: z.ZodType<CandidateNode> = z.object({
  id: localIdSchema,
  answerId: localIdSchema,
  title: z.string().trim().min(1).max(160),
  extractionMode: z.enum(["single", "expanded"]),
  children: z.array(candidateChildSchema).max(12),
  createdAt: isoDateSchema
});

export const historyEntrySchema: z.ZodType<HistoryEntry> = z.object({
  id: localIdSchema,
  subtree: mindMapNodeSchema,
  originalParentUid: localIdSchema,
  originalIndex: z.number().int().min(0),
  movedAt: isoDateSchema
});

const projectTrashEntrySchema: z.ZodType<ProjectTrashEntry> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("candidate"),
    id: localIdSchema,
    deletedAt: isoDateSchema,
    candidate: candidateNodeV2Schema
  }),
  z.object({
    kind: z.literal("history"),
    id: localIdSchema,
    deletedAt: isoDateSchema,
    history: historyEntrySchema
  }),
  z.object({
    kind: z.literal("subtree"),
    id: localIdSchema,
    deletedAt: isoDateSchema,
    subtree: mindMapNodeSchema,
    originalParentUid: localIdSchema,
    originalIndex: z.number().int().min(0)
  })
]);

export const projectStateSchema: z.ZodType<ProjectState> = z.object({
  schemaVersion: z.literal(2),
  dockLayout: z.unknown(),
  candidates: z.array(candidateNodeV2Schema),
  history: z.array(historyEntrySchema),
  trash: z.array(projectTrashEntrySchema),
  uiPreferences: z.object({
    theme: z.enum(["light", "dark", "system"]),
    mindMapTheme: z.enum(["paper", "night", "ink"]).optional(),
    autoHoverCapture: z.boolean(),
    captureMode: z.enum(["single", "expanded"]),
    titleSource: z.enum(["local", "api", "automatic"])
  })
});
