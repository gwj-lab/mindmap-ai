import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  History,
  Inbox,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type { CandidateNode, HistoryEntry, ProjectTrashEntry, WorkspaceProjectRecord } from "../../../shared/types.js";
import type { ConceptRecord } from "../../../shared/concepts.js";

type TrayTab = "candidates" | "history" | "trash";

interface NodeTrayProps {
  pendingCaptures?: ReadonlySet<string>;
  projects?: WorkspaceProjectRecord[];
  currentProject?: { projectId: string; name: string };
  concepts?: ConceptRecord[];
  onConceptSettings?(): void;
  onOpenConcept?(record: ConceptRecord): void;
  onConceptAction?(id: string, action: "trash" | "restore" | "delete" | "rename", title?: string): void;
  onRetryConcept?(id: string): void;
  onShowConceptTab?(record: ConceptRecord): void;
  candidates: CandidateNode[];
  history: HistoryEntry[];
  trash: ProjectTrashEntry[];
  readOnly?: boolean;
  onUpdateCandidate(candidate: CandidateNode): void;
  onDeleteCandidate(candidateId: string): void;
  onDeleteHistory(historyId: string): void;
  onRestoreTrash(trashId: string): void;
  onPermanentDelete(trashId: string): void;
  onMapSubtreeDrop(nodeUid: string): void;
}

function trashTitle(entry: ProjectTrashEntry): string {
  if (entry.kind === "candidate") return entry.candidate.title;
  if (entry.kind === "history") return entry.history.subtree.text;
  return entry.subtree.text;
}

export function NodeTray({
  pendingCaptures,
  projects = [], currentProject,
  concepts = [], onConceptSettings, onOpenConcept, onConceptAction, onRetryConcept, onShowConceptTab,
  candidates,
  history,
  trash,
  readOnly = false,
  onUpdateCandidate,
  onDeleteCandidate,
  onDeleteHistory,
  onRestoreTrash,
  onPermanentDelete,
  onMapSubtreeDrop
}: NodeTrayProps): React.JSX.Element {
  const [tab, setTab] = useState<TrayTab>("candidates");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visibleConcepts = concepts.filter((record) => record.status !== "trash");
  const conceptGroups = new Map<string, ConceptRecord[]>();
  for (const record of visibleConcepts) {
    for (const projectId of new Set(record.references.map((ref) => ref.projectId))) {
      const group = conceptGroups.get(projectId) ?? [];
      group.push(record); conceptGroups.set(projectId, group);
    }
  }
  const projectName = (projectId: string): string => projects.find((project) => project.projectId === projectId)?.name ?? (currentProject?.projectId === projectId ? currentProject.name : "已归档项目");
  const beginLocalDrag = (): void => window.mindmapAI?.ai.beginLocalDrag();
  const endLocalDrag = (): void => window.mindmapAI?.ai.endLocalDrag();

  const toggleExpanded = (candidateId: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const moveChild = (candidate: CandidateNode, index: number, direction: -1 | 1): void => {
    const children = [...(candidate.children ?? [])];
    const target = index + direction;
    if (target < 0 || target >= children.length) return;
    [children[index], children[target]] = [children[target]!, children[index]!];
    onUpdateCandidate({ ...candidate, children });
  };

  return (
    <section className="node-tray">
      <div className="node-tray-tabs" role="tablist" aria-label="节点托盘">
        <button role="tab" aria-selected={tab === "candidates"} onClick={() => setTab("candidates")}>
          候选节点 <b>{candidates.length}</b>
        </button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          历史节点 <b>{history.length}</b>
        </button>
        <button role="tab" aria-selected={tab === "trash"} onClick={() => setTab("trash")}>
          垃圾箱 <b>{trash.length + concepts.filter((record) => record.status === "trash").length}</b>
        </button>
      </div>

      {tab === "candidates" && (
        <div className="node-tray-panel" role="tabpanel" aria-label="候选节点">
          <details className="tray-category" open><summary>候选节点 <b>{candidates.length}</b></summary>
          <details className="tray-project" key={currentProject?.projectId ?? "current"} open><summary>{currentProject?.name ?? "当前项目"} <b>{candidates.length}</b></summary>
          {candidates.length === 0 ? (
            <div className="candidate-empty"><Inbox size={24} /><strong>还没有候选节点</strong><span>悬停或手动捕获回答后会出现在这里。</span></div>
          ) : candidates.map((candidate) => {
            const pending = pendingCaptures?.has(candidate.id) ?? false;
            const children = candidate.children ?? [];
            const isExpanded = expanded.has(candidate.id);
            return (
              <article
                className="node-tray-card"
                key={candidate.id}
                draggable={!readOnly && !pending}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-mindmap-candidate", candidate.id);
                  beginLocalDrag();
                }}
                onDragEnd={endLocalDrag}
              >
                <div className="node-tray-card-main">
                  <GripVertical size={15} />
                  <span title={candidate.title}>{candidate.title}</span>
                  {pending && <small role="status">整理中…</small>}
                  {children.length > 0 && (
                    <button aria-label={`${isExpanded ? "收起" : "展开"} ${candidate.title}`} onClick={() => toggleExpanded(candidate.id)}>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                  <button disabled={readOnly || pending} aria-label={`删除候选 ${candidate.title}`} onClick={() => onDeleteCandidate(candidate.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {isExpanded && children.length > 0 && (
                  <ol className="candidate-children">
                    <li className="candidate-root-editor">
                      <input disabled={readOnly || pending} aria-label={`候选标题 ${candidate.title}`} value={candidate.title} onChange={(event) => onUpdateCandidate({ ...candidate, title: event.currentTarget.value })} />
                    </li>
                    {children.map((child, index) => (
                      <li key={child.id}>
                        <input
                          aria-label={`子节点标题 ${child.title}`}
                          value={child.title}
                          disabled={readOnly || pending}
                          onChange={(event) => onUpdateCandidate({
                            ...candidate,
                            children: children.map((item) => item.id === child.id ? { ...item, title: event.currentTarget.value } : item)
                          })}
                        />
                        <button disabled={readOnly || pending || index === 0} aria-label={`上移 ${child.title}`} onClick={() => moveChild(candidate, index, -1)}>↑</button>
                        <button disabled={readOnly || pending || index === children.length - 1} aria-label={`下移 ${child.title}`} onClick={() => moveChild(candidate, index, 1)}>↓</button>
                        <button
                          disabled={readOnly || pending}
                          aria-label={`移除 ${child.title}`}
                          onClick={() => onUpdateCandidate({ ...candidate, children: children.filter((item) => item.id !== child.id) })}
                        ><X size={12} /></button>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            );
          })}
          </details></details>
          {onConceptSettings && <section className="concept-library" aria-label="概念节点库">
            <button className="concept-library-settings" aria-label="概念生成设置" onClick={onConceptSettings}>设置</button>
            <details className="tray-category" open><summary>概念节点 <b>{visibleConcepts.length}</b></summary>
            {visibleConcepts.length === 0 && <p className="concept-library-empty">在文档或 AI 回答中划词，再次点击原位标签生成概念。</p>}
            {[...conceptGroups].sort(([left], [right]) => Number(right === currentProject?.projectId) - Number(left === currentProject?.projectId)).map(([projectId, records]) => <details key={projectId} className="tray-project" open><summary>{projectName(projectId)} <b>{records.length}</b>{projectId === currentProject?.projectId && <small>当前</small>}</summary>
            {records.map((record) => <article key={record.id} className="node-tray-card concept-node-card" data-concept-id={record.id} draggable={!readOnly && record.status === "ready"} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData("application/x-mindmap-candidate", record.id); beginLocalDrag(); }} onDragEnd={endLocalDrag} onDoubleClick={() => record.status === "ready" && onOpenConcept?.(record)}>
              <div className="node-tray-card-main"><GripVertical size={15} /><span title={record.references[0]?.selection.sentence}>{record.title}</span><small className="concept-tag">概念</small><button disabled={readOnly || record.status === "generating"} aria-label={`删除概念 ${record.title}`} onClick={() => onConceptAction?.(record.id, "trash")}><Trash2 size={14} /></button></div>
              {record.status === "ready" ? <div className="concept-node-actions"><button aria-label={`打开概念 ${record.title}`} onClick={() => onOpenConcept?.(record)}>阅读</button><button disabled={readOnly} onClick={() => toggleExpanded(record.id)}>改名</button>{expanded.has(record.id) && <input aria-label={`概念标题 ${record.title}`} defaultValue={record.title} maxLength={160} onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== record.title) onConceptAction?.(record.id, "rename", title); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}</div> : <div className="concept-node-actions"><span title={record.error}>{record.status === "generating" ? "生成中…" : record.error || "生成失败"}</span>{record.status === "failed" && <button disabled={readOnly} onClick={() => onRetryConcept?.(record.id)}>重试</button>}<button onClick={() => onShowConceptTab?.(record)}>查看生成页面</button></div>}
            </article>)}</details>)}
            </details>
          </section>}
        </div>
      )}

      {tab === "history" && (
        <div
          className="node-tray-panel node-tray-history"
          role="tabpanel"
          aria-label="历史节点"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("application/x-mindmap-subtree")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            const nodeUid = event.dataTransfer.getData("application/x-mindmap-subtree");
            if (!nodeUid) return;
            event.preventDefault();
            onMapSubtreeDrop(nodeUid);
            endLocalDrag();
          }}
        >
          {history.length === 0 ? (
            <div className="candidate-empty"><History size={24} /><strong>暂无历史节点</strong><span>把导图节点拖到这里，或使用右键菜单。</span></div>
          ) : history.map((entry) => (
            <article
              className="node-tray-card"
              key={entry.id}
              draggable={!readOnly}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-mindmap-history", entry.id);
                beginLocalDrag();
              }}
              onDragEnd={endLocalDrag}
            >
              <div className="node-tray-card-main">
                <GripVertical size={15} /><span>{entry.subtree.text}</span>
                <small>{entry.subtree.children.length} 子节点</small>
                <button disabled={readOnly} aria-label={`删除历史 ${entry.subtree.text}`} onClick={() => onDeleteHistory(entry.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "trash" && (
        <div className="node-tray-panel" role="tabpanel" aria-label="垃圾箱">
          {concepts.filter((record) => record.status === "trash").map((record) => <article className="node-tray-card" key={record.id}><div className="node-tray-card-main"><span>{record.title}</span><small className="concept-tag">概念</small><button disabled={readOnly} aria-label={`恢复概念 ${record.title}`} onClick={() => onConceptAction?.(record.id, "restore")}><RotateCcw size={13} /></button><button disabled={readOnly} aria-label={`彻底删除概念 ${record.title}`} onClick={() => onConceptAction?.(record.id, "delete")}><X size={13} /></button></div></article>)}
          {trash.length === 0 && !concepts.some((record) => record.status === "trash") ? (
            <div className="candidate-empty"><Trash2 size={24} /><strong>垃圾箱为空</strong></div>
          ) : trash.map((entry) => {
            const title = trashTitle(entry);
            return (
              <article className="node-tray-card node-tray-card--trash" key={entry.id}>
                <div className="node-tray-card-main">
                  <Trash2 size={14} /><span>{title}</span>
                  <button disabled={readOnly} aria-label={`恢复 ${title}`} onClick={() => onRestoreTrash(entry.id)}><RotateCcw size={13} /></button>
                  <button disabled={readOnly} aria-label={`彻底删除 ${title}`} onClick={() => onPermanentDelete(entry.id)}><X size={13} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
