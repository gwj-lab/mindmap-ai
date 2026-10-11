import { useEffect, useState } from "react";
import type { AnswerDocument } from "../../../shared/types.js";
import type { ConceptRecord, ConceptSelection } from "../../../shared/concepts.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

export function QuestionAnnotation({ record, onClose, onOpenNote, onRetry }: { record: ConceptRecord; onClose(): void; onOpenNote?(id: string, selection?: ConceptSelection): void; onRetry?(id: string): void }): React.JSX.Element {
  const [answer, setAnswer] = useState<AnswerDocument | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (record.status === "ready") void window.mindmapAI.project.readAnswer(record.answerId).then((result) => {
      if (active) { setAnswer(result); setError(result ? "" : "找不到批注回答文件"); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取答疑失败"); });
    return () => { active = false; };
  }, [record.answerId, record.status]);
  // The portable note also stores the question and backlinks; the card has its
  // own question disclosure and source footer, so display the generated answer.
  const questionStart = answer?.body.lastIndexOf("\n\n## 提问\n\n") ?? -1;
  const body = answer && questionStart >= 0 ? answer.body.slice(0, questionStart) : answer?.body ?? "";
  return <aside className="question-annotation" aria-label="答疑批注" data-annotation-id={record.id}>
    <header><strong>答疑批注</strong><button aria-label="关闭答疑批注" onClick={onClose}>×</button></header>
    <div className="question-annotation-scroll">
      <blockquote>{record.references[0]!.selection.text}</blockquote>
      <details open={record.status !== "ready"}><summary>我的问题</summary><p className="annotation-prompt">{record.prompt}</p></details>
      {record.status === "generating" && <p role="status">正在生成回答…</p>}
      {record.status === "failed" && <div role="alert"><p>{record.error || "生成失败"}</p>{onRetry && <button onClick={() => onRetry(record.id)}>重试答疑</button>}</div>}
      {error && <p role="alert">{error}</p>}
      {record.status === "ready" && !answer && !error && <p>正在读取…</p>}
      {record.status === "ready" && answer && <MarkdownPreview body={body} provider={answer.metadata.provider} onOpenNote={onOpenNote} />}
    </div>
    <footer>{record.references.map((ref, index) => <button key={index} onClick={() => onOpenNote?.(ref.sourceAnswerId, ref.selection)} title={ref.selection.sentence}>定位原文 · {ref.sourceTitle}</button>)}</footer>
  </aside>;
}
