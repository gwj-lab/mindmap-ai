export type ProviderId = "chatgpt" | "yuanbao" | "doubao";

export interface AiTab {
  id: string;
  provider: ProviderId;
}

export interface AnswerMetadata {
  conceptId?: string;
  tags?: string[];
  id: string;
  provider: ProviderId;
  title: string;
  sourceUrl: string;
  sourceMessageId: string;
  contentHash: string;
  capturedAt: string;
  updatedAt: string;
}

export interface AnswerDocument {
  metadata: AnswerMetadata;
  body: string;
}

export interface CandidateNode {
  conceptId?: string;
  id: string;
  answerId: string;
  title: string;
  createdAt: string;
  extractionMode?: "single" | "expanded";
  children?: CandidateChild[];
}

export interface CandidateChild {
  id: string;
  title: string;
}

export interface MindMapNodeData {
  uid: string;
  text: string;
  answerId?: string;
  linkedProjectId?: string;
  children: MindMapNodeData[];
  [key: string]: unknown;
}

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProjectRecord {
  projectId: string;
  parentProjectId: string | null;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type NodeProjectTarget = { kind: "create"; name: string } | { kind: "existing"; projectId: string };

export interface TrashedProjectRecord extends WorkspaceProjectRecord {
  previousParentProjectId: string | null;
  previousOrder: number;
  deletedAt: string;
}

export interface WorkspaceManifest {
  schemaVersion: 2;
  workspaceId: string;
  name: string;
  activeProjectId: string | null;
  projects: WorkspaceProjectRecord[];
  projectTrash: TrashedProjectRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface UiPreferences {
  theme: "light" | "dark" | "system";
  mindMapTheme?: "paper" | "night" | "ink";
  autoHoverCapture: boolean;
  captureMode: "single" | "expanded";
  titleSource: "local" | "api" | "automatic";
}

export interface HistoryEntry {
  id: string;
  subtree: MindMapNodeData;
  originalParentUid: string;
  originalIndex: number;
  movedAt: string;
}

export interface CandidateTrashEntry {
  kind: "candidate";
  id: string;
  deletedAt: string;
  candidate: CandidateNode;
}

export interface HistoryTrashEntry {
  kind: "history";
  id: string;
  deletedAt: string;
  history: HistoryEntry;
}

export interface SubtreeTrashEntry {
  kind: "subtree";
  id: string;
  deletedAt: string;
  subtree: MindMapNodeData;
  originalParentUid: string;
  originalIndex: number;
}

export type ProjectTrashEntry = CandidateTrashEntry | HistoryTrashEntry | SubtreeTrashEntry;

export interface ProjectState {
  schemaVersion: 2;
  dockLayout: unknown;
  candidates: CandidateNode[];
  history: HistoryEntry[];
  trash: ProjectTrashEntry[];
  uiPreferences: UiPreferences;
}

export interface ActiveProjectManifest {
  schemaVersion: 2;
  projectId: string;
  parentProjectId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProjectSnapshot {
  manifest: ActiveProjectManifest;
  mindmap: MindMapNodeData;
  state: ProjectState;
  missingAnswerIds: string[];
  readOnly?: boolean;
}

export interface WorkspaceOpenResult {
  workspace: WorkspaceManifest;
  project: ActiveProjectSnapshot;
}

export interface RecentWorkspaceEntry {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface WorkspaceRestoreResult {
  result: WorkspaceOpenResult | null;
  warning?: string;
}

export interface WorkspaceState {
  schemaVersion: 1;
  dockLayout: unknown;
  candidates: CandidateNode[];
  uiPreferences: {
    theme: "light" | "dark" | "system";
    mindMapTheme?: "paper" | "night" | "ink";
  };
}

export interface ProjectSnapshot {
  manifest: ProjectManifest;
  mindmap: MindMapNodeData;
  workspace: WorkspaceState;
  missingAnswerIds: string[];
  readOnly?: boolean;
}

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedAnswerPayload {
  provider: ProviderId;
  sourceUrl: string;
  sourceMessageId: string;
  markdown: string;
}

export type CaptureAcknowledgement =
  | { status: "captured"; answer: AnswerDocument; candidate: CandidateNode; apiWarning?: string }
  | { status: "duplicate"; answerId: string }
  | { status: "failed"; message: string };

export interface SaveResult {
  savedAt: string;
}

export interface PublicAiSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface PublicAiSettingsUpdate {
  baseUrl?: string;
  model?: string;
}

export interface AiConnectionTestInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface DesktopApi {
  concepts: {
    get(): Promise<import("./concepts.js").ConceptLibrary>;
    settings(settings: import("./concepts.js").ConceptSettings): Promise<import("./concepts.js").ConceptLibrary>;
    prepare(request: import("./concepts.js").ConceptRequest): Promise<import("./concepts.js").ConceptJob>;
    retry(id: string): Promise<import("./concepts.js").ConceptJob>;
    run(id: string): Promise<void>;
    update(id: string, action: "trash" | "restore" | "delete" | "rename", title?: string): Promise<import("./concepts.js").ConceptLibrary>;
    onRequest(listener: (request: import("./concepts.js").ConceptRequest) => void): () => void;
    onChanged(listener: (workspaceId: string) => void): () => void;
    onOpen(listener: (answerId: string) => void): () => void;
  };
  settings: {
    getPublicSettings(): Promise<PublicAiSettings>;
    updatePublicSettings(update: PublicAiSettingsUpdate, confirmBaseUrlChange: boolean): Promise<PublicAiSettings>;
    testConnection(input: AiConnectionTestInput): Promise<AiConnectionTestResult>;
    setApiKey(apiKey: string): Promise<void>;
    clearApiKey(): Promise<void>;
  };
  workspace: {
    create(): Promise<WorkspaceOpenResult | null>;
    open(): Promise<WorkspaceOpenResult | null>;
    getSummary(): Promise<WorkspaceManifest | null>;
    restoreLast(): Promise<WorkspaceRestoreResult>;
    listRecent(): Promise<RecentWorkspaceEntry[]>;
    switchRecent(id: string): Promise<WorkspaceOpenResult>;
    forgetRecent(id: string): Promise<RecentWorkspaceEntry[]>;
  };
  project: {
    create(): Promise<ProjectSnapshot | null>;
    open(): Promise<ProjectSnapshot | null>;
    save(snapshot: ProjectSnapshot): Promise<SaveResult>;
    readAnswer(answerId: string): Promise<AnswerDocument | null>;
    writeAnswer(answer: AnswerDocument): Promise<SaveResult>;
    createNested(name: string, parentProjectId: string | null): Promise<ActiveProjectSnapshot>;
    reparent(projectId: string, parentProjectId: string | null): Promise<WorkspaceOpenResult>;
    linkNode(nodeUid: string, target: NodeProjectTarget): Promise<WorkspaceOpenResult>;
    switch(projectId: string): Promise<ActiveProjectSnapshot>;
    rename(projectId: string, name: string): Promise<WorkspaceManifest>;
    saveActive(snapshot: ActiveProjectSnapshot): Promise<SaveResult>;
    openInExplorer(projectId: string): Promise<void>;
    moveToTrash(projectId: string): Promise<WorkspaceOpenResult>;
    restore(projectId: string): Promise<WorkspaceManifest>;
    permanentlyDelete(projectId: string, cleanupOrphans: boolean): Promise<WorkspaceManifest>;
    export(projectId: string): Promise<boolean>;
  };
  ai: {
    syncTabs(tabs: AiTab[]): void;
    setPanelBounds(bounds: PanelBounds, tabId?: string): void;
    setPanelVisible(visible: boolean, tabId?: string): void;
    captureLatest(tabId?: string): void;
    pickAnswer(tabId?: string): void;
    setHoverCapture(enabled: boolean, tabId?: string): void;
    setExpansionPrompt(prompt: string, tabId?: string): void;
    beginLocalDrag(): void;
    endLocalDrag(): void;
    onAnswerCaptured(listener: (acknowledgement: Extract<CaptureAcknowledgement, { status: "captured" }>) => void): () => void;
    onAdapterError(listener: (message: string) => void): () => void;
  };
}
