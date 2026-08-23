import { FolderOpen, Plus, Trash2, X } from "lucide-react";
import type { RecentWorkspaceEntry } from "../../../shared/types.js";

interface WorkspaceSwitcherProps {
  entries: RecentWorkspaceEntry[];
  onClose(): void;
  onSwitch(id: string): void;
  onForget(id: string): void;
  onOpen(): void;
  onCreate(): void;
}

export function WorkspaceSwitcher({
  entries,
  onClose,
  onSwitch,
  onForget,
  onOpen,
  onCreate
}: WorkspaceSwitcherProps): React.JSX.Element {
  return (
    <div className="workspace-switcher-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="workspace-switcher" role="dialog" aria-modal="true" aria-label="切换工作区">
        <header>
          <div><span>RECENT WORKSPACES</span><h2>切换工作区</h2></div>
          <button aria-label="关闭工作区切换" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="workspace-switcher-list">
          {entries.length === 0 ? <p>暂无最近工作区</p> : entries.map((entry) => (
            <div className="workspace-switcher-entry" key={entry.id}>
              <button className="workspace-switcher-open" aria-label={`打开 ${entry.name}`} onClick={() => onSwitch(entry.id)}>
                <FolderOpen size={17} />
                <span><strong>{entry.name}</strong><small>{entry.path}</small></span>
              </button>
              <button aria-label={`从最近列表移除 ${entry.name}`} onClick={() => onForget(entry.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <footer>
          <button onClick={onOpen}><FolderOpen size={15} />打开其他文件夹</button>
          <button className="primary" onClick={onCreate}><Plus size={15} />新建工作区</button>
        </footer>
      </section>
    </div>
  );
}
