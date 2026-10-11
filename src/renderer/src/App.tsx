import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Actions, DockLocation, Layout, type Model, type TabNode } from "flexlayout-react";
import { AlertCircle, CheckCircle2, Library, PanelsTopLeft, X } from "lucide-react";
import { DEFAULT_DOCK_LAYOUT } from "../../shared/layout.js";
import { AI_PROVIDERS, isProviderId } from "../../shared/ai-providers.js";
import { collectAiTabs, createLayoutModel, getAiTabProvider, isAiTabSet } from "./ai-tabs.js";
import type { ActiveProjectSnapshot, MindMapNodeData } from "../../shared/types.js";
import {
  applyPersistedCandidate,
  attachPortableCandidate,
  createPortableChild,
  createPortableSibling,
  movePortableSubtreeToHistory,
  permanentlyRemovePortableTrash,
  renamePortableNode,
  restorePortableHistory,
  restorePortableTrash,
  trashPortableCandidate,
  trashPortableHistory,
  trashPortableSubtrees,
  updatePortableLinkedNodeTitle
} from "../state/project-state.js";
import { AiPanel } from "./components/AiPanel.js";
import { EmptyWorkspace } from "./components/EmptyWorkspace.js";
import { MindMapPanel, type MindMapController } from "./components/MindMapPanel.js";
import { NodeTray } from "./components/NodeTray.js";
import { NodeSearch } from './components/NodeSearch.js';
import type { NodeSearchResult } from '../../shared/search.js';
import { mergePortableNodes } from '../state/node-merge.js';
import { ProjectNavigator } from "./components/ProjectNavigator.js";
import { ProjectNameDialog } from "./components/ProjectNameDialog.js";
import { NodeProjectDialog } from "./components/NodeProjectDialog.js";
import { StylePanel } from "./components/StylePanel.js";
import { TopBar } from "./components/TopBar.js";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher.js";
import { useProject } from "./state/use-project.js";
import { conceptCandidate, type ConceptJob, type ConceptLibrary, type ConceptRecord, type ConceptRequest, type ConceptSelection } from "../../shared/concepts.js";
import { ConceptSettings } from "./components/ConceptSettings.js";
import { QuestionDialog } from "./components/QuestionDialog.js";
import { QuestionAnnotation } from "./components/QuestionAnnotation.js";

const AiSettingsPage = lazy(() => import("./components/AiSettingsPage.js").then((module) => ({ default: module.AiSettingsPage })));
const AnswerDialog = lazy(() => import("./components/AnswerDialog.js").then((module) => ({ default: module.AnswerDialog })));
const S3SyncDialog = lazy(() => import('./components/S3SyncDialog.js').then((module) => ({ default: module.S3SyncDialog })));

function AutoSave(): null {
  const saveStatus = useProject((state) => state.saveStatus);
  const snapshot = useProject((state) => state.snapshot);
  const saveProject = useProject((state) => state.saveProject);
  useEffect(() => {
    if (saveStatus !== "dirty" || !snapshot) return;
    const timer = window.setTimeout(() => void saveProject(), 700);
    return () => window.clearTimeout(timer);
  }, [saveProject, saveStatus, snapshot]);
  return null;
}

function ProjectToast(): React.JSX.Element | null {
  const message = useProject((state) => state.message);
  const saveStatus = useProject((state) => state.saveStatus);
  const setMessage = useProject((state) => state.setMessage);
  if (!message) return null;
  return (
    <div className={`toast ${saveStatus === "error" ? "toast--error" : ""}`}>
      {saveStatus === "error" ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
      <span>{message}</span>
      <button onClick={() => setMessage("")}><X size={15} /></button>
    </div>
  );
}

interface OpenAnswer {
  focusSelection?: ConceptSelection;
  answerId: string;
  nodeUid: string;
  initialPosition: { x: number; y: number };
  order: number;
}

function nodeTitleFor(node: MindMapNodeData, uid: string): string | undefined {
  return node.uid === uid ? node.text : node.children.map((child) => nodeTitleFor(child, uid)).find(Boolean);
}

export function App(): React.JSX.Element {
  const workspace = useProject((state) => state.workspace);
  const snapshot = useProject((state) => state.snapshot);
  const recentWorkspaces = useProject((state) => state.recentWorkspaces);
  const workspaceInitialized = useProject((state) => state.workspaceInitialized);
  const setSnapshot = useProject((state) => state.setSnapshot);
  const setMessage = useProject((state) => state.setMessage);
  const initializeWorkspace = useProject((state) => state.initializeWorkspace);
  const switchWorkspace = useProject((state) => state.switchWorkspace);
  const forgetRecentWorkspace = useProject((state) => state.forgetRecentWorkspace);
  const createWorkspace = useProject((state) => state.createWorkspace);
  const openWorkspace = useProject((state) => state.openWorkspace);
  const createNestedProject = useProject((state) => state.createNestedProject);
  const switchProject = useProject((state) => state.switchProject);
  const renameProject = useProject((state) => state.renameProject);
  const reparentProject = useProject((state) => state.reparentProject);
  const linkNodeProject = useProject((state) => state.linkNodeProject);
  const openProjectInExplorer = useProject((state) => state.openProjectInExplorer);
  const moveProjectToTrash = useProject((state) => state.moveProjectToTrash);
  const restoreProject = useProject((state) => state.restoreProject);
  const permanentlyDeleteProject = useProject((state) => state.permanentlyDeleteProject);
  const exportProject = useProject((state) => state.exportProject);
  const saveProject = useProject((state) => state.saveProject);
  const [layoutOverride, setLayoutOverride] = useState<{ projectId: string; model: Model } | null>(null);
  const [controller, setController] = useState<MindMapController | null>(null);
  const [focusRequest, setFocusRequest] = useState<NodeSearchResult | null>(null);
  const [openAnswers, setOpenAnswers] = useState<OpenAnswer[]>([]);
  const readerSequence = useRef(0);
  // Keep DOM order fixed: moving a window during pointerdown interrupts its click.
  const readerWindows = [...openAnswers].sort((left, right) => left.order - right.order);
  const [readersHidden, setReadersHidden] = useState(false);
  const openReader = useCallback((answerId: string, nodeUid = "", focusSelection?: ConceptSelection): void => {
    const order = readerSequence.current++;
    setReadersHidden(false);
    setOpenAnswers((current) => {
      const existing = current.find((reader) => reader.answerId === answerId);
      return [...current.filter((reader) => reader.answerId !== answerId), existing
        ? { ...existing, nodeUid: nodeUid || existing.nodeUid, focusSelection }
        : { answerId, nodeUid, focusSelection, order, initialPosition: { x: 48 + (current.length % 6) * 24, y: 76 + (current.length % 6) * 24 } }];
    });
  }, []);
  const activateReader = useCallback((answerId: string): void => {
    setOpenAnswers((current) => {
      if (current.at(-1)?.answerId === answerId) return current;
      const reader = current.find((item) => item.answerId === answerId);
      return reader ? [...current.filter((item) => item.answerId !== answerId), reader] : current;
    });
  }, []);
  const [conceptState, setConceptState] = useState<{ workspaceId: string; library: ConceptLibrary } | null>(null);
  const conceptLibrary = conceptState?.workspaceId === workspace?.workspaceId ? conceptState?.library ?? null : null;
  const setConceptLibrary = useCallback((library: ConceptLibrary): void => {
    const workspaceId = useProject.getState().workspace?.workspaceId;
    if (workspaceId) setConceptState({ workspaceId, library });
  }, [setConceptState]);
  const [conceptSettingsOpen, setConceptSettingsOpen] = useState(false);
  const [pendingCaptures, setPendingCaptures] = useState<Set<string>>(() => new Set());
  const [syncOpen, setSyncOpen] = useState(false);
  const [questionRequest, setQuestionRequest] = useState<{ request: ConceptRequest; workspaceId: string | undefined; projectId: string | undefined } | null>(null);
  const [openedAnnotation, setOpenedAnnotation] = useState<string | null>(null);
  const askQuestion = useCallback((request: ConceptRequest): void => {
    setQuestionRequest({ request, workspaceId: useProject.getState().workspace?.workspaceId, projectId: useProject.getState().snapshot?.manifest.projectId });
  }, [setQuestionRequest]);
  const [projectCreationParentId, setProjectCreationParentId] = useState<string | null | undefined>(undefined);
  const [workspacePage, setWorkspacePage] = useState<"dock" | "api-settings">("dock");
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [projectLinkNode, setProjectLinkNode] = useState<{ uid: string; title: string } | null>(null);
  const activeProjectId = snapshot?.manifest.projectId;
  const selectedMindMapTheme = snapshot?.state.uiPreferences.mindMapTheme ?? "paper";
  const savedDockLayout = snapshot?.state.dockLayout;
  const projectModel = useMemo(
    () => createLayoutModel(savedDockLayout ?? DEFAULT_DOCK_LAYOUT),
    [savedDockLayout]
  );
  const model = activeProjectId && layoutOverride?.projectId === activeProjectId
    ? layoutOverride.model
    : projectModel;

  const refreshConcepts = useCallback(async (): Promise<void> => {
    if (!window.mindmapAI.concepts || !useProject.getState().workspace) return;
    const workspaceId = useProject.getState().workspace!.workspaceId;
    const library = await window.mindmapAI.concepts.get();
    if (workspaceId === useProject.getState().workspace?.workspaceId) {
      setConceptLibrary(library);
      let removed = false;
      for (const record of library.records) {
        const tab = model.getNodeById(record.tabId) as TabNode | undefined;
        if (record.status === "ready" && tab?.getConfig()?.backgroundConcept) { model.doAction(Actions.deleteTab(record.tabId)); removed = true; }
      }
      if (removed) {
        window.mindmapAI.ai.syncTabs(collectAiTabs(model));
        const current = useProject.getState().snapshot;
        if (current && current.manifest.projectId === activeProjectId) { setLayoutOverride({ projectId: current.manifest.projectId, model }); useProject.getState().setSnapshot({ ...current, state: { ...current.state, dockLayout: model.toJson() } }); }
      }
    }
  }, [setConceptLibrary, model, activeProjectId]);
  const launchConcept = useCallback(async (job: ConceptJob, scope = { workspaceId: useProject.getState().workspace?.workspaceId, projectId: activeProjectId }): Promise<void> => {
    await refreshConcepts();
    if (scope.workspaceId !== useProject.getState().workspace?.workspaceId || scope.projectId !== useProject.getState().snapshot?.manifest.projectId) return;
    if (job.reused) { setMessage(job.record.status === "ready" ? "已关联已有概念" : "该概念已在库中，可查看或重试"); return; }
    if (!job.background) {
      let tabSetId: string | undefined;
      model.visitNodes((node) => { if (!tabSetId && node.getType() === "tabset" && isAiTabSet(node as never)) tabSetId = node.getId(); });
      if (!tabSetId) tabSetId = model.getActiveTabset()?.getId();
      if (!tabSetId) throw new Error("请先恢复停靠布局后生成概念");
      model.doAction(Actions.addNode({ type: "tab", id: job.record.tabId, name: `${AI_PROVIDERS[job.record.provider].name} · ${job.record.title}`, component: "ai", config: { provider: job.record.provider } }, tabSetId, DockLocation.CENTER, -1, true));
      window.mindmapAI.ai.syncTabs(collectAiTabs(model));
      const current = useProject.getState().snapshot;
      if (current) { setLayoutOverride({ projectId: current.manifest.projectId, model }); useProject.getState().setSnapshot({ ...current, state: { ...current.state, dockLayout: model.toJson() } }); }
    }
    await window.mindmapAI.concepts.run(job.record.id, job.background);
    if (!job.background) setReadersHidden(true);
    setMessage(`正在生成${job.record.kind === "qa" ? "答疑" : "概念"}：${job.record.title}`);
  }, [model, activeProjectId, refreshConcepts, setMessage]);
  const generateConcept = useCallback(async (request: ConceptRequest): Promise<void> => {
    const scope = { workspaceId: useProject.getState().workspace?.workspaceId, projectId: useProject.getState().snapshot?.manifest.projectId };
    try {
      if (collectAiTabs(model).length >= 64) throw new Error("标签页已达上限，请先关闭一个页面");
      if (useProject.getState().saveStatus === "dirty" && !await useProject.getState().saveProject()) return;
      if (scope.workspaceId !== useProject.getState().workspace?.workspaceId || scope.projectId !== useProject.getState().snapshot?.manifest.projectId) return;
      await launchConcept(await window.mindmapAI.concepts.prepare(request), scope);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "概念生成失败"); }
  }, [launchConcept, setMessage, model]);
  const openNote = useCallback((answerId: string, focusSelection?: ConceptSelection): void => {
    if (conceptLibrary?.records.some((record) => record.answerId === answerId && record.kind === "qa" && record.status !== "trash")) setOpenedAnnotation(answerId);
    else openReader(answerId, "", focusSelection);
  }, [openReader, conceptLibrary, setOpenedAnnotation]);
  const retryQuestion = useCallback((id: string): void => {
    void window.mindmapAI.concepts.retry(id).then(launchConcept).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : "重试失败"));
  }, [launchConcept, setMessage]);
  const conceptAction = useCallback((id: string, action: "trash" | "restore" | "delete" | "rename", title?: string): void => {
    if (action === "delete" && !window.confirm("从概念库彻底移除此词条？已被文档引用的 Markdown 会保留。")) return;
    void window.mindmapAI.concepts.update(id, action, title).then(refreshConcepts).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "更新概念失败"));
  }, [setMessage, refreshConcepts]);
  useEffect(() => {
    const api = window.mindmapAI.concepts;
    if (!api || !workspace) return;
    let active = true;
    api.get().then((library) => { if (active) setConceptState({ workspaceId: workspace.workspaceId, library }); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "读取概念库失败"); });
    const unsubscribe = api.onChanged((workspaceId) => { if (workspaceId === useProject.getState().workspace?.workspaceId) void refreshConcepts(); });
    return () => { active = false; unsubscribe(); };
  }, [workspace, refreshConcepts, setMessage]);
  useEffect(() => {
    const api = window.mindmapAI.concepts; if (!api) return;
    const request = api.onRequest((selection) => { void generateConcept(selection); });
    const open = api.onOpen(openNote);
    const question = api.onQuestionRequest?.(askQuestion);
    return () => { request(); open(); question?.(); };
  }, [generateConcept, openNote, askQuestion]);
  const hasVisibleReaders = openAnswers.length > 0 && !readersHidden;
  const visibleQuestion = questionRequest?.workspaceId === workspace?.workspaceId && questionRequest?.projectId === activeProjectId ? questionRequest : null;
  const annotation = conceptLibrary?.records.find((record) => record.answerId === openedAnnotation && record.kind === "qa" && record.status !== "trash");
  useEffect(() => { window.mindmapAI.ai.setPanelVisible(!hasVisibleReaders && !conceptSettingsOpen && !visibleQuestion && !annotation && !syncOpen); }, [hasVisibleReaders, conceptSettingsOpen, visibleQuestion, annotation, syncOpen]);

  useLayoutEffect(() => {
    window.mindmapAI.ai.syncTabs(collectAiTabs(model));
  }, [model]);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  useEffect(() => {
    const unsubscribeCaptured = window.mindmapAI.ai.onAnswerCaptured((acknowledgement) => {
      setPendingCaptures((current) => { const next = new Set(current); if (acknowledgement.phase === "saved") next.add(acknowledgement.candidate.id); else next.delete(acknowledgement.candidate.id); return next; });
      const current = useProject.getState().snapshot;
      if (acknowledgement.workspaceId && acknowledgement.workspaceId !== useProject.getState().workspace?.workspaceId || acknowledgement.projectId && acknowledgement.projectId !== current?.manifest.projectId) return;
      if (current) useProject.getState().setSnapshot(applyPersistedCandidate(current, acknowledgement.candidate));
      if (acknowledgement.phase === "saved") { setMessage(`原文已捕获：${acknowledgement.candidate.title}；正在整理节点…`); return; }
      setMessage(acknowledgement.apiWarning
        ? `已捕获：${acknowledgement.candidate.title}；${acknowledgement.apiWarning}`
        : `已捕获：${acknowledgement.candidate.title}`);
    });
    const unsubscribeError = window.mindmapAI.ai.onAdapterError(setMessage);
    return () => {
      unsubscribeCaptured();
      unsubscribeError();
    };
  }, [setMessage]);

  useEffect(() => {
    if (controller && activeProjectId) controller.applyTheme(selectedMindMapTheme);
  }, [activeProjectId, controller, selectedMindMapTheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if ((event.target as Element).closest(".flexlayout__tab_button")) window.mindmapAI.ai.beginLocalDrag();
    };
    const onPointerUp = (): void => window.mindmapAI.ai.endLocalDrag();
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("dragend", onPointerUp, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("dragend", onPointerUp, true);
    };
  }, [saveProject]);

  const updateSnapshot = useCallback((updater: (current: ActiveProjectSnapshot) => ActiveProjectSnapshot): void => {
    const current = useProject.getState().snapshot;
    if (current && !current.readOnly) setSnapshot(updater(current));
  }, [setSnapshot]);

  const createAttachment = useCallback((nodeUid: string, kind: 'blank' | 'import'): void => {
    void (async () => {
      const current = useProject.getState().snapshot;
      if (!current || current.readOnly) return;
      const find = (node: MindMapNodeData): MindMapNodeData | undefined => node.uid === nodeUid ? node : node.children.map(find).find(Boolean);
      const node = find(current.mindmap);
      if (!node || node.answerId && !window.confirm('此节点已有附加文档。替换为新文档？原文档文件会保留。')) return;
      if (!await saveProject()) throw new Error('请先成功保存项目');
      const answer = await window.mindmapAI.project.createAttachment(nodeUid, kind);
      if (!answer) return;
      if (useProject.getState().snapshot?.manifest.projectId !== current.manifest.projectId) throw new Error('项目已切换，文档已保存但未关联');
      updateSnapshot((latest) => {
        const attach = (item: MindMapNodeData): MindMapNodeData => item.uid === nodeUid ? { ...item, answerId: answer.metadata.id, conceptId: undefined, tags: undefined } : { ...item, children: item.children.map(attach) };
        return { ...latest, mindmap: attach(latest.mindmap) };
      });
      if (!await saveProject()) throw new Error('文档已保存，请重试保存节点关联');
      openReader(answer.metadata.id, nodeUid);
    })().catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : '创建附件失败'));
  }, [saveProject, updateSnapshot, openReader, setMessage]);

  const selectSearchResult = (result: NodeSearchResult): void => {
    void (async () => {
      setWorkspacePage('dock'); setReadersHidden(true);
      if (result.projectId !== useProject.getState().snapshot?.manifest.projectId) await switchProject(result.projectId);
      if (result.projectId !== useProject.getState().snapshot?.manifest.projectId) return;
      setFocusRequest(result);
    })().catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : '定位节点失败'));
  };
  useEffect(() => {
    if (!focusRequest || focusRequest.projectId !== activeProjectId || !controller) return;
    if (model.getNodeById('mindmap')) model.doAction(Actions.selectTab('mindmap'));
    const frame = requestAnimationFrame(() => { controller.focusNode(focusRequest.nodeUid); setFocusRequest(null); });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, activeProjectId, controller, model]);

  const factory = useMemo(() => (node: TabNode): React.ReactNode => {
    if (!snapshot) return null;
    switch (node.getComponent()) {
      case "mindmap":
        return (
          <MindMapPanel
            data={snapshot.mindmap}
            projectId={snapshot.manifest.projectId}
            readOnly={snapshot.readOnly}
            onOpenProject={(projectId) => { setOpenAnswers([]); void switchProject(projectId); }}
            onLinkProject={(uid, title) => setProjectLinkNode({ uid, title })}
            onUnlinkProject={(nodeUid) => updateSnapshot((current) => {
              const mindmap = structuredClone(current.mindmap);
              const visit = (node: MindMapNodeData): void => {
                if (node.uid === nodeUid) delete node.linkedProjectId;
                node.children.forEach(visit);
              };
              visit(mindmap);
              return { ...current, mindmap };
            })}
            onChange={(mindmap: MindMapNodeData) => updateSnapshot((current) => ({ ...current, mindmap }))}
            onCandidateDrop={(candidateId, targetUid) => updateSnapshot((current) => {
              const concept = conceptLibrary?.records.find((record) => record.kind !== "qa" && record.id === candidateId && record.status === "ready");
              return attachPortableCandidate(concept ? applyPersistedCandidate(current, conceptCandidate(concept)) : current, candidateId, targetUid);
            })}
            onHistoryDrop={(historyId, targetUid) => updateSnapshot((current) => restorePortableHistory(current, historyId, targetUid))}
            onOpenAnswer={openReader}
            onCreateAttachment={createAttachment}
            onRenameNode={(nodeUid, title) => updateSnapshot((current) => renamePortableNode(current, nodeUid, title))}
            onCreateChild={(nodeUid) => updateSnapshot((current) => createPortableChild(current, nodeUid, "新节点"))}
            onCreateSibling={(nodeUid) => updateSnapshot((current) => createPortableSibling(current, nodeUid, "新节点"))}
            onMoveToHistory={(nodeUid) => updateSnapshot((current) => movePortableSubtreeToHistory(current, nodeUid))}
            onDeleteNodes={(nodeUids) => updateSnapshot((current) => trashPortableSubtrees(current, nodeUids))}
            onMergeNodes={(nodeUids, targetUid, title, answerId) => {
              try { updateSnapshot((current) => mergePortableNodes(current, nodeUids, targetUid, title, answerId)); }
              catch (cause) { setMessage(cause instanceof Error ? cause.message : '合并节点失败'); }
            }}
            onController={setController}
          />
        );
      case "ai":
        return (
          <AiPanel
            tabId={node.getId()}
            provider={getAiTabProvider(node)}
            readOnly={snapshot.readOnly}
            autoHoverCapture={snapshot.state.uiPreferences.autoHoverCapture}
            captureMode={snapshot.state.uiPreferences.captureMode}
            onAutoHoverCaptureChange={(autoHoverCapture) => updateSnapshot((current) => ({
              ...current,
              state: {
                ...current.state,
                uiPreferences: { ...current.state.uiPreferences, autoHoverCapture }
              }
            }))}
            onCaptureModeChange={(captureMode) => updateSnapshot((current) => ({
              ...current,
              state: { ...current.state, uiPreferences: { ...current.state.uiPreferences, captureMode } }
            }))}
            onOpenSettings={() => setWorkspacePage("api-settings")}
          />
        );
      case "candidates":
        return (
          <NodeTray
            pendingCaptures={pendingCaptures}
            projects={workspace?.projects}
            currentProject={snapshot.manifest}
            concepts={conceptLibrary?.records.filter((record) => record.kind !== "qa")}
            onConceptSettings={() => setConceptSettingsOpen(true)}
            onConceptAction={conceptAction}
            onOpenConcept={(record) => openNote(record.answerId)}
            onRetryConcept={(id) => { void window.mindmapAI.concepts.retry(id).then(launchConcept).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "重试失败")); }}
            onShowConceptTab={(record: ConceptRecord) => {
              if (model.getNodeById(record.tabId)) { model.doAction(Actions.selectTab(record.tabId)); setReadersHidden(true); }
              else {
                const tabSetId = collectAiTabs(model).map((tab) => model.getNodeById(tab.id)?.getParent()?.getId()).find(Boolean) ?? model.getActiveTabset()?.getId();
                if (!tabSetId) return;
                model.doAction(Actions.addNode({ type: "tab", id: record.tabId, name: `${AI_PROVIDERS[record.provider].name} · ${record.title}`, component: "ai", config: { provider: record.provider, backgroundConcept: record.status === "generating" } }, tabSetId, DockLocation.CENTER, -1, true));
                window.mindmapAI.ai.syncTabs(collectAiTabs(model));
                updateSnapshot((current) => ({ ...current, state: { ...current.state, dockLayout: model.toJson() } }));
                setReadersHidden(true);
              }
            }}
            candidates={snapshot.state.candidates}
            history={snapshot.state.history}
            trash={snapshot.state.trash}
            readOnly={snapshot.readOnly}
            onUpdateCandidate={(updated) => updateSnapshot((current) => ({
              ...current,
              state: {
                ...current.state,
                candidates: current.state.candidates.map((candidate) =>
                  candidate.id === updated.id ? updated : candidate
                )
              }
            }))}
            onDeleteCandidate={(candidateId) => updateSnapshot((current) => trashPortableCandidate(current, candidateId))}
            onDeleteHistory={(historyId) => updateSnapshot((current) => trashPortableHistory(current, historyId))}
            onRestoreTrash={(trashId) => updateSnapshot((current) => restorePortableTrash(current, trashId))}
            onPermanentDelete={(trashId) => updateSnapshot((current) => permanentlyRemovePortableTrash(current, trashId))}
            onMapSubtreeDrop={(nodeUid) => updateSnapshot((current) => movePortableSubtreeToHistory(current, nodeUid))}
          />
        );
      case "styles":
        return (
          <StylePanel
            controller={snapshot.readOnly ? null : controller}
            currentTheme={snapshot.state.uiPreferences.mindMapTheme ?? "paper"}
            onApplyTheme={(mindMapTheme) => {
              controller?.applyTheme(mindMapTheme);
              updateSnapshot((current) => ({
                ...current,
                state: {
                  ...current.state,
                  uiPreferences: { ...current.state.uiPreferences, mindMapTheme }
                }
              }));
            }}
          />
        );
      default:
        return <div className="unknown-panel">未知模块</div>;
    }
  }, [controller, snapshot, workspace, pendingCaptures, updateSnapshot, switchProject, conceptLibrary, conceptAction, openNote, openReader, launchConcept, model, setMessage, createAttachment]);

  const resetLayout = (): void => {
    if (snapshot?.readOnly) return;
    const nextModel = createLayoutModel(DEFAULT_DOCK_LAYOUT);
    if (activeProjectId) setLayoutOverride({ projectId: activeProjectId, model: nextModel });
    if (snapshot) setSnapshot({
      ...snapshot,
      state: { ...snapshot.state, dockLayout: nextModel.toJson() }
    });
  };

  return (
    <div className="app-shell">
      <AutoSave />
      <TopBar
        onSync={() => setSyncOpen(true)}
        search={snapshot && workspace ? <NodeSearch key={workspace.workspaceId} snapshot={snapshot} workspaceId={workspace.workspaceId} onSelect={selectSearchResult} /> : undefined}
        projectName={snapshot?.manifest.name}
        readOnly={snapshot?.readOnly}
        onCreate={() => { setOpenAnswers([]); void createWorkspace(); }}
        onOpen={() => { setOpenAnswers([]); void openWorkspace(); }}
        onSwitchWorkspace={() => setWorkspaceSwitcherOpen(true)}
        onSave={() => void saveProject()}
        onResetLayout={resetLayout}
      />
      {!workspaceInitialized ? (
        <main className="workspace-loading" aria-label="正在恢复工作区">正在恢复上次工作区…</main>
      ) : !snapshot ? (
        <EmptyWorkspace
          onCreate={() => { setOpenAnswers([]); void createWorkspace(); }}
          onOpen={() => { setOpenAnswers([]); void openWorkspace(); }}
        />
      ) : (
        <div className="workspace-frame">
          {workspace && (
          <ProjectNavigator
              workspace={workspace}
              readOnly={snapshot?.readOnly}
              onReparent={(projectId, parentId) => { void reparentProject(projectId, parentId); }}
              onSwitch={(projectId) => { setOpenAnswers([]); void switchProject(projectId); }}
              onCreate={setProjectCreationParentId}
              onOpenApiSettings={() => setWorkspacePage("api-settings")}
              onRename={(projectId, name) => void renameProject(projectId, name)}
              onOpenInExplorer={(projectId) => void openProjectInExplorer(projectId)}
              onMoveToTrash={(projectId) => {
                if (window.confirm("将此项目移到垃圾箱？项目内容可以恢复。")) {
                  setOpenAnswers([]);
                  void moveProjectToTrash(projectId);
                }
              }}
              onRestore={(projectId) => void restoreProject(projectId)}
              onPermanentDelete={(projectId) => {
                if (window.confirm("彻底删除此项目？此操作无法撤销。")) {
                  void permanentlyDeleteProject(projectId, false);
                }
              }}
              onExport={(projectId) => void exportProject(projectId)}
            />
          )}
          <main className="dock-workspace">
            {workspacePage === "api-settings" ? (
              <Suspense fallback={<div className="workspace-loading">正在加载设置…</div>}><AiSettingsPage
                titleSource={snapshot.state.uiPreferences.titleSource}
                onClose={() => setWorkspacePage("dock")}
                onTitleSourceChange={(titleSource) => updateSnapshot((current) => ({
                  ...current,
                  state: { ...current.state, uiPreferences: { ...current.state.uiPreferences, titleSource } }
                }))}
              /></Suspense>
            ) : (
              <Layout
                model={model}
                factory={factory}
                realtimeResize
                onRenderTabSet={(tabSet, renderValues) => {
                  if (!isAiTabSet(tabSet)) return;
                  renderValues.stickyButtons.push(
                    <select
                      key="new-ai-tab"
                      className="ai-add-tab"
                      aria-label="新建问答标签页"
                      title="新建问答标签页"
                      value=""
                      disabled={collectAiTabs(model).length >= 64}
                      onMouseDown={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const provider = event.currentTarget.value;
                        if (!isProviderId(provider)) return;
                        model.doAction(Actions.addNode({
                          type: "tab", id: `ai-${crypto.randomUUID()}`, name: AI_PROVIDERS[provider].name,
                          component: "ai", config: { provider }
                        }, tabSet.getId(), DockLocation.CENTER, -1, true));
                      }}
                    >
                      <option value="" disabled>＋</option>
                      {Object.entries(AI_PROVIDERS).map(([id, { name }]) => <option key={id} value={id}>打开{name}</option>)}
                    </select>
                  );
                }}
                onModelChange={(nextModel) => {
                  window.mindmapAI.ai.syncTabs(collectAiTabs(nextModel));
                  if (activeProjectId) setLayoutOverride({ projectId: activeProjectId, model: nextModel });
                  const current = useProject.getState().snapshot;
                  if (current && !current.readOnly) setSnapshot({
                    ...current,
                    state: { ...current.state, dockLayout: nextModel.toJson() }
                  });
                }}
              />
            )}
          </main>
        </div>
      )}
      {openAnswers.length > 0 && snapshot && (
        <Suspense fallback={<div className="workspace-loading">正在加载回答…</div>}>
        {readerWindows.map((reader) => <AnswerDialog
          key={reader.answerId}
          {...reader}
          zIndex={100 + openAnswers.indexOf(reader)}
          active={reader === openAnswers.at(-1)}
          hidden={readersHidden}
          onActivate={() => activateReader(reader.answerId)}
          records={conceptLibrary?.records}
          onGenerateConcept={generateConcept}
          onAskQuestion={askQuestion}
          onRetryQuestion={retryQuestion}
          onOpenNote={openNote}
          nodeTitle={nodeTitleFor(snapshot.mindmap, reader.nodeUid)}
          readOnly={snapshot.readOnly}
          onClose={() => setOpenAnswers((current) => current.filter((item) => item.answerId !== reader.answerId))}
          onRetitle={(nodeUid, title) => updateSnapshot((current) => updatePortableLinkedNodeTitle(current, nodeUid, title))}
        />)}
        </Suspense>
      )}
      {openAnswers.length > 0 && snapshot && <nav className="reader-window-list" aria-label="阅读窗口管理">
        <Library size={16} />
        {readerWindows.map((reader, index) => {
          const title = nodeTitleFor(snapshot.mindmap, reader.nodeUid) ?? conceptLibrary?.records.find((record) => record.answerId === reader.answerId)?.title ?? conceptLibrary?.records.flatMap((record) => record.references).find((ref) => ref.sourceAnswerId === reader.answerId)?.sourceTitle ?? `节点笔记 ${index + 1}`;
          return <button key={reader.answerId} aria-label={`切换阅读窗口：${title}`} aria-pressed={!readersHidden && reader === openAnswers.at(-1)} title={title}
            onClick={() => { setReadersHidden(false); activateReader(reader.answerId); }}>{title}</button>;
        })}
        <button className="reader-workspace-button" title={readersHidden ? "显示阅读窗口" : "返回工作区"} aria-label={readersHidden ? "显示阅读窗口" : "返回工作区"} onClick={() => setReadersHidden((value) => !value)}><PanelsTopLeft size={16} />{readersHidden ? "显示窗口" : "工作区"}</button>
      </nav>}
      {conceptSettingsOpen && conceptLibrary && <ConceptSettings settings={conceptLibrary.settings} onClose={() => setConceptSettingsOpen(false)} onSave={async (settings) => { await window.mindmapAI.concepts.settings(settings); await refreshConcepts(); }} />}
      {visibleQuestion && <QuestionDialog key={`${visibleQuestion.workspaceId}-${visibleQuestion.projectId}-${visibleQuestion.request.sourceAnswerId}-${visibleQuestion.request.selection.text}`} request={visibleQuestion.request} settings={conceptLibrary?.questionSettings} onClose={() => setQuestionRequest(null)} onSaveSettings={async (settings) => {
        if (visibleQuestion.workspaceId !== useProject.getState().workspace?.workspaceId) throw new Error("工作区已切换，请重新打开答疑设置");
        await window.mindmapAI.concepts.questionSettings(settings); await refreshConcepts();
      }} onSubmit={async (question, settings) => {
        if (collectAiTabs(model).length >= 64) throw new Error("标签页已达上限，请先关闭一个页面");
        if (useProject.getState().saveStatus === "dirty" && !await useProject.getState().saveProject()) throw new Error("请先保存项目");
        if (visibleQuestion.workspaceId !== useProject.getState().workspace?.workspaceId || visibleQuestion.projectId !== useProject.getState().snapshot?.manifest.projectId) throw new Error("来源项目已切换，请重新划取");
        await window.mindmapAI.concepts.questionSettings(settings);
        await launchConcept(await window.mindmapAI.concepts.prepareQuestion({ ...visibleQuestion.request, question }), visibleQuestion);
      }} />}
      {annotation && <div className="question-backdrop"><QuestionAnnotation record={annotation} onClose={() => setOpenedAnnotation(null)} onRetry={snapshot?.readOnly ? undefined : retryQuestion} onOpenNote={(id, selection) => { setOpenedAnnotation(null); openNote(id, selection); }} /></div>}
      {projectCreationParentId !== undefined && (
        <ProjectNameDialog
          parentProjectId={projectCreationParentId}
          onClose={() => setProjectCreationParentId(undefined)}
          onSubmit={async (name, parentProjectId) => {
            setOpenAnswers([]);
            await createNestedProject(name, parentProjectId);
          }}
        />
      )}
      {projectLinkNode && workspace && <NodeProjectDialog
        title={projectLinkNode.title}
        workspace={workspace}
        onClose={() => setProjectLinkNode(null)}
        onSubmit={(target) => linkNodeProject(projectLinkNode.uid, target)}
      />}
      {workspaceSwitcherOpen && (
        <WorkspaceSwitcher
          entries={recentWorkspaces}
          onClose={() => setWorkspaceSwitcherOpen(false)}
          onSwitch={(id) => {
            setOpenAnswers([]);
            void switchWorkspace(id).then(() => setWorkspaceSwitcherOpen(false));
          }}
          onForget={(id) => void forgetRecentWorkspace(id)}
          onOpen={() => {
            setWorkspaceSwitcherOpen(false);
            setOpenAnswers([]);
            void openWorkspace();
          }}
          onCreate={() => {
            setWorkspaceSwitcherOpen(false);
            setOpenAnswers([]);
            void createWorkspace();
          }}
        />
      )}
      <ProjectToast />
      {syncOpen && <Suspense fallback={<div className="dialog-backdrop">正在加载 S3 设置…</div>}><S3SyncDialog workspaceName={workspace?.name} onClose={() => setSyncOpen(false)} onBeforeTransfer={async () => {
        if (document.querySelector('.answer-pane[data-dirty="true"]')) throw new Error('阅读窗口中有未保存的修改，请先保存文档');
        if (pendingCaptures.size || conceptLibrary?.records.some((record) => record.status === 'generating')) throw new Error('请等待捕获、概念或答疑生成完成后再同步');
        if (useProject.getState().snapshot && !await saveProject()) throw new Error('请先成功保存当前项目');
      }} onDownloaded={(result) => {
        setOpenAnswers([]); setSyncOpen(false); setWorkspacePage('dock'); setFocusRequest(null); setLayoutOverride(null);
        useProject.setState({ workspace: result.workspace, snapshot: result.project, saveStatus: 'saved', message: '云端工作区已下载并打开' });
        setConceptState(null);
        void window.mindmapAI.workspace.listRecent().then((recentWorkspaces) => useProject.setState({ recentWorkspaces }));
      }} /></Suspense>}
    </div>
  );
}
