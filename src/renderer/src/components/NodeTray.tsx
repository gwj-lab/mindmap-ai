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
import type { CandidateNode, HistoryEntry, ProjectTrashEntry } from "../../../shared/types.js";

type TrayTab = "candidates" | "history" | "trash";

interface NodeTrayProps {
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
          垃圾箱 <b>{trash.length}</b>
        </button>
      </div>

      {tab === "candidates" && (
        <div className="node-tray-panel" role="tabpanel" aria-label="候选节点">
          {candidates.length === 0 ? (
            <div className="candidate-empty"><Inbox size={24} /><strong>还没有候选节点</strong><span>悬停或手动捕获回答后会出现在这里。</span></div>
          ) : candidates.map((candidate) => {
            const children = candidate.children ?? [];
            const isExpanded = expanded.has(candidate.id);
            return (
              <article
                className="node-tray-card"
                key={candidate.id}
                draggable={!readOnly}
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
                  {children.length > 0 && (
                    <button aria-label={`${isExpanded ? "收起" : "展开"} ${candidate.title}`} onClick={() => toggleExpanded(candidate.id)}>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                  <button disabled={readOnly} aria-label={`删除候选 ${candidate.title}`} onClick={() => onDeleteCandidate(candidate.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {isExpanded && children.length > 0 && (
                  <ol className="candidate-children">
                    <li className="candidate-root-editor">
                      <input aria-label={`候选标题 ${candidate.title}`} value={candidate.title} onChange={(event) => onUpdateCandidate({ ...candidate, title: event.currentTarget.value })} />
                    </li>
                    {children.map((child, index) => (
                      <li key={child.id}>
                        <input
                          aria-label={`子节点标题 ${child.title}`}
                          value={child.title}
                          onChange={(event) => onUpdateCandidate({
                            ...candidate,
                            children: children.map((item) => item.id === child.id ? { ...item, title: event.currentTarget.value } : item)
                          })}
                        />
                        <button disabled={readOnly || index === 0} aria-label={`上移 ${child.title}`} onClick={() => moveChild(candidate, index, -1)}>↑</button>
                        <button disabled={readOnly || index === children.length - 1} aria-label={`下移 ${child.title}`} onClick={() => moveChild(candidate, index, 1)}>↓</button>
                        <button
                          disabled={readOnly}
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
          {trash.length === 0 ? (
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
