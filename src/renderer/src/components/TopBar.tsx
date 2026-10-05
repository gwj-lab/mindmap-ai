import { FolderOpen, LayoutDashboard, Plus, Save, Sparkles, SwitchCamera } from "lucide-react";
import { useProject, type SaveStatus } from "../state/use-project.js";

interface TopBarProps {
  projectName?: string;
  readOnly?: boolean;
  onCreate(): void;
  onOpen(): void;
  onSwitchWorkspace(): void;
  onSave(): void;
  onResetLayout(): void;
}

const labels: Record<SaveStatus, string> = {
  idle: "未打开工作区",
  dirty: "有未保存更改",
  saving: "正在保存…",
  saved: "已保存",
  error: "保存失败"
};

export function TopBar(props: TopBarProps): React.JSX.Element {
  const saveStatus = useProject((state) => state.saveStatus);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Sparkles size={16} /></span>
        <div>
          <strong>Mindmap AI</strong>
          <span>{props.projectName ?? "本地研究工作台"}</span>
        </div>
      </div>
      <nav className="top-actions" aria-label="项目操作">
        <button onClick={props.onCreate}><Plus size={16} />新建工作区</button>
        <button onClick={props.onOpen}><FolderOpen size={16} />打开工作区</button>
        <button onClick={props.onSwitchWorkspace}><SwitchCamera size={16} />切换工作区</button>
        <button onClick={props.onSave} disabled={!props.projectName || props.readOnly}><Save size={16} />保存</button>
        <span className="action-divider" />
        <button onClick={props.onResetLayout} disabled={!props.projectName || props.readOnly}><LayoutDashboard size={16} />恢复布局</button>
      </nav>
      <div className={`save-state save-state--${saveStatus}`}>
        <i />{props.readOnly ? "只读项目" : labels[saveStatus]}
      </div>
    </header>
  );
}
