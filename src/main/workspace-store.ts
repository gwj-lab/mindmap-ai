import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { workspaceManifestSchema } from "../shared/workspace.js";
import type {
  ActiveProjectManifest,
  ActiveProjectSnapshot,
  SaveResult,
  TrashedProjectRecord,
  WorkspaceManifest,
  WorkspaceOpenResult,
  WorkspaceProjectRecord
} from "../shared/types.js";
import { AnswerRepository } from "./answer-repository.js";
import { ProjectStore } from "./project-store.js";
import { scanWorkspaceAnswerReferences } from "./reference-scanner.js";
import { WorkspaceReconciler } from "./workspace-reconciler.js";

export class WorkspaceStore {
  readonly #root: string;
  readonly answers: AnswerRepository;
  #manifest: WorkspaceManifest | null = null;
  #activeProjectStore: ProjectStore | null = null;
  #workspaceWriteTail: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = path.resolve(root);
    this.answers = new AnswerRepository(path.join(this.#root, "answers"));
  }

  async initialize(workspaceName: string, projectName: string): Promise<WorkspaceOpenResult> {
    try {
      await access(path.join(this.#root, "workspace.json"));
      throw new Error("A Mindmap AI workspace already exists in this folder");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await Promise.all([
      mkdir(path.join(this.#root, "projects"), { recursive: true }),
      mkdir(path.join(this.#root, ".trash", "projects"), { recursive: true }),
      this.answers.initialize()
    ]);
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    const projectRecord: WorkspaceProjectRecord = {
      projectId,
      parentProjectId: null,
      name: projectName,
      order: 0,
      createdAt: now,
      updatedAt: now
    };
    this.#manifest = workspaceManifestSchema.parse({
      schemaVersion: 2,
      workspaceId: crypto.randomUUID(),
      name: workspaceName,
      activeProjectId: projectId,
      projects: [projectRecord],
      projectTrash: [],
      createdAt: now,
      updatedAt: now
    });
    this.#activeProjectStore = this.#storeFor(projectId);
    const project = await this.#activeProjectStore.initializePortable(this.#activeManifest(projectRecord));
    await this.#saveWorkspace();
    return { workspace: structuredClone(this.#manifest), project };
  }

  async load(): Promise<WorkspaceOpenResult> {
    const manifest = workspaceManifestSchema.parse(
      JSON.parse(await readFile(path.join(this.#root, "workspace.json"), "utf8"))
    );
    this.#manifest = manifest;
    await this.answers.initialize();
    const projectId = manifest.activeProjectId;
    if (!projectId) throw new Error("Workspace has no active project");
    const record = this.#requireProject(projectId);
    this.#activeProjectStore = this.#storeFor(record.projectId);
    const reconciliation = await new WorkspaceReconciler(this.#root, this.answers)
      .reconcile(manifest, this.#activeProjectStore);
    return { workspace: structuredClone(manifest), project: reconciliation.project };
  }

  async loadOrMigrate(): Promise<WorkspaceOpenResult> {
    const raw = JSON.parse(await readFile(path.join(this.#root, "workspace.json"), "utf8")) as {
      schemaVersion?: unknown;
    };
    if (raw.schemaVersion === 2) return this.load();
    const { migrateLegacyWorkspace } = await import("./workspace-migration.js");
    return migrateLegacyWorkspace(this.#root);
  }

  async createProject(name: string, parentProjectId: string | null): Promise<ActiveProjectSnapshot> {
    const manifest = this.#requireManifest();
    if (parentProjectId) this.#requireProject(parentProjectId);
    const now = new Date().toISOString();
    const siblings = manifest.projects.filter((project) => project.parentProjectId === parentProjectId);
    const record: WorkspaceProjectRecord = {
      projectId: crypto.randomUUID(),
      parentProjectId,
      name,
      order: siblings.length === 0 ? 0 : Math.max(...siblings.map((project) => project.order)) + 1,
      createdAt: now,
      updatedAt: now
    };
    const store = this.#storeFor(record.projectId);
    const project = await store.initializePortable(this.#activeManifest(record));
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      activeProjectId: record.projectId,
      projects: [...manifest.projects, record],
      updatedAt: now
    });
    this.#activeProjectStore = store;
    await this.#saveWorkspace();
    return project;
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    const manifest = this.#requireManifest();
    const current = this.#requireProject(projectId);
    const now = new Date().toISOString();
    const updatedRecord = { ...current, name, updatedAt: now };
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      projects: manifest.projects.map((project) => project.projectId === projectId ? updatedRecord : project),
      updatedAt: now
    });
    const store = projectId === manifest.activeProjectId && this.#activeProjectStore
      ? this.#activeProjectStore
      : this.#storeFor(projectId);
    const snapshot = await store.loadPortable();
    await store.savePortable({
      ...snapshot,
      manifest: { ...snapshot.manifest, name: updatedRecord.name, updatedAt: now }
    });
    await this.#saveWorkspace();
  }

  async switchProject(projectId: string): Promise<ActiveProjectSnapshot> {
    const manifest = this.#requireManifest();
    this.#requireProject(projectId);
    const now = new Date().toISOString();
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      activeProjectId: projectId,
      updatedAt: now
    });
    this.#activeProjectStore = this.#storeFor(projectId);
    const project = await this.#activeProjectStore.loadPortable();
    await this.#saveWorkspace();
    return project;
  }

  async saveActive(snapshot: ActiveProjectSnapshot): Promise<SaveResult> {
    const manifest = this.#requireManifest();
    if (manifest.activeProjectId !== snapshot.manifest.projectId) {
      throw new Error("Cannot save a project that is not active");
    }
    const store = this.#activeProjectStore ?? this.#storeFor(snapshot.manifest.projectId);
    const result = await store.savePortable(snapshot);
    const updatedRecord = this.#recordFromManifest(snapshot.manifest, this.#requireProject(snapshot.manifest.projectId).order);
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      projects: manifest.projects.map((project) => project.projectId === updatedRecord.projectId ? updatedRecord : project),
      updatedAt: snapshot.manifest.updatedAt
    });
    await this.#saveWorkspace();
    return result;
  }

  getSummary(): WorkspaceManifest {
    return structuredClone(this.#requireManifest());
  }

  getProjectDirectory(projectId: string): string {
    this.#requireProject(projectId);
    return this.#projectPath(projectId);
  }

  getWorkspaceDirectory(): string {
    return this.#root;
  }

  getActiveProjectStore(): ProjectStore {
    if (!this.#activeProjectStore) throw new Error("Workspace has no active project store");
    return this.#activeProjectStore;
  }

  async getOpenResult(): Promise<WorkspaceOpenResult> {
    const workspace = this.getSummary();
    const project = await this.getActiveProjectStore().loadPortable();
    return { workspace, project };
  }

  async moveProjectToTrash(projectId: string): Promise<void> {
    const manifest = this.#requireManifest();
    const project = this.#requireProject(projectId);
    if (manifest.projects.length === 1) throw new Error("Cannot move the last project to trash");
    if (manifest.projects.some((item) => item.parentProjectId === projectId)) {
      throw new Error("Move or delete child projects before trashing this project");
    }
    const now = new Date().toISOString();
    const trashRecord: TrashedProjectRecord = {
      ...project,
      previousParentProjectId: project.parentProjectId,
      previousOrder: project.order,
      deletedAt: now
    };
    await rename(this.#projectPath(projectId), this.#trashProjectPath(projectId));
    const projects = manifest.projects.filter((item) => item.projectId !== projectId);
    const activeProjectId = manifest.activeProjectId === projectId
      ? projects.slice().sort((left, right) => left.order - right.order)[0]?.projectId ?? null
      : manifest.activeProjectId;
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      activeProjectId,
      projects,
      projectTrash: [...manifest.projectTrash, trashRecord],
      updatedAt: now
    });
    if (activeProjectId && manifest.activeProjectId === projectId) {
      this.#activeProjectStore = this.#storeFor(activeProjectId);
      await this.#activeProjectStore.loadPortable();
    }
    await this.#saveWorkspace();
  }

  async restoreProject(projectId: string): Promise<void> {
    const manifest = this.#requireManifest();
    const trashed = manifest.projectTrash.find((item) => item.projectId === projectId);
    if (!trashed) throw new Error("Project is not in trash");
    const parentProjectId = trashed.previousParentProjectId
      && manifest.projects.some((project) => project.projectId === trashed.previousParentProjectId)
      ? trashed.previousParentProjectId
      : null;
    const restored: WorkspaceProjectRecord = {
      projectId: trashed.projectId,
      parentProjectId,
      name: trashed.name,
      order: trashed.previousOrder,
      createdAt: trashed.createdAt,
      updatedAt: new Date().toISOString()
    };
    await rename(this.#trashProjectPath(projectId), this.#projectPath(projectId));
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      projects: [...manifest.projects, restored],
      projectTrash: manifest.projectTrash.filter((item) => item.projectId !== projectId),
      updatedAt: restored.updatedAt
    });
    await this.#saveWorkspace();
  }

  async permanentlyDeleteProject(projectId: string, cleanupOrphans: boolean): Promise<void> {
    const manifest = this.#requireManifest();
    if (!manifest.projectTrash.some((project) => project.projectId === projectId)) {
      throw new Error("Only trashed projects can be permanently deleted");
    }
    const target = this.#trashProjectPath(projectId);
    const trashRoot = path.resolve(this.#root, ".trash", "projects");
    if (!target.startsWith(`${trashRoot}${path.sep}`) || target === trashRoot) {
      throw new Error("Refusing unsafe project deletion");
    }
    await rm(target, { recursive: true, force: false });
    this.#manifest = workspaceManifestSchema.parse({
      ...manifest,
      projectTrash: manifest.projectTrash.filter((project) => project.projectId !== projectId),
      updatedAt: new Date().toISOString()
    });
    await this.#saveWorkspace();
    if (cleanupOrphans) {
      const references = await scanWorkspaceAnswerReferences(this.#root, this.#manifest);
      for (const answer of await this.answers.list()) {
        if (!references.has(answer.id)) await this.answers.delete(answer.id);
      }
    }
  }

  #activeManifest(record: WorkspaceProjectRecord): ActiveProjectManifest {
    return {
      schemaVersion: 2,
      projectId: record.projectId,
      parentProjectId: record.parentProjectId,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  #recordFromManifest(manifest: ActiveProjectManifest, order: number): WorkspaceProjectRecord {
    return {
      projectId: manifest.projectId,
      parentProjectId: manifest.parentProjectId,
      name: manifest.name,
      order,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt
    };
  }

  #requireManifest(): WorkspaceManifest {
    if (!this.#manifest) throw new Error("Workspace is not open");
    return this.#manifest;
  }

  #requireProject(projectId: string): WorkspaceProjectRecord {
    const project = this.#requireManifest().projects.find((item) => item.projectId === projectId);
    if (!project) throw new Error("Project does not exist in this workspace");
    return project;
  }

  #storeFor(projectId: string): ProjectStore {
    return new ProjectStore(this.#projectPath(projectId), this.answers);
  }

  #projectPath(projectId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      throw new Error("Invalid project id");
    }
    const projectsRoot = path.resolve(this.#root, "projects");
    const projectPath = path.resolve(projectsRoot, projectId);
    if (!projectPath.startsWith(`${projectsRoot}${path.sep}`)) throw new Error("Project path escapes workspace");
    return projectPath;
  }

  #trashProjectPath(projectId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      throw new Error("Invalid project id");
    }
    const trashRoot = path.resolve(this.#root, ".trash", "projects");
    const projectPath = path.resolve(trashRoot, projectId);
    if (!projectPath.startsWith(`${trashRoot}${path.sep}`)) throw new Error("Trash path escapes workspace");
    return projectPath;
  }

  async #saveWorkspace(): Promise<void> {
    const manifest = workspaceManifestSchema.parse(this.#requireManifest());
    const operation = async (): Promise<void> => {
      await writeFileAtomic(
        path.join(this.#root, "workspace.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: "utf8" }
      );
    };
    const result = this.#workspaceWriteTail.then(operation, operation);
    this.#workspaceWriteTail = result.then(() => undefined, () => undefined);
    await result;
  }
}
