import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, Tags } from "lucide-react";
import type { ConceptRecord } from "../../../shared/concepts.js";
import type { AnswerDocument } from "../../../shared/types.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

function ConceptPreview({ record, onOpen, onOpenNote }: { record: ConceptRecord; onOpen(): void; onOpenNote(answerId: string): void }): React.JSX.Element {
  const [result, setResult] = useState<{ answerId: string; document: AnswerDocument | null; error?: string } | null>(null);
  useEffect(() => {
    let mounted = true;
    if (record.status === "ready") void window.mindmapAI.project.readAnswer(record.answerId).then((document) => {
      if (mounted) setResult({ answerId: record.answerId, document, error: document ? undefined : "找不到概念笔记" });
    }).catch((cause: unknown) => { if (mounted) setResult({ answerId: record.answerId, document: null, error: cause instanceof Error ? cause.message : "读取概念失败" }); });
    return () => { mounted = false; };
  }, [record]);
  const current = result?.answerId === record.answerId ? result : null;
  return <div className="concept-tab-preview" onDoubleClick={(event) => {
    const target = event.target as Element;
    // Chromium may select nearby text even when double-clicking padding. The
    // event target identifies blank space; inspecting the resulting selection doesn't.
    if ((target === event.currentTarget || target.matches(".markdown-preview,.concept-preview-hint")) && record.status === "ready") onOpen();
  }}>
    {record.status === "generating" ? <p className="concept-preview-message">概念正在生成，完成后会显示在这里。</p> : record.status === "failed" ? <p className="concept-preview-message" role="alert">{record.error || "生成失败，可在概念库中重试。"}</p> : current?.error ? <p className="concept-preview-message" role="alert">{current.error}</p> : current?.document ? <MarkdownPreview body={current.document.body} provider={current.document.metadata.provider} onOpenNote={onOpenNote} /> : <p className="concept-preview-message">正在读取概念…</p>}
    {record.status === "ready" && <div className="concept-preview-hint">双击空白处，完整打开</div>}
  </div>;
}

export function ConceptSidebar({ records, selectedId, onSelect, onOpen, onOpenNote }: {
  records: ConceptRecord[]; selectedId: string | null;
  onSelect(id: string | null): void; onOpen(id: string): void; onOpenNote(answerId: string): void;
}): React.JSX.Element {
  return <aside className="reader-concept-sidebar" aria-label="关联概念">
    <header><Tags size={16} /><strong>关联概念</strong><span>{records.length}</span></header>
    <div className="concept-tab-list">
      {!records.length && <p className="concept-sidebar-empty">选中正文中的词语，再点击标记生成概念。相关概念会收纳在这里。</p>}
      {records.map((record) => {
        const selected = record.answerId === selectedId;
        return <section className={`concept-tab${selected ? " concept-tab--expanded" : ""}`} key={record.answerId}>
          <div className="concept-tab-heading">
            <button className="concept-tab-title" aria-expanded={selected} aria-controls={`concept-preview-${record.id}`} onClick={() => onSelect(selected ? null : record.answerId)} title={record.title}>
              {selected ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>{record.title}</span>
              {record.status !== "ready" && <small>{record.status === "generating" ? "生成中" : "失败"}</small>}
            </button>
            {selected && record.status === "ready" && <button className="concept-tab-open" aria-label={`完整打开概念：${record.title}`} title="完整打开概念" onClick={() => onOpen(record.answerId)}><Maximize2 size={14} /></button>}
          </div>
          {selected && <div id={`concept-preview-${record.id}`}><ConceptPreview record={record} onOpen={() => onOpen(record.answerId)} onOpenNote={onOpenNote} /></div>}
        </section>;
      })}
    </div>
  </aside>;
}
