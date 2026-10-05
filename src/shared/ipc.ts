import { z } from "zod";
import { answerDocumentSchema } from "./project.js";
import { candidateNodeV2Schema } from "./workspace.js";

export const IPC = {
  workspaceCreate: "workspace:create",
  workspaceOpen: "workspace:open",
  workspaceGetSummary: "workspace:get-summary",
  workspaceRestoreLast: "workspace:restore-last",
  workspaceListRecent: "workspace:list-recent",
  workspaceSwitchRecent: "workspace:switch-recent",
  workspaceForgetRecent: "workspace:forget-recent",
  settingsGetPublic: "settings:get-public",
  settingsUpdatePublic: "settings:update-public",
  settingsTestConnection: "settings:test-connection",
  settingsSetApiKey: "settings:set-api-key",
  settingsClearApiKey: "settings:clear-api-key",
  workspaceProjectCreate: "workspace-project:create",
  workspaceProjectSwitch: "workspace-project:switch",
  workspaceProjectRename: "workspace-project:rename",
  workspaceProjectReparent: "workspace-project:reparent",
  workspaceProjectLinkNode: "workspace-project:link-node",
  workspaceProjectSave: "workspace-project:save",
  workspaceProjectOpenInExplorer: "workspace-project:open-in-explorer",
  workspaceProjectMoveToTrash: "workspace-project:move-to-trash",
  workspaceProjectRestore: "workspace-project:restore",
  workspaceProjectPermanentlyDelete: "workspace-project:permanently-delete",
  workspaceProjectExport: "workspace-project:export",
  projectCreate: "project:create",
  projectOpen: "project:open",
  projectSave: "project:save",
  projectReadAnswer: "project:read-answer",
  projectWriteAnswer: "project:write-answer",
  aiSetPanelBounds: "ai:set-panel-bounds",
  aiSetPanelVisible: "ai:set-panel-visible",
  aiCaptureLatest: "ai:capture-latest",
  aiPickAnswer: "ai:pick-answer",
  aiSetHoverCapture: "ai:set-hover-capture",
  aiSetExpansionPrompt: "ai:set-expansion-prompt",
  aiBeginLocalDrag: "ai:begin-local-drag",
  aiEndLocalDrag: "ai:end-local-drag",
  aiCapturedFromPage: "ai:captured-from-page",
  aiAnswerCaptured: "ai:answer-captured",
  aiAdapterErrorFromPage: "ai:adapter-error-from-page",
  aiAdapterError: "ai:adapter-error"
} as const;

const projectIdSchema = z.string().uuid();
const projectNameSchema = z.string().trim().min(1).max(120);

export const publicSettingsUpdateRequestSchema = z.object({
  update: z.object({
    baseUrl: z.string().trim().url().max(2048).optional(),
    model: z.string().trim().min(1).max(120).optional()
  }).strict(),
  confirmBaseUrlChange: z.boolean()
}).strict();

export const apiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(10_000)
}).strict();

export const connectionTestRequestSchema = z.object({
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(1).max(10_000).optional()
}).strict();

export const projectIdRequestSchema = z.object({
  projectId: projectIdSchema
}).strict();

export const recentWorkspaceIdRequestSchema = z.object({
  id: z.string().uuid()
}).strict();

export const projectCreateRequestSchema = z.object({
  name: projectNameSchema,
  parentProjectId: projectIdSchema.nullable()
}).strict();

export const projectRenameRequestSchema = z.object({
  projectId: projectIdSchema,
  name: projectNameSchema
}).strict();

export const projectReparentRequestSchema = z.object({
  projectId: projectIdSchema,
  parentProjectId: projectIdSchema.nullable()
}).strict();

export const projectLinkNodeRequestSchema = z.object({
  nodeUid: z.string().min(1).max(128),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("create"), name: projectNameSchema }).strict(),
    z.object({ kind: z.literal("existing"), projectId: projectIdSchema }).strict()
  ])
}).strict();

export const projectPermanentDeleteRequestSchema = z.object({
  projectId: projectIdSchema,
  cleanupOrphans: z.boolean()
}).strict();

export const capturedAnswerPayloadSchema = z.object({
  provider: z.literal("chatgpt"),
  sourceUrl: z.string().url().startsWith("https://chatgpt.com/"),
  sourceMessageId: z.string().min(1).max(256),
  markdown: z.string().trim().min(1).max(5_000_000)
});

export const captureAcknowledgementSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    answer: answerDocumentSchema,
    candidate: candidateNodeV2Schema,
    apiWarning: z.string().min(1).max(500).optional()
  }),
  z.object({ status: z.literal("duplicate"), answerId: z.string().min(1).max(128) }),
  z.object({ status: z.literal("failed"), message: z.string().min(1).max(500) })
]);
