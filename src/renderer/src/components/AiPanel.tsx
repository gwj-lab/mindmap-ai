import { useEffect, useRef, useState } from "react";
import { Crosshair, ListTree, MousePointer2, Settings, ShieldCheck } from "lucide-react";
import type { ProviderId, UiPreferences } from "../../../shared/types.js";
import { AI_PROVIDERS } from "../../../shared/ai-providers.js";

interface AiPanelProps {
  tabId?: string;
  provider?: ProviderId;
  readOnly?: boolean;
  autoHoverCapture: boolean;
  captureMode: UiPreferences["captureMode"];
  onAutoHoverCaptureChange(enabled: boolean): void;
  onCaptureModeChange(mode: UiPreferences["captureMode"]): void;
  onOpenSettings(): void;
}

export function AiPanel({
  tabId = "ai",
  provider = "chatgpt",
  readOnly = false,
  autoHoverCapture,
  captureMode,
  onAutoHoverCaptureChange,
  onCaptureModeChange,
  onOpenSettings
}: AiPanelProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [expansionPrompt, setExpansionPrompt] = useState("");

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let previousVisible: boolean | null = null;
    let previousBounds = "";
    const update = (): void => {
      const rect = surface.getBoundingClientRect();
      const nextVisible = rect.width > 8 && rect.height > 8 && getComputedStyle(surface).visibility !== "hidden";
      if (nextVisible !== previousVisible) {
        previousVisible = nextVisible;
        setVisible(nextVisible);
        window.mindmapAI.ai.setPanelVisible(nextVisible, tabId);
      }
      if (nextVisible) {
        const bounds = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
        const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
        if (key !== previousBounds) {
          previousBounds = key;
          window.mindmapAI.ai.setPanelBounds(bounds, tabId);
        }
      }
    };
    const resize = new ResizeObserver(update);
    const intersection = new IntersectionObserver(update, { threshold: 0.01 });
    resize.observe(surface);
    intersection.observe(surface);
    update();
    window.addEventListener("resize", update);
    return () => {
      resize.disconnect();
      intersection.disconnect();
      window.removeEventListener("resize", update);
      if (previousVisible !== false) window.mindmapAI.ai.setPanelVisible(false, tabId);
    };
  }, [tabId]);

  useEffect(() => {
    window.mindmapAI.ai.setHoverCapture(autoHoverCapture && !readOnly, tabId);
  }, [autoHoverCapture, readOnly, tabId]);

  useEffect(() => {
    window.mindmapAI.ai.setExpansionPrompt(captureMode === "expanded" && !readOnly ? expansionPrompt : "", tabId);
    return () => window.mindmapAI.ai.setExpansionPrompt("", tabId);
  }, [captureMode, expansionPrompt, readOnly, tabId]);

  return (
    <section data-ai-tab-id={tabId} className={`ai-panel${captureMode === "expanded" ? " ai-panel-expanded" : ""}`}>
      <div className="ai-toolbar">
        <span className="provider-state"><i className={visible ? "online" : ""} />{AI_PROVIDERS[provider].name}</span>
        <span className="security-chip"><ShieldCheck size={13} />隔离</span>
        <label className="hover-capture-toggle" title="悬停识别回答，双击捕获当前回答">
          <input
            type="checkbox"
            aria-label="悬停识别，双击捕获"
            checked={autoHoverCapture}
            disabled={readOnly}
            onChange={(event) => onAutoHoverCaptureChange(event.currentTarget.checked)}
          />悬停双击
        </label>
        <div className="capture-mode-switch" aria-label="提取模式">
          <button className={captureMode === "single" ? "active" : ""} disabled={readOnly} onClick={() => onCaptureModeChange("single")}><Crosshair size={13} />单一节点</button>
          <button className={captureMode === "expanded" ? "active" : ""} disabled={readOnly} onClick={() => onCaptureModeChange("expanded")}><ListTree size={13} />生成子节点</button>
        </div>
        <button aria-label="点选回答" title="在网页中点选一条回答" disabled={readOnly} onClick={() => window.mindmapAI.ai.pickAnswer(tabId)}><MousePointer2 size={15} /></button>
        <button aria-label="AI 设置" title="AI 设置" onClick={onOpenSettings}><Settings size={15} /></button>
        <button aria-label="捕获最新回答" className="capture-button" disabled={readOnly} onClick={() => window.mindmapAI.ai.captureLatest(tabId)}>
          捕获最新
        </button>
      </div>
      {captureMode === "expanded" && (
        <label className="expansion-prompt">
          <span>分点要求（可选）</span>
          <textarea
            aria-label="分点要求（可选）"
            placeholder="例如：半导体的流程有哪些？"
            value={expansionPrompt}
            maxLength={4000}
            rows={2}
            disabled={readOnly}
            onChange={(event) => setExpansionPrompt(event.currentTarget.value)}
          />
          <small>留空自动拆分；填写后按要求调用 API。捕获最新、点选和悬停双击均适用，需先配置 API 密钥。</small>
        </label>
      )}
      <div ref={surfaceRef} className="ai-surface">
        <div className="ai-placeholder">
          <div className="loading-ring" />
          <strong>正在连接{AI_PROVIDERS[provider].name}</strong>
          <span>网页会话在独立沙箱中运行</span>
        </div>
      </div>
    </section>
  );
}
