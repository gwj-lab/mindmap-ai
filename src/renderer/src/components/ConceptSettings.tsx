import { useState } from "react";
import { DEFAULT_CONCEPT_SETTINGS, type ConceptSettings as Settings } from "../../../shared/concepts.js";

export function ConceptSettings({ settings, onSave, onClose }: { settings: Settings; onSave(settings: Settings): Promise<void>; onClose(): void }): React.JSX.Element {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <div className="dialog-backdrop"><section className="concept-settings" role="dialog" aria-label="概念生成设置">
    <h2>概念生成设置</h2>
    <label>生成网站<select aria-label="概念生成网站" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as Settings["provider"] })}><option value="current">跟随来源平台</option><option value="chatgpt">ChatGPT</option><option value="yuanbao">腾讯元宝</option><option value="doubao">豆包</option></select></label>
    <label className="concept-background"><input type="checkbox" checked={draft.background} onChange={(event) => setDraft({ ...draft, background: event.target.checked })} />后台生成，不切换当前标签页</label>
    <label>生成提示词<textarea aria-label="概念生成提示词" rows={6} maxLength={4000} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></label>
    <p>必须包含 {'{concept}'} 和 {'{sentence}'}；{'{title}'} 表示当前节点标题。句子会完整提供，标题或表格使用所在项的完整内容。</p>
    <p>登录、验证或生成失败时，可在概念节点区打开生成页面处理后重试。</p>
    {error && <p role="alert">{error}</p>}
    <footer><button disabled={saving} onClick={() => setDraft({ ...DEFAULT_CONCEPT_SETTINGS })}>恢复默认</button><button disabled={saving} onClick={onClose}>取消</button><button disabled={saving} onClick={() => { setSaving(true); void onSave(draft).then(onClose).catch((error: unknown) => setError(error instanceof Error ? error.message : "保存设置失败")).finally(() => setSaving(false)); }}>保存设置</button></footer>
  </section></div>;
}
