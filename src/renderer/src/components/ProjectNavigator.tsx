import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderTree,
  Download,
  KeyRound,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type { WorkspaceManifest, WorkspaceProjectRecord } from "../../../shared/types.js";

interface ProjectNavigatorProps {
  workspace: WorkspaceManifest;
  readOnly?: boolean;
  onReparent?(projectId: string, parentProjectId: string | null): void;
  onSwitch(projectId: string): void;
  onCreate(parentProjectId: string | null): void;
  onRename(projectId: string, name: string): void;
  onOpenInExplorer(projectId: string): void;
  onOpenApiSettings(): void;
  onMoveToTrash?(projectId: string): void;
  onRestore?(projectId: string): void;
  onPermanentDelete?(projectId: string): void;
  onExport?(projectId: string): void;
}

function projectIndexes(workspace: WorkspaceManifest): {
  byId: Map<string, WorkspaceProjectRecord>;
  byParent: Map<string | null, WorkspaceProjectRecord[]>;
  breadcrumb: string[];
} {
  const byId = new Map(workspace.projects.map((project) => [project.projectId, project]));
  const byParent = new Map<string | null, WorkspaceProjectRecord[]>();
  for (const project of workspace.projects) {
    const children = byParent.get(project.parentProjectId) ?? [];
    children.push(project);
    byParent.set(project.parentProjectId, children);
  }
  for (const children of byParent.values()) {
    children.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  }
  const names: string[] = [];
  const seen = new Set<string>();
  let projectId = workspace.activeProjectId;
  while (projectId && !seen.has(projectId)) {
    seen.add(projectId);
    const project = byId.get(projectId);
    if (!project) break;
    names.unshift(project.name);
    projectId = project.parentProjectId;
  }
  return { byId, byParent, breadcrumb: names };
}

export function ProjectNavigator({
  workspace,
  readOnly = false,
  onReparent,
  onSwitch,
  onCreate,
  onRename,
  onOpenInExplorer,
  onOpenApiSettings,
  onMoveToTrash = () => undefined,
  onRestore = () => undefined,
  onPermanentDelete = () => undefined,
  onExport = () => undefined
}: ProjectNavigatorProps): React.JSX.Element {
  const [collapsedRail, setCollapsedRail] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dropParentId, setDropParentId] = useState<string | null | undefined>(undefined);
  const { byId, byParent, breadcrumb: pathNames } = useMemo(() => projectIndexes(workspace), [workspace]);
  const childrenOf = (parentId: string | null): WorkspaceProjectRecord[] => byParent.get(parentId) ?? [];
  const canDrop = (projectId: string, parentId: string | null): boolean => {
    const source = byId.get(projectId);
    if (!source || readOnly || !onReparent || source.parentProjectId === parentId) return false;
    const seen = new Set<string>();
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === projectId || seen.has(ancestor)) return false;
      seen.add(ancestor);
      const record = byId.get(ancestor);
      if (!record) return false;
      ancestor = record.parentProjectId;
    }
    return true;
  };
  const dragOver = (event: React.DragEvent, parentId: string | null): void => {
    if (!draggingProjectId || !canDrop(draggingProjectId, parentId)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropParentId(parentId);
  };
  const drop = (event: React.DragEvent, parentId: string | null): void => {
    event.preventDefault();
    event.stopPropagation();
    const projectId = event.dataTransfer.getData("application/x-mindmap-project");
    if (canDrop(projectId, parentId)) {
      onReparent?.(projectId, parentId);
      if (parentId) setCollapsedProjects((current) => { const next = new Set(current); next.delete(parentId); return next; });
    }
    setDraggingProjectId(null);
    setDropParentId(undefined);
    window.mindmapAI?.ai.endLocalDrag();
  };

  const toggleProject = (projectId: string): void => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const renderProject = (project: WorkspaceProjectRecord, depth: number): React.ReactNode => {
    const children = childrenOf(project.projectId);
    const collapsed = collapsedProjects.has(project.projectId);
    const editing = editingProjectId === project.projectId;
    return (
      <li
        key={project.projectId}
        role="treeitem"
        aria-label={project.name}
        aria-current={workspace.activeProjectId === project.projectId ? "page" : undefined}
        aria-expanded={children.length > 0 ? !collapsed : undefined}
      >
        <div
          className={`project-row ${workspace.activeProjectId === project.projectId ? "project-row--active" : ""} ${dropParentId === project.projectId ? "project-row--drop" : ""}`}
          data-project-id={project.projectId}
          draggable={!readOnly && !editing && Boolean(onReparent)}
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-mindmap-project", project.projectId);
            event.dataTransfer.effectAllowed = "move";
            setDraggingProjectId(project.projectId);
            setMenuProjectId(null);
            window.mindmapAI?.ai.beginLocalDrag();
          }}
          onDragEnd={() => { setDraggingProjectId(null); setDropParentId(undefined); window.mindmapAI?.ai.endLocalDrag(); }}
          onDragOver={(event) => dragOver(event, project.projectId)}
          onDragLeave={() => setDropParentId(undefined)}
          onDrop={(event) => drop(event, project.projectId)}
          style={{ paddingInlineStart: `${8 + depth * 16}px` }}
        >
          {children.length > 0 ? (
            <button
              className="project-disclosure"
              aria-label={`${collapsed ? "展开" : "折叠"} ${project.name}`}
              onClick={() => toggleProject(project.projectId)}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : <span className="project-disclosure-spacer" />}
          <FolderTree size={15} />
          {editing ? (
            <input
              autoFocus
              aria-label={`重命名 ${project.name}`}
              defaultValue={project.name}
              maxLength={120}
              onBlur={() => setEditingProjectId(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingProjectId(null);
                if (event.key === "Enter") {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== project.name) onRename(project.projectId, name);
                  setEditingProjectId(null);
                }
              }}
            />
          ) : (
            <button className="project-name" onClick={() => onSwitch(project.projectId)}>{project.name}</button>
          )}
          <button
            className="project-more"
            aria-label={`项目操作 ${project.name}`}
            onClick={() => setMenuProjectId((current) => current === project.projectId ? null : project.projectId)}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuProjectId === project.projectId && (
            <div className="project-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenuProjectId(null); onCreate(project.projectId); }}>
                <Plus size={14} />创建子项目
              </button>
              <button role="menuitem" onClick={() => { setMenuProjectId(null); setEditingProjectId(project.projectId); }}>
                <Pencil size={14} />重命名
              </button>
              <button role="menuitem" onClick={() => { setMenuProjectId(null); onOpenInExplorer(project.projectId); }}>
                <FolderOpen size={14} />在资源管理器中打开
              </button>
              <button role="menuitem" onClick={() => { setMenuProjectId(null); onExport(project.projectId); }}>
                <Download size={14} />导出独立项目
              </button>
              <button className="danger" role="menuitem" onClick={() => { setMenuProjectId(null); onMoveToTrash(project.projectId); }}>
                <Trash2 size={14} />移到项目垃圾箱
              </button>
            </div>
          )}
        </div>
        {!collapsed && children.length > 0 && (
          <ul role="group">{children.map((child) => renderProject(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  if (collapsedRail) {
    return (
      <aside className="project-navigator project-navigator--collapsed">
        <button aria-label="展开项目导航" onClick={() => setCollapsedRail(false)}><PanelLeftOpen size={18} /></button>
      </aside>
    );
  }

  return (
    <aside className="project-navigator">
      <header aria-label="移为主项目" className={dropParentId === null ? "project-root-drop" : undefined} onDragOver={(event) => dragOver(event, null)} onDrop={(event) => drop(event, null)}>
        <div><span>工作区</span><strong>{workspace.name}</strong></div>
        <button aria-label="折叠项目导航" onClick={() => setCollapsedRail(true)}><PanelLeftClose size={17} /></button>
      </header>
      <div className="project-breadcrumb" aria-label="项目路径">{pathNames.join(" / ") || "未选择项目"}</div>
      {draggingProjectId && <div className="project-drag-hint">拖入项目成为子项目；拖到工作区标题成为主项目</div>}
      <ul className="project-tree" role="tree" aria-label="项目">
        {childrenOf(null).map((project) => renderProject(project, 0))}
        {workspace.projectTrash.length > 0 && (
          <li className="project-trash-section" role="none">
            <span>项目垃圾箱 · {workspace.projectTrash.length}</span>
            {workspace.projectTrash.map((project) => (
              <div className="project-trash-row" key={project.projectId}>
                <Trash2 size={13} />
                <span title={project.name}>{project.name}</span>
                <button aria-label={`恢复 ${project.name}`} onClick={() => onRestore(project.projectId)}><RotateCcw size={13} /></button>
                <button aria-label={`彻底删除 ${project.name}`} onClick={() => onPermanentDelete(project.projectId)}><X size={13} /></button>
              </div>
            ))}
          </li>
        )}
      </ul>
      <footer>
        <button onClick={() => onCreate(null)} aria-label="新建主项目"><Plus size={15} />新建主项目</button>
        <button onClick={onOpenApiSettings} aria-label="API 配置"><KeyRound size={15} />API 配置</button>
      </footer>
    </aside>
  );
}
