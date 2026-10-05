import { memo, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { Edit3, Eye, RefreshCw, Save, X } from "lucide-react";
import { contentHash, extractTitle } from "../../../shared/content.js";
import type { AnswerDocument } from "../../../shared/types.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

interface AnswerDialogProps {
  answerId: string;
  nodeUid: string;
  readOnly?: boolean;
  onClose(): void;
  onRetitle(nodeUid: string, title: string): void;
}

export const AnswerDialog = memo(function AnswerDialog(props: AnswerDialogProps): React.JSX.Element {
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
      <div className={`answer-content answer-content--${mode}`}>
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
        <MarkdownPreview body={mode === "preview" ? body : previewBody} />
      </div>
      <footer>
        <span>{answer?.metadata.provider ?? "chatgpt"}</span>
        <span>{dirty ? "未保存修改" : "内容已保存"}</span>
      </footer>
    </aside>
  );
});
