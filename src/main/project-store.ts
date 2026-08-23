import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { createDefaultProject, mindMapNodeSchema, projectManifestSchema, repairCandidates, workspaceStateSchema } from "../shared/project.js";
import { DEFAULT_DOCK_LAYOUT } from "../shared/layout.js";
import { parsePortableMap, serializePortableMap, serializeTrayIndex } from "../shared/portable-map.js";
import { activeProjectManifestSchema, projectStateSchema } from "../shared/workspace.js";
import type {
  ActiveProjectManifest,
  ActiveProjectSnapshot,
  AnswerDocument,
  CandidateNode,
  MindMapNodeData,
  ProjectState,
  ProjectSnapshot,
  SaveResult,
  WorkspaceState
} from "../shared/types.js";
import { AnswerRepository } from "./answer-repository.js";

function defaultMindmap(): MindMapNodeData {
  return { uid: crypto.randomUUID(), text: "中心主题", children: [] };
}

function defaultProjectState(): ProjectState {
  return {
    schemaVersion: 2,
    dockLayout: structuredClone(DEFAULT_DOCK_LAYOUT),
    candidates: [],
    history: [],
    trash: [],
    uiPreferences: {
      theme: "system",
      mindMapTheme: "paper",
      autoHoverCapture: true,
      captureMode: "single",
      titleSource: "automatic"
    }
  };
}

function defaultWorkspace(): WorkspaceState {
  return {
    schemaVersion: 1,
    dockLayout: structuredClone(DEFAULT_DOCK_LAYOUT),
    candidates: [],
    uiPreferences: { theme: "system", mindMapTheme: "paper" }
  };
}

function collectLinkedAnswerIds(node: MindMapNodeData, result = new Set<string>()): Set<string> {
  if (node.answerId) result.add(node.answerId);
  for (const child of node.children) collectLinkedAnswerIds(child, result);
  return result;
}

function collectPortableAnswerIds(state: ProjectState, mindmap: MindMapNodeData): Set<string> {
  const result = collectLinkedAnswerIds(mindmap);
  for (const candidate of state.candidates) result.add(candidate.answerId);
  for (const entry of state.history) collectLinkedAnswerIds(entry.subtree, result);
  for (const entry of state.trash) {
    if (entry.kind === "candidate") result.add(entry.candidate.answerId);
    else if (entry.kind === "history") collectLinkedAnswerIds(entry.history.subtree, result);
    else collectLinkedAnswerIds(entry.subtree, result);
  }
  return result;
}

function serializeHistoryIndex(state: ProjectState): string {
  if (state.history.length === 0) return "# History\n";
  const lines = ["# History", ""];
  for (const entry of state.history) lines.push(`- ${entry.subtree.text}`);
  return `${lines.join("\n")}\n`;
}

function serializeTrashIndex(state: ProjectState): string {
  if (state.trash.length === 0) return "# Trash\n";
  const lines = ["# Trash", ""];
  for (const entry of state.trash) {
    const title = entry.kind === "candidate"
      ? entry.candidate.title
      : entry.kind === "history"
        ? entry.history.subtree.text
        : entry.subtree.text;
    lines.push(`- ${title}`);
  }
  return `${lines.join("\n")}\n`;
}

export class ProjectStore {
  readonly #root: string;
  readonly #answers: AnswerRepository;
  #writeTail: Promise<void> = Promise.resolve();
  #readOnly = false;

  constructor(root: string, answers?: AnswerRepository) {
    this.#root = path.resolve(root);
    this.#answers = answers ?? new AnswerRepository(path.join(this.#root, "answers"));
  }

  async initialize(name: string): Promise<ProjectSnapshot> {
    try {
      await access(path.join(this.#root, "project.json"));
      throw new Error("A Mindmap AI project already exists in this folder");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.#answers.initialize();
    this.#readOnly = false;
    const snapshot: ProjectSnapshot = {
      manifest: createDefaultProject(name),
      mindmap: defaultMindmap(),
      workspace: defaultWorkspace(),
      missingAnswerIds: []
    };
    await this.save(snapshot);
    return snapshot;
  }

  async load(): Promise<ProjectSnapshot> {
    const [manifestRaw, mindmapRaw, workspaceRaw] = await Promise.all([
      readFile(path.join(this.#root, "project.json"), "utf8"),
      readFile(path.join(this.#root, "mindmap.json"), "utf8"),
      readFile(path.join(this.#root, "workspace.json"), "utf8")
    ]);
    const manifestInput = JSON.parse(manifestRaw) as Record<string, unknown>;
    const mindmapInput = JSON.parse(mindmapRaw) as unknown;
    const workspaceInput = JSON.parse(workspaceRaw) as Record<string, unknown>;
    const unsupportedSchema = manifestInput.schemaVersion !== 1 || workspaceInput.schemaVersion !== 1;
    this.#readOnly = unsupportedSchema;
    if (unsupportedSchema) {
      await this.#writeRecoveryBundle({ manifestRaw, mindmapRaw, workspaceRaw }, {
        manifest: manifestInput.schemaVersion,
        workspace: workspaceInput.schemaVersion
      });
    }
    const manifest = projectManifestSchema.parse({ ...manifestInput, schemaVersion: 1 });
    const mindmap = mindMapNodeSchema.parse(mindmapInput);
    const workspace = workspaceStateSchema.parse({ ...workspaceInput, schemaVersion: 1 });
    const answers = await this.listAnswers();
    const answerIds = new Set(answers.map((answer) => answer.id));
    const linkedAnswerIds = collectLinkedAnswerIds(mindmap);
    const candidates = repairCandidates({ candidates: workspace.candidates, linkedAnswerIds, answers });
    const missingAnswerIds = [...linkedAnswerIds].filter((id) => !answerIds.has(id)).sort();
    return {
      manifest,
      mindmap,
      workspace: { ...workspace, candidates },
      missingAnswerIds,
      ...(unsupportedSchema ? { readOnly: true } : {})
    };
  }

  async save(snapshot: ProjectSnapshot): Promise<SaveResult> {
    if (this.#readOnly || snapshot.readOnly) throw new Error("This project uses an unsupported schema and is read-only");
    const manifest = projectManifestSchema.parse(snapshot.manifest);
    const mindmap = mindMapNodeSchema.parse(snapshot.mindmap);
    const workspace = workspaceStateSchema.parse(snapshot.workspace);
    return this.#enqueueWrite(async () => {
      await Promise.all([
        this.#writeJson("project.json", manifest),
        this.#writeJson("mindmap.json", mindmap),
        this.#writeJson("workspace.json", workspace)
      ]);
      return { savedAt: new Date().toISOString() };
    });
  }

  async writeAnswer(answer: AnswerDocument): Promise<SaveResult> {
    if (this.#readOnly) throw new Error("This project uses an unsupported schema and is read-only");
    return this.#answers.write(answer);
  }

  async readAnswer(answerId: string): Promise<AnswerDocument | null> {
    return this.#answers.read(answerId);
  }

  async listAnswers(): Promise<Array<{ id: string; title: string; capturedAt: string }>> {
    return this.#answers.list();
  }

  async listAnswerDocuments(): Promise<AnswerDocument[]> {
    return this.#answers.listDocuments();
  }

  async initializePortable(manifestInput: ActiveProjectManifest): Promise<ActiveProjectSnapshot> {
    try {
      await access(path.join(this.#root, "project.json"));
      throw new Error("A Mindmap AI project already exists in this folder");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const manifest = activeProjectManifestSchema.parse(manifestInput);
    this.#readOnly = false;
    const snapshot: ActiveProjectSnapshot = {
      manifest,
      mindmap: defaultMindmap(),
      state: defaultProjectState(),
      missingAnswerIds: []
    };
    await this.savePortable(snapshot);
    return snapshot;
  }

  async loadPortable(): Promise<ActiveProjectSnapshot> {
    const stored = JSON.parse(await readFile(path.join(this.#root, "project.json"), "utf8")) as {
      manifest?: unknown;
      state?: unknown;
    };
    const manifest = activeProjectManifestSchema.parse(stored.manifest);
    const state = projectStateSchema.parse(stored.state);
    let mindmap: MindMapNodeData;
    let readOnly = false;
    let recoveredFromMarkdown = false;
    try {
      mindmap = mindMapNodeSchema.parse(JSON.parse(await readFile(path.join(this.#root, "mindmap.json"), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        mindmap = parsePortableMap(await readFile(path.join(this.#root, "map.md"), "utf8"));
        recoveredFromMarkdown = true;
      } catch (recoveryError) {
        readOnly = true;
        this.#readOnly = true;
        mindmap = defaultMindmap();
        await this.#writePortableRecoveryReport(recoveryError);
      }
    }
    const answers = await this.#answers.list();
    const answerIds = new Set(answers.map((answer) => answer.id));
    const linkedAnswerIds = collectPortableAnswerIds(state, mindmap);
    const result: ActiveProjectSnapshot = {
      manifest,
      mindmap,
      state,
      missingAnswerIds: [...linkedAnswerIds].filter((id) => !answerIds.has(id)).sort(),
      ...(readOnly ? { readOnly: true } : {})
    };
    if (recoveredFromMarkdown && !readOnly) await this.#writeJson("mindmap.json", mindmap);
    return result;
  }

  async savePortable(snapshot: ActiveProjectSnapshot): Promise<SaveResult> {
    if (this.#readOnly || snapshot.readOnly) throw new Error("This project is read-only");
    const manifest = activeProjectManifestSchema.parse(snapshot.manifest);
    const mindmap = mindMapNodeSchema.parse(snapshot.mindmap);
    const state = projectStateSchema.parse(snapshot.state);
    return this.#enqueueWrite(async () => {
      await mkdir(this.#root, { recursive: true });
      await Promise.all([
        this.#writeJson("project.json", { manifest, state }),
        this.#writeJson("mindmap.json", mindmap),
        writeFileAtomic(path.join(this.#root, "map.md"), serializePortableMap(manifest, mindmap), { encoding: "utf8" }),
        writeFileAtomic(path.join(this.#root, "inbox.md"), serializeTrayIndex("Candidates", state.candidates), { encoding: "utf8" }),
        writeFileAtomic(path.join(this.#root, "history.md"), serializeHistoryIndex(state), { encoding: "utf8" }),
        writeFileAtomic(path.join(this.#root, "trash.md"), serializeTrashIndex(state), { encoding: "utf8" })
      ]);
      return { savedAt: new Date().toISOString() };
    });
  }

  async appendPortableCandidate(candidate: CandidateNode): Promise<ActiveProjectSnapshot> {
    const snapshot = await this.loadPortable();
    const next: ActiveProjectSnapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        candidates: [
          ...snapshot.state.candidates.filter((item) => item.answerId !== candidate.answerId),
          candidate
        ]
      }
    };
    await this.savePortable(next);
    return next;
  }

  async #writeJson(fileName: string, value: unknown): Promise<void> {
    await writeFileAtomic(path.join(this.#root, fileName), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
  }

  async #writePortableRecoveryReport(error: unknown): Promise<void> {
    const recoveryDir = path.join(this.#root, ".mindmap-ai-recovery");
    await mkdir(recoveryDir, { recursive: true });
    await writeFileAtomic(
      path.join(recoveryDir, "error-report.txt"),
      `Mindmap AI could not recover mindmap.json from map.md.\n${error instanceof Error ? error.message : String(error)}\n`,
      { encoding: "utf8" }
    );
  }

  async #writeRecoveryBundle(
    files: { manifestRaw: string; mindmapRaw: string; workspaceRaw: string },
    versions: { manifest: unknown; workspace: unknown }
  ): Promise<void> {
    const recoveryDir = path.join(
      this.#root,
      ".mindmap-ai-recovery",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`
    );
    await this.#enqueueWrite(async () => {
      await mkdir(recoveryDir, { recursive: true });
      await Promise.all([
        writeFileAtomic(path.join(recoveryDir, "project.json"), files.manifestRaw, { encoding: "utf8" }),
        writeFileAtomic(path.join(recoveryDir, "mindmap.json"), files.mindmapRaw, { encoding: "utf8" }),
        writeFileAtomic(path.join(recoveryDir, "workspace.json"), files.workspaceRaw, { encoding: "utf8" }),
        writeFileAtomic(
          path.join(recoveryDir, "error-report.txt"),
          `Mindmap AI could not safely migrate this project.\nManifest schema: ${String(versions.manifest)}\nWorkspace schema: ${String(versions.workspace)}\nThe project was opened read-only.\n`,
          { encoding: "utf8" }
        )
      ]);
    });
  }

  #enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation);
    this.#writeTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
