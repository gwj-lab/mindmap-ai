import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import type { PublicAiSettings, UiPreferences } from "../../../shared/types.js";

interface AiSettingsPageProps {
  titleSource: UiPreferences["titleSource"];
  onTitleSourceChange(source: UiPreferences["titleSource"]): void;
  onClose(): void;
}

export function AiSettingsPage({ titleSource, onTitleSourceChange, onClose }: AiSettingsPageProps): React.JSX.Element {
  const [settings, setSettings] = useState<PublicAiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    void window.mindmapAI.settings.getPublicSettings()
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setBaseUrl(loaded.baseUrl);
        setModel(loaded.model);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setHasError(true);
        setMessage(error instanceof Error ? error.message : "读取设置失败");
      });
    return () => { active = false; };
  }, []);

  const save = async (): Promise<void> => {
    setMessage("");
    setHasError(false);
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:") throw new Error("Base URL 必须使用 HTTPS");
      if (parsed.username || parsed.password) throw new Error("Base URL 不能包含用户名或密码");
      if (!model.trim()) throw new Error("模型名称不能为空");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "设置无效");
      return;
    }
    const changedBaseUrl = settings !== null && parsed.href.replace(/\/$/, "") !== settings.baseUrl.replace(/\/$/, "");
    let confirmed = false;
    if (changedBaseUrl && settings?.hasApiKey) {
      confirmed = window.confirm("Base URL 已更改。确认把已保存的 API 密钥用于这个新地址？");
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const updated = await window.mindmapAI.settings.updatePublicSettings({ baseUrl, model }, confirmed);
      if (apiKey.trim()) {
        await window.mindmapAI.settings.setApiKey(apiKey);
        setApiKey("");
        setSettings({ ...updated, hasApiKey: true });
      } else {
        setSettings(updated);
      }
      setMessage("设置已保存");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSaving(false);
    }
  };

  const clearApiKey = async (): Promise<void> => {
    if (!settings) return;
    setMessage("");
    setHasError(false);
    try {
      await window.mindmapAI.settings.clearApiKey();
      setSettings({ ...settings, hasApiKey: false });
      setMessage("API 密钥已清除");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "清除密钥失败");
    }
  };

  const testConnection = async (): Promise<void> => {
    setMessage("");
    setHasError(false);
    setTesting(true);
    try {
      const result = await window.mindmapAI.settings.testConnection({
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey } : {})
      });
      setHasError(!result.ok);
      setMessage(result.message);
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="api-settings-page" role="main" aria-label="API 配置">
      <header>
        <div>
          <span className="api-settings-eyebrow">MODEL CONNECTION</span>
          <h1>API 配置</h1>
        </div>
        <button onClick={onClose} aria-label="返回工作区"><ArrowLeft size={15} />返回工作区</button>
      </header>
      <div className="api-settings-card">
        <div className="api-settings-title"><KeyRound size={18} /><div><strong>OpenAI 兼容连接</strong><span>应用级单一连接</span></div></div>
        <fieldset>
          <legend>条目名称来源</legend>
          {(["local", "automatic", "api"] as const).map((source) => (
            <label key={source}>
              <input type="radio" name="title-source" checked={titleSource === source} onChange={() => onTitleSourceChange(source)} />
              {source === "local" ? "本地规则" : source === "automatic" ? "自动（有密钥用 API）" : "优先 API"}
            </label>
          ))}
        </fieldset>
        <div className="api-provider-presets">
          <span>服务商预设</span>
          <button onClick={() => { setBaseUrl("https://api.deepseek.com"); setModel("deepseek-chat"); }}>
            使用 DeepSeek 配置
          </button>
        </div>
        <label>Base URL<input aria-label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="https://api.example.com/v1" /></label>
        <label>模型<input aria-label="模型" value={model} onChange={(event) => setModel(event.currentTarget.value)} /></label>
        <label>API 密钥<input aria-label="API 密钥" type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={settings?.hasApiKey ? "输入新密钥以替换" : "仅由系统加密存储"} /></label>
        <div className="key-status"><ShieldCheck size={14} />{settings?.hasApiKey ? "API 密钥已安全保存" : "尚未保存 API 密钥"}</div>
        <div className="api-settings-usage">
          <strong>连接用途</strong>
          <span>单一节点：根据截取内容生成标题，不创建子方案。</span>
          <span>生成子节点：生成标题，并按内容给出最多 12 个有序子方案。</span>
          <span>连接失败或响应无效时自动使用本地规则，回答和候选仍会保存。</span>
        </div>
        {message && <p className="settings-message" role={hasError ? "alert" : "status"}>{message}</p>}
        <div className="api-settings-actions">
          {settings?.hasApiKey && <button onClick={() => void clearApiKey()}>清除密钥</button>}
          <span />
          <button disabled={testing || !settings} onClick={() => void testConnection()}>{testing ? "正在测试…" : "测试连接"}</button>
          <button className="primary" disabled={saving || !settings} onClick={() => void save()}>{saving ? "正在保存…" : "保存设置"}</button>
        </div>
      </div>
    </section>
  );
}
