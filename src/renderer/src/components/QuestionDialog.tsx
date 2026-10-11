import { useState } from "react";
import { DEFAULT_QUESTION_SETTINGS, questionPrompt, questionSettingsSchema, type ConceptRequest, type QuestionSettings } from "../../../shared/concepts.js";
import { AI_PROVIDERS, PROVIDER_IDS } from "../../../shared/ai-providers.js";

export function QuestionDialog({ request, settings = DEFAULT_QUESTION_SETTINGS, onSubmit, onSaveSettings, onClose }: { request: ConceptRequest; settings?: QuestionSettings; onSubmit(question: string, settings: QuestionSettings): Promise<void>; onSaveSettings(settings: QuestionSettings): Promise<void>; onClose(): void }): React.JSX.Element {
  const [draft, setDraft] = useState(settings);
  const [question, setQuestion] = useState(() => questionPrompt(request, settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="question-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="question-dialog" role="dialog" aria-modal="true" aria-label="对原文提问" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }} onSubmit={(event) => {
      event.preventDefault(); if (busy || !question.trim()) return;
      const parsed = questionSettingsSchema.safeParse(draft);
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "答疑设置无效"); return; }
      setBusy(true); setError("");
      void onSubmit(question.trim(), parsed.data).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "答疑生成失败")).finally(() => setBusy(false));
    }}>
      <header><strong>答疑</strong><button type="button" aria-label="关闭提问框" disabled={busy} onClick={onClose}>×</button></header>
      <details className="question-settings"><summary>答疑设置 · {draft.provider === "current" ? "跟随来源平台" : AI_PROVIDERS[draft.provider].name}</summary>
        <fieldset disabled={busy}>
          <label>网页模型<select aria-label="答疑网页模型" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as QuestionSettings["provider"] })}><option value="current">跟随来源平台</option>{PROVIDER_IDS.map((id) => <option key={id} value={id}>{AI_PROVIDERS[id].name}</option>)}</select></label>
          <label>初始提示词<textarea aria-label="答疑初始提示词" rows={4} maxLength={4000} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></label>
          <p>必须包含 {'{selection}'}（所选原文）；{'{title}'} 为主题，{'{sentence}'} 为上下文。设置用于后续答疑。</p>
          <div className="question-settings-actions"><button type="button" onClick={() => setDraft({ ...DEFAULT_QUESTION_SETTINGS })}>恢复默认</button><button type="button" onClick={() => {
            const parsed = questionSettingsSchema.safeParse(draft);
            if (parsed.success) { setQuestion(questionPrompt(request, parsed.data)); setError(""); }
            else setError(parsed.error.issues[0]?.message ?? "答疑设置无效");
          }}>应用到本次问题</button><button type="button" onClick={() => {
            const parsed = questionSettingsSchema.safeParse(draft);
            if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "答疑设置无效"); return; }
            setBusy(true); setError("");
            void onSaveSettings(parsed.data).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "保存答疑设置失败")).finally(() => setBusy(false));
          }}>保存答疑设置</button></div>
        </fieldset>
      </details>
      <blockquote>{request.selection.text}</blockquote>
      <label htmlFor="annotation-question">自定义问题</label>
      <textarea id="annotation-question" autoFocus disabled={busy} maxLength={40000} value={question} onChange={(event) => setQuestion(event.target.value)} />
      <p>回答会绑定这段原文，保存在答疑批注中。</p>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !question.trim()}>{busy ? "正在发起…" : "发送问题"}</button></footer>
    </form>
  </div>;
}
