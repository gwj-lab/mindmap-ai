import { useEffect, useRef, useState } from "react";
import { Crosshair, ListTree, MousePointer2, Settings, ShieldCheck } from "lucide-react";
import type { UiPreferences } from "../../../shared/types.js";

interface AiPanelProps {
  readOnly?: boolean;
  autoHoverCapture: boolean;
  captureMode: UiPreferences["captureMode"];
  onAutoHoverCaptureChange(enabled: boolean): void;
  onCaptureModeChange(mode: UiPreferences["captureMode"]): void;
  onOpenSettings(): void;
}

export function AiPanel({
  readOnly = false,
  autoHoverCapture,
  captureMode,
  onAutoHoverCaptureChange,
  onCaptureModeChange,
  onOpenSettings
}: AiPanelProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const update = (): void => {
      const rect = surface.getBoundingClientRect();
      const nextVisible = rect.width > 8 && rect.height > 8 && getComputedStyle(surface).visibility !== "hidden";
      setVisible(nextVisible);
      window.mindmapAI.ai.setPanelVisible(nextVisible);
      if (nextVisible) {
        window.mindmapAI.ai.setPanelBounds({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
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
      window.mindmapAI.ai.setPanelVisible(false);
    };
  }, []);

  useEffect(() => {
    window.mindmapAI.ai.setHoverCapture(autoHoverCapture);
  }, [autoHoverCapture]);

  return (
    <section className="ai-panel">
      <div className="ai-toolbar">
        <span className="provider-state"><i className={visible ? "online" : ""} />ChatGPT 网页端</span>
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
        <button aria-label="点选回答" title="在网页中点选一条回答" disabled={readOnly} onClick={() => window.mindmapAI.ai.pickAnswer()}><MousePointer2 size={15} /></button>
        <button aria-label="AI 设置" title="AI 设置" onClick={onOpenSettings}><Settings size={15} /></button>
        <button aria-label="捕获最新回答" className="capture-button" disabled={readOnly} onClick={() => window.mindmapAI.ai.captureLatest()}>
          捕获最新
        </button>
      </div>
      <div ref={surfaceRef} className="ai-surface">
        <div className="ai-placeholder">
          <div className="loading-ring" />
          <strong>正在连接 ChatGPT</strong>
          <span>网页会话在独立沙箱中运行</span>
        </div>
      </div>
    </section>
  );
}
