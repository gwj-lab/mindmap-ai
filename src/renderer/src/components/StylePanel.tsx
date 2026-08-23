import { Moon, Palette, PenLine, Sun } from "lucide-react";
import type { MindMapController } from "./MindMapPanel.js";

type MindMapTheme = "paper" | "night" | "ink";

interface StylePanelProps {
  controller: MindMapController | null;
  currentTheme: MindMapTheme;
  onApplyTheme(theme: MindMapTheme): void;
}

export function StylePanel({ controller, currentTheme, onApplyTheme }: StylePanelProps): React.JSX.Element {
  return (
    <section className="style-panel">
      <header><Palette size={17} /><div><strong>导图外观</strong><span>轻量自定义</span></div></header>
      <p>主题会保存进导图数据，重新打开项目后继续使用。</p>
      <div className="theme-grid">
        <button className={currentTheme === "paper" ? "selected" : ""} onClick={() => onApplyTheme("paper")} disabled={!controller}>
          <span className="theme-swatch theme-paper"><Sun size={18} /></span>
          <strong>纸页</strong><small>清晰、克制</small>
        </button>
        <button className={currentTheme === "night" ? "selected" : ""} onClick={() => onApplyTheme("night")} disabled={!controller}>
          <span className="theme-swatch theme-night"><Moon size={18} /></span>
          <strong>夜读</strong><small>低光研究</small>
        </button>
        <button className={currentTheme === "ink" ? "selected" : ""} onClick={() => onApplyTheme("ink")} disabled={!controller}>
          <span className="theme-swatch theme-ink"><PenLine size={18} /></span>
          <strong>墨线</strong><small>结构优先</small>
        </button>
      </div>
      <div className="shortcut-card">
        <strong>快捷操作</strong>
        <span><kbd>Tab</kbd> 子节点</span>
        <span><kbd>Enter</kbd> 同级节点</span>
        <span><kbd>F2</kbd> 编辑标题</span>
        <span><kbd>Ctrl Z</kbd> 撤销</span>
      </div>
    </section>
  );
}
