import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { workspaceManifestSchema } from "../shared/workspace.js";
import type {
  ActiveProjectManifest,
  ActiveProjectSnapshot,
  CandidateNode,
  WorkspaceManifest,
  WorkspaceOpenResult,
  WorkspaceProjectRecord
} from "../shared/types.js";
import { AnswerRepository } from "./answer-repository.js";
import { ProjectStore } from "./project-store.js";
import { WorkspaceStore } from "./workspace-store.js";

interface MigrationHooks {
  beforeInstall?(): Promise<void>;
}

function safeStagingPath(root: string, leaf: string): string {
  const stagingRoot = path.resolve(root, ".mindmap-ai-migration-staging");
  const target = path.resolve(stagingRoot, leaf);
  if (!target.startsWith(`${stagingRoot}${path.sep}`)) throw new Error("Migration path escapes staging directory");
  return target;
}

function upgradeCandidate(candidate: CandidateNode): CandidateNode {
  return {
    ...candidate,
    extractionMode: candidate.extractionMode ?? "single",
    children: candidate.children ?? []
  };
}

export async function migrateLegacyWorkspace(
  rootInput: string,
  hooks: MigrationHooks = {}
): Promise<WorkspaceOpenResult> {
  const root = path.resolve(rootInput);
  const workspacePath = path.join(root, "workspace.json");
  const workspaceRaw = await readFile(workspacePath, "utf8");
  const input = JSON.parse(workspaceRaw) as Record<string, unknown>;
  if (input.schemaVersion === 2) return new WorkspaceStore(root).load();
  if (input.schemaVersion !== 1) throw new Error("Cannot migrate unsupported legacy workspace schema");

  const backupDir = path.join(
    root,
    ".mindmap-ai-migration-backup",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`
  );
  await mkdir(backupDir, { recursive: true });
  await Promise.all([
    copyFile(path.join(root, "project.json"), path.join(backupDir, "project.json")),
    copyFile(path.join(root, "mindmap.json"), path.join(backupDir, "mindmap.json")),
    copyFile(workspacePath, path.join(backupDir, "workspace.json"))
  ]);

  const legacy = await new ProjectStore(root).load();
  if (legacy.readOnly) throw new Error("Cannot migrate a read-only legacy project safely");

  const now = new Date().toISOString();
  const record: WorkspaceProjectRecord = {
    projectId: legacy.manifest.projectId,
    parentProjectId: null,
    name: legacy.manifest.name,
    order: 0,
    createdAt: legacy.manifest.createdAt,
    updatedAt: now
  };
  const activeManifest: ActiveProjectManifest = {
    schemaVersion: 2,
    projectId: record.projectId,
    parentProjectId: null,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  const workspace: WorkspaceManifest = workspaceManifestSchema.parse({
    schemaVersion: 2,
    workspaceId: crypto.randomUUID(),
    name: legacy.manifest.name,
    activeProjectId: record.projectId,
    projects: [record],
    projectTrash: [],
    createdAt: legacy.manifest.createdAt,
    updatedAt: now
  });

  const stagingLeaf = crypto.randomUUID();
  const stagingProjectDir = safeStagingPath(root, stagingLeaf);
  const stagingRoot = path.dirname(stagingProjectDir);
  const answerRepository = new AnswerRepository(path.join(root, "answers"));
  const stagedStore = new ProjectStore(stagingProjectDir, answerRepository);
  const initialized = await stagedStore.initializePortable(activeManifest);
  const portableSnapshot: ActiveProjectSnapshot = {
    ...initialized,
    mindmap: legacy.mindmap,
    state: {
      schemaVersion: 2,
      dockLayout: legacy.workspace.dockLayout,
      candidates: legacy.workspace.candidates.map(upgradeCandidate),
      history: [],
      trash: [],
      uiPreferences: {
        theme: legacy.workspace.uiPreferences.theme,
        mindMapTheme: legacy.workspace.uiPreferences.mindMapTheme,
        autoHoverCapture: true,
        captureMode: "single",
        titleSource: "automatic"
      }
    },
    missingAnswerIds: legacy.missingAnswerIds
  };
  await stagedStore.savePortable(portableSnapshot);
  await stagedStore.loadPortable();

  try {
    await hooks.beforeInstall?.();
    const projectsRoot = path.resolve(root, "projects");
    const destination = path.resolve(projectsRoot, record.projectId);
    if (!destination.startsWith(`${projectsRoot}${path.sep}`)) throw new Error("Project path escapes workspace");
    await mkdir(projectsRoot, { recursive: true });
    await rename(stagingProjectDir, destination);
    await mkdir(path.join(root, ".trash", "projects"), { recursive: true });
    await writeFileAtomic(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    const resolvedStaging = path.resolve(stagingRoot);
    const expectedStaging = path.resolve(root, ".mindmap-ai-migration-staging");
    if (resolvedStaging === expectedStaging) await rm(resolvedStaging, { recursive: true, force: true });
  }

  return new WorkspaceStore(root).load();
}
