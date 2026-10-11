import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { ArrowLeft, Copy, ClipboardPaste, Edit3, Eye, RefreshCw, Save, X } from "lucide-react";
import { isEditableTarget } from "../keyboard.js";
import { contentHash, extractTitle } from "../../../shared/content.js";
import type { AnswerDocument } from "../../../shared/types.js";
import { ConceptSelectionController } from "../../../shared/concept-selection.js";
import type { ConceptRecord, ConceptRequest, ConceptSelection } from "../../../shared/concepts.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { QuestionAnnotation } from "./QuestionAnnotation.js";

export interface AnswerPaneProps {
  answerId: string;
  nodeUid: string;
  nodeTitle?: string;
  records?: ConceptRecord[];
  focusSelection?: ConceptSelection;
  readOnly?: boolean;
  active: boolean;
  controls: ReactNode;
  onGenerateConcept?(request: ConceptRequest): Promise<void>;
  onAskQuestion?(request: ConceptRequest): void;
  onRetryQuestion?(id: string): void;
  onOpenNote?(answerId: string, selection?: ConceptSelection): void;
  onRetitle(nodeUid: string, title: string): void;
  onDirtyChange(answerId: string, dirty: boolean): void;
  onBack?(): void;
  onDragStart(event: ReactPointerEvent<HTMLElement>): void;
  onToggleMaximize(): void;
}

// Keep documents mounted while navigating, preserving edits and reading position.
export const AnswerPane = memo(function AnswerPane(props: AnswerPaneProps): React.JSX.Element {
  const { answerId, nodeTitle, records, focusSelection, readOnly, active, onGenerateConcept, onAskQuestion, onOpenNote, onDirtyChange } = props;
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerDocument | null>(null);
  const [body, setBody] = useState("");
  const [previewBody, setPreviewBody] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [editorWidth, setEditorWidth] = useState(50);
  const splitPointer = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = !!answer && body !== answer.body;
  const dirtyRef = useRef(dirty);
  const bodyRef = useRef(body);
  const focusedSelection = useRef<ConceptSelection | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const editorExtensions = useMemo(() => [markdown()], []);
  const updateEditorWidth = (value: number): void => setEditorWidth(Math.max(20, Math.min(80, value)));
  const resizeEditor = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (splitPointer.current !== event.pointerId || !contentRef.current) return;
    const bounds = contentRef.current.getBoundingClientRect();
    if (bounds.width > 0) updateEditorWidth((event.clientX - bounds.left) / bounds.width * 100);
  };
  useEffect(() => { dirtyRef.current = dirty; onDirtyChange(answerId, dirty); }, [dirty, answerId, onDirtyChange]);
  useEffect(() => { bodyRef.current = body; }, [body]);

  useEffect(() => {
    if (dirtyRef.current) return;
    let mounted = true;
    void window.mindmapAI.project.readAnswer(answerId).then((document) => {
      if (!mounted || dirtyRef.current) return;
      setAnswer(document); setBody(document?.body ?? "");
      if (document?.metadata.origin === 'local' && !document.body) setMode('edit');
      setError(document ? "" : "找不到这篇笔记，文件可能已被移动或删除。");
    }).catch((cause: unknown) => { if (mounted) setError(cause instanceof Error ? cause.message : "读取笔记失败"); });
    return () => { mounted = false; };
  }, [answerId, records]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewBody(body), mode === "preview" ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [body, mode]);

  useEffect(() => {
    const root = contentRef.current?.querySelector(".markdown-preview");
    if (!root || !active || mode !== "preview" || !answer) return;
    const request = async (selection: ConceptSelection): Promise<ConceptRequest> => {
      if (dirty) {
        const next = { metadata: { ...answer.metadata, contentHash: await contentHash(body), updatedAt: new Date().toISOString() }, body };
        await window.mindmapAI.project.writeAnswer(next); setAnswer(next);
      }
      return { sourceAnswerId: answerId, sourceTitle: nodeTitle || answer.metadata.title, selection };
    };
    const controller = new ConceptSelectionController(document, (target) => root.contains(target) ? root : null, (_root, selection) => {
      void (async () => {
        if (onGenerateConcept) await onGenerateConcept(await request(selection));
      })().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "概念生成失败"));
    }, (id) => {
      if (records?.some((record) => record.answerId === id && record.kind === "qa")) setAnnotationId(id);
      else onOpenNote?.(id);
    }, { preserveSelection: true, readOnly: readOnly || (!onGenerateConcept && !onAskQuestion), onAsk: onAskQuestion ? (_root, selection) => {
      void request(selection).then(onAskQuestion).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "答疑选取失败"));
    } : undefined });
    controller.setMarks((records ?? []).flatMap((record) => record.status === "ready" || record.status === "generating" || (record.kind === "qa" && record.status === "failed") ? record.references.filter((ref) => ref.sourceAnswerId === answerId).map((ref) => ({ root, mark: { id: record.answerId, selection: ref.selection, pending: record.status === "generating", kind: record.kind } })) : []));
    if (focusSelection && focusedSelection.current !== focusSelection) {
      focusedSelection.current = focusSelection;
      if (!controller.focus(root, focusSelection)) queueMicrotask(() => setError("来源文字已改变，无法精确定位选词"));
    }
    return () => controller.destroy();
  }, [mode, body, answer, answerId, nodeTitle, records, focusSelection, readOnly, active, onGenerateConcept, onAskQuestion, onOpenNote, dirty]);

  const save = async (): Promise<void> => {
    if (!answer || readOnly || saving || !dirty) return;
    setSaving(true);
    try {
      const next: AnswerDocument = { metadata: { ...answer.metadata, contentHash: await contentHash(body), updatedAt: new Date().toISOString() }, body };
      await window.mindmapAI.project.writeAnswer(next);
      // The repository may append backlinks; show the exact saved document.
      const saved = await window.mindmapAI.project.readAnswer(answerId) ?? next;
      setAnswer(saved);
      if (bodyRef.current === body) setBody(saved.body);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  };

  const concept = records?.find((record) => record.answerId === answerId);
  const copyText = async (): Promise<void> => {
    const selection = document.getSelection();
    const view = mode === "edit" ? editorRef.current?.view : undefined;
    const selected = view && !view.state.selection.main.empty ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : selection?.anchorNode && contentRef.current?.contains(selection.anchorNode) ? selection.toString() : "";
    try { await window.mindmapAI.clipboard.writeText(selected || body); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "复制失败"); }
  };
  const insertText = (text: string): void => {
    if (!text || readOnly || !answer) return;
    const view = mode === "edit" ? editorRef.current?.view : undefined;
    if (view) { const selection = view.state.selection.main; view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length } }); view.focus(); }
    else { setBody((current) => current + (current && !current.endsWith("\n") ? "\n\n" : "") + text); setMode("edit"); }
    setError("");
  };
  const pasteText = async (): Promise<void> => {
    try { insertText(await window.mindmapAI.clipboard.readText()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "粘贴失败"); }
  };
  const annotations = records?.filter((record) => record.kind === "qa" && record.status !== "trash" && record.references.some((ref) => ref.sourceAnswerId === answerId)) ?? [];
  const annotation = annotations.find((record) => record.answerId === annotationId);
  return (
    <section className="answer-pane" hidden={!active} data-answer-id={answerId} data-dirty={dirty} tabIndex={-1} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && !isEditableTarget(event.target) && ["c", "v"].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation();
        if (event.key.toLowerCase() === "c") void copyText(); else if (!readOnly) void pasteText();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopPropagation(); void save();
      }
    }} onPasteCapture={(event) => { if (mode === "preview" && !isEditableTarget(event.target) && !readOnly && answer) { event.preventDefault(); insertText(event.clipboardData.getData("text/plain")); } }}>
      <header onPointerDown={props.onDragStart} onDoubleClick={(event) => { if (!(event.target as Element).closest("button")) props.onToggleMaximize(); }}>
        {props.onBack && <button className="reader-back" title="回退到节点页面" aria-label="回退到节点页面" onClick={props.onBack}><ArrowLeft size={18} /></button>}
        <div className="answer-heading"><small>{concept?.kind === "qa" || answer?.metadata.annotationId ? "答疑批注" : concept || answer?.metadata.conceptId ? "概念笔记" : "节点笔记"}</small><strong>{concept?.title ?? nodeTitle ?? answer?.metadata.title ?? "正在读取笔记…"}</strong></div>
        <nav aria-label="阅读操作">
          <button data-preserve-selection aria-label="复制阅读内容" title="复制选中文字，无选区时复制 Markdown 正文（Ctrl+C）" disabled={!answer} onMouseDown={(event) => event.preventDefault()} onClick={() => void copyText()}><Copy size={15} />复制</button>
          <button aria-label="粘贴到笔记" title="粘贴文本到编辑草稿（Ctrl+V）" disabled={readOnly || !answer} onMouseDown={(event) => event.preventDefault()} onClick={() => void pasteText()}><ClipboardPaste size={15} />粘贴</button>
          <button title="预览" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} />预览</button>
          <button title="编辑" disabled={readOnly || !answer} className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}><Edit3 size={15} />编辑</button>
          {mode === "edit" && <button title="关闭编辑，保留未保存修改" aria-label="关闭编辑页面" onClick={() => { splitPointer.current = null; setMode("preview"); }}><X size={15} />关闭编辑</button>}
          <button disabled={readOnly || !props.nodeUid || !answer} title="从正文重新提取节点标题" onClick={() => {
            const title = extractTitle(body);
            if (window.confirm(`将节点标题更新为“${title}”？`)) props.onRetitle(props.nodeUid, title);
          }}><RefreshCw size={15} /></button>
          <button title="保存笔记（Ctrl+S）" disabled={!dirty || readOnly || saving} onClick={() => void save()}><Save size={15} />保存</button>
          {props.controls}
        </nav>
      </header>
      <div ref={contentRef} className={`answer-content answer-content--${mode}`} style={{ "--editor-width": `${editorWidth}%` } as CSSProperties} onPointerDown={(event) => {
        if (mode === "preview" && !(event.target as Element).closest("button, a, input, textarea, [contenteditable]")) event.currentTarget.closest<HTMLElement>(".answer-pane")?.focus({ preventScroll: true });
      }}>
        {mode === "edit" && <div className="answer-editor"><CodeMirror ref={editorRef} value={body} height="100%" extensions={editorExtensions}
          onChange={setBody} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }} /></div>}
        {mode === "edit" && <div className="answer-editor-separator" role="separator" aria-label="调整 Markdown 与预览宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(editorWidth)} tabIndex={0}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); splitPointer.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); }}
          onPointerMove={resizeEditor} onPointerUp={(event) => { if (splitPointer.current === event.pointerId) { splitPointer.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); } }}
          onPointerCancel={() => { splitPointer.current = null; }} onLostPointerCapture={() => { splitPointer.current = null; }}
          onDoubleClick={() => updateEditorWidth(50)} onKeyDown={(event) => {
            const next = event.key === "ArrowLeft" ? editorWidth - 5 : event.key === "ArrowRight" ? editorWidth + 5 : event.key === "Home" ? 20 : event.key === "End" ? 80 : null;
            if (next !== null) { event.preventDefault(); event.stopPropagation(); updateEditorWidth(next); }
          }} />}
        <MarkdownPreview body={mode === "preview" ? body : previewBody} provider={answer?.metadata.provider} onOpenNote={onOpenNote} />
      </div>
      {annotations.length > 0 && <nav className="answer-annotations" aria-label="原文答疑"><strong>答疑</strong>{annotations.map((record) => <button key={record.id} aria-label={`查看答疑：${record.title}`} aria-pressed={annotationId === record.answerId} onClick={() => setAnnotationId(record.answerId)}>{record.title}{record.status === "generating" ? " · 生成中" : record.status === "failed" ? " · 失败" : ""}</button>)}</nav>}
      {annotation && <QuestionAnnotation record={annotation} onClose={() => setAnnotationId(null)} onOpenNote={(id, selection) => { setAnnotationId(null); onOpenNote?.(id, selection); }} onRetry={readOnly ? undefined : props.onRetryQuestion} />}
      {concept && <div className="concept-backlinks"><strong>来源与反向链接</strong>{concept.references.map((ref, index) => <button key={`${ref.sourceAnswerId}-${index}`} onClick={() => onOpenNote?.(ref.sourceAnswerId, ref.selection)} title={ref.selection.sentence}>{ref.sourceTitle} · {ref.selection.sentence}</button>)}</div>}
      <footer><span>{answer?.metadata.origin === 'local' ? '本机文档' : answer?.metadata.provider ?? "本地笔记"}</span><span role={error ? "alert" : undefined}>{error || (saving ? "正在保存…" : dirty ? "未保存修改" : readOnly ? "只读" : "内容已保存")}</span></footer>
    </section>
  );
});
