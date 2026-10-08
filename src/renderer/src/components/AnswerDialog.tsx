import { memo, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Edit3, Eye, RefreshCw, Save, X } from "lucide-react";
import { contentHash, extractTitle } from "../../../shared/content.js";
import type { AnswerDocument } from "../../../shared/types.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { ConceptSelectionController } from "../../../shared/concept-selection.js";
import type { ConceptRecord, ConceptRequest, ConceptSelection } from "../../../shared/concepts.js";

interface AnswerDialogProps {
  nodeTitle?: string;
  records?: ConceptRecord[];
  focusSelection?: ConceptSelection;
  onGenerateConcept?(request: ConceptRequest): Promise<void>;
  onOpenNote?(answerId: string, selection?: ConceptSelection): void;
  answerId: string;
  nodeUid: string;
  readOnly?: boolean;
  onClose(): void;
  onRetitle(nodeUid: string, title: string): void;
}

export const AnswerDialog = memo(function AnswerDialog(props: AnswerDialogProps): React.JSX.Element {
  const { onGenerateConcept, onOpenNote, answerId, nodeTitle, records, focusSelection, readOnly } = props;
  const [focusError, setFocusError] = useState("");
  const [answer, setAnswer] = useState<AnswerDocument | null>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [dirty, setDirty] = useState(false);
  const [position, setPosition] = useState({ x: 72, y: 78 });
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pendingPosition = useRef<{ x: number; y: number } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const editorExtensions = useMemo(() => [markdown()], []);
  const [previewBody, setPreviewBody] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewBody(body), mode === "preview" ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [body, mode]);

  useEffect(() => {
    let active = true;
    void window.mindmapAI.project.readAnswer(props.answerId).then((document) => {
      if (!active) return;
      setAnswer(document);
      setBody(document?.body ?? "");
    });
    return () => { active = false; };
  }, [props.answerId]);

  useEffect(() => {
    if (dirty || !props.records) return;
    let active = true;
    void window.mindmapAI.project.readAnswer(props.answerId).then((document) => { if (active && document) { setAnswer(document); setBody(document.body); } });
    return () => { active = false; };
  }, [props.answerId, props.records, dirty]);

  useEffect(() => {
    const root = contentRef.current?.querySelector(".markdown-preview");
    if (!root || mode !== "preview" || readOnly || !onGenerateConcept || !answer) return;
    const controller = new ConceptSelectionController(document, (target) => root.contains(target) ? root : null, (_root, selection) => {
      void (async () => {
        if (dirty) { await window.mindmapAI.project.writeAnswer({ metadata: { ...answer.metadata, contentHash: await contentHash(body), updatedAt: new Date().toISOString() }, body }); setDirty(false); }
        await onGenerateConcept({ sourceAnswerId: answerId, sourceTitle: nodeTitle || answer.metadata.title, selection });
      })().catch((error: unknown) => setFocusError(error instanceof Error ? error.message : "概念生成失败"));
    }, (id) => onOpenNote?.(id));
    controller.setMarks((records ?? []).flatMap((record) => record.status === "ready" || record.status === "generating" ? record.references.filter((ref) => ref.sourceAnswerId === answerId).map((ref) => ({ root, mark: { id: record.answerId, selection: ref.selection, pending: record.status === "generating" } })) : []));
    if (focusSelection && !controller.focus(root, focusSelection)) queueMicrotask(() => setFocusError("来源文字已改变，无法精确定位选词"));
    return () => controller.destroy();
  }, [mode, body, answer, answerId, nodeTitle, records, focusSelection, readOnly, onGenerateConcept, onOpenNote, dirty]);

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      pendingPosition.current = { x: Math.max(8, drag.left + event.clientX - drag.x), y: Math.max(58, drag.top + event.clientY - drag.y) };
      if (animationFrame.current === null) {
        animationFrame.current = window.requestAnimationFrame(() => {
          animationFrame.current = null;
          if (pendingPosition.current) setPosition(pendingPosition.current);
        });
      }
    };
    const up = (): void => {
      dragRef.current = null;
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
      if (pendingPosition.current) setPosition(pendingPosition.current);
      pendingPosition.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const close = (): void => {
    if (dirty && !window.confirm("回答还有未保存的修改。放弃这些修改吗？")) return;
    props.onClose();
  };

  const save = async (): Promise<void> => {
    if (!answer) return;
    const next: AnswerDocument = {
      metadata: {
        ...answer.metadata,
        contentHash: await contentHash(body),
        updatedAt: new Date().toISOString()
      },
      body
    };
    await window.mindmapAI.project.writeAnswer(next);
    setAnswer(next);
    setDirty(false);
  };

  return (
    <aside className="answer-dialog" style={{ left: position.x, top: position.y }} aria-label="回答阅读器">
      <header
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button")) return;
          dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
        }}
      >
        <div><small>LOCAL ANSWER</small><strong>{answer?.metadata.title ?? "正在读取回答…"}</strong></div>
        <nav>
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} />预览</button>
          <button disabled={props.readOnly} className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}><Edit3 size={15} />编辑</button>
          <button disabled={props.readOnly} title="从正文重新提取节点标题" onClick={() => {
            const title = extractTitle(body);
            if (window.confirm(`将节点标题更新为“${title}”？`)) props.onRetitle(props.nodeUid, title);
          }}><RefreshCw size={15} /></button>
          <button disabled={!dirty || props.readOnly} onClick={() => void save()}><Save size={15} />保存</button>
          <button title="关闭" onClick={close}><X size={17} /></button>
        </nav>
      </header>
      <div ref={contentRef} className={`answer-content answer-content--${mode}`}>
        {mode === "edit" && (
          <div className="answer-editor">
            <CodeMirror
              value={body}
              height="100%"
              extensions={editorExtensions}
              onChange={(value) => { setBody(value); setDirty(value !== answer?.body); }}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            />
          </div>
        )}
        <MarkdownPreview body={mode === "preview" ? body : previewBody} provider={answer?.metadata.provider} onOpenNote={props.onOpenNote} />
      </div>
      {answer?.metadata.conceptId && <div className="concept-backlinks"><strong>概念 · 来源与反向链接</strong>{props.records?.find((record) => record.id === answer.metadata.conceptId)?.references.map((ref, index) => <button key={`${ref.sourceAnswerId}-${index}`} onClick={() => props.onOpenNote?.(ref.sourceAnswerId, ref.selection)} title={ref.selection.sentence}>{ref.sourceTitle} · {ref.selection.sentence}</button>)}</div>}
      <footer>
        <span>{answer?.metadata.provider ?? "chatgpt"}</span>
        <span>{focusError || (dirty ? "未保存修改" : "内容已保存")}</span>
      </footer>
    </aside>
  );
});
