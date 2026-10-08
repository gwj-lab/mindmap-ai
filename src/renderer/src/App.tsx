import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Actions, DockLocation, Layout, type Model, type TabNode } from "flexlayout-react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
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
import { ProjectNavigator } from "./components/ProjectNavigator.js";
import { ProjectNameDialog } from "./components/ProjectNameDialog.js";
import { NodeProjectDialog } from "./components/NodeProjectDialog.js";
import { StylePanel } from "./components/StylePanel.js";
import { TopBar } from "./components/TopBar.js";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher.js";
import { useProject } from "./state/use-project.js";
import { conceptCandidate, type ConceptJob, type ConceptLibrary, type ConceptRecord, type ConceptRequest, type ConceptSelection } from "../../shared/concepts.js";
import { ConceptSettings } from "./components/ConceptSettings.js";

const AiSettingsPage = lazy(() => import("./components/AiSettingsPage.js").then((module) => ({ default: module.AiSettingsPage })));
const AnswerDialog = lazy(() => import("./components/AnswerDialog.js").then((module) => ({ default: module.AnswerDialog })));

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
  const [openAnswer, setOpenAnswer] = useState<OpenAnswer | null>(null);
  const [conceptState, setConceptState] = useState<{ workspaceId: string; library: ConceptLibrary } | null>(null);
  const conceptLibrary = conceptState?.workspaceId === workspace?.workspaceId ? conceptState?.library ?? null : null;
  const setConceptLibrary = useCallback((library: ConceptLibrary): void => {
    const workspaceId = useProject.getState().workspace?.workspaceId;
    if (workspaceId) setConceptState({ workspaceId, library });
  }, []);
  const [conceptSettingsOpen, setConceptSettingsOpen] = useState(false);
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
    if (workspaceId === useProject.getState().workspace?.workspaceId) setConceptLibrary(library);
  }, [setConceptLibrary]);
  const launchConcept = useCallback(async (job: ConceptJob, scope = { workspaceId: useProject.getState().workspace?.workspaceId, projectId: activeProjectId }): Promise<void> => {
    await refreshConcepts();
    if (scope.workspaceId !== useProject.getState().workspace?.workspaceId || scope.projectId !== useProject.getState().snapshot?.manifest.projectId) return;
    if (job.reused) { setMessage(job.record.status === "ready" ? "已关联已有概念" : "该概念已在库中，可查看或重试"); return; }
    let tabSetId: string | undefined;
    model.visitNodes((node) => { if (!tabSetId && node.getType() === "tabset" && isAiTabSet(node as never)) tabSetId = node.getId(); });
    if (!tabSetId) tabSetId = model.getActiveTabset()?.getId();
    if (!tabSetId) throw new Error("请先恢复停靠布局后生成概念");
    model.doAction(Actions.addNode({ type: "tab", id: job.record.tabId, name: `${AI_PROVIDERS[job.record.provider].name} · ${job.record.title}`, component: "ai", config: { provider: job.record.provider } }, tabSetId, DockLocation.CENTER, -1, !job.background));
    window.mindmapAI.ai.syncTabs(collectAiTabs(model));
    const current = useProject.getState().snapshot;
    if (current) { setLayoutOverride({ projectId: current.manifest.projectId, model }); useProject.getState().setSnapshot({ ...current, state: { ...current.state, dockLayout: model.toJson() } }); }
    await window.mindmapAI.concepts.run(job.record.id);
    if (!job.background) setOpenAnswer(null);
    setMessage(`正在生成概念：${job.record.title}`);
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
  const openNote = useCallback((answerId: string, focusSelection?: ConceptSelection): void => setOpenAnswer({ answerId, nodeUid: "", focusSelection }), []);
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
    return () => { request(); open(); };
  }, [generateConcept, openNote]);
  useEffect(() => { window.mindmapAI.ai.setPanelVisible(!openAnswer && !conceptSettingsOpen); }, [openAnswer, conceptSettingsOpen]);

  useLayoutEffect(() => {
    window.mindmapAI.ai.syncTabs(collectAiTabs(model));
  }, [model]);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  useEffect(() => {
    const unsubscribeCaptured = window.mindmapAI.ai.onAnswerCaptured((acknowledgement) => {
      const current = useProject.getState().snapshot;
      if (current) useProject.getState().setSnapshot(applyPersistedCandidate(current, acknowledgement.candidate));
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

  const factory = useMemo(() => (node: TabNode): React.ReactNode => {
    if (!snapshot) return null;
    switch (node.getComponent()) {
      case "mindmap":
        return (
          <MindMapPanel
            data={snapshot.mindmap}
            projectId={snapshot.manifest.projectId}
            readOnly={snapshot.readOnly}
            onOpenProject={(projectId) => { setOpenAnswer(null); void switchProject(projectId); }}
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
              const concept = conceptLibrary?.records.find((record) => record.id === candidateId && record.status === "ready");
              return attachPortableCandidate(concept ? applyPersistedCandidate(current, conceptCandidate(concept)) : current, candidateId, targetUid);
            })}
            onHistoryDrop={(historyId, targetUid) => updateSnapshot((current) => restorePortableHistory(current, historyId, targetUid))}
            onOpenAnswer={(answerId, nodeUid) => setOpenAnswer({ answerId, nodeUid })}
            onRenameNode={(nodeUid, title) => updateSnapshot((current) => renamePortableNode(current, nodeUid, title))}
            onCreateChild={(nodeUid) => updateSnapshot((current) => createPortableChild(current, nodeUid, "新节点"))}
            onCreateSibling={(nodeUid) => updateSnapshot((current) => createPortableSibling(current, nodeUid, "新节点"))}
            onMoveToHistory={(nodeUid) => updateSnapshot((current) => movePortableSubtreeToHistory(current, nodeUid))}
            onDeleteNodes={(nodeUids) => updateSnapshot((current) => trashPortableSubtrees(current, nodeUids))}
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
            concepts={conceptLibrary?.records}
            onConceptSettings={() => setConceptSettingsOpen(true)}
            onConceptAction={conceptAction}
            onOpenConcept={(record) => openNote(record.answerId)}
            onRetryConcept={(id) => { void window.mindmapAI.concepts.retry(id).then(launchConcept).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "重试失败")); }}
            onShowConceptTab={(record: ConceptRecord) => {
              if (model.getNodeById(record.tabId)) { model.doAction(Actions.selectTab(record.tabId)); setOpenAnswer(null); }
              else setMessage("生成标签页已关闭，请重试以打开新页面");
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
  }, [controller, snapshot, updateSnapshot, switchProject, conceptLibrary, conceptAction, openNote, launchConcept, model, setMessage]);

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
        projectName={snapshot?.manifest.name}
        readOnly={snapshot?.readOnly}
        onCreate={() => { setOpenAnswer(null); void createWorkspace(); }}
        onOpen={() => { setOpenAnswer(null); void openWorkspace(); }}
        onSwitchWorkspace={() => setWorkspaceSwitcherOpen(true)}
        onSave={() => void saveProject()}
        onResetLayout={resetLayout}
      />
      {!workspaceInitialized ? (
        <main className="workspace-loading" aria-label="正在恢复工作区">正在恢复上次工作区…</main>
      ) : !snapshot ? (
        <EmptyWorkspace
          onCreate={() => { setOpenAnswer(null); void createWorkspace(); }}
          onOpen={() => { setOpenAnswer(null); void openWorkspace(); }}
        />
      ) : (
        <div className="workspace-frame">
          {workspace && (
          <ProjectNavigator
              workspace={workspace}
              readOnly={snapshot?.readOnly}
              onReparent={(projectId, parentId) => { void reparentProject(projectId, parentId); }}
              onSwitch={(projectId) => { setOpenAnswer(null); void switchProject(projectId); }}
              onCreate={setProjectCreationParentId}
              onOpenApiSettings={() => setWorkspacePage("api-settings")}
              onRename={(projectId, name) => void renameProject(projectId, name)}
              onOpenInExplorer={(projectId) => void openProjectInExplorer(projectId)}
              onMoveToTrash={(projectId) => {
                if (window.confirm("将此项目移到垃圾箱？项目内容可以恢复。")) {
                  setOpenAnswer(null);
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
      {openAnswer && snapshot && (
        <Suspense fallback={<div className="workspace-loading">正在加载回答…</div>}>
        <AnswerDialog
          key={openAnswer.answerId}
          {...openAnswer}
          records={conceptLibrary?.records}
          onGenerateConcept={generateConcept}
          onOpenNote={openNote}
          nodeTitle={(() => { const find = (node: MindMapNodeData): string | undefined => node.uid === openAnswer.nodeUid ? node.text : node.children.map(find).find(Boolean); return find(snapshot.mindmap); })()}
          readOnly={snapshot.readOnly}
          onClose={() => setOpenAnswer(null)}
          onRetitle={(nodeUid, title) => updateSnapshot((current) => updatePortableLinkedNodeTitle(current, nodeUid, title))}
        />
        </Suspense>
      )}
      {conceptSettingsOpen && conceptLibrary && <ConceptSettings settings={conceptLibrary.settings} onClose={() => setConceptSettingsOpen(false)} onSave={async (settings) => { await window.mindmapAI.concepts.settings(settings); await refreshConcepts(); }} />}
      {projectCreationParentId !== undefined && (
        <ProjectNameDialog
          parentProjectId={projectCreationParentId}
          onClose={() => setProjectCreationParentId(undefined)}
          onSubmit={async (name, parentProjectId) => {
            setOpenAnswer(null);
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
            setOpenAnswer(null);
            void switchWorkspace(id).then(() => setWorkspaceSwitcherOpen(false));
          }}
          onForget={(id) => void forgetRecentWorkspace(id)}
          onOpen={() => {
            setWorkspaceSwitcherOpen(false);
            setOpenAnswer(null);
            void openWorkspace();
          }}
          onCreate={() => {
            setWorkspaceSwitcherOpen(false);
            setOpenAnswer(null);
            void createWorkspace();
          }}
        />
      )}
      <ProjectToast />
    </div>
  );
}
